import test from 'node:test';
import assert from 'node:assert/strict';
import { ROCKET_SCREEN, defaultRocket, validateRocket, creatorRecord, rocketCandidate, rocketScreen, rocketRank, rocketPlan, rocketRoom, launchAudit, cloneCheck } from '../lib/rocket.mjs';

const NOW = Date.UTC(2026, 9, 13), MINT = 'HbPDWSqu8hpVMX6gMjwMDGe5rVgicWo3Qh3Jaojypump';
const feed = (o = {}, audit = {}, stats = {}) => ({ id: MINT, dex: 'swap.pump.fun', type: 'pumpfun-amm', liquidity: 12000, bondingCurve: 100, createdAt: new Date(NOW - 10 * 60_000).toISOString(), ...o.pool,
  baseAsset: { id: MINT, symbol: 'ROCK', name: 'Rocket coin', launchpad: 'pump.fun', tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', usdPrice: 0.00002, mcap: 20000, holderCount: 300, dev: 'FBQo4ytjGJ1cpDZ9igzFHFY7rd1xZ5Qdz35Ad2RSYZU9', firstPool: { createdAt: new Date(NOW - 10 * 60_000).toISOString() }, graduatedAt: new Date(NOW - 5 * 60_000).toISOString(), stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 1600 },
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18, devBalancePercentage: 1, sniperPct: 4, insiderPct: 2, devMints: 6, devMigrations: 4, ...audit }, stats5m: { numBuys: 120, numSells: 80, buyVolume: 9000, sellVolume: 5000, priceChange: 40, ...stats }, ...o.asset } });
const cand = (...a) => rocketCandidate(feed(...a), NOW);

test('a clean young pump.fun coin passes the Rocket screen; nothing about it is called safe', () => {
  const c = cand(); assert.ok(Math.abs(c.ageMin - 10) < 1e-9); assert.equal(c.creator.kind, 'record'); assert.deepEqual(rocketScreen(c), { ok: true, reasons: [] });
  assert.equal(rocketCandidate(null), null); assert.equal(rocketCandidate({ id: 'x', baseAsset: { id: 'not an address' } }), null);
});

test('every known way a brand-new coin hurts people is refused with a plain reason', () => {
  const refused = (c, pattern) => { const s = rocketScreen(c); assert.equal(s.ok, false, pattern); assert.ok(s.reasons.some((r) => pattern.test(r)), `${pattern} not in ${s.reasons}`); };
  refused(cand({ asset: { launchpad: 'raydium' } }), /Not a pump\.fun launch/); refused(rocketCandidate({ ...feed(), id: MINT, baseAsset: { ...feed().baseAsset, id: '2J2BczpjoP2a2554UPCKCYoSwWH46oBYpLa4PSNF2J4i' } }, NOW), /Not a pump\.fun launch/);
  refused(cand({ asset: { firstPool: { createdAt: new Date(NOW - 20_000).toISOString() } } }), /Under a minute old/); refused(cand({ asset: { firstPool: { createdAt: new Date(NOW - 75 * 60_000).toISOString() } } }), /Older than 60 minutes/);
  refused(cand({}, { mintAuthorityDisabled: false }), /print more/); refused(cand({}, { freezeAuthorityDisabled: undefined }), /freeze it/);
  refused(cand({ asset: { holderCount: 43 } }), /Only 43 of the 1,500 wallets that traded it still hold it/); refused(cand({ pool: { liquidity: 900 } }), /Pool too small/); refused(cand({}, { topHoldersPercentage: 55 }), /Top holders own 55%/); refused(cand({}, { topHoldersPercentage: undefined }), /Top-holder share unknown/);
  refused(cand({}, { highSingleOwnership: true }), /One wallet owns/); refused(cand({}, { devBalancePercentage: 14 }), /Creator still holds 14\.0%/); refused(cand({}, { sniperPct: 40 }), /Snipers hold 40%/); refused(cand({}, { insiderPct: 30 }), /Insiders hold 30%/); refused(cand({}, { bundlerStats: { holdingPct: 25 } }), /Bundled wallets hold 25%/);
  refused(cand({}, { devMints: 1249, devMigrations: 43 }), /by the dozen/); refused(cand({}, {}, { buyVolume: 1000, sellVolume: 4000 }), /Far more money is selling than buying/); refused(cand({}, {}, { numBuys: 3 }), /Hardly anyone is buying/); refused(cand({ asset: { stats5m: undefined } }), /No trading in the last five minutes/);
  refused(cand({ asset: { usdPrice: 0 } }), /No price yet/); assert.equal(rocketScreen(null).ok, false);
  // The three figures the feed leaves out for clean coins do not fail a coin by themselves.
  assert.equal(rocketScreen(cand({}, { devBalancePercentage: undefined, sniperPct: undefined, insiderPct: undefined })).ok, true);
});

