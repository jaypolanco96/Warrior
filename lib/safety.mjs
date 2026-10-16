// The deeper safety panel. Turns raw facts about a coin into plain lines with a level:
// 'good', 'watch', 'bad' or 'unknown'. Unknown is shown as unknown, never as fine.

const num = (v) => { const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const yesNo = (v) => v === 'yes' || v === true ? true : v === 'no' || v === false ? false : null;

/**
 * `info`: token facts from the data source (holders, creator, launch). `token`: pool facts. `depth`: [{ sol, impactPct }].
 * Returns { items: [{ key, label, value, level, note }], worst }.
 */
export function safetyReport({ info = null, token = null, depth = [], now = Date.now() } = {}) {
  const items = [], add = (key, label, value, level, note = '') => items.push({ key, label, value, level, note });

  const top10 = num(info?.holders?.distribution_percentage?.top_10);
  if (top10 === null) add('holders', 'Top 10 holders', 'unknown', 'unknown', 'The data source has no holder list for this coin yet.');
  else add('holders', 'Top 10 holders', `${top10.toFixed(1)}% of supply`, top10 > 60 ? 'bad' : top10 > 35 ? 'watch' : 'good', 'Can include exchange and pool wallets. A few wallets holding most of a coin can crash it by selling.');
  const count = num(info?.holders?.count); if (count !== null) add('holderCount', 'Holders', count.toLocaleString('en-US'), count < 300 ? 'watch' : 'good', '');

  const dev = num(info?.developer_holding_percentage);
  if (dev === null) add('creator', 'Creator still holds', 'unknown', 'unknown', '');
  else add('creator', 'Creator still holds', `${dev.toFixed(1)}%`, dev > 15 ? 'bad' : dev > 5 ? 'watch' : 'good', 'A creator with a large share can sell it on you.');
  add('creatorHistory', 'Creator history', 'not available', 'unknown', 'Earlier coins by the same creator are not in the free data yet.');

  const freeze = yesNo(info?.freeze_authority), mint = yesNo(info?.mint_authority);
  add('freeze', 'Can the creator freeze it?', freeze === null ? 'unknown' : freeze ? 'yes' : 'no', freeze === null ? 'unknown' : freeze ? 'bad' : 'good', '');
  add('mint', 'Can the creator print more?', mint === null ? 'unknown' : mint ? 'yes' : 'no', mint === null ? 'unknown' : mint ? 'bad' : 'good', '');
  if (info?.is_honeypot === 'yes') add('honeypot', 'Sell trap', 'reported', 'bad', 'The data source reports this coin may not be sellable.');

  const launch = info?.launchpad_details, pump = token?.pump === true;
  if (launch && launch.completed === true) add('launch', 'How it launched', `Launchpad coin, graduated${launch.completed_at ? ` ${new Date(launch.completed_at).toISOString().slice(0, 10)}` : ''}`, 'good', 'It sold out its launch curve and moved to an open pool.');
  else if (launch) add('launch', 'How it launched', `Still on its launch curve (${num(launch.graduation_percentage)?.toFixed(0) ?? '?'}% sold)`, 'watch', 'Coins still on the curve are the riskiest stage.');
  else add('launch', 'How it launched', pump ? 'pump.fun coin' : 'Not from a known launchpad', pump ? 'watch' : 'unknown', '');
  if (token?.unlockedPool === true) add('poolLock', 'Can the pool be emptied?', 'yes', 'bad', "It trades on pump.fun's exchange but was not launched there. Whoever funded the pool can withdraw the money at any moment, leaving nothing to sell into.");

  const age = Number.isFinite(token?.createdAt) ? (now - token.createdAt) / 3_600_000 : null;
  if (age === null) add('age', 'Pool age', 'unknown', 'unknown', '');
  else add('age', 'Pool age', age < 48 ? `${age.toFixed(0)} hours` : `${(age / 24).toFixed(0)} days`, age < 2 ? 'bad' : age < 24 ? 'watch' : 'good', 'Most rug pulls happen in the first hours.');

  const liq = num(token?.liquidityUsd);
  add('liquidity', 'Money in the pool', liq === null ? 'unknown' : `$${Math.round(liq).toLocaleString('en-US')}`, liq === null ? 'unknown' : liq < 40000 ? 'bad' : liq < 150000 ? 'watch' : 'good', '');
  for (const d of depth ?? []) {
    if (!Number.isFinite(d?.sol)) continue;
    if (!Number.isFinite(d.impactPct)) add(`depth${d.sol}`, `Cost to buy ${d.sol} SOL worth`, 'unknown', 'unknown', '');
    // Jupiter answers 100% when it cannot price a trade at all. That is "no usable quote", not a cost.
    else if (d.impactPct >= 99) add(`depth${d.sol}`, `Cost to buy ${d.sol} SOL worth`, 'cannot be priced right now', 'bad', 'Jupiter could not give a usable price for this size. Warrior would refuse the trade.');
    else add(`depth${d.sol}`, `Cost to buy ${d.sol} SOL worth`, `${d.impactPct.toFixed(2)}%`, d.impactPct > 5 ? 'bad' : d.impactPct > 2.5 ? 'watch' : 'good', 'Includes the pool fee. The bigger the trade, the more the price moves against you.');
  }
  const order = ['bad', 'watch', 'unknown', 'good'], worst = order.find((l) => items.some((i) => i.level === l)) ?? 'unknown';
  return { items, worst, counts: Object.fromEntries(order.map((l) => [l, items.filter((i) => i.level === l).length])) };
}
