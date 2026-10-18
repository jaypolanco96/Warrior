import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, csvCell } from '../lib/portfolio.mjs';

test('portfolio uses executable quotes, preserves refundable rent and excludes emptied pools', () => {
  const positions = [
    { mode: 'live', mint: 'quoted', symbol: 'Q', solIn: 0.027, rentSol: 0.002, nowSol: 0.02625, entry: 1 },
    { mode: 'live', mint: 'drained', symbol: 'D', solIn: 0.1, nowSol: 0.12, entry: 1, empty: true },
    { mode: 'paper', mint: 'other', symbol: 'P', solIn: 100, nowSol: 200, entry: 1 }
  ];
  const s = summarize({ positions, prices: { quoted: 2, drained: 3 }, mode: 'live' });
  assert.ok(Math.abs(s.valueSol - 0.02825) < 1e-12);
  assert.ok(Math.abs(s.holdings[0].pnlPct - 5) < 1e-10);
  assert.equal(s.holdings[1].valueSol, 0);
  assert.equal(s.holdings[1].pnlPct, -100);
  assert.equal(s.holdings.length, 2);
});

test('portfolio price fallback grows swapped principal, not rent; old positions keep their cost fallback', () => {
  const s = summarize({ mode: 'live', positions: [
    { mode: 'live', mint: 'new', solIn: 0.027, rentSol: 0.002, entry: 1 },
    { mode: 'live', mint: 'old', solIn: 0.1, entry: 1 }
  ], prices: { new: 1.1 } });
  assert.ok(Math.abs(s.holdings[0].valueSol - 0.0295) < 1e-12);
  assert.equal(s.holdings[1].valueSol, 0.1);
  assert.equal(s.holdings[1].pnlPct, null);
  assert.equal(s.unpriced, 1);
});

test('desk CSV cells preserve numeric losses and neutralize coin-name formulas', () => {
  assert.equal(csvCell('-0.015000'), '-0.015000');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('a,b'), '"a,b"');
});
