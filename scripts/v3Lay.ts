/* v3-07 — ② 잔여 오차의 «층 분리». 진단만 · 처방 0.
 *
 * 진입: `npm run v3:lay`
 *
 * 세 층을 가른다:
 *   (가) 원소 종횡비 — nv 고정 계열에서 원소가 1:1.4 → 1:6.2로 찌그러진다
 *   (나) 이산화 «바닥» — 종횡비를 1로 고정해도 남는 오차
 *   (다) 기울기 불일치 — 에너지는 맞아도 시뮬이 «싼» 형상을 찾는가
 *
 * 계기 조건 2건(둘 다 «앞 판이 값으로» 뒷받침한다):
 *  · kMem = 100 N/m — v3-05 §2-B 배제 ①이 5e5→1e2에서 오차 0.07pp를 실측했다.
 *    멤브레인 정확도는 이 장면에 무관하고, 낮추면 서브스텝 예산이 굽힘에만 걸린다.
 *  · T=3s · damp=20/s — 정지 해는 감쇠와 무관하다. §0에서 등록 조건(T=8·damp=8)과
 *    같은 값을 내는지 «확인»하고 쓴다.
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  dihedral,
  substepsForBending,
  step,
  type BendConstraint,
  type Constraint,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;
const PAPER = { name: 'paper', rho: 0.1, B: 0.4e-3 };
const ALU = { name: 'alu  ', rho: 0.071, B: 96e-6 };
type Mat = { name: string; rho: number; B: number };

const KMEM = 100;
const DT = 1 / 60;

function mesh(nu: number, nv: number, L: number, W: number) {
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
  return { n, du, dv, uv, tris, Leff: L - du };
}

/** 해석 소변형 외팔보(둘째 고정 열 기준) */
function analytic(m: Mat, du: number, Leff: number) {
  const w = m.rho * G;
  return {
    y: (x: number) =>
      x <= du
        ? 0
        : -(w / (24 * m.B)) *
          ((x - du) ** 4 - 4 * Leff * (x - du) ** 3 + 6 * Leff ** 2 * (x - du) ** 2),
    kap: (x: number) => (x <= du ? 0 : (w * (Leff - (x - du)) ** 2) / (2 * m.B)),
    tip: (w * Leff ** 4) / (8 * m.B),
  };
}

