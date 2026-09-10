/* v4-13 §1-② — **v3 를 «지정한 프레임 F»까지** 돌려 그 자리의 위치를 낸다(물리 코어 diff 0 · `src/` 0줄).
 *
 * 물리 경로는 `scripts/v4CellConverge.ts` 와 **같은 것**을 인용한다(새 수 0):
 *   `prepare()` · 제약 집합 `all`(= `sc.cons`) · `params = {dt: DT, substeps: P.SUB, gravity: G,
 *   damping: DAMP, collision: P.params.collision}` · 초기 상태 = `settled-<cell>.bin` 의 위치·속도 전량 ·
 *   창 순변위 = `max_v |pos_v − ref_v|` · 창 = `dressRun.ts:N_WIN` · 문턱 = `s4Gate.ts:settleNetM`.
 *   자기충돌 «없다»(v4 이식 0 · 정의역 일치).
 *
 * 이 파일이 «더» 하는 것은 둘뿐(§0-5ㅁ):
 *   ① 프레임 수를 **밖에서 못 박는다**(F = v4 가 문턱에 도달한 프레임) — 수렴 여부와 무관하게 F 에서 멈춘다.
 *   ② 산출을 **헤더 없는 raw float64 3n** 으로 낸다 — `v4FitReport.ts` 의 `POS=` 가
 *      헤더를 건너뛰지 않으므로(그 파일 39-43행) v4 쪽 `.bin` 과 «같은 모양»이어야 대조가 대칭이 된다.
 *
 * 산출 = `gpu/oracle/export/l3conv-v3-<CELL>-f<F>.bin` / `.json`
 * 진입: `[CELL=…] F=80 npx tsx scripts/v4FrameAt.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT, DAMP, G } from '../src/v3/consts.ts';
import { step, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { N_WIN } from '../src/v3/dressRun.ts';
import { S4_THRESHOLD } from '../src/v3/s4Gate.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const F = Number(process.env.F ?? 80);
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
sc.s.vel.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl + nb, raw.byteOffset + 4 + hl + 2 * nb)));

const cons: Constraint[] = sc.cons;                       // KIND = 'all'
const params = { dt: DT, substeps: P.SUB, gravity: G, damping: DAMP, collision: P.params.collision };
const kinds: Record<string, number> = {};
for (const x of cons) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;

const netOf = (ref: Float64Array) => {
  let net = 0;
  for (let v = 0; v < sc.n; v++)
    net = Math.max(net, Math.hypot(sc.s.pos[v * 3] - ref[v * 3], sc.s.pos[v * 3 + 1] - ref[v * 3 + 1],
                                   sc.s.pos[v * 3 + 2] - ref[v * 3 + 2]));
  return net;
};

console.log(`[v3 F프레임] ${CELL} · n ${sc.n} · m ${cons.length} ${JSON.stringify(kinds)} · `
          + `substeps ${P.SUB} · F ${F} · N_WIN ${N_WIN} · tol ${S4_THRESHOLD.settleNetM}`);
const t0 = Date.now();
let ref = Float64Array.from(sc.s.pos);
let net = NaN, convFrame = -1, convNet = NaN;
const trail: Array<[number, number]> = [];
for (let f = 1; f <= F; f++) {
  step(sc.s, cons, params);
  if (!Number.isFinite(sc.s.pos[0])) throw new Error(`발산 — 프레임 ${f}`);
  if (f % N_WIN === 0) {
    net = netOf(ref);
    trail.push([f, net]);
    if (convFrame < 0 && net <= S4_THRESHOLD.settleNetM) { convFrame = f; convNet = net; }
    console.log(`  v3 f=${f} net=${net.toExponential(6)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    ref = Float64Array.from(sc.s.pos);
  }
}
const ms = Date.now() - t0;
const name = `l3conv-v3-${CELL}-f${F}`;
writeFileSync(`${OUT}/${name}.bin`, Buffer.from(sc.s.pos.buffer, sc.s.pos.byteOffset, nb));
const meta = { what: 'v4-13 §1-② — v3 를 지정 프레임 F 까지', cell: CELL, kind: 'all',
  n: sc.n, m: cons.length, kinds, substeps: P.SUB, F, N_WIN, tol: S4_THRESHOLD.settleNetM,
  DT, DAMP, G, d: D, THICK: P.params.collision!.thickness, MU: P.params.collision!.mu,
  blobFrame: bh.frame, lastNet: net, convFrame, convNet, ms, msPerFrame: ms / F, trail };
writeFileSync(`${OUT}/${name}.json`, JSON.stringify(meta, null, 1));
console.log(`[v3] F=${F} · 마지막 창 순변위 ${net.toExponential(6)} · 수렴 ${convFrame > 0 ? `f${convFrame} (${convNet.toExponential(6)})` : '미도달'} · ${ms}ms (${(ms / F).toFixed(0)}ms/프레임)`);
console.log(`  → ${OUT}/${name}.bin / .json`);
