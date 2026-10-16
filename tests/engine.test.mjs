import test from 'node:test'; import assert from 'node:assert/strict';
import { validCandles, ema, rsi, atr, macd, vwap, aggregate } from '../lib/indicators.mjs';
import { analyze, manage, validateSettings, regimeLabel, bias } from '../lib/strategy.mjs';
import { screenToken, positionSize, checkQuote, validateRisk, defaultRisk } from '../lib/risk.mjs';

// Made-up candles for testing the rules. Not market data.
const bar = (i, close, o = {}) => ({ t: i * 300_000, open: o.open ?? close * 0.998, high: o.high ?? close * 1.004, low: o.low ?? close * 0.994, close, volume: o.volume ?? 1000 });
// A steady climb with pullbacks; the phase puts the last bars just after a dip, not at the top of a spike.
const rising = (n = 120) => Array.from({ length: n }, (_, i) => bar(i, 1.0015 ** i * (1 + 0.03 * Math.sin((i + 6) / 3))));
const falling = (n = 120) => Array.from({ length: n }, (_, i) => bar(i, 1 * 0.996 ** i));

test('Indicators give known values and reject malformed candles', () => {
  assert.equal(ema([5, 5, 5, 5], 3), 5);
  assert.equal(rsi(Array.from({ length: 20 }, (_, i) => i + 1)), 100); assert.equal(rsi(Array.from({ length: 20 }, () => 7)), 50); assert.equal(rsi([1, 2]), null);
  assert.ok(rsi(Array.from({ length: 20 }, (_, i) => 20 - i)) < 1);
  const flat = Array.from({ length: 20 }, (_, i) => ({ t: i, open: 10, high: 11, low: 9, close: 10, volume: 5 }));
  assert.equal(atr(flat, 14), 2); assert.equal(vwap(flat, 10), 10); assert.equal(vwap(flat.map((c) => ({ ...c, volume: 0 }))), null); assert.equal(macd([1, 2, 3]), null);
  assert.equal(aggregate(flat, 12).length, 1); assert.equal(aggregate(flat, 12)[0].volume, 60);
  assert.equal(validCandles(flat, 20), true); assert.equal(validCandles(flat, 21), false);
  for (const bad of [{ low: 0 }, { high: 5 }, { close: NaN }, { volume: -1 }]) assert.equal(validCandles([{ ...flat[0], ...bad }]), false);
  assert.equal(validCandles([flat[1], flat[0]]), false); // out of order
});

test('The strategy enters only on agreement, and explains every refusal', () => {
  const up = rising(); up[up.length - 1] = bar(up.length - 1, up.at(-2).close * 1.012, { volume: 5000 }); // breakout bar on heavy volume
  const a = analyze(up, { minConfluence: 3 });
  assert.equal(a.decision, 'enter', JSON.stringify(a.reasons)); assert.ok(a.score >= 3); assert.equal(a.regime, 'uptrend'); assert.ok(a.stop < a.price && a.target > a.price);
  assert.ok(a.stopPct >= 3 && a.stopPct <= 12); assert.ok(Math.abs(a.target / a.price - 1.1) < 1e-9);
  const down = analyze(falling()); assert.equal(down.decision, 'wait'); assert.ok(down.reasons.includes('Short-term downtrend'));
  assert.equal(analyze(rising(40)).decision, 'wait'); assert.match(analyze(rising(40)).reasons[0], /60 clean completed candles/);
  // a quiet drift up with no volume or breakout does not have enough agreement
  const quiet = Array.from({ length: 120 }, (_, i) => bar(i, 1 + i * 0.0002, { volume: 1000 }));
  assert.equal(analyze(quiet, { minConfluence: 4 }).decision, 'wait');
  // wild bars are chaos, whatever the direction
  const wild = rising().map((c) => ({ ...c, high: c.close * 1.12, low: c.close * 0.88 }));
  assert.ok(analyze(wild).reasons.includes('Volatility too wild to size a stop'));
  assert.equal(regimeLabel({ atrPct: null }, 6), 'unknown'); assert.equal(bias(falling()), 'bearish'); assert.equal(bias(rising(30)), 'neutral');
  for (const bad of [{ minConfluence: 5 }, { targetPct: 0 }, { maxStopPct: 1 }, { maxHoldBars: 1.5 }]) assert.throws(() => validateSettings(bad));
});

