// The dashboard: draws the desk and wires every control. Trading logic lives in impi.js and trader.js.
import { state, save, on, emit, reload, exclusive } from './store.js';
import { sync, syncNow } from './sync.js';
import { drawOrders, drawPortfolio } from './tools.js';
import { vault, owner, connectPhantom, disconnectPhantom, reconnectPhantom, fundFromPhantom, withdraw, liveBalance } from './wallet.js';
import { AGENTS, impi, start, stop, peek, rules } from './impi.js';
import { sell, sellAll, balance, heldSol } from './trader.js';
import { startNet, setData } from './net.js';
import { rebasePosition } from '/vendor/lib/strategy.js';
/** As in Laugh: open positions take the new strength's stop and target at once. A stop that has already moved up to the price paid or above is kept. */
function followRules() { const s = rules().settings; let moved = 0; for (const p of state.positions) { const r = rebasePosition(p, s); if (!r) continue; p.target = r.target; p.stop = r.stop; p.baseStop = r.baseStop; p.rules = rules().version; moved++; } if (moved) emit('say', { who: 'induna', text: `${moved} open position${moved === 1 ? '' : 's'} now follow the new strength's stop and target.` }); }
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
  $('flow').replaceChildren(...read.slice(0, 14).map((t) => { const tr = el('tr'), c5 = t.change?.m5 ?? 0, c1 = t.change?.h1 ?? 0;
    const gap = t.analysis?.stretchPct, hot = Number.isFinite(gap) && gap <= -(rules().settings.dipBelowPct ?? 10); if (hot || t.analysis?.decision === 'enter') tr.className = 'hot';
    tr.append(el('td', '', String(t.symbol).slice(0, 10)), el('td', c5 >= 0 ? 'up' : 'down', pct(c5)), el('td', c1 >= 0 ? 'up' : 'down', pct(c1)), el('td', Number.isFinite(gap) && gap < 0 ? 'down' : '', Number.isFinite(gap) ? pct(gap) : '—'), el('td', '', money(t.volume1hUsd))); return tr; }));
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
async function drawMoney() {
  const mine = state.trades.filter((t) => t.mode === state.mode), whole = mine.filter((t) => !t.partial), won = whole.filter((t) => t.pnlSol > 0);
  let bal = 0; try { bal = await balance(); } catch { /* offline */ }
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
  $('positions').replaceChildren(...(open.length ? open.map((p) => { const tr = el('tr'), now = Number.isFinite(p.nowSol) ? p.nowSol : p.solIn, g = (now / p.solIn - 1) * 100, b = el('button', 'sell', 'Sell'); b.type = 'button';
    b.addEventListener('click', async () => { b.disabled = true; try { await exclusive(() => sell(p, 'manual')); } catch (e) { emit('say', { who: 'induna', text: `${p.symbol}: ${e.message}`, tone: 'down' }); } void drawMoney(); });
    const name = el('a', '', `${p.symbol}${p.dip ? ' · dip' : ''}`); name.href = `https://dexscreener.com/solana/${p.mint}`; name.target = '_blank'; name.rel = 'noopener';
    const px = p.last ?? p.entry, toStop = (p.stop / px - 1) * 100, toTgt = (p.target / px - 1) * 100, span = el('td', 'range'), bar = el('span', 'rbar'), mark = el('i'), at = Math.max(0, Math.min(1, (px - p.stop) / ((p.target - p.stop) || 1)));
    mark.className = `m${Math.round(at * 10)}`; bar.append(mark); span.append(el('span', 'down', pct(toStop)), bar, el('span', 'up', pct(toTgt)));
    const mins = Math.round((Date.now() - p.openedAt) / 60000);
    tr.append(el('td'), el('td', '', p.solIn.toFixed(4)), el('td', '', now.toFixed(4)), el('td', g >= 0 ? 'up' : 'down', pct(g)), span, el('td', '', `${mins}m`), el('td', '', '')); tr.firstChild.append(name); if (p.empty) tr.firstChild.append(el('span', 'tagx', 'POOL EMPTY')); const m = el('button', 'sell', 'Manage'); m.type = 'button'; m.addEventListener('click', () => emit('position-tools', p)); tr.lastChild.append(m, b); if (p.ownStop || p.ownTarget) tr.firstChild.append(el('span', 'tagx mine', 'MY EXITS')); return tr; })
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
const setMode = (m) => { if (impi.running) { emit('say', { who: 'induna', text: 'Call the impi back before switching between practice and live.' }); return; } state.mode = m; save(); drawControls(); drawWallet(); void drawMoney(); };
$('mode-paper').addEventListener('click', () => setMode('paper'));
$('mode-live').addEventListener('click', () => setMode('live'));
document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => { state.preset = b.dataset.preset; followRules(); save(); drawControls(); emit('say', { who: 'induna', text: `Strength set to ${b.textContent}: ${rules().risk.maxOpenPositions} coins at once, ${rules().risk.riskPerTradePct}% of the wallet at risk a trade.` }); void peek(); }));
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
  const csv = rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(',')).join('\n'), a = el('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `warrior-trades-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('reset').addEventListener('click', () => {
  if (impi.running || state.mode !== 'paper') { emit('say', { who: 'umlobi', text: 'Practice can be reset in practice mode, with the impi resting.' }); return; }
  state.paperSol = 1; state.positions = state.positions.filter((p) => p.mode !== 'paper'); state.trades = state.trades.filter((t) => t.mode !== 'paper'); state.equity = state.equity.filter((e) => e.mode !== 'paper'); if (state.days) delete state.days.paper; save();
  emit('say', { who: 'umlobi', text: 'Practice reset to a pretend 1 SOL.' }); void drawMoney();
});
$('connect').addEventListener('click', async () => { try { if (owner.address) await disconnectPhantom(); else await connectPhantom(); } catch (e) { emit('say', { who: 'induna', text: e.message, tone: 'down' }); } drawControls(); drawWallet(); });
on('running', () => { state.wasRunning = impi.running; save(); drawControls(); }); on('wallet', () => { drawControls(); drawWallet(); });

