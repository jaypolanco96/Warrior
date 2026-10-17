// Folding on phones (from Laugh): the page opens on what a trader acts on (the impi, equity, positions, the indaba,
// portfolio, wallet); the other panels start folded to their heading. A tap on a heading opens or closes it, and the choice
// is kept on this device. Nothing is removed: a folded panel's contents are only hidden, so everything keeps working.
const KEY = 'warrior.folds.v1', narrow = () => window.matchMedia('(max-width: 700px)').matches;
const FOLDED_FIRST = ['agents', 'flow', 'dist', 'adapt', 'watchtower', 'score', 'care', 'log'];
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { saved = {}; }
const nameOf = (card) => FOLDED_FIRST.find((n) => card.classList.contains(n)) ?? null;
const cards = () => [...document.querySelectorAll('.card')].filter(nameOf);

function apply() {
  for (const card of cards()) {
    const n = nameOf(card), h = card.querySelector('.label'), folded = narrow() && (saved[n] ?? true);
    card.classList.toggle('folded', folded); card.classList.toggle('foldable', narrow());
    if (h) { h.setAttribute('role', narrow() ? 'button' : 'heading'); h.tabIndex = narrow() ? 0 : -1; h.setAttribute('aria-expanded', String(!folded)); }
  }
}
function toggle(card) { if (!narrow()) return; const n = nameOf(card); saved[n] = !card.classList.contains('folded'); try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* kept for this visit */ } apply(); }
for (const card of cards()) {
  const h = card.querySelector('.label'); if (!h) continue;
  h.addEventListener('click', () => toggle(card));
  h.addEventListener('keydown', (e) => { if (narrow() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(card); } });
}
/** Open a panel without changing the saved choice (the tour uses this to show what it is talking about). */
export function reveal(card) { card?.classList.remove('folded'); card?.querySelector('.label')?.setAttribute('aria-expanded', 'true'); }
window.addEventListener('warrior-reveal', (e) => reveal(e.detail));
window.matchMedia('(max-width: 700px)').addEventListener('change', apply);
apply();
