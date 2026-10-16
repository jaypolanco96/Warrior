import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, resolveRules, toQuery, fromQuery, describe } from '../lib/presets.mjs';
import { validateOrder, orderDue, validateExits, ownExitDue, slicePlan, sliceDue, sliceDone } from '../lib/orders.mjs';
import { summarize, tradesCsv } from '../lib/portfolio.mjs';
import { buyFromTransaction, newBuys } from '../lib/follow.mjs';
import { safetyReport } from '../lib/safety.mjs';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', SOL = 'So11111111111111111111111111111111111111112', ME = '6ix8A8ieggbJ6aWXwBUwyTscmz6aaR4aj6VE5ofZAm82';

test('presets resolve to valid rules, and each has its own version', () => {
  const versions = new Set();
  for (const name of Object.keys(PRESETS)) { const r = resolveRules({ preset: name }); versions.add(r.version); assert.equal(r.preset, name); assert.equal(r.isCustom, false); assert.ok(describe(r).includes('signal groups')); }
  assert.equal(versions.size, 3);
  const chill = resolveRules({ preset: 'chill' }), spicy = resolveRules({ preset: 'spicy' }), balanced = resolveRules({ preset: 'balanced' });
  for (const r of [chill, balanced, spicy]) { assert.equal(r.settings.minConfluence, 4); assert.equal(r.settings.targetPct, 20); assert.equal(r.settings.deepDip, 1); }
  assert.ok(chill.risk.maxOpenPositions < balanced.risk.maxOpenPositions && balanced.risk.maxOpenPositions < spicy.risk.maxOpenPositions, 'the presets differ in how much they hold');
  assert.ok(chill.risk.riskPerTradePct < balanced.risk.riskPerTradePct && balanced.risk.riskPerTradePct < spicy.risk.riskPerTradePct);
  // The cost limit and the safety screen are not part of the dial.
  assert.equal(spicy.risk.maxPriceImpactPct, balanced.risk.maxPriceImpactPct); assert.equal(spicy.risk.minAgeHours, balanced.risk.minAgeHours);
});

test('presets only: typed numbers are ignored everywhere, unknown presets refused', () => {
  const base = resolveRules({ preset: 'balanced' }), typed = resolveRules({ preset: 'balanced', custom: { targetPct: 15, riskPerTradePct: 50 } });
  assert.equal(typed.version, base.version); assert.equal(typed.isCustom, false); assert.equal(typed.settings.targetPct, base.settings.targetPct);
  const back = fromQuery(Object.fromEntries(new URLSearchParams(toQuery({ preset: 'spicy', custom: { targetPct: 30 } }))));
  assert.equal(back.preset, 'spicy'); assert.equal(back.settings.targetPct, resolveRules({ preset: 'spicy' }).settings.targetPct);
  assert.equal(fromQuery({}).version, base.version);
  assert.throws(() => resolveRules({ preset: 'yolo' }));
});

