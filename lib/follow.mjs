// Following a wallet: read what a public wallet bought from its confirmed transactions. Read-only.
// A "buy" is a transaction where the wallet paid SOL (or a dollar coin) and received exactly one other coin.

const SOL = 'So11111111111111111111111111111111111111112';
const BASES = new Set([SOL, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const big = (v) => { try { return /^\d+$/.test(v ?? '') ? BigInt(v) : 0n; } catch { return 0n; } };

/** Returns { mint, tokenRaw, solSpent, at, signature } when the transaction is a buy by `wallet`, else null. */
export function buyFromTransaction(tx, wallet, signature = null) {
  const meta = tx?.meta, keys = tx?.transaction?.message?.accountKeys;
  if (!meta || meta.err || !Array.isArray(keys) || typeof wallet !== 'string') return null;
  const index = keys.findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === wallet); if (index < 0) return null;
  const delta = new Map();
  for (const b of meta.postTokenBalances ?? []) if (b?.owner === wallet && typeof b.mint === 'string') delta.set(b.mint, (delta.get(b.mint) ?? 0n) + big(b.uiTokenAmount?.amount));
  for (const b of meta.preTokenBalances ?? []) if (b?.owner === wallet && typeof b.mint === 'string') delta.set(b.mint, (delta.get(b.mint) ?? 0n) - big(b.uiTokenAmount?.amount));
  const lamports = BigInt(meta.postBalances?.[index] ?? 0) - BigInt(meta.preBalances?.[index] ?? 0) + (delta.get(SOL) ?? 0n);
  const gained = [...delta].filter(([mint, d]) => !BASES.has(mint) && d > 0n), lostOther = [...delta].some(([mint, d]) => !BASES.has(mint) && d < 0n);
  const paidBase = lamports < 0n || [...delta].some(([mint, d]) => BASES.has(mint) && mint !== SOL && d < 0n);
  // Coin-for-coin swaps, transfers in and airdrops are not buys.
  if (gained.length !== 1 || lostOther || !paidBase) return null;
  const at = Number.isFinite(tx.blockTime) ? tx.blockTime * 1000 : null;
  return { mint: gained[0][0], tokenRaw: gained[0][1].toString(), solSpent: lamports < 0n ? Number(-lamports) / 1e9 : null, at, signature: signature ?? tx.transaction?.signatures?.[0] ?? null };
}

/** Buys that happened after you started following and that you have not been shown yet, oldest first. */
export function newBuys(buys, { since = 0, seen = [] } = {}) {
  const known = new Set(seen);
  return (buys ?? []).filter((b) => b && b.signature && !known.has(b.signature) && Number.isFinite(b.at) && b.at >= since).sort((a, b) => a.at - b.at);
}
