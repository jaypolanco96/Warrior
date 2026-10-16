// Trust, in plain sight: a status line that says when something Warrior depends on is down, a list of anything that went
// wrong (nothing fails silently), installing Warrior like an app, and the comfort check.
import { on, emit } from '/bus.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// ---------- status ----------
let health = null, healthFailed = false; const problems = [];
function drawStatus() {
  const line = $('status-line'), list = $('status-list'), down = health?.parts.filter((p) => !p.ok) ?? [];
  line.className = `status-line ${healthFailed || down.length ? 'bad' : problems.length ? 'warn' : 'good'}`;
  $('status-text').textContent = healthFailed ? 'Warrior could not check its data sources just now. Treat anything on screen as possibly out of date.'
    : !health ? 'Checking the data sources…'
      : down.length ? `Trouble: ${down.map((p) => p.name).join(' and ')} ${down.length === 1 ? 'is' : 'are'} not answering. Warrior does not guess. Affected: ${down.map((p) => p.used).join('; ')}.`
        : problems.length ? `Data sources are answering. ${problems.length} thing${problems.length === 1 ? '' : 's'} did not work recently; tap to see.` : 'All data sources are answering.';
  list.replaceChildren();
  for (const p of health?.parts ?? []) list.append(el('li', p.ok ? 'ok' : 'bad', `${p.ok ? '✔' : '✖'} ${p.name}: ${p.ok ? `answering (${p.ms} ms)` : `not answering (${p.problem})`}. Used for ${p.used}.`));
  for (const x of [...problems].reverse()) list.append(el('li', 'warn', `! ${new Date(x.at).toLocaleTimeString()} ${x.text}`));
  if (health) list.append(el('li', 'muted', `Checked ${new Date(health.at).toLocaleTimeString()}. Checked again every two minutes while this page is open.`));
}
async function checkHealth() { try { const r = await fetch('/api/health'); if (!r.ok) throw new Error('unavailable'); health = await r.json(); healthFailed = false; } catch { healthFailed = true; } drawStatus(); }
/** Anything that goes wrong in the background is listed here instead of disappearing. */
on('problem', (text) => { const last = problems.at(-1); if (last?.text === text && Date.now() - last.at < 300_000) { last.at = Date.now(); } else { problems.push({ at: Date.now(), text: String(text).slice(0, 200) }); if (problems.length > 8) problems.shift(); } drawStatus(); if (!health || Date.now() - Date.parse(health.at) > 60_000) void checkHealth(); });
$('status-toggle').addEventListener('click', () => { const open = $('status-list').hidden; $('status-list').hidden = !open; $('status-toggle').setAttribute('aria-expanded', String(open)); });
window.addEventListener('error', (e) => emit('problem', `The page hit an error (${String(e.message).slice(0, 80)}). Reload if something looks stuck.`));
window.addEventListener('unhandledrejection', (e) => emit('problem', `Something did not finish (${String(e.reason?.message ?? e.reason).slice(0, 80)}).`));
window.addEventListener('offline', () => emit('problem', 'This device is offline. Warrior cannot see prices or trade until it is back.')); window.addEventListener('online', () => void checkHealth());
void checkHealth(); setInterval(() => { if (document.visibilityState === 'visible') void checkHealth(); }, 120_000);

// ---------- install like an app ----------
let installPrompt = null; const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => emit('problem', 'The offline helper could not start. Warrior still works; it just will not open without a connection.'));
function drawInstall(note = '') {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone;
  $('install-btn').hidden = !installPrompt; $('install-note').textContent = note || (standalone ? 'Warrior is installed on this device.' : installPrompt ? 'Put Warrior on your home screen. It opens like an app, with its own window.' : ios ? 'On iPhone or iPad: tap the Share button, then “Add to Home Screen”.' : 'To install: open your browser menu and choose “Install” or “Add to Home screen”. Some browsers only offer it after a visit or two.');
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; drawInstall(); });
window.addEventListener('appinstalled', () => { installPrompt = null; drawInstall('Installed. Look for Warrior on your home screen.'); });
$('install-btn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); const choice = await installPrompt.userChoice.catch(() => null); installPrompt = null; drawInstall(choice?.outcome === 'accepted' ? 'Installing…' : 'Not installed. You can do it later from the browser menu.'); });
drawInstall();

// ---------- comfort check: how did it feel? ----------
const CKEY = 'warrior.comfort.v1';
const journey = read(CKEY, { firstVisit: Date.now(), firstPracticeBuy: null, firstPracticeSale: null, answers: [], asked: false });
if (!read(CKEY, null)) write(CKEY, journey);
on('trade', (t) => {
  if (t.mode !== 'paper') return;
  if (t.type === 'buy' && !journey.firstPracticeBuy) { journey.firstPracticeBuy = Date.now(); write(CKEY, journey); }
  if (t.type === 'sell' && !journey.firstPracticeSale) { journey.firstPracticeSale = Date.now(); write(CKEY, journey); }
  if (t.type === 'sell' && !journey.asked) { journey.asked = true; write(CKEY, journey); $('comfort-ask').hidden = false; }
  drawComfort();
});
const WORDS = ['', 'Lost or uneasy', 'A bit unsure', 'Okay', 'Comfortable', 'Completely comfortable'];
let picked = 0;
function drawComfort(message = '') {
  const scale = $('comfort-scale'); scale.replaceChildren();
  for (let n = 1; n <= 5; n++) { const b = el('button', `btn score ${picked === n ? 'on' : ''}`, `${n} · ${WORDS[n]}`); b.type = 'button'; b.setAttribute('aria-pressed', String(picked === n)); b.addEventListener('click', () => { picked = n; drawComfort(); }); scale.append(b); }
  const secs = journey.firstPracticeBuy ? Math.round((journey.firstPracticeBuy - journey.firstVisit) / 1000) : null;
  $('comfort-facts').textContent = `${journey.answers.length} answer${journey.answers.length === 1 ? '' : 's'} saved on this device.${secs === null ? '' : ` First practice buy came ${secs < 120 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`} after the first visit.`}`;
  $('comfort-copy').disabled = !journey.answers.length; $('comfort-status').textContent = message;
}
$('comfort-save').addEventListener('click', () => {
  if (!picked) { drawComfort('Pick a number from 1 to 5 first.'); return; }
  journey.answers.push({ at: Date.now(), score: picked, hesitated: $('comfort-why').value.trim().slice(0, 500) }); journey.answers = journey.answers.slice(-20); write(CKEY, journey);
  picked = 0; $('comfort-why').value = ''; $('comfort-ask').hidden = true; drawComfort('Saved on this device. Nothing was sent anywhere: use “Copy my answers” to pass them on.');
});
$('comfort-copy').addEventListener('click', async () => {
  const secs = journey.firstPracticeBuy ? Math.round((journey.firstPracticeBuy - journey.firstVisit) / 1000) : 'not yet';
  const text = [`Warrior comfort check`, `First visit to first practice buy: ${secs}${typeof secs === 'number' ? ' seconds' : ''}`, `Screen: ${window.innerWidth}x${window.innerHeight}${standalone ? ', installed app' : ''}`, ...journey.answers.map((a) => `${new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')}  comfort ${a.score}/5 (${WORDS[a.score]})${a.hesitated ? `  hesitated: ${a.hesitated}` : ''}`)].join('\n');
  try { await navigator.clipboard.writeText(text); drawComfort('Copied. Paste it into a message to whoever asked you to try Warrior.'); } catch { $('comfort-why').value = text; drawComfort('Could not copy by itself. The answers are in the box: select and copy them.'); }
});
drawComfort();
