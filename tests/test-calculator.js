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
// suggestPreDilution
// ============================================================
console.log('\n--- suggestPreDilution ---');
assertNull(calc.suggestPreDilution(0, 0.5), '0 → null');
assertNull(calc.suggestPreDilution(1.0, 0.5), '1.0 >= 0.5 → null');
assertNull(calc.suggestPreDilution(0.5, 0.5), '0.5 == minVol → null');

var d = calc.suggestPreDilution(0.37, 0.5);
assertEqual(d.factor, 2, '0.37 → factor 2');
assertEqual(d.adjustedVolume, 0.74, '0.37 × 2 = 0.74');

d = calc.suggestPreDilution(0.15, 0.5);
assertEqual(d.factor, 4, '0.15 → factor 4');
assertEqual(d.adjustedVolume, 0.6, '0.15 × 4 = 0.6');

// ============================================================
// validateLossMargin
// ============================================================
console.log('\n--- validateLossMargin ---');
assert(calc.validateLossMargin(0).valid, '0% valid');
assert(calc.validateLossMargin(25).valid, '25% valid');
assert(calc.validateLossMargin(50).valid, '50% valid');
assert(!calc.validateLossMargin(-1).valid, '-1% invalid');
assert(!calc.validateLossMargin(51).valid, '51% invalid');

// ============================================================
// isSampleNumericallyValid (只看数字，不看名称)
// ============================================================
console.log('\n--- isSampleNumericallyValid ---');
assert(calc.isSampleNumericallyValid({ name: 'A', concentration: '2.0' }, 'perWell', false), 'perWell: valid conc → valid');
assert(calc.isSampleNumericallyValid({ name: '', concentration: '2.0' }, 'perWell', false), 'perWell: empty name, valid conc → still numerically valid');
assert(!calc.isSampleNumericallyValid({ name: 'A', concentration: '' }, 'perWell', false), 'perWell: empty conc → invalid');
assert(!calc.isSampleNumericallyValid({ name: 'A', concentration: '0' }, 'perWell', false), 'perWell: zero conc → invalid');

assert(calc.isSampleNumericallyValid({ name: '', imageIntensity: '1.0' }, 'rebalance', false), 'rebalance: empty name, valid intensity → numerically valid');
assert(!calc.isSampleNumericallyValid({ name: 'A', imageIntensity: '' }, 'rebalance', false), 'rebalance: empty intensity → invalid');

assert(calc.isSampleNumericallyValid({ name: '', concentration: '3.0' }, 'prep', false), 'prep: empty name, valid conc → numerically valid');

// ============================================================
// isSampleComplete (含名称检查)
// ============================================================
console.log('\n--- isSampleComplete ---');
assert(calc.isSampleComplete({ name: 'A', concentration: '2.0' }, 'perWell', false), 'perWell: name+conc → complete');
assert(!calc.isSampleComplete({ name: '', concentration: '2.0' }, 'perWell', false), 'perWell: empty name → incomplete');
assert(!calc.isSampleComplete({ name: 'A', concentration: '' }, 'perWell', false), 'perWell: empty conc → incomplete');

// ============================================================
// calculateEqualize
// ============================================================
console.log('\n--- calculateEqualize ---');

var r = calc.calculateEqualize([
  { name: 'A', concentration: '1' },
  { name: 'B', concentration: '1' }
], 100, false);
assertEqual(r.reference, 1, 'equal: reference = 1');
assertEqual(r.results[0].loadingVolume, 0, 'equal: loading = 0');

// 修复 #2：空名称不影响最低浓度计算
r = calc.calculateEqualize([
  { name: '', concentration: '2' },
  { name: 'B', concentration: '3' }
], 100, false);
assertEqual(r.reference, 2, 'empty name still participates in min conc → 2');
assert(r.results[0].severity === 'warning', 'empty name → warning (not error)');
assert(r.summary.validCount === 2, 'both numerically valid');

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

// Individual volumes
r = calc.calculateEqualize([
  { name: 'A', concentration: '2', individualVolume: '100' },
  { name: 'B', concentration: '1', individualVolume: '50' }
], 100, true);
assertEqual(r.results[0].currentVolume, 100, 'ind vol A = 100');
assertEqual(r.results[1].currentVolume, 50, 'ind vol B = 50');

// ============================================================
// calculatePerWell
// ============================================================
console.log('\n--- calculatePerWell ---');

// 基本计算（无损耗）
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'A: sampleVol = 10');
assertEqual(r.results[0].loadingVolume, 10, 'A loading = 10');

