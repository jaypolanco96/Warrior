// The centrepiece: the impi's shield as a glowing rainbow orb, its six agents orbiting it as labelled nodes, threads between
// them, and a pulse running along a thread whenever an agent acts. Drawn on a canvas; still when motion is reduced.
const COLORS = ['#e63946', '#f77f00', '#e0a300', '#2a9d8f', '#1d70e0', '#7b2cbf'];
let canvas, ctx, agents = [], pulses = [], glow = {}, raf = 0, t0 = performance.now(), logo;
/** Live figures drawn on the network: one chip per agent, read-outs around the shield, and two gauges (next round, slots used). */
let data = { agents: {}, top: '', bottom: '', running: false, nextAt: 0, slots: [0, 1] };
export function setData(d) { data = { ...data, ...d }; }
const MONO = 'ui-monospace,Consolas,monospace';
function chip(text, x, y, c, size = 11) { ctx.font = `700 ${size}px ${MONO}`; const w = ctx.measureText(text).width + 12, h = size + 8; ctx.fillStyle = '#fff'; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2) : ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke(); ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1); }
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startNet(el, list) {
  canvas = el; ctx = el.getContext('2d'); agents = list; logo = new Image(); logo.src = '/logo.svg';
  const fit = () => { const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1; canvas.width = Math.max(1, r.width * d); canvas.height = Math.max(1, r.height * d); ctx.setTransform(d, 0, 0, d, 0, 0); };
  new ResizeObserver(fit).observe(canvas); fit();
  cancelAnimationFrame(raf); const loop = () => { draw(); raf = requestAnimationFrame(loop); }; loop();
}
/** An agent acted: light it up and send a pulse from it to the centre (or to another agent). */
export function fire(id, to = null) { glow[id] = performance.now(); pulses.push({ from: id, to, at: performance.now() }); if (pulses.length > 40) pulses.shift(); }

