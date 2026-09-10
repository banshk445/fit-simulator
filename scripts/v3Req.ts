/* v3-09 — #20 요구의 재확인 + (iv) 보정 가능성. 진단만 · 모델 교체 0.
 *
 * 진입: `npm run v3:req`
 *
 * §1 — S5가 «원단 순서»를 가른다면(v3-01 §4) 18% 오차가 순서를 뒤집는가.
 *      핵심: **일률 오차는 순서를 원리적으로 보존한다**(모든 원단에 같은 배율).
 *      뒤집힘은 오차의 «퍼짐»에서만 온다 ⟹ 최소 인접 간격과 퍼짐을 같은 축에 놓는다.
 * §2 — 외팔보에서 맞춘 계수가 «다른 변형 형상»에도 통하는가(형상 전이성).
 *
 * 계기 조건은 v3-07 §0-B 확인분(kMem=100 · T=3s · damp=20/s) · 경계 결손 교정 적용 ·
 * 원소 종횡비 **1 고정**(제품 메시가 앉는 대역 · v3-08 §3).
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
const DT = 1 / 60;
const KMEM = 100;
const SUB_CAP = 20000;

/** B = bending[0][0](바이어스 0° · 곡률 0) — 신장의 ⓑ 접선 1점과 같은 계열의 선택.
 * 출처: ARCSim materials/*.json [1차] */
type Mat = { name: string; rho: number; B: number };
const MATS: Mat[] = [
  { name: 'paper    ', rho: 0.1, B: 0.4e-3 },
  { name: 'aluminium', rho: 0.071, B: 96e-6 },
  { name: 'gray-int ', rho: 0.187, B: 23.191698e-6 },
];

const FABRICS: [string, number, number][] = [
  ['gray-interlock', 0.187, 23.191698e-6],
  ['tango-red-jet-set', 0.113, 14.28883e-6],
  ['camel-ponte-roma', 0.284, 36.34897e-6],
  ['ivory-rib-knit', 0.276, 46.2415e-6],
  ['11oz-black-denim', 0.324, 64.19771e-6],
  ['navy-sparkle-sweat', 0.224, 59.46661e-6],
  ['white-swim-solid', 0.204, 60.2426e-6],
  ['white-dots-on-blk', 0.128, 51.70653e-6],
  ['pink-ribbon-brown', 0.228, 117.10344e-6],
  ['royal-target', 0.22, 125.44658e-6],
];

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
  return { n, du, dv, uv, tris, asp: dv / du };
}

/** 경계 결손비 — 해석 «외팔보» 형상에서(v3-06 §1). 세 형상에 «같은» 교정을 쓴다:
 * 형상마다 다른 교정을 쓰면 전이성을 묻는 시험이 순환이 된다. */
function deficit(nu: number, nv: number, L: number, W: number, m: Mat) {
  const { n, du, uv, tris } = mesh(nu, nv, L, W);
  const Leff = L - du;
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
  let Ed = 0;
  for (const b of makeBend(tris, uv, m.B)) {
    const th = dihedral(s, b);
    Ed += (m.B * th * th) / (2 * b.shape);
  }
  let Ec = 0;
  const M = 100000;
  for (let i = 0; i < M; i++) Ec += 0.5 * m.B * W * kap(((i + 0.5) * L) / M) ** 2 * (L / M);
  return Ed / Ec;
}

type Shape = 'canti' | 'fixfix' | 'tip';

function build(nu: number, nv: number, L: number, W: number, m: Mat, shape: Shape) {
  const g = mesh(nu, nv, L, W);
  const ke = m.B / deficit(nu, nv, L, W, m);
  const s = makeSolver(g.n);
  for (let v = 0; v < g.n; v++) {
    s.pos[v * 3] = g.uv[v * 2];
    s.pos[v * 3 + 2] = g.uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) {
    for (const i of [0, 1]) pin.add(j * nu + i);
    if (shape === 'fixfix') for (const i of [nu - 2, nu - 1]) pin.add(j * nu + i);
  }
  assignMassFromMesh(s, g.tris, g.uv, m.rho, pin);
  const bends: BendConstraint[] = makeBend(g.tris, g.uv, ke);
  return { g, s, bends, ke };
}

