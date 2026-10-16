import test from 'node:test'; import assert from 'node:assert/strict';
import { celebrationFor, comfortFor, moodFor, GLOSSARY, WASH_SOL } from '../lib/joy.mjs';

const closed = (o) => ({ symbol: 'BONK', closed: true, pnlSol: 0.01, pnlPct: 5, reason: 'target', ...o });

test('Celebrations fire only for a closed trade that actually made money', () => {
  assert.equal(celebrationFor(closed()).kind, 'warrior');
  assert.equal(celebrationFor(closed({ closed: false })).kind, 'none'); // buying is not winning
  assert.equal(celebrationFor(closed({ closed: undefined })).kind, 'none');
  assert.equal(celebrationFor(closed({ pnlSol: -0.01, pnlPct: -5 })).kind, 'none'); // never for a loss
  assert.equal(celebrationFor(closed({ pnlSol: WASH_SOL, pnlPct: 0.01 })).kind, 'none'); // a wash is not a win
  assert.equal(celebrationFor(closed({ pnlSol: 0 })).kind, 'none');
  for (const bad of [null, {}, closed({ pnlSol: NaN }), closed({ pnlPct: Infinity }), closed({ symbol: 5 })]) assert.equal(celebrationFor(bad).kind, 'none');
});

test('A bigger win gets a bigger celebration, and practice wins always say they are practice', () => {
  const small = celebrationFor(closed({ pnlPct: 1 })), mid = celebrationFor(closed({ pnlPct: 5 })), big = celebrationFor(closed({ pnlPct: 12 }));
  assert.deepEqual([small.kind, mid.kind, big.kind], ['chuckle', 'warrior', 'roar']);
  assert.ok(small.warriors < mid.warriors && mid.warriors < big.warriors && small.hearts < mid.hearts && mid.hearts < big.hearts);
  assert.match(mid.headline, /^\+0\.0100 SOL on BONK$/); assert.match(mid.detail, /after costs/);
  const practice = celebrationFor(closed({ practice: true }));
  assert.equal(practice.practice, true); assert.match(practice.detail, /practice money/); assert.match(practice.spoken, /^Practice win/);
  const first = celebrationFor(closed(), { firstWin: true }); assert.equal(first.firstWin, true); assert.match(first.message, /^Your first win!/);
  assert.match(celebrationFor(closed({ practice: true }), { firstWin: true }).message, /^Your first practice win!/);
});

test('A loss gets a calm, factual, kind message and never a celebration', () => {
  const stopped = comfortFor(closed({ pnlSol: -0.004, pnlPct: -3.1, reason: 'stop' }));
  assert.equal(stopped.kind, 'comfort'); assert.match(stopped.headline, /^−0\.0040 SOL on BONK$/); assert.match(stopped.message, /did its job/); assert.match(stopped.detail, /−3\.1%/);
  assert.match(comfortFor(closed({ pnlSol: -0.004, pnlPct: -3, reason: 'manual' })).message, /You closed it\. Small losses are part of trading\./);
  assert.match(comfortFor(closed({ pnlSol: -0.004, pnlPct: -3, reason: 'stop', practice: true })).detail, /nothing real was lost/);
  assert.equal(comfortFor(closed({ pnlSol: 0.00001, pnlPct: 0 })).kind, 'wash'); assert.equal(comfortFor(closed({ pnlSol: -0.00001, pnlPct: 0 })).kind, 'wash');
  assert.equal(comfortFor(closed()).kind, 'none'); // a win is not comforted
  assert.equal(comfortFor(closed({ closed: false, pnlSol: -1 })).kind, 'none');
  // no shaming or alarm words anywhere in a loss message
  for (const reason of ['stop', 'trailing-stop', 'time', 'trend-break', 'manual', 'something-new']) { const c = comfortFor(closed({ pnlSol: -0.02, pnlPct: -9, reason })); assert.doesNotMatch(`${c.headline} ${c.message} ${c.detail} ${c.spoken}`, /fail|bad|wrong|mistake|stupid|rekt|oops|warning|danger/i); }
});

test('Every closed trade gets exactly one response: celebration, comfort or a wash', () => {
  for (const pnlSol of [-0.5, -0.0001, -0.00005, 0, 0.00005, 0.0001, 0.5]) { const t = closed({ pnlSol, pnlPct: pnlSol * 100 }), a = celebrationFor(t).kind !== 'none', b = comfortFor(t).kind !== 'none'; assert.equal(a !== b, true, String(pnlSol)); }
});

test('The mascot mood follows what is really happening', () => {
  assert.equal(moodFor({ recent: 'win', enters: 3 }).mood, 'delighted'); assert.equal(moodFor({ recent: 'loss' }).mood, 'gentle');
  assert.equal(moodFor({ failed: true, enters: 2 }).mood, 'unsure'); assert.equal(moodFor({ scanning: true }).mood, 'looking');
  assert.match(moodFor({ enters: 1 }).line, /^1 setup I like\. Check the green card\.$/); assert.match(moodFor({ enters: 2 }).line, /^2 setups I like\. Check the green cards\.$/);
  assert.equal(moodFor({ forming: 2 }).mood, 'curious'); assert.equal(moodFor({}).mood, 'sleepy'); assert.equal(moodFor().mood, 'sleepy');
  assert.notEqual(moodFor({ tick: 0 }).line, moodFor({ tick: 1 }).line); assert.ok(moodFor({ tick: -7 }).line.length > 10); assert.ok(moodFor({ tick: 1e9 }).line.length > 10);
  for (const m of [moodFor({ recent: 'win' }), moodFor({ recent: 'loss' }), moodFor({ failed: true }), moodFor({ scanning: true }), moodFor({ enters: 1 }), moodFor({ forming: 1 }), moodFor({})]) { assert.ok(m.face.length > 0); assert.doesNotMatch(m.line, /guarantee|will profit|can't lose|moon/i); }
});

test('The glossary explains every label in plain words', () => {
  assert.equal(Object.isFrozen(GLOSSARY), true);
  for (const term of ['Price', '1h', 'Regime', 'Hourly bias', 'Liquidity', '24h volume', 'Stop', 'Target', 'Price impact', 'Slippage limit', 'trend', 'momentum', 'participation', 'structure', 'At risk']) { assert.ok(GLOSSARY[term]?.length > 20, term); assert.ok(GLOSSARY[term].length < 200, term); }
});

test('A position written off after its pool was emptied gets the truth, kindly, and never a celebration', async () => {
  const { comfortFor, celebrationFor } = await import('../lib/joy.mjs'), { coachAfter } = await import('../lib/coach.mjs'), { receipt } = await import('../lib/receipt.mjs');
  const t = { symbol: 'HIRE', closed: true, pnlSol: -0.0278, pnlPct: -100, reason: 'written-off', practice: false };
  assert.equal(celebrationFor(t).kind, 'none'); const c = comfortFor(t); assert.equal(c.kind, 'comfort'); assert.match(c.message, /pool was emptied, so it could not be sold/); assert.match(c.message, /not a mistake you made/); assert.doesNotMatch(c.message, /Small losses/);
  assert.match(coachAfter({ ...t, mode: 'live' }).learned, /No stop can sell into an empty pool/);
  const r = receipt({ mode: 'live', solIn: 0.0278, solOut: 0, costs: { entry: { requestedSol: 0.025, impactSol: 0.0003, extraSol: 0.0028 }, exitImpactPct: NaN, exitQuotedSol: 0 } }); assert.equal(r.resultSol, -0.0278); assert.equal(r.resultPct, -100);
});