test('Open positions exit on stop, target, trailing stop, time and trend break; stale data never triggers a trade', () => {
  const base = rising(80), entry = base.at(-1).close, position = { entry, stop: entry * 0.95, target: entry * 1.1, entryBar: base.at(-1).t };
  const next = (close, o) => [...base, bar(80, close, o)];
  assert.equal(manage(position, next(entry * 1.01)).action, 'hold');
  assert.equal(manage(position, next(entry * 0.94, { low: entry * 0.93, open: entry * 0.99, high: entry * 0.995 })).reason, 'stop');
  assert.equal(manage(position, next(entry * 1.11, { high: entry * 1.12 })).reason, 'target');
  // gap down through the stop fills at the open, not at the stop price
  assert.ok(manage(position, next(entry * 0.9, { open: entry * 0.92, high: entry * 0.92, low: entry * 0.89 })).price < position.stop);
  // after a move of one full risk unit, the stop trails and can never be below break-even
  const trailed = manage({ ...position, peak: entry * 1.06 }, next(entry * 1.04, { high: entry * 1.045, low: entry * 1.03 }));
  assert.equal(trailed.action, 'hold'); assert.ok(trailed.stop >= entry);
  assert.equal(manage({ ...position, peak: entry * 1.08 }, next(entry * 1.0, { high: entry * 1.01, low: entry * 0.995 })).reason, 'trailing-stop');
  assert.equal(manage({ ...position, entryBar: base[5].t }, next(entry * 1.01), { maxHoldBars: 10 }).reason, 'time');
  const stale = manage(position, []); assert.equal(stale.action, 'hold'); assert.equal(stale.stale, true);
});

test('Risk rules screen coins, size positions from the stop, and stop trading after the daily loss limit', () => {
  const now = Date.UTC(2026, 9, 12), good = { mint: 'So11111111111111111111111111111111111111112', liquidityUsd: 80000, volume24hUsd: 500000, createdAt: now - 5 * 3600_000 };
  assert.equal(screenToken(good, {}, now).ok, true);
  assert.deepEqual(screenToken({ ...good, liquidityUsd: 1000 }, {}, now).reasons, ['Liquidity too thin']);
  assert.deepEqual(screenToken({ ...good, createdAt: now - 600_000 }, {}, now).reasons, ['Pool too new']);
  assert.ok(screenToken({ ...good, liquidityUsd: null }, {}, now).reasons.includes('Liquidity unknown')); // unknown is not safe
  assert.ok(screenToken({ ...good, freezeAuthority: 'x' }, {}, now).reasons.includes('Token can be frozen by its creator'));
  assert.ok(screenToken({ ...good, mintAuthority: 'x' }, {}, now).reasons.includes('Creator can still mint more supply'));
  // 0.5 SOL wallet, 5% stop: 2% risk allows 0.2 SOL, the 25% cap allows 0.125 SOL
  const size = positionSize({ balanceSol: 0.5, equitySol: 0.5, stopPct: 5, openPositions: 0, dayPnlSol: 0 });
  assert.equal(size.sol, 0.125); assert.deepEqual(size.reasons, []);
  assert.ok(Math.abs(positionSize({ balanceSol: 0.5, equitySol: 0.5, stopPct: 12, openPositions: 0, dayPnlSol: 0 }).sol - 0.083333) < 1e-6); // wider stop, smaller trade
  assert.equal(positionSize({ balanceSol: 0.04, equitySol: 0.5, stopPct: 5, openPositions: 0, dayPnlSol: 0 }).sol, 0); // fee reserve protected
  assert.ok(positionSize({ balanceSol: 0.5, equitySol: 0.5, stopPct: 5, openPositions: 3, dayPnlSol: 0 }).reasons[0].includes('maximum number'));
  assert.ok(positionSize({ balanceSol: 0.5, equitySol: 0.5, stopPct: 5, openPositions: 0, dayPnlSol: -0.06 }).reasons.some((r) => r.includes('Daily loss limit')));
  assert.equal(positionSize({ balanceSol: NaN, equitySol: 0.5, stopPct: 5, openPositions: 0, dayPnlSol: 0 }).sol, 0);
  const q = { inputMint: 'A', outputMint: 'B', inAmount: '100', outAmount: '5000', otherAmountThreshold: '4900', priceImpactPct: '0.004' };
  assert.equal(checkQuote(q, { inputMint: 'A', outputMint: 'B', amountRaw: 100 }).ok, true);
  assert.ok(checkQuote({ ...q, priceImpactPct: '0.05' }, { inputMint: 'A', outputMint: 'B', amountRaw: 100 }).reasons.includes('Price impact too high'));
  assert.equal(checkQuote(q, { inputMint: 'A', outputMint: 'B', amountRaw: 101 }).ok, false); assert.equal(checkQuote(null, { inputMint: 'A', outputMint: 'B', amountRaw: 1 }).ok, false);
  assert.throws(() => validateRisk({ riskPerTradePct: 50 })); assert.throws(() => validateRisk({ slippageBps: 5000 })); assert.equal(Object.isFrozen(defaultRisk), true);
});