test('price orders: validation, and when they fill', () => {
  const now = 1_000_000;
  const buy = validateOrder({ kind: 'buy-below', mint: MINT, price: 0.9, sol: 0.1 }, { now, currentPrice: 1 });
  assert.equal(buy.ok, true); assert.equal(buy.order.status, 'waiting');
  assert.equal(validateOrder({ kind: 'buy-below', mint: MINT, price: 1.1, sol: 0.1 }, { currentPrice: 1 }).ok, false);
  assert.equal(validateOrder({ kind: 'buy-below', mint: MINT, price: 0.9, sol: 0.001 }, { currentPrice: 1 }).ok, false);
  assert.equal(validateOrder({ kind: 'sell-above', mint: MINT, price: 0.9, fraction: 1 }, { currentPrice: 1 }).ok, false);
  assert.equal(validateOrder({ kind: 'sell-above', mint: MINT, price: 1.2, fraction: 0.5 }, { currentPrice: 1 }).ok, true);
  assert.equal(validateOrder({ kind: 'market', mint: MINT, price: 1 }).ok, false);
  assert.equal(validateOrder({ kind: 'buy-below', mint: 'nope', price: 0.9, sol: 0.1 }).ok, false);
  assert.equal(orderDue(buy.order, 0.95, now + 1), 'wait');
  assert.equal(orderDue(buy.order, 0.9, now + 1), 'fill');
  assert.equal(orderDue(buy.order, 0.5, now + 1), 'fill');
  assert.equal(orderDue(buy.order, null, now + 1), 'wait', 'an unknown price never fills an order');
  assert.equal(orderDue(buy.order, NaN, now + 1), 'wait');
  assert.equal(orderDue(buy.order, 0.5, buy.order.expiresAt), 'expired');
  assert.equal(orderDue({ ...buy.order, status: 'filled' }, 0.5, now + 1), 'done');
  const sell = validateOrder({ kind: 'sell-above', mint: MINT, price: 1.2, fraction: 1 }, { now, currentPrice: 1 }).order;
  assert.equal(orderDue(sell, 1.19, now + 1), 'wait'); assert.equal(orderDue(sell, 1.2, now + 1), 'fill');
});

test('your own stop and target', () => {
  assert.equal(validateExits({ entry: 1, stop: 0.9, target: 1.3 }, 1.05).ok, true);
  assert.equal(validateExits({ entry: 1, stop: 1.1, target: null }, 1.05).ok, false);
  assert.equal(validateExits({ entry: 1, stop: null, target: 1.0 }, 1.05).ok, false);
  assert.equal(validateExits({ entry: 1, stop: -1 }, 1.05).ok, false);
  assert.equal(validateExits({ entry: 1 }, 1.05).ok, true);
  const p = { ownStop: 0.9, ownTarget: 1.3 };
  assert.equal(ownExitDue(p, 1), null); assert.equal(ownExitDue(p, 0.9), 'stop'); assert.equal(ownExitDue(p, 1.31), 'target');
  assert.equal(ownExitDue(p, null), null); assert.equal(ownExitDue({}, 0.0001), null);
});

test('slices: even split, one at a time, no bunching, pause after three failures', () => {
  const made = slicePlan({ side: 'buy', mint: MINT, totalSol: 0.3, slices: 3, everyMinutes: 10, startAt: 0 });
  assert.equal(made.ok, true); let plan = made.plan; assert.equal(plan.solEach, 0.1);
  assert.equal(slicePlan({ side: 'buy', mint: MINT, totalSol: 0.03, slices: 3, everyMinutes: 10 }).ok, false, 'slices too small');
  assert.equal(slicePlan({ side: 'buy', mint: MINT, totalSol: 0.3, slices: 1, everyMinutes: 10 }).ok, false);
  assert.equal(slicePlan({ side: 'buy', mint: MINT, totalSol: 0.3, slices: 3, everyMinutes: 0 }).ok, false);
  assert.deepEqual(sliceDue(plan, 0), { side: 'buy', sol: 0.1, index: 0 });
  plan = sliceDone(plan, true, 0); assert.equal(sliceDue(plan, 5 * 60_000), null, 'not due yet');
  // The tab was closed for an hour: still only one slice, and the next waits a full interval.
  const late = 60 * 60_000; assert.equal(sliceDue(plan, late).index, 1); plan = sliceDone(plan, true, late); assert.equal(sliceDue(plan, late + 1), null);
  plan = sliceDone(plan, true, late + 10 * 60_000); assert.equal(plan.status, 'finished'); assert.equal(sliceDue(plan, late * 10), null);
  let sell = slicePlan({ side: 'sell', mint: MINT, slices: 4, everyMinutes: 5, startAt: 0 }).plan;
  const fractions = []; for (let i = 0, t = 0; i < 4; i++, t += 5 * 60_000) { fractions.push(sliceDue(sell, t).fraction); sell = sliceDone(sell, true, t); }
  assert.deepEqual(fractions, [1 / 4, 1 / 3, 1 / 2, 1]); assert.equal(sell.status, 'finished');
  let bad = made.plan; for (let i = 0; i < 3; i++) bad = sliceDone(bad, false, i); assert.equal(bad.status, 'paused'); assert.equal(bad.done, 0); assert.equal(sliceDue(bad, 1e12), null);
});

