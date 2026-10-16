// The indaba: for every coin the impi considers, the agents speak in turn, typed out live. Each line is one of Warrior's
// real checks with its real number, ending in the commander's verdict. Display only: nothing here decides anything.
import { on } from './store.js';
import { AGENTS } from './impi.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const queue = []; let typing = false, current = null;
const tally = { BUY: 0, NO: 0, WAIT: 0 };

/** Start a new coin. `facts` are short strings shown on the case line. */
on('indaba-case', ({ symbol, facts = [] }) => queue.push({ kind: 'case', symbol, facts }));
/** One agent speaks. tone: 'yes' | 'no' | 'wait'. A verdict line ends the case: chip 'BUY', 'NO' or 'WAIT'. */
on('indaba-line', (m) => queue.push({ kind: 'line', ...m }));
setInterval(pump, 120);

function pump() {
  if (typing || !queue.length) return;
  const m = queue.shift();
  if (m.kind === 'case') return openCase(m);
  speak(m);
}
function openCase({ symbol, facts }) {
  current = symbol; const box = $('indaba-case'); box.replaceChildren(el('b', '', symbol), ...facts.map((f) => el('span', '', f)));
  $('indaba').replaceChildren();
}
function speak({ who, text, tone = 'wait', chip, verdict }) {
  const i = AGENTS.findIndex((a) => a.id === who), a = AGENTS[i]; if (!a) return;
  const li = el('li', `msg${verdict ? ` verdict ${tone}` : ''}`), av = el('div', `av c${i}`, a.glyph), bub = el('div', 'bubble'), head = el('div', `who c${i}`, a.name.toUpperCase());
  head.append(el('span', 'role', a.role)); if (chip) head.append(el('span', `chip ${tone}`, chip));
  const tx = el('div', 'txt'); bub.append(head, tx); li.append(av, bub); $('indaba').append(li);
  if (verdict) { tally[chip === 'BUY' ? 'BUY' : chip === 'NO' ? 'NO' : 'WAIT']++; drawTally(); }
  const box = $('indaba'), end = () => { box.scrollTop = box.scrollHeight; };
  if (still()) { tx.textContent = text; end(); return; }
  typing = true; tx.classList.add('cursor'); let n = 0;
  const type = () => { n += 3; tx.textContent = text.slice(0, n); end(); if (n < text.length) setTimeout(type, 16); else { tx.classList.remove('cursor'); setTimeout(() => { typing = false; }, 350); } };
  type();
}
function drawTally() { $('indaba-tally').textContent = `This session: ${tally.BUY} bought · ${tally.NO} refused · ${tally.WAIT} waiting`; }

// at rest: say what will appear here
$('indaba-case').replaceChildren(el('span', '', 'Send the impi out: each coin it considers is decided here, out loud.'));
