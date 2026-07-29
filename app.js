'use strict';

const STORAGE_KEY = 'wb-balancer-v4';

const elements = {
  workflowSelect: document.querySelector('#workflowSelect'),
  modeDescription: document.querySelector('#modeDescription'),
  targetMass: document.querySelector('#targetMass'),
  finalVolume: document.querySelector('#finalVolume'),
  currentVolume: document.querySelector('#currentVolume'),
  targetMassField: document.querySelector('#targetMassField'),
  finalVolumeField: document.querySelector('#finalVolumeField'),
  currentVolumeField: document.querySelector('#currentVolumeField'),
  individualVolumeToggle: document.querySelector('#individualVolumeToggle'),
  useIndividualVolume: document.querySelector('#useIndividualVolume'),
  bufferFactorField: document.querySelector('#bufferFactorField'),
  loadingBufferFactor: document.querySelector('#loadingBufferFactor'),
  lossMarginField: document.querySelector('#lossMarginField'),
  lossMargin: document.querySelector('#lossMargin'),
  rebalanceNotice: document.querySelector('#rebalanceNotice'),
  imagejTips: document.querySelector('#imagejTips'),
  samplesBody: document.querySelector('#samplesBody'),
  imageHeader: document.querySelector('#imageHeader'),
  concentrationHeader: document.querySelector('#concentrationHeader'),
  availableHeader: document.querySelector('#availableHeader'),
  volumeHeader: document.querySelector('#volumeHeader'),
  prevVolumeHeader: document.querySelector('#prevVolumeHeader'),
  resultsHead: document.querySelector('#resultsHead'),
  resultsBody: document.querySelector('#resultsBody'),
  summary: document.querySelector('#summary'),
  alerts: document.querySelector('#alerts'),
  formulaNote: document.querySelector('#formulaNote'),
  template: document.querySelector('#sampleRowTemplate'),
  addSampleBtn: document.querySelector('#addSampleBtn'),
  resetBtn: document.querySelector('#resetBtn'),
  copyBtn: document.querySelector('#copyBtn'),
  pasteBtn: document.querySelector('#pasteBtn'),
  pasteArea: document.querySelector('#pasteArea'),
  clearDataBtn: document.querySelector('#clearDataBtn'),
  exampleDataBtn: document.querySelector('#exampleDataBtn'),
};

let state = getDefaultState();
let latestResults = [];
let latestReference = null;

function blankSamples() {
  return [
    { name: 'Sample 1', concentration: '', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '' },
    { name: 'Sample 2', concentration: '', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '' },
    { name: 'Sample 3', concentration: '', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '' },
  ];
}

function getDefaultState() {
  return {
    workflowMode: 'equalize',
    targetMass: 20,
    finalVolume: 20,
    currentVolume: 100,
    useIndividualVolume: false,
    loadingBufferFactor: 5,
    lossMargin: 0,
    samplesByMode: {
      equalize: blankSamples(),
      perWell: blankSamples(),
      rebalance: blankSamples(),
      prep: blankSamples(),
    },
    samples: blankSamples(),
  };
}

function saveCurrentSamples() {
  state.samplesByMode[state.workflowMode] = state.samples.map(function (s) {
    return { name: s.name, concentration: s.concentration, individualVolume: s.individualVolume, prevVolume: s.prevVolume, availableVolume: s.availableVolume, imageIntensity: s.imageIntensity };
  });
}

function loadModeSamples() {
  var saved = state.samplesByMode[state.workflowMode];
  if (saved && saved.length > 0) {
    state.samples = saved.map(function (s) {
      return { name: s.name, concentration: s.concentration || '', individualVolume: s.individualVolume || '', prevVolume: s.prevVolume || '', availableVolume: s.availableVolume || '', imageIntensity: s.imageIntensity || '' };
    });
  } else {
    state.samples = blankSamples();
  }
}

function toFiniteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatVolume(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2) + ' µL';
}

function formatNumber(value, decimals) {
  if (decimals === undefined) decimals = 3;
  return Number.isFinite(value) ? value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '') : '—';
}

function formatConcentration(value) {
  return Number.isFinite(value) ? formatNumber(value) + ' µg/µL' : '—';
}

