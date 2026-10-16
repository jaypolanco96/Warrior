import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { mergeSnapshots, sealSnapshot, openSnapshot, lookupId, signedText, digestOf, portableRecord, TRADER_KEY } from '../lib/sync.mjs';
import { sealWallet } from '../lib/vault.mjs';
import handler from '../api/sync.js';

const R = 'warrior.rules.v1', T = 'warrior.tools.v1';
test('merging two devices: one-sided changes win, the running trader keeps its positions, other clashes take the saved copy', () => {
  const base = { [TRADER_KEY]: 'a', [R]: 'r1', [T]: 't1' };
  let m = mergeSnapshots(base, { ...base, [R]: 'r2' }, { ...base, [TRADER_KEY]: 'b' });
  assert.deepEqual(m.merged, { [TRADER_KEY]: 'b', [R]: 'r2', [T]: 't1' }); assert.deepEqual(m.take, [TRADER_KEY]);
  m = mergeSnapshots(base, { ...base, [TRADER_KEY]: 'mine' }, { ...base, [TRADER_KEY]: 'theirs' }, { authority: true }); assert.equal(m.merged[TRADER_KEY], 'mine'); assert.deepEqual(m.take, []);
  m = mergeSnapshots(base, { ...base, [TRADER_KEY]: 'mine' }, { ...base, [TRADER_KEY]: 'theirs' }); assert.equal(m.merged[TRADER_KEY], 'theirs');
  m = mergeSnapshots({}, { [TRADER_KEY]: 'fresh device' }, { [TRADER_KEY]: 'real data', [R]: 'r' }); assert.deepEqual(m.take.sort(), [TRADER_KEY, R].sort(), 'a new device takes everything');
});

test('the synced data is encrypted, tied to its wallet, and the lookup id needs the passphrase', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32)), snap = { [TRADER_KEY]: JSON.stringify({ positions: [{ mint: 'X'.repeat(44) }] }), [R]: '{}' };
  const blob = await sealSnapshot(key, 'addrA', snap);
  assert.ok(!blob.includes('positions') && !blob.includes('XXXX'), 'nothing readable'); assert.deepEqual(await openSnapshot(key, 'addrA', blob), snap);
  await assert.rejects(openSnapshot(key, 'addrB', blob), 'bound to the wallet'); await assert.rejects(openSnapshot(crypto.getRandomValues(new Uint8Array(32)), 'addrA', blob));
  const a = await lookupId('correct horse battery'), b = await lookupId('correct horse battery'); assert.equal(a, b); assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, await lookupId('correct horse batterz'));
});

const call = async (body, ip = '1.1.1.1') => { let code = 0, out = null; await handler({ method: 'POST', body, headers: { 'x-forwarded-for': ip } }, { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = o; return this; } }); return { code, ...out }; };
test('the sync server: only the wallet can write, a stale copy cannot overwrite a newer one, and only one device trades', async () => {
  const kp = Keypair.generate(), address = kp.publicKey.toBase58(), sign = (t) => Buffer.from(ed25519.sign(new TextEncoder().encode(t), kp.secretKey.slice(0, 32))).toString('base64');
  const { record } = await sealWallet(kp.secretKey, 'a long passphrase here', address, { iterations: 2000 }), rec = portableRecord({ ...record, passkey: { id: 'x' } }), id = await lookupId('a long passphrase here');
  let ts = Date.now();
  assert.equal((await call({ op: 'record', id, record: rec, ts, sig: sign(signedText.record({ id, address: 'someone else', ts })) })).code, 403, 'signature must match');
  assert.equal((await call({ op: 'record', id, record: { ...rec, passkey: { id: 'device' } }, ts, sig: sign(signedText.record({ id, address, ts })) })).code, 400, 'never a device passkey');
  assert.equal((await call({ op: 'record', id, record: rec, ts, sig: sign(signedText.record({ id, address, ts })) })).code, 200);
  assert.equal((await call({ op: 'find', id })).record.address, address); assert.equal((await call({ op: 'find', id: '0'.repeat(64) })).record, null);
  const blob = '{"v":1,"z":0,"iv":"AA","ct":"BB"}', put = async (base, b = blob, force = false) => { ts = Date.now(); return call({ op: 'put', address, base: force ? 'force' : String(base), force, blob: b, ts, sig: sign(signedText.put({ address, base: force ? 'force' : String(base), digest: await digestOf(b), ts })) }); };
  const first = await put(0); assert.equal(first.code, 200);
  assert.equal((await put(0, blob + ' ')).code, 409, 'a device that missed the first save cannot overwrite it');
  assert.equal((await put(first.version, blob + '  ')).code, 200);
  const g = await call({ op: 'get', address }); assert.ok(g.version > 0); assert.equal(g.blob, blob + '  ');
  ts = Date.now(); assert.equal((await call({ op: 'put', address, base: String(g.version), blob: 'tampered', ts, sig: sign(signedText.put({ address, base: String(g.version), digest: await digestOf(blob), ts })) })).code, 403, 'the signature covers the data');
  const lease = async (device, release = false) => { ts = Date.now(); return call({ op: 'lease', address, device, name: 'test', release, ts, sig: sign(signedText.lease({ address, device, release, ts })) }); };
  assert.equal((await lease('aaaaaaaaaaaaaaaa')).code, 200); assert.equal((await lease('bbbbbbbbbbbbbbbb')).code, 409, 'a second device may not trade');
  assert.equal((await lease('aaaaaaaaaaaaaaaa', true)).code, 200); assert.equal((await lease('bbbbbbbbbbbbbbbb')).code, 200, 'free once released');
  ts = Date.now() - 10 * 60_000; assert.equal((await call({ op: 'lease', address, device: 'cccccccccccccccc', ts, sig: sign(signedText.lease({ address, device: 'cccccccccccccccc', release: false, ts })) })).code, 400, 'old signed requests are refused');
});
