import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { passphraseProblems, sealWallet, openWallet, isSealed, shouldLockWallet, WALLET_IDLE_MS, toBase58 } from '../lib/vault.mjs';
import { signedText, digestOf } from '../lib/sync.mjs';

test('new passphrases need 15 characters; existing shorter passphrases still decrypt', async () => {
  assert.ok(passphraseProblems('Tr0ub4dor&3x').length);
  assert.ok(passphraseProblems('passwordpassword').length);
  assert.deepEqual(passphraseProblems('four unusual random words'), []);
  assert.ok(passphraseProblems('ｐａｓｓｗｏｒｄ１２').length, 'check normalized characters');
  const secret = new Uint8Array(64).fill(7);
  const { record } = await sealWallet(secret, 'old phrase', 'synthetic-address', { iterations: 2000 });
  assert.deepEqual((await openWallet(record, 'old phrase')).secret, secret);
  assert.equal(isSealed({ ...record, iterations: 999_999_999 }), false);
  await assert.rejects(openWallet({ ...record, iterations: 999_999_999 }, 'old phrase'), /damaged/);
});

test('idle locking cannot strand live trading, positions, orders or pending actions', () => {
  const idle = { unlocked: true, lastActive: 1000, now: 1000 + WALLET_IDLE_MS };
  assert.equal(shouldLockWallet(idle), true);
  assert.equal(shouldLockWallet({ ...idle, now: idle.now - 1 }), false);
  for (const protection of ['busy', 'liveRunning', 'liveExposure']) assert.equal(shouldLockWallet({ ...idle, [protection]: true }), false, protection);
  assert.equal(shouldLockWallet({ ...idle, unlocked: false }), false);
});

test('encrypted sync record signatures bind the actual ciphertext and reject substitutions', async () => {
  // Explicit local-only storage: these tests must never use a configured external Redis account.
  for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL']) delete process.env[name];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External requests forbidden in this test'); };
  try {
    const { default: handler } = await import('../api/sync.js');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicBytes = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    const secret = new Uint8Array([...seed, ...publicBytes]), address = toBase58(publicBytes);
    const { record } = await sealWallet(secret, 'unique synthetic test passphrase', address, { iterations: 2000 });
    const id = 'a'.repeat(64), ts = Date.now(), digest = await digestOf(JSON.stringify(record));
    const sig = sign(null, Buffer.from(signedText.record({ id, address, digest, ts })), privateKey).toString('base64');
    const call = async (body) => {
      let code, json;
      await handler({ method: 'POST', body, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, { setHeader() {}, status(n) { code = n; return this; }, json(data) { json = data; } });
      return { code, json };
    };
    assert.equal((await call({ op: 'record', id, ts, record, sig })).code, 200);
    const changed = structuredClone(record);
    const ciphertext = Buffer.from(changed.secret.ct, 'base64'); ciphertext[0] ^= 1; changed.secret.ct = ciphertext.toString('base64');
    assert.equal((await call({ op: 'record', id, ts, record: changed, sig })).code, 403);
    const legacySig = sign(null, Buffer.from(`warrior-sync|record|${id}|${address}|${ts}`), privateKey).toString('base64');
    assert.equal((await call({ op: 'record', id, ts, record: changed, sig: legacySig })).code, 403);
    const attacker = generateKeyPairSync('ed25519'), attackerAddress = toBase58(attacker.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
    const replacement = { ...record, address: attackerAddress };
    const replacementDigest = await digestOf(JSON.stringify(replacement));
    const attackerSig = sign(null, Buffer.from(signedText.record({ id, address: attackerAddress, digest: replacementDigest, ts })), attacker.privateKey).toString('base64');
    assert.equal((await call({ op: 'record', id, ts, record: replacement, sig: attackerSig })).code, 409, 'another wallet cannot replace an existing recovery record');
    const found = await call({ op: 'find', id });
    assert.equal(found.json.record.secret.ct, record.secret.ct, 'the accepted backup was not overwritten');
    assert.deepEqual((await openWallet(found.json.record, 'unique synthetic test passphrase')).secret, secret);
  } finally { globalThis.fetch = originalFetch; }
});