function run(
  nu: number,
  nv: number,
  L: number,
  W: number,
  m: Mat,
  shape: Shape,
  sub: number,
  F = 0,
) {
  const { g, s, bends } = build(nu, nv, L, W, m, shape);
  const cs: Constraint[] = [...makeInplane(g.tris, g.uv, KMEM, KMEM, KMEM), ...bends];
  let ext: Float64Array | undefined;
  if (shape === 'tip') {
    ext = new Float64Array(g.n * 3);
    for (let j = 0; j < nv; j++) ext[(j * nu + nu - 1) * 3 + 1] = -F / nv;
  }
  const p: SolverParams = {
    dt: DT,
    substeps: sub,
    gravity: shape === 'tip' ? 0 : G,
    damping: 20,
    extForce: ext,
  };
  for (let f = 0; f < Math.round(3 / DT); f++) step(s, cs, p);
  const mid = Math.floor(nv / 2);
  const idx = shape === 'fixfix' ? mid * nu + Math.floor(nu / 2) : mid * nu + nu - 1;
  return -s.pos[idx * 3 + 1];
}

function sized(nu: number, nv: number, L: number, W: number, m: Mat, shape: Shape) {
  const { s, bends } = build(nu, nv, L, W, m, shape);
  return Math.max(2048, substepsForBending(DT, s, bends, 0.95));
}

const P = (x: number, w = 8, d = 3) => x.toFixed(d).padStart(w);

console.log(`[v3-09] 진단 판 · 모델 교체 0 · 보정 계수 «적용» 0. 종횡비 1 고정(제품 대역)`);
console.log(`\n§1 #20 — S5는 «원단 순서»를 가른다(v3-01 §4: 참값 표 미확보 ⟹ 상대 순서로 판정)`);
console.log(`   굽힘 길이 ℓ = (B/ρg)^(1/3) — 주름 파장을 정하는 양. B = bending[0][0]`);
const L3 = FABRICS.map(([n, rho, B]) => ({ n, rho, B, l: (B / (rho * G)) ** (1 / 3) })).sort(
  (a, b) => a.l - b.l,
);
console.log(
  `   ${'원단'.padStart(20)}${'ρ'.padStart(8)}${'B[N·m]'.padStart(12)}${'ℓ[mm]'.padStart(10)}${'앞과의 간격'.padStart(13)}`,
);
let minGap = Infinity;
for (let i = 0; i < L3.length; i++) {
  const gap = i === 0 ? NaN : (L3[i].l / L3[i - 1].l - 1) * 100;
  if (i > 0) minGap = Math.min(minGap, gap);
  console.log(
    `   ${L3[i].n.padStart(20)}${P(L3[i].rho, 8)}${L3[i].B.toExponential(3).padStart(12)}${P(L3[i].l * 1000, 10)}` +
      `${(i === 0 ? '—' : `${gap.toFixed(2)}%`).padStart(13)}`,
  );
}
console.log(`   최소 인접 간격 = **${minGap.toFixed(2)}%**`);
console.log(
  `   일률 −18% ⟹ ℓ 배율 ${(0.82 ** (1 / 3)).toFixed(4)} — **모든 원단에 같은 배율이라 순서가 원리적으로 보존된다**`,
);
console.log(
  `   ⟹ 뒤집힘은 오차의 «크기»가 아니라 «퍼짐»에서만 온다. 퍼짐이 ${minGap.toFixed(2)}%를 넘으면 뒤집힌다.`,
);

