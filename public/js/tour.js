// The guided tour: the page dims into a vignette, a lit frame cuts out the exact control being described, and a card
// beside it explains that part. Next/Back (or the arrow keys), Esc to leave. Some steps ask you to press the control
// yourself. It starts once for a first visit, and the Tour button in the masthead replays it any time.
// Positions are set through the CSS object model (allowed by the page's security policy); nothing here changes trades.
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const SEEN = 'warrior.tour.v1', still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Each step: the element to light up, a title, the words, and optionally something for you to press. */
const STEPS = [
  { at: '.mark', title: 'Welcome to Warrior', text: 'A trading desk for Solana coins, run by six agents. Each agent is a tested rule, not a chatbot. This tour takes about two minutes. Use the arrow keys or the buttons; Esc leaves at any time.' },
  { at: '#mode-paper', title: 'Practice or Live', text: 'Practice trades a pretend 1 SOL at real prices. Live trades real SOL from your trading wallet. Start in Practice: everything in this tour works there.', pad: 6, group: '.mode .seg' },
  { at: '.preset', title: 'Pick a strength', text: 'Chill: three coins at once, smaller bets, only the busiest coins. Balanced: four coins, sells a third at +6% and a third at +12%. Spicy: five coins, bigger bets, slightly shallower dips. All three use the same tested deep-dip rule.', group: '[aria-label="Strength"]' },
  { at: '#go', title: 'Send the impi', text: 'This starts the agents. They run a round every minute: read the market, check each coin, buy only in the strike zone. Press it again to call them back. In Live mode it asks for a second tap, so one stray tap never trades real SOL.', try: 'Try it now in Practice: press Send the impi.' },
  { at: '#net', title: 'The six agents at work', text: 'Each circle is an agent with its live figure: coins watched, coins that passed the shield, coins in the strike zone, open positions. The shield in the middle shows your equity, today’s change, a countdown to the next round (blue ring) and how many position slots are used (pink).' },
  { at: '#ticker', title: 'The rules at a glance', text: 'The ticker lists the rules in force right now: the strike zone, stop, profit steps, target, the 3-hour clock, the trading minimum, and the cost of each scan.' },
  { at: '.card.indaba', title: 'The indaba: decisions out loud', text: 'Every round, the agents argue each coin out loud with the real numbers: how far it fell, its RSI, the cost to trade it. You see BUY, REFUSED and which rule said no, or NOTHING TO STRIKE. Most rounds end in waiting, and that is the strategy working.' },
  { at: '.card.positions', title: 'Your positions', text: 'Each open coin shows what you put in, what it is worth now, and a bar from its stop to its target with the price in between. Manage opens your own tools: sell 25, 50, 75 or 100%, take out what you put in, add funds, your own stop and target, and sell orders.' },
  { at: '#out', title: 'Get me out', text: 'Sells every open position at once. In Live mode it asks for a second tap first.', pad: 4 },
  { at: '.card.pnl', title: 'Equity and results', text: 'Your equity, today’s change, and the numbers that matter: trades, win rate, average per trade, best and worst trade, profit factor and how long trades last.' },
  { at: '.card.portfolio', title: 'Portfolio and costs', text: 'What your coins are worth, what they cost, what you have made so far, and what trading itself cost you. Your waiting orders are listed here with Cancel, and each recent trade has its honest receipt: every cost, rounded against Warrior.' },
  { at: '.card.score', title: 'The scorecard', text: 'While the impi is out, Chill, Balanced and Spicy each trade a pretend 1 SOL side by side, so you can see which suits the market this week. Below it: pause the impi after 3, 4 or 5 losing trades in a row.' },
  { at: '.card.care', title: 'Care: bedtime and sweep', text: 'Bedtime stops new trades overnight and can close everything at a time you choose. Sweep sends profits above an amount you keep to your Phantom after each live sale. Both are off until you switch them on.' },
  { at: '.card.adapt', title: 'Self-ruling', text: 'After every sale, Warrior checks its own history. When the evidence is clear it moves one dial one step, inside ranges tested on past prices. Each move is on probation for its next 8 trades and undone if they do worse. It never loosens a safety rule. Choose Auto, Suggest (you press Apply) or Off.' },
  { at: '.card.watchtower', title: 'The watchtower', text: 'Warrior grades its own calls. Dip weather: how many deep dips bounced in the last 6 hours, with an optional guard that trades smaller in a storm. Missed trades: coins it refused, followed for 3 hours. After the sale: whether it sold too early.' },
  { at: '.card.flow', title: 'Order flow', text: 'The coins being watched: their move over 5 minutes and an hour, how far under their average they sit, and how busy they are. Coins in the strike zone light up red.' },
  { at: '.card.wallet', title: 'Your trading wallet', text: 'Made in this browser and locked with your passphrase; the key never leaves your device. Fund it from Phantom, send SOL back any time, and save the backup key before going live. On another phone or computer, Open my wallet from another device with the same passphrase.' },
  { at: '#connect', title: 'Connect Phantom', text: 'Phantom is only used to send SOL into the trading wallet and to receive it back. Phantom asks you to approve every transfer.' },
  { at: '.card.log', title: 'The live feed', text: 'The full record: every sale with its result, every problem, every order and every change you made. Download history (CSV) under Positions saves all of it as a spreadsheet.' },
  { at: '#theme', title: 'Light or dark', text: 'Switch the look any time. Warrior remembers it on this device.', pad: 4 },
  { at: 'a[href="/risk.html"]', title: 'Before real money', text: 'Meme coins can fall to zero in minutes. Warrior makes losing trades, sometimes several in a row. It only trades while this tab is open. Practice first, and only put in what you can lose. No profit is promised. Press Tour at the top any time to see this again.', last: true }
];