test('creator records are stated as facts, and serial launchers are named', () => {
  assert.equal(creatorRecord({ devMints: 12, devMigrations: 9 }).kind, 'record'); assert.match(creatorRecord({ devMints: 12, devMigrations: 9 }).text, /9 of this creator's 12 coins graduated\. A record, not a promise/);
  assert.equal(creatorRecord({ devMints: 1, devMigrations: 1 }).kind, 'first'); assert.equal(creatorRecord({ devMints: 2, devMigrations: 2 }).kind, 'mixed'); assert.equal(creatorRecord({ devMints: 8, devMigrations: 1 }).kind, 'mixed');
  assert.equal(creatorRecord({ devMints: 1508, devMigrations: 6 }).kind, 'serial'); assert.equal(creatorRecord({ devMints: 40, devMigrations: 30 }).kind, 'record'); assert.equal(creatorRecord({}).kind, 'unknown'); assert.equal(creatorRecord(null).kind, 'unknown');
  for (const a of [{ devMints: 12, devMigrations: 9 }, { devMints: 1 }, { devMints: 5, devMigrations: 1 }]) assert.doesNotMatch(creatorRecord(a).text, /trusted|safe|guarantee|will /i);
});

test('ranking puts passing coins first and creators with a record ahead of the rest', () => {
  const mk = (symbol, ok, kind, buy) => ({ symbol, screen: { ok }, creator: { kind }, buyUsd5m: buy, sellUsd5m: 0 });
  assert.deepEqual(rocketRank([mk('fail-record', false, 'record', 9e9), mk('pass-first', true, 'first', 500), mk('pass-record-weak', true, 'record', 100), mk('pass-mixed-strong', true, 'mixed', 9000), mk('pass-record-strong', true, 'record', 800)]).map((c) => c.symbol), ['pass-record-strong', 'pass-record-weak', 'pass-mixed-strong', 'pass-first', 'fail-record']);
});

test('the Rocket plan: stop, target and a trailing stop that only takes over once the trade is well up', () => {
  const plan = rocketPlan(cand(), defaultRocket, NOW); assert.equal(plan.decision, 'rocket'); assert.equal(plan.tf, 1); assert.ok(Math.abs(plan.target / plan.price - 11) < 1e-9, '+1000% is eleven times the entry'); assert.ok(Math.abs(plan.stop / plan.price - 0.5) < 1e-9);
  assert.deepEqual(plan.exits, { trailing: 1, trailStartPct: 100, trailGapPct: 40, trendExit: 0, holdHours: 0, takeOutAtPct: 100, protectAtPct: 30, sellOffExit: 1 }); assert.equal(rocketPlan(cand({ asset: { usdPrice: undefined } })), null); assert.equal(rocketPlan(cand(), { betSol: 50 }), null);
  assert.equal(defaultRocket.on, false, 'Rocket Mode is off until switched on'); assert.equal(defaultRocket.betSol, 0.02, 'the default bet is the smallest trade');
  assert.equal(validateRocket({}).ok, true); assert.equal(validateRocket({ targetPct: 1 }).ok, true, 'the target can be set as low as 1%'); assert.ok(Math.abs(rocketPlan(cand(), { targetPct: 25 }, NOW).target / 0.00002 - 1.25) < 1e-9); assert.equal(validateRocket({ on: 'yes' }).value.on, false, 'only a real true switches it on');
  for (const bad of [{ betSol: 0.001 }, { betSol: 5 }, { targetPct: 0.5 }, { targetPct: 20000 }, { stopPct: 95 }, { trailGapPct: 1 }, { maxPositions: 9 }, { maxBetsPerDay: 0 }, { maxBetsPerDay: 101 }, { maxPositions: 1.5 }]) assert.equal(validateRocket(bad).ok, false, JSON.stringify(bad));
  assert.equal(rocketRoom({ openRockets: 0, betsToday: 0 }), null); assert.match(rocketRoom({ openRockets: 2, betsToday: 0 }), /Already holding 2/); assert.match(rocketRoom({ openRockets: 0, betsToday: 3 }), /3 Rocket bets placed today/);
  assert.equal(ROCKET_SCREEN.maxAgeMin, 60); assert.equal(ROCKET_SCREEN.minAgeMin, 1);
});

test('a staged launch is refused: the "GTA 6 Coin" that was dumped 16 minutes after launch would not pass now', () => {
  const born = new Date(NOW - 16 * 60_000).toISOString(), gta = (o = {}) => rocketCandidate({ id: MINT, dex: 'swap.pump.fun', type: 'pumpfun-amm', liquidity: 36000, baseAsset: { id: MINT, symbol: 'GTA 6 Coin', name: 'GTA6', launchpad: 'pump.fun', usdPrice: 0.00065, mcap: 650000, holderCount: 43, firstPool: { createdAt: born }, graduatedAt: born,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 12, devMints: 2, devMigrations: 1, bundlerStats: { totalBundles: 220, holdingPctATH: 67.088 } }, stats5m: { numBuys: 60, numSells: 20, buyVolume: 5000, sellVolume: 2500, priceChange: 9 }, ...o } }, NOW);
  const s = rocketScreen(gta()); assert.equal(s.ok, false);
  for (const pattern of [ /Bundled wallets held 67% of it at one point/, /Bought through 220 bundles/, /left the launch curve the second it was created/]) assert.ok(s.reasons.some((r) => pattern.test(r)), `${pattern} missing from ${s.reasons}`);
  // Each new sign refuses a coin by itself, on an otherwise clean coin.
  const only = (audit, asset = {}, stats = {}) => rocketScreen(cand({ asset }, audit, stats)).reasons;
  assert.deepEqual(only({ bundlerStats: { totalBundles: 5, holdingPctATH: 40 } }), ['Bundled wallets held 40% of it at one point']); assert.deepEqual(only({ bundlerStats: { totalBundles: 90, holdingPctATH: 3 } }), ['Bought through 90 bundles: a launch staged by one group']);
  assert.deepEqual(only({}, { graduatedAt: new Date(NOW - 10 * 60_000 + 5000).toISOString(), holderCount: 250 }), ['It left the launch curve the second it was created: one group bought the whole launch, and such coins are usually dumped within the hour']);
  assert.deepEqual(only({}, { graduatedAt: new Date(NOW - 10 * 60_000 + 90_000).toISOString(), holderCount: 250 }), ['Its whole launch was bought up at once by a few wallets']); assert.equal(rocketScreen(cand({ asset: { graduatedAt: new Date(NOW - 10 * 60_000 + 90_000).toISOString(), holderCount: 2500 } })).ok, true, 'a fast launch with thousands of holders is not refused for speed alone');
  // The same name launched and dumped before.
  const other = (id, o = {}) => ({ id, name: 'GTA6', symbol: 'GTA 6 Coin', firstPool: { createdAt: new Date(NOW - 5 * 3_600_000).toISOString() }, liquidity: 30, stats24h: { priceChange: -99 }, ...o }), g = gta();
  assert.equal(cloneCheck(g, [other('a'), other('b'), other('c', { liquidity: 50000, stats24h: { priceChange: 20 } }), other(MINT), other('old', { firstPool: { createdAt: new Date(NOW - 72 * 3_600_000).toISOString() } }), { id: 'x', name: 'Unrelated', symbol: 'UNR', firstPool: { createdAt: born }, liquidity: 1 }], ROCKET_SCREEN, NOW).collapsed, 2);
  const clean = cand(); assert.equal(launchAudit(clean, []).ok, true);
  assert.equal(launchAudit(null).ok, false);
});

test('a same-second launch with a faked holder count is refused (the fomo case)', () => {
  const base = { ageMin: 4, curveSecs: 0, holders: 2139, traders: 460, bundles: 40, bundlerPeakPct: 13, creator: { kind: 'unknown' }, name: 'fomo', symbol: 'FOMO' };
  const a = launchAudit(base); assert.equal(a.ok, false); assert.equal(a.reasons.length, 3); assert.match(a.reasons.join(' '), /second it was created/); assert.match(a.reasons.join(' '), /holder count was faked/);
  // an older coin that launched the same way but has more traders than holders is judged on its trading, not its launch
  assert.equal(launchAudit({ ...base, ageMin: 460, holders: 8660, traders: 11391 }).ok, true);
  // a coin that spent minutes on the launch curve and whose holders really traded passes
  assert.equal(launchAudit({ ...base, curveSecs: 1500, holders: 1100, traders: 1700 }).ok, true);
  // an old coin's one-day trader count says nothing about its lifetime holders
  assert.equal(launchAudit({ ...base, ageMin: 13000, curveSecs: 21, holders: 10018, traders: 2151 }).ok, true);
});

