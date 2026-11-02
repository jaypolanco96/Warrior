import {readFileSync} from 'node:fs';
export const BAR=9e5,H=36e5,D=864e5;
const ema=(a,p)=>{const k=2/(p+1),o=new Float64Array(a.length);let e=a[0];for(let i=0;i<a.length;i++){e=i?a[i]*k+e*(1-k):a[0];o[i]=e}return o};
const rsiS=(c,p=14)=>{const o=new Float64Array(c.length).fill(50);let g=0,l=0;for(let i=1;i<c.length;i++){const d=c[i]-c[i-1],u=Math.max(d,0),v=Math.max(-d,0);if(i<=p){g+=u/p;l+=v/p}else{g=(g*(p-1)+u)/p;l=(l*(p-1)+v)/p}if(i>=p)o[i]=l===0?100:100-100/(1+g/l)}return o};
// Higher timeframe aligned so bar i only sees the last COMPLETED higher bar.
function htf(t,o,h,l,c,v,size){const T=[],C=[],idx=new Int32Array(t.length).fill(-1);let cur=null;for(let i=0;i<t.length;i++){const b=Math.floor(t[i]/size)*size;if(b!==cur){if(cur!==null)T.push(cur);cur=b;C.push(c[i])}else C[C.length-1]=c[i];idx[i]=C.length-2}return{C,idx}}
export function prepare(coin,rows){const n=rows.length,t=rows.map(r=>r[0]),O=rows.map(r=>r[1]),Hi=rows.map(r=>r[2]),L=rows.map(r=>r[3]),C=rows.map(r=>r[4]),V=rows.map(r=>r[5]);
 const e20=ema(C,20),e50=ema(C,50),e200=ema(C,200),r=rsiS(C),m12=ema(C,12),m26=ema(C,26),md=C.map((_,i)=>m12[i]-m26[i]),sg=ema(md,9);
 const h1=htf(t,O,Hi,L,C,V,H),h4=htf(t,O,Hi,L,C,V,4*H);const h1e20=ema(h1.C,20),h1e50=ema(h1.C,50),h1r=rsiS(h1.C),h4e20=ema(h4.C,20),h4e50=ema(h4.C,50),h4r=rsiS(h4.C);
 const pre=new Float64Array(n+1),pv=new Float64Array(n+1),ps=new Float64Array(n+1);for(let i=0;i<n;i++){pre[i+1]=pre[i]+C[i];ps[i+1]=ps[i]+C[i]*C[i];pv[i+1]=pv[i]+V[i]}
 const sum=(p,a,b)=>p[b]-p[a];
 const f=new Array(n);for(let i=0;i<n;i++){if(i<672){f[i]=null;continue}
  // continuity: 7 days must span close to 672 bars or the coin trades too thinly to read
  const span=(t[i]-t[i-672])/BAR;const sma=sum(pre,i-19,i+1)/20,sd=Math.sqrt(Math.max(0,sum(ps,i-19,i+1)/20-sma*sma));let tr=0;for(let k=i-13;k<=i;k++)tr+=Math.max(Hi[k]-L[k],Math.abs(Hi[k]-C[k-1]),Math.abs(L[k]-C[k-1]));
  let hh=0;for(let k=i-80;k<i;k++)hh=Math.max(hh,Hi[k]);let ll=1e99;for(let k=i-16;k<i;k++)ll=Math.min(ll,L[k]);
  const a=h1.idx[i],b=h4.idx[i];f[i]={ok:span<=700,c:C[i],stretch:(C[i]/e20[i]-1)*100,rsi:r[i],prsi:r[i-1],z:sd>0?(C[i]-sma)/sd:0,atrPct:tr/14/C[i]*100,volRatio:(sum(pv,i-20,i)/20)>0?V[i]/(sum(pv,i-20,i)/20):0,vol1h:sum(pv,i-3,i+1),vol24h:sum(pv,i-95,i+1),ret1h:(C[i]/C[i-4]-1)*100,ret24h:(C[i]/C[i-96]-1)*100,ret7d:(C[i]/C[i-672]-1)*100,up15:C[i]>e50[i]&&e20[i]>e50[i],above200:C[i]>e200[i],h1up:a>=50&&h1.C[a]>h1e50[a]&&h1e20[a]>h1e50[a],h1rsi:a>=0?h1r[a]:50,h4up:b>=50&&h4.C[b]>h4e50[b],h4trend:b>=50&&h4e20[b]>h4e50[b],h4rsi:b>=0?h4r[b]:50,macdUp:md[i]-sg[i]>md[i-1]-sg[i-1],macdCross:md[i]>sg[i]&&md[i-1]<=sg[i-1],green:C[i]>O[i],hh,ll,mc:coin.circ>0?C[i]*coin.circ:null,e20:e20[i]}}
 return{coin,n,t,O,Hi,L,C,V,f}}
