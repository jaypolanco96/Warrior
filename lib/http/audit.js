import { launchRecord, candles } from '../market.mjs';
import { dipCheck } from '../indicators.mjs';
import { rocketCandidate, launchAudit, earlyLimits, ROCKET_LEVELS } from '../rocket.mjs';
import { isAddress } from '../rpc.mjs';
// Read-only: does this coin's launch look staged? Checked at the moment of every automatic buy.
// Applies to coins in their first two days. An older coin, or one the feed does not know, is not judged here.
export default async function handler(req, res) {
  const mint = req.query?.mint; if (!isAddress(mint)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'Invalid coin address.' }); }
  try {
    // watch=1: a quick re-read of a coin already held (no search for same-named coins), for the sell-off and holder checks.
    const watch = req.query?.watch === '1', { asset, others } = await launchRecord(mint, { lite: watch }), now = Date.now();
    if (!asset) { res.setHeader('Cache-Control', 'public, s-maxage=60'); return res.status(200).json({ mint, ok: true, judged: false, reasons: [], note: 'The launch feed does not know this coin.' }); }
    const c = rocketCandidate({ id: asset.graduatedPool ?? asset.firstPool?.id ?? mint, dex: '', liquidity: asset.liquidity, bondingCurve: asset.bondingCurve, baseAsset: asset }, now);
    if (!c || !Number.isFinite(c.ageMin) || c.ageMin > 48 * 60) { res.setHeader('Cache-Control', 'public, s-maxage=300'); return res.status(200).json({ mint, ok: true, judged: false, reasons: [], note: 'Older than two days: launch checks do not apply.' }); }
    // An early bet is judged on the early crowd size; everything else in the launch check stays the same.
    const level = Object.hasOwn(ROCKET_LEVELS, req.query?.level) ? req.query.level : 'balanced';
    const audit = launchAudit(c, others, { ...ROCKET_LEVELS[level], ...(req.query?.early === '1' ? (({ minTraders, organicGraceMin, organicGraceHoldPct }) => ({ minTraders, ...(organicGraceMin ? { organicGraceMin, organicGraceHoldPct } : {}) }))(earlyLimits(level)) : {}) });
    res.setHeader('Cache-Control', 'public, s-maxage=20');
    if (watch) { res.setHeader('Cache-Control', 'public, s-maxage=8'); return res.status(200).json({ mint, judged: true, watch: true, holders: c.holders, traders: c.traders, topHoldersPct: c.topHoldersPct, buyUsd5m: c.buyUsd5m, sellUsd5m: c.sellUsd5m, buys5m: c.buys5m, sells5m: c.sells5m, change5mPct: c.change5mPct, at: now }); }
    // trend=1 (every Rocket bet): is it being bought into a dip? SuperTrend on one-minute candles when there are enough, the
    // last candles when there are not. If the candles cannot be read, that is said, and the bet is not refused for it.
    let trend = null;
    if (req.query?.trend === '1') { const pool = isAddress(req.query?.pool) ? req.query.pool : c.pool; try { trend = dipCheck(await candles(pool, 30, now, 1, mint), c.priceUsd); } catch { trend = { ok: true, known: false, reason: null, candles: 0 }; } if (!trend.ok) audit.reasons.push(trend.reason); }
    if (trend && !trend.ok) audit.ok = false;
    res.status(200).json({ mint, ok: audit.ok, judged: true, reasons: audit.reasons, clones: audit.clones, trend, priceUsd: c.priceUsd, topHoldersPct: c.topHoldersPct, ageMin: c.ageMin, traders: c.traders, holders: c.holders, bundlerPeakPct: c.bundlerPeakPct, bundles: c.bundles, curveSecs: c.curveSecs, creator: c.creator });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The launch record is unavailable right now.' }); }
}
