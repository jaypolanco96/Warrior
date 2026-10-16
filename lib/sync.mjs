// Sync between your devices. Runs unchanged in the browser and in Node, so the same code is tested and shipped.
//
// What leaves a device, and how it is protected:
//   - The wallet record: the same locked copy of the key that this browser already keeps (AES-256-GCM, the lock opened
//     only by your passphrase through 600,000 rounds of PBKDF2). It is found again by a lookup id made from your
//     passphrase, so the server cannot hand it to anyone who does not know the passphrase.
//   - Your trading data (positions, history, rules, orders): compressed, then encrypted with the wallet's data key, which
//     only an unlocked wallet has. The server stores scrambled bytes it cannot read.
//   - Every write is signed by the wallet's key, so only the wallet's owner can change what is stored for it.
// Your passphrase never leaves the device.

const subtle = globalThis.crypto.subtle, random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const text = (s) => new TextEncoder().encode(s);
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The browser storage that is synced. Everything else (layout, what is folded, coin info caches) stays per device. */
export const SYNC_KEYS = Object.freeze(['warrior.auto.state.v1', 'warrior.rules.v1', 'warrior.tools.v1', 'warrior.positions.v1']);
/** The auto trader's data: the device that is running the auto trader is the one whose copy wins a disagreement. */
export const TRADER_KEY = 'warrior.auto.state.v1';
export const LOOKUP_ITERATIONS = 300_000, MAX_BLOB = 900_000;

/** The id a wallet record is filed under: made from the passphrase, so finding it needs the passphrase. 64 hex characters. */
export async function lookupId(passphrase) {
  const base = await subtle.importKey('raw', text(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: text('warrior-sync-lookup-v1'), iterations: LOOKUP_ITERATIONS }, base, 256));
  return hex(new Uint8Array(await subtle.digest('SHA-256', bits)));
}

async function gzip(bytes) { if (typeof CompressionStream === 'undefined') return { z: 0, bytes }; return { z: 1, bytes: new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) }; }
async function gunzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
const aes = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Encrypt a snapshot ({ key: string }) with the wallet's data key. */
export async function sealSnapshot(dataKey, address, snapshot) {
  const packed = await gzip(text(JSON.stringify(snapshot))), iv = random(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text(`warrior-sync:${address}`) }, await aes(dataKey), packed.bytes));
  return JSON.stringify({ v: 1, z: packed.z, iv: b64(iv), ct: b64(ct) });
}
export async function openSnapshot(dataKey, address, blob) {
  const box = JSON.parse(blob); if (box?.v !== 1) throw new Error('Unknown sync format');
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: text(`warrior-sync:${address}`) }, await aes(dataKey), unb64(box.ct)));
  const out = JSON.parse(new TextDecoder().decode(box.z ? await gunzip(plain) : plain));
  return Object.fromEntries(SYNC_KEYS.filter((k) => typeof out[k] === 'string').map((k) => [k, out[k]]));
}

/**
 * Three-way merge of one snapshot per key. `base` is what both sides last agreed on.
 * A key changed on one side only takes that side. Changed on both: the trader's data goes to the device running the
 * auto trader (`authority`); anything else keeps the newer edit, which is the remote one, already saved.
 * Returns the merged snapshot and the keys this device has to take from the remote copy.
 */
export function mergeSnapshots(base = {}, local = {}, remote = {}, { authority = false } = {}) {
  const merged = {}, take = [];
  for (const k of SYNC_KEYS) {
    const b = base[k], l = local[k], r = remote[k];
    let use;
    if (l === r) use = l; else if (l === b) use = r; else if (r === b) use = l;
    else use = k === TRADER_KEY && authority ? l : r;
    if (use !== undefined) merged[k] = use;
    if (use !== l && use !== undefined) take.push(k);
  }
  return { merged, take };
}

/** The exact text a device signs for each kind of write. The server rebuilds it to check the signature. */
export const signedText = {
  record: ({ id, address, ts }) => `warrior-sync|record|${id}|${address}|${ts}`,
  put: ({ address, base, digest, ts }) => `warrior-sync|put|${address}|${base}|${digest}|${ts}`,
  lease: ({ address, device, release, ts }) => `warrior-sync|lease|${address}|${device}|${release ? 1 : 0}|${ts}`
};
export async function digestOf(blob) { return hex(new Uint8Array(await subtle.digest('SHA-256', text(blob)))); }
/** The record that is synced: the locked key without this device's passkey, which only works on this device. */
export const portableRecord = (record) => ({ ...record, passkey: null });
