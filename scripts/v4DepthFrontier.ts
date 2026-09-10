/* v4-34 §1-①ㄴ·② — **참깊이 재측정 + 위반 0 경계(t*) 측정**(판정만 · `src/` 0줄 · 굽기 0).
 *
 * 자(尺) — 깊이는 `makeBodyDistance().exactBodyDist`(몸 «메시»까지 정확 무부호 거리)로 잰다.
 *   SDF 는 **부호**에만 쓴다(밴드 밖에서 |d| 가 잘리므로 크기는 못 믿는다 · §0-4ㄱ).
 *   부호 있는 여유 `clr(p) = (sdf < 0 ? −1 : +1) × exactBodyDist(p)`.
 * 경로 — `p(t) = R(축, 각도·t)·(p − s̄) + s̄ + t·(d̄ − s̄)` (t=0 항등 · t=1 = v4-33 강체 정합).
 * `t*` = 「모든 소매 정점의 `clr ≥ SEP` 인 최대 t」 — 이분 탐색 40회(문턱은 SEP 그대로 · 손 상수 0).
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… TAG=… npx tsx scripts/v4DepthFrontier.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

type V3 = [number, number, number];
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: verts, minPairDistLite, armAxis: armAxisFromEnv() });
type Pan = { base: number; nu: number; nv: number; name: string };
const S = PR.sc as unknown as { n: number; front: Pan; back: Pan; slv: Pan[];
                                s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
const RR = rng(S.slv[0]), LL = rng(S.slv[1]), FR = rng(S.front), BK = rng(S.back);
const inR = (v: number) => v >= RR[0] && v < RR[1];
const inL = (v: number) => v >= LL[0] && v < LL[1];
const isSlv = (v: number) => inR(v) || inL(v);
const pos = S.s.pos;
const at = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const qq = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const stat = (a: number[]) => ({ 최소: qq(a, 0), p25: qq(a, 0.25), 중앙: med(a), p75: qq(a, 0.75), 최대: qq(a, 0.999) });

const bd = makeBodyDistance({ pos: PR.prim0.pos, idx: PR.bodyIdx, bodyG: PR.bodyG, h: PR.sdfSpec.h, thick: THICK });
const sdfOf = (p: V3) => sampleSdf(PR.bodyG, p[0], p[1], p[2]);
/** 부호 있는 여유 — 크기는 «정확 거리», 부호는 SDF. */
const clr = (p: V3) => (sdfOf(p) < 0 ? -1 : 1) * bd.exactBodyDist(p[0], p[1], p[2]);

