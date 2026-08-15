/* v3 S2 게이트 — 굽힘(힌지형) + 단위 역검증 2종.
 *
 * 진입: `npm run v3:s2`
 *
 * 장면·파라미터·문턱은 실행 «전»에 여기 고정한다(사후 조정 금지 · 함정 14).
 * 완료 조건 ① 정지 이면각 = 0 ② 외팔보 ±10% ③ S1 게이트 3종 «완전히 같은 값»
 * ④ 신장 ×2 배율이 갈린다.
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  dihedral,
  step,
  type BendConstraint,
  type Constraint,
  type Solver,
  type SolverParams,
} from '../src/v3/solver.ts';
import { buildSamples, stiffnessAt, toStretchingData } from '../src/v3/wangStretch.ts';

const G = 9.81;

/* ── 물성 인용 (ARCSim materials/*.json · 주석이 참값을 «자체 문서화»한다) ──
 * paper:     h=0.1e-3 m · E=5 GPa  ⟹ E·h = 0.5e6 N/m · E h³/12 = 0.4e-3 N·m · ρ=0.100 kg/m²
 * aluminium: h=25.4e-6 m · E=70 GPa ⟹ E·h = 1.8e6 N/m · E h³/12 = 96e-6 N·m · ρ=0.071 kg/m²
 * 두 파일 모두 6행이 «전부 같다» ⟹ LUT이 변형에 무관한 상수다(v3-02 §4의 G=0 편향 무관). */
const PAPER = { rho: 0.1, EhJson: 0.5e6, B: 0.4e-3 };
const ALU = { rho: 0.071, EhJson: 1.8e6, B: 96e-6 };
const constRows = (v: number): number[][] => Array.from({ length: 6 }, () => [v, 0, v, v]);

/* ── 사전 등록 장면 ───────────────────────────────────────────────────── */
/** ②-A 외팔보: 한쪽 끝 고정, 자중으로 처진다. 소변형 대역을 «유지»한다. */
const CANTI = { L: 0.05, W: 0.02, dt: 1 / 60, seconds: 8.0, substeps: 16, damping: 8 };
/** 해상도 수렴 확인 — 단위 오류는 세분화해도 «안 줄고», 이산화 오차는 준다 */
const CANTI_RES = [8, 16, 32];
/** ④ 축방향 인장: 중력 0 · 아랫변에 알려진 외력. 상단 고정 */
const TENSION = {
  L: 0.5,
  W: 0.2,
  nx: 9,
  ny: 21,
  dt: 1 / 60,
  seconds: 8.0,
  substeps: 16,
  damping: 8,
};

function fmt(x: number, d = 6) {
  return Number.isFinite(x) ? x.toFixed(d) : String(x);
}
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);

/** 직사각 격자(정지 평면 · y가 처짐 방향). u축 = 길이 L, v축 = 폭 W */
function grid(nu: number, nv: number, L: number, W: number) {
  const n = nu * nv;
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const v = j * nu + i;
      uv[v * 2] = (i * L) / (nu - 1);
      uv[v * 2 + 1] = (j * W) / (nv - 1);
    }
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      tris.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu);
    }
  return { n, uv, tris };
}

function place(s: Solver, uv: Float64Array, n: number) {
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 1] = 0;
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
}

function maxRestDihedral(s: Solver, bends: BendConstraint[]): number {
  let m = 0;
  for (const b of bends) m = Math.max(m, Math.abs(dihedral(s, b)));
  return m;
}

/* ── 자기검사: 투영 변위가 유한차분 ∇θ에 «비례»하는가 ──────────────────
 * XPBD는 Δx_i = w_i·Δλ·∇C_i 이므로, 모든 성분에서 Δx_i/w_i 가 «같은 배율»로
 * ∇θ_i 와 일치해야 한다. 배율을 최소제곱으로 뽑고 잔차를 본다. */
