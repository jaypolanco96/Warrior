// Rocket Mode: brand-new pump.fun coins, one to sixty minutes old, held for a very large move.
// This is the riskiest thing Warrior does. Most coins this young go to nothing, so every bet is small, the screen is strict,
// and nothing here calls a coin "safe": it only refuses the ones that show a known way to hurt you.
// Pure rules. The data comes from Jupiter's launch feed (see lib/market.mjs).

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
export const ROCKET_SCREEN = Object.freeze({ minAgeMin: 1, maxAgeMin: 60, minLiquidityUsd: 6000, maxTopHoldersPct: 30, maxDevPct: 5, maxSniperPct: 15, maxInsiderPct: 15, maxBundlerPct: 15, minBuys5m: 20,
  // Added October 13, 2026, after a "GTA 6 Coin" passed the screen and was dumped to nothing 16 minutes after launch.
  // It had been bought up by bundled wallets at launch (67% at the peak), had 43 holders, its price was walked up on
  // almost no trading, and the same name had been launched and collapsed several times that day.
  maxBundlerPeakPct: 25, maxBundles: 60, quickLaunchSecs: 120, quickLaunchMinHolders: 300, cloneWindowHours: 48, maxCollapsedClones: 1,
  // Added October 13, 2026, after "fomo" passed and fell 80% in five minutes, four minutes after Warrior bought it. It left the
  // launch curve in the same second it was created, and showed 2,139 holders when only 460 wallets had ever traded it:
  // the holder count was faked by sending dust to empty wallets, which is how it got past the 300-holder rule above.
  // Of 14 such same-second launches seen that hour, 9 were down 75% to 100% within 45 minutes.
  instantLaunchSecs: 60, instantLaunchAgeMin: 120, fakeHoldersMin: 300, maxHoldersPerTrader: 3, fakeHoldersAgeMin: 1440,
  // Added later on October 13, 2026, after "SEAL" fell 89% in one minute, 24 minutes after launch. It was still on
  // pump.fun's launch curve, where the price is nothing but the coins bought so far: the few wallets that had walked
  // it up sold them all back in one go. Only 273 wallets had ever traded it. Of the young coins looked at that day,
  // every one that was still alive had left the curve and had over a thousand traders; nearly all with under a
  // hundred were already at zero. So Rocket Mode now waits for a coin to leave the curve, and wants a real crowd.
  mustGraduate: true, minTraders: 700, minTradersAgeMin: 1440,
  // The bundle count only ever grows, so it says something about a launch for its first two hours and nothing after:
  // real coins a day old (LOAD, HIRE, DOPE) had passed 60 simply by being traded. The peak share bundlers held still counts at any age.
  maxBundlesAgeMin: 120,
  // Added after "SALUTE": one of 23 coins named after "saluteface", a coin on another chain, all launched on
  // pump.fun inside an hour. Warrior bought one and it fell 90%. The earlier ones had not "collapsed" by the old
  // measure, because a dead coin on the launch curve still shows about $3,000 of pool money. So: a dead curve coin
  // now counts as collapsed, a coin with two same-named coins before it is a copy, and a swarm of same-named
  // launches within the hour is refused outright, since nothing tells the real one from the copies.
  maxEarlierNamesakes: 1, copyAgeMin: 1440, swarmWindowMin: 60, maxSwarm: 2, swarmAgeMin: 120, deadCurveMcapUsd: 6000,
  // The owner's rule, same day: copies must not cancel out the real coin. Among coins sharing a name, the real one is
  // the one ahead on both pool money and market value, and at least twice the next on one of them. That one is judged on everything else and may be traded;
  // the smaller ones are the copies and are refused. If several share a name and none clearly leads, none is bought yet.
  leaderMargin: 2, unclearRivals: 3, rivalActiveTraders: 200, rivalMinTraderShare: 0.25,
  // Added after "WISP" fell 98% two minutes after Warrior bought it, 28 minutes after launch. It had left the launch
  // curve properly and 2,431 wallets had traded it, so it passed. But the data feed marks which trading comes from
  // real people, and for WISP that was $10 of $52,000 of buying: 0.02%. The other 2,400 wallets were one group's
  // bots passing it back and forth to fake a crowd. That hour, every young coin under 0.1% was down 69% to 99%, and
  // every one that was still up was above 3%. Rocket Mode wants 1%; any automatic buy of a coin under a day old wants 0.3%.
  minOrganicBuyPct: 2.5, minOrganicBuyPctAny: 0.3, organicAgeMin: 1440,
  // The strict set, same day, after five Rocket losses to five different tricks. The idea is to stop guessing the next
  // trick and ask the coin to show what a real one shows: most of the wallets that bought it still hold it (dumped
  // coins had 1% to 11%, live ones 23% to 94%), it has had a few minutes in the open pool without collapsing, and it
  // is not already falling. Real buying is raised from 1% to 2.5%: live coins were above 3.4%.
  minHoldersPerTraderPct: 15, settleMin: 3, maxDrop5mPct: 30,
  // While a Rocket bet is open: get out when a third of the pool money has left since the buy,
  // or when four in ten of the holders it had at the buy have left. Holders leaving comes before the price does.
  poolDrainPct: 35, holderExodusPct: 40, holderExodusMin: 50,
  // The sell-off exit: selling money at least this many times buying over five minutes, with the price down this much;
  // or the biggest holders' share down by this fraction (and at least this many points) since the buy.
  sellOffRatio: 1.5, sellOffDropPct: 5, sellOffGraceSecs: 60, topHolderCutShare: 0.3, topHolderCutPoints: 4,
  // Loosened October 13, 2026, at the owner's request, after a look at 32 live launches found that no single rule was
  // what kept Rocket from trading. The window is an hour (a coin that has lasted 45 minutes has shown more than one at
  // 10). 700 traders, down from 1,000: live coins had over 1,000 and dead ones under 100, and nothing was measured in
  // between. When the feed does not report real buying, a coin may still pass if half of everyone who traded it is
  // still holding. Selling ahead of buying only refuses when it is clearly ahead or the price is also down. Two rules
  // that no longer decided anything were dropped: a 100-holder minimum and "walked up on almost no trading".
  unknownOrganicHoldPct: 50, sellAheadRatio: 1.5 });
/**
 * How strict the Rocket screen is follows the strategy dial. Chill and Balanced use the limits above. Spicy loosens the
 * ones that are matters of degree, at the owner's request on October 13, 2026 ("loosen drastically"): a smaller crowd,
 * fewer holders staying, less real buying, a smaller pool, more held by top wallets and bundles, and a same-second
 * launch may pass once it has lasted ten minutes with a real crowd still holding.
 * What Spicy does NOT loosen, because each one is a way the owner already lost money or cannot get out:
 * a crowd made of bots (under 0.3% real buying), a copy of a bigger coin, a creator who can print or freeze, a pool
 * that can be withdrawn, a coin still on the launch curve (the early lane is for those), and the cost limits.
 * Spicy will place more bets and lose more of them. That is the trade.
 */
