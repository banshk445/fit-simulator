import { readFileSync, readdirSync } from 'node:fs';
const D='public/v3diag/v3-77';
const rows=[];
for (const f of readdirSync(D).filter(f=>f.startsWith('body-')&&f.endsWith('.bin'))) {
  const b=readFileSync(`${D}/${f}`); const v=new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<v.length;i+=3) for(let k=0;k<3;k++){const x=v[i+k]; if(x<mn[k])mn[k]=x; if(x>mx[k])mx[k]=x;}
  rows.push({id:f.slice(5,-4), H:mx[1]-mn[1], W:mx[0]-mn[0], D:mx[2]-mn[2]});
}
rows.sort((a,b)=>a.id.localeCompare(b.id));
for(const r of rows) console.log(`${r.id.padEnd(20)} 높이 ${r.H.toFixed(4)}m  가로(팔스팬) ${r.W.toFixed(4)}m  깊이 ${r.D.toFixed(4)}m`);
const byH={}; for(const r of rows){const h=r.id.match(/h(\d+)/)[1]; (byH[h] ??= []).push(r.H);}
console.log('\n키별 몸 높이 [m] — min~max');
for(const [h,a] of Object.entries(byH)) console.log(`  h${h}: ${Math.min(...a).toFixed(4)} ~ ${Math.max(...a).toFixed(4)}  (상대폭 ${((Math.max(...a)/Math.min(...a)-1)*100).toFixed(3)}%)`);
console.log('\n최대 팔 스팬', Math.max(...rows.map(r=>r.W)).toFixed(4), 'm · 최대 깊이', Math.max(...rows.map(r=>r.D)).toFixed(4),'m');
