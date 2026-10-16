// Panels marked data-fold start closed, so the page opens on what a trader acts on: look up, scan, positions, auto-trade.
// data-fold="phone" folds only on a narrow screen. A tap on the heading opens or closes a panel, the choice is kept on
// this device, and following a link to a panel (the jump bar, or any #link) opens it. Nothing is removed from the page:
// a folded panel's contents are only hidden, so everything inside keeps working.
const KEY = 'warrior.folds.v1', narrow = () => window.matchMedia('(max-width: 640px)').matches;
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch {}
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} };
for (const panel of document.querySelectorAll('section.panel[data-fold]')) {
  const head = panel.querySelector('.panel-head'), title = head?.querySelector('h2'); if (!head || !title) continue;
  const id = title.id, startsShut = panel.dataset.fold === 'phone' ? narrow() : true, btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn small fold-btn'; btn.setAttribute('aria-controls', id);
  const set = (open, remember) => { panel.classList.toggle('folded', !open); btn.textContent = open ? 'Hide' : 'Show'; btn.setAttribute('aria-expanded', String(open)); if (remember) { saved[id] = open; keep(); } };
  btn.addEventListener('click', () => set(panel.classList.contains('folded'), true)); head.append(btn);
  title.addEventListener('click', () => { if (panel.classList.contains('folded')) set(true, true); });
  panel.openFold = () => set(true, false);
  set(typeof saved[id] === 'boolean' ? saved[id] : !startsShut, false);
}
const openTarget = () => { const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null, panel = el?.closest('section.panel[data-fold]'); if (panel?.openFold) { panel.openFold(); el.scrollIntoView({ block: 'start' }); } };
window.addEventListener('hashchange', openTarget); openTarget();
