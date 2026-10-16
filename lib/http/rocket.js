import { rocketPools } from '../market.mjs';
import { rocketList, smartBuyers } from '../smart.mjs';
import { rocketCandidate, rocketScreen, rocketRank, earlyScreen, rocketLimits, earlyLimits, ROCKET_LEVELS, ROCKET_SCREEN } from '../rocket.mjs';
// Read-only: brand-new pump.fun coins (about one to sixty minutes old), each with the Rocket screen's answer and the
// creator's record. Passing the screen does not make a coin safe; it means none of the known warning signs showed.
export default async function handler(req, res) {
  try {
    const now = Date.now(), seen = (await rocketPools()).map((p) => rocketCandidate(p, now)).filter((c) => c && Number.isFinite(c.ageMin) && c.ageMin <= ROCKET_SCREEN.maxAgeMin + 5);
    // How strict the screen is follows the strategy dial: level=spicy loosens it. Anything else is the standard screen.
    const level = Object.hasOwn(ROCKET_LEVELS, req.query?.level) ? req.query.level : 'balanced', L = rocketLimits(level), E = earlyLimits(level);
    const judged = seen.map((c) => ({ ...c, screen: rocketScreen(c, L), early: earlyScreen(c, E) })), coins = rocketRank(judged).slice(0, 30);
    // Launches still on the curve that pass the early screen, strongest buying first. Only used when the early lane is switched on.
    const early = judged.filter((c) => c.early.ok).sort((a, b) => (b.buyUsd5m - (b.sellUsd5m ?? 0)) - (a.buyUsd5m - (a.sellUsd5m ?? 0))).slice(0, 10);
    // Copy filter: how many launch wallets (wallets ahead on recent launches) bought each passing coin in the last ten minutes.
    const list = await rocketList().catch(() => null);
    if (list?.set?.size) await Promise.all(coins.filter((c) => c.screen.ok).slice(0, 8).map(async (c) => { try { c.copy = { count: (await smartBuyers(c.mint, list.set, { now, minutes: 10 })).count }; } catch { c.copy = { count: null }; } }));
    res.setHeader('Cache-Control', 'public, s-maxage=15');
    res.status(200).json({ at: new Date(now).toISOString(), coins, early, seen: seen.length, passing: coins.filter((c) => c.screen.ok).length, onCurve: judged.filter((c) => !c.graduated).length, copyList: list?.info ?? null, level, limits: L, earlyLimits: E });
  } catch { res.setHeader('Cache-Control', 'no-store'); res.status(503).json({ error: 'The launch feed is unavailable right now. No Rocket bets are placed without it.' }); }
}
