/* v4-35 §1-①②③ — **암홀 링 · 캡 링의 자리 사실**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * 링 = 어깨 이음 봉제쌍(v4-24·31~34 와 같은 가름)의 **몸판 쪽**(암홀) / **소매 쪽**(캡) 정점 · 좌·우 각 52.
 * 채널 — 중심 · 최소제곱 평면 법선(공분산 최소 고유벡터) · 법선↔팔축 각 · 중심↔어깨 피벗 거리 ·
 *        점별 부호 있는 여유(크기 = `exactBodyDist` · 부호 = SDF) · 둘레(이음 순서) ·
 *        최대 점쌍 거리(지름 대용) · 평면 이탈 RMS.
 * 대조군 — T포즈는 `asm-Tasm_M.bin` 의 좌표로 같은 채널(재굽기 0).
 *
 * 진입: `CELL=… BODY_BIN=… [ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…] [TBASE=asm-Tasm_M.bin] TAG=… npx tsx scripts/v4RingFacts.ts`
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
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const qq = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const stat = (a: number[]) => ({ 최소: qq(a, 0), p25: qq(a, 0.25), 중앙: med(a), p75: qq(a, 0.75), 최대: qq(a, 0.999) });
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 대칭 3×3 야코비 — 가장 작은 고윳값의 고유벡터(최소제곱 평면 법선). */
function smallestEigvec(M: number[][]): V3 {
  const A = M.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sw = 0; sw < 64; sw++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p][q] * A[p][q];
    if (off < 1e-32) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const a1 = A[k][p], a2 = A[k][q]; A[k][p] = cs * a1 - sn * a2; A[k][q] = sn * a1 + cs * a2; }
      for (let k = 0; k < 3; k++) { const a1 = A[p][k], a2 = A[q][k]; A[p][k] = cs * a1 - sn * a2; A[q][k] = sn * a1 + cs * a2; }
      for (let k = 0; k < 3; k++) { const v1 = V[k][p], v2 = V[k][q]; V[k][p] = cs * v1 - sn * v2; V[k][q] = sn * v1 + cs * v2; }
    }
  }
  let bi = 0; for (let i = 1; i < 3; i++) if (A[i][i] < A[bi][bi]) bi = i;
  return [V[0][bi], V[1][bi], V[2][bi]];
}

function ringFacts(P: V3[], AX: V3) {
  const n = P.length;
  const ctr: V3 = [P.reduce((s, p) => s + p[0], 0) / n, P.reduce((s, p) => s + p[1], 0) / n, P.reduce((s, p) => s + p[2], 0) / n];
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) { const d = sub(p, ctr); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  let nrm = smallestEigvec(C);
  const nl = len(nrm) || 1; nrm = [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl];
  if (dot(nrm, AX) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
  const plane = P.map((p) => Math.abs(dot(sub(p, ctr), nrm)));
  let peri = 0;
  for (let i = 1; i < n; i++) peri += len(sub(P[i], P[i - 1]));
  let dia = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dia = Math.max(dia, len(sub(P[i], P[j])));
  return { 중심: ctr, 법선: nrm, '법선↔팔축 deg': Math.acos(Math.min(1, Math.abs(dot(nrm, AX)))) * 180 / Math.PI,
           '둘레 mm': peri * 1000, '최대 점쌍 mm': dia * 1000,
           '평면 이탈 RMS mm': Math.sqrt(plane.reduce((s, x) => s + x * x, 0) / n) * 1000 };
}

function scene(bodyBin: string, ax: ReturnType<typeof armAxisFromEnv>, posOverride?: Float64Array) {
  const bb = readFileSync(bodyBin);
  const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                       bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                       minPairDistLite, armAxis: ax });
  type Pan = { base: number; nu: number; nv: number };
  const S = PR.sc as unknown as { n: number; slv: Pan[]; s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
  if (posOverride) S.s.pos.set(posOverride.slice(0, S.n * 3));
  const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
  const RR = rng(S.slv[0]), LL = rng(S.slv[1]);
  const inR = (v: number) => v >= RR[0] && v < RR[1];
  const isSlv = (v: number) => inR(v) || (v >= LL[0] && v < LL[1]);
  const pos = S.s.pos;
  const at = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const pairs = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
    .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
  const bd = makeBodyDistance({ pos: PR.prim0.pos, idx: PR.bodyIdx, bodyG: PR.bodyG, h: PR.sdfSpec.h, thick: THICK });
  const clr = (p: V3) => (sampleSdf(PR.bodyG, p[0], p[1], p[2]) < 0 ? -1 : 1) * bd.exactBodyDist(p[0], p[1], p[2]);
  return { PR, pairs, at, inR, clr };
}

