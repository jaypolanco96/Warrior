// Risk rules. These have the last word: a good signal on a coin that fails here is not traded.

export const defaultRisk = Object.freeze({
  riskPerTradePct: 2,       // lose at most this share of the wallet if the stop is hit
  maxPositionPct: 25,       // never put more than this share of the wallet into one coin
  maxOpenPositions: 3,
  dailyLossLimitPct: 10,    // stop opening trades for the day after losing this much
  reserveSol: 0.03,         // always left for network fees and token-account rent
  minTradeSol: 0.02,
  maxPriceImpactPct: 3,       // on pump.fun pools this figure includes the pool fee of about 1% per side
  slippageBps: 150,
  minLiquidityUsd: 30000,   // October 16: was 40,000, the filter that refused the most coins. Chill keeps 80,000.
  minVolume24hUsd: 100000,
  minAgeHours: 2,           // brand-new pools are where most rug pulls happen
  cooldownMinutes: 30,      // after exiting a coin, leave it alone for a while
  // After a LOSS, longer. October 14, 2026: coins re-bought exactly 30 minutes after a losing sale (CYBERLEEK, Altai,
  // CRAWLER) lost again. October 16: the owner's trades kept re-buying coins that had just lost (ZEREBRO three times, SI276,
  // Altai, CYBERLEEK). Six hours instead of two, replayed on five stretches: better for every strength (Spicy +2.62% ->
  // +2.90% a trade, Balanced +2.98% -> +3.08%, Chill +4.28% -> +4.49%), and Chill and Spicy are no worse in any stretch.
  lossCooldownMinutes: 360
});

export function validateRisk(r) {
  const out = { ...defaultRisk, ...r }, n = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!n(out.riskPerTradePct, 0.1, 10) || !n(out.maxPositionPct, 1, 100) || !n(out.dailyLossLimitPct, 1, 75)) throw new Error('Invalid risk percentages');
  if (!Number.isInteger(out.maxOpenPositions) || out.maxOpenPositions < 1 || out.maxOpenPositions > 10) throw new Error('maxOpenPositions must be 1 to 10');
  if (!n(out.reserveSol, 0.01, 10) || !n(out.minTradeSol, 0.005, 10) || !n(out.maxPriceImpactPct, 0.1, 10)) throw new Error('Invalid trade bounds');
  if (!Number.isInteger(out.slippageBps) || out.slippageBps < 10 || out.slippageBps > 1000) throw new Error('slippageBps must be 10 to 1000');
  if (!n(out.minLiquidityUsd, 1000, 1e9) || !n(out.minVolume24hUsd, 0, 1e12) || !n(out.minAgeHours, 0, 24 * 365) || !n(out.cooldownMinutes, 0, 1440) || !n(out.lossCooldownMinutes, 0, 1440)) throw new Error('Invalid screening bounds');
  return Object.freeze(out);
}

const PUMP_EXCHANGES = new Set(['pumpswap', 'pump-fun']);
/**
 * A pool on pump.fun's exchange for a coin that was NOT launched on pump.fun. A pump.fun launch moves its pool money
 * there under the launchpad's control; a pool opened by hand can be emptied by whoever funded it, at any moment.
 * (Learned the hard way on October 12, 2026: a coin of this kind passed the screen and its pool was emptied.)
 */
export const unlockedPool = (token) => PUMP_EXCHANGES.has(token?.dex) && typeof token?.mint === 'string' && !token.mint.endsWith('pump');

/** Is this coin's pool safe enough to consider at all? Missing data fails: unknown is not safe. */
export function screenToken(token, riskInput = {}, now = Date.now()) {
  const r = validateRisk(riskInput), reasons = [];
  if (!token || typeof token.mint !== 'string') return { ok: false, reasons: ['Unknown token'] };
  if (!Number.isFinite(token.liquidityUsd)) reasons.push('Liquidity unknown'); else if (token.liquidityUsd < r.minLiquidityUsd) reasons.push('Liquidity too thin');
  if (!Number.isFinite(token.volume24hUsd)) reasons.push('Volume unknown'); else if (token.volume24hUsd < r.minVolume24hUsd) reasons.push('Volume too low');
  if (!Number.isFinite(token.createdAt)) reasons.push('Pool age unknown'); else if ((now - token.createdAt) / 3_600_000 < r.minAgeHours) reasons.push('Pool too new');
  if (unlockedPool(token)) reasons.push('Pool money is not locked');
  if (token.freezeAuthority) reasons.push('Token can be frozen by its creator');
  if (token.mintAuthority) reasons.push('Creator can still mint more supply');
  return { ok: reasons.length === 0, reasons };
}

