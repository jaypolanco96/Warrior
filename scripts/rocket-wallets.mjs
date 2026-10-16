// Rebuild the launch-wallet list (public/rocket-wallets.json) for Rocket Mode's copy filter. Run by
// .github/workflows/rocket-wallets.yml every two hours. Read-only public data (Jupiter); no keys, no trades.
//   1. Recent pump.fun launches: 40 minutes to 6 hours old, from Jupiter's launch and trending lists.
//   2. Every wallet's buys and sells in each launch's first 30 minutes.
//   3. Keep wallets that came out ahead on two or more launches and made money overall.
// Why so fresh: in an 8-hour forward test (October 15, 2026, 451 launches with prices), copying wallets learned in the
// hours just before lost 4.4% a bet against 13.4% for buying launches blindly; wallets learned two days earlier barely
// helped (-9.6%). The list goes stale fast, so it is rebuilt every two hours and ignored once it is six hours old.
import { readFileSync, writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now();
const get = async (u, init) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { ...init, signal: AbortSignal.timeout(10000) }); if (r.status === 429) { await sleep(4000 * (i + 1)); continue; } if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(1000); } return null; };
const launches = new Map();
const add = (p) => { const a = p?.baseAsset ?? p, id = a?.id, created = Date.parse(a?.firstPool?.createdAt ?? p?.createdAt); if (id && /pump$/.test(id) && Number.isFinite(created) && now - created >= 40 * 60_000 && now - created <= 6 * 3_600_000) launches.set(id, { mint: id, sym: a.symbol, created }); };
const gems = await get('https://datapi.jup.ag/v1/pools/gems', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aboutToGraduate: { launchpads: ['pump.fun'] }, graduated: { launchpads: ['pump.fun'] } }) });
for (const k of ['aboutToGraduate', 'graduated']) for (const p of gems?.[k]?.pools ?? []) add(p);
for (const w of ['5m', '1h', '6h']) for (const kind of ['toptrending', 'toptraded', 'toporganicscore']) for (const p of (await get(`https://datapi.jup.ag/v1/pools/${kind}/${w}?limit=100`))?.pools ?? []) add(p);
const stats = new Map();
for (const c of [...launches.values()].slice(0, 80)) {
  const net = new Map(); let cur = c.created + 30 * 60_000;
  for (let page = 0; page < 40; page++) {
    const t = (await get(`https://datapi.jup.ag/v1/txs/${c.mint}?toTs=${cur}`))?.txs ?? []; await sleep(220); if (!t.length) break;
    let older = false;
    for (const x of t) { const ts = Date.parse(x.timestamp); if (ts < c.created) { older = true; break; } if (x.isMev || !x.traderAddress) continue; const n = net.get(x.traderAddress) ?? { buy: 0, sell: 0 }; if (x.type === 'buy') n.buy += x.usdVolume; else n.sell += x.usdVolume; net.set(x.traderAddress, n); }
    const last = Date.parse(t.at(-1).timestamp); if (older || !(last < cur)) break; cur = last;
  }
  for (const [w, n] of net) if (n.buy >= 20) { const s = stats.get(w) ?? { coins: 0, won: 0, net: 0 }; s.coins++; s.net += n.sell - n.buy; if (n.sell > n.buy * 1.1) s.won++; stats.set(w, s); }
  console.log(`${c.sym}: ${net.size} wallets`);
}
const wallets = [...stats].filter(([, s]) => s.coins >= 2 && s.won >= 2 && s.net > 0).map(([w]) => w).sort();
if (launches.size < 15 || wallets.length < 10) { console.log(`Only ${launches.size} launches and ${wallets.length} wallets; keeping the previous list.`); process.exit(0); }
let previous = null; try { previous = JSON.parse(readFileSync(new URL('../public/rocket-wallets.json', import.meta.url), 'utf8')); } catch { /* first run */ }
writeFileSync(new URL('../public/rocket-wallets.json', import.meta.url), `${JSON.stringify({ at: new Date(now).toISOString(), launches: Math.min(80, launches.size), rule: 'ahead on 2+ pump.fun launches in their first 30 minutes, and ahead overall, over the last 6 hours', wallets }, null, 1)}\n`);
console.log(`${wallets.length} launch wallets from ${Math.min(80, launches.size)} launches${previous ? ` (was ${previous.wallets?.length ?? 0})` : ''}.`);
