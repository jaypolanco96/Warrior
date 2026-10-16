// Your own orders: buy below a price, sell above a price, your own stop and target, and buying or selling in slices.
// Pure rules. They decide WHEN something is due; the trader still applies every cost and risk check before it acts.

const price = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const DAY = 86_400_000;
export const ORDER_LIMITS = Object.freeze({ maxActive: 10, maxDays: 14, minSol: 0.02, maxSol: 5, minSlices: 2, maxSlices: 12, minEveryMinutes: 2, maxEveryMinutes: 1440 });

/** Check a new price order. Returns { ok, reasons, order }. `now` and `currentPrice` make the check testable. */
export function validateOrder(o, { now = Date.now(), currentPrice = null } = {}) {
  const reasons = [];
  if (!o || !['buy-below', 'sell-above'].includes(o.kind)) return { ok: false, reasons: ['Unknown order type'] };
  if (typeof o.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o.mint)) reasons.push('Unknown coin');
  if (!price(o.price)) reasons.push('Enter a price above zero');
  if (o.kind === 'buy-below') {
    if (!price(o.sol) || o.sol < ORDER_LIMITS.minSol || o.sol > ORDER_LIMITS.maxSol) reasons.push(`Amount must be ${ORDER_LIMITS.minSol} to ${ORDER_LIMITS.maxSol} SOL`);
    if (price(currentPrice) && price(o.price) && o.price >= currentPrice) reasons.push('A buy-below price must be under the current price. To buy now, use the buy button');
  } else {
    if (!price(o.fraction) || o.fraction > 1 || o.fraction < 0.05) reasons.push('Choose how much to sell: 5% to 100%');
    if (price(currentPrice) && price(o.price) && o.price <= currentPrice) reasons.push('A sell-above price must be over the current price. To sell now, use the sell button');
  }
  const days = o.days ?? 7; if (!Number.isFinite(days) || days < 1 / 24 || days > ORDER_LIMITS.maxDays) reasons.push(`An order can wait at most ${ORDER_LIMITS.maxDays} days`);
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, reasons, order: { kind: o.kind, mint: o.mint, price: o.price, ...(o.kind === 'buy-below' ? { sol: o.sol } : { fraction: o.fraction }), createdAt: now, expiresAt: now + days * DAY, status: 'waiting', attempts: 0 } };
}

/** Is a waiting order due? An unknown price never fills an order: waiting is the safe answer. */
export function orderDue(order, currentPrice, now = Date.now()) {
  if (!order || order.status !== 'waiting') return 'done';
  if (now >= order.expiresAt) return 'expired';
  if (!price(currentPrice)) return 'wait';
  if (order.kind === 'buy-below') return currentPrice <= order.price ? 'fill' : 'wait';
  return currentPrice >= order.price ? 'fill' : 'wait';
}

/** Check your own stop and target for a position. Either may be missing. */
export function validateExits({ entry, stop, target }, currentPrice = null) {
  const reasons = [], ref = price(currentPrice) ? currentPrice : entry;
  if (stop !== null && stop !== undefined) { if (!price(stop)) reasons.push('Stop must be a price above zero'); else if (price(ref) && stop >= ref) reasons.push('A stop must be below the current price'); }
  if (target !== null && target !== undefined) { if (!price(target)) reasons.push('Target must be a price above zero'); else if (price(ref) && target <= ref) reasons.push('A target must be above the current price'); }
  return { ok: reasons.length === 0, reasons };
}
/** Has the price reached your own stop or target? Returns 'stop', 'target' or null. Unknown price: null. */
export function ownExitDue(position, currentPrice) {
  if (!position || !price(currentPrice)) return null;
  if (price(position.ownStop) && currentPrice <= position.ownStop) return 'stop';
  if (price(position.ownTarget) && currentPrice >= position.ownTarget) return 'target';
  return null;
}

/**
 * Plan a buy or a sell in equal slices over time.
 * Buy: `totalSol` is split evenly. Sell: the position is sold in equal parts, so slice i sells 1/(left) of what remains.
 */
