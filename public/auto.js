// Warrior auto-trading and practice trading in this browser tab.
// The trading wallet's key is handled only by /wallet.js: stored encrypted, opened with a passphrase, held in memory.
// PRACTICE (paper) needs no wallet at all: it uses real market data and real quotes with pretend SOL, and sends nothing.
// LIVE uses a small trading wallet created HERE, in this browser. Its key is kept in this browser's storage and is never
// sent to any server: transactions are signed on this page and only the signed result is relayed.
// While this tab is open and auto-trading is on, the page manages open positions, then scans and buys ENTER signals inside
// the risk rules. It can lose money and promises nothing.
import { Keypair, VersionedTransaction, Transaction, TransactionInstruction, SystemProgram, PublicKey } from '/vendor/solana.js';
import { session } from '/app.js';
import { tradeClosed } from '/joy.js';
import { on, emit } from '/bus.js';
import { rules as dial } from '/rules.js';
import { entryCosts, addEntryCosts, shareOf } from '/vendor/lib/receipt.js';
import { coachBefore, coachAfter } from '/vendor/lib/coach.js';
import { rebasePosition, DIP_REPEAT_HOURS } from '/vendor/lib/strategy.js';
import { bedtime } from '/care.js';
import { vault, walletSteps } from '/wallet.js';
import { coinInfo } from '/coininfo.js';
import { claimTrading, releaseTrading, holdWhile } from '/sync.js';
import { rocketFor, defaultRocket, validateRocket, rocketPlan, rocketRoom, rocketWatch, rocketTrust, rocketHealth, rocketRecord, rocketRecordText, earlyPlan, earlyTrust, rocketLimits, earlyLimits, rocketRatchet, rocketFlow } from '/vendor/lib/rocket.js';
import { partialDue } from '/vendor/lib/orders.js';
import { lineChart } from '/chart.js';
import { sweepLamports, unexpectedPrograms, closableAccounts, CLOSE_ACCOUNT_DATA } from '/vendor/lib/vault.js';
import { positionSize } from '/vendor/lib/risk.js';

const SOL = 'So11111111111111111111111111111111111111112', SKEY = 'warrior.auto.state.v1', ROUND_MS = 60_000;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const b64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const b58 = (bytes) => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let out = ''; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; } for (const b of bytes) { if (b !== 0) break; out = '1' + out; } return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- stored state ----------
const blank = () => ({ mode: 'paper', paperSol: 0.5, positions: [], trades: [], day: '', dayPnlSol: 0, cooldown: {}, log: [], backedUp: false, sweep: { on: false, to: '', keepSol: 0.2 }, reclaim: false, rocket: { ...defaultRocket }, rocketDay: { day: '', bets: 0 } });
let state = blank(); try { const saved = JSON.parse(localStorage.getItem(SKEY) ?? 'null'); if (saved && Array.isArray(saved.positions)) state = { ...blank(), ...saved }; } catch {}
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify({ ...state, log: state.log.slice(-150), trades: state.trades.slice(-200) })); } catch {} };
// Positions, history and the log from another device. While this device runs the auto trader its own copy wins a
// disagreement (lib/sync.mjs), so this only arrives here when nothing here changed since the last sync.
holdWhile(() => !busy);
on('synced', (keys) => { if (!keys.includes(SKEY)) return; try { const s = JSON.parse(localStorage.getItem(SKEY) ?? 'null'); if (s && Array.isArray(s.positions)) { state = { ...blank(), ...s }; render(); emit('positions-synced'); } } catch {} });
// The rules in force: the strategy dial's choice, resolved to exact numbers and stamped with a version.
let rules = dial.resolved, lastNote = '', running = false, busy = false, balance = null, timer = null, wake = null, release = null;
const address = () => vault.address;
const live = () => state.mode === 'live';
const openIn = (mode) => state.positions.filter((p) => p.mode === mode);
// Positions that can still be sold. One whose pool was emptied is worth nothing and does not use up a slot.
const sellable = (mode) => openIn(mode).filter((p) => !p.empty);
// "Positions at once" counts ordinary positions only. Rocket bets have their own count, on top, so neither crowds the other out.
const regular = (mode) => sellable(mode).filter((p) => !p.rocket);
const heldSol = (mode) => sellable(mode).reduce((n, p) => n + p.solIn, 0);
function log(text) { lastNote = text; state.log.push({ t: Date.now(), text }); save(); renderLog(); }
/**
 * Has today's loss reached the daily limit? The loss is measured against what the wallet was worth at the start of the
 * day (what it is worth now, plus what was lost today). Measuring against what is left made the limit trip early: with
 * a 75% limit it stopped trading after a 43% loss, and taking SOL out of the wallet made a small loss look huge.
 */
function dayLoss(equity) { const lost = -Math.min(0, state.dayPnlSol), start = equity + lost; return { lost, start, pct: start > 0 ? lost / start * 100 : 0 }; }
const dayLimitHit = (equity, r) => { const d = dayLoss(equity); return d.lost > 0 && d.pct >= r.dailyLossLimitPct; };
function rollDay() { const today = new Date().toISOString().slice(0, 10); if (state.day !== today) { state.day = today; state.dayPnlSol = 0; } }

