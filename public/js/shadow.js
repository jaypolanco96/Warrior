// The scorecard: Chill, Balanced and Spicy each trade their own pretend 1 SOL side by side, every round the impi runs,
// so your own results show which strength suits the market this week. Estimates, not real fills: buys and sells are
// priced from the scan and the position checks, and each trade is charged 1% for the round trip (more than most
// watched coins cost: see the COST column in your history). Exits follow each strength's own stop, target, clock and profit steps, exactly as the real impi does.
import { resolveRules, toQuery } from '/vendor/lib/presets.js';
import { positionSize } from '/vendor/lib/risk.js';
import { partialDue } from '/vendor/lib/orders.js';
import { state, save, api, post, emit } from './store.js';

export const PRESETS = ['chill', 'balanced', 'spicy'];
const blankBook = () => ({ sol: 1, positions: [], trades: [], since: Date.now() });
export function books() { state.shadow ??= {}; for (const k of PRESETS) state.shadow[k] ??= blankBook(); return state.shadow; }
export function resetBooks() { state.shadow = {}; books(); save(); emit('shadow'); }

const held = (b) => b.positions.reduce((n, p) => n + p.solIn * (p.last ?? p.entry) / p.entry, 0);
function close(b, p, fraction, reason) {
  const whole = fraction >= 0.999, cost = whole ? p.solIn : p.solIn * fraction, gross = cost * (p.last ?? p.entry) / p.entry, out = gross * (1 - p.costPct / 100), pnl = out - cost;
  b.sol += out; b.trades.push({ pnlSol: pnl, pnlPct: pnl / cost * 100, partial: !whole, reason, symbol: p.symbol, at: Date.now() }); if (b.trades.length > 300) b.trades.shift();
  if (whole) b.positions = b.positions.filter((x) => x !== p); else p.solIn -= cost;
}

/** One scorecard round. `scans` holds the scan the impi already made for its own strength, so it is not fetched twice. */
export async function shadowRound(known = {}) {
  const all = books();
  for (const preset of PRESETS) {
    const b = all[preset], R = resolveRules({ preset });
    try {
      // exits first: the same server check the real impi uses
      if (b.positions.length) {
        const list = [...b.positions], res = (await post('/api/manage', { rules: { preset }, positions: list.map((p) => ({ pool: p.pool, mint: p.mint, entry: p.entry, stop: p.stop, target: p.target, entryBar: p.entryBar, openedAt: p.openedAt, peak: p.peak, tf: p.tf, baseStop: p.baseStop, ...(p.dip ? { dip: 1 } : {}) })) })).results ?? [];
        for (const [i, m] of res.entries()) {
          const p = list[i]; if (!p || m.pool !== p.pool) continue;
          if (m.peak) p.peak = m.peak; if (m.stop) p.stop = Math.max(p.stop, m.stop); if (m.lastPrice) p.last = m.lastPrice;
          if (m.action === 'exit') { close(b, p, 1, m.reason); continue; }
          const gain = ((p.last ?? p.entry) / p.entry - 1) * 100, step = partialDue(p, gain, R.settings);
          if (step?.kind === 'sell') { p.auto[step.mark] = 1; close(b, p, step.fraction, step.reason); }
        }
      }
      // then entries
      const scan = known[preset] ?? await api(`/api/scan?${toQuery({ preset })}`), owned = new Set(b.positions.map((p) => p.mint));
      for (const t of (scan.results ?? []).filter((x) => x.analysis?.decision === 'enter' && x.analysis.style !== 'smart' && !owned.has(x.mint) && Number.isFinite(x.priceUsd))) {
        if (b.positions.length >= R.risk.maxOpenPositions) break;
        const a = t.analysis, eq = b.sol + held(b), size = positionSize({ balanceSol: b.sol, equitySol: eq, stopPct: a.stopPct ?? 10, openPositions: b.positions.length, dayPnlSol: 0, sizeFactor: a.sizeFactor ?? 1 }, R.risk);
        if (!size.sol) continue;
        const entry = t.priceUsd, stop = entry * (1 - (a.stopPct ?? 10) / 100);
        b.sol -= size.sol; b.positions.push({ mint: t.mint, symbol: t.symbol, pool: t.pool, solIn: size.sol, entry, stop, baseStop: stop, target: entry * (1 + R.settings.targetPct / 100), entryBar: a.at ?? Date.now(), openedAt: Date.now(), peak: entry, tf: a.tf === 1 ? 1 : 5, ...(a.style === 'dip' ? { dip: 1 } : {}), auto: {}, last: entry, costPct: 1 });
      }
    } catch { /* this strength sits this round out; the others carry on */ }
  }
  save(); emit('shadow');
}

/** The scorecard numbers for one strength. */
export function score(preset) {
  const b = books()[preset], whole = b.trades.filter((t) => !t.partial), sum = b.trades.reduce((n, t) => n + t.pnlSol, 0), eq = b.sol + held(b);
  let streak = 0, worst = 0; for (const t of whole) { streak = t.pnlSol < 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  return { equity: eq, changePct: (eq - 1) * 100, trades: whole.length, winPct: whole.length ? whole.filter((t) => t.pnlSol > 0).length / whole.length * 100 : null, avgSol: whole.length ? sum / whole.length : null, worstStreak: worst, open: b.positions.length, since: b.since };
}