test('a coin still on the launch curve, or traded by only a few hundred wallets, is not a Rocket coin (the SEAL case)', () => {
  // SEAL: 24 minutes old, 147 holders, 273 traders, still on the curve, 9% bundled, 3 bundles. It passed every earlier rule.
  const seal = cand({ pool: { dex: 'pump.fun', type: 'pumpfun', bondingCurve: 35 }, asset: { holderCount: 147, graduatedAt: undefined, stats24h: { numTraders: 273, buyVolume: 19000, buyOrganicVolume: 760 } } }, { bundlerStats: { totalBundles: 3, holdingPct: 9, holdingPctATH: 9 } });
  const r = rocketScreen(seal); assert.equal(r.ok, false); assert.equal(r.reasons.length, 2); assert.match(r.reasons[0], /Still on the pump\.fun launch curve/); assert.match(r.reasons[1], /Only 273 wallets have ever traded it/);
  assert.deepEqual(rocketScreen(cand({ asset: { stats24h: undefined } })).reasons, ['Trader count unknown', 'Its share of real traders is unknown, and fewer than 50% of the wallets that traded it still hold it']);
  // the same few-traders rule holds for any automatic buy of a coin under a day old, and not for older coins
  assert.equal(launchAudit({ ageMin: 300, traders: 400, holders: 300, curveSecs: 900, creator: { kind: 'unknown' } }).ok, false); assert.equal(launchAudit({ ageMin: 3000, traders: 400, holders: 3000, curveSecs: 900, creator: { kind: 'unknown' } }).ok, true);
});

test('the bundle count is only held against a coin in its first two hours', () => {
  const coin = { holders: 5000, traders: 5570, curveSecs: 900, bundles: 115, bundlerPeakPct: 8, creator: { kind: 'unknown' } };
  assert.equal(launchAudit({ ...coin, ageMin: 30 }).ok, false); assert.equal(launchAudit({ ...coin, ageMin: 18 * 60 }).ok, true);
  assert.equal(launchAudit({ ...coin, ageMin: 18 * 60, bundlerPeakPct: 40 }).ok, false, 'a large share once held by bundled wallets still counts at any age');
});

test('among coins sharing a name, the real one is traded and the copies are not (the SALUTE case)', () => {
  const at = (min) => new Date(NOW - min * 60_000).toISOString(), base = { mint: MINT, name: 'saluteface', symbol: 'SALUTE', createdAt: NOW - 20 * 60_000, ageMin: 20, holders: 900, traders: 1327, curveSecs: 170, bundles: 17, bundlerPeakPct: 5, creator: { kind: 'unknown' } };
  const other = (id, min, o = {}) => ({ id, name: 'saluteface', symbol: 'SALUTEFACE', firstPool: { createdAt: at(min) }, liquidity: 3300, mcap: 3200, stats24h: { priceChange: -40 }, ...o });
  const copies = [other('a', 47), other('b', 21), other('c', 21), other('d', 17), other('e', 16), other('f', 14), other('g', 12)];
  // the real one: clearly the most pool money and market value. Its copies, dead or alive, are not held against it.
  const real = { ...base, liquidityUsd: 60000, marketValueUsd: 900000 }, r = launchAudit(real, copies); assert.equal(r.ok, true); assert.equal(r.clones.leader, 'yes'); assert.equal(r.clones.rivals, 7);
  // a copy: a bigger coin has the name
  const copy = { ...base, liquidityUsd: 15000, marketValueUsd: 13000 }, big = other('real', 30, { liquidity: 60000, mcap: 900000, graduatedAt: at(28) }), c = launchAudit(copy, [...copies, big]);
  assert.equal(c.ok, false); assert.equal(c.clones.leader, 'no'); assert.match(c.reasons[0], /It is a copy: a bigger coin has this name \(\$900,000 market value and \$60,000 of pool money, against \$13,000 and \$15,000 here\)/);
  // ahead, but not clearly: with several rivals nobody is bought yet; with one or two the lead is enough
  const close = { ...base, liquidityUsd: 5000, marketValueUsd: 5000 }; assert.match(launchAudit(close, copies).reasons[0], /7 other coins share this name and none clearly leads yet/); assert.equal(launchAudit(close, copies.slice(0, 2)).ok, true);
  // a rival with a little more pool money but a fifth of the market value does not make the real coin a copy (SEALS)
  const seals = { ...base, liquidityUsd: 85784, marketValueUsd: 509971 }, near = other('n', 200, { liquidity: 88785, mcap: 111257, graduatedAt: at(190) }); assert.equal(launchAudit(seals, [near, ...copies]).ok, true); assert.equal(cloneCheck(seals, [near], undefined, NOW).leader, 'yes');
  // launched first and worth 2.5 times its biggest copy, which was given three times the pool money (PINCHA): still the real one
  const pincha = { ...base, liquidityUsd: 18359, marketValueUsd: 158416 }, fat = (min) => other('fat', min, { liquidity: 54815, mcap: 63883, graduatedAt: at(min - 2) });
  assert.equal(cloneCheck(pincha, [fat(5), ...copies.slice(3)], undefined, NOW).leader, 'yes'); assert.equal(launchAudit(pincha, [fat(5), ...copies.slice(3)]).ok, true);
  assert.equal(cloneCheck(pincha, [fat(40)], undefined, NOW).leader, 'unclear', 'not when the coin with the bigger pool came first'); assert.equal(cloneCheck({ ...pincha, marketValueUsd: 100000 }, [fat(5)], undefined, NOW).leader, 'unclear', 'nor when it is not worth double');
  // the real coin still has to pass everything else
  assert.equal(launchAudit({ ...real, traders: 300 }, copies).ok, false); assert.equal(cloneCheck(real, [], undefined, NOW).leader, 'alone');
});