// ---------- server calls (read chain state, build unsigned swaps, relay signed transactions) ----------
async function api(path, init) { const r = await fetch(path, init); let j = null; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`); return j; }
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function balanceSol(mode = state.mode) { if (mode !== 'live') return state.paperSol; return (await api(`/api/balance?owner=${address()}`)).sol; }
async function tokenRaw(mint) { return BigInt((await api(`/api/balance?owner=${address()}&mint=${mint}`)).tokenRaw ?? '0'); }
/** Relay a signed transaction and wait for the network's answer. Never resends. */
async function relay(signedBytes, protect = false) {
  const { signature } = await post('/api/send', { transaction: b64(signedBytes), protect });
  for (let i = 0; i < 24; i++) { await sleep(2500); const { outcome } = await api(`/api/status?signature=${signature}`).catch(() => ({ outcome: 'unknown' })); if (outcome !== 'unknown') return { signature, outcome }; }
  return { signature, outcome: 'unknown' };
}
async function swap(quoteResponse, exit = false) {
  if (!vault.unlocked) throw new Error('the trading wallet is locked; unlock it first');
  const how = dial.send, built = await post('/api/swap', { quoteResponse, userPublicKey: address(), exit, maxPriorityLamports: how.maxPriorityLamports, protect: how.protect });
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));
  // The transaction must be payable by this wallet and nobody else's signature may be required.
  if (tx.message.staticAccountKeys[0].toBase58() !== address() || tx.message.header.numRequiredSignatures !== 1) throw new Error('Swap was not built for this wallet');
  // A swap should only call the handful of programs a Jupiter swap needs. Anything else is not signed.
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()), odd = unexpectedPrograms(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex] ?? 'unknown'));
  if (odd.length) throw new Error(`swap refused: it calls a program Warrior does not expect (${odd[0].slice(0, 8)}…)`);
  tx.sign([vault.keypair]); return relay(tx.serialize(), how.protect);
}

// ---------- trades ----------
/**
 * Close a position, or part of it (`fraction` below 1). A position remembers whether it is practice or live; that, not the
 * current mode, decides what happens. Returns true when something was sold.
 */
async function closePosition(p, reason, fraction = 1) {
  const isLive = p.mode === 'live', part = Math.min(1, Math.max(0, fraction)), whole = part >= 0.999;
  try {
    const held = isLive ? await tokenRaw(p.mint) : BigInt(p.tokenRaw);
    if (held === 0n) { log(`${p.symbol}: nothing left in the wallet; marking it closed.`); state.positions = state.positions.filter((x) => x !== p); save(); return false; }
    const raw = whole ? held : held * BigInt(Math.round(part * 10_000)) / 10_000n; if (raw === 0n) { log(`${p.symbol}: that slice is too small to sell.`); return false; }
    const { quote, check } = await api(`/api/quote?${new URLSearchParams({ inputMint: p.mint, outputMint: SOL, amount: raw.toString(), exit: '1', slip: String(dial.slip) })}`);
    if (!check.ok) { log(`${p.symbol}: exit (${reason}) refused for now: ${check.reasons.join('; ')}. Will retry.`); return false; }
    const quotedOut = Number(quote.outAmount) / 1e9; let solOut = quotedOut, signature = 'paper', rentBack = 0;
    if (isLive) { const before = await balanceSol('live'), r = await swap(quote, true); signature = r.signature; if (r.outcome !== 'confirmed') { log(`${p.symbol}: exit ${r.outcome}. Not resending; will re-check the wallet next round.`); return false; } solOut = Math.max(0, await balanceSol('live') - before);
      // If you asked for it: close this coin's now-empty account and count the returned rent as part of what came back.
      if (whole && state.reclaim) { rentBack = await reclaimRent(p.mint); solOut += rentBack; } }
    else state.paperSol += solOut;
    const cost = whole ? p.solIn : p.solIn * part, pnl = solOut - cost, pnlPct = pnl / cost * 100; if (p.mode === state.mode) state.dayPnlSol += pnl;
    // The stop had moved up, but the price fell through it: no profit was kept, so the sale is not called a profit-lock.
    if (reason === 'profit-lock' && pnl < 0) reason = 'stop';
    // Everything the honest receipt needs is written down now, while the quote is in hand.
    const trade = { ...(p.rocket ? { rocket: true } : {}), kind: p.rocket ? (p.rocket.early === 1 ? 'early' : p.rocket.copy === 1 ? 'rocket-copy' : 'rocket') : p.style === 'smart' ? 'smart-wallets' : p.dip === 1 ? 'deep-dip' : p.why === 'signal' ? 'signal' : 'own-pick', ...(p.checked ? { checked: p.checked } : {}), mint: p.mint, symbol: p.symbol, solIn: cost, solOut, pnlSol: pnl, pnlPct, reason, openedAt: p.openedAt, closedAt: Date.now(), mode: p.mode, exit: signature, partial: !whole, rulesVersion: p.rulesVersion ?? null, costs: { entry: shareOf(p.costs ?? null, whole ? 1 : part), exitImpactPct: check.impactPct, exitQuotedSol: quotedOut }, rentBackSol: rentBack };
    state.trades.push(trade);
    if (whole) { state.positions = state.positions.filter((x) => x !== p); state.cooldown[p.mint] = Math.max(Date.now() + (pnl < 0 ? rules.risk.lossCooldownMinutes ?? 120 : rules.risk.cooldownMinutes) * 60_000, p.dip === 1 ? (p.openedAt ?? Date.now()) + DIP_REPEAT_HOURS * 3_600_000 : 0); } // one deep-dip buy per coin every six hours
    else { delete p.nowSol; soldNow.delete(`${p.mode}:${p.mint}`); setTimeout(() => void quoteNow(p), 300); p.solIn -= cost; p.tokenRaw = (held - raw).toString(); p.costs = shareOf(p.costs ?? null, 1 - part); }
    save();
    log(`SELL ${p.symbol}${whole ? '' : ` (${Math.round(part * 100)}% of it)`} (${reason}): ${cost.toFixed(4)} SOL in, ${solOut.toFixed(4)} out, ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)${isLive ? '' : ' — practice'}`);
    // The feel layer decides: a celebration for money made, a kind word for a loss, a shrug for a wash.
    tradeClosed({ symbol: p.symbol, pnlSol: pnl, pnlPct, reason, practice: !isLive });
    const coach = coachAfter(trade); log(`Coach: ${coach.happened} ${coach.learned}`);
    if (isLive && whole) await sweep();
    emit('trade', { type: 'sell', symbol: p.symbol, mint: p.mint, reason, pnlSol: pnl, pnlPct, mode: p.mode, partial: !whole });
    return true;
  } catch (e) { log(`${p.symbol}: exit attempt failed (${e.message}). Will retry.`); return false; }
  finally { render(); }
}
/**
 * Open a position in the given mode, or add to one (`opts.add`). `opts.fixedSol` is an amount you chose (an order or a
 * slice); it is still capped by the most-in-one-coin rule and the fee reserve. Returns true when coins were bought.
 */
let failKind = 'no'; // why the last buy did not happen: 'later' (worth another try shortly), 'unknown' (do not retry), 'no' (refused)
async function openPosition(t, bal, equity, mode = state.mode, opts = {}) {
  failKind = 'no';
  const isLive = mode === 'live', a = { ...(t.analysis ?? {}) }, r = rules.risk, stopPct = Number.isFinite(a.stopPct) ? a.stopPct : 8;
  const existing = opts.add ? state.positions.find((p) => p.mode === mode && p.mint === t.mint) : null;
  let sol;
  if (Number.isFinite(opts.fixedSol)) {
    const room = equity * r.maxPositionPct / 100 - (existing?.solIn ?? 0); sol = Math.floor(Math.max(0, Math.min(opts.fixedSol, room, bal - r.reserveSol)) * 1e6) / 1e6;
    if (sol < r.minTradeSol) { log(`${t.symbol}: skipped. ${room < r.minTradeSol ? `Your rules allow at most ${r.maxPositionPct}% of the wallet in one coin` : 'Not enough SOL after the fee reserve'}.`); return false; }
    if (sol < opts.fixedSol * 0.999) log(`${t.symbol}: amount trimmed to ${sol.toFixed(4)} SOL by your limits.`);
  } else {
    // The same tested sizing rule the bot uses. Position count and the daily limit are checked before this point.
    const size = positionSize({ balanceSol: bal, equitySol: equity, stopPct, openPositions: 0, dayPnlSol: 0, sizeFactor: a.sizeFactor ?? 1 }, r); sol = size.sol;
    if (!sol) { log(`${t.symbol}: skipped. ${size.reasons.join('; ')}.`); return false; }
    if (size.raised) log(`${t.symbol}: your wallet is small, so this trade uses the smallest size, ${sol} SOL. If the stop is hit it loses about ${size.riskPct.toFixed(1)}% of the wallet instead of the usual ${(r.riskPerTradePct * (a.sizeFactor ?? 1)).toFixed(1)}%.`);
  }
  const safety = await api(`/api/coin?what=mint&mint=${t.mint}`); if (!safety.safe) { log(`${t.symbol}: skipped, ${safety.reason}.`); state.cooldown[t.mint] = Date.now() + 6 * 3_600_000; return false; }
  // Does the launch look staged (bought up by bundled wallets, or a name already launched and dumped)? If that cannot be
  // checked, the coin is not bought: unknown is not safe.
  let launch; try { launch = await api(`/api/coin?what=audit&mint=${t.mint}&level=${dial.choice.preset}${opts.early ? '&early=1' : ''}${opts.rocket ? `&trend=1&pool=${t.pool}` : ''}`); } catch (e) { log(`${t.symbol}: skipped, its launch record could not be checked (${e.message}).`); return false; }
  // A coin that is only dipping right now may be worth another look in a minute; any other refusal waits a day.
  if (!launch.ok) { const onlyDip = launch.trend && !launch.trend.ok && launch.reasons.length === 1; if (onlyDip) failKind = 'dip'; log(`${t.symbol}: skipped. ${launch.reasons.join('. ')}.`); state.cooldown[t.mint] = Date.now() + (onlyDip ? 60_000 : 24 * 3_600_000); return false; }
  // The price the screen saw can be a minute old. If the live price is already well under it, the coin is falling as Warrior buys.
  if (opts.rocket && Number.isFinite(launch.priceUsd) && Number.isFinite(t.priceUsd) && launch.priceUsd < t.priceUsd * 0.88) { failKind = 'dip'; log(`${t.symbol}: skipped. Its price has fallen ${Math.round((1 - launch.priceUsd / t.priceUsd) * 100)}% since it passed the screen: it is dipping.`); state.cooldown[t.mint] = Date.now() + 60_000; return false; }
  // What the launch check saw at this moment, kept with the position so a bad trade can be explained afterwards.
  const checked = launch?.judged ? { at: Date.now(), ageMin: Math.round(launch.ageMin ?? NaN), holders: launch.holders ?? null, traders: launch.traders ?? null, bundles: launch.bundles ?? null, bundlerPeakPct: launch.bundlerPeakPct ?? null, curveSecs: launch.curveSecs ?? null, sameName: launch.clones?.rivals ?? null, biggest: launch.clones?.leader ?? null, topHoldersPct: launch.topHoldersPct ?? null } : null;
  if (checked && !existing) log(`${t.symbol}: launch check passed. ${launch.trend ? (launch.trend.known ? (launch.trend.superTrendUp === true ? 'SuperTrend is up on the one-minute chart. ' : launch.trend.superTrendUp === null ? `Too few candles for SuperTrend (${launch.trend.candles}); it is ${Math.round(launch.trend.offHighPct)}% off its recent high. ` : '') : 'Too new to read a trend. ') : ''}${checked.ageMin} minutes old, ${checked.holders ?? '?'} holders, ${checked.traders ?? '?'} traders, ${checked.bundles ?? '?'} bundles, ${checked.sameName ? `${checked.sameName} other coins share its name and it is ${checked.biggest === 'yes' ? 'clearly the biggest' : 'ahead of them'}` : 'no other coin with a real crowd shares its name'}.`);
  // A Rocket bet is on a coin that moves fast, so it is allowed a wider slippage limit and price-impact allowance than an
  // ordinary trade. Without that, the price moves between the quote and the trade and the buy fails on-chain.
  const lamports = Math.round(sol * 1e9), slipBps = Math.min(1000, Math.max(dial.slip, opts.rocket ? (opts.early ? 1000 : 500) : 0)), quoteUrl = `/api/quote?${new URLSearchParams({ inputMint: SOL, outputMint: t.mint, amount: String(lamports), slip: String(slipBps), ...(opts.rocket ? { impact: '5' } : {}) })}`;
  let buy, signature = 'paper', got, spent = sol;
  // If the trade fails on-chain, nothing was bought and nothing was spent beyond the network fee: it is tried once more at a fresh price.
  for (let attempt = 1; ; attempt++) {
    buy = await api(quoteUrl);
    if (!buy.check.ok) { failKind = 'later'; log(`${t.symbol}: skipped, ${buy.check.reasons.join('; ').toLowerCase()}${/impact/i.test(buy.check.reasons.join(' ')) ? '. On a fast coin this often clears in a few seconds' : ''}.`); return false; }
    // Can it be sold straight back? A coin that loses a lot on an immediate round trip is taxed or trapped.
    const back = await api(`/api/quote?${new URLSearchParams({ inputMint: t.mint, outputMint: SOL, amount: buy.quote.outAmount, exit: '1' })}`), lossPct = (1 - Number(back.quote.outAmount) / lamports) * 100;
    if (!Number.isFinite(lossPct) || lossPct > 6) { failKind = opts.rocket ? 'later' : 'no'; log(`${t.symbol}: skipped, selling straight back would lose ${lossPct.toFixed(1)}%.`); if (!opts.rocket) state.cooldown[t.mint] = Date.now() + 3_600_000; return false; }
    got = buy.quote.outAmount;
    if (!isLive) { state.paperSol -= sol; break; }
    const heldBefore = existing ? await tokenRaw(t.mint) : 0n, r2 = await swap(buy.quote); signature = r2.signature;
    if (r2.outcome === 'failed') { if (attempt < 2) { log(`${t.symbol}: the buy did not go through on-chain (the price moved past the ${(slipBps / 100).toFixed(1)}% slippage limit, most likely). Nothing was bought. Trying once more at a fresh price.`); continue; } failKind = 'later'; log(`${t.symbol}: the buy failed on-chain twice. Nothing was bought.`); return false; }
    const heldAfter = await tokenRaw(t.mint); if (heldAfter <= heldBefore) { failKind = 'unknown'; log(`${t.symbol}: buy outcome unknown and no coins arrived. Not retrying.`); return false; }
    got = (heldAfter - heldBefore).toString();
    // What actually left the wallet, network fees and account rent included, so results are after every fee.
    try { spent = Math.max(sol, bal - await balanceSol('live')); } catch {}
    break;
  }
  // The entry is the price actually paid per coin, worked out from the swap itself. The signal's price can be minutes old on a
  // fast coin, and measuring from it made positions look further up or down than they were.
  const signal = Number.isFinite(a.price) ? a.price : t.priceUsd, paid = Number(buy.quote.swapUsdValue) / (Number(got) / 10 ** safety.decimals); // the price per coin, before network fees and rent, so it compares like-for-like with a chart
  // On a fast coin the price paid can be far from the price the screen saw a moment earlier. The price paid is the true one;
  // the screen's price is only used when the paid figure is absurd (more than five times off) or missing.
  const price = Number.isFinite(paid) && paid > 0 && (!Number.isFinite(signal) || !(signal > 0) || (paid / signal > 0.2 && paid / signal < 5)) ? paid : Number.isFinite(signal) ? signal : paid;
  if (Number.isFinite(signal) && signal > 0 && price !== signal) { if (Number.isFinite(a.stop)) a.stop = price * (a.stop / signal); if (Number.isFinite(a.target)) a.target = price * (a.target / signal); }
  const targetPct = a.targetPct ?? rules.settings.targetPct, costs = entryCosts({ requestedSol: sol, spentSol: spent, impactPct: buy.check.impactPct });
  if (existing) {
    existing.costs = addEntryCosts(existing.costs ?? null, costs);
    if (Number.isFinite(price) && Number.isFinite(existing.entry)) existing.entry = (existing.entry * existing.solIn + price * spent) / (existing.solIn + spent);
    delete existing.nowSol; soldNow.delete(`${mode}:${t.mint}`); existing.solIn += spent; existing.tokenRaw = (BigInt(existing.tokenRaw) + BigInt(got)).toString();
  } else state.positions.push({ mint: t.mint, symbol: t.symbol, pool: t.pool, solIn: spent, tokenRaw: got, entry: price, stop: a.stop ?? price * (1 - stopPct / 100), target: a.target ?? price * (1 + targetPct / 100), entryBar: a.at ?? Date.now(), peak: price, openedAt: Date.now(), signature, mode, rulesVersion: rules.version, why: opts.why ?? (a.decision === 'enter' ? 'signal' : 'manual'), costs, tf: a.tf === 1 ? 1 : 5, baseStop: a.stop ?? price * (1 - stopPct / 100), ...(a.style === 'dip' ? { dip: 1 } : {}), ...(a.style === 'smart' ? { style: 'smart' } : {}), ...(opts.rocket ? { rocket: opts.rocket } : {}), ...(checked ? { checked } : {}) });
  save(); log(`BUY ${t.symbol}${existing ? ' (adding)' : ''}: ${spent.toFixed(4)} SOL${existing ? '' : `, stop −${stopPct.toFixed(1)}%, target +${targetPct}%`}${a.style === 'smart' ? ` · ${a.smartNote}` : a.style === 'dip' ? ` · ${a.dipNote}` : a.decision === 'enter' ? `, ${a.score}/4 agree (${a.regime}, ${a.bias})` : ''}${a.young ? ' · YOUNG COIN, half size' : ''}${opts.why ? ` [${opts.why}]` : ''}${isLive ? '' : ' — practice'}`);
  if (!existing && a.decision === 'enter') { const coach = coachBefore(t, rules); log(`Coach: ${coach.why} ${coach.wrongIf}`); }
  if (!existing && a.decision === 'rocket') log(`Coach: A Rocket bet on a coin minutes old. Most of these end at or near zero, which is why the bet is small. This one is wrong at $${a.stop.toPrecision(4)} (−${a.stopPct}%), and done at +${a.targetPct.toLocaleString('en-US')}%.`);
  emit('trade', { type: 'buy', symbol: t.symbol, mint: t.mint, sol: spent, mode, why: opts.why ?? null });
  { const fresh = state.positions.find((x) => x.mode === mode && x.mint === t.mint); if (fresh) setTimeout(() => void quoteNow(fresh), 400); }
  render(); return true;
}
/** A practice buy on any coin, from the scanner. Pretend money, real quotes, nothing sent. Works without any wallet. */
async function practiceBuy(t) {
  if (busy) { log('One moment: finishing the current round first.'); return; }
  if (openIn('paper').some((p) => p.mint === t.mint)) { log(`You already hold ${t.symbol} in practice.`); focusPanel(); return; }
  busy = true; render(); focusPanel();
  try { const bal = state.paperSol, equity = bal + heldSol('paper'); log(`Practice buy: ${t.symbol}…`); if (!await openPosition(t, bal, equity, 'paper')) log('That practice buy did not go through. The reason is on the line above. Try another coin.'); }
  catch (e) { log(`Practice buy failed (${e.message}). Nothing was spent.`); }
  busy = false; if (!live()) balance = state.paperSol; render();
}
function focusPanel() { document.querySelector('.auto')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }

// ---------- the trading loop ----------
async function round() {
  rollDay(); const mine = openIn(state.mode);
  if (mine.length) {
    const { results } = await post('/api/manage', { rules: dial.asObject, positions: mine.slice(0, 6).map((p) => ({ pool: p.pool, mint: p.mint, ...(p.rocket ? { exits: p.rocket } : {}), entry: p.entry, stop: p.stop, target: p.target, entryBar: p.entryBar, openedAt: p.openedAt, peak: p.peak, tf: p.tf === 1 ? 1 : 5, baseStop: p.baseStop, ...(p.dip === 1 ? { dip: 1 } : {}), ...(p.style === 'smart' ? { style: 'smart' } : {}) })) });
    for (const [i, m] of results.entries()) {
      const p = mine[i]; if (!p || m.pool !== p.pool) continue;
      if (m.stale) { log(p.empty ? `${p.symbol}: its pool has been emptied, so it cannot be sold. Warrior keeps checking.` : `${p.symbol}: nobody has traded it for a while, so there are no fresh candles. Holding; its stop is still checked against the live price every 30 seconds.`); continue; }
      if (m.peak) p.peak = m.peak; if (m.stop) p.stop = Math.max(p.stop, m.stop); if (m.lastPrice) p.last = m.lastPrice;
      // A position you asked for (a practice buy, an order, slices, a copied buy) is yours to hold: its stop and target still
      // apply, but Warrior does not sell it just because the trend is missing or time passed.
      const yours = p.why && p.why !== 'signal' && ['trend-break', 'time'].includes(m.reason); // Rocket bets are in this group too
      if (m.action === 'exit' && !yours) await closePosition(p, m.reason); else { await quoteNow(p); const sold = soldNow.get(`${p.mode}:${p.mint}`), fresh = sold && Date.now() - sold.at < 20_000 ? (sold.solOut - p.solIn) / p.solIn * 100 : null, sign = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`; log(`hold ${p.symbol}: ${fresh === null ? `price ${sign(m.changePct)}` : `PnL ${sign(fresh)} if sold now (price ${sign(m.changePct)}, before selling costs)`}${yours ? ' (your pick: only its stop and target sell it)' : ''}`); }
    }
    save();
  }
  balance = await balanceSol();
  const open = sellable(state.mode), equity = balance + heldSol(state.mode), r = rules.risk;
  render();
  const bed = bedtime.now; if (!bed.canOpen) { log(`Bedtime rule: no new trades until ${bed.wakeAt}. Open positions are still watched.`); return; }
  if (dayLimitHit(equity, r)) { const d = dayLoss(equity); log(`Daily loss limit reached: down ${d.lost.toFixed(4)} SOL today, ${d.pct.toFixed(0)}% of the ${d.start.toFixed(4)} SOL the day started with (your limit is ${r.dailyLossLimitPct}%). No new trades today. "Reset the day" starts the count again.`); return; }
  // Rocket Mode still gets its look when the ordinary slots are full or the balance is too small for an ordinary trade.
  const slots = regular(state.mode).length, rocketToo = rocketPrefs().on ? ' Rocket Mode still looks.' : '';
  if (slots >= r.maxOpenPositions) { log(`Holding ${slots} position${slots === 1 ? '' : 's'}, the most your rules allow; not looking for more.${rocketToo}`); if (running) await rocketStep(); return; }
  if (balance < r.minTradeSol + r.reserveSol) { log(`Balance ${balance.toFixed(4)} SOL is too small for an ordinary trade. ${live() ? 'Fund the trading wallet.' : ''}${rocketToo}`); if (running) await rocketStep(); return; }
  const result = await api(`/api/scan?${dial.query}${$('auto-mature').checked ? '&mature=1' : ''}`); if (result.rules?.version === dial.resolved.version) rules = dial.resolved;
  const owned = new Set(openIn(state.mode).map((p) => p.mint)), picks = result.results.filter((t) => t.analysis.decision === 'enter' && !owned.has(t.mint) && !((state.cooldown[t.mint] ?? 0) > Date.now()));
  // Smart-wallet buys stay in practice until you switch them on for real funds.
  for (const t of picks.filter((t) => t.analysis.style === 'smart' && live() && rules.settings.smartLive !== 1)) { picks.splice(picks.indexOf(t), 1); log(`${t.symbol}: ${t.analysis.smartNote}. Not bought: smart-wallet buys are practice-only for now, until they have a record.`); }
  log(`scan: ${result.universe} coins watched, ${result.rejected} failed the screen, ${result.scanned} read on their candles, ${picks.length} tradable ENTER.`);
  for (const t of picks) { if (regular(state.mode).length >= r.maxOpenPositions || !running) break; try { await openPosition(t, await balanceSol(), equity); } catch (e) { log(`${t.symbol}: entry attempt failed (${e.message}).`); } }
  if (running) await rocketStep();
}
// ---------- Rocket Mode: one small bet at a time on a brand-new pump.fun coin ----------
// Rocket Mode's plan is the preset's; only on/off and the bet size are yours.
const rocketPrefs = () => rocketFor(dial.choice.preset, state.rocket ?? {}).value;
function rocketBets() { const today = new Date().toISOString().slice(0, 10); if (state.rocketDay?.day !== today) state.rocketDay = { day: today, bets: 0 }; return state.rocketDay; }
const openRockets = (mode) => openIn(mode).filter((p) => p.rocket && !p.empty).length;
/**
 * The fast watch on open Rocket bets: every five seconds, on one look. A brand-new coin can lose most of its value in
 * well under a minute, so these do not wait for the 30-second check or for a second look to agree.
 * It sells at the stop, and when a third of the pool money has left since the buy. Read-only until it sells.
 */
