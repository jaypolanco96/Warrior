import { searchPools } from '../market.mjs';
import { lookupCoin } from '../scan.mjs';
import { fromQuery } from '../presets.mjs';
import { isAddress, mintSafety } from '../rpc.mjs';
// Read-only: look up any coin. An address gets Warrior's full verdict; a name gets a short list of matching coins to pick from.
export default async function handler(req, res) {
  const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
  let rules; try { rules = fromQuery(req.query ?? {}); } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: `Those settings are not valid: ${e.message}.` }); }
  if (q.length < 2 || q.length > 60) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Type a coin name, a ticker, or paste a coin address.' }); }
  try {
    if (!isAddress(q)) {
      const matches = (await searchPools(q)).slice(0, 6).map((t) => ({ mint: t.mint, symbol: t.symbol, dex: t.dex, pump: t.pump, priceUsd: t.priceUsd, liquidityUsd: t.liquidityUsd, volume24hUsd: t.volume24hUsd }));
      res.setHeader('Cache-Control', 'public, s-maxage=120'); return res.status(200).json({ matches });
    }
    const token = await lookupCoin(q, rules, mintSafety);
    if (!token) { res.setHeader('Cache-Control', 'public, s-maxage=60'); return res.status(404).json({ error: 'No pool trading this coin against SOL or a dollar coin was found. Check the address.' }); }
    const { verified, ...rest } = token;
    res.setHeader('Cache-Control', verified ? 'public, s-maxage=60, stale-while-revalidate=60' : 'no-store');
    res.status(200).json({ token: rest, rules: { version: rules.version, preset: rules.preset } });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'Coin data is unavailable right now. Try again in a moment.' }); }
}