test('Young coins: same rules on one-minute bars, widest stop, half size, and only when the dial allows', async () => {
  const { YOUNG_SIZE, YOUNG_HOURS, defaultSettings } = await import('../lib/strategy.mjs'), { resolveRules, describe } = await import('../lib/presets.mjs'), { isYoung } = await import('../lib/scan.mjs');
  const up = rising(); up[up.length - 1] = bar(up.length - 1, up.at(-2).close * 1.012, { volume: 5000 });
  const normal = analyze(up, { minConfluence: 3 }), young = analyze(up, { minConfluence: 3 }, { young: true });
  assert.equal(normal.young, false); assert.equal(normal.tf, 5); assert.equal(normal.sizeFactor, 1);
  assert.equal(young.young, true); assert.equal(young.tf, 1); assert.equal(young.sizeFactor, YOUNG_SIZE); assert.equal(YOUNG_SIZE, 0.5);
  assert.equal(young.stopPct, defaultSettings.maxStopPct, 'a young coin gets the widest stop the rules allow'); assert.ok(young.stopPct >= normal.stopPct);
  assert.equal(young.score, normal.score, 'the four signal groups are judged the same way'); assert.deepEqual(young.confirmations, normal.confirmations);
  assert.match(analyze(rising(40), {}, { young: true }).reasons[0], /an hour of trading/); assert.equal(analyze(rising(40), {}, { young: true }).decision, 'wait');
  assert.equal(analyze(falling(), {}, { young: true }).decision, 'wait', 'a falling young coin is still a wait');
  // The time limit is the same clock time: a one-minute position gets five times the bars.
  const base = rising(100), entry = base.at(-1).close, position = { entry, stop: entry * 0.5, target: entry * 3, entryBar: base[5].t, peak: entry };
  assert.equal(manage(position, base, { maxHoldBars: 50 }).reason, 'time'); assert.notEqual(manage({ ...position, tf: 1 }, base, { maxHoldBars: 50 }).reason, 'time');
  // The dial: on in Balanced and Spicy with a one-hour age floor, off in Chill with two hours.
  const chill = resolveRules({ preset: 'chill' }), balanced = resolveRules({ preset: 'balanced' }), spicy = resolveRules({ preset: 'spicy' });
  assert.deepEqual([chill.settings.youngCoins, balanced.settings.youngCoins, spicy.settings.youngCoins], [0, 1, 1]); assert.deepEqual([chill.risk.minAgeHours, balanced.risk.minAgeHours, spicy.risk.minAgeHours], [2, 1, 1]);
  assert.match(describe(chill), /under five hours old are left alone/); assert.match(describe(balanced), /half size with the widest stop/);
  const now = 1e12; assert.equal(isYoung({ createdAt: now - 2 * 3_600_000 }, now), true); assert.equal(isYoung({ createdAt: now - (YOUNG_HOURS + 1) * 3_600_000 }, now), false); assert.equal(isYoung({ createdAt: null }, now), false, 'unknown age is not treated as young');
});

