import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPosition } from '../scripts/replay-rules.mjs';
import { resolveRules } from '../lib/presets.mjs';
const settings = { ...resolveRules().settings, holdHours: 1, stepPct: 0 }, BAR=300000;
const bars=(n=14)=>Array.from({length:n},(_,i)=>({t:i*BAR,open:1,high:1.01,low:.99,close:1,volume:10000}));
test('replay buys only after signal; ambiguous stop/target bars use the adverse stop',()=>{
  const data=bars();data[0]={...data[0],high:10,low:.01};
  data[1]={...data[1],high:1.3,low:.7};
  assert.ok(Math.abs(replayPosition(data,0,settings,{cost:0}).pct+20)<1e-9);
  data[1]={...data[1],open:.6,high:.65,low:.4,close:.5};
  const gap=replayPosition(data,0,settings,{cost:0});
  assert.ok(gap.pct<0,'entry uses the next open and subsequent losses remain losses');
});
test('replay charges costs, refuses missing/truncated paths, and uses market-close target fills',()=>{
  const flat=replayPosition(bars(),0,settings,{cost:3}); assert.ok(flat.pct< -2.9);
  assert.equal(replayPosition(bars(3),0,settings),null);
  const gap=bars();gap[3].t+=1;assert.equal(replayPosition(gap,0,settings),null);
  const wick=bars();wick[1].high=1.5;
  const target=replayPosition(wick,0,{...settings,trailing:0},{cost:0});assert.equal(target.reason,'target');assert.equal(target.pct,0,'a wick is not a guaranteed target-price market fill');
});
test('trailing interpretation is independently stressable rather than silently assuming a high-before-low order',()=>{
  const data=bars();data[1]={...data[1],high:1.4,close:1.1};data[2]={...data[2],open:1.3,high:1.32,low:1.2,close:1.2};
  const s={...settings,targetPct:50};
  const prior=replayPosition(data,0,s,{cost:0}), literal=replayPosition(data,0,s,{cost:0,literalTrailing:true});
  assert.ok(prior.closedAt>literal.closedAt);assert.ok(prior.pct>literal.pct);
});