function formatIntensity(value) {
  return Number.isFinite(value) ? formatNumber(value) : '—';
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function roundToStep(value, step, minVol) {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (!Number.isFinite(step) || step <= 0) step = 0.1;
  if (!Number.isFinite(minVol)) minVol = 0;
  var rounded = Math.round(value / step) * step;
  rounded = Math.round(rounded * 1000) / 1000;
  if (rounded === 0 && value > 0 && minVol > 0) return minVol;
  return Math.max(minVol, rounded);
}

function suggestPreDilution(theoretical, minVol) {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return null;
  if (!Number.isFinite(minVol) || minVol <= 0) return null;
  if (theoretical >= minVol) return null;
  var factor = Math.ceil(minVol / theoretical);
  return { factor: factor, adjustedVolume: theoretical * factor };
}

function loadState() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    var def = getDefaultState();
    state = Object.assign(def, saved);
    // Backward compat: if no samplesByMode, migrate old samples into equalize mode
    if (!state.samplesByMode) {
      if (Array.isArray(saved.samples)) {
        var migrated = saved.samples.map(function (s, i) { return { name: s.name || 'Sample ' + (i + 1), concentration: s.concentration || '', individualVolume: s.individualVolume || '', prevVolume: s.prevVolume || '', availableVolume: s.availableVolume || '', imageIntensity: s.imageIntensity || '' }; });
        state.samplesByMode = { equalize: migrated, perWell: blankSamples(), rebalance: blankSamples(), prep: blankSamples() };
      } else {
        state.samplesByMode = def.samplesByMode;
      }
    }
    // Load current mode's samples
    loadModeSamples();
  } catch (error) {
    console.warn('无法读取本地保存的数据：', error);
  }
}

function saveState() {
  saveCurrentSamples();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('无法保存本地数据：', error);
  }
}

function getModeDescription() {
  if (state.workflowMode === 'equalize') {
    return '所有样本已变性且体积一致（如 100 µL）。以最低浓度为目标，通过加入 1× Loading 将各样本稀释至同一浓度。';
  }
  if (state.workflowMode === 'perWell') {
    return '按每孔目标蛋白量和各样本浓度计算取样体积，用 1× Loading 补足到统一上样体积。';
  }
  if (state.workflowMode === 'rebalance') {
    return '以 ImageJ 内参值作为相对浓度，按参考值与各样本的比值修正取样体积。适用于上一轮各样本取样体积相同的情况。';
  }
  return '适用于未变性的蛋白样品。输入蛋白浓度后，自动计算样品、Loading Buffer 和补液体积。';
}

function getFormulaNote() {
  if (state.workflowMode === 'equalize') {
    return '<strong>变性后重新配平：</strong>目标浓度 = 所有样本最低浓度；总蛋白量 = 浓度 × 体积；最终体积 = 总蛋白量 ÷ 目标浓度；需加 1× Loading = 最终体积 − 当前体积。最低浓度样本无需加入 Loading。';
  }
  if (state.workflowMode === 'perWell') {
    return '<strong>上样配平：</strong>样本体积 = 每孔目标蛋白量 ÷ 浓度；1× Loading = 统一上样体积 − 样本体积。样本体积超过可用体积时请检查。';
  }
  if (state.workflowMode === 'rebalance') {
    return '<strong>ImageJ 配平：</strong>修正样本体积 = 统一上样体积 × (参考值 ÷ ImageJ 值)；1× Loading = 统一上样体积 − 修正样本体积。如填写了上轮取样体积则以此为基准计算。';
  }
  return '<strong>未变性样品配平：</strong>样品体积 = 目标蛋白量 ÷ 浓度；Loading Buffer 体积 = 最终体积 ÷ Buffer 倍数；补液体积 = 最终体积 − 样品体积 − Loading Buffer。';
}

function syncControlsFromState() {
  elements.targetMass.value = state.targetMass;
  elements.finalVolume.value = state.finalVolume;
  elements.currentVolume.value = state.currentVolume;
  elements.useIndividualVolume.checked = state.useIndividualVolume;

  elements.workflowSelect.value = state.workflowMode;
  var mode = state.workflowMode;
  var isEqualize = mode === 'equalize';
  var isPerWell = mode === 'perWell';
  var isRebalance = mode === 'rebalance';

  elements.targetMassField.classList.toggle('hidden', !isPerWell);
  elements.finalVolumeField.classList.toggle('hidden', isEqualize);
  elements.currentVolumeField.classList.toggle('hidden', !isEqualize);
  elements.currentVolume.disabled = state.useIndividualVolume;
  elements.individualVolumeToggle.classList.toggle('hidden', !isEqualize);
  var isPrep = mode === 'prep';
  elements.rebalanceNotice.classList.toggle('hidden', !isRebalance);
  elements.imagejTips.classList.toggle('hidden', !isRebalance);
  elements.bufferFactorField.classList.toggle('hidden', !isPrep);
  elements.lossMarginField.classList.toggle('hidden', isEqualize);
  elements.loadingBufferFactor.value = state.loadingBufferFactor;
  elements.lossMargin.value = state.lossMargin;
  elements.modeDescription.textContent = getModeDescription();
  elements.formulaNote.innerHTML = getFormulaNote();
}