test('Small wallets take the smallest trade when the extra risk is modest, and are told why when it is not', async () => {
  const { SMALL_WALLET_RISK_LIMIT } = await import('../lib/risk.mjs'), w = (o) => positionSize({ balanceSol: 0.1, equitySol: 0.1, stopPct: 5, openPositions: 0, dayPnlSol: 0, ...o });
  assert.equal(w({}).sol, 0.025); assert.equal(w({}).raised, false, 'a tight stop fits the rules as they are');
  const wide = w({ stopPct: 12 }); assert.equal(wide.sol, 0.02); assert.equal(wide.raised, true); assert.ok(Math.abs(wide.riskPct - 2.4) < 1e-9, 'it says what the stop-out would cost');
  const young = w({ stopPct: 12, sizeFactor: 0.5 }); assert.equal(young.sol, 0.02); assert.equal(young.raised, true); assert.ok(Math.abs(young.riskPct - 2.4) < 1e-9);
  assert.ok(young.riskPct <= defaultRisk.riskPerTradePct * SMALL_WALLET_RISK_LIMIT);
  // Smaller still: the smallest trade would risk too much, so it is refused with the real reason.
  const tiny = positionSize({ balanceSol: 0.07, equitySol: 0.07, stopPct: 12, openPositions: 0, dayPnlSol: 0 }); assert.equal(tiny.sol, 0); assert.match(tiny.reasons[0], /the smallest trade \(0\.02 SOL\) is more than 25% of it/);
  const risky = positionSize({ balanceSol: 0.09, equitySol: 0.09, stopPct: 15, openPositions: 0, dayPnlSol: 0 }, { maxPositionPct: 30 }); assert.equal(risky.sol, 0); assert.match(risky.reasons[0], /would risk 3\.3% of it, and your rules allow 2%/);
  assert.match(positionSize({ balanceSol: 0.04, equitySol: 0.5, stopPct: 5, openPositions: 0, dayPnlSol: 0 }).reasons[0], /after the fee reserve/);
  // A wallet big enough never gets raised, and a young coin there is still half size.
  const big = positionSize({ balanceSol: 1, equitySol: 1, stopPct: 12, openPositions: 0, dayPnlSol: 0, sizeFactor: 0.5 }); assert.equal(big.raised, false); assert.ok(Math.abs(big.sol - 0.083333) < 1e-6);
  assert.equal(w({ stopPct: 12, openPositions: 3 }).sol, 0, 'the other limits still come first');
});

test('Changing the rules moves an open position\'s stop and target, without undoing protection already earned', async () => {
  const { rebasePosition } = await import('../lib/strategy.mjs'), near = (a, b) => Math.abs(a - b) < 1e-9;
  const young = { entry: 1, stop: 0.85, target: 1.2, tf: 1 };
  let r = rebasePosition(young, { targetPct: 100, maxStopPct: 15 }); assert.ok(near(r.target, 2)); assert.ok(near(r.stop, 0.85)); assert.equal(r.targetPct, 100);
  r = rebasePosition(young, { targetPct: 10, maxStopPct: 12 }); assert.ok(near(r.target, 1.1)); assert.ok(near(r.stop, 0.88), 'a young coin takes the new widest stop');
  const normal = { entry: 1, stop: 0.95, target: 1.1, tf: 5 };
  r = rebasePosition(normal, { targetPct: 25 }); assert.ok(near(r.target, 1.25)); assert.ok(near(r.stop, 0.95), 'its own 5% stop is inside the limits, so it stays');
  r = rebasePosition(normal, { minStopPct: 8, maxStopPct: 12 }); assert.ok(near(r.stop, 0.92), 'pulled out to the new tightest stop');
  r = rebasePosition({ ...normal, stop: 0.86 }, { maxStopPct: 8 }); assert.ok(near(r.stop, 0.92), 'pulled in to the new widest stop');
  // A stop that has trailed up to break-even or better is kept, whatever the new rules say; the target still moves.
  r = rebasePosition({ entry: 1, stop: 1.04, target: 1.2, tf: 1, baseStop: 0.85 }, { targetPct: 50, maxStopPct: 30 }); assert.equal(r.stop, 1.04); assert.equal(r.trailed, true); assert.ok(near(r.target, 1.5)); assert.ok(near(r.baseStop, 0.7));
  // The original distance is remembered, so going wide and back again returns to where it started.
  const wide = rebasePosition(normal, { minStopPct: 8, maxStopPct: 12 }), back = rebasePosition({ ...normal, stop: wide.stop, baseStop: 0.95 }, {}); assert.ok(near(back.stop, 0.95));
  assert.equal(rebasePosition({ entry: NaN, stop: 1 }, {}), null); assert.equal(rebasePosition(null, {}), null);
});

