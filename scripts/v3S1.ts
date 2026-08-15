/* v3 S1 게이트 — 해석해 대조 3종.
 *
 * 진입: `npm run v3:s1`
 *
 * 장면 정의와 파라미터는 «실행 전»에 여기 고정한다(회차 프롬프트 §3 — 사후 조정 금지).
 * 문턱: ① ±1% ② ±2% ③ ±1%. 결과에 맞춰 조정하지 않는다(함정 14).
 */
import {
  makeSolver,
  makeInplane,
  assignMassFromMesh,
  substepsFor,
  step,
  type Constraint,
  type Solver,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;

/** ③′ 결합계 서브스텝 불변성 [v3-04 승격 · §4].
 *
 * ③(단일 스프링)은 이 축을 «원리적으로» 못 본다 — 제약 1개는 어떤 h에서도 정확히
 * 수렴한다(v3-04 실측 r=1.00000000). 해석해가 있는 «결합»계로 승격한다.
 *
 * 장면: 균일 인장 사슬 N칸. 0번 고정, 끝에 F. 중력 0. 해석해 ΔL = N·F/k_el.
 * 문턱 r ≥ 0.95 의 «근거»: r은 실효 강성에 곱해지는 오차라 늘어남 오차와 1:1이다.
 *   S2가 이미 쓰는 «모델» 오차 문턱이 ±10%이므로 **수치** 오차 예산을 그 절반인
 *   5%로 잡는다. 이 값은 v3-04 회차 프롬프트 §3-A가 지정한 것이고 측정 «전»에 정해졌다.
 * 서브스텝 수는 손으로 고르지 않고 `substepsFor`가 산정한다 — 처방의 자체 검증이다.
 */
const CHAIN = { N: 21, kEl: 2e3, mNode: 1e-3, F: 1, seconds: 6, rMin: 0.95 };

function chainScene(substeps: number) {
  const { N, kEl, mNode, F } = CHAIN;
  const rest = 1 / N;
  const s = makeSolver(N + 1);
  for (let v = 0; v <= N; v++) {
    s.pos[v * 3] = v * rest;
    s.invMass[v] = v === 0 ? 0 : 1 / mNode;
  }
  const cs: Constraint[] = [];
  for (let i = 0; i < N; i++) cs.push({ kind: 'dist', i, j: i + 1, rest, k: kEl, lambda: 0 });
  const ext = new Float64Array((N + 1) * 3);
  ext[N * 3] = F;
  const p: SolverParams = {
    dt: 1 / 60,
    substeps,
    gravity: 0,
    damping: 40,
    extForce: ext,
    iterations: 1,
  };
  for (let f = 0; f < CHAIN.seconds * 60; f++) step(s, cs, p);
  let mv = 0;
  for (let v = 0; v <= N; v++) mv = Math.max(mv, Math.abs(s.vel[v * 3]));
  return { r: (N * F) / kEl / (s.pos[N * 3] - 1), mv };
}

// ── 사전 등록 장면 ─────────────────────────────────────────────────────────
/** ① 자유낙하: 제약 0 · 감쇠 0 · 1.0 s 낙하 */
const FALL = { dt: 1 / 60, substeps: 8, seconds: 1.0, mass: 0.1 };
/** ② 단일 스프링: p0 고정, p1 매달림. Δx = mg/k */
const SPRING = { dt: 1 / 60, substeps: 8, seconds: 5.0, mass: 0.1, k: 50, rest: 0.5, damping: 5 };
/** ③ 서브스텝 2배 대조: ② 장면을 substeps 8 vs 16 */
const SUBSTEP_PAIR = [8, 16];
/** 보조(게이트 아님) — 매달린 시트로 이방 면내 제약을 돌린다.
 * seconds 20: 1차 등록은 5초였으나 잔류속도 7.6e-2 m/s로 «미정착»이라
 * 「정지 형상」을 재는 계기의 전제가 안 섰다. 20초에서 5.6e-9까지 떨어진다.
 * 문턱이 아니라 계기 전제의 정정이다(값은 5·10·20·40·80초에서 동일하게 수렴). */
const SHEET = {
  nx: 21,
  ny: 21,
  size: 1.0,
  areaDensity: 0.2,
  kU: 2000,
  kV: 1000,
  kS: 500,
  dt: 1 / 60,
  substeps: 8,
  seconds: 20.0,
  damping: 2,
};

// 유도(1차 예측 정정 — v3-02 실측). 처음엔 "중력을 투영 «전»에 적용하므로
// 정지점에 g*h^2 잔차가 남는다"로 등록했으나 «틀렸다». 정지 부동점에서
//   예측 위치의 위반 C_pred = mg/k + g h^2  →  투영이 g h^2 를 정확히 되돌린다
//   ⟹ 투영 «후» 관측되는 늘어짐 = mg/k, h와 무관.
// 실측이 이를 확인한다(sub=1..64에서 |Δx - mg/k| < 3e-13). 문턱은 안 건드렸다.
const springAnalytic = (m: number, k: number) => (m * G) / k;

function run(s: Solver, cs: Constraint[], p: SolverParams, frames: number): number {
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) step(s, cs, p);
  return performance.now() - t0;
}

