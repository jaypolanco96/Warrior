import test from 'node:test';
import assert from 'node:assert/strict';

test('buying on a dip: an RSI limit and a stretch limit, both off unless you set them', async () => {
  const { analyze, defaultSettings } = await import('../lib/strategy.mjs'), { resolveRules } = await import('../lib/presets.mjs');
  const bars = (closes) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 300_000, open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: i === closes.length - 1 ? 5000 : 1000 }; });
  const run = Array.from({ length: 120 }, (_, i) => 1 * 1.004 ** i).concat(Array.from({ length: 6 }, (_, i) => 1.004 ** 119 * 1.02 ** (i + 1)));
  const free = analyze(bars(run), { minConfluence: 1 }), held = analyze(bars(run), { minConfluence: 1, maxStretchPct: 2 }), cool = analyze(bars(run), { minConfluence: 1, maxEntryRsi: 55 });
  assert.ok(free.stretchPct > 2, 'the last candles ran well above the average'); assert.ok(!free.reasons.some((r) => /Stretched/.test(r)), 'no stretch limit by default');
  assert.ok(held.reasons.some((r) => /Stretched: .* waiting for a dip/.test(r))); assert.equal(held.decision, 'wait');
  assert.ok(cool.reasons.some((r) => /above your limit of 55/.test(r)));
  assert.equal(defaultSettings.maxEntryRsi, 78); assert.equal(defaultSettings.maxStretchPct, 0);
  assert.equal(resolveRules({ preset: 'balanced' }).version, 'balanced-f70eb3', 'the Balanced preset\'s version');
  assert.equal(resolveRules({ preset: 'balanced' }).settings.maxEntryRsi, 50); assert.equal(resolveRules({ preset: 'balanced' }).settings.maxStretchPct, 1);
  const { validateSettings } = await import('../lib/strategy.mjs');
  for (const bad of [{ maxEntryRsi: 30 }, { maxEntryRsi: 95 }, { maxStretchPct: 0.2 }, { maxStretchPct: 40 }]) assert.throws(() => validateSettings(bad), JSON.stringify(bad));
});

test('deep dips: on by default, never sold by the trend exit, and off when switched off', async () => {
  const { analyze, manage } = await import('../lib/strategy.mjs'), { resolveRules, TUNABLE } = await import('../lib/presets.mjs');
  const bars = (closes) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 300_000, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 1000 }; });
  const fallen = bars(Array.from({ length: 100 }, (_, i) => (i < 80 ? 1 : 0.985 ** (i - 79))));
  const a = analyze(fallen, {}); assert.equal(a.decision, 'enter'); assert.equal(a.style, 'dip'); assert.ok(a.rsi <= 35 && a.stretchPct <= -8, `${a.rsi} ${a.stretchPct}`);
  assert.equal(analyze(fallen, { dipBelowPct: 30 }).decision, 'wait', 'not deep enough for a stricter dip rule');
  const p = { entry: a.price, stop: a.stop, baseStop: a.stop, target: a.target, entryBar: fallen.at(-1).t, peak: a.price };
  const more = [...fallen, { t: fallen.at(-1).t + 300_000, open: a.price, high: a.price * 1.01, low: a.price * 0.995, close: a.price * 1.005, volume: 1000 }];
  assert.equal(manage(p, more).reason, 'trend-break', 'a trend buy in this spot would be sold');
  assert.equal(manage({ ...p, dip: 1 }, more).action, 'hold', 'a dip buy is not');
  assert.equal(TUNABLE.deepDip.kind, 'switch'); assert.equal(TUNABLE.stepPct.kind, 'optional');
  for (const p of ['chill', 'balanced', 'spicy']) assert.equal(resolveRules({ preset: p }).settings.deepDip, 1, `${p} buys deep dips`);
  const { validateSettings } = await import('../lib/strategy.mjs'); assert.throws(() => validateSettings({ dipRsi: 60 }));
});

