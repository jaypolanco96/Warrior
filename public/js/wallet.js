// The signing secret stays inside this module. Only encrypted records and signed payloads leave it.
import { Transaction, VersionedTransaction, SystemProgram, PublicKey, ed25519 } from '/vendor/solana.js';
import { lookupId, portableRecord, sealSnapshot, openSnapshot } from '/vendor/lib/sync.js';
import { sealWallet, openWallet, isSealed, passphraseProblems, toBase58, parseBackupKey, addDeviceKey, openWithDeviceKey, shouldLockWallet, unexpectedPrograms } from '/vendor/lib/vault.js';
import { api, post, sleep, emit, state, lock } from './store.js';

const WKEY = 'warrior.wallet.v1';
let record = null, secretBytes = null, dataKey = null, syncId = null, epoch = 0, walletBusy = false, lastActive = Date.now();
const tradingHolds = [];
export const holdWalletWhile = (needsKey) => tradingHolds.push(needsKey);
try { const r = JSON.parse(localStorage.getItem(WKEY) ?? 'null'); if (isSealed(r)) record = r; } catch { /* none yet */ }
const persist = (next) => localStorage.setItem(WKEY, JSON.stringify(next));
const clean = (opened) => { opened?.secret?.fill(0); opened?.dataKey?.fill(0); };
const opened = (p) => {
  lastActive = Date.now(); const version = epoch;
  emit('wallet'); emit('vault-open');
  if (p) void lookupId(p).then((id) => { if (version === epoch && secretBytes) { syncId = id; emit('vault-sync-id'); } }).catch(() => {});
};
async function action(fn) {
  if (walletBusy) throw new Error('A wallet action is still finishing. Try again in a moment');
  walletBusy = true; const version = epoch;
  const current = () => { if (version !== epoch) throw new Error('The wallet was locked. Open it again'); };
  try { return await fn(current); } finally { walletBusy = false; }
}
function validSecret(secret, address) {
  if (!(secret instanceof Uint8Array) || secret.length !== 64) return false;
  const pub = ed25519.getPublicKey(secret.subarray(0, 32));
  return pub.every((b, i) => secret[i + 32] === b) && new PublicKey(pub).toBase58() === address;
}
function install(o, next, passphrase, current, save = false) {
  current();
  if (!validSecret(o.secret, next.address)) throw new Error('That wallet copy is damaged');
  if (save) persist(next);
  secretBytes?.fill(0); dataKey?.fill(0);
  secretBytes = o.secret; dataKey = o.dataKey; record = next;
  o.secret = null; o.dataKey = null;
  opened(passphrase);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const prfSupported = () => typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;
async function deviceKey(credentialId, salt) {
  const got = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: unb64(credentialId) }], userVerification: 'required', extensions: { prf: { eval: { first: unb64(salt) } } } } });
  const first = got?.getClientExtensionResults?.().prf?.results?.first; if (!first) throw new Error('This device or browser cannot unlock wallets with a passkey');
  return new Uint8Array(first);
}
export const vault = {
  get hasPasskey() { return !!record?.passkey; }, get passkeySupported() { return prfSupported(); },
  async addPasskey() { return action(async (current) => {
    if (!record || !dataKey) throw new Error('Unlock the wallet with its passphrase first');
    if (!prfSupported()) throw new Error('This browser does not support passkeys');
    const salt = crypto.getRandomValues(new Uint8Array(32)); let key;
    try {
      const made = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Warrior', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Warrior trading wallet', displayName: 'Warrior trading wallet' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, extensions: { prf: { eval: { first: salt } } } } });
      current(); const ext = made?.getClientExtensionResults?.().prf;
      if (!made || !ext || ext.enabled === false) throw new Error('This device or browser cannot unlock wallets with a passkey. The passphrase still works');
      const id = b64(new Uint8Array(made.rawId)); key = ext.results?.first ? new Uint8Array(ext.results.first) : await deviceKey(id, b64(salt)); current();
      const next = await addDeviceKey(record, dataKey, key, id, b64(salt)); current(); persist(next); record = next; emit('wallet');
    } finally { key?.fill(0); }
  }); },
  async unlockDevice() { return action(async (current) => {
    if (!record?.passkey) throw new Error('No passkey is set up for this wallet');
    let key, o; try { key = await deviceKey(record.passkey.id, record.passkey.prfSalt); current(); o = await openWithDeviceKey(record, key); install(o, record, null, current); } finally { key?.fill(0); clean(o); }
  }); },
  removePasskey() { if (walletBusy) throw new Error('A wallet action is still finishing'); if (record?.passkey) { const next = { ...record, passkey: null }; persist(next); record = next; emit('wallet'); } },
  get exists() { return !!record; }, get unlocked() { return !!secretBytes; },
  get address() { return record?.address ?? ''; }, get publicKey() { return new PublicKey(vault.address); },
  checkPassphrase(p, again) { const bad = passphraseProblems(p); if (bad.length) throw new Error(bad[0]); if (p !== again) throw new Error('The two passphrases do not match'); },
  async create(p) { return action(async (current) => {
    if (record) throw new Error('A trading wallet already exists here'); vault.checkPassphrase(p, p);
    const seed = crypto.getRandomValues(new Uint8Array(32)), pub = ed25519.getPublicKey(seed), secret = new Uint8Array(64); secret.set(seed); secret.set(pub, 32); seed.fill(0); let o;
    try { const made = await sealWallet(secret, p, new PublicKey(pub).toBase58()); o = { secret, dataKey: made.dataKey }; install(o, made.record, p, current, true); } finally { if (o) clean(o); else secret.fill(0); }
  }); },
  async restore(text, p) { return action(async (current) => {
    if (record) throw new Error('A trading wallet already exists here'); vault.checkPassphrase(p, p);
    const secret = parseBackupKey(text); if (!secret) throw new Error('That is not a backup key'); let o;
    try { const address = new PublicKey(secret.subarray(32)).toBase58(); if (!validSecret(secret, address)) throw new Error('That backup key is damaged'); const made = await sealWallet(secret, p, address); o = { secret, dataKey: made.dataKey }; install(o, made.record, p, current, true); } finally { if (o) clean(o); else secret.fill(0); }
  }); },
  async unlock(p) { return action(async (current) => { let o; try { o = await openWallet(record, p); install(o, record, p, current); } finally { clean(o); } }); },
  lock() { epoch++; secretBytes?.fill(0); dataKey?.fill(0); secretBytes = null; dataKey = null; syncId = null; emit('wallet'); emit('vault-locked'); },
  get protected() { return true; }, get syncId() { return syncId; }, get portable() { return record ? structuredClone(portableRecord(record)) : null; },
  sign(text) { if (!secretBytes) throw new Error('Unlock the wallet first'); const sig = ed25519.sign(new TextEncoder().encode(text), secretBytes.subarray(0, 32)); return b64(sig); },
  signTransaction(tx) {
    if (!secretBytes) throw new Error('Unlock the trading wallet first');
    if (tx instanceof VersionedTransaction) {
      if (tx.message.staticAccountKeys[0].toBase58() !== vault.address || tx.message.header.numRequiredSignatures !== 1) throw new Error('Transaction was not built for this wallet');
      const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
      if (unexpectedPrograms(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex] ?? 'unknown')).length) throw new Error('Transaction calls an unexpected program');
    } else if (!(tx instanceof Transaction) || !tx.feePayer?.equals(vault.publicKey)) throw new Error('Transaction was not built for this wallet');
    const secret = secretBytes.slice(), signer = { publicKey: vault.publicKey, secretKey: secret };
    try { if (tx instanceof VersionedTransaction) tx.sign([signer]); else tx.sign(signer); } finally { secret.fill(0); }
  },
  async sealSnapshot(snapshot) { if (!dataKey) throw new Error('Unlock the wallet first'); const key = dataKey.slice(), version = epoch; try { const out = await sealSnapshot(key, vault.address, snapshot); if (epoch !== version) throw new Error('Wallet locked during sync'); return out; } finally { key.fill(0); } },
  async openSnapshot(blob) { if (!dataKey) throw new Error('Unlock the wallet first'); const key = dataKey.slice(), version = epoch; try { const out = await openSnapshot(key, vault.address, blob); if (epoch !== version) throw new Error('Wallet locked during sync'); return out; } finally { key.fill(0); } },
  async adopt(found, p) { return action(async (current) => { if (record) throw new Error('A trading wallet already exists here'); let o; try { o = await openWallet(found, p); install(o, { ...found, passkey: null }, p, current, true); } finally { clean(o); } }); },
  async fromOtherDevice(p) { const version = epoch, id = await lookupId(p), r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'find', id }) }), j = await r.json().catch(() => ({})); if (version !== epoch) throw new Error('The wallet was locked. Try again'); if (!r.ok) throw new Error(j.error ?? 'Sync is unavailable right now'); if (!j.record) throw new Error('No synced wallet has that passphrase. Open Warrior on the other device, unlock the wallet there once, then try again'); await vault.adopt(j.record, p); },
  async backup(p) { return action(async (current) => { let o; try { o = await openWallet(record, p); current(); if (document.visibilityState !== 'visible') throw new Error('Return to Warrior to show the backup key'); return toBase58(o.secret); } finally { clean(o); } }); }
};

