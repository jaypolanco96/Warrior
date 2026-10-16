// Keeps your devices showing the same trading data. Everything is encrypted before it leaves this device (lib/sync.mjs).
// While the trading wallet is unlocked, every 15 seconds: fetch the other devices' copy, merge it with this one, and save
// back what changed. Only one device at a time may run the auto trader; it claims a three-minute lease and renews it.
import { vault } from './wallet.js';
import { on, emit } from './store.js';
import { SYNC_KEYS, TRADER_KEY, sealSnapshot, openSnapshot, mergeSnapshots, signedText, digestOf } from '/vendor/lib/sync.js';

const BASE = 'warrior.sync.base.v1', DEVICE = 'warrior.sync.device.v1', SENT = 'warrior.sync.sent.v1', $ = (id) => document.getElementById(id);
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } }, write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const device = read(DEVICE) ?? (() => { const d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); write(DEVICE, d); return d; })();
const deviceName = () => /iPhone|iPad/.test(navigator.userAgent) ? 'an iPhone or iPad' : /Android/.test(navigator.userAgent) ? 'an Android phone' : /Phantom/i.test(navigator.userAgent) ? 'the Phantom app' : 'a computer';
let base = (() => { try { const b = JSON.parse(read(BASE) ?? 'null'); return b && Number.isFinite(b.version) && b.address ? b : null; } catch { return null; } })();
let authority = false, busy = false, off = false, lastOk = 0, note = '', leaseUntil = 0;

const snapshot = () => Object.fromEntries(SYNC_KEYS.map((k) => [k, read(k)]).filter(([, v]) => typeof v === 'string'));
const same = (a, b) => SYNC_KEYS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
async function call(body) { const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; }
function show(text) { note = text; const el = $('sync-status'); if (el) el.textContent = text; }

async function sendRecord() {
  const id = vault.syncId, rec = vault.portable; if (!id || !rec || read(SENT) === `${id}:${rec.address}`) return;
  const ts = Date.now(), r = await call({ op: 'record', id, record: rec, ts, sig: vault.sign(signedText.record({ id, address: rec.address, ts })) });
  if (r.status === 200) write(SENT, `${id}:${rec.address}`);
}
async function push(address, snap, from) {
  const blob = await sealSnapshot(vault.syncKey, address, snap), ts = Date.now(), baseText = String(from);
  const r = await call({ op: 'put', address, base: baseText, blob, ts, sig: vault.sign(signedText.put({ address, base: baseText, digest: await digestOf(blob), ts })) });
  if (r.status === 200) { base = { address, version: r.version, snap }; write(BASE, JSON.stringify(base)); return true; }
  if (r.status === 409) return false; // someone else saved first: the next round merges their copy
  throw new Error(r.error ?? 'Sync failed');
}
/** One sync round. Safe to call any time; does nothing while the wallet is locked. */
let running = null, pending = false;
const holds = [];
/** `ok()` returns false while incoming trader data must wait (the auto trader is in the middle of a buy or sell). */
export const holdWhile = (ok) => holds.push(ok);
export async function syncNow() {
  if (off || !vault.unlocked || !vault.protected || !vault.syncKey) return;
  if (running) { pending = true; return running; } // asked during a round: run once more right after it
  running = (async () => {
    busy = true;
    try { do { pending = false; for (let attempt = 0; attempt < 3 && (await round()) === 'again'; attempt++); } while (pending); } // 'again': another device saved first, merge again
    catch (e) { show(`Sync paused (${e.message}). Everything is still saved on this device; it retries by itself.`); }
    finally { busy = false; running = null; }
  })();
  return running;
}
async function round() {
  {
    const address = vault.address; if (base && base.address !== address) base = null;
    await sendRecord();
    const r = await call({ op: 'get', address });
    if (r.status === 503 && r.setup) { off = true; show('Sync is off: the site\'s storage has not been added in Vercel yet. Everything is saved on this device.'); return 'done'; }
    if (r.status !== 200) throw new Error(r.error ?? 'Sync unavailable');
    let local = snapshot();
    if (r.version && r.version !== base?.version) {
      const remote = await openSnapshot(vault.syncKey, address, r.blob), { merged, take } = mergeSnapshots(base?.snap ?? {}, local, remote, { authority });
      // Never swap the trader's positions out from under a buy or sell in progress: try again next round.
      if (take.includes(TRADER_KEY) && holds.some((ok) => !ok())) return 'done';
      for (const k of take) write(k, merged[k]);
      base = { address, version: r.version, snap: remote }; write(BASE, JSON.stringify(base));
      // The trader's data first: other changes (new rules) can make the trader save, which must not save its old copy.
      if (take.includes(TRADER_KEY)) emit('synced', [TRADER_KEY]);
      const rest = take.filter((k) => k !== TRADER_KEY); if (rest.length) emit('synced', rest);
      local = snapshot();
    }
    if ((!same(local, base?.snap ?? {}) || !r.version) && !(await push(address, local, r.version ?? 0))) return 'again';
    lastOk = Date.now(); show(`Synced with your other devices at ${new Date(lastOk).toLocaleTimeString()}.${r.lease && r.lease.device !== device && r.lease.until > Date.now() ? ` Auto-trading is running on ${r.lease.name || 'another device'}.` : ''}`);
    return 'done';
  }
}

/**
 * The auto trader asks before it starts, and renews while it runs: only one device trades at a time, so two devices never
 * buy the same coin twice. Returns null when this device may trade, or the reason it may not.
 */
export async function claimTrading() {
  if (off || !vault.unlocked || !vault.protected) return null; // nothing synced: only this device is involved
  try {
    const ts = Date.now(), r = await call({ op: 'lease', address: vault.address, device, name: deviceName(), ts, sig: vault.sign(signedText.lease({ address: vault.address, device, release: false, ts })) });
    if (r.status === 409 && r.held) return `Auto-trading is already running on ${r.name || 'another device'}. Stop it there first (or wait ${Math.max(1, Math.ceil((r.until - Date.now()) / 60_000))} minutes after it closed).`;
    if (r.status === 200) { authority = true; leaseUntil = r.until; }
    return null;
  } catch { return null; } // storage down: do not block trading over it
}
export async function releaseTrading() {
  authority = false; leaseUntil = 0; if (off || !vault.unlocked) return;
  try { const ts = Date.now(); await call({ op: 'lease', address: vault.address, device, release: true, ts, sig: vault.sign(signedText.lease({ address: vault.address, device, release: true, ts })) }); } catch {}
}

on('vault-open', () => { off = false; void syncNow(); });
on('vault-sync-id', () => void syncNow());
on('vault-locked', () => show('Sync waits while the wallet is locked.'));
setInterval(() => {
  if (authority && leaseUntil - Date.now() < 90_000) void claimTrading();
  if (authority || document.visibilityState === 'visible') void syncNow();
}, 15_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });
show(vault.exists ? 'Unlock the trading wallet to sync with your other devices.' : 'Have a trading wallet on another device? Open it here with its passphrase.');
export const sync = { get note() { return note; }, get device() { return device; } };