let watching = false;
setInterval(() => {
  const mine = openIn(state.mode).filter((p) => p.rocket && !p.empty); if (!mine.length || watching || busy) return; watching = true;
  void (async () => {
    try {
      const j = await api(`/api/coin?what=prices&mints=${mine.map((p) => p.mint).join(',')}`);
      for (const p of mine) {
        if (busy || !state.positions.includes(p)) continue; const price = j.prices?.[p.mint]; if (Number.isFinite(price)) p.last = price;
        // An early bet opened under the old tight plan (20% stop, trailing 15% under the high, a ten-minute clock) is moved to the current settings.
        if (p.rocket.early === 1 && p.rocket.widened !== 1) { const now = rocketPrefs(), base = Number.isFinite(p.entry) && p.entry > 0 ? p.entry : null; p.rocket = { ...p.rocket, trailStartPct: now.trailStartPct, trailGapPct: now.trailGapPct, takeOutAtPct: now.takeOutAtPct, protectAtPct: now.protectAtPct, sellOffExit: now.sellOffExit, widened: 1 }; if (!(now.earlyMinutes > 0)) delete p.rocket.maxMinutes; else p.rocket.maxMinutes = now.earlyMinutes; if (base && !(p.stop > base)) { p.stop = base * (1 - now.stopPct / 100); p.baseStop = p.stop; p.target = base * (1 + now.targetPct / 100); } log(`🚀 ${p.symbol}: this early bet now follows your Rocket settings (stop −${now.stopPct}%, target +${now.targetPct.toLocaleString('en-US')}%).`); save(); }
        // A bet opened before these two rules existed takes them from the current Rocket settings.
        if (p.rocket.protectAtPct === undefined || p.rocket.sellOffExit === undefined) { const now = rocketPrefs(); p.rocket = { ...p.rocket, protectAtPct: p.rocket.protectAtPct ?? now.protectAtPct, sellOffExit: p.rocket.sellOffExit ?? now.sellOffExit }; save(); }
        // Protect a profit: the stop moves up once the bet has been well up, and never comes back down.
        // What left the wallet against what was swapped: the stop has to clear that before a sale returns the stake.
        const costMult = p.costs?.requestedSol > 0 ? p.solIn / p.costs.requestedSol : 1, lift = rocketRatchet(p, price, { costMult });
        if (lift) { const moved = lift.stop > p.stop, first = moved && !(p.stop > p.entry); p.peakSeen = lift.peak; p.lastLook = lift.look; if (moved) { p.stop = lift.stop; if (first) log(`🚀 ${p.symbol}: it has held ${Math.round((lift.peak / p.entry - 1) * 100)}% up, so its stop moved to ${Math.round((lift.stop / p.entry - 1) * 100)}% above the price paid, which clears your costs. If it falls back there, Warrior sells to keep what is left of the gain.`); save(); } }
        const due = rocketWatch(p, { price, liquidityUsd: j.liquidity?.[p.mint] }); if (!due) continue;
        busy = true; render(); log(due === 'stop' ? `🚀 ${p.symbol}: the live price reached the stop. Selling now.` : due === 'profit-lock' ? `🚀 ${p.symbol}: it fell back to the stop that had moved up. Selling now to keep part of the gain.` : due === 'time' ? `🚀 ${p.symbol}: its ${p.rocket.maxMinutes} minutes are up. Selling whatever it is worth now.` : `🚀 ${p.symbol}: money is leaving its pool (more than a third since you bought). Selling now, before the stop.`);
        try { await closePosition(p, due); } finally { busy = false; render(); if (live()) void refresh(); }
      }
    } catch { /* no prices this time: the 30-second check still stands */ } finally { watching = false; }
  })();
}, 5000);