function renderSampleRows() {
  elements.samplesBody.innerHTML = '';
  var mode = state.workflowMode;
  var isPrep = mode === 'prep';
  var showConcentration = mode !== 'rebalance' || isPrep;
  var showImage = mode === 'rebalance';
  var showAvailable = mode !== 'equalize' && !isPrep;
  var showIndividualVolume = mode === 'equalize' && state.useIndividualVolume;
  var showPrevVolume = mode === 'rebalance';

  elements.volumeHeader.classList.toggle('hidden', !showIndividualVolume);
  elements.concentrationHeader.classList.toggle('hidden', !showConcentration);
  elements.prevVolumeHeader.classList.toggle('hidden', !showPrevVolume);
  elements.imageHeader.classList.toggle('hidden', !showImage);
  elements.availableHeader.classList.toggle('hidden', !showAvailable);

  state.samples.forEach(function (sample, index) {
    var row = elements.template.content.firstElementChild.cloneNode(true);
    row.dataset.index = String(index);
    row.querySelector('.sample-name').value = sample.name || '';
    row.querySelector('.sample-volume').value = sample.individualVolume || '';
    row.querySelector('.sample-concentration').value = sample.concentration || '';
    row.querySelector('.sample-prevvolume').value = sample.prevVolume || '';
    row.querySelector('.sample-available').value = sample.availableVolume || '';
    row.querySelector('.sample-image').value = sample.imageIntensity || '';
    row.querySelector('.sample-volume-cell').classList.toggle('hidden', !showIndividualVolume);
    row.querySelector('.sample-concentration-cell').classList.toggle('hidden', !showConcentration);
    row.querySelector('.sample-prevvolume-cell').classList.toggle('hidden', !showPrevVolume);
    row.querySelector('.sample-image-cell').classList.toggle('hidden', !showImage);
    row.querySelector('.sample-available-cell').classList.toggle('hidden', !showAvailable);
    elements.samplesBody.appendChild(row);
  });
}

function readSettings() {
  state.targetMass = toFiniteNumber(elements.targetMass.value) || 0;
  state.finalVolume = toFiniteNumber(elements.finalVolume.value) || 0;
  state.currentVolume = toFiniteNumber(elements.currentVolume.value) || 0;
  state.loadingBufferFactor = toFiniteNumber(elements.loadingBufferFactor.value) || 5;
  state.lossMargin = toFiniteNumber(elements.lossMargin.value) || 0;
}

function getReferenceIntensity(samples) {
  if (state.workflowMode !== 'rebalance') return null;
  var values = samples.map(function (s) { return s.imageIntensity; }).filter(function (v) { return Number.isFinite(v) && v > 0; });
  return values.length ? Math.min.apply(null, values) : null;
}

