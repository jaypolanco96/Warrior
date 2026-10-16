import { rpc } from '../lib/rpc.mjs';
// Read-only: a recent blockhash, needed to build a plain SOL transfer in the browser.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try { const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); res.status(200).json({ blockhash: r.value.blockhash, lastValidBlockHeight: r.value.lastValidBlockHeight }); }
  catch { res.status(503).json({ error: 'Chain unavailable right now.' }); }
}
