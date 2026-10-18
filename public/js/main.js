// The dashboard: draws the desk and wires every control. Trading logic lives in impi.js and trader.js.
import { state, save, on, emit, reload, exclusive, lock } from './store.js';
import { sync, syncNow } from './sync.js';
import { drawOrders, drawPortfolio } from './tools.js';
import { vault, owner, connectPhantom, disconnectPhantom, reconnectPhantom, fundFromPhantom, withdraw, liveBalance } from './wallet.js';
import { AGENTS, impi, start, stop, peek, rules } from './impi.js';
import { sell, sellAll, balance, heldSol, writeOff, swapped } from './trader.js';
import { receipt } from '/vendor/lib/receipt.js';
import { MARKET_TYPES } from '/vendor/lib/activity.js';
import { csvCell } from '/vendor/lib/portfolio.js';
import { validateBedtime, bedtimeText } from '/vendor/lib/mood.js';
import { startNet, setData } from './net.js';
import { rebasePosition } from '/vendor/lib/strategy.js';
/** As in Laugh: open positions take the new strength's stop and target at once. A stop that has already moved up to the price paid or above is kept. */
function followRules() { const s = rules().settings; let moved = 0; for (const p of state.positions) { if (p.mode !== state.mode) continue; const r = rebasePosition(p, s); if (!r) continue; p.target = r.target; p.stop = r.stop; p.baseStop = r.baseStop; p.rules = rules().version; moved++; } if (moved) emit('say', { who: 'induna', text: `${moved} open position${moved === 1 ? '' : 's'} now follow the new strength's stop and target.` }); }
import { line, hist, bars } from './charts.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const money = (n) => !Number.isFinite(n) ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

// ---------- live figures: one chip per agent, read-outs on the shield ----------
const fig = {};
function figures() {
  const scan = impi.lastScan, read = scan?.results ?? [], R = rules(), mine = state.trades.filter((t) => t.mode === state.mode && !t.partial), open = state.positions.filter((p) => p.mode === state.mode).length;
  const won = mine.filter((t) => t.pnlSol > 0).length, zone = read.filter((t) => t.analysis?.decision === 'enter').length, birds = read.reduce((n, t) => n + (t.smart?.count ?? 0), 0);
  fig.inhloli = scan ? `${scan.universe} WATCHED` : 'SCANNING';
  fig.isihlangu = scan ? `${scan.passedScreen}/${scan.universe} PASS` : '—';
  fig.umkhonto = `${zone} IN ZONE`;
  fig.izinyoni = `${birds} SMART BUYS`;
  fig.induna = `${open}/${R.risk.maxOpenPositions} OPEN`;
  fig.umlobi = mine.length ? `${mine.length} · ${Math.round(won / mine.length * 100)}% WIN` : '0 TRADES';
  const day = state.days?.[state.mode]?.start, eq = Number.parseFloat($('equity').textContent), ch = day && Number.isFinite(eq) ? (eq / day - 1) * 100 : null;
  const left = impi.nextAt ? Math.max(0, Math.ceil((impi.nextAt - Date.now()) / 1000)) : 0;
  setData({ agents: { ...fig }, running: impi.running, nextAt: impi.nextAt, slots: [open, R.risk.maxOpenPositions],
    top: Number.isFinite(eq) ? `${eq.toFixed(3)} SOL` : '', mid: ch === null ? '' : `${pct(ch)} TODAY`, midUp: (ch ?? 0) >= 0,
    next: impi.running ? `ROUND ${impi.rounds} · NEXT ${left}s` : 'RESTING', bottom: scan ? `SCAN ${Math.round(impi.scanMs)}ms · ${state.preset.toUpperCase()}` : state.preset.toUpperCase() });
}
setInterval(figures, 1000);

// ---------- agents and the live feed ----------
const said = {};
function drawAgents() {
  $('agents').replaceChildren(...AGENTS.map((a, i) => { const li = el('li', `agent ${Date.now() - (said[a.id]?.at ?? 0) < 4000 ? 'busy' : ''}`), dot = el('span', 'dot'); dot.dataset.i = String(i);
    const body = el('div'), top = el('div', 'agent-top'); top.append(el('b', '', `${a.glyph} ${a.name.toUpperCase()}`), el('span', `fig c${i}`, fig[a.id] ?? '—')); body.append(top, el('div', 'role', `${a.role} · ${a.job}`), el('div', 'say', said[a.id]?.text ?? 'Ready.')); li.append(dot, body); return li; }));
  document.querySelectorAll('.agent .dot').forEach((d) => d.classList.add(`c${d.dataset.i}`));
}
on('say', ({ who, text, tone }) => {
  said[who] = { text, at: Date.now() }; const a = AGENTS.find((x) => x.id === who);
  state.log.push({ at: Date.now(), who, text, tone }); if (state.log.length > 200) state.log.shift(); save();
  const li = el('li', tone ?? ''), t = el('time', '', new Date().toLocaleTimeString()); li.append(t, el('span', 'who', a ? a.name.toUpperCase() : who), document.createTextNode(text));
  $('log').prepend(li); while ($('log').children.length > 120) $('log').lastChild.remove();
  $('core-line').textContent = `${a?.glyph ?? ''} ${text}`; drawAgents();
});

