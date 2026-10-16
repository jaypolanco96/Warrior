// Warrior bot: the website's trader, in a terminal. It scans, buys ENTER signals and manages exits on a loop, and it runs
// your orders, slices, own stops, watchlist and followed wallets, using the same tested rule files as the site.
//   npm run bot          practice mode: real market data, pretend money (0.5 SOL), nothing is sent
//   npm run bot:live     live mode: signs and sends real swaps from the bot's own wallet
// Options:
//   --preset=chill|balanced|spicy   --set=targetPct:15,riskPerTradePct:1     the strategy dial
//   --mature   --interval=120 (seconds between scans)   --max-sol=0.5 (cap on capital the bot may use)
//   --priority=off|normal|fast|turbo   --protect (send through Jito's block builders)
//   --stop-at=23:00 --close-by=00:00 --wake=07:00     bedtime rules, in this computer's clock (--close-by is optional)
//   --reclaim                                       after a full sale, close the coin's empty account to get its rent back
//   --rocket [--rocket-bet=0.02]  (the rest of the Rocket plan comes from --preset)   Rocket Mode: small bets on pump.fun coins 1 to 60
//                                                   minutes old that pass the Rocket screen. Most of them lose.
//   --follow=ADDRESS[:name][,ADDRESS…]   --copy       follow wallets; --copy also buys what they buy, inside the rules
// Orders, slices, own stops and the watchlist are given with `npm run warrior -- …` (see bot/warrior.mjs) while the bot runs.
// It can lose money. It promises nothing. Stop it with Ctrl+C; open positions stay open until you restart it or sell them.
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { PublicKey, VersionedTransaction, Transaction, TransactionInstruction } from '@solana/web3.js';
import { scan, lookupCoin } from '../lib/scan.mjs';
import { candles, priceFacts, rocketPools, launchRecord, SOL } from '../lib/market.mjs';
import { dipCheck } from '../lib/indicators.mjs';
import { rocketFor, validateRocket, rocketCandidate, rocketScreen, rocketRank, rocketPlan, rocketRoom, rocketWatch, rocketTrust, rocketHealth, rocketRecord, rocketRecordText, earlyScreen, earlyPlan, earlyTrust, rocketLimits, earlyLimits, ROCKET_LEVELS, rocketRatchet, rocketFlow, launchAudit } from '../lib/rocket.mjs';
import { manage, rebasePosition } from '../lib/strategy.mjs';
import { positionSize, checkQuote } from '../lib/risk.mjs';
import { buyQuote, sellQuote, swapTransaction } from '../lib/jupiter.mjs';
import { resolveRules, describe } from '../lib/presets.mjs';
import { validateOrder, orderDue, validateExits, ownExitDue, autoExitDue, confirm, poolEmptied, slicePlan, sliceDue, sliceDone, partialDue, ORDER_LIMITS } from '../lib/orders.mjs';
import { buyFromTransaction, newBuys } from '../lib/follow.mjs';
import { celebrationFor, comfortFor } from '../lib/joy.mjs';
import { coachBefore, coachAfter } from '../lib/coach.mjs';
import { entryCosts, addEntryCosts, shareOf, receipt } from '../lib/receipt.mjs';
import { validateBedtime, bedtimeState, bedtimeText } from '../lib/mood.mjs';
import { blankDay, recordScan } from '../lib/story.mjs';
import { rpc, mintSafety, sendProtected, isAddress } from '../lib/rpc.mjs';
import { unexpectedPrograms, closableAccounts, CLOSE_ACCOUNT_DATA } from '../lib/vault.mjs';
import { loadWallet, connection, DIR } from './wallet.mjs';

const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const has = (name) => process.argv.includes(`--${name}`);
const LIVE = has('live'), SELFTEST = has('selftest'), MATURE = has('mature'), ONCE = has('once'), INTERVAL = Math.max(60, Number(arg('interval', 120))) * 1000, MAX_SOL = Number(arg('max-sol', 'Infinity')), FAST_MS = 30_000;
const PRIORITY = { off: 0, normal: 200_000, fast: 1_000_000, turbo: 3_000_000 };
function fail(message) { console.error(message); process.exit(1); }
// Presets only (October 14, 2026): every number comes from --preset. --set and the old --rocket-* numbers are ignored.
let rules; try { rules = resolveRules({ preset: arg('preset', 'balanced') }); } catch (e) { fail(`${e.message}. Presets: chill, balanced, spicy.`); }
for (const old of ['set', 'rocket-target', 'rocket-stop', 'rocket-take-out', 'rocket-bets', 'rocket-early-minutes']) if (arg(old, null) !== null) console.log(`--${old} is ignored: every number now comes from the preset (--preset=chill, balanced or spicy).`);
const settings = rules.settings, risk = rules.risk, apiKey = process.env.JUPITER_API_KEY;
const priority = arg('priority', 'fast'); if (!(priority in PRIORITY)) fail('--priority must be off, normal, fast or turbo.');
const PROTECT = has('protect'), COPY = has('copy'), RECLAIM = has('reclaim');
const LEVEL = Object.hasOwn(ROCKET_LEVELS, arg('preset', 'balanced')) ? arg('preset', 'balanced') : 'balanced'; // the Rocket screen's strictness follows the preset
const rocketCheck = rocketFor(LEVEL, { on: has('rocket'), betSol: Number(arg('rocket-bet', 0.02)) }); // the plan is the preset's; on/off and bet size are yours if (!rocketCheck.ok) fail(`Rocket Mode: ${rocketCheck.reasons.join('. ')}.`);
const ROCKET = rocketCheck.value;
const bedtime = { on: !!arg('stop-at', ''), stopAt: arg('stop-at', ''), closeAt: arg('close-by', ''), wakeAt: arg('wake', '07:00') };
if (bedtime.on && !validateBedtime(bedtime).ok) fail(`Bedtime rule: ${validateBedtime(bedtime).reasons.join('. ')}. Example: --stop-at=23:00 --close-by=00:00 --wake=07:00`);
const follows = String(arg('follow', '')).split(',').filter(Boolean).map((f) => { const [wallet, name] = f.split(':'); if (!isAddress(wallet)) fail(`--follow: ${wallet} is not a wallet address.`); return { wallet, label: (name || `${wallet.slice(0, 4)}…${wallet.slice(-4)}`).slice(0, 20) }; }).slice(0, 3);

