// The impi: six agents with one job each, run in order every minute. A coin is bought only when the scout found it busy,
// the shield passed it, the spear saw the tested setup and the commander had room and budget. Positions are watched every
// 30 seconds. The rules come from the chosen strength (Chill, Balanced, Spicy), tested on real Solana prices.
import { resolveRules, toQuery } from '/vendor/lib/presets.js';
import { state, save, api, emit, on, lock, dials, problem, notify } from './store.js';
import { claimTrading, releaseTrading, holdWhile } from './sync.js';
import { buy, watch, balance, heldSol, live, sellable, sell } from './trader.js';
import { bedtimeState } from '/vendor/lib/mood.js';
import { vault, holdWalletWhile } from './wallet.js';
import { fire } from './net.js';
import { shadowRound } from './shadow.js';
import { weatherFactor, weather } from './watch.js';

export const AGENTS = [
  { id: 'inhloli', name: 'Inhloli', glyph: '👁', role: 'scout', job: 'Watches Solana meme and ecosystem coins; keeps only the busy ones.' },
  { id: 'isihlangu', name: 'Isihlangu', glyph: '🛡', role: 'shield', job: 'Refuses rugs: freeze or mint powers, thin pools, bundled-buy farms, staged launches.' },
  { id: 'umkhonto', name: 'Umkhonto', glyph: '⚔', role: 'spear', job: 'Strikes only on the tested deep dip: RSI 35 or less, 8–10% under the average, on a busy coin.' },
  { id: 'izinyoni', name: 'Izinyoni', glyph: '🐦', role: 'smart money', job: 'Watches wallets with a record of buying before pumps.' },
  { id: 'induna', name: 'Induna', glyph: '👑', role: 'commander', job: 'Sizes every trade, caps how many are open, stops for the day after a loss limit, banks profit in steps.' },
  { id: 'umlobi', name: 'Umlobi', glyph: '✎', role: 'scribe', job: 'Writes down every decision and every result, costs included.' }
];
export const rules = () => resolveRules({ preset: state.preset, adapt: dials() });
const heard = {};
let running = false, starting = false, timer = 0, watcher = 0, last = null, nextAt = 0, rounds = 0, ms = 0, shadowAt = 0;
holdWalletWhile(() => live() && (running || starting));
export const impi = { get running() { return running; }, get starting() { return starting; }, get lastScan() { return last; }, get nextAt() { return nextAt; }, get rounds() { return rounds; }, get scanMs() { return ms; } };
const say = (who, text, tone) => emit('say', { who, text, tone });
on('say', ({ who }) => fire(who));

// The day's starting equity, kept per mode: practice and live money are never mixed.
function rollDay(equity) { const d = new Date().toISOString().slice(0, 10), k = state.mode; state.days ??= {}; if (state.days[k]?.day !== d || !Number.isFinite(state.days[k]?.start)) state.days[k] = { day: d, start: equity }; return state.days[k].start; }