// ---------- market panels ----------
on('scan', (scan) => {
  const read = scan.results ?? [];
  const activity = scan.activity;
  $('activity-basis').textContent = activity ? `Automatic scan attention · mature coins ${activity.matureIncluded ? 'included' : 'excluded'} · reported hourly USD turnover in observed lists, not net SOL inflow. ${activity.sourcesFailed ? `${activity.sourcesFailed} source${activity.sourcesFailed === 1 ? '' : 's'} unavailable.` : ''}` : 'Activity coverage unavailable for this scan.';
  $('activity-mix').textContent = activity?.groups?.filter((g) => g.coins).map((g) => `${g.label}: ${g.sharePct === null ? 'unknown' : g.sharePct.toFixed(1) + '%'} · ${g.selected} read / ${g.coins} seen`).join(' | ') ?? '';
  $('flow').replaceChildren(...read.slice(0, 14).map((t) => { const tr = el('tr'), c5 = t.change?.m5 ?? 0, c1 = t.change?.h1 ?? 0;
    const gap = t.analysis?.stretchPct, hot = Number.isFinite(gap) && gap <= -(rules().settings.dipBelowPct ?? 10); if (hot || t.analysis?.decision === 'enter') tr.className = 'hot';
    tr.append(el('td', '', String(t.symbol).slice(0, 10)), el('td', c5 >= 0 ? 'up' : 'down', pct(c5)), el('td', c1 >= 0 ? 'up' : 'down', pct(c1)), el('td', Number.isFinite(gap) && gap < 0 ? 'down' : '', Number.isFinite(gap) ? pct(gap) : '—'), el('td', '', money(t.volume1hUsd))); return tr; }));
  for (const [i, row] of [...$('flow').children].entries()) row.firstChild.append(el('small', 'coin-type', MARKET_TYPES[read[i].marketType] ?? ''));
  figures();
  hist($('dist-chart'), read.map((t) => t.analysis?.stretchPct), -(rules().settings.dipBelowPct ?? 10));
  bars($('bars'), read.map((t) => t.volume1hUsd ?? 0));
  ticker(scan);
});

function ticker(scan) {
  const R = rules(), s = R.settings, parts = [['MODE', state.mode === 'live' ? 'LIVE' : 'PRACTICE'], ['STRENGTH', state.preset.toUpperCase()], ['WATCHED', scan?.universe ?? '—'], ['READ', scan?.scanned ?? '—'], ['PASSED SHIELD', scan?.passedScreen ?? '—'], ['STRIKE', `RSI≤${s.dipRsi} · ≥${s.dipBelowPct}% UNDER`], ['STOP', `${s.dipStopPct}%`], ['STEPS', s.stepPct ? `+${s.stepPct}/+${s.stepPct * 2}%` : 'OFF'], ['TARGET', `+${s.targetPct}%`], ['CLOCK', `${s.holdHours}H`], ['MIN VOL', `$${(s.minVol1hUsd / 1000).toFixed(0)}K/H`], ['SLIPPAGE', `${(R.risk.slippageBps / 100).toFixed(1)}%`], ['FEE', '0%'], ['ROUND', impi.rounds || '—'], ['SCAN', impi.scanMs ? `${Math.round(impi.scanMs)}MS` : '—'], ['IN ZONE', (scan?.results ?? []).filter((t) => t.analysis?.decision === 'enter').length]];
  const run = () => { const s = el('span', 'tick-set'); s.append(...parts.flatMap(([k, v]) => [document.createTextNode(`${k} `), el('b', '', String(v)), document.createTextNode('  ·  ')])); return s; };
  $('ticker').replaceChildren(run(), run());
}

