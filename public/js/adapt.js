// Self-ruling: Warrior adjusts its own dials from its own history, with guardrails.
//  - Only four dials may move (lib/presets.mjs ADAPT), one step at a time, inside ranges replays have tested.
//    Safety rules (pool size, cost limit, launch and token checks, the stop itself) are never loosened by this.
//  - Every move needs enough evidence: a minimum number of trades and a clear, one-sided result.
//  - Checked after every sale. One move at a time: a move is on probation for its next 8 trades: if they do worse than the 10
//    before it, it is undone and that dial is left alone for 3 days.
//  - Modes: Auto (moves by itself), Suggest (proposes; you press Apply), Off.
// Evidence comes from the trade history and the watchtower (watch.js). Everything is written to the history below.
import { state, save, emit, on } from './store.js';
import { ADAPT, resolveRules } from '/vendor/lib/presets.js';
import { evidence as decide, judge as verdictOf, baselineOf, perDayOf, MIN_GAP_MS } from '/vendor/lib/adapt.js';
import { afterByReason, missedByRule } from './watch.js';

const H = 3_600_000, DAY = 24 * H, $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const avg = (l, f) => l.length ? l.reduce((a, x) => a + f(x), 0) / l.length : 0;
const SHORT = { holdHours: 'Sell after', targetPct: 'Target', dipBelowPct: 'Dip depth', lossCooldownMinutes: 'Re-buy wait after a loss' };
const UNITS = { holdHours: (v) => `${v} h`, targetPct: (v) => `+${v}%`, dipBelowPct: (v) => `${v}%`, lossCooldownMinutes: (v) => `${v / 60} h` };

function book(preset = state.preset) { state.adapt ??= { mode: 'auto' }; state.adapt[preset] ??= { dials: {}, history: [], last: 0, probation: null, locked: {}, proposal: null }; return state.adapt[preset]; }
const presetOf = (t) => t.preset ?? String(t.rules ?? '').split(/[-+~]/)[0];
const value = (preset, key) => { const r = resolveRules({ preset, adapt: book(preset).dials }); return ADAPT[key].of === 'settings' ? r.settings[key] : r.risk[key]; };

/** Closed positions for a strength in the current mode: part-sales folded in, newest last. */
export function positions(preset = state.preset, since = Date.now() - 14 * DAY) {
  const map = new Map();
  for (const t of state.trades) {
    if (t.mode !== state.mode || presetOf(t) !== preset || !Number.isFinite(t.openedAt)) continue;
    const k = `${t.mint}:${t.openedAt}`, p = map.get(k) ?? { mint: t.mint, symbol: t.symbol, openedAt: t.openedAt, solIn: 0, pnl: 0, done: false, peakPct: null, depthPct: null };
    p.solIn += t.solIn; p.pnl += t.pnlSol; if (!t.partial) { p.done = true; p.reason = t.reason; p.closedAt = t.closedAt; p.peakPct = t.peakPct ?? null; p.depthPct = t.depthPct ?? null; p.rules = t.rules; }
    map.set(k, p);
  }
  return [...map.values()].filter((p) => p.done && p.closedAt >= since).map((p) => ({ ...p, pct: p.pnl / p.solIn * 100 })).sort((a, b) => a.closedAt - b.closedAt);
}

/** What the evidence says right now (lib/adapt.mjs decides; this only gathers the inputs). */
export function evidence(preset = state.preset) {
  return decide({ positions: positions(preset), after: afterByReason(preset), missed: missedByRule(preset), value: (k) => value(preset, k) });
}

function record(b, entry) { b.history.push({ at: Date.now(), ...entry }); while (b.history.length > 60) b.history.shift(); }
function apply(preset, move, by) {
  const b = book(preset);
  b.dials[move.key] = move.to; b.last = Date.now(); b.proposal = null;
  b.probation = { key: move.key, from: move.from, to: move.to, at: Date.now(), base: baselineOf(positions(preset)), perDay: perDayOf(positions(preset)) };
  record(b, { kind: 'change', key: move.key, from: move.from, to: move.to, why: move.why, by });
  save(); emit('rules-changed'); draw();
  emit('say', { who: 'induna', text: `Self-ruling: ${ADAPT[move.key].label} ${UNITS[move.key](move.from)} → ${UNITS[move.key](move.to)}. ${move.why} On probation for the next 8 trades.` });
}
function judge(preset) {
  const b = book(preset), pr = b.probation; if (!pr) return;
  const v = verdictOf({ positions: positions(preset), probation: pr }); if (!v) return;
  const now = v.now, worse = v.verdict === 'revert', after = { length: v.n };
  if (worse) {
    const r0 = resolveRules({ preset }), base = ADAPT[pr.key].of === 'settings' ? r0.settings[pr.key] : r0.risk[pr.key];
    if (pr.from === base) delete b.dials[pr.key]; else b.dials[pr.key] = pr.from;
    b.locked[pr.key] = Date.now() + 3 * DAY; record(b, { kind: 'revert', key: pr.key, from: pr.to, to: pr.from, why: `The ${after.length} trades since averaged ${pct(now)}${pr.base === null ? '' : `, against ${pct(pr.base)} before`}. Undone; this dial rests for 3 days.` });
    emit('say', { who: 'induna', text: `Self-ruling: undid ${ADAPT[pr.key].label} (${UNITS[pr.key](pr.to)} → ${UNITS[pr.key](pr.from)}). The trades since did worse.`, tone: 'down' }); emit('rules-changed');
  } else record(b, { kind: 'keep', key: pr.key, from: pr.from, to: pr.to, why: `The ${after.length} trades since averaged ${pct(now)}${pr.base === null ? '' : `, against ${pct(pr.base)} before`}. Kept.` });
  b.probation = null; save(); draw();
}
export function think() {
  const preset = state.preset, b = book(preset); state.adapt.mode ??= 'auto';
  judge(preset);
  if (state.adapt.mode === 'off' || b.probation || Date.now() - b.last < MIN_GAP_MS) { draw(); return; }
  const move = evidence(preset).find((m) => !((b.locked[m.key] ?? 0) > Date.now()));
  if (!move) { b.proposal = null; draw(); return; }
  if (state.adapt.mode === 'auto') apply(preset, move, 'auto');
  else { b.proposal = move; save(); draw(); }
}
setInterval(think, 30 * 60_000); on('trade', ({ side } = {}) => { if (side === 'sell') setTimeout(think, 2000); }); on('watch', think); setTimeout(think, 5000);