async function round() {
  if (lock.busy) return; lock.busy = true; nextAt = Date.now() + 60_000; rounds++;
  try {
    const R = rules(), open = state.positions.filter((p) => p.mode === state.mode);
    // 1. the scout
    const t0 = performance.now(), scan = await api(`/api/scan?${toQuery({ preset: state.preset, adapt: dials() })}&mature=1`); ms = performance.now() - t0; last = scan; emit('scan', scan);
    if (scan.sourcesFailed > 0) problem('sources', `${scan.sourcesFailed} of ${scan.sources} coin lists did not answer this round, so fewer coins were watched. Warrior keeps going with the rest.`, 30 * 60_000);
    const read = scan.results ?? [], quiet = read.filter((t) => t.analysis?.quiet).length;
    say('inhloli', `${scan.universe} coins watched; ${read.length} read closely${quiet ? `, ${quiet} too quiet to trade` : ''}.`);
    // 2. the shield
    say('isihlangu', `${scan.rejected} refused at the screen (pool, volume, age, safety). ${scan.passedScreen} passed.`);
    // 3. smart money
    const birds = read.filter((t) => (t.smart?.count ?? 0) > 0);
    if (birds.length) say('izinyoni', `Smart wallets buying: ${birds.map((t) => `${t.symbol} (${t.smart.count})`).join(', ')}.`);
    // 4. the spear
    // dip weather: every coin that meets the deep-dip reading this round, whether or not it is bought
    for (const t of read) { const a = t.analysis; if (Number.isFinite(a?.stretchPct) && a.stretchPct <= -R.settings.dipBelowPct && Number.isFinite(a.rsi) && a.rsi <= R.settings.dipRsi && Number.isFinite(t.priceUsd ?? a.price)) emit('dip-seen', { mint: t.mint, symbol: t.symbol, price: t.priceUsd ?? a.price }); }
    const owned = new Set(open.map((p) => p.mint));
    for (const t of read.filter((x) => x.analysis?.decision === 'enter' && !owned.has(x.mint) && (state.cooldown[x.mint] ?? 0) > Date.now())) {
      if ((heard[t.mint] ?? 0) > Date.now()) continue; heard[t.mint] = Date.now() + 15 * 60_000;
      const until = new Date(state.cooldown[t.mint]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), lost = state.trades.findLast?.((x) => x.mint === t.mint && !x.partial);
      emit('indaba-case', { symbol: t.symbol, facts: [t.analysis.dipNote ?? 'signals agree'] });
      emit('indaba-line', { who: 'umkhonto', text: `${t.analysis.dipNote ?? 'The signals agree'}. The rule says strike.`, tone: 'yes', chip: 'STRIKE' });
      emit('indaba-line', { who: 'induna', text: `${lost && lost.pnlSol < 0 ? `Sold at a loss recently: the rule is ${+(rules().risk.lossCooldownMinutes / 60).toFixed(1)} hours after a loss` : 'Bought or sold recently: the coin is resting'}. NOT NOW. Free again at ${until}.`, tone: 'wait', chip: 'WAIT', verdict: true });
    }
    const picks = read.filter((t) => t.analysis?.decision === 'enter' && !owned.has(t.mint) && !((state.cooldown[t.mint] ?? 0) > Date.now()) && !(t.analysis.style === 'smart' && live()));
    if (!picks.length) roundTalk(scan, read, R);
    say('umkhonto', picks.length ? `Strike: ${picks.map((t) => `${t.symbol} (${t.analysis.dipNote ?? t.analysis.smartNote ?? 'signals agree'})`).join('; ')}.` : 'No coin is in the strike zone. Waiting is a position too.');
    // bedtime: close everything at the time you chose, if you chose one
    await bedtimeClose();
    // 5. the commander
    const bal = await balance(), equity = bal + heldSol(), start = rollDay(equity);
    const down = start > 0 ? (start - equity) / start * 100 : 0;
    if (down >= R.risk.dailyLossLimitPct) notify('daily', 'Warrior: daily loss limit reached', `Down ${down.toFixed(1)}% today. No new trades until tomorrow; open positions are still watched.`, 12 * 3_600_000);
    if (down >= R.risk.dailyLossLimitPct) say('induna', `Down ${down.toFixed(1)}% today: the ${R.risk.dailyLossLimitPct}% limit is reached. No new trades until tomorrow.`, 'down');
    else if (sellable().length >= R.risk.maxOpenPositions) say('induna', `Holding ${sellable().length}, the most ${state.preset} allows.`);
    else if (!bed().canOpen) { if (Date.now() - bedSaid > 3_600_000) { bedSaid = Date.now(); say('induna', `Bedtime rule: no new trades until ${bed().wakeAt}. Open positions are still watched.`); } }
    else if (picks.length && weatherFactor() === 0) { const w = weather(); say('induna', `Severe storm: only ${w.up} of ${w.n} deep dips bounced in the last 6 hours. The weather guard holds new buys.`, 'down'); emit('indaba-line', { who: 'induna', text: `SEVERE STORM. ${w.up} of ${w.n} deep dips bounced in 6 hours. The weather guard holds new buys.`, tone: 'wait', chip: 'WAIT', verdict: true }); }
    else for (const t of picks) { if (weatherFactor() < 1) t.analysis = { ...t.analysis, sizeFactor: (t.analysis.sizeFactor ?? 1) * weatherFactor() }; if (sellable().length >= R.risk.maxOpenPositions || !running) break; try { await buy(t, R); } catch (e) { say('induna', `${t.symbol}: buy failed (${e.message}). Nothing spent.`, 'down'); } }
    // 6. the scribe
    const eq = (await balance()) + heldSol(); state.equity.push({ t: Date.now(), v: eq, mode: state.mode }); save(); emit('equity');
    say('umlobi', `Equity ${eq.toFixed(4)} SOL${live() ? '' : ' (practice)'}.`);
  } catch (e) { say('inhloli', `This round could not run (${e.message}). Trying again in a minute; nothing was traded.`, 'down'); }
  finally { lock.busy = false; }
  // The side-by-side scorecard scans the other strengths too. Every minute that was three market scans per round,
  // which burned the hosting allowance while the impi was out. Ten minutes still keeps the comparison current.
  if (running && Date.now() - shadowAt >= 10 * 60_000) { shadowAt = Date.now(); void shadowRound(Object.keys(dials()).length ? {} : { [state.preset]: last }).catch(() => {}); }
}
/** A round with no coin to buy is still decided out loud in the indaba: what was seen, refused, and the nearest misses. */
function roundTalk(scan, read, R) {
  const s = R.settings, line = (who, text, tone = 'wait', chip, verdict = false) => emit('indaba-line', { who, text, tone, chip, verdict });
  const near = read.filter((t) => Number.isFinite(t.analysis?.stretchPct) && t.analysis.stretchPct < 0).sort((a, b) => a.analysis.stretchPct - b.analysis.stretchPct).slice(0, 2);
  emit('indaba-case', { symbol: `ROUND ${rounds}`, facts: [`${scan.universe} watched`, `${scan.passedScreen} passed the shield`, `${read.length} read closely`, `${state.preset}`] });
  line('inhloli', `${scan.universe} coins on the lists. ${read.length} read closely: the busiest and the ones dropping.`);
  line('isihlangu', `${scan.rejected} refused at the screen (pool size, trading, age, locked pool money). ${scan.passedScreen} passed.`, 'yes', 'SCREEN');
  for (const t of near) { const a = t.analysis, deep = Math.abs(a.stretchPct) >= s.dipBelowPct, low = Number.isFinite(a.rsi) && a.rsi <= s.dipRsi;
    emit('missed', { mint: t.mint, symbol: t.symbol, price: t.priceUsd ?? a.price, rule: deep && low ? 'collapse' : !deep ? 'depth' : 'rsi', gap: s.dipBelowPct - Math.abs(a.stretchPct) });
    line('umkhonto', `Closest: ${t.symbol}, ${Math.abs(a.stretchPct).toFixed(1)}% under its average (needs ${s.dipBelowPct}%), RSI ${Number.isFinite(a.rsi) ? a.rsi.toFixed(0) : '?'} (needs ${s.dipRsi} or lower). ${deep && low ? (a.reasons?.[0] ?? 'Another rule says no') + '.' : `Not ${!deep && !low ? 'deep or oversold' : !deep ? 'deep' : 'oversold'} enough yet.`}`, 'wait', 'MISS'); }
  if (!near.length) line('umkhonto', 'No coin read closely is under its average right now.', 'wait', 'MISS');
  emit('indaba-line', { who: 'induna', text: 'NOTHING TO STRIKE. Waiting is a position too. Next round in a minute.', tone: 'wait', chip: 'WAIT', verdict: true, count: false });
}
async function guard() { if (lock.busy) return; lock.busy = true; try { await watch(rules()); emit('positions'); } catch (e) { problem('guard', `Open positions could not be checked (${e.message}). Trying again in 30 seconds; their stops are still checked against the live price.`); } finally { lock.busy = false; } }