// ---------- the trading wallet panel and its small dialog ----------
const dlg = $('dlg');
function ask({ title, text, fields = [], action, run }) {
  $('dlg-title').textContent = title; const body = $('dlg-body'); body.replaceChildren(el('p', 'small', text)); $('dlg-status').textContent = '';
  const inputs = {}; for (const f of fields) { const wrap = el('div', 'field'), l = el('label', '', f.label), i = el('input'); i.type = f.type ?? 'password'; i.autocomplete = f.ac ?? (i.type === 'password' ? 'current-password' : 'off'); if (i.type === 'password') i.name = 'password'; i.id = `f-${f.id}`; l.htmlFor = i.id; wrap.append(l, i); body.append(wrap); inputs[f.id] = i; }
  // A hidden username lets the browser's password manager save and fill the passphrase for this one wallet.
  if (fields.some((f) => (f.type ?? 'password') === 'password')) { const u = el('input'); u.type = 'text'; u.name = 'username'; u.autocomplete = 'username'; u.value = 'Warrior trading wallet'; u.hidden = true; body.prepend(u); }
  for (const i of Object.values(inputs)) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('dlg-go').click(); } });
  const go = $('dlg-go'); go.textContent = action; go.hidden = !action; go.disabled = false;
  go.onclick = async () => { go.disabled = true; $('dlg-status').textContent = 'Working…'; try { const out = await run(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); if (typeof out === 'string') { $('dlg-status').textContent = out; go.hidden = true; } else dlg.close(); drawWallet(); } catch (e) { $('dlg-status').textContent = e.message; go.disabled = false; } };
  dlg.showModal();
}
async function drawWallet() {
  const box = $('w-body'); box.replaceChildren();
  if (!vault.exists) {
    box.append(el('p', 'warn', 'Your trading wallet is locked with a passphrase you choose. It works on every phone and browser you open Warrior on: make it once here, then use "Open my wallet from another device" with the same passphrase. Lose the passphrase and the backup key, and the wallet is gone. Keep only money you can lose in it.'));
    const row = el('div', 'row'), make = el('button', 'btn', 'Make my trading wallet'), rest = el('button', 'btn ghost', 'Restore from a backup key'); make.type = rest.type = 'button';
    make.addEventListener('click', () => ask({ title: 'Make your trading wallet', text: 'Choose a passphrase of 10+ characters (a few random words work well). It locks the wallet, and it is how you open the same wallet on your other devices.', fields: [{ id: 'p', label: 'PASSPHRASE', ac: 'new-password' }, { id: 'a', label: 'AGAIN', ac: 'new-password' }], action: 'Make wallet', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.create(v.p); state.backedUp = false; save(); } }));
    rest.addEventListener('click', () => ask({ title: 'Restore a trading wallet', text: 'Paste the backup key (from Warrior or exported from Phantom) and choose a passphrase.', fields: [{ id: 'k', label: 'BACKUP KEY', type: 'text' }, { id: 'p', label: 'PASSPHRASE' }, { id: 'a', label: 'AGAIN' }], action: 'Restore', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.restore(v.k.trim(), v.p); state.backedUp = true; save(); } }));
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
  if (!vault.unlocked) add('Unlock', false, () => ask({ title: 'Unlock the trading wallet', text: 'It stays unlocked in this tab until you lock it or close the tab.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Unlock', run: (v) => vault.unlock(v.p) }));
  else add('Lock', true, () => { vault.lock(); });
  add('Fund from Phantom', false, () => ask({ title: 'Send SOL from Phantom', text: owner.address ? 'Phantom will show the amount and ask you to approve.' : 'Connect Phantom first (top right).', fields: owner.address ? [{ id: 's', label: 'SOL TO SEND', type: 'number' }] : [], action: owner.address ? 'Send' : '', run: async (v) => { const r = await fundFromPhantom(Number(v.s)); return r.outcome === 'confirmed' ? `Sent. It is in the trading wallet.` : `Sent; the network says: ${r.outcome}. Check the balance in a minute.`; } }));
  if (vault.unlocked) add('Send to Phantom', true, () => ask({ title: 'Send SOL back', text: `To ${owner.address ? 'your connected Phantom' : 'the address below'}. Keep about 0.01 SOL for fees.`, fields: [{ id: 's', label: 'SOL TO SEND', type: 'number' }, ...(owner.address ? [] : [{ id: 'to', label: 'TO ADDRESS', type: 'text' }])], action: 'Send', run: async (v) => { const r = await withdraw(owner.address || v.to.trim(), Number(v.s)); return r.outcome === 'confirmed' ? 'Sent.' : `Sent; the network says: ${r.outcome}.`; } }));
  add(state.backedUp ? 'Backup key' : 'Save the backup key (needed for live)', !!state.backedUp, () => ask({ title: 'Your backup key', text: 'Type the passphrase to show it. Anyone with this key controls the wallet: never paste it into a website or chat.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Show', run: async (v) => { const k = await vault.backup(v.p); state.backedUp = true; save(); return `Backup key: ${k}`; } }));
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
on('shadow', drawScore); on('synced', drawScore); drawScore();

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