function calculate() {
  readSettings();
  var mode = state.workflowMode;
  var minVol = 0.5;
  var step = 0.1;

  if (mode === 'equalize') {
    // === 变性后重新配平 ===
    var concentrations = state.samples.map(function (s) { return toFiniteNumber(s.concentration); }).filter(function (c) { return Number.isFinite(c) && c > 0; });
    var targetConc = concentrations.length > 0 ? Math.min.apply(null, concentrations) : null;
    latestReference = targetConc;

    latestResults = state.samples.map(function (sample, index) {
      var conc = toFiniteNumber(sample.concentration);
      var indVol = toFiniteNumber(sample.individualVolume);
      var vol = state.useIndividualVolume
        ? (Number.isFinite(indVol) && indVol > 0 ? indVol : 0)
        : (Number.isFinite(state.currentVolume) && state.currentVolume > 0 ? state.currentVolume : 0);
      var totalProtein = conc > 0 && vol > 0 ? conc * vol : null;
      var finalVol = totalProtein !== null && targetConc !== null && targetConc > 0 ? totalProtein / targetConc : null;
      var loading = finalVol !== null ? Math.max(0, finalVol - vol) : null;

      var msgs = [];
      var sev = 'ok';
      var e = function (m) { msgs.push(m); sev = 'error'; };
      var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

      if (!sample.name.trim()) e('请填写样本名');
      if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
      if (state.useIndividualVolume) {
        if (!Number.isFinite(vol) || vol <= 0) e('样本体积无效');
      } else {
        if (!Number.isFinite(state.currentVolume) || state.currentVolume <= 0) e('样本当前体积无效');
      }
      if (concentrations.length === 0) e('至少需要一个有效的蛋白浓度');
      if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('需加 1× Loading 体积 < 0.5 µL');
      if (Number.isFinite(loading) && loading < -1e-9) e('计算错误');
      if (msgs.length === 0) msgs.push('可以配平');

      return { name: sample.name, index: index, concentration: conc, currentVolume: vol, totalProtein: totalProtein, targetConcentration: targetConc, finalVolume: finalVol, loadingVolume: loading, messages: msgs, severity: sev };
    });
  } else if (mode === 'perWell') {
    // === 上样配平 ===
    var margin = (state.lossMargin || 0) / 100;
    var totalWithMargin = state.finalVolume * (1 + margin);
    latestReference = null;
    latestResults = state.samples.map(function (sample, index) {
      var conc = toFiniteNumber(sample.concentration);
      var availableVol = toFiniteNumber(sample.availableVolume);
      var theoreticalVol = conc > 0 && state.targetMass > 0 ? state.targetMass / conc : null;
      var loading = Number.isFinite(theoreticalVol) && totalWithMargin > 0 ? totalWithMargin - theoreticalVol : null;

      var dilution = suggestPreDilution(theoreticalVol, minVol);
      var actualVol = roundToStep(theoreticalVol, step, minVol);

      var msgs = [];
      var sev = 'ok';
      var e = function (m) { msgs.push(m); sev = 'error'; };
      var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

      if (!sample.name.trim()) e('请填写样本名');
      if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
      if (!Number.isFinite(state.targetMass) || state.targetMass <= 0) e('目标蛋白量无效');
      if (!Number.isFinite(state.finalVolume) || state.finalVolume <= 0) e('统一上样体积无效');
      if (Number.isFinite(loading) && loading < -1e-9) e('样本体积超过总体积，请降低目标蛋白量或增大上样体积');
      if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(theoreticalVol) && theoreticalVol > availableVol + 1e-9) w('变性样本可用体积不足');
      if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < minVol && dilution) w('理论取样量 ' + formatVolume(theoreticalVol) + ' 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + formatVolume(dilution.adjustedVolume));
      if (Number.isFinite(theoreticalVol) && theoreticalVol > 0 && theoreticalVol < 0.5) w('取样体积 < 0.5 µL');
      if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
      if (msgs.length === 0) msgs.push('可以配平');

      return { name: sample.name, index: index, concentration: conc, availableVolume: availableVol, theoreticalVolume: theoreticalVol, actualVolume: actualVol, loadingVolume: loading, finalVolume: totalWithMargin, dilution: dilution, messages: msgs, severity: sev };
    });
  } else if (mode === 'rebalance') {
    // === ImageJ 配平 ===
    var margin = (state.lossMargin || 0) / 100;
    var totalWithMargin = state.finalVolume * (1 + margin);
    var samplesWithIntensity = state.samples.map(function (s) { return { imageIntensity: toFiniteNumber(s.imageIntensity) }; });
    var reference = getReferenceIntensity(samplesWithIntensity);
    latestReference = reference;

    var hasPrevVolumes = state.samples.some(function (s) { return toFiniteNumber(s.prevVolume) !== null && toFiniteNumber(s.prevVolume) > 0; });

    latestResults = state.samples.map(function (sample, index) {
      var imageVal = toFiniteNumber(sample.imageIntensity);
      var availableVol = toFiniteNumber(sample.availableVolume);
      var prevVol = toFiniteNumber(sample.prevVolume);
      var adj = imageVal > 0 && reference > 0 ? reference / imageVal : null;
      var baseVol = hasPrevVolumes && Number.isFinite(prevVol) && prevVol > 0 ? prevVol * (1 + margin) : totalWithMargin;
      var sampleVol = Number.isFinite(adj) && baseVol > 0 ? baseVol * adj : null;
      var loading = Number.isFinite(sampleVol) && totalWithMargin > 0 ? totalWithMargin - sampleVol : null;

      var actualVol = roundToStep(sampleVol, step, minVol);
      var dilution = suggestPreDilution(sampleVol, minVol);

      var msgs = [];
      var sev = 'ok';
      var e = function (m) { msgs.push(m); sev = 'error'; };
      var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

      if (!sample.name.trim()) e('请填写样本名');
      if (!Number.isFinite(state.finalVolume) || state.finalVolume <= 0) e('统一上样体积无效');
      if (!Number.isFinite(imageVal) || imageVal <= 0) e('ImageJ 内参值无效');
      if (!Number.isFinite(reference) || reference <= 0) e('至少需要一个有效的 ImageJ 内参值');
      if (Number.isFinite(loading) && loading < -1e-9) {
        e('计算错误');
      }
      if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(sampleVol) && sampleVol > availableVol + 1e-9) w('变性样本可用体积不足');
      if (Number.isFinite(sampleVol) && sampleVol > 0 && sampleVol < minVol && dilution) w('理论取样量 ' + formatVolume(sampleVol) + ' 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + formatVolume(dilution.adjustedVolume));
      if (Number.isFinite(sampleVol) && sampleVol > 0 && sampleVol < 0.5) w('取样体积 < 0.5 µL');
      if (Number.isFinite(loading) && loading > 0 && loading < 0.5) w('1× Loading 体积 < 0.5 µL');
      if (msgs.length === 0) msgs.push('可以配平');

      return { name: sample.name, index: index, imageIntensity: imageVal, adjustmentFactor: adj, sampleVolume: sampleVol, actualVolume: actualVol, loadingVolume: loading, finalVolume: totalWithMargin, availableVolume: availableVol, dilution: dilution, messages: msgs, severity: sev };
    });
  } else {
    // === 未变性样品配平 ===
    var bufferFactor = state.loadingBufferFactor;
    var margin = (state.lossMargin || 0) / 100;

    latestReference = null;
    latestResults = state.samples.map(function (sample, index) {
      var conc = toFiniteNumber(sample.concentration);
      var availableVol = toFiniteNumber(sample.availableVolume);
      var sampleVol = conc > 0 && state.targetMass > 0 ? state.targetMass / conc : null;
      var totalWithMargin = state.finalVolume * (1 + margin);
      var loadingVol = state.finalVolume > 0 && bufferFactor > 0 ? totalWithMargin / bufferFactor : null;
      var makeupVol = Number.isFinite(sampleVol) && Number.isFinite(loadingVol)
        ? totalWithMargin - sampleVol - loadingVol
        : null;
      var actualSampleVol = roundToStep(sampleVol, step, minVol);
      var actualMakeupVol = Number.isFinite(actualSampleVol) ? totalWithMargin - actualSampleVol - loadingVol : null;
      var dilution = suggestPreDilution(sampleVol, minVol);

      var msgs = [];
      var sev = 'ok';
      var e = function (m) { msgs.push(m); sev = 'error'; };
      var w = function (m) { msgs.push(m); if (sev !== 'error') sev = 'warning'; };

      if (!sample.name.trim()) e('请填写样本名');
      if (!Number.isFinite(conc) || conc <= 0) e('浓度无效');
      if (!Number.isFinite(state.targetMass) || state.targetMass <= 0) e('目标蛋白量无效');
      if (!Number.isFinite(state.finalVolume) || state.finalVolume <= 0) e('最终体积无效');
      if (!Number.isFinite(bufferFactor) || bufferFactor <= 0) e('Loading Buffer 倍数无效');
      if (Number.isFinite(makeupVol) && makeupVol < -1e-9) e('补液体积为负，当前参数不可配制，请调整目标蛋白量或最终体积');
      if (Number.isFinite(availableVol) && availableVol >= 0 && Number.isFinite(sampleVol) && sampleVol > availableVol + 1e-9) w('可用体积不足');
      if (Number.isFinite(sampleVol) && sampleVol > 0 && sampleVol < minVol && dilution) w('样品体积 ' + formatVolume(sampleVol) + ' 低于最小可靠体积，建议预稀释 1:' + dilution.factor + ' 后取 ' + formatVolume(dilution.adjustedVolume));
      if (msgs.length === 0) msgs.push('可以配制');

      return { name: sample.name, index: index, concentration: conc, sampleVolume: sampleVol, actualSampleVol: actualSampleVol, loadingVol: loadingVol, makeupVol: makeupVol, actualMakeupVol: actualMakeupVol, finalVolume: totalWithMargin, margin: margin, dilution: dilution, availableVolume: availableVol, messages: msgs, severity: sev };
    });
  }

  renderResults();
  saveState();
}