test('a crowd made of bots is refused (the WISP case)', () => {
  // WISP: left the curve after 16 minutes, 2,431 traders, no bundles on record. $10 of $52,000 of buying was real.
  const wisp = cand({ asset: { holderCount: 400, stats24h: { numTraders: 2431, buyVolume: 51954, buyOrganicVolume: 10.5 } } }), r = rocketScreen(wisp);
  assert.ok(Math.abs(wisp.organicBuyPct - 0.0202) < 0.001); assert.equal(r.ok, false); assert.deepEqual(r.reasons, ['Almost none of its buying comes from real traders (0.02%): the crowd is bots passing it back and forth']);
  assert.deepEqual(rocketScreen(cand({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 240 } } })).reasons, ['Only 0.6% of its buying comes from real traders']);
  assert.deepEqual(rocketScreen(cand({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000 } } })).reasons, ['Its share of real traders is unknown, and fewer than 50% of the wallets that traded it still hold it']);
  assert.equal(rocketScreen(cand()).ok, true, '4% real buying passes');
  // for an ordinary automatic buy of a coin under a day old the floor is lower, and an older coin is not judged on it
  const coin = { ageMin: 600, traders: 15000, holders: 11000, curveSecs: 900, creator: { kind: 'unknown' } };
  assert.equal(launchAudit({ ...coin, organicBuyPct: 0.44 }).ok, true); assert.equal(launchAudit({ ...coin, organicBuyPct: 0.05 }).ok, false); assert.equal(launchAudit({ ...coin, ageMin: 3000, organicBuyPct: 0.05 }).ok, true); assert.equal(launchAudit({ ...coin, organicBuyPct: null }).ok, true);
});

test('the strict Rocket set: holders that stay, time to settle, not already falling, and the watch on an open bet', async () => {
  const { rocketWatch, rocketLossesToday } = await import('../lib/rocket.mjs'), { partialDue } = await import('../lib/orders.mjs');
  const reasons = (o, stats) => rocketScreen(cand(o, {}, stats)).reasons;
  assert.deepEqual(reasons({ asset: { holderCount: 200 } }), ['Only 200 of the 1,500 wallets that traded it still hold it: the rest have already left']);
  assert.deepEqual(reasons({ asset: { graduatedAt: new Date(NOW - 2 * 60_000).toISOString() } }), ['It left the launch curve under 3 minutes ago: too soon to see whether it holds']);
  assert.deepEqual(reasons({}, { priceChange: -35 }), ['It is falling fast right now']); assert.deepEqual(reasons({ pool: { liquidity: 5000 } }), ['Pool too small to get out of']);
  assert.equal(ROCKET_SCREEN.minOrganicBuyPct, 2.5); assert.deepEqual(reasons({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 800 } } }), ['Only 2.0% of its buying comes from real traders']);
  // settings: the stake comes out at double by default, and two losses end the day
  assert.equal(defaultRocket.takeOutAtPct, 100); assert.equal('stopAfterLosses' in defaultRocket, false, 'the rest-after-losses setting was removed'); for (const bad of [{ takeOutAtPct: 10 }, { takeOutAtPct: 2000 }]) assert.equal(validateRocket(bad).ok, false, JSON.stringify(bad)); assert.equal(validateRocket({ takeOutAtPct: 0 }).ok, true);
  assert.equal(rocketRoom({ openRockets: 0, betsToday: 0, lossesToday: 9 }), null, 'losses no longer stop Rocket for the day'); assert.equal(validateRocket({ stopAfterLosses: 2 }).ok, true, 'a saved old setting is ignored, not refused');
  const t = (o) => ({ rocket: true, mode: 'live', closedAt: NOW, pnlSol: -0.02, partial: false, ...o });
  assert.equal(rocketLossesToday([t(), t({ pnlSol: 0.3 }), t({ partial: true }), t({ rocket: false }), t({ mode: 'paper' }), t({ closedAt: NOW - 30 * 3_600_000 }), t()], 'live', NOW), 2);
  // a Rocket bet takes its stake out once, at its own setting, and ignores the dial's rules
  const bet = { solIn: 0.02, rocket: rocketPlan(cand(), {}, NOW).exits }; assert.equal(partialDue(bet, 90, { stepPct: 10 }), null); const out = partialDue(bet, 100, {}); assert.equal(out.reason, 'took-out'); assert.ok(Math.abs(out.fraction - 0.5) < 1e-9); assert.equal(partialDue({ ...bet, auto: { tookOut: true } }, 400, {}), null);
  // the watch: one look at the stop, or a third of the pool gone; never on missing numbers; never on ordinary positions
  const open = { rocket: {}, stop: 0.5, rocketLiq: 30000 };
  assert.equal(rocketWatch(open, { price: 0.49, liquidityUsd: 30000 }), 'stop'); assert.equal(rocketWatch(open, { price: 0.9, liquidityUsd: 19000 }), 'pool-draining'); assert.equal(rocketWatch(open, { price: 0.9, liquidityUsd: 21000 }), null);
  assert.equal(rocketWatch(open, {}), null); assert.equal(rocketWatch({ ...open, rocket: undefined }, { price: 0.1 }), null); assert.equal(rocketWatch({ ...open, empty: true }, { price: 0.1 }), null);
});

test('"Why Warrior trusted this coin" states each fact with its limit, and never promises', async () => {
  const { rocketTrust } = await import('../lib/rocket.mjs'), rows = rocketTrust(cand(), { rivals: 4, leader: 'yes' }), by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(by.Age, '10 minutes old (Rocket coins are 1 to 60)'); assert.match(by.Launch, /Spent 5 minutes on the launch curve.*held in the open pool for 5 minutes \(at least 3\)/);
  assert.equal(by.Crowd, '1,500 wallets have traded it (at least 700)'); assert.equal(by.Holders, '300 hold it now: 20% of everyone who traded it is still in (at least 15%)');
  assert.equal(by['Real buying'], '4.0% of its buying comes from real traders, not bots (at least 2.5%)'); assert.equal(by['Pool money'], '$12,000 to sell into (at least $6,000)');
  assert.match(by['Its name'], /4 other coins share its name and this is clearly the biggest/); assert.match(by.Creator, /Still holds 1\.0% \(at most 5%\)/);
  assert.equal(rows.at(-1).label, 'Remember'); assert.match(rows.at(-1).value, /not a promise/); assert.doesNotMatch(rows.map((r) => r.value).join(' '), /\bsafe\b|guarantee/i);
  assert.deepEqual(rocketTrust(null), []); assert.equal(rocketTrust(cand(), { rivals: 0 }).find((r) => r.label === 'Its name').value, 'No other coin with a real crowd shares its name');
});

