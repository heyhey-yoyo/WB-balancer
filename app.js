'use strict';

// ============================================================
// WB-balancer UI 控制器
// 纯计算逻辑已抽离至 calculator.js（通过 <script> 标签先行加载）。
// 本文件负责 DOM 操作、状态管理、localStorage 持久化和事件绑定。
// ============================================================

var STORAGE_KEY = 'wb-balancer-v4';

var elements = {
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

var state = getDefaultState();
var latestResults = [];

// ---------- 格式化函数（展示层） ----------

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

function summaryValue(value) {
  return '<span class="summary-value">' + value + '</span>';
}

// ---------- 结果列定义（表格渲染与复制共用，纯函数可测试） ----------

function resultName(r) {
  return escapeHtml(r.name || '样本 ' + (r.index + 1));
}

function statusSpan(r) {
  var sc = r.severity === 'ok' ? 'status-ok' : r.severity === 'warning' ? 'status-warning' : 'status-error';
  return '<span class="status ' + sc + '">' + escapeHtml(r.messages.join('；')) + '</span>';
}

/** 预稀释提示片段；middleText 为 '预稀释 → '（perWell）或 ' → '（rebalance/prep）。 */
function dilutionHintHtml(dilution, middleText) {
  if (!dilution) return '';
  return ' <span class="dilution-hint">(1:' + dilution.factor + middleText + formatVolume(dilution.adjustedVolume) + ')</span>';
}

function resultHeaders(mode, forCopy) {
  return RESULT_COLUMNS[mode].map(function (c) { return forCopy ? c.copy : c.table; });
}

function resultTableHtml(mode, results) {
  return results.map(function (r) {
    return '<tr>' + RESULT_COLUMNS[mode].map(function (c) {
      return '<td' + (c.tdClass ? ' class="' + c.tdClass + '"' : '') + '>' + c.cell(r) + '</td>';
    }).join('') + '</tr>';
  }).join('');
}

function resultCopyRows(mode, results) {
  return results.map(function (r) {
    return RESULT_COLUMNS[mode].map(function (c) { return c.text(r); });
  });
}

// 单元格辅助（每模式通用部分）
function concCell(r) { return formatConcentration(r.concentration); }
function concText(r) { return formatNumber(r.concentration, 3); }
function loadingVolCell(r) { return formatVolume(r.loadingVolume); }
function loadingVolText(r) { return formatNumber(r.loadingVolume, 2); }
function finalVolCell(r) { return formatVolume(r.finalVolume); }
function finalVolText(r) { return formatNumber(r.finalVolume, 2); }
function nameText(r) { return r.name; }
function statusText(r) { return r.messages.join('；'); }
function sampleVolCell(dilutionMiddle) {
  return function (r) { return formatVolume(r.sampleVolume) + dilutionHintHtml(r.dilution, dilutionMiddle); };
}

var RESULT_COLUMNS = {
  equalize: [
    { table: '样本', copy: '样本', cell: resultName, text: nameText },
    { table: '浓度', copy: '浓度(µg/µL)', cell: concCell, text: concText },
    { table: '目标浓度', copy: '目标浓度(µg/µL)', cell: function (r) { return r.targetConcentration ? formatConcentration(r.targetConcentration) : '—'; }, text: function (r) { return formatNumber(r.targetConcentration, 3); } },
    { table: '最终体积', copy: '最终体积(µL)', cell: finalVolCell, text: finalVolText },
    { table: '需加 1× Loading', copy: '需加 1× Loading(µL)', tdClass: 'loading-col', cell: loadingVolCell, text: loadingVolText },
    { table: '状态', copy: '状态', cell: statusSpan, text: statusText }
  ],
  perWell: [
    { table: '样本', copy: '样本', cell: resultName, text: nameText },
    { table: '浓度', copy: '浓度(µg/µL)', cell: concCell, text: concText },
    { table: '需取样品体积', copy: '需取样品体积(µL)', tdClass: 'loading-col', cell: sampleVolCell('预稀释 → '), text: function (r) { return formatNumber(r.sampleVolume, 2); } },
    { table: '需取1× Loading', copy: '需取1× Loading(µL)', tdClass: 'loading-col', cell: loadingVolCell, text: loadingVolText },
    { table: '上样体积', copy: '统一上样体积(µL)', cell: finalVolCell, text: finalVolText },
    { table: '状态', copy: '状态', cell: statusSpan, text: statusText }
  ],
  rebalance: [
    { table: '样本', copy: '样本', cell: resultName, text: nameText },
    { table: 'ImageJ', copy: 'ImageJ', cell: function (r) { return formatIntensity(r.imageIntensity); }, text: function (r) { return r.imageIntensity !== null && r.imageIntensity !== undefined ? formatNumber(r.imageIntensity, 3) : ''; } },
    { table: '需取样品体积', copy: '需取样品体积(µL)', tdClass: 'loading-col', cell: sampleVolCell(' → '), text: function (r) { return formatNumber(r.sampleVolume, 2); } },
    { table: '需取1× Loading', copy: '需取1× Loading(µL)', tdClass: 'loading-col', cell: loadingVolCell, text: loadingVolText },
    { table: '上样体积', copy: '统一上样体积(µL)', cell: finalVolCell, text: finalVolText },
    { table: '状态', copy: '状态', cell: statusSpan, text: statusText }
  ],
  prep: [
    { table: '样本', copy: '样本', cell: resultName, text: nameText },
    { table: '浓度', copy: '浓度(µg/µL)', cell: concCell, text: concText },
    { table: '需取样品体积', copy: '需取样品体积(µL)', tdClass: 'loading-col', cell: sampleVolCell(' → '), text: function (r) { return formatNumber(r.sampleVolume, 2); } },
    { table: '需取Loading Buffer', copy: '需取Loading Buffer(µL)', tdClass: 'loading-col', cell: function (r) { return formatVolume(r.loadingBufferVol); }, text: function (r) { return formatNumber(r.loadingBufferVol, 2); } },
    { table: '需补液', copy: '需补液(µL)', tdClass: 'loading-col', cell: function (r) { return formatVolume(r.makeupVol); }, text: function (r) { return formatNumber(r.makeupVol, 2); } },
    { table: '总体积', copy: '总体积(µL)', cell: finalVolCell, text: finalVolText },
    { table: '状态', copy: '状态', cell: statusSpan, text: statusText }
  ]
};

// ---------- 状态管理 ----------

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
  };
}