export const ROCKET_LEVELS = Object.freeze({ chill: Object.freeze({}), balanced: Object.freeze({}), spicy: Object.freeze({
  minTraders: 300, minHoldersPerTraderPct: 8, minOrganicBuyPct: 0.5, unknownOrganicHoldPct: 30, minLiquidityUsd: 4000, settleMin: 1, maxDrop5mPct: 45,
  maxTopHoldersPct: 40, maxDevPct: 12, maxSniperPct: 25, maxInsiderPct: 25, maxBundlerPct: 25, maxBundlerPeakPct: 40, maxBundles: 150, quickLaunchMinHolders: 150, minBuys5m: 10, sellAheadRatio: 2,
  instantSurviveMin: 10, instantSurviveTraders: 700, instantSurviveHoldPct: 35,
  // A creator with many coins is only refused on Spicy when under 3% of them left the launch curve (10% elsewhere):
  // prolific creators are ordinary on pump.fun, and the wider line was the biggest blocker of otherwise sound coins.
  serialMaxShare: 0.03 }) });
export const rocketLimits = (level) => ({ ...ROCKET_SCREEN, ...(ROCKET_LEVELS[level] ?? {}) });
export const defaultRocket = Object.freeze({ on: false, betSol: 0.02, targetPct: 1000, stopPct: 50, trailStartPct: 100, trailGapPct: 40, maxPositions: 2, maxBetsPerDay: 3,
  // Once a bet has doubled, sell enough to get the stake back; the rest rides for free.
  // (There was a "rest for the day after this many losses" setting. The owner had it removed on October 13, 2026: the
  // limits on Rocket are now bets per day, positions at once and the wallet's daily loss limit.)
  takeOutAtPct: 100,
  // The early lane: bets on launches still on the curve, one to ten minutes old. Off unless switched on. An early bet is
  // sold by the same settings as any Rocket bet (target, stop, trailing stop, stake take-out, profit protection). It used
  // to have its own: a 20% stop and a trailing stop 15% under the high. On "MERGE" (October 13, 2026) a normal 35% wick
  // sold the bet at -19% two minutes in, and the coin was up 33% from the buy five minutes later. A clock that sells
  // after so many minutes is still there for those who want it; 0 means no clock.
  early: 0, earlyMinutes: 0,
  // A bet that has been in profit should not end as a loss. Once it has been up this much, the stop moves above what was
  // paid; once it has been up twice this much, the stop locks in half of the best gain. 0 = off.
  protectAtPct: 30,
  // Leave when the selling starts: far more money selling than buying over five minutes with the price falling, or the
  // biggest holders cutting their share since the buy. 1 = on, 0 = off.
  sellOffExit: 1 });

/**
 * Rocket Mode's plan comes from the preset too (October 14, 2026). The only choices left to the trader are whether it is
 * on and how much each bet is. The early lane (coins still on the launch curve) is off in every preset: all five early
 * bets on October 14 hit their stop.
 */
// Replayed October 14, 2026 on the owner's 41 real Rocket bets (minute prices, 5% costs, crashes filling below the stop),
// every combination of target (8% to 1,000%), stop, trailing stop, stake take-out and profit protection: none made money.
// The old 1,000% plan lost 6.8% a bet; the steadiest was a 50% target, a 50% stop, a trailing stop from +25% with a 15%
// gap and the stake taken out at +25%: -4.9% a bet, the same in both halves of the bets, 61% of bets winning. Smaller
// targets lose more (fees take most of a small gain); larger ones swing from half to half. Tighter stops lose more.
const PLAN = { targetPct: 50, stopPct: 50, trailStartPct: 25, trailGapPct: 15, takeOutAtPct: 25, protectAtPct: 0, sellOffExit: 1, early: 0, earlyMinutes: 0 };
export const ROCKET_PLANS = Object.freeze({
  chill: Object.freeze({ ...PLAN, maxPositions: 1, maxBetsPerDay: 3 }),
  balanced: Object.freeze({ ...PLAN, maxPositions: 2, maxBetsPerDay: 6 }),
  spicy: Object.freeze({ ...PLAN, maxPositions: 2, maxBetsPerDay: 20 })
});
/** The Rocket settings in force: the preset's plan, with the trader's on/off and bet size. */
export const rocketFor = (preset, own = {}) => validateRocket({ ...(ROCKET_PLANS[preset] ?? ROCKET_PLANS.balanced), on: own.on === true, betSol: Number.isFinite(own.betSol) ? own.betSol : defaultRocket.betSol });

/** Check Rocket Mode settings. Returns { ok, reasons, value }. */
export function validateRocket(input = {}) {
  const v = { ...defaultRocket, ...input, on: input.on === true }, reasons = [], n = (x, min, max) => fin(x) && x >= min && x <= max;
  if (!n(v.betSol, 0.02, 1)) reasons.push('Bet size must be 0.02 to 1 SOL');
  if (!n(v.targetPct, 1, 10000)) reasons.push('Target must be 1% to 10,000%');
  if (!n(v.stopPct, 10, 90)) reasons.push('Stop must be 10% to 90%');
  if (!n(v.trailStartPct, 20, 5000)) reasons.push('The trailing stop must start between 20% and 5,000% up');
  if (!n(v.trailGapPct, 5, 90)) reasons.push('The trailing stop must follow 5% to 90% under the highest price');
  if (!Number.isInteger(v.maxPositions) || v.maxPositions < 1 || v.maxPositions > 5) reasons.push('Rocket positions at once must be 1 to 5');
  if (!Number.isInteger(v.maxBetsPerDay) || v.maxBetsPerDay < 1 || v.maxBetsPerDay > 100) reasons.push('Rocket bets per day must be 1 to 100');
  if (!(v.takeOutAtPct === 0 || n(v.takeOutAtPct, 20, 1000))) reasons.push('Taking out what you put in must be 0 (off), or 20% to 1,000% up');
  if (v.early !== 0 && v.early !== 1) reasons.push('Early launches must be 1 (yes) or 0 (no)');
  if (!(v.earlyMinutes === 0 || n(v.earlyMinutes, 2, 240))) reasons.push('The early time limit must be 0 (none), or 2 to 240 minutes');
  if (!(v.protectAtPct === 0 || n(v.protectAtPct, 5, 500))) reasons.push('Protecting a profit must be 0 (off), or start between 5% and 500% up');
  if (v.sellOffExit !== 0 && v.sellOffExit !== 1) reasons.push('Selling when a sell-off starts must be 1 (yes) or 0 (no)');
  return { ok: reasons.length === 0, reasons, value: v };
}

/**
 * What the creator's earlier launches say. "Graduated" means a coin sold out its launch curve and moved to an open pool.
 * It does NOT mean the coin did well afterwards, and a creator with a record can still dump on you. It is a fact, not a
 * promise; the page words it that way.
 *   record: at least 3 launches and half or more graduated      -> highlighted
 *   serial: 20 or more launches and fewer than 1 in 10 graduated -> refused: this creator makes coins to abandon them
 *   first:  this is the creator's only coin
 *   mixed:  anything else
 */