// 守恒
r.results.forEach(function (res) {
  if (res.severity === 'ok') {
    assert(Math.abs(res.sampleVolume + res.loadingVolume - res.finalVolume) < 1e-9,
      'perWell conservation: ' + res.name);
  }
});

// 修复 #1：损耗余量同比放大样品量
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
assertEqual(r.summary.totalWithMargin, 22, 'total = 22');
assertEqual(r.results[0].sampleVolume, 11, 'sample = 10 × 1.1 = 11 (scaled up)');
assertEqual(r.results[0].loadingVolume, 11, 'loading = 22 - 11 = 11');
assert(Math.abs(r.results[0].sampleVolume + r.results[0].loadingVolume - 22) < 1e-9, 'conservation');

// 损耗余量后：样品 × 浓度 = 目标 × (1 + 损耗)
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
// sampleVol = 11, conc = 2, total protein put in = 22 µg
// After 10% loss, effective = 22 × 0.9 = 19.8... hmm
// Actually the intended logic is: after loss, remaining protein = 22 * 0.9 ≈ 19.8
// Wait, that's not right. 10% loss means 90% remaining.
// 22 µg × 0.9 = 19.8 µg. But target is 20 µg.
// Hmm, the user's expectation might differ from a strict mathematical model.
// Let me recalculate: with 10% loss margin, you want to put in enough so that
// after losing 10%, you still have 20 µg.
// required × (1 - 0.10) = 20 → required = 20 / 0.9 ≈ 22.22 µg
// But a simpler model: required = 20 × 1.1 = 22 µg
// That gives: 22 × 0.9 = 19.8 µg (close enough for typical lab margin)
// Or: lossMargin is applied as a proportional "extra" buffer: targetMass * (1 + marginRatio)
// The user's example: 10 → 11 (that's ×1.1), and total 20 → 22 (also ×1.1)
// So the effective protein after 10% loss: 22 × 0.9 = 19.8 µg (within ~1% of target)
// This is the standard interpretation of "adding X% extra" in lab work
// Let me adjust the test to just verify the proportional scaling
assertEqual(r.results[0].sampleVolume, 11, '10% margin: sample 10 → 11');

// 修复 #2：空名称不影响计算，只有 warning
r = calc.calculatePerWell([
  { name: '', concentration: '2' },
  { name: 'B', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'empty name: sampleVol still calculated');
assert(r.results[0].severity === 'warning', 'empty name → warning');
assertEqual(r.summary.validCount, 2, 'both numerically valid');

// 损耗余量 20%
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 20 });
assertEqual(r.summary.totalWithMargin, 24, 'total = 24');
assertEqual(r.results[0].sampleVolume, 12, 'sample = 10 × 1.2 = 12');
assertEqual(r.results[0].loadingVolume, 12, 'loading = 24 - 12 = 12');

// 预稀释（损耗余量放大后触发）
r = calc.calculatePerWell([
  { name: 'A', concentration: '50' }  // theoretical=0.4, with 10% margin=0.44
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
// sampleVolBase = 0.4 × 1.1 = 0.44 < 0.5 → dilution
assertNotNull(r.results[0].dilution, '0.44 < 0.5 → dilution needed');
assertEqual(r.results[0].dilution.factor, 2, 'factor = ceil(0.5/0.44) = 2');

// 预稀释：可用体积检查用原液消耗量（修复 #4）
r = calc.calculatePerWell([
  { name: 'A', concentration: '50', availableVolume: '0.3' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
// theoreticalVol = 0.4, dilution yields adjustedVolume = 0.8
// originalConsumed = 0.4, available = 0.3 → 0.4 > 0.3 → warning
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
  { name: 'B', imageIntensity: '0.72' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[1].sampleVolume, 20, 'B (lowest): full volume');
assertEqual(r.results[0].sampleVolume, 14.4, 'A: 20 × 0.72/1.0 = 14.4');

// 修复 #3：上轮体积不同 → 按相对浓度归一化
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8', prevVolume: '20' }
], { finalVolume: 20, lossMargin: 0 });
// A: relativeConc = 1.0/10 = 0.1
// B: relativeConc = 0.8/20 = 0.04
// reference = min(0.1, 0.04) = 0.04
// A: sampleVol = 20 × 0.04/0.1 = 8
// B: sampleVol = 20 × 0.04/0.04 = 20
assertEqual(r.results[0].sampleVolume, 8, 'A: 20 × 0.04/0.1 = 8');
assertEqual(r.results[1].sampleVolume, 20, 'B: lowest rel conc → full volume');

// 上轮体积 + 损耗余量
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8', prevVolume: '20' }
], { finalVolume: 20, lossMargin: 10 });
// totalWithMargin = 22
// A: 22 × 0.04/0.1 = 8.8
// B: 22 × 0.04/0.04 = 22
assertEqual(r.summary.totalWithMargin, 22, 'total = 22');
assertEqual(r.results[0].sampleVolume, 8.8, 'A with margin: 8.8');

// 修复 #3：部分填写上轮体积 → 报错
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8', prevVolume: '' }
], { finalVolume: 20, lossMargin: 0 });
assert(r.summary.partialPrevError !== null, 'partial prevVol → error');
assert(r.results[0].severity === 'error', 'partial → error on all samples');

