// Market data from free public sources: GeckoTerminal (pools and candles) and DexScreener (mature coins).
// Read-only. Every value is validated; a missing or odd value becomes "unknown", never a guess.

export const SOL = 'So11111111111111111111111111111111111111112';
const STABLES = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', SOL]);
const GECKO = 'https://api.geckoterminal.com/api/v2';

/** Established Solana coins explicitly included in the default scanning universe. */
export const MATURE = Object.freeze({
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', JTO: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', POPCAT: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'
});

// GeckoTerminal's free allowance is about 30 calls a minute. A small burst is fine, so calls draw from a bucket of five
// that refills one every 2.2 seconds: a scan's first calls go out together instead of queueing one by one.
// With a paid key (COINGECKO_API_KEY) the same calls go to the paid endpoint with a much larger bucket.
const PAID = typeof process !== 'undefined' && process.env?.COINGECKO_API_KEY ? process.env.COINGECKO_API_KEY : '';
const BASE = PAID ? 'https://pro-api.coingecko.com/api/v3/onchain' : GECKO, BUCKET = PAID ? 30 : 5, REFILL_MS = PAID ? 150 : 2200;
let tokens = BUCKET, refilledAt = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function take() { for (;;) { const now = Date.now(); tokens = Math.min(BUCKET, tokens + (now - refilledAt) / REFILL_MS); refilledAt = now; if (tokens >= 1) { tokens -= 1; return; } await sleep(Math.ceil((1 - tokens) * REFILL_MS)); } }
async function gecko(path) {
  const init = () => ({ headers: { accept: 'application/json', ...(PAID ? { 'x-cg-pro-api-key': PAID } : {}) }, signal: AbortSignal.timeout(12000) });
  for (let attempt = 0; ; attempt++) {
    await take(); const response = await fetch(BASE + path, init());
    // Throttled: empty the bucket so every waiting call slows down, pause, and try again through the bucket.
    // Two retries, then the refusal is reported, not hammered.
    if (response.status === 429 && attempt < 2) { tokens = Math.min(tokens, 0); refilledAt = Date.now(); await sleep((PAID ? 1000 : 4000) + Math.random() * 2000); continue; }
    if (!response.ok) { const e = new Error(`Market data unavailable (${response.status})`); e.status = response.status; throw e; }
    return response.json();
  }
}
const num = (v) => { const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const mintOf = (id) => typeof id === 'string' && id.startsWith('solana_') ? id.slice(7) : null;
const validMint = (m) => typeof m === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);

