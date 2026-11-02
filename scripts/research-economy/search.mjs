// Train + validation ONLY. The last 19 days are never touched here.
import {load,trades,stat,D,H} from './lib.mjs';import {writeFileSync} from 'node:fs';
const ALL=load();const SOLM='So11111111111111111111111111111111111111112';const solP=ALL.find(p=>p.coin.mint===SOLM);const PS=ALL.filter(p=>p.coin.mint!==SOLM);
const END=Math.max(...solP.t);const HOLD=END-19*D,VAL=END-38*D;
// cross-section features by timestamp, using only values known at that bar
const byT=new Map();for(const P of PS)for(let i=672;i<P.n;i++){const f=P.f[i];if(!f)continue;let a=byT.get(P.t[i]);if(!a)byT.set(P.t[i],a=[]);a.push(f)}
for(const a of byT.values()){const up=a.filter(f=>f.h4up).length/a.length;a.sort((x,y)=>x.ret7d-y.ret7d);a.forEach((f,k)=>{f.breadth=up;f.rs=k/(a.length-1||1)})}
const solAt=new Map();for(let i=672;i<solP.n;i++)if(solP.f[i])solAt.set(solP.t[i],solP.f[i]);for(const P of PS)for(let i=672;i<P.n;i++){const f=P.f[i];if(!f)continue;const s=solAt.get(P.t[i]);f.solUp=!!s?.h4up;f.solH1=!!s?.h1up;f.solRsi=s?.h4rsi??50}
console.log('coins',PS.length,'train to',new Date(VAL).toISOString(),'val to',new Date(HOLD).toISOString());
const reg={any:()=>true,solUp:f=>f.solUp,breadth50:f=>f.breadth>=.5,breadth35:f=>f.breadth>=.35,coinH4:f=>f.h4up,solUpCoinH4:f=>f.solUp&&f.h4up};
const E={};
for(const r of [25,30,35,40])for(const s of [4,6,8,10,14])E[`dip r${r} s${s}`]=f=>f.rsi<=r&&f.stretch<=-s&&f.ret24h>-25;
for(const r of [30,35,40])for(const z of [2,2.5])E[`bbdip r${r} z${z}`]=f=>f.rsi<=r&&f.z<=-z&&f.ret24h>-25;
for(const v of [2,3,5])for(const s of [4,6,8])E[`capit v${v} s${s}`]=f=>f.volRatio>=v&&f.stretch<=-s&&f.rsi<=35;
for(const r of [30,35])E[`reclaim r${r}`]=f=>f.prsi<r&&f.rsi>=r&&f.green&&f.stretch<-1;
for(const r of [35,40,45,50])E[`pullback r${r}`]=f=>f.h1up&&f.h4trend&&f.rsi<=r&&f.stretch<=-1;
for(const r of [35,40,45])E[`pullturn r${r}`]=f=>f.h1up&&f.h4trend&&f.prsi<=r&&f.macdUp&&f.green;
for(const v of [1.5,2,3])for(const cap of [70,80])E[`break v${v} r${cap}`]=f=>f.c>f.hh&&f.volRatio>=v&&f.rsi<=cap&&f.h4trend;
for(const q of [.7,.8,.9])for(const r of [40,50])E[`rs q${q} r${r}`]=f=>f.rs>=q&&f.h4up&&f.rsi<=r&&f.stretch<0;
for(const q of [.7,.8,.9])E[`rsbreak q${q}`]=f=>f.rs>=q&&f.c>f.hh&&f.volRatio>=1.5;
for(const q of [.1,.2])E[`laggard q${q}`]=f=>f.rs<=q&&f.macdCross&&f.h1rsi<40;
E['macd h1up']=f=>f.macdCross&&f.h1up&&f.up15;E['macd h4rsi']=f=>f.macdCross&&f.h4rsi>50&&f.rsi<60;
E['h4 oversold turn']=f=>f.h4rsi<=35&&f.macdCross;E['h1 oversold turn']=f=>f.h1rsi<=30&&f.green&&f.macdUp;
const floor=(mc,v24)=>f=>f.mc>=mc&&f.vol24h>=v24&&f.vol1h>=2e4/4;
const sigs=(fn)=>PS.map(P=>{const a=new Uint8Array(P.n);for(let i=672;i<P.n;i++){const f=P.f[i];if(f&&fn(f))a[i]=1}return a});
const run=(sg,x,cost=.015,from=0,to=HOLD)=>PS.flatMap((P,k)=>trades(P,(_,i)=>sg[k][i],x,cost,from,to));
const judge=(sg,x)=>{const all=run(sg,x),tr=all.filter(t=>t.o<VAL),va=all.filter(t=>t.o>=VAL);return{tr:stat(tr),va:stat(va),all:stat(all)}};
const BX=[{stop:8,target:12,step:0,hold:12},{stop:10,target:20,step:6,hold:24},{stop:15,target:30,step:0,hold:48}];
// market control: random-ish entry once a day on every coin, same floor
const ctrl=sigs(f=>floor(10e6,25e4)(f));const everyDay=PS.map((P,k)=>ctrl[k].map((v,i)=>v&&i%96===0?1:0));
console.log('CONTROL daily entry (mc>=10M):');for(const x of BX)console.log(JSON.stringify(x),JSON.stringify(judge(everyDay,x)));
const score=j=>j.tr.n>=30&&j.va.n>=30?Math.min(j.tr.mean,j.va.mean):-99;
const st1=[];for(const [en,fn] of Object.entries(E))for(const [rn,rf] of Object.entries(reg)){const fl=floor(10e6,25e4),sg=sigs(f=>fl(f)&&rf(f)&&fn(f));for(const x of BX){const j=judge(sg,x);st1.push({en,rn,x,...j,s:score(j)})}}
st1.sort((a,b)=>b.s-a.s);writeFileSync('st1.json',JSON.stringify(st1));console.log('stage1 rows',st1.length,'with both n>=30',st1.filter(r=>r.s>-99).length,'both>0',st1.filter(r=>r.s>0).length);
for(const r of st1.slice(0,20))console.log(r.s,r.en,'|',r.rn,JSON.stringify(r.x),'T',JSON.stringify(r.tr),'V',JSON.stringify(r.va));
// stage 2 exit grid on the best distinct entries
const seen=new Set(),top=[];for(const r of st1){const k=r.en+r.rn;if(!seen.has(k)&&r.s>-99){seen.add(k);top.push(r)}if(top.length>=15)break}
const st2=[];for(const r of top){const sg=sigs(f=>floor(10e6,25e4)(f)&&reg[r.rn](f)&&E[r.en](f));for(const stop of [6,8,10,15,20])for(const target of [8,12,20,30,50])for(const step of [0,4,6])for(const hold of [6,12,24,48,96]){if(step&&step*2>=target)continue;const x={stop,target,step,hold},j=judge(sg,x);st2.push({en:r.en,rn:r.rn,x,...j,s:score(j)})}}
st2.sort((a,b)=>b.s-a.s);writeFileSync('st2.json',JSON.stringify(st2));console.log('stage2 rows',st2.length,'both>0',st2.filter(r=>r.s>0).length);
for(const r of st2.slice(0,15))console.log(r.s,r.en,'|',r.rn,JSON.stringify(r.x),'T',JSON.stringify(r.tr),'V',JSON.stringify(r.va));
// stage 3 market-cap and volume floors for the top 6 distinct
const sn=new Set(),t3=[];for(const r of st2){const k=r.en+r.rn;if(!sn.has(k)){sn.add(k);t3.push(r)}if(t3.length>=6)break}
const st3=[];for(const r of t3)for(const mc of [1e6,5e6,10e6,25e6,50e6,100e6])for(const v of [1e5,25e4,1e6]){const sg=sigs(f=>floor(mc,v)(f)&&reg[r.rn](f)&&E[r.en](f)),j=judge(sg,r.x);st3.push({en:r.en,rn:r.rn,x:r.x,mc,v,...j,s:score(j)})}
st3.sort((a,b)=>b.s-a.s);writeFileSync('st3.json',JSON.stringify(st3));console.log('STAGE3');for(const r of st3.slice(0,25))console.log(r.s,r.en,'|',r.rn,'mc',r.mc/1e6,'v',r.v/1e3,JSON.stringify(r.x),'T',JSON.stringify(r.tr),'V',JSON.stringify(r.va));
console.log('finished',new Date().toISOString());
