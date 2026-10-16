import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenSafety, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../lib/token.mjs';

const mint = (owner, info = {}, type = 'mint') => ({ owner, data: { parsed: { type, info: { decimals: 6, freezeAuthority: null, mintAuthority: null, ...info } } } });
const meta = [{ extension: 'metadataPointer', state: { authority: null, metadataAddress: 'x' } }, { extension: 'tokenMetadata', state: { name: 'Coin', symbol: 'C', updateAuthority: null } }];
const t22 = (...extra) => mint(TOKEN_2022_PROGRAM, { extensions: [...meta, ...extra] });
const fee = (now, old, authority = null) => ({ extension: 'transferFeeConfig', state: { newerTransferFee: { transferFeeBasisPoints: now }, olderTransferFee: { transferFeeBasisPoints: old }, transferFeeConfigAuthority: authority } });

test('the original token type: safe unless the creator kept freeze or mint power', () => {
  assert.deepEqual(tokenSafety(mint(TOKEN_PROGRAM)), { decimals: 6, program: 'token', extensions: [], safe: true, reason: null });
  assert.equal(tokenSafety(mint(TOKEN_PROGRAM, { freezeAuthority: 'someone' })).reason, 'creator can freeze it');
  assert.equal(tokenSafety(mint(TOKEN_PROGRAM, { mintAuthority: 'someone' })).reason, 'creator can mint more');
});

test('the newer token type with only name-and-picture data is safe', () => {
  const r = tokenSafety(t22()); assert.equal(r.safe, true); assert.equal(r.program, 'token-2022'); assert.deepEqual(r.extensions, ['metadataPointer', 'tokenMetadata']);
  assert.equal(tokenSafety(mint(TOKEN_2022_PROGRAM, {})).safe, true, 'no extensions at all');
  assert.equal(tokenSafety(t22({ extension: 'mintCloseAuthority', state: { closeAuthority: 'x' } })).safe, true);
  assert.equal(tokenSafety(mint(TOKEN_2022_PROGRAM, { extensions: meta, freezeAuthority: 'x' })).reason, 'creator can freeze it', 'the classic checks still apply');
});

test('every extension that can take coins or block a sale is refused, with a plain reason', () => {
  const refused = (account, pattern) => { const r = tokenSafety(account); assert.equal(r.safe, false); assert.match(r.reason, pattern); };
  refused(t22(fee(100, 0)), /takes a fee on every transfer \(1%\)/); refused(t22(fee(0, 250)), /fee on every transfer \(2\.5%\)/); refused(t22(fee(0, 0, 'creator')), /can switch on a fee/);
  assert.equal(tokenSafety(t22(fee(0, 0))).safe, true, 'a fee of zero that nobody can change is fine');
  refused(t22({ extension: 'transferFeeConfig', state: {} }), /amount unknown/);
  refused(t22({ extension: 'transferHook', state: { authority: null, programId: 'prog' } }), /runs its own code on every transfer/);
  refused(t22({ extension: 'transferHook', state: { authority: 'creator', programId: null } }), /can attach code/);
  assert.equal(tokenSafety(t22({ extension: 'transferHook', state: { authority: null, programId: null } })).safe, true, 'a hook that is off and cannot be turned on');
  refused(t22({ extension: 'permanentDelegate', state: { delegate: 'creator' } }), /take the coins out of any wallet/);
  assert.equal(tokenSafety(t22({ extension: 'permanentDelegate', state: { delegate: null } })).safe, true);
  refused(t22({ extension: 'defaultAccountState', state: { accountState: 'frozen' } }), /start frozen/);
  assert.equal(tokenSafety(t22({ extension: 'defaultAccountState', state: { accountState: 'initialized' } })).safe, true);
  refused(t22({ extension: 'pausableConfig', state: { authority: 'creator', paused: false } }), /can pause all transfers/); refused(t22({ extension: 'pausableConfig', state: { authority: null, paused: true } }), /is paused/);
  refused(t22({ extension: 'nonTransferable', state: {} }), /cannot be sold/);
  refused(t22({ extension: 'confidentialTransferMint', state: {} }), /hidden balances/);
  refused(t22({ extension: 'interestBearingConfig', state: {} }), /not the balance you hold/);
});

test('unknown is not safe', () => {
  assert.match(tokenSafety(t22({ extension: 'somethingNew2027', state: {} })).reason, /does not recognise \(somethingNew2027\)/);
  assert.equal(tokenSafety(null).reason, 'not a standard token'); assert.equal(tokenSafety(mint('SomeOtherProgram1111111111111111111111111111')).reason, 'not a standard token');
  assert.equal(tokenSafety(mint(TOKEN_2022_PROGRAM, {}, 'account')).reason, 'not a standard token', 'a token account is not a mint');
  assert.equal(tokenSafety({ owner: TOKEN_PROGRAM, data: ['base64', 'x'] }).reason, 'not a standard token', 'unparsed data is not trusted');
});
