// Smart wallets: wallets that kept buying regular coins in the 20 minutes before a big pump (+20% within two hours), on
// at least two different coins, and never at an ordinary moment. scripts/smart-wallets.mjs rebuilds the list every six
// hours into public/smart-wallets.json.
//
// Measured October 14, 2026 (34 coins, 207 pumps, 409 ordinary moments, three and a half days). Wallets were picked on the
// first 60% of the time and tested on the last 40%, which they were never picked from. In the test part 32% of the
// moments were pumps; where one or more smart wallets bought, 49%; where two or more bought, 71% (14 moments). That says a
// pump followed more often. It does not say a trade made money after costs: that is what practice mode is for.

const SITE = (typeof process !== 'undefined' && process.env?.WARRIOR_SITE) || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://WARRIOR_HOST');
const caches = new Map();
/** A wallet list published on the site (cached ten minutes). Empty when it cannot be read or is older than `maxHours`. */
async function listFrom(file, maxHours) {
  const cache = caches.get(file); if (cache?.set && Date.now() - cache.at < 10 * 60_000) return cache;
  let next;
  try {
    const r = await fetch(`${SITE}/${file}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error(String(r.status));
    const j = await r.json(), fresh = Number.isFinite(Date.parse(j.at)) && Date.now() - Date.parse(j.at) < maxHours * 3_600_000;
    next = { at: Date.now(), set: new Set(fresh && Array.isArray(j.wallets) ? j.wallets : []), info: { builtAt: j.at, wallets: j.wallets?.length ?? 0, pumps: j.pumps ?? null, launches: j.launches ?? null, fresh } };
  } catch { next = { at: Date.now() - 9 * 60_000, set: new Set(), info: { builtAt: null, wallets: 0, fresh: false } }; } // retry in a minute
  caches.set(file, next); return next;
}
/** The current smart-wallet list for regular coins (stale after two days). An empty set when unreadable: no smart buys, never a guess. */
export const smartList = () => listFrom('smart-wallets.json', 48);
/** The launch-wallet list for Rocket Mode's copy filter (scripts/rocket-wallets.mjs). Stale after six hours: it ages fast. */
export const rocketList = () => listFrom('rocket-wallets.json', 6);

/** Distinct smart wallets that bought this coin in the last `minutes` (from its latest trades). */
export async function smartBuyers(mint, list, { minutes = 15, now = Date.now() } = {}) {
  if (!list?.size) return { count: 0, wallets: [] };
  const seen = new Set(); let cur = now;
  for (let page = 0; page < 3; page++) {
    const r = await fetch(`https://datapi.jup.ag/v1/txs/${mint}?toTs=${cur}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); if (!r.ok) break;
    const t = (await r.json())?.txs ?? []; if (!t.length) break;
    for (const x of t) { const ts = Date.parse(x.timestamp); if (ts < now - minutes * 60_000) return { count: seen.size, wallets: [...seen] }; if (x.type === 'buy' && !x.isMev && x.usdVolume >= 25 && list.has(x.traderAddress)) seen.add(x.traderAddress); }
    const last = Date.parse(t.at(-1).timestamp); if (!(last < cur)) break; cur = last;
  }
  return { count: seen.size, wallets: [...seen] };
}
