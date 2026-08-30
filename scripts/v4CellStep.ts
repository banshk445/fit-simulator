/* v4-02 §1-③ㄴ — **정답지 1칸에 «늘어남만» 한 스텝**(v3 쪽 정답 · 물리 코어 diff 0).
 *
 * 「늘어남만 1스텝」의 정의(집행 «전»에 고정):
 *   · 초기값 = 그 칸의 **정착 blob 위치**(`settled-<id>.bin` 의 앞 3n) · **속도는 0 으로 둔다**
 *   · `step()` 을 **중력 0 · 감쇠 0 · substeps 1 · dt = DT/SUB** 로 부른다 ⟹
 *     예측 단계가 위치를 **한 톨도 안 바꾸고**(v=0, g=0), λ 초기화 뒤 **`inplane` 투영 «1회»**만 돈다.
 *     h 는 그 장면의 **실제** 서브스텝 h(= DT/SUB) 다 — α̃ = α/h² 가 실제 값이어야 하므로.
 *   · 제약 배열은 **`inplane` 만** 넘긴다(굽힘·봉제 0개) ⟹ 「늘어남만」이 구조로 보장된다.
 * v3 의 `step()`·`projectInplane` 을 **그대로** 부른다 — 이 스크립트에 물리 식은 0줄이다.
 *
 * 진입: `[CELL=c100-h170-s45_M] npx tsx scripts/v4CellStep.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT } from '../src/v3/consts.ts';
import { step, type Constraint } from '../src/v3/solver.ts';
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

/* 정착 blob — 헤더를 읽고 «앞 3n» 이 위치다(`dressRun.stateBlob` 순서). */
const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const bh = JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl)));
if (bh.n !== sc.n) throw new Error(`정점 수가 다르다 — blob ${bh.n} ≠ 조립 ${sc.n}`);
const nb = sc.n * 3 * 8;
const settled = new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb));

sc.s.pos.set(settled);
sc.s.vel.fill(0);                                    // 「늘어남만」 — 관성·중력을 뺀다
const before = Float64Array.from(sc.s.pos);
const inplane = sc.cons.filter((x: Constraint) => x.kind === 'inplane');
const h = DT / P.SUB;
step(sc.s, inplane, { dt: h, substeps: 1, gravity: 0, damping: 0 });

const hdr = { cell: CELL, n: sc.n, m: inplane.length, substeps: P.SUB, h, d: D,
              blobFrame: bh.frame, blobD: bh.d, k: FABRICS.gray.k,
              note: 'v4-02 §1-③ㄴ · 정착 위치에 inplane 투영 1회(중력 0 · 감쇠 0 · 속도 0)' };
const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
writeFileSync(`${OUT}/cellstep-${CELL}.bin`,
  Buffer.concat([head, hb, Buffer.from(before.buffer), Buffer.from(sc.s.pos.buffer)]));
let mx = 0, dmax = 0;
for (let i = 0; i < sc.n * 3; i++) {
  if (Math.abs(before[i]) > mx) mx = Math.abs(before[i]);
  const dd = Math.abs(sc.s.pos[i] - before[i]); if (dd > dmax) dmax = dd;
}
console.log(`${CELL} n=${sc.n} m=${inplane.length} sub=${P.SUB} h=${h.toExponential(12)}`);
console.log(`투영 변위 최대 ${dmax.toExponential(9)} m · 최대|좌표| ${mx.toFixed(9)}`);