test('holders leaving is a reason to sell, and the Rocket record is plain arithmetic', async () => {
  const { rocketHealth, rocketRecord, rocketRecordText } = await import('../lib/rocket.mjs'), p = { rocket: {}, checked: { holders: 400 } };
  assert.equal(rocketHealth(p, { holders: 239 }), 'holders-leaving'); assert.equal(rocketHealth(p, { holders: 240 }), null); assert.equal(rocketHealth(p, {}), null); assert.equal(rocketHealth({ ...p, checked: { holders: 30 } }, { holders: 1 }), null, 'too few to read');
  assert.equal(rocketHealth({ checked: { holders: 400 } }, { holders: 1 }), null, 'ordinary positions are left alone');
  const t = (o) => ({ rocket: true, mode: 'paper', mint: 'A', openedAt: 1, pnlSol: -0.02, pnlPct: -50, partial: false, ...o });
  const r = rocketRecord([t(), t({ mint: 'B', pnlSol: 0.03, pnlPct: 150, partial: true }), t({ mint: 'B', pnlSol: 0.05, pnlPct: 400 }), t({ mint: 'C', pnlSol: 0.01, partial: true, pnlPct: 100 }), t({ mint: 'D', rocket: false }), t({ mint: 'E', mode: 'live' })], 'paper');
  assert.deepEqual({ bets: r.bets, won: r.won, lost: r.lost, open: r.open, best: r.bestPct }, { bets: 2, won: 1, lost: 1, open: 1, best: 400 }); assert.ok(Math.abs(r.netSol - 0.07) < 1e-9);
  assert.equal(rocketRecordText(r), 'Your Rocket record with practice money: 2 bets closed, 1 made money and 1 lost. Net +0.0700 SOL. Best sale +400%. That is too few to judge by.');
  assert.match(rocketRecordText(rocketRecord([], 'paper')), /No Rocket bets closed yet with practice money/);
});

test('the early lane: a running launch still on the curve, with a crowd, and a bet that is sold by the clock', async () => {
  const { earlyScreen, earlyPlan, earlyTrust, rocketWatch, EARLY_SCREEN } = await import('../lib/rocket.mjs');
  const live = (o = {}, audit = {}, stats = {}) => cand({ pool: { dex: 'pump.fun', type: 'pumpfun', bondingCurve: 45, createdAt: new Date(NOW - 4 * 60_000).toISOString(), ...o.pool }, asset: { firstPool: { createdAt: new Date(NOW - 4 * 60_000).toISOString() }, graduatedAt: undefined, holderCount: 180, stats24h: { numTraders: 320, buyVolume: 30000, buyOrganicVolume: 1500 }, ...o.asset } }, audit, { priceChange: 60, ...stats });
  assert.deepEqual(earlyScreen(live()), { ok: true, reasons: [] }); assert.equal(rocketScreen(live()).ok, false, 'the ordinary Rocket screen still refuses a coin on the curve');
  const why = (...a) => earlyScreen(live(...a)).reasons;
  assert.deepEqual(why({ pool: { bondingCurve: 8 } }), ['Only 8% of the launch curve is sold: too little buying to call it a run']); assert.match(why({ pool: { bondingCurve: 95 } })[0], /about to leave the curve/);
  assert.deepEqual(why({ asset: { stats24h: { numTraders: 90, buyVolume: 30000, buyOrganicVolume: 1500 }, holderCount: 70 } }), ['Only 90 wallets have traded it']);
  assert.deepEqual(why({ asset: { holderCount: 70 } }), ['Only 70 of the 320 wallets that traded it still hold it']);
  assert.deepEqual(why({ asset: { stats24h: { numTraders: 320, buyVolume: 30000, buyOrganicVolume: 30 } } }), ['Only 0.1% of its buying comes from real traders']);
  assert.deepEqual(why({}, { bundlerStats: { totalBundles: 90, holdingPctATH: 5 } }), ['Bought through 90 bundles: a launch staged by one group']);
  assert.deepEqual(why({}, {}, { priceChange: 2 }), ['It is not running: the price is flat or falling']); assert.deepEqual(why({}, {}, { buyVolume: 3000, sellVolume: 5000 }), ['More money is selling than buying']);
  assert.match(earlyScreen(cand()).reasons.join(' | '), /already left the launch curve/); assert.match(why({ pool: { createdAt: new Date(NOW - 20 * 60_000).toISOString() }, asset: { firstPool: { createdAt: new Date(NOW - 20 * 60_000).toISOString() } } })[0], /Older than 10 minutes/);
  // the plan: close stop, modest target, early trailing stop, and a clock
  const mine = { targetPct: 200, stopPct: 40, trailStartPct: 60, trailGapPct: 30, takeOutAtPct: 100, protectAtPct: 50 }, plan = earlyPlan(live(), mine, NOW); assert.equal(plan.stopPct, 40); assert.equal(plan.targetPct, 200);
  assert.deepEqual(plan.exits, { trailing: 1, trailStartPct: 60, trailGapPct: 30, trendExit: 0, holdHours: 0, takeOutAtPct: 100, protectAtPct: 50, sellOffExit: 1, early: 1, widened: 1 }, 'an early bet is sold by the same settings as any Rocket bet, with no clock unless one is set');
  assert.equal(earlyPlan(live(), { ...mine, earlyMinutes: 10 }, NOW).exits.maxMinutes, 10);
  const bet = { rocket: earlyPlan(live(), { ...mine, earlyMinutes: 10 }, NOW).exits, stop: 0.6, openedAt: NOW }, free = { rocket: plan.exits, stop: 0.6, openedAt: NOW }; assert.equal(rocketWatch(free, { price: 1.3 }, undefined, NOW + 90 * 60_000), null, 'no clock, no sale by time'); assert.equal(rocketWatch(bet, { price: 1 }, undefined, NOW + 9 * 60_000), null); assert.equal(rocketWatch(bet, { price: 1.3 }, undefined, NOW + 10 * 60_000), 'time'); assert.equal(rocketWatch(bet, { price: 0.7 }, undefined, NOW + 60_000), null, 'a 30% dip no longer sells an early bet with a 40% stop'); assert.equal(rocketWatch(bet, { price: 0.59 }, undefined, NOW + 60_000), 'stop');
  assert.equal(defaultRocket.early, 0, 'off unless switched on'); assert.equal(defaultRocket.earlyMinutes, 0); assert.equal(validateRocket({ earlyStopPct: 20, earlyTargetPct: 50 }).ok, true, 'old saved early settings are ignored, not refused'); for (const bad of [{ early: 2 }, { earlyMinutes: 1 }, { earlyMinutes: 500 }]) assert.equal(validateRocket(bad).ok, false, JSON.stringify(bad));
  const rows = earlyTrust(live()); assert.match(rows.find((r) => r.label === 'Launch curve').value, /45% sold/); assert.match(rows.at(-1).value, /riskiest thing Warrior does/); assert.equal(EARLY_SCREEN.maxAgeMin, 10);
});

