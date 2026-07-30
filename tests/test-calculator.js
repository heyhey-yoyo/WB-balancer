'use strict';

// ============================================================
// WB-balancer 计算模块测试
// 直接从 calculator.js 导入生产代码，禁止复制算法。
// 运行: node tests/test-calculator.js
// ============================================================

var calc = require('../calculator.js');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}

function assertEqual(actual, expected, msg, tolerance) {
  tolerance = tolerance || 1e-9;
  if (Math.abs(actual - expected) < tolerance) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + ' (expected ' + expected + ', got ' + actual + ')'); }
}

function assertNull(value, msg) {
  if (value === null) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + ' (expected null, got ' + value + ')'); }
}

function assertNotNull(value, msg) {
  if (value !== null && value !== undefined) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + ' (expected non-null)'); }
}

// ============================================================
// toFiniteNumber
// ============================================================
console.log('\n--- toFiniteNumber ---');
assertNull(calc.toFiniteNumber(''), 'empty string → null');
assertNull(calc.toFiniteNumber(null), 'null → null');
assertNull(calc.toFiniteNumber(undefined), 'undefined → null');
assertEqual(calc.toFiniteNumber('0'), 0, '"0" → 0');
assertEqual(calc.toFiniteNumber('-5'), -5, '"-5" → -5');
assertNull(calc.toFiniteNumber('abc'), '"abc" → null');
assertEqual(calc.toFiniteNumber('2.5'), 2.5, '"2.5" → 2.5');
assertNull(calc.toFiniteNumber('Infinity'), '"Infinity" → null');
assertNull(calc.toFiniteNumber(NaN), 'NaN → null');

// ============================================================
// suggestPreDilution
// ============================================================
console.log('\n--- suggestPreDilution ---');
assertNull(calc.suggestPreDilution(0, 0.5), '0 volume → null');
assertNull(calc.suggestPreDilution(null, 0.5), 'null → null');
assertNull(calc.suggestPreDilution(1.0, 0.5), '1.0 >= 0.5 → null (no dilution needed)');
assertNull(calc.suggestPreDilution(0.5, 0.5), '0.5 == minVol → null (no dilution needed)');

var d = calc.suggestPreDilution(0.37, 0.5);
assertNotNull(d, '0.37 < 0.5 → dilution suggested');
assertEqual(d.factor, 2, '0.37 → factor 2 (ceil(0.5/0.37)=2)');
assertEqual(d.adjustedVolume, 0.74, '0.37 × 2 = 0.74');

d = calc.suggestPreDilution(0.15, 0.5);
assertEqual(d.factor, 4, '0.15 → factor 4 (ceil(0.5/0.15)=4)');
assertEqual(d.adjustedVolume, 0.6, '0.15 × 4 = 0.6');

d = calc.suggestPreDilution(0.1, 0.5);
assertEqual(d.factor, 5, '0.1 → factor 5');

d = calc.suggestPreDilution(0.01, 0.5);
assertEqual(d.factor, 50, '0.01 → factor 50');

// ============================================================
// validateLossMargin
// ============================================================
console.log('\n--- validateLossMargin ---');
assert(calc.validateLossMargin(0).valid, '0% → valid');
assert(calc.validateLossMargin(25).valid, '25% → valid');
assert(calc.validateLossMargin(50).valid, '50% → valid');

assert(!calc.validateLossMargin(-1).valid, '-1% → invalid');
assert(!calc.validateLossMargin(51).valid, '51% → invalid');
assert(!calc.validateLossMargin('abc').valid, '"abc" → invalid');
assert(!calc.validateLossMargin('').valid, 'empty → invalid');
assert(!calc.validateLossMargin(null).valid, 'null → invalid');

assertEqual(calc.validateLossMargin(-1).value, -1, 'invalid returns parsed value');
assertEqual(calc.validateLossMargin('').value, null, 'invalid empty returns null');

