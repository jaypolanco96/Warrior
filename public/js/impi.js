// The impi: six agents with one job each, run in order every minute. A coin is bought only when the scout found it busy,
// the shield passed it, the spear saw the tested setup and the commander had room and budget. Positions are watched every
// 30 seconds. The rules come from the chosen strength (Chill, Balanced, Spicy), tested on real Solana prices.
import { resolveRules, toQuery } from '/vendor/lib/presets.js';
import { state, save, api, emit, on } from './store.js';
import { buy, watch, balance, heldSol, live } from './trader.js';
import { vault } from './wallet.js';
import { fire } from './net.js';

export const AGENTS = [
  { id: 'inhloli', name: 'Inhloli', glyph: '👁', role: 'scout', job: 'Watches Solana meme and ecosystem coins; keeps only the busy ones.' },
  { id: 'isihlangu', name: 'Isihlangu', glyph: '🛡', role: 'shield', job: 'Refuses rugs: freeze or mint powers, thin pools, bundled-buy farms, staged launches.' },
  { id: 'umkhonto', name: 'Umkhonto', glyph: '⚔', role: 'spear', job: 'Strikes only on the tested deep dip: RSI 35 or less, 8–10% under the average, on a busy coin.' },
  { id: 'izinyoni', name: 'Izinyoni', glyph: '🐦', role: 'smart money', job: 'Watches wallets with a record of buying before pumps.' },
  { id: 'induna', name: 'Induna', glyph: '👑', role: 'commander', job: 'Sizes every trade, caps how many are open, stops for the day after a loss limit, banks profit in steps.' },
  { id: 'umlobi', name: 'Umlobi', glyph: '✎', role: 'scribe', job: 'Writes down every decision and every result, costs included.' }
];
export const rules = () => resolveRules({ preset: state.preset });
let running = false, timer = 0, watcher = 0, busy = false, last = null;
export const impi = { get running() { return running; }, get lastScan() { return last; } };
const say = (who, text, tone) => emit('say', { who, text, tone });
on('say', ({ who }) => fire(who));

function rollDay(equity) { const d = new Date().toISOString().slice(0, 10); if (state.day !== d || !Number.isFinite(state.dayStart)) { state.day = d; state.dayStart = equity; } }

async function round() {
  if (busy) return; busy = true;
  try {
    const R = rules(), open = state.positions.filter((p) => p.mode === state.mode);
    // 1. the scout
    const scan = await api(`/api/scan?${toQuery({ preset: state.preset })}`); last = scan; emit('scan', scan);
    const read = scan.results ?? [], quiet = read.filter((t) => t.analysis?.quiet).length;
    say('inhloli', `${scan.universe} coins watched; ${read.length} read closely${quiet ? `, ${quiet} too quiet to trade` : ''}.`);
    // 2. the shield
    say('isihlangu', `${scan.rejected} refused at the screen (pool, volume, age, safety). ${scan.passedScreen} passed.`);
    // 3. smart money
    const birds = read.filter((t) => (t.smart?.count ?? 0) > 0);
    if (birds.length) say('izinyoni', `Smart wallets buying: ${birds.map((t) => `${t.symbol} (${t.smart.count})`).join(', ')}.`);
    // 4. the spear
    const owned = new Set(open.map((p) => p.mint)), picks = read.filter((t) => t.analysis?.decision === 'enter' && !owned.has(t.mint) && !((state.cooldown[t.mint] ?? 0) > Date.now()) && !(t.analysis.style === 'smart' && live()));
    say('umkhonto', picks.length ? `Strike: ${picks.map((t) => `${t.symbol} (${t.analysis.dipNote ?? t.analysis.smartNote ?? 'signals agree'})`).join('; ')}.` : 'No coin is in the strike zone. Waiting is a position too.');
    // 5. the commander
    const bal = await balance(), equity = bal + heldSol(); rollDay(equity);
    const down = (state.dayStart - equity) / state.dayStart * 100;
    if (down >= R.risk.dailyLossLimitPct) say('induna', `Down ${down.toFixed(1)}% today: the ${R.risk.dailyLossLimitPct}% limit is reached. No new trades until tomorrow.`, 'down');
    else if (open.length >= R.risk.maxOpenPositions) say('induna', `Holding ${open.length}, the most ${state.preset} allows.`);
    else for (const t of picks) { if (state.positions.filter((p) => p.mode === state.mode).length >= R.risk.maxOpenPositions || !running) break; try { await buy(t, R); } catch (e) { say('induna', `${t.symbol}: buy failed (${e.message}). Nothing spent.`, 'down'); } }
    // 6. the scribe
    const eq = (await balance()) + heldSol(); state.equity.push({ t: Date.now(), v: eq, mode: state.mode }); save(); emit('equity');
    say('umlobi', `Equity ${eq.toFixed(4)} SOL${live() ? '' : ' (practice)'}.`);
  } catch (e) { say('inhloli', `This round could not run (${e.message}). Trying again in a minute; nothing was traded.`, 'down'); }
  finally { busy = false; }
}
async function guard() { if (busy) return; busy = true; try { await watch(rules()); emit('positions'); } catch { /* next time */ } finally { busy = false; } }

export function start() {
  if (running) return null;
  if (live()) { if (!vault.exists) return 'Make the trading wallet first.'; if (!vault.unlocked) return 'Unlock the trading wallet first.'; if (!state.backedUp) return 'Save the backup key first.'; }
  running = true; say('induna', `The impi is out: ${state.preset}, ${live() ? 'LIVE with real SOL' : 'practice money'}.`); void round();
  timer = setInterval(round, 60_000); watcher = setInterval(guard, 30_000); emit('running'); return null;
}
export function stop() { running = false; clearInterval(timer); clearInterval(watcher); say('induna', 'The impi is resting. Open positions are still yours; start again to keep watching them.'); emit('running'); }
/** A look without trading, so the dashboard is alive before the impi is sent. */
export async function peek() { try { const scan = await api(`/api/scan?${toQuery({ preset: state.preset })}`); last = scan; emit('scan', scan); } catch { /* shown next time */ } }