// The health check on open Rocket bets, every 15 seconds: are holders leaving, has selling taken over, or are the biggest
// holders cutting their share? Any of the three sells before the stop is reached.
let healthBusy = false;
setInterval(() => {
  const mine = openIn(state.mode).filter((p) => p.rocket && !p.empty); if (!mine.length || busy || healthBusy) return; healthBusy = true;
  void (async () => {
    try {
      for (const p of mine) {
        try {
          const now = await api(`/api/coin?what=audit&watch=1&mint=${p.mint}`); if (busy || !state.positions.includes(p)) continue;
          const why = rocketHealth(p, { holders: now.holders }) ?? rocketFlow(p, now); if (!why) continue;
          busy = true; render();
          log(why === 'holders-leaving' ? `🚀 ${p.symbol}: ${p.checked.holders} wallets held it when Warrior bought and ${now.holders} do now. Holders are leaving, so Warrior is selling before the price follows.` : why === 'sell-off' ? `🚀 ${p.symbol}: in the last five minutes $${Math.round(now.sellUsd5m).toLocaleString('en-US')} was sold against $${Math.round(now.buyUsd5m).toLocaleString('en-US')} bought, and the price is down ${Math.abs(Math.round(now.change5mPct))}%. A sell-off has started, so Warrior is selling now.` : `🚀 ${p.symbol}: its biggest holders held ${p.checked.topHoldersPct.toFixed(0)}% when Warrior bought and ${now.topHoldersPct.toFixed(0)}% now. They are selling, so Warrior is selling too.`);
          try { await closePosition(p, why); } finally { busy = false; render(); if (live()) void refresh(); }
        } catch { /* no reading this time */ }
      }
    } finally { healthBusy = false; }
  })();
}, 15_000);

