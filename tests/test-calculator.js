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
assertNull(calc.toFiniteNumber(''), 'empty → null');
assertNull(calc.toFiniteNumber(null), 'null → null');
assertNull(calc.toFiniteNumber(undefined), 'undefined → null');
assertEqual(calc.toFiniteNumber('0'), 0, '"0" → 0');
assertEqual(calc.toFiniteNumber('-5'), -5, '"-5" → -5');
assertNull(calc.toFiniteNumber('abc'), '"abc" → null');
assertEqual(calc.toFiniteNumber('2.5'), 2.5, '"2.5" → 2.5');

// ============================================================
// lossScaleFactor: 1 / (1 - loss%)
// ============================================================
console.log('\n--- lossScaleFactor ---');
assertEqual(calc.lossScaleFactor(0), 1, '0% → 1');
assertEqual(calc.lossScaleFactor(10), 1 / 0.9, '10% → 1/0.9');
assertEqual(calc.lossScaleFactor(20), 1.25, '20% → 1.25');
assertEqual(calc.lossScaleFactor(50), 2, '50% → 2');

// lossScaleFactor values are exact inverses
// 10% loss → scaleFactor = 1/0.9 → 22.22 µg → after 10% loss: 22.22 × 0.9 = 20.0 ✓
// 20% loss → scaleFactor = 1/0.8 = 1.25 → 25 µg → after 20% loss: 25 × 0.8 = 20.0 ✓

// ============================================================
// suggestPreDilution
// ============================================================
console.log('\n--- suggestPreDilution ---');
assertNull(calc.suggestPreDilution(0, 0.5), '0 → null');
assertNull(calc.suggestPreDilution(1.0, 0.5), '1.0 >= 0.5 → null');

var d = calc.suggestPreDilution(0.37, 0.5);
assertEqual(d.factor, 2, '0.37 → factor 2');
assertEqual(d.adjustedVolume, 0.74, '0.37 × 2 = 0.74');

// ============================================================
// validateLossMargin
// ============================================================
console.log('\n--- validateLossMargin ---');
assert(calc.validateLossMargin(0).valid, '0% valid');
assert(calc.validateLossMargin(10).valid, '10% valid');
assert(calc.validateLossMargin(50).valid, '50% valid');
assert(!calc.validateLossMargin(-1).valid, '-1% invalid');
assert(!calc.validateLossMargin(51).valid, '51% invalid');

// ============================================================
// calculateEqualize
// ============================================================
console.log('\n--- calculateEqualize ---');

var r = calc.calculateEqualize([
  { name: 'A', concentration: '1' },
  { name: 'B', concentration: '1' }
], 100, false);
assertEqual(r.reference, 1, 'reference = 1');
assertEqual(r.results[0].loadingVolume, 0, 'loading = 0');

// 空名称不影响参考值
r = calc.calculateEqualize([
  { name: '', concentration: '2' },
  { name: 'B', concentration: '3' }
], 100, false);
assertEqual(r.reference, 2, 'empty name still participates in min conc');
assert(r.results[0].severity === 'warning', 'empty name → warning');

// 正常配平
r = calc.calculateEqualize([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' },
  { name: 'C', concentration: '3' }
], 100, false);
assertEqual(r.reference, 1, 'target = 1');
assertEqual(r.results[1].loadingVolume, 0, 'lowest loading = 0');
assertEqual(r.results[0].loadingVolume, 100, 'A loading = 100');

// 守恒
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.finalVolume - (res.currentVolume + res.loadingVolume)) < 1e-9,
      'equalize conservation: ' + res.name);
  }
});

// ============================================================
// calculatePerWell
// ============================================================
console.log('\n--- calculatePerWell ---');

// 基本计算（无损耗）
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'sampleVol = 10');
assertEqual(r.results[0].loadingVolume, 10, 'loading = 10');

// 守恒
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - res.finalVolume) < 1e-9,
      'perWell conservation: ' + res.name);
  }
});

