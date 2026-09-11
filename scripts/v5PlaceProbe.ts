/* v5-9 §1-② — **조립 «시작 자세»의 자리**(측정만 · `src/` 0줄 · 굽기 0 · 물리 0프레임 · 판정 0).
 *
 * 새 계기를 만들지 않는다 — v3-90 §1-① 이 `garmentScene.ts:559` 에 박아 둔 **인쇄 «전용» 계기**
 * `globalThis.__v3clampProbe` 를 받는다. 그 자리는 배치 둘레를 정하는 식
 *   `SCALES[k] = Math.max(1, need / base)` · `need = 4·panelHalfWidth(py) + 2·GAP_SIDE` ·
 *   `base = perimOf(boundaryOf(HSUP_Y[k], δ, 1))`  ← 그 높이 «몸» 단면 볼록 껍질(δ 부풀림)의 둘레
 * 이다(`:552-563`). **클램프 발화 = `need < base`** ⟹ 그 높이에서 패널은 «자기가 요구하는 둘레»가
 * 아니라 **«몸 실루엣 둘레»** 에 놓인다(v3-21 주석 「몸을 비우되 필요한 만큼만 벌어진다」).
 *
 * `rebuildSurface` 는 δ 이분법 동안 여러 번 불린다 ⟹ **마지막 호출분만** 남긴다(= 최종 δ).
 * 목선 링 둘레는 `s4Gate.ts:118-123` 의 닫힌 고리 정의를 그대로 쓴다(v5-8 §1-① 과 같은 자).
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5PlaceProbe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Probe = { k: number; need: number; base: number; ratio: number; GAP_SIDE: number; delta: number;
               base_d1: number; base_d2: number; base_d5: number };
const seen = new Map<number, Probe>();
(globalThis as unknown as { __v3clampProbe?: (r: Probe) => void }).__v3clampProbe = (r) => seen.set(r.k, r);

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';
/* ★ 계기는 `prepare()` «호출 전»에 전역을 꽂는다 — `scalesFor` 가 «호출 시점»에 읽으므로
 * 정적 import 로도 충분하다(모듈 평가 순서와 무관). 동작 0 · 반환값 불변. */

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const P = prepare({ glb, fabric: FABRICS.gray, d: D,
  garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
  bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
  minPairDistLite, armAxis: armAxisFromEnv() });
const S = P.S as unknown as { Y_TOP: number; Y_HEM: number };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array } };
const p0 = sc.s.pos;

/* 목선 링 — 닫힌 고리(`s4Gate.ts:118-123` 인용) · f0(물리 0프레임) 둘레와 rest */
const ring = [...(P.neckF as number[]), ...[...(P.neckB as number[])].reverse()];
let ringF0 = 0;
for (let q = 0; q < ring.length; q++) {
  const a = ring[q], b = ring[(q + 1) % ring.length];
  ringF0 += Math.hypot(p0[a * 3] - p0[b * 3], p0[a * 3 + 1] - p0[b * 3 + 1], p0[a * 3 + 2] - p0[b * 3 + 2]);
}
const rows = [...seen.values()].sort((a, b) => a.k - b.k);
const NY = rows.length;
const yOf = (k: number) => S.Y_HEM + ((S.Y_TOP - S.Y_HEM) * k) / (NY - 1);
const out = {
  what: 'v5-9 §1-② 배치 둘레의 클램프 자리(인쇄 전용 계기 수신 · 판정 0)',
  _args: { BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null, SPEC: SPEC ?? null, CELL,
    D_MM: process.env.D_MM ?? null, 계기: import.meta.url.split('/').pop() },
  'Y_TOP m': S.Y_TOP, 'Y_HEM m': S.Y_HEM, NY, SEP, n: sc.n,
  '목선 링 f0 cm': ringF0 * 100, '목선 링 정점': ring.length,
  '클램프 발화 높이 수': rows.filter((r) => r.need < r.base).length,
  rows: rows.map((r) => ({ k: r.k, 'y m': yOf(r.k), 'need cm': r.need * 100, 'base cm': r.base * 100,
    ratio: r.ratio, '클램프 발화': r.need < r.base, 'delta mm': r.delta * 1000,
    'base(δ+1mm) cm': r.base_d1 * 100, 'base(δ+5mm) cm': r.base_d5 * 100 })),
};
writeFileSync(`gpu/oracle/export/v5-9-place-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