// ---------- the panel ----------
export function draw() {
  const box = $('adapt'); if (!box) return; const preset = state.preset, b = book(preset), mode = state.adapt.mode ?? 'auto';
  const sel = el('select'); sel.id = 'adapt-mode'; for (const [v, t] of [['auto', 'Auto: Warrior adjusts its own dials'], ['suggest', 'Suggest: I press Apply'], ['off', 'Off']]) { const o = el('option', '', t); o.value = v; sel.append(o); } sel.value = mode;
  sel.addEventListener('change', () => { state.adapt.mode = sel.value; save(); emit('say', { who: 'induna', text: sel.value === 'auto' ? 'Self-ruling is on: Warrior moves its own dials when the evidence is clear.' : sel.value === 'suggest' ? 'Self-ruling suggests moves; nothing changes until you press Apply.' : 'Self-ruling is off. The strength\'s dials stay as tested.' }); think(); });
  const lab = el('label', 'small', 'Self-ruling'); lab.htmlFor = 'adapt-mode'; const top = el('div', 'row'); top.append(lab, sel);
  const t = el('table', 'book'), hr = el('tr'); for (const h of ['DIAL', 'TESTED', 'NOW', 'RANGE']) hr.append(el('th', '', h)); t.append(el('thead'), el('tbody')); t.tHead.append(hr);
  const base = resolveRules({ preset });
  for (const [k, d] of Object.entries(ADAPT)) { const b0 = d.of === 'settings' ? base.settings[k] : base.risk[k], now = value(preset, k), tr = el('tr', now !== b0 ? 'moved' : '');
    tr.append(el('td', '', SHORT[k]), el('td', '', UNITS[k](b0)), el('td', '', `${UNITS[k](now)}${b.probation?.key === k ? ' · probation' : (b.locked[k] ?? 0) > Date.now() ? ' · resting' : ''}`), el('td', 'small', `${UNITS[k](d.min)}–${UNITS[k](d.max)}`)); t.tBodies[0].append(tr); }
  const parts = [top, t];
  if (b.proposal && mode === 'suggest') { const p = b.proposal, card = el('div', 'proposal'), go = el('button', 'btn small', 'Apply'), no = el('button', 'btn ghost small', 'Not now'); go.type = no.type = 'button';
    go.addEventListener('click', () => apply(preset, p, 'you')); no.addEventListener('click', () => { b.proposal = null; b.last = Date.now(); save(); draw(); });
    const row = el('div', 'row'); row.append(go, no); card.append(el('b', '', `${p.key === 'lossCooldownMinutes' ? 'Re-buy wait' : ADAPT[p.key].label}: ${UNITS[p.key](p.from)} → ${UNITS[p.key](p.to)}`), el('p', 'small', p.why), row); parts.push(card); }
  const ev = evidence(preset), P = positions(preset);
  parts.push(el('p', 'small', ev.length ? `Evidence now points to ${ev.length} move${ev.length === 1 ? '' : 's'}.` : `${P.length} positions closed under ${preset} in the last 14 days. No dial has enough one-sided evidence to move: that is the usual answer, and a good one.`));
  const hist = el('ol', 'ahist'); for (const h of [...b.history].reverse().slice(0, 6)) { const li = el('li', h.kind); li.append(el('span', 'small', new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), el('b', '', `${h.kind === 'change' ? 'Moved' : h.kind === 'revert' ? 'Undone' : 'Kept'} · ${ADAPT[h.key]?.label ?? h.key} ${UNITS[h.key] ? `${UNITS[h.key](h.from)} → ${UNITS[h.key](h.to)}` : ''}`), el('span', '', h.why)); hist.append(li); }
  if (b.history.length) parts.push(el('h3', 'label sub', 'WHAT IT DID AND WHY'), hist);
  box.replaceChildren(...parts);
}
on('mode', draw); on('strength', draw); on('synced', draw); draw();
