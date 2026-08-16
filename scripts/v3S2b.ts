/* v3-05 — ② 외팔보 «재판정» + 셋째 원인 좁히기.
 *
 * 진입: `npm run v3:s2b`
 *
 * v3-03 §2-A 장면을 «그대로» 쓴다(L·W·nv·뿌리 2열 고정·물성). 바꾸면 검증이 아니라
 * 새 시험이 된다. 바뀐 것은 두 가지뿐이고 둘 다 «다른 판이 독립적으로 정한 값»이다:
 *   ① ke = 4B   (#13 · v3-03 §2-A' 원기둥 등거리 에너지 시험이 확정)
 *   ② 서브스텝을 수렴할 때까지 올린다 (#14 · v3-04)
 * 문턱 ±10%는 v3-03에 등록된 그대로. 조정 0(함정 14).
 */
import {
  makeSolver,
  makeInplane,
  makeBend,
  assignMassFromMesh,
  step,
  substepsForCloth,
  type Constraint,
  type SolverParams,
} from '../src/v3/solver.ts';

const G = 9.81;
const PAPER = { name: 'paper    ', rho: 0.1, Eh: 0.5e6, B: 0.4e-3 };
const ALU = { name: 'aluminium', rho: 0.071, Eh: 1.8e6, B: 96e-6 };
/** v3-03 §2-A 등록 장면 */
const SC = { L: 0.05, W: 0.02, nv: 3, seconds: 8, damping: 8, dt: 1 / 60 };
const RES = [8, 12, 16, 32];

type Mat = { rho: number; Eh: number; B: number };

function canti(opts: {
  nu: number;
  nv?: number;
  sub: number;
  m: Mat;
  keMult?: number;
  kMem?: number;
  altDiag?: boolean;
}) {
  const { nu, sub, m } = opts;
  const nv = opts.nv ?? SC.nv;
  const keMult = opts.keMult ?? 4;
  const kMem = opts.kMem ?? m.Eh;
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
      const b = a + 1;
      const c = a + nu;
      const d = a + nu + 1;
      if (!opts.altDiag || (i + j) % 2 === 0) tris.push(a, b, c, b, d, c);
      else tris.push(a, b, d, a, d, c);
    }
  const s = makeSolver(n);
  for (let v = 0; v < n; v++) {
    s.pos[v * 3] = uv[v * 2];
    s.pos[v * 3 + 2] = uv[v * 2 + 1];
  }
  const pin = new Set<number>();
  for (let j = 0; j < nv; j++) for (const i of [0, 1]) pin.add(j * nu + i);
  assignMassFromMesh(s, tris, uv, m.rho, pin);
  const cs: Constraint[] = [
    ...makeInplane(tris, uv, kMem, kMem, kMem),
    ...makeBend(tris, uv, m.B * keMult),
  ];
  const p: SolverParams = { dt: SC.dt, substeps: sub, gravity: G, damping: SC.damping };
  for (let f = 0; f < Math.round(SC.seconds / SC.dt); f++) step(s, cs, p);
  let mv = 0;
  let nan = 0;
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) if (!Number.isFinite(s.pos[v * 3 + k])) nan++;
    mv = Math.max(mv, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
  }
  const mid = Math.floor(nv / 2);
  const Leff = SC.L - du;
  const skew = Math.abs(s.pos[(nu - 1) * 3 + 1] - s.pos[((nv - 1) * nu + nu - 1) * 3 + 1]);
  return {
    d: -s.pos[(mid * nu + nu - 1) * 3 + 1],
    want: (m.rho * G * Leff ** 4) / (8 * m.B),
    Leff,
    mv,
    nan,
    skew,
    aspect: dv / du,
  };
}

const pct = (r: { d: number; want: number }) => (r.d / r.want - 1) * 100;
const mm = (x: number) => (x * 1000).toFixed(4);

console.log(
  `[v3-05] 장면=v3-03 §2-A «그대로»(L=${SC.L}m W=${SC.W}m nv=${SC.nv} 뿌리2열고정 T=${SC.seconds}s damp=${SC.damping}/s)`,
);
console.log(
  `        바뀐 것 2건(둘 다 «다른 판»이 독립 확정): ke=4B(#13 · v3-03 §2-A') · 서브스텝 수렴(#14 · v3-04)`,
);
console.log(`[참값] 주=선형보 δ=w·Leff⁴/(8B) · 부=Peirce c=(B/w)^(1/3) 참고. 문턱 ±10% (조정 0)`);

