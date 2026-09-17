/* v5-23 §1-①② — **목선 자의 정의역 사실**(측정만 · `src/` **0줄** · 물리 0프레임 · 처방 0 · 판단 0).
 *
 * 게이트의 식을 **그대로** 다시 쓴다(`s4Gate.ts:111-126` · 새 식 0):
 *   `ringM` = 링 닫힌 둘레 · `ringBodyM` = 링 정점의 `nearestBodyPoint` 를 이은 닫힌 둘레 ·
 *   `ringAllowM = ringBodyM + 2π(THICK + TOL_SELF)` · `ringExcess = ringM / ringAllowM`.
 * 더 내는 것 — 정점별 몸 거리 분포(«얹힘» 자 `d_rest = THICK + TOL_SELF` · `SEP` 기준도 병기) ·
 *   링 정점 높이(앞·뒤·옆 · `Y_NECK` 대비) · 정점별 신장률(3D 엣지 / 2D 패턴 엣지) ·
 *   허용의 높이 민감도 `dC/dy`(링을 `y ± 5 mm` 강체 이동 · 프롬프트가 준 탐침 폭).
 *
 * 진입: `[ASM1X=1] [POS=<blob>] CELL=… [SPEC=…] BODY_BIN=… [ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…]
 *        [TAG=…] npx tsx scripts/v5NeckRuler.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { makeBodyDistance, minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, THICK, TOL_SELF, SEP } from '../src/v3/consts.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const ASM1X = process.env.ASM1X === '1';
const POS = process.env.POS;
const TAG = process.env.TAG ?? `${ASM1X ? 'on' : 'off'}-${SPEC ?? CELL}${POS ? '-정착' : '-f0'}`;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

let thrown: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD, bodyVerts: verts,
    minPairDistLite, armAxis: armAxisFromEnv(), ...(ASM1X ? { asm1x: true } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }

/** 정착 blob 읽기 — 두 포장을 다 받는다: 생 float64(굽기 산출) · `[u32 길이][헤더 JSON][페이로드]`(정본). */
function loadPos(path: string, n: number): { pos: Float64Array; 포장: string } {
  const raw = readFileSync(path);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  if (raw.byteLength === n * 24) return { pos: new Float64Array(ab), 포장: '생 float64' };
  const ln = new DataView(ab).getUint32(0, true);
  const hdr = JSON.parse(Buffer.from(raw.subarray(4, 4 + ln)).toString('utf-8')) as { n?: number };
  const body = ab.slice(4 + ln);
  if (hdr.n !== undefined && hdr.n !== n)
    throw new Error(`정착 blob 의 n 이 다르다 — 헤더 ${hdr.n} ≠ 장면 ${n} (${path})`);
  return { pos: new Float64Array(body.slice(0, n * 24)), 포장: `헤더+페이로드(헤더 n ${hdr.n})` };
}

