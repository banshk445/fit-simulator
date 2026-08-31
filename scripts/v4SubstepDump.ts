/* v4-12 §1-② «보조 채널» — 프레임 «밑»으로 내려간 주사. 한 프레임 = **229 서브스텝**이므로
 * `f=1` 은 「1스텝」이 아니다(등재 갈래의 이름과 정의역이 어긋나는 자리 · §1-② 주의).
 * 이 스크립트는 **서브스텝 경계마다** v3 위치를 덤프한다.
 *
 * 물리 경로 인용은 `v4FrameDump.ts` 와 같다. 바뀐 것은 «부르는 단위» 하나뿐:
 *   `step(s, cons, {dt: DT/SUB, substeps: 1, …})` — `solver.ts:1050` 이 `h = dt/substeps` 이므로
 *   이것이 **정확히 한 서브스텝**이다(`:1053` 루프가 1회전). 반복 호출로 서브스텝을 센다.
 * ★ 주의(사실) — 이 규약의 h 는 `f64(DT/229)` 이고 본 실행의 h 도 `DT/229` 다(같은 식).
 *   v4 쪽은 인자가 f32 로 내려가므로 h 가 **f32 로 반올림된 같은 값**이다(≤1 ULP).
 *
 * 산출 = `gpu/oracle/export/l3sub-v3-<CELL>.bin` — [4B][헤더 JSON][K × n × 3 f64] (K = SUBS 개수)
 * 진입: `[CELL=…] [SUBS=0,1,2,4,8,16,32,64,128,229] npx tsx scripts/v4SubstepDump.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT, DAMP, G } from '../src/v3/consts.ts';
import { step, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const SUBS = (process.env.SUBS ?? '0,1,2,4,8,16,32,64,128,229').split(',').map(Number);
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
const nb = sc.n * 3 * 8;
sc.s.pos.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb)));
sc.s.vel.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl + nb, raw.byteOffset + 4 + hl + 2 * nb)));

const cons: Constraint[] = sc.cons;
const SUB = P.SUB;
const params = { dt: DT / SUB, substeps: 1, gravity: G, damping: DAMP, collision: P.params.collision };
const want = [...SUBS].sort((a, b) => a - b);
const dump = new Float64Array(want.length * sc.n * 3);
let done = 0;
const t0 = Date.now();
for (let s = 0; s <= want[want.length - 1]; s++) {
  if (s > 0) step(sc.s, cons, params);
  if (want.includes(s)) { dump.set(sc.s.pos, done * sc.n * 3); done++; }
}
const ms = Date.now() - t0;
const hdr = { what: 'v4-12 §1-② 보조 — v3(f64) 서브스텝 경계 덤프', cell: CELL, n: sc.n,
              m: cons.length, substepsPerFrame: SUB, subs: want, dtSub: DT / SUB, DT, DAMP, G,
              blobFrame: bh.frame, ms };
const hbb = Buffer.from(JSON.stringify(hdr), 'utf8');
const hd = Buffer.alloc(4); hd.writeUInt32LE(hbb.length, 0);
writeFileSync(`${OUT}/l3sub-v3-${CELL}.bin`, Buffer.concat([hd, hbb, Buffer.from(dump.buffer)]));
console.log(`v3 서브스텝 덤프 · ${want.join(',')} · ${ms}ms → ${OUT}/l3sub-v3-${CELL}.bin`);
