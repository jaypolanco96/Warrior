import test from 'node:test';
import assert from 'node:assert/strict';
import { marketType, allocateAttention, activitySummary, selectActiveCandidates } from '../lib/activity.mjs';
import { uniqueTokens, jupiterPoolToToken, MATURE, SOL } from '../lib/market.mjs';
import { screenToken } from '../lib/risk.mjs';
const now = Date.now(), hour = 3600000;
const coin = (mint, type, volume = 100000) => ({ mint, mature: type === 'mature', pump: type === 'rocket', createdAt: now - (type === 'rocket' ? .3 : type === 'young' ? 3 : 24) * hour, volume1hUsd: volume, volume24hUsd: 1000000, liquidityUsd: 100000, priceUsd: 2, change: { h1: -5, h24: -10 }, activity: { turnoverUsd: volume } });
test('attention follows activity rotation while retaining category coverage and unique coins', () => {
  const tokens = ['mature', 'young', 'other'].flatMap((type) => Array.from({ length: 30 }, (_, i) => coin(`${type}${i}`, type, type === 'mature' ? 1e6 : 1e4)));
  const first = allocateAttention([...tokens, tokens[0]], 20, now);
  assert.equal(first.length, 20); assert.equal(new Set(first.map(t => t.mint)).size, 20);
  assert.equal(first.filter(t => t.mature).length, 15);
  assert.ok(first.some(t => marketType(t, now) === 'young'));
  for (const t of tokens) t.activity.turnoverUsd = t.mint.startsWith('young') ? 1e7 : 1e4;
  const rotated = allocateAttention(tokens, 20, now);
  assert.equal(rotated.filter(t => marketType(t, now) === 'young').length, 15);
  assert.deepEqual(allocateAttention(tokens, NaN), []);
});
test('missing activity, quiet coins and daily collapses do not consume dip readings', () => {
  const good = coin('good', 'mature'), quiet = coin('quiet', 'other', 1), collapse = coin('collapse', 'young');
  collapse.change.h24 = -90;
  const missing = { ...coin('missing', 'other'), volume1hUsd: null, activity: { turnoverUsd: null } };
  assert.deepEqual(selectActiveCandidates([quiet, collapse, missing, good], { limit: 36, now, settings: { minVol1hUsd: 20000, dipDayDropPct: 60 } }).map(t => t.mint), ['good']);
});
test('rocket popularity is observed but cannot bypass the existing age screen', () => {
  const rocket = coin('rocket', 'rocket', 1e9), mature = coin('mature', 'mature');
  assert.equal(marketType(rocket, now), 'rocket');
  assert.equal(screenToken(rocket, {}, now).ok, false);
  const summary = activitySummary([rocket, rocket, mature], { passed: [mature], selected: [mature], now });
  assert.equal(summary.observed, 2); assert.equal(summary.leader, 'rocket');
  assert.equal(summary.groups.find(g => g.type === 'rocket').selected, 0);
  assert.equal(summary.groups.find(g => g.type === 'mature').selected, 1);
  assert.equal(activitySummary([{ mint: 'unknown' }]).groups.find(g => g.type === 'unknown').sharePct, null);
});
test('overlapping feeds preserve deepest pool, token activity and negative safety metadata without summing', () => {
  const [merged] = uniqueTokens([{ mint: MATURE.JUP, pool: 'deep', liquidityUsd: 1e7, activity: { turnoverUsd: 20, scope: 'pool' }, freezeAuthority: true }, { mint: MATURE.JUP, pool: 'shallow', liquidityUsd: 100, activity: { turnoverUsd: 1000, scope: 'token' }, established: true }]);
  assert.equal(merged.pool, 'deep'); assert.equal(merged.mature, true); assert.equal(merged.freezeAuthority, true);
  assert.equal(merged.activity.turnoverUsd, 1000); assert.equal(merged.established, true);
});
test('Jupiter metrics use both sides of USD turnover; missing and zero stay distinct', () => {
  const pool = { id: SOL, chain: 'solana', quoteAsset: SOL, createdAt: new Date(now - 24 * hour).toISOString(), liquidity: 1e6, baseAsset: { id: MATURE.JUP, symbol: 'JUP', usdPrice: 2, stats1h: { buyVolume: 10, sellVolume: 20, numTraders: 5, buyOrganicVolume: 3, sellOrganicVolume: 4 } } };
  const parsed = jupiterPoolToToken(pool);
  assert.equal(parsed.activity.turnoverUsd, 30); assert.equal(parsed.activity.organicTurnoverUsd, 7); assert.equal(parsed.activity.traders, 5);
  pool.baseAsset.stats1h = { buyVolume: 0, sellVolume: 0 };
  assert.equal(jupiterPoolToToken(pool).volume1hUsd, 0);
  delete pool.baseAsset.stats1h.sellVolume;
  assert.equal(jupiterPoolToToken(pool).volume1hUsd, null);
  pool.chain = 'ethereum'; assert.equal(jupiterPoolToToken(pool), null);
});
