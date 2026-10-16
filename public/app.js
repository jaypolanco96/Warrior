// Warrior site. The scanner is read-only. A trade happens only when you press the button and approve it in your own wallet.
import { setMood, label, joyPrefs, tradeClosed } from '/joy.js';
import { lineChart, addressLine } from '/chart.js';
import { emit, on } from '/bus.js';
import { rules } from '/rules.js';
import { coachBefore } from '/vendor/lib/coach.js';
import { guardBuy, day } from '/care.js';
import { coinInfo } from '/coininfo.js';
const SOL = 'So11111111111111111111111111111111111111112', KEY = 'warrior.positions.v1';
// Sizing limits come from the strategy dial, read fresh each time so a change applies at once.
const RISK = new Proxy({}, { get: (_, key) => rules.resolved.risk[key] });
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const usd = (n) => n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= 1 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${n.toPrecision(4)}`;
const compact = (n) => Number.isFinite(n) ? `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}` : '—';
const pct = (n) => Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '—';

let provider = null, owner = '', balanceSol = null, walletEpoch = 0, lastScan = null, scanRequest = 0, retryTimer = null;
// The connected Phantom wallet, shared with the auto-trading panel (used only to fund it and to receive withdrawals).
export const session = { get owner() { return owner; }, get provider() { return provider; } };

// ---------- wallet ----------
function findProvider() { const p = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null) ?? window.solflare ?? null; return p && typeof p.connect === 'function' ? p : null; }
async function refreshBalance() {
  if (!owner) { balanceSol = null; return; }
  const who = owner; try { const r = await fetch(`/api/balance?owner=${who}`), j = await r.json(); if (who === owner) balanceSol = r.ok ? j.sol : null; } catch { if (who === owner) balanceSol = null; }
  renderWallet();
}
function renderWallet() {
  $('connect').textContent = owner ? 'Disconnect' : 'Connect wallet';
  $('wallet-info').textContent = owner ? `${owner.slice(0, 4)}…${owner.slice(-4)} · ${balanceSol === null ? 'balance unavailable' : `${balanceSol.toFixed(4)} SOL`}` : '';
  renderResults(); renderPositions();
}
function setOwner(next) { owner = next || ''; walletEpoch++; balanceSol = null; positionChecks = new Map(); renderWallet(); if (owner) { void refreshBalance(); void checkPositions(); } }
// Remember that you connected, so a reload does not ask again. Only a flag is kept, never an address or a key; the wallet
// itself decides whether this site is still trusted and can refuse.
const CONNECTED = 'warrior.wallet.connected.v1';
let listening = null;
function listen(p) { if (listening === p) return; listening = p; p.on?.('accountChanged', (pk) => setOwner(pk ? pk.toString() : '')); p.on?.('disconnect', () => setOwner('')); }
$('connect').addEventListener('click', async () => {
  if (owner) { try { localStorage.removeItem(CONNECTED); } catch {} try { await provider?.disconnect?.(); } catch {} setOwner(''); return; }
  provider = findProvider();
  if (!provider) { $('wallet-info').textContent = 'No Solana wallet found. Install Phantom, or open this page in the Phantom app browser.'; return; }
  try {
    const r = await provider.connect(); setOwner((r?.publicKey ?? provider.publicKey)?.toString()); listen(provider);
    try { localStorage.setItem(CONNECTED, '1'); } catch {}
  } catch { $('wallet-info').textContent = 'Connection cancelled.'; }
});
/** After a reload: reconnect quietly if you were connected and the wallet still trusts this site. Never opens a prompt. */
async function reconnect() {
  let was = false; try { was = localStorage.getItem(CONNECTED) === '1'; } catch {} if (!was) return;
  // Wallet extensions can take a moment to appear on the page.
  for (let i = 0; i < 12 && !findProvider(); i++) await new Promise((r) => setTimeout(r, 250));
  const p = findProvider(); if (!p || owner) return;
  try { const r = await p.connect({ onlyIfTrusted: true }), key = (r?.publicKey ?? p.publicKey)?.toString(); if (key && !owner) { provider = p; setOwner(key); listen(p); } }
  catch { /* the wallet is locked or no longer trusts this site: stay disconnected until Connect is pressed */ }
}

// ---------- scanner ----------
async function scan() {
  const mine = ++scanRequest; $('scan-status').textContent = 'Scanning the market… this takes up to a minute.'; $('rescan').disabled = true; setMood({ scanning: true, failed: false });
  try {
    const r = await fetch(`/api/scan?${rules.query}${$('mature').checked ? '&mature=1' : ''}`), j = await r.json();
    if (mine !== scanRequest) return;
    if (!r.ok) throw new Error(j.error || 'Scan unavailable');
    lastScan = j; day.scanned(j); void checkPositions();
    const enters = j.results.filter((t) => t.analysis.decision === 'enter').length;
    setMood({ scanning: false, failed: false, enters, forming: j.results.filter((t) => t.analysis.decision !== 'enter' && t.analysis.score >= 2).length, tick: Math.floor(Date.now() / 180_000) });
    $('scan-status').textContent = `${new Date(j.at).toLocaleTimeString()} · looked at ${j.universe} coins, ${j.rejected} failed the risk screen, ${j.scanned} analysed, ${enters} ENTER signal${enters === 1 ? '' : 's'} under your ${rules.PRESETS[rules.choice.preset].label}${rules.resolved.isCustom ? ' (custom)' : ''} rules.${j.sourcesFailed ? ' Some data sources were unavailable.' : ''} ${j.note}`;
    renderResults(); renderPositions();
  } catch (e) { if (mine === scanRequest) { day.scanned(null); emit('problem', `A market scan failed (${e.message}).`); setMood({ scanning: false, failed: true }); $('scan-status').textContent = `${e.message}. ${lastScan ? 'Showing the last results. ' : ''}Trying again in 30 seconds.`; clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (mine === scanRequest && !dialog.open) void scan(); }, 30_000); } }
  finally { if (mine === scanRequest) $('rescan').disabled = false; }
}
/** A coin card: verdict, facts, reasons and actions. Shared by the scanner, the lookup and the watchlist. */
const seenPrice = new Map(); // the price each coin showed last time its card was drawn, so a change can flash
/**
 * One coin as a card. A coin from the Rocket scanner carries `rocketInfo` ({ ok, label, tag, move, facts, note }): it gets
 * the Rocket screen's verdict and facts in place of the four signal groups, and exactly the same buttons.
 */
export function card(t) {
  const a = t.analysis, R = t.rocketInfo ?? null, c = el('article', `card ${a.decision === 'enter' || R?.ok ? 'enter' : ''}`), top = el('div', 'card-top'), name = el('span', 'sym', t.symbol || 'Unknown');
  const tag = el('span', `tag ${t.mature ? 'mature' : t.pump ? 'pump' : ''}`, R ? R.tag : t.mature ? 'MATURE' : t.pump ? 'PUMP.FUN' : String(t.dex).toUpperCase());
  top.append(name, tag); c.append(top);
  if (a.young) c.append(label('div', 'Young coin', 'young-tag'));
  c.append(el('div', `verdict ${R ? (R.ok ? 'enter' : 'wait') : a.decision}`, R ? R.label : a.decision === 'enter' ? `ENTER · ${a.score}/4 agree` : `WAIT · ${a.score}/4 agree`));
  if (!R && a.confirmations) { const dots = el('div', 'dots'); for (const [k, lit] of Object.entries(a.confirmations)) dots.append(label('span', k, `dot ${lit ? 'on' : ''}`)); c.append(dots); }
  const facts = el('dl', 'facts'), row = (k, v, cls) => { facts.append(label('dt', k)); facts.append(el('dd', cls || '', v)); };
  if (R) { for (const [k, v] of R.facts) { facts.append(el('dt', '', k)); facts.append(el('dd', '', v)); } }
  else { row('Price', usd(t.priceUsd)); row('1h', pct(t.change?.h1), t.change?.h1 > 0 ? 'up' : t.change?.h1 < 0 ? 'down' : '');
  row('Regime', a.regime ?? '—'); row(a.young ? 'Recent bias' : 'Hourly bias', a.bias ?? '—'); row('Liquidity', compact(t.liquidityUsd)); row('24h volume', compact(t.volume24hUsd)); }
  if (!R && a.decision === 'enter') { row('Stop', `${usd(a.stop)} (−${a.stopPct.toFixed(1)}%)`); row('Target', `${usd(a.target)} (+${a.targetPct}%)`); }
  const was = seenPrice.get(t.mint), priceNow = el('b', '', usd(t.priceUsd)); if (Number.isFinite(t.priceUsd)) { if (Number.isFinite(was) && was !== t.priceUsd) priceNow.className = t.priceUsd > was ? 'flash-up' : 'flash-down'; seenPrice.set(t.mint, t.priceUsd); if (seenPrice.size > 300) seenPrice.delete(seenPrice.keys().next().value); }
  const quick = el('p', 'card-line'); const move = R ? R.move : t.change?.h1; quick.append(priceNow, R ? ' · 5m ' : ' · 1h ', el('span', move > 0 ? 'up' : move < 0 ? 'down' : '', pct(move)), ` · pool ${compact(t.liquidityUsd)}${R?.age ? ` · ${R.age}` : ''}`); c.append(quick);
  if (typeof t.mint === 'string') { c.append(addressLine(t.mint)); if (typeof t.pool === 'string') c.append(lineChart({ mint: t.mint, pool: t.pool, symbol: t.symbol })); }
  const more = el('details', 'card-more'), sum = el('summary', '', R ? (R.ok ? 'The numbers behind it' : 'Numbers and reasons') : 'Numbers, reasons and coach'); more.append(sum, facts);
  if (t.candleSource) c.dataset.candles = t.candleSource;
  if (a.reasons?.length) { const ul = el('ul', 'reasons'); for (const r of a.reasons.slice(0, 4)) ul.append(el('li', '', r)); more.append(ul); }
  // Warrior Coach: one sentence on why, one on what would make it wrong. Inside the fold, with the numbers.
  const coach = R ? { stance: R.ok ? 'enter' : 'wait' } : coachBefore(t, rules.resolved), says = el('p', 'coach'); if (R) says.append(el('b', '', 'Creator: '), R.note); else says.append(el('b', '', 'Coach: '), `${coach.why} ${coach.wrongIf}`); more.append(says);
  c.append(more);
  const foot = el('div', 'card-foot');
  if (coach.stance === 'wait') { const why = el('button', 'btn small whynot-btn', 'Why not?'); why.type = 'button'; why.addEventListener('click', () => emit('why-not', t)); foot.append(why); }
  // Practice is always available and needs no wallet. Real trading needs a connected wallet.
  const actions = el('div', 'card-actions'), practice = el('button', 'btn practice', 'Practice buy'); practice.type = 'button'; practice.addEventListener('click', () => guardBuy({ mint: t.mint, practice: true }, () => emit('practice-buy', t)));
  const b = el('button', `btn ${a.decision === 'enter' || R?.ok ? 'neon' : ''}`, owner ? (a.decision === 'enter' || R?.ok ? 'Trade this signal' : 'Trade anyway') : 'Trade with Warrior wallet');
  b.addEventListener('click', () => owner ? guardBuy({ mint: t.mint, practice: false }, () => openBuy(t)) : emit('coin-tools', { ...t, focus: 'buy' })); actions.append(practice, b); c.append(actions);
  const tools = el('button', 'btn ghost', 'Safety, watch, orders'); tools.type = 'button'; tools.addEventListener('click', () => emit('coin-tools', t)); foot.append(tools); c.append(foot);
  return c;
}
// Two scanners share one panel. Only the one on show is fetched and refreshed, so the page stays short and light.
let scanTab = 'live';
for (const b of document.querySelectorAll('[data-scan-tab]')) b.addEventListener('click', () => {
  if (scanTab === b.dataset.scanTab) return; scanTab = b.dataset.scanTab; const rocket = scanTab === 'rocket';
  for (const x of document.querySelectorAll('[data-scan-tab]')) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }
  for (const id of ['scan-status', 'results', 'results-more', 'mature-wrap']) $(id).hidden = rocket; for (const id of ['rocket-scan-status', 'rocket-scan', 'rocket-scan-more']) $(id).hidden = !rocket;
  $('rescan').textContent = rocket ? 'Look now' : 'Scan now'; emit('scanner-tab', scanTab); if (!rocket) void scan();
});
let showAllResults = false;
function renderResults() {
  const box = $('results'), more = $('results-more'); box.replaceChildren(); more.replaceChildren(); if (!lastScan) return;
  if (!lastScan.results.length) { box.append(el('p', 'muted', 'No coin passed the risk screen right now. That is the screen doing its job.')); return; }
  // ENTER calls first, then the strongest readings. Nine cards unless you ask for all of them.
  const enters = lastScan.results.filter((t) => t.analysis.decision === 'enter').length, shown = showAllResults ? lastScan.results : lastScan.results.slice(0, Math.max(9, enters));
  for (const t of shown) box.append(card(t));
  if (lastScan.results.length > shown.length || showAllResults) { const b = el('button', 'btn', showAllResults ? 'Show fewer' : `Show all ${lastScan.results.length} coins Warrior read`); b.type = 'button'; b.addEventListener('click', () => { showAllResults = !showAllResults; renderResults(); }); more.append(b); }
}
$('rescan').addEventListener('click', () => { if (scanTab === 'rocket') emit('scanner-refresh'); else void scan(); }); $('mature').addEventListener('change', () => void scan());

// ---------- positions (this browser only) ----------
const loadPositions = () => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((p) => p && typeof p.mint === 'string' && p.owner) : []; } catch { return []; } };
const savePositions = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-50))); } catch {} };
let positionChecks = new Map(), positionRequest = 0;
async function checkPositions() {
  const mine = loadPositions().filter((p) => p.owner === owner && !p.closedAt && p.pool && p.entryPriceUsd && p.stop && p.target).slice(0, 3), request = ++positionRequest, who = owner;
  if (!mine.length) { positionChecks = new Map(); return; }
  try {
    const r = await fetch('/api/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positions: mine.map((p) => ({ pool: p.pool, entry: p.entryPriceUsd, stop: p.stop, target: p.target, entryBar: p.openedAt, peak: p.entryPriceUsd })) }) }), j = await r.json();
    if (request !== positionRequest || who !== owner || !r.ok) return;
    positionChecks = new Map(j.results.map((m, i) => [mine[i].signature, m])); renderPositions();
  } catch (e) { emit('problem', `Could not check your open positions against the rules (${e.message}).`); }
}
function renderPositions() {
  if (typeof renderComfort === 'function') { try { renderComfort(); } catch {} }
  const box = $('positions'); box.replaceChildren();
  const mine = loadPositions().filter((p) => p.owner === owner && !p.closedAt);
  if (!owner) { box.append(el('p', 'muted', 'Connect your wallet to see positions opened here.')); return; }
  if (!mine.length) { box.append(el('p', 'muted', 'No open positions.')); return; }
  for (const p of mine) {
    const live = lastScan?.results.find((t) => t.mint === p.mint), checked = positionChecks.get(p.signature), now = checked?.lastPrice ?? live?.priceUsd ?? null, change = now && p.entryPriceUsd ? (now / p.entryPriceUsd - 1) * 100 : null;
    const c = el('article', 'card'), top = el('div', 'card-top'); top.append(el('span', 'sym', p.symbol), el('span', 'tag', `${p.sol} SOL in`)); c.append(top);
    const facts = el('dl', 'facts'), row = (k, v, cls) => { facts.append(label('dt', k)); facts.append(el('dd', cls || '', v)); };
    row('Entry', usd(p.entryPriceUsd)); row('Now', now === null ? 'checking…' : usd(now)); row('Change', pct(change), change > 0 ? 'up' : change < 0 ? 'down' : '');
    row('Stop', usd(p.stop)); row('Target', usd(p.target)); c.append(facts);
    const why = { stop: 'the stop was hit', 'trailing-stop': 'the trailing stop was hit', target: 'the target was reached', time: 'the time limit passed', 'trend-break': 'the trend broke', step: 'a take-profit step was reached', 'pool-draining': 'money was leaving its pool', 'holders-leaving': 'its holders were leaving', 'profit-lock': 'the stop that had moved up kept part of the gain', 'sell-off': 'selling took over', 'big-holders-selling': 'its biggest holders were selling', 'took-out': 'your rule took out what you put in' };
    if (checked?.action === 'exit') c.append(el('div', `verdict ${checked.reason === 'target' ? 'enter' : 'exit'}`, `RULES SAY SELL — ${why[checked.reason] ?? checked.reason}`));
    else if (checked?.stale) c.append(el('div', 'muted', 'No fresh price data for this coin right now.'));
    else if (checked?.action === 'hold') c.append(el('div', 'muted', 'Rules say hold.'));
    c.append(coinInfo(p.mint, [Number.isFinite(p.openedAt) ? `Opened ${new Date(p.openedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null]));
    const link = el('a', '', 'View entry transaction'); link.href = `https://solscan.io/tx/${encodeURIComponent(p.signature)}`; link.target = '_blank'; link.rel = 'noopener'; c.append(link);
    const b = el('button', 'btn sell', 'Sell back to SOL'); b.addEventListener('click', () => openSell(p)); c.append(b); box.append(c);
  }
}

