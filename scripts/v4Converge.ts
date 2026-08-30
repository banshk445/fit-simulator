/* v4-04 §1-② — **층2(수렴 도달)의 v3 정답**(물리 코어 diff 0 · `src/` 0줄).
 *
 * 층2 는 **궤적을 보지 않는다**. 같은 초기 상태에서 **수렴 판정까지** 돌리고 **최종 정점만** 낸다.
 *
 * 수렴 판정은 **v3 코드에서 인용**한다(새 수 0):
 *   · `src/v3/dressRun.ts:N_WIN`  `Math.round(1 / (V3CONST.DAMP * V3CONST.DT))` ⟹ **10 프레임 창**
 *   · `src/v3/s4Gate.ts:S4_THRESHOLD.settleNetM`  `= TOL_SELF` ⟹ **창 순변위 ≤ 1e-4 m**(0.1mm)
 *   · `src/v3/consts.ts:TOL_SELF`  `1e-4`
 *   · 창 순변위의 «정의»도 v3 것이다 — `dressRun.ts:runFrames` 의
 *     `net = max_v |pos_v − ref_v|`(창 시작 시점 `ref` 대비 · 정점 최대)
 *
 * 두 합성계를 돌린다(v4-02 · v4-03 에서 «정의를 이미 고정한» 것 그대로 · 재정의 0):
 *   `strip` = 2행×32열 한 줄 천 · 늘어남(`inplane`)만 · 중력 G · 한쪽 열 고정
 *   `hinge` = 두 삼각형 힌지 · 굽힘(`bend`)만 · 중력 0 · 날개 90° 접힌 초기 · 한쪽 삼각형 고정
 *
 * 진입: `[SYS=strip|hinge] [CAP=20000] npx tsx scripts/v4Converge.ts`
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { makeInplane, makeBend, assignMassFromMesh, substepsForCloth, substepsForBending,
         step, type Solver, type Constraint } from '../src/v3/solver.ts';
import { DT, DAMP, TOL_SELF, G, FABRICS } from '../src/v3/consts.ts';
import { N_WIN } from '../src/v3/dressRun.ts';
import { S4_THRESHOLD } from '../src/v3/s4Gate.ts';

const SYS = (process.env.SYS ?? 'strip') as 'strip' | 'hinge';
const CAP = Number(process.env.CAP ?? 20000);          // 상한 프레임 — 미수렴을 «미수렴»으로 적기 위한 것
const D = Number(process.env.D_MM ?? 9) / 1000;
const FAB = FABRICS.gray;
const OUT = 'gpu/oracle/export';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let n: number, uv: Float64Array, T: Uint32Array, pinned: Set<number>, gravity: number;
if (SYS === 'strip') {
  const NCOL = 32;
  n = 2 * NCOL;
  uv = new Float64Array(n * 2);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < NCOL; c++) { const v = r * NCOL + c; uv[v * 2] = c * D; uv[v * 2 + 1] = r * D; }
  const tr: number[] = [];
  for (let c = 0; c < NCOL - 1; c++) tr.push(c, c + 1, NCOL + c + 1, c, NCOL + c + 1, NCOL + c);
  T = Uint32Array.from(tr);
  pinned = new Set([0, NCOL]);
  gravity = G;
} else {
  n = 4;
  uv = Float64Array.from([0, 0, D, 0, 0, D, 0, -D]);
  T = Uint32Array.from([0, 1, 2, 1, 0, 3]);
  pinned = new Set([0, 1, 2]);
  gravity = 0;                                          // 굽힘 하나만 남긴다(v4-03 §1-③ㄱ 정의)
}
const pos = new Float64Array(n * 3);
for (let v = 0; v < n; v++) { pos[v * 3] = uv[v * 2]; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = uv[v * 2 + 1]; }
if (SYS === 'hinge') { pos[3 * 3 + 1] = D; pos[3 * 3 + 2] = 0; }   // 날개 90° 접기

/* v4-04 §1-② — **계기 «판별력» 검사**(v3 ↔ v3). 초기값만 PERTURB 만큼 흔들어 같은 코드를 돌린다.
 * 두 v3 실행의 도착점이 크게 갈리면 **이 계기는 «구현 차이»를 잴 수 없다** — 갈린 것은 계다.
 * `PERTURB=1e-7 npx tsx scripts/v4Converge.ts` · 산출 파일명에 `-p` 가 붙는다. */
