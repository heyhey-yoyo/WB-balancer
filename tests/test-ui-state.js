'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var calc = require('../calculator.js');

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (condition) passed++;
  else { failed++; console.error('FAIL: ' + message); }
}

function loadStateContext(storage) {
  var appPath = path.join(__dirname, '..', 'app.js');
  var source = fs.readFileSync(appPath, 'utf8');
  source = source.split('// ---------- UI 描述 ----------')[0];
  var context = {
    document: { querySelector: function () { return {}; } },
    localStorage: storage,
    console: { warn: function () {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: appPath });
  return context;
}

console.log('\n--- State Recovery ---');

var context = loadStateContext({ getItem: function () { return '{not-json'; } });
context.loadState();
assert(Array.isArray(context.state.samples), 'corrupt JSON → samples array');
assert(context.state.samples.length === 3, 'corrupt JSON → default samples');

context = loadStateContext({ getItem: function () { throw new Error('blocked'); } });
context.loadState();
assert(Array.isArray(context.state.samples), 'blocked localStorage → samples array');
assert(context.state.workflowMode === 'equalize', 'blocked localStorage → default mode');

context = loadStateContext({
  getItem: function () {
    return JSON.stringify({ workflowMode: 'equalize', samplesByMode: { equalize: 'bad-data' } });
  }
});
context.loadState();
assert(Array.isArray(context.state.samples), 'malformed mode samples → array fallback');
assert(context.state.samples.length === 3, 'malformed mode samples → default rows');

context = loadStateContext({
  getItem: function () {
    return JSON.stringify({ workflowMode: 'unknown', samplesByMode: {} });
  }
});
context.loadState();
assert(context.state.workflowMode === 'equalize', 'invalid workflow mode → equalize');

context = loadStateContext({
  getItem: function () {
    return JSON.stringify({
      workflowMode: 'perWell',
      samples: [{ name: 'Legacy', concentration: 2 }]
    });
  }
});
context.loadState();
assert(context.state.workflowMode === 'perWell', 'legacy state keeps valid mode');
assert(context.state.samples[0].name === 'Legacy', 'legacy top-level samples migrate');
assert(context.state.samples[0].concentration === '2', 'legacy numeric field normalized safely');

context = loadStateContext({
  getItem: function () {
    return JSON.stringify({ workflowMode: 'equalize', samplesByMode: { equalize: [null] } });
  }
});
context.loadState();
assert(context.state.samples[0] && typeof context.state.samples[0] === 'object', 'invalid sample row → safe object');

console.log('\n--- Accessibility Markup ---');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/<textarea[^>]+id="pasteArea"[^>]+aria-label="粘贴 Excel 数据"/.test(html), 'paste area has stable accessible label');
assert(/<div id="summary" class="summary-grid"><\/div>/.test(html), 'summary is not a live region');
assert(/<div id="alerts" class="alerts" aria-live="polite"><\/div>/.test(html), 'alerts remains the live region');

console.log('\n--- Result Presentation (RESULT_COLUMNS) ---');

var MODES = ['equalize', 'perWell', 'rebalance', 'prep'];
MODES.forEach(function (mode) {
  assert(context.RESULT_COLUMNS[mode].length === context.resultHeaders(mode, false).length, mode + ': table header count matches columns');
  assert(context.resultHeaders(mode, false).length === context.resultHeaders(mode, true).length, mode + ': copy header count matches columns');
});

// equalize 行（含目标浓度列）
var eq = calc.calculateEqualize([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], 100, false);
assert(context.resultTableHtml('equalize', eq.results.slice(0, 1)) ===
  '<tr><td>A</td><td>2 µg/µL</td><td>1 µg/µL</td><td>200.00 µL</td><td class="loading-col">100.00 µL</td><td><span class="status status-ok">可以配平</span></td></tr>',
  'equalize table row');
assert(JSON.stringify(context.resultCopyRows('equalize', eq.results.slice(0, 1))[0]) ===
  JSON.stringify(['A', '2', '1', '200', '100', '可以配平']),
  'equalize copy row');

// perWell 基本行 + 复制表头
var pw = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(context.resultTableHtml('perWell', pw.results) ===
  '<tr><td>A</td><td>2 µg/µL</td><td class="loading-col">10.00 µL</td><td class="loading-col">10.00 µL</td><td>20.00 µL</td><td><span class="status status-ok">可以配平</span></td></tr>',
  'perWell table row');
assert(JSON.stringify(context.resultCopyRows('perWell', pw.results)[0]) ===
  JSON.stringify(['A', '2', '10', '10', '20', '可以配平']),
  'perWell copy row');
assert(context.resultHeaders('perWell', true).join('\t') ===
  '样本\t浓度(µg/µL)\t需取样品体积(µL)\t需取1× Loading(µL)\t统一上样体积(µL)\t状态',
  'perWell copy headers');

// perWell 预稀释提示
var pwD = calc.calculatePerWell([{ name: 'A', concentration: '50' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
var pwDHtml = context.resultTableHtml('perWell', pwD.results);
assert(pwDHtml.indexOf('(1:2预稀释 → 0.80 µL)') >= 0, 'perWell dilution hint text');
assert(pwDHtml.indexOf('status-warning') >= 0, 'perWell dilution → warning status');

// rebalance 行（ImageJ 列）
var rb = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.72' }
], { finalVolume: 20, lossMargin: 0 });
assert(context.resultTableHtml('rebalance', rb.results.slice(1, 2)) ===
  '<tr><td>B</td><td>0.72</td><td class="loading-col">20.00 µL</td><td class="loading-col">0.00 µL</td><td>20.00 µL</td><td><span class="status status-ok">可以配平</span></td></tr>',
  'rebalance table row');
assert(JSON.stringify(context.resultCopyRows('rebalance', rb.results.slice(1, 2))[0]) ===
  JSON.stringify(['B', '0.72', '20', '0', '20', '可以配平']),
  'rebalance copy row');

// 无效 ImageJ：表格显示 '—'，复制文本为空
var rbBad = calc.calculateRebalance([{ name: 'X', imageIntensity: '' }], { finalVolume: 20, lossMargin: 0 });
assert(context.resultTableHtml('rebalance', rbBad.results).indexOf('<td>—</td>') >= 0, 'rebalance invalid imageJ → dash in table');
assert(context.resultCopyRows('rebalance', rbBad.results)[0][1] === '', 'rebalance invalid imageJ → empty in copy');

// prep 行（样品 + Loading Buffer + 补液）
var pr = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(context.resultTableHtml('prep', pr.results) ===
  '<tr><td>A</td><td>2 µg/µL</td><td class="loading-col">10.00 µL</td><td class="loading-col">4.00 µL</td><td class="loading-col">6.00 µL</td><td>20.00 µL</td><td><span class="status status-ok">可以配制</span></td></tr>',
  'prep table row');
assert(JSON.stringify(context.resultCopyRows('prep', pr.results)[0]) ===
  JSON.stringify(['A', '2', '10', '4', '6', '20', '可以配制']),
  'prep copy row');

// 用户输入转义
var xss = { name: '<img src=x onerror=alert(1)>', concentration: '2', sampleVolume: 1, loadingVolume: 1, finalVolume: 2, messages: ['可以配平'], severity: 'ok', index: 0 };
var xssHtml = context.resultTableHtml('perWell', [xss]);
assert(xssHtml.indexOf('<img') === -1 && xssHtml.indexOf('&lt;img') >= 0, 'result table escapes user names');

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
