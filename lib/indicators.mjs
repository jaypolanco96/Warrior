// Technical indicators over completed candles: { t, open, high, low, close, volume }, oldest first.
// Pure functions. Nothing here fetches, trades or signs.

export function validCandles(candles, min = 1) {
  if (!Array.isArray(candles) || candles.length < min) return false;
  let last = -Infinity;
  for (const c of candles) {
    if (!c || ![c.t, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) return false;
    if (c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.volume < 0 || c.t <= last) return false;
    last = c.t;
  }
  return true;
}

/** Exponential moving average series, seeded with the first value. */
export function emaSeries(values, period) {
  const k = 2 / (period + 1), out = [];
  let e = values[0];
  for (const v of values) { e = v * k + e * (1 - k); out.push(e); }
  return out;
}
export const ema = (values, period) => emaSeries(values, period).at(-1);

/** Wilder RSI of the last `period` changes. 50 when flat. */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Average true range over the last `period` bars (simple average of true ranges). */
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  return sum / period;
}

/** MACD histogram now and one bar ago (12, 26, 9). */
export function macd(closes) {
  if (closes.length < 35) return null;
  const fast = emaSeries(closes, 12), slow = emaSeries(closes, 26), line = fast.map((v, i) => v - slow[i]), signal = emaSeries(line, 9);
  return { hist: line.at(-1) - signal.at(-1), prevHist: line.at(-2) - signal.at(-2), line: line.at(-1) };
}

/** Volume-weighted average price over the last `bars`. Null when there was no volume. */
export function vwap(candles, bars = 48) {
  const window = candles.slice(-bars);
  let pv = 0, v = 0;
  for (const c of window) { pv += (c.high + c.low + c.close) / 3 * c.volume; v += c.volume; }
  return v > 0 ? pv / v : null;
}

/** Combine candles into larger ones (for example twelve 5-minute bars into one hour). Leading leftovers are dropped. */
export function aggregate(candles, size) {
  const out = [], start = candles.length % size;
  for (let i = start; i + size <= candles.length; i += size) {
    const g = candles.slice(i, i + size);
    out.push({ t: g[0].t, open: g[0].open, high: Math.max(...g.map((c) => c.high)), low: Math.min(...g.map((c) => c.low)), close: g.at(-1).close, volume: g.reduce((n, c) => n + c.volume, 0) });
  }
  return out;
}

/**
 * SuperTrend: a line that sits under the price in an uptrend and over it in a downtrend, set from the average true
 * range. Returns { up, line, flippedAgo } for the last candle (`flippedAgo` = candles since the trend last changed side),
 * or null when there are too few candles to work it out. The usual settings are 10 candles and a multiplier of 3.
 */
export function superTrend(candles, period = 10, multiplier = 3) {
  if (!Array.isArray(candles) || candles.length < period + 1 || !(period >= 2) || !(multiplier > 0)) return null;
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  if (tr.some((v) => !Number.isFinite(v))) return null;
  let atr = tr.slice(1, period + 1).reduce((n, v) => n + v, 0) / period, upper = null, lower = null, up = true, flippedAgo = 0;
  for (let i = period; i < candles.length; i++) {
    if (i > period) atr = (atr * (period - 1) + tr[i]) / period; // Wilder's smoothing
    const mid = (candles[i].high + candles[i].low) / 2, basicUpper = mid + multiplier * atr, basicLower = mid - multiplier * atr, prevClose = candles[i - 1].close;
    upper = upper === null || basicUpper < upper || prevClose > upper ? basicUpper : upper;
    lower = lower === null || basicLower > lower || prevClose < lower ? basicLower : lower;
    const was = up; if (i === period) up = candles[i].close >= mid; else if (up && candles[i].close < lower) up = false; else if (!up && candles[i].close > upper) up = true;
    flippedAgo = i === period || up !== was ? 0 : flippedAgo + 1;
  }
  return { up, line: up ? lower : upper, flippedAgo };
}
/**
 * Is a coin being bought into a dip? For a brand-new coin read on one-minute candles. Returns { ok, known, reason, ... }.
 * With eight or more candles it uses SuperTrend(7, 3): the trend must be up. With fewer, SuperTrend cannot be worked
 * out, so it uses what little there is: the last candle must not be a hard fall, and the price must not have dropped
 * far from its recent high, the last candle must not be red, and the live price must not be falling inside the current
 * minute. With under three candles nothing can be said (`known: false`).
 */
export function dipCheck(candles, livePrice = null) {
  const c = Array.isArray(candles) ? candles.filter((x) => x && [x.open, x.high, x.low, x.close].every(Number.isFinite)) : [];
  if (c.length < 3) return { ok: true, known: false, reason: null, candles: c.length };
  const last = c.at(-1), now = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : last.close, high = Math.max(...c.slice(-10).map((x) => x.high)), offHigh = (1 - now / high) * 100, lastMove = (last.close / last.open - 1) * 100, st = c.length >= 8 ? superTrend(c, 7, 3) : null;
  const facts = { known: true, candles: c.length, superTrendUp: st ? st.up : null, offHighPct: offHigh, lastCandlePct: lastMove };
  if (st && (!st.up || now < st.line)) return { ok: false, reason: 'SuperTrend is down on the one-minute chart: it is falling, not running', ...facts };
  if (offHigh >= 25) return { ok: false, reason: `It is ${Math.round(offHigh)}% below its high of the last few minutes: it is dipping`, ...facts };
  if (lastMove <= -12) return { ok: false, reason: `Its last one-minute candle fell ${Math.abs(Math.round(lastMove))}%: it is dipping right now`, ...facts };
  // The live price against the last finished candle: a fall inside the current minute does not show on any candle yet.
  if (Number.isFinite(livePrice) && livePrice > 0 && livePrice <= last.close * 0.93) return { ok: false, reason: `It has fallen ${Math.round((1 - livePrice / last.close) * 100)}% inside the current minute: it is dipping right now`, ...facts };
  // Too young for SuperTrend (JAILFLOYD: five minutes old, up 300%, then one red candle, then down 45% in the next minute).
  // With so little to read, the run has to be still going: a red last candle after a climb is the run stalling.
  if (!st && lastMove < 0) return { ok: false, reason: 'Its last one-minute candle was red: the run has stalled, and it is too young for SuperTrend to say more', ...facts };
  return { ok: true, reason: null, ...facts };
}
