// The tools traders expect, the Warrior way: look up any coin, a watchlist, your own orders, slices, the strategy dial,
// portfolio and history, the deeper safety check, alerts and wallet following.
// Nothing here trades by itself. Orders, slices and copied buys are handed to the trader in /auto.js, which applies every
// cost and risk check. They run only while a Warrior tab is open.
import { card, session } from '/app.js';
import { trader } from '/auto.js';
import { rules } from '/rules.js';
import { notice } from '/joy.js';
import { on, emit } from '/bus.js';
import { validateOrder, orderDue, validateExits, ownExitDue, autoExitDue, confirm, poolEmptied, slicePlan, sliceDue, sliceDone, ORDER_LIMITS } from '/vendor/lib/orders.js';
import { summarize, tradesCsv } from '/vendor/lib/portfolio.js';
import { newBuys } from '/vendor/lib/follow.js';
import { fact, heading } from '/knobs.js';

const KEY = 'warrior.tools.v1', MANUAL_KEY = 'warrior.positions.v1', TICK_MS = 30_000, ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const btn = (text, cls, fn) => { const b = el('button', `btn ${cls ?? ''}`, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const usd = (n) => !Number.isFinite(n) ? '—' : n >= 1 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${n.toPrecision(4)}`;
const sol = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)} SOL`;
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const modeName = (m) => m === 'live' ? 'the trading wallet (real funds)' : 'practice money';
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60_000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const until = (t) => { const m = Math.max(0, Math.round((t - Date.now()) / 60_000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
async function api(path) { const r = await fetch(path); let j = null; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`); return j; }

// ---------- stored state (this browser only) ----------
let st = { watch: [], orders: [], plans: [], follows: [], alerts: false };
try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (saved && typeof saved === 'object') st = { ...st, ...saved, watch: Array.isArray(saved.watch) ? saved.watch : [], orders: Array.isArray(saved.orders) ? saved.orders : [], plans: Array.isArray(saved.plans) ? saved.plans : [], follows: Array.isArray(saved.follows) ? saved.follows : [] }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...st, orders: st.orders.slice(-40), plans: st.plans.slice(-20) })); } catch {} };
// Orders, watchlist and plans changed on another device: take them.
on('synced', (keys) => { if (!keys.includes(KEY) && !keys.includes(MANUAL_KEY)) return; try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s && typeof s === 'object') st = { ...st, ...s, watch: Array.isArray(s.watch) ? s.watch : [], orders: Array.isArray(s.orders) ? s.orders : [], plans: Array.isArray(s.plans) ? s.plans : [], follows: Array.isArray(s.follows) ? s.follows : [] }; } catch {} renderLists(); renderPortfolio(); });
let prices = {}, pricesAt = 0, nextId = Date.now();
const coinOf = (t) => ({ mint: t.mint, symbol: String(t.symbol || 'Unknown').slice(0, 16), pool: t.pool, pump: !!t.pump, dex: t.dex ?? null, createdAt: t.createdAt ?? null, liquidityUsd: t.liquidityUsd ?? null });
const tokenFor = (coin) => ({ ...coin, priceUsd: prices[coin.mint] ?? null, analysis: {} });

// ---------- alerts ----------
function alertUser(headline, message = '', detail = '') {
  notice({ headline, message, detail });
  if (!st.alerts || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  systemNote(`Warrior: ${headline}`, [message, detail].filter(Boolean).join(' · '));
}
/** A system notification. Phones only allow these through the installed app's helper, so that is tried first. */
function systemNote(title, body) {
  const direct = () => { try { new Notification(title, { body }); } catch { emit('problem', 'This browser blocked a notification. Alerts still show on the page.'); } };
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png' })).catch(direct); else direct();
}
function drawAlerts() {
  const b = $('alerts-toggle'), supported = typeof Notification !== 'undefined', blocked = supported && Notification.permission === 'denied', onNow = st.alerts && supported && Notification.permission === 'granted';
  b.textContent = onNow ? '🔔 Alerts on' : '🔕 Alerts off'; b.setAttribute('aria-pressed', String(onNow)); b.disabled = !supported || blocked;
  $('alerts-note').textContent = !supported ? 'This browser does not support notifications. Alerts still show on this page.' : blocked ? 'Notifications are blocked for this site in your browser settings. Alerts still show on this page.' : onNow ? 'You get a notification when an order fills, a stop or target is hit, a watched coin turns into an ENTER, or a followed wallet buys.' : 'Alerts always show on this page. Turn this on to also get a notification when the tab is in the background.';
}
$('alerts-toggle').addEventListener('click', async () => {
  if (st.alerts && Notification.permission === 'granted') { st.alerts = false; save(); drawAlerts(); return; }
  let permission = Notification.permission; if (permission === 'default') { try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; } }
  st.alerts = permission === 'granted'; save(); drawAlerts(); if (st.alerts) alertUser('Alerts are on', 'This is what an alert looks like.');
});
on('trade', (t) => {
  if (t.type === 'buy' && t.why) alertUser(`Bought ${t.symbol}`, `${t.sol.toFixed(4)} SOL · ${t.why}`, t.mode === 'live' ? 'trading wallet' : 'practice');
  // A sale already gets its own message on the page; this adds the background notification.
  if (t.type === 'sell' && st.alerts && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') systemNote(`Warrior: sold ${t.symbol} (${t.reason})`, `${sol(t.pnlSol)} · ${t.pnlPct.toFixed(1)}%${t.mode === 'live' ? '' : ' · practice'}`);
});

// ---------- look up any coin ----------
let lookupRequest = 0;
async function lookup(q, { scroll = false } = {}) {
  const query = String(q ?? '').trim(), mine = ++lookupRequest, status = $('lookup-status'), box = $('lookup-result');
  if (query.length < 2) { status.textContent = 'Type a coin name, a ticker, or paste a coin address.'; return null; }
  status.textContent = ADDRESS.test(query) ? 'Reading the coin and checking it…' : `Searching for “${query}”…`; $('lookup-go').disabled = true; if (scroll) $('lookup-title').scrollIntoView({ block: 'start' });
  try {
    const j = await api(`/api/coin?what=lookup&q=${encodeURIComponent(query)}&${rules.query}`); if (mine !== lookupRequest) return null;
    if (j.matches) {
      box.replaceChildren();
      if (!j.matches.length) { status.textContent = `Nothing on Solana matches “${query}”. Try the coin's address.`; return null; }
      status.textContent = `${j.matches.length} coin${j.matches.length === 1 ? '' : 's'} match, busiest first. Many coins share a name: check the address before you trust one.`;
      const list = el('ul', 'rows');
      for (const m of j.matches) { const li = el('li', 'row-item'), money = (n) => Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : 'unknown', text = el('span', '', `${m.symbol} · ${usd(m.priceUsd)} · traded today ${money(m.volume24hUsd)} · pool ${money(m.liquidityUsd)} · `); text.append(el('code', '', short(m.mint))); li.append(text, btn("Warrior's verdict", 'small', () => { $('lookup-q').value = m.mint; void lookup(m.mint); })); list.append(li); }
      box.append(list); return null;
    }
    const t = j.token; status.textContent = `${t.symbol}: Warrior says ${t.analysis.decision === 'enter' && t.screen.ok ? 'ENTER' : 'WAIT'} under your ${rules.PRESETS[rules.choice.preset].label} rules.`;
    box.replaceChildren(coinView(t)); return t;
  } catch (e) { if (mine === lookupRequest) { status.textContent = `${e.message}`; box.replaceChildren(); } return null; }
  finally { if (mine === lookupRequest) $('lookup-go').disabled = false; }
}
/** A coin card with the safety screen's answer on top when the coin fails it. */
function coinView(t) {
  const wrap = el('div', 'coin-view');
  if (t.screen && !t.screen.ok) { const warn = el('div', 'warn'); warn.append(el('b', '', "This coin fails Warrior's safety screen. "), el('span', '', `${t.screen.reasons.join('. ')}. Auto-trading would not buy it.`)); wrap.append(warn); }
  wrap.append(card(t)); return wrap;
}
$('lookup-go').addEventListener('click', () => void lookup($('lookup-q').value));
$('lookup-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup($('lookup-q').value); } });

// ---------- trending now ----------
let trendWindow = '1h', trendRequest = 0, trendAll = false, trendData = null;
const money = (n) => !Number.isFinite(n) ? '?' : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const age = (t) => { if (!Number.isFinite(t)) return 'age unknown'; const h = (Date.now() - t) / 3_600_000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min old` : h < 48 ? `${h.toFixed(0)} h old` : `${Math.round(h / 24)} days old`; };
async function loadTrending() {
  const mine = ++trendRequest, status = $('trend-status'), box = $('trend-list');
  for (const b of document.querySelectorAll('.trend-window')) b.setAttribute('aria-pressed', String(b.dataset.window === trendWindow));
  try {
    const j = await api(`/api/coin?what=trending&window=${trendWindow}&${rules.query}`); if (mine !== trendRequest) return;
    trendData = j; drawTrending();
  } catch (e) { if (mine === trendRequest) { status.textContent = `${e.message}`; emit('problem', `The trending list could not be read (${e.message}).`); } }
}
/** Draw the list: the hottest eight first, the rest behind one button, so the page stays short on a phone. */
function drawTrending() {
  const j = trendData, status = $('trend-status'), box = $('trend-list'); if (!j) return;
  {
    const n = j.coins.length, preset = rules.PRESETS[rules.choice.preset].label;
    status.textContent = !n ? 'Nothing is trending in the data right now.' : `${n} coins trending. ${j.passing === n ? `All of them pass Warrior's safety screen under your ${preset} rules` : `${j.passing} pass Warrior's safety screen under your ${preset} rules; the rest say why not`}. The token itself is checked when you ask for the verdict. Updated ${new Date(j.at).toLocaleTimeString()}.`;
    box.replaceChildren();
    for (const c of trendAll ? j.coins : j.coins.slice(0, 8)) {
      const row = el('div', 'row-item trend'), text = el('span', ''), pct = c.changePct;
      text.append(el('b', '', `${c.rank}. ${c.symbol}`), ' ', el('span', pct > 0 ? 'up' : pct < 0 ? 'down' : '', Number.isFinite(pct) ? `${pct > 0 ? '+' : ''}${Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(1)}%` : '—'), ` · ${usd(c.priceUsd)} · worth ${money(c.marketValueUsd)} · pool ${money(c.liquidityUsd)} · ${age(c.createdAt)}${c.pump ? ' · pump.fun' : ''} · `, el('span', `verdict ${c.screen.ok ? 'enter' : 'exit'}`, c.screen.ok ? 'PASSES THE SAFETY SCREEN' : `FAILS: ${c.screen.reasons.join(', ').toUpperCase()}`));
      row.append(text, btn("Warrior's verdict", 'small', () => { $('lookup-q').value = c.mint; void lookup(c.mint, { scroll: true }); })); box.append(row);
    }
    if (j.coins.length > 8) box.append(btn(trendAll ? 'Show only the top 8' : `Show all ${j.coins.length}`, 'ghost', () => { trendAll = !trendAll; drawTrending(); }));
  }
}
for (const b of document.querySelectorAll('.trend-window')) b.addEventListener('click', () => { trendWindow = b.dataset.window; $('trend-status').textContent = 'Loading what is trending…'; void loadTrending(); });
on('rules-changed', () => void loadTrending());
void loadTrending(); setInterval(() => { if (document.visibilityState === 'visible') void loadTrending(); }, 120_000);

// ---------- the coin dialog: safety check, watch, buy-below order, buy in slices ----------
const dialog = $('coin'), body = $('coin-body'); let fid = 0;
$('coin-close').addEventListener('click', () => dialog.close());
/**
 * A percent box with the price it means printed under it, updated as you type. `dir` is +1 for "above" and -1 for "below";
 * `base` is the price the percent is measured from. Returns the wrapper, the input, and a function giving the price (or null if empty).
 */
function pctField(text, base, dir, attrs, flip = null) {
  const [wrap, input] = field(text, { step: 'any', min: '0', ...attrs }), hint = el('p', 'muted pct-price'); wrap.append(hint);
  // `flip` lets one box work on either side: { labels: [below, above], buttons: [toBelow, toAbove] }
  if (flip) { const label = wrap.querySelector('label'), sw = el('button', 'btn small ghost pct-flip'); sw.type = 'button'; const draw = () => { label.textContent = flip.labels[dir > 0 ? 1 : 0]; sw.textContent = flip.buttons[dir > 0 ? 0 : 1]; input.max = dir > 0 ? '' : '99'; }; sw.addEventListener('click', () => { dir = -dir; draw(); show(); }); draw(); wrap.append(sw); }
  const priceOf = () => { const v = input.value.trim() === '' ? NaN : Number(input.value); return Number.isFinite(v) && v >= 0 && Number.isFinite(base) && base > 0 ? base * (1 + dir * v / 100) : null; };
  const show = () => { const pr = priceOf(); hint.textContent = input.value.trim() === '' ? 'Empty: none' : pr === null || pr <= 0 ? 'Not a usable price' : `= ${usd(pr)}`; };
  input.addEventListener('input', show); show(); return [wrap, input, priceOf];
}
const pctFrom = (price, base, dir) => Number.isFinite(price) && Number.isFinite(base) && base > 0 ? String(Number((dir * (price / base - 1) * 100).toFixed(2))) : '';
function field(text, attrs) { const wrap = el('div', 'fieldwrap'), l = el('label', '', text), i = el('input'); Object.assign(i, { type: 'number', inputMode: 'decimal', ...attrs }); i.id = `tool-f${++fid}`; l.htmlFor = i.id; wrap.append(l, i); return [wrap, i]; }
// The last amount you chose for a buy is remembered on this device, so you do not retype it every time.
const AMOUNT_KEY = 'warrior.amount.v1';
const lastAmount = () => { try { const v = Number(localStorage.getItem(AMOUNT_KEY)); return Number.isFinite(v) && v >= ORDER_LIMITS.minSol && v <= ORDER_LIMITS.maxSol ? String(v) : '0.05'; } catch { return '0.05'; } };
const keepAmount = (v) => { try { if (Number.isFinite(v) && v >= ORDER_LIMITS.minSol && v <= ORDER_LIMITS.maxSol) localStorage.setItem(AMOUNT_KEY, String(v)); } catch {} };
/** One line saying how much there is to spend, in the current mode. */
const haveLine = () => { const b = trader.balance; return el('p', 'muted have', Number.isFinite(b) ? `You have ${b.toFixed(4)} SOL${trader.mode === 'live' ? ' in the trading wallet' : ' of practice money'}.` : 'Balance not known yet.'); };
/** A Max button: fills in the most this buy could spend under the rules, and says so when there is no room. */
function maxButton(input, mint, note) {
  return btn('Max', 'small', () => { const m = trader.maxBuy(mint), top = m === null ? null : Math.min(m, ORDER_LIMITS.maxSol);
    if (top === null) { note.textContent = 'Balance not known yet.'; return; }
    if (top < ORDER_LIMITS.minSol) { note.textContent = `No room for another buy of this coin: your rules allow ${top.toFixed(2)} SOL more, and the smallest buy is ${ORDER_LIMITS.minSol}.`; return; }
    input.value = String(top); note.textContent = `Max is ${top} SOL: your balance less the fee reserve, within the most your rules allow in one coin.`; });
}
/** A row of short buttons at the top of a long box, one per section, so nothing needs hunting for. It stays in reach while the box scrolls. */
const SHORT = { 'Buy now with the Warrior wallet': 'Buy now', 'Buy if it gets cheaper': 'Buy lower', 'Sell if it gets dearer': 'Sell higher', 'Add funds to this position': 'Add funds', 'Sell part of it now': 'Sell part', 'My stop and target': 'Stop and target', 'Take profit in steps': 'Profit steps', 'Safety check': 'Safety', 'Watch it': 'Watch', 'Buy in slices': 'Buy in slices', 'Sell in slices': 'Sell in slices' };
function chipNav() {
  body.querySelector(':scope > .chips')?.remove(); const secs = [...body.querySelectorAll(':scope > section.tool')]; if (secs.length < 3) return;
  const nav = el('nav', 'chips'); nav.setAttribute('aria-label', 'Jump to a section');
  for (const s of secs) { const h = s.querySelector('h3'); if (!h) continue; const full = h.textContent.trim(), words = SHORT[full] ?? full, b = btn(words.length > 22 ? `${words.slice(0, 21)}…` : words, 'small', () => s.scrollIntoView({ block: 'start', behavior: 'smooth' })); nav.append(b); }
  body.prepend(nav);
}
function section(title, hint) { const s = el('section', 'tool'); s.append(el('h3', '', title)); if (hint) s.append(el('p', 'muted', hint)); return s; }
/** The line under every order form saying whose money it uses, with a tick box when that money is real. */
function consent(parent) {
  const live = trader.mode === 'live', line = el('p', live ? 'warn' : 'muted', live ? 'This will use REAL funds from your trading wallet, automatically, when its moment comes.' : 'This uses your practice money. Nothing real is spent.');
  parent.append(line); if (!live) return () => true;
  const row = el('label', 'toggle'), box = el('input'); box.type = 'checkbox'; row.append(box, ' I understand it trades real funds without asking again.'); parent.append(row);
  return () => trader.liveReady && box.checked;
}
const RUNS = 'It only works while a Warrior tab is open on this device.';

async function safetySection(t) {
  const s = section('Safety check', 'What Warrior can see about this coin right now. Unknown means unknown, not fine.'), list = el('ul', 'safety'), status = el('p', 'muted', 'Checking holders, creator, launch and depth…');
  s.append(status, list);
  api(`/api/coin?what=safety&${new URLSearchParams({ mint: t.mint, ...(Number.isFinite(t.createdAt) ? { created: String(t.createdAt) } : {}), ...(Number.isFinite(t.liquidityUsd) ? { liq: String(t.liquidityUsd) } : {}), pump: t.pump ? '1' : '0', ...(t.dex ? { dex: String(t.dex) } : {}) })}`).then((r) => {
    const words = { good: 'looks fine', watch: 'worth a look', bad: 'a warning', unknown: 'unknown' };
    status.textContent = `${r.counts.bad} warning${r.counts.bad === 1 ? '' : 's'}, ${r.counts.watch} worth a look, ${r.counts.unknown} unknown, ${r.counts.good} fine. ${r.source}`;
    for (const item of r.items) { const li = el('li', `safety-item ${item.level}`), head = el('div', 'safety-head'); head.append(el('span', 'safety-label', item.label), el('span', 'safety-value', item.value), el('span', `safety-level ${item.level}`, words[item.level])); li.append(head); if (item.note) li.append(el('p', 'muted', item.note)); list.append(li); }
  }).catch((e) => { status.textContent = `The safety check is unavailable right now (${e.message}). Treat the coin as unchecked.`; });
  // The launch check: the same one Warrior runs before every automatic buy, shown here so you can see it before you buy yourself.
  const launch = el('ul', 'safety'), lStatus = el('p', 'muted', 'Checking how it was launched…'); s.append(el('h4', 'safety-sub', 'Launch check'), lStatus, launch);
  api(`/api/coin?what=audit&mint=${t.mint}&level=${rules.choice.preset}`).then((a) => {
    const item = (level, label, value, note) => { const li = el('li', `safety-item ${level}`), head = el('div', 'safety-head'); head.append(el('span', 'safety-label', label), el('span', 'safety-value', value), el('span', `safety-level ${level}`, { good: 'looks fine', bad: 'a warning', unknown: 'unknown' }[level])); li.append(head); if (note) li.append(el('p', 'muted', note)); launch.append(li); };
    if (!a.judged) { lStatus.textContent = a.note || 'The launch check does not apply to this coin.'; return; }
    lStatus.textContent = a.ok ? 'Nothing in how it was launched would stop Warrior buying it. That is not the same as safe.' : `Warrior would not buy this automatically: ${a.reasons.length} reason${a.reasons.length === 1 ? '' : 's'}.`;
    for (const why of a.reasons) item('bad', 'Refused', why);
    const n = (v) => Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '?';
    item(a.ok ? 'good' : 'unknown', 'Crowd', `${n(a.traders)} wallets traded it, ${n(a.holders)} hold it now`);
    if (a.curveSecs !== null && a.curveSecs !== undefined) item(a.curveSecs < 60 ? (a.ageMin < 120 ? 'bad' : 'unknown') : 'good', 'Launch', a.curveSecs < 60 ? `Left the launch curve the second it was created${a.ageMin < 120 ? '' : '. It has lasted more than two hours since, so this no longer counts against it'}` : `Spent ${a.curveSecs >= 120 ? `${Math.round(a.curveSecs / 60)} minutes` : `${Math.round(a.curveSecs)} seconds`} on the launch curve`);
    if (a.clones) item(a.clones.leader === 'no' ? 'bad' : a.clones.leader === 'unclear' ? 'unknown' : 'good', 'Its name', !a.clones.rivals ? 'No other coin with a real crowd shares it' : a.clones.leader === 'yes' ? `${a.clones.rivals} others share it; this is clearly the biggest` : a.clones.leader === 'no' ? `${a.clones.rivals} others share it and a bigger one exists` : `${a.clones.rivals} others share it; none clearly leads`);
    if (a.creator?.text) item(a.creator.kind === 'serial' ? 'bad' : a.creator.kind === 'record' ? 'good' : 'unknown', 'Creator', a.creator.text);
  }).catch(() => { lStatus.textContent = 'The launch check is unavailable right now. Warrior would not buy it automatically until it can be checked.'; });
  return s;
}
function watchSection(t) {
  const s = section('Watch it', 'Warrior re-checks watched coins every two minutes and tells you when one turns into an ENTER.'), b = btn('', '', () => { toggleWatch(t); draw(); });
  const draw = () => { const onList = st.watch.some((w) => w.mint === t.mint); b.textContent = onList ? '★ Watching — tap to stop' : '☆ Add to my watchlist'; b.setAttribute('aria-pressed', String(onList)); };
  draw(); s.append(b); return s;
}
function buyBelowSection(t) {
  const now = Number.isFinite(t.priceUsd) ? t.priceUsd : prices[t.mint] ?? null, s = section('Buy if it gets cheaper', `Say how far below today's price (${usd(now)}) you want to buy. When the coin falls to it, Warrior buys the amount you chose, if the coin still passes the cost checks.`);
  const [w1, , buyAt] = pctField('Buy when it is this much cheaper (%)', now, -1, { max: '99', value: now ? '5' : '' }), [w2, amount] = field('Amount (SOL)', { step: '0.01', min: String(ORDER_LIMITS.minSol), max: String(ORDER_LIMITS.maxSol), value: '0.05' });
  const row = el('div', 'fields'); w2.append(el('p', 'muted pct-price')); row.append(w1, w2); s.append(row); const agreed = consent(s), status = el('p', 'muted', RUNS); status.setAttribute('role', 'status');
  s.append(btn('Place buy-below order', 'neon', () => {
    if (!agreed()) { status.textContent = trader.liveReady ? 'Tick the box to confirm this uses real funds.' : 'Set up and back up the trading wallet first, or switch to practice mode.'; return; }
    const v = validateOrder({ kind: 'buy-below', mint: t.mint, price: buyAt() ?? NaN, sol: Number(amount.value) }, { currentPrice: now });
    if (!v.ok) { status.textContent = `${v.reasons.join('. ')}.`; return; }
    if (st.orders.filter((o) => o.status === 'waiting').length >= ORDER_LIMITS.maxActive) { status.textContent = `You can have ${ORDER_LIMITS.maxActive} waiting orders at once. Cancel one first.`; return; }
    st.orders.push({ id: ++nextId, ...v.order, symbol: coinOf(t).symbol, coin: coinOf(t), mode: trader.mode }); save(); renderLists();
    status.textContent = `Order placed: buy ${v.order.sol} SOL of ${t.symbol} at or below ${usd(v.order.price)}, with ${modeName(trader.mode)}. ${RUNS}`; trader.note(`Order placed: buy ${v.order.sol} SOL of ${t.symbol} at or below ${usd(v.order.price)}.`); startEngine();
  }), status);
  return s;
}
function buySlicesSection(t) {
  const s = section('Buy in slices', 'Split one buy into equal parts over time, so one bad moment does not set your whole price.');
  const [w1, total] = field('Total (SOL)', { step: '0.01', min: '0.04', value: '0.12' }), [w2, count] = field('Slices', { step: '1', min: String(ORDER_LIMITS.minSlices), max: String(ORDER_LIMITS.maxSlices), value: '3' }), [w3, every] = field('Minutes apart', { step: '1', min: String(ORDER_LIMITS.minEveryMinutes), max: String(ORDER_LIMITS.maxEveryMinutes), value: '10' });
  const row = el('div', 'fields'); row.append(w1, w2, w3); s.append(row); const agreed = consent(s), status = el('p', 'muted', RUNS); status.setAttribute('role', 'status');
  s.append(btn('Start buying in slices', 'neon', () => {
    if (!agreed()) { status.textContent = trader.liveReady ? 'Tick the box to confirm this uses real funds.' : 'Set up and back up the trading wallet first, or switch to practice mode.'; return; }
    const v = slicePlan({ side: 'buy', mint: t.mint, totalSol: Number(total.value), slices: Number(count.value), everyMinutes: Number(every.value) });
    if (!v.ok) { status.textContent = `${v.reasons.join('. ')}.`; return; }
    if (st.plans.some((p) => p.status === 'running' && p.mint === t.mint)) { status.textContent = 'A slice plan for this coin is already running. Cancel it first.'; return; }
    st.plans.push({ id: ++nextId, ...v.plan, symbol: coinOf(t).symbol, coin: coinOf(t), mode: trader.mode }); save(); renderLists();
    status.textContent = `Started: ${v.plan.slices} buys of ${v.plan.solEach} SOL, ${v.plan.everyMinutes} minutes apart. The first goes within half a minute. ${RUNS}`; trader.note(`Slice plan started: ${v.plan.slices} × ${v.plan.solEach} SOL of ${t.symbol}.`); startEngine(); void tick();
  }), status);
  return s;
}
/** Buy a coin at once with the Warrior wallet: the trading wallet in this browser when Warrior is live, practice money otherwise. */
function buyNowSection(t) {
  const live = trader.mode === 'live', holding = () => trader.positions().some((p) => p.mint === t.mint && p.mode === trader.mode);
  const s = section('Buy now with the Warrior wallet', live ? `Buys ${t.symbol} at once from the trading wallet in this browser. No Phantom approval is asked. The token check, the launch check, the cost limits and your rules still apply, and Warrior then looks after the position with a stop and a target.` : `Warrior is in practice mode, so this buys ${t.symbol} with practice money. For real funds, set Mode to Live under Auto-trade.`);
  s.id = 'buy-now';
  const [w, amount] = field('Amount (SOL)', { step: '0.01', min: String(ORDER_LIMITS.minSol), max: String(ORDER_LIMITS.maxSol), value: lastAmount() }), quick = el('div', 'quick');
  for (const v of [0.05, 0.1, 0.25, 0.5]) quick.append(btn(`${v} SOL`, 'small', () => { amount.value = String(v); }));
  const status = el('p', 'muted'); status.setAttribute('role', 'status'); quick.append(maxButton(amount, t.mint, status));
  s.append(haveLine(), w, quick); const agreed = consent(s);
  s.append(btn(live ? `Buy ${t.symbol} with the trading wallet` : `Practice buy ${t.symbol}`, 'neon', async () => {
    const sol = Number(amount.value); if (!Number.isFinite(sol) || sol < ORDER_LIMITS.minSol || sol > ORDER_LIMITS.maxSol) { status.textContent = `Amount must be ${ORDER_LIMITS.minSol} to ${ORDER_LIMITS.maxSol} SOL.`; return; }
    if (trader.mode !== (live ? 'live' : 'paper')) { status.textContent = 'The mode changed while this was open. Close this and open it again.'; return; }
    if (!agreed()) { status.textContent = trader.liveReady ? 'Tick the box to confirm this uses real funds.' : 'Set up, back up and unlock the trading wallet first, or switch to practice mode.'; return; }
    keepAmount(sol); status.textContent = 'Buying…'; const r = await trader.buy({ ...tokenFor(coinOf(t)), priceUsd: prices[t.mint] ?? t.priceUsd ?? null }, { sol, add: holding(), why: 'your own pick' }), p = trader.positions().find((x) => x.mint === t.mint && x.mode === trader.mode);
    status.textContent = r.ok && p ? `Bought. ${p.solIn.toFixed(4)} SOL is in ${t.symbol}${live ? '' : ' (practice)'}, stop ${usd(p.stop)}, target ${usd(p.target)}. It is on your positions list under Auto-trade.` : `Not bought: ${String(r.reason || 'the buy did not go through').replace(/\.+$/, '')}. Nothing was spent.`;
  }), status);
  return s;
}
async function openCoin(t) {
  if (Number.isFinite(t.priceUsd)) prices[t.mint] = t.priceUsd;
  $('coin-title').textContent = `${t.symbol} · safety, watch and orders`; const buyNow = buyNowSection(t); const safety = await safetySection(t);
  // Asked to trade: the buy comes first and the safety check sits right under it. Otherwise safety leads.
  body.replaceChildren(...(t.focus === 'buy' ? [buyNow, safety] : [safety, buyNow]), watchSection(t), buyBelowSection(t), buySlicesSection(t));
  chipNav(); if (!dialog.open) dialog.showModal(); body.scrollTop = 0;
}
// ---------- the position dialog: my stop and target, sell-above order, sell in slices ----------
function openPosition(p) {
  const now = prices[p.mint] ?? p.last ?? null, base = Number.isFinite(p.entry) && p.entry > 0 ? p.entry : now; $('coin-title').textContent = `${p.symbol} · add funds, sell part, stops and orders`; body.replaceChildren();
  const exits = section('My stop and target', `Warrior already has a stop at ${usd(p.stop)} and a target at ${usd(p.target)}. Add your own as a percent of what you paid (${usd(base)}), and whichever is reached first sells. Leave a box empty for none. Price now: ${usd(now)}.`);
  const stopUp = p.ownStop > base, [w1, stopIn, stopAt] = pctField('My stop (% below what I paid)', base, stopUp ? 1 : -1, { max: '99', value: p.ownStop ? pctFrom(p.ownStop, base, stopUp ? 1 : -1) : '' }, { labels: ['My stop (% below what I paid)', 'My stop (% above what I paid)'], buttons: ['Put my stop below what I paid', 'Put my stop above what I paid, to lock in profit'] }), [w2, , targetAt] = pctField('My target (% above what I paid)', base, 1, { value: p.ownTarget ? pctFrom(p.ownTarget, base, 1) : '' }), row = el('div', 'fields'); row.append(w1, w2);
  const s1 = el('p', 'muted', 'Your stop and target are checked every 30 seconds while a Warrior tab is open.'); s1.setAttribute('role', 'status');
  const flipBtn = w1.querySelector('.pct-flip'), even = btn('Set my stop at what I paid (break-even)', 'small', () => { stopIn.value = '0'; stopIn.dispatchEvent(new Event('input')); s1.textContent = 'Stop set to the price you paid. Press Save to keep it. It only works once the price is above what you paid.'; });
  exits.append(row, flipBtn, even, btn('Save my stop and target', 'neon', () => {
    const sv = stopAt(), tv = targetAt(), v = validateExits({ entry: p.entry, stop: sv, target: tv }, now);
    if (!v.ok) { s1.textContent = `${v.reasons.join('. ')}.`; return; }
    s1.textContent = trader.setExits(p.mint, { stop: sv, target: tv }) ? `Saved. ${sv ? `Sells if the price falls to ${usd(sv)}.` : 'No stop of your own.'} ${tv ? `Sells if it rises to ${usd(tv)}.` : 'No target of your own.'}` : 'That position is no longer open.'; startEngine();
  }), s1);
  const above = section('Sell if it gets dearer', `Say how far above what you paid (${usd(base)}) and how much of the position to sell when it gets there. It has to be above the price now, ${usd(now)}.`);
  const [w3, , sellAt] = pctField('Sell at (% above what I paid)', base, 1, { value: now && base ? String(Math.max(1, Math.ceil((now * 1.1 / base - 1) * 100))) : '' }), [w4, share] = field('How much (%)', { step: '5', min: '5', max: '100', value: '50' }), row2 = el('div', 'fields'); w4.append(el('p', 'muted pct-price')); row2.append(w3, w4); above.append(row2);
  const s2 = el('p', 'muted', RUNS); s2.setAttribute('role', 'status');
  above.append(btn('Place sell-above order', 'neon', () => {
    const v = validateOrder({ kind: 'sell-above', mint: p.mint, price: sellAt() ?? NaN, fraction: Number(share.value) / 100 }, { currentPrice: now });
    if (!v.ok) { s2.textContent = `${v.reasons.join('. ')}.`; return; }
    st.orders.push({ id: ++nextId, ...v.order, symbol: p.symbol, coin: coinOf(p), mode: p.mode }); save(); renderLists();
    s2.textContent = `Order placed: sell ${Math.round(v.order.fraction * 100)}% of ${p.symbol} at or above ${usd(v.order.price)}. ${RUNS}`; trader.note(`Order placed: sell ${Math.round(v.order.fraction * 100)}% of ${p.symbol} at or above ${usd(v.order.price)}.`); startEngine();
  }), s2);
  const slices = section('Sell in slices', 'Sell the whole position in equal parts over time.');
  const [w5, count] = field('Slices', { step: '1', min: String(ORDER_LIMITS.minSlices), max: String(ORDER_LIMITS.maxSlices), value: '2' }), [w6, every] = field('Minutes apart', { step: '1', min: String(ORDER_LIMITS.minEveryMinutes), max: String(ORDER_LIMITS.maxEveryMinutes), value: '10' }), row3 = el('div', 'fields'); row3.append(w5, w6); slices.append(row3);
  const s3 = el('p', 'muted', RUNS); s3.setAttribute('role', 'status');
  slices.append(btn('Start selling in slices', 'neon', () => {
    const v = slicePlan({ side: 'sell', mint: p.mint, slices: Number(count.value), everyMinutes: Number(every.value) });
    if (!v.ok) { s3.textContent = `${v.reasons.join('. ')}.`; return; }
    if (st.plans.some((x) => x.status === 'running' && x.mint === p.mint)) { s3.textContent = 'A slice plan for this coin is already running. Cancel it first.'; return; }
    st.plans.push({ id: ++nextId, ...v.plan, symbol: p.symbol, coin: coinOf(p), mode: p.mode }); save(); renderLists();
    s3.textContent = `Started: ${v.plan.slices} sells, ${v.plan.everyMinutes} minutes apart. The first goes within half a minute. ${RUNS}`; trader.note(`Slice plan started: sell ${p.symbol} in ${v.plan.slices} parts.`); startEngine(); void tick();
  }), s3);

  // ---- add funds, sell part, take out what I put in, take profit in steps ----
  const cur = () => trader.positions().find((x) => x.mint === p.mint && x.mode === p.mode) ?? null, here = () => p.mode === trader.mode, wrongMode = `This position was opened with ${modeName(p.mode)}. Switch the mode back to act on it.`;
  const say = (node, text) => { node.textContent = text; };
  const add = section('Add funds to this position', `Buy more ${p.symbol}. Your average price is worked out again from both buys. Your limits still apply: the most in one coin, the daily loss limit and the bedtime rule.`);
  const [wa, addSol] = field('Amount to add (SOL)', { step: '0.01', min: String(ORDER_LIMITS.minSol), max: String(ORDER_LIMITS.maxSol), value: lastAmount() }), quick = el('div', 'quick');
  for (const v of [0.05, 0.1, 0.25, 0.5]) quick.append(btn(`${v} SOL`, 'small', () => { addSol.value = String(v); }));
  const sA = el('p', 'muted'); sA.setAttribute('role', 'status'); quick.append(maxButton(addSol, p.mint, sA));
  add.append(haveLine(), wa, quick); const agreedAdd = consent(add);
  add.append(btn(p.mode === 'live' ? `Add to ${p.symbol} now` : `Practice: add to ${p.symbol}`, 'neon', async () => {
    const sol = Number(addSol.value); if (!here()) return say(sA, wrongMode); if (!cur()) return say(sA, 'That position is no longer open.');
    if (!Number.isFinite(sol) || sol < ORDER_LIMITS.minSol || sol > ORDER_LIMITS.maxSol) return say(sA, `Amount must be ${ORDER_LIMITS.minSol} to ${ORDER_LIMITS.maxSol} SOL.`);
    if (!agreedAdd()) return say(sA, trader.liveReady ? 'Tick the box to confirm this uses real funds.' : 'Set up and back up the trading wallet first, or switch to practice mode.');
    keepAmount(sol); say(sA, 'Buying…'); const before = cur().solIn, r = await trader.buy(coinOf(p), { sol, add: true, why: 'you added funds' }), c = cur();
    return say(sA, r.ok && c ? `Added ${(c.solIn - before).toFixed(4)} SOL. You now have ${c.solIn.toFixed(4)} SOL in ${p.symbol}, at an average of ${usd(c.entry)} a coin.` : `Not added: ${String(r.reason || 'the buy did not go through').replace(/\.+$/, '')}.`);
  }), sA);
  const part = section('Sell part of it now', 'Take some off the table and let the rest ride. Your stop, target and orders keep working on what is left.'), sP = el('p', 'muted'), rowP = el('div', 'quick'); sP.setAttribute('role', 'status');
  const sellPart = async (fraction, done) => { if (!here()) return say(sP, wrongMode); const c0 = cur(); if (!c0) return say(sP, 'That position is no longer open.'); say(sP, 'Selling…'); const r = await trader.sell(p.mint, { reason: 'manual', fraction }), c = cur(); return say(sP, r.ok ? done(c0, c) : `Not sold: ${String(r.reason || 'the sale did not go through').replace(/\.+$/, '')}.`); };
  for (const f of [25, 50, 75, 100]) rowP.append(btn(`Sell ${f}%`, f === 100 ? 'small sell' : 'small', () => sellPart(f / 100, (c0, c) => c ? `Sold ${f}%. ${c.solIn.toFixed(4)} SOL of what you put in is still riding.` : `Sold all of ${p.symbol}.`)));
  part.append(rowP, btn('Take out what I put in, let the rest ride', '', () => {
    const c = cur(); if (!c) return say(sP, 'That position is no longer open.');
    if (!Number.isFinite(c.nowSol)) return say(sP, 'Warrior has no fresh sale price for this position yet. Try again in a few seconds.');
    if (c.nowSol <= c.solIn * 1.03) return say(sP, `Only possible when the position is worth more than the ${c.solIn.toFixed(4)} SOL you put in. A sale right now would return about ${c.nowSol.toFixed(4)} SOL.`);
    const fraction = Math.min(1, c.solIn / c.nowSol * 1.01); return sellPart(fraction, () => `Sold ${Math.round(fraction * 100)}%: about the ${c.solIn.toFixed(4)} SOL you put in is back in your wallet. The rest keeps riding, and it can still fall to nothing.`);
  }), sP);
  const ladder = section('Take profit in steps', `Sells a third of what you hold today at each of three gains over what you paid (${usd(base)}). Each step has to be above the price now, ${usd(now)}.`);
  const steps = [25, 50, 100].map((v, i) => pctField(`Step ${i + 1} (% above what I paid)`, base, 1, { value: String(Math.max(v, now && base ? Math.ceil((now * (1.05 + i * 0.1) / base - 1) * 100) : v)) })), rowL = el('div', 'fields'); rowL.append(...steps.map((x) => x[0])); ladder.append(rowL);
  const sL = el('p', 'muted', RUNS); sL.setAttribute('role', 'status');
  ladder.append(btn('Place the three sell orders', 'neon', () => {
    const at = steps.map((x) => x[2]()), share = [1 / 3, 1 / 2, 1]; if (at.some((v) => v === null)) return say(sL, 'Fill in all three steps.');
    if (!(at[0] < at[1] && at[1] < at[2])) return say(sL, 'Each step must be higher than the one before.');
    const checked = at.map((price, i) => validateOrder({ kind: 'sell-above', mint: p.mint, price, fraction: share[i] }, { currentPrice: now })), bad = checked.find((v) => !v.ok); if (bad) return say(sL, `${bad.reasons.join('. ')}.`);
    if (st.orders.filter((o) => o.status === 'waiting').length + 3 > ORDER_LIMITS.maxActive) return say(sL, `You can have ${ORDER_LIMITS.maxActive} waiting orders at once. Cancel some first.`);
    for (const v of checked) st.orders.push({ id: ++nextId, ...v.order, symbol: p.symbol, coin: coinOf(p), mode: p.mode }); save(); renderLists(); startEngine();
    trader.note(`Take-profit steps placed for ${p.symbol}: a third at ${at.map(usd).join(', ')}.`);
    return say(sL, `Placed: a third at ${usd(at[0])}, a third at ${usd(at[1])}, the rest at ${usd(at[2])}. In your order list they read 33%, 50% and 100%, because each is a share of what is left at that moment. ${RUNS}`);
  }), sL);
  body.append(add, part, exits, ladder, above, slices); chipNav(); if (!dialog.open) dialog.showModal(); body.scrollTop = 0;
}
on('coin-tools', (t) => void openCoin(t)); on('position-tools', (p) => openPosition(p));

// ---------- watchlist, orders and slices: the lists ----------
function toggleWatch(t) {
  if (st.watch.some((w) => w.mint === t.mint)) st.watch = st.watch.filter((w) => w.mint !== t.mint);
  else { if (st.watch.length >= 8) { alertUser('Watchlist is full', 'Eight coins is the most Warrior can re-check on free data. Remove one first.'); return; } if (Number.isFinite(t.priceUsd)) prices[t.mint] = t.priceUsd; st.watch.push({ ...coinOf(t), last: t.analysis?.decision === 'enter' && t.screen?.ok !== false ? 'enter' : 'wait', score: t.analysis?.score ?? null, checkedAt: Date.now(), addedAt: Date.now() }); startEngine(); }
  save(); renderLists();
}
function renderLists() {
  const w = $('watch-list'); w.replaceChildren();
  if (!st.watch.length) w.append(el('p', 'muted', 'Nothing watched yet. Open “Safety check, watch, orders” on any coin and add it.'));
  for (const c of st.watch) {
    const li = el('div', 'row-item'), text = el('span', ''); text.append(el('b', '', c.symbol), ` · ${usd(prices[c.mint])} · `, el('span', `verdict ${c.last === 'enter' ? 'enter' : 'wait'}`, c.last === 'enter' ? 'ENTER' : `WAIT${Number.isFinite(c.score) ? ` · ${c.score}/4` : ''}`), ` · checked ${ago(c.checkedAt)}`);
    const acts = el('span', 'row-acts'); acts.append(btn('Open', 'small', () => { $('lookup-q').value = c.mint; void lookup(c.mint, { scroll: true }); }), btn('Remove', 'small', () => toggleWatch(c))); li.append(text, acts); w.append(li);
  }
  const o = $('order-list'); o.replaceChildren(); const orders = [...st.orders].reverse(), plans = [...st.plans].reverse();
  if (!orders.length && !plans.length) o.append(el('p', 'muted', 'No orders or slice plans. Buy-side ones start from a coin; sell-side ones start from a position.'));
  for (const x of orders) {
    const waiting = x.status === 'waiting', li = el('div', `row-item ${waiting ? '' : 'done'}`), what = x.kind === 'buy-below' ? `Buy ${x.sol} SOL of ${x.symbol} at or below ${usd(x.price)}` : `Sell ${Math.round(x.fraction * 100)}% of ${x.symbol} at or above ${usd(x.price)}`;
    const state = waiting ? `waiting · now ${usd(prices[x.mint])} · expires in ${until(x.expiresAt)}${x.mode !== trader.mode ? ` · paused until you switch to ${x.mode === 'live' ? 'live' : 'practice'} mode` : ''}` : x.status;
    li.append(el('span', '', `${what} · ${x.mode === 'live' ? 'REAL' : 'practice'} · ${state}${x.note ? ` · ${x.note}` : ''}`), btn(waiting ? 'Cancel' : 'Clear', 'small', () => { st.orders = st.orders.filter((y) => y.id !== x.id); save(); renderLists(); })); o.append(li);
  }
  for (const p of plans) {
    const running = p.status === 'running', li = el('div', `row-item ${running ? '' : 'done'}`), what = p.side === 'buy' ? `Buy ${p.symbol} in ${p.slices} slices of ${p.solEach} SOL` : `Sell ${p.symbol} in ${p.slices} slices`;
    const state = running ? `${p.done} of ${p.slices} done · next ${p.nextAt <= Date.now() ? 'now' : `in ${until(p.nextAt)}`}${p.mode !== trader.mode ? ` · paused until you switch to ${p.mode === 'live' ? 'live' : 'practice'} mode` : ''}` : `${p.status} · ${p.done} of ${p.slices} done`;
    li.append(el('span', '', `${what} · ${p.mode === 'live' ? 'REAL' : 'practice'} · ${state}${p.note ? ` · ${p.note}` : ''}`), btn(running ? 'Cancel' : 'Clear', 'small', () => { st.plans = st.plans.filter((y) => y.id !== p.id); save(); renderLists(); })); o.append(li);
  }
}

// ---------- the engine: every 30 seconds, check prices; every 2 minutes, re-check watched coins and followed wallets ----------
let haveLock = !navigator.locks, engineBusy = false, tickN = 0, timer = null;
if (navigator.locks) navigator.locks.request('warrior-tools', () => { haveLock = true; drawEngine(); void tick(); return new Promise(() => {}); }).catch(() => {});
const manualOpen = () => { try { const v = JSON.parse(localStorage.getItem(MANUAL_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((p) => p && typeof p.mint === 'string') : []; } catch { return []; } };
const hasWork = () => st.orders.some((o) => o.status === 'waiting') || st.plans.some((p) => p.status === 'running') || st.watch.length > 0 || st.follows.length > 0 || trader.positions().length > 0;
function drawEngine() { $('engine-note').textContent = haveLock ? 'Orders, slices, your stops and alerts are checked every 30 seconds while this tab is open.' : 'Another Warrior tab is handling orders and alerts. This tab will take over if that one closes.'; }
function startEngine() { if (!timer) timer = setInterval(() => void tick(), TICK_MS); }
async function refreshPrices() {
  const mints = [...new Set([...st.orders.filter((o) => o.status === 'waiting').map((o) => o.mint), ...st.plans.filter((p) => p.status === 'running').map((p) => p.mint), ...st.watch.map((w) => w.mint), ...trader.positions().map((p) => p.mint), ...manualOpen().filter((p) => !p.closedAt).map((p) => p.mint)])].slice(0, 30);
  if (!mints.length) return;
  const j = await api(`/api/coin?what=prices&mints=${mints.join(',')}`); prices = { ...prices, ...j.prices }; pricesAt = Date.now();
  // A held coin whose pool has been emptied cannot be sold. Say so loudly, once, and again if it comes back.
  for (const p of trader.positions()) { const liq = j.liquidity?.[p.mint]; if (liq === undefined) continue; const empty = poolEmptied(liq), change = trader.setHealth(p.mint, { empty });
    if (change === 'emptied') { alertUser(`${p.symbol}: its pool has been emptied`, 'There is no money left in the pool, so it cannot be sold right now. This usually means whoever funded the pool took the money out.', 'Warrior keeps checking and will tell you if that changes.'); emit('problem', `${p.symbol} cannot be sold: its pool has been emptied.`); }
    if (change === 'restored') alertUser(`${p.symbol}: its pool has money again`, 'It can be sold again.'); }
  for (const [mint, price] of Object.entries(j.prices)) trader.setLast(mint, price);
}
async function orderStep() {
  for (const o of st.orders) {
    const due = orderDue(o, prices[o.mint]); if (due === 'expired') { o.status = 'expired'; alertUser(`Order expired: ${o.symbol}`, 'The price never got there. Nothing was traded.'); continue; }
    if (due !== 'fill' || o.mode !== trader.mode || trader.busy) continue;
    const r = o.kind === 'buy-below' ? await trader.buy(tokenFor(o.coin), { sol: o.sol, add: true, why: 'your buy-below order' }) : await trader.sell(o.mint, { reason: 'order', fraction: o.fraction });
    if (r.ok) { o.status = 'filled'; o.note = `filled ${new Date().toLocaleTimeString()}`; if (o.kind === 'sell-above') alertUser(`Sell order filled: ${o.symbol}`, `${Math.round(o.fraction * 100)}% sold at or above ${usd(o.price)}.`); }
    else if (r.gone) { o.status = 'cancelled'; o.note = 'the position was already closed'; }
    else if (!r.busy) { o.attempts = (o.attempts ?? 0) + 1; o.note = r.reason; if (o.attempts >= 3) { o.status = 'failed'; alertUser(`Order could not fill: ${o.symbol}`, r.reason, 'Tried three times. Nothing was traded.'); } }
  }
}
const autoSeen = new Map();
async function exitStep() {
  for (const p of trader.positions()) {
    if (p.mode !== trader.mode || trader.busy || p.empty) continue; // an emptied pool cannot be sold into; trying only fills the log
    const own = ownExitDue(p, prices[p.mint]);
    if (own) { const r = await trader.sell(p.mint, { reason: own }); if (r.ok) alertUser(`Your ${own} was hit: ${p.symbol}`, 'Sold as you asked.'); continue; }
    // Warrior's own stop and target, against the live price, while auto-trading is running. Two looks in a row must agree.
    if (!trader.running) { autoSeen.delete(p.mint); continue; }
    const due = autoExitDue(p, prices[p.mint]); if (!confirm(autoSeen, p.mint, due)) continue;
    autoSeen.delete(p.mint); const why = due === 'stop' && p.stop >= p.entry ? 'trailing-stop' : due; // a stop that has moved up above what was paid is the trailing stop
    trader.note(`${p.symbol}: the live price reached the ${why === 'trailing-stop' ? 'trailing stop' : due}. Selling without waiting for the next candle.`); await trader.sell(p.mint, { reason: why });
  }
}
async function sliceStep() {
  for (let i = 0; i < st.plans.length; i++) {
    const plan = st.plans[i], due = sliceDue(plan); if (!due || plan.mode !== trader.mode || trader.busy) continue;
    const r = due.side === 'buy' ? await trader.buy(tokenFor(plan.coin), { sol: due.sol, add: true, why: `slice ${due.index + 1} of ${plan.slices}` }) : await trader.sell(plan.mint, { reason: 'slice', fraction: due.fraction });
    if (r.busy) continue;
    if (r.gone) { st.plans[i] = { ...plan, status: 'cancelled', note: 'the position was already closed' }; continue; }
    const next = sliceDone(plan, r.ok); next.note = r.ok ? '' : r.reason; st.plans[i] = next;
    if (next.status === 'finished') alertUser(`Slices finished: ${plan.symbol}`, `${plan.slices} of ${plan.slices} done.`); else if (next.status === 'paused') alertUser(`Slices paused: ${plan.symbol}`, r.reason, 'Three tries failed in a row.');
  }
}
async function watchStep() {
  for (const w of st.watch) {
    try { const { token: t } = await api(`/api/coin?what=lookup&q=${w.mint}&${rules.query}`), now = t.analysis.decision === 'enter' && t.screen.ok ? 'enter' : 'wait'; if (now === 'enter' && w.last !== 'enter') alertUser(`${w.symbol} turned into an ENTER`, `${t.analysis.score}/4 signal groups agree.`, 'Open it from your watchlist.'); w.last = now; w.score = t.analysis.score; w.checkedAt = Date.now(); if (Number.isFinite(t.priceUsd)) prices[w.mint] = t.priceUsd; }
    catch (e) { emit('problem', `Could not re-check ${w.symbol} on your watchlist (${e.message}). It will be tried again in two minutes.`); }
  }
}
async function followStep() {
  for (const f of st.follows) {
    try {
      const j = await api(`/api/wallet-buys?wallet=${f.wallet}`); f.checkedAt = Date.now(); f.recent = j.buys.slice(0, 5).map((b) => ({ ...b, ...(f.recent ?? []).find((x) => x.signature === b.signature) }));
      for (const b of newBuys(j.buys, { since: f.since, seen: f.seen }).slice(0, 2)) {
        f.seen = [...(f.seen ?? []), b.signature].slice(-60);
        let t = null; try { t = (await api(`/api/coin?what=lookup&q=${b.mint}&${rules.query}`)).token; } catch {}
        const says = !t ? 'could not be checked' : !t.screen.ok ? `fails the safety screen (${t.screen.reasons[0]})` : t.analysis.decision === 'enter' ? `is an ENTER (${t.analysis.score}/4)` : `is a WAIT (${t.analysis.reasons[0] ?? 'rules not met'})`;
        const entry = f.recent.find((x) => x.signature === b.signature); if (entry && t) { entry.symbol = t.symbol; entry.says = says; }
        alertUser(`${f.label} bought ${t?.symbol ?? short(b.mint)}`, `Warrior says it ${says}.`, f.copy ? '' : 'Not copied.');
        // Copying follows the same rules as everything else: never a coin that fails the screen, and with real funds only an ENTER.
        const allowed = f.copy && t && t.screen.ok && (trader.mode !== 'live' || t.analysis.decision === 'enter');
        if (f.copy && !allowed) trader.note(`Did not copy ${f.label}'s buy of ${t?.symbol ?? short(b.mint)}: it ${says}.`);
        if (allowed && !trader.busy) { const r = await trader.buy(t, { why: `copied from ${f.label}` }); if (!r.ok) trader.note(`Did not copy ${f.label}'s buy of ${t.symbol}: ${r.reason}.`); }
      }
    } catch (e) { f.error = e.message; emit('problem', `Could not read the wallet you follow, ${f.label} (${e.message}).`); continue; } f.error = '';
  }
}
async function tick() {
  if (engineBusy || !haveLock || !hasWork()) { renderPortfolio(); return; }
  engineBusy = true;
  try { try { await refreshPrices(); } catch (e) { emit('problem', `Prices could not be read (${e.message}). Orders, slices and your own stops wait until they can.`); } await orderStep(); await exitStep(); await sliceStep(); if (tickN % 4 === 0) { await watchStep(); await followStep(); } tickN++; }
  finally { engineBusy = false; save(); renderLists(); renderFollows(); renderPortfolio(); }
}

// Open positions get a fresh price every five seconds while the tab is in view. The heavier checks (orders, stops, slices)
// keep their 30-second rhythm; this only keeps the numbers on screen current.
setInterval(() => { if (document.visibilityState !== 'visible' || !haveLock || engineBusy || !trader.positions().length) return; void refreshPrices().then(() => renderPortfolio()).catch(() => {}); }, 5000);

// ---------- strategy dial ----------
function renderDial() {
  const box = $('dial-presets'); box.replaceChildren();
  for (const [id, p] of Object.entries(rules.PRESETS)) { const b = btn('', `preset ${rules.choice.preset === id ? 'on' : ''}`, () => { rules.setPreset(id); $('dial-status').textContent = `Switched to ${p.label}.`; }); b.setAttribute('aria-pressed', String(rules.choice.preset === id)); b.append(el('span', 'preset-face', p.face), el('b', '', p.label), el('span', 'muted', p.blurb)); box.append(b); }
  $('dial-text').textContent = rules.text; $('dial-version').textContent = `Rules version ${rules.resolved.version}. Every trade is stamped with it, so results belong to the rules that made them.`;
  const adv = $('dial-fields'); adv.replaceChildren(); adv.classList.add('knob-list');
  // Presets only: every number is set by the preset and shown here, read-only, so you always know what Warrior is doing.
  const p = rules.PRESETS[rules.choice.preset];
  adv.append(el('p', 'muted', `${p.face} ${p.label} sets every number below. They come from Warrior's tests on real trades. To trade differently, pick another preset above.`));
  const NOTES = { 'When to buy': 'Warrior buys a coin in a clear uptrend (a trend buy), or one that has just fallen hard and looks stretched downward (a deep dip).' };
  let group = null;
  const ORDER = ['When to buy', 'When to sell', 'Size and limits'];
  for (const [key, t] of Object.entries(rules.TUNABLE).sort(([, x], [, y]) => ORDER.indexOf(x.group) - ORDER.indexOf(y.group))) {
    if (t.group !== group) { group = t.group; adv.append(heading(group, NOTES[group])); }
    const value = (t.of === 'settings' ? rules.resolved.settings : rules.resolved.risk)[key];
    adv.append(fact({ label: t.label, unit: t.unit, value, kind: t.kind, off: t.off }));
  }
  $('dial-reset').hidden = true;
  const send = rules.send, sel = $('send-priority'); if (!sel.options.length) for (const p of rules.PRIORITY) sel.append(Object.assign(el('option', '', p.label), { value: p.id }));
  sel.value = send.priority; $('send-protect').checked = send.protect;
}
$('dial-reset').addEventListener('click', () => { rules.setPreset(rules.choice.preset); $('dial-status').textContent = `Back to the plain ${rules.PRESETS[rules.choice.preset].label} numbers.`; });
$('send-priority').addEventListener('change', (e) => rules.setSend({ priority: e.target.value, protect: $('send-protect').checked }));
$('send-protect').addEventListener('change', (e) => rules.setSend({ priority: $('send-priority').value, protect: e.target.checked }));
on('rules-changed', () => renderDial());

// ---------- portfolio and results ----------
function manualAsTrader() {
  const owner = session.owner, all = manualOpen().filter((p) => owner && p.owner === owner);
  return {
    positions: all.filter((p) => !p.closedAt && Number.isFinite(p.sol)).map((p) => ({ mode: 'wallet', mint: p.mint, symbol: p.symbol, solIn: p.sol, entry: p.entryPriceUsd, stop: p.stop, target: p.target, openedAt: p.openedAt, rulesVersion: p.rulesVersion ?? null })),
    trades: all.filter((p) => p.closedAt && Number.isFinite(p.quotedOutSol) && Number.isFinite(p.sol)).map((p) => ({ mode: 'wallet', mint: p.mint, openedAt: p.openedAt, costs: { entry: { requestedSol: p.sol, impactSol: Number.isFinite(p.entryImpactPct) ? p.sol * p.entryImpactPct / 100 : null, extraSol: 0 }, exitImpactPct: p.exitImpactPct ?? NaN, exitQuotedSol: p.quotedOutSol }, symbol: p.symbol, solIn: p.sol, solOut: p.quotedOutSol, pnlSol: p.quotedOutSol - p.sol, pnlPct: (p.quotedOutSol / p.sol - 1) * 100, reason: 'manual', closedAt: p.closedAt, exit: p.exitSignature, rulesVersion: p.rulesVersion ?? null }))
  };
}
const FEES = { paper: 'Practice results come from real quotes, so pool fees and price impact are in. Network fees are not: no transaction is sent.', live: "Trading-wallet results are measured from the wallet's own balance before and after, so every fee is in.", wallet: 'Own-wallet results use the quote at the moment you sold. Your wallet history has the exact figure.' };
const TITLES = { paper: 'Practice', live: 'Trading wallet (real)', wallet: 'Your own wallet (real)' };
function allTrades() { const m = manualAsTrader(); return [...trader.trades(), ...m.trades].sort((a, b) => a.closedAt - b.closedAt); }
function renderPortfolio() {
  const box = $('pf-body'); if (!box) return; const m = manualAsTrader(), positions = [...trader.positions(), ...m.positions], trades = allTrades(); box.replaceChildren();
  const modes = ['paper', 'live', 'wallet'].filter((mode) => mode === 'paper' || positions.some((p) => p.mode === mode) || trades.some((t) => t.mode === mode));
  for (const mode of modes) {
    const s = summarize({ positions, trades, prices, mode }), sec = el('section', 'pf'); sec.append(el('h3', '', TITLES[mode]));
    const totals = el('dl', 'sum wide'), row = (k, v, cls) => { totals.append(el('dt', '', k), el('dd', cls ?? '', v)); };
    row('Holding', s.holdings.length ? `${s.holdings.length} coin${s.holdings.length === 1 ? '' : 's'} · cost ${s.costSol.toFixed(4)} SOL · worth about ${s.valueSol.toFixed(4)} SOL` : 'nothing');
    if (s.holdings.length) row('Open result', `${sol(s.unrealizedSol)}${s.unpriced ? ` (${s.unpriced} without a current price, counted at cost)` : ''}`, s.unrealizedSol > 0 ? 'up' : s.unrealizedSol < 0 ? 'down' : '');
    row('Closed trades', s.closed ? `${s.closed} · ${s.wins} won, ${s.losses} lost${s.winRatePct === null ? '' : ` · ${s.winRatePct.toFixed(0)}% won`}` : 'none yet');
    if (s.closed) { row('Closed result', sol(s.realizedSol), s.realizedSol > 0 ? 'up' : s.realizedSol < 0 ? 'down' : ''); row('Best and worst', `${s.best.symbol} ${sol(s.best.pnlSol)} · ${s.worst.symbol} ${sol(s.worst.pnlSol)}`); }
    sec.append(totals);
    if (s.holdings.length) { const t = el('table', 'grid'), head = el('tr'); for (const h of ['Coin', 'Cost', 'Worth about', 'Result', 'Rules']) head.append(el('th', '', h)); t.append(head); for (const h of s.holdings) { const tr = el('tr'); tr.append(el('td', '', h.symbol), el('td', '', `${h.costSol.toFixed(4)}`), el('td', '', h.priced ? `${h.valueSol.toFixed(4)}` : 'no price'), el('td', h.pnlSol > 0 ? 'up' : h.pnlSol < 0 ? 'down' : '', h.priced ? `${sol(h.pnlSol)} (${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%)` : '—'), el('td', 'muted', h.rulesVersion ?? '—')); t.append(tr); } const wrap = el('div', 'scroll-x'); wrap.append(t); sec.append(wrap); }
    sec.append(el('p', 'muted', FEES[mode])); box.append(sec);
  }
  const hist = $('pf-history'); hist.replaceChildren(); const recent = trades.slice(-15).reverse();
  if (!recent.length) hist.append(el('p', 'muted', 'No closed trades yet. They appear here, newest first.'));
  else { const t = el('table', 'grid'), head = el('tr'); for (const h of ['When', 'Coin', 'In', 'Out', 'Result', 'Why', 'Money', 'Rules', '']) head.append(el('th', '', h)); t.append(head); for (const x of recent) { const tr = el('tr'); tr.append(el('td', '', new Date(x.closedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), el('td', '', x.symbol), el('td', '', x.solIn.toFixed(4)), el('td', '', x.solOut.toFixed(4)), el('td', x.pnlSol > 0 ? 'up' : x.pnlSol < 0 ? 'down' : '', `${sol(x.pnlSol)} (${x.pnlPct.toFixed(1)}%)`), el('td', '', x.reason), el('td', '', x.mode === 'paper' ? 'practice' : 'real'), el('td', 'muted', x.rulesVersion ?? '—')); const cell = el('td', 'row-acts'); cell.append(btn('Receipt', 'small', () => emit('receipt', x))); if (x.pnlSol > 0) cell.append(btn('Card', 'small', () => emit('warrior-card', x))); tr.append(cell); t.append(tr); } const wrap = el('div', 'scroll-x'); wrap.append(t); hist.append(wrap); }
  $('pf-download').disabled = !trades.length; $('pf-prices').textContent = pricesAt ? `Prices checked ${ago(pricesAt)}.` : '';
}
$('pf-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([tradesCsv(allTrades())], { type: 'text/csv;charset=utf-8' })), a = el('a'); a.href = url; a.download = `warrior-trades-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  $('pf-prices').textContent = 'Trade history downloaded.';
});
$('pf-refresh').addEventListener('click', async () => { $('pf-prices').textContent = 'Checking prices…'; try { await refreshPrices(); } catch { $('pf-prices').textContent = 'Prices are unavailable right now.'; } renderPortfolio(); renderLists(); });
on('risk', () => { renderPortfolio(); if (trader.positions().length) startEngine(); });

// ---------- follow a wallet ----------
function renderFollows() {
  const box = $('follow-list'); box.replaceChildren();
  if (!st.follows.length) box.append(el('p', 'muted', 'Not following anyone. Paste a public wallet address above. Warrior only reads it; it can never touch that wallet.'));
  for (const f of st.follows) {
    const c = el('article', 'card'), top = el('div', 'card-top'); top.append(el('span', 'sym', f.label), el('code', '', short(f.wallet))); c.append(top);
    c.append(el('p', 'muted', f.error ? `Could not read this wallet just now (${f.error}).` : f.checkedAt ? `Checked ${ago(f.checkedAt)}. New buys since you followed are announced.` : 'First check within half a minute…'));
    const row = el('label', 'toggle'), box2 = el('input'); box2.type = 'checkbox'; box2.checked = !!f.copy; box2.addEventListener('change', () => { f.copy = box2.checked; save(); renderFollows(); });
    row.append(box2, ` Copy its buys with ${trader.mode === 'live' ? 'REAL funds, only when Warrior also says ENTER' : 'practice money, when the coin passes the safety screen'}`); c.append(row);
    const list = el('ul', 'rows');
    for (const b of f.recent ?? []) { const li = el('li', 'row-item'); li.append(el('span', '', `${b.symbol ?? short(b.mint)} · ${Number.isFinite(b.solSpent) ? `${b.solSpent.toFixed(3)} SOL` : 'paid in dollars'} · ${Number.isFinite(b.at) ? ago(b.at) : 'time unknown'}${b.says ? ` · Warrior says it ${b.says}` : ''}`), btn("Warrior's verdict", 'small', () => { $('lookup-q').value = b.mint; void lookup(b.mint, { scroll: true }); })); list.append(li); }
    if (f.checkedAt && !(f.recent ?? []).length) list.append(el('li', 'muted', 'No buys in its last few transactions.'));
    c.append(list, btn('Stop following', 'small', () => { st.follows = st.follows.filter((x) => x.wallet !== f.wallet); save(); renderFollows(); })); box.append(c);
  }
}
$('follow-add').addEventListener('click', () => {
  const wallet = $('follow-wallet').value.trim(), status = $('follow-status'), name = $('follow-name').value.trim().slice(0, 20);
  if (!ADDRESS.test(wallet)) { status.textContent = 'That is not a Solana wallet address.'; return; }
  if (st.follows.some((f) => f.wallet === wallet)) { status.textContent = 'You already follow that wallet.'; return; }
  if (st.follows.length >= 3) { status.textContent = 'Three wallets is the most Warrior can follow on free data. Stop following one first.'; return; }
  st.follows.push({ wallet, label: name || short(wallet), since: Date.now(), seen: [], recent: [], copy: false, checkedAt: 0, error: '' }); save(); $('follow-wallet').value = ''; $('follow-name').value = '';
  status.textContent = 'Following. Warrior shows its recent buys in a moment and announces new ones.'; renderFollows(); startEngine(); tickN = 0; void tick();
});

// ---------- start ----------
renderDial(); drawAlerts(); renderLists(); renderFollows(); renderPortfolio(); drawEngine();
if (hasWork()) { startEngine(); void tick(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && hasWork()) void tick(); });
