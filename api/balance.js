const mint = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const rpc = async (method, params) => {
  const r = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  const j = await r.json(); if (j.error || j.result === undefined) throw new Error('rpc'); return j.result;
};
// Read-only wallet balances: SOL, and optionally one token. A public address is all that is needed.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { owner, mint: token } = req.query ?? {}, empty = req.query?.empty === '1';
  if (!mint(owner) || (token !== undefined && !mint(token))) return res.status(400).json({ error: 'Invalid address.' });
  try {
    const lamports = (await rpc('getBalance', [owner, { commitment: 'confirmed' }])).value;
    let tokenRaw = null, decimals = null;
    if (token) {
      const accounts = (await rpc('getTokenAccountsByOwner', [owner, { mint: token }, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value ?? [];
      let total = 0n; for (const a of accounts) { const t = a.account?.data?.parsed?.info?.tokenAmount; if (t && /^\d+$/.test(t.amount)) { total += BigInt(t.amount); decimals = t.decimals; } }
      tokenRaw = total.toString();
    }
    // With empty=1: this wallet's coin accounts that hold nothing, so their rent can be reclaimed. Both token programs.
    let emptyAccounts;
    if (empty) {
      emptyAccounts = [];
      for (const programId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
        const list = (await rpc('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value ?? [];
        for (const a of list) { const info = a.account?.data?.parsed?.info; if (info?.tokenAmount?.amount === '0') emptyAccounts.push({ address: a.pubkey, mint: info.mint, amount: '0', program: programId, lamports: a.account.lamports }); }
      }
    }
    res.status(200).json({ owner, lamports, sol: lamports / 1e9, tokenRaw, decimals, ...(empty ? { emptyAccounts } : {}) });
  } catch { res.status(503).json({ error: 'Balance unavailable right now.' }); }
}
