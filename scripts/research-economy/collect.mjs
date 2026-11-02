// Read-only public prices. Locked universe: Jupiter verified, mcap>=1M, liquidity>=50k, not stable/LST/yield/stock/RWA/commodity/wrapped.
import {writeFileSync,existsSync,mkdirSync} from 'node:fs';
mkdirSync('c',{recursive:true});
const NO=new Set(['stable','lst','original-lst','yield','yb','jup-lend-earn','stocks','xstocks','rwa','equities','prestocks','ondo','pre-ipo','commodities','tessera','backpack','duplicate','internal']);
const list=await (await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified')).json();
const wrapped=/^(w|cb|x|t|so)?(btc|eth|sat)$|^(zec|xrp|doge|ltc|bnb|sui|ada|hype)$|sol$/i;
const u=list.filter(t=>t.mcap>=1e6&&t.liquidity>=5e4&&!(t.tags||[]).some(g=>NO.has(g))&&!wrapped.test(t.symbol)&&t.organicScore>=0&&t.stats24h).sort((a,b)=>b.mcap-a.mcap);
const SOL='So11111111111111111111111111111111111111112';const sol=list.find(t=>t.id===SOL);
const coins=[sol,...u].map(t=>({mint:t.id,symbol:t.symbol,mcap:t.mcap,circ:t.circSupply,liq:t.liquidity,tags:t.tags,holders:t.holderCount,organic:t.organicScore,created:Date.parse(t.firstPool?.createdAt??t.createdAt)||null}));
writeFileSync('universe.json',JSON.stringify(coins));console.log('universe',coins.length);
const at=Date.now(),BAR=9e5,PAGES=9;let next=0,refused=0,done=0,i=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const get=async u=>{for(let k=0;k<3;k++){const s=Math.max(Date.now(),next);next=s+120;await pause(s-Date.now());try{const r=await fetch(u,{signal:AbortSignal.timeout(15000)});if(r.status===429){refused++;next=Date.now()+15000;continue}if(r.ok)return r.json()}catch{}}return null};
await Promise.all(Array.from({length:4},async()=>{for(;;){const c=coins[i++];if(!c)return;const f=`c/${c.mint}.json`;if(existsSync(f)){done++;continue}
const m=new Map();for(let p=0;p<PAGES;p++){const to=at-p*1000*BAR;const j=await get(`https://datapi.jup.ag/v2/charts/${c.mint}?interval=15_MINUTE&to=${to}&candles=1000&type=price&quote=usd`);const l=j?.candles||[];for(const b of l){const t=b.time*1000;if(t+BAR<=at&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)&&b.low>0)m.set(t,[t,b.open,b.high,b.low,b.close,b.volume])}if(l.length<1000)break}
writeFileSync(f,JSON.stringify([...m.values()].sort((a,b)=>a[0]-b[0])));if(++done%25===0)console.log(done,'/',coins.length,'refused',refused,new Date().toISOString())}}));
console.log('DONE',done,'refused',refused);
