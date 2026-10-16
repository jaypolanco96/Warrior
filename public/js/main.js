// The dashboard: draws the desk and wires every control. Trading logic lives in impi.js and trader.js.
import { state, save, on, emit } from './store.js';
import { vault, owner, connectPhantom, disconnectPhantom, fundFromPhantom, withdraw, liveBalance } from './wallet.js';
import { AGENTS, impi, start, stop, peek, rules } from './impi.js';
import { sell, sellAll, balance, heldSol } from './trader.js';
import { startNet } from './net.js';
import { line, hist, bars } from './charts.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const money = (n) => !Number.isFinite(n) ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

// ---------- agents and the live feed ----------
const said = {};
function drawAgents() {
  $('agents').replaceChildren(...AGENTS.map((a, i) => { const li = el('li', `agent ${Date.now() - (said[a.id]?.at ?? 0) < 4000 ? 'busy' : ''}`), dot = el('span', 'dot'); dot.dataset.i = String(i); li.style && null;
    const body = el('div'); body.append(el('b', '', `${a.glyph} ${a.name.toUpperCase()}`), el('div', 'role', `${a.role} · ${a.job}`), el('div', 'say', said[a.id]?.text ?? 'Ready.')); li.append(dot, body); return li; }));
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
  $('flow').replaceChildren(...read.slice(0, 18).map((t) => { const tr = el('tr'), c5 = t.change?.m5 ?? 0, c1 = t.change?.h1 ?? 0;
    tr.append(el('td', '', String(t.symbol).slice(0, 10)), el('td', c5 >= 0 ? 'up' : 'down', pct(c5)), el('td', c1 >= 0 ? 'up' : 'down', pct(c1)), el('td', '', money(t.volume1hUsd))); return tr; }));
  hist($('dist-chart'), read.map((t) => t.analysis?.stretchPct), -(rules().settings.dipBelowPct ?? 10));
  bars($('bars'), read.map((t) => t.volume1hUsd ?? 0));
  ticker(scan);
});
function ticker(scan) {
  const R = rules(), s = R.settings, parts = [['MODE', state.mode === 'live' ? 'LIVE' : 'PRACTICE'], ['STRENGTH', state.preset.toUpperCase()], ['WATCHED', scan?.universe ?? '—'], ['READ', scan?.scanned ?? '—'], ['PASSED SHIELD', scan?.passedScreen ?? '—'], ['STRIKE', `RSI≤${s.dipRsi} · ≥${s.dipBelowPct}% UNDER`], ['STOP', `${s.dipStopPct}%`], ['STEPS', s.stepPct ? `+${s.stepPct}/+${s.stepPct * 2}%` : 'OFF'], ['TARGET', `+${s.targetPct}%`], ['CLOCK', `${s.holdHours}H`], ['MIN VOL', `$${(s.minVol1hUsd / 1000).toFixed(0)}K/H`], ['SLIPPAGE', `${(R.risk.slippageBps / 100).toFixed(1)}%`], ['FEE', '0%']];
  $('ticker').replaceChildren(...parts.flatMap(([k, v], i) => [document.createTextNode(`${i ? ' · ' : ''}${k} `), el('b', '', String(v))]));
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
  $('positions').replaceChildren(...(open.length ? open.map((p) => { const tr = el('tr'), now = Number.isFinite(p.nowSol) ? p.nowSol : p.solIn, g = (now / p.solIn - 1) * 100, b = el('button', 'sell', 'Sell'); b.type = 'button';
    b.addEventListener('click', async () => { b.disabled = true; try { await sell(p, 'manual'); } catch (e) { emit('say', { who: 'induna', text: `${p.symbol}: ${e.message}`, tone: 'down' }); } void drawMoney(); });
    tr.append(el('td', '', `${p.symbol}${p.dip ? ' · dip' : ''}`), el('td', '', p.solIn.toFixed(4)), el('td', '', now.toFixed(4)), el('td', g >= 0 ? 'up' : 'down', pct(g)), el('td', '', '')); tr.lastChild.append(b); return tr; })
    : [(() => { const tr = el('tr'), td = el('td', 'small', 'Nothing open. The impi buys only in the strike zone.'); td.colSpan = 5; tr.append(td); return tr; })()]));
}
on('equity', drawMoney); on('positions', drawMoney); on('trade', drawMoney);

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
document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => { state.preset = b.dataset.preset; save(); drawControls(); emit('say', { who: 'induna', text: `Strength set to ${b.textContent}: ${rules().risk.maxOpenPositions} coins at once, ${rules().risk.riskPerTradePct}% of the wallet at risk a trade.` }); void peek(); }));
let armed = 0;
$('go').addEventListener('click', () => {
  if (impi.running) { stop(); drawControls(); return; }
  if (state.mode === 'live' && Date.now() - armed > 6000) { armed = Date.now(); $('go').textContent = 'Tap again: this trades REAL SOL'; setTimeout(drawControls, 6000); return; }
  const why = start(); if (why) emit('say', { who: 'induna', text: why, tone: 'down' }); drawControls();
});
$('out').addEventListener('click', async () => { if (!state.positions.some((p) => p.mode === state.mode)) return; $('out').disabled = true; try { await sellAll(); } finally { $('out').disabled = false; void drawMoney(); } });
$('connect').addEventListener('click', async () => { try { if (owner.address) await disconnectPhantom(); else await connectPhantom(); } catch (e) { emit('say', { who: 'induna', text: e.message, tone: 'down' }); } drawControls(); drawWallet(); });
on('running', drawControls); on('wallet', () => { drawControls(); drawWallet(); });