/**
 * state.samples 是 state.samplesByMode[mode] 的引用——不再独立持久化。
 * 所有对 state.samples 的修改直接写入 samplesByMode，无需 saveCurrentSamples 同步。
 */
var WORKFLOW_MODES = ['equalize', 'perWell', 'rebalance', 'prep'];

function normalizeSample(sample, index) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    sample = {};
  }
  function field(value) {
    return value === null || value === undefined ? '' : String(value);
  }
  return {
    name: field(sample.name),
    concentration: field(sample.concentration),
    individualVolume: field(sample.individualVolume),
    prevVolume: field(sample.prevVolume),
    availableVolume: field(sample.availableVolume),
    imageIntensity: field(sample.imageIntensity),
  };
}

function normalizeSampleList(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return blankSamples();
  return samples.map(normalizeSample);
}

function loadModeSamples() {
  if (WORKFLOW_MODES.indexOf(state.workflowMode) === -1) {
    state.workflowMode = 'equalize';
  }
  if (!state.samplesByMode || typeof state.samplesByMode !== 'object' || Array.isArray(state.samplesByMode)) {
    state.samplesByMode = getDefaultState().samplesByMode;
  }
  var normalized = normalizeSampleList(state.samplesByMode[state.workflowMode]);
  state.samplesByMode[state.workflowMode] = normalized;
  state.samples = normalized;
}