export function creatorRecord(audit) {
  const mints = Number.isInteger(audit?.devMints) ? audit.devMints : null, graduated = Number.isInteger(audit?.devMigrations) ? audit.devMigrations : 0;
  if (mints === null || mints < 1) return { kind: 'unknown', mints: null, graduated: null, text: "The creator's history is not reported." };
  const share = graduated / mints, said = `${graduated} of this creator's ${mints} coin${mints === 1 ? '' : 's'} graduated`;
  if (mints >= 20 && share < 0.1) return { kind: 'serial', mints, graduated, share, text: `${said}. This creator launches coins by the dozen and almost none survive.` };
  if (mints >= 3 && share >= 0.5) return { kind: 'record', mints, graduated, text: `${said}. A record, not a promise: a graduated coin can still be dumped.` };
  if (mints === 1) return { kind: 'first', mints, graduated, text: "This is the creator's first coin. There is no record to judge." };
  return { kind: 'mixed', mints, graduated, text: `${said}.` };
}

/** One launch-feed entry, reduced to the facts Rocket Mode uses. Returns null for anything malformed. */
export function rocketCandidate(pool, now = Date.now()) {
  const a = pool?.baseAsset, mint = a?.id; if (!a || typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || typeof pool.id !== 'string') return null;
  const born = Date.parse(a.firstPool?.createdAt ?? a.createdAt ?? pool.createdAt), audit = a.audit ?? {}, s = a.stats5m ?? null;
  return {
    mint, pool: pool.id, symbol: String(a.symbol ?? '').slice(0, 16) || 'Unknown', name: String(a.name ?? '').slice(0, 40), dex: String(pool.dex ?? ''), launchpad: a.launchpad ?? null, tokenProgram: a.tokenProgram ?? null,
    createdAt: Number.isFinite(born) ? born : null, ageMin: Number.isFinite(born) ? (now - born) / 60_000 : null, priceUsd: fin(a.usdPrice) ? a.usdPrice : null, marketValueUsd: fin(a.mcap) ? a.mcap : null, liquidityUsd: fin(pool.liquidity) ? pool.liquidity : fin(a.liquidity) ? a.liquidity : null,
    holders: Number.isInteger(a.holderCount) ? a.holderCount : null, curvePct: fin(pool.bondingCurve) ? pool.bondingCurve : null, graduated: pool.dex === 'swap.pump.fun' || pool.type === 'pumpfun-amm',
    mintLocked: audit.mintAuthorityDisabled === true, freezeLocked: audit.freezeAuthorityDisabled === true, topHoldersPct: fin(audit.topHoldersPercentage) ? audit.topHoldersPercentage : null, devPct: fin(audit.devBalancePercentage) ? audit.devBalancePercentage : null,
    bundlerPeakPct: fin(audit.bundlerStats?.holdingPctATH) ? audit.bundlerStats.holdingPctATH : null, bundles: Number.isInteger(audit.bundlerStats?.totalBundles) ? audit.bundlerStats.totalBundles : null,
    // Seconds from launch to leaving the launch curve. Near zero means a few wallets bought the whole curve at once.
    curveSecs: Number.isFinite(Date.parse(a.graduatedAt)) && Number.isFinite(born) ? Math.max(0, (Date.parse(a.graduatedAt) - born) / 1000) : null,
    sniperPct: fin(audit.sniperPct) ? audit.sniperPct : null, insiderPct: fin(audit.insiderPct) ? audit.insiderPct : null, bundlerPct: fin(audit.bundlerStats?.holdingPct) ? audit.bundlerStats.holdingPct : null, singleOwner: audit.highSingleOwnership === true,
    buys5m: Number.isInteger(s?.numBuys) ? s.numBuys : null, sells5m: Number.isInteger(s?.numSells) ? s.numSells : null, buyUsd5m: fin(s?.buyVolume) ? s.buyVolume : null, sellUsd5m: fin(s?.sellVolume) ? s.sellVolume : null, change5mPct: fin(s?.priceChange) ? s.priceChange : null,
    turnover5mPct: fin(s?.buyVolume) && fin(a.mcap) && a.mcap > 0 ? (s.buyVolume + (fin(s.sellVolume) ? s.sellVolume : 0)) / a.mcap * 100 : null,
    // Share of its buying, by money, that the data feed attributes to real traders and not bots. Null when the feed does not say.
    organicBuyPct: ((v) => fin(v?.buyVolume) && v.buyVolume > 0 && fin(v.buyOrganicVolume) ? v.buyOrganicVolume / v.buyVolume * 100 : null)(a.stats24h ?? a.stats1h),
    // Wallets that have ever traded it, for a coin under a day old. Far fewer traders than holders means holders were manufactured.
    traders: Number.isInteger(a.stats24h?.numTraders) ? a.stats24h.numTraders : null,
    creator: creatorRecord(audit), dev: typeof a.dev === 'string' ? a.dev : null
  };
}

/**
 * The Rocket screen. Every reason is a known way a brand-new coin hurts people. Passing it does not make a coin safe.
 * Missing facts that the feed normally reports fail the coin; three it often omits for clean coins (creator share,
 * snipers, insiders) are shown as "not reported" and do not fail it by themselves.
 */
