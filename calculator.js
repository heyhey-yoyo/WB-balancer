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
  if (mode === 'rebalance') {
    var intensity = toFiniteNumber(sample.imageIntensity);
    return Number.isFinite(intensity) && intensity > 0;
  }
  // equalize / perWell / prep：浓度有效即可；equalize 开启逐样本体积时还需体积有效
  var conc = toFiniteNumber(sample.concentration);
  if (!(Number.isFinite(conc) && conc > 0)) return false;
  if (mode === 'equalize' && useIndividualVolume) {
    var iv = toFiniteNumber(sample.individualVolume);
    if (!(Number.isFinite(iv) && iv > 0)) return false;
  }
  return true;
}

function isSampleComplete(sample, mode, useIndividualVolume) {
  if (!sample.name || !sample.name.trim()) return false;
  return isSampleNumericallyValid(sample, mode, useIndividualVolume);
}

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

var DERIVED_RANGE_ERROR = '计算结果超出可处理范围，请减小输入数值';

// ---------- 各模式共用辅助 ----------

var MIN_RELIABLE_VOLUME = 0.5;

/**
 * 收集样本校验消息，按最严重级别判定结果状态。
 * finish() 在无消息时补默认文案并返回最终 severity（ok / warning / error）。
 */
function createMessages(defaultText) {
  var messages = [];
  var severity = 'ok';
  return {
    messages: messages,
    error: function (message) { messages.push(message); severity = 'error'; },
    warn: function (message) { messages.push(message); if (severity !== 'error') severity = 'warning'; },
    finish: function () { if (messages.length === 0) messages.push(defaultText); return severity; },
  };
}

/** 两个有限数相乘，任一无效 → null。用于"理论体积 × 放大系数"与"原液消耗量"。 */
function multiplyFinite(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a * b : null;
}

/** 最终体积 × 放大系数；放大系数无效或体积非正 → null。 */
function scaledTotal(finalVolume, scaleFactor) {
  return Number.isFinite(scaleFactor) && finalVolume > 0 ? finalVolume * scaleFactor : null;
}

/** 体积低于最小可靠体积时建议预稀释，返回 { dilution, volume }；volume 为最终移液体积。 */
function applyPreDilution(volume) {
  var dilution = suggestPreDilution(volume, MIN_RELIABLE_VOLUME);
  return { dilution: dilution, volume: dilution ? dilution.adjustedVolume : volume };
}

function warnMissingName(sample, warn) {
  if (!sample.name || !sample.name.trim()) warn('未填写样本名');
}

/** Loading 体积 > 0 但小于最小可靠体积时警告；noun 决定文案前缀。 */
function warnSmallLoading(loading, warn, noun) {
  if (Number.isFinite(loading) && loading > 0 && loading < MIN_RELIABLE_VOLUME) warn(noun + ' < 0.5 µL');
}

/** 原液消耗量超过可用体积时报错（预稀释场景下 originalConsumed 为原液消耗）。 */
function errorIfNotEnoughAvailable(availableVol, originalConsumed, error) {
  if (Number.isFinite(availableVol) && availableVol >= 0 &&
      Number.isFinite(originalConsumed) && originalConsumed > availableVol + 1e-9) {
    error('可用体积不足');
  }
}

