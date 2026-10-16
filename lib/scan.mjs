import { universe, candles, tokenPools } from './market.mjs';
import { analyze, defaultSettings, validateSettings, smartEntry, YOUNG_HOURS } from './strategy.mjs';
import { smartList, smartBuyers } from './smart.mjs';
import { screenToken } from './risk.mjs';

/** Is this pool too young for the normal five-minute reading? Unknown age is treated as not young. */
export const isYoung = (token, now = Date.now()) => Number.isFinite(token?.createdAt) && now - token.createdAt < YOUNG_HOURS * 3_600_000;
/**
 * One coin's verdict from its candles. A coin under five hours old is read on one-minute candles when the rules allow
 * young coins; otherwise it waits and says why. A coin whose candles cannot be read waits; it is never guessed.
 */
export async function verdict(token, { settings = {}, now = Date.now() } = {}) {
  const young = isYoung(token, now), allowed = (settings.youngCoins ?? defaultSettings.youngCoins) === 1;
  if (young && !allowed) return { ...token, analysis: { decision: 'wait', score: 0, reasons: ['Young coin: your rules wait until a coin has five hours of history'], confirmations: null, young: true, tf: 5 }, bars: 0 };
  try {
    const bars = await candles(token.pool, 200, now, young ? 1 : 5, token.mint), analysis = analyze(bars, settings, { young });
    // A coin nobody has traded for a while is not "trending": six minutes without a bar for a young coin, fifteen otherwise.
    const stale = !bars.length || now - bars.at(-1).t > (young ? 6 : 15) * 60_000;
    // A deep dip on a coin that has collapsed over the day is not a dip (lib/strategy.mjs, dipDayDropPct).
    const drop = (settings.dipDayDropPct ?? defaultSettings.dipDayDropPct), day = token.change?.h24;
    const collapsed = analysis.style === 'dip' && drop > 0 && Number.isFinite(day) && day < -drop ? { ...analysis, decision: 'wait', style: undefined, reasons: [`Down ${Math.abs(day).toFixed(0)}% in 24 hours: a collapse, not a dip (your limit is ${drop}%)`] } : analysis;
    return { ...token, analysis: stale ? { ...collapsed, decision: 'wait', reasons: ['Candles are stale', ...collapsed.reasons] } : collapsed, bars: bars.length, candleSource: bars.source ?? null };
  } catch { return { ...token, analysis: { decision: 'wait', score: 0, reasons: ['Candles unavailable'], confirmations: null, young, tf: young ? 1 : 5 }, bars: 0 }; }
}

/**
 * Look up one coin by address: its deepest pool, Warrior's verdict under `rules`, and the safety screen's answer.
 * `mintSafety` is passed in because the server and the bot reach the chain differently. Returns null when no pool trades it.
 */
export async function lookupCoin(mint, rules, mintSafety) {
  const pools = await tokenPools(mint); if (!pools.length) return null;
  const [coin, safety] = await Promise.all([verdict(pools[0], { settings: rules.settings }), mintSafety(mint)]);
  const screen = screenToken({ ...pools[0], freezeAuthority: safety.reason === 'creator can freeze it', mintAuthority: safety.reason === 'creator can mint more' }, rules.risk);
  const reasons = [...screen.reasons]; if (!safety.safe && !reasons.some((r) => /frozen|mint more/i.test(r))) reasons.push(`Token check: ${safety.reason}`);
  return { ...coin, screen: { ok: reasons.length === 0, reasons }, safe: safety.safe, verified: safety.verified !== false, pools: pools.length };
}

/**
 * Scan the market: screen each coin, then run the strategy on the ones that pass.
 * Returns every coin with its verdict and reasons, best first. Read-only.
 */