test('smart wallets: two buying turn a wait into a buy, never on stale prices or a spike, and off when switched off', async () => {
  const { analyze, smartEntry, manage } = await import('../lib/strategy.mjs'), { TUNABLE } = await import('../lib/presets.mjs');
  const bars = (closes) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 300_000, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 1000 }; });
  const flat = bars(Array.from({ length: 100 }, (_, i) => 1 + 0.002 * Math.sin(i))), a = analyze(flat, {});
  assert.equal(a.decision, 'wait');
  assert.equal(smartEntry(a, 1, {}).decision, 'wait', 'one wallet is not enough by default');
  const s = smartEntry(a, 2, {}); assert.equal(s.decision, 'enter'); assert.equal(s.style, 'smart'); assert.equal(s.smartCount, 2); assert.ok(s.stopPct >= 8); assert.match(s.smartNote, /2 smart wallets/);
  assert.equal(smartEntry(a, 1, { smartMin: 1 }).decision, 'enter');
  assert.equal(smartEntry(a, 5, { smartWallets: 0 }).decision, 'wait');
  assert.equal(smartEntry({ ...a, reasons: ['Candles are stale'] }, 3, {}).decision, 'wait');
  assert.equal(smartEntry({ ...a, reasons: ['Overbought: chasing a spike'] }, 3, {}).decision, 'wait');
  assert.equal(smartEntry({ decision: 'wait', reasons: ['Candles unavailable'], confirmations: null }, 3, {}).decision, 'wait');
  const p = { entry: s.price, stop: s.stop, baseStop: s.stop, target: s.target, entryBar: flat.at(-1).t, peak: s.price, style: 'smart' };
  const fall = [...bars(Array.from({ length: 100 }, (_, i) => 1.2 - i * 0.002))]; fall.push({ ...fall.at(-1), t: fall.at(-1).t + 300_000 });
  assert.notEqual(manage({ ...p, entry: fall.at(-1).close, stop: fall.at(-1).close * 0.5, target: 9 }, fall).reason, 'trend-break', 'a smart-wallet buy is not sold by the trend exit');
  assert.equal(TUNABLE.smartLive.kind, 'switch');
  const { defaultSettings } = await import('../lib/strategy.mjs'); assert.equal(defaultSettings.smartLive, 0, 'real funds stay off until switched on');
});

test('prices from before the buy never sell a position (October 14 overnight: CRAWLER, SI276, HeeHaw)', async () => {
  const { manage } = await import('../lib/strategy.mjs');
  // CRAWLER: bought at 11:27:38 for 0.001058, inside the 11:25 candle whose high (0.001133, +7%) came before the buy
  const before = Array.from({ length: 70 }, (_, i) => ({ t: Date.UTC(2026, 9, 14, 5, 35) + i * 300_000, open: 0.00106, high: 0.00107, low: 0.00105, close: 0.00106, volume: 1 }));
  const c = { t: Date.UTC(2026, 9, 14, 11, 25), open: 0.001063, high: 0.001133, low: 0.001035, close: 0.001058, volume: 1 }, bars = [...before, c];
  const p = { entry: 0.001058, stop: 0.001058 * 0.93, baseStop: 0.001058 * 0.93, target: 0.001058 * 1.1, entryBar: c.t, peak: 0.001058, openedAt: Date.UTC(2026, 9, 14, 11, 27, 38) };
  const s = { trailing: 1, trailStartPct: 7, trailGapPct: 2, trendExit: 0 };
  assert.equal(manage(p, bars, s).action, 'hold', 'the +7% high came before the buy: no trailing stop');
  assert.equal(manage({ ...p, openedAt: undefined }, bars, s).reason, 'trailing-stop', 'without the buy time it is the old behaviour');
  // SI276: the candle's low from before the buy sits under a 2.5% stop
  const q = { ...p, stop: 0.001058 * 0.975, baseStop: 0.001058 * 0.975 }, low = [...before, { ...c, high: 0.00107, low: 0.00102 }];
  assert.equal(manage(q, low, s).action, 'hold');
  // the next candle, entirely after the buy, counts in full
  assert.equal(manage(q, [...low, { t: c.t + 300_000, open: 0.001058, high: 0.00106, low: 0.00102, close: 0.00104, volume: 1 }], s).reason, 'stop');
});

test('a trailing stop never sells at a loss after costs, and never sells at once from a small start', async () => {
  const { manage, TRAIL_COSTS } = await import('../lib/strategy.mjs');
  const flat = Array.from({ length: 70 }, (_, i) => ({ t: i * 300_000, open: 1, high: 1.001, low: 0.999, close: 1, volume: 1 }));
  const p = { entry: 1, stop: 0.95, baseStop: 0.95, target: 2, entryBar: 0, peak: 1.04, openedAt: 0 }, s = { trailing: 1, trailStartPct: 3, trailGapPct: 0, trendExit: 0 };
  const m = manage(p, [...flat, { t: 70 * 300_000, open: 1.03, high: 1.035, low: 1.02, close: 1.025, volume: 1 }], s);
  assert.equal(m.action, 'hold'); assert.ok(m.stop >= 1 + TRAIL_COSTS - 1e-9, `floor ${m.stop} covers costs`);
  assert.equal(manage(p, [...flat, { t: 70 * 300_000, open: 1.02, high: 1.02, low: 1.012, close: 1.013, volume: 1 }], s).reason, 'trailing-stop', 'sold while still above costs');
  const small = manage({ ...p, peak: 1.012 }, [...flat, { t: 70 * 300_000, open: 1.011, high: 1.012, low: 1.009, close: 1.01, volume: 1 }], { ...s, trailStartPct: 1 });
  assert.equal(small.action, 'hold', 'a 1% start does not set a floor above the price');
});