const MODE = LIVE ? 'live' : 'paper', STATE = `${DIR}state-${MODE}.json`, INBOX = `${DIR}inbox-${MODE}.jsonl`, LOG = `${DIR}log.txt`;
mkdirSync(DIR, { recursive: true });
const log = (...parts) => { const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')}  ${parts.join(' ')}`; console.log(line); try { appendFileSync(LOG, line + '\n'); } catch {} };
const blank = { rocketDay: { day: '', bets: 0 }, positions: [], trades: [], day: '', dayPnlSol: 0, cooldown: {}, paperSol: 0.5, orders: [], plans: [], watch: [], follows: {}, dayRecord: null, nextId: 1 };
const state = { ...blank, ...(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}) };
const save = () => { state.rules = { version: rules.version, text: describe(rules) }; state.savedAt = Date.now(); writeFileSync(STATE + '.tmp', JSON.stringify({ ...state, trades: state.trades.slice(-500), orders: state.orders.slice(-60), plans: state.plans.slice(-30) }, null, 1)); renameSync(STATE + '.tmp', STATE); };
const conn = connection(), wallet = LIVE ? await loadWallet().catch((e) => fail(`${e.message}. The bot did not start and nothing was traded.`)) : null, owner = wallet?.publicKey.toBase58() ?? 'paper';
const usd = (n) => !Number.isFinite(n) ? 'unknown' : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`;
let prices = {}; const autoSeen = new Map();

async function balanceSol() { return LIVE ? (await conn.getBalance(wallet.publicKey, 'confirmed')) / 1e9 : state.paperSol; }
async function tokenBalanceRaw(mint) {
  const accounts = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(mint) }, 'confirmed');
  return accounts.value.reduce((n, a) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}
/** Sign and send one swap, then wait for the network's answer. Returns 'confirmed', 'failed' or 'unknown'. Never resends. */
async function send(quoteResponse) {
  const { transaction } = await swapTransaction({ quoteResponse, userPublicKey: owner, apiKey, maxPriorityLamports: PRIORITY[priority], protect: PROTECT });
  const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
  if (tx.message.staticAccountKeys[0].toBase58() !== owner || tx.message.header.numRequiredSignatures !== 1) throw new Error('Swap was not built for this wallet');
  // A swap should only call the handful of programs a Jupiter swap needs. Anything else is not signed.
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()), odd = unexpectedPrograms(tx.message.compiledInstructions.map((i) => keys[i.programIdIndex] ?? 'unknown'));
  if (odd.length) throw new Error(`swap refused: it calls a program Warrior does not expect (${odd[0].slice(0, 8)}…)`);
  tx.sign([wallet]);
  const signature = PROTECT ? await sendProtected(Buffer.from(tx.serialize()).toString('base64')) : await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = (await conn.getSignatureStatuses([signature])).value[0];
    if (s?.err) return { signature, outcome: 'failed' };
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return { signature, outcome: 'confirmed' };
  }
  return { signature, outcome: 'unknown' };
}
// Today's loss against what the wallet was worth at the start of the day (what it is worth now plus what was lost today).
const dayLimitHit = (equity) => { const lost = -Math.min(0, state.dayPnlSol), start = Math.min(equity + lost, MAX_SOL); return lost > 0 && start > 0 && lost / start * 100 >= risk.dailyLossLimitPct; };
function rollDay() { const today = new Date().toISOString().slice(0, 10); if (state.day !== today) { state.day = today; state.dayPnlSol = 0; } if (state.dayRecord?.day !== today) state.dayRecord = blankDay(today); }
const sleeping = () => { const d = new Date(); return bedtimeState(bedtime, d.getHours() * 60 + d.getMinutes()); };

/** Close this coin's empty account and get its rent back. Only an account holding exactly zero is closed. Returns the SOL that came back. */
async function reclaimRent(mint) {
  try {
    const found = await conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(mint) }, 'confirmed');
    const list = closableAccounts(found.value.map((a) => ({ address: a.pubkey.toBase58(), mint, amount: a.account.data.parsed.info.tokenAmount.amount, program: a.account.owner.toBase58(), lamports: a.account.lamports })), { mint }); if (!list.length) return 0;
    const before = await balanceSol(), tx = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: (await conn.getLatestBlockhash('confirmed')).blockhash });
    for (const a of list) tx.add(new TransactionInstruction({ programId: new PublicKey(a.program), keys: [{ pubkey: new PublicKey(a.address), isSigner: false, isWritable: true }, { pubkey: wallet.publicKey, isSigner: false, isWritable: true }, { pubkey: wallet.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(CLOSE_ACCOUNT_DATA) }));
    tx.sign(wallet); const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 2000)); const s = (await conn.getSignatureStatuses([signature])).value[0]; if (s?.err) { log(`Closing the empty coin account failed (${signature}). The rent is still there.`); return 0; } if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') break; }
    const back = Math.max(0, await balanceSol() - before); log(`  Closed the empty coin account: ${back.toFixed(6)} SOL of rent came back.`); return back;
  } catch (e) { log(`  Could not close the empty coin account (${e.message}). The rent is still there to claim later.`); return 0; }
}
/** Close a position, or a fraction of it. Returns true when something was sold. */
async function closePosition(p, reason, fraction = 1) {
  const part = Math.min(1, Math.max(0, fraction)), whole = part >= 0.999;
  try {
    const held = LIVE ? await tokenBalanceRaw(p.mint) : BigInt(p.tokenRaw);
    if (held === 0n) { log(`${p.symbol}: nothing left in the wallet; marking closed.`); state.positions = state.positions.filter((x) => x !== p); save(); return false; }
    const raw = whole ? held : held * BigInt(Math.round(part * 10_000)) / 10_000n; if (raw === 0n) { log(`${p.symbol}: that slice is too small to sell.`); return false; }
    // An exit must get out: allow more slippage than an entry, but still refuse an absurd price.
    const q = await sellQuote(p.mint, raw.toString(), { slippageBps: Math.max(300, risk.slippageBps), apiKey }), check = checkQuote(q, { inputMint: p.mint, outputMint: SOL, amountRaw: raw.toString() }, { ...risk, maxPriceImpactPct: 10 });
    if (!check.ok) { log(`${p.symbol}: exit (${reason}) refused for now: ${check.reasons.join('; ')}. Will retry next round.`); return false; }
    const quotedOut = Number(q.outAmount) / 1e9; let solOut = quotedOut, signature = 'paper', rentBack = 0;
    if (LIVE) { const before = await balanceSol(), r = await send(q); signature = r.signature; if (r.outcome !== 'confirmed') { log(`${p.symbol}: exit ${r.outcome} (${signature}). Not resending; will re-check the wallet next round.`); return false; } solOut = Math.max(0, await balanceSol() - before); if (whole && RECLAIM) { rentBack = await reclaimRent(p.mint); solOut += rentBack; } }
    else state.paperSol += solOut;
    const cost = whole ? p.solIn : p.solIn * part, pnl = solOut - cost, pnlPct = pnl / cost * 100; state.dayPnlSol += pnl; if (reason === 'profit-lock' && pnl < 0) reason = 'stop';
    const trade = { ...(p.rocket ? { rocket: true } : {}), kind: p.rocket ? (p.rocket.early === 1 ? 'early' : 'rocket') : p.style === 'smart' ? 'smart-wallets' : p.dip === 1 ? 'deep-dip' : p.why === 'signal' ? 'signal' : 'own-pick', ...(p.checked ? { checked: p.checked } : {}), symbol: p.symbol, mint: p.mint, solIn: cost, solOut, pnlSol: pnl, pnlPct, reason, openedAt: p.openedAt, closedAt: Date.now(), mode: MODE, entry: p.signature, exit: signature, partial: !whole, rulesVersion: p.rulesVersion ?? null, costs: { entry: shareOf(p.costs ?? null, whole ? 1 : part), exitImpactPct: check.impactPct, exitQuotedSol: quotedOut }, rentBackSol: rentBack };
    state.trades.push(trade);
    if (whole) { state.positions = state.positions.filter((x) => x !== p); state.cooldown[p.mint] = Math.max(Date.now() + (pnl < 0 ? risk.lossCooldownMinutes ?? 120 : risk.cooldownMinutes) * 60_000, p.dip === 1 ? (p.openedAt ?? Date.now()) + 6 * 3_600_000 : 0); }
    else { p.solIn -= cost; p.tokenRaw = (held - raw).toString(); p.costs = shareOf(p.costs ?? null, 1 - part); }
    save();
    log(`SELL ${p.symbol}${whole ? '' : ` (${Math.round(part * 100)}% of it)`} (${reason}): ${cost.toFixed(4)} SOL in, ${solOut.toFixed(4)} SOL out, ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)${LIVE ? '' : ' — practice'}`);
    // The same feel rules as the site: a celebration only for money actually made, a kind word for a loss.
    const feel = { symbol: p.symbol, pnlSol: pnl, pnlPct, reason, practice: !LIVE, closed: true }, win = celebrationFor(feel), soft = comfortFor(feel);
    if (win.kind !== 'none') log(`  ${'😂'.repeat(win.kind === 'roar' ? 5 : win.kind === 'warrior' ? 3 : 1)}${'💖'.repeat(win.kind === 'roar' ? 4 : win.kind === 'warrior' ? 2 : 1)}  ${win.headline}. ${win.message} (${win.detail})`);
    else if (soft.kind !== 'none') log(`  🤗  ${soft.headline}. ${soft.message} (${soft.detail})`);
    const coach = coachAfter(trade), r = receipt(trade); log(`  Coach: ${coach.happened} ${coach.learned}`);
    log(`  Receipt: costs ${r.complete ? '' : 'at least '}${r.costsSol.toFixed(6)} SOL, true result ${r.resultSol >= 0 ? '+' : ''}${r.resultSol.toFixed(6)} SOL. Full receipt: npm run warrior -- receipt`);
    return true;
  } catch (e) { log(`${p.symbol}: exit attempt failed (${e.message}). Will retry next round.`); return false; }
}

/** Open a position, or add to one. `opts.fixedSol` is an amount you chose (an order or a slice); your limits still cap it. */
async function openPosition(t, balance, equity, opts = {}) {
  const a = { ...(t.analysis ?? {}) }, stopPct = Number.isFinite(a.stopPct) ? a.stopPct : 8, existing = opts.add ? state.positions.find((p) => p.mint === t.mint) : null, bal = Math.min(balance, MAX_SOL), eq = Math.min(equity, MAX_SOL);
  let sol;
  if (Number.isFinite(opts.fixedSol)) {
    const room = eq * risk.maxPositionPct / 100 - (existing?.solIn ?? 0); sol = Math.floor(Math.max(0, Math.min(opts.fixedSol, room, bal - risk.reserveSol)) * 1e6) / 1e6;
    if (sol < risk.minTradeSol) { log(`${t.symbol}: skipped. ${room < risk.minTradeSol ? `Your rules allow at most ${risk.maxPositionPct}% of the wallet in one coin` : 'Not enough SOL after the fee reserve'}.`); return false; }
    if (sol < opts.fixedSol * 0.999) log(`${t.symbol}: amount trimmed to ${sol.toFixed(4)} SOL by your limits.`);
  } else {
    const size = positionSize({ balanceSol: bal, equitySol: eq, stopPct, openPositions: state.positions.length, dayPnlSol: state.dayPnlSol, sizeFactor: a.sizeFactor ?? 1 }, risk);
    if (!size.sol) { log(`${t.symbol}: skipped: ${size.reasons.join('; ')}`); return false; }
    sol = size.sol; if (size.raised) log(`${t.symbol}: the wallet is small, so this trade uses the smallest size, ${sol} SOL. If the stop is hit it loses about ${size.riskPct.toFixed(1)}% of the wallet instead of the usual ${(risk.riskPerTradePct * (a.sizeFactor ?? 1)).toFixed(1)}%.`);
  }
  const safety = await mintSafety(t.mint); if (!safety.safe) { log(`${t.symbol}: skipped, ${safety.reason}.`); state.cooldown[t.mint] = Date.now() + 6 * 3_600_000; return false; }
  // Does the launch look staged? Coins in their first two days only. If it cannot be checked, the coin is not bought.
  try { const { asset, others } = await launchRecord(t.mint), now = Date.now(), c = asset ? rocketCandidate({ id: asset.graduatedPool ?? asset.firstPool?.id ?? t.mint, dex: '', liquidity: asset.liquidity, baseAsset: asset }, now) : null; if (c && Number.isFinite(c.ageMin) && c.ageMin <= 48 * 60) { const audit = launchAudit(c, others, { ...(ROCKET_LEVELS[LEVEL] ?? {}), ...(opts.early ? (({ minTraders, organicGraceMin, organicGraceHoldPct }) => ({ minTraders, ...(organicGraceMin ? { organicGraceMin, organicGraceHoldPct } : {}) }))(earlyLimits(LEVEL)) : {}) }); if (opts.rocket) { try { const trend = dipCheck(await candles(t.pool, 30, now, 1, t.mint), c.priceUsd); if (!trend.ok) { audit.ok = false; audit.reasons.push(trend.reason); } } catch { /* candles unreadable: not refused for that */ } } if (!audit.ok) { log(`${t.symbol}: skipped. ${audit.reasons.join('. ')}.`); state.cooldown[t.mint] = now + 24 * 3_600_000; return false; } } }
  catch (e) { log(`${t.symbol}: skipped, its launch record could not be checked (${e.message}).`); return false; }
  const lamports = Math.round(sol * 1e9), q = await buyQuote(t.mint, lamports, { slippageBps: Math.min(1000, Math.max(risk.slippageBps, opts.rocket ? (opts.early ? 1000 : 500) : 0)), apiKey }), check = checkQuote(q, { inputMint: SOL, outputMint: t.mint, amountRaw: lamports }, opts.rocket ? { ...risk, maxPriceImpactPct: Math.max(risk.maxPriceImpactPct, 5) } : risk); // a Rocket coin moves fast: wider slippage and impact allowance, or the buy fails on-chain
  if (!check.ok) { log(`${t.symbol}: skipped, ${check.reasons.join('; ')}.`); return false; }
  // Can it be sold again? Quote the way back out. A coin that loses a lot on an immediate round trip is taxed or trapped.
  const back = await sellQuote(t.mint, q.outAmount, { slippageBps: Math.max(300, risk.slippageBps), apiKey }), roundTripLossPct = (1 - Number(back.outAmount) / lamports) * 100;
  if (!Number.isFinite(roundTripLossPct) || roundTripLossPct > 6) { log(`${t.symbol}: skipped, selling it straight back would lose ${roundTripLossPct.toFixed(1)}%.`); state.cooldown[t.mint] = Date.now() + 3_600_000; return false; }
  let signature = 'paper', got = q.outAmount, spent = sol;
  if (LIVE) {
    const heldBefore = existing ? await tokenBalanceRaw(t.mint) : 0n, r = await send(q); signature = r.signature;
    if (r.outcome === 'failed') { log(`${t.symbol}: buy failed on-chain (${signature}). Nothing bought.`); return false; }
    const heldAfter = await tokenBalanceRaw(t.mint); if (heldAfter <= heldBefore) { log(`${t.symbol}: buy outcome ${r.outcome} and no coins arrived (${signature}). Not retrying.`); return false; }
    got = (heldAfter - heldBefore).toString();
    try { spent = Math.max(sol, balance - await balanceSol()); } catch {} // what actually left the wallet, fees and rent included
  } else state.paperSol -= sol;
  // The entry is the price actually paid per coin, worked out from the swap itself; the signal's price can be minutes old.
  const signal = Number.isFinite(a.price) ? a.price : t.priceUsd, paid = Number(q.swapUsdValue) / (Number(got) / 10 ** safety.decimals); // the price per coin, before network fees and rent, so it compares like-for-like with a chart
  const price = Number.isFinite(paid) && paid > 0 && Number.isFinite(signal) && Math.abs(paid / signal - 1) < 0.3 ? paid : Number.isFinite(signal) ? signal : paid;
  if (Number.isFinite(signal) && signal > 0 && price !== signal) { if (Number.isFinite(a.stop)) a.stop = price * (a.stop / signal); if (Number.isFinite(a.target)) a.target = price * (a.target / signal); }
  const targetPct = a.targetPct ?? settings.targetPct, costs = entryCosts({ requestedSol: sol, spentSol: spent, impactPct: check.impactPct });
  if (existing) { if (Number.isFinite(price) && Number.isFinite(existing.entry)) existing.entry = (existing.entry * existing.solIn + price * spent) / (existing.solIn + spent); existing.solIn += spent; existing.tokenRaw = (BigInt(existing.tokenRaw) + BigInt(got)).toString(); existing.costs = addEntryCosts(existing.costs ?? null, costs); }
  else state.positions.push({ mint: t.mint, symbol: t.symbol, pool: t.pool, solIn: spent, tokenRaw: got, entry: price, stop: a.stop ?? price * (1 - stopPct / 100), target: a.target ?? price * (1 + targetPct / 100), entryBar: a.at ?? Date.now(), peak: price, openedAt: Date.now(), signature, mode: MODE, rulesVersion: rules.version, why: opts.why ?? (a.decision === 'enter' ? 'signal' : 'manual'), costs, tf: a.tf === 1 ? 1 : 5, baseStop: a.stop ?? price * (1 - stopPct / 100), ...(a.style === 'dip' ? { dip: 1 } : {}), ...(a.style === 'smart' ? { style: 'smart' } : {}), ...(opts.rocket ? { rocket: opts.rocket } : {}) });
  save(); log(`BUY  ${t.symbol}${existing ? ' (adding)' : ''}: ${spent.toFixed(4)} SOL at ${usd(price)}${existing ? '' : `, stop −${stopPct.toFixed(1)}%, target +${targetPct}%`}${a.style === 'smart' ? ` · ${a.smartNote}` : a.style === 'dip' ? ` · ${a.dipNote}` : a.decision === 'enter' ? `, ${a.score}/4 agree (${a.regime}, ${a.bias})` : ''}${a.young ? ' · YOUNG COIN, half size' : ''}${opts.why ? ` [${opts.why}]` : ''}${LIVE ? ` ${signature}` : ' — practice'}`);
  if (a.decision === 'enter' && !existing) { const c = coachBefore(t, rules); log(`  Coach: ${c.why} ${c.wrongIf}`); }
  return true;
}
/** The checks every new buy passes, whoever asked for it. Returns a reason to refuse, or null. */
async function mayBuy(mint, { add = false } = {}) {
  rollDay(); const bal = await balanceSol(), equity = bal + heldSol(), existing = state.positions.find((p) => p.mint === mint), bed = sleeping();
  if (!bed.canOpen) return { reason: `Bedtime rule: no new trades until ${bed.wakeAt}` };
  if (dayLimitHit(equity)) return { reason: 'Daily loss limit reached; no new buys today (npm run warrior -- reset-day starts the count again)' };
  if (existing && !add) return { reason: 'Already holding this coin' };
  if (!existing && regular().length >= risk.maxOpenPositions) return { reason: `Already holding ${regular().length} positions, the most your rules allow (Rocket bets are counted separately)` };
  return { bal, equity, existing };
}
// Positions that can still be sold. One whose pool was emptied is worth nothing and does not use up a slot.
const regular = () => state.positions.filter((p) => !p.empty && !p.rocket); // "positions at once" counts these; Rocket bets have their own count on top
const sellable = () => state.positions.filter((p) => !p.empty), heldSol = () => sellable().reduce((n, p) => n + p.solIn, 0);
const tokenFor = (coin) => ({ ...coin, priceUsd: prices[coin.mint] ?? null, analysis: {} });
const findPosition = (key) => state.positions.find((p) => p.mint === key || p.symbol.toLowerCase() === String(key).toLowerCase());

// ---------- instructions from `npm run warrior -- …` arrive in an inbox file; the bot is the only writer of its state ----------
function readInbox() {
  if (!existsSync(INBOX)) return []; const taken = `${INBOX}.${Date.now()}`;
  try { renameSync(INBOX, taken); const lines = readFileSync(taken, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); unlinkSync(taken); return lines; } catch { return []; }
}
async function handle(cmd) {
  const now = prices[cmd.mint] ?? null;
  if (cmd.do === 'watch') { if (state.watch.some((w) => w.mint === cmd.coin.mint)) return; if (state.watch.length >= 8) { log('Watchlist is full (8 coins). Remove one first.'); return; } state.watch.push({ ...cmd.coin, last: 'wait', checkedAt: 0 }); log(`Watching ${cmd.coin.symbol}.`); }
  else if (cmd.do === 'unwatch') { state.watch = state.watch.filter((w) => w.mint !== cmd.mint && w.symbol.toLowerCase() !== String(cmd.mint).toLowerCase()); log('Removed from the watchlist.'); }
  else if (cmd.do === 'buy-below') { const v = validateOrder({ kind: 'buy-below', mint: cmd.coin.mint, price: cmd.price, sol: cmd.sol }, { currentPrice: prices[cmd.coin.mint] ?? cmd.priceNow }); if (!v.ok) { log(`Order refused: ${v.reasons.join('. ')}.`); return; } if (state.orders.filter((o) => o.status === 'waiting').length >= ORDER_LIMITS.maxActive) { log('Order refused: ten orders are already waiting.'); return; } state.orders.push({ id: state.nextId++, ...v.order, symbol: cmd.coin.symbol, coin: cmd.coin }); log(`Order placed: buy ${cmd.sol} SOL of ${cmd.coin.symbol} at or below ${usd(cmd.price)}.`); }
  else if (cmd.do === 'sell-above') { const p = findPosition(cmd.key); if (!p) { log(`Order refused: no open position matches "${cmd.key}".`); return; } const v = validateOrder({ kind: 'sell-above', mint: p.mint, price: cmd.price, fraction: cmd.percent / 100 }, { currentPrice: prices[p.mint] ?? p.last ?? null }); if (!v.ok) { log(`Order refused: ${v.reasons.join('. ')}.`); return; } state.orders.push({ id: state.nextId++, ...v.order, symbol: p.symbol, coin: { mint: p.mint, symbol: p.symbol, pool: p.pool } }); log(`Order placed: sell ${cmd.percent}% of ${p.symbol} at or above ${usd(cmd.price)}.`); }
  else if (cmd.do === 'exits') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } const v = validateExits({ entry: p.entry, stop: cmd.stop, target: cmd.target }, prices[p.mint] ?? p.last ?? null); if (!v.ok) { log(`Not saved: ${v.reasons.join('. ')}.`); return; } p.ownStop = cmd.stop; p.ownTarget = cmd.target; log(`${p.symbol}: your stop is ${cmd.stop ? usd(cmd.stop) : 'off'}, your target is ${cmd.target ? usd(cmd.target) : 'off'}.`); }
  else if (cmd.do === 'slices-buy') { const v = slicePlan({ side: 'buy', mint: cmd.coin.mint, totalSol: cmd.totalSol, slices: cmd.slices, everyMinutes: cmd.everyMinutes }); if (!v.ok) { log(`Slices refused: ${v.reasons.join('. ')}.`); return; } state.plans.push({ id: state.nextId++, ...v.plan, symbol: cmd.coin.symbol, coin: cmd.coin }); log(`Slice plan started: ${v.plan.slices} × ${v.plan.solEach} SOL of ${cmd.coin.symbol}, ${v.plan.everyMinutes} minutes apart.`); }
  else if (cmd.do === 'slices-sell') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } const v = slicePlan({ side: 'sell', mint: p.mint, slices: cmd.slices, everyMinutes: cmd.everyMinutes }); if (!v.ok) { log(`Slices refused: ${v.reasons.join('. ')}.`); return; } state.plans.push({ id: state.nextId++, ...v.plan, symbol: p.symbol, coin: { mint: p.mint, symbol: p.symbol, pool: p.pool } }); log(`Slice plan started: sell ${p.symbol} in ${v.plan.slices} parts, ${v.plan.everyMinutes} minutes apart.`); }
  else if (cmd.do === 'cancel') { const o = state.orders.find((x) => x.id === cmd.id && x.status === 'waiting'), pl = state.plans.find((x) => x.id === cmd.id && x.status === 'running'); if (o) o.status = 'cancelled'; if (pl) pl.status = 'cancelled'; log(o || pl ? `Cancelled #${cmd.id}.` : `Nothing waiting has the number ${cmd.id}.`); }
  else if (cmd.do === 'sell') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } await closePosition(p, 'manual', Number.isFinite(cmd.percent) ? Math.min(100, Math.max(1, cmd.percent)) / 100 : 1); }
  else if (cmd.do === 'add') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } if (!(cmd.sol >= ORDER_LIMITS.minSol && cmd.sol <= ORDER_LIMITS.maxSol)) { log(`Not added: the amount must be ${ORDER_LIMITS.minSol} to ${ORDER_LIMITS.maxSol} SOL.`); return; }
    const may = await mayBuy(p.mint, { add: true }); if (may.reason) { log(`Not added: ${may.reason}.`); return; } const before = p.solIn, ok = await openPosition(tokenFor({ mint: p.mint, symbol: p.symbol, pool: p.pool }), may.bal, may.equity, { fixedSol: cmd.sol, add: true, why: 'you added funds' });
    log(ok ? `Added ${(p.solIn - before).toFixed(4)} SOL to ${p.symbol}. It now holds ${p.solIn.toFixed(4)} SOL at an average of ${usd(p.entry)} a coin.` : `Nothing was added to ${p.symbol}. The reason is on the line above.`); }
  else if (cmd.do === 'take-out') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } const last = prices[p.mint] ?? p.last, gain = Number.isFinite(last) && p.entry > 0 ? (last / p.entry - 1) * 100 : NaN;
    if (!(gain >= 5)) { log(`${p.symbol}: taking out what you put in only works once the position is up at least 5%. It is ${Number.isFinite(gain) ? `${gain >= 0 ? 'up' : 'down'} ${Math.abs(gain).toFixed(1)}%` : 'at an unknown price'} now.`); return; }
    const fraction = Math.min(0.95, 1 / (1 + gain / 100) * 1.02); log(`${p.symbol}: selling ${Math.round(fraction * 100)}% to take out about what you put in. The rest rides.`); await closePosition(p, 'took-out', fraction); }
  else if (cmd.do === 'steps') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } const at = cmd.percents.map((v) => p.entry * (1 + v / 100)), share = [1 / 3, 1 / 2, 1], checked = at.map((price, i) => validateOrder({ kind: 'sell-above', mint: p.mint, price, fraction: share[i] }, { currentPrice: prices[p.mint] ?? p.last ?? null })), bad = checked.find((v) => !v.ok);
    if (!(at[0] < at[1] && at[1] < at[2])) { log('Steps refused: each step must be higher than the one before.'); return; } if (bad) { log(`Steps refused: ${bad.reasons.join('. ')}.`); return; } if (state.orders.filter((o) => o.status === 'waiting').length + 3 > ORDER_LIMITS.maxActive) { log('Steps refused: too many orders are already waiting.'); return; }
    for (const v of checked) state.orders.push({ id: state.nextId++, ...v.order, symbol: p.symbol, coin: { mint: p.mint, symbol: p.symbol, pool: p.pool } }); log(`Take-profit steps placed for ${p.symbol}: a third at ${at.map(usd).join(', ')}.`); }
  else if (cmd.do === 'break-even') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } const live = prices[p.mint] ?? p.last ?? null; if (!Number.isFinite(live)) { log(`${p.symbol}: no live price yet. Try again in a minute.`); return; } const v = validateExits({ entry: p.entry, stop: p.entry, target: p.ownTarget ?? null }, live); if (!v.ok) { log(`Not saved: ${v.reasons.join('. ')}. A break-even stop only works once the price is above what you paid.`); return; } p.ownStop = p.entry; log(`${p.symbol}: your stop is now what you paid, ${usd(p.entry)}.`); }
  else if (cmd.do === 'write-off') { const p = findPosition(cmd.key); if (!p) { log(`No open position matches "${cmd.key}".`); return; } if (!p.empty) { log(`${p.symbol} can still be sold, so it is not written off. Use: npm run warrior -- sell ${p.symbol}`); return; }
    state.trades.push({ ...(p.rocket ? { rocket: true } : {}), symbol: p.symbol, mint: p.mint, solIn: p.solIn, solOut: 0, pnlSol: -p.solIn, pnlPct: -100, reason: 'written-off', openedAt: p.openedAt, closedAt: Date.now(), mode: MODE, entry: p.signature, exit: 'none', partial: false, rulesVersion: p.rulesVersion ?? null, costs: { entry: p.costs ?? null, exitImpactPct: NaN, exitQuotedSol: 0 } }); state.positions = state.positions.filter((x) => x !== p); state.dayPnlSol -= p.solIn; state.cooldown[p.mint] = Date.now() + 30 * 86_400_000;
    log(`${p.symbol} written off: ${p.solIn.toFixed(4)} SOL in, nothing out. Its pool was emptied and it could not be sold.`); log(`  Coach: ${coachAfter(state.trades.at(-1)).learned}`); }
  else if (cmd.do === 'reset-day') { const was = state.dayPnlSol; rollDay(); state.dayPnlSol = 0; state.dayResetAt = Date.now(); state.rocketDay = { day: new Date().toISOString().slice(0, 10), bets: 0 }; log(`Day reset by you. Today had been ${was >= 0 ? '+' : '−'}${Math.abs(was).toFixed(4)} SOL. The daily loss limit and Rocket's bets per day count from zero again. Your trades are still in the history.`); }
  else if (cmd.do === 'get-me-out') { log('Get me out: selling everything.'); for (const p of [...state.positions]) await closePosition(p, 'manual'); }
  void now;
}

