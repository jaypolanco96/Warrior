import { swapTransaction } from '../lib/jupiter.mjs';
import { checkQuote } from '../lib/risk.mjs';
const mint = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
// Builds an UNSIGNED swap transaction for the visitor's own wallet to review and approve. The server holds no key and sends nothing.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const { quoteResponse, userPublicKey, maxPriorityLamports } = req.body ?? {}, exit = req.body?.exit === true, protect = req.body?.protect === true;
  if (maxPriorityLamports !== undefined && (!Number.isInteger(maxPriorityLamports) || maxPriorityLamports < 0 || maxPriorityLamports > 5_000_000)) return res.status(400).json({ error: 'Priority fee must be 0 to 0.005 SOL.' });
  if (!mint(userPublicKey) || !quoteResponse || !mint(quoteResponse.inputMint) || !mint(quoteResponse.outputMint) || JSON.stringify(quoteResponse).length > 20000) return res.status(400).json({ error: 'Invalid swap request.' });
  const check = checkQuote(quoteResponse, { inputMint: quoteResponse.inputMint, outputMint: quoteResponse.outputMint, amountRaw: quoteResponse.inAmount }, exit ? { maxPriceImpactPct: 10 } : {});
  if (!check.ok) return res.status(400).json({ error: `Quote refused: ${check.reasons.join('; ')}.` });
  try { res.status(200).json(await swapTransaction({ quoteResponse, userPublicKey, maxPriorityLamports, protect, apiKey: process.env.JUPITER_API_KEY })); }
  catch { res.status(503).json({ error: 'Could not build the swap right now. Nothing was traded.' }); }
}