test('portfolio sums and a safe CSV', () => {
  const positions = [{ mode: 'paper', mint: MINT, symbol: 'BONK', solIn: 0.1, entry: 1, openedAt: 1 }, { mode: 'paper', mint: SOL, symbol: 'X', solIn: 0.2, entry: 2 }, { mode: 'live', mint: MINT, symbol: 'BONK', solIn: 1, entry: 1 }];
  const trades = [{ mode: 'paper', symbol: 'A', solIn: 0.1, solOut: 0.12, pnlSol: 0.02, pnlPct: 20, reason: 'target', closedAt: 0, rulesVersion: 'balanced-abc123' }, { mode: 'paper', symbol: 'B', solIn: 0.1, solOut: 0.09, pnlSol: -0.01, pnlPct: -10, reason: 'stop', closedAt: 1 }, { mode: 'live', symbol: 'C', solIn: 1, solOut: 2, pnlSol: 1, pnlPct: 100, reason: 'target', closedAt: 2, exit: 'sig123' }];
  const s = summarize({ positions, trades, prices: { [MINT]: 1.1 }, mode: 'paper' });
  assert.equal(s.holdings.length, 2); assert.ok(Math.abs(s.holdings[0].valueSol - 0.11) < 1e-9); assert.equal(s.holdings[1].priced, false); assert.equal(s.holdings[1].valueSol, 0.2);
  assert.equal(s.unpriced, 1); assert.ok(Math.abs(s.unrealizedSol - 0.01) < 1e-9); assert.ok(Math.abs(s.realizedSol - 0.01) < 1e-9);
  assert.equal(s.wins, 1); assert.equal(s.losses, 1); assert.equal(s.winRatePct, 50); assert.equal(s.best.symbol, 'A'); assert.equal(s.worst.symbol, 'B');
  assert.equal(summarize({ positions, trades, prices: {}, mode: 'live' }).realizedSol, 1);
  const csv = tradesCsv([...trades, { mode: 'paper', symbol: '=HYPERLINK("http://x","y")', solIn: 0.1, solOut: 0.1, pnlSol: 0, pnlPct: 0, reason: 'manual', closedAt: 3 }]);
  const lines = csv.trim().split('\r\n'); assert.equal(lines.length, 5); assert.ok(lines[0].startsWith('closed_at_utc,mode,coin'));
  assert.ok(lines[1].includes('practice,A,0.100000,0.120000,0.020000,20.00,target,balanced-abc123')); assert.ok(lines[2].includes('-0.010000'), 'negative numbers stay numbers');
  assert.ok(lines[3].includes('trading-wallet,C') && lines[3].includes(',sig123,'));
  // the columns that say what kind of trade it was and what Warrior saw when it bought
  assert.ok(lines[0].endsWith('exit_transaction,kind,opened_at_utc,minutes_held,coin_age_min_at_buy,holders_at_buy,traders_at_buy,bundles_at_buy,coin_address,round_trip_cost_pct'));
  const rich = tradesCsv([{ mode: 'live', symbol: 'R', mint: 'MintAddr', solIn: 0.0267, solOut: 0.01, pnlSol: -0.0167, pnlPct: -62.5, reason: 'stop', openedAt: 60_000, closedAt: 240_000, kind: 'early', rocket: true, checked: { ageMin: 4, holders: 180, traders: 320, bundles: 6 } }]).trim().split('\r\n')[1];
  assert.ok(rich.endsWith(',early,1970-01-01T00:01:00.000Z,3.0,4,180,320,6,MintAddr,'), rich); assert.ok(tradesCsv([{ mode: 'paper', symbol: 'old', solIn: 1, solOut: 1, pnlSol: 0, pnlPct: 0, reason: 'manual', closedAt: 5 }]).trim().split('\r\n')[1].endsWith(',,,,,,,,,'), 'an older trade without these facts leaves them blank'); assert.ok(lines[4].includes(`"'=HYPERLINK(""http://x"",""y"")"`), 'formula cells are neutralised');
});

