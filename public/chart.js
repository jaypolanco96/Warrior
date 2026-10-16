// The small one-minute line chart, used on position cards and on scanner cards. It shows the last hour of closing
// prices, one per minute, as a line; on a position it also draws a dashed line at the price paid.
// It is a picture of where the price has been. It predicts nothing. Drawn with plain shapes, no chart library.
const SVG = 'http://www.w3.org/2000/svg', FRESH_MS = 55_000, cache = new Map(); // mint -> { points: [[time, price]], at, asking }
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const shape = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

function draw(fig) {
  const got = cache.get(fig.dataset.chartMint), pts = got?.points ?? [], entry = Number(fig.dataset.entry) > 0 ? Number(fig.dataset.entry) : null, symbol = fig.dataset.symbol || 'This coin'; fig.replaceChildren();
  if (pts.length < 2) { fig.append(el('figcaption', 'muted', got && !got.asking && got.at ? 'No one-minute chart for this coin right now.' : 'Loading the one-minute chart…')); return; }
  const W = 300, H = 72, pad = 4, prices = pts.map((x) => x[1]), top = Math.max(...prices), bottom = Math.min(...prices);
  const lo = entry ? Math.min(bottom, entry) : bottom, hi = entry ? Math.max(top, entry) : top, span = hi - lo || hi || 1;
  const x = (i) => pad + i * (W - 2 * pad) / (pts.length - 1), y = (v) => pad + (hi - v) * (H - 2 * pad) / span, last = prices.at(-1), up = entry ? last >= entry : last >= prices[0];
  const svg = shape('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${symbol}, the last ${pts.length} minutes: from $${prices[0].toPrecision(4)} to $${last.toPrecision(4)}${entry ? `, you paid $${entry.toPrecision(4)}` : ''}` });
  if (entry) svg.append(shape('line', { x1: 0, x2: W, y1: y(entry).toFixed(1), y2: y(entry).toFixed(1), class: 'chart-entry' }));
  svg.append(shape('polyline', { points: prices.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: `chart-line ${up ? 'up' : 'down'}` }), shape('circle', { cx: x(pts.length - 1).toFixed(1), cy: y(last).toFixed(1), r: 2.5, class: `chart-dot ${up ? 'up' : 'down'}` }));
  const mins = Math.max(1, Math.round((pts.at(-1)[0] - pts[0][0]) / 60_000)), move = (last / prices[0] - 1) * 100;
  fig.append(svg, el('figcaption', 'muted', `1-minute prices, last ${mins} min${entry ? '' : ` (${move >= 0 ? '+' : '−'}${Math.abs(move).toFixed(1)}%)`} · high $${top.toPrecision(4)} · low $${bottom.toPrecision(4)}${entry ? ' · dashed line: what you paid' : ''}`));
}
const redraw = (mint) => { for (const fig of document.querySelectorAll('[data-chart-mint]')) if (fig.dataset.chartMint === mint) draw(fig); };

/** Fetch one coin's chart at most once a minute, however many cards show it, then redraw every card that does. */
async function load(mint, pool) {
  const got = cache.get(mint); if (got?.asking || (got && Date.now() - got.at < FRESH_MS)) return;
  cache.set(mint, { points: got?.points ?? [], at: got?.at ?? 0, asking: true });
  let points = got?.points ?? [];
  try { const r = await fetch(`/api/coin?what=chart&${new URLSearchParams({ mint, pool })}`), j = r.ok ? await r.json() : null; if (Array.isArray(j?.points)) points = j.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0); } catch { /* keep the last picture */ }
  if (cache.size > 80) for (const k of [...cache.keys()].slice(0, cache.size - 80)) cache.delete(k);
  cache.set(mint, { points, at: Date.now(), asking: false }); redraw(mint);
}
// A chart is fetched when its card comes into view, so a page of cards does not ask for everything at once.
const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) void load(e.target.dataset.chartMint, e.target.dataset.pool); }, { rootMargin: '200px' }) : null;
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  for (const fig of document.querySelectorAll('[data-chart-mint]')) { const r = fig.getBoundingClientRect(); if (r.width > 0 && r.bottom > -200 && r.top < innerHeight + 200) void load(fig.dataset.chartMint, fig.dataset.pool); }
}, 20_000);

/** The chart for one coin. `entry` (the price paid) is optional and draws the dashed line. */
export function lineChart({ mint, pool, symbol, entry = null }) {
  const fig = el('figure', 'pos-chart'); fig.dataset.chartMint = mint; fig.dataset.pool = pool; fig.dataset.symbol = symbol ?? ''; if (Number.isFinite(entry) && entry > 0) fig.dataset.entry = String(entry);
  draw(fig); if (seen) seen.observe(fig); else void load(mint, pool);
  return fig;
}
/** A coin's address in short, with the full address on hover and a Copy button. */
export function addressLine(mint) {
  const row = el('p', 'card-address'), code = el('code', '', `${mint.slice(0, 4)}…${mint.slice(-4)}`), copy = el('button', 'btn small', 'Copy address'); code.title = mint; copy.type = 'button';
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(mint); copy.textContent = 'Copied'; } catch { code.textContent = mint; copy.textContent = 'Shown in full'; } setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy address'; }, 2000); });
  row.append(code, copy); return row;
}