export async function scan({ mature = false, limit = 8, settings = {}, risk = {}, now = Date.now() } = {}) {
  const { tokens, sourcesFailed, sources } = await universe({ mature });
  const screened = tokens.map((t) => ({ token: t, screen: screenToken(t, risk, now) }));
  // Which of the coins that pass the screen get their candles read?
  // With trend buys possible: half the busiest, a quarter that just dropped (deep dips), a quarter rising fastest.
  // Dips only (the presets since October 15: RSI capped at 50 with four groups, so no trend buy can qualify): three
  // quarters go to ACTIVE coins that have just dropped, busiest first, and a quarter to the busiest coins of all (a dip
  // can start between scans). Coins the dip rules would refuse anyway (down more than the daily limit, too quiet) are
  // not given a place.
  const passed = screened.filter((s) => s.screen.ok), cfg = validateSettings(settings), vol = (t) => t.volume1hUsd ?? 0;
  const dipsOnly = cfg.deepDip === 1 && cfg.maxEntryRsi <= 50 && cfg.minConfluence >= 4;
  let eligible;
  if (dipsOnly) {
    const dipSlots = Math.ceil(limit * 0.75), dayLimit = cfg.dipDayDropPct > 0 ? -cfg.dipDayDropPct : -60;
    const dipping = passed.filter((s) => (s.token.change?.h1 ?? 0) <= -3 && (s.token.change?.h24 ?? 0) > dayLimit && vol(s.token) >= cfg.minVol1hUsd).sort((a, b) => vol(b.token) - vol(a.token)).slice(0, dipSlots);
    const taken = new Set(dipping.map((d) => d.token.mint)), busiest = passed.filter((s) => !taken.has(s.token.mint) && vol(s.token) >= cfg.minVol1hUsd).sort((a, b) => vol(b.token) - vol(a.token)).slice(0, limit - dipping.length);
    eligible = [...dipping, ...busiest];
  } else {
    const busiest = [...passed].sort((a, b) => vol(b.token) - vol(a.token)).slice(0, Math.ceil(limit * 0.5));
    const taken = new Set(busiest.map((s) => s.token.mint)), dipSlots = cfg.deepDip === 1 ? Math.floor(limit / 4) : 0;
    const dipping = passed.filter((s) => !taken.has(s.token.mint) && (s.token.change?.h1 ?? 0) <= -4 && (s.token.change?.h24 ?? 0) > -60).sort((a, b) => (a.token.change?.h1 ?? 0) - (b.token.change?.h1 ?? 0)).slice(0, dipSlots);
    for (const d of dipping) taken.add(d.token.mint);
    const rising = passed.filter((s) => !taken.has(s.token.mint) && (s.token.change?.h1 ?? 0) > 0).sort((a, b) => ((b.token.change?.m5 ?? 0) + (b.token.change?.h1 ?? 0) / 4) - ((a.token.change?.m5 ?? 0) + (a.token.change?.h1 ?? 0) / 4)).slice(0, limit - busiest.length - dipping.length);
    eligible = [...busiest, ...dipping, ...rising];
  }
  // Candle calls go out together; the data source's allowance (see market.mjs) paces them.
  const results = await Promise.all(eligible.map(({ token }) => verdict(token, { settings, now })));
  // Smart wallets: for every coin read, how many listed wallets bought it in the last 15 minutes.
  const s = validateSettings(settings), smart = s.smartWallets === 1 ? await smartList() : null;
  if (smart?.set?.size) await Promise.all(results.map(async (t) => { try { const b = await smartBuyers(t.mint, smart.set, { now }); t.smart = { count: b.count }; t.analysis = smartEntry(t.analysis, b.count, settings); } catch { t.smart = { count: null }; } }));
  results.sort((a, b) => (b.analysis.decision === 'enter') - (a.analysis.decision === 'enter') || b.analysis.score - a.analysis.score);
  return {
    at: new Date(now).toISOString(), scanned: results.length, universe: tokens.length, sourcesFailed, sources,
    smartList: smart?.info ?? null,
    rejected: screened.filter((s) => !s.screen.ok).length, passedScreen: passed.length, results,
    note: 'A signal is a rule-based reading of recent price and volume. It is not a prediction and it can be wrong.'
  };
}
