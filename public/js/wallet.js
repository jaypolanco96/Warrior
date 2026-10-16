// Two wallets:
//  - Phantom (yours): connected only to send SOL into the trading wallet. Phantom asks you to approve every transfer.
//  - The trading wallet: made in this browser, its key locked with your passphrase (AES-256-GCM, PBKDF2 600,000 rounds).
//    It lives in this tab's memory only while unlocked. The key is never sent anywhere; only signed transactions leave.
import { Keypair, Transaction, SystemProgram, PublicKey } from '/vendor/solana.js';
import { sealWallet, openWallet, isSealed, passphraseProblems, toBase58, parseBackupKey } from '/vendor/lib/vault.js';
import { api, post, sleep, emit } from './store.js';

const WKEY = 'warrior.wallet.v1';
let record = null, keypair = null;
try { const r = JSON.parse(localStorage.getItem(WKEY) ?? 'null'); if (isSealed(r)) record = r; } catch { /* none yet */ }
const store = () => localStorage.setItem(WKEY, JSON.stringify(record));

export const vault = {
  get exists() { return !!record; }, get unlocked() { return !!keypair; }, get keypair() { return keypair; },
  get address() { return record?.address ?? ''; },
  checkPassphrase(p, again) { const bad = passphraseProblems(p); if (bad.length) throw new Error(bad[0]); if (p !== again) throw new Error('The two passphrases do not match'); },
  async create(p) { if (record) throw new Error('A trading wallet already exists here'); const kp = Keypair.generate(); record = (await sealWallet(kp.secretKey, p, kp.publicKey.toBase58())).record; keypair = kp; store(); emit('wallet'); },
  async restore(text, p) { if (record) throw new Error('A trading wallet already exists here'); const secret = parseBackupKey(text); if (!secret) throw new Error('That is not a backup key'); const kp = Keypair.fromSecretKey(secret); record = (await sealWallet(secret, p, kp.publicKey.toBase58())).record; keypair = kp; store(); emit('wallet'); },
  async unlock(p) { keypair = Keypair.fromSecretKey((await openWallet(record, p)).secret); emit('wallet'); },
  lock() { keypair = null; emit('wallet'); },
  async backup(p) { return toBase58((await openWallet(record, p)).secret); }
};

// ---------- Phantom ----------
const phantom = () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
export const owner = { address: '' };
export async function connectPhantom() {
  const p = phantom(); if (!p) { window.open('https://phantom.com/download', '_blank', 'noopener'); throw new Error('Phantom is not installed in this browser'); }
  const r = await p.connect(); owner.address = r.publicKey.toString(); emit('wallet'); return owner.address;
}
export async function disconnectPhantom() { try { await phantom()?.disconnect(); } catch { /* already gone */ } owner.address = ''; emit('wallet'); }

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
