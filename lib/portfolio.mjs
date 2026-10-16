// Portfolio and results. Pure sums over what the trader recorded; nothing here guesses a price.

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Summarise holdings and closed trades for one mode ('paper' or 'live').
 * `prices` maps mint -> current USD price. A holding with no current price is valued at cost and flagged, never invented.
 */
export function summarize({ positions = [], trades = [], prices = {}, mode }) {
  const mine = positions.filter((p) => p.mode === mode), closed = trades.filter((t) => t.mode === mode);
  const holdings = mine.map((p) => {
    const now = prices[p.mint], known = fin(now) && now > 0 && fin(p.entry) && p.entry > 0;
    const valueSol = known ? p.solIn * now / p.entry : p.solIn;
    return { mint: p.mint, symbol: p.symbol, costSol: p.solIn, valueSol, pnlSol: valueSol - p.solIn, pnlPct: known ? (now / p.entry - 1) * 100 : null, priced: known, entry: p.entry, now: known ? now : null, stop: p.stop, target: p.target, ownStop: p.ownStop ?? null, ownTarget: p.ownTarget ?? null, openedAt: p.openedAt, rulesVersion: p.rulesVersion ?? null };
  });
  const cost = holdings.reduce((n, h) => n + h.costSol, 0), value = holdings.reduce((n, h) => n + h.valueSol, 0);
  const realized = closed.reduce((n, t) => n + (fin(t.pnlSol) ? t.pnlSol : 0), 0);
  const wins = closed.filter((t) => t.pnlSol > 0).length, losses = closed.filter((t) => t.pnlSol < 0).length;
  const sorted = [...closed].sort((a, b) => b.pnlSol - a.pnlSol);
  return {
    mode, holdings, costSol: cost, valueSol: value, unrealizedSol: value - cost, realizedSol: realized, unpriced: holdings.filter((h) => !h.priced).length,
    closed: closed.length, wins, losses, winRatePct: closed.length ? wins / closed.length * 100 : null,
    best: sorted[0] ?? null, worst: sorted.at(-1) ?? null
  };
}

// A spreadsheet treats a cell starting with = + - or @ as a formula. Coin names are chosen by strangers, so neutralise them.
const cell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Trade history as CSV text, newest last. */
export function tradesCsv(trades = []) {
  // The last eight columns were added so a history can show which kind of trade loses money and what Warrior saw when it bought.
  const head = ['closed_at_utc', 'mode', 'coin', 'sol_in', 'sol_out', 'result_sol', 'result_pct', 'why_closed', 'rules_version', 'exit_transaction', 'kind', 'opened_at_utc', 'minutes_held', 'coin_age_min_at_buy', 'holders_at_buy', 'traders_at_buy', 'bundles_at_buy', 'coin_address', 'round_trip_cost_pct'];
  const more = (t) => { const c = t.checked ?? {}, n = (v) => fin(v) ? String(Math.round(v)) : ''; return [t.kind ?? (t.rocket ? 'rocket' : ''), fin(t.openedAt) ? new Date(t.openedAt).toISOString() : '', fin(t.openedAt) && fin(t.closedAt) ? ((t.closedAt - t.openedAt) / 60_000).toFixed(1) : '', n(c.ageMin), n(c.holders), n(c.traders), n(c.bundles), t.mint ?? '', fin(t.costPct) ? t.costPct.toFixed(2) : '']; };
  const rows = trades.map((t) => [fin(t.closedAt) ? new Date(t.closedAt).toISOString() : '', t.mode === 'live' ? 'trading-wallet' : t.mode === 'wallet' ? 'own-wallet' : 'practice', t.symbol, fin(t.solIn) ? t.solIn.toFixed(6) : '', fin(t.solOut) ? t.solOut.toFixed(6) : '', fin(t.pnlSol) ? t.pnlSol.toFixed(6) : '', fin(t.pnlPct) ? t.pnlPct.toFixed(2) : '', t.reason ?? '', t.rulesVersion ?? '', t.exit && t.exit !== 'paper' ? t.exit : '', ...more(t)]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
