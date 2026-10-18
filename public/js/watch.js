// The watchtower: Warrior grades its own decisions by following the price after them.
//  1. Missed trades: every coin refused or narrowly missed is followed for 3 hours. Would it have made or lost money?
//  2. After the sale: every whole sale is followed for 3 hours. Did it sell too early, or just in time?
//  3. Dip weather: of the coins that reached the deep-dip reading in the last 6 hours, how many bounced +5% within the hour?
// Prices are sampled every 3 minutes, so highs and lows are approximate. The records are kept in the synced state.
import { state, save, api, emit, on, dials } from './store.js';
import { resolveRules } from '/vendor/lib/presets.js';
import { learningSample } from '/vendor/lib/adapt.js';

const H = 3_600_000, FOLLOW = 3 * H, DIP_WINDOW = H, KEEP = 300;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const pct = (v) => !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
function book() { state.watch ??= {}; const w = state.watch; w.missed ??= []; w.after ??= []; w.dips ??= []; w.guard ??= 'report'; return w; }
const trim = (list) => { while (list.length > KEEP) list.shift(); };
const fresh = (list, mint, within) => list.some((x) => x.mint === mint && x.mode === state.mode && x.preset === state.preset && Date.now() - x.at < within);

// ---------- recording ----------
on('missed', ({ mint, symbol, price, rule, gap }) => {
  const w = book(); if (!Number.isFinite(price) || price <= 0 || fresh(w.missed, mint, FOLLOW)) return;
  const current = resolveRules({ preset: state.preset, adapt: dials() }), s = current.settings;
  w.missed.push({ mint, symbol, rule, rules: current.version, gap: Number.isFinite(gap) ? gap : null, preset: state.preset, mode: state.mode, p0: price, at: Date.now(), max: price, min: price, last: price, stop: s.dipStopPct, target: s.targetPct, hit: null, done: false }); trim(w.missed); save();
});
on('trade', ({ side, mint, symbol, px, reason, whole, preset, rules, mode } = {}) => {
  if (side !== 'sell' || !whole || !Number.isFinite(px) || px <= 0) return;
  const w = book(); w.after.push({ mint, symbol, reason, rules: rules ?? null, preset: preset ?? state.preset, mode: mode ?? state.mode, p0: px, at: Date.now(), max: px, min: px, last: px, done: false }); trim(w.after); save();
});
on('dip-seen', ({ mint, symbol, price }) => {
  const w = book(); if (fresh(w.dips, mint, DIP_WINDOW)) return;
  w.dips.push({ mint, symbol, mode: state.mode, preset: state.preset, p0: price, at: Date.now(), max: price, done: false, bounced: null }); trim(w.dips); save();
});

// ---------- following the price ----------
async function follow() {
  const w = book(), now = Date.now(), open = [...w.missed, ...w.after, ...w.dips].filter((x) => !x.done);
  const mints = [...new Set(open.map((x) => x.mint))]; if (!mints.length) { draw(); return; }
  const prices = {};
  for (let i = 0; i < mints.length; i += 30) { try { Object.assign(prices, (await api(`/api/coin?what=prices&mints=${mints.slice(i, i + 30).join(',')}`)).prices ?? {}); } catch { /* next time */ } }
  for (const x of open) {
    const p = prices[x.mint]; if (Number.isFinite(p) && p > 0) { x.last = p; x.max = Math.max(x.max, p); if ('min' in x) x.min = Math.min(x.min, p); }
    if ('hit' in x && !x.hit) { if (x.min <= x.p0 * (1 - x.stop / 100)) x.hit = 'stop'; else if (x.max >= x.p0 * (1 + x.target / 100)) x.hit = 'target'; }
    if ('bounced' in x && x.max >= x.p0 * 1.05) { x.bounced = true; x.done = true; }
    const span = 'bounced' in x ? DIP_WINDOW : FOLLOW;
    if (!x.done && now - x.at >= span) { x.done = true; if ('bounced' in x) x.bounced = x.bounced ?? false; }
  }
  for (const x of w.missed) if (x.done && x.result === undefined) x.result = (x.hit === 'target' ? x.target : x.hit === 'stop' ? -x.stop : (x.last / x.p0 - 1) * 100) - 1; // 1% for costs
  for (const x of w.after) if (x.done && x.afterMax === undefined) { x.afterMax = (x.max / x.p0 - 1) * 100; x.afterEnd = (x.last / x.p0 - 1) * 100; }
  save(); draw(); emit('watch');
}
setInterval(() => { if (document.visibilityState === 'visible' || state.wasRunning) void follow(); }, 3 * 60_000);
setTimeout(follow, 20_000);

// ---------- dip weather and the guard ----------
export function weather() {
  const since = Date.now() - 6 * H, seen = book().dips.filter((x) => x.done && x.at >= since && x.mode === state.mode && x.preset === state.preset), up = seen.filter((x) => x.bounced).length;
  const rate = seen.length ? up / seen.length : null;
  const level = seen.length < 5 ? 'unknown' : rate >= 0.5 ? 'good' : rate >= 0.35 ? 'mixed' : rate >= 0.2 ? 'storm' : 'severe';
  return { n: seen.length, up, rate, level };
}
/** What the guard does to a new buy: 1 = full size, 0.5 = half, 0 = no new buys. Only when the guard is on ('auto'). */
export function weatherFactor() { if (book().guard !== 'auto') return 1; const { level } = weather(); return level === 'severe' ? 0 : level === 'storm' ? 0.5 : 1; }