// 10% 预计损耗：scaleFactor = 1/0.9 ≈ 1.1111
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
assertEqual(r.summary.scaleFactor, 1 / 0.9, 'scaleFactor = 1/0.9');
assertEqual(r.summary.totalWithMargin, 20 / 0.9, 'total = 20/0.9');
assertEqual(r.results[0].sampleVolume, 10 / 0.9, 'sample = 10/0.9');
assertEqual(r.results[0].loadingVolume, 10 / 0.9, 'loading = 10/0.9');
// 验证严格补偿：配制量 × (1 − 损耗率) = 目标量
var loadedProtein = r.results[0].sampleVolume * 2; // sampleVol × conc
var afterLoss = loadedProtein * (1 - 10 / 100);
assert(Math.abs(afterLoss - 20) < 1e-9, '10% loss: ' + loadedProtein + ' × 0.9 = ' + afterLoss + ' ≈ 20');

// 20% 损耗：scaleFactor = 1/0.8 = 1.25
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 20 });
assertEqual(r.summary.scaleFactor, 1.25, 'scaleFactor = 1.25');
assertEqual(r.results[0].sampleVolume, 12.5, 'sample = 10 × 1.25 = 12.5');
assertEqual(r.results[0].loadingVolume, 12.5, 'loading = 25 - 12.5 = 12.5');
// 验证补偿
loadedProtein = r.results[0].sampleVolume * 2;
afterLoss = loadedProtein * (1 - 20 / 100);
assert(Math.abs(afterLoss - 20) < 1e-9, '20% loss: ' + loadedProtein + ' × 0.8 = ' + afterLoss + ' ≈ 20');

// 空名称 → warning，不影响计算
r = calc.calculatePerWell([
  { name: '', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'empty name: sampleVol still calculated');
assert(r.results[0].severity === 'warning', 'empty name → warning');

// 预稀释 + 损耗
r = calc.calculatePerWell([
  { name: 'A', concentration: '50' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
// theoreticalVol = 0.4, sampleVolBase = 0.4 × 1/0.9 ≈ 0.444 < 0.5 → dilution
assertNotNull(r.results[0].dilution, 'dilution needed');

// 可用体积用原液消耗量检查
r = calc.calculatePerWell([
  { name: 'A', concentration: '50', availableVolume: '0.3' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
// originalConsumed = 0.4, available = 0.3 → warning
assert(r.results[0].severity === 'warning', 'original 0.4 > available 0.3 → warning');

// 无效输入
r = calc.calculatePerWell([{ name: 'A', concentration: '-1' }], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'negative conc → error');
r = calc.calculatePerWell([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, lossMargin: 60 });
assert(r.results[0].severity === 'error', 'lossMargin 60% → error');

// ============================================================
// calculateRebalance
// ============================================================
console.log('\n--- calculateRebalance ---');

// 基本：ImageJ 相等
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '1.0' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 20, 'all equal: sampleVol = 20');
assertEqual(r.results[0].loadingVolume, 0, 'loading = 0');

r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - res.finalVolume) < 1e-9,
      'rebalance conservation: ' + res.name);
  }
});

// 最低 ImageJ 占满体积
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.72' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[1].sampleVolume, 20, 'B (lowest): full volume');
assertEqual(r.results[0].sampleVolume, 14.4, 'A: 20 × 0.72/1.0 = 14.4');

// 10% 损耗
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.5' }
], { finalVolume: 20, lossMargin: 10 });
assertEqual(r.summary.scaleFactor, 1 / 0.9, 'scaleFactor = 1/0.9');
assertEqual(r.summary.totalWithMargin, 20 / 0.9, 'total = 20/0.9');

// 上轮体积归一化
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8', prevVolume: '20' }
], { finalVolume: 20, lossMargin: 0 });
// A: relConc = 0.1, B: relConc = 0.04 → reference = 0.04
// A: sampleVol = 20 × 0.04/0.1 = 8
// B: sampleVol = 20 × 0.04/0.04 = 20
assert(r.summary.useNormalized, 'using normalized mode');
assertEqual(r.results[0].sampleVolume, 8, 'A: 20 × 0.04/0.1 = 8');
assertEqual(r.results[1].sampleVolume, 20, 'B: lowest rel conc → full volume');

// 部分填写 → 报错
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8' }
], { finalVolume: 20, lossMargin: 0 });
assertNotNull(r.summary.partialPrevError, 'partial prevVol → error');