// ============================================================
// isSampleComplete
// ============================================================
console.log('\n--- isSampleComplete ---');

assert(calc.isSampleComplete({ name: 'A', concentration: '2.0' }, 'equalize', false), 'equalize: name+conc → complete');
assert(!calc.isSampleComplete({ name: '', concentration: '2.0' }, 'equalize', false), 'equalize: empty name → incomplete');
assert(!calc.isSampleComplete({ name: 'A', concentration: '' }, 'equalize', false), 'equalize: empty conc → incomplete');
assert(!calc.isSampleComplete({ name: 'A', concentration: '0' }, 'equalize', false), 'equalize: zero conc → incomplete');
assert(!calc.isSampleComplete({ name: 'A', concentration: '-1' }, 'equalize', false), 'equalize: negative conc → incomplete');

assert(calc.isSampleComplete({ name: 'A', concentration: '2.0', individualVolume: '100' }, 'equalize', true), 'equalize+indVol: name+conc+vol → complete');
assert(!calc.isSampleComplete({ name: 'A', concentration: '2.0', individualVolume: '' }, 'equalize', true), 'equalize+indVol: empty vol → incomplete');

assert(calc.isSampleComplete({ name: 'B', concentration: '1.5' }, 'perWell', false), 'perWell: name+conc → complete');
assert(!calc.isSampleComplete({ name: 'B', concentration: 'abc' }, 'perWell', false), 'perWell: invalid conc → incomplete');

assert(calc.isSampleComplete({ name: 'C', imageIntensity: '1.0' }, 'rebalance', false), 'rebalance: name+intensity → complete');
assert(!calc.isSampleComplete({ name: 'C', imageIntensity: '' }, 'rebalance', false), 'rebalance: empty intensity → incomplete');
assert(!calc.isSampleComplete({ name: 'C', imageIntensity: '0' }, 'rebalance', false), 'rebalance: zero intensity → incomplete');

assert(calc.isSampleComplete({ name: 'D', concentration: '3.0' }, 'prep', false), 'prep: name+conc → complete');
assert(!calc.isSampleComplete({ name: '', concentration: 'x' }, 'prep', false), 'prep: missing both → incomplete');

// ============================================================
// calculateEqualize
// ============================================================
console.log('\n--- calculateEqualize ---');

var r = calc.calculateEqualize([
  { name: 'A', concentration: '1' },
  { name: 'B', concentration: '1' }
], 100, false);
assertEqual(r.reference, 1, 'equal: reference = 1');
assertEqual(r.results[0].loadingVolume, 0, 'equal: A loading = 0');
assertEqual(r.results[1].loadingVolume, 0, 'equal: B loading = 0');
assertEqual(r.results[0].targetConcentration, 1, 'equal: targetConcentration = 1');
assert(r.summary.completeCount === 2, 'equal: 2 complete');

r = calc.calculateEqualize([{ name: 'S', concentration: '3' }], 100, false);
assertEqual(r.results.length, 1, 'single sample');
assertEqual(r.results[0].loadingVolume, 0, 'single sample: loading = 0');

r = calc.calculateEqualize([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' },
  { name: 'C', concentration: '3' }
], 100, false);
assertEqual(r.reference, 1, 'target = lowest = 1');
assertEqual(r.results[1].loadingVolume, 0, 'lowest (B): loading = 0');
assertEqual(r.results[0].loadingVolume, 100, 'A (2→1): loading = 100');
assertEqual(r.results[2].loadingVolume, 200, 'C (3→1): loading = 200');

// 守恒：finalVolume = currentVolume + loading
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.finalVolume - (res.currentVolume + res.loadingVolume)) < 1e-9,
      'equalize conservation: ' + res.name);
  }
});

r = calc.calculateEqualize([
  { name: 'A', concentration: '0.1' },
  { name: 'B', concentration: '10' }
], 50, false);
assertEqual(r.reference, 0.1, 'target = 0.1');
assert(r.results[1].loadingVolume > 1000, 'high conc → large loading');