console.log(`\n§2 (iv) 형상 전이성 (종횡비 1 · 21×9 · 경계 결손 교정은 «외팔보 형상»으로 통일)`);
console.log(`   장면 정의(전부 δ/Leff ≈ 5%가 되도록 L을 물성마다 «해석식»으로 정한다):`);
console.log(`     ① 외팔보 자중         뿌리 2열 고정 · δ_tip = w·Leff⁴/(8B)      L = (0.4·B/w)^(1/3)`);
console.log(`     ② 양단 고정 자중       양끝 2열씩 고정 · δ_mid = w·Leff⁴/(384B)  L = (19.2·B/w)^(1/3)`);
console.log(`     ③ 외팔보 끝단 집중하중  중력 0 · δ_tip = F·Leff³/(3·B·W)`);
console.log(`   ※ 프롬프트의 「정사각 시트」는 **해석 참값이 없어** 대체했다(갈래 E 부분 · 노트에 적는다).`);
console.log(
  `\n   ${'물성'.padStart(10)}${'형상'.padStart(10)}${'L[mm]'.padStart(9)}${'sub'.padStart(7)}${'δ[mm]'.padStart(11)}${'참값[mm]'.padStart(11)}${'δ/Leff'.padStart(8)}${'오차'.padStart(9)}${'B_eff/B'.padStart(10)}`,
);
const NU = 21;
const NV = 9;
const rows: { mat: string; shape: string; beff: number }[] = [];
for (const m of MATS) {
  const w = m.rho * G;
  for (const shape of ['canti', 'fixfix', 'tip'] as const) {
    const L = shape === 'fixfix' ? ((19.2 * m.B) / w) ** (1 / 3) : ((0.4 * m.B) / w) ** (1 / 3);
    const W = 0.4 * L;
    const { du } = mesh(NU, NV, L, W);
    const Leff = shape === 'fixfix' ? L - 2 * du : L - du;
    const F = shape === 'tip' ? (0.05 * 3 * m.B * W) / Leff ** 2 : 0;
    const want =
      shape === 'canti'
        ? (w * Leff ** 4) / (8 * m.B)
        : shape === 'fixfix'
          ? (w * Leff ** 4) / (384 * m.B)
          : (F * Leff ** 3) / (3 * m.B * W);
    const label = shape === 'canti' ? '외팔보' : shape === 'fixfix' ? '양단고정' : '집중하중';
    const sub = sized(NU, NV, L, W, m, shape);
    if (sub > SUB_CAP) {
      console.log(
        `   ${m.name.padStart(10)}${label.padStart(10)}  산정 sub=${sub} > 상한 ${SUB_CAP} ⟹ **무효**`,
      );
      continue;
    }
    const d = run(NU, NV, L, W, m, shape, sub, F);
    const err = (d / want - 1) * 100;
    rows.push({ mat: m.name.trim(), shape: label, beff: 1 / (1 + err / 100) });
    console.log(
      `   ${m.name.padStart(10)}${label.padStart(10)}${P(L * 1000, 9, 2)}${String(sub).padStart(7)}` +
        `${P(d * 1000, 11, 4)}${P(want * 1000, 11, 4)}${P((d / Leff) * 100, 7, 2)}%${P(err, 8, 2)}%${P(1 / (1 + err / 100), 10, 4)}`,
    );
  }
}

if (rows.length > 1) {
  const bs = rows.map((r) => r.beff);
  console.log(
    `\n   B_eff/B — 최소 ${Math.min(...bs).toFixed(4)} · 최대 ${Math.max(...bs).toFixed(4)} · 전체 폭 **${((Math.max(...bs) - Math.min(...bs)) * 100).toFixed(2)}pp**`,
  );
  for (const shape of ['외팔보', '양단고정', '집중하중']) {
    const g2 = rows.filter((r) => r.shape === shape).map((r) => r.beff);
    if (g2.length > 1)
      console.log(
        `     ${shape.padStart(8)} — «물성 간» 폭 **${((Math.max(...g2) - Math.min(...g2)) * 100).toFixed(2)}pp**  (${g2.map((x) => x.toFixed(4)).join(' / ')})`,
      );
  }
  for (const mat of MATS.map((m) => m.name.trim())) {
    const g2 = rows.filter((r) => r.mat === mat).map((r) => r.beff);
    if (g2.length > 1)
      console.log(
        `     ${mat.padStart(10)} — «형상 간» 폭 **${((Math.max(...g2) - Math.min(...g2)) * 100).toFixed(2)}pp**  (${g2.map((x) => x.toFixed(4)).join(' / ')})`,
      );
  }
  const matSpread = Math.max(
    ...['외팔보', '양단고정', '집중하중'].map((sh) => {
      const g2 = rows.filter((r) => r.shape === sh).map((r) => r.beff);
      return g2.length > 1 ? Math.max(...g2) - Math.min(...g2) : 0;
    }),
  );
  console.log(
    `\n   [§1 연결] «물성 간» 최대 폭 ${(matSpread * 100).toFixed(2)}pp ⟹ ℓ 퍼짐 = (1+폭)^(1/3)−1 = **${(((1 + matSpread) ** (1 / 3) - 1) * 100).toFixed(3)}%**`,
  );
  console.log(
    `   최소 인접 간격 ${minGap.toFixed(2)}% 와 비교: ${((1 + matSpread) ** (1 / 3) - 1) * 100 < minGap ? '**작다 ⟹ 순서 뒤집힘 0**' : '**크다 ⟹ 뒤집힘 가능**'}`,
  );
}