const axA = armAxisFromEnv();
const AXA: V3 = axA ? [Math.abs(axA.right[0]), axA.right[1], axA.right[2]] : [1, 0, 0];
const PIV: V3 | null = axA?.pivot ? [Math.abs(axA.pivot.right[0]), axA.pivot.right[1], axA.pivot.right[2]] : null;
const A = scene(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`, axA);

const tb = readFileSync(`${OUT}/${process.env.TBASE ?? 'asm-Tasm_M.bin'}`);
const thl = tb.readUInt32LE(0);
const thn = (JSON.parse(tb.subarray(4, 4 + thl).toString('utf8')) as { n: number }).n;
const tpos = new Float64Array(tb.buffer.slice(tb.byteOffset + 4 + thl, tb.byteOffset + 4 + thl + thn * 3 * 8));
const T = scene(`public/v3diag/v3-77/body-${c.bodyId}.bin`, undefined, tpos);

const W = garmentOf(c.size as Size).W;
const partOf = (p: V3, yArm: number, armD: number) =>
  Math.abs(p[0]) > W / 2 ? '팔' : Math.abs(p[1] - yArm) <= armD ? '겨드랑이' : '몸통';

function measure(sc: ReturnType<typeof scene>, AX: V3, withPivot: boolean) {
  const S2 = sc.PR.S as unknown as { Y_TOP: number; L: number; Y_ARM: number; ARM_D: number };
  const yArm = S2.Y_TOP - (S2.L - S2.Y_ARM);
  const out: Record<string, unknown> = { 'Y_ARM(세계) m': yArm };
  for (const side of ['R', 'L'] as const) {
    const ps = sc.pairs.filter((p) => (side === 'R' ? sc.inR(p.slv) : !sc.inR(p.slv)));
    const bodyPts = ps.map((p) => sc.at(p.body)), capPts = ps.map((p) => sc.at(p.slv));
    const rb = ringFacts(bodyPts, AX), rc = ringFacts(capPts, AX);
    const clrs = bodyPts.map((p) => sc.clr(p) * 1000);
    const neg = clrs.map((v, i) => ({ v, i })).filter((x) => x.v < 0);
    out[side] = {
      점: ps.length,
      '암홀 링': { ...rb, ...(withPivot && PIV ? { '중심↔피벗 mm': len(sub(rb.중심 as V3, PIV)) * 1000 } : {}) },
      '캡 링': rc,
      '두 링 차': { '둘레 mm': (rb['둘레 mm'] as number) - (rc['둘레 mm'] as number),
                  '지름 mm': (rb['최대 점쌍 mm'] as number) - (rc['최대 점쌍 mm'] as number),
                  '법선 사이 deg': Math.acos(Math.min(1, Math.abs(dot(rb.법선 as V3, rc.법선 as V3)))) * 180 / Math.PI,
                  '중심 거리 mm': len(sub(rb.중심 as V3, rc.중심 as V3)) * 1000 },
      '암홀 링 여유 mm': stat(clrs),
      '음(몸 안) 점': neg.length,
      '음 점 깊이 mm': neg.length ? stat(neg.map((x) => -x.v)) : null,
      '음 점 부위': neg.reduce((acc: Record<string, number>, x) => {
        const k = partOf(bodyPts[x.i], yArm, S2.ARM_D); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
      '위반(< SEP) 점': clrs.filter((v) => v < SEP * 1000).length,
    };
  }
  return out;
}

const res = { what: 'v4-35 §1 암홀·캡 링 자리 사실(측정만)', cell: CELL, tag: TAG, SEPmm: SEP * 1000,
              A포즈: measure(A, AXA, true), T포즈: measure(T, [1, 0, 0], false) };
writeFileSync(`${OUT}/l3ap-ring-${TAG}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
