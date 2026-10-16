// The trader: buys, sells and watches positions for the impi, in practice (pretend SOL, real quotes) or live (the trading
// wallet, real swaps through Jupiter). Every live transaction is checked before it is signed: it must be paid by the
// trading wallet, need no other signature, and call only the programs a Jupiter swap uses.
import { VersionedTransaction } from '/vendor/solana.js';
import { unexpectedPrograms } from '/vendor/lib/vault.js';
import { positionSize } from '/vendor/lib/risk.js';
import { partialDue } from '/vendor/lib/orders.js';
import { state, save, api, post, SOL, emit } from './store.js';
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
  const built = await post('/api/swap', { quoteResponse, userPublicKey: vault.address, exit, maxPriorityLamports: 200_000 });
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));
  if (tx.message.staticAccountKeys[0].toBase58() !== vault.address || tx.message.header.numRequiredSignatures !== 1) throw new Error('swap was not built for this wallet');
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()), odd = unexpectedPrograms(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex] ?? 'unknown'));
  if (odd.length) throw new Error(`swap refused: it calls a program Warrior does not expect (${odd[0].slice(0, 8)}…)`);
  tx.sign([vault.keypair]);
  const { signature } = await post('/api/send', { transaction: b64(tx.serialize()) }); return { signature, outcome: await waitFor(signature) };
}

/**
 * Buy a coin the spear picked. The shield checks it twice more first: the token itself (freeze/mint authority) and its
 * launch record (bundled buys, staged launches). Then a round trip is priced: a coin that loses over 6% when sold straight
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
  const lamports = Math.round(size.sol * 1e9), q = await api(`/api/quote?${new URLSearchParams({ inputMint: SOL, outputMint: t.mint, amount: String(lamports), slip: String(r.slippageBps) })}`);
  if (!q.check.ok) { say('induna', `${t.symbol}: ${q.check.reasons.join('; ')}. Waiting.`); return false; }
  const back = await api(`/api/quote?${new URLSearchParams({ inputMint: t.mint, outputMint: SOL, amount: q.quote.outAmount, exit: '1' })}`), loss = (1 - Number(back.quote.outAmount) / lamports) * 100;
  if (!(loss <= 6)) { say('isihlangu', `${t.symbol} refused: selling straight back would lose ${loss.toFixed(1)}%.`, 'down'); state.cooldown[t.mint] = Date.now() + 3_600_000; return false; }
  let got = q.quote.outAmount, spent = size.sol, sig = 'practice';
  if (live()) {
    const before = await liveBalance(), res = await swap(q.quote, false); sig = res.signature;
    if (res.outcome !== 'confirmed') { say('induna', `${t.symbol}: the buy ${res.outcome === 'failed' ? 'failed on-chain (the price moved); nothing was bought' : 'outcome is unknown; not retrying'}.`, 'down'); return false; }
    got = (await tokenRaw(t.mint)).toString(); try { spent = Math.max(size.sol, before - await liveBalance()); } catch { /* keep the requested size */ }
  } else state.paperSol -= size.sol;
  const price = Number(q.quote.swapUsdValue) / (Number(got) / 10 ** safety.decimals), entry = Number.isFinite(price) && price > 0 ? price : a.price;
  const stop = entry * (1 - (a.stopPct ?? 10) / 100);
  state.positions.push({ mode: state.mode, mint: t.mint, symbol: t.symbol, pool: t.pool, solIn: spent, tokenRaw: got, entry, stop, baseStop: stop, target: entry * (1 + rules.settings.targetPct / 100), entryBar: a.at ?? Date.now(), openedAt: Date.now(), peak: entry, tf: a.tf === 1 ? 1 : 5, ...(a.style === 'dip' ? { dip: 1 } : {}), style: a.style ?? 'trend', auto: {}, sig, rules: rules.version });
  save(); emit('trade', { side: 'buy', symbol: t.symbol, sol: spent });
  say('umkhonto', `BUY ${t.symbol}: ${spent.toFixed(4)} SOL${live() ? '' : ' (practice)'} · stop −${(a.stopPct ?? 10).toFixed(0)}% · target +${rules.settings.targetPct}% · ${a.dipNote ?? a.smartNote ?? 'signals agree'}.`, 'up');
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
  if (live()) { const before = await liveBalance(), res = await swap(q.quote, true); if (res.outcome !== 'confirmed') { say('induna', `${p.symbol}: sell ${res.outcome}. Checking again next round.`, 'down'); return false; } out = Math.max(0, await liveBalance() - before); }
  else state.paperSol += out;
  const cost = whole ? p.solIn : p.solIn * fraction, pnl = out - cost;
  state.trades.push({ mode: p.mode, symbol: p.symbol, mint: p.mint, solIn: cost, solOut: out, pnlSol: pnl, pnlPct: pnl / cost * 100, reason, style: p.style, partial: !whole, openedAt: p.openedAt, closedAt: Date.now(), rules: p.rules });
  if (whole) { state.positions = state.positions.filter((x) => x !== p); state.cooldown[p.mint] = Math.max(Date.now() + (pnl < 0 ? 120 : 30) * 60_000, p.dip === 1 ? p.openedAt + 6 * 3_600_000 : 0); }
  else { p.solIn -= cost; p.tokenRaw = (held - raw).toString(); }
  save(); emit('trade', { side: 'sell', symbol: p.symbol, pnl });
  say('umlobi', `SELL ${p.symbol}${whole ? '' : ` (${Math.round(fraction * 100)}%)`}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${(pnl / cost * 100).toFixed(1)}%) · ${reason}.`, pnl >= 0 ? 'up' : 'down');
  return true;
}

/** Every 30 seconds: price each open position, take profit in steps, and follow the stop, target and clock. */
export async function watch(rules) {
  const list = mine(); if (!list.length) return;
  let res = []; try { res = (await post('/api/manage', { rules: { preset: state.preset }, positions: list.slice(0, 6).map((p) => ({ pool: p.pool, mint: p.mint, entry: p.entry, stop: p.stop, target: p.target, entryBar: p.entryBar, openedAt: p.openedAt, peak: p.peak, tf: p.tf, baseStop: p.baseStop, ...(p.dip === 1 ? { dip: 1 } : {}) })) })).results; } catch (e) { say('induna', `Positions could not be checked (${e.message}). Holding.`); return; }
  for (const [i, m] of res.entries()) {
    const p = list[i]; if (!p || m.pool !== p.pool) continue;
    if (m.peak) p.peak = m.peak; if (m.stop) p.stop = Math.max(p.stop, m.stop); if (m.lastPrice) p.last = m.lastPrice;
    if (m.action === 'exit') { await sell(p, m.reason); continue; }
    try { // what the position would fetch right now, for the screen and for the profit steps
      const raw = live() ? await tokenRaw(p.mint) : BigInt(p.tokenRaw), q = await api(`/api/quote?${new URLSearchParams({ inputMint: p.mint, outputMint: SOL, amount: raw.toString(), exit: '1' })}`);
      p.nowSol = Number(q.quote.outAmount) / 1e9; const due = partialDue(p, (p.nowSol / p.solIn - 1) * 100, rules.settings);
      if (due?.kind === 'sell' && await sell(p, due.reason, due.fraction)) p.auto[due.mark] = true;
    } catch { /* priced again next round */ }
  }
  save();
}
export async function sellAll() { for (const p of [...mine()]) await sell(p, 'get-me-out'); }
