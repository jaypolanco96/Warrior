// Rebuild the smart-wallet list (public/smart-wallets.json). Run by .github/workflows/smart-wallets.yml every six hours.
// Read-only public data: Jupiter's price candles and trades. No keys, no trades.
//   1. On regular coins (over six hours old, pools over $30K), find every big pump in the last three and a half days:
//      a low from which the price rose 20% or more within two hours.
//   2. Note the wallets that bought in the 20 minutes before each pump, and at ordinary moments (no +10% in two hours).
//   3. Keep the wallets that bought before pumps on two or more coins and never at an ordinary moment.
import { writeFileSync } from 'node:fs';
const SITE = process.env.WARRIOR_SITE || 'https://WARRIOR_HOST', MAX_COINS = Number(process.env.SMART_COINS) || 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now();
const get = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (r.status === 429) { await sleep(4000 * (i + 1)); continue; } if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(1000); } return null; };

const coins = new Map();
for (const c of (await get(`${SITE}/api/scan?x=${now}`))?.results ?? []) coins.set(c.mint, c);
for (const w of ['1h', '6h', '24h']) for (const c of (await get(`${SITE}/api/coin?what=trending&window=${w}&x=${now}`))?.coins ?? []) coins.set(c.mint, c);
const list = [...coins.values()].filter((c) => c.createdAt && now - c.createdAt > 6 * 3_600_000 && (c.liquidityUsd ?? 1e9) > 30_000).slice(0, MAX_COINS);

async function buys(mint, from, to) {
  const out = new Set(); let cur = to;
  for (let page = 0; page < 8; page++) {
    const t = (await get(`https://datapi.jup.ag/v1/txs/${mint}?toTs=${cur}`))?.txs ?? []; await sleep(250); if (!t.length) break;
    for (const x of t) { const ts = Date.parse(x.timestamp); if (ts < from) return out; if (x.type === 'buy' && !x.isMev && x.usdVolume >= 25) out.add(x.traderAddress); }
    const last = Date.parse(t.at(-1).timestamp); if (!(last < cur)) break; cur = last;
  }
  return out;
}

const stats = new Map(); let pumpsSeen = 0, calmSeen = 0;
for (const c of list) {
  const k = (await get(`https://datapi.jup.ag/v2/charts/${c.mint}?interval=5_MINUTE&to=${now}&candles=1000&type=price&quote=usd`))?.candles; await sleep(800);
  if (!k || k.length < 150) continue;
  const cl = k.map((b) => b.close), at = (i) => k[i].time * (k[i].time > 1e12 ? 1 : 1000), pumps = [];
  for (let i = 30; i < k.length - 24;) { const up = Math.max(...k.slice(i + 1, i + 25).map((b) => b.high)) / cl[i]; if (up >= 1.2 && cl[i] <= Math.min(...cl.slice(i - 6, i + 7))) { pumps.push(i); i += 24; } else i++; }
  const calm = []; for (let x = 30; x < k.length - 24; x += 5) if (Math.max(...k.slice(x + 1, x + 25).map((b) => b.high)) / cl[x] < 1.1 && pumps.every((p) => Math.abs(p - x) > 24)) calm.push(x);
  const picked = []; for (let n = 0; n < Math.max(3, pumps.length * 2) && calm.length; n++) picked.push(calm.splice(Math.floor(Math.random() * calm.length), 1)[0]);
  for (const [i, pump] of [...pumps.map((i) => [i, true]), ...picked.map((i) => [i, false])]) {
    for (const w of await buys(c.mint, at(i) - 20 * 60_000, at(i) + 60_000)) { const s = stats.get(w) ?? { coins: new Set(), calm: 0 }; if (pump) s.coins.add(c.mint); else s.calm++; stats.set(w, s); }
    if (pump) pumpsSeen++; else calmSeen++;
  }
  console.log(`${c.symbol}: ${pumps.length} pumps, ${picked.length} ordinary moments`);
}
const wallets = [...stats].filter(([, s]) => s.coins.size >= 2 && s.calm === 0).map(([w]) => w).sort();
if (pumpsSeen < 40) { console.log(`Only ${pumpsSeen} pumps found; keeping the previous list.`); process.exit(0); }
writeFileSync(new URL('../public/smart-wallets.json', import.meta.url), `${JSON.stringify({ at: new Date(now).toISOString(), coins: list.length, pumps: pumpsSeen, ordinary: calmSeen, rule: 'bought in the 20 minutes before a +20% pump on 2+ coins, never at an ordinary moment', wallets }, null, 1)}\n`);
console.log(`${wallets.length} smart wallets from ${pumpsSeen} pumps and ${calmSeen} ordinary moments on ${list.length} coins.`);