// ---------- trading ----------
let pending = null; // { quote, kind, token, position, at }
const dialog = $('trade'), body = $('trade-body'), status = $('trade-status'), go = $('trade-go');
function summary(rows) { const dl = el('dl', 'sum'); for (const [k, v] of rows) { dl.append(label('dt', k)); dl.append(el('dd', '', v)); } return dl; }
async function fetchQuote(inputMint, outputMint, amountRaw, exit = false) {
  const r = await fetch(`/api/quote?${new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), slip: String(rules.slip), ...(exit ? { exit: '1' } : {}) })}`), j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Quote unavailable'); if (!j.check.ok) throw new Error(`Refused: ${j.check.reasons.join('; ')}`); return j;
}
function suggestedSol(stopPct) { if (balanceSol === null) return RISK.minTradeSol; const byRisk = balanceSol * RISK.riskPerTradePct / (stopPct || 8), cap = balanceSol * RISK.maxPositionPct / 100, spend = balanceSol - RISK.reserveSol; return Math.max(0, Math.floor(Math.min(byRisk, cap, spend) * 1000) / 1000); }
function openBuy(t) {
  if (!owner) return; pending = null; go.disabled = true; status.textContent = ''; $('trade-title').textContent = `Buy ${t.symbol}`; body.replaceChildren();
  const a = t.analysis, suggest = suggestedSol(a.stopPct), label = el('label', 'field', 'SOL to spend'), input = el('input'); input.type = 'number'; input.min = String(RISK.minTradeSol); input.step = '0.001'; input.value = String(Math.max(RISK.minTradeSol, suggest)); label.htmlFor = input.id = 'buy-sol';
  const info = el('div');
  const viaWarrior = el('button', 'btn ghost', 'Buy with the Warrior wallet instead'); viaWarrior.type = 'button'; viaWarrior.addEventListener('click', () => { dialog.close(); emit('coin-tools', { ...t, focus: 'buy' }); });
  body.append(el('p', 'muted', a.decision === 'enter' ? `Signal: ${a.score}/4 groups agree. Suggested size risks about ${RISK.riskPerTradePct}% of your wallet if the stop is hit.` : `No ENTER signal on this coin (${a.reasons?.[0] ?? 'rules not met'}). You can still trade it, at your own judgement.`), label, input, info, viaWarrior);
  let timer; const requote = () => { clearTimeout(timer); pending = null; go.disabled = true; timer = setTimeout(async () => {
    const sol = Number(input.value), epoch = walletEpoch;
    if (!Number.isFinite(sol) || sol < RISK.minTradeSol) { status.textContent = `Minimum is ${RISK.minTradeSol} SOL.`; return; }
    if (balanceSol !== null && sol > balanceSol - RISK.reserveSol) { status.textContent = `Leave at least ${RISK.reserveSol} SOL for fees. You can spend up to ${Math.max(0, balanceSol - RISK.reserveSol).toFixed(3)}.`; return; }
    status.textContent = 'Getting a live quote…';
    try {
      const lamports = Math.round(sol * 1e9), j = await fetchQuote(SOL, t.mint, lamports); if (epoch !== walletEpoch || !dialog.open) return;
      pending = { kind: 'buy', token: t, quote: j.quote, sol, impactPct: j.check.impactPct, at: Date.now() };
      info.replaceChildren(summary([['You pay', `${sol} SOL`], ['Price impact', `${j.check.impactPct.toFixed(2)}%`], ['Slippage limit', `${(j.quote.slippageBps / 100).toFixed(1)}%`], ["Warrior's fee", 'none'], ['Stop if it falls to', a.stop ? usd(a.stop) : 'set your own'], ['Target', a.target ? usd(a.target) : 'set your own']]));
      status.textContent = 'Your wallet will show exactly what leaves and what arrives. Approve only if it matches.'; go.disabled = false;
    } catch (e) { status.textContent = `${e.message}. Nothing was traded.`; }
  }, 500); };
  input.addEventListener('input', requote); dialog.showModal(); requote();
}
async function openSell(p) {
  if (!owner) return; pending = null; go.disabled = true; $('trade-title').textContent = `Sell ${p.symbol}`; body.replaceChildren(); status.textContent = 'Reading your balance…'; dialog.showModal();
  const epoch = walletEpoch;
  try {
    const r = await fetch(`/api/balance?owner=${owner}&mint=${p.mint}`), b = await r.json(); if (!r.ok) throw new Error(b.error || 'Balance unavailable');
    if (!b.tokenRaw || b.tokenRaw === '0') { status.textContent = 'Your wallet holds none of this coin. It may already be sold; removing it from the list.'; savePositions(loadPositions().map((x) => x.signature === p.signature ? { ...x, closedAt: Date.now() } : x)); renderPositions(); return; }
    const j = await fetchQuote(p.mint, SOL, b.tokenRaw, true); if (epoch !== walletEpoch || !dialog.open) return;
    const out = Number(j.quote.outAmount) / 1e9; pending = { kind: 'sell', position: p, quote: j.quote, impactPct: j.check.impactPct, at: Date.now() };
    body.append(summary([['You sell', `all ${p.symbol} in your wallet`], ['You receive about', `${out.toFixed(4)} SOL`], ['You paid', `${p.sol} SOL`], ['Result', `${out - p.sol >= 0 ? '+' : ''}${(out - p.sol).toFixed(4)} SOL before fees`], ['Price impact', `${j.check.impactPct.toFixed(2)}%`], ["Warrior's fee", 'none']]));
    status.textContent = 'Approve in your wallet to sell.'; go.disabled = false;
  } catch (e) { status.textContent = `${e.message}. Nothing was traded.`; }
}
go.addEventListener('click', async () => {
  if (!pending || !owner || !provider) return; const job = pending, epoch = walletEpoch; go.disabled = true;
  if (Date.now() - job.at > 45_000) { status.textContent = 'That quote is stale. Close and reopen to get a fresh one.'; return; }
  try {
    status.textContent = 'Building the transaction…';
    const r = await fetch('/api/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: job.quote, userPublicKey: owner, exit: job.kind === 'sell' }) }), j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Could not build the swap');
    const { VersionedTransaction } = await import('/vendor/solana.js');
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(j.transaction), (c) => c.charCodeAt(0)));
    if (epoch !== walletEpoch) throw new Error('Wallet changed');
    status.textContent = 'Check and approve it in your wallet…';
    const sent = await provider.signAndSendTransaction(tx), signature = typeof sent === 'string' ? sent : sent?.signature;
    if (!signature) throw new Error('The wallet did not return a signature. Check your wallet history before trying again');
    const list = loadPositions();
    if (job.kind === 'buy') { const a = job.token.analysis; list.push({ owner, mint: job.token.mint, symbol: job.token.symbol, pool: job.token.pool, sol: job.sol, tokenRaw: job.quote.outAmount, entryPriceUsd: job.token.priceUsd, stop: a.stop ?? (job.token.priceUsd ? job.token.priceUsd * 0.92 : null), target: a.target ?? (job.token.priceUsd ? job.token.priceUsd * (1 + rules.resolved.settings.targetPct / 100) : null), openedAt: Date.now(), signature, rulesVersion: rules.resolved.version, entryImpactPct: job.impactPct ?? null }); savePositions(list); }
    else { const out = Number(job.quote.outAmount) / 1e9; savePositions(list.map((x) => x.signature === job.position.signature ? { ...x, closedAt: Date.now(), exitSignature: signature, quotedOutSol: out, exitImpactPct: job.impactPct ?? null } : x)); void feelWhenConfirmed(signature, { symbol: job.position.symbol, pnlSol: out - job.position.sol, pnlPct: (out / job.position.sol - 1) * 100, reason: 'manual', practice: false }); }
    pending = null; status.replaceChildren('Sent. ', Object.assign(el('a', '', 'View on Solscan'), { href: `https://solscan.io/tx/${encodeURIComponent(signature)}`, target: '_blank', rel: 'noopener' }), ' — give it a few seconds to confirm. Do not send it again.');
    renderPositions(); void checkPositions(); setTimeout(() => void refreshBalance(), 8000);
  } catch (e) { status.textContent = `${/reject|cancel|denied/i.test(e?.message ?? '') ? 'You cancelled in the wallet' : e?.message ?? 'Wallet error'}. If you are unsure whether it went through, check your wallet history before trying again.`; go.disabled = !pending; }
});
dialog.addEventListener('close', () => { pending = null; });
$('trade-close').addEventListener('click', () => dialog.close());
// A quote goes stale after 45 seconds. Say so and lock the button, so the refusal is not a surprise after the click.
setInterval(() => { if (dialog.open && pending && Date.now() - pending.at > 45_000 && !go.disabled) { go.disabled = true; status.textContent = 'That quote is now stale. Close and reopen to get a fresh one.'; } }, 2000);