// 全部不填上轮体积 → 直接用 ImageJ
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0' },
  { name: 'B', imageIntensity: '0.5' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.results[1].sampleVolume, 20, 'no prevVol: lowest ImageJ = full');
assertNull(r.summary.partialPrevError, 'no prevVol all → no error');
assert(!r.summary.useNormalized, 'not using normalized mode');

// 修复 #4：可用体积用原液消耗量检查
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', availableVolume: '5' },
  { name: 'B', imageIntensity: '0.1' }
], { finalVolume: 20, lossMargin: 0 });
// A: sampleVol = 20 × 0.1/1.0 = 2, originalConsumed = 2, available = 5 → ok
// B: sampleVol = 20, available not set → ok
assert(r.results[0].severity !== 'warning', '2 <= 5 → no availability warning');

// 修复 #2：空名称不影响 ImageJ 参考值
r = calc.calculateRebalance([
  { name: '', imageIntensity: '0.5' },
  { name: 'B', imageIntensity: '1.0' }
], { finalVolume: 20, lossMargin: 0 });
assertEqual(r.reference, 0.5, 'empty name: reference still uses 0.5');
assert(r.results[0].severity === 'warning', 'empty name → warning');

// ============================================================
// calculatePrep
// ============================================================
console.log('\n--- calculatePrep ---');

// 基本计算
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
    assert(Math.abs(sum - res.finalVolume) < 1e-9,
      'prep conservation: ' + sum + ' = ' + res.finalVolume);
  }
});

// 修复 #1：损耗余量同比放大样品量
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 10 });
assertEqual(r.summary.totalWithMargin, 22, 'total = 22');
assertEqual(r.results[0].sampleVolume, 11, 'sample = 10 × 1.1 = 11');
assertEqual(r.results[0].loadingBufferVol, 4.4, 'LB = 22/5 = 4.4');
assertEqual(r.results[0].makeupVol, 6.6, 'makeup = 22 - 11 - 4.4 = 6.6');
var sum = r.results[0].sampleVolume + r.results[0].loadingBufferVol + r.results[0].makeupVol;
assert(Math.abs(sum - 22) < 1e-9, 'margin conservation');

