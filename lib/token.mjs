// Is this coin's token itself safe to trade? Pure: it reads the parsed mint account the Solana network returns.
// Two token programs exist. The original one has no extras. The newer one (Token-2022, used by most new pump.fun coins)
// lets a creator switch on "extensions". Some are harmless, some can take your coins or stop you selling.
// Rule: an extension is allowed only if it is on the harmless list or is provably switched off. Anything Warrior does not
// recognise is refused. Unknown is not safe.

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const set = (v) => v !== null && v !== undefined && v !== '';
// Name, picture and grouping data. They change nothing about how the coin moves.
const HARMLESS = new Set(['metadataPointer', 'tokenMetadata', 'groupPointer', 'tokenGroup', 'groupMemberPointer', 'tokenGroupMember', 'uninitialized']);

/** One extension: null when it is fine, or a plain reason to refuse. */
function extensionProblem(e) {
  const name = e?.extension, s = e?.state ?? {};
  if (HARMLESS.has(name)) return null;
  if (name === 'mintCloseAuthority') return null; // can only close the mint once every coin is gone
  if (name === 'transferFeeConfig') {
    const now = Number(s.newerTransferFee?.transferFeeBasisPoints), old = Number(s.olderTransferFee?.transferFeeBasisPoints);
    if (!(now === 0 && old === 0)) return `it takes a fee on every transfer (${Number.isFinite(Math.max(now, old)) ? `${Math.max(now, old) / 100}%` : 'amount unknown'})`;
    return set(s.transferFeeConfigAuthority) ? 'its creator can switch on a fee on every transfer' : null;
  }
  if (name === 'transferHook') return set(s.programId) ? 'it runs its own code on every transfer, which can block a sale' : set(s.authority) ? 'its creator can attach code that runs on every transfer' : null;
  if (name === 'permanentDelegate') return set(s.delegate) ? 'its creator can take the coins out of any wallet' : null;
  if (name === 'defaultAccountState') return s.accountState === 'initialized' ? null : 'new holders start frozen and cannot sell';
  if (name === 'pausableConfig' || name === 'pausable') return s.paused === true ? 'trading in it is paused' : set(s.authority) ? 'its creator can pause all transfers' : null;
  if (name === 'nonTransferable') return 'it cannot be transferred, so it cannot be sold';
  if (name === 'confidentialTransferMint' || name === 'confidentialTransferFeeConfig' || name === 'confidentialMintBurn') return 'it uses hidden balances, which Warrior cannot check';
  if (name === 'interestBearingConfig' || name === 'scaledUiAmountConfig' || name === 'scaledUiAmount') return 'the balance it shows is not the balance you hold';
  return `it has a feature Warrior does not recognise (${String(name).slice(0, 30)})`;
}

/**
 * `account` is the `value` of getAccountInfo with jsonParsed encoding.
 * Returns { safe, reason, decimals, program, extensions }. `reason` keeps the two classic wordings the safety screen
 * already understands ('creator can freeze it', 'creator can mint more').
 */
export function tokenSafety(account) {
  const info = account?.data?.parsed?.info, owner = account?.owner, program = owner === TOKEN_PROGRAM ? 'token' : owner === TOKEN_2022_PROGRAM ? 'token-2022' : null;
  if (!account || !program || !info || account.data?.parsed?.type !== 'mint') return { safe: false, reason: 'not a standard token', decimals: null, program, extensions: [] };
  const extensions = program === 'token-2022' ? (Array.isArray(info.extensions) ? info.extensions : []) : [], names = extensions.map((e) => String(e?.extension));
  const base = { decimals: Number.isInteger(info.decimals) ? info.decimals : null, program, extensions: names };
  if (set(info.freezeAuthority)) return { ...base, safe: false, reason: 'creator can freeze it' };
  if (set(info.mintAuthority)) return { ...base, safe: false, reason: 'creator can mint more' };
  for (const e of extensions) { const problem = extensionProblem(e); if (problem) return { ...base, safe: false, reason: problem }; }
  return { ...base, safe: true, reason: null };
}
