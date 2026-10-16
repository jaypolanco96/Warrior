// Settings and explanations open in their own box instead of unfolding inside the page.
// Each fold-out written into the page (Rocket Mode, Exact numbers, Bedtime rules, How trades are sent, Coin account rent,
// Sweep winnings home, the "how this works" notes…) becomes a button. Pressing it opens a box holding exactly what the
// fold-out held: the same fields with the same ids, so every setting keeps working as before. Fold-outs that cards build
// for themselves (a card's numbers, About this coin, Why Warrior trusted this coin) are left as they are.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let count = 0;
for (const fold of [...document.querySelectorAll('main section.panel details')]) {
  const summary = fold.querySelector(':scope > summary'); if (!summary) continue;
  const title = summary.textContent.trim(), note = fold.classList.contains('more'), box = el('dialog', 'sheet'), head = el('h2', '', title), x = el('button', 'dialog-x', '✕'), open = el('button', note ? 'btn small ghost sheet-open note' : 'btn sheet-open', title), done = el('button', 'btn', 'Done'), foot = el('div', 'dialog-actions');
  box.id = `sheet-${fold.id || ++count}`; head.id = `${box.id}-title`; box.setAttribute('aria-labelledby', head.id); x.type = 'button'; x.setAttribute('aria-label', 'Close'); open.type = 'button'; done.type = 'button'; open.setAttribute('aria-haspopup', 'dialog');
  if (fold.id === 'rocket') open.classList.add('rocket-open');
  fold.replaceWith(open); foot.append(done); box.append(x, head, fold, foot); document.body.append(box);
  // The fold-out stays inside the box, opened and closed with it, so code that listens for it opening still runs.
  open.addEventListener('click', () => { fold.open = true; if (!box.open) box.showModal(); box.scrollTop = 0; });
  box.addEventListener('close', () => { fold.open = false; open.focus({ preventScroll: true }); });
  x.addEventListener('click', () => box.close()); done.addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => { if (e.target !== box) return; const r = box.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) box.close(); });
}
// Buttons that ended up next to each other sit in one row.
for (const first of [...document.querySelectorAll('.sheet-open')]) {
  if (first.parentElement?.classList.contains('tool-row') || first.previousElementSibling?.classList?.contains('sheet-open')) continue;
  const row = el('div', 'tool-row'); first.before(row); let next = first; while (next?.classList?.contains('sheet-open')) { const after = next.nextElementSibling; row.append(next); next = after; }
}

// The Mode picker shows as two side-by-side buttons. The dropdown stays in the page, unseen, as the one thing the rest
// of Warrior reads and sets, so the buttons only ever press it and copy what it says.
const mode = document.getElementById('auto-mode');
if (mode) {
  const group = el('div', 'seg'), label = mode.closest('label'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Mode');
  const buttons = [['paper', 'Practice', 'Pretend 0.5 SOL. Nothing is sent.'], ['live', 'Live', 'Real funds from the trading wallet.']].map(([value, text, hint]) => { const b = el('button', 'btn seg-btn', text); b.type = 'button'; b.dataset.value = value; b.title = hint; b.addEventListener('click', () => { if (mode.disabled || mode.value === value) return; mode.value = value; mode.dispatchEvent(new Event('change', { bubbles: true })); sync(); }); group.append(b); return b; });
  const hint = el('span', 'muted seg-hint');
  function sync() { for (const b of buttons) { const on = b.dataset.value === mode.value; b.classList.toggle('on', on); b.classList.toggle('live', on && b.dataset.value === 'live'); b.setAttribute('aria-pressed', String(on)); b.disabled = mode.disabled && !on; if (on) hint.textContent = mode.disabled ? `${b.title} Stop auto-trading to switch.` : b.title; } }
  mode.hidden = true; if (label) { label.classList.add('seg-label'); label.append(group, hint); } else mode.after(group, hint);
  sync(); setInterval(sync, 400); mode.addEventListener('change', sync);
}