export function slicePlan({ side, mint, totalSol, slices, everyMinutes, startAt = Date.now() }) {
  const reasons = [], L = ORDER_LIMITS;
  if (!['buy', 'sell'].includes(side)) return { ok: false, reasons: ['Unknown plan type'] };
  if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) reasons.push('Unknown coin');
  if (!Number.isInteger(slices) || slices < L.minSlices || slices > L.maxSlices) reasons.push(`Use ${L.minSlices} to ${L.maxSlices} slices`);
  if (!Number.isFinite(everyMinutes) || everyMinutes < L.minEveryMinutes || everyMinutes > L.maxEveryMinutes) reasons.push(`Space slices ${L.minEveryMinutes} minutes to 24 hours apart`);
  if (side === 'buy') { if (!price(totalSol) || totalSol > L.maxSol * 2) reasons.push('Enter a total amount in SOL'); else if (Number.isInteger(slices) && totalSol / slices < L.minSol) reasons.push(`Each slice must be at least ${L.minSol} SOL: use fewer slices or a larger total`); }
  if (reasons.length) return { ok: false, reasons };
  const each = side === 'buy' ? Math.floor(Math.round(totalSol * 1e6) / slices) / 1e6 : null;
  return { ok: true, reasons, plan: { side, mint, slices, everyMinutes, done: 0, failed: 0, nextAt: startAt, createdAt: startAt, status: 'running', ...(side === 'buy' ? { solEach: each, totalSol: each * slices } : {}) } };
}
/** What the next slice should do, if one is due. Late slices never bunch up: only one runs, and the rest keep their spacing. */
export function sliceDue(plan, now = Date.now()) {
  if (!plan || plan.status !== 'running' || plan.done >= plan.slices || now < plan.nextAt) return null;
  const left = plan.slices - plan.done;
  return plan.side === 'buy' ? { side: 'buy', sol: plan.solEach, index: plan.done } : { side: 'sell', fraction: 1 / left, index: plan.done };
}
/** Record the outcome of a slice. Three failures in a row pause the plan instead of retrying forever. */
export function sliceDone(plan, ok, now = Date.now()) {
  const next = { ...plan, nextAt: now + plan.everyMinutes * 60_000 };
  if (ok) { next.done = plan.done + 1; next.failed = 0; if (next.done >= plan.slices) next.status = 'finished'; }
  else { next.failed = (plan.failed ?? 0) + 1; if (next.failed >= 3) next.status = 'paused'; }
  return next;
}

/** A pool with less than this many dollars in it is treated as emptied: there is nothing to sell into. */
export const EMPTY_POOL_USD = 500;
export const poolEmptied = (liquidityUsd) => typeof liquidityUsd === 'number' && Number.isFinite(liquidityUsd) && liquidityUsd < EMPTY_POOL_USD;
/**
 * Has the live price reached the position's automatic stop or target? Returns 'stop', 'target' or null.
 * Candles can lag or stop arriving; the live price is a second pair of eyes. A single odd price print proves little,
 * so the caller sells only after two looks in a row agree (see `confirm`).
 */
export function autoExitDue(position, currentPrice) {
  if (!position || !price(currentPrice)) return null;
  if (price(position.stop) && currentPrice <= position.stop) return 'stop';
  if (price(position.target) && currentPrice >= position.target) return 'target';
  return null;
}
/** Count consecutive looks that gave the same answer. `seen` is a Map kept by the caller. Returns true on the second. */
export function confirm(seen, key, due) {
  if (!due) { seen.delete(key); return false; }
  const last = seen.get(key), count = last?.due === due ? last.count + 1 : 1; seen.set(key, { due, count });
  return count >= 2;
}

/**
 * Automatic part-exits and one dip add, from the rules. `gainPct` is how far the position is up or down against what
 * went into it (after a part-sale both sides shrink together, so it stays a measure of the move since the buy).
 * Returns null, or one action: { kind: 'sell', fraction, mark, reason } or { kind: 'add', sol, mark }.
 * Each action happens once per position: `mark` is recorded on position.auto. Rocket bets and emptied pools are left alone.
 */
export function partialDue(position, gainPct, settings) {
  const p = position, s = settings ?? {}, done = p?.auto ?? {};
  if (!p || p.empty || !(p.solIn > 0) || typeof gainPct !== 'number' || !Number.isFinite(gainPct) || gainPct <= -100) return null;
  // A Rocket bet follows its own setting only: take the stake out once it is up enough, and let the rest ride.
  if (p.rocket) { const at = p.rocket.takeOutAtPct; return at > 0 && !done.tookOut && gainPct >= at ? { kind: 'sell', fraction: Math.min(0.95, 1 / (1 + gainPct / 100)), mark: 'tookOut', reason: 'took-out' } : null; }
  if (s.takeOutAtPct > 0 && !done.tookOut && gainPct >= s.takeOutAtPct) return { kind: 'sell', fraction: Math.min(0.95, 1 / (1 + gainPct / 100)), mark: 'tookOut', reason: 'took-out' };
  if (s.stepPct > 0 && !done.step1 && gainPct >= s.stepPct) return { kind: 'sell', fraction: 1 / 3, mark: 'step1', reason: 'step' };
  if (s.stepPct > 0 && done.step1 && !done.step2 && gainPct >= s.stepPct * 2) return { kind: 'sell', fraction: 1 / 2, mark: 'step2', reason: 'step' };
  // One add, and only while the position is still above its stop: below the stop it is being sold, not bought.
  if (s.dipAddPct > 0 && !done.dip && gainPct <= -s.dipAddPct && !(price(p.last) && price(p.stop) && p.last <= p.stop)) return { kind: 'add', sol: Math.round(p.solIn * 0.5 * 1e4) / 1e4, mark: 'dip' };
  return null;
}
