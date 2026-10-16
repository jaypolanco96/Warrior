// What a coin is: its full address (to copy or look up) and, when the data source has one, its own "about" text.
// The about text and links are written by whoever made the coin. Warrior shows them as plain text, checks nothing in them,
// and says so. Used on position cards.
const KEY = 'warrior.about.v1', DAY = 86_400_000;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let cache = {}; try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch {}
const pending = new Map(), opened = new Set(); // which coins' About is unfolded, so it stays open when the card is redrawn
function remember(mint, about) { cache[mint] = { at: Date.now(), about }; const keys = Object.keys(cache); if (keys.length > 60) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - 60)) delete cache[k]; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} }
/** A coin's about facts, asked once and then kept for a day (an hour when there was nothing to show yet). */
function load(mint) {
  const hit = cache[mint]; if (hit && Date.now() - hit.at < (hit.about?.description || hit.about?.links?.length ? DAY : DAY / 24)) return Promise.resolve(hit.about);
  if (!pending.has(mint)) pending.set(mint, fetch(`/api/coin?what=about&mint=${mint}`).then((r) => r.ok ? r.json() : null).then((j) => { const about = j && !j.error ? j : null; if (about) remember(mint, about); return about; }).catch(() => null).finally(() => pending.delete(mint)));
  return pending.get(mint);
}
function fill(box, about) {
  box.replaceChildren();
  if (!about || (!about.description && !about.links?.length)) { box.append(el('p', 'muted', about ? 'This coin has not published an "about".' : 'The "about" could not be read just now.')); return; }
  if (about.name) box.append(el('p', 'about-name', about.name));
  if (about.description) { const text = el('p', 'about-text', about.description.length > 280 ? `${about.description.slice(0, 280)}…` : about.description); box.append(text); if (about.description.length > 280) { const more = el('button', 'btn small', 'Show all'); more.type = 'button'; more.addEventListener('click', () => { text.textContent = about.description; more.remove(); }); box.append(more); } }
  if (about.links?.length) { const row = el('p', 'about-links'); for (const l of about.links) { const a = el('a', '', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; row.append(a, ' '); } box.append(row); }
  box.append(el('p', 'muted about-note', 'Written by the coin\'s creator, not by Warrior. Nobody has checked it, and the links are theirs.'));
}
/**
 * The block for a card: the address with Copy and "View on Solscan", plus a fold-out "About this coin".
 * `facts` are short extra lines for the card (when it was opened, why, under which rules).
 */
export function coinInfo(mint, facts = []) {
  const wrap = el('div', 'coin-info'), row = el('p', 'coin-address'), code = el('code', '', mint), copy = el('button', 'btn small', 'Copy address'), scan = el('a', '', 'View on Solscan');
  copy.type = 'button'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(mint); copy.textContent = 'Copied'; } catch { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = 'Selected: press copy'; } setTimeout(() => { copy.textContent = 'Copy address'; }, 2500); });
  scan.href = `https://solscan.io/token/${encodeURIComponent(mint)}`; scan.target = '_blank'; scan.rel = 'noopener noreferrer';
  row.append(el('span', 'muted', 'Coin address '), code); const acts = el('p', 'coin-address-acts'); acts.append(copy, ' ', scan); wrap.append(row, acts);
  for (const f of facts.filter(Boolean)) wrap.append(el('p', 'muted coin-fact', f));
  const details = el('details', 'about'), sum = el('summary', '', 'About this coin'), box = el('div', 'about-body'); box.append(el('p', 'muted', 'Loading…')); details.append(sum, box); wrap.append(details);
  // Fetched when opened, or at once if it is already known, so a page of cards does not ask for everything.
  const hit = cache[mint]; if (hit?.about) fill(box, hit.about);
  let asked = !!hit?.about; const ask = () => { if (asked) return; asked = true; void load(mint).then((about) => fill(box, about)); };
  if (opened.has(mint)) { details.open = true; ask(); }
  details.addEventListener('toggle', () => { if (details.open) { opened.add(mint); ask(); } else opened.delete(mint); });
  return wrap;
}