function loadState() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      var def = getDefaultState();
      var hasValidSamplesByMode = saved.samplesByMode && typeof saved.samplesByMode === 'object' && !Array.isArray(saved.samplesByMode);
      state = Object.assign(def, saved);
      // 向后兼容：旧版本可能只有顶层 samples。
      if (!hasValidSamplesByMode) {
        state.samplesByMode = def.samplesByMode;
        if (Array.isArray(saved.samples)) {
          var legacyMode = WORKFLOW_MODES.indexOf(saved.workflowMode) !== -1 ? saved.workflowMode : 'equalize';
          state.samplesByMode[legacyMode] = saved.samples;
        }
      }
    }
  } catch (error) {
    console.warn('无法读取本地保存的数据：', error);
    state = getDefaultState();
  } finally {
    // 存储损坏或被浏览器阻止时也必须提供可渲染的默认样本。
    loadModeSamples();
  }
}

function saveState() {
  // state.samples 是 samplesByMode[mode] 的引用，序列化副本中移除避免重复存储
  var toSave = Object.assign({}, state);
  delete toSave.samples;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.warn('无法保存本地数据：', error);
  }
}

// ---------- UI 描述 ----------

function getModeDescription() {
  if (state.workflowMode === 'equalize') {
    return '所有样本已变性且体积一致（如 100 µL）。以最低浓度为目标，通过加入 1× Loading 将各样本稀释至同一浓度。';
  }
  if (state.workflowMode === 'perWell') {
    return '按每孔目标蛋白量和各样本浓度计算取样体积，用 1× Loading 补足到统一上样体积。';
  }
  if (state.workflowMode === 'rebalance') {
    return '根据 ImageJ 内参值修正取样体积。如果上一轮各样本取样体积相同，可直接使用 ImageJ 值；如果取样体积不同，请填写所有样本的上轮取样体积，程序将按 ImageJ ÷ 上轮体积计算相对浓度。';
  }
  return '适用于未变性的蛋白样品。输入蛋白浓度后，自动计算样品、Loading Buffer 和补液体积。';
}

function getFormulaNote(summary) {
  var mode = state.workflowMode;
  var lossNote = '';
  if (summary && summary.marginError) {
    lossNote = '预计损耗率无效；';
  } else if (summary && Number.isFinite(summary.scaleFactor) && summary.lossMargin > 0) {
    lossNote = '补偿系数 = 1/(1−' + summary.lossMargin + '%) ≈ ' + summary.scaleFactor.toFixed(3) + '；';
  }

  if (mode === 'equalize') {
    return '<strong>变性后重新配平：</strong>目标浓度 = 所有样本最低浓度；总蛋白量 = 浓度 × 体积；最终体积 = 总蛋白量 ÷ 目标浓度；需加 1× Loading = 最终体积 − 当前体积。最低浓度样本无需加入 Loading。';
  }
  if (mode === 'perWell') {
    return '<strong>上样配平：</strong>' + lossNote + '样品体积 = 每孔目标蛋白量 ÷ 浓度 × 补偿系数；1× Loading = 统一上样体积 × 补偿系数 − 样品体积。配制量 × (1−预计损耗率) = 目标量。体积 < 0.5 µL 时建议预稀释。';
  }
  if (mode === 'rebalance') {
    if (summary && summary.partialPrevError) {
      return '<strong>ImageJ 配平：</strong>上轮取样体积必须全部填写或全部留空，不允许部分填写。';
    }
    if (summary && summary.useNormalized) {
      return '<strong>ImageJ 配平：</strong>' + lossNote + '相对浓度 = ImageJ ÷ 上轮取样体积；样品体积 = 补偿后总体积 × 最低相对浓度 ÷ 当前相对浓度。';
    }
    return '<strong>ImageJ 配平：</strong>' + lossNote + '样品体积 = 补偿后总体积 × 最低 ImageJ ÷ 当前 ImageJ。';
  }
  return '<strong>未变性样品配平：</strong>' + lossNote + '样品体积 = 目标蛋白量 ÷ 浓度 × 补偿系数；Loading Buffer = 补偿后总体积 ÷ Buffer 倍数；补液 = 补偿后总体积 − 样品 − Loading Buffer。配制量 × (1−预计损耗率) = 目标量。';
}

