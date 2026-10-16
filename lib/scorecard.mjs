// The public scorecard. Every ENTER signal the recorder sees is written down, and later marked with what the price did.
// Nobody edits it by hand: scripts/scorecard.mjs runs these functions on a schedule and commits the file.
// It measures the CALL (what price did after the signal), before trading costs. It is not anyone's profit.

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
export const blankCard = () => ({ version: 1, updatedAt: null, samples: 0, signals: [] });

/** Write down every new ENTER in a scan. A coin already being tracked is not recorded twice. */
export function recordSignals(card, scan, { now = Date.now(), rulesVersion = 'balanced', maxHoldBars = 72 } = {}) {
  const out = { ...card, samples: (card.samples ?? 0) + 1, updatedAt: new Date(now).toISOString(), signals: [...card.signals] }, open = new Set(out.signals.filter((s) => s.outcome === 'open').map((s) => s.mint)); let added = 0;
  for (const t of scan?.results ?? []) {
    const a = t.analysis; if (a?.decision !== 'enter' || open.has(t.mint) || ![a.price, a.stop, a.target, a.at].every(fin)) continue;
    out.signals.push({ id: `${t.mint.slice(0, 6)}-${a.at}`, mint: t.mint, symbol: String(t.symbol ?? '').slice(0, 16), pool: t.pool, calledAt: new Date(now).toISOString(), bar: a.at, entry: a.price, stop: a.stop, target: a.target, stopPct: a.stopPct, targetPct: a.targetPct, score: a.score, regime: a.regime, bias: a.bias, young: a.young === true, rulesVersion, maxHoldBars, outcome: 'open', resultPct: null, closedAt: null });
    open.add(t.mint); added++;
  }
  return { card: out, added };
}

/**
 * What happened after one signal, from the candles that came after it.
 * The first of: stop touched, target touched, or the time limit. If one bar touches both, it counts as the stop:
 * the scorecard never gives itself the benefit of the doubt.
 */
export function resolveSignal(signal, candles) {
  if (signal.outcome !== 'open') return signal;
  const after = (candles ?? []).filter((c) => c.t > signal.bar).sort((a, b) => a.t - b.t);
  for (const [i, c] of after.entries()) {
    const done = (outcome, price) => ({ ...signal, outcome, resultPct: Math.round((price / signal.entry - 1) * 10_000) / 100, closedAt: new Date(c.t + 300_000).toISOString(), bars: i + 1 });
    if (c.low <= signal.stop) return done('stop', Math.min(c.open, signal.stop));
    if (c.high >= signal.target) return done('target', signal.target);
    if (i + 1 >= signal.maxHoldBars) return done('time', c.close);
  }
  return signal;
}
/** A signal whose candles can no longer be read is closed as 'unknown' after two days, and counted separately, not hidden. */
export function expireSignal(signal, now = Date.now()) { return signal.outcome === 'open' && now - Date.parse(signal.calledAt) > 2 * 86_400_000 ? { ...signal, outcome: 'unknown', closedAt: new Date(now).toISOString() } : signal; }

/** The headline numbers, losers included. */
export function scoreSummary(card) {
  const all = card?.signals ?? [], closed = all.filter((s) => ['stop', 'target', 'time'].includes(s.outcome) && fin(s.resultPct)), wins = closed.filter((s) => s.resultPct > 0);
  const sum = closed.reduce((n, s) => n + s.resultPct, 0);
  return {
    total: all.length, open: all.filter((s) => s.outcome === 'open').length, unknown: all.filter((s) => s.outcome === 'unknown').length, closed: closed.length,
    targets: closed.filter((s) => s.outcome === 'target').length, stops: closed.filter((s) => s.outcome === 'stop').length, timeouts: closed.filter((s) => s.outcome === 'time').length,
    wins: wins.length, losses: closed.length - wins.length, winRatePct: closed.length ? Math.round(wins.length / closed.length * 1000) / 10 : null, averagePct: closed.length ? Math.round(sum / closed.length * 100) / 100 : null,
    samples: card?.samples ?? 0, updatedAt: card?.updatedAt ?? null
  };
}
