import { validCandles, ema, rsi, atr, macd, vwap, aggregate, superTrend } from './indicators.mjs';

// Warrior's decision engine. It reads completed candles and says ENTER, WAIT or (for an open position) EXIT, with reasons.
// It is deterministic: the same candles and settings always give the same answer. It predicts nothing and promises nothing.

export const defaultSettings = Object.freeze({
  minConfluence: 3,        // how many of the four signal groups must agree (1-4)
  stopAtr: 1.5,            // stop distance in ATRs
  minStopPct: 3,           // never tighter than this
  maxStopPct: 12,          // never looser than this
  targetPct: 10,           // take profit
  maxHoldBars: 72,         // 6 hours of 5-minute bars
  chaosAtrPct: 6,          // a bar range this large (ATR as % of price) is treated as untradeable chaos
  youngCoins: 1,           // 1: also judge and trade coins with one to five hours of history, on one-minute bars; 0: wait for five hours
  // How a position may be sold, besides its stop and its target.
  trailing: 1,             // 1: once a trade is far enough up, move the stop up behind the price; 0: never move it
  trailStartPct: 0,        // gain at which trailing starts. 0 = the trade's own stop distance
  trailGapPct: 0,          // how far under the highest price the stop follows. 0 = one and a half stop distances
  trendExit: 1,            // 1: sell when the trend that justified the trade breaks; 0: ignore it
  holdHours: 6,            // sell after this many hours; 0 = no time limit
  // When to buy. Measured October 14, 2026 on 797 replayed ENTER calls: buying only on a dip (near the 20-candle average,
  // RSI cooled) lost a little less per trade but reached targets less often and more slowly; buying stretched coins hit
  // targets faster and lost more at the stops. Neither turned the signal profitable after costs. Both are left to you.
  maxEntryRsi: 78,         // no entry when RSI is above this (78 = only a spike is refused)
  maxStretchPct: 0,        // no entry when the price is more than this far above its 20-candle average; 0 = no limit
  // Deep dips. Measured October 14, 2026 on 30,661 replayed 5-minute moments of 39 regular coins (stop -8%, 2% costs):
  // buying at any moment lost about 2.3% a trade; buying when RSI was 35 or under AND the price was 8% or more under its
  // 20-candle average won 54% of the time and came out slightly ahead (+0.1% at a 10% target, +0.4% at 20%). Those coins
  // are in a downtrend by definition, so a dip buy skips the trend, momentum, SuperTrend, hourly-bias and chaos refusals.
  // The safety screen and cost limits still apply. A small edge on three and a half days of data, not a promise.
  deepDip: 1,              // 1: also buy deep dips; 0: only the usual trend buys
  dipRsi: 35,              // a deep dip: RSI at or under this
  dipBelowPct: 8,          // and the price at least this far under its 20-candle average
  // October 14, 2026, replaying 217 deep dips on 24 coins with the day's exits: as they were, -0.37% a trade. Leaving out
  // coins down over 20% in 24 hours (a collapse, not a dip) and a second dip buy on the same coin within 6 hours: +1.71%.
  dipDayDropPct: 20,       // no deep dip on a coin down more than this in 24 hours; 0 = no limit
  // A dip swings before it recovers. Same replay, with those two rules: stop 6% -1.85% a trade, 8% +0.80%, 10% +1.23%,
  // 12% +2.37%, 15% +3.29%. A wider stop also means a smaller position (size is set so the stop loses the same share).
  dipStopPct: 12,          // a deep-dip buy's stop, whatever the widest stop for trend buys
  // Active coins only (October 15, 2026, the owner: EXFIL had not traded for 15 minutes when Warrior bought it). Over the
  // last hour of candles: trades in at least 10 of the twelve 5-minute candles, and at least this much traded. Replayed on
  // five 3.5-day stretches, $20K turned the stretch the dials had never seen from -1.83% to +0.45% a trade; $50K to +3.59%.
  minVol1hUsd: 0,          // 0 = no minimum
  // Smart wallets (lib/smart.mjs): buy when this many wallets with a record of buying before pumps buy the same coin.
  smartWallets: 1,         // 1: buy when smart wallets buy; 0: ignore them
  smartMin: 2,             // how many different smart wallets must buy within 15 minutes
  smartLive: 0             // 1: also with real funds; 0: practice only, until it has a record
});
/** A coin is "young" until its pool has this many hours of trading. Young coins are read on one-minute candles. */
export const YOUNG_HOURS = 5;
/** What a buy and a sell cost together, about: fees, price impact and slippage on a regular coin. */
export const TRAIL_COSTS = 0.015;
/** After a deep-dip buy, the same coin is not dip-bought again for this long (see dipDayDropPct). */
export const DIP_REPEAT_HOURS = 6;
/** Young coins swing harder and have less history, so they are traded at this share of the usual size. */
export const YOUNG_SIZE = 0.5;

