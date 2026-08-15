/* v3 S1 — 갈래 ⓐ(서브스텝마다 α 재평가) vs ⓑ(선형 접선 상수) 비교.
 *
 * 진입: `npm run v3:s1ab`.  게이트 ③ 통과 «후»에만 의미가 있다(회차 프롬프트 §3).
 *
 * ① 자유낙하는 제약 0이므로 ⓐ/ⓑ가 «구조적으로» 동일하고, ② 단일 스프링은
 * 거리 제약이라 면내 룩업이 관여하지 않는다 — 둘 다 v3S1.ts에서 이미 통과했다.
 * 실질 비교는 ③(서브스텝 2배)과 시트 형상·비용이다.
 *
 * ⚠ 물성 «투입»이 아니다. gray-interlock 값은 ⓐ 기계를 돌리기 위한 표본이고
 *   단위 배율(×2 규약)은 미확정이다 — S2 외팔보 역검증에서 닫는다.
 */
import {
  makeSolver,
  makeInplane,
  assignMassFromMesh,
  step,
  type Constraint,
  type SolverParams,
} from '../src/v3/solver.ts';
import {
  buildSamples,
  stiffnessAt,
  GRAY_INTERLOCK_STRETCHING as ROWS,
} from '../src/v3/wangStretch.ts';

const G = 9.81;

/** LUT 포팅 자기검사 — 격자점 (7,7,0)은 G00=G11=-0.25+7/30, G01=0 이고
 * 그 지점의 표본은 «변형 0»이 아니지만, 격자점을 정확히 질의하면 삼선형
 * 보간이 표본값을 그대로 돌려줘야 한다. 동시에 표본 (7,7,0)의 값은
 * row0×2(음수 클램프)와 일치해야 한다 — dde.cpp 76-83의 클램프·×2 규약. */
function selfCheck(s: Float64Array): string {
  const o = new Float64Array(4);
  stiffnessAt(s, -0.25 + 7 / 30, -0.25 + 7 / 30, 0, o);
  const want = ROWS[0].map((x) => Math.max(x, 0) * 2);
  const err = Math.max(...want.map((w, c) => Math.abs(w - o[c])));
  if (err > 1e-9) throw new Error(`LUT 포팅 자기검사 실패: 최대차 ${err}`);
  return `격자(7,7,0)=row0×2(음수클램프) 일치 최대차=${err.toExponential(1)}`;
}
const SHEET = { nx: 21, ny: 21, size: 1.0, dt: 1 / 60, seconds: 20.0, damping: 2 };
/** gray-interlock 면밀도 [kg/m²] (materials/gray-interlock.json) */
const RHO = 0.187;

const samples = buildSamples();
const k0 = new Float64Array(4);
stiffnessAt(samples, 0, 0, 0, k0); // ⓑ = 무변형 접선 1점 (v3-01 §1-3 ⓑ 정의)

function sheet(sub: number, mode: 'a' | 'b', loadMult = 1) {
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
      s.pos[v * 3 + 2] = j * dx;
    }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      tris.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
    }
  assignMassFromMesh(s, tris, uv, RHO, new Set(Array.from({ length: nx }, (_, i) => i)));
  const cs: Constraint[] = makeInplane(tris, uv, k0[0], k0[2], k0[3]);
  if (mode === 'a') for (const c of cs) if (c.kind === 'inplane') c.samples = samples;
  // loadMult: 하중 배율. ⓐ/ⓑ가 갈라지는 변형 대역을 찾기 위한 손잡이이며
  // «중력의 정정이 아니다» — 게이트 ①②③은 loadMult=1에서만 판정한다.
  const p: SolverParams = {
    dt: SHEET.dt,
    substeps: sub,
    gravity: G * loadMult,
    damping: SHEET.damping,
  };
  const t0 = performance.now();
  for (let f = 0; f < Math.round(SHEET.seconds / SHEET.dt); f++) step(s, cs, p);
  const ms = performance.now() - t0;
  let maxVel = 0;
  let nan = 0;
  let minY = 0;
  let maxStrain = 0;
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < 3; c++) if (!Number.isFinite(s.pos[v * 3 + c])) nan++;
    maxVel = Math.max(maxVel, Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]));
    minY = Math.min(minY, s.pos[v * 3 + 1]);
  }
  for (const c of cs) {
    if (c.kind !== 'inplane') continue;
    const o0 = c.i0 * 3;
    const o1 = c.i1 * 3;
    const o2 = c.i2 * 3;
    const e1 = [s.pos[o1] - s.pos[o0], s.pos[o1 + 1] - s.pos[o0 + 1], s.pos[o1 + 2] - s.pos[o0 + 2]];
    const e2 = [s.pos[o2] - s.pos[o0], s.pos[o2 + 1] - s.pos[o0 + 1], s.pos[o2 + 2] - s.pos[o0 + 2]];
    const xu = e1.map((x, i) => c.a * x + c.b * e2[i]);
    const xv = e1.map((x, i) => c.c * x + c.d * e2[i]);
    const g00 = (xu[0] ** 2 + xu[1] ** 2 + xu[2] ** 2 - 1) / 2;
    const g11 = (xv[0] ** 2 + xv[1] ** 2 + xv[2] ** 2 - 1) / 2;
    maxStrain = Math.max(maxStrain, Math.abs(g00), Math.abs(g11));
  }
  return { pos: s.pos, ms, maxVel, nan, drop: -minY, maxStrain };
}

