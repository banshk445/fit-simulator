/* v3-57 §2-1 — **사실 수집 전용**. 채널 ② 의 «겹침»이 «상관»인지 «구조적 종속»인지를 값으로 가른다.
 * **판정 0 · 도출 0 · 규칙 변경 0.** 여기서 나온 «비포화 부분집합» 재계산은 **갈래 판정에 쓰지 않는다**
 * (사전 등록된 판별식을 사후에 고쳐 답을 얻는 것이 아니다 — v3-51 §3 · v3-53 §2-1 과 같은 규율).
 * 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3ShoulderSdfDiag.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, THICK } from '../src/v3/consts.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
const R="";
const FAB=process.env.FAB!, D=Number(process.env.D_MM)/1000;
const ab=(b:Buffer)=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;
const P=prepare({glb:ab(readFileSync(R+'public/models/mannequin.glb')),fabric:FABRICS[FAB],d:D,garment:DEFAULT_GARMENT,minPairDistLite,injectState:ab(readFileSync(R+process.env.BLOB!))});
const {sc,prim0,bodyIdx,bodyG,S}=P; const pos=sc.s.pos;
const bd=makeBodyDistance({pos:prim0.pos,idx:bodyIdx,bodyG,h:P.sdfSpec.h,thick:THICK});
const BAND=THICK+2*P.sdfSpec.h;
const g_=(v:number)=>sampleSdf(bodyG,pos[v*3],pos[v*3+1],pos[v*3+2]);
const ex=(v:number)=>bd.exactBodyDist(pos[v*3],pos[v*3+1],pos[v*3+2]);
const sg=(v:number)=>{const g=g_(v);return g>bd.CELL?g:(g<0?-1:1)*ex(v);};
const e_=(v:number)=>{const g=g_(v);return (g<BAND&&g<0?-ex(v):ex(v))-g;};
const yLo=S.Y_TOP-S.CAP_H; const band:number[]=[];
for(let v=0;v<sc.n;v++) if(pos[v*3+1]>=yLo) band.push(v);
const gs=band.map(g_); const maxG=Math.max(...gs);
const sat=gs.filter(x=>x>=maxG-1e-9).length;
const rank=(a:number[])=>{const ix=a.map((_,i)=>i).sort((p,r)=>a[p]-a[r]);const rk=new Array(a.length);ix.forEach((v,r)=>{rk[v]=r;});return rk;};
const rho=(A:number[],B:number[])=>{const ra=rank(A),rb=rank(B),n=A.length,m=(n-1)/2;let nu=0,da=0,db=0;
for(let i=0;i<n;i++){nu+=(ra[i]-m)*(rb[i]-m);da+=(ra[i]-m)**2;db+=(rb[i]-m)**2;}return nu/Math.sqrt(da*db);};
const A=band.map(v=>sg(v)), B=band.map(v=>Math.abs(e_(v)));
console.log(`[진단:${FAB}] 어깨 대역 n ${band.length} · 밴드 ${(BAND*1000).toFixed(3)}mm · sampleSdf 최대 ${(maxG*1000).toFixed(4)}mm · **포화 정점 ${sat} (${(100*sat/band.length).toFixed(1)}%)**`);
console.log(`  순위 상관 ρ(signedGap, |e|) = **${rho(A,B).toFixed(6)}**  ← 1.0 이면 «같은 순서»(항등)`);
// 비포화 부분집합에서 채널 ② 재계산 — 사실 수집 · 판정 미사용
const un=band.filter(v=>g_(v)<maxG-1e-9);
if(un.length>20){const N=un.length,K=Math.max(1,Math.round(N*0.05));
const tg=new Set(un.map(v=>[sg(v),v] as [number,number]).sort((x,y)=>y[0]-x[0]).slice(0,K).map(p=>p[1]));
const te=new Set(un.map(v=>[Math.abs(e_(v)),v] as [number,number]).sort((x,y)=>y[0]-x[0]).slice(0,K).map(p=>p[1]));
let h=0;for(const v of te) if(tg.has(v)) h++;
const hp=[...te].filter(v=>tg.has(v)).map(e_);
console.log(`  **비포화 부분집합**(g < 밴드 상한) n ${N} · 상위 5% ${K}개 ∩ = **${h}** · 기대 ${(K*K/N).toFixed(2)} ⟹ **배율 ${(h/(K*K/N)).toFixed(2)}배** · e>0 ${hp.length?(100*hp.filter(x=>x>0).length/hp.length).toFixed(1):'—'}%`);
console.log(`  (비포화에서) ρ(signedGap, |e|) = ${rho(un.map(sg),un.map(v=>Math.abs(e_(v)))).toFixed(4)}`);}