export function validateSettings(s) {
  const n = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const out = { takeOutAtPct: 0, stepPct: 0, dipAddPct: 0, ...defaultSettings, ...s };
  // Automatic part-exits and one dip add. 0 = off.
  if (!(out.takeOutAtPct === 0 || n(out.takeOutAtPct, 5, 1000)) || !(out.stepPct === 0 || n(out.stepPct, 2, 500)) || !(out.dipAddPct === 0 || n(out.dipAddPct, 3, 50))) throw new Error('Invalid automatic part-exit settings');
  if (![1, 2, 3, 4].includes(out.minConfluence)) throw new Error('minConfluence must be 1 to 4');
  if (!n(out.stopAtr, 0.5, 5) || !n(out.minStopPct, 1, 30) || !n(out.maxStopPct, out.minStopPct, 40)) throw new Error('Invalid stop settings');
  if (!n(out.targetPct, 1, 500)) throw new Error('targetPct must be 1 to 500');
  if (!Number.isInteger(out.maxHoldBars) || out.maxHoldBars < 1 || out.maxHoldBars > 2000) throw new Error('maxHoldBars must be 1 to 2000');
  if (!n(out.chaosAtrPct, 1, 50)) throw new Error('Invalid chaos threshold');
  if (![0, 1].includes(out.youngCoins)) throw new Error('youngCoins must be 0 or 1');
  if (![0, 1].includes(out.trailing) || ![0, 1].includes(out.trendExit)) throw new Error('Exit switches must be 0 or 1');
  if (![0, 1].includes(out.smartWallets) || ![0, 1].includes(out.smartLive) || !Number.isInteger(out.smartMin) || out.smartMin < 1 || out.smartMin > 5) throw new Error('Invalid smart wallet settings');
  if (![0, 1].includes(out.deepDip) || !n(out.dipRsi, 15, 50) || !n(out.dipBelowPct, 3, 40) || !(out.dipDayDropPct === 0 || n(out.dipDayDropPct, 5, 90)) || !n(out.dipStopPct, 5, 30) || !n(out.minVol1hUsd, 0, 1e9)) throw new Error('Invalid deep dip settings');
  if (!n(out.maxEntryRsi, 40, 90) || !(out.maxStretchPct === 0 || n(out.maxStretchPct, 0.5, 30))) throw new Error('Invalid entry settings');
  if (!(out.trailStartPct === 0 || n(out.trailStartPct, 1, 500)) || !(out.trailGapPct === 0 || n(out.trailGapPct, 1, 90))) throw new Error('Invalid trailing stop settings');
  if (!Number.isInteger(out.holdHours) || out.holdHours < 0 || out.holdHours > 168) throw new Error('holdHours must be 0 to 168');
  // The time limit is given in hours on the dial. When it is given, it sets the bar count; 0 switches the limit off.
  if (s && s.holdHours !== undefined) out.maxHoldBars = Math.max(1, out.holdHours * 12);
  out.timeLimit = out.holdHours === 0 ? 0 : 1;
  return Object.freeze(out);
}

const st0 = (candles) => { const st = superTrend(candles, 10, 3); return st ? (st.up ? 'up' : 'down') : null; };

/** Market regime from the short and long averages and from volatility. */
export function regime(candles) {
  const closes = candles.map((c) => c.close), last = closes.at(-1), e20 = ema(closes, 20), e50 = ema(closes, 50), a = atr(candles, 14);
  const atrPct = a === null ? null : a / last * 100;
  return { e20, e50, atrPct, spreadPct: (e20 - e50) / e50 * 100 };
}
export function regimeLabel(r, chaosAtrPct) {
  if (r.atrPct === null) return 'unknown';
  if (r.atrPct > chaosAtrPct) return 'chaos';
  if (r.spreadPct > 0.5) return 'uptrend';
  if (r.spreadPct < -0.5) return 'downtrend';
  return 'range';
}

