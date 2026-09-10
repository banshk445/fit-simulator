/* v3-04 — #14 결합 제약계 수렴 정량화.
 *
 * 진입: `npm run v3:conv`
 *
 * 계기: 해석해가 있는 «균일 인장 사슬». 입자 N+1개를 일렬로 두고 0번을 고정,
 * 끝에 알려진 힘 F를 건다. 중력 0. 각 스프링 강성 k_el.
 *   해석해:  ΔL = N·F/k_el     ⟹  실효 강성비 r = ΔL_해석 / ΔL_실측
 * r=1이면 명목 강성이 그대로 나온 것이다. v3-03 §3이 r<1을 관측했다.
 *
 * 1D 사슬을 쓰는 이유: 기전(가우스-자이델 사슬 전파)이 같고 비용이 2자릿수 싸서
 * N·n·k 3축을 실제로 쓸어볼 수 있다. 면내 제약 스트립으로 «교차 확인»한다(§1-D).
 */
import {
  makeSolver,
  makeInplane,
  assignMassFromMesh,
  substepsForCloth,
  step,
  type Constraint,
  type SolverParams,
} from '../src/v3/solver.ts';

/** 1D 인장 사슬. 반환 = 실효 강성비 r · 잔류속도 · 무차원 수 */
function chain(N: number, kEl: number, sub: number, iters: number, secs: number, F = 1) {
  const mNode = 1e-3; // 절점 질량 [kg] — 정지 해에는 무관, 동역학 시간척도만 정한다
  const rest = 1 / N; // 총 길이 1 m
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
    substeps: sub,
    gravity: 0,
    damping: 40,
    extForce: ext,
    iterations: iters,
  };
  for (let f = 0; f < Math.round(secs * 60); f++) step(s, cs, p);
  let mv = 0;
  for (let v = 0; v <= N; v++) mv = Math.max(mv, Math.abs(s.vel[v * 3]));
  const dl = s.pos[N * 3] - 1;
  const h = 1 / 60 / sub;
  // 무차원 후보: h·ω_el(원소 진동수) · h·ω_1(사슬 기본 모드 ≈ (π/2N)·ω_el)
  const wEl = Math.sqrt(kEl / mNode);
  return { r: (N * F) / kEl / dl, mv, hwEl: h * wEl, hw1: (h * wEl * Math.PI) / (2 * N) };
}

const fx = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

console.log(
  `[v3-04] 계기=균일 인장 사슬(해석해 ΔL=N·F/k_el) · 중력=0 · damp=40/s · F=1N · 총길이 1m · m_절점=1e-3kg`,
);
console.log(`[정의] 실효 강성비 r = ΔL_해석 / ΔL_실측.  r=1 이면 명목 강성이 그대로 나온다`);

/* ── §1-A 3축 스윕 ─────────────────────────────────────────────────────── */
const NS = [2, 3, 5, 9, 21, 41, 81];
const SUBS = [8, 16, 64, 256, 1024];
const KS = [20, 2e3, 2e5];
console.log(`\n§1-A 3축 스윕 — r (괄호는 잔류속도 m/s). 반복=1 · T=6s`);
for (const k of KS) {
  console.log(`  k_el=${k.toExponential(0)} N/m`);
  console.log(`    N \\ sub${SUBS.map((x) => String(x).padStart(16)).join('')}`);
  for (const N of NS) {
    const cells = SUBS.map((sub) => {
      const c = chain(N, k, sub, 1, 6);
      return `${fx(c.r)}(${c.mv.toExponential(0)})`.padStart(16);
    });
    console.log(`    ${String(N).padStart(2)}   ${cells.join('')}`);
  }
}

/* ── §1-B 무차원 붕괴 확인 ─────────────────────────────────────────────── */
console.log(`\n§1-B 무차원 붕괴 — 같은 r가 같은 무차원 수에서 나오는가`);
console.log(`   후보① h·ω_el = h·√(k_el/m)   후보② h·ω_1 = (π/2N)·h·ω_el   후보③ N·h·ω_el`);
console.log(
  `   ${'N'.padStart(3)}${'k_el'.padStart(10)}${'sub'.padStart(6)}${'r'.padStart(9)}${'h·ω_el'.padStart(11)}${'h·ω_1'.padStart(11)}${'N·h·ω_el'.padStart(11)}`,
);
for (const [N, k, sub] of [
  [9, 2e3, 16],
  [9, 2e5, 160],
  [21, 2e3, 16],
  [21, 2e5, 160],
  [41, 2e3, 16],
  [81, 2e3, 16],
  [9, 2e3, 64],
  [21, 2e3, 64],
  [41, 2e3, 64],
  [81, 2e3, 64],
] as const) {
  const c = chain(N, k, sub, 1, 6);
  console.log(
    `   ${String(N).padStart(3)}${k.toExponential(0).padStart(10)}${String(sub).padStart(6)}` +
      `${fx(c.r).padStart(9)}${c.hwEl.toExponential(2).padStart(11)}${c.hw1.toExponential(2).padStart(11)}` +
      `${(N * c.hwEl).toExponential(2).padStart(11)}`,
  );
}