export function checkWalletIdle(now = Date.now()) {
  const liveExposure = state.positions.some((p) => p.mode === 'live') || state.orders.some((o) => o.mode === 'live' && o.status === 'waiting');
  if (shouldLockWallet({ unlocked: vault.unlocked, lastActive, now, busy: walletBusy || lock.busy, liveRunning: tradingHolds.some((needsKey) => needsKey()), liveExposure })) {
    vault.lock(); emit('say', { who: 'umlobi', text: 'Trading wallet locked after five minutes without activity. Unlock it when you need it.' });
  }
}
for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, (e) => { if (e.isTrusted) lastActive = Date.now(); }, { passive: true, capture: true });
setInterval(checkWalletIdle, 15_000);
document.addEventListener('visibilitychange', () => checkWalletIdle());
window.addEventListener('pagehide', () => vault.lock());

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
  if (!secretBytes) throw new Error('Unlock the trading wallet first');
  const lamports = Math.round(sol * 1e9); if (!(lamports > 0)) throw new Error('Enter an amount');
  const { blockhash } = await api('/api/chain'), tx = new Transaction({ feePayer: vault.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: new PublicKey(to), lamports }));
  vault.signTransaction(tx); const bytes = tx.serialize(), b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  const { signature } = await post('/api/send', { transaction: b64 }); return { signature, outcome: await waitFor(signature) };
}
export async function liveBalance() { return vault.address ? (await api(`/api/balance?owner=${vault.address}`)).sol : 0; }