test('following a wallet: only real buys count', () => {
  const tx = (o) => ({ blockTime: 100, transaction: { signatures: ['sigA'], message: { accountKeys: [{ pubkey: ME }, { pubkey: 'other' }] } }, meta: { err: null, preBalances: [5_000_000_000, 0], postBalances: [4_000_000_000, 0], preTokenBalances: [], postTokenBalances: [{ owner: ME, mint: MINT, uiTokenAmount: { amount: '5000' } }], ...o } });
  const buy = buyFromTransaction(tx({}), ME);
  assert.deepEqual(buy, { mint: MINT, tokenRaw: '5000', solSpent: 1, at: 100_000, signature: 'sigA' });
  assert.equal(buyFromTransaction(tx({ err: { InstructionError: [] } }), ME), null, 'failed transaction');
  assert.equal(buyFromTransaction(tx({ postBalances: [5_000_000_000, 0] }), ME), null, 'received coins without paying: a transfer or airdrop');
  assert.equal(buyFromTransaction(tx({ preTokenBalances: [{ owner: ME, mint: MINT, uiTokenAmount: { amount: '9000' } }] }), ME), null, 'that was a sell');
  assert.equal(buyFromTransaction(tx({ postTokenBalances: [{ owner: 'someone-else', mint: MINT, uiTokenAmount: { amount: '5000' } }] }), ME), null, 'coins went to another wallet');
  assert.equal(buyFromTransaction(tx({}), 'not-in-this-transaction'), null);
  assert.equal(buyFromTransaction(null, ME), null);
  const list = [{ signature: 'a', at: 50 }, { signature: 'b', at: 150 }, { signature: 'c', at: 120 }, { signature: null, at: 500 }];
  assert.deepEqual(newBuys(list, { since: 100, seen: ['b'] }).map((b) => b.signature), ['c']);
});

test('safety panel: unknown stays unknown, and the worst finding leads', () => {
  const empty = safetyReport({}); assert.equal(empty.worst, 'unknown'); assert.ok(empty.items.every((i) => i.level === 'unknown'));
  const now = Date.UTC(2026, 9, 12), good = safetyReport({ now, info: { holders: { count: 50000, distribution_percentage: { top_10: '20.5' } }, developer_holding_percentage: '0.0', freeze_authority: 'no', mint_authority: 'no', launchpad_details: { completed: true, completed_at: '2026-10-01T00:00:00Z' } }, token: { createdAt: now - 10 * 86_400_000, liquidityUsd: 500000, pump: true }, depth: [{ sol: 1, impactPct: 1.1 }] });
  assert.equal(good.counts.bad, 0); assert.equal(good.items.find((i) => i.key === 'holders').level, 'good'); assert.equal(good.items.find((i) => i.key === 'creatorHistory').level, 'unknown');
  const bad = safetyReport({ now, info: { holders: { distribution_percentage: { top_10: '81' } }, developer_holding_percentage: '20.0', freeze_authority: 'yes', mint_authority: 'no', is_honeypot: 'yes' }, token: { createdAt: now - 3_600_000, liquidityUsd: 9000 }, depth: [{ sol: 5, impactPct: 9 }, { sol: 1, impactPct: NaN }] });
  assert.equal(bad.worst, 'bad'); for (const key of ['holders', 'creator', 'freeze', 'honeypot', 'age', 'liquidity', 'depth5']) assert.equal(bad.items.find((i) => i.key === key).level, 'bad', key);
  assert.equal(safetyReport({ depth: [{ sol: 1, impactPct: 100 }] }).items.find((i) => i.key === 'depth1').value, 'cannot be priced right now');
  assert.equal(bad.items.find((i) => i.key === 'mint').level, 'good'); assert.equal(bad.items.find((i) => i.key === 'depth1').level, 'unknown');
});

