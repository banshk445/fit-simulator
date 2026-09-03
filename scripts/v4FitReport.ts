/* v4-06 §1-④ — **층3(관측량) 첫 시행**. 핏 리포트 5행을 **v3 계산 경로로** 낸다.
 *
 * 이 스크립트에 리포트 «식»은 **0줄**이다 — `src/v3/fitReport.ts:56 buildFitReport(P, L)` 를
 * 그대로 부른다(v3-52 §1-4 정본 · **물리 0프레임 · 읽기만**). 화면(v3 패널)과 «같은 모듈»이다(함정 22).
 *
 * 입력 위치는 셋 중 하나다:
 *   `POS=<파일>`  — float64 3n 나열(내가 낸 최종 상태). v4 산출도, v3 산출도 여기로 들어온다
 *   (없으면)      — 정답지 blob `settled-<cell>.bin` 의 정착 위치(= **v3 정본**)
 * ⟹ **같은 계산 경로에 상태만 갈아 끼운다** — 리포트 차이는 «상태 차이»뿐이다.
 *
 * 진입: `[CELL=…] [POS=…] [TAG=…] npx tsx scripts/v4FitReport.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { deriveLevels } from '../src/v3/bodyLevels.ts';
import { buildFitReport } from '../src/v3/fitReport.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const POS = process.env.POS ?? null;
const TAG = process.env.TAG ?? (POS ? 'pos' : 'v3정본');
const D = Number(process.env.D_MM ?? 9) / 1000;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
/* v4-24 §1-② — **몸을 갈아 끼울 수 있게** 인자 하나를 연다(기본값은 «그대로» ⟹ 기존 호출 바이트 불변).
 * 근거: A포즈 상태를 T포즈 그리드 몸으로 재면 «다른 몸»의 대역·SDF 로 재는 것이라 수가 뜻을 잃는다. */
const BODY_BIN = process.env.BODY_BIN ?? `${SRC}/body-${c.bodyId}.bin`;
const bb = readFileSync(BODY_BIN);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const n = P.sc.n;

let pos: Float64Array;
if (POS) {
  const b = readFileSync(POS);
  pos = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 0, n * 3);
  /* v4-24 — **길이가 «다르면» 던진다**(구 판은 짧을 때만 던져 «긴» 파일을 조용히 잘라 썼다 ·
   * A포즈 9644 를 T포즈 9388 로 자른 사고가 이 판에서 실측됐다 — 조용한 성공 0). */
  if (b.byteLength !== n * 3 * 8) throw new Error(`위치 파일 길이가 다르다 — ${b.byteLength} ≠ ${n * 3 * 8}(정점 ${n})`);
} else {
  const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  pos = new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + n * 3 * 8));
}
P.sc.s.pos.set(pos);

const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);
const R = buildFitReport(P, L);
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : 'NaN');
console.log(`[핏 리포트 · ${CELL} · ${TAG}] 정점 ${n} · 물리 0프레임 · 경계 ${R.sepMm.toFixed(1)}mm`);
console.log(`  높이 chestY ${R.levels.chestYCm.toFixed(2)}cm · waistY ${R.levels.waistYCm.toFixed(2)}cm`);
for (const r of R.rows)
  console.log(`  ${r.name.padEnd(4)} 중앙 ${f(r.medMm).padStart(10)}  p25 ${f(r.p25Mm).padStart(10)}  p75 ${f(r.p75Mm).padStart(10)}  눌림/밀착/여유 ${r.pressN}/${r.snugN}/${r.looseN}  표본 ${r.n}/${r.domain}`);
writeFileSync(`${OUT}/fit-${CELL}-${TAG}.json`, JSON.stringify({
  cell: CELL, tag: TAG, n, sepMm: R.sepMm, bandHalfMm: R.bandHalfMm, levels: R.levels,
  rows: R.rows.map((r) => ({ name: r.name, n: r.n, domain: r.domain,
    p25Mm: r.p25Mm, medMm: r.medMm, p75Mm: r.p75Mm,
    pressN: r.pressN, snugN: r.snugN, looseN: r.looseN })),
}, null, 1));
console.log(`  → ${OUT}/fit-${CELL}-${TAG}.json`);