export function poolToToken(p) {
  const a = p?.attributes, rel = p?.relationships; if (!a || !rel) return null;
  const base = mintOf(rel.base_token?.data?.id), quote = mintOf(rel.quote_token?.data?.id);
  if (!validMint(base) || !validMint(quote) || STABLES.has(base) || !STABLES.has(quote) || !validMint(a.address)) return null;
  const created = Date.parse(a.pool_created_at);
  return {
    mint: base, pool: a.address, dex: rel.dex?.data?.id ?? 'unknown', symbol: String(a.name ?? '').split(' / ')[0].slice(0, 16), quote,
    priceUsd: num(a.base_token_price_usd), fdvUsd: num(a.fdv_usd), liquidityUsd: num(a.reserve_in_usd), volume24hUsd: num(a.volume_usd?.h24), volume1hUsd: num(a.volume_usd?.h1),
    createdAt: Number.isFinite(created) ? created : null, change: { m5: num(a.price_change_percentage?.m5), h1: num(a.price_change_percentage?.h1), h6: num(a.price_change_percentage?.h6), h24: num(a.price_change_percentage?.h24) },
    // "pump" means the coin itself was launched on pump.fun (its address ends in "pump"), not merely that it trades on
    // pump.fun's exchange. Anyone can open a pool there for any coin, and such a pool's money is not locked.
    pump: base.endsWith('pump'), activity: poolActivity(num(a.volume_usd?.h1), 'geckoterminal')
  };
}
const matureMints = new Set(Object.values(MATURE));
const metric = (v) => { const n = num(v); return n !== null && n >= 0 ? n : null; };
const total = (a, b) => a !== null && b !== null ? a + b : null;
const poolActivity = (volume, source) => ({ turnoverUsd: metric(volume), buyUsd: null, sellUsd: null, traders: null, organicTurnoverUsd: null, source, scope: 'pool' });
export function uniqueTokens(tokens) {
  const seen = new Map();
  for (const t of tokens) {
    if (!t) continue; const prev = seen.get(t.mint);
    if (!prev) { seen.set(t.mint, { ...t, mature: t.mature === true || matureMints.has(t.mint) }); continue; }
    const best = (t.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0) ? t : prev;
    // Token-wide Jupiter stats describe the mint, not the execution pool. Retain their provenance independently.
    const activity = [prev.activity, t.activity].filter(Boolean).sort((a, b) => (b.scope === 'token') - (a.scope === 'token'))[0];
    seen.set(t.mint, { ...best, activity, volume1hUsd: activity?.turnoverUsd ?? best.volume1hUsd, mature: prev.mature === true || t.mature === true || matureMints.has(t.mint),
      established: prev.established === true || t.established === true, tokenCreatedAt: prev.tokenCreatedAt ?? t.tokenCreatedAt,
      ...(prev.freezeAuthority || t.freezeAuthority ? { freezeAuthority: true } : {}), ...(prev.mintAuthority || t.mintAuthority ? { mintAuthority: true } : {}) });
  }
  return [...seen.values()];
}
const unique = uniqueTokens;

// Coin lists change slowly; a warm server reuses them for a minute instead of spending two calls on every scan.
const listCache = new Map();
async function cachedList(path) { const hit = listCache.get(path); if (hit && hit.until > Date.now()) return hit.list; const list = unique(((await gecko(path)).data ?? []).map(poolToToken)); listCache.set(path, { list, until: Date.now() + 60_000 }); return list; }
/** Coins trending on Solana over a window ('5m', '1h', '6h' or '24h'), hottest first, across every exchange. */
export const trending = (window = '1h') => cachedList(`/networks/solana/trending_pools?page=1&duration=${['5m', '1h', '6h', '24h'].includes(window) ? window : '1h'}`);
/** What the scanner starts from: the coins trending in the last hour. */
export const trendingMemes = () => trending('1h');
/** The busiest pump.fun (PumpSwap) pools by 24-hour volume. */
export const pumpFunTop = async () => (await Promise.all([1, 2].map((page) => cachedList(`/networks/solana/dexes/pumpswap/pools?page=${page}&sort=h24_volume_usd_desc`).catch(() => [])))).flat();

