// The honest receipt. Every cost Warrior can measure, and the true result.
// Rounding rule: costs round UP and results round DOWN, so no figure is ever rounded in Warrior's favour.

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
export const roundUp = (n, places = 6) => { const f = 10 ** places; return Math.ceil(n * f - 1e-9) / f; };
export const roundDown = (n, places = 6) => { const f = 10 ** places; return Math.floor(n * f + 1e-9) / f; };
const solText = (n) => `${n.toFixed(6)} SOL`;

/**
 * What the trader records while a position is open, so the receipt can be exact later.
 * `impactPct` comes from the quote and on pump.fun pools includes the pool fee.
 */
export function entryCosts({ requestedSol, spentSol, impactPct }) {
  return { requestedSol, impactSol: fin(impactPct) ? requestedSol * impactPct / 100 : null, extraSol: fin(spentSol) ? Math.max(0, spentSol - requestedSol) : 0 };
}
/** Add a second buy (a slice) to the running entry costs. */
export function addEntryCosts(a, b) {
  if (!a) return b; if (!b) return a;
  return { requestedSol: a.requestedSol + b.requestedSol, impactSol: a.impactSol === null || b.impactSol === null ? null : a.impactSol + b.impactSol, extraSol: a.extraSol + b.extraSol };
}
/** The share of entry costs that belongs to the part being sold. */
export function shareOf(costs, fraction) { return costs ? { requestedSol: costs.requestedSol * fraction, impactSol: costs.impactSol === null ? null : costs.impactSol * fraction, extraSol: costs.extraSol * fraction } : null; }

/**
 * Build the receipt for a closed trade.
 * trade: { solIn, solOut, pnlSol, mode, costs: { entry: {requestedSol, impactSol, extraSol}, exitImpactPct, exitQuotedSol } }
 */
export function receipt(trade) {
  if (!trade || !fin(trade.solIn) || !fin(trade.solOut)) return { complete: false, lines: [], note: 'This trade has no amounts on record.' };
  // 'live' is the trading wallet, measured from its balance. 'wallet' is a trade you approved in your own wallet: real
  // money, but Warrior only has the quotes, so anything it could not measure is said to be not measured.
  const measured = trade.mode === 'live', own = trade.mode === 'wallet', live = measured || own, c = trade.costs ?? null, lines = [], add = (label, sol, note = '', kind = 'cost') => lines.push({ label, sol, text: sol === null ? 'not recorded' : solText(sol), note, kind });
  add('You put in', roundUp(trade.solIn), measured ? 'What actually left the wallet.' : own ? 'The amount you chose to swap.' : 'Pretend SOL.', 'in');
  let known = 0, complete = !!c;
  if (c?.entry) {
    if (c.entry.impactSol === null) { add('Cost of buying (pool fee and price impact)', null, 'The quote did not report it.'); complete = false; }
    else { const v = roundUp(c.entry.impactSol); known += v; add('Cost of buying (pool fee and price impact)', v, 'From the quote at the moment of the buy.'); }
    if (measured) { const v = roundUp(c.entry.extraSol); known += v; add('Network fees and account rent on the way in', v, 'Measured: what left the wallet beyond the amount swapped.'); }
  }
  if (trade.reason === 'written-off') lines.push({ label: 'Selling', sol: 0, text: 'nothing sold', note: 'The pool was emptied, so there was no sale and no selling cost.', kind: 'cost' });
  else if (c && fin(c.exitQuotedSol)) {
    if (fin(c.exitImpactPct)) { const v = roundUp(c.exitQuotedSol * c.exitImpactPct / (100 - Math.min(99, c.exitImpactPct))); known += v; add('Cost of selling (pool fee and price impact)', v, 'From the quote at the moment of the sale.'); }
    else { add('Cost of selling (pool fee and price impact)', null, 'The quote did not report it.'); complete = false; }
    if (measured) { const v = roundUp(Math.max(0, c.exitQuotedSol - trade.solOut)); known += v; add('Slippage and network fee on the way out', v, 'Measured: the quote said more than the wallet received.'); }
  }
  if (!live) add('Network fees', 0, 'None: practice sends no transaction. A real trade would pay a small one each way.');
  if (own) { add('Network fees and slippage', null, 'Not measured: your own wallet sent this trade. Its history has the exact figures.'); complete = false; }
  if (!c) lines.push({ label: 'Costs', sol: null, text: 'not recorded', note: 'This trade was made before Warrior kept cost details.', kind: 'cost' });
  if (Number.isFinite(trade.rentBackSol) && trade.rentBackSol > 0) add('Account rent returned', roundDown(trade.rentBackSol), "Closing the coin's empty account brought this back. It is already inside what you got out.", 'back');
  // Warrior charges nothing today. The line is always printed so a fee could never appear without being seen here first.
  const fee = Number.isFinite(trade.warriorFeeSol) && trade.warriorFeeSol > 0 ? roundUp(trade.warriorFeeSol) : 0; known += fee;
  add("Warrior's fee", fee, fee ? 'Charged by Warrior.' : 'None. Warrior charges no fee. If that ever changes, it is shown before you trade and here after.', 'fee');
  add('You got out', roundDown(trade.solOut), measured ? "Measured from the wallet's balance." : 'From the sell quote.', 'out');
  const result = roundDown(trade.solOut - trade.solIn), costs = roundUp(known);
  return {
    complete, lines, costsSol: costs, resultSol: result, resultPct: roundDown((trade.solOut / trade.solIn - 1) * 100, 2),
    beforeCostsSol: c ? roundDown(trade.solOut - trade.solIn + known) : null,
    note: own ? 'This result comes from the quotes at the moment you traded, so it is close but not exact. Your wallet history is the final word.' : complete ? 'Costs are rounded up and results are rounded down. The result is what you got out minus what you put in; the costs are already inside it.' : 'Some costs were not recorded, so the cost total is a minimum. The result itself is exact.'
  };
}