function place(w, h) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36, t = still() ? 0 : (performance.now() - t0) / 60000;
  return agents.map((a, i) => { const ang = -Math.PI / 2 + i * (Math.PI * 2 / agents.length) + t; return { ...a, x: cx + Math.cos(ang) * R * 1.25, y: cy + Math.sin(ang) * R, c: COLORS[i % COLORS.length] }; });
}
function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight, now = performance.now(); if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, nodes = place(w, h), byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  // faint beadwork rings
  for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, Math.min(w, h) * 0.12 * k * 1.25, Math.min(w, h) * 0.12 * k, 0, 0, Math.PI * 2); ctx.strokeStyle = `rgba(123,44,191,${0.07 - k * 0.01})`; ctx.setLineDash([2, 6]); ctx.stroke(); }
  ctx.setLineDash([]);
  // threads: every agent to the centre, and around the ring
  nodes.forEach((n, i) => {
    const m = nodes[(i + 1) % nodes.length];
    ctx.strokeStyle = 'rgba(27,18,48,.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); ctx.stroke();
    const g = ctx.createLinearGradient(n.x, n.y, cx, cy); g.addColorStop(0, n.c + 'aa'); g.addColorStop(1, n.c + '10'); ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(cx, cy); ctx.stroke();
  });
  // data flowing along every thread toward the shield while the impi is out
  if (data.running && !still()) nodes.forEach((n, i) => { for (let j = 0; j < 3; j++) { const k = ((now / 1600 + j / 3 + i * 0.13) % 1); ctx.fillStyle = n.c; ctx.globalAlpha = 0.25 + 0.5 * (1 - k); ctx.beginPath(); ctx.arc(n.x + (cx - n.x) * k, n.y + (cy - n.y) * k, 2.2, 0, Math.PI * 2); ctx.fill(); } }); ctx.globalAlpha = 1;
  // the orb: rainbow halo and the shield
  const r = Math.min(w, h) * 0.17, beat = still() ? 0 : Math.sin(now / 700) * 4;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.8 + beat);
  halo.addColorStop(0, 'rgba(252,191,73,.55)'); halo.addColorStop(0.45, 'rgba(216,27,96,.18)'); halo.addColorStop(0.75, 'rgba(29,112,224,.10)'); halo.addColorStop(1, 'rgba(255,248,236,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * 1.8 + beat, 0, Math.PI * 2); ctx.fill();
  const ring = ctx.createConicGradient ? ctx.createConicGradient(now / 3000, cx, cy) : null;
  if (ring) { ['#e63946', '#f77f00', '#fcbf49', '#2a9d8f', '#1d70e0', '#7b2cbf', '#d81b60', '#e63946'].forEach((c, i, a) => ring.addColorStop(i / (a.length - 1), c)); ctx.strokeStyle = ring; } else ctx.strokeStyle = '#7b2cbf';
  ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.fill();
  if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, cx - r * 0.5, cy - r * 0.78, r, r);
  // gauge 1 (outer): time to the next round; gauge 2: positions open out of the most allowed
  ctx.lineCap = 'round';
  const left = data.nextAt ? Math.max(0, Math.min(1, (data.nextAt - Date.now()) / 60000)) : 0;
  ctx.strokeStyle = 'rgba(27,18,48,.08)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, r + 12, 0, Math.PI * 2); ctx.stroke();
  if (left) { ctx.strokeStyle = '#1d70e0'; ctx.beginPath(); ctx.arc(cx, cy, r + 12, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke(); }
  const [used, max] = data.slots; for (let k = 0; k < max; k++) { const a0 = Math.PI * 0.15 + k * (Math.PI * 0.7 / max), a1 = a0 + Math.PI * 0.7 / max - 0.06; ctx.strokeStyle = k < used ? '#d81b60' : 'rgba(216,27,96,.15)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, r + 22, a0, a1); ctx.stroke(); }
  ctx.lineCap = 'butt';
  // tick marks like a dial
  for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2, l = k % 5 ? 3 : 7; ctx.strokeStyle = 'rgba(27,18,48,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r + 30), cy + Math.sin(a) * (r + 30)); ctx.lineTo(cx + Math.cos(a) * (r + 30 + l), cy + Math.sin(a) * (r + 30 + l)); ctx.stroke(); }
  // read-outs inside the shield
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (data.top) { ctx.fillStyle = '#1b1230'; ctx.font = `800 ${Math.max(11, r * 0.17)}px ${MONO}`; ctx.fillText(data.top, cx, cy + r * 0.42); }
  if (data.mid) { ctx.fillStyle = data.midUp ? '#12a066' : '#d62839'; ctx.font = `700 ${Math.max(10, r * 0.13)}px ${MONO}`; ctx.fillText(data.mid, cx, cy + r * 0.64); }
  // corner read-outs, clear of the orbiting agents
  const cw = (t) => { ctx.font = `700 10px ${MONO}`; return ctx.measureText(t).width + 12; };
  if (data.next) chip(data.next, 6 + cw(data.next) / 2, 14, '#1d70e0', 10);
  if (data.bottom) chip(data.bottom, w - 6 - cw(data.bottom) / 2, h - 14, '#7b2cbf', 10);
  // pulses travelling along threads
  pulses = pulses.filter((p) => now - p.at < 1400);
  for (const p of pulses) { const a = byId[p.from]; if (!a) continue; const b = p.to && byId[p.to] ? byId[p.to] : { x: cx, y: cy }, k = (now - p.at) / 1400, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
    ctx.fillStyle = a.c; ctx.globalAlpha = 1 - k * 0.6; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  // the agents
  for (const n of nodes) {
    const lit = Math.max(0, 1 - (now - (glow[n.id] ?? 0)) / 1800), rad = 22 + lit * 6;
    ctx.fillStyle = n.c + '22'; ctx.beginPath(); ctx.arc(n.x, n.y, rad + 10 * lit, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = n.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(n.x, n.y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = n.c; ctx.font = '700 15px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n.glyph, n.x, n.y + 1);
    ctx.fillStyle = '#1b1230'; ctx.font = '700 10px ui-monospace,Consolas,monospace'; ctx.fillText(n.name.toUpperCase(), n.x, n.y + rad + 12);
    ctx.fillStyle = '#6b5a7e'; ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.fillText(n.role, n.x, n.y + rad + 24);
    const d = data.agents[n.id]; if (d) chip(d, n.x, n.y - rad - 14, n.c, 10);
  }
}
