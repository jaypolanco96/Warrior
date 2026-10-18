import test from 'node:test';
import assert from 'node:assert/strict';
import { MATURE, SOL, universe } from '../lib/market.mjs';
import { scan } from '../lib/scan.mjs';
import handler from '../api/scan.js';
test('default universe includes mature coverage, deduplicates lists and exposes launch activity', async () => {
  const original = globalThis.fetch, urls = [];
  const pool = { id: SOL, quoteAsset: SOL, chain: 'solana', createdAt: new Date(Date.now() - 86400000).toISOString(), liquidity: 1e6, volume24h: 2e6, baseAsset: { id: MATURE.JUP, symbol: 'JUP', usdPrice: 2, tags: ['major'], stats1h: { buyVolume: 40000, sellVolume: 60000 } } };
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const json = String(url).includes('/charts/') ? { candles: Array.from({ length: 200 }, (_, i) => ({ time: Math.floor(Date.now() / 300000) * 300 - (200 - i) * 300, open: 2, high: 2.1, low: 1.9, close: 2, volume: 1000 })) } : String(url).includes('smart-wallets.json') ? {} : String(url).includes('/gems') ? { recent: { pools: [pool] } } : String(url).includes('datapi.jup.ag') ? { pools: [pool] } : String(url).includes('dexscreener') ? [] : { data: [] };
    return { ok: true, json: async () => json };
  };
  try {
    const all = await universe();
    assert.equal(all.sourcesFailed, 0); assert.equal(all.tokens.length, 1);
    assert.equal(all.tokens[0].mature, true); assert.equal(all.tokens[0].activity.turnoverUsd, 100000);
    assert.ok(urls.some(u => u.includes('dexscreener'))); assert.ok(urls.some(u => u.includes('/gems')));
    const restricted = await universe({ mature: false });
    assert.equal(restricted.tokens.length, 0);
    const result = await scan({ limit: 36, settings: { smartWallets: 0 } });
    assert.equal(result.activity.matureIncluded, true);
    assert.equal(result.results[0].marketType, 'mature');
    assert.equal(result.results[0].analysis.decision, 'wait', 'activity alone must not make a buy');
    assert.equal(result.activity.groups.find(g => g.type === 'mature').selected, 1);
    let body, code;
    const res = { setHeader() {}, status(n) { code = n; return this; }, json(v) { body = v; } };
    await handler({ query: {} }, res);
    assert.equal(code, 200); assert.equal(body.activity.matureIncluded, true);
    globalThis.fetch = async () => { throw new Error('synthetic outage'); };
    const fresh = await import('../lib/market.mjs?outage');
    const outage = await fresh.universe();
    assert.equal(outage.tokens.length, 0); assert.ok(outage.sourcesFailed > 0);
  } finally { globalThis.fetch = original; }
});
