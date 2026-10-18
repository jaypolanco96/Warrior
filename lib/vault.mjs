// Key protection for the trading wallet, and the checks made before the wallet signs or sweeps anything.
// The wallet's secret is encrypted with a random data key (AES-256-GCM). The data key is itself locked by a key made
// from the passphrase (PBKDF2-SHA256), and optionally by a device passkey. Nothing here leaves the device.
// Runs unchanged in the browser and in Node (both provide crypto.subtle), so the same code is tested and shipped.

const subtle = globalThis.crypto.subtle, random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')), unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const text = (s) => new TextEncoder().encode(s);
export const KDF_ITERATIONS = 600_000;
export const WALLET_IDLE_MS = 5 * 60_000;
/** Do not strand live positions or stop an active trader just because nobody touched the screen. */
export function shouldLockWallet({ unlocked, lastActive, now = Date.now(), busy = false, liveRunning = false, liveExposure = false }) {
  return !!unlocked && !busy && !liveRunning && !liveExposure && Number.isFinite(lastActive) && now - lastActive >= WALLET_IDLE_MS;
}

// ---------- base58, for the backup key ----------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function toBase58(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let out = ''; while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; } for (const b of bytes) { if (b !== 0) break; out = '1' + out; } return out; }
/** Returns the bytes, or null when the text is not base58. */
export function fromBase58(input) {
  const s = String(input ?? '').trim(); if (!s || [...s].some((c) => !ALPHABET.includes(c))) return null;
  let n = 0n; for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
/** A backup key is 64 bytes: accept base58 (what Phantom exports) or a JSON list of 64 numbers. */
export function parseBackupKey(input) {
  const s = String(input ?? '').trim();
  if (s.length > 1024) return null;
  if (s.startsWith('[')) { try { const list = JSON.parse(s); if (Array.isArray(list) && list.length === 64 && list.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return Uint8Array.from(list); } catch {} return null; }
  const bytes = fromBase58(s); return bytes && bytes.length === 64 ? bytes : null;
}

// ---------- passphrase ----------
const COMMON = new Set(['password', 'password1', 'passphrase', '1234567890', 'qwertyuiop', 'letmein123', 'iloveyou12', 'solanasolana', 'passwordpassword', 'password123456789', '123456789012345', 'qwertyuiopasdfgh', 'letmeinletmein123']);
/** Reasons a passphrase is too weak. An empty list means it is accepted. Plain rules: long beats clever. */
export function passphraseProblems(p) {
  const s = String(p ?? '').normalize('NFKC'), reasons = [];
  if ([...s].length < 15) reasons.push('Use at least 15 characters. Four or more random words work well');
  else if (new Set(s).size < 5) reasons.push('That repeats the same few characters. Mix it up');
  else if (COMMON.has(s.toLowerCase())) reasons.push('That one is on every list of common passwords');
  return reasons;
}
async function keyFromPassphrase(passphrase, salt, iterations) {
  const base = await subtle.importKey('raw', text(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aes = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function lock(key, plain, aad) { const iv = random(12); return { iv: b64(iv), ct: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text(aad) }, key, plain))) }; }
async function unlock(key, box, aad) { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: text(aad) }, key, unb64(box.ct))); }

/**
 * Lock a wallet secret (64 bytes) behind a passphrase. `address` is bound into the ciphertext, so a record cannot be
 * swapped for another wallet's. Returns the record to store and the data key (kept in memory only, to add a passkey).
 */