r = calc.calculateEqualize([
  { name: 'A', concentration: '2', individualVolume: '100' },
  { name: 'B', concentration: '1', individualVolume: '50' }
], 100, true);
assertEqual(r.results[0].currentVolume, 100, 'individual volume A = 100');
assertEqual(r.results[1].currentVolume, 50, 'individual volume B = 50');
assertEqual(r.results[1].loadingVolume, 0, 'B (lowest conc) loading = 0');

// 无效浓度不参与目标浓度计算
r = calc.calculateEqualize([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '' },
  { name: 'C', concentration: '3' }
], 100, false);
assertEqual(r.reference, 2, 'only valid samples for target: min(2,3) = 2');
assertEqual(r.summary.completeCount, 2, 'complete count = 2');
assert(r.results[1].severity === 'error', 'incomplete sample → error');

r = calc.calculateEqualize([{ name: 'A', concentration: '' }], 100, false);
assertNull(r.reference, 'all empty → null reference');
assert(r.results[0].severity === 'error', 'all empty → error');

// ============================================================
// calculatePerWell
// ============================================================
console.log('\n--- calculatePerWell ---');

r = calc.calculatePerWell([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'A: sampleVol = 20/2 = 10');
assertEqual(r.results[0].loadingVolume, 10, 'A loading = 20-10 = 10');
assertEqual(r.results[1].sampleVolume, 20, 'B: sampleVol = 20/1 = 20');
assertEqual(r.results[1].loadingVolume, 0, 'B loading = 0');

// 守恒：sampleVolume + loadingVolume == totalWithMargin
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - res.finalVolume) < 1e-9,
      'perWell conservation: ' + res.name);
  }
});

// 损耗余量：10% → totalWithMargin = 22
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
assertEqual(r.results[0].finalVolume, 22, 'totalWithMargin = 22');
assertEqual(r.results[0].sampleVolume, 10, 'sampleVol = 10 (unchanged)');
assertEqual(r.results[0].loadingVolume, 12, 'loading = 22 - 10 = 12');
assert(Math.abs(r.results[0].sampleVolume + r.results[0].loadingVolume - 22) < 1e-9, 'conservation with margin');

// 损耗余量 20%
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 20 });
assertEqual(r.summary.totalWithMargin, 24, 'total with 20% margin = 24');
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - 24) < 1e-9, '20% margin conservation');
  }
});

// 预稀释
r = calc.calculatePerWell([
  { name: 'A', concentration: '50' }  // sampleVol = 20/50 = 0.4 < 0.5
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertNotNull(r.results[0].dilution, '0.4µL < 0.5 → pre-dilution needed');
assertEqual(r.results[0].dilution.factor, 2, 'factor = ceil(0.5/0.4) = 2');
assertEqual(r.results[0].dilution.adjustedVolume, 0.8, 'adjusted = 0.4 × 2 = 0.8');
// 样品体积 = 预稀释调整后的值（不取整）
assertEqual(r.results[0].sampleVolume, 0.8, 'sampleVol = 0.8');

// 预稀释后 loading 基于 sampleVolume
r = calc.calculatePerWell([
  { name: 'A', concentration: '60' }  // sampleVol=0.333, factor=2, adjusted=0.667
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 0.667, 'sampleVol = 0.667 (unrounded)');
assertEqual(r.results[0].loadingVolume, 19.333, 'loading = 20 - 0.667 = 19.333');
assert(Math.abs(r.results[0].sampleVolume + r.results[0].loadingVolume - 20) < 1e-9, 'pre-dilution conservation');

// 损耗余量无效
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 60 });
assert(r.results[0].severity === 'error', 'lossMargin 60% → error');

r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: -5 });
assert(r.results[0].severity === 'error', 'lossMargin -5% → error');