// ---------- 控件同步 ----------

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
  var isPrep = mode === 'prep';

  // prep 和 perWell 都需要显示目标蛋白量（修复 #1）
  elements.targetMassField.classList.toggle('hidden', !isPerWell && !isPrep);
  // prep 和 perWell 和 rebalance 显示最终体积，equalize 显示当前体积
  elements.finalVolumeField.classList.toggle('hidden', isEqualize);
  // prep 模式下将标签改为"最终体积"
  var fvLabel = elements.finalVolumeField.querySelector('span:first-child');
  if (fvLabel) fvLabel.textContent = isPrep ? '最终体积' : '统一上样体积';

  elements.currentVolumeField.classList.toggle('hidden', !isEqualize);
  elements.currentVolume.disabled = state.useIndividualVolume;
  elements.individualVolumeToggle.classList.toggle('hidden', !isEqualize);
  elements.rebalanceNotice.classList.toggle('hidden', !isRebalance);
  elements.imagejTips.classList.toggle('hidden', !isRebalance);
  elements.bufferFactorField.classList.toggle('hidden', !isPrep);
  // 损耗余量：equalize 模式隐藏，其余显示
  elements.lossMarginField.classList.toggle('hidden', isEqualize);
  elements.loadingBufferFactor.value = state.loadingBufferFactor;
  elements.lossMargin.value = state.lossMargin;
  elements.modeDescription.textContent = getModeDescription();
  elements.formulaNote.innerHTML = getFormulaNote();
}

// ---------- 样本行渲染 ----------