// 全部不填 → 直接用 ImageJ
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.5' }
], { finalVolume: 20, lossMargin: 0 });
assert(!r.summary.useNormalized, 'not using normalized mode');

// 空名称不影响参考值
r = calc.calculateRebalance([
  { name: '', imageIntensity: '0.5' },
  { name: 'B', imageIntensity: '1.0' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.reference, 0.5, 'empty name: reference still uses 0.5');

// ============================================================
// calculatePrep
// ============================================================
console.log('\n--- calculatePrep ---');

r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'sample = 10');
assertEqual(r.results[0].loadingBufferVol, 4, 'LB = 4');
assertEqual(r.results[0].makeupVol, 6, 'makeup = 6');

// 守恒
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    var sum = res.sampleVolume + res.loadingBufferVol + res.makeupVol;
    assert(Math.abs(sum - res.finalVolume) < 1e-9, 'prep conservation: ' + sum + ' = ' + res.finalVolume);
  }
});

// 10% 损耗：scaleFactor = 1/0.9
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 10 });
assertEqual(r.summary.scaleFactor, 1 / 0.9, 'scaleFactor = 1/0.9');
assertEqual(r.results[0].sampleVolume, 10 / 0.9, 'sample = 10/0.9');
assertEqual(r.results[0].loadingBufferVol, 4 / 0.9, 'LB = 4/0.9');
assertEqual(r.results[0].makeupVol, 6 / 0.9, 'makeup = 6/0.9');
var sum = r.results[0].sampleVolume + r.results[0].loadingBufferVol + r.results[0].makeupVol;
assert(Math.abs(sum - 20 / 0.9) < 1e-9, 'prep margin conservation');
// 验证严格补偿：配制蛋白量 × (1 − 损耗率) = 目标量
var loadedProtein = r.results[0].sampleVolume * 2;
var afterLoss = loadedProtein * (1 - 10 / 100);
assert(Math.abs(afterLoss - 20) < 1e-9, 'prep 10% loss: ' + loadedProtein + ' × 0.9 = ' + afterLoss + ' ≈ 20');

