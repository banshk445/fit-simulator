/* v3-08 — 종횡비 처방이 «수렴»인가 «상쇄»인가. 진단만 · 처방 0.
 *
 * 진입: `npm run v3:asp`
 *
 * v3-07 계열 C는 `nu=16` «하나»에서만 쟀다. 4.77%가 수렴값인지 그 종횡비에서의
 * 우연한 상쇄인지 미확인이다. 여기서는 **종횡비를 고정하고 절대 해상도를 올린다.**
 *
 * 계기 조건은 v3-07 §0-B가 확인한 그대로: kMem=100 · T=3s · damp=20/s
 * (등록 조건과 δ가 소수 4자리까지 같음이 실측됐다).
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
const PAPER = { rho: 0.1, B: 0.4e-3 };
const KMEM = 100;
const DT = 1 / 60;
const L0 = 0.05;
const W0 = 0.02;
/** 실행 상한 — 넘으면 «무효»로 적고 넘어간다(추정 금지) */
// 상한 20,000 — 이 위는 한 셀에 90분을 넘는다(31×31 sub=40,664 실측). 회차 프롬프트가
// 「실행 불가한 셀은 무효로 적고 넘어간다(추정 금지)」를 사전 등록했다.
const SUB_CAP = 20000;

function mesh(nu: number, nv: number, alt: boolean) {
  const n = nu * nv;
  const du = L0 / (nu - 1);
  const dv = W0 / (nv - 1);
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
      const b = a + 1;
      const c = a + nu;
      const d = a + nu + 1;
      if (!alt || (i + j) % 2 === 0) tris.push(a, b, c, b, d, c);
      else tris.push(a, b, d, a, d, c);
    }
  return { n, du, dv, uv, tris, Leff: L0 - du, asp: dv / du };
}

function analytic(du: number, Leff: number) {
  const w = PAPER.rho * G;
  return {
    y: (x: number) =>
      x <= du
        ? 0
        : -(w / (24 * PAPER.B)) *
          ((x - du) ** 4 - 4 * Leff * (x - du) ** 3 + 6 * Leff ** 2 * (x - du) ** 2),
    kap: (x: number) => (x <= du ? 0 : (w * (Leff - (x - du)) ** 2) / (2 * PAPER.B)),
    tip: (w * Leff ** 4) / (8 * PAPER.B),
  };
}

