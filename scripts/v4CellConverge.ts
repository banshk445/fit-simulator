/* v4-05 §1-①② — **정답지 1칸(구속계)의 층2 v3 정답**(물리 코어 diff 0 · `src/` 0줄).
 *
 * v4-04 가 값으로 배운 것: **자유 합성계는 평형이 유일하지 않다**(함정 40) ⟹ 층2 시험계를
 * **정답지 한 칸**으로 바꾼다. 이 계는 고정점이 **0개**이고 옷을 붙드는 것은
 * **몸 충돌 + 쿨롱 마찰**뿐이라, 「강체 모드를 구속하는가」를 정면으로 묻는다.
 *
 * 초기 상태 = `settled-<cell>.bin` 의 **위치·속도 전량**(v3 가 저장한 그대로).
 * 제약 부분집합 = `CONS=inplane|bend|both` — **봉제(`dist`)는 v4 에 아직 이식이 없어 뺀다.**
 *   v3 쪽도 «같은 부분집합»으로 돌린다(정의역을 맞춘다). 이 차이는 §0-7 에 등재돼 있다.
 * 충돌은 `prepare()` 가 만든 `P.params.collision` 을 **그대로** 쓴다(격자 SDF + THICK + MU).
 * 자기충돌은 **넣지 않는다** — v4 에 이식이 없다(정의역 일치).
 *
 * 수렴 판정은 v3 인용(새 수 0):
 *   `dressRun.ts:N_WIN` = round(1/(DAMP·DT)) = 10 · `s4Gate.ts:settleNetM` = `TOL_SELF` = 1e-4 m ·
 *   창 순변위 = `max_v |pos_v − ref_v|`(`runFrames` 의 식)
 *
 * 진입: `[CELL=…] [CONS=both] [CAP=2000] [PERTURB=1e-7] [FRAMES=n(강제 프레임 · 비용 측정용)]
 *        npx tsx scripts/v4CellConverge.ts`
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
const KIND = (process.env.CONS ?? 'both') as 'inplane' | 'bend' | 'both' | 'all';
const CAP = Number(process.env.CAP ?? 2000);
const PERTURB = Number(process.env.PERTURB ?? 0);
const FORCE = process.env.FRAMES ? Number(process.env.FRAMES) : 0;   // 비용 측정용(수렴 무시)
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

/* 정착 blob — 위치 3n + 속도 3n(`dressRun.stateBlob` 순서) */
const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const bh = JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl)));
if (bh.n !== sc.n) throw new Error(`정점 수가 다르다 — blob ${bh.n} ≠ 조립 ${sc.n}`);
const nb = sc.n * 3 * 8;
sc.s.pos.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb)));
sc.s.vel.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl + nb, raw.byteOffset + 4 + hl + 2 * nb)));

/* 섭동 — 자유 정점 «전량»의 x 에 +PERTURB(강체 병진 · v4-04 와 같은 정의 · §0-5 등재) */
let nFree = 0;
for (let v = 0; v < sc.n; v++) if (sc.s.invMass[v] !== 0) { nFree++; if (PERTURB !== 0) sc.s.pos[v * 3] += PERTURB; }

/* 'all' = 봉제(dist)까지 «전량» — v4 에 이식이 없어 대조에는 못 쓰고, **구속 여부 확인 전용**이다. */
const cons: Constraint[] = KIND === 'all' ? sc.cons
  : KIND === 'both' ? sc.cons.filter((x: Constraint) => x.kind !== 'dist')
  : sc.cons.filter((x: Constraint) => x.kind === KIND);
const params = { dt: DT, substeps: P.SUB, gravity: G, damping: DAMP, collision: P.params.collision };

const netOf = (ref: Float64Array) => {
  let net = 0;
  for (let v = 0; v < sc.n; v++)
    net = Math.max(net, Math.hypot(sc.s.pos[v * 3] - ref[v * 3], sc.s.pos[v * 3 + 1] - ref[v * 3 + 1],
                                   sc.s.pos[v * 3 + 2] - ref[v * 3 + 2]));
  return net;
};

const t0 = Date.now();
let ref = Float64Array.from(sc.s.pos);
let frame = 0, net = Infinity, converged = false;
const trail: Array<[number, number]> = [];
const LIMIT = FORCE || CAP;
while (frame < LIMIT) {
  step(sc.s, cons, params);
  frame++;
  if (!Number.isFinite(sc.s.pos[0])) throw new Error(`발산 — 프레임 ${frame}`);
  if (frame % N_WIN === 0) {
    net = netOf(ref);
    trail.push([frame, net]);
    if (!FORCE && net <= S4_THRESHOLD.settleNetM) { converged = true; break; }
    ref = Float64Array.from(sc.s.pos);
  }
}
const ms = Date.now() - t0;

const hdr = {
  what: `v4-05 §1 층2 구속계 — v3 정답 (${CELL} · ${KIND})`, cell: CELL, kind: KIND,
  n: sc.n, m: cons.length, nFree, substeps: P.SUB, d: D, G, DT, DAMP,
  k: FABRICS.gray.k, ke: FABRICS.gray.B, rho: FABRICS.gray.rho,
  THICK: P.params.collision!.thickness, MU: P.params.collision!.mu,
  N_WIN, tol: S4_THRESHOLD.settleNetM, frames: frame, converged, net, cap: LIMIT,
  perturb: PERTURB, forced: FORCE, blobFrame: bh.frame, ms,
  trail: trail.filter((_, i) => i < 8 || i % 10 === 0 || i === trail.length - 1),
};
const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
const suffix = `${KIND}${PERTURB !== 0 ? '-p' : ''}`;
writeFileSync(`${OUT}/cellconv-${CELL}-${suffix}.bin`,
  Buffer.concat([head, hb, Buffer.from(sc.s.pos.buffer), Buffer.from(sc.s.vel.buffer)]));
console.log(`${CELL} ${KIND} n=${sc.n} 자유 ${nFree} m=${cons.length} sub=${P.SUB} perturb=${PERTURB}`);
console.log(`수렴 ${converged ? '**도달**' : '**미도달**'} · 프레임 **${frame}** · 창 순변위 ${net.toExponential(6)} m · ${ms}ms (${(ms / frame).toFixed(0)}ms/프레임)`);
