// The trader: buys, sells and watches positions for the impi, in practice (pretend SOL, real quotes) or live (the trading
// wallet, real swaps through Jupiter). Every live transaction is checked before it is signed: it must be paid by the
// trading wallet, need no other signature, and call only the programs a Jupiter swap uses.
import { VersionedTransaction, Transaction, TransactionInstruction, PublicKey } from '/vendor/solana.js';
import { unexpectedPrograms, closableAccounts, CLOSE_ACCOUNT_DATA } from '/vendor/lib/vault.js';
import { positionSize } from '/vendor/lib/risk.js';
import { partialDue, autoExitDue, ownExitDue, confirm, poolEmptied } from '/vendor/lib/orders.js';
import { state, save, api, post, SOL, emit } from './store.js';
import { resolveRules } from '/vendor/lib/presets.js';
import { DIP_REPEAT_HOURS } from '/vendor/lib/strategy.js';
import { vault, waitFor, liveBalance } from './wallet.js';

export const live = () => state.mode === 'live';
const say = (who, text, tone) => emit('say', { who, text, tone });
const b64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const mine = () => state.positions.filter((p) => p.mode === state.mode);

export async function balance() { return live() ? liveBalance() : state.paperSol; }
export function heldSol() { return mine().reduce((n, p) => n + (Number.isFinite(p.nowSol) ? p.nowSol : p.solIn), 0); }
async function tokenRaw(mint) { return BigInt((await api(`/api/balance?owner=${vault.address}&mint=${mint}`)).tokenRaw ?? '0'); }

async function swap(quoteResponse, exit) {
  if (!vault.unlocked) throw new Error('the trading wallet is locked');
  const built = await post('/api/swap', { quoteResponse, userPublicKey: vault.address, exit, maxPriorityLamports: 1_000_000 }); // Laugh's default level; the server caps it at 0.3% of a buy, 0.5% of a sell
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));
  if (tx.message.staticAccountKeys[0].toBase58() !== vault.address || tx.message.header.numRequiredSignatures !== 1) throw new Error('swap was not built for this wallet');
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()), odd = unexpectedPrograms(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex] ?? 'unknown'));
  if (odd.length) throw new Error(`swap refused: it calls a program Warrior does not expect (${odd[0].slice(0, 8)}…)`);
  tx.sign([vault.keypair]);
  const { signature } = await post('/api/send', { transaction: b64(tx.serialize()) }); return { signature, outcome: await waitFor(signature) };
}

/**
 * Buy a coin the spear picked. The shield checks it twice more first: the token itself (freeze/mint authority) and its
 * launch record (bundled buys, staged launches). Then a round trip is priced: a coin that costs over 3% to sell straight
 * back is taxed or trapped. Returns true when coins were bought.
 */
