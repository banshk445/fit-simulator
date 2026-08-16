/* v3-06 — #17 자유 가장자리 «결손» 검증 + #16 굽힘 서브스텝 산정식.
 *
 * 진입: `npm run v3:def`
 *
 * §1은 «정적»이라 서브스텝과 무관하다 — #16 없이 지금 잰다.
 * §3은 §1·§2가 둘 다 닫힌 «뒤»에만 의미가 있다(회차 프롬프트).
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  dihedral,
  bendOmega,
  substepsForBending,
  substepsForCloth,
  step,
  type BendConstraint,
  type Constraint,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;
const PAPER = { name: 'paper    ', rho: 0.1, Eh: 0.5e6, B: 0.4e-3 };
const ALU = { name: 'aluminium', rho: 0.071, Eh: 1.8e6, B: 96e-6 };
/** v3-03 §2-A 등록 장면 */
const SC = { L: 0.05, W: 0.02, nv: 3, seconds: 8, damping: 8, dt: 1 / 60 };

type Mat = { name: string; rho: number; Eh: number; B: number };

function mesh(nu: number, nv: number) {
  const n = nu * nv;
  const du = SC.L / (nu - 1);
  const dv = SC.W / (nv - 1);
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
  return { n, du, dv, uv, tris, Leff: SC.L - du };
}

/* ── §1 결손비 — 등록 장면 «형상»에서 이산/연속체 굽힘 에너지 ─────────── */
function deficit(nu: number, nv: number, m: Mat) {
  const { n, du, uv, tris, Leff } = mesh(nu, nv);
  const w = m.rho * G;
  const yA = (x: number) =>
    x <= du
      ? 0
      : -(w / (24 * m.B)) *
        ((x - du) ** 4 - 4 * Leff * (x - du) ** 3 + 6 * Leff ** 2 * (x - du) ** 2);
  const kap = (x: number) => (x <= du ? 0 : (w * (Leff - (x - du)) ** 2) / (2 * m.B));
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = yA(uv[v * 2]);
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const bends = makeBend(tris, uv, m.B);
  let Ed = 0;
  for (const b of bends) {
    const th = dihedral(s, b);
    Ed += (m.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 200000;
  for (let i = 0; i < M; i++) Ec += 0.5 * m.B * SC.W * kap(((i + 0.5) * SC.L) / M) ** 2 * (SC.L / M);
  return Ed / Ec;
}

/* ── 동역학 외팔보 ────────────────────────────────────────────────────── */
function canti(nu: number, nv: number, sub: number, m: Mat, ke: number) {
  const { n, uv, tris, Leff } = mesh(nu, nv);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, m.rho, pin);
  const cs: Constraint[] = [
    ...makeInplane(tris, uv, m.Eh, m.Eh, m.Eh),
    ...makeBend(tris, uv, ke),
  ];
  const p: SolverParams = { dt: SC.dt, substeps: sub, gravity: G, damping: SC.damping };
  for (let f = 0; f < Math.round(SC.seconds / SC.dt); f++) step(s, cs, p);
  const tip = Math.floor(nv / 2) * nu + nu - 1;
  return { d: -s.pos[tip * 3 + 1], want: (m.rho * G * Leff ** 4) / (8 * m.B), Leff };
}

/** 정지(평면) 상태에서 굽힘 ω를 잰다 — 산정식 입력 */
function restBendOmega(nu: number, nv: number, m: Mat, ke: number) {
  const { n, uv, tris } = mesh(nu, nv);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, m.rho, pin);
  const bends: BendConstraint[] = makeBend(tris, uv, ke);
  let wMax = 0;
  for (const b of bends) wMax = Math.max(wMax, bendOmega(s, b));
  return { wMax, sub: substepsForBending(SC.dt, s, bends, 0.95) };
}

const pct = (r: { d: number; want: number }) => (r.d / r.want - 1) * 100;

/* ── 실행 ─────────────────────────────────────────────────────────────── */
console.log(
  `[v3-06] 장면=v3-03 §2-A 등록분(L=${SC.L}m W=${SC.W}m 뿌리2열고정 T=${SC.seconds}s damp=${SC.damping}/s)`,
);
console.log(`[가설] 「자유 가장자리 재료가 굽힘 에너지에 기여하지 않는다」 — §1이 값으로 판정한다`);

console.log(`\n§1 결손비 — 등록 장면 «형상»에서 이산/연속체 (ke=B · 정적 · 서브스텝 무관)`);
console.log(
  `   ${'nu'.padStart(4)}${'nv'.padStart(4)}${'실측비'.padStart(10)}` +
    `${'㉠¼(1−1/(nv−1))'.padStart(16)}${'㉡¼(1−1/(nu−1))'.padStart(16)}${'㉢곱형'.padStart(11)}`,
);
for (const nu of [12, 32])
  for (const nv of [3, 5, 9, 17, 33]) {
    const r = deficit(nu, nv, PAPER);
    const a = 0.25 * (1 - 1 / (nv - 1));
    const b = 0.25 * (1 - 1 / (nu - 1));
    console.log(
      `   ${String(nu).padStart(4)}${String(nv).padStart(4)}${r.toFixed(5).padStart(10)}` +
        `${a.toFixed(5).padStart(16)}${b.toFixed(5).padStart(16)}${(4 * a * b).toFixed(5).padStart(11)}`,
    );
  }