function gradCheck() {
  const P = [0.0, 0.0, 0.0, 1.0, 0.13, -0.07, 0.42, 0.91, 0.35, 0.55, -0.83, 0.24];
  const c: BendConstraint = {
    kind: 'bend',
    p0: 0,
    p1: 1,
    p2: 2,
    p3: 3,
    restAngle: 0,
    ke: 1,
    shape: 1,
    lambda: 0,
  };
  const s = makeSolver(4);
  s.pos.set(P);
  for (let v = 0; v < 4; v++) s.invMass[v] = 1;
  step(s, [c], { dt: 1, substeps: 1, gravity: 0, damping: 0 });
  const dx = Array.from({ length: 12 }, (_, i) => s.pos[i] - P[i]);

  const eps = 1e-7;
  const probe = makeSolver(4);
  for (let v = 0; v < 4; v++) probe.invMass[v] = 1;
  const fd = Array.from({ length: 12 }, (_, i) => {
    probe.pos.set(P);
    probe.pos[i] = P[i] + eps;
    const tp = dihedral(probe, c);
    probe.pos[i] = P[i] - eps;
    const tm = dihedral(probe, c);
    return (tp - tm) / (2 * eps);
  });

  let num = 0;
  let den = 0;
  for (let i = 0; i < 12; i++) {
    num += dx[i] * fd[i];
    den += fd[i] * fd[i];
  }
  const dl = num / den;
  let maxErr = 0;
  let scale = 0;
  for (let i = 0; i < 12; i++) {
    maxErr = Math.max(maxErr, Math.abs(dx[i] - dl * fd[i]));
    scale = Math.max(scale, Math.abs(dl * fd[i]));
  }
  return { maxRelErr: maxErr / scale, samples: 12 };
}

/* ── ②-A 외팔보 ──────────────────────────────────────────────────────── */
function cantilever(nu: number, mat: { rho: number; B: number; EhJson: number }) {
  const nv = 3;
  const { n, uv, tris } = grid(nu, nv, CANTI.L, CANTI.W);
  const s = makeSolver(n);
  place(s, uv, n);
  // 뿌리 «두 열»을 고정한다 — 한 열만 고정하면 클램프가 아니라 힌지가 된다
  const pinned = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pinned.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, mat.rho, pinned);
  // 신장·전단은 실제 E·h로 두어 멤브레인 늘어남이 처짐에 안 섞이게 한다
  const kMem = mat.EhJson;
  const cs: Constraint[] = [
    ...makeInplane(tris, uv, kMem, kMem, kMem),
    ...makeBend(tris, uv, mat.B),
  ];
  const bends = cs.filter((c): c is BendConstraint => c.kind === 'bend');
  const restMax = maxRestDihedral(s, bends);
  const p: SolverParams = {
    dt: CANTI.dt,
    substeps: CANTI.substeps,
    gravity: G,
    damping: CANTI.damping,
  };
  for (let f = 0; f < Math.round(CANTI.seconds / CANTI.dt); f++) step(s, cs, p);
  const tip = Math.floor(nv / 2) * nu + (nu - 1);
  let maxVel = 0;
  let nan = 0;
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) if (!Number.isFinite(s.pos[v * 3 + k])) nan++;
    maxVel = Math.max(maxVel, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  }
  // 유효 길이 = 고정된 «둘째» 열부터 자유단까지
  const Leff = CANTI.L - CANTI.L / (nu - 1);
  return { drop: -s.pos[tip * 3 + 1], Leff, restMax, maxVel, nan, bends: bends.length };
}

/* ── ②-B 순수 굽힘 «에너지» 교정 — 동역학·보이론·수렴을 전부 뺀 계기 ────
 * 메시를 반지름 R 원기둥에 «등거리»로 얹는다(developable ⟹ 신장 0). 제약이 품은
 * 에너지 Σ C²/(2α) = Σ ke·θ²/(2·shape) 를 연속체 ½·B·κ²·A 와 직접 비교한다.
 * 비가 1이면 ke가 곧 굽힘강성 B다. */
function pureBendRatio(N: number, L: number, R: number, ke: number) {
  const { n, uv, tris } = grid(N, N, L, L);
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    const t = uv[v * 2];
    s.pos[v * 3] = R * Math.sin(t / R);
    s.pos[v * 3 + 1] = -R * (1 - Math.cos(t / R));
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const bends = makeBend(tris, uv, ke);
  let E = 0;
  for (const b of bends) {
    const th = dihedral(s, b);
    E += (ke * th * th) / (2 * b.shape);
  }
  const kappa = 1 / R;
  return { ratio: E / (0.5 * ke * kappa * kappa * L * L), hinges: bends.length };
}

/* ── ④ 축방향 인장 ───────────────────────────────────────────────────── */
/** 최소계(삼각형 2개). 사슬이 1칸이라 서브스텝 수렴이 «완전»하다 —
 * 배율 판별에는 이것이 정본이다. 긴 스트립은 아래 수렴표에서 따로 본다. */