export function rocketScreen(c, limits = ROCKET_SCREEN) {
  const L = { ...ROCKET_SCREEN, ...limits }, reasons = [];
  if (!c) return { ok: false, reasons: ['Unknown coin'] };
  if (c.launchpad !== 'pump.fun' || !c.mint.endsWith('pump')) reasons.push('Not a pump.fun launch, so its pool money may be withdrawable');
  if (!fin(c.ageMin)) reasons.push('Age unknown'); else if (c.ageMin < L.minAgeMin) reasons.push('Under a minute old: nothing to read yet'); else if (c.ageMin > L.maxAgeMin) reasons.push(`Older than ${L.maxAgeMin} minutes: not a Rocket coin any more`);
  if (!c.mintLocked) reasons.push('Creator can still print more'); if (!c.freezeLocked) reasons.push('Creator can freeze it');
  if (!fin(c.priceUsd) || c.priceUsd <= 0) reasons.push('No price yet');
  if (L.mustGraduate && !c.graduated) reasons.push('Still on the pump.fun launch curve: the wallets that bought it up can sell it straight back down to nothing');
  if (c.traders === null) reasons.push('Trader count unknown');
  if (c.organicBuyPct === null || c.organicBuyPct === undefined) { if (!(c.holders !== null && c.traders > 0 && c.holders >= c.traders * L.unknownOrganicHoldPct / 100)) reasons.push(`Its share of real traders is unknown, and fewer than ${L.unknownOrganicHoldPct}% of the wallets that traded it still hold it`); }
  else if (c.organicBuyPct < L.minOrganicBuyPct && c.organicBuyPct >= L.minOrganicBuyPctAny) reasons.push(`Only ${c.organicBuyPct.toFixed(1)}% of its buying comes from real traders`);
  if (c.holders !== null && c.traders !== null && c.traders > 0 && c.holders < c.traders * L.minHoldersPerTraderPct / 100) reasons.push(`Only ${c.holders.toLocaleString('en-US')} of the ${c.traders.toLocaleString('en-US')} wallets that traded it still hold it: the rest have already left`);
  if (c.graduated && c.curveSecs !== null && fin(c.ageMin) && c.ageMin - c.curveSecs / 60 < L.settleMin) reasons.push(`It left the launch curve under ${L.settleMin} minutes ago: too soon to see whether it holds`);
  if (c.change5mPct !== null && c.change5mPct <= -L.maxDrop5mPct) reasons.push('It is falling fast right now');
  if (c.holders === null) reasons.push('Holder count unknown');
  if (c.liquidityUsd === null) reasons.push('Pool size unknown'); else if (c.liquidityUsd < L.minLiquidityUsd) reasons.push('Pool too small to get out of');
  if (c.topHoldersPct === null) reasons.push('Top-holder share unknown'); else if (c.topHoldersPct > L.maxTopHoldersPct) reasons.push(`Top holders own ${c.topHoldersPct.toFixed(0)}%`);
  if (c.singleOwner) reasons.push('One wallet owns a large share');
  if (c.devPct !== null && c.devPct > L.maxDevPct) reasons.push(`Creator still holds ${c.devPct.toFixed(1)}%`);
  if (c.sniperPct !== null && c.sniperPct > L.maxSniperPct) reasons.push(`Snipers hold ${c.sniperPct.toFixed(0)}%`);
  if (c.insiderPct !== null && c.insiderPct > L.maxInsiderPct) reasons.push(`Insiders hold ${c.insiderPct.toFixed(0)}%`);
  if (c.bundlerPct !== null && c.bundlerPct > L.maxBundlerPct) reasons.push(`Bundled wallets hold ${c.bundlerPct.toFixed(0)}%`);
  reasons.push(...launchAudit(c, [], L).reasons.filter((r) => !reasons.includes(r)));
  if (c.buys5m === null || c.buyUsd5m === null) reasons.push('No trading in the last five minutes'); else { if (c.buys5m < L.minBuys5m) reasons.push('Hardly anyone is buying'); const sold = c.sellUsd5m ?? 0; if (sold >= c.buyUsd5m * L.sellAheadRatio) reasons.push('Far more money is selling than buying'); else if (sold >= c.buyUsd5m && c.change5mPct !== null && c.change5mPct < 0) reasons.push('More money is selling than buying, and the price is down'); }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Signs that a launch was staged so its insiders can sell everything at once. These apply to any coin in its first two
 * days, Rocket or not, and are checked again at the moment of every automatic buy.
 * `clones` are other coins with the same name or ticker (see cloneCheck).
 */
export function launchAudit(c, clones = [], limits = ROCKET_SCREEN) {
  const L = { ...ROCKET_SCREEN, ...limits }, reasons = [];
  if (!c) return { ok: false, reasons: ['Launch record unavailable'] };
  if (c.bundlerPeakPct !== null && c.bundlerPeakPct > L.maxBundlerPeakPct) reasons.push(`Bundled wallets held ${c.bundlerPeakPct.toFixed(0)}% of it at one point`);
  if (c.bundles !== null && c.bundles > L.maxBundles && (c.ageMin === null || c.ageMin === undefined || c.ageMin < L.maxBundlesAgeMin)) reasons.push(`Bought through ${c.bundles} bundles: a launch staged by one group`);
  // At any age: one bundled buy for every two holders or more means one group is faking the crowd. October 15, 2026:
  // SYCAMORE (1,128 bundles, 574 holders) lost 33.6% in a minute; every other coin bought had under 0.06 bundles a holder.
  else if (c.bundles !== null && c.holders !== null && c.holders > 0 && c.bundles >= 20 && c.bundles / c.holders >= 0.5) reasons.push(`${c.bundles} bundled buys for ${c.holders} holders: one group faking the crowd`);
  // On Spicy a same-second launch may pass once it has lasted a while with a real crowd that is still holding.
  const survived = L.instantSurviveMin > 0 && c.ageMin !== null && c.ageMin >= L.instantSurviveMin && c.traders !== null && c.traders >= L.instantSurviveTraders && c.holders !== null && c.holders >= c.traders * L.instantSurviveHoldPct / 100;
  if (c.curveSecs !== null && c.curveSecs < L.instantLaunchSecs && c.ageMin !== null && c.ageMin < L.instantLaunchAgeMin && !survived) reasons.push('It left the launch curve the second it was created: one group bought the whole launch, and such coins are usually dumped within the hour');
  else if (c.curveSecs !== null && c.curveSecs < L.quickLaunchSecs && c.holders !== null && c.holders < L.quickLaunchMinHolders) reasons.push('Its whole launch was bought up at once by a few wallets');
  if (c.holders !== null && c.traders !== null && c.ageMin !== null && c.ageMin < L.fakeHoldersAgeMin && c.holders >= L.fakeHoldersMin && c.holders > c.traders * L.maxHoldersPerTrader) reasons.push(`It shows ${c.holders.toLocaleString('en-US')} holders but only ${c.traders.toLocaleString('en-US')} wallets ever traded it: the holder count was faked`);
  if (c.traders !== null && c.ageMin !== null && c.ageMin < L.minTradersAgeMin && c.traders < L.minTraders) reasons.push(`Only ${c.traders.toLocaleString('en-US')} wallets have ever traded it: too few to tell a real crowd from one group`);
  const tooYoungToTell = L.organicGraceMin > 0 && c.ageMin !== null && c.ageMin < L.organicGraceMin && c.holders !== null && c.traders > 0 && c.holders >= c.traders * L.organicGraceHoldPct / 100;
  if (c.organicBuyPct !== null && c.organicBuyPct !== undefined && c.ageMin !== null && c.ageMin < L.organicAgeMin && c.organicBuyPct < L.minOrganicBuyPctAny && !tooYoungToTell) reasons.push(`Almost none of its buying comes from real traders (${c.organicBuyPct.toFixed(2)}%): the crowd is bots passing it back and forth`);
  if (c.creator?.kind === 'serial' && (c.creator.share ?? 0) < (L.serialMaxShare ?? 0.1)) reasons.push('Creator launches coins by the dozen and abandons them');
  // Copies. The real coin among same-named ones is traded on its other merits; the copies are not.
  const dead = cloneCheck(c, clones, L), money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
  if (dead.leader === 'no') reasons.push(`It is a copy: a bigger coin has this name (${money(dead.bestMcap)} market value and ${money(dead.bestLiquidity)} of pool money, against ${money(c.marketValueUsd ?? 0)} and ${money(c.liquidityUsd ?? 0)} here)`);
  else if (dead.leader === 'unclear' && dead.rivals >= L.unclearRivals) reasons.push(`${dead.rivals} other coins share this name and none clearly leads yet, so the real one cannot be told from the copies`);
  return { ok: reasons.length === 0, reasons, clones: dead };
}
/**
 * Coins launched under the same name or ticker BEFORE this one in the last two days, and how many are already dead.
 * Only earlier ones count: a real coin that copycats imitate afterwards is not blamed for them, while the fifth
 * re-launch of a name whose first four were dumped is exactly the pattern to refuse.
 */
export function cloneCheck(c, others = [], limits = ROCKET_SCREEN, now = Date.now()) {
  const L = { ...ROCKET_SCREEN, ...limits }, key = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), mine = new Set([key(c?.name), key(c?.symbol)].filter(Boolean));
  const born = (o) => Date.parse(o.firstPool?.createdAt ?? o.createdAt), mineBorn = Number.isFinite(c?.createdAt) ? c.createdAt : now;
  const same = (others ?? []).filter((o) => o && o.id !== c?.mint && (mine.has(key(o.name)) || mine.has(key(o.symbol))) && Number.isFinite(born(o)) && now - born(o) <= L.cloneWindowHours * 3_600_000 && born(o) < mineBorn);
  const onCurve = (o) => !o.graduatedPool && !o.graduatedAt;
  const collapsed = same.filter((o) => (fin(o.liquidity) && o.liquidity < 500) || (fin(o.stats24h?.priceChange) && o.stats24h.priceChange <= -90) || (onCurve(o) && fin(o.mcap) && o.mcap < L.deadCurveMcapUsd && now - born(o) > 10 * 60_000)).length;
  // Same-named coins launched within the hour either side of this one, whichever came first.
  const swarm = (others ?? []).filter((o) => o && o.id !== c?.mint && (mine.has(key(o.name)) || mine.has(key(o.symbol))) && Number.isFinite(born(o)) && Math.abs(born(o) - mineBorn) <= L.swarmWindowMin * 60_000).length;
  // Who is the real one? Compare with every same-named coin the search knows, whatever its age.
  // Which same-named coins are real rivals? Two kinds are not, and are left out (LouLou, October 13, 2026):
  //  - an old coin that merely shares the ticker and is no longer traded. A two-year-old "loulou" that 5 wallets
  //    traded that day is not what today's launches are copying. An old coin that is still busy does count.
  //  - a copy launched after this coin that has only a fraction of its traders. Market value can be faked with a thin
  //    pool and a set price (one was "worth" $2.2M on 44 traders); a crowd cannot.
  const tradersOf = (o) => Number.isInteger(o?.stats24h?.numTraders) ? o.stats24h.numTraders : null;
  const dormantOld = (o) => Number.isFinite(born(o)) && mineBorn - born(o) > L.cloneWindowHours * 3_600_000 && tradersOf(o) !== null && tradersOf(o) < L.rivalActiveTraders;
  const thinLater = (o) => Number.isFinite(born(o)) && born(o) > mineBorn && tradersOf(o) !== null && Number.isInteger(c?.traders) && tradersOf(o) < c.traders * L.rivalMinTraderShare;
  const rivals = (others ?? []).filter((o) => o && o.id !== c?.mint && (mine.has(key(o.name)) || mine.has(key(o.symbol))) && !dormantOld(o) && !thinLater(o)), top = (pick) => rivals.reduce((m, o) => Math.max(m, fin(pick(o)) ? pick(o) : 0), 0);
  // Each rival is compared on its own two numbers: a rival that is bigger on both makes this one the copy. This one
  // leads when, against every rival, it is not far behind on either number (four fifths at least) and double on one.
  const liq = fin(c?.liquidityUsd) ? c.liquidityUsd : 0, mc = fin(c?.marketValueUsd) ? c.marketValueUsd : 0, num = (v) => fin(v) ? v : 0;
  const bigger = rivals.filter((o) => num(o.liquidity) > liq && num(o.mcap) > mc).sort((a, b) => num(b.mcap) - num(a.mcap))[0] ?? null;
  const clear = rivals.every((o) => liq >= num(o.liquidity) * 0.8 && mc >= num(o.mcap) * 0.8 && (liq >= num(o.liquidity) * L.leaderMargin || mc >= num(o.mcap) * L.leaderMargin));
  const bestLiquidity = bigger ? num(bigger.liquidity) : top((o) => o.liquidity), bestMcap = bigger ? num(bigger.mcap) : top((o) => o.mcap);
  // A copy can be handed a fat pool cheaply; it cannot fake having come first or being worth more. So this one also leads
  // when it is worth at least double every rival and every rival with more pool money was launched after it (PINCHA:
  // launched first and worth 2.5 times its biggest copy, which had three times the pool money).
  const firstAndWorthMore = Number.isFinite(c?.createdAt) && mc > 0 && rivals.every((o) => mc >= num(o.mcap) * L.leaderMargin && (num(o.liquidity) <= liq || (Number.isFinite(born(o)) && born(o) > c.createdAt)));
  const leader = !rivals.length ? 'alone' : bigger ? 'no' : clear || firstAndWorthMore ? 'yes' : 'unclear';
  return { total: same.length, collapsed, swarm, rivals: rivals.length, bestLiquidity, bestMcap, leader };
}