function summaryValue(value) {
  return '<span class="summary-value">' + value + '</span>';
}

function renderResults() {
  var validCount = latestResults.filter(function (r) { return r.severity !== 'error'; }).length;
  var warnCount = latestResults.filter(function (r) { return r.severity === 'warning'; }).length;
  var errCount = latestResults.filter(function (r) { return r.severity === 'error'; }).length;
  var mode = state.workflowMode;

  if (mode === 'equalize') {
    elements.summary.innerHTML =
      '<div class="summary-item"><span class="summary-label">目标浓度（最低）</span>' + summaryValue(latestReference !== null ? formatConcentration(latestReference) : '—') + '</div>' +
      '<div class="summary-item"><span class="summary-label">' + (state.useIndividualVolume ? '样本体积' : '样本当前体积') + '</span>' + summaryValue(state.useIndividualVolume ? '各样本不同' : formatVolume(state.currentVolume)) + '</div>' +
      '<div class="summary-item"><span class="summary-label">配平模式</span>' + summaryValue('变性后重新配平') + '</div>' +
      '<div class="summary-item"><span class="summary-label">有效样本</span>' + summaryValue(validCount + ' / ' + latestResults.length) + '</div>';
  } else if (mode === 'perWell') {
    elements.summary.innerHTML =
      '<div class="summary-item"><span class="summary-label">目标蛋白量 / 孔</span>' + summaryValue(state.targetMass > 0 ? formatNumber(state.targetMass, 2) + ' µg' : '—') + '</div>' +
      '<div class="summary-item"><span class="summary-label">统一上样体积</span>' + summaryValue(formatVolume(state.finalVolume)) + '</div>' +
      '<div class="summary-item"><span class="summary-label">配平模式</span>' + summaryValue('上样配平') + '</div>' +
      '<div class="summary-item"><span class="summary-label">有效样本</span>' + summaryValue(validCount + ' / ' + latestResults.length) + '</div>';
  } else if (mode === 'rebalance') {
    elements.summary.innerHTML =
      '<div class="summary-item"><span class="summary-label">参考 ImageJ（最低值）</span>' + summaryValue(formatIntensity(latestReference)) + '</div>' +
      '<div class="summary-item"><span class="summary-label">统一上样体积</span>' + summaryValue(formatVolume(state.finalVolume)) + '</div>' +
      '<div class="summary-item"><span class="summary-label">配平模式</span>' + summaryValue('ImageJ 配平') + '</div>' +
      '<div class="summary-item"><span class="summary-label">有效样本</span>' + summaryValue(validCount + ' / ' + latestResults.length) + '</div>';
  } else {
    elements.summary.innerHTML =
      '<div class="summary-item"><span class="summary-label">目标蛋白量</span>' + summaryValue(state.targetMass > 0 ? formatNumber(state.targetMass, 2) + ' µg' : '—') + '</div>' +
      '<div class="summary-item"><span class="summary-label">Buffer 倍数</span>' + summaryValue((state.loadingBufferFactor || 5) + '×') + '</div>' +
      '<div class="summary-item"><span class="summary-label">有效样本</span>' + summaryValue(validCount + ' / ' + latestResults.length) + '</div>';
  }

  var alerts = [];
  if (mode === 'rebalance' && Number.isFinite(latestReference)) {
    alerts.push('<div class="alert alert-success">以最低 ImageJ 值 ' + formatIntensity(latestReference) + ' 为参考，低者占满体积。</div>');
  } else if (mode === 'equalize' && Number.isFinite(latestReference)) {
    alerts.push('<div class="alert alert-success">目标浓度（最低样本浓度）为 ' + formatConcentration(latestReference) + '。最低浓度样本无需加入 1× Loading。</div>');
  }
  if (warnCount > 0) alerts.push('<div class="alert alert-warning">有 ' + warnCount + ' 个样本的体积在可操作范围边缘，请检查。</div>');
  if (errCount > 0) alerts.push('<div class="alert alert-danger">有 ' + errCount + ' 个样本无法按当前参数计算，请修正红色状态项。</div>');
  elements.alerts.innerHTML = alerts.join('');

  if (latestResults.length === 0) {
    elements.resultsHead.innerHTML = '';
    elements.resultsBody.innerHTML = '<tr><td colspan="10" class="empty-cell">请先添加样本。</td></tr>';
    return;
  }

  var showPipetting = mode !== 'equalize';
  var headers;
  if (mode === 'equalize') {
    headers = ['样本', '浓度', '目标浓度', '最终体积', '需加 1× Loading', '状态'];
  } else if (mode === 'perWell') {
    headers = showPipetting
      ? ['样本', '浓度', '理论取样', '建议实取', '1× Loading', '统一上样体积', '状态']
      : ['样本', '浓度', '样本体积', '1× Loading', '统一上样体积', '状态'];
  } else if (mode === 'rebalance') {
    headers = showPipetting
      ? ['样本', 'ImageJ', '建议实取', '1× Loading', '统一上样体积', '状态']
      : ['样本', 'ImageJ', '1× Loading', '统一上样体积', '状态'];
  } else {
    headers = ['样本', '浓度', '样品', 'Loading Buffer', '补液', '总体积', '状态'];
  }
  elements.resultsHead.innerHTML = headers.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('');

  elements.resultsBody.innerHTML = latestResults.map(function (r) {
    var sc = r.severity === 'ok' ? 'status-ok' : r.severity === 'warning' ? 'status-warning' : 'status-error';
    var st = '<span class="status ' + sc + '">' + escapeHtml(r.messages.join('；')) + '</span>';
    if (mode === 'equalize') {
      return '<tr><td>' + escapeHtml(r.name || '样本 ' + (r.index + 1)) + '</td><td>' + formatConcentration(r.concentration) + '</td><td>' + (r.targetConcentration ? formatConcentration(r.targetConcentration) : '—') + '</td><td>' + formatVolume(r.finalVolume) + '</td><td class="loading-col">' + formatVolume(r.loadingVolume) + '</td><td>' + st + '</td></tr>';
    }
    if (mode === 'perWell') {
      var theoVol = formatVolume(r.theoreticalVolume);
      var actualVol = formatVolume(r.actualVolume);
      if (r.dilution) {
        theoVol += ' <span class="dilution-hint">(1:' + r.dilution.factor + '预稀释)</span>';
        actualVol += ' <span class="dilution-hint">(' + formatVolume(r.dilution.adjustedVolume) + ')</span>';
      }
      return '<tr><td>' + escapeHtml(r.name || '样本 ' + (r.index + 1)) + '</td><td>' + formatConcentration(r.concentration) + '</td><td>' + theoVol + '</td><td class="loading-col">' + actualVol + '</td><td class="loading-col">' + formatVolume(r.loadingVolume) + '</td><td>' + formatVolume(r.finalVolume) + '</td><td>' + st + '</td></tr>';
    }
    if (mode === 'rebalance') {
      var av2 = formatVolume(r.actualVolume);
      if (r.dilution) {
        av2 += ' <span class="dilution-hint">(' + formatVolume(r.dilution.adjustedVolume) + ')</span>';
      }
      return '<tr><td>' + escapeHtml(r.name || '样本 ' + (r.index + 1)) + '</td><td>' + formatIntensity(r.imageIntensity) + '</td><td class="loading-col">' + av2 + '</td><td class="loading-col">' + formatVolume(r.loadingVolume) + '</td><td>' + formatVolume(r.finalVolume) + '</td><td>' + st + '</td></tr>';
    }
    // prep mode
    var sv2 = formatVolume(r.actualSampleVol);
    var mv2 = formatVolume(r.actualMakeupVol);
    if (r.dilution) {
      sv2 += ' <span class="dilution-hint">(1:' + r.dilution.factor + ')</span>';
    }
    return '<tr><td>' + escapeHtml(r.name || '样本 ' + (r.index + 1)) + '</td><td>' + formatConcentration(r.concentration) + '</td><td class="loading-col">' + sv2 + '</td><td>' + formatVolume(r.loadingVol) + '</td><td>' + mv2 + '</td><td>' + formatVolume(r.finalVolume) + '</td><td>' + st + '</td></tr>';
  }).join('');
}