function renderSampleRows() {
  elements.samplesBody.innerHTML = '';
  var mode = state.workflowMode;
  var isEqualize = mode === 'equalize';
  var isRebalance = mode === 'rebalance';
  var isPrep = mode === 'prep';
  var showConcentration = mode !== 'rebalance';
  var showImage = mode === 'rebalance';
  var showAvailable = mode !== 'equalize';
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

// ---------- 设置读取 ----------

function readSettings() {
  state.targetMass = toFiniteNumber(elements.targetMass.value) || 0;
  state.finalVolume = toFiniteNumber(elements.finalVolume.value) || 0;
  state.currentVolume = toFiniteNumber(elements.currentVolume.value) || 0;
  state.loadingBufferFactor = toFiniteNumber(elements.loadingBufferFactor.value) || 5;
  state.lossMargin = toFiniteNumber(elements.lossMargin.value) || 0;
}

// ---------- 计算（委托给 calculator.js）----------

function calculate() {
  readSettings();
  var mode = state.workflowMode;
  var result;

  if (mode === 'equalize') {
    result = calculateEqualize(state.samples, state.currentVolume, state.useIndividualVolume);
  } else if (mode === 'perWell') {
    result = calculatePerWell(state.samples, {
      targetMass: state.targetMass,
      finalVolume: state.finalVolume,
      lossMargin: state.lossMargin
    });
  } else if (mode === 'rebalance') {
    result = calculateRebalance(state.samples, {
      finalVolume: state.finalVolume,
      lossMargin: state.lossMargin
    });
  } else {
    result = calculatePrep(state.samples, {
      targetMass: state.targetMass,
      finalVolume: state.finalVolume,
      loadingBufferFactor: state.loadingBufferFactor,
      lossMargin: state.lossMargin
    });
  }

  latestResults = result.results;
  elements.formulaNote.innerHTML = getFormulaNote(result.summary);
  renderResults(result);
  saveState();
}

// ---------- 结果渲染 ----------

function renderResults(result) {
  var summary = result.summary;
  var results = result.results;
  var reference = result.reference;
  var mode = state.workflowMode;
  var validCount = results.filter(function (r) { return r.severity !== 'error'; }).length;
  var warnCount = results.filter(function (r) { return r.severity === 'warning'; }).length;
  var errCount = results.filter(function (r) { return r.severity === 'error'; }).length;

  // 统计卡片
  var items = [];
  function item(label, value) {
    items.push('<div class="summary-item"><span class="summary-label">' + label + '</span>' + summaryValue(value) + '</div>');
  }
  if (mode === 'equalize') {
    item('目标浓度（最低）', reference !== null ? formatConcentration(reference) : '—');
    item(state.useIndividualVolume ? '样本体积' : '样本当前体积', state.useIndividualVolume ? '各样本不同' : formatVolume(state.currentVolume));
    item('配平模式', '变性后重新配平');
  } else if (mode === 'perWell') {
    var marginInfo = state.lossMargin > 0 ? '（预计损耗 ' + state.lossMargin + '%）' : '';
    item('目标蛋白量 / 孔', state.targetMass > 0 ? formatNumber(state.targetMass, 2) + ' µg' : '—');
    item('统一上样体积' + marginInfo, formatVolume(summary.totalWithMargin));
    item('配平模式', '上样配平');
  } else if (mode === 'rebalance') {
    var mInfo = state.lossMargin > 0 ? '（预计损耗 ' + state.lossMargin + '%）' : '';
    var refLabel = summary.useNormalized ? '参考相对浓度（最低 ImageJ/µL）' : '参考 ImageJ（最低值）';
    var refValue = summary.useNormalized ? formatNumber(reference, 4) : formatIntensity(reference);
    item(refLabel, refValue);
    item('统一上样体积' + mInfo, formatVolume(summary.totalWithMargin));
    item('配平模式', 'ImageJ 配平');
  } else {
    var mInfo2 = state.lossMargin > 0 ? '（预计损耗 ' + state.lossMargin + '%）' : '';
    item('目标蛋白量', state.targetMass > 0 ? formatNumber(state.targetMass, 2) + ' µg' : '—');
    item('Buffer 倍数', (state.loadingBufferFactor || 5) + '×');
    item('最终体积' + mInfo2, formatVolume(summary.totalWithMargin));
  }
  item('有效样本', validCount + ' / ' + results.length);
  elements.summary.innerHTML = items.join('');

  // 提示条
  var alerts = [];
  if (mode === 'rebalance' && Number.isFinite(reference)) {
    if (summary.useNormalized) {
      alerts.push('<div class="alert alert-success">根据 ImageJ 值和上轮取样体积计算单位体积相对浓度，以最低相对浓度样品为参考进行配平。</div>');
    } else {
      alerts.push('<div class="alert alert-success">以最低 ImageJ 值 ' + formatIntensity(reference) + ' 为参考，低者占满体积。</div>');
    }
  } else if (mode === 'equalize' && Number.isFinite(reference)) {
    alerts.push('<div class="alert alert-success">目标浓度（最低样本浓度）为 ' + formatConcentration(reference) + '。最低浓度样本无需加入 1× Loading。</div>');
  }
  if (summary.marginError) {
    alerts.push('<div class="alert alert-danger">' + escapeHtml(summary.marginError) + '</div>');
  }
  if (summary.partialPrevError) {
    alerts.push('<div class="alert alert-danger">' + escapeHtml(summary.partialPrevError) + '</div>');
  }
  if (warnCount > 0) alerts.push('<div class="alert alert-warning">有 ' + warnCount + ' 个样本的体积在可操作范围边缘，请检查。</div>');
  if (errCount > 0) alerts.push('<div class="alert alert-danger">有 ' + errCount + ' 个样本无法按当前参数计算，请修正红色状态项。</div>');
  elements.alerts.innerHTML = alerts.join('');

  // 复制按钮状态（必须在空结果 return 之前设置）
  if (results.length === 0) {
    elements.copyBtn.disabled = true;
    elements.copyBtn.textContent = '暂无结果可复制';
    elements.resultsHead.innerHTML = '';
    elements.resultsBody.innerHTML = '<tr><td colspan="10" class="empty-cell">请先添加样本。</td></tr>';
    return;
  }
  elements.copyBtn.disabled = errCount > 0;
  elements.copyBtn.textContent = errCount > 0 ? '存在错误，无法复制' : '复制结果';

  // 表头与表身（列定义见 RESULT_COLUMNS）
  elements.resultsHead.innerHTML = resultHeaders(mode, false).map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('');
  elements.resultsBody.innerHTML = resultTableHtml(mode, results);
}

// ---------- 样本操作 ----------

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
  var lastRow = elements.samplesBody.lastElementChild;
  if (lastRow) {
    var nameInput = lastRow.querySelector('.sample-name');
    if (nameInput) nameInput.focus();
  }
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

// ---------- 粘贴导入（按模式列映射，只填充有效列）----------

function pasteData() {
  // 点击即切换显隐；若由显示变为隐藏则直接退出
  if (elements.pasteArea.classList.toggle('hidden')) return;
  elements.pasteArea.focus();
  elements.pasteArea.oninput = function () {
    var text = elements.pasteArea.value.trim();
    if (!text) return;
    var mode = state.workflowMode;
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });

    var imported = lines.map(function (line) {
      var cols = line.split('\t');
      var s = { name: (cols[0] || '').trim(), concentration: '', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '' };

      if (mode === 'equalize') {
        // 列: name, concentration, availableVolume, individualVolume(可选)
        s.concentration = (cols[1] || '').trim();
        s.availableVolume = (cols[2] || '').trim();
        s.individualVolume = (cols[3] || '').trim();
      } else if (mode === 'perWell') {
        // 列: name, concentration, availableVolume(可选)
        s.concentration = (cols[1] || '').trim();
        s.availableVolume = (cols[2] || '').trim();
      } else if (mode === 'rebalance') {
        // 列: name, imageIntensity, availableVolume(可选), prevVolume(可选)
        s.imageIntensity = (cols[1] || '').trim();
        s.availableVolume = (cols[2] || '').trim();
        s.prevVolume = (cols[3] || '').trim();
      } else {
        // prep: name, concentration, availableVolume(可选)
        s.concentration = (cols[1] || '').trim();
        s.availableVolume = (cols[2] || '').trim();
      }
      return s;
    }).filter(function (s) { return s.name || s.concentration || s.imageIntensity; });

    if (imported.length > 0) {
      state.samples = imported;
      state.samplesByMode[mode] = imported;
      renderSampleRows();
      calculate();
      elements.pasteArea.classList.add('hidden');
    }
  };
}