/** Passing coins first; among them creators with a record first, then the strongest buying. */
export function rocketRank(list) {
  const pressure = (c) => fin(c.buyUsd5m) ? c.buyUsd5m - (c.sellUsd5m ?? 0) : -Infinity, rank = (c) => (c.screen?.ok ? 2 : 0) + (c.creator?.kind === 'record' ? 1 : 0);
  return [...list].sort((a, b) => rank(b) - rank(a) || pressure(b) - pressure(a));
}

/** The plan for one Rocket bet: where it is wrong, where it is done, and how the stop follows a winner up. */
export function rocketPlan(c, prefs = defaultRocket, now = Date.now()) {
  const v = validateRocket(prefs); if (!v.ok || !fin(c?.priceUsd) || c.priceUsd <= 0) return null; const p = v.value;
  return { decision: 'rocket', price: c.priceUsd, at: now, tf: 1, stopPct: p.stopPct, targetPct: p.targetPct, stop: c.priceUsd * (1 - p.stopPct / 100), target: c.priceUsd * (1 + p.targetPct / 100), exits: { trailing: 1, trailStartPct: p.trailStartPct, trailGapPct: p.trailGapPct, trendExit: 0, holdHours: 0, takeOutAtPct: p.takeOutAtPct, protectAtPct: p.protectAtPct, sellOffExit: p.sellOffExit } };
}
/** May another Rocket bet be placed right now? Returns a reason to wait, or null. */
export function rocketRoom({ openRockets, betsToday }, prefs = defaultRocket) {
  if (openRockets >= prefs.maxPositions) return `Already holding ${openRockets} Rocket position${openRockets === 1 ? '' : 's'}, the most you allow`;
  if (betsToday >= prefs.maxBetsPerDay) return `${betsToday} Rocket bets placed today, the most you allow`;
  return null;
}

