import { rpc } from '../lib/rpc.mjs';
// Read-only: is each outside service Warrior depends on answering right now? One small request to each, a few seconds at most.
// Used by the status line on the site and by the hourly monitor. It reports what it saw; it never guesses "fine".
const SOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
async function probe(id, name, used, run) {
  const started = Date.now();
  try { await run(); return { id, name, used, ok: true, ms: Date.now() - started }; }
  catch (e) { return { id, name, used, ok: false, ms: Date.now() - started, problem: String(e?.message ?? 'no answer').slice(0, 80) }; }
}
const get = async (url, init) => { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error(`answered ${r.status}`); return r.json(); };
export default async function handler(req, res) {
  const key = process.env.JUPITER_API_KEY;
  const parts = await Promise.all([
    probe('market', 'GeckoTerminal', 'the trending list, coin lookups and backup candles', async () => { const j = await get('https://api.geckoterminal.com/api/v2/networks/solana/dexes?page=1'); if (!Array.isArray(j?.data)) throw new Error('unexpected answer'); }),
    probe('charts', 'Jupiter charts', 'price candles for every verdict (GeckoTerminal is the fallback)', async () => { const j = await get(`https://datapi.jup.ag/v2/charts/${SOL}?interval=5_MINUTE&to=${Date.now()}&candles=5&type=price&quote=usd`); if (!Array.isArray(j?.candles) || !j.candles.length) throw new Error('unexpected answer'); }),
    probe('prices', 'DexScreener', 'live prices for orders, your own stops and the portfolio', async () => { const j = await get(`https://api.dexscreener.com/tokens/v1/solana/${SOL}`); if (!Array.isArray(j) || !j.length) throw new Error('unexpected answer'); }),
    probe('swaps', 'Jupiter', 'quotes and building every buy and sell', async () => { const j = await get(`https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=10000000&slippageBps=50`, { headers: key ? { 'x-api-key': key } : {} }); if (!/^\d+$/.test(j?.outAmount ?? '')) throw new Error('unexpected answer'); }),
    probe('chain', 'Solana network connection', 'balances, token checks, sending and confirming trades', async () => { const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); if (!r?.value?.blockhash) throw new Error('unexpected answer'); })
  ]);
  res.setHeader('Cache-Control', 'public, s-maxage=45');
  res.status(200).json({ ok: parts.every((p) => p.ok), at: new Date().toISOString(), parts });
}