// ---------- equity, stats and positions ----------
let moneyDraw = 0;
async function drawMoney() {
  const request = ++moneyDraw, mode = state.mode;
  const mine = state.trades.filter((t) => t.mode === state.mode), whole = mine.filter((t) => !t.partial), won = whole.filter((t) => t.pnlSol > 0);
  let bal = 0; try { bal = await balance(); } catch { /* offline */ }
  if (request !== moneyDraw || mode !== state.mode) return;
  const eq = bal + heldSol(), curve = state.equity.filter((e) => e.mode === state.mode).map((e) => e.v);
  $('equity').textContent = `${eq.toFixed(4)} SOL`; $('pnl-mode').textContent = state.mode === 'live' ? 'LIVE' : 'PRACTICE';
  const first = curve[0] ?? eq, ch = first ? (eq / first - 1) * 100 : 0; $('pnl-change').textContent = curve.length ? pct(ch) : ''; $('pnl-change').className = `chg ${ch >= 0 ? 'up' : 'down'}`;
  line($('pnl-chart'), [...curve, eq]);
  $('s-trades').textContent = String(whole.length); $('s-win').textContent = whole.length ? `${Math.round(won.length / whole.length * 100)}%` : '—';
  const sum = mine.reduce((n, t) => n + t.pnlSol, 0), put = mine.reduce((n, t) => n + t.solIn, 0); $('s-avg').textContent = put ? pct(sum / put * 100) : '—';
  const open = state.positions.filter((p) => p.mode === state.mode); $('s-open').textContent = String(open.length);
  const pcts = whole.map((t) => t.pnlPct), gains = mine.filter((t) => t.pnlSol > 0).reduce((n, t) => n + t.pnlSol, 0), losses = -mine.filter((t) => t.pnlSol < 0).reduce((n, t) => n + t.pnlSol, 0), held = whole.filter((t) => t.openedAt).map((t) => (t.closedAt - t.openedAt) / 60000);
  $('s-best').textContent = pcts.length ? pct(Math.max(...pcts)) : '—'; $('s-worst').textContent = pcts.length ? pct(Math.min(...pcts)) : '—';
  $('s-pf').textContent = losses > 0 ? (gains / losses).toFixed(2) : gains > 0 ? '∞' : '—'; $('s-hold').textContent = held.length ? `${Math.round(held.reduce((a, b) => a + b, 0) / held.length)}m` : '—';
  $('s-best').className = 'up'; $('s-worst').className = 'down';
  $('positions').replaceChildren(...(open.length ? open.map((p) => { const tr = el('tr'), now = p.empty ? 0 : Number.isFinite(p.nowSol) ? p.nowSol + (p.rentSol ?? 0) : p.solIn, g = p.empty ? -100 : (Number.isFinite(p.nowSol) ? p.nowSol / swapped(p) - 1 : 0) * 100, b = el('button', 'sell', 'Sell'); b.type = 'button';
    b.addEventListener('click', async () => { b.disabled = true; try { await exclusive(() => sell(p, 'manual')); } catch (e) { emit('say', { who: 'induna', text: `${p.symbol}: ${e.message}`, tone: 'down' }); } void drawMoney(); });
    const name = el('a', '', `${p.symbol}${p.dip ? ' · dip' : ''}`); name.href = `https://dexscreener.com/solana/${p.mint}`; name.target = '_blank'; name.rel = 'noopener';
    const px = p.last ?? p.entry, toStop = (p.stop / px - 1) * 100, toTgt = (p.target / px - 1) * 100, span = el('td', 'range'), bar = el('span', 'rbar'), mark = el('i'), at = Math.max(0, Math.min(1, (px - p.stop) / ((p.target - p.stop) || 1)));
    mark.className = `m${Math.round(at * 10)}`; bar.append(mark); span.append(el('span', 'down', pct(toStop)), bar, el('span', 'up', pct(toTgt)));
    const mins = Math.round((Date.now() - p.openedAt) / 60000);
    tr.append(el('td'), el('td', '', p.solIn.toFixed(4)), el('td', '', now.toFixed(4)), el('td', g >= 0 ? 'up' : 'down', pct(g)), span, el('td', '', `${mins}m`), el('td', '', ''));
    // labels for the phone layout, where each position is a stacked card
    ['', 'In', 'Now', 'P/L', 'Stop · price · target', 'Held', ''].forEach((l, k) => { tr.children[k].dataset.l = l; }); tr.firstChild.append(name); if (p.empty) tr.firstChild.append(el('span', 'tagx', 'POOL EMPTY')); const m = el('button', 'sell', 'Manage'); m.type = 'button'; m.addEventListener('click', () => emit('position-tools', p));
    if (p.empty) { const w = el('button', 'sell', 'Write off'); w.type = 'button'; let armedW = 0; w.addEventListener('click', () => { if (Date.now() - armedW > 5000) { armedW = Date.now(); w.textContent = 'Tap again: record it as lost'; return; } writeOff(p); void drawMoney(); }); tr.lastChild.append(w); } else tr.lastChild.append(m, b); if (p.ownStop || p.ownTarget) tr.firstChild.append(el('span', 'tagx mine', 'MY EXITS')); return tr; })
    : [(() => { const tr = el('tr'), td = el('td', 'small', 'Nothing open. The impi buys only in the strike zone.'); td.colSpan = 7; tr.append(td); return tr; })()]));
}
on('equity', drawMoney); on('positions', drawMoney); on('trade', drawMoney); setInterval(() => { if (state.positions.length) void drawMoney(); }, 15_000);