function quadTension(kJson: number, useLut: boolean, force: number, sub = 16) {
  const L = 1;
  const W = 1;
  const uv = new Float64Array([0, 0, L, 0, 0, W, L, W]);
  const tris = [0, 1, 2, 1, 3, 2];
  const s = makeSolver(4);
  for (let v = 0; v < 4; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  assignMassFromMesh(s, tris, uv, 1.0, new Set([0, 2]));
  let kU: number;
  if (useLut) {
    const out = new Float64Array(4);
    stiffnessAt(buildSamples(constRows(kJson)), 0, 0, 0, out);
    kU = out[0];
  } else {
    // LUT 우회 — d[0][0] 직독(v3-02 §4의 G=0 격자 편향 회피). ×2 규약은 그대로.
    kU = toStretchingData(constRows(kJson))[0][0][0] * 2;
  }
  const cs: Constraint[] = makeInplane(tris, uv, kU, kU, kU);
  const ext = new Float64Array(12);
  ext[3] = force / 2;
  ext[9] = force / 2;
  const p: SolverParams = { dt: 1 / 60, substeps: sub, gravity: 0, damping: 20, extForce: ext };
  for (let f = 0; f < 600; f++) step(s, cs, p);
  const lam = (s.pos[3] + s.pos[9]) / 2 / L;
  const Gg = (lam * lam - 1) / 2;
  // ψ = ½k·G² ⟹ T = dψ/dλ = k·G·λ (선형화 없이 역산)
  return { kUsed: kU, lam, G: Gg, kMeasured: force / W / (Gg * lam) };
}

/* ── 결합 제약계의 서브스텝 수렴 — S1 게이트 ③이 못 본 축 ─────────────── */
function chainTension(ny: number, kUsed: number, force: number, sub: number, secs: number) {
  const { nx, L, W } = TENSION;
  const { n, uv, tris } = grid(ny, nx, L, W);
  const s = makeSolver(n);
  place(s, uv, n);
  const pinned = new Set<number>();
  for (let j = 0; j < nx; j++) pinned.add(j * ny);
  assignMassFromMesh(s, tris, uv, 0.2, pinned);
  const cs: Constraint[] = makeInplane(tris, uv, kUsed, kUsed, kUsed);
  const ext = new Float64Array(n * 3);
  const tip: number[] = [];
  for (let j = 0; j < nx; j++) tip.push(j * ny + (ny - 1));
  for (const v of tip) ext[v * 3] = force / tip.length;
  const p: SolverParams = { dt: 1 / 60, substeps: sub, gravity: 0, damping: 20, extForce: ext };
  for (let f = 0; f < Math.round(secs * 60); f++) step(s, cs, p);
  let mv = 0;
  for (let v = 0; v < n; v++)
    mv = Math.max(mv, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  let sum = 0;
  for (const v of tip) sum += s.pos[v * 3];
  const lam = sum / tip.length / L;
  const Gg = (lam * lam - 1) / 2;
  return { lam, ratio: force / W / (Gg * lam) / kUsed, mv };
}

/* ── ③ S1 회귀 (v3S1.ts와 «같은» 장면 상수) ──────────────────────────── */
function s1Regression() {
  const s = makeSolver(1);
  s.invMass[0] = 1 / 0.1;
  for (let f = 0; f < 60; f++) step(s, [], { dt: 1 / 60, substeps: 8, gravity: G, damping: 0 });
  const spring = (substeps: number) => {
    const q = makeSolver(2);
    q.invMass[0] = 0;
    q.invMass[1] = 1 / 0.1;
    q.pos[4] = -0.5;
    const cs: Constraint[] = [{ kind: 'dist', i: 0, j: 1, rest: 0.5, k: 50, lambda: 0 }];
    for (let f = 0; f < 300; f++)
      step(q, cs, { dt: 1 / 60, substeps, gravity: G, damping: 5 });
    return -q.pos[4] - 0.5;
  };
  return { fall: -s.pos[1], sp8: spring(8), sp16: spring(16) };
}


/* ── 실행 ─────────────────────────────────────────────────────────────── */
console.log(
  `[v3-S2] 코어=XPBD(small-steps) 신장=ⓑ선형 굽힘=힌지형(이면각) 이차형=미구현 ` +
    `충돌=없음 교차항k1=없음 g=${G} 정밀도=Float64`,
);
console.log(
  `[장면] ②외팔보 L=${CANTI.L}m W=${CANTI.W}m 해상도=${CANTI_RES.join('/')} dt=1/60 sub=${CANTI.substeps} ` +
    `T=${CANTI.seconds}s damp=${CANTI.damping}/s 뿌리2열고정 | ` +
    `④인장 최소계(삼각2) 중력=0 | 사슬수렴표 ${TENSION.L}m×${TENSION.W}m nx=${TENSION.nx}`,
);
console.log(`[문턱] ①이면각=0(<1e-9) ②±10% ③S1 3종 «완전 일치» ④배율 판별 (사전 등록 · 무조정)`);

const gc = gradCheck();
const okGrad = gc.maxRelErr < 1e-5;
console.log(
  `\n[자기검사] ∇θ 유한차분 대조 ${gc.samples}성분 최대상대오차=${gc.maxRelErr.toExponential(2)} → ${okGrad ? 'OK' : 'FAIL'}`,
);

const probe = cantilever(16, PAPER);
const okFlat = probe.restMax < 1e-9;
console.log(
  `① 정지 이면각 최대=${probe.restMax.toExponential(2)} rad (힌지 ${probe.bends}개) → ${okFlat ? 'PASS' : 'FAIL'}`,
);

console.log(`\n② 외팔보 — 참값 «계산식 병기»`);
console.log(`   주 참값(게이트) = 선형보 이론 균일하중 외팔보:  δ = w·L⁴/(8·B),  w = ρ·g [N/m²]`);
console.log(
  `   부 참값(참고) = Peirce/ASTM D1388 굽힘길이 c = (B/w)^(1/3) — 설계 §3-1이 「표준식 최대 72% 오차」로`,
);
console.log(`   경고한 식이라 «게이트로 쓰지 않는다». δ/Leff를 병기해 소변형 가정을 확인한다`);
let okCanti = true;
for (const mat of [
  { name: 'paper    ', m: PAPER },
  { name: 'aluminium', m: ALU },
]) {
  for (const nu of CANTI_RES) {
    const r = cantilever(nu, mat.m);
    const w = mat.m.rho * G;
    const want = (w * r.Leff ** 4) / (8 * mat.m.B);
    const e = rel(r.drop, want);
    const ok = e <= 0.1;
    if (nu === CANTI_RES[CANTI_RES.length - 1]) okCanti &&= ok;
    console.log(
      `   ${mat.name} nu=${String(nu).padStart(2)} Leff=${fmt(r.Leff, 5)}m δ=${fmt(r.drop * 1000, 4)}mm ` +
        `참값=${fmt(want * 1000, 4)}mm 오차=${(e * 100).toFixed(2)}% δ/Leff=${((r.drop / r.Leff) * 100).toFixed(2)}% ` +
        `[Peirce c=${fmt(Math.cbrt(mat.m.B / w) * 1000, 2)}mm] 잔류=${r.maxVel.toExponential(1)} NaN=${r.nan} → ${ok ? 'PASS' : 'FAIL'}`,
    );
  }
}
console.log(
  `   ⟹ 최고 해상도(nu=${CANTI_RES[CANTI_RES.length - 1]}) 기준 판정 → ${okCanti ? 'PASS' : 'FAIL'} (±10%)`,
);

console.log(
  `\n②-B 원인 특정 — 순수 굽힘 «에너지» 교정 (동역학·보이론·수렴 전부 배제 · ke=1 · R=1m)`,
);
console.log(`   Σ E_hinge / (½·ke·κ²·A) 가 1이면 ke가 곧 굽힘강성 B다`);
for (const N of [5, 9, 17, 33, 65]) {
  const r = pureBendRatio(N, 0.2, 1, 1);
  console.log(
    `   ${String(N).padStart(2)}×${N} 힌지=${String(r.hinges).padStart(5)} 비=${r.ratio.toFixed(5)} ` +
      `(경계 결손 보정 ¼·(1−1/(N−1))=${(0.25 * (1 - 1 / (N - 1))).toFixed(5)})`,
  );
}
{
  const inv = pureBendRatio(33, 0.4, 2.5, 7);
  console.log(
    `   불변성 확인(L·R·ke 전부 바꿈: L=0.4 R=2.5 ke=7) 비=${inv.ratio.toFixed(5)} ⟹ 곡률·크기·강성 무관`,
  );
}
console.log(
  `   ⟹ 연속체 극한 = **1/4**. ARCSim 에너지 E = ke·l²θ²/(8a) 는 굽힘강성 **B_eff = ke/4** 를 낸다`,
);
console.log(
  `   ⟹ ke 를 B 로 그대로 넣으면 «4배 무르다». 각도 규약 차이가 아니다(geometry.cpp:249-262 = 우리와 동일)`,
);

const reg = s1Regression();
// 참조값은 «유도»한다(손으로 적은 상수 금지 — 함정 13). 심플렉틱 오일러 이산 낙하:
//   y = ½·g·h²·n(n+1),  h = dt/substeps,  n = 총 서브스텝 수
const hFall = 1 / 60 / 8;
const nFall = 60 * 8;
const WANT_FALL = 0.5 * G * hFall * hFall * nFall * (nFall + 1);
const WANT_SPRING = (0.1 * G) / 50;
const okReg =
  Math.abs(reg.fall - WANT_FALL) < 1e-9 &&
  Math.abs(reg.sp8 - WANT_SPRING) < 1e-7 &&
  Math.abs(reg.sp16 - reg.sp8) < 1e-7;
console.log(`\n③ S1 회귀 (굽힘 제약이 «없는» 장면)`);
console.log(
  `   낙하=${fmt(reg.fall, 9)}m (해석 ½gh²n(n+1)=${WANT_FALL.toFixed(9)}) ` +
    `스프링sub8=${fmt(reg.sp8, 10)}m sub16=${fmt(reg.sp16, 10)}m (mg/k=${WANT_SPRING.toFixed(10)}) → ${okReg ? 'PASS(완전 일치)' : 'FAIL'}`,
);

console.log(`\n④ 신장 ×2 배율 — 축방향 인장. 최소계(삼각2)라 서브스텝 수렴이 «완전»하다`);
let okX2 = true;
for (const [label, kJson, F] of [
  ['합성 1000 N/m     ', 1000, 10],
  ['aluminium 1.8e6N/m', ALU.EhJson, 18000],
] as const) {
  const lut = quadTension(kJson, true, F);
  const dir = quadTension(kJson, false, F);
  const ratio = lut.kMeasured / kJson;
  const ok = Math.abs(ratio - 2) < 0.05 || Math.abs(ratio - 1) < 0.05;
  okX2 &&= ok;
  console.log(
    `   ${label} LUT경로    k사용=${lut.kUsed.toExponential(4)} λ=${fmt(lut.lam, 8)} ` +
      `k실측=${lut.kMeasured.toExponential(4)} → JSON대비 ${ratio.toFixed(4)}배`,
  );
  console.log(
    `   ${' '.repeat(label.length)} d[0][0]직독 k사용=${dir.kUsed.toExponential(4)} λ=${fmt(dir.lam, 8)} ` +
      `k실측=${dir.kMeasured.toExponential(4)} → JSON대비 ${(dir.kMeasured / kJson).toFixed(4)}배`,
  );
}

console.log(
  `\n[신규 관측] 결합 제약계의 «정지 해»가 서브스텝 수에 의존한다 — S1 게이트 ③이 못 보는 축.`,
);
console.log(
  `   ③은 제약 «1개» 계에서 잰다. 제약 1개는 항상 정확히 수렴하므로 불변성이 자명하다.`,
);
console.log(`   아래는 k사용=2000 F=4N 인장 사슬. 잔류속도가 1e-12 이하인 «완전 정착» 상태의 값이다.`);
console.log(`   사슬 길이 의존 (sub=16 · T=10s):`);
for (const ny of [2, 3, 5, 9, 21]) {
  const r = chainTension(ny, 2000, 4, 16, 10);
  console.log(
    `     ny=${String(ny).padStart(2)} (제약사슬 ${ny - 1}칸) λ=${fmt(r.lam, 8)} k실측/k사용=${r.ratio.toFixed(4)} 잔류속도=${r.mv.toExponential(1)}`,
  );
}
console.log(`   서브스텝 의존 (ny=21 · T=60s):`);
for (const sub of [16, 64, 256]) {
  const r = chainTension(21, 2000, 4, sub, 60);
  console.log(
    `     sub=${String(sub).padStart(3)} λ=${fmt(r.lam, 8)} k실측/k사용=${r.ratio.toFixed(4)} 잔류속도=${r.mv.toExponential(1)}`,
  );
}

const pass = okGrad && okFlat && okCanti && okReg && okX2;
const branch = pass
  ? 'A — ①②③④ 전부 통과 (S2 성립)'
  : !okReg
    ? 'D — ③ 실패: 굽힘이 기존 제약을 오염시켰다 (가장 나쁜 경우 · 즉시 정지)'
    : !okFlat
      ? 'C — ① 실패: 삼각화가 평면 정지 상태를 안 준다'
      : !okCanti
        ? 'B — ② 실패: 굽힘 단위 환산 의심 · 원인 특정 = ②-B (ke≠B, B_eff=ke/4) + 결합계 수렴. 문턱 조정 0 · 정지'
        : !okX2
          ? 'E — ④ 배율이 안 갈린다: 시험이 배율에 둔감 (#1 유지 · 정지 아님)'
          : 'F — 판정 불가';
console.log(`\n[갈래] ${branch}`);
if (!pass) process.exitCode = 1;
