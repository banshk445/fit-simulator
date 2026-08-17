/* v3-10 — S3 몸 충돌 + 마찰. 단방향 · **흡착 0**.
 *
 * 진입: `npm run v3:s3`
 *
 * 시험 형상은 **해석적**(평면 · 경사면 · 구 · 원기둥). 실제 몸 메시는 S4다 —
 * 원본 마네킹은 수밀이나 `splitFrontBack`·`excludeArms`가 597/189개 엣지를 뚫는다
 * (CLAUDE.md Stage 1a 동결분) ⟹ 부호가 원리적으로 정의되지 않는다.
 *
 * 문턱은 실행 «전»에 고정한다: ① 관통 0 ② |tanθ_c/μ − 1| ≤ 10% ③ 완전 일치 ④ 산출만.
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  dihedral,
  substepsForBending,
  collisionStats,
  step,
  type BendConstraint,
  type Collider,
  type CollisionParams,
  type Constraint,
  type Solver,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;
const DT = 1 / 60;
const KMEM = 100;
/** 시험용 원단 — ARCSim gray-interlock. 마찰계수는 «원단 파일에 없다»(출처 미확보) */
const MAT = { rho: 0.187, B: 23.191698e-6 };
/** 옷 두께 [m] — 시험용 상수(v3 설계 §2-4는 「이산 + 두께」로 시작한다) */
const THICK = 1e-3;

function grid(nu: number, nv: number, L: number, W: number) {
  const n = nu * nv;
  const du = L / (nu - 1);
  const dv = W / (nv - 1);
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const v = j * nu + i;
      uv[v * 2] = i * du;
      uv[v * 2 + 1] = j * dv;
    }
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      tris.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu);
    }
  return { n, du, dv, uv, tris };
}