function fmt(x: number, d = 6): string {
  return Number.isFinite(x) ? x.toFixed(d) : String(x);
}

function relErr(got: number, want: number): number {
  return Math.abs(got - want) / Math.abs(want);
}

// ── ① 자유낙하 ────────────────────────────────────────────────────────────
function testFall() {
  const p: SolverParams = { dt: FALL.dt, substeps: FALL.substeps, gravity: G, damping: 0 };
  const s = makeSolver(1);
  s.invMass[0] = 1 / FALL.mass;
  const frames = Math.round(FALL.seconds / FALL.dt);
  const ms = run(s, [], p, frames);
  const drop = -s.pos[1];
  const t = frames * FALL.dt;
  const want = 0.5 * G * t * t;
  const nSub = frames * FALL.substeps;
  // 심플렉틱 오일러의 이산 낙하는 해석해의 (n+1)/n 배다.
  const discrete = (want * (nSub + 1)) / nSub;
  return { drop, want, discrete, err: relErr(drop, want), nSub, ms };
}

// ── ② 단일 스프링 ─────────────────────────────────────────────────────────
function springScene(substeps: number) {
  const s = makeSolver(2);
  s.invMass[0] = 0; // 고정
  s.invMass[1] = 1 / SPRING.mass;
  s.pos[4] = -SPRING.rest;
  const cs: Constraint[] = [
    { kind: 'dist', i: 0, j: 1, rest: SPRING.rest, k: SPRING.k, lambda: 0 },
  ];
  const p: SolverParams = { dt: SPRING.dt, substeps, gravity: G, damping: SPRING.damping };
  const frames = Math.round(SPRING.seconds / SPRING.dt);
  const ms = run(s, cs, p, frames);
  const stretch = -s.pos[4] - SPRING.rest;
  return { stretch, vel: Math.abs(s.vel[4]), h: SPRING.dt / substeps, ms };
}