/** Higher-timeframe bias: the direction of the averages one step up (hourly from 5-minute bars, 15-minute from 1-minute bars). */
export function bias(candles, group = 12) {
  const hourly = aggregate(candles, group);
  if (hourly.length < 8) return 'neutral';
  const closes = hourly.map((c) => c.close), fast = ema(closes, 4), slow = ema(closes, 8);
  if (fast > slow * 1.003 && closes.at(-1) > fast) return 'bullish';
  if (fast < slow * 0.997 && closes.at(-1) < fast) return 'bearish';
  return 'neutral';
}

/**
 * Analyze completed 5-minute candles. Needs at least 60.
 * Four independent groups: trend, momentum, participation (volume), structure (breakout or pullback).
 * Correlated indicators sit inside one group so they cannot be counted twice.
 * With `young`, the candles are one-minute bars of a coin under five hours old: same rules, the widest stop the rules
 * allow (young coins swing hard), and half the usual size.
 */
export function analyze(candles, settingsInput = {}, { young = false } = {}) {
  const s = validateSettings(settingsInput);
  if (!validCandles(candles, 60)) return { decision: 'wait', score: 0, reasons: [young ? 'Need at least an hour of trading (60 clean one-minute candles)' : 'Need at least 60 clean completed candles'], confirmations: null, young, tf: young ? 1 : 5 };
  const closes = candles.map((c) => c.close), last = candles.at(-1), r = regime(candles), label = regimeLabel(r, s.chaosAtrPct), b = bias(candles, young ? 15 : 12);
  const rs = rsi(closes, 14), m = macd(closes), vw = vwap(candles, 48), a = atr(candles, 14);
  const volAvg = candles.slice(-21, -1).reduce((n, c) => n + c.volume, 0) / 20, volRatio = volAvg > 0 ? last.volume / volAvg : 0;
  const priorHigh = Math.max(...candles.slice(-21, -1).map((c) => c.high));
  const pullback = last.low <= r.e20 * 1.005 && last.close > r.e20 && last.close > last.open;
  const confirmations = {
    trend: last.close > r.e20 && r.e20 > r.e50,
    momentum: rs !== null && rs >= 50 && rs <= Math.min(78, s.maxEntryRsi) && m !== null && m.hist > 0 && m.hist >= m.prevHist,
    participation: volRatio >= 1.3 && vw !== null && last.close > vw,
    structure: last.close > priorHigh || pullback
  };
  const score = Object.values(confirmations).filter(Boolean).length, reasons = [];
  // Too quiet to trade: checked before any kind of buy, deep dips included.
  if (s.minVol1hUsd > 0) { const hour = candles.slice(young ? -60 : -12), traded = hour.filter((c) => c.volume > 0).length, usd = hour.reduce((n, c) => n + (c.volume || 0), 0), need = young ? 50 : 10;
    if (traded < need || usd < s.minVol1hUsd) return { decision: 'wait', score, confirmations, regime: label, bias: b, reasons: [`Too quiet: $${Math.round(usd).toLocaleString('en-US')} traded in the last hour${traded < need ? `, and nothing traded in ${hour.length - traded} of its ${young ? 'minutes' : 'five-minute candles'}` : ''} (needs $${s.minVol1hUsd.toLocaleString('en-US')} and steady trading)`], quiet: true, price: last.close, at: last.t, rsi: rs, young, tf: young ? 1 : 5, sizeFactor: young ? YOUNG_SIZE : 1 }; }
  const stretch = r.e20 > 0 ? (last.close / r.e20 - 1) * 100 : null;
  // A deep dip is its own kind of buy: it does not wait for a trend, because the coin has just fallen out of one.
  const dip = s.deepDip === 1 && rs !== null && rs <= s.dipRsi && stretch !== null && stretch <= -s.dipBelowPct && a !== null && a > 0;
  if (dip) {
    const stopPct = s.dipStopPct;
    return {
      decision: 'enter', style: 'dip', score, confirmations, regime: label, bias: b, reasons: [], superTrend: st0(candles),
      dipNote: `Deep dip: RSI ${rs.toFixed(0)}, ${Math.abs(stretch).toFixed(1)}% under its 20-candle average`,
      price: last.close, at: last.t, rsi: rs, stretchPct: stretch, atrPct: r.atrPct, volRatio, vwap: vw, ema20: r.e20, ema50: r.e50,
      stopPct, stop: last.close * (1 - stopPct / 100), target: last.close * (1 + s.targetPct / 100), targetPct: s.targetPct,
      young, tf: young ? 1 : 5, sizeFactor: young ? YOUNG_SIZE : 1
    };
  }
  if (label === 'chaos') reasons.push('Volatility too wild to size a stop');
  if (label === 'downtrend') reasons.push('Short-term downtrend');
  const st = superTrend(candles, 10, 3); if (st && !st.up) reasons.push('SuperTrend is down');
  if (b === 'bearish') reasons.push('Hourly bias is bearish');
  // Never buy what the trend exit would sell at the next look (with 2 of 4 groups, the trend group need not agree).
  if (s.trendExit === 1 && last.close < r.e50 && r.e20 < r.e50) reasons.push('Under its 50-candle average: the trend exit would sell it at once');
  if (rs !== null && rs > s.maxEntryRsi) reasons.push(s.maxEntryRsi >= 78 ? 'Overbought: chasing a spike' : `RSI is ${rs.toFixed(0)}, above your limit of ${s.maxEntryRsi}: waiting for it to cool`);
  if (s.maxStretchPct > 0 && stretch !== null && stretch > s.maxStretchPct) reasons.push(`Stretched: ${stretch.toFixed(1)}% above its 20-candle average; waiting for a dip`);
  if (score < s.minConfluence) reasons.push(`Only ${score} of 4 signal groups agree (need ${s.minConfluence})`);
  if (a === null || a <= 0) reasons.push('No measurable volatility');
  // One-minute swings understate how far a young coin moves, so its stop is the widest the rules allow. A wider stop
  // also means a smaller position, because size is set so that hitting the stop loses the same share of the wallet.
  const stopPct = young || !a ? s.maxStopPct : Math.min(s.maxStopPct, Math.max(s.minStopPct, a * s.stopAtr / last.close * 100));
  const enter = reasons.length === 0;
  return {
    decision: enter ? 'enter' : 'wait', style: 'trend', score, confirmations, regime: label, bias: b, reasons, superTrend: st ? (st.up ? 'up' : 'down') : null,
    price: last.close, at: last.t, rsi: rs, stretchPct: stretch, atrPct: r.atrPct, volRatio, vwap: vw, ema20: r.e20, ema50: r.e50,
    stopPct, stop: last.close * (1 - stopPct / 100), target: last.close * (1 + s.targetPct / 100), targetPct: s.targetPct,
    young, tf: young ? 1 : 5, sizeFactor: young ? YOUNG_SIZE : 1
  };
}