// ---------- summaries (also used by the self-ruling engine) ----------
// Practice never teaches live, and the other way round: each summary reads only the current mode.
export function missedByRule(preset = state.preset, cohort = null) {
  const out = {}; for (const x of book().missed) { if (!x.done || x.preset !== preset || (x.mode ?? 'paper') !== state.mode || (cohort && !learningSample(x, { ...cohort, preset, mode: state.mode }))) continue; (out[x.rule] ??= []).push(x); }
  return Object.fromEntries(Object.entries(out).map(([k, l]) => [k, { n: l.length, avg: l.reduce((a, b) => a + b.result, 0) / l.length, list: l }]));
}
export function afterByReason(preset = state.preset, cohort = null) {
  const out = {}; for (const x of book().after) { if (!x.done || x.preset !== preset || (x.mode ?? 'paper') !== state.mode || (cohort && !learningSample(x, { ...cohort, preset, mode: state.mode }))) continue; (out[x.reason] ??= []).push(x); }
  return Object.fromEntries(Object.entries(out).map(([k, l]) => [k, { n: l.length, max: l.reduce((a, b) => a + b.afterMax, 0) / l.length, end: l.reduce((a, b) => a + b.afterEnd, 0) / l.length }]));
}

// ---------- the panel ----------
const RULE = { cost: 'Cost over 3%', token: 'Token powers', launch: 'Launch check', depth: 'Not deep enough', rsi: 'RSI too high', collapse: 'Collapsing coin' };
const EXIT = { stop: 'Stop', 'trailing-stop': 'Trailing stop', target: 'Target', time: 'The clock', step: 'Profit step', manual: 'Sold by you', order: 'Your order', 'took-out': 'Took out stake', 'my stop': 'My stop', 'my target': 'My target', 'trend-break': 'Trend break', 'get-me-out': 'Get me out' };
export function draw() {
  const box = $('watch'); if (!box) return; const w = book(), wx = weather();
  const gauge = el('div', `weather ${wx.level}`), word = { good: 'GOOD WEATHER', mixed: 'MIXED', storm: 'STORM', severe: 'SEVERE STORM', unknown: 'LEARNING' }[wx.level];
  gauge.append(el('b', '', word), el('span', '', wx.n ? `${wx.up} of ${wx.n} deep dips bounced +5% within the hour (last 6 h)` : 'Needs 5 deep dips seen in the last 6 hours. Keep the impi out.'));
  const bar = el('div', 'wbar'), fill = el('i', `w${wx.rate === null ? 0 : Math.round(wx.rate * 10)}`); bar.append(fill); gauge.append(bar);
  const guard = el('div', 'row'), sel = el('select'); sel.id = 'weather-guard'; for (const [v, t] of [['report', 'Report only'], ['auto', 'Guard on: half size in a storm, no new buys in a severe storm'], ['off', 'Off']]) { const o = el('option', '', t); o.value = v; sel.append(o); } sel.value = w.guard;
  sel.addEventListener('change', () => { w.guard = sel.value; save(); emit('say', { who: 'induna', text: w.guard === 'auto' ? 'Weather guard on: half size in a storm, no new buys in a severe storm.' : 'Weather guard reports only; it does not change trades.' }); });
  const l = el('label', 'small', 'Weather guard'); l.htmlFor = 'weather-guard'; guard.append(l, sel);
  const m = missedByRule(), mt = el('table', 'book'), mh = el('tr'); for (const h of ['REFUSED FOR', 'COINS', 'IF BOUGHT', 'THE RULE']) mh.append(el('th', '', h)); mt.append(el('thead'), el('tbody')); mt.tHead.append(mh);
  for (const [k, v] of Object.entries(m).sort((a, b) => b[1].n - a[1].n)) { const tr = el('tr'); tr.append(el('td', '', RULE[k] ?? k), el('td', '', String(v.n)), el('td', v.avg >= 0 ? 'up' : 'down', pct(v.avg)), el('td', v.avg < 0 ? 'up' : 'down', v.n < 5 ? 'too few yet' : v.avg < 0 ? 'saved money' : 'cost money')); mt.tBodies[0].append(tr); }
  if (!Object.keys(m).length) { const tr = el('tr'), td = el('td', 'small', 'Refused coins are followed for 3 hours; results appear here.'); td.colSpan = 4; tr.append(td); mt.tBodies[0].append(tr); }
  const a = afterByReason(), at = el('table', 'book'), ah = el('tr'); for (const h of ['SOLD BY', 'SALES', 'HIGH AFTER', '3 H LATER']) ah.append(el('th', '', h)); at.append(el('thead'), el('tbody')); at.tHead.append(ah);
  for (const [k, v] of Object.entries(a).sort((x, y) => y[1].n - x[1].n)) { const tr = el('tr'); tr.append(el('td', '', EXIT[k] ?? k), el('td', '', String(v.n)), el('td', '', pct(v.max)), el('td', v.end > 0 ? 'down' : 'up', pct(v.end))); at.tBodies[0].append(tr); }
  if (!Object.keys(a).length) { const tr = el('tr'), td = el('td', 'small', 'Each whole sale is followed for 3 hours; results appear here.'); td.colSpan = 4; tr.append(td); at.tBodies[0].append(tr); }
  const pending = [...w.missed, ...w.after, ...w.dips].filter((x) => !x.done).length;
  box.replaceChildren(el('h3', 'label sub', 'DIP WEATHER'), gauge, guard, el('h3', 'label sub', 'MISSED TRADES · WOULD THE RULE HAVE PAID?'), mt, el('h3', 'label sub', 'AFTER THE SALE · TOO EARLY OR JUST IN TIME?'), at, el('p', 'small', `${pending} being followed now. Prices sampled every 3 minutes; a red “3 h later” means the coin kept rising after the sale.`));
}
on('mode', draw); on('strength', draw); on('synced', draw); on('trade', () => setTimeout(draw, 500));
draw();