// ── 보조: 매달린 시트 ─────────────────────────────────────────────────────
function sheetScene(substeps: number, pinTop: boolean) {
  const { nx, ny, size } = SHEET;
  const n = nx * ny;
  const s = makeSolver(n);
  const uv = new Float64Array(n * 2);
  const dx = size / (nx - 1);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i;
      uv[v * 2] = i * dx;
      uv[v * 2 + 1] = j * dx;
      s.pos[v * 3] = i * dx;
      s.pos[v * 3 + 1] = 0;
      s.pos[v * 3 + 2] = j * dx;
    }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      tris.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  // pinTop=false: 모서리 2개만 — 폴드 다중해가 있다. true: 윗변 전체 — 단일 평형.
  const pinned = new Set<number>(pinTop ? Array.from({ length: nx }, (_, i) => i) : [0, nx - 1]);
  const { totalMass, totalArea } = assignMassFromMesh(s, tris, uv, SHEET.areaDensity, pinned);
  const cs: Constraint[] = makeInplane(tris, uv, SHEET.kU, SHEET.kV, SHEET.kS);
  const p: SolverParams = { dt: SHEET.dt, substeps, gravity: G, damping: SHEET.damping };
  const frames = Math.round(SHEET.seconds / SHEET.dt);
  const ms = run(s, cs, p, frames);
  let maxVel = 0;
  let nan = 0;
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < 3; c++) if (!Number.isFinite(s.pos[v * 3 + c])) nan++;
    maxVel = Math.max(maxVel, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  }
  return {
    pos: s.pos,
    totalMass,
    totalArea,
    tris: tris.length / 3,
    cs: cs.length,
    maxVel,
    nan,
    ms,
    n,
  };
}

/** 함정 18: 대역 요약에 단일 통계 금지 — 최대·평균·어느 정점인가를 병기한다. */
function diffStat(a: Float64Array, b: Float64Array) {
  let max = 0;
  let sum = 0;
  let at = -1;
  const n = a.length / 3;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    if (d > max) {
      max = d;
      at = i / 3;
    }
    sum += d;
  }
  return { max, mean: sum / n, at };
}

// ── 실행 ──────────────────────────────────────────────────────────────────
console.log(
  `[v3-S1] 코어=XPBD(small-steps) 신장=ⓑ선형이방 굽힘=없음 충돌=없음 물성투입=없음(임의 k) ` +
    `g=${G} 정밀도=Float64`,
);
console.log(
  `[장면] ①낙하 dt=${FALL.dt.toFixed(6)} sub=${FALL.substeps} T=${FALL.seconds}s m=${FALL.mass}kg damp=0 | ` +
    `②스프링 dt=${SPRING.dt.toFixed(6)} sub=${SPRING.substeps} T=${SPRING.seconds}s m=${SPRING.mass}kg ` +
    `k=${SPRING.k}N/m L0=${SPRING.rest}m damp=${SPRING.damping}/s | ` +
    `③sub=${SUBSTEP_PAIR.join('vs')} | 보조시트 ${SHEET.nx}x${SHEET.ny} ${SHEET.size}m ρ=${SHEET.areaDensity}kg/m² ` +
    `kU/kV/kS=${SHEET.kU}/${SHEET.kV}/${SHEET.kS}N/m damp=${SHEET.damping}/s T=${SHEET.seconds}s`,
);
console.log(
  `[문턱] ①±1% ②±2% ③±1% ③′결합계 r≥${CHAIN.rMin} (사전 등록 · 결과에 맞춰 조정 금지)`,
);

let pass = true;
const verdict = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

const f = testFall();
const okFall = f.err <= 0.01;
pass &&= okFall;
console.log(
  `\n① 자유낙하  낙하=${fmt(f.drop)}m 해석해=${fmt(f.want)}m 이산예측=${fmt(f.discrete)}m ` +
    `상대오차=${(f.err * 100).toFixed(4)}% 서브스텝=${f.nSub} (${f.ms.toFixed(1)}ms) → ${verdict(okFall)}`,
);

const sp = springScene(SPRING.substeps);
const wantSpring = springAnalytic(SPRING.mass, SPRING.k);
const okSpring = relErr(sp.stretch, wantSpring) <= 0.02;
pass &&= okSpring;
console.log(
  `② 스프링    Δx=${fmt(sp.stretch, 10)}m mg/k=${fmt(wantSpring, 10)}m ` +
    `절대차=${(sp.stretch - wantSpring).toExponential(2)}m 상대오차=${(relErr(sp.stretch, wantSpring) * 100).toFixed(4)}% ` +
    `h=${sp.h.toExponential(3)}s 잔류속도=${sp.vel.toExponential(2)}m/s (${sp.ms.toFixed(1)}ms) → ${verdict(okSpring)}`,
);

