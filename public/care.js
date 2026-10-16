// Looking after the person, not the trade: the mood guard, bedtime rules and the day's record for the story.
// This file imports nothing from the scanner or the trader, so both can use it.
import { moodCheck, MOOD_CHOICES, BREATHER_MINUTES, validateBedtime, bedtimeState, bedtimeText } from '/vendor/lib/mood.js';
import { blankDay, recordScan } from '/vendor/lib/story.js';
import { emit } from '/bus.js';

const $ = (id) => document.getElementById(id);
const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- bedtime rules ----------
const BED_KEY = 'warrior.bedtime.v1';
let bed = { on: false, stopAt: '23:00', closeAt: '00:00', wakeAt: '07:00', ...read(BED_KEY, {}) };
export const bedtime = {
  get value() { return { ...bed }; }, get text() { return bedtimeText(bed); },
  /** What the rule says this minute, in this device's own clock. */
  get now() { const d = new Date(); return bedtimeState(bed, d.getHours() * 60 + d.getMinutes()); },
  /** Save a rule. Returns the reasons it was refused, or an empty list. */
  set(next) { const candidate = { ...bed, ...next }; if (candidate.on) { const v = validateBedtime(candidate); if (!v.ok) return v.reasons; } bed = candidate; write(BED_KEY, bed); emit('bedtime-changed', bed); return []; }
};

// ---------- the day's record, for "your day as a story" ----------
const DAY_KEY = 'warrior.day.v1', today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const day = {
  get record() { const d = read(DAY_KEY, null); return d?.day === today() ? d : blankDay(today()); },
  /** Add one scan (or a failed one, as null) to today's record. */
  scanned(result) { write(DAY_KEY, recordScan(day.record, result)); }
};

// ---------- mood guard: notice a bad moment and offer a breather. It is always your call. ----------
const REST_KEY = 'warrior.breather.v1';
function closedTrades(practice) {
  const auto = read('warrior.auto.state.v1', {})?.trades ?? [], mode = practice ? 'paper' : 'live', list = auto.filter((t) => t.mode === mode);
  if (!practice) for (const p of read('warrior.positions.v1', [])) if (p?.closedAt && Number.isFinite(p.quotedOutSol) && Number.isFinite(p.sol)) list.push({ mint: p.mint, pnlSol: p.quotedOutSol - p.sol, solIn: p.sol, closedAt: p.closedAt });
  return list;
}
function ask({ title, message, restLabel, goLabel, onRest }, proceed) {
  const d = $('mood'); $('mood-title').textContent = title; $('mood-text').textContent = message;
  const rest = $('mood-rest'), go = $('mood-go'); rest.textContent = restLabel; go.textContent = goLabel;
  rest.onclick = () => { d.close(); onRest?.(); }; go.onclick = () => { d.close(); proceed(); };
  if (!d.open) d.showModal(); rest.focus();
}
/**
 * Call before a buy the person asked for by hand. Runs `proceed` straight away unless there is something worth a pause.
 * Warrior's own automatic trades never come through here.
 */
export function guardBuy({ mint, sol, practice }, proceed) {
  const until = Number(read(REST_KEY, 0)), sleep = bedtime.now;
  if (until > Date.now()) return ask({ title: 'You are on a breather', message: `You chose to rest until ${clock(until)}. Nothing is locked: it is your call.`, restLabel: 'Keep resting', goLabel: 'End it and go ahead' }, () => { write(REST_KEY, 0); proceed(); });
  if (sleep.asleep) return ask({ title: 'Past your bedtime rule', message: `You told Warrior: ${bedtime.text} Tired trades are rarely good ones. It is still your call.`, restLabel: 'Leave it for tonight', goLabel: 'Go ahead anyway' }, proceed);
  const seen = moodCheck({ trades: closedTrades(practice), proposed: { mint, sol } });
  if (!seen) return proceed();
  ask({ title: 'A quick word first', message: `${seen.message} Want a short break? Say no and Warrior carries on.`, restLabel: MOOD_CHOICES.rest, goLabel: MOOD_CHOICES.go, onRest: () => { write(REST_KEY, Date.now() + BREATHER_MINUTES * 60_000); emit('breather', { until: Date.now() + BREATHER_MINUTES * 60_000, kind: seen.kind }); } }, proceed);
}
