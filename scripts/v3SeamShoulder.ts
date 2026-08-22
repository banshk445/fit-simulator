/* v3-44 — (가) 어깨 상승 · (나) 시접선 끊김의 «원인 정량». **수정 0 · 물리 0프레임.**
 *
 * 대역 정의는 전부 «등재량»에서 온다 — 새 수를 고르지 않는다.
 *   어깨 대역 = 몸 y ≥ Y_TOP − CAP_H  (Y_TOP = 어깨 능선 · CAP_H = 소매산 높이 · 둘 다 등재)
 *   민감도로 y ≥ Y_TOP − ARM_D (암홀 깊이) 도 함께 낸다
 *   시접 대역(픽셀) = 투영 시접 정점에서 «해상도 d» 이내 — d 도 등재량이다
 *
 * 픽셀 분류·실루엣은 v3-42 M 계기의 것을 그대로 쓴다(기저색 최소제곱 역산).
 * 「실루엣 «내부»」는 **윤곽 안쪽**으로 읽는다 — 배경에서 채우기로 바깥을 지우고 남은 영역.
 * 그래야 «갭이 배경까지 뚫고 보이는» 끊김이 채널에 잡힌다.
 *
 * 진입: `IN=<blob> FAB=<원단> D_MM=<d> npx tsx scripts/v3SeamShoulder.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { FABRICS, THICK, SEP } from '../src/v3/consts.ts';
import { render, VIEWS, type View } from '../src/v3/raster.ts';
import { seamBridgeIndices, bridgeStripCount, withBridge } from '../src/v3/seamBridge.ts';

const IN = process.env.IN!, FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

const P = prepare({ glb: ab('public/models/mannequin.glb'), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(IN) });
const { S, sc } = P;
const pos = sc.s.pos;
const clothPos = Float32Array.from(pos);
const clothIdx = Uint32Array.from(sc.tris);
/* v3-45 ㉢ — **표시 전용**. `BRIDGE=1` 일 때만 «렌더에 넘기는» 인덱스에 이어 붙인다.
 * `sc.tris` · 제약 · 상태는 한 바이트도 안 바뀐다(솔버·게이트 경로 유입 0). */
const BRIDGE_ON = process.env.BRIDGE === '1';
const bridgeIdx = seamBridgeIndices(sc.seams);
const drawIdx = BRIDGE_ON ? withBridge(clothIdx, bridgeIdx) : clothIdx;
const bodyPos = Float32Array.from(P.prim0.pos);
const bodyIdx = P.bodyIdx;
const cm = (v: number) => (v * 100).toFixed(2);
const mm = (v: number) => (v * 1000).toFixed(2);
const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))];

console.log(`[SEAM/SHOULDER:${FAB}-d${process.env.D_MM}] ${IN} · 정점 ${sc.n} · 물리 0프레임`);
console.log(`  등재량[cm]  Y_TOP ${cm(S.Y_TOP)} · Y_NECK ${cm(S.Y_NECK)} · CAP_H ${cm(S.CAP_H)} · ARM_D ${cm(S.ARM_D)} · SEP ${mm(SEP)}mm`);

/* ══ ㉠1 시접 갭 기하 ═══════════════════════════════════════════════════════ */
const seg = (i: number, j: number) => Math.hypot(pos[i*3]-pos[j*3], pos[i*3+1]-pos[j*3+1], pos[i*3+2]-pos[j*3+2]);
console.log(`  ── ㉠1 시접 갭[mm] · rest = SEP = ${mm(SEP)}mm ──`);
console.log(`     ${'시접'.padEnd(8)} ${'쌍'.padStart(4)}  중앙   p90    최대   최소 | 구간별 중앙(시작→끝 5분할)`);
const seamAll: number[] = [];
for (const sm of sc.seams) {
  const g = sm.a.map((_, k) => seg(sm.a[k], sm.b[k]));
  seamAll.push(...g);
  const srt = [...g].sort((x, y) => x - y);
  const bins = Array.from({ length: 5 }, (_, b) => {
    const s0 = Math.floor((b * g.length) / 5), s1 = Math.max(s0 + 1, Math.floor(((b + 1) * g.length) / 5));
    const w = g.slice(s0, s1).sort((x, y) => x - y);
    return mm(q(w, .5));
  });
  console.log(`     ${sm.name.padEnd(8)} ${String(g.length).padStart(4)}  ${mm(q(srt,.5))}  ${mm(q(srt,.9))}  ${mm(q(srt,1))}  ${mm(q(srt,0))} | ${bins.join(' ')}`);
}
{ const s = [...seamAll].sort((a, b) => a - b);
  console.log(`     ${'전체'.padEnd(8)} ${String(s.length).padStart(4)}  ${mm(q(s,.5))}  ${mm(q(s,.9))}  ${mm(q(s,1))}  ${mm(q(s,0))}   (rest 대비 중앙 ${(q(s,.5)/SEP).toFixed(3)}배)`); }