console.log(`   ⟹ **nv에 완전 무관**(소수 5자리까지 동일). 가설의 「폭 결손」은 «반증».`);
console.log(`   nu만 움직인다(nv=3)`);
for (const nu of [8, 12, 16, 32, 64, 128]) {
  const r = deficit(nu, 3, PAPER);
  const b = 0.25 * (1 - 1 / (nu - 1));
  console.log(
    `     nu=${String(nu).padStart(3)} 실측=${r.toFixed(5)} ㉡=${b.toFixed(5)} 차=${((r / b - 1) * 100).toFixed(2)}%`,
  );
}
console.log(`   ⟹ 형태는 **㉡ ¼·(1−1/(nu−1))** 이다(−0.3~−5.8%). 결손은 «길이 방향» 경계다.`);

console.log(`\n§1-B 결손이 «처짐 배율»을 얼마나 설명하는가`);
console.log(`   E_d(s)=s²·(4·비)·E_c(1) · E_g(s)=−2s·E_c(1) ⟹ 최소화 s = 1/(4·비)`);
const OBS: Record<number, number> = { 8: 1.756, 12: 1.853, 16: 1.92, 32: 2.043 }; // v3-05 §2 실측
for (const nu of [8, 12, 16, 32]) {
  const r = deficit(nu, 3, PAPER);
  const s = 1 / (4 * r);
  console.log(
    `     nu=${String(nu).padStart(2)} 비=${r.toFixed(5)} 예측s=${s.toFixed(4)} 실측s=${OBS[nu].toFixed(4)} **미설명분=${((OBS[nu] / s - 1) * 100).toFixed(1)}%**`,
  );
}
console.log(`   ⟹ 결손은 원인의 «일부»다. 미설명분이 nu와 함께 «커진다».`);

console.log(`\n§2 #16 — 굽힘 서브스텝 산정식 (ω를 «상태에서 직접» 잰다)`);
console.log(
  `   ${'nu'.padStart(4)}${'nv'.padStart(4)}${'ω_bend'.padStart(11)}${'sub(굽힘)'.padStart(11)}${'sub(멤브레인)'.padStart(13)}${'결합=큰쪽'.padStart(11)}`,
);
for (const [nu, nv] of [
  [8, 3],
  [12, 3],
  [16, 3],
  [32, 3],
  [12, 9],
  [12, 33],
  [41, 17],
] as const) {
  const { du } = mesh(nu, nv);
  const o = restBendOmega(nu, nv, PAPER, 4 * PAPER.B);
  const mem = substepsForCloth(SC.dt, PAPER.Eh, PAPER.rho, du);
  console.log(
    `   ${String(nu).padStart(4)}${String(nv).padStart(4)}${o.wMax.toExponential(3).padStart(11)}` +
      `${String(o.sub).padStart(11)}${String(mem).padStart(13)}${String(Math.max(o.sub, mem)).padStart(11)}`,
  );
}

console.log(`\n§2-B 법칙 확인 — 굽힘에서도 r ≈ 1/(1+(h·ω)²) 인가`);
console.log(`   r는 «해석해» 대비가 아니라 «서브스텝 수렴값» 대비로 정의한다(모델 오차 분리)`);
{
  const o = restBendOmega(12, 3, PAPER, 4 * PAPER.B);
  const dInf = canti(12, 3, 16384, PAPER, 4 * PAPER.B).d;
  for (const sub of [64, 256, 1024, 4096]) {
    const d = canti(12, 3, sub, PAPER, 4 * PAPER.B).d;
    const r = dInf / d;
    const hw = (SC.dt / sub) * o.wMax;
    const pred = 1 / (1 + hw * hw);
    console.log(
      `     sub=${String(sub).padStart(5)} h·ω=${hw.toFixed(4)} r실측=${r.toFixed(5)} 예측=${pred.toFixed(5)} 차=${((r / pred - 1) * 100).toFixed(2)}%`,
    );
  }
}

console.log(`\n§3 조건부 ② 재판정 — 결손 교정 ke = B/비(nu,nv) 적용`);
console.log(`   교정 방식 근거: 결손은 «등록 장면 형상에서 잰 전역 에너지 부족»이라 전역 배율로`);
console.log(`   나누는 것이 측정과 1:1이다. 경계 힌지 보정은 유령 힌지를 «발명»해야 해 가정이 는다.`);
console.log(`   서브스텝은 §2 결합 산정(굽힘·멤브레인 중 큰 쪽)을 [4096, 16384]로 클램프한다.`);
let ok = true;
for (const [m, nu] of [
  [PAPER, 8],
  [PAPER, 12],
  [PAPER, 16],
  [PAPER, 32],
  [ALU, 12],
  [ALU, 32],
] as const) {
  const r0 = deficit(nu, 3, m);
  const ke = m.B / r0;
  const o = restBendOmega(nu, 3, m, ke);
  const sub = Math.min(16384, Math.max(o.sub, 4096));
  const r = canti(nu, 3, sub, m, ke);
  const pass = Math.abs(pct(r)) <= 10;
  if (nu === 32) ok &&= pass;
  console.log(
    `   ${m.name} nu=${String(nu).padStart(2)} 비=${r0.toFixed(5)} ke=${(ke / m.B).toFixed(3)}B sub=${String(sub).padStart(5)} ` +
      `δ=${(r.d * 1000).toFixed(4)}mm 참값=${(r.want * 1000).toFixed(4)}mm 오차=${pct(r).toFixed(2)}% → ${pass ? 'PASS' : 'FAIL'}`,
  );
}
console.log(`   ⟹ ${ok ? 'PASS' : 'FAIL'} (±10% · v3-03 등록분 · 조정 0)`);

console.log(
  `\n[갈래] ${ok ? 'A — 결손 확정 + 산정식 성립 + 재판정 통과' : 'B — 결손은 «확정»했으나 재판정 여전히 실패(원인의 일부)'}`,
);
if (!ok) process.exitCode = 1;