// ---------- controls ----------
function drawControls() {
  $('mode-paper').classList.toggle('on', state.mode === 'paper'); $('mode-live').classList.toggle('on', state.mode === 'live');
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('on', b.dataset.preset === state.preset));
  $('go').textContent = impi.running ? 'Call the impi back' : state.mode === 'live' ? 'Send the impi (real SOL)' : 'Send the impi (practice)';
  $('connect').textContent = owner.address ? 'Disconnect' : 'Connect Phantom'; $('phantom-info').textContent = owner.address ? `Phantom ${owner.address.slice(0, 4)}…${owner.address.slice(-4)}` : '';
  ticker(impi.lastScan);
}
const setMode = (m) => { if (lock.busy || impi.starting) { emit('say', { who: 'induna', text: 'Wait for the current action to finish before switching modes.' }); return; } if (impi.running) { emit('say', { who: 'induna', text: 'Call the impi back before switching between practice and live.' }); return; } state.mode = m; save(); drawControls(); drawWallet(); drawPortfolio(); drawOrders(); emit('mode'); void drawMoney(); };
$('mode-paper').addEventListener('click', () => setMode('paper'));
$('mode-live').addEventListener('click', () => setMode('live'));
document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => { if (lock.busy || impi.starting) { emit('say', { who: 'induna', text: 'Wait for the current action to finish before changing strength.' }); return; } state.preset = b.dataset.preset; followRules(); save(); drawControls(); emit('strength'); emit('say', { who: 'induna', text: `Strength set to ${b.textContent}: ${rules().risk.maxOpenPositions} coins at once, ${rules().risk.riskPerTradePct}% of the wallet at risk a trade.` }); void peek(); }));
let armed = 0;
$('go').addEventListener('click', () => {
  if (impi.running) { stop(); drawControls(); return; }
  if (state.mode === 'live' && Date.now() - armed > 6000) { armed = Date.now(); $('go').textContent = 'Tap again: this trades REAL SOL'; setTimeout(drawControls, 6000); return; }
  $('go').disabled = true; start().then((why) => { if (why) emit('say', { who: 'induna', text: why, tone: 'down' }); }).finally(() => { $('go').disabled = false; drawControls(); });
});
let outArmed = 0;
$('out').addEventListener('click', async () => {
  if (!state.positions.some((p) => p.mode === state.mode)) { emit('say', { who: 'induna', text: 'Nothing is open to sell.' }); return; }
  // Live: a second tap within six seconds, so one stray tap never sells real positions.
  if (state.mode === 'live' && Date.now() - outArmed > 6000) { outArmed = Date.now(); $('out').textContent = 'Tap again: sell every LIVE position now'; setTimeout(() => { $('out').textContent = 'Get me out: sell everything'; }, 6000); return; }
  $('out').disabled = true; try { await exclusive(sellAll); } catch (e) { emit('say', { who: 'induna', text: e.message, tone: 'down' }); } finally { $('out').disabled = false; $('out').textContent = 'Get me out: sell everything'; void drawMoney(); }
});
// The full history as a spreadsheet file: every sale, its costs already inside the result, practice and live marked.
$('csv').addEventListener('click', () => {
  const rows = [['closed_at_utc', 'mode', 'coin', 'kind', 'sol_in', 'sol_out', 'result_sol', 'result_pct', 'why_closed', 'part_sale', 'opened_at_utc', 'minutes_held', 'rules_version', 'round_trip_cost_pct', 'coin_address'], ...state.trades.map((t) => [new Date(t.closedAt).toISOString(), t.mode === 'live' ? 'live' : 'practice', t.symbol, t.style ?? '', t.solIn.toFixed(6), t.solOut.toFixed(6), t.pnlSol.toFixed(6), t.pnlPct.toFixed(2), t.reason, t.partial ? 'yes' : 'no', t.openedAt ? new Date(t.openedAt).toISOString() : '', t.openedAt ? ((t.closedAt - t.openedAt) / 60000).toFixed(1) : '', t.rules ?? '', Number.isFinite(t.costPct) ? t.costPct.toFixed(2) : '', t.mint])];
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n'), a = el('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `warrior-trades-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
// Reset the day (from Laugh): today's loss count starts again from what the wallet is worth now. A second tap confirms.
let dayArmed = 0;
$('reset-day').addEventListener('click', async () => {
  if (Date.now() - dayArmed > 6000) { dayArmed = Date.now(); $('reset-day').textContent = 'Tap again: start today from now'; setTimeout(() => { $('reset-day').textContent = 'Reset the day'; }, 6000); return; }
  let eq = 0; try { eq = (await balance()) + heldSol(); } catch { return; }
  state.days ??= {}; state.days[state.mode] = { day: new Date().toISOString().slice(0, 10), start: eq }; save(); $('reset-day').textContent = 'Reset the day';
  emit('say', { who: 'induna', text: `The day starts again from ${eq.toFixed(4)} SOL. The daily loss limit counts from here.` });
});
$('reset').addEventListener('click', () => {
  if (lock.busy || impi.starting || impi.running || state.mode !== 'paper') { emit('say', { who: 'umlobi', text: 'Practice can be reset in practice mode, with the impi resting and no action in progress.' }); return; }
  state.paperSol = 1; state.positions = state.positions.filter((p) => p.mode !== 'paper'); state.trades = state.trades.filter((t) => t.mode !== 'paper'); state.equity = state.equity.filter((e) => e.mode !== 'paper'); if (state.days) delete state.days.paper;
  state.orders = state.orders.filter((o) => o.mode !== 'paper'); save(); drawOrders(); drawPortfolio(); emit('mode'); emit('say', { who: 'umlobi', text: 'Practice reset to a pretend 1 SOL.' }); void drawMoney();
});
$('connect').addEventListener('click', async () => { try { if (owner.address) await disconnectPhantom(); else await connectPhantom(); } catch (e) { emit('say', { who: 'induna', text: e.message, tone: 'down' }); } drawControls(); drawWallet(); });
on('running', () => { state.wasRunning = impi.running; save(); drawControls(); }); on('wallet', () => { drawControls(); drawWallet(); });

// ---------- the trading wallet panel and its small dialog ----------
const dlg = $('dlg');
let dialogVersion = 0, backupTimer = 0, backupDialog = null;
function clearSecretInputs() { for (const i of dlg.querySelectorAll('input[type=password]')) i.value = ''; }
function hideBackup() {
  clearSecretInputs();
  if (!backupDialog || !dlg.open) return;
  const config = backupDialog; ask(config);
  $('dlg-status').textContent = 'Backup key hidden. Enter your passphrase again to show it.';
}
window.addEventListener('blur', hideBackup);
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') hideBackup(); });
window.addEventListener('pagehide', hideBackup);
on('vault-locked', hideBackup);
$('dlg-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => { if (dlg.open) return; dialogVersion++; clearTimeout(backupTimer); backupDialog = null; clearSecretInputs(); $('dlg-body').replaceChildren(); $('dlg-status').textContent = ''; $('dlg-go').onclick = null; });
function ask(config) {
  const { title, text, fields = [], action, run, sensitive = false } = config;
  clearTimeout(backupTimer); backupDialog = sensitive ? config : null;
  $('dlg-status').setAttribute('aria-live', sensitive ? 'off' : 'polite');
  const version = ++dialogVersion;
  $('dlg-title').textContent = title; const body = $('dlg-body'); body.replaceChildren(el('p', 'small', text)); $('dlg-status').textContent = '';
  const inputs = {}; for (const f of fields) { const wrap = el('div', 'field'), l = el('label', '', f.label), i = el('input'); i.type = f.type ?? 'password'; i.autocomplete = f.ac ?? (i.type === 'password' ? 'current-password' : 'off'); if (i.type === 'password') { i.name = f.id === 'k' ? 'backup-key' : 'password'; i.spellcheck = false; i.autocapitalize = 'none'; i.setAttribute('autocorrect', 'off'); } if (i.type === 'number') { i.step = 'any'; i.min = '0.000000001'; i.inputMode = 'decimal'; } i.id = `f-${f.id}`; l.htmlFor = i.id; wrap.append(l, i); body.append(wrap); inputs[f.id] = i; }
  // A hidden username lets the browser's password manager save and fill the passphrase for this one wallet.
  if (fields.some((f) => (f.type ?? 'password') === 'password')) { const u = el('input'); u.type = 'text'; u.name = 'username'; u.autocomplete = 'username'; u.value = 'Warrior trading wallet'; u.hidden = true; body.prepend(u); }
  for (const i of Object.values(inputs)) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dlg-go').click(); } });
  const go = $('dlg-go'); go.textContent = action; go.hidden = !action; go.disabled = false;
  go.onclick = async () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    for (const i of Object.values(inputs)) if (i.type === 'password') i.value = '';
    go.disabled = true; $('dlg-status').textContent = 'Working...';
    try {
      const out = await run(values);
      if (version === dialogVersion && dlg.open) {
        if (typeof out === 'string') { $('dlg-status').textContent = out; go.hidden = true; if (sensitive) { state.backedUp = true; save(); backupTimer = setTimeout(hideBackup, 45_000); } }
        else dlg.close();
      }
      drawWallet(); void drawMoney();
    } catch (e) { if (version === dialogVersion && dlg.open) { $('dlg-status').textContent = e.message; go.disabled = false; } }
    finally { for (const [id, i] of Object.entries(inputs)) if (i.type === 'password') values[id] = ''; }
  };
  if (!dlg.open) dlg.showModal();
}
// Money you move in or out of the live wallet is not a gain or a loss: the day's starting equity moves with it, so a
// withdrawal never trips the daily loss limit and a deposit never hides a real loss.
function moved(sol) { const d = state.days?.live; if (d && Number.isFinite(d.start) && Number.isFinite(sol)) { d.start = Math.max(0, d.start + sol); save(); } }
function transferMessage(result, confirmed) {
  const text = result.outcome === 'confirmed' ? confirmed : result.outcome === 'failed' ? 'The transfer failed on-chain. Check the wallet before trying again.' : `Transfer submitted, but confirmation is still unknown. Check the wallet before sending again. Transaction: ${result.signature}`;
  emit('say', { who: 'umlobi', text, tone: result.outcome === 'confirmed' ? 'up' : 'down' });
  return text;
}
async function drawWallet() {
  const box = $('w-body'); box.replaceChildren();
  if (!vault.exists) {
    box.append(el('p', 'warn', 'Your trading wallet is locked with a passphrase you choose. It works on every phone and browser you open Warrior on: make it once here, then use "Open my wallet from another device" with the same passphrase. Lose the passphrase and the backup key, and the wallet is gone. Keep only money you can lose in it.'));
    const row = el('div', 'row'), make = el('button', 'btn', 'Make my trading wallet'), rest = el('button', 'btn ghost', 'Restore from a backup key'); make.type = rest.type = 'button';
    make.addEventListener('click', () => ask({ title: 'Make your trading wallet', text: 'Choose a unique passphrase of 15+ characters (four or more random words work well). It locks the wallet, and it is how you open the same wallet on your other devices.', fields: [{ id: 'p', label: 'PASSPHRASE', ac: 'new-password' }, { id: 'a', label: 'AGAIN', ac: 'new-password' }], action: 'Make wallet', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.create(v.p); state.backedUp = false; save(); } }));
    rest.addEventListener('click', () => ask({ title: 'Restore a trading wallet', text: 'Paste the backup key (from Warrior or exported from Phantom) and choose a passphrase.', fields: [{ id: 'k', label: 'BACKUP KEY', type: 'password', ac: 'off' }, { id: 'p', label: 'PASSPHRASE' }, { id: 'a', label: 'AGAIN' }], action: 'Restore', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.restore(v.k.trim(), v.p); state.backedUp = true; save(); } }));
    const other = el('button', 'btn ghost', 'Open my wallet from another device'); other.type = 'button';
    other.addEventListener('click', () => ask({ title: 'Open your wallet from another device', text: 'Type the passphrase of the trading wallet you made on your other phone or computer. Warrior finds the locked copy that device synced and opens it here. Your passphrase never leaves this device; only an id made from it is sent.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Find and open', run: async (v) => { await vault.fromOtherDevice(v.p); state.backedUp = true; save(); } }));
    row.append(make, rest, other); box.append(row, syncLine()); return;
  }
  const copy = el('button', 'sell', 'Copy'), scan = el('a', 'small', 'Solscan'), who = el('div', 'addr', vault.address); copy.type = 'button'; scan.href = `https://solscan.io/account/${vault.address}`; scan.target = '_blank'; scan.rel = 'noopener';
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(vault.address); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it'; } setTimeout(() => { copy.textContent = 'Copy'; }, 1500); });
  const head = el('div', 'row'); head.append(el('span', 'small', vault.unlocked ? 'UNLOCKED IN THIS TAB' : 'LOCKED · unlock after every refresh: the key is only ever held in memory'), copy, scan);
  box.append(head, who);
  const bal = el('div', 'big', '…'); box.append(bal); liveBalance().then((s) => { bal.textContent = `${s.toFixed(4)} SOL`; }).catch(() => { bal.textContent = 'balance unavailable'; });
  const row = el('div', 'row'), add = (label, ghost, fn) => { const b = el('button', `btn ${ghost ? 'ghost' : ''}`, label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); };
  if (!vault.unlocked && vault.hasPasskey) add('Unlock with passkey', false, async () => { try { await vault.unlockDevice(); } catch (e) { emit('say', { who: 'induna', text: `${e?.name === 'NotAllowedError' ? 'The passkey prompt was cancelled' : e.message}. The passphrase still works.`, tone: 'down' }); } });
  if (vault.unlocked && !vault.hasPasskey && vault.passkeySupported) add('Add a passkey (fingerprint or face)', true, async () => { try { await vault.addPasskey(); emit('say', { who: 'induna', text: 'Passkey added: this device can unlock the wallet with your fingerprint, face or PIN. The passphrase still works.' }); } catch (e) { emit('say', { who: 'induna', text: `${e?.name === 'NotAllowedError' ? 'Passkey not added: the prompt was cancelled' : e.message}.`, tone: 'down' }); } });
  if (!vault.unlocked) add(vault.hasPasskey ? 'Unlock with passphrase' : 'Unlock', !!vault.hasPasskey, () => ask({ title: 'Unlock the trading wallet', text: 'It locks after five idle minutes when no live trading, positions or orders need it. Leaving the page locks it too.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Unlock', run: (v) => vault.unlock(v.p) }));
  else add('Lock', true, () => { vault.lock(); });
  add('Fund from Phantom', false, () => ask({ title: 'Send SOL from Phantom', text: owner.address ? 'Phantom will show the amount and ask you to approve.' : 'Connect Phantom first (top right).', fields: owner.address ? [{ id: 's', label: 'SOL TO SEND', type: 'number' }] : [], action: owner.address ? 'Send' : '', run: async (v) => { const r = await exclusive(() => fundFromPhantom(Number(v.s))); if (r.outcome === 'confirmed') moved(Number(v.s)); return transferMessage(r, 'Sent. It is in the trading wallet.'); } }));
  if (vault.unlocked) add('Send to Phantom', true, () => ask({ title: 'Send SOL back', text: `To ${owner.address ? 'your connected Phantom' : 'the address below'}. Keep about 0.01 SOL for fees.`, fields: [{ id: 's', label: 'SOL TO SEND', type: 'number' }, ...(owner.address ? [] : [{ id: 'to', label: 'TO ADDRESS', type: 'text' }])], action: 'Send', run: async (v) => { const r = await exclusive(() => withdraw(owner.address || v.to.trim(), Number(v.s))); if (r.outcome === 'confirmed') moved(-Number(v.s)); return transferMessage(r, 'Sent.'); } }));
  add(state.backedUp ? 'Backup key' : 'Save the backup key (needed for live)', !!state.backedUp, () => ask({ title: 'Your backup key', sensitive: true, text: 'Type the passphrase to show it. It hides after 45 seconds or when you leave this page. Anyone with this key controls the wallet: never paste it into a website or chat.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Show', run: async (v) => { const k = await vault.backup(v.p); return `Backup key: ${k}`; } }));
  box.append(row, syncLine());
}
function syncLine() { const p = el('p', 'small sync-line', sync.note); p.id = 'sync-status'; return p; }
// Another device's copy arrived: take it in and redraw everything.
on('synced', () => { reload(); drawControls(); void drawMoney(); drawOrders(); drawPortfolio(); });
on('vault-open', () => void syncNow());

// ---------- scorecard ----------
import { PRESETS, score, resetBooks } from './shadow.js';
function drawScore() {
  const rows = PRESETS.map((k) => [k, score(k)]), ready = rows.filter(([, s]) => s.trades >= 10), best = ready.length ? ready.reduce((a, b) => (b[1].changePct > a[1].changePct ? b : a))[0] : null;
  $('score').replaceChildren(...rows.map(([k, s]) => { const tr = el('tr', k === best ? 'lead' : ''), name = el('td', '', `${k.toUpperCase()}${k === state.preset ? ' · ON' : ''}`);
    tr.append(name, el('td', s.changePct >= 0 ? 'up' : 'down', pct(s.changePct)), el('td', '', `${s.trades}${s.open ? ` +${s.open}` : ''}`), el('td', '', s.winPct === null ? '—' : `${Math.round(s.winPct)}%`), el('td', s.avgSol === null ? '' : s.avgSol >= 0 ? 'up' : 'down', s.avgSol === null ? '—' : `${s.avgSol >= 0 ? '+' : ''}${s.avgSol.toFixed(4)}`), el('td', '', String(s.worstStreak))); return tr; }));
  const since = Math.round((Date.now() - score('balanced').since) / 3_600_000);
  $('score-note').textContent = best ? `${best.toUpperCase()} leads after ${since}h. Past results, on estimates: they do not promise the next week.` : `Comparing needs 10 trades per strength; ${since}h so far. Keep the impi out to fill it in.`;
  $('pause-after').value = String(state.pauseAfter ?? 4);
}
$('pause-after').addEventListener('change', () => { state.pauseAfter = Number($('pause-after').value); save(); emit('say', { who: 'induna', text: state.pauseAfter ? `The impi will pause after ${state.pauseAfter} losing trades in a row.` : 'The impi will not pause for a losing streak (the daily loss limit still applies).' }); });
let scoreArmed = 0;
$('score-reset').addEventListener('click', () => { if (Date.now() - scoreArmed > 5000) { scoreArmed = Date.now(); $('score-reset').textContent = 'Tap again to reset'; setTimeout(() => { $('score-reset').textContent = 'Reset scorecard'; }, 5000); return; } resetBooks(); $('score-reset').textContent = 'Reset scorecard'; });
on('mode', drawScore); on('strength', drawScore); on('shadow', drawScore); on('synced', drawScore); drawScore();

// ---------- care: bedtime and the sweep (from Laugh) ----------
function drawCare() {
  const b = { on: false, stopAt: '23:00', closeAt: '', wakeAt: '07:00', ...(state.bedtime ?? {}) }, w = { on: false, to: '', keepSol: 0.2, ...(state.sweep ?? {}) };
  $('bed-on').checked = !!b.on; $('bed-stop').value = b.stopAt; $('bed-close').value = b.closeAt ?? ''; $('bed-wake').value = b.wakeAt; $('bed-text').textContent = bedtimeText(b);
  $('sweep-on').checked = !!w.on; $('sweep-to').value = w.to || owner.address || ''; $('sweep-keep').value = String(w.keepSol);
  $('sweep-text').textContent = w.on ? `After each whole live sale, with nothing left open, anything above ${w.keepSol} SOL goes to ${w.to.slice(0, 4)}…${w.to.slice(-4)}.` : 'Off. Profits stay in the trading wallet until you send them yourself.';
}
$('bed-save').addEventListener('click', () => {
  const next = { on: $('bed-on').checked, stopAt: $('bed-stop').value, closeAt: $('bed-close').value || null, wakeAt: $('bed-wake').value };
  if (next.on) { const v = validateBedtime(next); if (!v.ok) { $('bed-text').textContent = `${v.reasons.join('. ')}.`; return; } }
  state.bedtime = next; save(); drawCare(); emit('say', { who: 'induna', text: bedtimeText(next) });
});
$('sweep-save').addEventListener('click', () => {
  const to = $('sweep-to').value.trim(), keep = Number($('sweep-keep').value), on = $('sweep-on').checked;
  if (on && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) { $('sweep-text').textContent = 'That is not a Solana address.'; return; }
  if (on && to === vault.address) { $('sweep-text').textContent = 'That is the trading wallet itself. Choose your Phantom address.'; return; }
  if (!(keep >= 0.05 && keep <= 100)) { $('sweep-text').textContent = 'Keep 0.05 to 100 SOL to trade with.'; return; }
  state.sweep = { on, to, keepSol: keep }; save(); drawCare();
  emit('say', { who: 'umlobi', text: on ? `Sweep on: anything above ${keep} SOL goes to your address after each whole live sale, when nothing is open.` : 'Sweep off.' });
});
on('synced', drawCare); on('wallet', drawCare); drawCare();

// ---------- the honest receipt (from Laugh) ----------
export function showReceipt(t) {
  dialogVersion++; clearTimeout(backupTimer); backupDialog = null; $('dlg-go').onclick = null;
  const r = receipt(t), body = $('dlg-body'), table = el('div', 'receipt');
  $('dlg-title').textContent = 'Honest receipt';
  const meta = el('p', 'small', `${t.symbol} · closed ${new Date(t.closedAt).toLocaleString()} · ${t.reason}${t.partial ? ' (part)' : ''} · rules ${t.rules ?? '—'} · ${t.mode === 'live' ? 'live' : 'practice'}`);
  for (const l of r.lines) { const row = el('div', `rline ${l.kind ?? ''}`), left = el('div'); left.append(el('b', '', l.label)); if (l.note) left.append(el('span', '', l.note)); row.append(left, el('div', 'rsol', l.text)); table.append(row); }
  const tot = el('div', 'rline total'); tot.append(el('b', '', 'Costs you paid, in total'), el('div', 'rsol', `${r.costsSol?.toFixed(6) ?? '—'} SOL`));
  const res = el('div', `rline total ${r.resultSol >= 0 ? 'up' : 'down'}`); res.append(el('b', '', 'True result'), el('div', 'rsol', `${r.resultSol >= 0 ? '+' : '−'}${Math.abs(r.resultSol).toFixed(6)} SOL (${r.resultPct >= 0 ? '+' : ''}${r.resultPct.toFixed(2)}%)`));
  table.append(tot, res);
  const extra = []; if (t.exit && !['practice', 'none'].includes(t.exit)) { const a = el('a', 'small', 'See the sale on Solscan'); a.href = `https://solscan.io/tx/${t.exit}`; a.target = '_blank'; a.rel = 'noopener'; extra.push(a); }
  body.replaceChildren(meta, table, el('p', 'small', r.note), ...extra); $('dlg-status').textContent = ''; $('dlg-go').hidden = true; dlg.showModal();
}
on('receipt', showReceipt);

// ---------- dark mode ----------
function drawTheme() { const d = document.documentElement.dataset.theme === 'dark'; $('theme').setAttribute('aria-pressed', String(d)); $('theme').querySelector('.tt-l').textContent = d ? 'DARK' : 'LIGHT'; document.querySelector('meta[name=theme-color]').content = d ? '#120d1a' : '#fff8ec'; }
$('theme').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('warrior.theme', t); } catch { /* not kept */ } drawTheme(); if (impi.lastScan) emit('scan', impi.lastScan); void drawMoney(); });
drawTheme();