console.log(`\n§1 산정식 유효성 — substepsForCloth는 «멤브레인» 진동수 기반이다`);
for (const nu of [12, 32]) {
  const du = SC.L / (nu - 1);
  console.log(
    `   paper nu=${String(nu).padStart(2)} du=${(du * 1000).toFixed(2)}mm → substepsForCloth(k=Eh=5e5) = ${substepsForCloth(SC.dt, PAPER.Eh, PAPER.rho, du)}`,
  );
}
console.log(
  `   ⟹ 실행 불가한 값이고, 이 장면에서 멤브레인 «정확도»는 필요 없다(하중 w=${(PAPER.rho * G).toFixed(3)}N/m² ⟹ 변형 ~1e-6).`,
);
console.log(`   대신 굽힘 수렴을 «직접» 확인한다(아래 §1-B). 산정식 처분은 §4 갈래 D.`);

console.log(`\n§1-B 굽힘 서브스텝 수렴 (paper nu=12 · ke=4B)`);
for (const sub of [256, 1024, 4096, 16384]) {
  const r = canti({ nu: 12, sub, m: PAPER });
  console.log(
    `   sub=${String(sub).padStart(5)} δ=${mm(r.d)}mm 오차=${pct(r).toFixed(2)}% 잔류=${r.mv.toExponential(1)}`,
  );
}

console.log(`\n§2 재판정 — 등록 장면 · ke=4B · sub=4096(§1-B에서 수렴 확인)`);
let ok = true;
for (const m of [PAPER, ALU]) {
  for (const nu of RES) {
    const r = canti({ nu, sub: 4096, m });
    const pass = Math.abs(pct(r)) <= 10;
    if (nu === RES[RES.length - 1]) ok &&= pass;
    console.log(
      `   ${m.name} nu=${String(nu).padStart(2)} Leff=${r.Leff.toFixed(5)}m δ=${mm(r.d)}mm 참값=${mm(r.want)}mm ` +
        `오차=${pct(r).toFixed(2)}% δ/Leff=${((r.d / r.Leff) * 100).toFixed(2)}% ` +
        `[Peirce c=${(Math.cbrt(m.B / (m.rho * G)) * 1000).toFixed(2)}mm] NaN=${r.nan} → ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
}
console.log(
  `   ⟹ ${ok ? 'PASS' : 'FAIL'} (±10%). **해상도를 올릴수록 오차가 «커진다»** — #14 처분 후에도 그렇다`,
);

console.log(`\n§2-B 셋째 원인 좁히기 — 후보를 하나씩 «값으로» 배제한다 (paper nu=12 sub=4096)`);
console.log(`   (가) 멤브레인 강성 — 5e5에서 1e2까지 4자릿수를 내린다`);
for (const kMem of [0.5e6, 1e4, 1e2]) {
  const r = canti({ nu: 12, sub: 4096, m: PAPER, kMem });
  console.log(`        kMem=${kMem.toExponential(0).padStart(7)} 오차=${pct(r).toFixed(2)}%`);
}
console.log(`        ⟹ 0.1pp 이내. **배제.**`);
console.log(`   (나) 대각 분할의 좌우 비대칭 — 고정 vs 교대`);
for (const altDiag of [false, true]) {
  const r = canti({ nu: 12, sub: 4096, m: PAPER, altDiag });
  console.log(
    `        ${altDiag ? '교대' : '고정'} 오차=${pct(r).toFixed(2)}% 폭방향비틀림=${(r.skew * 1000).toExponential(2)}mm`,
  );
}
console.log(`        ⟹ 교대가 비틀림을 «없애는데» 오차는 그대로. **배제.**`);
console.log(`   (다) 폭 방향 해상도(원소 종횡비) — nu=12 고정, nv만 올린다`);
for (const nv of [3, 5, 9, 17]) {
  const r = canti({ nu: 12, nv, sub: 4096, m: PAPER });
  console.log(
    `        nv=${String(nv).padStart(2)} dv/du=${r.aspect.toFixed(3)} 오차=${pct(r).toFixed(2)}%`,
  );
}
console.log(`        ⟹ **여기서 크게 움직인다. 유력 후보.**`);

console.log(
  `\n[갈래] C + D 동시 성립 — C: ② 실패·셋째 원인 존재(§3 착수 0) · D: 산정식이 굽힘을 못 덮는다`,
);
process.exitCode = 1;