/** How many Rocket bets closed at a loss today (UTC day), from the trade list. Part-sales at a profit do not count. */
export function rocketLossesToday(trades, mode, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return (trades ?? []).filter((t) => t && t.rocket && (mode === undefined || t.mode === mode) && Number.isFinite(t.closedAt) && new Date(t.closedAt).toISOString().slice(0, 10) === day && t.pnlSol < 0 && !t.partial).length;
}
/**
 * The fast watch on an open Rocket bet, meant to run every few seconds on one look (no waiting for a second look):
 * 'stop' when the live price is at or under the stop, 'pool-draining' when a third of the pool money has left since
 * the buy. Unknown numbers return null: never sell on missing data.
 */
export function rocketWatch(position, { price, liquidityUsd } = {}, limits = ROCKET_SCREEN, now = Date.now()) {
  const p = position, L = { ...ROCKET_SCREEN, ...limits }; if (!p || !p.rocket || p.empty) return null;
  if (p.rocket.maxMinutes > 0 && Number.isFinite(p.openedAt) && now - p.openedAt >= p.rocket.maxMinutes * 60_000) return 'time';
  if (fin(price) && price > 0 && fin(p.stop) && price <= p.stop) return fin(p.entry) && p.stop > p.entry ? 'profit-lock' : 'stop'; // a stop that has moved above the price paid is a kept profit
  if (fin(liquidityUsd) && fin(p.rocketLiq) && p.rocketLiq > 0 && liquidityUsd < p.rocketLiq * (1 - L.poolDrainPct / 100)) return 'pool-draining';
  return null;
}

/**
 * "Why Warrior trusted this coin": the facts behind a Rocket bet, as plain lines with the number and the limit it had to
 * meet. Built at the moment of the buy and kept with the position, so the reasons can be read later, win or lose.
 * `sameName` is the same-name verdict from the launch check ({ rivals, leader }) when there is one.
 * These are the reasons it passed, not a promise: the last line says so every time.
 */
export function rocketTrust(c, sameName = null, limits = ROCKET_SCREEN) {
  if (!c) return []; const L = { ...ROCKET_SCREEN, ...limits }, n = (v) => Math.round(v).toLocaleString('en-US'), rows = [], add = (label, value) => rows.push({ label, value });
  const settled = c.curveSecs !== null && fin(c.ageMin) ? c.ageMin - c.curveSecs / 60 : null;
  add('Age', `${Math.round(c.ageMin)} minutes old (Rocket coins are ${L.minAgeMin} to ${L.maxAgeMin})`);
  if (c.curveSecs !== null) add('Launch', `Spent ${c.curveSecs >= 120 ? `${Math.round(c.curveSecs / 60)} minutes` : `${Math.round(c.curveSecs)} seconds`} on the launch curve, so it was not bought up in one go${settled !== null ? `, and has held in the open pool for ${Math.round(settled)} minutes (at least ${L.settleMin})` : ''}`);
  if (c.traders !== null) add('Crowd', `${n(c.traders)} wallets have traded it (at least ${n(L.minTraders)})`);
  if (c.holders !== null && c.traders) add('Holders', `${n(c.holders)} hold it now: ${Math.round(c.holders / c.traders * 100)}% of everyone who traded it is still in (at least ${L.minHoldersPerTraderPct}%)`);
  if (c.organicBuyPct !== null && c.organicBuyPct !== undefined) add('Real buying', `${c.organicBuyPct.toFixed(1)}% of its buying comes from real traders, not bots (at least ${L.minOrganicBuyPct}%)`);
  else add('Real buying', `Not reported for this coin. It passed on its holders instead: at least ${L.unknownOrganicHoldPct}% of everyone who traded it is still in`);
  if (c.liquidityUsd !== null) add('Pool money', `$${n(c.liquidityUsd)} to sell into (at least $${n(L.minLiquidityUsd)})`);
  if (c.topHoldersPct !== null) add('Top holders', `The biggest holders own ${c.topHoldersPct.toFixed(0)}% (at most ${L.maxTopHoldersPct}%)`);
  add('Creator', `${c.creator?.text ?? 'No record.'}${c.devPct !== null ? ` Still holds ${c.devPct.toFixed(1)}% (at most ${L.maxDevPct}%).` : ''}`);
  if (c.bundles !== null || c.bundlerPeakPct !== null) add('Staged buying', `${c.bundles ?? 0} bundled purchases (at most ${L.maxBundles}); bundled wallets never held more than ${(c.bundlerPeakPct ?? 0).toFixed(0)}% (at most ${L.maxBundlerPeakPct}%)`);
  add('Creator powers', 'Cannot print more coins and cannot freeze yours');
  if (c.buys5m !== null && c.buyUsd5m !== null) add('Right now', `${n(c.buys5m)} buys and ${n(c.sells5m ?? 0)} sells in five minutes: $${n(c.buyUsd5m)} buying against $${n(c.sellUsd5m ?? 0)} selling`);
  if (sameName) add('Its name', !sameName.rivals ? 'No other coin with a real crowd shares its name' : sameName.leader === 'yes' ? `${sameName.rivals} other coins share its name and this is clearly the biggest, so the others are the copies` : `${sameName.rivals} other coins share its name and none is bigger than this one`);
  add('Remember', 'These are the reasons it passed, not a promise. Most coins this young still end at or near zero.');
  return rows;
}

/**
 * The slower health check on an open Rocket bet (every 30 seconds): have the holders it had when Warrior bought started
 * to leave? Returns 'holders-leaving' or null. Needs both counts; a missing number never sells.
 */
export function rocketHealth(position, { holders } = {}, limits = ROCKET_SCREEN) {
  const p = position, L = { ...ROCKET_SCREEN, ...limits }, then = p?.checked?.holders; if (!p || !p.rocket || p.empty || !Number.isInteger(holders) || !Number.isInteger(then) || then < L.holderExodusMin) return null;
  return holders < then * (1 - L.holderExodusPct / 100) ? 'holders-leaving' : null;
}
/**
 * The Rocket track record, from closed trades: how many bets, how many made money, the net result and the best sale.
 * A bet sold in parts counts once. Honest by construction: it is only arithmetic on what happened.
 */
