/* v4-10 §1-② — **게이트 판정** 다리. `runS4Gate` 를 «그대로» 부른다(물리 0스텝 · 새 실행 0).
 *
 * 인용 자리:
 * ```
 *  문턱   — `src/v3/s4Gate.ts:47-57` `S4_THRESHOLD`
 *           penMaxM 5e-4 · crossings 0 · ringExcess 1 · settleNetM = TOL_SELF(1e-4) · pinned 0
 *  판정   — `src/v3/s4Gate.ts:142-148` (fails 를 쌓고 `pass = fails.length === 0`)
 *  창 정의 — `src/v3/s4Gate.ts:73` `N_WIN = round(1/(DAMP·DT))` = 10
 * ```
 * ★ **정착 채널만 «인용»으로 낸다** — `runS4Gate(P, before)` 의 `before` 는 10프레임 «전» 위치인데,
 *   v3@180 의 f=170 위치는 v4-09 산출물에 없다. 그런데 그 창 순변위는 **이미 측정돼 있고**
 *   (`cellconv9-…-e0-sum.json` 의 `trailAll` · v4 는 `l3dom-…json` 의 `trail`) **식이 같다**
 *   (`s4Gate.ts:133-137` = `v4CellConverge.ts:80-86` = `l3_dom.py` — max |pos − ref|).
 *   ⟹ `NET=<m>` 으로 그 수를 넣고, 문턱 비교는 `S4_THRESHOLD.settleNetM` 에서 «뜬다»(손 상수 0).
 *
 * 진입: `POS=<float64 3n bin> [HDR=1] NET=<m> [TAG=…] npx tsx scripts/v4ProductGate.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { runS4Gate, S4_THRESHOLD, N_WIN } from '../src/v3/s4Gate.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SRC = 'public/v3diag/v3-77';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const D = Number(process.env.D_MM ?? 9) / 1000;

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
/* v4-24 §1-② — 몸 인자(기본값 그대로 ⟹ 기존 호출 바이트 불변 · 사유는 `v4FitReport.ts` 와 같다) */
const BODY_BIN = process.env.BODY_BIN ?? `${SRC}/body-${c.bodyId}.bin`;
const bb = readFileSync(BODY_BIN);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), armAxis: armAxisFromEnv(),
                    bodyVerts: verts, minPairDistLite });
const n = P.sc.n;

const rawBuf = readFileSync(process.env.POS!);
let pos: Float64Array;
if (process.env.HDR === '1') {
  const dv = new DataView(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
  const hl = dv.getUint32(0, true);
  pos = new Float64Array(rawBuf.buffer.slice(rawBuf.byteOffset + 4 + hl,
                                             rawBuf.byteOffset + 4 + hl + n * 3 * 8));
} else {
  pos = new Float64Array(rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + n * 3 * 8));
}
if (pos.length !== n * 3) throw new Error(`위치 길이 ${pos.length} ≠ ${n * 3}`);
P.sc.s.pos.set(pos);

const r = runS4Gate(P);
const net = process.env.NET ? Number(process.env.NET) : NaN;
const settled = net <= S4_THRESHOLD.settleNetM;
const fails = [...r.fails];
if (Number.isFinite(net) && !settled)
  fails.push(`정착 창 순변위 ${(net * 1000).toFixed(4)}mm > ${(S4_THRESHOLD.settleNetM * 1000).toFixed(1)}mm`);

const out = {
  what: 'v4-10 §1-② 게이트 다리 — runS4Gate(물리 0스텝)',
  cell: CELL, tag: TAG, pos: process.env.POS, N_WIN, 문턱: S4_THRESHOLD,
  채널: {
    '③a 관통 최대 mm': r.penMaxM * 1000, 관통정점수: r.penCnt,
    '자기관통 교차': r.crossings, '최소 쌍거리 mm': r.minPairM * 1000,
    '목선 초과비': r.ringExcess, '링 cm': r.ringM * 100, '허용 cm': r.ringAllowM * 100,
    '보조 장치(invMass=0)': r.pinned, 발산: r.diverged,
    '봉제 간극 중앙 mm': r.seamMedM * 1000, '봉제 간극 최대 mm': r.seamMaxM * 1000,
    'λ 최대': r.lambdaMax,
  },
  정착: { '창 순변위 m(인용)': net, '창 순변위 mm': net * 1000,
          문턱mm: S4_THRESHOLD.settleNetM * 1000, 통과: settled },
  fails, pass: fails.length === 0,
};
writeFileSync(`gpu/oracle/export/l3-gate-${CELL}-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