// ---------- every 30 seconds: instructions, prices, your orders, your own stops, slices ----------
async function fastTick() {
  let liqNow = {};
  for (const cmd of readInbox()) { try { await handle(cmd); } catch (e) { log(`Instruction failed (${e.message}).`); } }
  const mints = [...new Set([...state.orders.filter((o) => o.status === 'waiting').map((o) => o.mint), ...state.plans.filter((p) => p.status === 'running').map((p) => p.mint), ...state.positions.map((p) => p.mint), ...state.watch.map((w) => w.mint)])];
  if (mints.length) { try { const facts = await priceFacts(mints); prices = { ...prices, ...facts.prices }; liqNow = facts.liquidity ?? {}; for (const p of state.positions) { if (Number.isFinite(prices[p.mint])) p.last = prices[p.mint]; const liq = facts.liquidity[p.mint]; if (liq === undefined) continue; const empty = poolEmptied(liq); if (empty && !p.empty) log(`⚠  ${p.symbol}: its pool has been emptied. There is no money left to sell into, so it cannot be sold right now. This usually means whoever funded the pool took the money out. The bot keeps checking.`); if (!empty && p.empty) log(`${p.symbol}: its pool has money again and can be sold.`); p.empty = empty; } } catch { log('Prices unavailable this moment; orders wait.'); } }
  for (const o of state.orders) {
    const due = orderDue(o, prices[o.mint]); if (due === 'expired') { o.status = 'expired'; log(`Order #${o.id} expired: ${o.symbol} never reached ${usd(o.price)}. Nothing was traded.`); continue; } if (due !== 'fill') continue;
    let ok = false, reason = '';
    if (o.kind === 'buy-below') { const may = await mayBuy(o.mint, { add: true }); if (may.reason) reason = may.reason; else ok = await openPosition(tokenFor(o.coin), may.bal, may.equity, { fixedSol: o.sol, add: true, why: 'your buy-below order' }); }
    else { const p = state.positions.find((x) => x.mint === o.mint); if (!p) { o.status = 'cancelled'; o.note = 'the position was already closed'; continue; } ok = await closePosition(p, 'order', o.fraction); }
    if (ok) { o.status = 'filled'; log(`Order #${o.id} filled.`); } else { o.attempts = (o.attempts ?? 0) + 1; o.note = reason; if (reason) log(`Order #${o.id} not filled: ${reason}.`); if (o.attempts >= 3) { o.status = 'failed'; log(`Order #${o.id} could not fill after three tries. Nothing was traded.`); } }
  }
  for (const p of [...state.positions]) {
    if (p.empty) continue; const own = ownExitDue(p, prices[p.mint]); if (own) { log(`${p.symbol}: your ${own} was reached.`); await closePosition(p, own); continue; }
    // Rocket bets: have the holders it had at the buy started to leave?
    if (p.rocket) { try { const { asset } = await launchRecord(p.mint, { lite: true }), c = asset ? rocketCandidate({ id: asset.graduatedPool ?? p.mint, dex: '', liquidity: asset.liquidity, baseAsset: asset }, Date.now()) : null, why = c ? (rocketHealth(p, { holders: c.holders }) ?? rocketFlow(p, c)) : null; if (why) { log(why === 'holders-leaving' ? `🚀 ${p.symbol}: ${p.checked.holders} wallets held it at the buy and ${c.holders} do now. Holders are leaving, so the bot is selling.` : why === 'sell-off' ? `🚀 ${p.symbol}: $${Math.round(c.sellUsd5m)} sold against $${Math.round(c.buyUsd5m)} bought in five minutes, price down ${Math.abs(Math.round(c.change5mPct))}%. A sell-off has started, so the bot is selling.` : `🚀 ${p.symbol}: its biggest holders are cutting their share. The bot is selling too.`); await closePosition(p, why); continue; } } catch { /* no reading this time */ } }
    // Rocket bets: one look is enough at the stop, and a draining pool is a reason to leave before it. (Checked here every 30 seconds and by rocketLook every 5.)
    { const due = rocketWatch(p, { price: prices[p.mint], liquidityUsd: liqNow[p.mint] }); if (due) { log(due === 'stop' ? `🚀 ${p.symbol}: the live price reached the stop. Selling now.` : due === 'profit-lock' ? `🚀 ${p.symbol}: it fell back to the stop that had moved up. Selling now to keep part of the gain.` : due === 'time' ? `🚀 ${p.symbol}: its ${p.rocket.maxMinutes} minutes are up. Selling whatever it is worth now.` : `🚀 ${p.symbol}: money is leaving its pool (more than a third since the buy). Selling now, before the stop.`); await closePosition(p, due); continue; } }
    // The part-exit rules from the dial. The bot measures the move by the live price; the site uses a sale quote.
    { const gain = Number.isFinite(prices[p.mint]) && p.entry > 0 ? (prices[p.mint] / p.entry - 1) * 100 : NaN, part = (p.auto?.retryAt ?? 0) > Date.now() ? null : partialDue(p, gain, settings);
      if (part?.kind === 'sell') { log(part.reason === 'took-out' ? `${p.symbol}: up enough to take out what you put in. Selling ${Math.round(part.fraction * 100)}% and letting the rest ride.` : `${p.symbol}: take-profit step reached. Selling ${Math.round(part.fraction * 100)}% of what is left.`); const ok = await closePosition(p, part.reason, part.fraction); if (state.positions.includes(p)) p.auto = { ...(p.auto ?? {}), ...(ok ? { [part.mark]: true } : { retryAt: Date.now() + 60_000 }) }; continue; }
      if (part?.kind === 'add') { p.auto = { ...(p.auto ?? {}), [part.mark]: true }; const may = await mayBuy(p.mint, { add: true }); if (may.reason) log(`${p.symbol}: dip add skipped. ${may.reason}.`); else { log(`${p.symbol}: dipped far enough for your one dip add. Buying ${part.sol} SOL more.`); await openPosition(tokenFor({ mint: p.mint, symbol: p.symbol, pool: p.pool }), may.bal, may.equity, { fixedSol: part.sol, add: true, why: 'your dip rule' }); } continue; } }
    // The automatic stop and target against the live price. Two looks in a row must agree before selling.
    const due = autoExitDue(p, prices[p.mint]); if (confirm(autoSeen, p.mint, due)) { autoSeen.delete(p.mint); const why = due === 'stop' && p.stop >= p.entry ? 'trailing-stop' : due; log(`${p.symbol}: the live price reached the ${why === 'trailing-stop' ? 'trailing stop' : due}. Selling without waiting for the next candle.`); await closePosition(p, why); }
  }
  for (let i = 0; i < state.plans.length; i++) {
    const plan = state.plans[i], due = sliceDue(plan); if (!due) continue; let ok = false, reason = '';
    if (due.side === 'buy') { const may = await mayBuy(plan.mint, { add: true }); if (may.reason) reason = may.reason; else ok = await openPosition(tokenFor(plan.coin), may.bal, may.equity, { fixedSol: due.sol, add: true, why: `slice ${due.index + 1} of ${plan.slices}` }); }
    else { const p = state.positions.find((x) => x.mint === plan.mint); if (!p) { state.plans[i] = { ...plan, status: 'cancelled', note: 'the position was already closed' }; continue; } ok = await closePosition(p, 'slice', due.fraction); }
    const next = sliceDone(plan, ok); next.note = ok ? '' : reason; state.plans[i] = next; if (!ok && reason) log(`Slice not done: ${reason}.`);
    if (next.status === 'finished') log(`Slices finished: ${plan.symbol}, ${plan.slices} of ${plan.slices}.`); else if (next.status === 'paused') log(`Slices paused: ${plan.symbol}. Three tries failed in a row.`);
  }
  // Bedtime: close everything once the close-by time has passed.
  if (sleeping().mustClose && state.positions.length) { log(`Bedtime rule: closing everything. ${bedtimeText(bedtime)}`); for (const p of [...state.positions]) await closePosition(p, 'bedtime'); }
  save();
}

