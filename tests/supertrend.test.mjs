import test from 'node:test';
import assert from 'node:assert/strict';
import { superTrend, dipCheck } from '../lib/indicators.mjs';
import { analyze } from '../lib/strategy.mjs';

const bars = (closes) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 60_000, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1000 }; });
const rise = (n, from = 1, step = 0.03) => Array.from({ length: n }, (_, i) => from * (1 + step) ** i), fall = (n, from = 2, step = 0.05) => Array.from({ length: n }, (_, i) => from * (1 - step) ** i);

test('SuperTrend is up in a steady rise, down in a steady fall, and flips when the trend turns', () => {
  assert.equal(superTrend(bars(rise(30))).up, true); assert.equal(superTrend(bars(fall(30))).up, false);
  const turn = superTrend(bars([...rise(25), ...fall(12, rise(25).at(-1), 0.08)])); assert.equal(turn.up, false); assert.ok(turn.flippedAgo < 12, 'it turned down during the fall');
  const up = superTrend(bars(rise(30))); assert.ok(up.line < bars(rise(30)).at(-1).close, 'in an uptrend the line sits under the price');
  assert.equal(superTrend(bars(rise(8))), null, 'too few candles'); assert.equal(superTrend(null), null);
});

test('a Rocket bet is not bought into a dip (the JAILFLOYD case)', () => {
  // ran up, then falling hard for several minutes: SuperTrend has turned down
  const dumping = bars([...rise(12, 1, 0.08), ...fall(6, rise(12, 1, 0.08).at(-1), 0.12)]), d = dipCheck(dumping); assert.equal(d.ok, false); assert.match(d.reason, /SuperTrend is down|below its high|fell/);
  // still running
  const running = dipCheck(bars(rise(14, 1, 0.06))); assert.equal(running.ok, true); assert.equal(running.superTrendUp, true);
  // too few candles for SuperTrend: the recent high and the last candle decide
  assert.match(dipCheck(bars([1, 1.5, 2, 1.4])).reason, /below its high|fell/); assert.equal(dipCheck(bars([1, 1.2, 1.4, 1.5])).ok, true);
  assert.match(dipCheck(bars([1, 1.2, 1.4, 1.45]), 1.0).reason, /below its high/, 'the live price counts, not only the last finished candle');
  // JAILFLOYD's real candles at the moment Warrior bought: +71%, +17%, +35%, +47%, then -2%. The next minute fell 45%.
  const k = (o, c) => ({ t: 0, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1 }), jail = [k(3.41e-6, 5.83e-6), k(5.83e-6, 6.81e-6), k(6.81e-6, 9.22e-6), k(9.22e-6, 1.36e-5), k(1.36e-5, 1.32e-5)];
  const j = dipCheck(jail, 1.32e-5); assert.equal(j.ok, false); assert.match(j.reason, /last one-minute candle was red: the run has stalled/); assert.equal(dipCheck(jail.slice(0, 4), 1.36e-5).ok, true, 'a minute earlier it was still running');
  assert.match(dipCheck(bars(rise(14, 1, 0.06)), rise(14, 1, 0.06).at(-1) * 0.9).reason, /fallen 10% inside the current minute/, 'a fall inside the minute counts even when SuperTrend is up');
  // nothing to read yet: said, not refused
  assert.deepEqual(dipCheck(bars([1, 1.1])), { ok: true, known: false, reason: null, candles: 2 }); assert.equal(dipCheck(null).known, false);
});

test('a trend buy is not made against the SuperTrend; a deep dip is its own kind of buy', () => {
  const series = bars([...rise(40, 1, 0.02), ...fall(40, rise(40, 1, 0.02).at(-1), 0.03)]).map((c, i) => ({ ...c, t: i * 300_000 }));
  const dip = analyze(series, {}); assert.equal(dip.decision, 'enter'); assert.equal(dip.style, 'dip'); assert.match(dip.dipNote, /Deep dip: RSI \d+, [\d.]+% under/); assert.ok(dip.stopPct >= 8, 'a dip buy gets room to breathe');
  const down = analyze(series, { deepDip: 0 });
  assert.equal(down.decision, 'wait'); assert.equal(down.superTrend, 'down'); assert.ok(down.reasons.includes('SuperTrend is down'));
  const up = analyze(bars(rise(80, 1, 0.01)).map((c, i) => ({ ...c, t: i * 300_000 })), {}); assert.equal(up.superTrend, 'up'); assert.ok(!up.reasons.includes('SuperTrend is down'));
});
