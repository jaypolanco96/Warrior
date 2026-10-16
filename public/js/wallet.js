// Two wallets:
//  - Phantom (yours): connected only to send SOL into the trading wallet. Phantom asks you to approve every transfer.
//  - The trading wallet: made in this browser, its key locked with your passphrase (AES-256-GCM, PBKDF2 600,000 rounds).
//    It lives in this tab's memory only while unlocked. The key is never sent anywhere; only signed transactions leave.
import { Keypair, Transaction, SystemProgram, PublicKey, ed25519 } from '/vendor/solana.js';
import { lookupId, portableRecord } from '/vendor/lib/sync.js';
import { sealWallet, openWallet, isSealed, passphraseProblems, toBase58, parseBackupKey } from '/vendor/lib/vault.js';
import { api, post, sleep, emit } from './store.js';

const WKEY = 'warrior.wallet.v1';
let record = null, keypair = null, dataKey = null, syncId = null;
// Once open: work out the id the locked copy is filed under on the server (it needs the passphrase), and tell sync.
const opened = (p) => { emit('wallet'); emit('vault-open'); if (p) void lookupId(p).then((id) => { syncId = id; emit('vault-sync-id'); }).catch(() => {}); };
try { const r = JSON.parse(localStorage.getItem(WKEY) ?? 'null'); if (isSealed(r)) record = r; } catch { /* none yet */ }
const store = () => localStorage.setItem(WKEY, JSON.stringify(record));

export const vault = {
  get exists() { return !!record; }, get unlocked() { return !!keypair; }, get keypair() { return keypair; },
  get address() { return record?.address ?? ''; },
  checkPassphrase(p, again) { const bad = passphraseProblems(p); if (bad.length) throw new Error(bad[0]); if (p !== again) throw new Error('The two passphrases do not match'); },
  async create(p) { if (record) throw new Error('A trading wallet already exists here'); const kp = Keypair.generate(), made = await sealWallet(kp.secretKey, p, kp.publicKey.toBase58()); record = made.record; dataKey = made.dataKey; keypair = kp; store(); opened(p); },
  async restore(text, p) { if (record) throw new Error('A trading wallet already exists here'); const secret = parseBackupKey(text); if (!secret) throw new Error('That is not a backup key'); const kp = Keypair.fromSecretKey(secret), made = await sealWallet(secret, p, kp.publicKey.toBase58()); record = made.record; dataKey = made.dataKey; keypair = kp; store(); opened(p); },
  async unlock(p) { const o = await openWallet(record, p); keypair = Keypair.fromSecretKey(o.secret); dataKey = o.dataKey; opened(p); },
  lock() { keypair = null; dataKey = null; syncId = null; emit('wallet'); emit('vault-locked'); },
  // ---------- for sync between devices ----------
  get protected() { return true; }, get syncId() { return syncId; }, get syncKey() { return dataKey; }, get portable() { return record ? portableRecord(record) : null; },
  /** Sign a sync request; only an unlocked wallet can. Base64. */
  sign(text) { if (!keypair) throw new Error('Unlock the wallet first'); const sig = ed25519.sign(new TextEncoder().encode(text), keypair.secretKey.slice(0, 32)); return btoa(String.fromCharCode(...sig)); },
  /** A new device: keep the locked copy found on the server, then open it with the passphrase. */
  async adopt(found, p) { if (record) throw new Error('A trading wallet already exists here'); const o = await openWallet(found, p); const kp = Keypair.fromSecretKey(o.secret); if (kp.publicKey.toBase58() !== found.address) throw new Error('That wallet copy is damaged'); record = { ...found, passkey: null }; store(); keypair = kp; dataKey = o.dataKey; opened(p); },
  /** Find the locked copy another device synced, by its passphrase (only an id made from it is sent), and open it here. */
  async fromOtherDevice(p) { const id = await lookupId(p), r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'find', id }) }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Sync is unavailable right now'); if (!j.record) throw new Error('No synced wallet has that passphrase. Open Warrior on the other device, unlock the wallet there once, then try again'); await vault.adopt(j.record, p); },
  async backup(p) { return toBase58((await openWallet(record, p)).secret); }
};

// ---------- Phantom ----------
const phantom = () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
export const owner = { address: '' };
const REMEMBER = 'warrior.phantom.v1';
export async function connectPhantom() {
  const p = phantom(); if (!p) { window.open('https://phantom.com/download', '_blank', 'noopener'); throw new Error('Phantom is not installed in this browser'); }
  const r = await p.connect(); owner.address = r.publicKey.toString(); try { localStorage.setItem(REMEMBER, '1'); } catch { /* not remembered */ } emit('wallet'); return owner.address;
}
export async function disconnectPhantom() { try { await phantom()?.disconnect(); } catch { /* already gone */ } try { localStorage.removeItem(REMEMBER); } catch { /* fine */ } owner.address = ''; emit('wallet'); }
/**
 * After a refresh: reconnect Phantom silently if you connected it before and still trust this site in Phantom
 * (onlyIfTrusted never opens a popup). Phantom injects itself a moment after the page loads, so this waits for it briefly.
 */
export async function reconnectPhantom() {
  let remembered = false; try { remembered = localStorage.getItem(REMEMBER) === '1'; } catch { /* blocked */ } if (!remembered) return;
  for (let i = 0; i < 20 && !phantom(); i++) await sleep(150);
  const p = phantom(); if (!p) return;
  try { const r = await p.connect({ onlyIfTrusted: true }); owner.address = r.publicKey.toString(); emit('wallet'); } catch { /* not trusted any more: the button stays */ }
}

/** Wait for the network's answer about a transaction: 'confirmed', 'failed' or 'unknown'. Never resends. */
export async function waitFor(signature) {
  for (let i = 0; i < 24; i++) { await sleep(2500); const { outcome } = await api(`/api/status?signature=${signature}`).catch(() => ({ outcome: 'unknown' })); if (outcome !== 'unknown') return outcome; }
  return 'unknown';
}
/** Phantom -> trading wallet. Phantom shows the amount and asks you to approve. */
export async function fundFromPhantom(sol) {
  const p = phantom(); if (!p || !owner.address) throw new Error('Connect Phantom first'); if (!vault.exists) throw new Error('Make the trading wallet first');
  const lamports = Math.round(sol * 1e9); if (!(lamports > 0)) throw new Error('Enter an amount');
  const { blockhash } = await api('/api/chain'), from = new PublicKey(owner.address);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(vault.address), lamports }));
  const { signature } = await p.signAndSendTransaction(tx); return { signature, outcome: await waitFor(signature) };
}
/** Trading wallet -> Phantom (or any address you type). Signed here, relayed by the server. */
export async function withdraw(to, sol) {
  if (!keypair) throw new Error('Unlock the trading wallet first');
  const lamports = Math.round(sol * 1e9); if (!(lamports > 0)) throw new Error('Enter an amount');
  const { blockhash } = await api('/api/chain'), tx = new Transaction({ feePayer: keypair.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(to), lamports }));
  tx.sign(keypair); const bytes = tx.serialize(), b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  const { signature } = await post('/api/send', { transaction: b64 }); return { signature, outcome: await waitFor(signature) };
}
export async function liveBalance() { return vault.address ? (await api(`/api/balance?owner=${vault.address}`)).sol : 0; }
