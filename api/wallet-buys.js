import { rpc, isAddress } from '../lib/rpc.mjs';
import { buyFromTransaction } from '../lib/follow.mjs';
// Read-only: what a public wallet bought recently, from its confirmed transactions. Only a public address is needed.
export default async function handler(req, res) {
  const wallet = req.query?.wallet; if (!isAddress(wallet)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Invalid wallet address.' }); }
  try {
    const sigs = ((await rpc('getSignaturesForAddress', [wallet, { limit: 12 }])) ?? []).filter((s) => !s.err && typeof s.signature === 'string').slice(0, 8), buys = []; let unread = 0;
    for (const s of sigs) {
      try { const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); const buy = buyFromTransaction(tx, wallet, s.signature); if (buy) buys.push(buy); }
      catch { unread++; }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=45');
    res.status(200).json({ wallet, buys, checked: sigs.length, unread });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'That wallet could not be read right now.' }); }
}