const rocketTries = new Map(); // how many rounds a coin's Rocket buy has been put off, so a coin that never lands is dropped
/** Place one Rocket bet in the current mode. The usual token check, cost checks and wallet limits all still apply. */
async function rocketBuy(c, early = false) {
  const prefs = rocketPrefs(), plan = early ? earlyPlan(c, prefs) : rocketPlan(c, prefs); if (!plan) { log(`Rocket Mode: ${c.symbol} has no usable price; skipped.`); return false; }
  if (openIn(state.mode).some((p) => p.mint === c.mint)) { log(`Rocket Mode: already holding ${c.symbol}.`); return false; }
  const wait = rocketRoom({ openRockets: openRockets(state.mode), betsToday: rocketBets().bets }, prefs); if (wait) { log(`Rocket Mode: ${wait}.`); return false; }
  const bed = bedtime.now; if (!bed.canOpen) { log(`Rocket Mode: bedtime rule, no new trades until ${bed.wakeAt}.`); return false; }
  const bal = await balanceSol(), equity = bal + heldSol(state.mode);
  log(early ? `Rocket Mode, early: ${c.symbol}, ${Math.round(c.ageMin)} minutes old and still on the launch curve (${Math.round(c.curvePct ?? 0)}% sold), up ${Math.round(c.change5mPct ?? 0)}% in five minutes. Sold by your Rocket settings: stop −${prefs.stopPct}%, target +${prefs.targetPct.toLocaleString('en-US')}%${prefs.earlyMinutes > 0 ? `, or after ${prefs.earlyMinutes} minutes` : ''}.` : `Rocket Mode: ${c.symbol}, ${Math.round(c.ageMin)} minutes old, passes the Rocket screen.${c.copied ? ` A launch wallet (ahead on recent launches) bought it in the last ten minutes: a copy bet, practice only.` : ''} ${c.creator.text}`);
  // A refusal that is about this very second (the price moved, the trade did not land) is tried again: twice more now, a few
  // seconds apart, and again next round. Anything else shuts the coin out for an hour.
  let ok = false, kind = 'no';
  for (let go = 1; go <= 3 && !ok; go++) {
    try { ok = await openPosition({ mint: c.mint, symbol: c.symbol, pool: c.pool, priceUsd: c.priceUsd, dex: c.dex, createdAt: c.createdAt, pump: true, analysis: plan }, bal, equity, state.mode, { fixedSol: prefs.betSol, why: early ? 'Rocket Mode, early' : 'Rocket Mode', rocket: { ...plan.exits, ...(c.copied ? { copy: 1 } : {}) }, early }); kind = failKind; } catch (e) { kind = 'later'; log(`Rocket Mode: ${c.symbol}: ${e.message}.`); }
    if (ok || kind !== 'later' || go === 3 || !running) break;
    log(`Rocket Mode: trying ${c.symbol} again in a few seconds (try ${go + 1} of 3).`); await new Promise((r) => setTimeout(r, 6000));
  }
  if (ok) { rocketBets().bets++; const p = openIn(state.mode).find((x) => x.mint === c.mint); if (p) { if (Number.isFinite(c.liquidityUsd)) p.rocketLiq = c.liquidityUsd; p.trust = { at: Date.now(), rows: (early ? earlyTrust : rocketTrust)(c, p.checked ? { rivals: p.checked.sameName ?? 0, leader: p.checked.biggest } : null, early ? earlyLimits(dial.choice.preset) : rocketLimits(dial.choice.preset)) }; } save(); } else { const tries = rocketTries.get(c.mint) ?? 0, soon = kind === 'later' && tries < 3; rocketTries.set(c.mint, tries + 1); if (rocketTries.size > 200) rocketTries.delete(rocketTries.keys().next().value);
    // Keep whatever longer wait a refusal already set (a failed launch check waits a day).
    state.cooldown[c.mint] = Math.max(state.cooldown[c.mint] ?? 0, Date.now() + (soon ? 20_000 : kind === 'unknown' ? 600_000 : 3_600_000)); if (soon) log(`Rocket Mode: ${c.symbol} was not bought this round. Warrior will try it again next round if it still passes.`); save(); }
  return ok;
}
async function rocketStep(quick = false) { // quick: one of the 30-second looks between rounds, which only speaks when it finds something
  const prefs = rocketPrefs(); if (!prefs.on) return;
  try {
    const wait = rocketRoom({ openRockets: openRockets(state.mode), betsToday: rocketBets().bets }, prefs); if (wait) { if (!quick) log(`Rocket Mode: ${wait}.`); return; }
    // Copy filter, practice mode only for now (October 15, 2026): a practice Rocket bet also needs a launch wallet (one that
    // came out ahead on recent launches) buying the coin in the last ten minutes. Live Rocket bets are unchanged, so the two
    // can be compared in the history (practice copy bets are marked rocket-copy).
    const copy = !live(), j = await api(`/api/coin?what=rocket&level=${dial.choice.preset}`), owned = new Set(openIn(state.mode).map((p) => p.mint));
    const copyOff = copy && !(j.copyList?.fresh && j.copyList.wallets > 0), pick = j.coins.find((c) => c.screen.ok && !owned.has(c.mint) && !((state.cooldown[c.mint] ?? 0) > Date.now()) && (!copy || copyOff || (c.copy?.count ?? 0) >= 1));
    if (pick && copy && !copyOff) pick.copied = true;
    if (copy && copyOff && !quick) log('Rocket Mode: the launch-wallet list is not fresh right now, so practice bets are placed without the copy filter this round.');
    const free = (c) => !owned.has(c.mint) && !((state.cooldown[c.mint] ?? 0) > Date.now()), first = prefs.early === 1 && !pick ? (j.early ?? []).find(free) : null;
    if (!quick || pick || first) log(`Rocket Mode${quick ? ' (30-second look)' : ''}: ${j.seen} new launches, ${j.passing} pass the Rocket screen${prefs.early === 1 ? `, ${(j.early ?? []).length} of ${j.onCurve ?? '?'} on the launch curve pass the early screen` : ''}${pick || first ? '' : '; none to bet on this round'}.`); if (pick) await rocketBuy(pick); else if (first) await rocketBuy(first, true);
  } catch (e) { if (!quick) log(`Rocket Mode could not look this round (${e.message}). No bet placed.`); }
}
// A coin often passes the Rocket screen for under a minute. Between the two-minute rounds, Rocket looks again every 30 seconds.
setInterval(() => { if (!running || busy || !rocketPrefs().on) return; busy = true; render(); void rocketStep(true).finally(() => { busy = false; if (!live()) balance = state.paperSol; render(); }); }, 30_000);
async function tick() {
  if (!running) return;
  // Busy with a trade you asked for: come back in a few seconds. Returning without this left auto-trading switched on with no rounds running.
  if (busy) { clearTimeout(timer); timer = setTimeout(tick, 5000); return; }
  busy = true; render();
  try { await round(); } catch (e) { log(`Round failed (${e.message}). Trying again next round.`); emit('problem', `An auto-trading round failed (${e.message}). Open positions were not checked this round.`); }
  busy = false; render(); if (running) timer = setTimeout(tick, ROUND_MS);
}
async function start() {
  if (running) return;
  if (live() && !vault.exists) { log('Create the trading wallet first. Practice mode needs no wallet.'); return; }
  if (live() && !vault.protected) { log('Protect the trading wallet with a passphrase first. Live trading stays locked until you do.'); return; }
  if (live() && !vault.unlocked) { log('Unlock the trading wallet first.'); return; }
  if (live() && !state.backedUp) { log('Save the backup key first. Live trading stays locked until you do.'); return; }
  if (live() && !$('auto-ack').checked) { log('Tick the box to confirm you understand this trades real funds automatically.'); return; }
  // Only one tab may auto-trade at a time.
  if (navigator.locks) { const got = await new Promise((resolve) => { navigator.locks.request('warrior-auto', { ifAvailable: true }, (lock) => { if (!lock) { resolve(false); return; } resolve(true); return new Promise((done) => { release = done; }); }); }); if (!got) { log('Auto-trading is already running in another tab.'); return; } }
  // Only one device trades at a time, so two devices never buy the same coin twice.
  const elsewhere = await claimTrading(); if (elsewhere) { release?.(); release = null; log(elsewhere); return; }
  running = true; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  log(`Auto-trading started in ${live() ? 'LIVE mode — real funds' : 'PRACTICE mode — pretend money'}. Keep this tab open.`); render(); void tick();
}
function stop(reason = 'Stopped.') {
  if (!running) return; running = false; clearTimeout(timer); try { wake?.release(); } catch {} wake = null; release?.(); release = null; void releaseTrading();
  const open = openIn(state.mode).length; log(`${reason} ${open ? `${open} position(s) remain open; start again to keep managing them, or press Get me out.` : ''}`); render();
}
/**
 * Write off a position whose pool was emptied: take it off the list and record the loss honestly, as nothing received.
 * The worthless coins stay in the wallet; this only stops Warrior counting them.
 */
function writeOff(p) {
  if (!p.empty || busy) return;
  const trade = { ...(p.rocket ? { rocket: true } : {}), mint: p.mint, symbol: p.symbol, solIn: p.solIn, solOut: 0, pnlSol: -p.solIn, pnlPct: -100, reason: 'written-off', openedAt: p.openedAt, closedAt: Date.now(), mode: p.mode, exit: 'none', partial: false, rulesVersion: p.rulesVersion ?? null, costs: { entry: p.costs ?? null, exitImpactPct: NaN, exitQuotedSol: 0 } };
  state.trades.push(trade); state.positions = state.positions.filter((x) => x !== p); if (p.mode === state.mode) state.dayPnlSol -= p.solIn; state.cooldown[p.mint] = Date.now() + 30 * 86_400_000; save();
  log(`${p.symbol} written off: ${p.solIn.toFixed(4)} SOL in, nothing out. Its pool was emptied and it could not be sold${p.mode === 'live' ? '' : ' — practice'}.`);
  tradeClosed({ symbol: p.symbol, pnlSol: -p.solIn, pnlPct: -100, reason: 'written-off', practice: p.mode !== 'live' }); emit('trade', { type: 'sell', symbol: p.symbol, mint: p.mint, reason: 'written-off', pnlSol: -p.solIn, pnlPct: -100, mode: p.mode, partial: false }); render();
}
/** Sell every open position in the current mode, one by one. */
async function sellAll(reason = 'manual') {
  if (busy) { log('A round is in progress; try again in a moment.'); return; }
  const mine = openIn(state.mode); if (!mine.length) { log('Nothing is open.'); return; }
  busy = true; render(); for (const p of mine) await closePosition(p, reason); busy = false; void refresh();
}
// Bedtime: once the close-by time has passed, sell what this tab holds. Checked every minute while the tab is open.
setInterval(() => { if (!bedtime.now.mustClose || busy || !openIn(state.mode).length) return; if (running) stop('Stopped by your bedtime rule.'); log(`Bedtime rule: closing everything. ${bedtime.text}`); void sellAll('bedtime'); }, 60_000);
/** The comfort button: stop trading and sell everything this tab controls. */
async function getMeOut() { stop('Stopped by Get me out.'); log('Get me out: selling everything open in this tab.'); await sellAll(); }

// ---------- wallet actions (live mode only) ----------
async function refresh() { if (live() && !vault.exists) { balance = null; render(); return; } try { balance = await balanceSol(); } catch { balance = null; } render(); }
/** Send SOL from the trading wallet to an address. Signed here; only the signed result is relayed. */
async function sendSol(to, lamports) {
  const { blockhash } = await api('/api/chain'), tx = new Transaction({ feePayer: vault.keypair.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: vault.keypair.publicKey, toPubkey: new PublicKey(to), lamports }));
  tx.sign(vault.keypair); return relay(tx.serialize());
}
/**
 * Close this wallet's empty coin accounts and get their rent back (about 0.002 SOL each). Only accounts holding exactly
 * zero are closed; the rule is in lib/vault.mjs. With `mint`, only that coin's account. Returns the SOL that came back.
 */
