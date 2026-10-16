// Warrior's saved state (this browser) and a tiny event bus. Everything here is practice data or public addresses:
// the trading wallet's key is kept separately, locked by a passphrase (wallet.js).
// This key is the one synced between your devices (encrypted; see sync.js). The older key is moved over once.
const KEY = 'warrior.auto.state.v1', OLD = 'warrior.state.v1';
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

const blank = () => ({ mode: 'paper', preset: 'balanced', paperSol: 1, positions: [], trades: [], equity: [], cooldown: {}, day: '', dayStart: null, log: [], orders: [] });
export let state = blank();
try { const s = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD) ?? 'null'); if (s && Array.isArray(s.positions)) state = { ...blank(), ...s }; } catch { /* a fresh start */ }
/** Another device's copy arrived: take it in place, so every module keeps the same state object. */
export function reload() { try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s && Array.isArray(s.positions)) { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, blank(), s); } } catch { /* keep what is here */ } }
/** One trading action at a time across the impi, the order engine and your own buttons. */
export const lock = { busy: false };
export async function exclusive(fn) { if (lock.busy) throw new Error('Warrior is in the middle of another trade. Try again in a few seconds'); lock.busy = true; try { return await fn(); } finally { lock.busy = false; } }
export function save() {
  try { localStorage.removeItem(OLD); localStorage.setItem(KEY, JSON.stringify({ ...state, trades: state.trades.slice(-500), equity: state.equity.slice(-2000), log: state.log.slice(-200) })); } catch { /* storage full or blocked: keep going in memory */ }
}
export const SOL = 'So11111111111111111111111111111111111111112';
export async function api(path, init) {
  const r = await fetch(path, init); let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`); return j;
}
export const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
