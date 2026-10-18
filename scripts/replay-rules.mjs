// Research-only fill model. Candle prices cannot reproduce live quotes, liquidity or intra-bar ordering.
import { manage } from '../lib/strategy.mjs';
import { partialDue } from '../lib/orders.mjs';
const BAR = 300000, H = 3600000;
export function replayPosition(bars, signalIndex, settings, { cost = 1.5, literalTrailing = false } = {}) {
  const first = bars[signalIndex + 1]; if (!first || first.t - bars[signalIndex].t !== BAR) return null;
  const entry = first.open * (1 + cost / 200), p = { entry, stop: entry * (1 - settings.dipStopPct / 100), baseStop: entry * (1 - settings.dipStopPct / 100), target: entry * (1 + settings.targetPct / 100), peak: entry, openedAt: first.t, entryBar: bars[signalIndex].t, dip: 1, auto: {}, solIn: 1 };
  let left = 1, out = 0;
  for (let j = signalIndex + 1; j < bars.length; j++) {
    const b = bars[j]; if (j > signalIndex + 1 && b.t - bars[j-1].t !== BAR) return null;
    const m = manage(p, bars.slice(Math.max(signalIndex, j-1), j+1), settings);
    // Both possible orders are stressed: previously earned trailing stops, and production's same-bar trailing reading.
    const stop = literalTrailing ? m.stop ?? p.stop : p.stop;
    let reason = null, price;
    if (b.low <= stop) { reason = stop >= entry ? 'trailing-stop' : 'stop'; price = Math.min(stop, b.open, b.close); }
    else if (b.high >= p.target) { reason = 'target'; price = Math.min(p.target, b.close); }
    else if (b.t + BAR - first.t >= settings.holdHours * H) { reason = 'time'; price = b.close; }
    if (reason) {
      out += left * price / entry * (1 - cost / 200);
      return { pct: (out - 1) * 100, reason, openedAt: first.t, closedAt: b.t + BAR, endIndex: j };
    }
    const due = partialDue(p, (b.close / entry * (1 - cost / 200) - 1) * 100, settings);
    if (due?.kind === 'sell') { const sold = left * due.fraction; out += sold * b.close / entry * (1 - cost / 200); left -= sold; p.auto[due.mark] = true; }
    p.peak = m.peak ?? p.peak; p.stop = Math.max(p.stop, m.stop ?? p.stop);
  }
  return null; // Incomplete positions are never booked as wins or losses.
}