/** 경계 결손비 — 해석 형상에서 이산/연속체 (v3-06 §1) */
function deficit(nu: number, nv: number, L: number, W: number, m: Mat) {
  const { n, du, uv, tris, Leff } = mesh(nu, nv, L, W);
  const a = analytic(m, du, Leff);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = a.y(uv[v * 2]);
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  let Ed = 0;
  for (const b of makeBend(tris, uv, m.B)) {
    const th = dihedral(s, b);
    Ed += (m.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 100000;
  for (let i = 0; i < M; i++) Ec += 0.5 * m.B * W * a.kap(((i + 0.5) * L) / M) ** 2 * (L / M);
  return Ed / Ec;
}

/** 외팔보 실행. ke는 결손 교정 적용. 반환에 형상·힌지 포함(§3용) */
function run(
  nu: number,
  nv: number,
  L: number,
  W: number,
  m: Mat,
  sub: number,
  secs: number,
  damping: number,
) {
  const { n, du, uv, tris, Leff } = mesh(nu, nv, L, W);
  const ke = m.B / deficit(nu, nv, L, W, m);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, m.rho, pin);
  const bends: BendConstraint[] = makeBend(tris, uv, ke);
  const cs: Constraint[] = [...makeInplane(tris, uv, KMEM, KMEM, KMEM), ...bends];
  const p: SolverParams = { dt: DT, substeps: sub, gravity: G, damping };
  for (let f = 0; f < Math.round(secs / DT); f++) step(s, cs, p);
  let mv = 0;
  for (let v = 0; v < n; v++)
    mv = Math.max(mv, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  const mid = Math.floor(nv / 2);
  return {
    s,
    bends,
    uv,
    nu,
    nv,
    du,
    Leff,
    ke,
    mv,
    d: -s.pos[(mid * nu + nu - 1) * 3 + 1],
    want: analytic(m, du, Leff).tip,
  };
}

/** 산정 서브스텝(굽힘 기준). 결손 교정된 ke로 잰다. */
function subFor(nu: number, nv: number, L: number, W: number, m: Mat) {
  const { n, uv, tris } = mesh(nu, nv, L, W);
  const ke = m.B / deficit(nu, nv, L, W, m);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, m.rho, pin);
  return substepsForBending(DT, s, makeBend(tris, uv, ke), 0.95);
}

const pct = (r: { d: number; want: number }) => (r.d / r.want - 1) * 100;
const P = (x: number, w = 8, d = 2) => x.toFixed(d).padStart(w);

/* ── §0 계기 조건 확인 ─────────────────────────────────────────────────── */
console.log(`[v3-07] 진단 판 · 처방 0. kMem=${KMEM}N/m(v3-05 배제① 근거) · ω는 상태에서 직접`);
console.log(`\n§0 계기 조건 확인 — 감쇠·시간을 바꿔도 «정지 해»가 같은가 (paper 12×3 L=.05 W=.02)`);
{
  const sub = Math.max(4096, subFor(12, 3, 0.05, 0.02, PAPER));
  const a = run(12, 3, 0.05, 0.02, PAPER, sub, 8, 8);
  const b = run(12, 3, 0.05, 0.02, PAPER, sub, 3, 20);
  console.log(
    `   T=8s damp=8  δ=${(a.d * 1000).toFixed(4)}mm 오차=${P(pct(a))}% 잔류=${a.mv.toExponential(1)}`,
  );
  console.log(
    `   T=3s damp=20 δ=${(b.d * 1000).toFixed(4)}mm 오차=${P(pct(b))}% 잔류=${b.mv.toExponential(1)}  차=${((b.d / a.d - 1) * 100).toFixed(3)}%`,
  );
  console.log(`   ⟹ 같으면 아래 계열에 T=3s·damp=20을 쓴다(비용 2.7배 절감)`);
}

/* ── §1 종횡비 분리 ───────────────────────────────────────────────────── */
const L0 = 0.05;
const W0 = 0.02;
function cell(nu: number, nv: number, m: Mat, L = L0, W = W0, checkConv = false) {
  const sub = Math.max(2048, subFor(nu, nv, L, W, m));
  const r = run(nu, nv, L, W, m, sub, 3, 20);
  let conv = '';
  if (checkConv) {
    const r2 = run(nu, nv, L, W, m, sub * 2, 3, 20);
    const diff = Math.abs(r2.d / r.d - 1) * 100;
    conv = ` [2배 수렴차 ${diff.toFixed(3)}%${diff > 0.5 ? ' **미해상**' : ''}]`;
  }
  const { dv, du } = mesh(nu, nv, L, W);
  return { r, sub, conv, asp: dv / du };
}

console.log(`\n§1 종횡비 분리 — 경계 결손 «교정된» ke = B/비 적용 (paper · L=${L0} W=${W0})`);
console.log(`   계열 A — 원소 종횡비 = 1 고정 (nu·nv를 함께 올린다)`);
console.log(
  `     ${'nu×nv'.padStart(8)}${'dv/du'.padStart(7)}${'sub'.padStart(7)}${'ke/B'.padStart(8)}${'오차'.padStart(9)}`,
);
for (const [nu, nv] of [
  [6, 3],
  [11, 5],
  [21, 9],
  [41, 17],
] as const) {
  // 41×17의 2배 확인은 뺀다 — 21×9에서 0.239%로 이미 확인했고 그 셀만 30분 넘게 든다
  const c = cell(nu, nv, PAPER, L0, W0, nu === 21);
  console.log(
    `     ${`${nu}×${nv}`.padStart(8)}${P(c.asp, 7, 3)}${String(c.sub).padStart(7)}${P(c.r.ke / PAPER.B, 8, 3)}${P(pct(c.r), 8)}%${c.conv}`,
  );
}
console.log(`   계열 B — nv=3 고정 (nu만 올린다 · 종횡비가 찌그러진다)`);
for (const nu of [8, 12, 16, 32]) {
  const c = cell(nu, 3, PAPER);
  console.log(
    `     ${`${nu}×3`.padStart(8)}${P(c.asp, 7, 3)}${String(c.sub).padStart(7)}${P(c.r.ke / PAPER.B, 8, 3)}${P(pct(c.r), 8)}%`,
  );
}
console.log(`   계열 C — nu=16 고정 · nv만 올린다(종횡비 스윕)`);
for (const nv of [3, 5, 9, 17, 33]) {
  const c = cell(16, nv, PAPER);
  console.log(
    `     ${`16×${nv}`.padStart(8)}${P(c.asp, 7, 3)}${String(c.sub).padStart(7)}${P(c.r.ke / PAPER.B, 8, 3)}${P(pct(c.r), 8)}%`,
  );
}

/* ── §2 세장 시편 «추가» ──────────────────────────────────────────────── */
console.log(`\n§2 세장 시편 «추가»(등록 장면은 유지) — 참값 공식의 적용 범위`);
console.log(
  `   등록 장면은 L/W=2.5. ASTM D1388 시편은 25×200mm(L/W=8)이고 보 이론은 세장비가 클 때 선다.`,
);
console.log(
  `     ${'물성'.padStart(6)}${'L(mm)'.padStart(8)}${'W(mm)'.padStart(8)}${'L/W'.padStart(6)}${'nu×nv'.padStart(8)}${'dv/du'.padStart(7)}${'sub'.padStart(7)}${'δ/Leff'.padStart(9)}${'오차'.padStart(9)}`,
);
let slenderOK = true;
for (const [m, L, nv] of [
  [PAPER, 0.055, 4],
  [ALU, 0.038, 4],
] as const) {
  const W = L / 8;
  const dv = W / (nv - 1);
  const nu = Math.round(L / dv) + 1;
  const c = cell(nu, nv, m, L, W, true);
  const ok = Math.abs(pct(c.r)) <= 10;
  slenderOK &&= ok;
  console.log(
    `     ${m.name.padStart(6)}${P(L * 1000, 8, 1)}${P(W * 1000, 8, 2)}${P(L / W, 6, 1)}${`${nu}×${nv}`.padStart(8)}` +
      `${P(c.asp, 7, 3)}${String(c.sub).padStart(7)}${P((c.r.d / c.r.Leff) * 100, 8)}%${P(pct(c.r), 8)}% → ${ok ? 'PASS' : 'FAIL'}${c.conv}`,
  );
}
console.log(`   ⟹ 세장 장면 ${slenderOK ? 'PASS' : 'FAIL'} (±10% · 조정 0)`);

/* ── §3 시뮬 «수렴 형상»의 이산/연속체 에너지 비 ──────────────────────── */
console.log(`\n§3 시뮬 수렴 형상의 에너지 비 — 처방(해석) 형상 비와 다른가`);
console.log(`   연속체는 형상에서 곡률을 유한차분으로 뽑아 ∫½BWκ²dx. 뿌리/자유단 절반으로 나눈다.`);
console.log(
  `     ${'nu×nv'.padStart(8)}${'해석형상비'.padStart(12)}${'시뮬형상비'.padStart(12)}${'뿌리절반'.padStart(11)}${'자유단절반'.padStart(12)}`,
);
for (const [nu, nv] of [
  [12, 3],
  [32, 3],
  [21, 9],
] as const) {
  const c = cell(nu, nv, PAPER);
  const { s, bends, uv, du } = c.r;
  const mid = Math.floor(nv / 2);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nu; i++) {
    xs.push(uv[(mid * nu + i) * 2]);
    ys.push(s.pos[(mid * nu + i) * 3 + 1]);
  }
  const half = du + c.r.Leff / 2;
  let EcAll = 0;
  let EcRoot = 0;
  for (let i = 1; i < nu - 1; i++) {
    const h1 = xs[i] - xs[i - 1];
    const h2 = xs[i + 1] - xs[i];
    const yp = (ys[i + 1] - ys[i - 1]) / (h1 + h2);
    const ypp = (2 * (h1 * ys[i + 1] - (h1 + h2) * ys[i] + h2 * ys[i - 1])) / (h1 * h2 * (h1 + h2));
    const kap = Math.abs(ypp) / (1 + yp * yp) ** 1.5;
    const seg = 0.5 * PAPER.B * W0 * kap * kap * ((h1 + h2) / 2);
    EcAll += seg;
    if (xs[i] < half) EcRoot += seg;
  }
  let EdAll = 0;
  let EdRoot = 0;
  for (const b of bends) {
    const th = dihedral(s, b);
    const e = (c.r.ke * th * th) / (2 * b.shape);
    EdAll += e;
    if ((uv[b.p0 * 2] + uv[b.p1 * 2]) / 2 < half) EdRoot += e;
  }
  console.log(
    `     ${`${nu}×${nv}`.padStart(8)}${P(deficit(nu, nv, L0, W0, PAPER), 12, 5)}${P(EdAll / EcAll, 12, 5)}` +
      `${P(EdRoot / EcRoot, 11, 5)}${P((EdAll - EdRoot) / (EcAll - EcRoot), 12, 5)}`,
  );
}
console.log(`   ※ 시뮬 형상 비는 «교정된 ke»로 계산했다 ⟹ 1.0에 가까우면 이산 에너지가 연속체와 맞는다`);
