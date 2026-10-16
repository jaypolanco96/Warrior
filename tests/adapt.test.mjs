// Self-ruling guardrails. The walk-forward results behind these rules are in the commit that added this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidence, judge, baselineOf, perDayOf, PROBATION_TRADES } from '../lib/adapt.mjs';
import { resolveRules, ADAPT, toQuery, fromQuery } from '../lib/presets.mjs';

const H = 3_600_000, base = (preset = 'balanced', adapt = {}) => (k) => { const r = resolveRules({ preset, adapt }); return ADAPT[k].of === 'settings' ? r.settings[k] : r.risk[k]; };
const pos = (n, f) => Array.from({ length: n }, (_, i) => ({ mint: `M${i}`, openedAt: i * 10 * H, closedAt: i * 10 * H + 2 * H, pct: 0, reason: 'stop', ...f(i) }));

test('only the four listed dials can move, never a safety rule, and only inside their range', () => {
  assert.deepEqual(Object.keys(ADAPT).sort(), ['dipBelowPct', 'holdHours', 'lossCooldownMinutes', 'targetPct']);
  for (const safety of ['minLiquidityUsd', 'dipStopPct', 'maxPriceImpactPct', 'minVolume24hUsd', 'dailyLossLimitPct', 'riskPerTradePct']) assert.ok(!(safety in ADAPT), safety);
  const r = resolveRules({ preset: 'spicy', adapt: { holdHours: 99, targetPct: 5, minLiquidityUsd: 1000, dipStopPct: 50 } });
  assert.equal(r.settings.holdHours, 3); assert.equal(r.settings.targetPct, 20); assert.equal(r.risk.minLiquidityUsd, resolveRules({ preset: 'spicy' }).risk.minLiquidityUsd); assert.equal(r.settings.dipStopPct, 20);
  assert.equal(resolveRules({ preset: 'spicy' }).version, 'spicy-b41b4c', 'no moves: the tested version name is unchanged');
});

test('a move travels to the server: the scan and position checks read it back', () => {
  const q = toQuery({ preset: 'balanced', adapt: { holdHours: 4 } }), r = fromQuery(Object.fromEntries(new URLSearchParams(q)));
  assert.equal(r.settings.holdHours, 4); assert.match(r.version, /~/);
});

test('the clock moves one step, and only with enough sales behind it', () => {
  const after = (n) => ({ time: { n, max: 12, end: 4 } });
  assert.equal(evidence({ positions: [], after: after(5), value: base() }).length, 0, 'five clock sales are not enough');
  const m = evidence({ positions: [], after: after(6), value: base() });
  assert.equal(m.length, 1); assert.equal(m[0].key, 'holdHours'); assert.equal(m[0].to, m[0].from + 1);
  assert.equal(evidence({ positions: [], after: after(9), value: base('balanced', { holdHours: 5 }) }).length, 0, 'never past the top of the range');
});

test('a higher target is never proposed from what coins did after the target (it cost Chill a third of its profit)', () => {
  assert.equal(evidence({ positions: [], after: { target: { n: 30, max: 60, end: 25 } }, value: base() }).filter((m) => m.key === 'targetPct').length, 0);
});

test('re-buying after a loss: a longer wait needs at least 5 re-buys, 70% of them lost', () => {
  const lost = (i) => i % 2 === 0 ? { mint: `C${i >> 1}`, pct: -5 } : { mint: `C${i >> 1}`, pct: i === 1 ? 3 : -4 };
  const P = pos(12, lost); // 6 coins, each lost then re-bought 10 h later; 5 of the 6 re-buys lost
  const m = evidence({ positions: P, value: base() }).find((x) => x.key === 'lossCooldownMinutes');
  assert.ok(m); assert.equal(m.to, m.from + 120);
  assert.equal(evidence({ positions: P.slice(0, 8), value: base() }).filter((x) => x.key === 'lossCooldownMinutes').length, 0, 'four re-buys are not enough');
});

test('dip depth needs a large, well-sampled gap (it fired on shuffled results with weaker evidence)', () => {
  const v = base('spicy'), mk = (n, depth, pct) => pos(n, () => ({ depthPct: depth, pct }));
  assert.equal(evidence({ positions: [...mk(8, -8.5, -2), ...mk(5, -12, 3)], value: v }).length, 0, 'eight shallow and five deep: not enough');
  const m = evidence({ positions: [...mk(12, -8.5, -2.5), ...mk(8, -12, 3)], value: v });
  assert.equal(m[0]?.key, 'dipBelowPct'); assert.equal(m[0].to, 9);
});

test('probation: undone when the next trades do worse per trade, or earn less than half as much per day', () => {
  const before = pos(10, () => ({ pct: 2 })), probation = { at: 200 * H, base: baselineOf(before), perDay: perDayOf(before) };
  const later = (n, pct, gap = 10) => Array.from({ length: n }, (_, i) => ({ openedAt: 200 * H + i * gap * H, closedAt: 200 * H + i * gap * H + 2 * H, pct }));
  assert.equal(judge({ positions: [...before, ...later(PROBATION_TRADES - 1, -9)], probation }), null, 'waits for eight trades');
  assert.equal(judge({ positions: [...before, ...later(PROBATION_TRADES, -1)], probation }).verdict, 'revert', 'worse per trade');
  assert.equal(judge({ positions: [...before, ...later(PROBATION_TRADES, 2.5)], probation }).verdict, 'keep');
  assert.equal(judge({ positions: [...before, ...later(PROBATION_TRADES, 2.2, 40)], probation }).verdict, 'revert', 'a little better per trade, but far fewer trades a day');
});
