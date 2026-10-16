// Things no other trading app has: "Why not?", the honest receipt, Warrior cards, your day as a story, the practice
// league, bedtime rules and the public scorecard. All of it is drawn from tested rule files in /vendor/lib/.
import { whyNot, coachAfter } from '/vendor/lib/coach.js';
import { receipt } from '/vendor/lib/receipt.js';
import { dayStory, leagueWeek, leagueEntry, leagueCode, readLeagueCode, leagueTable } from '/vendor/lib/story.js';
import { scoreSummary } from '/vendor/lib/scorecard.js';
import { rules } from '/rules.js';
import { bedtime, day } from '/care.js';
import { on } from '/bus.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const btn = (text, cls, fn) => { const b = el('button', `btn ${cls ?? ''}`, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const dialog = $('extra'), body = $('extra-body');
let storyTimer = null;
function show(title, ...nodes) { clearInterval(storyTimer); $('extra-title').textContent = title; body.replaceChildren(...nodes); if (!dialog.open) dialog.showModal(); body.scrollTop = 0; }
$('extra-close').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => clearInterval(storyTimer));

// ---------- "Why not?" ----------
on('why-not', (t) => {
  if (t.rocketInfo) { // a coin from the Rocket scanner: the Rocket screen's own reasons
    const why = t.rocketInfo.reasons ?? [], ol = el('ol', 'whynot'); for (const r of why) { const li = el('li'); li.append(el('p', '', r)); ol.append(li); }
    show(`Why not ${t.symbol}?`, el('p', 'muted', why.length ? `${why.length} rule${why.length === 1 ? '' : 's'} of the Rocket screen said no. Rocket Mode would not bet on it right now.` : 'No rule is saying no right now.'), ol, el('p', 'muted', 'You can still trade it yourself. Most coins this young end at or near zero.')); return; }
  const items = whyNot(t, rules.resolved), list = el('ol', 'whynot');
  for (const i of items) { const li = el('li'); li.append(el('b', '', i.rule), el('p', '', i.said), el('p', 'muted', `What would change it: ${i.change}`)); list.append(li); }
  show(`Why not ${t.symbol}?`, el('p', 'muted', items.length ? `${items.length} rule${items.length === 1 ? '' : 's'} said no, under your ${rules.PRESETS[rules.choice.preset].label} rules. Each one is listed with what would have to change.` : 'No rule is saying no right now.'), list, el('p', 'muted', 'You can still trade it yourself. Warrior just will not call it.'));
});

// ---------- the honest receipt ----------
function receiptNodes(trade) {
  const r = receipt(trade), c = coachAfter(trade), table = el('dl', 'receipt');
  for (const l of r.lines) { const dt = el('dt', l.kind, l.label); if (l.note) dt.append(el('small', '', l.note)); table.append(dt, el('dd', l.kind, l.text)); }
  const total = el('dt', 'total', 'Costs you paid, in total'); table.append(total, el('dd', 'total', `${r.complete ? '' : 'at least '}${(r.costsSol ?? 0).toFixed(6)} SOL`));
  const res = el('dt', 'result', 'True result'); table.append(res, el('dd', `result ${r.resultSol > 0 ? 'up' : r.resultSol < 0 ? 'down' : ''}`, `${r.resultSol >= 0 ? '+' : '−'}${Math.abs(r.resultSol).toFixed(6)} SOL (${r.resultPct}%)`));
  return [el('p', 'muted', `${trade.symbol} · closed ${new Date(trade.closedAt).toLocaleString()} · ${trade.reason}${trade.mode === 'paper' ? ' · PRACTICE MONEY' : ''}${trade.rulesVersion ? ` · rules ${trade.rulesVersion}` : ''}`), table, el('p', 'muted', r.note), el('p', 'coach', `Coach: ${c.happened} ${c.learned}`)];
}
on('receipt', (trade) => { const nodes = receiptNodes(trade); if (trade.pnlSol > 0) nodes.push(btn('💖 Make a Warrior card of this win', '', () => openCard(trade))); show('Honest receipt', ...nodes); });

