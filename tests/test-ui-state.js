'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

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

console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
