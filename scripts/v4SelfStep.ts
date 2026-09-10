/* v4-14 §1-① — **v3 의 셀프 충돌만 «1서브스텝»** 적용해 그 자리 상태를 낸다(층1 의 v3 쪽).
 *
 * 물리 경로는 `src/v3/solver.ts:step` 을 **그대로** 부른다(`src/` 0줄 · 셀프 충돌 코드 인용 0줄).
 * 「셀프 충돌만」을 만드는 방법도 **인자로만** 한다(§0-5ㅁ):
 * ```
 *   cons = []            ⟹ 제약 투영 0(solver.ts:1088-1112 의 루프가 비어 돈다)
 *   collision 없음        ⟹ 몸 충돌 «한 줄도» 안 돈다(solver.ts:1128)
 *   gravity 0 · vel 0     ⟹ 예측이 위치를 «안 바꾼다»(solver.ts:1049-1053 · prev = pos)
 *   damping 0 · substeps 1 ⟹ 속도 갱신은 위치를 안 바꾼다(solver.ts:1134-1141)
 *   selfCollision = 정본 인자(dressRun.ts:120) — tris · thickness THICK · every 1 · iterations 기본 1
 * ```
 * ⟹ `step` 뒤 위치의 «차»는 **셀프 충돌 해소분 하나뿐**이다.
 *
 * 산출 = `gpu/oracle/export/l3sc-v3-<CELL>.bin`  — 헤더 없는 float64 3n(적용 «후» 위치)
 *        `gpu/oracle/export/l3sc-v3-<CELL>-pre.bin` — 적용 «전» 위치(= blob 원본 · 대조 기준)
 *        `gpu/oracle/export/l3sc-v3-<CELL>-tris.bin` — int32 3T(v4 가 **같은 삼각형 배열**을 쓰게)
 *        `gpu/oracle/export/l3sc-v3-<CELL>.json`  — selfStats · T · thickness · sep
 * 진입: `[CELL=…] npx tsx scripts/v4SelfStep.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, THICK, SEP } from '../src/v3/consts.ts';
import { step, selfStats, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const D = Number(process.env.D_MM ?? 9) / 1000;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc;

const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const bh = JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl)));
if (bh.n !== sc.n) throw new Error(`정점 수가 다르다 — blob ${bh.n} ≠ 조립 ${sc.n}`);
const nb = sc.n * 3 * 8;
sc.s.pos.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb)));
sc.s.vel.fill(0);                                    // 예측이 위치를 안 바꾸게(§0-5ㅁ)

const pre = Float64Array.from(sc.s.pos);
const tris = Int32Array.from(sc.tris as ArrayLike<number>);
const T = tris.length / 3;

const cons: Constraint[] = [];                       // 제약 투영 0
const params = { dt: 1 / 60, substeps: 1, gravity: 0, damping: 0,
                 selfCollision: { tris: sc.tris, thickness: THICK, every: 1 } };
selfStats.fill(0);
const t0 = Date.now();
step(sc.s, cons, params);
const ms = Date.now() - t0;

let moved = 0, maxD = 0;
for (let v = 0; v < sc.n; v++) {
  const d = Math.hypot(sc.s.pos[v * 3] - pre[v * 3], sc.s.pos[v * 3 + 1] - pre[v * 3 + 1],
                       sc.s.pos[v * 3 + 2] - pre[v * 3 + 2]);
  if (d > 0) moved++;
  if (d > maxD) maxD = d;
}
const meta = {
  what: 'v4-14 §1-① — v3 셀프 충돌만 1서브스텝', cell: CELL, n: sc.n, T,
  thickness: THICK, sep: SEP, blobFrame: bh.frame, ms,
  근접쌍: selfStats[0], 해소횟수: selfStats[1], 최대침투m: selfStats[2],
  광역ms: selfStats[3], 협역ms: selfStats[4], 해소ms: selfStats[5],
  움직인정점: moved, 최대변위m: maxD,
};
writeFileSync(`${OUT}/l3sc-v3-${CELL}-pre.bin`, Buffer.from(pre.buffer));
writeFileSync(`${OUT}/l3sc-v3-${CELL}.bin`, Buffer.from(sc.s.pos.buffer, sc.s.pos.byteOffset, nb));
writeFileSync(`${OUT}/l3sc-v3-${CELL}-tris.bin`, Buffer.from(tris.buffer));
writeFileSync(`${OUT}/l3sc-v3-${CELL}.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
console.log(`  → ${OUT}/l3sc-v3-${CELL}.bin / -pre.bin / -tris.bin / .json`);