// 边界：0% 和 50% 都 ok
r = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'ok', 'lossMargin 0% → ok');
r = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, lossMargin: 50 });
assert(r.results[0].severity === 'ok', 'lossMargin 50% → ok');

// 无效输入
r = calc.calculatePerWell([{ name: 'A', concentration: '-1' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'negative conc → error');
r = calc.calculatePerWell([{ name: 'A', concentration: '0' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'zero conc → error');
r = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 0, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'zero targetMass → error');
r = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 0, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'zero finalVolume → error');

// 可用体积不足 → warning
r = calc.calculatePerWell([
  { name: 'A', concentration: '0.5', availableVolume: '10' }
], { targetMass: 20, finalVolume: 50, lossMargin: 0 });
assert(r.results[0].severity === 'warning', 'available volume insufficient → warning');

// 样本体积超过总体积 → error
r = calc.calculatePerWell([
  { name: 'A', concentration: '0.5' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'sample exceeds total → error');

// 仅完整样本参与统计
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' },
  { name: '', concentration: '3' },
  { name: 'C', concentration: '' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.summary.completeCount, 1, 'only 1 complete sample');
assertEqual(r.summary.totalCount, 3, '3 total samples');

// ============================================================
// calculateRebalance
// ============================================================
console.log('\n--- calculateRebalance ---');

r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '1.0' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].adjustmentFactor, 1, 'all equal: adj = 1');
assertEqual(r.results[0].loadingVolume, 0, 'all equal: loading = 0');
assertEqual(r.results[1].loadingVolume, 0, 'all equal: loading = 0');
assertEqual(r.reference, 1, 'reference = 1');

// 守恒
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - res.finalVolume) < 1e-9,
      'rebalance conservation: ' + res.name);
  }
});

// 最低 ImageJ 占满体积
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.72' },
  { name: 'C', imageIntensity: '1.18' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.reference, 0.72, 'reference = min = 0.72');
assertEqual(r.results[1].sampleVolume, 20, 'B (lowest): sampleVol = 20');

// 损耗余量
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.5' }
], { finalVolume: 20, lossMargin: 10 });
assertEqual(r.summary.totalWithMargin, 22, 'total with 10% margin = 22');
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - 22) < 1e-9, 'rebalance margin conservation');
  }
});

// 上轮取样体积
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '15' },
  { name: 'B', imageIntensity: '0.8', prevVolume: '18' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 12, 'A: 15 × 0.8 = 12');
assertEqual(r.results[1].sampleVolume, 18, 'B: 18 × 1.0 = 18');

// 上轮取样体积 + 损耗余量
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' }
], { finalVolume: 20, lossMargin: 10 });
assertEqual(r.results[0].sampleVolume, 11, 'prevVol 10 + 10% margin = 11');

// 仅完整样本参与参考值
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '' },
  { name: 'C', imageIntensity: '0.5' },
  { name: 'D', imageIntensity: '0' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.reference, 0.5, 'reference = min of valid(1.0, 0.5) = 0.5');
assertEqual(r.summary.completeCount, 2, '2 complete (A, C)');
assert(r.results[1].severity === 'error', 'B: missing intensity → error');

// 预稀释
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.01' }
], { finalVolume: 20, lossMargin: 0 });
assertNotNull(r.results[0].dilution, 'very small volume → pre-dilution needed');

// 无有效 ImageJ
r = calc.calculateRebalance([{ name: 'A', imageIntensity: '' }], { finalVolume: 20, lossMargin: 0 });
assertNull(r.reference, 'no valid intensity → null reference');
assert(r.results[0].severity === 'error', 'no reference → error');

// ============================================================
// calculatePrep
// ============================================================
console.log('\n--- calculatePrep ---');

r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'sample = 20/2 = 10');
assertEqual(r.results[0].loadingBufferVol, 4, 'LB = 20/5 = 4');
assertEqual(r.results[0].makeupVol, 6, 'makeup = 20 - 10 - 4 = 6');