test('the priority fee is a small share of a small trade, never above the level chosen', async () => {
  const { priorityCap } = await import('../lib/jupiter.mjs'), SOL = 'So11111111111111111111111111111111111111112', COIN = 'X'.repeat(43);
  const buy = (sol) => ({ inputMint: SOL, outputMint: COIN, inAmount: String(sol * 1e9), outAmount: '123' }), sell = (sol) => ({ inputMint: COIN, outputMint: SOL, inAmount: '123', outAmount: String(sol * 1e9) });
  assert.equal(priorityCap(1_000_000, buy(0.028)), 84_000, 'DOPE-sized buy: 0.3%, not 0.001 SOL');
  assert.equal(priorityCap(1_000_000, sell(0.028)), 140_000, 'a sell may pay a little more');
  assert.equal(priorityCap(1_000_000, buy(0.002)), 30_000, 'never below the floor that still lands');
  assert.equal(priorityCap(200_000, buy(5)), 200_000, 'never above the level chosen');
  assert.equal(priorityCap(0, buy(1)), 0, 'off stays off');
});

test('deep dips skip coins collapsing over the day, and a coin is dip-bought at most once every six hours', async () => {
  const { defaultSettings, DIP_REPEAT_HOURS } = await import('../lib/strategy.mjs'), { resolveRules, TUNABLE } = await import('../lib/presets.mjs');
  assert.equal(defaultSettings.dipDayDropPct, 20); assert.equal(DIP_REPEAT_HOURS, 6); assert.equal(TUNABLE.dipDayDropPct.kind, 'optional');
  assert.equal(resolveRules({ preset: 'balanced' }).settings.dipDayDropPct, 10, 'presets skip coins down 10% in a day');
  const { validateSettings } = await import('../lib/strategy.mjs'); assert.throws(() => validateSettings({ dipDayDropPct: 2 }));
  const src = (await import('node:fs')).readFileSync(new URL('../public/js/trader.js', import.meta.url), 'utf8');
  assert.match(src, /p\.dip === 1 \? p\.openedAt \+ DIP_REPEAT_HOURS \* 3_600_000/, 'the trader waits six hours from a dip buy before buying the same coin again');
  const scan = (await import('node:fs')).readFileSync(new URL('../lib/scan.mjs', import.meta.url), 'utf8');
  assert.match(scan, /a collapse, not a dip/);
});

test('a deep dip has its own 12% stop, above the widest stop for trend buys, and keeps it when the rules change', async () => {
  const { analyze, rebasePosition } = await import('../lib/strategy.mjs');
  const bars = (closes) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 300_000, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 1000 }; });
  const fallen = bars(Array.from({ length: 100 }, (_, i) => (i < 80 ? 1 : 0.985 ** (i - 79))));
  const a = analyze(fallen, { maxStopPct: 10 }); assert.equal(a.style, 'dip'); assert.equal(a.stopPct, 12); assert.ok(Math.abs(a.stop / a.price - 0.88) < 1e-9);
  assert.equal(analyze(fallen, { dipStopPct: 15 }).stopPct, 15);
  const p = { entry: 1, stop: 0.88, baseStop: 0.88, target: 1.1, dip: 1 };
  assert.ok(Math.abs(rebasePosition(p, { maxStopPct: 10 }).stop - 0.88) < 1e-9, 'not squeezed to the trend buys\' 10%');
  assert.ok(Math.abs(rebasePosition({ ...p, dip: undefined }, { maxStopPct: 10 }).stop - 0.9) < 1e-9, 'a trend buy still is');
});

test('only active coins: a quiet hour, or one with gaps in trading, is never bought', async () => {
  const { analyze } = await import('../lib/strategy.mjs'), { resolveRules } = await import('../lib/presets.mjs');
  const bars = (closes, vol) => closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: i * 300_000, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: vol(i) }; });
  const fall = Array.from({ length: 100 }, (_, i) => (i < 80 ? 1 : 0.985 ** (i - 79)));
  const busy = analyze(bars(fall, () => 5000), { minVol1hUsd: 20000 }); assert.equal(busy.decision, 'enter', 'a busy dip is bought');
  const thin = analyze(bars(fall, () => 1000), { minVol1hUsd: 20000 }); assert.equal(thin.decision, 'wait'); assert.equal(thin.quiet, true); assert.match(thin.reasons[0], /Too quiet: \$12,000 traded/);
  const gaps = analyze(bars(fall, (i) => (i > 92 && i < 97 ? 0 : 9000)), { minVol1hUsd: 20000 }); assert.equal(gaps.decision, 'wait', 'EXFIL: no trades for a stretch');
  assert.deepEqual(['chill', 'balanced', 'spicy'].map((p) => resolveRules({ preset: p }).settings.minVol1hUsd), [50000, 20000, 20000]);
});
