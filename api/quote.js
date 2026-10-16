import { quote } from '../lib/jupiter.mjs';
import { checkQuote, defaultRisk } from '../lib/risk.mjs';
const mint = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
// Read-only: asks Jupiter what a swap would give right now. Nothing is signed or sent here.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { inputMint, outputMint, amount, slip } = req.query ?? {}, exit = req.query?.exit === '1';
  if (slip !== undefined && (!/^\d{2,4}$/.test(slip) || Number(slip) < 10 || Number(slip) > 1000)) return res.status(400).json({ error: 'Slippage limit must be 0.1% to 10%.' });
  const entrySlip = slip === undefined ? defaultRisk.slippageBps : Number(slip);
  // A fast-moving new coin reads as a higher "price impact" than it has, because the figure is measured against a price that is
  // seconds old. A Rocket bet may allow up to 6%; the separate round-trip check still refuses anything that costs too much.
  const impact = req.query?.impact; if (impact !== undefined && (!/^\d(\.\d)?$/.test(impact) || Number(impact) < 1 || Number(impact) > 6)) return res.status(400).json({ error: 'Price impact allowance must be 1% to 6%.' });
  if (!mint(inputMint) || !mint(outputMint) || inputMint === outputMint || !/^\d{1,20}$/.test(amount ?? '') || BigInt(amount) <= 0n) return res.status(400).json({ error: 'Invalid swap request.' });
  try {
    const q = await quote({ inputMint, outputMint, amountRaw: amount, slippageBps: exit ? Math.max(300, entrySlip) : entrySlip, apiKey: process.env.JUPITER_API_KEY });
    // Getting out matters more than the price: an exit tolerates more cost than an entry, but still refuses an absurd one.
    res.status(200).json({ quote: q, check: checkQuote(q, { inputMint, outputMint, amountRaw: amount }, exit ? { maxPriceImpactPct: 10 } : impact !== undefined ? { maxPriceImpactPct: Number(impact) } : {}) });
  } catch { res.status(503).json({ error: 'No quote available right now. Nothing was traded.' }); }
}
