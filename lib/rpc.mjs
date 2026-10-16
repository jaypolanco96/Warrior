// Minimal Solana JSON-RPC helper for the serverless functions. The server holds no key: it reads chain state and
// relays transactions that were already signed in the visitor's browser.
import { tokenSafety } from './token.mjs';
export async function rpc(method, params) {
  const response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (body.error || body.result === undefined) { const e = new Error('Solana RPC unavailable'); e.rpc = body.error; throw e; }
  return body.result;
}
const JITO = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';
/**
 * Send an already-signed transaction (base64) to Jito's block builders only, not the public queue.
 * It is never retried through the public route: that would undo the protection.
 */
export async function sendProtected(base64) {
  const response = await fetch(JITO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [base64, { encoding: 'base64' }] }), signal: AbortSignal.timeout(15000) }), body = await response.json();
  if (body.error || typeof body.result !== 'string') { const e = new Error('The protected route refused the transaction'); e.rpc = body.error; throw e; }
  return body.result;
}
/**
 * Is this coin's token safe to trade? Covers both token programs; the rules are in lib/token.mjs.
 * A coin that cannot be read is treated as unsafe.
 */
export async function mintSafety(mint) {
  try { return { mint, ...tokenSafety((await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value), verified: true }; }
  catch { return { mint, safe: false, reason: 'could not verify the token', decimals: null, verified: false }; }
}
export const isAddress = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