/* ══ ㉡3 패턴 이즈 — 소매산 vs 암홀 ════════════════════════════════════════ */
console.log(`  ── ㉡3 패턴 이즈 ──`);
console.log(`     연속 곡선[cm]  암홀 LEN_ARM ${cm(S.LEN_ARM)} · 소매산 LEN_CAP ${cm(S.LEN_CAP)} (반쪽 ${cm(S.LEN_CAP/2)})`);
console.log(`     이즈 = 소매산 반쪽 − 암홀 = ${cm(S.LEN_CAP/2 - S.LEN_ARM)}cm = ${((S.LEN_CAP/2/S.LEN_ARM - 1)*100).toFixed(4)}%`);
{ /* 이산(휴지 좌표) 길이 — 실제로 봉제되는 폴리라인이다 */
  const uv = sc.uv;
  const plen = (ids: number[]) => ids.slice(1).reduce((s, v, k) =>
    s + Math.hypot(uv[v*2]-uv[ids[k]*2], uv[v*2+1]-uv[ids[k]*2+1]), 0);
  console.log(`     이산 휴지 길이[cm] · 시접 양변 (a=몸판/앞뒤 · b=소매)`);
  for (const sm of sc.seams) {
    const la = plen(sm.a), lb = plen(sm.b);
    console.log(`       ${sm.name.padEnd(8)} a ${cm(la)}  b ${cm(lb)}  차 ${cm(lb-la)}cm (${la>0?((lb/la-1)*100).toFixed(3):'—'}%)`);
  }
}