async function reclaimRent(mint = null) {
  try {
    if (!vault.unlocked) { log('Unlock the trading wallet first.'); return 0; }
    const start = (await api(`/api/balance?owner=${address()}`)).sol; let closed = 0, last = start;
    // One transaction closes up to eight accounts. For "close them all" Warrior repeats, up to 25 times, until none are left.
    for (let round = 0; round < (mint ? 1 : 25); round++) {
      const info = await api(`/api/balance?owner=${address()}&empty=1`), list = closableAccounts(info.emptyAccounts, { mint });
      if (!list.length) { if (!mint && !closed) log('No empty coin accounts to close.'); break; }
      if (!mint && round === 0 && (info.emptyAccounts?.length ?? 0) > list.length) log(`${info.emptyAccounts.length} empty coin accounts found. Closing them eight at a time; keep this tab open.`);
      const { blockhash } = await api('/api/chain'), me = vault.keypair.publicKey, tx = new Transaction({ feePayer: me, recentBlockhash: blockhash });
      for (const a of list) tx.add(new TransactionInstruction({ programId: new PublicKey(a.program), keys: [{ pubkey: new PublicKey(a.address), isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }], data: CLOSE_ACCOUNT_DATA }));
      tx.sign(vault.keypair); const r = await relay(tx.serialize());
      if (r.outcome !== 'confirmed') { log(`Closing ${list.length} empty coin account${list.length === 1 ? '' : 's'}: ${r.outcome}. Not resending; the rent is still there to claim later.`); break; }
      closed += list.length; last = (await api(`/api/balance?owner=${address()}`)).sol;
      if (!mint && list.length === 8) log(`Closed ${closed} so far: ${Math.max(0, last - start).toFixed(6)} SOL of rent back. Looking for more…`);
    }
    const back = Math.max(0, last - start); if (closed) log(`Closed ${closed} empty coin account${closed === 1 ? '' : 's'}: ${back.toFixed(6)} SOL of rent came back.`);
    return back;
  } catch (e) { log(`Could not close the empty coin account (${e.message}). The rent is still there to claim later.`); return 0; }
}
/** Sweep: after a sale, when nothing is open, send SOL above the amount you keep working back to your main wallet. */
async function sweep() {
  try {
    const w = state.sweep ?? {}; if (!w.on || !vault.unlocked) return;
    const lamports = Math.round((await api(`/api/balance?owner=${address()}`)).sol * 1e9), amount = sweepLamports({ balanceLamports: lamports, keepSol: w.keepSol, openPositions: openIn('live').length, on: w.on, to: w.to });
    if (!amount) return; log(`Sweep: sending ${(amount / 1e9).toFixed(4)} SOL to your main wallet ${w.to.slice(0, 4)}…${w.to.slice(-4)}, keeping ${w.keepSol} SOL here.`);
    const r = await sendSol(w.to, amount); log(r.outcome === 'confirmed' ? 'Sweep confirmed.' : `Sweep ${r.outcome}. Not resending; check the wallet.`);
  } catch (e) { log(`Sweep did not go through (${e.message}). The SOL is still in the trading wallet.`); }
}
async function fund() {
  const owner = session.owner, provider = session.provider, sol = Number($('auto-fund-amount').value);
  if (!owner || !provider) { log('Connect your Phantom wallet first (top right).'); return; }
  if (!Number.isFinite(sol) || sol < 0.05 || sol > 5) { log('Enter an amount between 0.05 and 5 SOL.'); return; }
  try {
    const { blockhash } = await api('/api/chain'), tx = new Transaction({ feePayer: new PublicKey(owner), recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: new PublicKey(owner), toPubkey: new PublicKey(address()), lamports: Math.round(sol * 1e9) }));
    log(`Approve the transfer of ${sol} SOL in your wallet…`); const sent = await provider.signAndSendTransaction(tx);
    log(`Funding sent (${String(sent?.signature ?? sent).slice(0, 12)}…). It shows here in a few seconds.`); setTimeout(() => void refresh(), 9000);
  } catch (e) { log(`Funding not sent: ${/reject|cancel|denied/i.test(e?.message ?? '') ? 'you cancelled in the wallet' : e?.message ?? 'wallet error'}.`); }
}
async function withdraw() {
  const owner = session.owner; if (!owner) { log('Connect your Phantom wallet first; the SOL is sent back to it.'); return; }
  if (running) { log('Stop auto-trading before withdrawing.'); return; }
  if (!vault.unlocked) { log('Unlock the trading wallet first.'); return; }
  try {
    const lamports = Math.round((await api(`/api/balance?owner=${address()}`)).sol * 1e9), amount = lamports - 5000; if (amount <= 0) { log('Nothing to withdraw.'); return; }
    log(`Sending ${(amount / 1e9).toFixed(4)} SOL back to ${owner.slice(0, 4)}…${owner.slice(-4)}…`);
    const r = await sendSol(owner, amount); log(r.outcome === 'confirmed' ? 'Withdrawal confirmed.' : `Withdrawal ${r.outcome}. Check the wallet before trying again.`); void refresh();
  } catch (e) { log(`Withdrawal failed: ${e.message}.`); }
}

// ---------- live position lines: updated in place, so the cards are not rebuilt (and buttons not reset) every few seconds ----------
const trustOpen = new Set(); // which cards have "Why Warrior trusted this coin" unfolded, so a redraw keeps them open
const soldNow = new Map(); // what a sale would return, from a live quote: "mode:mint" -> { solOut, price, at }
/**
 * One simple number: the position's profit or loss right now, in SOL and percent, after the costs so far.
 * It comes from a live sell quote, refreshed every 10 seconds: what a sale would return right now, minus what went in.
 * A price feed can disagree with what a sale really pays by a percent or more, so the quote alone is used. The last quote is
 * kept with the position, so a reload shows the same number instead of the bare price move.
 */
function paintPnl(node, p) {
  const q = soldNow.get(`${p.mode}:${p.mint}`); let worth = null;
  if (p.empty) worth = 0;
  else if (q && Number.isFinite(q.solOut)) worth = q.solOut;
  else if (Number.isFinite(p.nowSol)) worth = p.nowSol; // the last quote, kept across a reload
  if (worth === null) { node.className = 'pos-pnl muted'; node.textContent = 'PnL: …'; return; }
  const result = worth - p.solIn, pct = result / p.solIn * 100;
  node.className = `pos-pnl ${result > 0 ? 'up' : result < 0 ? 'down' : ''}`;
  node.textContent = `PnL: ${result >= 0 ? '+' : '−'}${Math.abs(result).toFixed(4)} SOL (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`;
}
const repaint = (p) => { const key = `${p.mode}:${p.mint}`; for (const n of document.querySelectorAll('[data-pnl]')) if (n.dataset.pnl === key) paintPnl(n, p); };
/**
 * The part-exit rules from the dial: take profit in steps, take out what I put in, and one dip add. They act on what a
 * sale would really return, checked every ten seconds while a Warrior tab is open. Sells work whether or not auto-trading
 * is running, like a stop does; the dip add spends money, so it only happens while auto-trading is running.
 */
async function autoPart(p, solOut) {
  if (busy || !state.positions.includes(p) || p.mode !== state.mode || (p.auto?.retryAt ?? 0) > Date.now()) return;
  const due = partialDue(p, (solOut / p.solIn - 1) * 100, rules.settings); if (!due || (due.kind === 'add' && !running)) return;
  busy = true; render();
  try {
    if (due.kind === 'sell') {
      log(due.reason === 'took-out' ? `${p.symbol}: up enough to take out what you put in. Selling ${Math.round(due.fraction * 100)}% and letting the rest ride.` : `${p.symbol}: take-profit step reached. Selling ${Math.round(due.fraction * 100)}% of what is left.`);
      const ok = await closePosition(p, due.reason, due.fraction); if (state.positions.includes(p)) { p.auto = { ...(p.auto ?? {}), ...(ok ? { [due.mark]: true } : { retryAt: Date.now() + 60_000 }) }; save(); }
    } else {
      p.auto = { ...(p.auto ?? {}), [due.mark]: true }; save(); log(`${p.symbol}: dipped far enough for your one dip add. Buying ${due.sol} SOL more.`);
      const bal = await balanceSol(), equity = bal + heldSol(p.mode); await openPosition({ mint: p.mint, symbol: p.symbol, pool: p.pool, priceUsd: p.last ?? null, pump: p.mint.endsWith('pump'), analysis: {} }, bal, equity, p.mode, { fixedSol: due.sol, add: true, why: 'your dip rule' });
    }
  } catch (e) { log(`${p.symbol}: the automatic part-trade failed (${e.message}). Nothing else was changed.`); if (state.positions.includes(p)) { p.auto = { ...(p.auto ?? {}), retryAt: Date.now() + 60_000 }; save(); } }
  finally { busy = false; if (!live()) balance = state.paperSol; render(); if (live()) void refresh(); }
}
/** Ask what selling this position would return right now. Read-only: a quote, nothing is sold. */
async function quoteNow(p) {
  const key = `${p.mode}:${p.mint}`;
  try { const raw = BigInt(p.tokenRaw); if (raw <= 0n) throw new Error('nothing held'); const { quote } = await api(`/api/quote?${new URLSearchParams({ inputMint: p.mint, outputMint: SOL, amount: raw.toString(), exit: '1' })}`); const solOut = Number(quote.outAmount) / 1e9; if (p.tokenRaw !== raw.toString()) return; /* its size changed while the quote was on its way */ soldNow.set(key, { solOut, price: p.last ?? null, at: Date.now() }); if (Number.isFinite(solOut)) { p.nowSol = solOut; save(); void autoPart(p, solOut); } }
  catch { /* no quote this time: the number keeps following the price from the last one */ }
  repaint(p);
}
// Every 10 seconds, while the tab is in view, refresh each position's PnL. This keeps going while a round is running:
// a round can take a minute, and pausing for it left the cards showing an old number. A quote is read-only.
let quoting = false;
setInterval(() => { if (document.visibilityState !== 'visible' || quoting) return; quoting = true; void (async () => { try { for (const p of openIn(state.mode)) { if (!p.empty) await quoteNow(p); } } finally { quoting = false; } })(); }, 10_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !quoting) for (const p of openIn(state.mode)) if (!p.empty) void quoteNow(p); });

