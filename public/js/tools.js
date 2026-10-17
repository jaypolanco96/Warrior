// Your own hands on a position, the Laugh way: add funds, sell part (25/50/75/100%), take out what you put in, your own
// stop and target, sell-above orders and take-profit steps. Plus the order engine that runs them and the portfolio.
// Orders live in the synced state, so every device you open Warrior on sees them; only the device that is open runs them.
import { state, save, emit, on, exclusive, lock, problem } from './store.js';
import { moodCheck } from '/vendor/lib/mood.js';
import { sell, addFunds, liveStops, swapped } from './trader.js';
import { impi, rules } from './impi.js';
import { validateOrder, orderDue, validateExits, ORDER_LIMITS } from '/vendor/lib/orders.js';
import { summarize } from '/vendor/lib/portfolio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const usd = (n) => !Number.isFinite(n) ? '—' : n >= 1 ? `$${n.toFixed(4)}` : `$${n.toPrecision(4)}`;
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const say = (who, text, tone) => emit('say', { who, text, tone });
const nextId = () => Date.now() + Math.floor(Math.random() * 1000);
const find = (mint, mode) => state.positions.find((p) => p.mint === mint && p.mode === mode) ?? null;
const reasonOf = (e) => String(e?.message ?? e).replace(/\.+$/, '');