/** 경계 결손비(v3-06 §1) — 삼각화 방식에 따라 달라질 수 있으므로 alt를 함께 받는다 */
function deficit(nu: number, nv: number, alt: boolean) {
  const { n, du, uv, tris, Leff } = mesh(nu, nv, alt);
  const a = analytic(du, Leff);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = a.y(uv[v * 2]);
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  let Ed = 0;
  for (const b of makeBend(tris, uv, PAPER.B)) {
    const th = dihedral(s, b);
    Ed += (PAPER.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 100000;
  for (let i = 0; i < M; i++)
    Ec += 0.5 * PAPER.B * W0 * a.kap(((i + 0.5) * L0) / M) ** 2 * (L0 / M);
  return Ed / Ec;
}

function build(nu: number, nv: number, alt: boolean) {
  const m = mesh(nu, nv, alt);
  const ke = PAPER.B / deficit(nu, nv, alt);
  const s = makeSolver(m.n);
  for (let v = 0; v < m.n; v++) {
    s.pos[v * 3] = m.uv[v * 2];
    s.pos[v * 3 + 2] = m.uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, m.tris, m.uv, PAPER.rho, pin);
  const bends: BendConstraint[] = makeBend(m.tris, m.uv, ke);
  return { m, s, bends, ke };
}

function solve(nu: number, nv: number, alt: boolean, sub: number) {
  const { m, s, bends, ke } = build(nu, nv, alt);
  const cs: Constraint[] = [...makeInplane(m.tris, m.uv, KMEM, KMEM, KMEM), ...bends];
  const p: SolverParams = { dt: DT, substeps: sub, gravity: G, damping: 20 };
  for (let f = 0; f < Math.round(3 / DT); f++) step(s, cs, p);
  const mid = Math.floor(nv / 2);
  return {
    d: -s.pos[(mid * nu + nu - 1) * 3 + 1],
    want: analytic(m.du, m.Leff).tip,
    ke,
    asp: m.asp,
    n: m.n,
  };
}

function sized(nu: number, nv: number, alt: boolean) {
  const { s, bends } = build(nu, nv, alt);
  return Math.max(2048, substepsForBending(DT, s, bends, 0.95));
}

const pct = (r: { d: number; want: number }) => (r.d / r.want - 1) * 100;
const P = (x: number, w = 8, d = 2) => x.toFixed(d).padStart(w);

/** 한 셀. 상한 초과면 «무효». conv=true면 2배 수렴 확인. */
function cell(nu: number, nv: number, alt = false, conv = false) {
  const sub = sized(nu, nv, alt);
  if (sub > SUB_CAP) return { sub, invalid: true as const };
  const r = solve(nu, nv, alt, sub);
  let note = '';
  if (conv) {
    if (sub * 2 > SUB_CAP) note = ' [2배 확인 = 상한 초과 · 미확인]';
    else {
      const r2 = solve(nu, nv, alt, sub * 2);
      const diff = Math.abs(r2.d / r.d - 1) * 100;
      note = ` [2배차 ${diff.toFixed(3)}%${diff > 0.5 ? ' **미해상**' : ''}]`;
    }
  }
  return { sub, invalid: false as const, r, note };
}

function row(label: string, nu: number, nv: number, alt = false, conv = false) {
  const c = cell(nu, nv, alt, conv);
  if (c.invalid) {
    console.log(`   ${label.padStart(11)}  산정 sub=${c.sub} > 상한 ${SUB_CAP} ⟹ **무효(실행 안 함)**`);
    return;
  }
  console.log(
    `   ${label.padStart(11)}${P(c.r.asp, 8, 3)}${String(c.r.n).padStart(7)}${String(c.sub).padStart(8)}` +
      `${P(c.r.ke / PAPER.B, 8, 3)}${P(pct(c.r), 9)}%${c.note}`,
  );
}

console.log(`[v3-08] 진단 판 · 처방 0. kMem=${KMEM} · T=3s · damp=20/s (v3-07 §0-B 확인분)`);
console.log(
  `[핵심 물음] 종횡비를 «고정»하고 절대 해상도를 올리면 오차가 0으로 가는가(수렴) 머무는가(상쇄)`,
);
const H =
  `   ${'nu×nv'.padStart(11)}${'dv/du'.padStart(8)}${'정점'.padStart(7)}${'sub'.padStart(8)}${'ke/B'.padStart(8)}${'오차'.padStart(10)}`;

console.log(`\n§1-A 종횡비 ≡ 0.4 고정 (nv = nu ⟹ dv/du = 0.4·(nu−1)/(nv−1) = 0.4)`);
console.log(H);
for (const nu of [6, 11, 16, 21, 31]) row(`${nu}×${nu}`, nu, nu, false, nu === 16);

console.log(`\n§1-B 종횡비 ≡ 0.2 고정 (nv−1 = 2(nu−1))`);
console.log(H);
for (const nu of [6, 11, 16]) row(`${nu}×${2 * nu - 1}`, nu, 2 * nu - 1, false, false);

console.log(`\n§1-C 계열 A(종횡비 = 1) 연장 — 20.8%가 바닥인지 한 단계 더`);
console.log(`   41×17 = **20.81%**는 v3-07 §1 계열 A 실측을 «인용»한다(같은 솔버·같은 교정·같은 조건).`);
console.log(H);
row(`51×21`, 51, 21, false, false);

console.log(`\n§2 대각 분할 의존 — 상쇄면 삼각화에 «민감»하고 수렴이면 둔감하다`);
console.log(H);
for (const [nu, nv] of [
  [21, 9],
  [16, 16],
  [16, 17],
] as const) {
  row(`${nu}×${nv} 고정`, nu, nv, false, false);
  row(`${nu}×${nv} 교대`, nu, nv, true, false);
}
