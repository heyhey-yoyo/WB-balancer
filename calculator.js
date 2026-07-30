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

function suggestPreDilution(theoretical, minVol) {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return null;
  if (!Number.isFinite(minVol) || minVol <= 0) return null;
  if (theoretical >= minVol) return null;
  var factor = Math.ceil(minVol / theoretical);
  return { factor: factor, adjustedVolume: Math.round(theoretical * factor * 1000) / 1000 };
}

/**
 * 校验预计损耗率范围 0%–50%。
 * 公式：放大系数 = 1 / (1 − 损耗率)，严格补偿损耗后仍满足目标。
 */
function validateLossMargin(value) {
  var num = toFiniteNumber(value);
  if (num === null) return { valid: false, value: null, message: '预计损耗率无效' };
  if (num < 0) return { valid: false, value: num, message: '预计损耗率不能为负数' };
  if (num > 50) return { valid: false, value: num, message: '预计损耗率不能超过 50%' };
  return { valid: true, value: num, message: '' };
}

/**
 * 根据预计损耗率计算放大系数。
 * scaleFactor = 1 / (1 − lossPercent / 100)
 * 0% → 1；超出 0%–50% 或非数字 → null。
 */
function lossScaleFactor(lossPercent) {
  var check = validateLossMargin(lossPercent);
  if (!check.valid) return null;
  if (check.value === 0) return 1;
  return 1 / (1 - check.value / 100);
}

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

function isSampleComplete(sample, mode, useIndividualVolume) {
  if (!sample.name || !sample.name.trim()) return false;
  return isSampleNumericallyValid(sample, mode, useIndividualVolume);
}

// ---------- 各模式计算 ----------

function calculateEqualize(samples, currentVolume, useIndividualVolume) {
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
 * 预计损耗率通过严格补偿公式同比放大样品量和总体积：
 * scaleFactor = 1 / (1 − lossMargin/100)
 * 保证配制量 × (1 − 损耗率) = 目标量。
 */
function calculatePerWell(samples, settings) {
  var targetMass = settings.targetMass;
  var finalVolume = settings.finalVolume;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = Number.isFinite(scaleFactor) && finalVolume > 0 ? finalVolume * scaleFactor : null;

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'perWell', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    var sampleVolBase = Number.isFinite(theoreticalVol) && Number.isFinite(scaleFactor) ? theoreticalVol * scaleFactor : null;
    var dilution = suggestPreDilution(sampleVolBase, minVol);
    var sampleVol = dilution ? dilution.adjustedVolume : sampleVolBase;
    var originalConsumed = Number.isFinite(theoreticalVol) && Number.isFinite(scaleFactor) ? theoreticalVol * scaleFactor : null;
    var loading = Number.isFinite(sampleVol) && Number.isFinite(totalWithMargin) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

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
      scaleFactor: scaleFactor,
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
 *   - 都填了 → 按"相对浓度 = ImageJ ÷ 上轮体积"归一化
 *   - 都没填 → 直接用 ImageJ 值作为相对浓度
 *   - 部分填写 → 报错
 */
function calculateRebalance(samples, settings) {
  var finalVolume = settings.finalVolume;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = Number.isFinite(scaleFactor) && finalVolume > 0 ? finalVolume * scaleFactor : null;

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'rebalance', false); });

  var validWithPrev = validSamples.filter(function (s) {
    var pv = toFiniteNumber(s.prevVolume);
    return Number.isFinite(pv) && pv > 0;
  });
  var partialPrevError = null;
  if (validWithPrev.length > 0 && validWithPrev.length < validSamples.length) {
    partialPrevError = '上轮取样体积必须全部填写或全部留空，不允许部分填写';
  }

  // 计算参考值：归一化模式用相对浓度，否则用原始 ImageJ
  var reference = null;
  var relativeConcs = null;
  if (!partialPrevError && validSamples.length > 0) {
    if (validWithPrev.length > 0) {
      relativeConcs = validWithPrev.map(function (s) {
        var iv = toFiniteNumber(s.imageIntensity);
        var pv = toFiniteNumber(s.prevVolume);
        return { imageIntensity: iv, prevVolume: pv, relativeConc: iv / pv };
      });
      reference = Math.min.apply(null, relativeConcs.map(function (r) { return r.relativeConc; }));
    } else {
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
    if (Number.isFinite(totalWithMargin) && reference !== null && Number.isFinite(imageVal) && imageVal > 0) {
      if (relativeConcs) {
        var rc = hasPrev ? imageVal / prevVol : null;
        if (Number.isFinite(rc) && rc > 0) {
          sampleVol = totalWithMargin * reference / rc;
        }
      } else {
        sampleVol = totalWithMargin * reference / imageVal;
      }
    }

    var dilution = suggestPreDilution(sampleVol, minVol);
    var pipettingVol = dilution ? dilution.adjustedVolume : sampleVol;
    var originalConsumed = sampleVol;
    var loading = Number.isFinite(pipettingVol) && Number.isFinite(totalWithMargin) && totalWithMargin > 0 ? totalWithMargin - pipettingVol : null;

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
      scaleFactor: scaleFactor,
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
 * 预计损耗率通过严格补偿公式同比放大所有组分。
 */
function calculatePrep(samples, settings) {
  var targetMass = settings.targetMass;
  var finalVolume = settings.finalVolume;
  var bufferFactor = settings.loadingBufferFactor;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = Number.isFinite(scaleFactor) && finalVolume > 0 ? finalVolume * scaleFactor : null;

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'prep', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    var sampleVolBase = Number.isFinite(theoreticalVol) && Number.isFinite(scaleFactor) ? theoreticalVol * scaleFactor : null;
    var dilution = suggestPreDilution(sampleVolBase, minVol);
    var sampleVol = dilution ? dilution.adjustedVolume : sampleVolBase;
    var originalConsumed = Number.isFinite(theoreticalVol) && Number.isFinite(scaleFactor) ? theoreticalVol * scaleFactor : null;
    var loadingBufferVol = Number.isFinite(totalWithMargin) && totalWithMargin > 0 && bufferFactor > 0 ? totalWithMargin / bufferFactor : null;
    var makeupVol = null;
    if (Number.isFinite(sampleVol) && Number.isFinite(loadingBufferVol) && Number.isFinite(totalWithMargin)) {
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
      scaleFactor: scaleFactor,
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
    lossScaleFactor: lossScaleFactor,
    isSampleComplete: isSampleComplete,
    isSampleNumericallyValid: isSampleNumericallyValid,
    calculateEqualize: calculateEqualize,
    calculatePerWell: calculatePerWell,
    calculateRebalance: calculateRebalance,
    calculatePrep: calculatePrep
  };
}
