'use strict';

// ============================================================
// WB-balancer 纯计算模块
// 所有函数均为纯函数，无 DOM 依赖，无副作用。
// 展示理论体积，不做移液取整——用户自行判断实际移液量。
// 浏览器：通过 <script> 标签加载，函数暴露为全局变量。
// Node 测试：通过 require() 导入。
// ============================================================

// ---------- 工具函数 ----------

function toFiniteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 建议预稀释方案。理论体积 < 最小可靠体积时返回稀释倍数和调整后体积。
 */
function suggestPreDilution(theoretical, minVol) {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return null;
  if (!Number.isFinite(minVol) || minVol <= 0) return null;
  if (theoretical >= minVol) return null;
  var factor = Math.ceil(minVol / theoretical);
  return { factor: factor, adjustedVolume: Math.round(theoretical * factor * 1000) / 1000 };
}

/**
 * 校验损耗余量范围 0%–50%。
 */
function validateLossMargin(value) {
  var num = toFiniteNumber(value);
  if (num === null) return { valid: false, value: null, message: '损耗余量无效' };
  if (num < 0) return { valid: false, value: num, message: '损耗余量不能为负数' };
  if (num > 50) return { valid: false, value: num, message: '损耗余量不能超过 50%' };
  return { valid: true, value: num, message: '' };
}

/**
 * 判定样本在当前模式下数值是否有效（只看数字字段，不看名称）。
 * 用于计算最低浓度/参考值——样品名称不应影响数值算法。
 */
function isSampleNumericallyValid(sample, mode, useIndividualVolume) {
  if (mode === 'equalize') {
    var conc = toFiniteNumber(sample.concentration);
    if (!(Number.isFinite(conc) && conc > 0)) return false;
    if (useIndividualVolume) {
      var iv = toFiniteNumber(sample.individualVolume);
      if (!(Number.isFinite(iv) && iv > 0)) return false;
    }
    return true;
  }
  if (mode === 'perWell' || mode === 'prep') {
    var c = toFiniteNumber(sample.concentration);
    return Number.isFinite(c) && c > 0;
  }
  if (mode === 'rebalance') {
    var iv2 = toFiniteNumber(sample.imageIntensity);
    return Number.isFinite(iv2) && iv2 > 0;
  }
  return false;
}

/**
 * 判定样本信息是否完整（含名称）。
 * 用于界面提示——名称为空时显示警告，但不影响参考值计算。
 */
function isSampleComplete(sample, mode, useIndividualVolume) {
  if (!sample.name || !sample.name.trim()) return false;
  return isSampleNumericallyValid(sample, mode, useIndividualVolume);
}

// ---------- 各模式计算 ----------

/**
 * 变性后重新配平 (equalize)
 */
