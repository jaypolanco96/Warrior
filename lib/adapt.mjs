// Self-ruling decisions, as pure functions: the page (public/js/adapt.js) and the walk-forward test (tests/) both use
// these, so what is tested is what runs. Which dials may move, and their ranges, live in presets.mjs (ADAPT).
import { ADAPT } from './presets.mjs';

const H = 3_600_000;
const avg = (l, f) => l.length ? l.reduce((a, x) => a + f(x), 0) / l.length : 0;
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
export const PROBATION_TRADES = 8, BASELINE_TRADES = 10, MIN_GAP_MS = 24 * H, REST_MS = 72 * H;

/**
 * What the evidence says: moves { key, from, to, why, strength }, strongest first.
 * positions: closed positions [{ mint, openedAt, closedAt, pct, reason, peakPct, depthPct }]
 * after:     by exit reason { n, max, end } (the price after a sale: the high and the price 3 hours later, in %)
 * missed:    by refusal rule { list: [{ gap, result }] } (coins refused or narrowly missed, and how they would have done)
 * value(key): the dial's current value.
 */
export function evidence({ positions: P = [], after = {}, missed = {}, value }) {
  const out = [];
  const step = (k, dir) => { const t = ADAPT[k], to = value(k) + dir * t.step; return to >= t.min && to <= t.max ? to : null; };
  const push = (key, dir, why, strength) => { const to = step(key, dir); if (to !== null) out.push({ key, from: value(key), to, why, strength }); };
  // the clock
  const clock = P.filter((p) => p.reason === 'time'), ac = after.time;
  if (clock.length >= 8 && avg(clock, (p) => p.pct) <= -2 && ac?.n >= 5 && ac.end <= 0) push('holdHours', -1, `${clock.length} positions sold by the ${value('holdHours')}-hour clock averaged ${pct(avg(clock, (p) => p.pct))}, and those coins kept falling after (${pct(ac.end)} 3 h later). Sell sooner.`, 2);
  if (ac?.n >= 6 && ac.end >= 3 && ac.max >= 8) push('holdHours', 1, `Coins sold by the clock went on to ${pct(ac.max)} at their high and ${pct(ac.end)} 3 h later (${ac.n} sales). Hold an hour longer.`, 2);
  // the target
  const at = after.target, tgt = value('targetPct'), hits = P.filter((p) => p.reason === 'target').length, close = P.filter((p) => Number.isFinite(p.peakPct) && p.peakPct >= tgt - 8 && p.peakPct < tgt);
  // No 'aim higher' rule (walk-forward, October 16): coins that kept rising after the target are mostly the winners,
  // and a higher target also loses the coins that peak just under it. It raised Chill's target and cost a third of its
  // profit. Only the lower-the-target rule remains, on misses that peaked just under the target.
  if (false && at?.n >= 5 && at.max >= 15 && at.end >= 5) push('targetPct', 1, `After hitting the +${tgt}% target, coins kept rising: ${pct(at.max)} at their high, ${pct(at.end)} 3 h later (${at.n} sales). Aim higher.`, 1);
  if (P.length >= 20 && hits <= 1 && close.length >= 5) push('targetPct', -1, `Only ${hits} of ${P.length} positions reached +${tgt}%, while ${close.length} peaked within 8 points of it and turned back. Aim a little lower.`, 1);
  // re-buying after a loss
  const wait = value('lossCooldownMinutes'), rebuys = P.filter((p) => P.some((q) => q.mint === p.mint && q.pct < 0 && q.closedAt < p.openedAt && p.openedAt - q.closedAt < 12 * H));
  const relost = rebuys.filter((p) => p.pct < 0).length;
  if (rebuys.length >= 5 && relost / rebuys.length >= 0.7) push('lossCooldownMinutes', 1, `${relost} of ${rebuys.length} re-buys of a coin that had just lost lost again. Wait ${(wait + 120) / 60} h instead of ${wait / 60} h.`, 3);
  // how deep a dip
  const below = value('dipBelowPct'), known = P.filter((p) => Number.isFinite(p.depthPct)), shallow = known.filter((p) => -p.depthPct < below + 2), deep = known.filter((p) => -p.depthPct >= below + 2);
  // Stricter than the other rules (walk-forward, October 16): with 8 trades and a 3-point gap it fired on shuffled results
  // 2-5% of days, and moving the line also cuts the number of trades, so the gap has to be large and well sampled.
  if (shallow.length >= 12 && deep.length >= 8 && avg(shallow, (p) => p.pct) <= -2 && avg(deep, (p) => p.pct) >= avg(shallow, (p) => p.pct) + 5) push('dipBelowPct', 1, `Dips bought just past the ${below}% line averaged ${pct(avg(shallow, (p) => p.pct))} (${shallow.length}); deeper ones averaged ${pct(avg(deep, (p) => p.pct))} (${deep.length}). Wait for deeper dips.`, 2);
  const nearMiss = (missed.depth?.list ?? []).filter((x) => Number.isFinite(x.gap) && x.gap <= 2);
  if (nearMiss.length >= 10 && avg(nearMiss, (x) => x.result) >= 3) push('dipBelowPct', -1, `${nearMiss.length} coins that missed the ${below}% line by 2 points or less would have averaged ${pct(avg(nearMiss, (x) => x.result))} after costs. Accept slightly shallower dips.`, 1);
  return out.sort((a, b) => b.strength - a.strength);
}

const days = (l) => Math.max(1, (l.at(-1).closedAt - l[0].openedAt) / (24 * H));
/** The baseline a move is judged against: the average of the last trades before it (null with fewer than 5). */
export function baselineOf(positions) { const before = positions.slice(-BASELINE_TRADES); return before.length >= 5 ? avg(before, (p) => p.pct) : null; }
/** The same trades as profit per day (the sum of their results over the days they covered). */
export function perDayOf(positions) { const before = positions.slice(-BASELINE_TRADES); return before.length >= 5 ? before.reduce((a, p) => a + p.pct, 0) / days(before) : null; }

/** Probation: once enough trades closed after the move, 'revert' when they did worse, 'keep' otherwise; null while waiting. */
export function judge({ positions, probation }) {
  const after = positions.filter((p) => p.openedAt >= probation.at); if (after.length < PROBATION_TRADES) return null;
  // Worse per trade, or (when the move cut how often it trades) less profit per day than before.
  const now = avg(after, (p) => p.pct), perDay = after.reduce((a, p) => a + p.pct, 0) / days(after);
  const worse = probation.base === null ? now < -3 : now < probation.base - 1.5 || (Number.isFinite(probation.perDay) && probation.perDay > 0 && perDay < probation.perDay * 0.5);
  return { verdict: worse ? 'revert' : 'keep', now, perDay, n: after.length };
}