// ---------- start ----------
startNet($('net'), AGENTS); drawAgents(); drawControls(); drawWallet(); void drawMoney();
for (const m of state.log.slice(-30)) { const a = AGENTS.find((x) => x.id === m.who), li = el('li', m.tone ?? ''); li.append(el('time', '', new Date(m.at).toLocaleTimeString()), el('span', 'who', a ? a.name.toUpperCase() : m.who), document.createTextNode(m.text)); $('log').prepend(li); }
void reconnectPhantom();
// A refresh stops the impi. Practice picks up again by itself; live waits for you to unlock the wallet and send it again.
if (state.wasRunning && state.mode === 'paper') start().then((why) => { if (!why) emit('say', { who: 'induna', text: 'Picked up where the impi left off (practice).' }); drawControls(); });
else if (state.wasRunning) emit('say', { who: 'induna', text: 'The page was refreshed, so the live impi stopped. Unlock the wallet and send it again to keep watching your positions.', tone: 'down' });
void peek(); setInterval(() => { if (!impi.running && document.visibilityState === 'visible') void peek(); }, 120_000);
// The tab title shows equity and open positions at a glance.
setInterval(() => { const open = state.positions.filter((p) => p.mode === state.mode).length; document.title = `${impi.running ? '⚔ ' : ''}${$('equity').textContent} · ${open} open — Warrior`; }, 5000);
setInterval(drawAgents, 2000);