function calculateEqualize(samples, currentVolume, useIndividualVolume) {
  // 用数值有效性（不含名称）筛选参与参考值计算的样本
  var validSamples = samples.filter(function (s) {
    return isSampleNumericallyValid(s, 'equalize', useIndividualVolume);
  });
  var concentrations = validSamples.map(function (s) { return toFiniteNumber(s.concentration); });
  var targetConc = concentrations.length > 0 ? Math.min.apply(null, concentrations) : null;

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var indVol = toFiniteNumber(sample.individualVolume);
    var vol = useIndividualVolume
      ? (Number.isFinite(indVol) && indVol > 0 ? indVol : 0)
      : (Number.isFinite(currentVolume) && currentVolume > 0 ? currentVolume : 0);
    var totalProtein = conc > 0 && vol > 0 ? conc * vol : null;
    var finalVol = totalProtein !== null && targetConc !== null && targetConc > 0 ? totalProtein / targetConc : null;
    var loading = finalVol !== null && vol >= 0 ? Math.max(0, finalVol - vol) : null;

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) w('未填写样本名');
    if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
    if (useIndividualVolume) {
      if (!Number.isFinite(vol) || vol <= 0) e('样本体积无效');
    } else {
      if (!Number.isFinite(currentVolume) || currentVolume <= 0) e('样本当前体积无效');
    }
    if (targetConc === null) e('至少需要一个有效样本');
    if (Number.isFinite(finalVol) && finalVol > 0 && finalVol < vol - 1e-9) e('计算错误：最终体积小于当前体积');
    if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('需加 1× Loading 体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配平');

    return {
      name: sample.name, index: index, concentration: conc,
      currentVolume: vol, totalProtein: totalProtein,
      targetConcentration: targetConc, finalVolume: finalVol,
      loadingVolume: loading,
      messages: msgs, severity: sev
    };
  });

  return {
    results: results,
    reference: targetConc,
    summary: {
      mode: 'equalize',
      targetConcentration: targetConc,
      currentVolume: currentVolume,
      useIndividualVolume: useIndividualVolume,
      validCount: validSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * 上样配平 (perWell)
 * 损耗余量同比放大样品量和总体积，保证损耗后剩余蛋白量仍满足目标。
 */
function calculatePerWell(samples, settings) {
  var targetMass = settings.targetMass;
  var finalVolume = settings.finalVolume;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginRatio = lossMargin / 100;
  var totalWithMargin = finalVolume * (1 + marginRatio);

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'perWell', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    // 理论取样体积（损耗前）
    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    // 损耗余量同比放大样品量
    var sampleVolBase = Number.isFinite(theoreticalVol) ? theoreticalVol * (1 + marginRatio) : null;
    // 预稀释检查（基于放大后的体积）
    var dilution = suggestPreDilution(sampleVolBase, minVol);
    // 预稀释后的移液体积
    var sampleVol = dilution ? dilution.adjustedVolume : sampleVolBase;
    // 原液实际消耗量 = 理论取样体积 × (1 + 损耗)
    var originalConsumed = Number.isFinite(theoreticalVol) ? theoreticalVol * (1 + marginRatio) : null;
    // Loading = 总体积 - 样品移液体积
    var loading = Number.isFinite(sampleVol) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) w('未填写样本名');
    if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) e('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('统一上样体积无效');
    if (marginError) e(marginError);
    if (Number.isFinite(loading) && loading < -1e-9) e('样品体积超过总体积，请降低目标蛋白量或增大上样体积');
    // 可用体积：用原液消耗量检查，不是稀释后体积
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(originalConsumed) && originalConsumed > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(sampleVolBase) && sampleVolBase > 0 && sampleVolBase < minVol && dilution) {
      w('取样体积 ' + sampleVolBase.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(sampleVolBase) && sampleVolBase > 0 && sampleVolBase < minVol && !dilution) w('取样体积 < 0.5 µL');
    if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配平');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingVolume: loading,
      finalVolume: totalWithMargin, dilution: dilution,
      originalConsumed: originalConsumed, availableVolume: availableVol,
      messages: msgs, severity: sev
    };
  });

  return {
    results: results,
    reference: null,
    summary: {
      mode: 'perWell',
      targetMass: targetMass,
      finalVolume: finalVolume,
      totalWithMargin: totalWithMargin,
      lossMargin: lossMargin,
      marginError: marginError,
      validCount: validSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * ImageJ 配平 (rebalance)
 *
 * 上轮取样体积处理规则：
 *   - 所有有效样本都填了 prevVolume → 按"相对浓度 = ImageJ ÷ 上轮体积"归一化
 *   - 所有有效样本都没填 prevVolume → 直接用 ImageJ 值作为相对浓度
 *   - 部分填写 → 报错，不允许混用计算基准
 */
function calculateRebalance(samples, settings) {
  var finalVolume = settings.finalVolume;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginRatio = lossMargin / 100;
  var totalWithMargin = finalVolume * (1 + marginRatio);

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;

  // 数值有效的样本
  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'rebalance', false); });

  // 检查 prevVolume 填写一致性
  var validWithPrev = validSamples.filter(function (s) {
    var pv = toFiniteNumber(s.prevVolume);
    return Number.isFinite(pv) && pv > 0;
  });
  var partialPrevError = null;
  if (validWithPrev.length > 0 && validWithPrev.length < validSamples.length) {
    partialPrevError = '上轮取样体积必须全部填写或全部留空，不允许部分填写';
  }

  // 计算参考值
  var reference = null;
  var relativeConcs = null; // { imageIntensity, prevVolume, relativeConc }
  if (!partialPrevError && validSamples.length > 0) {
    if (validWithPrev.length > 0) {
      // 有上轮体积：按相对浓度归一化
      relativeConcs = validWithPrev.map(function (s) {
        var iv = toFiniteNumber(s.imageIntensity);
        var pv = toFiniteNumber(s.prevVolume);
        return { imageIntensity: iv, prevVolume: pv, relativeConc: iv / pv };
      });
      var minRel = Math.min.apply(null, relativeConcs.map(function (r) { return r.relativeConc; }));
      reference = minRel;
    } else {
      // 无上轮体积：直接用 ImageJ 值
      var intensities = validSamples.map(function (s) { return toFiniteNumber(s.imageIntensity); });
      reference = Math.min.apply(null, intensities);
    }
  }

  var results = samples.map(function (sample, index) {
    var imageVal = toFiniteNumber(sample.imageIntensity);
    var availableVol = toFiniteNumber(sample.availableVolume);
    var prevVol = toFiniteNumber(sample.prevVolume);
    var hasPrev = Number.isFinite(prevVol) && prevVol > 0;

    var sampleVol = null;
    if (reference !== null && Number.isFinite(imageVal) && imageVal > 0) {
      if (relativeConcs) {
        // 归一化模式：sampleVol = totalWithMargin × 参考相对浓度 ÷ 样本相对浓度
        var rc = hasPrev ? imageVal / prevVol : null;
        if (Number.isFinite(rc) && rc > 0) {
          sampleVol = totalWithMargin * reference / rc;
        }
      } else {
        // 直接模式：sampleVol = totalWithMargin × 参考值 ÷ ImageJ 值
        sampleVol = totalWithMargin * reference / imageVal;
      }
    }

    // 预稀释
    var dilution = suggestPreDilution(sampleVol, minVol);
    var pipettingVol = dilution ? dilution.adjustedVolume : sampleVol;
    // 原液消耗量 = 样品体积（预稀释前的值，即实际消耗的原液量）
    var originalConsumed = sampleVol;
    var loading = Number.isFinite(pipettingVol) && totalWithMargin > 0 ? totalWithMargin - pipettingVol : null;

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) w('未填写样本名');
    if (!Number.isFinite(imageVal) || imageVal <= 0) e('ImageJ 内参值无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('统一上样体积无效');
    if (marginError) e(marginError);
    if (partialPrevError) e(partialPrevError);
    if (reference === null && (Number.isFinite(imageVal) && imageVal > 0)) e('至少需要一个有效样本');
    if (Number.isFinite(loading) && loading < -1e-9) e('计算错误');
    // 可用体积：用原液消耗量检查
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(originalConsumed) && originalConsumed > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(sampleVol) && sampleVol > 0 && sampleVol < minVol && dilution) {
      w('取样体积 ' + sampleVol.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(sampleVol) && sampleVol > 0 && sampleVol < minVol && !dilution) w('取样体积 < 0.5 µL');
    if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配平');

    return {
      name: sample.name, index: index, imageIntensity: imageVal,
      sampleVolume: pipettingVol, loadingVolume: loading,
      finalVolume: totalWithMargin, dilution: dilution,
      originalConsumed: originalConsumed, availableVolume: availableVol,
      messages: msgs, severity: sev
    };
  });

  return {
    results: results,
    reference: reference,
    summary: {
      mode: 'rebalance',
      finalVolume: finalVolume,
      totalWithMargin: totalWithMargin,
      lossMargin: lossMargin,
      reference: reference,
      partialPrevError: partialPrevError,
      useNormalized: relativeConcs !== null,
      validCount: validSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * 未变性样品配平 (prep)
 * 损耗余量同比放大所有组分，守恒：sampleVol + loadingBufferVol + makeupVol = totalWithMargin
 */
function calculatePrep(samples, settings) {
  var targetMass = settings.targetMass;
  var finalVolume = settings.finalVolume;
  var bufferFactor = settings.loadingBufferFactor;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginRatio = lossMargin / 100;
  var totalWithMargin = finalVolume * (1 + marginRatio);

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'prep', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    // 理论样品体积（损耗前）
    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    // 损耗余量同比放大样品量
    var sampleVolBase = Number.isFinite(theoreticalVol) ? theoreticalVol * (1 + marginRatio) : null;
    // 预稀释
    var dilution = suggestPreDilution(sampleVolBase, minVol);
    var sampleVol = dilution ? dilution.adjustedVolume : sampleVolBase;
    // 原液消耗量 = 理论取样 × (1 + 损耗)
    var originalConsumed = Number.isFinite(theoreticalVol) ? theoreticalVol * (1 + marginRatio) : null;
    // Loading Buffer 体积
    var loadingBufferVol = totalWithMargin > 0 && bufferFactor > 0 ? totalWithMargin / bufferFactor : null;
    // 补液体积 = 总体积 - 样品体积 - Loading Buffer
    var makeupVol = null;
    if (Number.isFinite(sampleVol) && Number.isFinite(loadingBufferVol)) {
      makeupVol = totalWithMargin - sampleVol - loadingBufferVol;
      if (makeupVol < 0 && makeupVol > -1e-9) makeupVol = 0;
    }

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) w('未填写样本名');
    if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) e('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('最终体积无效');
    if (!Number.isFinite(bufferFactor) || bufferFactor <= 0) e('Loading Buffer 倍数无效');
    if (marginError) e(marginError);
    if (Number.isFinite(makeupVol) && makeupVol < -1e-9) e('补液体积为负，当前参数不可配制，请调整目标蛋白量或最终体积');
    // 可用体积：用原液消耗量检查
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(originalConsumed) && originalConsumed > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(sampleVolBase) && sampleVolBase > 0 && sampleVolBase < minVol && dilution) {
      w('样品体积 ' + sampleVolBase.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(sampleVolBase) && sampleVolBase > 0 && sampleVolBase < minVol && !dilution) w('样品体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配制');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingBufferVol: loadingBufferVol,
      makeupVol: makeupVol, finalVolume: totalWithMargin,
      dilution: dilution, originalConsumed: originalConsumed,
      availableVolume: availableVol, messages: msgs, severity: sev
    };
  });

  return {
    results: results,
    reference: null,
    summary: {
      mode: 'prep',
      targetMass: targetMass,
      finalVolume: finalVolume,
      totalWithMargin: totalWithMargin,
      bufferFactor: bufferFactor,
      lossMargin: lossMargin,
      marginError: marginError,
      validCount: validSamples.length,
      totalCount: samples.length
    }
  };
}

// ---------- Node.js 测试导出 ----------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toFiniteNumber: toFiniteNumber,
    suggestPreDilution: suggestPreDilution,
    validateLossMargin: validateLossMargin,
    isSampleComplete: isSampleComplete,
    isSampleNumericallyValid: isSampleNumericallyValid,
    calculateEqualize: calculateEqualize,
    calculatePerWell: calculatePerWell,
    calculateRebalance: calculateRebalance,
    calculatePrep: calculatePrep
  };
}