export function load(){const U=JSON.parse(readFileSync('universe.json'));const out=[];for(const c of U){let r;try{r=JSON.parse(readFileSync(`c/${c.mint}.json`))}catch{continue}if(r.length>800)out.push(prepare(c,r))}return out}
const hash=s=>{let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))>>>0;return h};
export const bucket=m=>hash(m)%2;
// sim: signal(f,i,P)->bool; exit {stop,target,step,hold}; cost fraction round trip. Returns gross fills so cost can vary.
export function trades(P,signal,x,cost,from=0,to=Infinity){const out=[],{t,O,Hi,L,C,f,n}=P,end=t[n-1],holdMs=x.hold*H;let wait=0;
 for(let i=672;i<n-1;i++){if(t[i+1]<wait)continue;const fi=f[i];if(!fi?.ok||t[i+1]-t[i]!==BAR||t[i+1]<from||t[i+1]>=to)continue;if(!signal(fi,i,P))continue;if(t[i+1]+holdMs>end)break;
  const px=O[i+1],entry=px*(1+cost/2),stop=entry*(1-x.stop/100),tgt=entry*(1+x.target/100),s1=x.step?entry*(1+x.step/100):0,s2=x.step?entry*(1+2*x.step/100):0;let left=1,got=0,st=0,j=i+1,why='time';
  for(;j<n;j++){if(L[j]<=stop){got+=left*Math.min(stop,O[j]);left=0;why='stop';break}
   if(s1&&st===0&&Hi[j]>=s1){got+=s1/3;left-=1/3;st=1}if(s1&&st===1&&Hi[j]>=s2){got+=s2/3;left-=1/3;st=2}
   if(Hi[j]>=tgt){got+=left*tgt;left=0;why='target';break}
   if(t[j]+BAR-t[i+1]>=holdMs){got+=left*C[j];left=0;break}}
  if(left>0)continue;const pct=(got*(1-cost/2)/entry-1)*100;out.push({m:P.coin.mint,sym:P.coin.symbol,o:t[i+1],c:t[Math.min(j,n-1)]+BAR,pct,why,b:bucket(P.coin.mint)});wait=Math.max(t[i+1]+6*H,t[Math.min(j,n-1)]+(pct<0?6*H:.5*H));i=j}return out}
export const stat=l=>{const n=l.length;if(!n)return{n:0,mean:0,med:0,win:0,pf:0,xb2:0,coins:0};const a=l.map(x=>x.pct).sort((p,q)=>p-q),s=a.reduce((p,q)=>p+q,0),g=a.filter(x=>x>0).reduce((p,q)=>p+q,0),b=-a.filter(x=>x<0).reduce((p,q)=>p+q,0);const x=a.slice(0,Math.max(0,n-2));return{n,mean:+(s/n).toFixed(2),med:+a[n>>1].toFixed(2),win:+(a.filter(v=>v>0).length/n*100).toFixed(0),pf:+(b?g/b:99).toFixed(2),xb2:+(x.length?x.reduce((p,q)=>p+q,0)/x.length:0).toFixed(2),coins:new Set(l.map(t=>t.m)).size}};