/**
 * Turn a reading into a smart-wallet buy: `count` different smart wallets bought this coin in the last 15 minutes.
 * Like a deep dip, it does not wait for a trend; the stop is at least 8%. Readings without usable candles stay a wait.
 * Returns the reading unchanged when the rule does not apply.
 */
export function smartEntry(analysis, count, settingsInput = {}) {
  const s = validateSettings(settingsInput);
  if (s.smartWallets !== 1 || !(count >= s.smartMin) || !analysis?.confirmations || !Number.isFinite(analysis.price) || analysis.decision === 'enter') return analysis;
  if ((analysis.reasons ?? []).some((r) => /stale|Overbought|Stretched|No measurable/i.test(r))) return analysis; // never on old prices or a spike
  const stopPct = Math.min(s.maxStopPct, Math.max(analysis.stopPct ?? 0, 8));
  return { ...analysis, decision: 'enter', style: 'smart', reasons: [], smartCount: count, smartNote: `${count} smart wallets bought in the last 15 minutes`, stopPct, stop: analysis.price * (1 - stopPct / 100), target: analysis.price * (1 + s.targetPct / 100), targetPct: s.targetPct };
}

/**
 * When the rules change while a position is open, its stop and target follow them.
 *   target: the entry price plus the new target percentage.
 *   stop:   a young coin gets the new widest stop; any other coin keeps the stop distance it was opened with, pulled
 *           inside the new tightest and widest stops. A stop that has already trailed up to the entry price or above
 *           is never moved back down: protection already earned is kept.
 * Your own stop and target (ownStop, ownTarget) are yours and are not touched. Returns null for an unusable position.
 */