// A sale is only celebrated (or comforted) once the network confirms it. An unknown outcome gets neither.
async function feelWhenConfirmed(signature, trade) {
  for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 2500)); try { const r = await fetch(`/api/status?signature=${encodeURIComponent(signature)}`), j = await r.json(); if (j.outcome === 'confirmed') { tradeClosed(trade); return; } if (j.outcome === 'failed') return; } catch {} }
}

// ---------- comfort bar: what is at risk right now, and one button out ----------
let risk = { mode: 'paper', positions: 0, solAtRisk: 0, running: false, busy: false }, armed = 0;
$('comfort-term').replaceWith(label('span', 'At risk'));
function renderComfort() {
  const manual = owner ? loadPositions().filter((p) => p.owner === owner && !p.closedAt).length : 0, practice = risk.mode !== 'live';
  const auto = risk.positions ? `${risk.solAtRisk.toFixed(4)} ${practice ? 'pretend ' : ''}SOL in ${risk.positions} ${practice ? 'practice ' : ''}position${risk.positions === 1 ? '' : 's'}` : '';
  const mine = manual ? `${manual} position${manual === 1 ? '' : 's'} you opened with your wallet (sell from My positions)` : '';
  const lost = risk.lost ? `${risk.lost} position${risk.lost === 1 ? '' : 's'} that cannot be sold (pool emptied)` : '';
  $('comfort-text').textContent = auto || mine || lost ? [auto, mine, lost].filter(Boolean).join(' · ') : 'nothing right now.';
  const btn = $('get-me-out'); btn.disabled = !risk.positions || risk.busy; if (!armed) btn.textContent = 'Get me out';
}
on('risk', (r) => { risk = r; renderComfort(); });
$('get-me-out').addEventListener('click', () => {
  const btn = $('get-me-out');
  // Practice money goes in one tap. Real money asks for a second tap, so a slip of the thumb cannot sell everything.
  if (risk.mode === 'live' && Date.now() - armed > 5000) { armed = Date.now(); btn.textContent = 'Tap again to sell everything'; setTimeout(() => { armed = 0; renderComfort(); }, 5000); return; }
  armed = 0; emit('get-me-out');
});

