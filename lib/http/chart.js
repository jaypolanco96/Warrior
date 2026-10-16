import { candles } from '../market.mjs';
import { isAddress } from '../rpc.mjs';
// Read-only: the last hour of one-minute closing prices for one coin, for the small line chart on a position card.
// It is a picture of where the price has been. It predicts nothing.
export default async function handler(req, res) {
  const mint = req.query?.mint, pool = req.query?.pool;
  if (!isAddress(mint) || !isAddress(pool)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Invalid coin address.' }); }
  try {
    const rows = await candles(pool, 60, Date.now(), 1, mint), points = rows.slice(-60).map((c) => [c.t, c.close]);
    res.setHeader('Cache-Control', 'public, s-maxage=20');
    res.status(200).json({ mint, minutes: 1, points, source: rows.source ?? null, at: Date.now() });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The chart is unavailable right now.' }); }
}
