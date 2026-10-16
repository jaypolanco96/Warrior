import test from 'node:test';
import assert from 'node:assert/strict';
import { closableAccounts, CLOSE_ACCOUNT_DATA, sealWallet, openWallet, addDeviceKey, openWithDeviceKey, isSealed, passphraseProblems, toBase58, fromBase58, parseBackupKey, sweepLamports, unexpectedPrograms, SWAP_PROGRAMS, KDF_ITERATIONS } from '../lib/vault.mjs';

const secret = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256), ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', FAST = { iterations: 2000 };

test('a sealed wallet opens only with its passphrase, and the stored record holds no readable key', async () => {
  const { record, dataKey } = await sealWallet(secret, 'correct horse battery', ADDR, FAST);
  assert.equal(isSealed(record), true); assert.equal(record.address, ADDR); assert.equal(dataKey.length, 32);
  const stored = JSON.stringify(record); assert.ok(!stored.includes(toBase58(secret))); assert.ok(!stored.includes(Buffer.from(secret).toString('base64').slice(0, 24)));
  assert.deepEqual((await openWallet(record, 'correct horse battery')).secret, secret);
  await assert.rejects(openWallet(record, 'correct horse batterz'), /Wrong passphrase/);
  await assert.rejects(openWallet(record, ''), /Wrong passphrase/);
  // The same key sealed twice gives different records: fresh salt and nonces every time.
  assert.notEqual(JSON.stringify((await sealWallet(secret, 'correct horse battery', ADDR, FAST)).record), stored);
  assert.ok(KDF_ITERATIONS >= 600_000, 'the shipped work factor stays at or above current guidance');
});

