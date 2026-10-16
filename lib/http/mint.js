import { isAddress, mintSafety } from '../rpc.mjs';
// Read-only safety check: can the creator freeze this coin or mint more of it? Unknown is treated as unsafe.
export default async function handler(req, res) {
  const mint = req.query?.mint; if (!isAddress(mint)) return res.status(400).json({ error: 'Invalid mint.' });
  const { verified, ...out } = await mintSafety(mint);
  res.setHeader('Cache-Control', verified ? 'public, s-maxage=300' : 'no-store'); res.status(200).json(out);
}