const [sA, sB] = SUBSTEP_PAIR.map((k) => springScene(k));
const okSub = relErr(sB.stretch, sA.stretch) <= 0.01;
pass &&= okSub;
console.log(
  `③ 서브스텝2배 sub=${SUBSTEP_PAIR[0]} Δx=${fmt(sA.stretch)}m / sub=${SUBSTEP_PAIR[1]} Δx=${fmt(sB.stretch)}m ` +
    `상대차=${(relErr(sB.stretch, sA.stretch) * 100).toFixed(4)}% → ${verdict(okSub)}`,
);

// ③′ 결합계 (v3-04 승격)
const autoSub = substepsFor(1 / 60, CHAIN.kEl, CHAIN.mNode, CHAIN.rMin);
const chAuto = chainScene(autoSub);
const chLow = chainScene(16);
const okChain = chAuto.r >= CHAIN.rMin;
pass &&= okChain;
console.log(
  `③′ 결합계   사슬 ${CHAIN.N}칸 k_el=${CHAIN.kEl.toExponential(0)} · substepsFor 산정=${autoSub} ` +
    `r=${fmt(chAuto.r, 5)} (문턱 ${CHAIN.rMin}) 잔류속도=${chAuto.mv.toExponential(1)} → ${verdict(okChain)}`,
);
console.log(
  `            대조: 손으로 고른 sub=16이면 r=${fmt(chLow.r, 5)} — ③(단일 제약)은 이 축을 «원리적으로» 못 본다`,
);

const diag = Math.hypot(SHEET.size, SHEET.size);
const hA = sheetScene(SUBSTEP_PAIR[0], true);
const okSheetMass = Math.abs(hA.totalMass - hA.totalArea * SHEET.areaDensity) < 1e-12;
console.log(
  `\n[보조] 시트 정점=${hA.n} 삼각형=${hA.tris} 면내제약=${hA.cs}×3성분 ` +
    `총질량=${fmt(hA.totalMass, 8)}kg (면적${fmt(hA.totalArea, 6)}m²×ρ 일치=${okSheetMass}) ` +
    `NaN=${hA.nan} 잔류속도=${hA.maxVel.toExponential(2)}m/s`,
);
// 서브스텝 수렴: 8→16→32→64 로 좁혀지는가. 최대·평균·최대정점 병기(함정 18).
for (const pinTop of [true, false]) {
  const runs = [8, 16, 32, 64].map((k) => sheetScene(k, pinTop));
  const label = pinTop ? '윗변전체(단일평형)' : '모서리2개(폴드다중해)';
  const line = runs
    .slice(0, -1)
    .map((r, i) => {
      const d = diffStat(r.pos, runs[i + 1].pos);
      return `${[8, 16, 32][i]}vs${[16, 32, 64][i]} 최대 ${((d.max / diag) * 100).toFixed(3)}%·평균 ${((d.mean / diag) * 100).toFixed(3)}%@v${d.at}`;
    })
    .join(' | ');
  console.log(`[보조] 시트 서브스텝수렴 ${label}: ${line}`);
}
console.log(
  `[비용] 면내제약 투영 ${hA.cs * 3}개/서브스텝 · ` +
    `${((hA.ms * 1000) / (Math.round(SHEET.seconds / SHEET.dt) * SHEET.substeps)).toFixed(1)}µs/서브스텝. ` +
    `BVH 질의 비용은 충돌이 없는 S1에서 측정 불가 — S3로 이월(추정치로 채우지 않는다)`,
);

const branch = pass
  ? "A — ①②③③′ 전부 통과 (S1 성립 · ③′는 v3-04 승격분)"
  : !okFall
    ? 'D — ① 실패(적분기)'
    : !okSpring
      ? 'C — ② 실패(질량배분 또는 α↔k 사상)'
      : 'B — ③ 실패(컴플라이언스 스케일링 α/dt²)';
console.log(`\n[갈래] ${branch}`);
if (!pass) process.exitCode = 1;
