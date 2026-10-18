// Read-only public-price research. No wallet, private journal, signing or execution APIs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { MATURE, jupiterPoolToToken, uniqueTokens } from '../lib/market.mjs';
import { analyze } from '../lib/strategy.mjs';
import { ema, rsi } from '../lib/indicators.mjs';
import { resolveRules } from '../lib/presets.mjs';
import { positionSize } from '../lib/risk.mjs';
import { replayPosition } from './replay-rules.mjs';
const dir = resolve(process.argv[3] ?? (() => { throw new Error('Pass a research-only output directory'); })());
const H = 3600000, BAR = 300000;
await mkdir(dir, { recursive: true });
let nextRequest = 0;
const pause = ms => new Promise(done => setTimeout(done, ms));
const get = async (url) => {
  for(let attempt=0;attempt<3;attempt++) {
    const slot=Math.max(Date.now(),nextRequest);nextRequest=slot+400;await pause(Math.max(0,slot-Date.now()));
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(r.status===429) {nextRequest=Math.max(nextRequest,Date.now()+30000);if(attempt<2)continue;}
    if(!r.ok)throw new Error(`Public data HTTP ${r.status}`);return r.json();
  }
};
const hash = (s) => createHash('sha256').update(s).digest('hex');
if (['collect','resume','older'].includes(process.argv[2])) {
  const older=process.argv[2]==='older'?JSON.parse(await readFile(resolve(process.argv[4],'manifest.json'),'utf8')):null;
  const prior=process.argv[2]==='resume'?JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8')):null;
  const at = prior?.at ?? (older ? older.at-6000*BAR : Date.now()), lists = prior||older?[]:await Promise.allSettled(['toptraded/24h', 'toptraded/6h', 'toptrending/6h', 'toporganicscore/1h'].map(async path => (await get(`https://datapi.jup.ag/v1/pools/${path}?limit=100`)).pools.map(jupiterPoolToToken)));
  const tokens = uniqueTokens(lists.flatMap(x => x.status === 'fulfilled' ? x.value : []));
  const coins = prior?.coins ?? older?.coins ?? tokens.sort((a,b) => hash(a.mint).localeCompare(hash(b.mint))).slice(0, 112);
  for (const [symbol,mint] of Object.entries(MATURE)) if (!coins.some(c => c.mint === mint)) coins.push({mint,symbol,mature:true});
  const pages=prior?.pages ?? (older ? 3 : 6);
  if(!prior) await writeFile(resolve(dir,'manifest.json'), JSON.stringify({at, coins, pages, discoveryAt: older?.at ?? at, failedLists: lists.filter(x=>x.status==='rejected').length}, null, 2));
  let cursor = 0, done = 0;
  await Promise.all(Array.from({length:2}, async () => {
    for (;;) {
      const coin = coins[cursor++]; if (!coin) break;
      if(prior) {try {const old=JSON.parse(await readFile(resolve(dir,`${coin.mint}.json`),'utf8'));if(!old.errors.length){done++;continue;}} catch { /* resume a missing file */ }}
      const map = new Map(), errors = [];
      for (let page=0; page<pages; page++) {
        try {
          const to = at - page*1000*BAR;
          const j = await get(`https://datapi.jup.ag/v2/charts/${coin.mint}?interval=5_MINUTE&to=${to}&candles=1000&type=price&quote=usd`);
          for (const c of j.candles ?? []) {
            const t=c.time*1000;
            if (t >= to || t+BAR>at || ![t,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low<=0 || c.volume<0 || c.high<Math.max(c.open,c.close) || c.low>Math.min(c.open,c.close)) continue;
            map.set(t,{t,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume});
          }
        } catch(e) { errors.push(e.message); }
      }
      await writeFile(resolve(dir,`${coin.mint}.json`),JSON.stringify({coin,bars:[...map.values()].sort((a,b)=>a.t-b.t),errors}));
      if (++done%10===0) console.log(`Collected ${done}/${coins.length}`);
    }
  }));
  console.log(`Public dataset ready: ${dir}`);
} else if (process.argv[2] === 'run') {
  const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
  const variants = { baseline:{}, clock2:{holdHours:2}, clock4:{holdHours:4}, clock5:{holdHours:5}, step7:{stepPct:7}, step8:{stepPct:8}, rsi30:{dipRsi:30}, depth11:{dipBelowPct:11}, volume50k:{minVol1hUsd:50000}, collapse5:{dipDayDropPct:5}, target15:{targetPct:15}, lossWait8:{lossCooldownMinutes:480} };
  const result={at:manifest.at,coins:manifest.coins.length,baselineCommit:'cbac2a4',literalTrailing:process.env.RESEARCH_LITERAL_TRAILING==='1',variants:{},data:[],model:'Shared-rule signal replay; next-bar open entry, adverse market-close fills, stop first in ambiguous bars; assumed costs; no live return claim'};
  const prepared=[];
  for(const coin of manifest.coins) {
    const data=JSON.parse(await readFile(resolve(dir,`${coin.mint}.json`),'utf8')), bars=data.bars, readings=new Map();
    for(let i=288;i<bars.length-1;i++) {
      const window=bars.slice(i-199,i+1), closes=window.map(c=>c.close), stretch=(closes.at(-1)/ema(closes,20)-1)*100;
      if(bars[i].t-bars[i-288].t!==24*H || stretch> -8 || rsi(closes,14)>35 || window.some((c,k)=>k && c.t-window[k-1].t!==BAR)) continue;
      const a=analyze(window,{...resolveRules({preset:'balanced'}).settings,minVol1hUsd:0,dipBelowPct:8});
      if(a.decision==='enter' && a.style==='dip') readings.set(i,{...a,vol:bars.slice(i-11,i+1).reduce((s,c)=>s+c.volume,0),traded:bars.slice(i-11,i+1).filter(c=>c.volume>0).length,day:(bars[i].close/bars[i-288].close-1)*100});
    }
    prepared.push({coin,bars,readings});
    result.data.push({mint:coin.mint,symbol:coin.symbol,n:bars.length,signals:readings.size,errors:data.errors,first:bars[0]?.t,last:bars.at(-1)?.t});
  }
  for(const preset of ['balanced','spicy','chill']) for(const [name,change] of Object.entries(variants)) for(const cost of [1.5,3]) {
    // Freeze the pre-research clock so rerunning after promotion still compares against the original policy.
    const R=resolveRules({preset}), s={...R.settings,holdHours:preset==='chill'?4:3,...change}, wait=change.lossCooldownMinutes??R.risk.lossCooldownMinutes;
    const trades=[];
    for(const {coin,bars,readings} of prepared) {
      let cooldown=0;
      for(let i=288;i<bars.length-2;i++) {
        const a=readings.get(i), entryBar=bars[i+1];
        if(!a || a.rsi>s.dipRsi || a.stretchPct> -s.dipBelowPct || a.vol<s.minVol1hUsd || a.traded<10 || a.day< -s.dipDayDropPct || entryBar.t<cooldown || entryBar.t-bars[i].t!==BAR) continue;
        if(Number.isFinite(coin.createdAt) && entryBar.t-coin.createdAt<5*H) continue;
        // Warm-up and full maximum-hold runway are mandatory, so truncated winners/losers are not selectively censored.
        if(entryBar.t+6*H>bars.at(-1).t) break;
        const runway=bars.slice(i+1,i+74);
        if(runway.length<73 || runway.some((c,k)=>k && c.t-runway[k-1].t!==BAR)) continue;
        const replay=replayPosition(bars,i,s,{cost,literalTrailing:process.env.RESEARCH_LITERAL_TRAILING==='1'});
        if(!replay) continue;
        const {pct,reason,closedAt:exit,endIndex:j}=replay;
        const split=entryBar.t<manifest.at-10*86400000?'train':'holdout', bucket=parseInt(hash(coin.mint).slice(-2),16)%2;
        trades.push({mint:coin.mint,openedAt:entryBar.t,closedAt:exit,pct,reason,split,bucket});
        cooldown=Math.max(entryBar.t+6*H,exit+(pct<0?wait:R.risk.cooldownMinutes)*60000);i=j;
      }
    }
    const summarize=list=>({n:list.length,mean:list.length?list.reduce((a,t)=>a+t.pct,0)/list.length:0,sum:list.reduce((a,t)=>a+t.pct,0),wins:list.filter(t=>t.pct>0).length,withoutBest2:[...list].sort((a,b)=>b.pct-a.pct).slice(2).reduce((a,t)=>a+t.pct,0)});
    // Capital-constrained sensitivity only: open positions valued at cost, partial proceeds delayed to the final sale.
    let cash=1,dayStart=1,day='',taken=0,skipped=0;const open=[];
    const closeAt=at=>{for(let k=open.length-1;k>=0;k--)if(open[k].closedAt<=at){cash+=open[k].size*(1+open[k].pct/100);open.splice(k,1);}};
    for(const t of [...trades].sort((a,b)=>a.openedAt-b.openedAt||a.mint.localeCompare(b.mint))){closeAt(t.openedAt);const equity=cash+open.reduce((s,p)=>s+p.size,0),today=new Date(t.openedAt).toISOString().slice(0,10);if(today!==day){day=today;dayStart=equity;}
      const sized=positionSize({balanceSol:cash,equitySol:equity,stopPct:s.dipStopPct,openPositions:open.length,dayPnlSol:equity-dayStart},R.risk);
      if(sized.sol>0){cash-=sized.sol;open.push({...t,size:sized.sol});taken++;}else skipped++;
    }closeAt(Infinity);
    result.variants[`${preset}/${name}/${cost}`]={all:summarize(trades),train:summarize(trades.filter(t=>t.split==='train')),holdout:summarize(trades.filter(t=>t.split==='holdout')),a:summarize(trades.filter(t=>t.bucket===0)),b:summarize(trades.filter(t=>t.bucket===1)),portfolioProxy:{endSol:cash,taken,skipped},byMint:Object.fromEntries([...new Set(trades.map(t=>t.mint))].map(mint=>[mint,summarize(trades.filter(t=>t.mint===mint))]))};
  }
  await writeFile(resolve(dir,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.variants,null,2));
} else throw new Error('Use collect, resume, older or run');
