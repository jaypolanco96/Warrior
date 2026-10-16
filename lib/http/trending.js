import { trending } from '../market.mjs';
import { screenToken } from '../risk.mjs';
import { fromQuery } from '../presets.mjs';
// Read-only: what is trending on Solana right now, hottest first, each with the safety screen's answer.
// One call to the data source and no candles, so it is quick. The full verdict for a coin comes from the lookup.
const WINDOWS = { '5m': 'm5', '1h': 'h1', '6h': 'h6', '24h': 'h24' };
export default async function handler(req, res) {
  const window = typeof req.query?.window === 'string' && req.query.window in WINDOWS ? req.query.window : '1h';
  let rules; try { rules = fromQuery(req.query ?? {}); } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: `Those settings are not valid: ${e.message}.` }); }
  try {
    const now = Date.now(), coins = (await trending(window)).slice(0, 20).map((t, i) => { const screen = screenToken(t, rules.risk, now); return { rank: i + 1, mint: t.mint, symbol: t.symbol, pool: t.pool, dex: t.dex, pump: t.pump, priceUsd: t.priceUsd, changePct: t.change?.[WINDOWS[window]] ?? null, change: t.change, liquidityUsd: t.liquidityUsd, volume24hUsd: t.volume24hUsd, volume1hUsd: t.volume1hUsd, marketValueUsd: t.fdvUsd ?? null, createdAt: t.createdAt, screen: { ok: screen.ok, reasons: screen.reasons } }; });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
    res.status(200).json({ window, at: new Date(now).toISOString(), coins, passing: coins.filter((c) => c.screen.ok).length });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The trending list is unavailable right now. Try again in a moment.' }); }
}