// 守恒：sampleVolume + loadingBufferVol + makeupVol = totalWithMargin
r = calc.calculatePrep([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    var sum = res.sampleVolume + res.loadingBufferVol + res.makeupVol;
    assert(Math.abs(sum - res.finalVolume) < 1e-9,
      'prep conservation: ' + res.name + ' (' + sum + ' = ' + res.finalVolume + ')');
  }
});

// 损耗余量
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 10 });
assertEqual(r.summary.totalWithMargin, 22, 'total with 10% margin = 22');
assertEqual(r.results[0].loadingBufferVol, 4.4, 'LB = 22/5 = 4.4');
assertEqual(r.results[0].sampleVolume, 10, 'sampleVol = 10');
assertEqual(r.results[0].makeupVol, 7.6, 'makeup = 22 - 10 - 4.4 = 7.6');
var sum = r.results[0].sampleVolume + r.results[0].loadingBufferVol + r.results[0].makeupVol;
assert(Math.abs(sum - 22) < 1e-9, 'prep margin conservation');

// 预稀释
r = calc.calculatePrep([
  { name: 'A', concentration: '50' }  // sampleVol = 0.4
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertNotNull(r.results[0].dilution, 'prep: pre-dilution needed');
assertEqual(r.results[0].dilution.factor, 2, 'factor = 2');
assertEqual(r.results[0].dilution.adjustedVolume, 0.8, 'adjusted = 0.8');
assertEqual(r.results[0].sampleVolume, 0.8, 'sampleVol = 0.8 (adjusted, unrounded)');
assertEqual(r.results[0].makeupVol, 15.2, 'makeup = 20 - 0.8 - 4 = 15.2');
sum = r.results[0].sampleVolume + r.results[0].loadingBufferVol + r.results[0].makeupVol;
assert(Math.abs(sum - 20) < 1e-9, 'prep dilution conservation');

// 不同 buffer 倍数
r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 2, lossMargin: 0 });
assertEqual(r.results[0].loadingBufferVol, 10, '2× → LB = 10');
assertEqual(r.results[0].makeupVol, 0, 'makeup = 0');

r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 4, lossMargin: 0 });
assertEqual(r.results[0].loadingBufferVol, 5, '4× → LB = 5');

r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 6, lossMargin: 0 });
assertEqual(r.results[0].loadingBufferVol, 20 / 6, '6× → LB = 20/6');

// 损耗余量无效
r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 60 });
assert(r.results[0].severity === 'error', 'prep lossMargin 60% → error');

// 负补液
r = calc.calculatePrep([{ name: 'A', concentration: '0.1' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'negative makeup → error');

// 无效输入
r = calc.calculatePrep([{ name: 'A', concentration: '' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'prep empty conc → error');
r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 0, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'prep zero targetMass → error');
r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 0, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'prep zero bufferFactor → error');

// 可用体积不足 → warning
r = calc.calculatePrep([
  { name: 'A', concentration: '2', availableVolume: '5' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(r.results[0].severity === 'warning', 'prep: available volume insufficient → warning');

// 仅完整样本统计
r = calc.calculatePrep([
  { name: 'A', concentration: '2' },
  { name: '', concentration: '3' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.summary.completeCount, 1, 'prep: only 1 complete');

// ============================================================
// 跨模式过滤
// ============================================================
console.log('\n--- Cross-mode Sample Filtering ---');

r = calc.calculateEqualize([
  { name: 'OK', concentration: '5' },
  { name: 'BAD', concentration: '' }
], 100, false);
assertEqual(r.reference, 5, 'equalize: only valid sample for reference');

r = calc.calculateRebalance([
  { name: 'OK', imageIntensity: '2.0' },
  { name: 'BAD', imageIntensity: '' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.reference, 2.0, 'rebalance: only valid sample for reference');

// ============================================================
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
