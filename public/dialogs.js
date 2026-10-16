// Every pop-up box gets a close button at the top right that stays in reach while the box scrolls.
// The two reading boxes (coin tools, extras) also close when you click the dark area outside them. Boxes where you type
// something that matters (the wallet steps, a trade) do not, so a stray click cannot throw the typing away.
// The "quick word" box is left alone: it asks a question and wants one of its two answers.
const BOXES = [['trade', false], ['coin', true], ['extra', true], ['vault', false], ['welcome', false]];
for (const [id, outsideCloses] of BOXES) {
  const box = document.getElementById(id); if (!box) continue;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'dialog-x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close');
  // The welcome box records that you have seen it when you skip it, so closing it presses its own skip button.
  x.addEventListener('click', () => { const skip = id === 'welcome' ? document.getElementById('welcome-skip') : null; if (skip) skip.click(); else box.close(); });
  box.prepend(x);
  if (outsideCloses) box.addEventListener('click', (e) => { if (e.target !== box) return; const r = box.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) box.close(); });
}
