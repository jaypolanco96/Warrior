// The war drum: Warrior's alert sound, synthesized in the browser (no recordings). A deep ngoma-style drum with a falling
// pitch, a sharp slap on the skin and a dry rim, played in four patterns so each event can be told apart by ear:
//   buy   - a rising call to battle        win   - a triumphant roll
//   loss  - two slow, heavy beats          alert - an urgent triple (a pause, the daily limit, a problem)
// Browsers only allow sound after you have touched the page once, so the drum wakes on your first tap or key press.
let ctx = null;
const wake = () => { try { ctx ??= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') void ctx.resume(); } catch { ctx = null; } };
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, wake, { capture: true, passive: true });

function noise(len) { const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
/** One stroke. kind: 'bass' (the open centre of the skin), 'slap' (near the rim), 'rim' (a dry click). */
function stroke(at, kind = 'bass', gain = 1) {
  const out = ctx.createGain(); out.connect(ctx.destination); out.gain.value = 0.9 * gain;
  if (kind === 'bass') {
    // the body: a sine that drops from about 120 Hz to 48 Hz, with a soft second partial for weight
    for (const [f0, f1, g, d] of [[120, 48, 1, 0.55], [240, 90, 0.25, 0.25]]) {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + d * 0.6);
      e.gain.setValueAtTime(0.0001, at); e.gain.exponentialRampToValueAtTime(g, at + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(e).connect(out); o.start(at); o.stop(at + d + 0.05);
    }
    // the hand hitting the skin: a short burst of low-passed noise
    const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), e = ctx.createGain(); n.buffer = noise(0.05); lp.type = 'lowpass'; lp.frequency.value = 900;
    e.gain.setValueAtTime(0.5, at); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.05); n.connect(lp).connect(e).connect(out); n.start(at);
  } else {
    // slap and rim: a higher, tighter tone with a bright noise crack
    const f = kind === 'slap' ? 330 : 520, d = kind === 'slap' ? 0.16 : 0.06;
    const o = ctx.createOscillator(), e = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(f * 1.4, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.03);
    e.gain.setValueAtTime(0.0001, at); e.gain.exponentialRampToValueAtTime(kind === 'slap' ? 0.45 : 0.3, at + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, at + d);
    o.connect(e).connect(out); o.start(at); o.stop(at + d + 0.05);
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), ne = ctx.createGain(); n.buffer = noise(0.08); hp.type = 'highpass'; hp.frequency.value = kind === 'slap' ? 1500 : 3000;
    ne.gain.setValueAtTime(kind === 'slap' ? 0.55 : 0.35, at); ne.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'slap' ? 0.09 : 0.04)); n.connect(hp).connect(ne).connect(out); n.start(at);
  }
}
// [beat (in sixteenths), stroke, loudness]
const PATTERNS = {
  buy: { bpm: 132, notes: [[0, 'bass', 1], [2, 'slap', 0.7], [3, 'slap', 0.6], [4, 'bass', 1], [6, 'bass', 0.8], [7, 'rim', 0.6], [8, 'bass', 1], [9, 'slap', 0.6], [10, 'slap', 0.75], [11, 'slap', 0.9], [12, 'bass', 1.1]] },
  win: { bpm: 140, notes: [[0, 'bass', 1], [1, 'rim', 0.5], [2, 'slap', 0.7], [4, 'bass', 1], [5, 'slap', 0.6], [6, 'slap', 0.7], [7, 'slap', 0.8], [8, 'bass', 1], [9, 'bass', 0.8], [10, 'slap', 0.8], [11, 'slap', 0.9], [12, 'bass', 1.1], [14, 'bass', 1.1], [16, 'bass', 1.2]] },
  loss: { bpm: 70, notes: [[0, 'bass', 1], [4, 'bass', 0.85]] },
  alert: { bpm: 150, notes: [[0, 'slap', 0.9], [1, 'slap', 0.9], [2, 'slap', 0.9], [4, 'bass', 1], [8, 'slap', 0.9], [9, 'slap', 0.9], [10, 'slap', 0.9], [12, 'bass', 1]] }
};
/** Play a pattern now. Returns false when the browser has not allowed sound yet (no tap on the page so far). */
export function drum(kind = 'alert', volume = 1) {
  wake(); if (!ctx || ctx.state !== 'running') return false;
  const p = PATTERNS[kind] ?? PATTERNS.alert, six = 60 / p.bpm / 4, t0 = ctx.currentTime + 0.05;
  for (const [beat, k, g] of p.notes) stroke(t0 + beat * six, k, g * volume);
  return true;
}
export const drumKinds = Object.keys(PATTERNS);
