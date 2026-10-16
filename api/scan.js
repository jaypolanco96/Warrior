import { scan } from '../lib/scan.mjs';
import { fromQuery } from '../lib/presets.mjs';
// Public, read-only market scan under the visitor's chosen rules. Cached at the edge per rule set so visitors do not
// exhaust the data allowance.
export default async function handler(req, res) {
  let rules; try { rules = fromQuery(req.query ?? {}); } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: `Those settings are not valid: ${e.message}.` }); }
  try {
    const started = Date.now(), result = await scan({ mature: req.query?.mature === '1', limit: 36, settings: rules.settings, risk: rules.risk });
    // A scan where some candles could not be read is kept only briefly, so the next visitor gets a fuller one.
    const incomplete = result.results.some((t) => t.bars === 0);
    res.setHeader('Cache-Control', incomplete ? 'public, s-maxage=20' : 'public, s-maxage=20, stale-while-revalidate=30');
    res.status(200).json({ ...result, tookMs: Date.now() - started, rules: { risk: rules.risk, settings: rules.settings, version: rules.version, preset: rules.preset } });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Market data is unavailable right now. Nothing was traded.' });
  }
}