// ---------- 复制结果 ----------

async function copyResults() {
  var mode = state.workflowMode;
  var headers = resultHeaders(mode, true);
  var rows = resultCopyRows(mode, latestResults);
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

// ---------- 事件绑定 ----------

function bindEvents() {
  [elements.targetMass, elements.finalVolume, elements.currentVolume, elements.loadingBufferFactor, elements.lossMargin].forEach(function (el) {
    el && el.addEventListener('input', calculate);
  });

  elements.useIndividualVolume.addEventListener('change', function () {
    state.useIndividualVolume = elements.useIndividualVolume.checked;
    syncControlsFromState();
    renderSampleRows();
    calculate();
  });

  elements.workflowSelect.addEventListener('change', function () {
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
    loadModeSamples();
    syncControlsFromState();
    renderSampleRows();
    calculate();
  });

  elements.copyBtn.addEventListener('click', copyResults);
  elements.pasteBtn.addEventListener('click', pasteData);
  elements.clearDataBtn.addEventListener('click', function () {
    if (!window.confirm('确定清空当前模式样本数据？')) return;
    state.samples = [];
    state.samplesByMode[state.workflowMode] = [];
    renderSampleRows();
    calculate();
  });
  elements.exampleDataBtn.addEventListener('click', function () {
    state.samples = [
      { name: 'Ctrl-1', concentration: '2.15', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '1.00' },
      { name: 'Treat-A', concentration: '1.73', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '0.72' },
      { name: 'Treat-B', concentration: '0.96', individualVolume: '', prevVolume: '', availableVolume: '', imageIntensity: '1.18' },
    ];
    state.samplesByMode[state.workflowMode] = state.samples;
    renderSampleRows();
    calculate();
  });
}

// ---------- 初始化 ----------

loadState();
syncControlsFromState();
renderSampleRows();
bindEvents();
calculate();