function diffStat(a: Float64Array, b: Float64Array) {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / (a.length / 3) };
}

const diag = Math.hypot(SHEET.size, SHEET.size);
console.log(
  `[v3-S1 ⓐ/ⓑ] LUT=30³(dde.cpp nsamples=30) 원단=gray-interlock ρ=${RHO}kg/m² ` +
    `시트 ${SHEET.nx}x${SHEET.ny} ${SHEET.size}m 윗변전체고정 damp=${SHEET.damping}/s T=${SHEET.seconds}s g=${G}`,
);
console.log(`[자기검사] ${selfCheck(samples)}`);
console.log(
  `[ⓑ 접선 1점] G=0에서 k0/k1/k2/k3 = ${[...k0].map((x) => x.toFixed(3)).join(' / ')} N/m ` +
    `→ kU=${k0[0].toFixed(3)} kV=${k0[2].toFixed(3)} kS=${k0[3].toFixed(3)} (k1은 스칼라 제약 미사상 · ⓐⓑ 공통 누락)`,
);
console.log(
  `[LUT 해상도] G=0 질의는 row0×2=[${ROWS[0].map((x) => (Math.max(x, 0) * 2).toFixed(2)).join(',')}]와 «다르다» — ` +
    `30³ 격자의 최근접 표본이 ±1.67% 변형에 있어 16.7% 변형 행이 약 10% 섞인다. LUT 해상도의 고유 편향`,
);
console.log(`[구조] ① 제약 0 → ⓐ/ⓑ 동일 · ② 거리 제약 → 면내 룩업 미관여. 실질 비교는 ③·형상·비용`);

const rows: { mode: 'a' | 'b'; sub: number; r: ReturnType<typeof sheet> }[] = [];
for (const mode of ['b', 'a'] as const)
  for (const sub of [8, 16, 32]) rows.push({ mode, sub, r: sheet(sub, mode) });

console.log('');
for (const { mode, sub, r } of rows)
  console.log(
    `  ${mode === 'a' ? 'ⓐ' : 'ⓑ'} sub=${String(sub).padStart(2)} 최저점=${r.drop.toFixed(6)}m ` +
      `최대|G|=${r.maxStrain.toFixed(5)} 잔류속도=${r.maxVel.toExponential(2)} NaN=${r.nan} ` +
      `${r.ms.toFixed(0)}ms`,
  );

console.log('');
for (const mode of ['b', 'a'] as const) {
  const get = (sub: number) => rows.find((x) => x.mode === mode && x.sub === sub)!.r;
  const d1 = diffStat(get(8).pos, get(16).pos);
  const d2 = diffStat(get(16).pos, get(32).pos);
  const tag = mode === 'a' ? 'ⓐ' : 'ⓑ';
  const ok = d1.max / diag <= 0.01;
  console.log(
    `③ ${tag} 서브스텝2배 8vs16 최대=${((d1.max / diag) * 100).toFixed(3)}%·평균=${((d1.mean / diag) * 100).toFixed(3)}% ` +
      `| 16vs32 최대=${((d2.max / diag) * 100).toFixed(3)}%·평균=${((d2.mean / diag) * 100).toFixed(3)}% → ${ok ? 'PASS' : 'FAIL'}(±1%)`,
  );
}

const pick = (mode: 'a' | 'b', sub: number) => rows.find((x) => x.mode === mode && x.sub === sub)!.r;
const ab = diffStat(pick('b', 32).pos, pick('a', 32).pos);
console.log(
  `\n[정확도] ⓐ vs ⓑ 형상차(sub=32) 최대=${ab.max.toFixed(6)}m(${((ab.max / diag) * 100).toFixed(3)}%) ` +
    `평균=${ab.mean.toFixed(6)}m(${((ab.mean / diag) * 100).toFixed(3)}%)`,
);
console.log(
  `[비용] sub=32 ⓑ=${pick('b', 32).ms.toFixed(0)}ms ⓐ=${pick('a', 32).ms.toFixed(0)}ms ` +
    `→ ⓐ/ⓑ=${(pick('a', 32).ms / pick('b', 32).ms).toFixed(2)}배`,
);

// ⓑ의 대가는 «큰 변형에서 커진다»(v3-01 §1-3 — 오차 크기 미측정). 그 크기를 잰다.
// LUT의 비선형 구간은 주신장 0~16.7%(strain_weight=(w0-1)*6이 1에서 포화)다.
console.log(`\n[변형 대역 스윕] sub=32 · 하중 배율로 |G|를 올려 ⓐ/ⓑ 이탈을 잰다`);
for (const mult of [1, 5, 20, 50, 100]) {
  const b = sheet(32, 'b', mult);
  const a = sheet(32, 'a', mult);
  const d = diffStat(b.pos, a.pos);
  const strain = Math.sqrt(1 + 2 * a.maxStrain) - 1; // |G|max → 주신장 근사
  console.log(
    `  하중×${String(mult).padStart(3)} 최대|G|=${a.maxStrain.toFixed(5)}(주신장≈${(strain * 100).toFixed(2)}%) ` +
      `ⓑ최저점=${b.drop.toFixed(4)}m ⓐ최저점=${a.drop.toFixed(4)}m ` +
      `ⓐ-ⓑ 최대=${((d.max / diag) * 100).toFixed(3)}%·평균=${((d.mean / diag) * 100).toFixed(3)}% ` +
      `NaN=${a.nan + b.nan}`,
  );
}