/** A small wallet may take the smallest trade even when the rules ask for less, as long as the loss at the stop stays under this many times the usual risk. */
export const SMALL_WALLET_RISK_LIMIT = 1.5;
/**
 * How much SOL to put into a trade. Size so that hitting the stop loses riskPerTradePct of the wallet (times
 * `sizeFactor`, which is 0.5 for a young coin), then cap by maxPositionPct and by what is spendable after the fee reserve.
 *
 * Small wallets: when that sum comes out under the smallest trade, the smallest trade is used instead, provided the
 * wallet can afford it inside its other limits and a stop-out would lose no more than 1.5 times the usual risk.
 * The result says so (`raised`, `riskPct`) so the person is told. Otherwise the trade is refused with the real reason.
 */
export function positionSize({ balanceSol, equitySol, stopPct, openPositions, dayPnlSol, sizeFactor = 1 }, riskInput = {}) {
  const r = validateRisk(riskInput), reasons = [];
  if (![balanceSol, equitySol, stopPct].every(Number.isFinite) || equitySol <= 0 || stopPct <= 0) return { sol: 0, reasons: ['Wallet or stop unavailable'] };
  if (openPositions >= r.maxOpenPositions) reasons.push('Already holding the maximum number of positions');
  if (Number.isFinite(dayPnlSol) && dayPnlSol < 0 && dayPnlSol <= -equitySol * r.dailyLossLimitPct / 100) reasons.push('Daily loss limit reached; done for today');
  const factor = Number.isFinite(sizeFactor) && sizeFactor > 0 && sizeFactor <= 1 ? sizeFactor : 1, spendable = balanceSol - r.reserveSol;
  const byRisk = equitySol * r.riskPerTradePct / stopPct * factor, byCap = equitySol * r.maxPositionPct / 100;
  let sol = Math.floor(Math.max(0, Math.min(byRisk, byCap, spendable)) * 1e6) / 1e6, raised = false;
  const riskOf = (amount) => amount * stopPct / equitySol; // percent of the wallet lost if the stop is hit
  if (sol < r.minTradeSol) {
    if (spendable < r.minTradeSol) reasons.push('Not enough SOL for a trade after the fee reserve');
    else if (byCap < r.minTradeSol) reasons.push(`Wallet too small: the smallest trade (${r.minTradeSol} SOL) is more than ${r.maxPositionPct}% of it`);
    else if (riskOf(r.minTradeSol) > r.riskPerTradePct * SMALL_WALLET_RISK_LIMIT) reasons.push(`Wallet too small for this stop: the smallest trade would risk ${riskOf(r.minTradeSol).toFixed(1)}% of it, and your rules allow ${r.riskPerTradePct}%`);
    else { sol = r.minTradeSol; raised = true; }
  }
  return { sol: reasons.length ? 0 : sol, byRisk, byCap, spendable, reasons, raised: !reasons.length && raised, riskPct: riskOf(reasons.length ? 0 : sol) };
}

/** Check a Jupiter quote before trading on it. */
export function checkQuote(quote, { inputMint, outputMint, amountRaw }, riskInput = {}) {
  const r = validateRisk(riskInput), reasons = [];
  if (!quote || quote.inputMint !== inputMint || quote.outputMint !== outputMint || quote.inAmount !== String(amountRaw)) return { ok: false, reasons: ['Quote does not match the request'] };
  if (!/^\d+$/.test(quote.outAmount ?? '') || BigInt(quote.outAmount) <= 0n || !/^\d+$/.test(quote.otherAmountThreshold ?? '')) reasons.push('Quote amounts unavailable');
  const impact = Math.abs(Number(quote.priceImpactPct));
  // Jupiter reports price impact as a fraction of 1 on this endpoint (0.01 = 1%).
  if (!Number.isFinite(impact)) reasons.push('Price impact unknown'); else if (impact * 100 > r.maxPriceImpactPct) reasons.push('Price impact too high');
  return { ok: reasons.length === 0, reasons, impactPct: Number.isFinite(impact) ? impact * 100 : null };
}