/** 경계 결손 교정(v3-06) — 굽힘 강성을 넣을 때 쓰던 그대로 */
function bendKe(nu: number, nv: number, L: number, W: number) {
  const { n, du, uv, tris } = grid(nu, nv, L, W);
  const Leff = L - du;
  const w = MAT.rho * G;
  const yA = (x: number) =>
    x <= du
      ? 0
      : -(w / (24 * MAT.B)) *
        ((x - du) ** 4 - 4 * Leff * (x - du) ** 3 + 6 * Leff ** 2 * (x - du) ** 2);
  const kap = (x: number) => (x <= du ? 0 : (w * (Leff - (x - du)) ** 2) / (2 * MAT.B));
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = yA(uv[v * 2]);
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  let Ed = 0;
  for (const b of makeBend(tris, uv, MAT.B)) {
    const th = dihedral(s, b);
    Ed += (MAT.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 50000;
  for (let i = 0; i < M; i++) Ec += 0.5 * MAT.B * W * kap(((i + 0.5) * L) / M) ** 2 * (L / M);
  return MAT.B / (Ed / Ec);
}

/** 천 한 장. rot = 경사면 기울기(rad) · lift = 띄울 높이 */
function sheet(nu: number, nv: number, L: number, W: number, rot: number, lift: number) {
  const g = grid(nu, nv, L, W);
  const s = makeSolver(g.n);
  const ke = bendKe(nu, nv, L, W);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  for (let v = 0; v < g.n; v++) {
    const u = g.uv[v * 2] - L / 2;
    const w = g.uv[v * 2 + 1] - W / 2;
    s.pos[v * 3] = w;
    s.pos[v * 3 + 1] = u * sn + lift;
    s.pos[v * 3 + 2] = u * cs;
  }
  assignMassFromMesh(s, g.tris, g.uv, MAT.rho, new Set());
  const bends: BendConstraint[] = makeBend(g.tris, g.uv, ke);
  const con: Constraint[] = [...makeInplane(g.tris, g.uv, KMEM, KMEM, KMEM), ...bends];
  return { g, s, con, bends };
}

const subFor = (bends: BendConstraint[], s: Solver) =>
  Math.max(1024, substepsForBending(DT, s, bends, 0.95));

function run(
  s: Solver,
  con: Constraint[],
  cp: CollisionParams | undefined,
  sub: number,
  secs: number,
  damping: number,
) {
  collisionStats.fill(0);
  const p: SolverParams = { dt: DT, substeps: sub, gravity: G, damping, collision: cp };
  const t0 = performance.now();
  for (let f = 0; f < Math.round(secs / DT); f++) step(s, con, p);
  return performance.now() - t0;
}

function signedDist(c: Collider, x: number, y: number, z: number): number {
  if (c.kind === 'plane')
    return (x - c.p[0]) * c.n[0] + (y - c.p[1]) * c.n[1] + (z - c.p[2]) * c.n[2];
  if (c.kind === 'sphere') return Math.hypot(x - c.c[0], y - c.c[1], z - c.c[2]) - c.r;
  const dx = x - c.c[0];
  const dy = y - c.c[1];
  const dz = z - c.c[2];
  const t = dx * c.a[0] + dy * c.a[1] + dz * c.a[2];
  return Math.hypot(dx - t * c.a[0], dy - t * c.a[1], dz - t * c.a[2]) - c.r;
}

/** 정지 상태의 관통(두께 «안쪽»으로 들어간 양). 수치 잔차 1µm은 허용. */
function penetration(s: Solver, cols: readonly Collider[], thick: number) {
  let cnt = 0;
  let max = 0;
  for (let v = 0; v < s.n; v++)
    for (const c of cols) {
      const pen = thick - signedDist(c, s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]);
      if (pen > 1e-6) {
        cnt++;
        if (pen > max) max = pen;
      }
    }
  return { cnt, max };
}

const P = (x: number, w = 8, d = 3) => x.toFixed(d).padStart(w);

console.log(`[v3-10] S3 몸 충돌 — 단방향 · **흡착 0** · 해석 형상(평면·경사면·구·원기둥)`);
console.log(
  `[설계] 부호=해석 SDF(닫힌 형식) · 두께=${THICK * 1000}mm · 마찰=쿨롱 위치기반 · μ 출처 «미확보»(원단 파일에 없다)`,
);
console.log(`[문턱] ① 관통 0  ② |tanθ_c/μ − 1| ≤ 10%  ③ S1·S2 완전 일치  ④ 산출만 (사전 등록 · 무조정)`);

/* ── ① 관통 0 ─────────────────────────────────────────────────────────── */
console.log(`\n① 관통 0 — 구·원기둥·평면 위에 천을 떨어뜨려 정지 상태에서 확인`);
console.log(
  `   ${'형상'.padStart(8)}${'정점'.padStart(7)}${'sub'.padStart(7)}${'관통정점'.padStart(10)}${'최대깊이[mm]'.padStart(14)}${'h·|v|max[µm]'.padStart(14)}${'판정'.padStart(7)}`,
);
let ok1 = true;
const R = 0.05;
const SHAPES: [string, Collider][] = [
  ['구', { kind: 'sphere', c: [0, 0, 0], r: R }],
  ['원기둥', { kind: 'cylinder', c: [0, 0, 0], a: [1, 0, 0], r: R }],
  ['평면', { kind: 'plane', p: [0, -R, 0], n: [0, 1, 0] }],
];
for (const [name, col] of SHAPES) {
  const L = 0.12;
  const nu = 25;
  const { s, con, bends } = sheet(nu, nu, L, L, 0, R + 0.02);
  const sub = subFor(bends, s);
  run(s, con, { colliders: [col], thickness: THICK, mu: 0.3 }, sub, 2.5, 6);
  let vmax = 0;
  for (let v = 0; v < s.n; v++)
    vmax = Math.max(vmax, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  const pen = penetration(s, [col], THICK);
  const pass = pen.cnt === 0;
  ok1 &&= pass;
  console.log(
    `   ${name.padStart(8)}${String(s.n).padStart(7)}${String(sub).padStart(7)}${String(pen.cnt).padStart(10)}` +
      `${P(pen.max * 1000, 14, 6)}${P((DT / sub) * vmax * 1e6, 14, 4)}${(pass ? 'PASS' : 'FAIL').padStart(7)}`,
  );
}
console.log(
  `   ⟹ ① ${ok1 ? 'PASS' : 'FAIL'}. h·|v|max 를 두께 ${THICK * 1000}mm와 대조하면 이산 판정의 근거가 된다`,
);

/* ── ② 마찰 임계각 ────────────────────────────────────────────────────── */
console.log(`\n② 마찰 임계각 — 경사면에 천을 놓고 각을 올린다. tanθ_c = μ 여야 한다`);
console.log(`   판정: 3초 동안 경사 방향 평균 이동 > 1mm 이면 «미끄러짐». θ를 이분 탐색(12회)`);
console.log(
  `   ${'μ'.padStart(6)}${'θ_c[°]'.padStart(9)}${'tanθ_c'.padStart(10)}${'tanθ_c/μ'.padStart(10)}${'오차'.padStart(9)}${'판정'.padStart(7)}`,
);
function slides(mu: number, thetaDeg: number): boolean {
  const th = (thetaDeg * Math.PI) / 180;
  const L = 0.04;
  const nu = 9;
  const { s, con, bends } = sheet(nu, nu, L, L, th, 0);
  const col: Collider = { kind: 'plane', p: [0, 0, 0], n: [0, Math.cos(th), -Math.sin(th)] };
  for (let v = 0; v < s.n; v++) {
    s.pos[v * 3 + 1] += THICK * Math.cos(th);
    s.pos[v * 3 + 2] -= THICK * Math.sin(th);
  }
  const before = s.pos.slice();
  const sub = subFor(bends, s);
  run(s, con, { colliders: [col], thickness: THICK, mu }, sub, 3, 2);
  let d = 0;
  for (let v = 0; v < s.n; v++) {
    const dy = s.pos[v * 3 + 1] - before[v * 3 + 1];
    const dz = s.pos[v * 3 + 2] - before[v * 3 + 2];
    d += (dy * -Math.sin(th) + dz * -Math.cos(th)) / s.n;
  }
  return d > 1e-3;
}
let ok2 = true;
for (const mu of [0.2, 0.4, 0.8]) {
  let lo = 1;
  let hi = 60;
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    if (slides(mu, mid)) hi = mid;
    else lo = mid;
  }
  const thetaC = (lo + hi) / 2;
  const t = Math.tan((thetaC * Math.PI) / 180);
  const err = (t / mu - 1) * 100;
  const pass = Math.abs(err) <= 10;
  ok2 &&= pass;
  console.log(
    `   ${P(mu, 6, 2)}${P(thetaC, 9, 3)}${P(t, 10, 4)}${P(t / mu, 10, 4)}${P(err, 8, 2)}%${(pass ? 'PASS' : 'FAIL').padStart(7)}`,
  );
}
console.log(`   ⟹ ② ${ok2 ? 'PASS' : 'FAIL'} (±10%)`);

/* ── ④ 비용 ───────────────────────────────────────────────────────────── */
console.log(`\n④ 비용 — 충돌 있음/없음 · 주기 every=1 vs N. **N을 정하지 않는다**(#15 입력)`);
console.log(
  `   ${'every'.padStart(7)}${'질의'.padStart(12)}${'충돌ms'.padStart(10)}${'총ms'.padStart(10)}${'충돌비중'.padStart(10)}${'관통정점'.padStart(10)}${'최대깊이[mm]'.padStart(14)}`,
);
{
  const L = 0.12;
  const nu = 25;
  const col: Collider = { kind: 'sphere', c: [0, 0, 0], r: R };
  const base = sheet(nu, nu, L, L, 0, R + 0.02);
  const sub = subFor(base.bends, base.s);
  {
    const { s, con } = sheet(nu, nu, L, L, 0, R + 0.02);
    const ms = run(s, con, undefined, sub, 2.5, 6);
    console.log(
      `   ${'없음'.padStart(7)}${'—'.padStart(12)}${'—'.padStart(10)}${P(ms, 10, 0)}${'—'.padStart(10)}${'—'.padStart(10)}${'—'.padStart(14)}`,
    );
  }
  for (const every of [1, 4, 16, 64]) {
    const { s, con } = sheet(nu, nu, L, L, 0, R + 0.02);
    const ms = run(s, con, { colliders: [col], thickness: THICK, mu: 0.3, every }, sub, 2.5, 6);
    const pen = penetration(s, [col], THICK);
    console.log(
      `   ${String(every).padStart(7)}${collisionStats[2].toExponential(2).padStart(12)}${P(collisionStats[3], 10, 0)}${P(ms, 10, 0)}` +
        `${P((collisionStats[3] / ms) * 100, 9, 1)}%${String(pen.cnt).padStart(10)}${P(pen.max * 1000, 14, 6)}`,
    );
  }
  console.log(`   (sub=${sub} · 정점 ${nu * nu} · T=2.5s · 충돌체 1개)`);
}

console.log(
  `\n[갈래] ${ok1 && ok2 ? 'A — ①②④ 통과(③은 §5 회귀에서)' : !ok1 ? 'C — ① 관통 잔존' : 'B — ② 마찰 임계각 불일치'}`,
);
if (!(ok1 && ok2)) process.exitCode = 1;
