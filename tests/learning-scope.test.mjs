import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptationBook, learningSample } from '../lib/adapt.mjs';
import { resolveRules } from '../lib/presets.mjs';
import { manage } from '../lib/strategy.mjs';
test('the promoted four-hour clock waits past three hours without relaxing its stop', () => {
  for (const preset of ['balanced','spicy','chill']) {
    const rules=resolveRules({preset}), candles=Array.from({length:49},(_,i)=>({t:i*300000,open:1,high:1.01,low:.99,close:1,volume:1000}));
    const p={entry:1,stop:.8,baseStop:.8,target:1.2,entryBar:0,openedAt:0,dip:1};
    assert.equal(rules.settings.holdHours,4); assert.equal(rules.settings.maxHoldBars,48);
    assert.equal(manage(p,candles.slice(0,37),rules.settings).action,'hold');
    assert.equal(manage(p,candles,rules.settings).reason,'time');
    candles.at(-1).low=.7;assert.equal(manage(p,candles,rules.settings).reason,'stop');
  }
});
test('practice dials, probation, proposals and locks cannot govern live learning', () => {
  const state = { mode: 'paper', preset: 'balanced' }, paper = adaptationBook(state);
  paper.dials.holdHours = 5; paper.probation = { key: 'holdHours', at: 100 }; paper.locked.targetPct = 500; paper.proposal = { key: 'targetPct' };
  state.mode = 'live'; const live = adaptationBook(state);
  assert.deepEqual(live.dials, {}); assert.equal(live.probation, null); assert.deepEqual(live.locked, {}); assert.equal(live.proposal, null);
  live.dials.targetPct = 15;
  state.mode = 'paper'; assert.equal(adaptationBook(state), paper); assert.deepEqual(paper.dials, {holdHours:5});
  assert.deepEqual(adaptationBook(state,'chill').dials, {});
});
test('legacy unscoped decisions are archived, never guessed to belong to live or practice', () => {
  const legacy = { dials: {holdHours:5}, history:[{kind:'change',key:'holdHours',to:5}], probation:{at:1} };
  const state = {mode:'live',preset:'balanced',adapt:{mode:'suggest',balanced:legacy}}, book=adaptationBook(state);
  assert.equal(state.adapt.balanced,legacy); assert.equal(state.adapt.mode,'suggest');
  assert.deepEqual(book.dials,{}); assert.equal(book.probation,null); assert.equal(book.archivedUnscoped,true);
  assert.equal(book.history[0].legacy,true); assert.equal(legacy.history[0].legacy,undefined);
  assert.equal(adaptationBook(state),book,'initialization is idempotent');
});
test('only recent, attributable observations under the active rules can move dials', () => {
  const scope={mode:'live',preset:'balanced',rules:'balanced-current',since:100};
  const record={...scope,at:150}; assert.equal(learningSample(record,scope),true);
  for(const change of [{mode:'paper'},{preset:'spicy'},{rules:'balanced-old'},{rules:undefined},{at:99},{at:NaN}]) assert.equal(learningSample({...record,...change},scope),false);
});
