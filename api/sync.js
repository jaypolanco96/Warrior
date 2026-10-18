// Sync between your devices (see lib/sync.mjs for what is stored and how it is protected).
// Storage: an Upstash Redis database added to the Vercel project (KV_REST_API_URL and KV_REST_API_TOKEN, or the
// UPSTASH_REDIS_REST_ names). Off Vercel, with neither set, it keeps everything in memory, for local checks only.
// The server never sees a passphrase, a key or readable trading data. It checks that every write is signed by the wallet.
import { createPublicKey, verify, createHash } from 'node:crypto';
import { fromBase58, isSealed } from '../lib/vault.mjs';
import { signedText, digestOf, MAX_BLOB } from '../lib/sync.mjs';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = globalThis.__warriorSync ??= new Map();
const ready = () => !!(URL_ && TOKEN) || !process.env.VERCEL;
async function redis(...cmd) {
  if (!URL_ || !TOKEN) { // local checks only
    const [op, key, ...rest] = cmd;
    if (op === 'GET') return memory.get(key) ?? null;
    if (op === 'SET') { if (rest[1] === 'NX' && memory.has(key)) return null; memory.set(key, rest[0]); return 'OK'; }
    if (op === 'INCR') { const n = Number(memory.get(key) ?? 0) + 1; memory.set(key, String(n)); return n; }
    if (op === 'EXPIRE' || op === 'DEL') { if (op === 'DEL') memory.delete(key); return 1; }
    if (op === 'EVAL') { const [, , , k, base, value] = cmd; const cur = memory.get(k); const ver = cur ? JSON.parse(cur).version : 0; if (String(ver) !== base && base !== 'force') return JSON.stringify({ conflict: ver }); memory.set(k, value); return 'OK'; }
  }
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (j.error) throw new Error('storage'); return j.result;
}
// Save the trading data only if nobody else saved since this device last looked (or when forced by the running trader).
const CAS = "local cur = redis.call('GET', KEYS[1]); local ver = 0; if cur then ver = cjson.decode(cur).version end; if tostring(ver) ~= ARGV[1] and ARGV[1] ~= 'force' then return cjson.encode({conflict = ver}) end; redis.call('SET', KEYS[1], ARGV[2]); return 'OK'";

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function signedBy(address, message, signature) {
  try { const pub = fromBase58(address), sig = Buffer.from(String(signature), 'base64'); if (!pub || pub.length !== 32 || sig.length !== 64) return false; return verify(null, Buffer.from(message), createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pub)]), format: 'der', type: 'spki' }), sig); } catch { return false; }
}
const fresh = (ts) => Number.isFinite(ts) && Math.abs(Date.now() - ts) < 5 * 60_000;
const isAddress = (a) => typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const isId = (id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
async function limited(req, what, max) {
  const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim(), key = `warrior:rl:${what}:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
  const n = await redis('INCR', key); if (n === 1) await redis('EXPIRE', key, 3600); return n > max;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Bad request.' });
  if (!ready()) return res.status(503).json({ error: 'Sync is not set up yet: the site needs its storage added in Vercel.', setup: true });
  const b = req.body;
  try {
    switch (b.op) {
      case 'status': return res.status(200).json({ ok: true });
      case 'find': { // a new device asks for the locked wallet, by the id its passphrase makes
        if (!isId(b.id)) return res.status(400).json({ error: 'Bad request.' });
        if (await limited(req, 'find', 30)) return res.status(429).json({ error: 'Too many tries. Wait an hour.' });
        const rec = await redis('GET', `warrior:rec:${b.id}`); return res.status(200).json({ record: rec ? JSON.parse(rec) : null });
      }
      case 'record': { // save the locked wallet under its id
        const r = b.record;
        if (!isId(b.id) || !isSealed(r) || r.passkey || !isAddress(r.address) || !fresh(b.ts) || JSON.stringify(r).length > 4000) return res.status(400).json({ error: 'Bad request.' });
        const digest = await digestOf(JSON.stringify(r));
        if (!signedBy(r.address, signedText.record({ id: b.id, address: r.address, digest, ts: b.ts }), b.sig)) return res.status(403).json({ error: 'Not signed by this wallet.' });
        const key = `warrior:rec:${b.id}`, value = JSON.stringify(r);
        // An id already assigned to a wallet cannot be replaced by a different wallet's valid signature.
        if (!(await redis('SET', key, value, 'NX'))) {
          const existing = JSON.parse(await redis('GET', key));
          if (existing?.address !== r.address) return res.status(409).json({ error: 'This sync lookup already belongs to another wallet. Your local wallet is unchanged. Use a unique passphrase for each wallet.' });
          await redis('SET', key, value);
        }
        return res.status(200).json({ ok: true });
      }
      case 'get': { // the encrypted trading data and its version
        if (!isAddress(b.address)) return res.status(400).json({ error: 'Bad request.' });
        const cur = await redis('GET', `warrior:state:${b.address}`), lease = await redis('GET', `warrior:lease:${b.address}`);
        return res.status(200).json({ ...(cur ? JSON.parse(cur) : { version: 0, blob: null }), lease: lease ? JSON.parse(lease) : null });
      }
      case 'put': {
        const base = b.force ? 'force' : String(b.base ?? '');
        if (!isAddress(b.address) || typeof b.blob !== 'string' || b.blob.length > MAX_BLOB || !fresh(b.ts) || !/^(force|\d+)$/.test(base)) return res.status(400).json({ error: b.blob?.length > MAX_BLOB ? 'Too much data to sync.' : 'Bad request.' });
        if (!signedBy(b.address, signedText.put({ address: b.address, base, digest: await digestOf(b.blob), ts: b.ts }), b.sig)) return res.status(403).json({ error: 'Not signed by this wallet.' });
        if (await limited(req, 'put', 600)) return res.status(429).json({ error: 'Too many saves. Wait a little.' });
        const version = Date.now(), out = await redis('EVAL', CAS, 1, `warrior:state:${b.address}`, base, JSON.stringify({ version, blob: b.blob }));
        if (out !== 'OK') return res.status(409).json({ conflict: true, version: JSON.parse(out).conflict });
        return res.status(200).json({ version });
      }
      case 'lease': { // only one device runs the auto trader at a time
        if (!isAddress(b.address) || typeof b.device !== 'string' || !/^[0-9a-f]{16,64}$/.test(b.device) || !fresh(b.ts)) return res.status(400).json({ error: 'Bad request.' });
        if (!signedBy(b.address, signedText.lease({ address: b.address, device: b.device, release: !!b.release, ts: b.ts }), b.sig)) return res.status(403).json({ error: 'Not signed by this wallet.' });
        const key = `warrior:lease:${b.address}`, cur = JSON.parse((await redis('GET', key)) ?? 'null');
        if (cur && cur.device !== b.device && cur.until > Date.now()) return res.status(409).json({ held: true, until: cur.until, name: cur.name ?? null });
        if (b.release) { if (cur?.device === b.device) await redis('DEL', key); return res.status(200).json({ ok: true }); }
        const lease = { device: b.device, name: String(b.name ?? '').slice(0, 40), until: Date.now() + 3 * 60_000 }; await redis('SET', key, JSON.stringify(lease)); return res.status(200).json({ ok: true, until: lease.until });
      }
      default: return res.status(400).json({ error: 'Bad request.' });
    }
  } catch { return res.status(503).json({ error: 'Sync storage is unavailable right now. Everything is still saved on this device.' }); }
}