/** 体积低于最小可靠体积时的预稀释建议；noun 决定文案主语（取样体积/样品体积）。 */
function warnPreDilution(volume, dilution, warn, noun) {
  if (!Number.isFinite(volume) || volume <= 0 || volume >= MIN_RELIABLE_VOLUME) return;
  if (dilution) {
    warn(noun + ' ' + volume.toFixed(2) + ' µL 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + dilution.adjustedVolume.toFixed(2) + ' µL');
  } else {
    warn(noun + ' < 0.5 µL');
  }
}

function allPositive(values) {
  for (var i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || values[i] <= 0) return false;
  }
  return true;
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

    var c = createMessages('可以配平');

    warnMissingName(sample, c.warn);
    if (!Number.isFinite(conc) || conc <= 0) c.error('浓度无效');
    if (useIndividualVolume) {
      if (!Number.isFinite(vol) || vol <= 0) c.error('样本体积无效');
    } else {
      if (!Number.isFinite(currentVolume) || currentVolume <= 0) c.error('样本当前体积无效');
    }
    if (targetConc === null) c.error('至少需要一个有效样本');
    if (isFinitePositive(conc) && isFinitePositive(vol) && isFinitePositive(targetConc) &&
        (!isFinitePositive(totalProtein) || !isFinitePositive(finalVol) || !isFiniteNonNegative(loading))) {
      c.error(DERIVED_RANGE_ERROR);
    }
    if (Number.isFinite(finalVol) && finalVol > 0 && finalVol < vol - 1e-9) c.error('计算错误：最终体积小于当前体积');
    warnSmallLoading(loading, c.warn, '需加 1× Loading 体积');

    return {
      name: sample.name, index: index, concentration: conc,
      currentVolume: vol, totalProtein: totalProtein,
      targetConcentration: targetConc, finalVolume: finalVol,
      loadingVolume: loading,
      messages: c.messages, severity: c.finish()
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

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = scaledTotal(finalVolume, scaleFactor);

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'perWell', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    var sampleVolBase = multiplyFinite(theoreticalVol, scaleFactor);
    var dilutionStep = applyPreDilution(sampleVolBase);
    var dilution = dilutionStep.dilution;
    var sampleVol = dilutionStep.volume;
    var originalConsumed = sampleVolBase;
    var loading = Number.isFinite(sampleVol) && Number.isFinite(totalWithMargin) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

    var c = createMessages('可以配平');

    warnMissingName(sample, c.warn);
    if (!Number.isFinite(conc) || conc <= 0) c.error('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) c.error('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) c.error('统一上样体积无效');
    if (marginError) c.error(marginError);
    if (isFinitePositive(conc) && isFinitePositive(targetMass) && isFinitePositive(finalVolume) && marginCheck.valid &&
        (!allPositive([theoreticalVol, sampleVolBase, sampleVol, originalConsumed, totalWithMargin]) || !Number.isFinite(loading))) {
      c.error(DERIVED_RANGE_ERROR);
    }
    if (Number.isFinite(loading) && loading < -1e-9) c.error('样品体积超过总体积，请降低目标蛋白量或增大上样体积');
    errorIfNotEnoughAvailable(availableVol, originalConsumed, c.error);
    warnPreDilution(sampleVolBase, dilution, c.warn, '取样体积');
    warnSmallLoading(loading, c.warn, '1× Loading 体积');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingVolume: loading,
      finalVolume: totalWithMargin, dilution: dilution,
      originalConsumed: originalConsumed, availableVolume: availableVol,
      messages: c.messages, severity: c.finish()
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

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = scaledTotal(finalVolume, scaleFactor);

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

    var dilutionStep = applyPreDilution(sampleVol);
    var dilution = dilutionStep.dilution;
    var pipettingVol = dilutionStep.volume;
    var originalConsumed = sampleVol;
    var loading = Number.isFinite(pipettingVol) && Number.isFinite(totalWithMargin) && totalWithMargin > 0 ? totalWithMargin - pipettingVol : null;

    var c = createMessages('可以配平');

    warnMissingName(sample, c.warn);
    if (!Number.isFinite(imageVal) || imageVal <= 0) c.error('ImageJ 内参值无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) c.error('统一上样体积无效');
    if (marginError) c.error(marginError);
    if (partialPrevError) c.error(partialPrevError);
    if (reference === null && (Number.isFinite(imageVal) && imageVal > 0)) c.error('至少需要一个有效样本');
    if (isFinitePositive(imageVal) && isFinitePositive(finalVolume) && marginCheck.valid && !partialPrevError &&
        (!allPositive([reference, totalWithMargin, sampleVol, pipettingVol]) || !Number.isFinite(loading))) {
      c.error(DERIVED_RANGE_ERROR);
    }
    if (Number.isFinite(loading) && loading < -1e-9) c.error('计算错误');
    errorIfNotEnoughAvailable(availableVol, originalConsumed, c.error);
    warnPreDilution(sampleVol, dilution, c.warn, '取样体积');
    warnSmallLoading(loading, c.warn, '1× Loading 体积');

    return {
      name: sample.name, index: index, imageIntensity: imageVal,
      sampleVolume: pipettingVol, loadingVolume: loading,
      finalVolume: totalWithMargin, dilution: dilution,
      originalConsumed: originalConsumed, availableVolume: availableVol,
      messages: c.messages, severity: c.finish()
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
      marginError: marginError,
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

  var marginCheck = validateLossMargin(lossMargin);
  var marginError = !marginCheck.valid ? marginCheck.message : null;
  var scaleFactor = marginCheck.valid ? lossScaleFactor(marginCheck.value) : null;
  var totalWithMargin = scaledTotal(finalVolume, scaleFactor);

  var validSamples = samples.filter(function (s) { return isSampleNumericallyValid(s, 'prep', false); });

  var results = samples.map(function (sample, index) {
    var conc = toFiniteNumber(sample.concentration);
    var availableVol = toFiniteNumber(sample.availableVolume);

    var theoreticalVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    var sampleVolBase = multiplyFinite(theoreticalVol, scaleFactor);
    var dilutionStep = applyPreDilution(sampleVolBase);
    var dilution = dilutionStep.dilution;
    var sampleVol = dilutionStep.volume;
    var originalConsumed = sampleVolBase;
    var loadingBufferVol = Number.isFinite(totalWithMargin) && totalWithMargin > 0 && bufferFactor > 0 ? totalWithMargin / bufferFactor : null;
    var makeupVol = null;
    if (Number.isFinite(sampleVol) && Number.isFinite(loadingBufferVol) && Number.isFinite(totalWithMargin)) {
      makeupVol = totalWithMargin - sampleVol - loadingBufferVol;
      if (makeupVol < 0 && makeupVol > -1e-9) makeupVol = 0;
    }

    var c = createMessages('可以配制');

    warnMissingName(sample, c.warn);
    if (!Number.isFinite(conc) || conc <= 0) c.error('浓度无效');
    if (!Number.isFinite(targetMass) || targetMass <= 0) c.error('目标蛋白量无效');
    if (!Number.isFinite(finalVolume) || finalVolume <= 0) c.error('最终体积无效');
    if (!Number.isFinite(bufferFactor) || bufferFactor <= 0) c.error('Loading Buffer 倍数无效');
    if (marginError) c.error(marginError);
    if (isFinitePositive(conc) && isFinitePositive(targetMass) && isFinitePositive(finalVolume) && isFinitePositive(bufferFactor) && marginCheck.valid &&
        (!allPositive([theoreticalVol, sampleVolBase, sampleVol, originalConsumed, totalWithMargin, loadingBufferVol]) || !Number.isFinite(makeupVol))) {
      c.error(DERIVED_RANGE_ERROR);
    }
    if (Number.isFinite(makeupVol) && makeupVol < -1e-9) c.error('补液体积为负，当前参数不可配制，请调整目标蛋白量或最终体积');
    errorIfNotEnoughAvailable(availableVol, originalConsumed, c.error);
    warnPreDilution(sampleVolBase, dilution, c.warn, '样品体积');

    return {
      name: sample.name, index: index, concentration: conc,
      sampleVolume: sampleVol, loadingBufferVol: loadingBufferVol,
      makeupVol: makeupVol, finalVolume: totalWithMargin,
      dilution: dilution, originalConsumed: originalConsumed,
      availableVolume: availableVol, messages: c.messages, severity: c.finish()
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