// ---------- the trading wallet panel and its small dialog ----------
const dlg = $('dlg');
function ask({ title, text, fields = [], action, run }) {
  $('dlg-title').textContent = title; const body = $('dlg-body'); body.replaceChildren(el('p', 'small', text)); $('dlg-status').textContent = '';
  const inputs = {}; for (const f of fields) { const wrap = el('div', 'field'), l = el('label', '', f.label), i = el('input'); i.type = f.type ?? 'password'; i.autocomplete = 'off'; i.id = `f-${f.id}`; l.htmlFor = i.id; wrap.append(l, i); body.append(wrap); inputs[f.id] = i; }
  const go = $('dlg-go'); go.textContent = action; go.hidden = !action; go.disabled = false;
  go.onclick = async () => { go.disabled = true; $('dlg-status').textContent = 'Working…'; try { const out = await run(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); if (typeof out === 'string') { $('dlg-status').textContent = out; go.hidden = true; } else dlg.close(); drawWallet(); } catch (e) { $('dlg-status').textContent = e.message; go.disabled = false; } };
  dlg.showModal();
}
async function drawWallet() {
  const box = $('w-body'); box.replaceChildren();
  if (!vault.exists) {
    box.append(el('p', 'warn', 'The trading wallet lives in this browser, locked with a passphrase you choose. Lose the passphrase and the backup key, and the wallet is gone. Keep only money you can lose in it.'));
    const row = el('div', 'row'), make = el('button', 'btn', 'Make my trading wallet'), rest = el('button', 'btn ghost', 'Restore from a backup key'); make.type = rest.type = 'button';
    make.addEventListener('click', () => ask({ title: 'Make your trading wallet', text: 'Choose a passphrase of 10+ characters (a few random words work well). It locks the wallet on this device.', fields: [{ id: 'p', label: 'PASSPHRASE' }, { id: 'a', label: 'AGAIN' }], action: 'Make wallet', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.create(v.p); state.backedUp = false; save(); } }));
    rest.addEventListener('click', () => ask({ title: 'Restore a trading wallet', text: 'Paste the backup key (from Warrior or exported from Phantom) and choose a passphrase.', fields: [{ id: 'k', label: 'BACKUP KEY', type: 'text' }, { id: 'p', label: 'PASSPHRASE' }, { id: 'a', label: 'AGAIN' }], action: 'Restore', run: async (v) => { vault.checkPassphrase(v.p, v.a); await vault.restore(v.k.trim(), v.p); state.backedUp = true; save(); } }));
    row.append(make, rest); box.append(row); return;
  }
  box.append(el('div', 'small', vault.unlocked ? 'UNLOCKED IN THIS TAB' : 'LOCKED'), el('div', 'addr', vault.address));
  const bal = el('div', 'big', '…'); box.append(bal); liveBalance().then((s) => { bal.textContent = `${s.toFixed(4)} SOL`; }).catch(() => { bal.textContent = 'balance unavailable'; });
  const row = el('div', 'row'), add = (label, ghost, fn) => { const b = el('button', `btn ${ghost ? 'ghost' : ''}`, label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); };
  if (!vault.unlocked) add('Unlock', false, () => ask({ title: 'Unlock the trading wallet', text: 'It stays unlocked in this tab until you lock it or close the tab.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Unlock', run: (v) => vault.unlock(v.p) }));
  else add('Lock', true, () => { vault.lock(); });
  add('Fund from Phantom', false, () => ask({ title: 'Send SOL from Phantom', text: owner.address ? 'Phantom will show the amount and ask you to approve.' : 'Connect Phantom first (top right).', fields: owner.address ? [{ id: 's', label: 'SOL TO SEND', type: 'number' }] : [], action: owner.address ? 'Send' : '', run: async (v) => { const r = await fundFromPhantom(Number(v.s)); return r.outcome === 'confirmed' ? `Sent. It is in the trading wallet.` : `Sent; the network says: ${r.outcome}. Check the balance in a minute.`; } }));
  if (vault.unlocked) add('Send to Phantom', true, () => ask({ title: 'Send SOL back', text: `To ${owner.address ? 'your connected Phantom' : 'the address below'}. Keep about 0.01 SOL for fees.`, fields: [{ id: 's', label: 'SOL TO SEND', type: 'number' }, ...(owner.address ? [] : [{ id: 'to', label: 'TO ADDRESS', type: 'text' }])], action: 'Send', run: async (v) => { const r = await withdraw(owner.address || v.to.trim(), Number(v.s)); return r.outcome === 'confirmed' ? 'Sent.' : `Sent; the network says: ${r.outcome}.`; } }));
  add(state.backedUp ? 'Backup key' : 'Save the backup key (needed for live)', !!state.backedUp, () => ask({ title: 'Your backup key', text: 'Type the passphrase to show it. Anyone with this key controls the wallet: never paste it into a website or chat.', fields: [{ id: 'p', label: 'PASSPHRASE' }], action: 'Show', run: async (v) => { const k = await vault.backup(v.p); state.backedUp = true; save(); return `Backup key: ${k}`; } }));
  box.append(row);
}

// ---------- start ----------
startNet($('net'), AGENTS); drawAgents(); drawControls(); drawWallet(); void drawMoney();
for (const m of state.log.slice(-30)) { const a = AGENTS.find((x) => x.id === m.who), li = el('li', m.tone ?? ''); li.append(el('time', '', new Date(m.at).toLocaleTimeString()), el('span', 'who', a ? a.name.toUpperCase() : m.who), document.createTextNode(m.text)); $('log').prepend(li); }
void peek(); setInterval(() => { if (!impi.running && document.visibilityState === 'visible') void peek(); }, 120_000);
setInterval(drawAgents, 2000);