// Another device's copy of the positions never replaces this one in the middle of a trade.
holdWhile(() => !lock.busy && !starting);
// Bedtime (from Laugh, off unless you set it): no new buys between the hours you choose; optionally close everything.
let bedSaid = 0;
const bed = () => { const d = new Date(); return bedtimeState(state.bedtime ?? { on: false }, d.getHours() * 60 + d.getMinutes()); };
async function bedtimeClose() { if (!running || !bed().mustClose) return; const open = sellable(); if (!open.length) return; say('induna', `Bedtime rule: closing ${open.length} position${open.length === 1 ? '' : 's'} for the night.`); for (const p of open) { try { await sell(p, 'bedtime'); } catch { /* tried again next round */ } } }
// One tab at a time (from Laugh): two Warrior tabs in one browser count as one device, so the device lease alone cannot
// stop both from trading. A browser lock can: the second tab is told the impi is already out elsewhere.
let releaseTab = null, wake = null;
async function claimTab() {
  if (!navigator.locks) return true;
  return new Promise((resolve) => { navigator.locks.request('warrior-impi', { ifAvailable: true }, (lock) => { if (!lock) { resolve(false); return; } resolve(true); return new Promise((done) => { releaseTab = done; }); }); });
}
// Keep the screen awake while the impi is out (from Laugh): a sleeping screen lets the browser slow the page, and the
// 15-second stop checks with it. Asked again when you come back to the tab, since the browser drops it when hidden.
async function keepAwake() { try { if (running && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock?.request('screen'); wake?.addEventListener?.('release', () => { wake = null; }); } } catch { wake = null; } }
document.addEventListener('visibilitychange', () => void keepAwake());
export async function start() {
  if (running || starting) return null;
  if (lock.busy) return 'Wait for the current action to finish before sending the impi.';
  starting = true;
  try {
    if (live()) { if (!vault.exists) return 'Make the trading wallet first.'; if (!vault.unlocked) return 'Unlock the trading wallet first.'; if (!state.backedUp) return 'Save the backup key first.'; }
    if (!(await claimTab())) return 'The impi is already out in another Warrior tab in this browser. Call it back there first, or use that tab.';
    const held = await claimTrading(); if (held) return held; // one device trades at a time
    running = true; state.streakFrom = Date.now(); save(); say('induna', `The impi is out: ${state.preset}, ${live() ? 'LIVE with real SOL' : 'practice money'}.`); void round();
    timer = setInterval(round, 60_000); watcher = setInterval(guard, 30_000); void keepAwake(); emit('running'); return null;
  } catch (e) { return `The impi could not start (${e.message}). Try again.`; }
  finally { starting = false; if (!running) { releaseTab?.(); releaseTab = null; } }
}
// Pause after a losing streak: the chosen number of whole trades in a row lost since the impi was last sent out.
export function losingStreak() { let n = 0; for (const t of state.trades) { if (t.mode !== state.mode || t.partial || t.closedAt < (state.streakFrom ?? 0)) continue; n = t.pnlSol < 0 ? n + 1 : 0; } return n; }
on('trade', ({ side } = {}) => {
  const limit = state.pauseAfter ?? 4; if (!running || side !== 'sell' || !limit) return;
  const n = losingStreak(); if (n >= limit) { notify('pause', 'Warrior paused', `${n} losing trades in a row. Open positions keep their stops; send the impi out again when you are ready.`, 0); say('induna', `${n} losing trades in a row: the impi is pausing, as you asked. Open positions keep their stops. Look at the scorecard, then send it out again when you are ready.`, 'down'); stop(); }
});
export function stop() { running = false; nextAt = 0; clearInterval(timer); clearInterval(watcher); void releaseTrading(); releaseTab?.(); releaseTab = null; try { wake?.release(); } catch { /* already gone */ } wake = null; say('induna', 'The impi is resting. Open positions are still yours; start again to keep watching them.'); emit('running'); }
on('vault-locked', () => { if (live() && running) { stop(); say('induna', 'The trading wallet is locked. Live trading is paused; unlock it and send the impi again to watch your positions.', 'down'); } });
/** A look without trading, so the dashboard is alive before the impi is sent. */
export async function peek() { try { const t0 = performance.now(), scan = await api(`/api/scan?${toQuery({ preset: state.preset, adapt: dials() })}&mature=1`); ms = performance.now() - t0; last = scan; emit('scan', scan); } catch { /* shown next time */ } }
