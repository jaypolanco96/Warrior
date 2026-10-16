import test from 'node:test';
import assert from 'node:assert/strict';

test('part-exit rules: steps, take out what I put in, and one dip add, each once', async () => {
  const { partialDue } = await import('../lib/orders.mjs'), { resolveRules, exits } = await import('../lib/presets.mjs');
  const { validateSettings } = await import('../lib/strategy.mjs'), p = { solIn: 0.1, last: 1, stop: 0.9 }, off = validateSettings({});
  assert.equal(partialDue(p, 500, off), null, 'off by default'); assert.equal(resolveRules({ preset: 'balanced' }).version, 'balanced-43dac0', 'the Balanced preset\'s version');
  assert.deepEqual(['chill', 'balanced', 'spicy'].map((p) => resolveRules({ preset: p }).settings.stepPct), [0, 6, 6], 'Balanced and Spicy take profit in steps; Chill sells whole at the target');
  const s = validateSettings({ stepPct: 10, takeOutAtPct: 100, dipAddPct: 6 }); assert.match(exits(s), /A third is sold at \+10% and another third at \+20%/);
  assert.equal(partialDue(p, 9, s), null); assert.deepEqual(partialDue(p, 10, s), { kind: 'sell', fraction: 1 / 3, mark: 'step1', reason: 'step' });
  assert.equal(partialDue({ ...p, auto: { step1: true } }, 15, s), null); assert.deepEqual(partialDue({ ...p, auto: { step1: true } }, 20, s), { kind: 'sell', fraction: 1 / 2, mark: 'step2', reason: 'step' });
  const out = partialDue({ ...p, auto: { step1: true, step2: true } }, 100, s); assert.equal(out.reason, 'took-out'); assert.ok(Math.abs(out.fraction - 0.5) < 1e-9, 'at double, half returns the stake'); assert.equal(partialDue({ ...p, auto: { step1: true, step2: true, tookOut: true } }, 300, s), null);
  assert.deepEqual(partialDue(p, -6, s), { kind: 'add', sol: 0.05, mark: 'dip' }); assert.equal(partialDue({ ...p, auto: { dip: true } }, -9, s), null, 'only once'); assert.equal(partialDue({ ...p, last: 0.89 }, -11, s), null, 'never below the stop');
  assert.equal(partialDue({ ...p, rocket: {} }, 50, s), null); assert.equal(partialDue({ ...p, empty: true }, 50, s), null); assert.equal(partialDue(p, NaN, s), null);
  for (const bad of [{ takeOutAtPct: 3 }, { dipAddPct: 60 }, { dipAddPct: 2 }]) assert.throws(() => validateSettings(bad), JSON.stringify(bad));
});
