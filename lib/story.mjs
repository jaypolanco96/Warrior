// "Your day as a story" and the practice league. Pure: both are built only from what was recorded.

/** A blank record for one day. The page and the bot add to it as things happen. */
export const blankDay = (day) => ({ day, scans: 0, coinsSeen: 0, screenedOut: 0, analysed: 0, enters: 0, waits: {}, failedScans: 0 });
/** Add one scan result to the day's record. */
export function recordScan(dayRecord, scan) {
  const d = { ...dayRecord, waits: { ...dayRecord.waits } };
  if (!scan) { d.failedScans++; return d; }
  d.scans++; d.coinsSeen = Math.max(d.coinsSeen, scan.universe ?? 0); d.screenedOut = Math.max(d.screenedOut, scan.rejected ?? 0); d.analysed += scan.results?.length ?? 0;
  for (const t of scan.results ?? []) { if (t.analysis?.decision === 'enter') d.enters++; else { const why = String(t.analysis?.reasons?.[0] ?? 'Rules not met').replace(/\s*\(need \d\)/, '').replace(/^Only \d of 4/, 'Too few'); d.waits[why] = (d.waits[why] ?? 0) + 1; } }
  return d;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const solText = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(4)} SOL`;
/** The day as a few short slides: what Warrior watched, what it skipped and why, what was traded. */
export function dayStory(dayRecord, trades = [], { practice = true } = {}) {
  const d = dayRecord ?? blankDay(''), slides = [];
  if (!d.scans) { slides.push({ face: '😴', title: 'A quiet day', text: 'Warrior has not finished a scan yet today. The first one takes up to a minute after you open the page. Look again shortly.' }); return slides; }
  slides.push({ face: '🧐', title: 'What I watched', text: `I scanned the market ${plural(d.scans, 'time')} and looked at up to ${plural(d.coinsSeen, 'coin')} each time.${d.failedScans ? ` ${plural(d.failedScans, 'scan')} failed because the data was down; I did not guess.` : ''}` });
  slides.push({ face: '🛡️', title: 'What never got past the door', text: d.screenedOut ? `${plural(d.screenedOut, 'coin')} failed the safety screen before I even read a chart: too thin, too new, or a creator with too much power.` : 'Every coin I saw passed the safety screen. That is unusual.' });
  const top = Object.entries(d.waits).sort((a, b) => b[1] - a[1]).slice(0, 3);
  slides.push({ face: '✋', title: 'What I skipped, and why', text: top.length ? `I said WAIT ${plural(Object.values(d.waits).reduce((a, b) => a + b, 0), 'time')}. Most often: ${top.map(([why, n]) => `${why.toLowerCase()} (${n})`).join('; ')}.` : 'I did not have to say WAIT once.' });
  slides.push({ face: d.enters ? '🤩' : '😌', title: 'What I liked', text: d.enters ? `I called ENTER ${plural(d.enters, 'time')}. A call is a reading of the rules, not a promise.` : 'I did not call a single ENTER. Sitting on our hands was the trade.' });
  if (!trades.length) slides.push({ face: '🫖', title: 'What you traded', text: 'Nothing closed today. No result is also a result.' });
  else {
    const total = trades.reduce((n, t) => n + t.pnlSol, 0), wins = trades.filter((t) => t.pnlSol > 0).length, best = [...trades].sort((a, b) => b.pnlSol - a.pnlSol)[0], worst = [...trades].sort((a, b) => a.pnlSol - b.pnlSol)[0];
    slides.push({ face: total > 0 ? '😂' : '🤗', title: 'What you traded', text: `${plural(trades.length, 'trade')} closed: ${wins} up, ${trades.length - wins} not. Together ${solText(total)}${practice ? ' of practice money' : ''}. Best: ${best.symbol} ${solText(best.pnlSol)}. Worst: ${worst.symbol} ${solText(worst.pnlSol)}.` });
  }
  slides.push({ face: '🌙', title: 'That was the day', text: 'One day says very little. The scorecard keeps the long record, winners and losers alike.' });
  return slides;
}

// ---------- practice league: friends compare PRETEND money results. Never real money, so nobody gambles for rank. ----------
const b64 = { enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
const check = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
/** The league week a moment belongs to: the Monday (UTC) it started, as YYYY-MM-DD. */
export function leagueWeek(now = Date.now()) { const d = new Date(now), day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10); }
/** Your standing this week, from practice trades only. */
export function leagueEntry(name, trades = [], now = Date.now(), startSol = 0.5) {
  const week = leagueWeek(now), from = Date.parse(`${week}T00:00:00Z`), mine = trades.filter((t) => t.mode === 'paper' && Number.isFinite(t.closedAt) && t.closedAt >= from && t.closedAt <= now && Number.isFinite(t.pnlSol));
  const pnl = mine.reduce((n, t) => n + t.pnlSol, 0);
  return { v: 1, name: String(name ?? '').trim().slice(0, 16) || 'Anonymous', week, trades: mine.length, wins: mine.filter((t) => t.pnlSol > 0).length, returnPct: Math.round(pnl / startSol * 10_000) / 100 };
}
/** A short code a friend can paste. It is a convenience, not a proof: the league runs on honour, and says so. */
export function leagueCode(entry) { const body = b64.enc(JSON.stringify([entry.v, entry.name, entry.week, entry.trades, entry.wins, entry.returnPct])); return `WARRIOR-${body}-${check(body)}`; }
export function readLeagueCode(code) {
  const m = /^WARRIOR-([A-Za-z0-9_-]{8,200})-([a-z0-9]{1,8})$/.exec(String(code ?? '').trim()); if (!m || check(m[1]) !== m[2]) return null;
  try { const [v, name, week, trades, wins, returnPct] = JSON.parse(b64.dec(m[1])); if (v !== 1 || typeof name !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isInteger(trades) || !Number.isInteger(wins) || trades < 0 || wins < 0 || wins > trades || !Number.isFinite(returnPct) || Math.abs(returnPct) > 100_000) return null; return { v, name: name.slice(0, 16), week, trades, wins, returnPct }; } catch { return null; }
}
/** This week's table. Entries from another week are set aside, not ranked. Ties share a place. */
export function leagueTable(entries, week) {
  const current = entries.filter((e) => e && e.week === week).sort((a, b) => b.returnPct - a.returnPct || b.trades - a.trades || a.name.localeCompare(b.name));
  let place = 0, last = null;
  return { rows: current.map((e, i) => { if (last === null || e.returnPct !== last) place = i + 1; last = e.returnPct; return { ...e, place }; }), old: entries.filter((e) => e && e.week !== week) };
}
