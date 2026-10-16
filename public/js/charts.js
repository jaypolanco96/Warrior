// Small canvas charts in the posts' style: an equity line, a distribution histogram and a volume bar strip, all in
// rainbow-road colours.
const ROAD = ['#e63946', '#f77f00', '#fcbf49', '#2a9d8f', '#1d70e0', '#7b2cbf', '#d81b60'];
function prep(c) { const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d); const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, r.width, r.height); return [x, r.width, r.height]; }
function road(x, w) { const g = x.createLinearGradient(0, 0, w, 0); ROAD.forEach((c, i) => g.addColorStop(i / (ROAD.length - 1), c)); return g; }

/** Equity over time: a rainbow line over a soft fill, with a dashed line where it started. */
export function line(c, values) {
  const [x, w, h] = prep(c); if (values.length < 2 || Math.max(...values) - Math.min(...values) < 1e-9) { x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--soft').trim() || '#6b5a7e'; x.font = '12px ui-monospace,Consolas,monospace'; x.fillText('Flat until the first trade.', 6, h / 2); x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#ecdcc0'; x.fillRect(0, h - 2, w, 2); return; }
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, px = (i) => 4 + i / (values.length - 1) * (w - 8), py = (v) => h - 6 - (v - lo) / span * (h - 12);
  x.setLineDash([3, 4]); x.strokeStyle = '#d9c7a8'; x.beginPath(); x.moveTo(0, py(values[0])); x.lineTo(w, py(values[0])); x.stroke(); x.setLineDash([]);
  x.beginPath(); values.forEach((v, i) => (i ? x.lineTo(px(i), py(v)) : x.moveTo(px(i), py(v)))); x.lineTo(px(values.length - 1), h); x.lineTo(px(0), h); x.closePath();
  const f = x.createLinearGradient(0, 0, 0, h); f.addColorStop(0, 'rgba(252,191,73,.35)'); f.addColorStop(1, 'rgba(252,191,73,0)'); x.fillStyle = f; x.fill();
  x.beginPath(); values.forEach((v, i) => (i ? x.lineTo(px(i), py(v)) : x.moveTo(px(i), py(v)))); x.strokeStyle = road(x, w); x.lineWidth = 2.5; x.stroke();
}
/** Where the watched coins sit against their 20-candle average: a histogram, the strike zone (left tail) highlighted. */
export function hist(c, values, strikeAt = -8) {
  const [x, w, h] = prep(c), lo = -20, hi = 20, n = 32, bins = new Array(n).fill(0);
  for (const v of values) if (Number.isFinite(v)) bins[Math.max(0, Math.min(n - 1, Math.floor((v - lo) / (hi - lo) * n)))]++;
  const top = Math.max(1, ...bins), bw = w / n;
  bins.forEach((b, i) => { const v = lo + (i + 0.5) * (hi - lo) / n, bh = b / top * (h - 18); x.fillStyle = v <= strikeAt ? '#e63946' : ROAD[Math.floor(i / n * ROAD.length)] + '99'; x.fillRect(i * bw + 1, h - 14 - bh, bw - 2, bh); });
  x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--soft').trim() || '#6b5a7e'; x.font = '10px ui-monospace,Consolas,monospace'; x.textAlign = 'left'; x.fillText(`${lo}%`, 2, h - 2); x.textAlign = 'center'; x.fillText('0', w / 2, h - 2); x.textAlign = 'right'; x.fillText(`+${hi}%`, w - 2, h - 2);
  const sx = (strikeAt - lo) / (hi - lo) * w; x.strokeStyle = '#e63946'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, h - 14); x.stroke(); x.setLineDash([]);
  x.textAlign = 'left'; x.fillStyle = '#e63946'; x.font = '700 10px ui-monospace,Consolas,monospace'; x.fillText('STRIKE ZONE', 4, 10);
}
/** A strip of bars (trading volume of the watched coins), coloured along the rainbow road. */
export function bars(c, values) {
  const [x, w, h] = prep(c), n = Math.max(values.length, 1), top = Math.max(1, ...values.map((v) => Math.log10(1 + v))), bw = w / n;
  values.forEach((v, i) => { const bh = Math.log10(1 + v) / top * (h - 4); x.fillStyle = ROAD[i % ROAD.length]; x.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh); });
}
