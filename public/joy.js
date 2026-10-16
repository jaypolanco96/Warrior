// How Warrior feels: celebrations, comfort, the mascot's mood, plain-word tips and optional sound.
// The decisions come from the tested rules in /vendor/joy-rules.js; this file only draws them.
import { celebrationFor, comfortFor, moodFor, GLOSSARY } from '/vendor/joy-rules.js';
const KEY = 'warrior.joy.v1', $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let prefs = { sound: false, firstWin: false, firstPracticeWin: false, welcomed: false };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch {}
const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const joyPrefs = { get welcomed() { return prefs.welcomed; }, setWelcomed() { prefs.welcomed = true; savePrefs(); } };

// ---------- sound (off unless the user turns it on) ----------
let audio = null;
function chime(notes) {
  if (!prefs.sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)(); const start = audio.currentTime;
    notes.forEach(([freq, at, len], i) => { const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(0, start + at); g.gain.linearRampToValueAtTime(0.12, start + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, start + at + len); o.connect(g).connect(audio.destination); o.start(start + at); o.stop(start + at + len + 0.05); void i; });
  } catch {}
}
const SOUNDS = { chuckle: [[660, 0, 0.18], [880, 0.12, 0.25]], warrior: [[660, 0, 0.15], [830, 0.1, 0.15], [990, 0.2, 0.3]], roar: [[523, 0, 0.14], [659, 0.1, 0.14], [784, 0.2, 0.14], [1047, 0.3, 0.45]], comfort: [[440, 0, 0.35]] };

// ---------- the toast: one message at a time, readable by a screen reader, dismissable ----------
let toastTimer = null;
function toast(kind, { headline, message, detail, practice, spoken }) {
  const box = $('joy-toast'); if (!box) return; clearTimeout(toastTimer); box.replaceChildren(); box.className = `joy-toast ${kind}`;
  if (practice) box.append(el('span', 'practice-tag', 'PRACTICE'));
  box.append(el('strong', '', headline), el('span', '', message), el('small', '', detail));
  const close = el('button', 'btn small', 'OK'); close.type = 'button'; close.addEventListener('click', () => { box.hidden = true; }); box.append(close);
  box.hidden = false; $('joy-live').textContent = spoken; toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'win' ? 7000 : 9000);
}
// ---------- the burst: warrioring faces rain down, pink hearts float up ----------
function burst({ warriors, hearts }) {
  const layer = $('joy-layer'); if (!layer || calm()) return; // with reduced motion the toast alone carries the moment
  const add = (chars, cls, n) => { for (let i = 0; i < n; i++) { const s = el('span', `joy-bit ${cls}`, chars[i % chars.length]); s.style.setProperty('--x', `${Math.random() * 100}%`); s.style.setProperty('--drift', `${(Math.random() - 0.5) * 30}vw`); s.style.setProperty('--delay', `${Math.random() * 0.9}s`); s.style.setProperty('--dur', `${2.4 + Math.random() * 1.8}s`); s.style.setProperty('--size', `${22 + Math.random() * 26}px`); layer.append(s); s.addEventListener('animationend', () => s.remove(), { once: true }); } };
  add(['😂', '🤣', '😆', '😄'], 'fall', warriors); add(['💖', '💗', '💕', '🩷'], 'rise', hearts);
  setTimeout(() => layer.replaceChildren(), 6000);
}

/** A neutral heads-up (an order filled, a watched coin lit up). Same message box, no celebration and no emojis. */
export function notice({ headline, message = '', detail = '' }) { toast('note', { headline, message, detail, practice: false, spoken: [headline, message].filter(Boolean).join('. ') }); }

let recent = null, recentTimer = null, moodInput = {};
/** Tell the feel layer a trade closed. Exactly one of: a celebration, a comfort message, or a quiet "about even". */
export function tradeClosed(trade) {
  const t = { ...trade, closed: true }, key = t.practice ? 'firstPracticeWin' : 'firstWin', win = celebrationFor(t, { firstWin: !prefs[key] });
  if (win.kind !== 'none') { prefs[key] = true; savePrefs(); toast('win', win); burst(win); chime(SOUNDS[win.kind]); setRecent('win'); return win.kind; }
  const soft = comfortFor(t); if (soft.kind === 'none') return 'none';
  toast(soft.kind === 'wash' ? 'wash' : 'comfort', soft); if (soft.kind === 'comfort') { chime(SOUNDS.comfort); setRecent('loss'); } return soft.kind;
}
function setRecent(value) { recent = value; clearTimeout(recentTimer); recentTimer = setTimeout(() => { recent = null; drawMood(); }, 45_000); drawMood(); }
/** Update the mascot from what is true right now (scan state and signal counts). */
export function setMood(input) { moodInput = { ...moodInput, ...input }; drawMood(); }
function drawMood() {
  const m = moodFor({ ...moodInput, recent }), face = $('mascot'), line = $('mascot-line'); if (!face || !line) return;
  if (face.textContent !== m.face) { face.textContent = m.face; face.dataset.mood = m.mood; } line.textContent = m.line;
}
/** Show what a win looks like, clearly labelled as a preview. Lets people choose sound before real money is involved. */
export function previewWin() { const p = celebrationFor({ symbol: 'PREVIEW', closed: true, pnlSol: 0.0123, pnlPct: 6.2, practice: true }); toast('win', { ...p, headline: 'This is what a win looks like', message: 'Hearts and warriors, sized to the win.', detail: 'preview only · no trade happened', spoken: 'Preview of a win celebration. No trade happened.' }); burst(p); chime(SOUNDS.warrior); }

// ---------- plain-word tips: tap any label to see what it means ----------
/** Returns a label element. If the term is in the glossary, it becomes a button that reveals the explanation. */
export function label(tag, term, cls = '') {
  const tip = GLOSSARY[term]; if (!tip) return el(tag, cls, term);
  const wrap = el(tag, cls), b = el('button', 'tip', term); b.type = 'button'; b.setAttribute('aria-expanded', 'false'); b.dataset.tip = tip; wrap.append(b); return wrap;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button.tip'); const open = document.querySelector('.tip-pop');
  if (open && (!b || open.dataset.for !== b.dataset.tip)) { document.querySelector('button.tip[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false'); open.remove(); }
  if (!b) return;
  if (b.getAttribute('aria-expanded') === 'true') { b.setAttribute('aria-expanded', 'false'); document.querySelector('.tip-pop')?.remove(); return; }
  const pop = el('div', 'tip-pop', b.dataset.tip); pop.setAttribute('role', 'note'); pop.dataset.for = b.dataset.tip; b.setAttribute('aria-expanded', 'true');
  (b.closest('.card, .panel, dialog') ?? document.body).append(pop);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { document.querySelector('button.tip[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false'); document.querySelector('.tip-pop')?.remove(); } });

// ---------- sound switch and preview ----------
function drawSound() { const b = $('sound-toggle'); if (b) { b.textContent = prefs.sound ? '🔔 Sound on' : '🔕 Sound off'; b.setAttribute('aria-pressed', String(prefs.sound)); } }
$('sound-toggle')?.addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); drawSound(); if (prefs.sound) chime(SOUNDS.chuckle); });
$('preview-win')?.addEventListener('click', previewWin);
drawSound(); drawMood();