// ---------- Warrior cards: a picture of a win, with the honest numbers on it ----------
function drawCard(canvas, trade) {
  const r = receipt(trade), g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, practice = trade.mode === 'paper';
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#fff8ec'); bg.addColorStop(1, '#fff8ec'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d81b60'; g.lineWidth = 6; g.strokeRect(24, 24, W - 48, H - 48);
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '220px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; g.fillText('😂', W / 2, 300);
  g.font = '64px system-ui, "Segoe UI Emoji", sans-serif'; g.fillText('💖  💗  💕', W / 2, 400);
  g.fillStyle = '#1a9e4f'; g.font = '900 120px system-ui, sans-serif'; g.fillText(`+${r.resultSol.toFixed(4)} SOL`, W / 2, 560);
  g.fillStyle = '#1b1230'; g.font = '700 60px system-ui, sans-serif'; g.fillText(`+${r.resultPct}% on ${String(trade.symbol).slice(0, 12)}`, W / 2, 650);
  g.fillStyle = practice ? '#00897b' : '#f4a300'; g.font = '700 44px system-ui, sans-serif'; g.fillText(practice ? 'PRACTICE MONEY · nothing real was made' : 'REAL MONEY · after every fee', W / 2, 740);
  g.fillStyle = '#6b5a7e'; g.font = '36px system-ui, sans-serif';
  g.fillText(`Costs paid: ${r.complete ? '' : 'at least '}${r.costsSol.toFixed(6)} SOL · closed by: ${trade.reason}`, W / 2, 820);
  g.fillText(`${new Date(trade.closedAt).toISOString().slice(0, 10)}${trade.rulesVersion ? ` · rules ${trade.rulesVersion}` : ''}`, W / 2, 872);
  g.fillStyle = '#f4a300'; g.font = '900 48px system-ui, sans-serif'; g.fillText('Warrior', W / 2, 960);
  g.fillStyle = '#6b5a7e'; g.font = '30px system-ui, sans-serif'; g.fillText('One trade, not a track record. No profit is ever promised.', W / 2, 1010);
}
function openCard(trade) {
  if (!(trade.pnlSol > 0)) return; const canvas = el('canvas', 'warrior-card'); canvas.width = 1080; canvas.height = 1080; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Warrior card: plus ${trade.pnlSol.toFixed(4)} SOL on ${trade.symbol}, ${trade.mode === 'paper' ? 'practice money' : 'real money after every fee'}.`); drawCard(canvas, trade);
  const status = el('p', 'muted', 'The card shows the true result and says plainly whether it was practice money.'); status.setAttribute('role', 'status');
  const name = `warrior-${String(trade.symbol).replace(/[^\w-]/g, '')}-${new Date(trade.closedAt).toISOString().slice(0, 10)}.png`;
  const save = btn('Save picture', 'neon', () => canvas.toBlob((blob) => { if (!blob) { status.textContent = 'This browser could not make the picture.'; return; } const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); status.textContent = 'Saved to your downloads.'; }, 'image/png'));
  const share = btn('Share', '', () => canvas.toBlob(async (blob) => { try { const file = new File([blob], name, { type: 'image/png' }); if (!navigator.canShare?.({ files: [file] })) { status.textContent = 'This browser cannot share pictures. Use Save picture instead.'; return; } await navigator.share({ files: [file], title: 'Warrior card' }); } catch { status.textContent = 'Not shared.'; } }, 'image/png'));
  const row = el('div', 'row'); row.append(save, share); show('Warrior card', canvas, row, status);
}
on('warrior-card', (trade) => openCard(trade));

// ---------- your day as a story ----------
function todaysTrades() { const from = new Date(); from.setHours(0, 0, 0, 0); const mode = read('warrior.auto.state.v1', {})?.mode === 'live' ? 'live' : 'paper'; return { mode, trades: (read('warrior.auto.state.v1', {})?.trades ?? []).filter((t) => t.mode === mode && t.closedAt >= from.getTime()) }; }
function openStory() {
  const { mode, trades } = todaysTrades(), slides = dayStory(day.record, trades, { practice: mode === 'paper' }); let at = 0;
  const stage = el('div', 'story'), face = el('div', 'story-face'), title = el('h3'), text = el('p'), dots = el('p', 'muted story-dots'), live = el('div', 'sr-only'); live.setAttribute('aria-live', 'polite'); face.setAttribute('aria-hidden', 'true');
  const draw = () => { const s = slides[at]; stage.classList.remove('in'); void stage.offsetWidth; face.textContent = s.face; title.textContent = s.title; text.textContent = s.text; dots.textContent = `${at + 1} of ${slides.length}`; live.textContent = `${s.title}. ${s.text}`; if (!calm()) stage.classList.add('in'); back.disabled = at === 0; next.textContent = at === slides.length - 1 ? 'Done' : 'Next'; };
  const back = btn('Back', '', () => { clearInterval(storyTimer); at = Math.max(0, at - 1); draw(); }), next = btn('Next', 'neon', () => { clearInterval(storyTimer); if (at === slides.length - 1) { dialog.close(); return; } at++; draw(); });
  stage.append(face, title, text); const row = el('div', 'row story-nav'); row.append(back, next); row.hidden = slides.length < 2; dots.hidden = slides.length < 2;
  if (calm()) { // no motion: the whole story at once, as a list
    const list = el('ol', 'story-list'); for (const s of slides) { const li = el('li'); li.append(el('b', '', `${s.face} ${s.title}`), el('p', '', s.text)); list.append(li); } show('Your day', list); return;
  }
  show('Your day', stage, dots, row, live); draw();
  storyTimer = setInterval(() => { if (at >= slides.length - 1) { clearInterval(storyTimer); return; } at++; draw(); }, 6000);
}
$('story-open').addEventListener('click', openStory);

// ---------- bedtime rules ----------
function drawBedtime(message = '') {
  const b = bedtime.value; $('bed-on').checked = b.on; $('bed-stop').value = b.stopAt; $('bed-close').value = b.closeAt; $('bed-wake').value = b.wakeAt; $('bed-keep').checked = !b.closeAt;
  $('bed-close').disabled = !b.closeAt && $('bed-keep').checked; $('bed-text').textContent = bedtime.text; $('bed-status').textContent = message;
}
function saveBedtime() {
  const keep = $('bed-keep').checked, next = { on: $('bed-on').checked, stopAt: $('bed-stop').value, closeAt: keep ? '' : ($('bed-close').value || '00:00'), wakeAt: $('bed-wake').value }, refused = bedtime.set(next);
  drawBedtime(refused.length ? `Not saved: ${refused.join('. ')}.` : next.on ? 'Saved. It uses this device\'s clock, and works while a Warrior tab is open.' : 'Bedtime rule is off.');
}
for (const id of ['bed-on', 'bed-stop', 'bed-close', 'bed-wake', 'bed-keep']) $(id).addEventListener('change', saveBedtime);

// ---------- practice league ----------
const LEAGUE_KEY = 'warrior.league.v1';
function renderLeague(message = '') {
  const saved = read(LEAGUE_KEY, { name: '', friends: [] }), week = leagueWeek(), me = leagueEntry(saved.name || 'You', read('warrior.auto.state.v1', {})?.trades ?? []);
  const friends = (saved.friends ?? []).map(readLeagueCode).filter(Boolean), table = leagueTable([{ ...me, me: true }, ...friends], week), box = $('league-table');
  if (document.activeElement !== $('league-name')) $('league-name').value = saved.name ?? ''; $('league-code').value = leagueCode(me); $('league-week').textContent = `Week starting ${week}. Everyone starts each week from a pretend 0.5 SOL; only practice trades closed this week count.`;
  const t = el('table', 'grid'), head = el('tr'); for (const h of ['Place', 'Name', 'Practice result', 'Trades', 'Won']) head.append(el('th', '', h)); t.append(head);
  for (const r of table.rows) { const tr = el('tr', r.me ? 'me' : ''); tr.append(el('td', '', String(r.place)), el('td', '', r.me ? `${r.name} (you)` : r.name), el('td', r.returnPct > 0 ? 'up' : r.returnPct < 0 ? 'down' : '', `${r.returnPct >= 0 ? '+' : ''}${r.returnPct}%`), el('td', '', String(r.trades)), el('td', '', String(r.wins))); t.append(tr); }
  const wrap = el('div', 'scroll-x'); wrap.append(t); box.replaceChildren(wrap);
  if (table.old.length) box.append(el('p', 'muted', `${table.old.length} code${table.old.length === 1 ? ' is' : 's are'} from another week and not ranked. Ask for a fresh one.`));
  if (friends.length) box.append(btn('Clear friends', 'small', () => { write(LEAGUE_KEY, { ...saved, friends: [] }); renderLeague('Friends cleared.'); }));
  $('league-status').textContent = message;
}
$('league-name').addEventListener('change', (e) => { const saved = read(LEAGUE_KEY, { name: '', friends: [] }); write(LEAGUE_KEY, { ...saved, name: e.target.value.trim().slice(0, 16) }); renderLeague('Name saved.'); });
$('league-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('league-code').value); renderLeague('Code copied. Send it to a friend.'); } catch { $('league-code').select(); renderLeague('Select the code and copy it.'); } });
$('league-add').addEventListener('click', () => {
  const code = $('league-friend').value.trim(), entry = readLeagueCode(code), saved = read(LEAGUE_KEY, { name: '', friends: [] });
  if (!entry) { renderLeague('That is not a Warrior league code.'); return; }
  const others = (saved.friends ?? []).filter((c) => readLeagueCode(c)?.name !== entry.name).slice(-19); write(LEAGUE_KEY, { ...saved, friends: [...others, code] }); $('league-friend').value = ''; renderLeague(`${entry.name} added.`);
});
on('risk', () => renderLeague($('league-status').textContent));

// ---------- public scorecard ----------
async function renderScorecard() {
  const box = $('score-body'), status = $('score-status');
  try {
    const r = await fetch('/scorecard.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('unavailable'); const card = await r.json(), s = scoreSummary(card);
    status.textContent = s.updatedAt ? `Last updated ${new Date(s.updatedAt).toLocaleString()} by the recorder, after ${s.samples} look${s.samples === 1 ? '' : 's'} at the market.` : 'The recorder has not run yet.';
    if (card.lastError) status.textContent += ` ${card.lastError}`;
    const totals = el('dl', 'sum wide'), row = (k, v) => totals.append(el('dt', '', k), el('dd', '', v));
    row('ENTER calls recorded', String(s.total)); row('Reached the target', String(s.targets)); row('Hit the stop', String(s.stops)); row('Ran out of time', String(s.timeouts)); row('Still open', String(s.open)); if (s.unknown) row('Could not be followed up', String(s.unknown));
    row('Ended higher / lower', s.closed ? `${s.wins} / ${s.losses} (${s.winRatePct}% higher)` : 'nothing has closed yet'); row('Average move after a call', s.closed ? `${s.averagePct >= 0 ? '+' : ''}${s.averagePct}% before trading costs` : '—');
    box.replaceChildren(totals);
    const recent = [...card.signals].reverse().slice(0, 25);
    if (!recent.length) box.append(el('p', 'muted', 'No ENTER has been recorded yet. Warrior says WAIT far more often than ENTER, so this list grows slowly. It will show every call, losers included.'));
    else { const t = el('table', 'grid'), head = el('tr'); for (const h of ['Called', 'Coin', 'Signals', 'Stop / target', 'What happened', 'Move']) head.append(el('th', '', h)); t.append(head); for (const x of recent) { const tr = el('tr'); tr.append(el('td', '', new Date(x.calledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), el('td', '', x.young ? `${x.symbol} (young)` : x.symbol), el('td', '', `${x.score}/4`), el('td', '', `−${x.stopPct?.toFixed(1)}% / +${x.targetPct}%`), el('td', '', ({ open: 'still open', target: 'reached the target', stop: 'hit the stop', time: 'ran out of time', unknown: 'could not be followed up' })[x.outcome] ?? x.outcome), el('td', x.resultPct > 0 ? 'up' : x.resultPct < 0 ? 'down' : '', x.resultPct === null ? '—' : `${x.resultPct >= 0 ? '+' : ''}${x.resultPct}%`)); t.append(tr); } const wrap = el('div', 'scroll-x'); wrap.append(t); box.append(wrap); }
  } catch { status.textContent = 'The scorecard could not be loaded just now.'; }
}

drawBedtime(); renderLeague(); void renderScorecard();