const out: Record<string, unknown> = {
  what: 'v5-23 §1-①② 목선 자의 정의역 사실(측정만 · src 0줄 · 처방 0 · 판단 0)',
  _args: { TAG, CELL, SPEC: SPEC ?? null, ASM1X, POS: POS ?? null, D_MM: D * 1000,
    계기: 'v5NeckRuler.ts', BODY_BIN: process.env.BODY_BIN ?? null,
    ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null, ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  '등재 자': { 'THICK mm': THICK * 1000, 'TOL_SELF mm': TOL_SELF * 1000, 'SEP mm': SEP * 1000,
    'd_rest = THICK+TOL_SELF mm': (THICK + TOL_SELF) * 1000, 'ringExcess 문턱': 1 },
  던짐: thrown,
};

if (P) {
  const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float64Array };
  const S = P.S as unknown as { Y_NECK: number; Y_TOP: number; LEN_NECK: number };
  let pos = sc.s.pos, 포장 = 'f0 조립';
  if (POS) { const r = loadPos(POS, sc.n); pos = r.pos; 포장 = r.포장; }
  const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG,
    h: P.sdfSpec.h, thick: THICK });

  /* ── 게이트 식 그대로 ── */
  const loop = [...P.neckF, ...[...P.neckB].reverse()];
  const pt = (v: number): [number, number, number] => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const closed = (pts: number[][]) => pts.reduce((t, _, k) => {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    return t + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }, 0);
  const polyLen = (ix: number[]) => ix.slice(1).reduce((t, v, k) =>
    t + Math.hypot(pos[v * 3] - pos[ix[k] * 3], pos[v * 3 + 1] - pos[ix[k] * 3 + 1],
                   pos[v * 3 + 2] - pos[ix[k] * 3 + 2]), 0);
  const ringM = closed(loop.map(pt));
  const proj = loop.map((v) => bd.nearestBodyPoint(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
  const ringBodyM = closed(proj as number[][]);
  const ringAllowM = ringBodyM + 2 * Math.PI * (THICK + TOL_SELF);
  const ringExcess = ringM / ringAllowM;
  const ringRestRatio = (polyLen(P.neckF) + polyLen(P.neckB)) / P.ringRest;

  /* ── 정점별 몸 거리 · «얹힘» ── */
  const dists = loop.map((v) => bd.exactBodyDist(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
  const srt = [...dists].sort((a, b) => a - b);
  const q = (p: number) => srt[Math.min(srt.length - 1, Math.floor(srt.length * p))];
  const dRest = THICK + TOL_SELF;
  const 얹힘 = dists.filter((d) => d <= dRest).length;
  const 얹힘SEP = dists.filter((d) => d <= SEP).length;

  /* ── 링 정점 높이 ── */
  const ys = loop.map((v) => pos[v * 3 + 1]);
  const xs = loop.map((v) => pos[v * 3]);
  const iSide = xs.reduce((best, x, k) => (Math.abs(x) > Math.abs(xs[best]) ? k : best), 0);
  const mid = (ix: number[]) => ix[Math.floor(ix.length / 2)];
  const vF = mid(P.neckF), vB = mid(P.neckB);

  /* ── 정점별 신장률(3D 엣지 / 2D 패턴 엣지) ── */
  const uvLen = (a: number, b: number) => Math.hypot(sc.uv[a * 2] - sc.uv[b * 2],
    sc.uv[a * 2 + 1] - sc.uv[b * 2 + 1]);
  const str: number[] = [];
  for (const ix of [P.neckF, P.neckB])
    for (let k = 0; k + 1 < ix.length; k++) {
      const a = ix[k], b = ix[k + 1], L2 = uvLen(a, b);
      if (L2 > 1e-12) str.push(Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1],
                                          pos[a * 3 + 2] - pos[b * 3 + 2]) / L2);
    }
  const ssrt = [...str].sort((a, b) => a - b);
  const sq = (p: number) => ssrt[Math.min(ssrt.length - 1, Math.floor(ssrt.length * p))];

  /* ── 허용의 높이 민감도 dC/dy (링을 y ± 5 mm 강체 이동 · 프롬프트 탐침 폭) ── */
  const allowAt = (dy: number) => {
    const pj = loop.map((v) => bd.nearestBodyPoint(pos[v * 3], pos[v * 3 + 1] + dy, pos[v * 3 + 2]));
    return closed(pj as number[][]) + 2 * Math.PI * (THICK + TOL_SELF);
  };
  const aUp = allowAt(+0.005), aDn = allowAt(-0.005);

  out['장면'] = { n: sc.n, 포장, 'Y_NECK mm': S.Y_NECK * 1000, 'Y_TOP mm': S.Y_TOP * 1000,
    'LEN_NECK mm': S.LEN_NECK * 1000, 'ringRest mm': P.ringRest * 1000, '링 정점 수': loop.length };
  out['게이트 식 재현'] = { '링 cm': ringM * 100, '허용 cm': ringAllowM * 100,
    'ringBody cm': ringBodyM * 100, '초과비': ringExcess,
    'ringRestRatio(판정 아님)': ringRestRatio };
  out['링↔몸 거리 mm'] = { 최소: srt[0] * 1000, p25: q(0.25) * 1000, 중앙: q(0.5) * 1000,
    p75: q(0.75) * 1000, 최대: srt[srt.length - 1] * 1000,
    '평균': (dists.reduce((a, b) => a + b, 0) / dists.length) * 1000 };
  out['얹힘'] = { 'd_rest mm': dRest * 1000, '얹힘 정점': 얹힘, '전체': dists.length,
    '얹힘 비율': 얹힘 / dists.length,
    'SEP 기준 정점': 얹힘SEP, 'SEP 기준 비율': 얹힘SEP / dists.length };
  out['링 높이 mm'] = { 최소: Math.min(...ys) * 1000, 최대: Math.max(...ys) * 1000,
    '앞(neckF 중앙)': pos[vF * 3 + 1] * 1000, '뒤(neckB 중앙)': pos[vB * 3 + 1] * 1000,
    '옆(|x| 최대)': pos[loop[iSide] * 3 + 1] * 1000,
    'Y_NECK 대비 중앙': (ys.reduce((a, b) => a + b, 0) / ys.length - S.Y_NECK) * 1000 };
  out['신장률(3D/2D 패턴)'] = { 엣지: str.length, 최소: ssrt[0], p25: sq(0.25), 중앙: sq(0.5),
    p75: sq(0.75), 최대: ssrt[ssrt.length - 1],
    '1.0 초과 엣지 비율': str.filter((x) => x > 1).length / str.length };
  out['허용 높이 민감도'] = { '허용(+5mm) cm': aUp * 100, '허용(0) cm': ringAllowM * 100,
    '허용(−5mm) cm': aDn * 100, 'dC/dy cm per 10mm': (aUp - aDn) * 100,
    '초과비(+5mm)': ringM / aUp, '초과비(−5mm)': ringM / aDn };
}
writeFileSync(`gpu/oracle/export/v5-23-neck-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