export function rebasePosition(position, settingsInput = {}) {
  const s = validateSettings(settingsInput), entry = position?.entry;
  if (!(typeof entry === 'number' && Number.isFinite(entry) && entry > 0) || !Number.isFinite(position.stop)) return null;
  const trailed = position.stop >= entry, first = Number.isFinite(position.baseStop) ? position.baseStop : trailed ? null : position.stop;
  const was = first === null ? s.maxStopPct : (1 - first / entry) * 100;
  const widest = position.dip === 1 ? Math.max(s.maxStopPct, s.dipStopPct) : s.maxStopPct; // a dip buy keeps its own wider stop
  const stopPct = position.tf === 1 ? widest : Math.min(widest, Math.max(s.minStopPct, was)), baseStop = entry * (1 - stopPct / 100);
  return { target: entry * (1 + s.targetPct / 100), targetPct: s.targetPct, stop: trailed ? position.stop : baseStop, baseStop, stopPct, trailed };
}

/**
 * What to do with an open position. `position` = { entry, stop, target, entryBar (index time t), peak }.
 * Exits: stop, target, a trailing stop once the trade is up by its own risk, a time limit, or the trend breaking.
 */
export function manage(position, candles, settingsInput = {}) {
  const s = validateSettings(settingsInput);
  if (!validCandles(candles, 2)) return { action: 'hold', reasons: ['No fresh candles; holding and not guessing'], stale: true };
  // A candle that began before the buy has a high and a low from before Warrior owned the coin. Found October 14, 2026:
  // twelve overnight trades were sold at the first check, 1.5 minutes after buying, by a stop or even a trailing stop
  // set off by prices from before the buy. Such a candle counts only with its latest price.
  const last0 = candles.at(-1), opened = Number.isFinite(position.openedAt) ? position.openedAt : null;
  const last = opened !== null && last0.t < opened ? { ...last0, high: last0.close, low: last0.close } : last0;
  const entry = position.entry, peak = Math.max(position.peak ?? entry, last.high);
  // The trade's original stop distance. It is measured from the stop the trade was opened with, not from wherever the
  // stop has trailed to since: otherwise a stop that reached break-even would make the distance zero.
  const first = Number.isFinite(position.baseStop) ? position.baseStop : position.stop < entry ? position.stop : entry * (1 - s.maxStopPct / 100), distance = entry - first;
  // Trailing: once the price has been far enough above the entry, the stop follows under the highest price seen, and is
  // never put back below break-even. Both distances can be set on the dial; by default they come from the stop distance.
  let stop = position.stop;
  if (s.trailing === 1) {
    const start = s.trailStartPct > 0 ? entry * s.trailStartPct / 100 : distance, gap = s.trailGapPct > 0 ? peak * s.trailGapPct / 100 : distance * 1.5;
    // Its floor covers the round trip's costs, so a trailing stop does not sell at a loss (October 14: pill -3.9%, swordcat
    // -2.0% were trailing-stop sales). Never above just under the highest price, so a small start cannot sell at once.
    if (peak >= entry + start) stop = Math.max(stop, peak - gap, Math.min(entry * (1 + TRAIL_COSTS), peak * 0.99));
  }
  const bars = candles.filter((c) => c.t > position.entryBar).length, changePct = (last.close / entry - 1) * 100;
  if (last.low <= stop) return { action: 'exit', reason: stop >= entry ? 'trailing-stop' : 'stop', price: Math.min(last.open, stop), stop, peak, changePct };
  if (last.high >= position.target) return { action: 'exit', reason: 'target', price: position.target, stop, peak, changePct };
  // The time limit is the same clock time either way: a position read on one-minute bars gets five times the bars.
  if (s.timeLimit === 1 && bars >= s.maxHoldBars * (position.tf === 1 ? 5 : 1)) return { action: 'exit', reason: 'time', price: last.close, stop, peak, changePct };
  if (s.trendExit === 1 && position.dip !== 1 && position.style !== 'smart' && candles.length >= 60) { const r = regime(candles); if (last.close < r.e50 && r.e20 < r.e50) return { action: 'exit', reason: 'trend-break', price: last.close, stop, peak, changePct }; }
  return { action: 'hold', stop, peak, changePct, reasons: [] };
}