// 预稀释
r = calc.calculatePrep([
  { name: 'A', concentration: '50' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertNotNull(r.results[0].dilution, '0.4 < 0.5 → dilution needed');
assertEqual(r.results[0].dilution.factor, 2, 'factor = 2');
assertEqual(r.results[0].sampleVolume, 0.8, 'sampleVol = 0.8 (diluted pipetting volume)');

// 修复 #4：可用体积用原液消耗量检查
r = calc.calculatePrep([
  { name: 'A', concentration: '50', availableVolume: '0.3' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
// theoreticalVol = 0.4, originalConsumed = 0.4, available = 0.3 → warning
assert(r.results[0].severity === 'warning', 'original 0.4 > available 0.3 → warning');

// 不同 buffer 倍数
r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 2, lossMargin: 0 });
assertEqual(r.results[0].loadingBufferVol, 10, '2× → LB = 10');

r = calc.calculatePrep([{ name: 'A', concentration: '2' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 6, lossMargin: 0 });
assertEqual(r.results[0].loadingBufferVol, 20 / 6, '6× → LB = 20/6');

// 负补液
r = calc.calculatePrep([{ name: 'A', concentration: '0.1' }], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assert(r.results[0].severity === 'error', 'negative makeup → error');

// 修复 #2：空名称不影响计算
r = calc.calculatePrep([
  { name: '', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].sampleVolume, 10, 'empty name: still calculated');
assert(r.results[0].severity === 'warning', 'empty name → warning');

// ============================================================
// 修复 #1：损耗余量同比放大所有组分
// ============================================================
console.log('\n--- Loss Margin Proportional Scaling ---');

// perWell: sampleVolume ∝ (1 + marginRatio)
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
var baseSample = r.results[0].sampleVolume;
r = calc.calculatePerWell([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, lossMargin: 10 });
assertEqual(r.results[0].sampleVolume, baseSample * 1.1, 'perWell: sample scales ×1.1');

// prep: sampleVolume ∝ (1 + marginRatio)
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
var basePrepSample = r.results[0].sampleVolume;
r = calc.calculatePrep([
  { name: 'A', concentration: '2' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 20 });
assertEqual(r.results[0].sampleVolume, basePrepSample * 1.2, 'prep: sample scales ×1.2');

// ============================================================
// 修复 #2：名称不影响数值结果
// ============================================================
console.log('\n--- Name Does Not Affect Numeric Results ---');

var rNamed = calc.calculatePerWell([
  { name: 'Ctrl', concentration: '2' },
  { name: 'Treat', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });

var rUnnamed = calc.calculatePerWell([
  { name: '', concentration: '2' },
  { name: '', concentration: '1' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });

assertEqual(rNamed.results[0].sampleVolume, rUnnamed.results[0].sampleVolume, 'name does not affect sampleVol (conc=2)');
assertEqual(rNamed.results[1].sampleVolume, rUnnamed.results[1].sampleVolume, 'name does not affect sampleVol (conc=1)');
assertEqual(rNamed.summary.validCount, rUnnamed.summary.validCount, 'name does not affect validCount');

// equalize: name doesn't affect target concentration
rNamed = calc.calculateEqualize([
  { name: 'A', concentration: '2' },
  { name: 'B', concentration: '5' }
], 100, false);
rUnnamed = calc.calculateEqualize([
  { name: '', concentration: '2' },
  { name: '', concentration: '5' }
], 100, false);
assertEqual(rNamed.reference, rUnnamed.reference, 'equalize: name does not affect target conc');

// ============================================================
// 修复 #3：ImageJ 上轮体积归一化
// ============================================================
console.log('\n--- ImageJ Normalized by PrevVolume ---');

// 不同上轮体积 → 归一化为相对浓度
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '2.0', prevVolume: '20' },   // relConc = 0.1
  { name: 'B', imageIntensity: '0.5', prevVolume: '10' }    // relConc = 0.05 → lowest
], { finalVolume: 20, lossMargin: 0 });
assert(r.summary.useNormalized, 'using normalized mode');
assertEqual(r.reference, 0.05, 'reference = min rel conc = 0.05');
assertEqual(r.results[1].sampleVolume, 20, 'B (lowest rel conc): full volume');
// A: 20 × 0.05 / 0.1 = 10
assertEqual(r.results[0].sampleVolume, 10, 'A: 20 × 0.05/0.1 = 10');

// 部分填写 → 报错
r = calc.calculateRebalance([
  { name: 'A', imageIntensity: '1.0', prevVolume: '10' },
  { name: 'B', imageIntensity: '0.8' }  // no prevVolume
], { finalVolume: 20, lossMargin: 0 });
assertNotNull(r.summary.partialPrevError, 'partial prevVol → partialPrevError set');
assert(r.results[0].severity === 'error', 'partial → first sample error');
assert(r.results[1].severity === 'error', 'partial → second sample error');

// ============================================================
// 修复 #4：预稀释后可用体积用原液消耗量检查
// ============================================================
console.log('\n--- Pre-dilution Availability Check ---');

// perWell: 稀释后体积 0.8µL，但原液只消耗 0.4µL
r = calc.calculatePerWell([
  { name: 'A', concentration: '50', availableVolume: '0.6' }
], { targetMass: 20, finalVolume: 20, lossMargin: 0 });
// theoreticalVol = 0.4, dilution factor=2, adjusted=0.8
// originalConsumed = 0.4, available = 0.6 → ok
assertEqual(r.results[0].originalConsumed, 0.4, 'original consumed = 0.4');
assert(r.results[0].dilution !== null, 'dilution triggered');
// 0.4 ≤ 0.6 → no warning for availability
var hasAvailWarning = r.results[0].messages.some(function (m) { return m.indexOf('可用体积不足') >= 0; });
assert(!hasAvailWarning, 'original 0.4 ≤ available 0.6 → ok, no warning');

// prep: 同样逻辑
r = calc.calculatePrep([
  { name: 'A', concentration: '50', availableVolume: '0.6' }
], { targetMass: 20, finalVolume: 20, loadingBufferFactor: 5, lossMargin: 0 });
assertEqual(r.results[0].originalConsumed, 0.4, 'prep: original consumed = 0.4');
var hasAvailWarning2 = r.results[0].messages.some(function (m) { return m.indexOf('可用体积不足') >= 0; });
assert(!hasAvailWarning2, 'prep: original 0.4 ≤ available 0.6 → ok');

// ============================================================
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