/** Established coins, each with its deepest SOL or stablecoin pool, from DexScreener in one call. */
export async function matureCoins() {
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${Object.values(MATURE).join(',')}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Mature coin data unavailable (${response.status})`);
  const pairs = await response.json(); if (!Array.isArray(pairs)) throw new Error('Mature coin data unavailable');
  return unique(pairs.map((p) => {
    const base = p?.baseToken?.address, quote = p?.quoteToken?.address;
    if (!Object.values(MATURE).includes(base) || !STABLES.has(quote) || !validMint(p.pairAddress)) return null;
    return { mint: base, pool: p.pairAddress, dex: String(p.dexId ?? 'unknown'), symbol: String(p.baseToken.symbol ?? '').slice(0, 16), quote, priceUsd: num(p.priceUsd), liquidityUsd: num(p.liquidity?.usd), volume24hUsd: num(p.volume?.h24), volume1hUsd: num(p.volume?.h1), createdAt: num(p.pairCreatedAt), change: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) }, pump: false, mature: true, activity: poolActivity(num(p.volume?.h1), 'dexscreener') };
  }));
}

// Candles come from two places. Jupiter's chart feed is asked first: it is quick, covers every coin by its address and has
// not throttled a scan. It is the feed behind Jupiter's own charts, not a documented public service, so it may change
// without notice; GeckoTerminal (documented, but about 30 calls a minute) is the fallback, and every coin says which
// source its candles came from. A candle only changes when its bar closes, so both are kept until the next bar boundary.
const candleCache = new Map();
const clean = (rows, bar, now) => rows
  .filter((c) => [c.t, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.low > 0 && c.t + bar <= now)
  .map((c) => ({ ...c, high: Math.max(c.high, c.open, c.close), low: Math.min(c.low, c.open, c.close) }))
  .sort((a, b) => a.t - b.t);
async function jupiterCandles(mint, limit, tf) {
  const response = await fetch(`https://datapi.jup.ag/v2/charts/${mint}?interval=${tf === 1 ? '1_MINUTE' : '5_MINUTE'}&to=${Date.now()}&candles=${Math.min(1000, Math.max(10, limit))}&type=price&quote=usd`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Jupiter charts unavailable (${response.status})`);
  const list = (await response.json())?.candles; if (!Array.isArray(list) || !list.length) throw new Error('Jupiter charts have no candles for this coin');
  return list.map((c) => ({ t: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}
async function geckoCandles(pool, limit, tf) {
  const raw = (await gecko(`/networks/solana/pools/${pool}/ohlcv/minute?aggregate=${tf}&limit=${Math.min(1000, Math.max(10, limit))}&currency=usd`))?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(raw)) throw new Error('Candles unavailable');
  return raw.map((r) => ({ t: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
}
/**
 * Completed candles for a coin, oldest first, priced in USD. The bar still forming is dropped.
 * `minutes` is the bar size: 5 for the normal reading, 1 for young coins. With `mint`, Jupiter's feed is tried first.
 * The returned list carries a `source` note ('jupiter' or 'geckoterminal').
 */
export async function candles(pool, limit = 200, now = Date.now(), minutes = 5, mint = null) {
  if (!validMint(pool)) throw new Error('Invalid pool');
  const tf = minutes === 1 ? 1 : 5, bar = tf * 60_000, key = `${pool}:${limit}:${tf}`, hit = candleCache.get(key);
  let got = hit && hit.until > Date.now() ? hit : null;
  if (!got) {
    try {
      let rows = null, source = 'jupiter';
      if (validMint(mint) && !PAID) { try { rows = await jupiterCandles(mint, limit, tf); } catch { rows = null; } }
      if (!rows) { rows = await geckoCandles(pool, limit, tf); source = 'geckoterminal'; }
      if (candleCache.size > 400) candleCache.clear();
      got = { rows, source, fetchedAt: Date.now(), until: Math.ceil(Date.now() / bar) * bar + (tf === 1 ? 6_000 : 15_000) }; candleCache.set(key, got);
    } catch (e) {
      // Both sources refused this time. Recently read candles are at most two bars behind, which is better than
      // nothing; anything older is not used, and the "stale" rule still applies to what is returned.
      if (hit && Date.now() - hit.fetchedAt < (tf === 1 ? 180_000 : 600_000)) got = hit; else throw e;
    }
  }
  return Object.assign(clean(got.rows, bar, now), { source: got.source });
}

/** Every pool of one coin that trades against SOL or a dollar coin, deepest first. */
export async function tokenPools(mint) {
  if (!validMint(mint)) throw new Error('Invalid coin address');
  // An address the data source has never seen is "no pools", not an outage.
  const found = await gecko(`/networks/solana/tokens/${mint}/pools?page=1`).catch((e) => { if (e.status === 404) return { data: [] }; throw e; });
  return (found.data ?? []).map(poolToToken).filter((t) => t && t.mint === mint).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}
/** Search Solana pools by coin name or ticker. One entry per coin, busiest first: copycat coins share names but rarely volume. */
export async function searchPools(query) {
  const q = String(query ?? '').trim().slice(0, 40); if (q.length < 2) return [];
  return unique(((await gecko(`/search/pools?query=${encodeURIComponent(q)}&network=solana&page=1`)).data ?? []).map(poolToToken)).sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
}
/** Facts about a coin itself: holders, creator share, launch. Null when the source has none. */
export async function tokenInfo(mint) {
  if (!validMint(mint)) throw new Error('Invalid coin address');
  const a = (await gecko(`/networks/solana/tokens/${mint}/info`))?.data?.attributes; if (!a) return null;
  return { name: typeof a.name === 'string' ? a.name.slice(0, 40) : null, symbol: typeof a.symbol === 'string' ? a.symbol.slice(0, 16) : null, holders: a.holders ?? null, developer_holding_percentage: a.developer_holding_percentage ?? null, mint_authority: a.mint_authority ?? null, freeze_authority: a.freeze_authority ?? null, is_honeypot: a.is_honeypot ?? null, launchpad_details: a.launchpad_details ?? null,
    // The coin's own words and links, exactly as its creator published them. Shown as plain text, never trusted.
    description: typeof a.description === 'string' ? a.description.slice(0, 2000) : null, websites: Array.isArray(a.websites) ? a.websites.filter((w) => typeof w === 'string').slice(0, 3) : [], twitter_handle: a.twitter_handle ?? null, telegram_handle: a.telegram_handle ?? null, discord_url: a.discord_url ?? null };
}
/** Current USD price for up to 30 coins in one call (DexScreener). A coin with no usable pool is simply absent. */
export async function prices(mints) { return (await priceFacts(mints)).prices; }
/**
 * Price and pool money for up to 30 coins. `liquidity` is the money in the coin's deepest pool; it matters as much as the
 * price, because a coin whose pool has been emptied still shows a last price that nobody can sell at.
 */
export async function priceFacts(mints) {
  const list = [...new Set(mints)].filter(validMint).slice(0, 30); if (!list.length) return { prices: {}, liquidity: {} };
  const out = { prices: {}, liquidity: {} };
  // Jupiter's price service is updated every block, so it is asked first. It also reports the money in the pool, even for a
  // coin it can no longer price, which is how an emptied pool is recognised.
  try {
    const key = typeof process !== 'undefined' ? process.env?.JUPITER_API_KEY : '';
    const response = await fetch(`https://api.jup.ag/price/v3?ids=${list.join(',')}`, { headers: { accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) }, signal: AbortSignal.timeout(5000) });
    if (response.ok) { const j = await response.json(); for (const mint of list) { const v = j?.[mint]; if (!v) continue; const price = num(v.usdPrice), liq = num(v.liquidity); if (price !== null && price > 0) out.prices[mint] = price; if (liq !== null) out.liquidity[mint] = liq; } }
  } catch { /* fall through to the second source */ }
  const missing = list.filter((m) => out.prices[m] === undefined || out.liquidity[m] === undefined);
  if (missing.length) {
    try {
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${missing.join(',')}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Prices unavailable (${response.status})`);
      const pairs = await response.json(), best = new Map(); if (!Array.isArray(pairs)) throw new Error('Prices unavailable');
      for (const p of pairs) { const mint = p?.baseToken?.address, price = num(p?.priceUsd), known = num(p?.liquidity?.usd), liq = known ?? -1; if (!missing.includes(mint) || !STABLES.has(p?.quoteToken?.address) || price === null || price <= 0) continue; if (!best.has(mint) || liq > best.get(mint).liq) best.set(mint, { price, liq }); }
      // Pool money that is not reported stays unknown, never "empty".
      for (const [mint, v] of best) { if (out.prices[mint] === undefined) out.prices[mint] = v.price; if (out.liquidity[mint] === undefined && v.liq >= 0) out.liquidity[mint] = v.liq; }
    } catch (e) { if (!Object.keys(out.prices).length && !Object.keys(out.liquidity).length) throw e; }
  }
  return out;
}

/** The basics of one coin (ticker, deepest pool, price) from DexScreener: one quick call that does not touch the candle allowance. */
export async function coinBasics(mint) {
  if (!validMint(mint)) throw new Error('Invalid coin address');
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Coin data unavailable (${response.status})`);
  const pairs = await response.json(); let best = null; if (!Array.isArray(pairs)) throw new Error('Coin data unavailable');
  for (const p of pairs) { const liq = num(p?.liquidity?.usd) ?? 0; if (p?.baseToken?.address !== mint || !STABLES.has(p?.quoteToken?.address) || !validMint(p.pairAddress)) continue; if (!best || liq > best.liq) best = { liq, mint, symbol: String(p.baseToken.symbol ?? '').slice(0, 16), pool: p.pairAddress, priceUsd: num(p.priceUsd) }; }
  if (!best) return null; const { liq, ...coin } = best; return coin;
}

// Brand-new pump.fun coins, from Jupiter's launch feed (the same undocumented feed family as its charts: free, and it may
// change without notice). Three lists are merged: just launched, close to graduating, and just graduated.
let rocketCache = null;
export async function rocketPools() {
  if (rocketCache && rocketCache.until > Date.now()) return rocketCache.pools;
  const response = await fetch('https://datapi.jup.ag/v1/pools/gems', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ recent: { launchpads: ['pump.fun'] }, aboutToGraduate: { launchpads: ['pump.fun'] }, graduated: { launchpads: ['pump.fun'] } }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Launch feed unavailable (${response.status})`);
  const j = await response.json(), byCoin = new Map();
  // A coin can be in two lists while it graduates; the later list has the fuller facts.
  for (const list of [j?.recent?.pools, j?.aboutToGraduate?.pools, j?.graduated?.pools]) for (const p of Array.isArray(list) ? list : []) if (typeof p?.baseAsset?.id === 'string') byCoin.set(p.baseAsset.id, p);
  const pools = [...byCoin.values()]; rocketCache = { pools, until: Date.now() + 12_000 }; return pools;
}

/**
 * One coin's launch record from Jupiter's feed, plus other coins using the same name or ticker.
 * Returns { asset, others } with asset null when the feed does not know the coin.
 */
export async function launchRecord(mint, { lite = false } = {}) { // lite: only this coin, without the search for same-named ones
  if (!validMint(mint)) throw new Error('Invalid coin address');
  const ask = async (query) => { const r = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`Launch record unavailable (${r.status})`); const j = await r.json(); return Array.isArray(j) ? j : []; };
  const asset = (await ask(mint)).find((a) => a?.id === mint) ?? null; if (!asset || lite) return { asset, others: [] };
  const name = String(asset.name ?? '').trim(), symbol = String(asset.symbol ?? '').trim(), lists = await Promise.all([...new Set([name, symbol].filter((v) => v.length >= 2))].map((q) => ask(q).catch(() => [])));
  return { asset, others: [...new Map(lists.flat().filter((a) => a && a.id !== mint).map((a) => [a.id, a])).values()] };
}

/** The default universe covers mature coins, trending coins and pump.fun launches. */
/**
 * Jupiter's own lists of what is moving on Solana, across every exchange: trending, most traded and most genuinely
 * traded. Each returns up to 100 pools with price, pool money, volume and age, in one fast call.
 * Added October 14, 2026: the scanner had been starting from two lists of twenty coins, and waited a long time for an
 * ENTER simply because it was looking at so few.
 */
// Not meme coins, and nothing a ten percent target can be traded on: dollar coins, tokenised shares and commodities, staked SOL.
const NOT_FOR_TRADING = new Set(['stable', 'stocks', 'xstocks', 'equities', 'prestocks', 'rwa', 'commodities', 'lst', 'original-lst', 'yield', 'jup-lend-earn']);
export function jupiterPoolToToken(p) {
  const a = p?.baseAsset, base = a?.id, quote = p?.quoteAsset; if (!a || (p.chain && p.chain !== 'solana') || !validMint(base) || !validMint(p.id) || STABLES.has(base) || !STABLES.has(quote)) return null;
  const tags = Array.isArray(a.tags) ? a.tags : []; if (tags.some((t) => NOT_FOR_TRADING.has(t))) return null;
  if (Math.abs((num(a.usdPrice) ?? 0) - 1) < 0.03 && Math.abs(num(a.stats24h?.priceChange) ?? 9) < 1) return null; // looks like a dollar coin, whatever it is tagged
  const created = Date.parse(p.createdAt), born = Date.parse(a.firstPool?.createdAt ?? a.createdAt), s1 = a.stats1h ?? {}, buyUsd = metric(s1.buyVolume), sellUsd = metric(s1.sellVolume), vol1h = total(buyUsd, sellUsd);
  return {
    mint: base, pool: p.id, dex: p.type === 'pumpfun-amm' || /pump/i.test(String(p.dex)) ? 'pumpswap' : String(p.dex ?? 'unknown').toLowerCase(), symbol: String(a.symbol ?? '').slice(0, 16) || 'Unknown', quote,
    priceUsd: num(a.usdPrice), fdvUsd: num(a.fdv), liquidityUsd: num(p.liquidity), volume24hUsd: num(p.volume24h), volume1hUsd: vol1h,
    tokenCreatedAt: Number.isFinite(born) ? born : null, activity: { turnoverUsd: vol1h, buyUsd, sellUsd, traders: Number.isInteger(s1.numTraders) && s1.numTraders >= 0 ? s1.numTraders : null, organicTurnoverUsd: total(metric(s1.buyOrganicVolume), metric(s1.sellOrganicVolume)), source: 'jupiter', scope: 'token' },
    createdAt: Number.isFinite(created) ? created : null, change: { m5: num(a.stats5m?.priceChange), h1: num(s1.priceChange), h6: num(a.stats6h?.priceChange), h24: num(a.stats24h?.priceChange) },
    // Established metadata is retained even when another feed supplies the deepest execution pool.
    established: (num(a.mcap) ?? 0) >= 100e6 || tags.includes('major'),
    pump: base.endsWith('pump'), ...(a.audit?.mintAuthorityDisabled === false ? { mintAuthority: true } : {}), ...(a.audit?.freezeAuthorityDisabled === false ? { freezeAuthority: true } : {})
  };
}
async function jupiterList(kind, window, limit = 100) {
  const key = `jup:${kind}:${window}:${limit}`, hit = listCache.get(key); if (hit && hit.until > Date.now()) return hit.list;
  const r = await fetch(`https://datapi.jup.ag/v1/pools/${kind}/${window}?limit=${limit}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`Jupiter list unavailable (${r.status})`);
  const j = await r.json(), list = unique((Array.isArray(j?.pools) ? j.pools : []).map(jupiterPoolToToken)); listCache.set(key, { list, until: Date.now() + 45_000 }); return list;
}
export async function universe({ mature = true } = {}) {
  const lists = await Promise.allSettled([trendingMemes(), pumpFunTop(), jupiterList('toptrending', '5m'), jupiterList('toptrending', '1h'), jupiterList('toptraded', '1h'), jupiterList('toporganicscore', '1h'),
    // October 16: wider lists. Each added 54-77 coins the others missed; the 5-minute ones catch a coin while it is dropping.
    jupiterList('toptraded', '5m'), jupiterList('toporganicscore', '5m'), jupiterList('toptraded', '6h'), jupiterList('toptrending', '6h'), jupiterList('toptraded', '24h'), jupiterList('toptrending', '24h'), rocketPools().then((pools) => unique(pools.map(jupiterPoolToToken))), ...(mature ? [matureCoins()] : [])]);
  const tokens = unique(lists.flatMap((l) => l.status === 'fulfilled' ? l.value : [])).filter((t) => mature || !t.established);
  return { tokens, sourcesFailed: lists.filter((l) => l.status === 'rejected').length, sources: lists.length };
}