/* ── v4-33 과 «같은» 절차(사원수 Kabsch) — 대응도 같다 ─────────────────── */
function jacobi4(A0: number[][]) {
  const A = A0.map((r) => [...r]);
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sw = 0; sw < 64; sw++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 4; k++) { const a1 = A[k][p], a2 = A[k][q]; A[k][p] = cs * a1 - sn * a2; A[k][q] = sn * a1 + cs * a2; }
      for (let k = 0; k < 4; k++) { const a1 = A[p][k], a2 = A[q][k]; A[p][k] = cs * a1 - sn * a2; A[q][k] = sn * a1 + cs * a2; }
      for (let k = 0; k < 4; k++) { const v1 = V[k][p], v2 = V[k][q]; V[k][p] = cs * v1 - sn * v2; V[k][q] = sn * v1 + cs * v2; }
    }
  }
  return { eig: [A[0][0], A[1][1], A[2][2], A[3][3]], vec: V };
}
function fitRigid(src: V3[], dst: V3[]) {
  const n = src.length;
  const mean = (P: V3[]): V3 => P.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n] as V3, [0, 0, 0] as V3);
  const cs = mean(src), cd = mean(dst);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++)
    M[a][b] += (src[i][a] - cs[a]) * (dst[i][b] - cd[b]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = M;
  const K = [[xx + yy + zz, yz - zy, zx - xz, xy - yx],
             [yz - zy, xx - yy - zz, xy + yx, zx + xz],
             [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
             [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const { eig, vec } = jacobi4(K);
  let bi = 0; for (let i = 1; i < 4; i++) if (eig[i] > eig[bi]) bi = i;
  const qv = [vec[0][bi], vec[1][bi], vec[2][bi], vec[3][bi]];
  const nq = Math.hypot(qv[0], qv[1], qv[2], qv[3]) || 1;
  const [w, x, y, z] = qv.map((v) => v / nq);
  const ang = 2 * Math.acos(Math.min(1, Math.abs(w)));
  const sa = Math.hypot(x, y, z) || 1;
  return { cs, cd, 각도rad: ang, 축: [x / sa, y / sa, z / sa] as V3 };
}
/** 로드리게스 회전 — 축은 그대로, 각도만 t 배. */
const rot = (p: V3, axis: V3, ang: number): V3 => {
  const [kx, ky, kz] = axis, cA = Math.cos(ang), sA = Math.sin(ang);
  const dot = kx * p[0] + ky * p[1] + kz * p[2];
  const cr: V3 = [ky * p[2] - kz * p[1], kz * p[0] - kx * p[2], kx * p[1] - ky * p[0]];
  return [p[0] * cA + cr[0] * sA + kx * dot * (1 - cA),
          p[1] * cA + cr[1] * sA + ky * dot * (1 - cA),
          p[2] * cA + cr[2] * sA + kz * dot * (1 - cA)];
};

const pairs = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
  .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
const fit: Record<string, ReturnType<typeof fitRigid>> = {};
for (const side of ['R', 'L'] as const) {
  const ps = pairs.filter((p) => (side === 'R' ? inR(p.slv) : inL(p.slv)));
  fit[side] = fitRigid(ps.map((p) => at(p.slv)), ps.map((p) => at(p.body)));
}
const mapv = (v: number, t: number): V3 => {
  const f = fit[inR(v) ? 'R' : 'L'];
  const p = at(v);
  const r = rot([p[0] - f.cs[0], p[1] - f.cs[1], p[2] - f.cs[2]], f.축, f.각도rad * t);
  return [f.cs[0] + r[0] + t * (f.cd[0] - f.cs[0]),
          f.cs[1] + r[1] + t * (f.cd[1] - f.cs[1]),
          f.cs[2] + r[2] + t * (f.cd[2] - f.cs[2])];
};
const slvVerts = [...Array(RR[1] - RR[0]).keys()].map((k) => RR[0] + k)
  .concat([...Array(LL[1] - LL[0]).keys()].map((k) => LL[0] + k));
const bodyVerts = [...Array(FR[1] - FR[0]).keys()].map((k) => FR[0] + k)
  .concat([...Array(BK[1] - BK[0]).keys()].map((k) => BK[0] + k));
const dd = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ① 참깊이 — t=1 에서 SDF 기준 위반 정점의 «정확» 깊이 */
const violAt1 = slvVerts.filter((v) => sdfOf(mapv(v, 1)) < SEP);
const sdfDepth = violAt1.map((v) => (SEP - sdfOf(mapv(v, 1))) * 1000);
const trueDepth = violAt1.map((v) => (SEP - clr(mapv(v, 1))) * 1000);

/* ② 위반 0 경계 — 이분 탐색(참깊이 자) */
const ok = (t: number) => slvVerts.every((v) => clr(mapv(v, t)) >= SEP);
let lo = 0, hi = 1;
const okAt0 = ok(0), okAt1 = ok(1);
if (okAt1) lo = 1;
else if (!okAt0) hi = 0;
else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
const tStar = lo;
const seamAt = (t: number) => pairs.map((p) => dd(mapv(p.slv, t), at(p.body)) * 1000);
const key = new Set(pairs.map((p) => p.slv * S.n + p.body));
const minPairAt = (t: number) => {
  let mn = Infinity;
  for (const a of slvVerts) {
    const pa = mapv(a, t);
    for (const b of bodyVerts) { if (key.has(a * S.n + b)) continue; const d = dd(pa, at(b)); if (d < mn) mn = d; }
  }
  return mn * 1000;
};
const yMedAt = (t: number) => med(slvVerts.map((v) => mapv(v, t)[1]));

const out = {
  what: 'v4-34 §1-①ㄴ② 참깊이 · 위반 0 경계', cell: CELL, tag: TAG, bodyBin: bbPath,
  SEPmm: SEP * 1000, THICKmm: THICK * 1000, 'sdf h mm': PR.sdfSpec.h * 1000,
  'sdf band mm': (PR.sdfSpec as unknown as { band: number }).band * 1000,
  '①': {
    '위반 정점(t=1 · SDF 기준)': violAt1.length,
    'SDF 깊이 mm': sdfDepth.length ? stat(sdfDepth) : null,
    '참깊이(정확 거리) mm': trueDepth.length ? stat(trueDepth) : null,
  },
  '②': {
    't=0 위반 0': okAt0, 't=1 위반 0': okAt1, 't*': tStar,
    '봉제쌍 거리 mm(t*)': stat(seamAt(tStar)), '봉제쌍 거리 mm(t=1)': stat(seamAt(1)),
    '문턱 mm': 217.0112, '중앙 ≤ 문턱(t*)': med(seamAt(tStar)) <= 217.0112,
    '소매 y중앙 m(t=0 / t* / t=1)': [yMedAt(0), yMedAt(tStar), yMedAt(1)],
    '비봉제 최소 쌍거리 mm(t*)': minPairAt(tStar),
    '최소 여유 mm(t*)': Math.min(...slvVerts.map((v) => clr(mapv(v, tStar)))) * 1000,
  },
};
writeFileSync(`${OUT}/l3ap-frontier-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