// 预稀释
r = calc.calculatePrep([
  { name: 'A', concentration: '50' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertNotNull(r.results[0].dilution, 'dilution needed');

// 可用体积用原液消耗量
r = calc.calculatePrep([
  { name: 'A', concentration: '50', availableVolume: '0.6' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].originalConsumed, 0.4, 'original consumed = 0.4');
var hasAvailWarning = r.results[0].messages.some(function (m) { return m.indexOf('可用体积不足') >= 0; });
assert(!hasAvailWarning, '0.4 ≤ 0.6 → ok');

// 空名称不影响计算
r = calc.calculatePrep([
  { name: '', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'empty name: still calculated');

// ============================================================
// 损耗补偿不变量：配制量 × (1 − 损耗率) ≈ 目标量
// ============================================================
console.log('\n--- Loss Compensation Invariant ---');

function verifyCompensation(results, targetMass, lossPercent, concentrationGetter) {
  results.forEach(function (res) {
    if (res.severity === 'ok') {
      var conc = concentrationGetter(res);
      var loadedProtein = res.sampleVolume * conc;
      var remaining = loadedProtein * (1 - lossPercent / 100);
      assert(Math.abs(remaining - targetMass) < 1e-7,
        'compensation: ' + res.name + ' loaded=' + loadedProtein + ' × (1-' + lossPercent + '%) = ' + remaining + ' ≈ ' + targetMass);
    }
  });
}

// perWell 10%
r = calc.calculatePerWell([
  { name: 'A', concentration: '2.15' },
  { name: 'B', concentration: '1.73' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
verifyCompensation(r.results, 20, 10, function (res) { return res.concentration; });

// perWell 30%
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 30 });
verifyCompensation(r.results, 20, 30, function (res) { return res.concentration; });

// prep 10%
r = calc.calculatePrep([
  { name: 'A', concentration: '2.15' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 10 });
verifyCompensation(r.results, 20, 10, function (res) { return res.concentration; });

// prep 25%
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 25 });
verifyCompensation(r.results, 20, 25, function (res) { return res.concentration; });

// 0% 损耗 → 补偿系数为 1
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.summary.scaleFactor, 1, '0% → scaleFactor = 1');
verifyCompensation(r.results, 20, 0, function (res) { return res.concentration; });

// ============================================================
// 名称不影响数值结果
// ============================================================
console.log('\n--- Name Does Not Affect Numeric Results ---');

var rNamed = calc.calculatePerWell([
  { name: 'Ctrl', concentration: '2' },
  { name: 'Treat', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });

var rUnnamed = calc.calculatePerWell([
  { name: '', concentration: '2' },
  { name: '', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });

assertEqual(rNamed.results[0].sampleVolume, rUnnamed.results[0].sampleVolume, 'name does not affect sampleVol');
assertEqual(rNamed.summary.totalWithMargin, rUnnamed.summary.totalWithMargin, 'name does not affect total');

// ImageJ 上轮体积归一化验证
console.log('\n--- ImageJ Normalization ---');

r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '2.0', prevVolume: '20' },
  { name: 'B', imageIntensity: '0.5', prevVolume: '10' }
], { finalVolume: 20, lossMargin: 0 });
assert(r.summary.useNormalized, 'using normalized mode');
assertEqual(r.results[1].sampleVolume, 20, 'B: lowest rel conc → full volume');
assertEqual(r.results[0].sampleVolume, 10, 'A: 20 × 0.05/0.1 = 10');

// 部分填写 → 报错
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8' }
], { finalVolume: 20, lossMargin: 0 });
assertNotNull(r.summary.partialPrevError, 'partial prevVol → error');

// ============================================================
// lossScaleFactor 字符串输入一致性 + 边界值校验
// ============================================================
console.log('\n--- lossScaleFactor String Input + Boundaries ---');
assertEqual(calc.lossScaleFactor(0), 1, '0% → 1');
assertEqual(calc.lossScaleFactor('10'), calc.lossScaleFactor(10), '"10" === 10');
assertEqual(calc.lossScaleFactor(10), 1 / 0.9, '10% → 1/0.9');
assertEqual(calc.lossScaleFactor(50), 2, '50% → 2');

// 超出范围 → null
assertNull(calc.lossScaleFactor(-1), '-1% → null');
assertNull(calc.lossScaleFactor(51), '51% → null');
assertNull(calc.lossScaleFactor(100), '100% → null');
assertNull(calc.lossScaleFactor('abc'), '"abc" → null');
assertNull(calc.lossScaleFactor(''), 'empty → null');
assertNull(calc.lossScaleFactor(null), 'null → null');

// ============================================================
// 无效损耗率 → scaleFactor=null，体积返回 null
// ============================================================
console.log('\n--- Invalid Loss Margin → null Volumes ---');

// perWell: 51% → invalid
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 51 });
assertNull(r.summary.scaleFactor, '51% → scaleFactor null');
assertNull(r.summary.totalWithMargin, '51% → totalWithMargin null');
assertNull(r.results[0].sampleVolume, '51% → sampleVolume null');
assertNull(r.results[0].loadingVolume, '51% → loadingVolume null');
assert(r.results[0].severity === 'error', '51% → error');

// perWell: negative → invalid
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: -5 });
assertNull(r.summary.scaleFactor, '-5% → scaleFactor null');
assertNull(r.results[0].sampleVolume, '-5% → sampleVolume null');

// rebalance: invalid → null
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' }
], { finalVolume: 20, lossMargin: 51 });
assertNull(r.summary.scaleFactor, 'rebalance 51% → scaleFactor null');
assertNull(r.results[0].sampleVolume, 'rebalance 51% → sampleVolume null');

// prep: invalid → null
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 51 });
assertNull(r.summary.scaleFactor, 'prep 51% → scaleFactor null');
assertNull(r.results[0].sampleVolume, 'prep 51% → sampleVolume null');
assertNull(r.results[0].loadingBufferVol, 'prep 51% → loadingBufferVol null');
assertNull(r.results[0].makeupVol, 'prep 51% → makeupVol null');

// 0% 仍然是有效的
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assert(r.summary.scaleFactor === 1, '0% → scaleFactor = 1');
assertNotNull(r.results[0].sampleVolume, '0% → sampleVolume not null');

// ============================================================
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
