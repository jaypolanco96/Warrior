// Jupiter swap construction. These calls only ask for a quote and an unsigned transaction.
// Signing and sending happen in the wallet (site) or in the local bot, never here.
import { SOL } from './market.mjs';
const API = 'https://api.jup.ag/swap/v1';
const headers = (key) => ({ 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) });

// The free allowance is 5 requests per 10 seconds. Space calls and retry a throttled one once.
let nextCall = 0, queue = Promise.resolve();
function call(url, init) { const run = queue.then(() => callOnce(url, init)); queue = run.catch(() => undefined); return run; }
async function callOnce(url, init) {
  for (let attempt = 0; ; attempt++) {
    const wait = nextCall - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextCall = Date.now() + 2100;
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (response.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 6000)); continue; }
    if (!response.ok) throw new Error(`Jupiter unavailable (${response.status})`);
    return response.json();
  }
}

/** Exact-in quote. `amountRaw` is in the input token's smallest units (lamports for SOL). */
export async function quote({ inputMint, outputMint, amountRaw, slippageBps = 150, apiKey }) {
  if (!/^\d+$/.test(String(amountRaw)) || BigInt(amountRaw) <= 0n) throw new Error('Invalid amount');
  const q = await call(`${API}/quote?${new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), slippageBps: String(slippageBps), swapMode: 'ExactIn' })}`, { headers: headers(apiKey) });
  if (q?.inputMint !== inputMint || q.outputMint !== outputMint || q.inAmount !== String(amountRaw) || !/^\d+$/.test(q.outAmount ?? '')) throw new Error('Quote does not match the request');
  return q;
}

/** Unsigned swap transaction (base64) for a quote. SOL is wrapped and unwrapped automatically. */
/**
 * `maxPriorityLamports` caps the priority fee (default 0.001 SOL). With `protect`, the fee is paid as a tip to Jito's
 * block builders instead, and the signed transaction must then be sent through Jito (see api/send.js).
 */
/**
 * The priority fee cap for one swap: the level chosen, but never more than a small share of the trade. A fixed 0.001 SOL
 * on a 0.03 SOL trade is 3% each way (October 14, 2026: a DOPE sale 5% up ended at -0.9% after fees). A buy may pay up to
 * 0.3% of the trade, a sell (getting out matters more) up to 0.5%, and never less than 0.00003 SOL so it still lands.
 */
export function priorityCap(chosenLamports, quoteResponse) {
  const SOL = 'So11111111111111111111111111111111111111112', sell = quoteResponse?.outputMint === SOL;
  const solLamports = Number(sell ? quoteResponse?.outAmount : quoteResponse?.inAmount), chosen = Math.min(5_000_000, Math.max(0, Math.trunc(chosenLamports)));
  if (!Number.isFinite(solLamports) || solLamports <= 0 || chosen === 0) return chosen;
  return Math.min(chosen, Math.max(30_000, Math.round(solLamports * (sell ? 0.005 : 0.003))));
}
export async function swapTransaction({ quoteResponse, userPublicKey, apiKey, maxPriorityLamports = 1_000_000, protect = false }) {
  const cap = priorityCap(maxPriorityLamports, quoteResponse);
  const fee = protect ? { jitoTipLamports: Math.min(200_000, Math.max(10_000, cap)) } : cap === 0 ? 0 : { priorityLevelWithMaxLamports: { maxLamports: cap, priorityLevel: 'high' } };
  const r = await call(`${API}/swap`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: fee }) });
  if (typeof r?.swapTransaction !== 'string' || !r.swapTransaction) throw new Error('Swap transaction unavailable');
  return { transaction: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight ?? null };
}
export const buyQuote = (mint, lamports, opts = {}) => quote({ inputMint: SOL, outputMint: mint, amountRaw: lamports, ...opts });
export const sellQuote = (mint, tokenRaw, opts = {}) => quote({ inputMint: mint, outputMint: SOL, amountRaw: tokenRaw, ...opts });
