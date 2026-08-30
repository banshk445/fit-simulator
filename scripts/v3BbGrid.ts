/* v3-90 §1-② — **bb 7칸의 «그리드 자리»**(사실만 · 처방 0 · 코드 변경 0).
 * 최소쌍 두 삼각형의 coons 격자 (i, j) 를 `tris` 에서 «되찾아» 낸다:
 *   coons 그리드는 정점 v = base + j·(nu+1) + i 이고, 세로 이웃은 index 차 = nu+1 이다 ⟹
 *   패널 안에서 «가장 흔한 index 차»가 nu+1 이다(격자 폭 복원 · 새 상수 0).
 * 그다음 (가) 2D 에서도 붙어 있는가 / (나) 2D 는 멀고 3D 가 접는가 를 값으로 가른다.
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
type Rec = { pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };
const BB = ['c122.5-h170-s50_M','c122.5-h155-s50_S','c122.5-h155-s45_S','c122.5-h185-s45_XL',
            'c87.5-h185-s40_S','c87.5-h185-s40_XL','c87.5-h170-s40_S'];

console.log('| 칸 | 패널 | 삼각형 A (i,j) | 삼각형 B (i,j) | Δi | Δj | 3D 거리(mm) | 격자 간격(mm) | 2D 추정 거리(mm) | 3D/2D |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const id of BB) {
  const c = cells().find((x) => x.id === id)!;
  const b = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  let rec: Rec | null = null;
  (globalThis as unknown as { __v3gapProbe?: (x: unknown) => void }).__v3gapProbe = (x) => {
    if (!rec) { const q = x as Rec; rec = { pos: Float64Array.from(q.pos), tris: [...q.tris], panels: q.panels, n: q.n }; }
  };
  try { prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts, minPairDistLite }); } catch { /* 던짐 정상 */ }
  if (!rec) { console.log(`| \`${id}\` | 계기 미발화 | | | | | | | | |`); continue; }
  const r = rec as Rec;
  const w = minPairDist(r.pos, r.tris, 0.004);
  const bases = r.panels.map((p) => p.base).concat([r.n]);
  const pidx = (v: number) => { for (let k = 0; k < r.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return k; return -1; };
  const p0 = pidx(r.tris[w.worst[0] * 3]);
  const lo = bases[p0], hi = bases[p0 + 1];
  /* 격자 폭 복원 — 그 패널 안의 엣지 index 차 가운데 «1 이 아닌 최솟값» */
  const diffs = new Map<number, number>();
  for (let t = 0; t < r.tris.length; t += 3) {
    const v = [r.tris[t], r.tris[t + 1], r.tris[t + 2]];
    if (v.some((x) => x < lo || x >= hi)) continue;
    for (let a = 0; a < 3; a++) for (let b2 = a + 1; b2 < 3; b2++) {
      const d2 = Math.abs(v[a] - v[b2]); if (d2 > 1) diffs.set(d2, (diffs.get(d2) ?? 0) + 1);
    }
  }
  const stride = [...diffs.keys()].sort((a, b2) => a - b2)[0];   // nu+1
  const ij = (v: number) => [(v - lo) % stride, Math.floor((v - lo) / stride)];
  const A = ij(r.tris[w.worst[0] * 3]), B2 = ij(r.tris[w.worst[1] * 3]);
  /* 격자 간격 — 그 패널의 3D 가로 이웃 평균 길이(2D 패턴 간격의 대용 · 배치 배율 1 인 구간) */
  let sum = 0, n2 = 0;
  for (let v = lo; v + 1 < hi; v++) if ((v - lo) % stride !== stride - 1) {
    sum += Math.hypot(r.pos[v * 3] - r.pos[(v + 1) * 3], r.pos[v * 3 + 1] - r.pos[(v + 1) * 3 + 1], r.pos[v * 3 + 2] - r.pos[(v + 1) * 3 + 2]); n2++;
  }
  const cell = sum / n2;
  const di = Math.abs(A[0] - B2[0]), dj = Math.abs(A[1] - B2[1]);
  const d2d = Math.hypot(di, dj) * cell;
  console.log(`| \`${id}\` | ${r.panels[p0].name} | (${A[0]},${A[1]}) | (${B2[0]},${B2[1]}) | **${di}** | **${dj}**`
    + ` | ${(w.min * 1000).toPrecision(4)} | ${(cell * 1000).toFixed(2)} | ${(d2d * 1000).toFixed(2)} | ${(w.min / d2d).toPrecision(3)} |`);
}
