/* v4-29 §1-② — **피벗 배치 «가상 실험»**(판정만 · `src/` 0줄 · 조립 0 · 굽기 0).
 *
 * 무엇을 하나 — 소매 관의 «중심»만 두 자리에 놓고 같은 표본점을 다시 잰다:
 *   ㉠ **C 배치**(현행 v4-26·28 · 중심선 투영점) — v4-28 §1-③ 의 수를 **재현**해 계기 충실도를 보인다
 *   ㉡ **P 배치**(어깨 피벗 원좌표 · §0-2 승인 문언의 자리)
 * 쓰는 조각은 전부 있는 것이다 — `P.S.PROBE.sleeve` · `P.bodyG` · `sampleSdf`(`src/v3/bodySdf.ts`) ·
 * `sleeveTrace.dims`(v4-28 계기). 축의 직교 보완 AU·AV 는 `garmentScene.ts` 와 **같은 규칙**을 옮겼다.
 * ★ **몸판 기둥 항은 평가하지 않는다**(§0-5ㄴ 등재 · `distToSurface` 는 `garmentScene` 내부).
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… [RFORCE=0.061510] [TAG=…] npx tsx scripts/v4PivotProbe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sleeveTrace } from '../src/v3/garmentScene.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

type V3 = [number, number, number];
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const RFORCE = Number(process.env.RFORCE ?? 0.061510);
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

sleeveTrace.on = true;
const ax = armAxisFromEnv();
const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: verts, minPairDistLite, armAxis: ax });
const dims = sleeveTrace.dims!;
const S = PR.S as unknown as { PROBE: { sleeve: [number, number][] }; SLV_X0: number; SLV_R: number };
const yArmWorld = dims.Y_TOP - (dims.L - dims.Y_ARM);
const part = (x: number, y: number) =>
  Math.abs(x) > dims.W / 2 ? '팔' : Math.abs(y - yArmWorld) <= dims.ARM_D ? '겨드랑이' : '몸통';

/* 축과 직교 보완 — `garmentScene.ts` 의 규칙 그대로(값 창작 0). */
const AX: V3 = ax ? [Math.abs(ax.right[0]), ax.right[1], ax.right[2]] : [1, 0, 0];
const [AU, AV]: [V3, V3] = (() => {
  const n = Math.hypot(AX[0], AX[1], AX[2]) || 1;
  const a: V3 = [AX[0] / n, AX[1] / n, AX[2] / n];
  const cr = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const nz = (p: V3): V3 => { const L = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / L, p[1] / L, p[2] / L]; };
  const seed: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const w = nz(cr(seed, a));
  const u = cr(a, w);
  return [u, cr(a, u)];
})();

const origin = JSON.parse(readFileSync(process.env.ARM_ORIGIN_JSON!, 'utf8')) as
  { right: { 피벗: V3; 중심선투영: V3 } };
const mirror = (v: V3): V3 => [Math.abs(v[0]), v[1], v[2]];      // 오른팔 기준(코드의 sgn 규약과 같은 쪽)
const anchors: [string, V3][] = [
  ['C(현행 · 중심선투영)', mirror(origin.right.중심선투영)],
  ['P(어깨 피벗 원좌표)', mirror(origin.right.피벗)],
];

const run = (A: V3, R: number) => {
  const rows = S.PROBE.sleeve.map(([px, py]) => {
    const t = S.SLV_X0 + (dims.CAP_H - py), ph = px / R;
    const c0 = Math.cos(ph), s0 = Math.sin(ph);
    const x = A[0] + t * AX[0] + R * (c0 * AU[0] + s0 * AV[0]);
    const y = A[1] + t * AX[1] + R * (c0 * AU[1] + s0 * AV[1]);
    const z = A[2] + t * AX[2] + R * (c0 * AU[2] + s0 * AV[2]);
    const body = sampleSdf(PR.bodyG, x, y, z);
    return { px, py, x, y, z, body, 부위: part(x, y) };
  });
  const viol = rows.filter((r) => r.body < SEP);
  const byPart: Record<string, number> = {};
  for (const v of viol) byPart[v.부위] = (byPart[v.부위] ?? 0) + 1;
  const dep = viol.map((v) => (SEP - v.body) * 1000).sort((a, b) => a - b);
  const q = (f: number) => (dep.length ? dep[Math.min(dep.length - 1, Math.floor(f * dep.length))] : null);
  return { R, 표본: rows.length, 'min 몸SDFmm': Math.min(...rows.map((r) => r.body)) * 1000,
    위반: viol.length, 부위별: byPart,
    '깊이mm': dep.length ? { 최소: dep[0], p25: q(0.25), 중앙: q(0.5), p75: q(0.75), 최대: dep[dep.length - 1] } : null,
    '위반 앞3': viol.slice(0, 3).map((v) => ({ xyz: [v.x, v.y, v.z], 부위: v.부위, '깊이mm': (SEP - v.body) * 1000 })) };
};

const out = { what: 'v4-29 §1-② 피벗 배치 가상 실험(판정만 · 몸SDF 항 한정)', cell: CELL, tag: TAG,
  bodyBin: bbPath, R: RFORCE, SEPmm: SEP * 1000, SLV_X0: S.SLV_X0, 'SLV_R(현행)': S.SLV_R,
  AX, AU, AV, 'Y_ARM(세계)': yArmWorld,
  결과: Object.fromEntries(anchors.map(([k, A]) => [k, { 중심: A, ...run(A, RFORCE) }])) };
writeFileSync(`${OUT}/l3ap-pivot-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