let i = -1, open = false, veil, frame, card, ring, resizeTimer;
function build() {
  veil = el('div', 'tour-veil'); veil.setAttribute('aria-hidden', 'true');
  frame = el('div', 'tour-frame'); frame.setAttribute('aria-hidden', 'true');
  ring = el('div', 'tour-ring'); frame.append(ring);
  card = el('div', 'tour-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tour-title'); card.tabIndex = -1;
  document.body.append(veil, frame, card);
  // the veil only darkens: clicks reach the page, so a step can ask you to press the lit control
}
const target = (s) => document.querySelector(s.group ?? s.at) ?? document.querySelector(s.at);
function place() {
  const s = STEPS[i], t = target(s); if (!t) return;
  const r = t.getBoundingClientRect(), pad = s.pad ?? 10, vw = window.innerWidth, vh = window.innerHeight;
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(vw - 8, r.width + pad * 2), h = Math.min(vh - 8, r.height + pad * 2);
  for (const [k, v] of Object.entries({ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })) frame.style.setProperty(k, v);
  // the card goes where it fits: below, above, then beside (narrowing to the wider gap if it must), else docked at the
  // bottom of the screen. A panel taller than most of a phone screen shows its top, with the card docked below.
  let cw = Math.min(380, vw - 24); const gap = 14, size = (wd) => { card.style.setProperty('width', `${wd}px`); return card.offsetHeight || 220; };
  let ch = size(cw), cx, cy;
  const leftRoom = x - 2 * gap, rightRoom = vw - (x + w) - 2 * gap;
  if (y + h + gap + ch < vh) { cx = vw < 640 ? (vw - cw) / 2 : x; cy = y + h + gap; }
  else if (y - gap - ch > 0) { cx = vw < 640 ? (vw - cw) / 2 : x; cy = y - gap - ch; }
  else if (vw >= 640 && Math.max(leftRoom, rightRoom) >= 280) {
    const right = rightRoom >= leftRoom; cw = Math.min(380, right ? rightRoom : leftRoom); ch = size(cw);
    cx = right ? x + w + gap : x - gap - cw; cy = Math.max(12, Math.min(vh - ch - 12, y));
  } else { cx = (vw - cw) / 2; cy = vh - ch - 12; }
  cx = Math.max(12, Math.min(vw - cw - 12, cx));
  card.style.setProperty('left', `${cx}px`); card.style.setProperty('top', `${cy}px`);
}
function render() {
  const s = STEPS[i], dots = el('div', 'tour-dots');
  STEPS.forEach((_, k) => { const d = el('button', `tour-dot${k === i ? ' on' : ''}`); d.type = 'button'; d.setAttribute('aria-label', `Step ${k + 1}: ${STEPS[k].title}`); d.addEventListener('click', () => go(k)); dots.append(d); });
  const head = el('div', 'tour-head'); head.append(el('span', 'tour-count', `${i + 1} / ${STEPS.length}`), dots);
  const back = el('button', 'btn ghost small', 'Back'), next = el('button', 'btn small', s.last ? 'Finish' : 'Next'), skip = el('button', 'tour-skip', 'Skip tour');
  back.type = next.type = skip.type = 'button'; back.disabled = i === 0;
  back.addEventListener('click', () => go(i - 1)); next.addEventListener('click', () => (s.last ? close(true) : go(i + 1))); skip.addEventListener('click', () => close(true));
  const row = el('div', 'tour-row'); row.append(skip, back, next);
  const title = el('h3', '', s.title); title.id = 'tour-title';
  card.replaceChildren(head, title, el('p', '', s.text), ...(s.try ? [el('p', 'tour-try', s.try)] : []), row);
  next.focus({ preventScroll: true });
}
function go(k) {
  if (k < 0 || k >= STEPS.length) { if (k >= STEPS.length) close(true); return; }
  i = k; const t = target(STEPS[i]);
  if (t) window.dispatchEvent(new CustomEvent('warrior-reveal', { detail: t.closest('.card') })); // a folded panel opens to be shown
  if (!t) { go(k + 1); return; } // a panel missing from this layout: skip it
  frame.classList.remove('tour-pulse'); render();
  const tall = t.getBoundingClientRect().height > window.innerHeight * 0.55;
  t.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: still() ? 'auto' : 'smooth' });
  // place once the scroll has settled; place again on the next frames in case layout shifts
  let n = 0, calm = 0, lastY = NaN; const settle = () => { place(); const y = Math.round(t.getBoundingClientRect().top); calm = y === lastY ? calm + 1 : 0; lastY = y; if (calm < 8 && ++n < 150) requestAnimationFrame(settle); else if (!still()) frame.classList.add('tour-pulse'); };
  requestAnimationFrame(settle);
}
function keys(e) {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(true); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  else if (e.key === 'Tab') { const f = [...card.querySelectorAll('button:not([disabled])')]; if (!f.length) return; const a = f.indexOf(document.activeElement); if (e.shiftKey && a <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); } }
}
export function start(from = 0) {
  if (!veil) build(); open = true; document.body.classList.add('touring');
  for (const n of [veil, frame, card]) n.hidden = false;
  go(from);
}
function close(done) {
  open = false; document.body.classList.remove('touring'); for (const n of [veil, frame, card]) n.hidden = true;
  if (done) try { localStorage.setItem(SEEN, '1'); } catch { /* shown again next time */ }
  document.getElementById('tour')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', keys, true);
window.addEventListener('resize', () => { if (!open) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(place, 80); });
window.addEventListener('scroll', () => { if (open) place(); }, { passive: true });
document.getElementById('tour')?.addEventListener('click', () => start(0));
// a first visit starts it once the desk has drawn
let seen = false; try { seen = localStorage.getItem(SEEN) === '1'; } catch { seen = true; }
if (!seen) setTimeout(() => { if (!document.querySelector('dialog[open]')) start(0); }, 1600);