export async function buy(t, rules) {
  const a = t.analysis, r = rules.risk, bal = await balance(), equity = bal + heldSol();
  const size = positionSize({ balanceSol: bal, equitySol: equity, stopPct: a.stopPct ?? 10, openPositions: mine().length, dayPnlSol: 0, sizeFactor: a.sizeFactor ?? 1 }, r);
  if (!size.sol) { say('induna', `${t.symbol}: no room. ${size.reasons.join('; ')}.`); return false; }
  const safety = await api(`/api/coin?what=mint&mint=${t.mint}`);
  if (!safety.safe) { say('isihlangu', `${t.symbol} refused: ${safety.reason}.`, 'down'); state.cooldown[t.mint] = Date.now() + 6 * 3_600_000; return false; }
  let launch; try { launch = await api(`/api/coin?what=audit&mint=${t.mint}&level=${state.preset}`); } catch { say('isihlangu', `${t.symbol}: its launch record could not be read, so no buy. Unknown is not safe.`); return false; }
  if (!launch.ok) { say('isihlangu', `${t.symbol} refused: ${launch.reasons.join('. ')}.`, 'down'); state.cooldown[t.mint] = Date.now() + 24 * 3_600_000; return false; }
  const lamports = Math.round(size.sol * 1e9); let q, got, spent = size.sol, sig = 'practice', costPct = null;
  // If the buy fails on-chain (the price moved past the slippage limit), nothing was bought: it is tried once more at a fresh price.
  for (let attempt = 1; ; attempt++) {
    q = await api(`/api/quote?${new URLSearchParams({ inputMint: SOL, outputMint: t.mint, amount: String(lamports), slip: String(r.slippageBps) })}`);
    if (!q.check.ok) { say('induna', `${t.symbol}: ${q.check.reasons.join('; ')}. Waiting.`); return false; }
    const back = await api(`/api/quote?${new URLSearchParams({ inputMint: t.mint, outputMint: SOL, amount: q.quote.outAmount, exit: '1' })}`), loss = (1 - Number(back.quote.outAmount) / lamports) * 100;
    // Selling straight back must cost 3% or less. Most watched coins cost under 1%; a coin costing more has to rise a long way just to break even.
    if (!(loss <= 3)) { say('isihlangu', `${t.symbol} refused: selling straight back would cost ${loss.toFixed(1)}% (the limit is 3%).`, 'down'); state.cooldown[t.mint] = Date.now() + 3_600_000; return false; }
    costPct = Math.max(0, loss);
    got = q.quote.outAmount;
    if (!live()) { state.paperSol -= size.sol; break; }
    const before = await liveBalance(), res = await swap(q.quote, false); sig = res.signature;
    if (res.outcome === 'failed' && attempt < 2) { say('induna', `${t.symbol}: the buy failed on-chain (the price moved). Nothing was bought. Trying once more at a fresh price.`); continue; }
    if (res.outcome !== 'confirmed') { say('induna', `${t.symbol}: the buy ${res.outcome === 'failed' ? 'failed on-chain twice; nothing was bought' : 'outcome is unknown; not retrying'}.`, 'down'); return false; }
    const held = await tokenRaw(t.mint); if (held === 0n) { say('induna', `${t.symbol}: no coins arrived. Not retrying.`, 'down'); return false; }
    got = held.toString(); try { spent = Math.max(size.sol, before - await liveBalance()); } catch { /* keep the requested size */ }
    break;
  }
  const price = Number(q.quote.swapUsdValue) / (Number(got) / 10 ** safety.decimals), entry = Number.isFinite(price) && price > 0 ? price : a.price;
  const stop = entry * (1 - (a.stopPct ?? 10) / 100);
  state.positions.push({ mode: state.mode, mint: t.mint, symbol: t.symbol, pool: t.pool, solIn: spent, tokenRaw: got, entry, stop, baseStop: stop, target: entry * (1 + rules.settings.targetPct / 100), entryBar: a.at ?? Date.now(), openedAt: Date.now(), peak: entry, tf: a.tf === 1 ? 1 : 5, ...(a.style === 'dip' ? { dip: 1 } : {}), style: a.style ?? 'trend', auto: {}, sig, rules: rules.version, costPct });
  save(); emit('trade', { side: 'buy', symbol: t.symbol, sol: spent });
  say('umkhonto', `BUY ${t.symbol}: ${spent.toFixed(4)} SOL${live() ? '' : ' (practice)'} · stop −${(a.stopPct ?? 10).toFixed(0)}% · target +${rules.settings.targetPct}% · cost ${costPct.toFixed(2)}% · ${a.dipNote ?? a.smartNote ?? 'signals agree'}.`, 'up');
  return true;
}

