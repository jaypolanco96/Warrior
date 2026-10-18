// Allocate research attention, never wallet capital or safety permissions, from current reported trading activity.
export const MARKET_TYPES = Object.freeze({ mature: 'Mature', rocket: 'Rocket launches', young: 'Young', other: 'Other coins', unknown: 'Unknown age' });
const H = 3_600_000;
const nonnegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function marketType(token, now = Date.now()) {
  if (token.mature === true) return 'mature';
  const born = nonnegative(token.tokenCreatedAt) ? token.tokenCreatedAt : token.createdAt;
  const age = nonnegative(born) && born <= now ? now - born : null;
  if (age !== null && age < H && token.pump) return 'rocket';
  if (token.established === true) return 'mature';
  return age === null ? 'unknown' : age < 5 * H ? 'young' : 'other';
}

/** USD turnover is buying plus selling, not money entering a chain or a count of people. */
export function activityVolume(token) {
  return nonnegative(token.activity?.turnoverUsd) ? token.activity.turnoverUsd : nonnegative(token.volume1hUsd) ? token.volume1hUsd : 0;
}
export function compareActivity(a, b) {
  return activityVolume(b) - activityVolume(a)
    || (b.activity?.traders ?? -1) - (a.activity?.traders ?? -1)
    || (b.activity?.organicTurnoverUsd ?? -1) - (a.activity?.organicTurnoverUsd ?? -1)
    || String(a.mint).localeCompare(String(b.mint));
}

// Each present category gets a place when there is room. Remaining places follow its observed volume. The 75% cap
// preserves exploration of other categories; it is relaxed only when those categories have no candidates left.
export function allocateAttention(tokens, limit, now = Date.now()) {
  const unique = [...new Map(tokens.map((t) => [t.mint, t])).values()];
  const n = Math.min(unique.length, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0);
  const groups = Object.keys(MARKET_TYPES).map((type) => ({ type, tokens: unique.filter((t) => marketType(t, now) === type).sort(compareActivity), used: 0 }))
    .filter((g) => g.tokens.length);
  for (const g of groups) g.weight = g.tokens.reduce((sum, t) => sum + activityVolume(t), 0);
  groups.sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type));
  const out = [], take = (g) => { out.push(g.tokens[g.used++]); };
  for (const g of groups) { if (out.length >= n) break; take(g); }
  const cap = Math.max(1, Math.ceil(n * 0.75));
  while (out.length < n) {
    const available = groups.filter((g) => g.used < g.tokens.length), capped = available.filter((g) => g.used < cap);
    const pool = capped.length ? capped : available;
    pool.sort((a, b) => b.weight / (b.used + 1) - a.weight / (a.used + 1) || compareActivity(a.tokens[a.used], b.tokens[b.used]));
    if (!pool.length) break; take(pool[0]);
  }
  return out;
}

/** Existing deep-dip discovery split: three quarters current dips, then a watch list for the next dip. */
export function selectActiveCandidates(tokens, { limit = 36, settings, now = Date.now() }) {
  const eligible = tokens.filter((t) => activityVolume(t) > 0 && Number.isFinite(t.volume1hUsd) && t.volume1hUsd >= settings.minVol1hUsd
    && !(settings.dipDayDropPct > 0 && Number.isFinite(t.change?.h24) && t.change.h24 < -settings.dipDayDropPct));
  const dipping = eligible.filter((t) => (t.change?.h1 ?? 0) <= -3 || (t.change?.m5 ?? 0) <= -3);
  const first = allocateAttention(dipping, Math.ceil(limit * 0.75), now), taken = new Set(first.map((t) => t.mint));
  return [...first, ...allocateAttention(eligible.filter((t) => !taken.has(t.mint)), limit - first.length, now)];
}

export function activitySummary(tokens, { passed = [], selected = [], now = Date.now() } = {}) {
  const unique = [...new Map(tokens.map((t) => [t.mint, t])).values()];
  const pass = new Set(passed.map((t) => t.mint)), read = new Set(selected.map((t) => t.mint));
  const groups = Object.entries(MARKET_TYPES).map(([type, label]) => {
    const list = unique.filter((t) => marketType(t, now) === type), measured = list.filter((t) => nonnegative(t.activity?.turnoverUsd) || nonnegative(t.volume1hUsd));
    return { type, label, coins: list.length, measured: measured.length, turnoverUsd: measured.reduce((s, t) => s + activityVolume(t), 0),
      passed: list.filter((t) => pass.has(t.mint)).length, selected: list.filter((t) => read.has(t.mint)).length,
      tradersKnown: list.filter((t) => nonnegative(t.activity?.traders)).length,
      organicKnown: list.filter((t) => nonnegative(t.activity?.organicTurnoverUsd)).length };
  });
  const totalUsd = groups.reduce((s, g) => s + g.turnoverUsd, 0);
  for (const g of groups) g.sharePct = totalUsd > 0 ? g.turnoverUsd / totalUsd * 100 : null;
  const ranked = [...groups].sort((a, b) => b.turnoverUsd - a.turnoverUsd);
  return { policy: 'activity-v1', windowMinutes: 60, basis: 'Reported USD turnover in observed lists, not net SOL inflow or unique people',
    totalUsd, measured: groups.reduce((s, g) => s + g.measured, 0), observed: unique.length, leader: totalUsd > 0 ? ranked[0].type : null, groups };
}