// ---------- every round: manage positions, scan and buy ENTERs, re-check the watchlist, look at followed wallets ----------
async function watchStep() {
  for (const w of state.watch) {
    try { const t = await lookupCoin(w.mint, rules, mintSafety); if (!t) continue; const now = t.analysis.decision === 'enter' && t.screen.ok ? 'enter' : 'wait'; if (now === 'enter' && w.last !== 'enter') log(`🤩  WATCHLIST: ${w.symbol} turned into an ENTER (${t.analysis.score}/4). ${coachBefore(t, rules).wrongIf}`); w.last = now; w.score = t.analysis.score; w.checkedAt = Date.now(); } catch {}
  }
}
async function followStep() {
  for (const f of follows) {
    const mem = state.follows[f.wallet] ??= { since: Date.now(), seen: [] };
    try {
      const sigs = ((await rpc('getSignaturesForAddress', [f.wallet, { limit: 12 }])) ?? []).filter((s) => !s.err).slice(0, 8), buys = [];
      for (const s of sigs) { if (mem.seen.includes(s.signature)) continue; try { const buy = buyFromTransaction(await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]), f.wallet, s.signature); if (buy) buys.push(buy); } catch {} }
      for (const b of newBuys(buys, { since: mem.since, seen: mem.seen }).slice(0, 2)) {
        mem.seen = [...mem.seen, b.signature].slice(-60); let t = null; try { t = await lookupCoin(b.mint, rules, mintSafety); } catch {}
        const says = !t ? 'could not be checked' : !t.screen.ok ? `fails the safety screen (${t.screen.reasons[0]})` : t.analysis.decision === 'enter' ? `is an ENTER (${t.analysis.score}/4)` : `is a WAIT (${t.analysis.reasons[0] ?? 'rules not met'})`;
        log(`👀  ${f.label} bought ${t?.symbol ?? b.mint.slice(0, 6)}. Warrior says it ${says}.`);
        // Copying obeys the same rules as everything else: never a coin that fails the screen, and with real funds only an ENTER.
        if (!COPY) continue; if (!t || !t.screen.ok || (LIVE && t.analysis.decision !== 'enter')) { log(`  Not copied: it ${says}.`); continue; }
        const may = await mayBuy(t.mint); if (may.reason) { log(`  Not copied: ${may.reason}.`); continue; } await openPosition(t, may.bal, may.equity, { why: `copied from ${f.label}` });
      }
    } catch (e) { log(`${f.label}: could not read that wallet just now (${e.message}).`); }
  }
}
async function round() {
  rollDay();
  for (const p of [...state.positions]) {
    try {
      const bars = await candles(p.pool, p.tf === 1 ? 400 : 120, Date.now(), p.tf === 1 ? 1 : 5, p.mint), m = manage(p, bars, p.rocket ? { ...settings, ...p.rocket } : settings);
      if (m.stale) { log(p.empty ? `${p.symbol}: its pool has been emptied, so it cannot be sold. Still checking.` : `${p.symbol}: nobody has traded it for a while, so there are no fresh candles. Holding; its stop is still checked against the live price.`); continue; }
      p.peak = m.peak ?? p.peak; if (m.stop) p.stop = Math.max(p.stop, m.stop);
      // A position you asked for (an order, slices, a copied buy) is yours to hold: its stop and target still apply, but
      // Warrior does not sell it just because the trend it never promised is missing, or because time passed.
      const yours = p.why && p.why !== 'signal' && ['trend-break', 'time'].includes(m.reason);
      if (m.action === 'exit' && !yours) await closePosition(p, m.reason); else log(`hold ${p.symbol}: ${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%, stop ${usd(p.stop)}${p.ownStop || p.ownTarget ? ` · yours: stop ${p.ownStop ? usd(p.ownStop) : 'off'}, target ${p.ownTarget ? usd(p.ownTarget) : 'off'}` : ''}`);
    } catch (e) { log(`${p.symbol}: could not check (${e.message}). Holding.`); }
  }
  save(); await watchStep(); await followStep();
  const balance = await balanceSol(), equity = balance + heldSol(), bed = sleeping();
  if (!bed.canOpen && !SELFTEST) { log(`Bedtime rule: no new trades until ${bed.wakeAt}. Open positions are still watched.`); return; }
  if (dayLimitHit(equity)) { log(`Daily loss limit reached: down ${(-state.dayPnlSol).toFixed(4)} SOL today, against a limit of ${risk.dailyLossLimitPct}% of what the day started with. No new trades today. "npm run warrior -- reset-day" starts the count again.`); return; }
  if (regular().length >= risk.maxOpenPositions && !SELFTEST) { log(`Holding ${regular().length} positions, the most your rules allow; not looking for more.${ROCKET.on ? ' Rocket Mode still looks.' : ''}`); if (ROCKET.on) await rocketStep(); return; }
  let result; try { result = await scan({ mature: MATURE, limit: 36, settings, risk }); } catch (e) { state.dayRecord = recordScan(state.dayRecord, null); throw e; }
  state.dayRecord = recordScan(state.dayRecord, result);
  const held = new Set(state.positions.map((p) => p.mint)), picks = result.results.filter((t) => t.analysis.decision === 'enter' && !held.has(t.mint) && !((state.cooldown[t.mint] ?? 0) > Date.now()) && !(t.analysis.style === 'smart' && LIVE && settings.smartLive !== 1)); // smart-wallet buys: practice only unless switched on
  log(`scan: ${result.universe} coins, ${result.rejected} failed the screen, ${result.scanned} analysed, ${picks.length} tradable ENTER. Wallet ${balance.toFixed(4)} SOL, today ${state.dayPnlSol >= 0 ? '+' : ''}${state.dayPnlSol.toFixed(4)} SOL.`);
  // Practice-only self-test: force one pretend round trip on the best-scoring coin to exercise quoting, sizing and both exits.
  if (SELFTEST) {
    if (LIVE) { log('Self-test is practice-only and does nothing in live mode.'); process.exit(1); }
    for (const t of result.results.filter((x) => x.analysis.price && x.analysis.stop)) {
      log(`Self-test on ${t.symbol} (forced; its real verdict was ${t.analysis.decision}).`);
      const before = state.positions.length; await openPosition(t, await balanceSol(), equity); const p = state.positions.at(-1);
      if (state.positions.length === before) continue; // refused by the risk checks: try the next coin
      await closePosition(p, 'selftest');
      log(`Self-test ${!state.positions.includes(p) ? 'passed: bought and sold in practice' : 'bought but could not sell in practice; see above'}. Practice balance ${state.paperSol.toFixed(4)} SOL.`); process.exit(0);
    }
    log('Self-test: every analysed coin was refused by the risk checks right now. Try again later.'); process.exit(1);
  }
  for (const t of picks) { if (regular().length >= risk.maxOpenPositions) break; try { await openPosition(t, await balanceSol(), equity); } catch (e) { log(`${t.symbol}: entry attempt failed (${e.message}).`); } }
  if (ROCKET.on) await rocketStep();
}
/** Rocket Mode: at most one small bet a round on a brand-new pump.fun coin that passes the Rocket screen. */
const rocketTries = new Map(); // rounds a coin's Rocket buy has been put off
async function rocketStep(quick = false) { // quick: a 30-second look between rounds, silent unless it finds something
  try {
    const today = new Date().toISOString().slice(0, 10); if (state.rocketDay?.day !== today) state.rocketDay = { day: today, bets: 0 };
    const wait = rocketRoom({ openRockets: state.positions.filter((p) => p.rocket && !p.empty).length, betsToday: state.rocketDay.bets }, ROCKET); if (wait) { if (!quick) log(`Rocket Mode: ${wait}.`); return; }
    const now = Date.now(), seen = (await rocketPools()).map((p) => rocketCandidate(p, now)).filter(Boolean), coins = rocketRank(seen.map((c) => ({ ...c, screen: rocketScreen(c, rocketLimits(LEVEL)) })));
    const free = (c) => !state.positions.some((p) => p.mint === c.mint) && !((state.cooldown[c.mint] ?? 0) > now), usual = coins.find((c) => c.screen.ok && free(c));
    const firsts = ROCKET.early === 1 ? seen.filter((c) => earlyScreen(c, earlyLimits(LEVEL)).ok && free(c)).sort((a, b) => (b.buyUsd5m - (b.sellUsd5m ?? 0)) - (a.buyUsd5m - (a.sellUsd5m ?? 0))) : [], early = !usual && firsts.length > 0, pick = usual ?? firsts[0];
    if (ROCKET.early === 1 && !quick) log(`Rocket Mode, early: ${firsts.length} of ${seen.filter((c) => !c.graduated).length} launches on the curve pass the early screen.`);
    if (!quick || pick) log(`Rocket Mode: ${seen.length} new launches, ${coins.filter((c) => c.screen.ok).length} pass the Rocket screen${pick ? '' : '; none to bet on this round'}.`); if (!pick) return;
    const plan = early ? earlyPlan(pick, ROCKET) : rocketPlan(pick, ROCKET), may = await mayBuy(pick.mint); if (!plan || may.reason) { log(`Rocket Mode: ${pick.symbol} skipped: ${may.reason ?? 'no usable price'}.`); return; }
    log(`🚀 Rocket Mode: ${pick.symbol}, ${Math.round(pick.ageMin)} minutes old. ${pick.creator.text}`);
    const ok = await openPosition({ mint: pick.mint, symbol: pick.symbol, pool: pick.pool, priceUsd: pick.priceUsd, analysis: plan }, may.bal, may.equity, { fixedSol: ROCKET.betSol, why: early ? 'Rocket Mode, early' : 'Rocket Mode', rocket: plan.exits, early });
    if (ok) { state.rocketDay.bets++; const held = state.positions.find((p) => p.mint === pick.mint); if (held) { if (Number.isFinite(pick.liquidityUsd)) held.rocketLiq = pick.liquidityUsd; if (Number.isInteger(pick.holders)) held.checked = { at: Date.now(), holders: pick.holders, traders: pick.traders ?? null, topHoldersPct: pick.topHoldersPct ?? null }; held.trust = { at: Date.now(), rows: early ? earlyTrust(pick, null, earlyLimits(LEVEL)) : rocketTrust(pick, null, rocketLimits(LEVEL)) }; log(`  Why Warrior trusted ${pick.symbol}:`); for (const r of held.trust.rows) log(`    ${r.label.padEnd(15)} ${r.value}`); } } else { const tries = rocketTries.get(pick.mint) ?? 0; rocketTries.set(pick.mint, tries + 1); state.cooldown[pick.mint] = Math.max(state.cooldown[pick.mint] ?? 0, now + (tries < 3 ? 20_000 : 3_600_000)); if (tries < 3) log(`Rocket Mode: ${pick.symbol} was not bought this round. The bot will try it again next round if it still passes.`); }
  } catch (e) { log(`Rocket Mode could not look this round (${e.message}). No bet placed.`); }
}

