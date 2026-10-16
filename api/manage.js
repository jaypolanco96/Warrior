import { candles } from '../lib/market.mjs';
import { manage, validateSettings } from '../lib/strategy.mjs';
import { isAddress } from '../lib/rpc.mjs';
import { fromQuery } from '../lib/presets.mjs';
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
// Read-only: for each open position, say hold or exit under the rules. The caller decides and signs; nothing is traded here.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const list = req.body?.positions;
  if (req.method !== 'POST' || !Array.isArray(list) || list.length > 6) return res.status(400).json({ error: 'Up to six positions.' });
  let settings = {}; try { settings = fromQuery(req.body?.rules ?? {}).settings; } catch { return res.status(400).json({ error: 'Those settings are not valid.' }); }
  const out = [];
  for (const p of list) {
    if (!isAddress(p?.pool) || !num(p.entry) || !num(p.stop) || !num(p.target) || !num(p.entryBar)) { out.push({ pool: p?.pool ?? null, action: 'hold', stale: true, reasons: ['Invalid position'] }); continue; }
    try {
      // A Rocket position carries its own exit plan (trailing stop start and distance, no time or trend exit).
      let use = settings; if (p.exits && typeof p.exits === 'object') { const own = Object.fromEntries(['trailing', 'trailStartPct', 'trailGapPct', 'trendExit', 'holdHours'].filter((k) => typeof p.exits[k] === 'number').map((k) => [k, p.exits[k]])); try { use = validateSettings({ ...settings, ...own }); } catch { use = settings; } }
      const tf = p.tf === 1 ? 1 : 5, bars = await candles(p.pool, tf === 1 ? 400 : 120, Date.now(), tf, isAddress(p.mint) ? p.mint : null), m = manage({ entry: p.entry, stop: p.stop, target: p.target, entryBar: p.entryBar, ...(num(p.openedAt) ? { openedAt: p.openedAt } : {}), peak: num(p.peak) ? p.peak : p.entry, tf, ...(num(p.baseStop) ? { baseStop: p.baseStop } : {}), ...(p.dip === 1 ? { dip: 1 } : {}), ...(p.style === 'smart' ? { style: 'smart' } : {}) }, bars, use);
      const fresh = bars.length > 0 && Date.now() - bars.at(-1).t <= 15 * 60_000;
      out.push({ pool: p.pool, ...(fresh ? m : { action: 'hold', stale: true, reasons: ['Candles are stale; holding'] }), lastPrice: bars.at(-1)?.close ?? null });
    } catch { out.push({ pool: p.pool, action: 'hold', stale: true, reasons: ['Candles unavailable; holding'] }); }
  }
  res.status(200).json({ results: out });
}
