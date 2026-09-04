/* v4-36 §1-① — **축 성분 이동 가상 실험**(판정만 · `src/` 0줄 · 굽기 0).
 *
 * s = (어깨 이음 봉제쌍의 «암홀 쪽 중심» − «소매 쪽 중심»)·AX  — 좌·우 각각 · 손 상수 0.
 * 소매 패널을 `p ← p + s·AX` 로 옮긴 가상 배치에서 **참깊이 자**(크기 `exactBodyDist` · 부호 SDF)로:
 *   위반(전/후) 수·깊이 · 봉제쌍 거리 분포 · 두 링 중심 거리 · 비봉제 최소 쌍거리 · 소매 y중앙.
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… TAG=… npx tsx scripts/v4AxialShift.ts`
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
const ax = armAxisFromEnv();
const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                     minPairDistLite, armAxis: ax });
type Pan = { base: number; nu: number; nv: number };
const S = PR.sc as unknown as { n: number; front: Pan; back: Pan; slv: Pan[];
                                s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
const RR = rng(S.slv[0]), LL = rng(S.slv[1]), FR = rng(S.front), BK = rng(S.back);
const inR = (v: number) => v >= RR[0] && v < RR[1];
const isSlv = (v: number) => inR(v) || (v >= LL[0] && v < LL[1]);
const pos = S.s.pos;
const at = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const qq = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const stat = (a: number[]) => ({ 최소: qq(a, 0), p25: qq(a, 0.25), 중앙: med(a), p75: qq(a, 0.75), 최대: qq(a, 0.999) });
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const AX: V3 = ax ? [Math.abs(ax.right[0]), ax.right[1], ax.right[2]] : [1, 0, 0];
const bd = makeBodyDistance({ pos: PR.prim0.pos, idx: PR.bodyIdx, bodyG: PR.bodyG, h: PR.sdfSpec.h, thick: THICK });
const clr = (p: V3) => (sampleSdf(PR.bodyG, p[0], p[1], p[2]) < 0 ? -1 : 1) * bd.exactBodyDist(p[0], p[1], p[2]);

const pairs = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
  .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
const mean = (P: V3[]): V3 => [P.reduce((s2, p) => s2 + p[0], 0) / P.length,
                               P.reduce((s2, p) => s2 + p[1], 0) / P.length,
                               P.reduce((s2, p) => s2 + p[2], 0) / P.length];
const sOf: Record<string, number> = {};
for (const side of ['R', 'L'] as const) {
  const ps = pairs.filter((p) => (side === 'R' ? inR(p.slv) : !inR(p.slv)));
  const mir = (p: V3): V3 => (side === 'L' ? [-p[0], p[1], p[2]] : p);
  const cb = mean(ps.map((p) => mir(at(p.body)))), cs = mean(ps.map((p) => mir(at(p.slv))));
  sOf[side] = dot(sub(cb, cs), AX);
}
const shiftOf = (v: number): V3 => {
  const s = sOf[inR(v) ? 'R' : 'L'], m = inR(v) ? 1 : -1;
  return [m * s * AX[0], s * AX[1], s * AX[2]];
};
const mv = (v: number, on: boolean): V3 => {
  const p = at(v); if (!on) return p;
  const d = shiftOf(v); return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
};
const slvVerts = [...Array(RR[1] - RR[0]).keys()].map((k) => RR[0] + k)
  .concat([...Array(LL[1] - LL[0]).keys()].map((k) => LL[0] + k));
const bodyVerts = [...Array(FR[1] - FR[0]).keys()].map((k) => FR[0] + k)
  .concat([...Array(BK[1] - BK[0]).keys()].map((k) => BK[0] + k));
const violOf = (on: boolean) => slvVerts.map((v) => clr(mv(v, on)) * 1000).filter((x) => x < SEP * 1000);
const seamOf = (on: boolean) => pairs.map((p) => len(sub(mv(p.slv, on), at(p.body))) * 1000);
const key = new Set(pairs.map((p) => p.slv * S.n + p.body));
const minPairOf = (on: boolean) => {
  let mn = Infinity;
  for (const a of slvVerts) {
    const pa = mv(a, on);
    for (const b of bodyVerts) { if (key.has(a * S.n + b)) continue; const d = len(sub(pa, at(b))); if (d < mn) mn = d; }
  }
  return mn * 1000;
};
const ringCtrDist = (on: boolean) => {
  const o: Record<string, number> = {};
  for (const side of ['R', 'L'] as const) {
    const ps = pairs.filter((p) => (side === 'R' ? inR(p.slv) : !inR(p.slv)));
    o[side] = len(sub(mean(ps.map((p) => at(p.body))), mean(ps.map((p) => mv(p.slv, on))))) * 1000;
  }
  return o;
};
const vB = violOf(false), vA = violOf(true);
const depth = (arr: number[]) => arr.map((x) => SEP * 1000 - x);
const out = {
  what: 'v4-36 §1-① 축 성분 이동 가상 실험(참깊이 자)', cell: CELL, tag: TAG, bodyBin: bbPath,
  SEPmm: SEP * 1000, AX,
  's_mm': { R: sOf.R * 1000, L: sOf.L * 1000 },
  '교차 확인(v4-32 Δ·AX)': { R: -220.6033, L: -220.5420 },
  '위반 정점(전/후)': [vB.length, vA.length], '위반 후 ≤ 전': vA.length <= vB.length,
  '위반 깊이 전 mm': vB.length ? stat(depth(vB)) : null,
  '위반 깊이 후 mm': vA.length ? stat(depth(vA)) : null,
  '봉제쌍 거리 mm(전)': stat(seamOf(false)), '봉제쌍 거리 mm(후)': stat(seamOf(true)),
  '문턱 mm': 217.0112, '중앙 ≤ 문턱(후)': med(seamOf(true)) <= 217.0112,
  '두 링 중심 거리 mm(전/후)': [ringCtrDist(false), ringCtrDist(true)],
  '비봉제 최소 쌍거리 mm(전/후)': [minPairOf(false), minPairOf(true)],
  '소매 y중앙 m(전/후)': [med(slvVerts.map((v) => at(v)[1])), med(slvVerts.map((v) => mv(v, true)[1]))],
  '최소 여유 mm(후)': Math.min(...slvVerts.map((v) => clr(mv(v, true)))) * 1000,
};
writeFileSync(`${OUT}/l3ap-axial-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
