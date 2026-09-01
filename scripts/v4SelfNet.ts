/* v4-14 §1-③ㅂ — **v3 «정본» 상태의 정착 채널**(게이트 다리에 넣을 `NET`)을 «잰다».
 *
 * 게이트의 정착 항은 «창 순변위»인데(`s4Gate.ts:73` N_WIN = 10), 정본 blob 이 만들어질 때의
 * 그 값은 산출물로 남아 있지 않다(v4-07 의 `cellconv7-…` 궤적은 **셀프 충돌 «없는»** 경로다).
 * 그래서 **정본 경로 그대로**(제약 all + 몸 충돌 + 셀프 충돌 · `dressRun.ts:118-121` 인자) 로
 * blob 에서 **10프레임 앞으로** 돌려 `max_v |pos_v − blob_v|` 를 낸다.
 * ★ 이것은 **«전방» 창**이다(`runS4Gate` 의 후방 창이 아니다). v4 쪽 `NET` 도 같은 판 §1-③ 의
 *   **첫 창**(blob → f=10)이므로 **두 값은 같은 뜻으로 마주 선다**. 그 사실을 그대로 등재한다.
 *
 * 진입: `[CELL=…] [FRAMES=10] npx tsx scripts/v4SelfNet.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT, G, THICK } from '../src/v3/consts.ts';
import { step, selfStats, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { V3CONST } from '../src/v3/dressRun.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const FRAMES = Number(process.env.FRAMES ?? 10);
const D = Number(process.env.D_MM ?? 9) / 1000;

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
const ref = Float64Array.from(sc.s.pos);

const cons: Constraint[] = sc.cons;
const params = {                                   // dressRun.ts:118-121 그대로(램프는 끝난 자리)
  dt: DT, substeps: P.SUB, gravity: G, damping: V3CONST.DAMP,
  collision: P.params.collision,
  selfCollision: { tris: sc.tris, thickness: THICK, every: 1 },
};
const t0 = Date.now();
let pen = 0, pairs = 0, res = 0;
for (let f = 1; f <= FRAMES; f++) {
  selfStats.fill(0);
  step(sc.s, cons, params);
  pairs += selfStats[0]; res += selfStats[1]; pen = Math.max(pen, selfStats[2]);
  console.log(`  v3(정본 경로) f=${f} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
              `근접쌍 ${selfStats[0]} · 해소 ${selfStats[1]}`);
}
let net = 0;
for (let v = 0; v < sc.n; v++)
  net = Math.max(net, Math.hypot(sc.s.pos[v * 3] - ref[v * 3], sc.s.pos[v * 3 + 1] - ref[v * 3 + 1],
                                 sc.s.pos[v * 3 + 2] - ref[v * 3 + 2]));
const meta = { what: 'v4-14 §1-③ㅂ — v3 정본 경로의 «전방» 10프레임 창 순변위', cell: CELL,
  n: sc.n, m: cons.length, substeps: P.SUB, frames: FRAMES, blobFrame: bh.frame,
  netM: net, netMm: net * 1000, 근접쌍_프레임당: pairs / FRAMES, 해소_프레임당: res / FRAMES,
  최대침투m: pen, ms: Date.now() - t0 };
writeFileSync(`${OUT}/l3sc-v3net-${CELL}.bin`, Buffer.from(sc.s.pos.buffer, sc.s.pos.byteOffset, nb));
writeFileSync(`${OUT}/l3sc-v3net-${CELL}.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