function addSample(sample) {
  if (!sample) sample = {};
  state.samples.push({
    name: sample.name || 'Sample ' + (state.samples.length + 1),
    concentration: sample.concentration || '',
    individualVolume: sample.individualVolume || '',
    prevVolume: sample.prevVolume || '',
    availableVolume: sample.availableVolume || '',
    imageIntensity: sample.imageIntensity || '',
  });
  renderSampleRows();
  calculate();
  elements.samplesBody.lastElementChild && elements.samplesBody.lastElementChild.querySelector('.sample-name') && elements.samplesBody.lastElementChild.querySelector('.sample-name').focus();
}

function updateSampleFromInput(input) {
  var row = input.closest('tr');
  var index = Number(row && row.dataset.index);
  if (!Number.isInteger(index) || !state.samples[index]) return;
  if (input.classList.contains('sample-name')) state.samples[index].name = input.value;
  if (input.classList.contains('sample-volume')) state.samples[index].individualVolume = input.value;
  if (input.classList.contains('sample-concentration')) state.samples[index].concentration = input.value;
  if (input.classList.contains('sample-prevvolume')) state.samples[index].prevVolume = input.value;
  if (input.classList.contains('sample-available')) state.samples[index].availableVolume = input.value;
  if (input.classList.contains('sample-image')) state.samples[index].imageIntensity = input.value;
  calculate();
}