/** Sell all of a position, or a part of it. Records the result after every cost. */
export async function sell(p, reason, fraction = 1) {
  const whole = fraction >= 0.999, held = live() ? await tokenRaw(p.mint) : BigInt(p.tokenRaw);
  if (held === 0n) { state.positions = state.positions.filter((x) => x !== p); save(); return false; }
  const raw = whole ? held : held * BigInt(Math.round(fraction * 10_000)) / 10_000n;
  const q = await api(`/api/quote?${new URLSearchParams({ inputMint: p.mint, outputMint: SOL, amount: raw.toString(), exit: '1' })}`);
  if (!q.check.ok) { say('induna', `${p.symbol}: cannot sell yet (${q.check.reasons.join('; ')}). Will retry.`); return false; }
  let out = Number(q.quote.outAmount) / 1e9;
  let rent = 0;
  if (live()) { const before = await liveBalance(), res = await swap(q.quote, true); if (res.outcome !== 'confirmed') { say('induna', `${p.symbol}: sell ${res.outcome}. Checking again next round.`, 'down'); return false; } out = Math.max(0, await liveBalance() - before);
    // The coin's now-empty account holds about 0.002 SOL of rent: close it and count that rent as part of what came back.
    if (whole) { rent = await reclaim(p.mint); out += rent; } }
  else state.paperSol += out;
  const cost = whole ? p.solIn : p.solIn * fraction, pnl = out - cost;
  state.trades.push({ mode: p.mode, symbol: p.symbol, mint: p.mint, solIn: cost, solOut: out, pnlSol: pnl, pnlPct: pnl / cost * 100, reason, style: p.style, partial: !whole, openedAt: p.openedAt, closedAt: Date.now(), rules: p.rules, costPct: p.costPct ?? null });
  if (whole) { state.positions = state.positions.filter((x) => x !== p); const R = resolveRules({ preset: state.preset }).risk; state.cooldown[p.mint] = Math.max(Date.now() + (pnl < 0 ? R.lossCooldownMinutes : R.cooldownMinutes) * 60_000, p.dip === 1 ? p.openedAt + DIP_REPEAT_HOURS * 3_600_000 : 0); } // the same waits as Laugh
  else { p.solIn -= cost; p.tokenRaw = (held - raw).toString(); delete p.nowSol; } // the old value was for the whole position
  save(); emit('trade', { side: 'sell', symbol: p.symbol, pnl });
  say('umlobi', `SELL ${p.symbol}${whole ? '' : ` (${Math.round(fraction * 100)}%)`}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${(pnl / cost * 100).toFixed(1)}%) · ${reason}${rent > 0 ? ` · ${rent.toFixed(4)} SOL of account rent back` : ''}.`, pnl >= 0 ? 'up' : 'down');
  return true;
}

