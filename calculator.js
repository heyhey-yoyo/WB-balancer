'use strict';

// ============================================================
// WB-balancer 纯计算模块
// 所有函数均为纯函数，无 DOM 依赖，无副作用。
// 不包含移液取整——展示理论体积，由用户自行判断实际移液量。
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
 * 返回 { factor, adjustedVolume } 或 null（不需稀释时）。
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
 * 判定样本在当前模式下是否"字段完整有效"。
 * 只有完整的样本才参与最低浓度/参考值计算。
 */
function isSampleComplete(sample, mode, useIndividualVolume) {
  if (!sample.name || !sample.name.trim()) return false;
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

// ---------- 各模式计算 ----------

/**
 * 变性后重新配平 (equalize)
 * 以最低浓度为目标，通过加入 1× Loading 将各样本稀释至同一浓度。
 */
function calculateEqualize(samples, currentVolume, useIndividualVolume) {
  var completeSamples = samples.filter(function (s) {
    return isSampleComplete(s, 'equalize', useIndividualVolume);
  });
  var concentrations = completeSamples.map(function (s) { return toFiniteNumber(s.concentration); });
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

    if (!sample.name || !sample.name.trim()) e('请填写样本名');
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
      completeCount: completeSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * 上样配平 (perWell)
 * 按每孔目标蛋白量和各样本浓度计算取样体积，用 1× Loading 补足到统一上样体积。
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

  var completeSamples = samples.filter(function (s) { return isSampleComplete(s, 'perWell', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    // 理论取样体积
    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    // 预稀释检查
    var dilution = suggestPreDilution(theoreticalVol, minVol);
    // 样品体积 = 预稀释调整后的体积（不取整）
    var sampleVol = dilution ? dilution.adjustedVolume : theoreticalVol;
    // Loading 体积 = 总体积 - 样品体积
    var loading = Number.isFinite(sampleVol) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) e('请填写样本名');
    if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) e('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('统一上样体积无效');
    if (marginError) e(marginError);
    if (Number.isFinite(loading) && loading < -1e-9) e('样本体积超过总体积，请降低目标蛋白量或增大上样体积');
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(sampleVol) && sampleVol > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && dilution) {
      w('理论取样量 ' + theoreticalVol.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && !dilution) w('取样体积 < 0.5 µL');
    if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配平');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingVolume: loading,
      finalVolume: totalWithMargin, dilution: dilution,
      availableVolume: availableVol, messages: msgs, severity: sev
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
      completeCount: completeSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * ImageJ 配平 (rebalance)
 * 以 ImageJ 内参值作为相对浓度，以最低值为参考按比值修正取样体积。
 */
function calculateRebalance(samples, settings) {
  var finalVolume = settings.finalVolume;
  var lossMargin = settings.lossMargin;
  var minVol = 0.5;

  var marginRatio = lossMargin / 100;
  var totalWithMargin = finalVolume * (1 + marginRatio);

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;

  var completeSamples = samples.filter(function (s) { return isSampleComplete(s, 'rebalance', false); });
  var intensities = completeSamples.map(function (s) { return toFiniteNumber(s.imageIntensity); }).filter(function (v) { return Number.isFinite(v) && v > 0; });
  var reference = intensities.length > 0 ? Math.min.apply(null, intensities) : null;

  var hasPrevVolumes = samples.some(function (s) {
    var pv = toFiniteNumber(s.prevVolume);
    return Number.isFinite(pv) && pv > 0;
  });

  var results = samples.map(function (sample, index) {
    var imageVal = toFiniteNumber(sample.imageIntensity);
    var availableVol = toFiniteNumber(sample.availableVolume);
    var prevVol = toFiniteNumber(sample.prevVolume);
    var adj = imageVal > 0 && reference > 0 ? reference / imageVal : null;
    var baseVol = hasPrevVolumes && Number.isFinite(prevVol) && prevVol > 0 ? prevVol * (1 + marginRatio) : totalWithMargin;
    // 理论体积
    var theoreticalVol = Number.isFinite(adj) && baseVol > 0 ? baseVol * adj : null;
    // 预稀释 → 样品体积（不取整）
    var dilution = suggestPreDilution(theoreticalVol, minVol);
    var sampleVol = dilution ? dilution.adjustedVolume : theoreticalVol;
    // Loading = 总体积 - 样品体积
    var loading = Number.isFinite(sampleVol) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

    var msgs = [];
    var sev = 'ok';
    var e = function (m) { msgs.push(m); sev = 'error'; };
    var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

    if (!sample.name || !sample.name.trim()) e('请填写样本名');
    if (!Number.isFinite(imageVal) || imageVal <= 0) e('ImageJ 内参值无效');
    if (!Number.isFinite(reference) || reference <= 0) e('至少需要一个有效的 ImageJ 内参值');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('统一上样体积无效');
    if (marginError) e(marginError);
    if (Number.isFinite(loading) && loading < -1e-9) e('计算错误');
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(sampleVol) && sampleVol > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && dilution) {
      w('理论取样量 ' + theoreticalVol.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && !dilution) w('取样体积 < 0.5 µL');
    if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配平');

    return {
      name: sample.name, index: index, imageIntensity: imageVal,
      adjustmentFactor: adj, sampleVolume: sampleVol,
      loadingVolume: loading, finalVolume: totalWithMargin,
      availableVolume: availableVol, dilution: dilution,
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
      hasPrevVolumes: hasPrevVolumes,
      completeCount: completeSamples.length,
      totalCount: samples.length
    }
  };
}

/**
 * 未变性样品配平 (prep)
 * 同时计算样品、Loading Buffer 和补液体积。
 * 核心守恒：sampleVol + loadingBufferVol + makeupVol = totalWithMargin
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

  var completeSamples = samples.filter(function (s) { return isSampleComplete(s, 'prep', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    // 理论样品体积
    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    // 预稀释 → 样品体积（不取整）
    var dilution = suggestPreDilution(theoreticalVol, minVol);
    var sampleVol = dilution ? dilution.adjustedVolume : theoreticalVol;
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

    if (!sample.name || !sample.name.trim()) e('请填写样本名');
    if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) e('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) e('最终体积无效');
    if (!Number.isFinite(bufferFactor) || bufferFactor <= 0) e('Loading Buffer 倍数无效');
    if (marginError) e(marginError);
    if (Number.isFinite(makeupVol) && makeupVol < -1e-9) e('补液体积为负，当前参数不可配制，请调整目标蛋白量或最终体积');
    if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(sampleVol) && sampleVol > availableVol + 1e-9) w('可用体积不足');
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && dilution) {
      w('样品体积 ' + theoreticalVol.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
    }
    if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && !dilution) w('样品体积 < 0.5 µL');
    if (msgs.length === 0) msgs.push('可以配制');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingBufferVol: loadingBufferVol,
      makeupVol: makeupVol, finalVolume: totalWithMargin,
      dilution: dilution, availableVolume: availableVol,
      messages: msgs, severity: sev
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
      completeCount: completeSamples.length,
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
    calculateEqualize: calculateEqualize,
    calculatePerWell: calculatePerWell,
    calculateRebalance: calculateRebalance,
    calculatePrep: calculatePrep
  };
}