// ---------- the position dialog ----------
const dlg = $('pos-dlg');
function section(title, text) { const s = el('section', 'ptool'); s.append(el('h4', '', title)); if (text) s.append(el('p', 'small', text)); return s; }
function button(label, cls, fn) { const b = el('button', `btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
function numberField(label, attrs) { const w = el('div', 'field'), l = el('label', '', label), i = el('input'); i.type = 'number'; i.inputMode = 'decimal'; Object.assign(i, attrs); i.id = `pt-${Math.random().toString(36).slice(2, 8)}`; l.htmlFor = i.id; w.append(l, i); return [w, i]; }
const status = () => { const p = el('p', 'small pstatus'); p.setAttribute('role', 'status'); return p; };

export function openPosition(start) {
  const mint = start.mint, mode = start.mode, p0 = find(mint, mode); if (!p0) return;
  const here = () => mode === state.mode, wrong = `This position was opened in ${mode === 'live' ? 'live' : 'practice'} mode. Switch back to act on it.`;
  const now = p0.last ?? p0.entry, base = p0.entry;
  $('pos-title').textContent = `${p0.symbol} · add funds, sell part, stops and orders`;
  const head = el('div', 'pos-facts');
  // the summary is redrawn after every action, so it never shows the position as it was before a sale
  const drawFacts = () => { const p = find(mint, mode) ?? p0, px = p.last ?? p.entry; head.replaceChildren(); for (const [k, v] of [['IN', `${p.solIn.toFixed(4)} SOL`], ['PAID', usd(p.entry)], ['NOW', usd(px)], ['P/L', pct((px / p.entry - 1) * 100)], ['IMPI STOP', usd(p.stop)], ['IMPI TARGET', usd(p.target)]]) { const d = el('div'); d.append(el('span', '', k), el('b', '', v)); head.append(d); } if (!find(mint, mode)) head.append(el('div', 'closed', 'Closed')); };
  drawFacts();
  const run = async (out, fn, done) => { if (!here()) { out.textContent = wrong; return; } out.textContent = 'Working…'; try { const r = await exclusive(fn); out.textContent = done(r); } catch (e) { out.textContent = `Not done: ${reasonOf(e)}.`; } drawFacts(); emit('positions'); drawPortfolio(); };

  // sell part now
  const part = section('Sell part of it now', 'Take some off the table and let the rest ride. The impi\'s stop and target, and your own, keep working on what is left.'), sP = status(), row = el('div', 'row');
  for (const f of [25, 50, 75, 100]) row.append(button(`Sell ${f}%`, f === 100 ? 'danger' : 'ghost', () => run(sP, async () => { const p = find(mint, mode); if (!p) throw new Error('that position is no longer open'); return sell(p, 'manual', f / 100); }, (ok) => { const p = find(mint, mode); return ok ? p ? `Sold ${f}%. ${p.solIn.toFixed(4)} SOL of what you put in is still riding.` : `Sold all of ${p0.symbol}.` : 'The sale did not go through. Nothing changed.'; })));
  row.append(button('Take out what I put in', 'ghost', () => run(sP, async () => {
    const p = find(mint, mode); if (!p) throw new Error('that position is no longer open');
    if (!Number.isFinite(p.nowSol)) throw new Error('no fresh sale price yet; try again in half a minute');
    if (p.nowSol <= swapped(p) * 1.03) throw new Error(`only possible once it is worth more than the ${swapped(p).toFixed(4)} SOL you swapped in (a sale now returns about ${p.nowSol.toFixed(4)} SOL)`);
    const fraction = Math.min(1, swapped(p) / p.nowSol * 1.01); await sell(p, 'took-out', fraction); return fraction;
  }, (f) => `Sold ${Math.round(f * 100)}%: about what you put in is back in the wallet. The rest rides, and it can still fall to nothing.`)));
  part.append(row, sP);

  // add funds
  const add = section('Add funds to this position', `Buy more ${p0.symbol}. Your average price is worked out again from both buys. ${mode === 'live' ? 'This uses REAL SOL from the trading wallet.' : 'Practice money.'}`), sA = status();
  const [wA, amt] = numberField('Amount to add (SOL)', { step: '0.01', min: '0.01', max: '5', value: '0.05' }), quick = el('div', 'row');
  for (const v of [0.05, 0.1, 0.25, 0.5]) quick.append(button(`${v} SOL`, 'ghost small', () => { amt.value = String(v); }));
  let armed = 0;
  add.append(wA, quick, button(mode === 'live' ? `Add to ${p0.symbol} (real SOL)` : `Practice: add to ${p0.symbol}`, '', () => {
    // The mood guard (from Laugh): going straight back into a coin that just lost, or adding after a losing streak, asks twice.
    const mood = moodCheck({ trades: state.trades.filter((t) => t.mode === mode), proposed: { mint, sol: Number(amt.value) } });
    if ((mood || mode === 'live') && Date.now() - armed > 8000) { armed = Date.now(); sA.textContent = `${mood ? `${mood.message} ` : ''}${mode === 'live' ? 'This buys with REAL SOL. ' : ''}Tap again within 8 seconds to go ahead.`; return; }
    return run(sA, async () => { const p = find(mint, mode); if (!p) throw new Error('that position is no longer open'); return addFunds(p, Number(amt.value), rules().risk.slippageBps); }, () => { const p = find(mint, mode); return `Added. You now have ${p.solIn.toFixed(4)} SOL in ${p.symbol}, at an average of ${usd(p.entry)} a coin.`; });
  }), sA);

  // my stop and target
  const exits = section('My stop and target', `On top of the impi's own. A percent of what you paid (${usd(base)}); whichever is reached first sells. Leave a box empty for none. Checked every 15 seconds while Warrior is open, even when the impi is resting.`), sE = status();
  const [wS, stopIn] = numberField('My stop (% below what I paid; 0 = break-even)', { step: '1', min: '0', max: '95', value: p0.ownStop ? String(Math.round((1 - p0.ownStop / base) * 100)) : '' });
  const [wT, tgtIn] = numberField('My target (% above what I paid)', { step: '1', min: '1', max: '10000', value: p0.ownTarget ? String(Math.round((p0.ownTarget / base - 1) * 100)) : '' });
  const two = el('div', 'fields'); two.append(wS, wT);
  exits.append(two, el('div', 'row'), sE); exits.lastChild.previousSibling.append(
    button('Save my stop and target', '', () => {
      const p = find(mint, mode); if (!p) { sE.textContent = 'That position is no longer open.'; return; }
      const sv = stopIn.value === '' ? null : base * (1 - Number(stopIn.value) / 100), tv = tgtIn.value === '' ? null : base * (1 + Number(tgtIn.value) / 100), v = validateExits({ entry: base, stop: sv, target: tv }, p.last ?? null);
      if (!v.ok) { sE.textContent = `${v.reasons.join('. ')}.`; return; }
      p.ownStop = sv; p.ownTarget = tv; save(); emit('positions');
      sE.textContent = `Saved. ${sv ? `Sells if the price falls to ${usd(sv)}.` : 'No stop of your own.'} ${tv ? `Sells if it rises to ${usd(tv)}.` : 'No target of your own.'}`;
    }),
    button('Clear mine', 'ghost', () => { const p = find(mint, mode); if (p) { delete p.ownStop; delete p.ownTarget; save(); } stopIn.value = tgtIn.value = ''; sE.textContent = 'Cleared. Only the impi\'s stop and target remain.'; }));

  // sell-above order
  const above = section('Sell if it gets dearer', `Sells part of the position when the price reaches a level over the price now (${usd(now)}).`), sO = status();
  const [wO, atIn] = numberField('Sell at (% above what I paid)', { step: '1', min: '1', value: String(Math.max(1, Math.ceil((now * 1.1 / base - 1) * 100))) }), [wF, shareIn] = numberField('How much (%)', { step: '5', min: '5', max: '100', value: '50' });
  const two2 = el('div', 'fields'); two2.append(wO, wF);
  above.append(two2, button('Place sell-above order', '', () => place(sO, [{ price: base * (1 + Number(atIn.value) / 100), fraction: Number(shareIn.value) / 100 }])), sO);

  // take profit in steps
  const steps = section('Take profit in steps', 'Three sell orders: a third of what you hold at each gain over what you paid. Each must be over the price now.'), sL = status();
  const ins = [25, 50, 100].map((v, i) => numberField(`Step ${i + 1} (% above paid)`, { step: '1', min: '1', value: String(Math.max(v, Math.ceil((now * (1.05 + i * 0.1) / base - 1) * 100))) })), three = el('div', 'fields three'); three.append(...ins.map((x) => x[0]));
  steps.append(three, button('Place the three sell orders', '', () => {
    const at = ins.map((x) => base * (1 + Number(x[1].value) / 100)); if (!(at[0] < at[1] && at[1] < at[2])) { sL.textContent = 'Each step must be higher than the one before.'; return; }
    place(sL, at.map((price, i) => ({ price, fraction: [1 / 3, 1 / 2, 1][i] })));
  }), sL);

  function place(out, list) {
    const p = find(mint, mode); if (!p) { out.textContent = 'That position is no longer open.'; return; }
    const checked = list.map((o) => validateOrder({ kind: 'sell-above', mint, price: o.price, fraction: o.fraction }, { currentPrice: p.last ?? null })), bad = checked.find((v) => !v.ok);
    if (bad) { out.textContent = `${bad.reasons.join('. ')}.`; return; }
    if (waiting().length + checked.length > ORDER_LIMITS.maxActive) { out.textContent = `You can have ${ORDER_LIMITS.maxActive} waiting orders at once. Cancel some first.`; return; }
    for (const v of checked) state.orders.push({ id: nextId(), ...v.order, symbol: p.symbol, mode });
    save(); drawOrders(); out.textContent = `Placed ${checked.length === 1 ? `a sell of ${Math.round(checked[0].order.fraction * 100)}% at ${usd(checked[0].order.price)}` : `three sells at ${checked.map((v) => usd(v.order.price)).join(', ')}`}. Orders are checked every 15 seconds while Warrior is open on any of your devices.`;
    say('induna', `Order placed for ${p.symbol}: ${checked.map((v) => `${Math.round(v.order.fraction * 100)}% at ${usd(v.order.price)}`).join(', ')}.`);
  }

  $('pos-body').replaceChildren(head, part, add, exits, steps, above);
  if (!dlg.open) dlg.showModal(); $('pos-body').scrollTop = 0;
}
$('pos-close').addEventListener('click', () => dlg.close());
on('position-tools', (p) => openPosition(p));

// ---------- the order list ----------
const waiting = () => state.orders.filter((o) => o.status === 'waiting');
export function drawOrders() {
  const box = $('orders'); if (!box) return; const list = [...state.orders].reverse().slice(0, 20);
  box.replaceChildren(...(list.length ? list.map((o) => { const li = el('li'), w = o.status === 'waiting', b = el('button', 'sell', w ? 'Cancel' : 'Clear'); b.type = 'button';
    b.addEventListener('click', () => { state.orders = state.orders.filter((x) => x.id !== o.id); save(); drawOrders(); });
    li.append(el('span', `ostate ${o.status}`, o.status.toUpperCase()), el('span', '', `Sell ${Math.round(o.fraction * 100)}% ${o.symbol} ≥ ${usd(o.price)} · ${o.mode === 'live' ? 'LIVE' : 'practice'}${o.note ? ` · ${o.note}` : ''}`), b); return li; })
    : [el('li', 'small', 'No orders. Open a position (the Manage button) to set your own stop, target, sell orders or take-profit steps.')]));
}

// ---------- the engine: your stops and orders every 15 seconds, the impi's live-price stops while it is out ----------
async function orderStep() {
  for (const o of state.orders) {
    const p = find(o.mint, o.mode), due = orderDue(o, p?.last);
    if (due === 'expired') { o.status = 'expired'; say('umlobi', `Order expired: ${o.symbol}. The price never got there; nothing was traded.`); continue; }
    if (due !== 'fill' || o.mode !== state.mode) continue;
    if (!p) { o.status = 'cancelled'; o.note = 'the position was already closed'; continue; }
    let ok = false; try { ok = await sell(p, 'order', o.fraction); } catch (e) { o.note = reasonOf(e); }
    if (ok) { o.status = 'filled'; o.note = `filled ${new Date().toLocaleTimeString()}`; }
    else if ((o.attempts = (o.attempts ?? 0) + 1) >= 3) { o.status = 'failed'; say('induna', `Order for ${o.symbol} could not fill after three tries. Nothing was traded.`, 'down'); }
  }
  // a position closed some other way takes its waiting orders with it
  for (const o of waiting()) if (!find(o.mint, o.mode)) { o.status = 'cancelled'; o.note = 'the position was closed'; }
}
async function engine() {
  if (lock.busy || !state.positions.some((p) => p.mode === state.mode)) { drawPortfolio(); return; }
  lock.busy = true;
  try { await liveStops({ auto: impi.running }); await orderStep(); } catch (e) { problem('engine', `Your stops and orders could not be checked this time (${e.message}). Trying again in 15 seconds.`); }
  finally { lock.busy = false; save(); drawOrders(); drawPortfolio(); emit('positions'); }
}
setInterval(engine, 15_000);

// ---------- portfolio ----------
export function drawPortfolio() {
  const box = $('portfolio'); if (!box) return;
  const prices = Object.fromEntries(state.positions.filter((p) => Number.isFinite(p.last)).map((p) => [p.mint, p.last]));
  const s = summarize({ positions: state.positions, trades: state.trades, prices, mode: state.mode });
  const kv = (k, v, cls = '') => { const d = el('div'); d.append(el('span', '', k), el('b', cls, v)); return d; }, sol = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(4)}`;
  // what trading itself cost: the round trip measured at each buy (price impact plus pool fees), on what went in
  const priced = state.trades.filter((t) => t.mode === state.mode && Number.isFinite(t.costPct)), costs = priced.filter((t) => !t.partial).map((t) => t.costPct), paid = priced.reduce((n, t) => n + t.solIn * t.costPct / 100, 0);
  const grid = el('div', 'pf-grid');
  grid.append(kv('IN COINS', `${s.valueSol.toFixed(4)} SOL`), kv('COST', `${s.costSol.toFixed(4)} SOL`), kv('UNREALIZED', sol(s.unrealizedSol), s.unrealizedSol >= 0 ? 'up' : 'down'), kv('REALIZED', sol(s.realizedSol), s.realizedSol >= 0 ? 'up' : 'down'),
    kv('WINS / LOSSES', `${s.wins} / ${s.losses}`), kv('BEST', s.best ? `${s.best.symbol} ${sol(s.best.pnlSol)}` : '—', 'up'), kv('WORST', s.worst ? `${s.worst.symbol} ${sol(s.worst.pnlSol)}` : '—', 'down'), kv('ORDERS', String(waiting().filter((o) => o.mode === state.mode).length)), kv('AVG COST / TRADE', costs.length ? `${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2)}%` : '—'), kv('COST PAID', `${paid.toFixed(4)} SOL`));
  const bar = el('div', 'pf-bar'); const total = s.valueSol || 1;
  s.holdings.forEach((h, i) => { const seg = el('span', `seg c${i % 6} w${Math.max(1, Math.min(20, Math.round(h.valueSol / total * 20)))}`); seg.title = `${h.symbol}: ${h.valueSol.toFixed(4)} SOL`; bar.append(seg); });
  const list = el('ul', 'pf-list'); for (const [i, h] of s.holdings.entries()) { const li = el('li'), dot = el('i', `c${i % 6}`); li.append(dot, el('span', '', h.symbol), el('span', '', `${h.valueSol.toFixed(4)} SOL`), el('span', h.pnlPct === null ? '' : h.pnlPct >= 0 ? 'up' : 'down', h.pnlPct === null ? 'no price yet' : pct(h.pnlPct))); list.append(li); }
  const recent = state.trades.filter((t) => t.mode === state.mode).slice(-6).reverse(), rl = el('ul', 'pf-list recent');
  for (const t of recent) { const li = el('li'), b = el('button', 'sell', 'Receipt'); b.type = 'button'; b.addEventListener('click', () => emit('receipt', t)); li.append(el('i', t.pnlSol >= 0 ? 'win' : 'loss'), el('span', '', `${t.symbol}${t.partial ? ' (part)' : ''}`), el('span', t.pnlSol >= 0 ? 'up' : 'down', `${t.pnlSol >= 0 ? '+' : ''}${t.pnlSol.toFixed(4)}`), b); rl.append(li); }
  const recentBlock = recent.length ? [el('h3', 'label sub', 'RECENT TRADES · HONEST RECEIPTS'), rl] : [];
  box.replaceChildren(grid, ...recentBlock, ...(s.holdings.length ? [bar, list] : [el('p', 'small', 'No coins held right now. Holdings, their share of the portfolio and their live profit show here.')]));
}
on('trade', () => { drawPortfolio(); drawOrders(); }); on('equity', drawPortfolio); on('synced', () => { drawPortfolio(); drawOrders(); });
drawOrders(); drawPortfolio();
