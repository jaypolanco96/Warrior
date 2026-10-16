import { tokenInfo, SOL } from '../market.mjs';
import { quote } from '../jupiter.mjs';
import { safetyReport } from '../safety.mjs';
import { isAddress } from '../rpc.mjs';
import { unlockedPool } from '../risk.mjs';
const n = (v) => { const x = Number(v); return typeof v === 'string' && v !== '' && Number.isFinite(x) ? x : null; };
// Read-only: the deeper safety panel for one coin. Holder spread, creator share and launch come from the data source;
// depth is what a 1 SOL and a 5 SOL buy would cost right now. Anything that cannot be read is reported as unknown.
export default async function handler(req, res) {
  const mint = req.query?.mint; if (!isAddress(mint)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Invalid coin address.' }); }
  const token = { createdAt: n(req.query?.created), liquidityUsd: n(req.query?.liq), pump: mint.endsWith('pump'), unlockedPool: unlockedPool({ mint, dex: typeof req.query?.dex === 'string' ? req.query.dex : null }) };
  const depthFor = async (sol) => { try { const q = await quote({ inputMint: SOL, outputMint: mint, amountRaw: String(sol * 1e9), apiKey: process.env.JUPITER_API_KEY }); const impact = Math.abs(Number(q.priceImpactPct)); return { sol, impactPct: Number.isFinite(impact) ? impact * 100 : NaN }; } catch { return { sol, impactPct: NaN }; } };
  const [info, d1, d5] = await Promise.all([tokenInfo(mint).catch(() => null), depthFor(1), depthFor(5)]);
  const report = safetyReport({ info, token, depth: [d1, d5] });
  res.setHeader('Cache-Control', info ? 'public, s-maxage=300' : 'no-store');
  res.status(200).json({ mint, name: info?.name ?? null, ...report, source: 'Holders, creator and launch: GeckoTerminal. Depth: live Jupiter quotes.' });
}
