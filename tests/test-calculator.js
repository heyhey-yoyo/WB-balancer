'use strict';

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL: ' + msg); }
}

function assertEqual(actual, expected, msg) {
  if (Math.abs(actual - expected) < 1e-9) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + ' (expected ' + expected + ', got ' + actual + ')'); }
}

// ============================================================
// Test helper functions
// ============================================================

function toFiniteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  return { factor: factor, adjustedVolume: Math.round(theoretical * factor * 1000) / 1000 };
}

// ============================================================
// toFiniteNumber
// ============================================================
console.log('\n--- toFiniteNumber ---');
assert(toFiniteNumber('') === null, 'empty string → null');
assert(toFiniteNumber(null) === null, 'null → null');
assert(toFiniteNumber(undefined) === null, 'undefined → null');
assert(toFiniteNumber('0') === 0, '"0" → 0');
assert(toFiniteNumber('-5') === -5, '"-5" → -5');
assert(toFiniteNumber('abc') === null, '"abc" → null');
assertEqual(toFiniteNumber('2.5'), 2.5, '2.5');

// ============================================================
// roundToStep
// ============================================================
console.log('\n--- roundToStep ---');
assertEqual(roundToStep(0.37, 0.1, 0.5), 0.5, '0.37 step 0.1 min 0.5 → 0.5 (min volume)');
assertEqual(roundToStep(1.37, 0.1, 0.5), 1.4, '1.37 step 0.1 → 1.4');
assertEqual(roundToStep(1.37, 0.5, 0.5), 1.5, '1.37 step 0.5 → 1.5');
assertEqual(roundToStep(1.25, 0.5, 0.5), 1.5, '1.25 step 0.5 → 1.5 (rounds up)');
assertEqual(roundToStep(1.24, 0.5, 0.5), 1.0, '1.24 step 0.5 → 1.0 (rounds down)');
assertEqual(roundToStep(15.67, 0.2, 1.0), 15.6, '15.67 step 0.2 → 15.6');
assertEqual(roundToStep(0, 0.1, 0.5), 0, '0 → 0');
assert(roundToStep(-1, 0.1, 0.5) === -1, 'negative → unchanged');
assert(roundToStep(null, 0.1, 0.5) === null, 'null → null');

// ============================================================
// suggestPreDilution
// ============================================================
console.log('\n--- suggestPreDilution ---');
assert(suggestPreDilution(0, 0.5) === null, '0 volume → null');
assert(suggestPreDilution(1.0, 0.5) === null, '1.0 >= 0.5 → null (no dilution needed)');
var d = suggestPreDilution(0.37, 0.5);
assert(d !== null, '0.37 < 0.5 → dilution suggested');
assertEqual(d.factor, 2, '0.37 → factor 2');
assertEqual(d.adjustedVolume, 0.74, '0.37 × 2 = 0.74');
d = suggestPreDilution(0.15, 0.5);
assertEqual(d.factor, 4, '0.15 → factor 4');

// ============================================================
// Equalize mode calculation (整管等浓度)
// ============================================================
console.log('\n--- Equalize Mode ---');

function calcEqualize(samples, currentVolume, useIndividual) {
  var concentrations = samples.map(function (s) { return toFiniteNumber(s.concentration); }).filter(function (c) { return Number.isFinite(c) && c > 0; });
  var targetConc = concentrations.length > 0 ? Math.min.apply(null, concentrations) : null;
  return samples.map(function (s) {
    var conc = toFiniteNumber(s.concentration);
    var indVol = toFiniteNumber(s.individualVolume);
    var vol = useIndividual ? (Number.isFinite(indVol) && indVol > 0 ? indVol : 0) : (Number.isFinite(currentVolume) && currentVolume > 0 ? currentVolume : 0);
    var totalProtein = conc > 0 && vol > 0 ? conc * vol : null;
    var finalVol = totalProtein !== null && targetConc !== null && targetConc > 0 ? totalProtein / targetConc : null;
    var loading = finalVol !== null ? Math.max(0, finalVol - vol) : null;
    return { name: s.name, concentration: conc, volume: vol, totalProtein: totalProtein, targetConcentration: targetConc, finalVolume: finalVol, loadingVolume: loading };
  });
}

// All equal concentrations
var r = calcEqualize([{ name: 'A', concentration: '1' }, { name: 'B', concentration: '1' }], 100, false);
assertEqual(r[0].targetConcentration, 1, 'all equal: target = 1');
assertEqual(r[0].loadingVolume, 0, 'all equal: loading = 0');
assertEqual(r[1].loadingVolume, 0, 'all equal: loading = 0');

// Single sample
r = calcEqualize([{ name: 'S', concentration: '3' }], 100, false);
assertEqual(r.length, 1, 'single sample');
assertEqual(r[0].loadingVolume, 0, 'single sample: loading = 0');

// Normal case
r = calcEqualize([{ name: 'A', concentration: '2' }, { name: 'B', concentration: '1' }, { name: 'C', concentration: '3' }], 100, false);
assertEqual(r[0].targetConcentration, 1, 'target = lowest = 1');
assertEqual(r[1].loadingVolume, 0, 'lowest: loading = 0');
assertEqual(r[0].loadingVolume, 100, 'A (2→1): loading = 100');
assertEqual(r[2].loadingVolume, 200, 'C (3→1): loading = 200');

