// Mood guard and bedtime rules. Both protect people from their own worst moment, and both can always be declined.
// Design rules, checked by tests: no countdown the user cannot skip, no shaming words, no reward for trading more,
// and the "go ahead" answer is always offered.

const HOUR = 3_600_000;
export const BREATHER_MINUTES = 10;

/**
 * Should Warrior offer a breather before this buy? Returns null (no) or { kind, message }.
 * trades: closed trades in the SAME money (practice or real), each { mint, pnlSol, solIn, closedAt }.
 * proposed: { mint, sol } for the buy about to happen. Only your own manual actions are checked, never Warrior's.
 */
export function moodCheck({ trades = [], proposed = {}, now = Date.now() } = {}) {
  const recent = trades.filter((t) => Number.isFinite(t.closedAt) && now - t.closedAt <= HOUR && now >= t.closedAt), losses = recent.filter((t) => t.pnlSol < 0);
  const sameCoin = losses.find((t) => t.mint && t.mint === proposed.mint && now - t.closedAt <= 15 * 60_000);
  if (sameCoin) return { kind: 'revenge', message: `You closed this coin at a loss ${((m) => `${m} minute${m === 1 ? '' : 's'}`)(Math.max(1, Math.round((now - sameCoin.closedAt) / 60_000)))} ago. Going straight back in is the most common way a small loss becomes a big one.` };
  if (losses.length >= 2) return { kind: 'streak', message: `That is ${losses.length} losing trades in the last hour. The market will still be here in ${BREATHER_MINUTES} minutes.` };
  const today = trades.filter((t) => Number.isFinite(t.closedAt) && now - t.closedAt <= 24 * HOUR), dayPnl = today.reduce((n, t) => n + t.pnlSol, 0), sizes = today.map((t) => t.solIn).filter((n) => Number.isFinite(n) && n > 0);
  if (dayPnl < 0 && sizes.length >= 2 && Number.isFinite(proposed.sol)) { const usual = sizes.reduce((a, b) => a + b, 0) / sizes.length; if (proposed.sol > usual * 1.5) return { kind: 'size', message: `You are down today, and this buy is ${(proposed.sol / usual).toFixed(1)} times your usual size. Betting bigger to win it back is how a bad day gets worse.` }; }
  return null;
}
/** The words on the two buttons. Equal weight: neither is the "wrong" one. */
export const MOOD_CHOICES = Object.freeze({ rest: `Take a ${BREATHER_MINUTES}-minute breather`, go: 'Go ahead' });

const parse = (hhmm) => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const within = (t, from, to) => from === to ? false : from < to ? t >= from && t < to : t >= from || t < to; // windows may cross midnight
/** Check bedtime settings: { on, stopAt, closeAt, wakeAt } as 'HH:MM' in the user's own clock. closeAt may be '' for "do not close". */
export function validateBedtime(b) {
  const reasons = []; if (!b || typeof b !== 'object') return { ok: false, reasons: ['No bedtime rule'] };
  const stop = parse(b.stopAt), wake = parse(b.wakeAt), close = b.closeAt ? parse(b.closeAt) : null;
  if (stop === null) reasons.push('Choose when to stop opening trades'); if (wake === null) reasons.push('Choose when trading may start again');
  if (b.closeAt && close === null) reasons.push('The close-everything time is not a time');
  if (stop !== null && wake !== null && stop === wake) reasons.push('Stop and start cannot be the same time');
  if (stop !== null && wake !== null && close !== null && close !== stop && !within(close, stop, wake)) reasons.push('Close-everything has to fall between the stop time and the morning start');
  return { ok: reasons.length === 0, reasons };
}
const clock = (hhmm) => { const m = parse(hhmm); if (m === null) return hhmm; const h = Math.floor(m / 60), mm = m % 60, twelve = h % 12 === 0 ? 12 : h % 12; return `${twelve}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
/** What the rule says right now. `minutesNow` is minutes since local midnight. */
export function bedtimeState(b, minutesNow) {
  if (!b?.on || !validateBedtime(b).ok) return { asleep: false, canOpen: true, mustClose: false };
  const stop = parse(b.stopAt), wake = parse(b.wakeAt), close = b.closeAt ? parse(b.closeAt) : null, asleep = within(minutesNow, stop, wake);
  return { asleep, canOpen: !asleep, mustClose: asleep && close !== null && within(minutesNow, close, wake), wakeAt: clock(b.wakeAt) };
}
/** The rule in plain words. */
export function bedtimeText(b) {
  if (!b?.on) return 'No bedtime rule. Warrior may open trades at any hour.';
  if (!validateBedtime(b).ok) return 'The bedtime rule is not complete yet.';
  return `Stop opening trades at ${clock(b.stopAt)}${b.closeAt ? `, close everything by ${clock(b.closeAt)}` : ', keep open positions overnight'}, and start again at ${clock(b.wakeAt)}.`;
}
