// The strategy dial as this browser remembers it: a preset, any exact numbers changed in the advanced panel, and how
// transactions are sent. The numbers are resolved by the same tested rules the server uses (/vendor/lib/presets.js).
import { PRESETS, TUNABLE, resolveRules, toQuery, describe } from '/vendor/lib/presets.js';
import { emit, on } from '/bus.js';
const KEY = 'warrior.rules.v1';
export const PRIORITY = [{ id: 'off', label: 'Off', lamports: 0 }, { id: 'normal', label: 'Normal (up to 0.0002 SOL)', lamports: 200_000 }, { id: 'fast', label: 'Fast (up to 0.001 SOL)', lamports: 1_000_000 }, { id: 'turbo', label: 'Turbo (up to 0.003 SOL)', lamports: 3_000_000 }];
let choice = { preset: 'balanced', custom: {} }, send = { priority: 'fast', protect: false }, resolved = resolveRules(choice);
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  // Presets only (October 14, 2026): numbers typed in earlier versions are dropped.
  if (saved && PRESETS[saved.preset]) { const next = { preset: saved.preset, custom: {} }; resolved = resolveRules(next); choice = next; }
  if (saved?.send && PRIORITY.some((p) => p.id === saved.send.priority)) send = { priority: saved.send.priority, protect: saved.send.protect === true };
} catch { choice = { preset: 'balanced', custom: {} }; resolved = resolveRules(choice); }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...choice, send })); } catch {} };
function apply(next) { const before = resolved.version; resolved = resolveRules(next); choice = next; persist(); if (resolved.version !== before) emit('rules-changed', resolved); } // saying the same thing twice changes nothing // resolveRules throws before anything is saved

// Another device changed the rules: take them, the same way as a change made here.
on('synced', (keys) => { if (!keys.includes(KEY)) return; try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s && PRESETS[s.preset]) { if (s.send && PRIORITY.some((p) => p.id === s.send.priority)) send = { priority: s.send.priority, protect: s.send.protect === true }; apply({ preset: s.preset, custom: {} }); emit('send-changed', rules.send); } } catch {} });

export const rules = {
  PRESETS, TUNABLE, PRIORITY,
  get choice() { return choice; }, get resolved() { return resolved; }, get query() { return toQuery(choice); }, get asObject() { return Object.fromEntries(new URLSearchParams(toQuery(choice))); },
  get text() { return describe(resolved); }, get slip() { return resolved.risk.slippageBps; },
  get send() { return { maxPriorityLamports: PRIORITY.find((p) => p.id === send.priority).lamports, protect: send.protect, priority: send.priority }; },
  setPreset(preset) { apply({ preset, custom: {} }); },
  setSend(next) { send = { priority: PRIORITY.some((p) => p.id === next.priority) ? next.priority : send.priority, protect: next.protect === true }; persist(); emit('send-changed', rules.send); }
};