test('pools that can be emptied are refused, and how a coin launched is told truthfully', async () => {
  const { screenToken, unlockedPool } = await import('../lib/risk.mjs'), { whyNot } = await import('../lib/coach.mjs'), now = Date.UTC(2026, 9, 12);
  const base = { liquidityUsd: 220000, volume24hUsd: 14e6, createdAt: now - 4 * 3_600_000 };
  const rugged = { ...base, mint: '2J2BczpjoP2a2554UPCKCYoSwWH46oBYpLa4PSNF2J4i', dex: 'pumpswap' }, launched = { ...base, mint: 'HbPDWSqu8hpVMX6gMjwMDGe5rVgicWo3Qh3Jaojypump', dex: 'pumpswap' }, elsewhere = { ...base, mint: MINT, dex: 'raydium' };
  assert.equal(unlockedPool(rugged), true); assert.equal(unlockedPool(launched), false); assert.equal(unlockedPool(elsewhere), false, 'other exchanges are not judged by this rule: the data cannot tell');
  const s = screenToken(rugged, {}, now); assert.equal(s.ok, false); assert.deepEqual(s.reasons, ['Pool money is not locked']); assert.equal(screenToken(launched, {}, now).ok, true); assert.equal(screenToken(elsewhere, {}, now).ok, true);
  const why = whyNot({ ...rugged, analysis: { decision: 'enter', score: 3, confirmations: { trend: true, momentum: true, participation: true, structure: false }, reasons: [] }, screen: s }, resolveRules({})); assert.equal(why[0].rule, 'Safety screen: pool money'); assert.match(why[0].said, /not launched on pump\.fun/);
  const report = safetyReport({ token: { ...base, pump: false, unlockedPool: true }, now }); assert.equal(report.items.find((i) => i.key === 'poolLock').level, 'bad'); assert.equal(report.items.find((i) => i.key === 'launch').value, 'Not from a known launchpad'); assert.equal(report.worst, 'bad');
  assert.equal(safetyReport({ token: { ...base, pump: true }, now }).items.some((i) => i.key === 'poolLock'), false);
});

test('the live price is a second pair of eyes on the stop, and an emptied pool is recognised', async () => {
  const { autoExitDue, confirm, poolEmptied, EMPTY_POOL_USD } = await import('../lib/orders.mjs'), p = { stop: 0.85, target: 1.2 };
  assert.equal(autoExitDue(p, 1), null); assert.equal(autoExitDue(p, 0.85), 'stop'); assert.equal(autoExitDue(p, 0.2), 'stop'); assert.equal(autoExitDue(p, 1.21), 'target');
  assert.equal(autoExitDue(p, null), null, 'no price, no action'); assert.equal(autoExitDue(p, NaN), null); assert.equal(autoExitDue({}, 0.01), null);
  const seen = new Map(); assert.equal(confirm(seen, 'a', 'stop'), false, 'one look is not enough'); assert.equal(confirm(seen, 'a', 'stop'), true, 'two in a row are');
  seen.clear(); confirm(seen, 'a', 'stop'); assert.equal(confirm(seen, 'a', null), false, 'a recovery in between resets the count'); assert.equal(confirm(seen, 'a', 'stop'), false);
  seen.clear(); confirm(seen, 'a', 'stop'); assert.equal(confirm(seen, 'a', 'target'), false, 'a different answer starts over'); assert.equal(confirm(seen, 'b', 'stop'), false, 'each coin is counted on its own');
  assert.equal(poolEmptied(0), true); assert.equal(poolEmptied(EMPTY_POOL_USD - 1), true); assert.equal(poolEmptied(220000), false); assert.equal(poolEmptied(undefined), false, 'unknown is not treated as emptied'); assert.equal(poolEmptied(NaN), false);
});