const PERTURB = Number(process.env.PERTURB ?? 0);
if (PERTURB !== 0) for (let v = 0; v < n; v++) if (!pinned.has(v)) pos[v * 3] += PERTURB;

const s: Solver = { pos, prev: new Float64Array(n * 3), vel: new Float64Array(n * 3),
                    invMass: new Float64Array(n), n };
const mass = assignMassFromMesh(s, T, uv, FAB.rho, pinned);
const cons: Constraint[] =
  SYS === 'strip' ? makeInplane(T, uv, FAB.k, FAB.k, FAB.k) : makeBend(T, uv, FAB.B);
const SUB = SYS === 'strip'
  ? substepsForCloth(DT, FAB.k, FAB.rho, D, 0.95)
  : substepsForBending(DT, s, cons as never, 0.95);
const params = { dt: DT, substeps: SUB, gravity, damping: DAMP };

/* 창 순변위 — `dressRun.ts:runFrames` 의 그 식이다(정의 재작성 0). */
const netOf = (ref: Float64Array) => {
  let net = 0;
  for (let v = 0; v < n; v++)
    net = Math.max(net, Math.hypot(pos[v * 3] - ref[v * 3], pos[v * 3 + 1] - ref[v * 3 + 1],
                                   pos[v * 3 + 2] - ref[v * 3 + 2]));
  return net;
};

const t0 = Date.now();
let ref = Float64Array.from(pos);
let frame = 0, net = Infinity, converged = false;
const trail: Array<[number, number]> = [];
while (frame < CAP) {
  step(s, cons, params);
  frame++;
  if (frame % N_WIN === 0) {
    net = netOf(ref);
    if (trail.length < 6 || frame % (N_WIN * 50) === 0) trail.push([frame, net]);
    if (net <= S4_THRESHOLD.settleNetM) { converged = true; break; }
    ref = Float64Array.from(pos);
  }
}
const ms = Date.now() - t0;

const hdr = {
  what: `v4-04 §1-② 층2 수렴 — v3 정답 (${SYS})`, sys: SYS, n, tris: T.length / 3, m: cons.length,
  substeps: SUB, d: D, G: gravity, DT, DAMP, k: FAB.k, ke: FAB.B, rho: FAB.rho,
  N_WIN, tol: S4_THRESHOLD.settleNetM, TOL_SELF,
  frames: frame, converged, net, cap: CAP, pinned: [...pinned], perturb: PERTURB,
  totalMass: mass.totalMass, trail, ms,
};
const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
const im = new Float64Array(n); im.set(s.invMass);
writeFileSync(`${OUT}/converge-${SYS}-v3${PERTURB !== 0 ? '-p' : ''}.bin`, Buffer.concat([
  head, hb, Buffer.from(uv.buffer), Buffer.from(new Int32Array(T).buffer),
  Buffer.from(im.buffer), Buffer.from(pos.buffer), Buffer.from(s.vel.buffer)]));
let lo = Infinity, hi = -Infinity;
for (let i = 0; i < n * 3; i++) { if (pos[i] < lo) lo = pos[i]; if (pos[i] > hi) hi = pos[i]; }
console.log(`${SYS} n=${n} m=${cons.length} sub=${SUB} N_WIN=${N_WIN} tol=${S4_THRESHOLD.settleNetM}`);
console.log(`수렴 ${converged ? '**도달**' : '**미도달**'} · 프레임 **${frame}** · 창 순변위 ${net.toExponential(6)} m · ${ms}ms`);
console.log(`좌표 범위 ${lo.toExponential(9)} ~ ${hi.toExponential(9)}`);