test('the loosened Rocket rules: an hour to qualify, 700 traders, holders standing in for unreported real buying, and selling that must be clearly ahead', () => {
  const at = (min) => new Date(NOW - min * 60_000).toISOString(), aged = (min) => cand({ pool: { createdAt: at(min) }, asset: { firstPool: { createdAt: at(min) }, graduatedAt: at(min - 5) } });
  assert.equal(rocketScreen(aged(45)).ok, true); assert.match(rocketScreen(aged(61)).reasons.join(' '), /Older than 60 minutes/);
  const crowd = (traders, holders) => rocketScreen(cand({ asset: { holderCount: holders, stats24h: { numTraders: traders, buyVolume: 40000, buyOrganicVolume: 1600 } } }));
  assert.equal(crowd(700, 300).ok, true); assert.match(crowd(699, 300).reasons[0], /Only 699 wallets have ever traded it/);
  const noShare = (holders) => rocketScreen(cand({ asset: { holderCount: holders, stats24h: { numTraders: 1500, buyVolume: 40000 } } }));
  assert.equal(noShare(750).ok, true, 'half still holding stands in for the missing number'); assert.deepEqual(noShare(700).reasons, ['Its share of real traders is unknown, and fewer than 50% of the wallets that traded it still hold it']);
  assert.match(rocketScreen(cand({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 40 } } })).reasons[0], /Almost none of its buying comes from real traders/, 'a reported low share still refuses');
  const flow = (buy, sell, change) => rocketScreen(cand({}, {}, { buyVolume: buy, sellVolume: sell, priceChange: change })).reasons;
  assert.deepEqual(flow(9000, 9500, 12), [], 'selling a little ahead while the price is up is not a refusal'); assert.deepEqual(flow(9000, 9500, -4), ['More money is selling than buying, and the price is down']); assert.deepEqual(flow(9000, 13500, 12), ['Far more money is selling than buying']);
  assert.equal(rocketScreen(cand({ asset: { holderCount: 240, stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 1600 } } })).ok, true, 'there is no flat 100-holder rule; 16% still holding is enough');
});

test('only real rivals count: not a dormant old namesake, not a later copy with a faked market value (the LouLou case)', () => {
  const at = (min) => new Date(NOW - min * 60_000).toISOString(), coin = { mint: MINT, name: 'The Odyssean Dog', symbol: 'LouLou', createdAt: NOW - 32 * 60_000, ageMin: 32, holders: 1222, traders: 2055, curveSecs: 700, bundles: 5, bundlerPeakPct: 4, creator: { kind: 'mixed' }, liquidityUsd: 24278, marketValueUsd: 281115 };
  const old = (traders) => ({ id: 'old', name: 'loulou', symbol: 'loulou', firstPool: { createdAt: at(745 * 24 * 60) }, liquidity: 69688, mcap: 1813638, stats24h: { numTraders: traders } });
  const fake = { id: 'fake', name: 'The Odyssean Dog', symbol: 'LouLou', firstPool: { createdAt: at(1) }, liquidity: 18492, mcap: 2254855, stats24h: { numTraders: 44 } };
  const small = (id, min) => ({ id, name: 'The Odyssean Dog', symbol: 'LouLou', firstPool: { createdAt: at(min) }, liquidity: 3220, mcap: 3150, stats24h: { numTraders: 20 } });
  const all = [old(5), fake, small('a', 31), small('b', 25), small('c', 20), small('d', 10)], r = launchAudit(coin, all);
  assert.equal(r.ok, true); assert.equal(r.clones.leader, 'alone', 'none of them is a real rival');
  // an old coin that is still busy is the real one, and the new launch is its copy
  const busy = launchAudit(coin, [old(5000)]); assert.equal(busy.ok, false); assert.match(busy.reasons[0], /It is a copy: a bigger coin has this name/);
  // a later copy with a real crowd still counts as a rival
  const crowd = { ...fake, stats24h: { numTraders: 1500 }, liquidity: 60000 }; assert.equal(cloneCheck(coin, [crowd], undefined, NOW).leader, 'no');
  // a rival launched BEFORE this coin counts however few traders it has
  const earlier = { ...small('e', 40), liquidity: 90000, mcap: 900000 }; assert.equal(cloneCheck(coin, [earlier], undefined, NOW).leader, 'no');
});

