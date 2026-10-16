import { priceFacts } from '../market.mjs';
import { isAddress } from '../rpc.mjs';
// Read-only: current USD prices for a short list of coins. Used to check orders, own stops and the portfolio.
export default async function handler(req, res) {
  const list = typeof req.query?.mints === 'string' ? req.query.mints.split(',').filter(Boolean) : [];
  if (!list.length || list.length > 30 || !list.every(isAddress)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Send 1 to 30 coin addresses.' }); }
  try { const out = await priceFacts(list); res.setHeader('Cache-Control', 'public, s-maxage=3'); res.status(200).json({ prices: out.prices, liquidity: out.liquidity, at: Date.now() }); }
  catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'Prices are unavailable right now.' }); }
}