// Large concentration difference
r = calcEqualize([{ name: 'A', concentration: '0.1' }, { name: 'B', concentration: '10' }], 50, false);
assertEqual(r[0].targetConcentration, 0.1, 'target = 0.1');
assert(r[1].loadingVolume > 1000, 'high conc → large loading');

// Individual volumes
r = calcEqualize([{ name: 'A', concentration: '2', individualVolume: '100' }, { name: 'B', concentration: '1', individualVolume: '50' }], 100, true);
assertEqual(r[0].volume, 100, 'individual volume A = 100');
assertEqual(r[1].volume, 50, 'individual volume B = 50');
assertEqual(r[1].loadingVolume, 0, 'B (lowest conc) loading = 0');
assertEqual(r[0].finalVolume, 200, 'A final = 200');

// Empty/null concentration
r = calcEqualize([{ name: 'A', concentration: '' }], 100, false);
assert(r[0].targetConcentration === null, 'empty conc → null target');

// ============================================================
// Per-well mode calculation (每孔等蛋白量)
// ============================================================
console.log('\n--- Per-Well Mode ---');

function calcPerWell(samples, targetMass, finalVolume) {
  return samples.map(function (s) {
    var conc = toFiniteNumber(s.concentration);
    var availableVol = toFiniteNumber(s.availableVolume);
    var sampleVol = conc > 0 && targetMass > 0 ? targetMass / conc : null;
    var loading = Number.isFinite(sampleVol) && finalVolume > 0 ? finalVolume - sampleVol : null;
    return { name: s.name, concentration: conc, sampleVolume: sampleVol, loadingVolume: loading, availableVolume: availableVol };
  });
}

r = calcPerWell([{ name: 'A', concentration: '2' }, { name: 'B', concentration: '1' }], 20, 20);
assertEqual(r[0].sampleVolume, 10, 'A: 20/2 = 10');
assertEqual(r[0].loadingVolume, 10, 'A loading = 10');
assertEqual(r[1].sampleVolume, 20, 'B: 20/1 = 20');
assertEqual(r[1].loadingVolume, 0, 'B loading = 0');

// Volume exceeds final
r = calcPerWell([{ name: 'A', concentration: '0.5' }], 20, 20);
assert(r[0].loadingVolume < 0, '0.5 conc → sample 40 > 20 final → negative loading');

// Available volume warning
r = calcPerWell([{ name: 'A', concentration: '2', availableVolume: '5' }], 20, 20);
assert(r[0].sampleVolume > r[0].availableVolume, 'sample 10 > available 5 → warning');

// ============================================================
// ImageJ rebalance calculation
// ============================================================
console.log('\n--- ImageJ Rebalance Mode ---');

function calcRebalance(samples, finalVolume, referenceMode) {
  var intensities = samples.map(function (s) { return { imageIntensity: toFiniteNumber(s.imageIntensity) }; });
  var values = intensities.map(function (s) { return s.imageIntensity; }).filter(function (v) { return Number.isFinite(v) && v > 0; });
  var reference;
  if (referenceMode === 'min') reference = values.length > 0 ? Math.min.apply(null, values) : null;
  else if (referenceMode === 'max') reference = values.length > 0 ? Math.max.apply(null, values) : null;
  else {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    reference = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return samples.map(function (s) {
    var iv = toFiniteNumber(s.imageIntensity);
    var adj = iv > 0 && reference > 0 ? reference / iv : null;
    var sv = Number.isFinite(adj) && finalVolume > 0 ? finalVolume * adj : null;
    var loading = Number.isFinite(sv) && finalVolume > 0 ? finalVolume - sv : null;
    return { name: s.name, imageIntensity: iv, adjustmentFactor: adj, sampleVolume: sv, loadingVolume: loading };
  });
}

// All ImageJ equal
r = calcRebalance([{ imageIntensity: '1.0' }, { imageIntensity: '1.0' }], 20, 'min');
assertEqual(r[0].adjustmentFactor, 1, 'all equal: adj = 1');
assertEqual(r[0].loadingVolume, 0, 'all equal: loading = 0');
assertEqual(r[1].loadingVolume, 0, 'all equal: loading = 0');

// Min reference
r = calcRebalance([{ imageIntensity: '1.0' }, { imageIntensity: '0.72' }, { imageIntensity: '1.18' }], 20, 'min');
assertEqual(r[1].sampleVolume, 20, 'min sample: full volume');
assert(r[0].sampleVolume < 20, 'higher ImageJ: less volume');
assert(r[2].sampleVolume < 20, 'highest ImageJ: least volume');

// Median reference
r = calcRebalance([{ imageIntensity: '1.0' }, { imageIntensity: '0.5' }, { imageIntensity: '1.5' }], 20, 'median');
assert(r[1].sampleVolume > 20, 'below median → exceeds final volume');

// Abnormal low ImageJ
r = calcRebalance([{ imageIntensity: '1.0' }, { imageIntensity: '0.01' }], 20, 'min');
assertEqual(r[1].sampleVolume, 20, 'lowest ImageJ: full volume');
assert(r[0].sampleVolume < 1, 'much higher ImageJ → very small volume (0.2µL)');
// With max reference, low ImageJ gets very large volume
r = calcRebalance([{ imageIntensity: '1.0' }, { imageIntensity: '0.01' }], 20, 'max');
assert(r[1].sampleVolume > 500, 'max ref + very low ImageJ → very large volume');

// ============================================================
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