// ---------- display ----------
function renderLog() { const box = $('auto-log'); if (!box) return; box.replaceChildren(...state.log.slice(-40).reverse().map((l) => el('li', '', `${new Date(l.t).toLocaleTimeString()}  ${l.text}`))); }
function render() {
  const has = vault.exists, ready = vault.protected && vault.unlocked, w = state.sweep ?? {}, open = openIn(state.mode), closed = state.trades.filter((t) => t.mode === state.mode), total = closed.reduce((n, t) => n + t.pnlSol, 0);
  $('auto-create').hidden = has || !live(); $('sync-open').hidden = has; $('auto-wallet-row').hidden = !live(); $('auto-wallet-label').hidden = !live();
  $('auto-address').textContent = has ? address() : 'not created yet';
  $('auto-lock').hidden = !has; $('auto-lock').textContent = !vault.protected ? 'NOT PROTECTED' : vault.unlocked ? 'UNLOCKED IN THIS TAB' : 'LOCKED';
  $('auto-protect').hidden = !live() || !has || vault.protected; $('auto-locked').hidden = !live() || !vault.protected || vault.unlocked; $('auto-unlock-device').hidden = !vault.hasPasskey;
  $('auto-lock-btn').hidden = !ready; $('auto-passkey').hidden = !ready || vault.hasPasskey || !vault.passkeySupported; $('auto-passkey-off').hidden = !ready || !vault.hasPasskey; $('auto-backup-again').hidden = !state.backedUp;
  $('reclaim-on').checked = !!state.reclaim; $('reclaim-now').disabled = !ready || busy;
  $('sweep-on').checked = !!w.on; $('sweep-on').disabled = !w.to; $('sweep-to').textContent = w.to ? w.to : 'not set yet'; if (document.activeElement !== $('sweep-keep')) $('sweep-keep').value = String(w.keepSol ?? 0.2);
  $('auto-balance').textContent = live() && !has ? '—' : balance === null ? 'unavailable' : `${balance.toFixed(4)} SOL${live() ? '' : ' (pretend)'}`;
  $('auto-status').textContent = running ? (busy ? 'Running — working…' : 'Running — waiting for the next round') : busy ? 'Working…' : 'Stopped'; $('auto-status').className = `verdict ${running ? 'enter' : 'wait'}`;
  $('auto-start').hidden = running; $('auto-stop').hidden = !running; $('auto-mode').value = state.mode; $('auto-mode').disabled = running;
  $('auto-start').textContent = live() ? 'Start auto-trading' : 'Start practice auto-trading';
  $('auto-ack-row').hidden = !live() || running || !ready; $('auto-backup-warn').hidden = !live() || !vault.protected || state.backedUp; $('auto-fund').disabled = !state.backedUp || !vault.protected; $('auto-live-tools').hidden = !live() || !has;
  $('auto-reset').hidden = live() || running; $('auto-sell').disabled = busy || !open.length;
  document.title = open.length ? `${open.length} open · today ${state.dayPnlSol >= 0 ? '+' : '−'}${Math.abs(state.dayPnlSol).toFixed(4)} SOL · Warrior${live() ? '' : ' (practice)'}` : 'Warrior — Solana meme coin trader';
  $('auto-summary').textContent = `${open.length} open · ${closed.length} closed · total ${total >= 0 ? '+' : ''}${total.toFixed(4)} SOL · today ${state.dayPnlSol >= 0 ? '+' : ''}${state.dayPnlSol.toFixed(4)} SOL`;
  const box = $('auto-positions'); box.replaceChildren();
  for (const p of open) {
    const c = el('article', 'card'), top = el('div', 'card-top'); top.append(el('span', 'sym', p.rocket ? `🚀 ${p.symbol}` : p.symbol), el('span', `tag ${p.mode === 'live' ? '' : 'practice'}`, p.mode === 'live' ? `${p.solIn.toFixed(4)} SOL in` : `PRACTICE · ${p.solIn.toFixed(4)} SOL`));
    c.append(top, el('p', 'muted', `Paid $${p.entry.toPrecision(5)} a coin · stop $${p.stop.toPrecision(5)} · target $${p.target.toPrecision(5)}`));
    const pnl = el('p', 'pos-pnl'); pnl.dataset.pnl = `${p.mode}:${p.mint}`; paintPnl(pnl, p); c.append(pnl);
    if (!p.empty) c.append(lineChart({ mint: p.mint, pool: p.pool, symbol: p.symbol, entry: p.entry }));
    if (p.empty) { const gone = el('div', 'warn'); gone.append(el('b', '', 'This coin cannot be sold right now. '), 'Its pool has been emptied: there is no money left to sell into. That usually means whoever funded the pool took it out. Warrior keeps checking and will tell you if money returns.'); c.append(gone); }
    const why = { signal: "Warrior's own ENTER call", manual: 'your own pick' }[p.why] ?? p.why ?? null, opened = Number.isFinite(p.openedAt) ? new Date(p.openedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    c.append(coinInfo(p.mint, [[opened ? `Opened ${opened}` : null, why ? `because of ${why}` : null].filter(Boolean).join(' '), [p.tf === 1 ? 'Young coin, read on one-minute candles' : null, p.rulesVersion ? `rules ${p.exitRules ?? p.rulesVersion}` : null].filter(Boolean).join(' · ')]));
    if (p.trust?.rows?.length) { // why Warrior trusted this coin: the facts at the moment of the buy
      const d = el('details', 'about trust'), list = el('dl', 'trust-list'); d.append(el('summary', '', 'Why Warrior trusted this coin'));
      for (const r of p.trust.rows) { const row = el('div', r.label === 'Remember' ? 'trust-row note' : 'trust-row'); row.append(el('dt', '', r.label), el('dd', '', r.value)); list.append(row); }
      d.append(el('p', 'muted', `What Warrior saw when it bought, ${new Date(p.trust.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It has not been re-checked since.`), list);
      const key = `${p.mode}:${p.mint}`; if (trustOpen.has(key)) d.open = true; d.addEventListener('toggle', () => { if (d.open) trustOpen.add(key); else trustOpen.delete(key); }); c.append(d); }
    if (p.ownStop || p.ownTarget) c.append(el('p', 'muted own', `Yours: ${p.ownStop ? `stop $${p.ownStop.toPrecision(5)}` : 'no stop'} · ${p.ownTarget ? `target $${p.ownTarget.toPrecision(5)}` : 'no target'}`));
    const sell = el('button', 'btn sell', p.empty ? 'Cannot be sold right now' : p.mode === 'live' ? `Sell ${p.symbol} now` : `Practice sell ${p.symbol}`); sell.type = 'button'; sell.disabled = busy || !!p.empty;
    sell.addEventListener('click', async () => { if (busy) return; busy = true; render(); await closePosition(p, 'manual'); busy = false; void refresh(); });
    const more = el('button', 'btn', 'Add funds, sell part, stops and orders'); more.type = 'button'; more.addEventListener('click', () => emit('position-tools', { ...p }));
    const acts = el('div', 'card-actions'); acts.append(sell, more); c.append(acts);
    if (!p.empty) { // sell part without opening the tools box
      const part = el('div', 'card-foot');
      for (const f of [25, 50]) { const b = el('button', 'btn small', `${p.mode === 'live' ? 'Sell' : 'Practice sell'} ${f}%`); b.type = 'button'; b.disabled = busy; b.addEventListener('click', async () => { if (busy) return; busy = true; render(); try { await closePosition(p, 'manual', f / 100); } finally { busy = false; void refresh(); } }); part.append(b); }
      c.append(part); }
    if (p.empty) { // nothing can be sold, so offer the honest way to clear it: record the loss and take it off the list
      const off = el('button', 'btn ghost', 'Write it off and remove it'); off.type = 'button'; let armed = 0;
      off.addEventListener('click', () => { if (Date.now() - armed > 6000) { armed = Date.now(); off.textContent = `Tap again: records a loss of ${p.solIn.toFixed(4)} SOL`; setTimeout(() => { if (off.isConnected) off.textContent = 'Write it off and remove it'; }, 6000); return; } writeOff(p); });
      c.append(off, el('p', 'muted', 'Until you do, Warrior leaves it here, does not count it as money you have, and does not let it take up one of your position slots.')); }
    box.append(c);
  }
  if (!open.length) box.append(el('p', 'muted', live() ? 'No open positions.' : 'No practice positions yet. Press "Practice buy" on any coin in the scanner to try one.'));
  renderLog();
  // What is at risk right now, for the comfort bar.
  emit('risk', { mode: state.mode, positions: open.filter((p) => !p.empty).length, solAtRisk: open.filter((p) => !p.empty).reduce((n, p) => n + p.solIn, 0), running, busy, lost: open.filter((p) => p.empty).length });
}

// ---------- what the tools panel (orders, slices, watchlist, following) may ask the trader to do ----------
// Everything goes through the same buy and sell paths as auto-trading, so every cost and risk check still applies.
export const trader = {
  get mode() { return state.mode; }, get busy() { return busy; }, get running() { return running; },
  get liveReady() { return vault.protected && vault.unlocked && state.backedUp; },
  /** SOL available in the current mode, or null when it is not known yet. */
  get balance() { return live() ? balance : state.paperSol; },
  /** The most one buy of this coin could spend right now under the rules: the balance less the fee reserve, capped by the most-in-one-coin limit. Null when the balance is not known. */
  maxBuy(mint) { const bal = live() ? balance : state.paperSol; if (!Number.isFinite(bal)) return null; const r = rules.risk, held = openIn(state.mode).find((p) => p.mint === mint)?.solIn ?? 0, room = (bal + heldSol(state.mode)) * r.maxPositionPct / 100 - held; return Math.max(0, Math.floor(Math.min(bal - r.reserveSol, room) * 100) / 100); },
  positions: () => state.positions.map((p) => ({ ...p })), trades: () => state.trades.map((t) => ({ ...t })), note: (text) => log(text),
  /** Buy with the current mode's money. `sol` is your amount (orders, slices); without it the size comes from the risk rules. */
  async buy(t, { sol, add = false, why } = {}) {
    if (busy) return { ok: false, busy: true, reason: 'Warrior is in the middle of something; it will try again shortly' };
    if (live() && !trader.liveReady) return { ok: false, reason: 'The live trading wallet is not set up and backed up yet' };
    busy = true; render();
    try {
      const bed = bedtime.now; if (!bed.canOpen) return { ok: false, reason: `Bedtime rule: no new trades until ${bed.wakeAt}` };
      rollDay(); const mode = state.mode, bal = await balanceSol(), open = sellable(mode), equity = bal + heldSol(mode), r = rules.risk, existing = open.find((p) => p.mint === t.mint);
      if (dayLimitHit(equity, r)) return { ok: false, reason: 'Daily loss limit reached; no new buys today. "Reset the day" under Auto-trade starts the count again' };
      if (existing && !add) return { ok: false, reason: `Already holding ${t.symbol}` };
      if (!existing && regular(mode).length >= r.maxOpenPositions) return { ok: false, reason: `Already holding ${regular(mode).length} positions, the most your rules allow (Rocket bets are counted separately)` };
      const ok = await openPosition(t, bal, equity, mode, { fixedSol: sol, add: !!existing, why });
      return { ok, reason: ok ? '' : lastNote };
    } catch (e) { log(`${t.symbol}: buy attempt failed (${e.message}).`); return { ok: false, reason: e.message }; }
    finally { busy = false; if (!live()) balance = state.paperSol; render(); if (live()) void refresh(); }
  },
  /** Sell a position in the current mode, or a fraction of it. */
  async sell(mint, { reason = 'manual', fraction = 1 } = {}) {
    if (busy) return { ok: false, busy: true, reason: 'Warrior is in the middle of something; it will try again shortly' };
    const p = openIn(state.mode).find((x) => x.mint === mint); if (!p) return { ok: false, gone: true, reason: 'That position is no longer open' };
    busy = true; render();
    try { const ok = await closePosition(p, reason, fraction); return { ok, reason: ok ? '' : lastNote }; }
    finally { busy = false; void refresh(); }
  },
  /** Set or clear your own stop and target on a position. They work alongside the automatic ones. */
  /** The Rocket track record in the current mode, as a sentence. */
  get rocketRecord() { return rocketRecordText(rocketRecord(state.trades, state.mode), live() ? 'real funds' : 'practice money'); },
  setExits(mint, { stop = null, target = null }) { const p = openIn(state.mode).find((x) => x.mint === mint); if (!p) return false; p.ownStop = stop; p.ownTarget = target; save(); log(`${p.symbol}: your stop is ${stop ? `$${stop.toPrecision(5)}` : 'off'}, your target is ${target ? `$${target.toPrecision(5)}` : 'off'}.`); render(); return true; },
  /** Record whether a held coin's pool still has money. Returns 'emptied', 'restored' or null when nothing changed. */
  setHealth(mint, { empty }) { let change = null; for (const p of state.positions) if (p.mint === mint && !!p.empty !== !!empty) { p.empty = !!empty; change = empty ? 'emptied' : 'restored'; } if (change) { save(); log(change === 'emptied' ? 'A coin you hold has lost its pool money and cannot be sold right now. See its card.' : 'A coin you hold can be sold again.'); render(); } return change; },
  get rocket() { return rocketPrefs(); },
  /** Change Rocket Mode settings. Returns the reasons it was refused, or an empty list. */
  setRocket(next) { const cur = rocketPrefs(), own = { on: next.on ?? cur.on, betSol: next.betSol ?? cur.betSol }, v = rocketFor(dial.choice.preset, own); if (!v.ok) return v.reasons; const was = cur.on; state.rocket = own; save(); if (v.value.on !== was) log(v.value.on ? `Rocket Mode ON: up to ${v.value.maxBetsPerDay} bets a day of ${v.value.betSol} SOL on brand-new pump.fun coins, ${live() ? 'with REAL funds' : 'with practice money'}. Most of them will lose.` : 'Rocket Mode off. Rocket positions already open keep their stop and target.'); render(); return []; },
  /** A fresh price for a held coin. The card's live lines are updated in place; nothing is rebuilt. */
  setLast(mint, price) { let changed = false; for (const p of state.positions) if (p.mint === mint && Number.isFinite(price)) { changed = changed || p.last !== price; p.last = price; p.lastAt = Date.now(); repaint(p); } return changed; },
  redraw: () => render()
};

// ---------- wiring ----------
const step = (run, done) => async () => { const ok = await run(); if (ok && done) done(); render(); void refresh(); };
$('auto-create-btn').addEventListener('click', step(walletSteps.create, () => { state.backedUp = false; save(); log('Trading wallet created and locked with your passphrase. Save its backup key before funding it.'); }));
$('sync-open').addEventListener('click', step(walletSteps.fromOtherDevice, () => { state.backedUp = true; save(); log('Trading wallet opened from your other device. Your positions and history arrive in a few seconds.'); }));
$('auto-restore').addEventListener('click', step(walletSteps.restore, () => { state.backedUp = true; save(); log('Wallet restored from its backup key and locked with your passphrase.'); }));
$('auto-protect-btn').addEventListener('click', step(walletSteps.protect, () => log('Wallet protected: its key is now stored encrypted.')));
$('auto-unlock').addEventListener('click', step(walletSteps.unlock, () => log('Trading wallet unlocked in this tab.')));
$('auto-unlock-device').addEventListener('click', step(walletSteps.unlockDevice, () => log('Trading wallet unlocked in this tab.')));
$('auto-lock-btn').addEventListener('click', () => { if (running) stop('Stopped: the wallet was locked.'); vault.lock(); log('Trading wallet locked. Open positions stay open; unlock to trade or sell.'); render(); });
$('auto-passkey').addEventListener('click', step(walletSteps.addPasskey, () => log('Passkey added for this device.')));
$('auto-passkey-off').addEventListener('click', () => { vault.removePasskey(); log('Passkey removed. The passphrase still unlocks the wallet.'); render(); });
const backedUp = () => { state.backedUp = true; save(); log('Backup confirmed.'); };
$('auto-backup').addEventListener('click', step(walletSteps.backup, backedUp)); $('auto-backup-again').addEventListener('click', step(walletSteps.backup, backedUp));
$('reclaim-on').addEventListener('change', (e) => { state.reclaim = e.target.checked; save(); log(state.reclaim ? 'After each full sale, Warrior will close the coin\'s empty account and bring its rent back.' : 'Empty coin accounts will be left open after a sale.'); render(); });
$('reclaim-now').addEventListener('click', async () => { if (busy) return; busy = true; render(); await reclaimRent(); busy = false; void refresh(); });
$('sweep-use').addEventListener('click', () => { if (!session.owner) { log('Connect your Phantom wallet first (top right). Sweeps go to that wallet.'); return; } state.sweep = { ...(state.sweep ?? { keepSol: 0.2 }), to: session.owner, on: false }; save(); log(`Sweep address set to your connected wallet ${session.owner}. Tick the box to switch sweeping on.`); render(); });
$('sweep-on').addEventListener('change', (e) => { state.sweep = { ...(state.sweep ?? {}), on: e.target.checked && !!state.sweep?.to }; save(); log(state.sweep.on ? `Sweep is on: after a sale, when nothing is open, SOL above ${state.sweep.keepSol} goes to ${state.sweep.to}.` : 'Sweep is off.'); render(); });
$('sweep-keep').addEventListener('change', (e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0.05 || v > 100) { log('Keep at least 0.05 SOL in the trading wallet so it can still trade and pay fees.'); render(); return; } state.sweep = { ...(state.sweep ?? {}), keepSol: v }; save(); render(); });
$('auto-start').addEventListener('click', () => void start()); $('auto-stop').addEventListener('click', () => stop());
$('auto-mode').addEventListener('change', (e) => { if (running) return; state.mode = e.target.value === 'live' ? 'live' : 'paper'; save(); balance = null; render(); void refresh(); });
$('auto-fund').addEventListener('click', () => void fund()); $('auto-withdraw').addEventListener('click', () => void withdraw()); $('auto-sell').addEventListener('click', () => void sellAll());
$('auto-refresh').addEventListener('click', () => void refresh());
// Reset the day: today's result and Rocket's bets today start again from zero, so the daily
// limits stop holding trading back. Nothing is erased: the trades stay in the history and on the receipts. Two taps.
{ const b = $('auto-reset-day'); let armed = 0; b.addEventListener('click', () => {
  if (Date.now() - armed > 6000) { armed = Date.now(); b.textContent = `Tap again: today is ${state.dayPnlSol >= 0 ? '+' : '−'}${Math.abs(state.dayPnlSol).toFixed(4)} SOL, start it from zero`; setTimeout(() => { if (Date.now() - armed >= 6000) b.textContent = 'Reset the day'; }, 6100); return; }
  armed = 0; b.textContent = 'Reset the day'; const was = state.dayPnlSol; rollDay(); state.dayPnlSol = 0; state.dayResetAt = Date.now(); state.rocketDay = { day: new Date().toISOString().slice(0, 10), bets: 0 }; save();
  log(`Day reset by you. Today had been ${was >= 0 ? '+' : '−'}${Math.abs(was).toFixed(4)} SOL. The daily loss limit and Rocket's bets per day count from zero again. Your trades are still in the history.`); render();
}); }
$('auto-reset').addEventListener('click', () => { if (running || live()) return; state.paperSol = 0.5; state.positions = state.positions.filter((p) => p.mode !== 'paper'); state.trades = state.trades.filter((t) => t.mode !== 'paper'); state.dayPnlSol = 0; state.cooldown = {}; save(); balance = state.paperSol; log('Practice results reset to a pretend 0.5 SOL.'); render(); });
/** Make open positions follow the rules in force. `all` is false at start-up, when only positions left on older rules need it. */
function followRules(next, all) {
  const moved = [], near = (x, y) => Math.abs(x / y - 1) < 1e-9, price = (n) => `$${n.toPrecision(5)}`;
  // The target moves, and the stop moves unless it has already trailed up. Your own stop and target are left alone.
  for (const p of state.positions) {
    if (p.rocket) continue; // a Rocket bet keeps the plan it was opened with
    if (!all && (p.exitRules ?? p.rulesVersion) === next.version) continue;
    const r = rebasePosition(p, next.settings); if (!r) continue;
    if (!near(r.target, p.target) || !near(r.stop, p.stop)) moved.push(`${p.symbol}${p.mode === 'live' ? '' : ' (practice)'}: target ${price(r.target)} (+${r.targetPct}%), stop ${price(r.stop)}${r.trailed ? ' (kept: it had already moved up)' : ` (−${r.stopPct.toFixed(1)}%)`}`);
    p.target = r.target; p.stop = r.stop; p.baseStop = r.baseStop; p.exitRules = next.version;
  }
  save(); return moved;
}
on('rules-changed', (next) => { rules = next; const moved = followRules(next, true); log(`Rules changed to ${next.version}. ${moved.length ? `Open positions now follow them. ${moved.join('. ')}.` : 'New trades use them.'}`); render(); });
on('rocket-buy', async (c) => { if (busy) { log('One moment: finishing the current round first.'); return; } busy = true; render(); focusPanel(); try { if (live() && !trader.liveReady) log('Unlock and back up the trading wallet first, or switch to practice mode.'); else await rocketBuy(c); } catch (e) { log(`Rocket bet failed (${e.message}). Nothing was spent.`); } busy = false; if (!live()) balance = state.paperSol; render(); void refresh(); });
on('practice-buy', (t) => void practiceBuy(t)); on('get-me-out', () => void getMeOut()); on('start-practice', () => { if (!running && !live()) void start(); focusPanel(); });
window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', async () => { if (running && document.visibilityState === 'visible' && !wake) { try { wake = await navigator.wakeLock?.request('screen'); } catch {} } });
{ const moved = followRules(rules, false); if (moved.length) log(`Open positions now follow your current rules (${rules.version}). ${moved.join('. ')}.`); }
render(); void refresh();
// On opening the page, find out straight away what each open position would return.
setTimeout(() => { for (const p of openIn(state.mode)) if (!p.empty) void quoteNow(p); }, 1500);