function pasteData() {
  elements.pasteArea.classList.toggle('hidden');
  elements.pasteArea.focus();
  if (elements.pasteArea.classList.contains('hidden')) return;
  elements.pasteArea.oninput = function () {
    var text = elements.pasteArea.value.trim();
    if (!text) return;
    var isRebalance = state.workflowMode === 'rebalance';
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var imported = lines.map(function (line) {
      var cols = line.split('\t');
      return {
        name: (cols[0] || '').trim(),
        // ImageJ 配平模式下第二列是内参值，其余模式是蛋白浓度
        concentration: isRebalance ? '' : (cols[1] || '').trim(),
        individualVolume: (cols[2] || '').trim(),
        availableVolume: (cols[3] || '').trim(),
        imageIntensity: isRebalance ? (cols[1] || '').trim() : (cols[4] || '').trim(),
        prevVolume: '',
      };
    }).filter(function (s) { return s.name || s.concentration || s.imageIntensity; });
    if (imported.length > 0) {
      state.samples = imported;
      renderSampleRows();
      calculate();
      elements.pasteArea.classList.add('hidden');
    }
  };
}

async function copyResults() {
  var headers;
  var mode = state.workflowMode;
  if (mode === 'equalize') {
    headers = ['样本', '浓度', '目标浓度', '最终体积(µL)', '需加 1× Loading(µL)', '状态'];
  } else if (mode === 'perWell') {
    headers = ['样本', '浓度', '理论取样(µL)', '建议实取(µL)', '1× Loading(µL)', '统一上样体积(µL)', '状态'];
  } else if (mode === 'rebalance') {
    headers = ['样本', 'ImageJ', '建议实取(µL)', '1× Loading(µL)', '统一上样体积(µL)', '状态'];
  } else {
    headers = ['样本', '浓度', '样品(µL)', 'LB(µL)', '补液(µL)', '总体积(µL)', '状态'];
  }
  var rows = latestResults.map(function (r) {
    if (mode === 'equalize') return [r.name, r.concentration || '', formatNumber(r.targetConcentration, 3), formatNumber(r.finalVolume, 2), formatNumber(r.loadingVolume, 2), r.messages.join('；')];
    if (mode === 'perWell') return [r.name, r.concentration || '', formatNumber(r.theoreticalVolume, 2), formatNumber(r.actualVolume, 2), formatNumber(r.loadingVolume, 2), formatNumber(r.finalVolume, 2), r.messages.join('；')];
    if (mode === 'rebalance') return [r.name, r.imageIntensity || '', formatNumber(r.actualVolume, 2), formatNumber(r.loadingVolume, 2), formatNumber(r.finalVolume, 2), r.messages.join('；')];
    return [r.name, r.concentration || '', formatNumber(r.actualSampleVol, 2), formatNumber(r.loadingVol, 2), formatNumber(r.actualMakeupVol, 2), formatNumber(r.finalVolume, 2), r.messages.join('；')];
  });
  var text = [headers].concat(rows).map(function (row) { return row.join('\t'); }).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    var orig = elements.copyBtn.textContent;
    elements.copyBtn.textContent = '已复制';
    setTimeout(function () { elements.copyBtn.textContent = orig; }, 1200);
  } catch (e) {
    window.prompt('请手动复制以下内容：', text);
  }
}