log(`Warrior bot starting in ${LIVE ? 'LIVE mode — real funds' : 'PRACTICE mode — pretend money, nothing is sent'}. ${LIVE ? `Wallet ${owner}.` : ''}`);
log(`Rules ${rules.version}: ${describe(rules)}`);
if (ROCKET.on) log(`🚀 Rocket Mode ON: up to ${ROCKET.maxBetsPerDay} bets a day of ${ROCKET.betSol} SOL on pump.fun coins 1 to 60 minutes old, sold at −${ROCKET.stopPct}% or +${ROCKET.targetPct}%. ${ROCKET.takeOutAtPct > 0 ? `Your stake comes out once a bet is up ${ROCKET.takeOutAtPct}%. ` : ''}Open bets are watched every 5 seconds. ${LEVEL === 'spicy' ? 'On Spicy the Rocket screen is at its loosest. ' : ''}Most of them will lose.`);
if (ROCKET.on) log(rocketRecordText(rocketRecord(state.trades), LIVE ? 'real funds' : 'practice money'));
log(`Sending: priority fee ${priority}${PROTECT ? ', protected (Jito)' : ''}. ${bedtimeText(bedtime)}${follows.length ? ` Following ${follows.map((f) => f.label).join(', ')}${COPY ? ' and copying inside the rules' : ', not copying'}.` : ''}`);
for (const p of state.positions) { if (p.rocket) continue; if (p.exitRules === rules.version || (p.rulesVersion === rules.version && !p.exitRules)) continue; const r = rebasePosition(p, settings); if (!r) continue; p.target = r.target; p.stop = r.stop; p.baseStop = r.baseStop; p.exitRules = rules.version; log(`${p.symbol}: opened under other rules, now follows ${rules.version}: target ${usd(r.target)} (+${r.targetPct}%), stop ${usd(r.stop)}${r.trailed ? ' (kept: it had already moved up)' : ` (−${r.stopPct.toFixed(1)}%)`}.`); }
save();
if (LIVE) { const b = await balanceSol(); log(`Balance ${b.toFixed(4)} SOL.`); if (b < risk.minTradeSol + risk.reserveSol) log(`That is too little to trade. Send SOL to ${owner} and the bot will pick it up.`); }
let stopping = false; process.on('SIGINT', () => { if (stopping) process.exit(1); stopping = true; save(); log(`Stopping. ${state.positions.length} position(s) remain open: ${state.positions.map((p) => p.symbol).join(', ') || 'none'}. Restart the bot to keep managing them.`); process.exit(0); });
/** The five-second watch on open Rocket bets: sell on one look at the stop, or when a third of the pool money has left. */
async function rocketLook() {
  const mine = state.positions.filter((p) => p.rocket && !p.empty); if (!mine.length) return;
  try {
    const facts = await priceFacts(mine.map((p) => p.mint));
    for (const p of mine) {
      const price = facts.prices?.[p.mint]; if (Number.isFinite(price)) { p.last = price; prices[p.mint] = price; }
      const lift = rocketRatchet(p, price, { costMult: p.costs?.requestedSol > 0 ? p.solIn / p.costs.requestedSol : 1 }); if (lift) { const moved = lift.stop > p.stop, first = moved && !(p.stop > p.entry); p.peakSeen = lift.peak; p.lastLook = lift.look; if (moved) { p.stop = lift.stop; if (first) log(`🚀 ${p.symbol}: it has held ${Math.round((lift.peak / p.entry - 1) * 100)}% up, so its stop moved to ${Math.round((lift.stop / p.entry - 1) * 100)}% above the price paid.`); } }
      const due = rocketWatch(p, { price, liquidityUsd: facts.liquidity?.[p.mint] }); if (!due) continue;
      log(due === 'stop' ? `🚀 ${p.symbol}: the live price reached the stop. Selling now.` : due === 'profit-lock' ? `🚀 ${p.symbol}: it fell back to the stop that had moved up. Selling now to keep part of the gain.` : due === 'time' ? `🚀 ${p.symbol}: its ${p.rocket.maxMinutes} minutes are up. Selling whatever it is worth now.` : `🚀 ${p.symbol}: money is leaving its pool (more than a third since the buy). Selling now, before the stop.`); await closePosition(p, due); save();
    }
  } catch { /* no prices this time: the 30-second check still stands */ }
}
let lastRound = 0;
for (;;) {
  try { await fastTick(); } catch (e) { log(`Check failed (${e.message}). Trying again shortly.`); }
  if (ROCKET.on && Date.now() - lastRound < INTERVAL && lastRound > 0) { try { await rocketStep(true); } catch { /* the round's own look reports problems */ } } // Rocket looks every 30 seconds, not only each round
  if (Date.now() - lastRound >= INTERVAL) { lastRound = Date.now(); try { await round(); } catch (e) { log(`Round failed (${e.message}). Trying again next round.`); } save(); }
  if (ONCE) { await fastTick().catch(() => {}); save(); process.exit(0); }
  // Between the 30-second checks, open Rocket bets get a look every five seconds.
  for (let waited = 0; waited < FAST_MS; waited += 5000) { await new Promise((r) => setTimeout(r, Math.min(5000, FAST_MS - waited))); if (waited + 5000 < FAST_MS) await rocketLook(); }
}