test('Spicy loosens the Rocket screen by degree, and never the rules that came from real losses', async () => {
  const { rocketLimits, earlyLimits, earlyScreen, ROCKET_LEVELS } = await import('../lib/rocket.mjs'), S = rocketLimits('spicy'), B = rocketLimits('balanced');
  assert.deepEqual(B, { ...ROCKET_SCREEN }); assert.deepEqual(rocketLimits('nonsense'), { ...ROCKET_SCREEN }); assert.equal(ROCKET_LEVELS.chill && Object.keys(ROCKET_LEVELS.chill).length, 0);
  const pass = (c) => [rocketScreen(c, B).ok, rocketScreen(c, S).ok];
  const crowd = (traders, holders, organic = 0.04) => cand({ asset: { holderCount: holders, stats24h: { numTraders: traders, buyVolume: 40000, buyOrganicVolume: 40000 * organic } } });
  assert.deepEqual(pass(crowd(400, 120)), [false, true], 'a smaller crowd'); assert.deepEqual(pass(crowd(1500, 150)), [false, true], 'fewer holders staying'); assert.deepEqual(pass(crowd(1500, 300, 0.015)), [false, true], 'less real buying');
  assert.deepEqual(pass(cand({ pool: { liquidity: 4500 } })), [false, true]); assert.deepEqual(pass(cand({}, { topHoldersPercentage: 36 })), [false, true]); assert.deepEqual(pass(cand({}, { bundlerStats: { totalBundles: 120, holdingPctATH: 30 } })), [false, true]);
  // a same-second launch that has lasted ten minutes with a real crowd still holding
  const instant = (ageMin, traders, holders) => { const at = new Date(NOW - ageMin * 60_000).toISOString(); return cand({ pool: { createdAt: at }, asset: { firstPool: { createdAt: at }, graduatedAt: at, holderCount: holders, stats24h: { numTraders: traders, buyVolume: 40000, buyOrganicVolume: 1600 } } }); };
  assert.deepEqual(pass(instant(15, 1000, 600)), [false, true]); assert.equal(rocketScreen(instant(6, 1000, 600), S).ok, false, 'not before ten minutes'); assert.equal(rocketScreen(instant(15, 1000, 200), S).ok, false, 'not when the holders have gone'); assert.equal(rocketScreen(instant(15, 400, 300), S).ok, false, 'not on a thin crowd');
  // never loosened
  assert.match(rocketScreen(crowd(1500, 600, 0.0002), S).reasons[0], /Almost none of its buying comes from real traders/, 'the WISP rule');
  assert.match(rocketScreen(cand({ pool: { dex: 'pump.fun', type: 'pumpfun', bondingCurve: 40 }, asset: { graduatedAt: undefined } }), S).reasons.join(' '), /Still on the pump\.fun launch curve/, 'the SEAL rule');
  assert.match(rocketScreen(cand({}, { mintAuthorityDisabled: false }), S).reasons.join(' '), /print more/); assert.match(rocketScreen(cand({}, { devMints: 1249, devMigrations: 12 }), S).reasons.join(' '), /by the dozen/);
  const copy = { mint: MINT, name: 'x', symbol: 'COPY', createdAt: NOW - 10 * 60_000, ageMin: 10, holders: 400, traders: 900, curveSecs: 300, creator: { kind: 'unknown' }, liquidityUsd: 9000, marketValueUsd: 20000, organicBuyPct: 4 };
  assert.equal(launchAudit(copy, [{ id: 'real', name: 'x', symbol: 'COPY', firstPool: { createdAt: new Date(NOW - 60 * 60_000).toISOString() }, liquidity: 90000, mcap: 900000 }], ROCKET_LEVELS.spicy).ok, false, 'the SALUTE rule');
  // the early lane loosens the same way
  const early = cand({ pool: { dex: 'pump.fun', type: 'pumpfun', bondingCurve: 45, createdAt: new Date(NOW - 4 * 60_000).toISOString() }, asset: { firstPool: { createdAt: new Date(NOW - 4 * 60_000).toISOString() }, graduatedAt: undefined, holderCount: 45, stats24h: { numTraders: 80, buyVolume: 30000, buyOrganicVolume: 450 } } }, {}, { priceChange: 60, numBuys: 30 });
  assert.equal(earlyScreen(early, earlyLimits('balanced')).ok, false); assert.equal(earlyScreen(early, earlyLimits('spicy')).ok, true);
});

test('on Spicy, a launch under five minutes old is judged on its holders, not on a real-buying number that has not settled (the Pral case)', async () => {
  const { earlyScreen, earlyLimits, ROCKET_LEVELS } = await import('../lib/rocket.mjs'), at = (min) => new Date(NOW - min * 60_000).toISOString();
  const pral = (min, holders) => cand({ pool: { dex: 'pump.fun', type: 'pumpfun', bondingCurve: 40, createdAt: at(min) }, asset: { firstPool: { createdAt: at(min) }, graduatedAt: undefined, holderCount: holders, stats24h: { numTraders: 393, buyVolume: 37000, buyOrganicVolume: 0 } } }, {}, { priceChange: 60, numBuys: 200, buyVolume: 37000, sellVolume: 33000 });
  assert.equal(earlyScreen(pral(2, 244), earlyLimits('spicy')).ok, true); assert.match(earlyScreen(pral(2, 244), earlyLimits('balanced')).reasons.join(' '), /0\.0% of its buying comes from real traders/);
  assert.match(earlyScreen(pral(7, 244), earlyLimits('spicy')).reasons.join(' '), /real traders/, 'after five minutes the number counts again'); assert.match(earlyScreen(pral(2, 150), earlyLimits('spicy')).reasons.join(' '), /real traders/, 'and never when most of its traders have already left');
  const E = earlyLimits('spicy'), limits = { ...ROCKET_LEVELS.spicy, minTraders: E.minTraders, organicGraceMin: E.organicGraceMin, organicGraceHoldPct: E.organicGraceHoldPct }, c = { ageMin: 2, traders: 393, holders: 244, organicBuyPct: 0, curveSecs: null, creator: { kind: 'record' } };
  assert.equal(launchAudit(c, [], limits).ok, true); assert.equal(launchAudit({ ...c, ageMin: 7 }, [], limits).ok, false); assert.equal(launchAudit(c, [], ROCKET_LEVELS.spicy).ok, false, 'only an early bet gets the grace');
});

test('Spicy, second loosening: a prolific creator is refused only under 3% graduated, real buying may be 0.5%, and the creator may hold 12%', async () => {
  const { rocketLimits } = await import('../lib/rocket.mjs'), S = rocketLimits('spicy'), B = rocketLimits('balanced'), both = (c) => [rocketScreen(c, B).ok, rocketScreen(c, S).ok];
  assert.deepEqual(both(cand({}, { devMints: 100, devMigrations: 5 })), [false, true], '5% graduated: refused on Balanced, allowed on Spicy');
  assert.deepEqual(both(cand({}, { devMints: 100, devMigrations: 2 })), [false, false], '2% graduated: refused everywhere'); assert.deepEqual(both(cand({}, { devMints: 191, devMigrations: 28 })), [true, true], 'a mixed record was never refused');
  assert.deepEqual(both(cand({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 280 } } })), [false, true], '0.7% real buying'); assert.equal(rocketScreen(cand({ asset: { stats24h: { numTraders: 1500, buyVolume: 40000, buyOrganicVolume: 160 } } }), S).ok, false, '0.4% is still too little');
  assert.deepEqual(both(cand({}, { devBalancePercentage: 10 })), [false, true]); assert.equal(rocketScreen(cand({}, { devBalancePercentage: 14 }), S).ok, false);
});

