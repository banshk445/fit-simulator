/* v3-51 §3 — **사실 수집 전용**. `v3BodyLevels.ts` 가 사전 등록 갈래 B 로 정지한 «뒤»에,
 * 정지 사유를 값으로 남기기 위한 진단이다. **판정 0 · 도출 0 · 규칙 변경 0.**
 * 여기서 chestY/waistY 를 «내지 않는다» — 그것은 규칙이 닫힌 뒤의 일이다.
 * 진입: `npx tsx scripts/v3BodyLevelsDiag.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';

const b = readFileSync('public/models/mannequin.glb');
const P = prepare({ glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  fabric: FABRICS.gray, d: 0.009, garment: DEFAULT_GARMENT, minPairDistLite });
const pos = P.prim0.pos, idx = P.bodyIdx, { Y_TOP, Y_NECK, AXIS_Z } = P.S;
const nv = pos.length / 3;
type Seg = { e0: number; e1: number; p0: [number, number]; p1: [number, number] };
const key = (a: number, c: number) => (a < c ? a * nv + c : c * nv + a);
function sectionSegs(y: number): Seg[] {
  const out: Seg[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const hit: { e: number; p: [number, number] }[] = [];
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3];
      const fp = pos[p * 3 + 1] - y, fq = pos[q * 3 + 1] - y;
      if ((fp > 0) === (fq > 0)) continue;
      const u = fp / (fp - fq);
      hit.push({ e: key(p, q), p: [pos[p * 3] + u * (pos[q * 3] - pos[p * 3]), pos[p * 3 + 2] + u * (pos[q * 3 + 2] - pos[p * 3 + 2])] });
    }
    if (hit.length === 2) out.push({ e0: hit[0].e, e1: hit[1].e, p0: hit[0].p, p1: hit[1].p });
  }
  return out;
}
function components(segs: Seg[]): Seg[][] {
  const par = segs.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const be = new Map<number, number>();
  segs.forEach((s, i) => { for (const e of [s.e0, s.e1]) { const j = be.get(e); if (j === undefined) be.set(e, i); else { const a = find(i), c = find(j); if (a !== c) par[a] = c; } } });
  const g = new Map<number, Seg[]>();
  segs.forEach((s, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r)!.push(s); });
  return [...g.values()];
}
const containsAxis = (L: Seg[]) => {
  let ins = false;
  for (const s of L) { const [x0, z0] = s.p0, [x1, z1] = s.p1;
    if ((z0 > AXIS_Z) !== (z1 > AXIS_Z)) { const xc = x0 + ((AXIS_Z - z0) / (z1 - z0)) * (x1 - x0); if (xc > 0) ins = !ins; } }
  return ins;
};
function hullPerim(L: Seg[]): number {
  const pts: [number, number][] = [];
  for (const s of L) { pts.push(s.p0); pts.push(s.p1); }
  pts.sort((a, c) => (a[0] - c[0]) || (a[1] - c[1]));
  const cr = (o: [number, number], a: [number, number], c: [number, number]) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const half = (src: [number, number][]) => { const h: [number, number][] = []; for (const p of src) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h; };
  const lo = half(pts), hi = half([...pts].reverse());
  const H = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  if (H.length < 3) return NaN;
  let s = 0; for (let i = 0; i < H.length; i++) { const a = H[i], c = H[(i + 1) % H.length]; s += Math.hypot(a[0] - c[0], a[1] - c[1]); }
  return s;
}
console.log(`[진단] 판정 0 · 도출 0. Y_TOP ${(Y_TOP * 100).toFixed(2)} · Y_NECK ${(Y_NECK * 100).toFixed(2)} · 축 z ${(AXIS_Z * 100).toFixed(2)} cm`);
console.log(`  ${'y[cm]'.padStart(7)}${'성분'.padStart(5)}${'몸통고리 |x|max'.padStart(16)}${'몸통 껍질둘레[cm]'.padStart(18)}   비고`);
for (let ycm = 83; ycm <= 147; ycm += 1) {
  const y = ycm / 100;
  const C = components(sectionSegs(y));
  const t = C.find(containsAxis);
  let xm = NaN;
  if (t) { xm = 0; for (const s of t) for (const p of [s.p0, s.p1]) xm = Math.max(xm, Math.abs(p[0])); }
  const note = !t ? '몸통 고리 없음' : xm > 0.25 ? '**팔이 몸통 고리에 «융합»**' : '';
  console.log(`  ${ycm.toFixed(0).padStart(7)}${String(C.length).padStart(5)}${(xm * 100).toFixed(1).padStart(16)}${(hullPerim(t ?? []) * 100).toFixed(2).padStart(18)}   ${note}`);
}