/* ── §1-C 총 작업량 «고정» 비교 (서브스텝 배분 vs 반복 배분) ───────────── */
console.log(`\n§1-C 총 작업량(sub×반복) 고정 — 배분만 바꾼다. small-steps 전제의 직접 시험`);
for (const N of [21, 81]) {
  console.log(`   N=${N} · k_el=2e3 · 총작업량 1024`);
  console.log(`     ${'sub'.padStart(6)}${'반복'.padStart(6)}${'r'.padStart(9)}${'잔류속도'.padStart(11)}`);
  for (const [sub, it] of [
    [1024, 1],
    [256, 4],
    [64, 16],
    [16, 64],
    [8, 128],
  ] as const) {
    const c = chain(N, 2e3, sub, it, 6);
    console.log(
      `     ${String(sub).padStart(6)}${String(it).padStart(6)}${fx(c.r).padStart(9)}${c.mv.toExponential(1).padStart(11)}`,
    );
  }
}

/* ── §1-D 면내 제약 스트립 교차 확인 ───────────────────────────────────── */
function strip(ny: number, kU: number, sub: number, iters: number, secs = 8) {
  const nx = 3;
  const L = 0.5;
  const W = 0.2;
  const n = ny * nx;
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < nx; j++)
    for (let i = 0; i < ny; i++) {
      const v = j * ny + i;
      uv[v * 2] = (i * L) / (ny - 1);
      uv[v * 2 + 1] = (j * W) / (nx - 1);
    }
  for (let j = 0; j < nx - 1; j++)
    for (let i = 0; i < ny - 1; i++) {
      const a = j * ny + i;
      tris.push(a, a + 1, a + ny, a + 1, a + ny + 1, a + ny);
    }
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nx; j++) pin.add(j * ny);
  assignMassFromMesh(s, tris, uv, 0.2, pin);
  const cs: Constraint[] = makeInplane(tris, uv, kU, kU, kU);
  const ext = new Float64Array(n * 3);
  const tip: number[] = [];
  for (let j = 0; j < nx; j++) tip.push(j * ny + ny - 1);
  const F = 4;
  for (const v of tip) ext[v * 3] = F / tip.length;
  const p: SolverParams = {
    dt: 1 / 60,
    substeps: sub,
    gravity: 0,
    damping: 20,
    extForce: ext,
    iterations: iters,
  };
  for (let f = 0; f < Math.round(secs * 60); f++) step(s, cs, p);
  let sum = 0;
  for (const v of tip) sum += s.pos[v * 3];
  const lam = sum / tip.length / L;
  const Gg = (lam * lam - 1) / 2;
  return F / W / (Gg * lam) / kU;
}
/** 정사각 원소 스트립 — 폭·길이 둘 다 엣지 길이 d. §2-B의 정본 계기. */
function stripSquare(
  ny: number,
  nx: number,
  d: number,
  k: number,
  rho: number,
  sub: number,
  iters: number,
  secs: number,
) {
  const L = (ny - 1) * d;
  const W = (nx - 1) * d;
  const n = ny * nx;
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < nx; j++)
    for (let i = 0; i < ny; i++) {
      const v = j * ny + i;
      uv[v * 2] = i * d;
      uv[v * 2 + 1] = j * d;
    }
  for (let j = 0; j < nx - 1; j++)
    for (let i = 0; i < ny - 1; i++) {
      const a = j * ny + i;
      tris.push(a, a + 1, a + ny, a + 1, a + ny + 1, a + ny);
    }
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nx; j++) pin.add(j * ny);
  assignMassFromMesh(s, tris, uv, rho, pin);
  const cs: Constraint[] = makeInplane(tris, uv, k, k, k);
  const ext = new Float64Array(n * 3);
  const tip: number[] = [];
  for (let j = 0; j < nx; j++) tip.push(j * ny + ny - 1);
  const F = 0.02 * k * W; // 폭당 장력 ≈ 2% 변형 상당
  for (const v of tip) ext[v * 3] = F / tip.length;
  const p: SolverParams = {
    dt: 1 / 60,
    substeps: sub,
    gravity: 0,
    damping: 20,
    extForce: ext,
    iterations: iters,
  };
  for (let f = 0; f < Math.round(secs * 60); f++) step(s, cs, p);
  let sum = 0;
  for (const v of tip) sum += s.pos[v * 3];
  const lam = sum / tip.length / L;
  const Gg = (lam * lam - 1) / 2;
  return F / W / (Gg * lam) / k;
}

console.log(`\n§1-D 교차 확인 — 1D 거리 제약이 아니라 «면내 제약» 스트립에서도 같은가`);
console.log(`   면내 스트립 k=2000 N/m F=4N (사슬 = ny−1 칸)`);
for (const ny of [3, 5, 9, 21]) {
  const row = [16, 64, 256].map((sub) => fx(strip(ny, 2000, sub, 1)).padStart(10));
  console.log(
    `     ny=${String(ny).padStart(2)} (사슬 ${String(ny - 1).padStart(2)}칸) sub 16/64/256:${row.join('')}`,
  );
}