/* ══ ㉡1 어깨 상승고 ═══════════════════════════════════════════════════════ */
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const signedGap = (v: number) => {
  const x = pos[v*3], y = pos[v*3+1], z = pos[v*3+2];
  const g = sampleSdf(P.bodyG, x, y, z);
  return g > bd.CELL ? g : (g < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z);
};
/** 정점 → {패널, i, j} — 패널 base/nu 로 «역산»한다 */
const panelOf = (v: number) => {
  for (const p of sc.panels) {
    const cnt = (p.nu + 1) * (p.nv + 1);
    if (v >= p.base && v < p.base + cnt) {
      const r = v - p.base;
      return { name: p.name, i: r % (p.nu + 1), j: Math.floor(r / (p.nu + 1)), nu: p.nu, nv: p.nv };
    }
  }
  return { name: '?', i: -1, j: -1, nu: 0, nv: 0 };
};
/* ㉡1a — 사용자 지적문 「어깨 능선 «위»로 솟음」의 «직접» 채널.
 * 대역이 아니라 **문턱 y = Y_TOP(어깨 능선 · 등재량)** 하나로 가른다. */
{
  const above: number[] = [];
  for (let v = 0; v < sc.n; v++) if (pos[v*3+1] > S.Y_TOP) above.push(v);
  const h = above.map((v) => pos[v*3+1] - S.Y_TOP).sort((a, b) => a - b);
  console.log(`  ── ㉡1a 어깨 능선 «위»(y > Y_TOP = ${cm(S.Y_TOP)}cm) 옷 정점: **${above.length} / ${sc.n}** (${(100*above.length/sc.n).toFixed(2)}%) ──`);
  if (above.length) {
    console.log(`     능선 위 높이[mm]  중앙 ${mm(q(h,.5))} · p90 ${mm(q(h,.9))} · **최대 ${mm(q(h,1))}**`);
    const byP = new Map<string, number>();
    for (const v of above) { const p = panelOf(v); byP.set(p.name, (byP.get(p.name) ?? 0) + 1); }
    console.log(`     패널별  ${[...byP].sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} ${c} (${(100*c/above.length).toFixed(0)}%)`).join(' · ')}`);
    const gp = above.map(signedGap).sort((a,b)=>a-b);
    console.log(`     그 정점들의 몸 법선 이격[mm]  중앙 ${mm(q(gp,.5))} · 최대 ${mm(q(gp,1))}`);
    /* 목선 링 정점은 «능선 위»가 정상이다(목을 두르므로) — 분리해 낸다 */
    const neckSet = new Set([...P.neckF, ...P.neckB]);
    const nonNeck = above.filter((v) => !neckSet.has(v));
    const hn = nonNeck.map((v) => pos[v*3+1] - S.Y_TOP).sort((a,b)=>a-b);
    console.log(`     목선 링 제외  ${nonNeck.length}개 · 중앙 ${hn.length?mm(q(hn,.5)):'—'} · 최대 ${hn.length?mm(q(hn,1)):'—'}mm`);
    if (nonNeck.length) {
      const byQ = new Map<string, number>();
      for (const v of nonNeck) { const p = panelOf(v); byQ.set(p.name, (byQ.get(p.name) ?? 0) + 1); }
      console.log(`     목선 제외 패널별  ${[...byQ].sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} ${c} (${(100*c/nonNeck.length).toFixed(0)}%)`).join(' · ')}`);
    }
  }
}
for (const [tag, yLo] of [['CAP_H', S.Y_TOP - S.CAP_H], ['ARM_D(민감도)', S.Y_TOP - S.ARM_D]] as const) {
  const band: number[] = [];
  for (let v = 0; v < sc.n; v++) if (pos[v*3+1] >= yLo) band.push(v);
  const gaps = band.map(signedGap);
  const srt = [...gaps].sort((a, b) => a - b);
  console.log(`  ── ㉡1 어깨 대역(y ≥ Y_TOP−${tag} = ${cm(yLo)}cm): 정점 ${band.length} · 몸 법선 이격[mm] ──`);
  console.log(`     중앙 ${mm(q(srt,.5))} · p90 ${mm(q(srt,.9))} · p99 ${mm(q(srt,.99))} · **최대 ${mm(q(srt,1))}** · 최소 ${mm(q(srt,0))}`);
  if (tag !== 'CAP_H') continue;
  /* 패널별 — 「소매산 대역이 솟는가」의 직접 대조 */
  { const byP = new Map<string, number[]>();
    band.forEach((v, k) => { const nm = panelOf(v).name; (byP.get(nm) ?? byP.set(nm, []).get(nm)!).push(gaps[k]); });
    console.log(`     패널별 이격[mm]  ${[...byP].map(([k, a]) => { a.sort((x,y)=>x-y);
      return `${k} n${a.length} 중앙 ${mm(q(a,.5))} p90 ${mm(q(a,.9))} 최대 ${mm(q(a,1))}`; }).join('\n                       ')}`);
  }
  /* 높이별 프로파일 — 문턱을 고르지 않고 «어디»가 뜨는지 본다(6구간은 표시 분할일 뿐) */
  { const NB = 6, rows: string[] = [];
    for (let b = 0; b < NB; b++) {
      const y0 = yLo + ((S.Y_TOP - yLo) * b) / NB, y1 = yLo + ((S.Y_TOP - yLo) * (b + 1)) / NB;
      const a: number[] = [];
      band.forEach((v, k) => { const y = pos[v*3+1]; if (y >= y0 && y < y1) a.push(gaps[k]); });
      a.sort((x, y) => x - y);
      rows.push(`${cm(y0)}~${cm(y1)}cm n${String(a.length).padStart(4)} 중앙 ${a.length?mm(q(a,.5)):'—'} p95 ${a.length?mm(q(a,.95)):'—'} 최대 ${a.length?mm(q(a,1)):'—'}`);
    }
    console.log(`     높이별 이격[mm]  ${rows.join('\n                       ')}`);
  }
  /* ㉡2 소속 — 상승 상위 5% */
  const ord = band.map((v, k) => [gaps[k], v] as [number, number]).sort((a, b) => b[0] - a[0]);
  const top = ord.slice(0, Math.max(1, Math.round(ord.length * 0.05)));
  const byPanel = new Map<string, number>();
  for (const [, v] of top) { const p = panelOf(v); byPanel.set(p.name, (byPanel.get(p.name) ?? 0) + 1); }
  console.log(`  ── ㉡2 소속: 상승 상위 5% (${top.length}개 · 이격 ${mm(top[top.length-1][0])}~${mm(top[0][0])}mm) ──`);
  console.log(`     패널별  ${[...byPanel].sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} ${c} (${(100*c/top.length).toFixed(0)}%)`).join(' · ')}`);
  const p0 = panelOf(top[0][1]);
  console.log(`     최대점  ${p0.name} (i ${p0.i}/${p0.nu}, j ${p0.j}/${p0.nv}) · 이격 ${mm(top[0][0])}mm · y ${cm(pos[top[0][1]*3+1])}cm`);
  const rows = new Map<string, number[]>();
  for (const [, v] of top) { const p = panelOf(v); const key = p.name; (rows.get(key) ?? rows.set(key, []).get(key)!).push(p.j); }
  for (const [k, js] of rows) { js.sort((a,b)=>a-b);
    console.log(`     ${k.padEnd(8)} j(행) 범위 ${js[0]}~${js[js.length-1]} · 중앙 ${q(js,.5)} (nv ${panelOf(sc.panels.find(p=>p.name===k)!.base).nv})`); }

  /* ㉡4 시접 연동 — 시접 정점에서 격자 ±2열 안인가 */
  const seamOf = new Map<number, string>();
  for (const sm of sc.seams) for (const v of [...sm.a, ...sm.b]) seamOf.set(v, sm.name);
  const near = new Set<number>();
  for (const v of seamOf.keys()) {
    const p = panelOf(v);
    const pan = sc.panels.find((z) => z.name === p.name)!;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const i = p.i + di, j = p.j + dj;
      if (i < 0 || j < 0 || i > pan.nu || j > pan.nv) continue;
      near.add(pan.base + j * (pan.nu + 1) + i);
    }
  }
  const inBand = top.filter(([, v]) => near.has(v)).length;
  const baseRate = band.filter((v) => near.has(v)).length / band.length;
  console.log(`  ── ㉡4 시접 연동: 상승 상위 5% 중 시접 ±2열 안 **${inBand}/${top.length} = ${(100*inBand/top.length).toFixed(1)}%** ──`);
  console.log(`     (대조) 어깨 대역 전체의 시접 ±2열 비율 ${(100*baseRate).toFixed(1)}% ⟹ 농축비 ${((inBand/top.length)/baseRate).toFixed(2)}배`);
}

/* ══ ㉠2 시접 «가시량» — 뷰별 픽셀 ══════════════════════════════════════════ */
const BODY_COL: [number, number, number] = [190, 185, 178];
const CLOTH_COL: [number, number, number] = [40, 90, 200];
const RES = Number(process.env.RES ?? 1);
const W = 300 * RES, H = 420 * RES;
const bounds = (() => {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const A of [bodyPos, clothPos]) for (let i = 0; i < A.length; i += 3)
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], A[i+c]); hi[c] = Math.max(hi[c], A[i+c]); }
  return { lo, hi };
})();
function classify(r: number, g: number, b: number): 'bg' | 'body' | 'cloth' {
  if (r === 255 && g === 255 && b === 255) return 'bg';
  const res = (C: number[]) => { const s = (r*C[0]+g*C[1]+b*C[2])/(C[0]**2+C[1]**2+C[2]**2);
    return (r-C[0]*s)**2 + (g-C[1]*s)**2 + (b-C[2]*s)**2; };
  return res(BODY_COL) <= res(CLOTH_COL) ? 'body' : 'cloth';
}
/** raster.ts 의 투영식 — 픽셀 좌표만 필요하다 */
function projector(view: View) {
  const d = view.dir, up = [0, 1, 0];
  const ux = up[1]*d[2]-up[2]*d[1], uy = up[2]*d[0]-up[0]*d[2], uz = up[0]*d[1]-up[1]*d[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const U = [ux/ul, uy/ul, uz/ul];
  const pr = (x: number, y: number, z: number) => [x*U[0]+y*U[1]+z*U[2], y];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = pr(k&1?bounds.hi[0]:bounds.lo[0], k&2?bounds.hi[1]:bounds.lo[1], k&4?bounds.hi[2]:bounds.lo[2]);
    u0 = Math.min(u0,p[0]); u1 = Math.max(u1,p[0]); v0 = Math.min(v0,p[1]); v1 = Math.max(v1,p[1]);
  }
  const s = Math.max((u1-u0)/W, (v1-v0)/H), cu = (u0+u1)/2, cv = (v0+v1)/2;
  return { px: (x:number,y:number,z:number)=>[Math.floor(W/2+(pr(x,y,z)[0]-cu)/s), Math.floor(H/2-(y-cv)/s)], mPerPx: s };
}
console.log(`  ── ㉠2 시접 «가시량» · 브리지 ${BRIDGE_ON ? `**on** (스트립 ${bridgeStripCount(bridgeIdx)} · 삼각형 ${bridgeIdx.length/3})` : 'off (등재 기준)'} — 시접 대역(투영 시접 정점 ± d) 안의 비옷색 픽셀 ──`);
console.log(`     ${'뷰'.padEnd(10)} 대역px  옷    몸    배경  | 끊김(윤곽 안 비옷색) ‰(대역)`);
/* v3-43 #94 — 근측 맨팔의 «전방 폐색»이 sideXplus 의 몸 픽셀에 섞인다.
 * 그 성분을 빼려면 v3-43 §1-2 와 «같은 방법»으로 소매 밖 원위 삼각형을 표시에서만 숨긴다.
 * blob 무변조 · 옷 무변경. 대조 열로만 쓴다. */
let sleeveXp = -Infinity;
for (let i = 0; i < clothPos.length; i += 3) sleeveXp = Math.max(sleeveXp, clothPos[i]);
const bodyIdxNoArm = (() => {
  const keep: number[] = [];
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const o = [bodyIdx[t]*3, bodyIdx[t+1]*3, bodyIdx[t+2]*3];
    if (o.every((k) => Math.abs(bodyPos[k]) > sleeveXp)) continue;
    keep.push(bodyIdx[t], bodyIdx[t+1], bodyIdx[t+2]);
  }
  return Uint32Array.from(keep);
})();
for (const view of VIEWS) {
  const full = render([{pos:bodyPos,idx:bodyIdx,color:BODY_COL},{pos:clothPos,idx:drawIdx,color:CLOTH_COL}], view, bounds, W, H);
  const fullNA = render([{pos:bodyPos,idx:bodyIdxNoArm,color:BODY_COL},{pos:clothPos,idx:drawIdx,color:CLOTH_COL}], view, bounds, W, H);
  const only = render([{pos:clothPos,idx:drawIdx,color:CLOTH_COL}], view, bounds, W, H);
  /* 윤곽 «안»: 옷이 아닌 곳을 테두리에서 채워 바깥을 지운다 — 남은 것이 옷 윤곽 내부다 */
  const outside = new Uint8Array(W*H);
  const isCloth = (i: number) => classify(only[i*3], only[i*3+1], only[i*3+2]) === 'cloth';
  const st: number[] = [];
  for (let x = 0; x < W; x++) { for (const i of [x, (H-1)*W+x]) if (!isCloth(i) && !outside[i]) { outside[i]=1; st.push(i);} }
  for (let y = 0; y < H; y++) { for (const i of [y*W, y*W+W-1]) if (!isCloth(i) && !outside[i]) { outside[i]=1; st.push(i);} }
  while (st.length) { const i = st.pop()!, x = i%W, y = (i/W)|0;
    for (const j of [x>0?i-1:-1, x<W-1?i+1:-1, y>0?i-W:-1, y<H-1?i+W:-1])
      if (j>=0 && !isCloth(j) && !outside[j]) { outside[j]=1; st.push(j); } }
  let sil = 0, outCnt = 0;
  for (let i = 0; i < W*H; i++) { if (isCloth(i)) sil++; if (outside[i]) outCnt++; }
  const pj = projector(view);
  const R = Math.max(1, Math.round(D / pj.mPerPx));       // 시접 대역 반경 = 해상도 d (등재량)
  const band = new Uint8Array(W*H);
  for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) for (const v of [sm.a[k], sm.b[k]]) {
    const [cx, cy] = pj.px(pos[v*3], pos[v*3+1], pos[v*3+2]);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx+dx, y = cy+dy;
      if (x<0||y<0||x>=W||y>=H||dx*dx+dy*dy>R*R) continue;
      band[y*W+x] = 1;
    }
  }
  let nb = 0, cl = 0, bo = 0, bg = 0, brk = 0, brkNA = 0, diffFull = 0;
  for (let i = 0; i < W*H; i++) {
    if (full[i*3] !== fullNA[i*3] || full[i*3+1] !== fullNA[i*3+1]) diffFull++;
    if (!band[i]) continue;
    nb++;
    const c = classify(full[i*3], full[i*3+1], full[i*3+2]);
    if (c === 'cloth') cl++; else if (c === 'body') bo++; else bg++;
    if (c !== 'cloth' && !outside[i]) brk++;
    const cn = classify(fullNA[i*3], fullNA[i*3+1], fullNA[i*3+2]);
    if (cn !== 'cloth' && !outside[i]) brkNA++;
  }
  console.log(`     ${view.name.padEnd(10)} ${String(nb).padStart(5)}  ${String(cl).padStart(5)} ${String(bo).padStart(5)} ${String(bg).padStart(5)} | **${String(brk).padStart(4)}**  ${(1000*brk/nb).toFixed(1)}‰  → 팔 숨김 후 **${String(brkNA).padStart(4)}** ${(1000*brkNA/nb).toFixed(1)}‰   (R=${R}px · 1px=${mm(pj.mPerPx)}mm · 전체화면 팔차이 ${diffFull}px · 실루엣 ${sil} · 윤곽밖 ${outCnt})`);
  /* 잔여의 «자리» — 팔 숨김 후에도 남는 끊김 픽셀을 가장 가까운 시접에 귀속시킨다.
   * 갈래 B 가 요구하는 「잔여의 자리·크기」다. 판정 채널을 바꾸지 않는다. */
  if (view.name === 'sideXplus' && brkNA > 0) {
    const seamPx: { name: string; x: number; y: number }[] = [];
    for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) for (const v of [sm.a[k], sm.b[k]]) {
      const [x, y] = pj.px(pos[v*3], pos[v*3+1], pos[v*3+2]);
      seamPx.push({ name: sm.name, x, y });
    }
    const cnt = new Map<string, number>();
    for (let i = 0; i < W*H; i++) {
      if (!band[i] || outside[i]) continue;
      if (classify(fullNA[i*3], fullNA[i*3+1], fullNA[i*3+2]) === 'cloth') continue;
      const x = i % W, y = (i/W)|0;
      let best = Infinity, nm = '?';
      for (const sp of seamPx) { const dd = (sp.x-x)**2 + (sp.y-y)**2; if (dd < best) { best = dd; nm = sp.name; } }
      cnt.set(nm, (cnt.get(nm) ?? 0) + 1);
    }
    console.log(`       잔여 ${brkNA}px 의 최근접 시접별 귀속: ${[...cnt].sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} ${c}`).join(' · ')}`);
    /* 잔여가 «시접선 위»인가 «대역 가장자리»인가 — 최근접 시접 정점까지의 픽셀 거리 */
    const dists: number[] = [];
    for (let i = 0; i < W*H; i++) {
      if (!band[i] || outside[i]) continue;
      if (classify(fullNA[i*3], fullNA[i*3+1], fullNA[i*3+2]) === 'cloth') continue;
      const x = i % W, y = (i/W)|0;
      let best = Infinity;
      for (const sp of seamPx) { const dd = (sp.x-x)**2 + (sp.y-y)**2; if (dd < best) best = dd; }
      dists.push(Math.sqrt(best));
    }
    dists.sort((a,b)=>a-b);
    console.log(`       잔여의 최근접 시접 정점까지 거리[px] 중앙 ${q(dists,.5).toFixed(2)} · p90 ${q(dists,.9).toFixed(2)} · 최대 ${q(dists,1).toFixed(2)} (대역 반경 R=${R}px · 1px=${mm(pj.mPerPx)}mm)`);
  }
}