test('Exits on the dial: trailing stop start and distance, trend-break and time limit can each be changed or switched off', async () => {
  const { resolveRules, exits } = await import('../lib/presets.mjs');
  const base = rising(80), entry = base.at(-1).close, position = { entry, stop: entry * 0.85, baseStop: entry * 0.85, target: entry * 2, entryBar: base.at(-1).t, tf: 1 };
  const next = (close, o) => [...base, bar(80, close, o)], at = (peak, low, settings = {}, extra = {}) => manage({ ...position, peak: entry * peak, ...extra }, next(entry * (low + 0.01), { high: entry * (low + 0.015), low: entry * low, open: entry * (low + 0.012) }), settings);
  // Default: starts after one stop distance (15%), follows 1.5 distances (22.5% of the entry) under the peak, never below entry.
  assert.equal(at(1.10, 1.02).stop, position.stop, 'not far enough up yet'); assert.ok(Math.abs(at(1.20, 1.05).stop - entry * 1.015) < 1e-9, 'first step is break-even after costs');
  assert.ok(Math.abs(at(1.60, 1.45).stop - entry * 1.375) < 1e-9); assert.equal(at(1.60, 1.30).reason, 'trailing-stop');
  // The bug this replaced: with the stop already at break-even, the next look must NOT sell a trade that is still well up.
  const held = at(1.20, 1.10, {}, { stop: entry }); assert.equal(held.action, 'hold'); assert.ok(Math.abs(held.stop - entry * 1.015) < 1e-9);
  assert.equal(at(1.20, 1.10, {}, { stop: entry, baseStop: undefined }).action, 'hold', 'older positions without a remembered first stop are safe too');
  // Your own numbers.
  assert.ok(Math.abs(at(1.20, 1.15, { trailStartPct: 50 }).stop - position.stop) < 1e-9, 'start moved out to +50%'); assert.ok(at(1.55, 1.40, { trailStartPct: 50 }).stop > entry);
  assert.ok(Math.abs(at(1.60, 1.50, { trailGapPct: 10 }).stop - entry * 1.44) < 1e-9, '10% under the highest price'); assert.equal(at(1.60, 1.40, { trailGapPct: 10 }).reason, 'trailing-stop');
  assert.ok(Math.abs(at(1.20, 1.05, { trailGapPct: 30 }).stop - entry * 1.015) < 1e-9, 'a wide gap still never puts the stop below entry plus costs');
  // Switched off: the stop never moves, so only the stop and the target can sell.
  const off = { trailing: 0, trendExit: 0, holdHours: 0 }; assert.equal(at(1.90, 1.20, off).action, 'hold'); assert.equal(at(1.90, 1.20, off).stop, position.stop);
  assert.equal(at(1.90, 0.84, off).reason, 'stop'); assert.equal(manage({ ...position, peak: entry }, next(entry * 2.01, { high: entry * 2.02 }), off).reason, 'target');
  // Time limit and trend-break switches.
  const old = { ...position, entryBar: base[2].t, tf: 5 }; assert.equal(manage(old, next(entry * 1.01), { holdHours: 1 }).reason, 'time'); assert.equal(manage(old, next(entry * 1.01), { holdHours: 0 }).action, 'hold'); assert.equal(manage(old, next(entry * 1.01), { holdHours: 24 }).action, 'hold');
  const down = [...falling(100)], fell = { entry: down.at(-1).close * 1.02, stop: down.at(-1).close * 0.5, target: down.at(-1).close * 3, entryBar: down.at(-1).t - 1, peak: down.at(-1).close * 1.02 };
  assert.equal(manage(fell, down).reason, 'trend-break'); assert.equal(manage(fell, down, { trendExit: 0 }).action, 'hold');
  // The dial accepts them, versions them and describes them; nonsense is refused.
  const { validateSettings } = await import('../lib/strategy.mjs'), r = validateSettings({ targetPct: 100, trailing: 0, trendExit: 0, holdHours: 0 }); assert.equal(r.timeLimit, 0);
  assert.match(exits(r), /trailing stop is off\. There is no time limit\. A broken trend does not sell/); assert.match(exits(validateSettings({ trailStartPct: 40, trailGapPct: 12, holdHours: 48 })), /after a gain of 40% and follows 12% under the highest price\. Positions are sold after 48 hours/);
  const { validateSettings: vs } = await import('../lib/strategy.mjs');
  assert.equal(vs({ holdHours: 48 }).maxHoldBars, 576); assert.equal(resolveRules({}).settings.maxHoldBars, 36, 'presets sell after 3 hours');
  for (const bad of [{ trailing: 2 }, { trailGapPct: 95 }, { holdHours: 1.5 }, { holdHours: 500 }, { trailStartPct: -5 }, { trailStartPct: 0.5 }]) assert.throws(() => vs(bad), JSON.stringify(bad));
});