/* ── §2 실제 옷으로 외삽 + 직접 측정 ──────────────────────────────────── */
console.log(`\n§2 실제 옷 — 사슬 길이 정의 · 필요 서브스텝 · 예산 대조`);
console.log(
  `   [정의] 사슬 길이 = **제약 그래프 지름**(두 정점이 한 제약을 공유하면 인접, 단위=엣지 수).`,
);
console.log(
  `          하중 경로 사슬(어깨→밑단)도 병기한다 — 드레이프에서 실제로 장력을 나르는 경로다.`,
);
console.log(
  `   [추정] 앞판 0.55m×0.70m · 엣지 8mm ⟹ 69×88 격자. 반대각 분할이라 코너-코너 = 69+88 = 157.`,
);
console.log(
  `          앞뒤판+소매 봉제 시 지름 ≈ 157+2×25 ≈ 207. 하중 경로(어깨→밑단) = 0.70/0.008 ≈ 88.`,
);
console.log(
  `   [법칙] r ≥ 0.95 ⟺ h·ω_el ≤ √(1/0.95−1) = 0.2294.  ω_el = √(k/ρ)/d (삼각 메시).`,
);
console.log(`          ⟹ n = dt·√(k/ρ) / (0.2294·d).  **사슬 길이 N은 안 들어간다**(§1-B)`);

const FABRICS: [string, number, number][] = [
  ['gray-interlock (t-shirt)', 2 * 34.477123, 0.187],
  ['navy-sparkle-sweat', 2 * 12.49, 0.224],
  ['camel-ponte-roma', 2 * 44.03, 0.284],
  ['ivory-rib-knit', 2 * 65.17, 0.276],
  ['white-swim-solid', 2 * 104.62, 0.204],
  ['tango-red-jet-set', 2 * 171.42, 0.113],
  ['pink-ribbon-brown', 2 * 244.83, 0.228],
  ['11oz-black-denim', 2 * 1013.89, 0.324],
  ['white-dots-on-blk', 2 * 2027.49, 0.128],
  ['royal-target (pants)', 2 * 2034.98, 0.22],
];
const D = 0.008;
const DT = 1 / 60;
// v3-02 §3-3 실측: 면내 2400 투영 = 72.1µs/서브스텝 ⟹ 30ns/투영(단일 스레드 JS)
const NS_PER_PROJ = 72.1e-6 / 2400;
// 8mm 옷 ≈ 14,500정점 ⟹ 약 28,700삼각형 = 면내 86,100 + 힌지 약 43,000 ≈ 130,000 투영
const PROJ = 130_000;
const SETTLE_FRAMES = 120; // 정착 2초 상당
console.log(
  `\n   ${'원단'.padEnd(26)}${'k[N/m]'.padStart(10)}${'ρ'.padStart(7)}${'n(8mm)'.padStart(8)}${'ms/프레임'.padStart(11)}${'정착(2s분)'.padStart(12)}`,
);
for (const [name, k, rho] of FABRICS) {
  const n = Math.ceil((DT * Math.sqrt(k / rho)) / (0.2294 * D));
  const msFrame = PROJ * n * NS_PER_PROJ * 1000;
  const settle = (msFrame * SETTLE_FRAMES) / 1000;
  console.log(
    `   ${name.padEnd(26)}${k.toFixed(1).padStart(10)}${rho.toFixed(3).padStart(7)}${String(n).padStart(8)}` +
      `${msFrame.toFixed(0).padStart(11)}${(settle < 60 ? `${settle.toFixed(0)}초` : `${(settle / 60).toFixed(1)}분`).padStart(12)}`,
  );
}
console.log(
  `   ※ 비용은 v3-02 §3-3의 30ns/투영(단일 스레드 JS)에서 «외삽»이다. 워커·SIMD·병렬 미반영`,
);

console.log(`\n§2-B 직접 측정 — 외삽이 아니라 «정사각 8mm 원소»로 옷 규모를 돌린다`);
console.log(
  `   1차 시도는 계기가 어긋났다: 스트립 폭을 3열로 잡아 원소가 100mm×8mm였고 k_el이 12.5배였다.`,
);
console.log(
  `   (그 조건에서도 법칙은 맞았다 — 예측 0.869 vs 실측 0.890.) 아래는 원소를 정사각으로 고친 판이다.`,
);
{
  const d = 0.008;
  const nyG = 89; // 길이 0.704m
  const nxG = 26; // 폭 0.200m
  const kG = 68.95;
  const rhoG = 0.187;
  const auto = substepsForCloth(DT, kG, rhoG, d, 0.95);
  console.log(
    `   gray-interlock: ${nyG}×${nxG} 정점(원소 8mm 정사각) · L=0.704m W=0.200m · k=${kG}N/m ρ=${rhoG}` +
      ` · substepsForCloth 산정 = ${auto}`,
  );
  for (const sub of [16, 64, auto, 2 * auto]) {
    const t0 = performance.now();
    const r = stripSquare(nyG, nxG, d, kG, rhoG, sub, 1, 6);
    console.log(
      `     sub=${String(sub).padStart(4)} r=${fx(r)} (${(performance.now() - t0).toFixed(0)}ms / 360프레임)`,
    );
  }
}