function bindEvents() {
  [elements.targetMass, elements.finalVolume, elements.currentVolume, elements.loadingBufferFactor, elements.lossMargin].forEach(function (el) { el && el.addEventListener('input', calculate); });

  elements.useIndividualVolume.addEventListener('change', function () {
    state.useIndividualVolume = elements.useIndividualVolume.checked;
    syncControlsFromState();
    renderSampleRows();
    calculate();
  });

  elements.workflowSelect.addEventListener('change', function () {
    saveCurrentSamples();
    state.workflowMode = elements.workflowSelect.value;
    loadModeSamples();
    syncControlsFromState();
    renderSampleRows();
    calculate();
  });

  elements.addSampleBtn.addEventListener('click', function () { addSample(); });
  elements.samplesBody.addEventListener('input', function (e) { if (e.target instanceof HTMLInputElement) updateSampleFromInput(e.target); });
  elements.samplesBody.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.remove-sample');
    var copyBtn = e.target.closest('.copy-row-btn');
    if (removeBtn) {
      var row = removeBtn.closest('tr');
      var idx = Number(row && row.dataset.index);
      if (Number.isInteger(idx)) { state.samples.splice(idx, 1); renderSampleRows(); calculate(); }
    }
    if (copyBtn) {
      var cr = copyBtn.closest('tr');
      var ci = Number(cr && cr.dataset.index);
      if (Number.isInteger(ci) && state.samples[ci]) {
        addSample(Object.assign({}, state.samples[ci], { name: (state.samples[ci].name || 'Sample') + ' copy' }));
      }
    }
  });

  elements.resetBtn.addEventListener('click', function () {
    if (!window.confirm('确定恢复默认？当前数据将被清除。')) return;
    state = getDefaultState();
    syncControlsFromState();
    renderSampleRows();
    calculate();
  });

  elements.copyBtn.addEventListener('click', copyResults);
  elements.pasteBtn.addEventListener('click', pasteData);
  elements.clearDataBtn.addEventListener('click', function () { if (!window.confirm('确定清空当前模式样本数据？')) return; state.samples = []; state.samplesByMode[state.workflowMode] = []; renderSampleRows(); calculate(); });
  elements.exampleDataBtn.addEventListener('click', function () {
    state.samples = [
      { name: 'Ctrl-1', concentration: '2.15', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '1.00' },
      { name: 'Treat-A', concentration: '1.73', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '0.72' },
      { name: 'Treat-B', concentration: '0.96', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '1.18' },
    ];
    renderSampleRows();
    calculate();
  });
}

loadState();
syncControlsFromState();
renderSampleRows();
bindEvents();
calculate();
calculate();