/** Every 30 seconds: price each open position, take profit in steps, and follow the stop, target and clock. */
export async function watch(rules) {
  const list = mine(); if (!list.length) return;
  let res = []; try { res = (await post('/api/manage', { rules: { preset: state.preset }, positions: list.slice(0, 6).map((p) => ({ pool: p.pool, mint: p.mint, entry: p.entry, stop: p.stop, target: p.target, entryBar: p.entryBar, openedAt: p.openedAt, peak: p.peak, tf: p.tf, baseStop: p.baseStop, ...(p.dip === 1 ? { dip: 1 } : {}) })) })).results; } catch (e) { say('induna', `Positions could not be checked (${e.message}). Holding.`); return; }
  for (const [i, m] of res.entries()) {
    const p = list[i]; if (!p || m.pool !== p.pool) continue;
    if (m.peak) p.peak = m.peak; if (m.stop) p.stop = Math.max(p.stop, m.stop); if (m.lastPrice) p.last = m.lastPrice;
    if (p.empty) continue; // an emptied pool cannot be sold into
    if (m.action === 'exit') { await sell(p, m.reason); continue; }
    try { // what the position would fetch right now, for the screen and for the profit steps
      const raw = live() ? await tokenRaw(p.mint) : BigInt(p.tokenRaw), q = await api(`/api/quote?${new URLSearchParams({ inputMint: p.mint, outputMint: SOL, amount: raw.toString(), exit: '1' })}`);
      p.nowSol = Number(q.quote.outAmount) / 1e9; const due = partialDue(p, (p.nowSol / p.solIn - 1) * 100, rules.settings);
      if (due?.kind === 'sell' && await sell(p, due.reason, due.fraction)) p.auto[due.mark] = true;
    } catch { /* priced again next round */ }
  }
  save();
}
/** Close this wallet's empty coin account for `mint` and return the rent that came back (0 when nothing to close). */
async function reclaim(mint) {
  try {
    const info = await api(`/api/balance?owner=${vault.address}&empty=1`), list = closableAccounts(info.emptyAccounts, { mint }); if (!list.length) return 0;
    const start = await liveBalance(), { blockhash } = await api('/api/chain'), me = vault.keypair.publicKey, tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
    for (const a of list) tx.add(new TransactionInstruction({ programId: new PublicKey(a.program), keys: [{ pubkey: new PublicKey(a.address), isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: CLOSE_ACCOUNT_DATA }));
    tx.sign(vault.keypair); const { signature } = await post('/api/send', { transaction: b64(tx.serialize()) });
    if (await waitFor(signature) !== 'confirmed') return 0;
    return Math.max(0, await liveBalance() - start);
  } catch { return 0; } // the rent stays claimable later
}
/** Every 15 seconds: the stop and target against the live price, between candle checks. Two looks in a row must agree. */
const seen = new Map();
export async function liveStops({ auto = true } = {}) {
  const list = mine(); if (!list.length) return;
  let j; try { j = await api(`/api/coin?what=prices&mints=${[...new Set(list.map((p) => p.mint))].join(',')}`); } catch { return; }
  for (const p of list) {
    const liq = j.liquidity?.[p.mint]; if (liq !== undefined) { const was = !!p.empty; p.empty = poolEmptied(liq); if (p.empty && !was) say('isihlangu', `${p.symbol}: its pool has been emptied, so it cannot be sold right now. Watching in case that changes.`, 'down'); }
    if (p.empty) continue;
    const price = j.prices?.[p.mint]; if (Number.isFinite(price)) p.last = price;
    // your own stop and target work whether or not the impi is out
    const own = ownExitDue(p, price); if (own) { await sell(p, `my ${own}`); continue; }
    if (!auto) { seen.delete(`${p.mode}:${p.mint}`); continue; }
    const due = autoExitDue(p, price); if (!confirm(seen, `${p.mode}:${p.mint}`, due)) continue;
    seen.delete(`${p.mode}:${p.mint}`); await sell(p, due === 'stop' && p.stop >= p.entry ? 'trailing-stop' : due);
  }
  save();
}
/** Add funds to an open position: buy more of the same coin. The average price paid is worked out again from both buys. */
export async function addFunds(p, sol, slippageBps) {
  if (p.mode !== state.mode) throw new Error(`This position was opened in ${p.mode === 'live' ? 'live' : 'practice'} mode. Switch back to act on it`);
  if (!(sol >= 0.01 && sol <= 5)) throw new Error('Add 0.01 to 5 SOL');
  const bal = await balance(); if (sol > bal - (live() ? 0.01 : 0)) throw new Error(`Not enough SOL: ${bal.toFixed(4)} in the wallet${live() ? ', and about 0.01 is kept for fees' : ''}`);
  const safety = await api(`/api/coin?what=mint&mint=${p.mint}`); if (!safety.safe) throw new Error(safety.reason);
  const q = await api(`/api/quote?${new URLSearchParams({ inputMint: SOL, outputMint: p.mint, amount: String(Math.round(sol * 1e9)), slip: String(slippageBps) })}`);
  if (!q.check.ok) throw new Error(q.check.reasons.join('; '));
  let got = BigInt(q.quote.outAmount), spent = sol;
  if (live()) { const before = await liveBalance(), had = await tokenRaw(p.mint), res = await swap(q.quote, false); if (res.outcome !== 'confirmed') throw new Error(`the buy ${res.outcome === 'failed' ? 'failed on-chain; nothing was bought' : 'outcome is unknown'}`); got = (await tokenRaw(p.mint)) - had; try { spent = Math.max(sol, before - await liveBalance()); } catch { /* keep the asked amount */ } }
  else state.paperSol -= sol;
  if (got <= 0n) throw new Error('no coins arrived');
  const price = Number(q.quote.swapUsdValue) / (Number(got) / 10 ** safety.decimals), had = Number(p.tokenRaw), more = Number(got);
  if (Number.isFinite(price) && price > 0 && had + more > 0) p.entry = (p.entry * had + price * more) / (had + more);
  p.solIn += spent; p.tokenRaw = (BigInt(p.tokenRaw) + got).toString(); delete p.nowSol; save(); emit('trade', { side: 'buy', symbol: p.symbol, sol: spent });
  say('umkhonto', `ADD ${p.symbol}: ${spent.toFixed(4)} SOL${live() ? '' : ' (practice)'} · now ${p.solIn.toFixed(4)} SOL in it.`, 'up'); return true;
}
export async function sellAll() { for (const p of [...mine()]) await sell(p, 'get-me-out'); }