// ---------- the one-minute welcome ----------
const welcome = $('welcome'); let step = 0;
function drawWelcome() { welcome.querySelectorAll('.welcome-step').forEach((s) => { s.hidden = Number(s.dataset.step) !== step; }); welcome.querySelectorAll('.welcome-dots span').forEach((d, i) => d.classList.toggle('on', i === step)); $('welcome-next').textContent = step === 2 ? 'Start practicing' : 'Next'; }
function closeWelcome(practice) { joyPrefs.setWelcomed(); welcome.close(); if (!practice) return; $('scan-title').scrollIntoView({ block: 'start' }); const first = document.querySelector('#results .btn.practice'); if (first) { first.classList.add('spotlight'); first.focus({ preventScroll: true }); setTimeout(() => first.classList.remove('spotlight'), 8000); } }
$('welcome-next').addEventListener('click', () => { if (step < 2) { step++; drawWelcome(); } else closeWelcome(true); });
$('welcome-skip').addEventListener('click', () => closeWelcome(false));
$('welcome-open').addEventListener('click', () => { step = 0; drawWelcome(); welcome.showModal(); });
welcome.addEventListener('cancel', () => joyPrefs.setWelcomed());
if (!joyPrefs.welcomed) { drawWelcome(); welcome.showModal(); }

on('rules-changed', () => void scan());
renderWallet(); renderComfort(); void reconnect(); void scan(); setInterval(() => { if (!dialog.open && document.visibilityState === 'visible' && scanTab === 'live') void scan(); }, 120_000);