export async function sealWallet(secret, passphrase, address, { iterations = KDF_ITERATIONS } = {}) {
  if (!(secret instanceof Uint8Array) || secret.length !== 64) throw new Error('Not a wallet key');
  const dataKey = random(32), salt = random(16);
  const record = { v: 2, address, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), wrapped: await lock(await keyFromPassphrase(passphrase, salt, iterations), dataKey, `warrior-wrap:${address}`), secret: await lock(await aes(dataKey), secret, `warrior-secret:${address}`), passkey: null };
  return { record, dataKey };
}
const valid = (r) => r && r.v === 2 && typeof r.address === 'string' && typeof r.salt === 'string' && r.salt.length === 24 && r.wrapped?.iv?.length === 16 && r.wrapped?.ct?.length === 64 && r.secret?.iv?.length === 16 && r.secret?.ct?.length === 108 && Number.isInteger(r.iterations) && r.iterations >= 1000 && r.iterations <= 2_000_000;
export const isSealed = valid;
/** Open a sealed wallet with its passphrase. A wrong passphrase or a tampered record throws 'Wrong passphrase'. */
export async function openWallet(record, passphrase) {
  if (!valid(record)) throw new Error('This wallet record is damaged');
  let dataKey;
  try { dataKey = await unlock(await keyFromPassphrase(passphrase, unb64(record.salt), record.iterations), record.wrapped, `warrior-wrap:${record.address}`); return { secret: await unlock(await aes(dataKey), record.secret, `warrior-secret:${record.address}`), dataKey }; }
  catch { dataKey?.fill(0); throw new Error('Wrong passphrase'); }
}
/** Let a second key (32 bytes from a device passkey) open the same wallet. Returns the updated record. */
export async function addDeviceKey(record, dataKey, deviceKey, credentialId, prfSalt) {
  if (!valid(record) || !(deviceKey instanceof Uint8Array) || deviceKey.length !== 32) throw new Error('Device key unavailable');
  return { ...record, passkey: { id: credentialId, prfSalt, ...(await lock(await aes(deviceKey), dataKey, `warrior-device:${record.address}`)) } };
}
export async function openWithDeviceKey(record, deviceKey) {
  if (!valid(record) || !record.passkey) throw new Error('No passkey is set up for this wallet');
  let dataKey;
  try { dataKey = await unlock(await aes(deviceKey), record.passkey, `warrior-device:${record.address}`); return { secret: await unlock(await aes(dataKey), record.secret, `warrior-secret:${record.address}`), dataKey }; }
  catch { dataKey?.fill(0); throw new Error('That passkey does not open this wallet'); }
}

// ---------- sweep: send spare SOL home to the owner's main wallet ----------
/**
 * How many lamports to sweep. Only when nothing is open, only what is above the amount the owner chose to keep working,
 * and never a dust-sized transfer. Returns 0 for "do nothing".
 */
export function sweepLamports({ balanceLamports, keepSol, openPositions, on, to, feeLamports = 5000, minSol = 0.01 }) {
  if (!on || openPositions > 0 || typeof to !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) return 0;
  if (!Number.isFinite(balanceLamports) || !Number.isFinite(keepSol) || keepSol < 0) return 0;
  const spare = Math.floor(balanceLamports - keepSol * 1e9 - feeLamports);
  return spare >= minSol * 1e9 ? spare : 0;
}

// ---------- what a swap transaction is allowed to contain ----------
export const SWAP_PROGRAMS = Object.freeze({
  'ComputeBudget111111111111111111111111111111': 'compute budget', '11111111111111111111111111111111': 'system',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'token', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'token-2022',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'associated token account', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter swap'
});
/**
 * The programs a built swap calls directly, minus the ones a Jupiter swap is expected to call. Anything left over is a
 * reason not to sign. Program addresses cannot hide in lookup tables, so this list is complete for the top level.
 */
export function unexpectedPrograms(programIds) { return [...new Set(programIds)].filter((id) => !(id in SWAP_PROGRAMS)); }

// ---------- getting the rent back from empty coin accounts ----------
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** The one-byte instruction that closes a token account and sends its rent to the owner. */
export const CLOSE_ACCOUNT_DATA = Uint8Array.from([9]);
/**
 * From a wallet's token accounts, pick the ones that are safe to close: exactly zero coins, a known token program, and
 * (when `mint` is given) only that coin's. An account that still holds anything is never touched. At most eight a time.
 * accounts: [{ address, mint, amount, program, lamports }]
 */
export function closableAccounts(accounts, { mint = null, max = 8 } = {}) {
  return (accounts ?? []).filter((a) => a && a.amount === '0' && TOKEN_PROGRAMS.has(a.program) && ADDRESS.test(a.address ?? '') && ADDRESS.test(a.mint ?? '') && (!mint || a.mint === mint)).slice(0, max);
}