test('tampering is detected, and a record cannot be moved to another wallet address', async () => {
  const { record } = await sealWallet(secret, 'correct horse battery', ADDR, FAST);
  const flip = (s) => { const b = Buffer.from(s, 'base64'); b[0] ^= 1; return b.toString('base64'); };
  await assert.rejects(openWallet({ ...record, secret: { ...record.secret, ct: flip(record.secret.ct) } }, 'correct horse battery'), /Wrong passphrase/);
  await assert.rejects(openWallet({ ...record, wrapped: { ...record.wrapped, ct: flip(record.wrapped.ct) } }, 'correct horse battery'), /Wrong passphrase/);
  await assert.rejects(openWallet({ ...record, address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' }, 'correct horse battery'), /Wrong passphrase/);
  await assert.rejects(openWallet({ v: 2 }, 'x'), /damaged/); await assert.rejects(openWallet({ ...record, iterations: 1 }, 'correct horse battery'), /damaged/);
  await assert.rejects(sealWallet(new Uint8Array(32), 'correct horse battery', ADDR, FAST), /Not a wallet key/);
});

test('a device passkey is a second way in, and the wrong one is refused', async () => {
  const { record, dataKey } = await sealWallet(secret, 'correct horse battery', ADDR, FAST), device = Uint8Array.from({ length: 32 }, (_, i) => i);
  const withKey = await addDeviceKey(record, dataKey, device, 'cred-1', 'c2FsdA==');
  assert.deepEqual((await openWithDeviceKey(withKey, device)).secret, secret); assert.deepEqual((await openWallet(withKey, 'correct horse battery')).secret, secret, 'the passphrase still works');
  await assert.rejects(openWithDeviceKey(withKey, new Uint8Array(32).fill(9)), /does not open/); await assert.rejects(openWithDeviceKey(record, device), /No passkey/);
  await assert.rejects(addDeviceKey(record, dataKey, new Uint8Array(8), 'x', 'y'), /unavailable/);
});

test('passphrase rules are plain: long enough, not repetitive, not famous', () => {
  assert.deepEqual(passphraseProblems('correct horse battery'), []); assert.deepEqual(passphraseProblems('Tr0ub4dor&3x'), []);
  assert.equal(passphraseProblems('short').length, 1); assert.equal(passphraseProblems('aaaaaaaaaaaa').length, 1); assert.equal(passphraseProblems('1234567890').length, 1); assert.equal(passphraseProblems(null).length, 1);
});

test('backup keys: base58 and number lists both restore, and junk is refused', () => {
  assert.deepEqual(fromBase58(toBase58(secret)), secret); assert.deepEqual(fromBase58(toBase58(Uint8Array.from([0, 0, 5]))), Uint8Array.from([0, 0, 5]));
  assert.equal(toBase58(Uint8Array.from(Buffer.from('Hello World!'))), '2NEpo7TZRRrLZSi2U'); assert.equal(fromBase58('0OIl'), null); assert.equal(fromBase58(''), null);
  assert.deepEqual(parseBackupKey(`  ${toBase58(secret)}  `), secret); assert.deepEqual(parseBackupKey(JSON.stringify([...secret])), secret);
  assert.equal(parseBackupKey(toBase58(secret.slice(0, 32))), null, 'a 32-byte value is an address or a seed, not a wallet key'); assert.equal(parseBackupKey('[1,2,3]'), null); assert.equal(parseBackupKey('not a key'), null); assert.equal(parseBackupKey(JSON.stringify([...secret].map((n) => n + 300))), null);
});

test('sweep sends only spare SOL, only when nothing is open, and only to a set address', () => {
  const base = { on: true, to: ADDR, keepSol: 0.2, openPositions: 0, balanceLamports: 0.5e9 };
  assert.equal(sweepLamports(base), 0.3e9 - 5000);
  assert.equal(sweepLamports({ ...base, openPositions: 1 }), 0, 'never while a position is open');
  assert.equal(sweepLamports({ ...base, on: false }), 0); assert.equal(sweepLamports({ ...base, to: '' }), 0); assert.equal(sweepLamports({ ...base, to: 'not-an-address' }), 0);
  assert.equal(sweepLamports({ ...base, balanceLamports: 0.205e9 }), 0, 'dust is not worth a fee'); assert.equal(sweepLamports({ ...base, balanceLamports: 0.1e9 }), 0);
  assert.equal(sweepLamports({ ...base, keepSol: -1 }), 0); assert.equal(sweepLamports({ ...base, balanceLamports: NaN }), 0);
});

test('a swap may only call the programs a Jupiter swap needs', () => {
  assert.deepEqual(unexpectedPrograms(Object.keys(SWAP_PROGRAMS)), []);
  assert.deepEqual(unexpectedPrograms(['11111111111111111111111111111111', 'Evi1111111111111111111111111111111111111111', 'Evi1111111111111111111111111111111111111111']), ['Evi1111111111111111111111111111111111111111']);
});

test('only truly empty coin accounts are ever closed', async () => {
  const { receipt, entryCosts } = await import('../lib/receipt.mjs');
  const T = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', B = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
  const acct = (o) => ({ address: A, mint: B, amount: '0', program: T, lamports: 2039280, ...o });
  assert.equal(closableAccounts([acct({})]).length, 1); assert.equal(closableAccounts([acct({ program: T22 })]).length, 1);
  assert.equal(closableAccounts([acct({ amount: '1' })]).length, 0, 'an account holding even one unit is never closed');
  assert.equal(closableAccounts([acct({ amount: 0 })]).length, 0, 'the amount must be the exact text "0" the network returned'); assert.equal(closableAccounts([acct({ amount: undefined })]).length, 0);
  assert.equal(closableAccounts([acct({ program: 'SomeOtherProgram1111111111111111111111111111' })]).length, 0); assert.equal(closableAccounts([acct({ address: 'bad' })]).length, 0);
  assert.equal(closableAccounts([acct({}), acct({ mint: A })], { mint: A }).length, 1, 'after a sale, only that coin\'s account'); assert.equal(closableAccounts(Array.from({ length: 20 }, () => acct({}))).length, 8);
  assert.equal(closableAccounts(null).length, 0); assert.deepEqual([...CLOSE_ACCOUNT_DATA], [9]);
  const r = receipt({ mode: 'live', solIn: 0.0278, solOut: 0.0281, rentBackSol: 0.00204, costs: { entry: entryCosts({ requestedSol: 0.025, spentSol: 0.0278, impactPct: 1 }), exitImpactPct: 1, exitQuotedSol: 0.0262 } });
  assert.ok(r.lines.some((l) => l.kind === 'back' && l.sol === 0.00204)); assert.ok(!receipt({ mode: 'live', solIn: 1, solOut: 1 }).lines.some((l) => l.kind === 'back'));
});