export function rocketRecord(trades, mode) {
  const mine = (trades ?? []).filter((t) => t && t.rocket && (mode === undefined || t.mode === mode) && Number.isFinite(t.pnlSol)), bets = new Map();
  for (const t of mine) { const k = `${t.mint}:${t.openedAt}`, b = bets.get(k) ?? { pnlSol: 0, closed: false }; b.pnlSol += t.pnlSol; if (!t.partial) b.closed = true; bets.set(k, b); }
  const closed = [...bets.values()].filter((b) => b.closed), won = closed.filter((b) => b.pnlSol > 0).length;
  return { bets: closed.length, won, lost: closed.length - won, netSol: mine.reduce((n, t) => n + t.pnlSol, 0), bestPct: mine.reduce((m, t) => Number.isFinite(t.pnlPct) ? Math.max(m, t.pnlPct) : m, -Infinity), open: bets.size - closed.length };
}
export function rocketRecordText(r, money = 'practice money') {
  if (!r || (!r.bets && !r.open)) return `No Rocket bets closed yet with ${money}. The record builds here, so you can see how the screen has really done before trusting it with more.`;
  const sol = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(4)} SOL`;
  return `Your Rocket record with ${money}: ${r.bets} bet${r.bets === 1 ? '' : 's'} closed, ${r.won} made money and ${r.lost} lost. Net ${sol(r.netSol)}.${Number.isFinite(r.bestPct) && r.bestPct > 0 ? ` Best sale +${Math.round(r.bestPct)}%.` : ''}${r.bets < 20 ? ' That is too few to judge by.' : ''}`;
}

/**
 * The early lane: a launch still on the pump.fun curve, one to ten minutes old, with buying momentum.
 * On the curve the price is only the coins bought so far, so whoever bought it up can sell it back down; no screen
 * removes that. What this asks for is a crowd rather than one buyer: enough separate wallets, most of them still
 * holding, real (non-bot) buying, no staged bundles, and more money coming in than going out right now.
 * A quick look at 17 launches on October 13, 2026 found only 5 higher at minute ten than at minute one, so the lane
 * leans on its exits (close stop, early trailing stop, a clock) and on small bets, not on the launches being good.
 */
export const EARLY_SCREEN = Object.freeze({ minAgeMin: 1, maxAgeMin: 10, minCurvePct: 15, maxCurvePct: 85, minTraders: 100, minHolders: 60, minHoldersPerTraderPct: 30, minOrganicBuyPct: 2.5, minBuys5m: 40, minRise5mPct: 10 });
/** The early lane on Spicy: a smaller crowd and a gentler run are enough. The bot-crowd floor and the staged-launch limits follow the Rocket level. */
export const EARLY_LEVELS = Object.freeze({ chill: Object.freeze({}), balanced: Object.freeze({}), spicy: Object.freeze({ minTraders: 60, minHolders: 40, minHoldersPerTraderPct: 20, minOrganicBuyPct: 0.5, minBuys5m: 20, minRise5mPct: 5, minCurvePct: 10, maxCurvePct: 90,
  // In a coin's first five minutes the feed's real-buying number has barely been worked out ("Pral" read 0.00% at two
  // minutes old with 62% of its traders still holding, and then nearly doubled). On Spicy, a coin that young is judged
  // on its holders instead: at least half of everyone who traded it must still be in.
  organicGraceMin: 5, organicGraceHoldPct: 50 }) });
export const earlyLimits = (level) => ({ ...EARLY_SCREEN, ...(EARLY_LEVELS[level] ?? {}), rocket: ROCKET_LEVELS[level] ?? {} });
export function earlyScreen(c, limits = EARLY_SCREEN) {
  const E = { ...EARLY_SCREEN, ...limits }, R = { ...ROCKET_SCREEN, ...(limits?.rocket ?? {}) }, reasons = [];
  if (!c) return { ok: false, reasons: ['Unknown coin'] };
  if (c.launchpad !== 'pump.fun' || !c.mint.endsWith('pump')) reasons.push('Not a pump.fun launch');
  if (c.graduated) reasons.push('It has already left the launch curve: the ordinary Rocket screen judges it');
  if (!fin(c.ageMin)) reasons.push('Age unknown'); else if (c.ageMin < E.minAgeMin) reasons.push('Under a minute old: nothing to read yet'); else if (c.ageMin > E.maxAgeMin) reasons.push(`Older than ${E.maxAgeMin} minutes: the first run is over`);
  if (!c.mintLocked) reasons.push('Creator can still print more'); if (!c.freezeLocked) reasons.push('Creator can freeze it');
  if (!fin(c.priceUsd) || c.priceUsd <= 0) reasons.push('No price yet');
  if (c.curvePct === null) reasons.push('Launch curve progress unknown'); else if (c.curvePct < E.minCurvePct) reasons.push(`Only ${c.curvePct.toFixed(0)}% of the launch curve is sold: too little buying to call it a run`); else if (c.curvePct > E.maxCurvePct) reasons.push(`${c.curvePct.toFixed(0)}% of the launch curve is sold: it is about to leave the curve, where early buyers sell`);
  if (c.traders === null) reasons.push('Trader count unknown'); else if (c.traders < E.minTraders) reasons.push(`Only ${c.traders} wallets have traded it`);
  if (c.holders === null) reasons.push('Holder count unknown'); else if (c.holders < E.minHolders) reasons.push(`Only ${c.holders} holders`);
  if (c.holders !== null && c.traders > 0 && c.holders < c.traders * E.minHoldersPerTraderPct / 100) reasons.push(`Only ${c.holders} of the ${c.traders} wallets that traded it still hold it`);
  const grace = E.organicGraceMin > 0 && fin(c.ageMin) && c.ageMin < E.organicGraceMin && c.holders !== null && c.traders > 0 && c.holders >= c.traders * E.organicGraceHoldPct / 100;
  if (grace) { /* too young for the real-buying number to mean anything; its holders vouch for it */ } else if (c.organicBuyPct === null || c.organicBuyPct === undefined) reasons.push('Its share of real traders is unknown'); else if (c.organicBuyPct < E.minOrganicBuyPct) reasons.push(`Only ${c.organicBuyPct.toFixed(1)}% of its buying comes from real traders`);
  if (c.topHoldersPct !== null && c.topHoldersPct > R.maxTopHoldersPct) reasons.push(`Top holders own ${c.topHoldersPct.toFixed(0)}%`);
  if (c.singleOwner) reasons.push('One wallet owns a large share');
  if (c.devPct !== null && c.devPct > R.maxDevPct) reasons.push(`Creator still holds ${c.devPct.toFixed(1)}%`);
  if (c.sniperPct !== null && c.sniperPct > R.maxSniperPct) reasons.push(`Snipers hold ${c.sniperPct.toFixed(0)}%`);
  if (c.insiderPct !== null && c.insiderPct > R.maxInsiderPct) reasons.push(`Insiders hold ${c.insiderPct.toFixed(0)}%`);
  if (c.bundlerPct !== null && c.bundlerPct > R.maxBundlerPct) reasons.push(`Bundled wallets hold ${c.bundlerPct.toFixed(0)}%`);
  if (c.bundlerPeakPct !== null && c.bundlerPeakPct > R.maxBundlerPeakPct) reasons.push(`Bundled wallets held ${c.bundlerPeakPct.toFixed(0)}% of it at one point`);
  if (c.bundles !== null && c.bundles > R.maxBundles) reasons.push(`Bought through ${c.bundles} bundles: a launch staged by one group`);
  if (c.creator?.kind === 'serial' && (c.creator.share ?? 0) < (R.serialMaxShare ?? 0.1)) reasons.push('Creator launches coins by the dozen and abandons them');
  if (c.buys5m === null || c.buyUsd5m === null) reasons.push('No trading in the last five minutes'); else { if (c.buys5m < E.minBuys5m) reasons.push('Hardly anyone is buying'); if (c.buyUsd5m <= (c.sellUsd5m ?? 0)) reasons.push('More money is selling than buying'); }
  if (c.change5mPct === null) reasons.push('Its recent move is unknown'); else if (c.change5mPct < E.minRise5mPct) reasons.push('It is not running: the price is flat or falling');
  return { ok: reasons.length === 0, reasons };
}
/** The early bet's plan: the Rocket settings' own exits, and a clock if one is set. */
export function earlyPlan(c, prefs = defaultRocket, now = Date.now()) {
  const v = validateRocket(prefs); if (!v.ok || !fin(c?.priceUsd) || c.priceUsd <= 0) return null; const p = v.value;
  // The same exits as an ordinary Rocket bet, plus the clock when one is set.
  const plan = rocketPlan(c, p, now); if (!plan) return null;
  return { ...plan, exits: { ...plan.exits, early: 1, widened: 1, ...(p.earlyMinutes > 0 ? { maxMinutes: p.earlyMinutes } : {}) } }; // widened: already on the Rocket settings' exits, so the site does not announce a move from the old tight early plan
}
/** The facts behind an early bet, in the same plain form as rocketTrust. */
export function earlyTrust(c, sameName = null, limits = EARLY_SCREEN) {
  if (!c) return []; const E = { ...EARLY_SCREEN, ...limits }, n = (v) => Math.round(v).toLocaleString('en-US'), rows = [], add = (label, value) => rows.push({ label, value });
  add('Age', `${Math.round(c.ageMin)} minutes old (early bets are ${E.minAgeMin} to ${E.maxAgeMin})`);
  if (c.curvePct !== null) add('Launch curve', `${c.curvePct.toFixed(0)}% sold (between ${E.minCurvePct}% and ${E.maxCurvePct}%): it is still on the curve, where the wallets that bought it can sell it straight back down`);
  if (c.traders !== null) add('Crowd', `${n(c.traders)} wallets have traded it (at least ${E.minTraders})`);
  if (c.holders !== null && c.traders) add('Holders', `${n(c.holders)} hold it now: ${Math.round(c.holders / c.traders * 100)}% of everyone who traded it is still in (at least ${E.minHoldersPerTraderPct}%)`);
  if (c.organicBuyPct !== null && c.organicBuyPct !== undefined) add('Real buying', `${c.organicBuyPct.toFixed(1)}% of its buying comes from real traders, not bots (at least ${E.minOrganicBuyPct}%)`);
  add('Creator', `${c.creator?.text ?? 'No record.'}${c.devPct !== null ? ` Still holds ${c.devPct.toFixed(1)}%.` : ''}`);
  if (c.bundles !== null || c.bundlerPeakPct !== null) add('Staged buying', `${c.bundles ?? 0} bundled purchases; bundled wallets never held more than ${(c.bundlerPeakPct ?? 0).toFixed(0)}%`);
  if (c.buys5m !== null && c.buyUsd5m !== null) add('Right now', `Up ${Math.round(c.change5mPct ?? 0)}% in five minutes on ${n(c.buys5m)} buys, with more money buying ($${n(c.buyUsd5m)}) than selling ($${n(c.sellUsd5m ?? 0)})`);
  if (sameName) add('Its name', !sameName.rivals ? 'No other coin with a real crowd shares its name' : sameName.leader === 'yes' ? `${sameName.rivals} other coins share its name and this is clearly the biggest` : `${sameName.rivals} other coins share its name and none is bigger than this one`);
  add('Remember', 'An early bet is the riskiest thing Warrior does. It is sold by your Rocket settings, the same as any Rocket bet.');
  return rows;
}

/**
 * Protect a profit on an open Rocket bet. Call it with every fresh price (every five seconds). Returns
 * { peak, look, stop } to store back on the position, or null when the rule is off. The stop only ever moves up.
 *
 * Two things learned from three "profit-lock" sales that all lost money (CTOWN, Tailers, dogineers, October 13, 2026):
 *  - One price print is not a gain. Tailers touched +60% for a few seconds; the stop jumped to +30%, above where the coin
 *    was actually trading, and the bet was sold at a loss at once. The best price now only counts once two looks in a
 *    row have been at or above it.
 *  - "3% above what was paid" is not break-even. On a small bet, fees and rent are 7% to 11% of the stake, so a stop
 *    there locked in a loss. The floor is now set where a sale would really return what went in: `costMult` is what
 *    left the wallet divided by what was swapped, and 3% is added on top for the cost of selling.
 * Once the bet has been up `protectAtPct` the stop sits at that floor; once it has been up twice that, it locks in half
 * of the best gain (never less than the floor).
 */
export function rocketRatchet(position, price, { costMult = 1 } = {}) {
  const p = position, at = p?.rocket?.protectAtPct; if (!p || !p.rocket || p.empty || !(at > 0) || !fin(price) || price <= 0 || !fin(p.entry) || p.entry <= 0) return null;
  const seenTwice = fin(p.lastLook) ? Math.min(price, p.lastLook) : null, was = fin(p.peakSeen) ? p.peakSeen : p.entry, peak = seenTwice !== null ? Math.max(was, seenTwice) : was;
  const best = (peak / p.entry - 1) * 100, keep = { peak, look: price, stop: p.stop }; if (best < at) return keep;
  const even = p.entry * Math.max(1, fin(costMult) ? Math.min(costMult, 1.5) : 1) * 1.03, floor = best >= at * 2 ? Math.max(even, p.entry * (1 + best / 200)) : even;
  // The floor has to be under the best price actually seen, or it is not protecting anything: it would just sell.
  return floor < peak ? { ...keep, stop: Math.max(fin(p.stop) ? p.stop : 0, floor) } : keep;
}
/**
 * Is a sell-off starting on a coin Warrior holds a Rocket bet in? `facts` are the coin's last-five-minutes numbers.
 * Returns 'sell-off', 'big-holders-selling' or null. A missing number never sells, and nothing is judged in the first
 * minute after the buy, because the five-minute numbers still describe the time before it.
 */
export function rocketFlow(position, facts = {}, limits = ROCKET_SCREEN, now = Date.now()) {
  const p = position, L = { ...ROCKET_SCREEN, ...limits }; if (!p || !p.rocket || p.empty || p.rocket.sellOffExit === 0 || !fin(p.openedAt) || now - p.openedAt < L.sellOffGraceSecs * 1000) return null;
  const { buyUsd5m, sellUsd5m, change5mPct, topHoldersPct } = facts;
  if (fin(buyUsd5m) && fin(sellUsd5m) && sellUsd5m > 0 && sellUsd5m >= buyUsd5m * L.sellOffRatio && fin(change5mPct) && change5mPct <= -L.sellOffDropPct) return 'sell-off';
  const then = p.checked?.topHoldersPct; if (fin(then) && fin(topHoldersPct) && then - topHoldersPct >= L.topHolderCutPoints && topHoldersPct <= then * (1 - L.topHolderCutShare)) return 'big-holders-selling';
  return null;
}