test('a bet that has been in profit is protected, and Warrior leaves when a sell-off starts (the MLM case)', async () => {
  const { rocketRatchet, rocketFlow, rocketWatch } = await import('../lib/rocket.mjs'), bet = (o = {}) => ({ rocket: { protectAtPct: 15, sellOffExit: 1 }, entry: 1, stop: 0.9, openedAt: NOW - 5 * 60_000, ...o });
  // a price has to be seen on two looks in a row before it counts as the best price
  const step = (p, price, o) => { const r = rocketRatchet(p, price, o); return r ? { ...p, peakSeen: r.peak, lastLook: r.look, stop: r.stop } : p; };
  let b1 = step(bet(), 1.16); assert.equal(b1.stop, 0.9, 'one look at +16% moves nothing'); b1 = step(b1, 1.17); assert.ok(Math.abs(b1.stop - 1.03) < 1e-9, 'a second look confirms it: the stop moves above what was paid'); assert.ok(Math.abs(b1.peakSeen - 1.16) < 1e-9);
  // Tailers: a wick to +60% for one look, then straight back. The stop must not jump above where the coin is trading.
  let wick = step(step(step(bet(), 1.05), 1.60), 1.08); assert.equal(wick.stop, 0.9, 'a one-look wick moves nothing'); assert.ok(wick.peakSeen < 1.1);
  // held at +40% for two looks: half the best gain is locked in, and the stop never comes back down
  let run = step(step(bet(), 1.40), 1.42); assert.ok(Math.abs(run.stop - 1.20) < 1e-9); run = step(step(run, 1.25), 1.22); assert.ok(Math.abs(run.stop - 1.20) < 1e-9);
  // the floor covers what the bet really cost: 0.026719 SOL left the wallet for 0.025 swapped, so break-even is about 10% up, not 3%
  let small = step(step(bet(), 1.18), 1.18, { costMult: 0.026719 / 0.025 }); small = step(small, 1.18, { costMult: 0.026719 / 0.025 }); assert.ok(Math.abs(small.stop - 1 * (0.026719 / 0.025) * 1.03) < 1e-9, 'the stop sits where a sale returns the stake'); assert.ok(small.stop > 1.09 && small.stop < 1.11);
  let thin = step(step(bet(), 1.16), 1.16, { costMult: 1.2 }); assert.equal(thin.stop, 0.9, 'if break-even is above the best price seen, there is nothing to protect yet');
  assert.equal(rocketRatchet(bet({ rocket: { protectAtPct: 0 } }), 2), null, 'off means off'); assert.equal(rocketRatchet({ entry: 1, stop: 0.9 }, 2), null, 'ordinary positions are left alone');
  // MLM: up, then back to a 10% stop. With protection the bet is sold above the price paid.
  assert.equal(rocketWatch(bet({ stop: 1.03 }), { price: 1.01 }), 'profit-lock'); assert.equal(rocketWatch(bet(), { price: 0.89 }), 'stop');
  // a sell-off: far more selling than buying with the price falling
  assert.equal(rocketFlow(bet(), { buyUsd5m: 4000, sellUsd5m: 6000, change5mPct: -8 }, undefined, NOW), 'sell-off');
  assert.equal(rocketFlow(bet(), { buyUsd5m: 4000, sellUsd5m: 6000, change5mPct: 3 }, undefined, NOW), null, 'selling ahead while the price holds is not one'); assert.equal(rocketFlow(bet(), { buyUsd5m: 4000, sellUsd5m: 5000, change5mPct: -8 }, undefined, NOW), null);
  assert.equal(rocketFlow(bet({ openedAt: NOW - 30_000 }), { buyUsd5m: 4000, sellUsd5m: 9000, change5mPct: -20 }, undefined, NOW), null, 'not in the first minute: the numbers are from before the buy');
  assert.equal(rocketFlow(bet({ rocket: { sellOffExit: 0 } }), { buyUsd5m: 1, sellUsd5m: 9000, change5mPct: -50 }, undefined, NOW), null); assert.equal(rocketFlow(bet(), {}, undefined, NOW), null, 'missing numbers never sell');
  // the biggest holders cutting their share since the buy
  const held = bet({ checked: { topHoldersPct: 20 } }); assert.equal(rocketFlow(held, { topHoldersPct: 13 }, undefined, NOW), 'big-holders-selling'); assert.equal(rocketFlow(held, { topHoldersPct: 17 }, undefined, NOW), null);
  assert.equal(defaultRocket.protectAtPct, 30); assert.equal(defaultRocket.sellOffExit, 1); for (const bad of [{ protectAtPct: 2 }, { sellOffExit: 2 }]) assert.equal(validateRocket(bad).ok, false, JSON.stringify(bad));
});

test('Rocket plans come from the preset: a 50% target, stake out at +25%, only the limits differ', async () => {
  const { rocketFor, ROCKET_PLANS } = await import('../lib/rocket.mjs');
  for (const p of ['chill', 'balanced', 'spicy']) { const r = rocketFor(p, { on: true, betSol: 0.03 }); assert.ok(r.ok, r.reasons.join('; ')); assert.equal(r.value.targetPct, 50); assert.equal(r.value.takeOutAtPct, 25); assert.equal(r.value.trailStartPct, 25); assert.equal(r.value.early, 0); assert.equal(r.value.betSol, 0.03); }
  assert.deepEqual(['chill', 'balanced', 'spicy'].map((p) => ROCKET_PLANS[p].maxBetsPerDay), [3, 6, 20]);
  assert.equal(rocketFor('spicy', { on: true, targetPct: 1000 }).value.targetPct, 50, 'a typed number is ignored');
});

test('Rocket copy filter: practice bets need a launch wallet buying, live bets are unchanged, copy bets are labelled', async () => {
  const fs = await import('node:fs'), src = fs.readFileSync(new URL('../public/auto.js', import.meta.url), 'utf8');
  assert.match(src, /const copy = !live\(\)/, 'only practice mode uses the copy filter');
  assert.match(src, /\(c\.copy\?\.count \?\? 0\) >= 1/, 'a practice pick needs one launch wallet buying');
  assert.match(src, /p\.rocket\.copy === 1 \? 'rocket-copy'/, 'copy bets are marked in the history');
  const list = JSON.parse(fs.readFileSync(new URL('../public/rocket-wallets.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(list.wallets) && list.wallets.every((w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)), 'a list of wallet addresses');
  assert.ok(Number.isFinite(Date.parse(list.at)));
  const smart = await import('../lib/smart.mjs'); assert.equal(typeof smart.rocketList, 'function');
  const feed = fs.readFileSync(new URL('../lib/http/rocket.js', import.meta.url), 'utf8'); assert.match(feed, /minutes: 10/);
});

test('a coin of any age with one bundled buy for every two holders is refused (SYCAMORE, October 15)', async () => {
  const { launchAudit } = await import('../lib/rocket.mjs');
  const base = { ageMin: 187, holders: 574, traders: 2872, bundles: 1128, bundlerPeakPct: null, topHoldersPct: 20 };
  const r = launchAudit(base); assert.ok(r.reasons.some((x) => /1128 bundled buys for 574 holders/.test(x)), r.reasons.join('; '));
  for (const ok of [{ bundles: 117, holders: 2491 }, { bundles: 237, holders: 4632 }, { bundles: 62, holders: 12640 }]) assert.ok(!launchAudit({ ...base, ...ok }).reasons.some((x) => /faking the crowd/.test(x)), JSON.stringify(ok));
});
