/* v3 S1 — XPBD 솔버 뼈대 + 중력 + 신장(선형 이방 · 갈래 ⓑ).
 *
 * v2 코드를 임포트하지 않는다(설계 R4-3 — 제품 기본 경로는 v2). 이 파일을
 * 임포트하는 제품 코드도 없다.
 *
 * 참고: Macklin et al., "XPBD" (2016) · "Small Steps in Physics Simulation" (2019).
 * 서브스텝당 반복 1회, λ는 서브스텝마다 0으로 초기화한다.
 */
import { stiffnessAt } from './wangStretch.ts';

export type Solver = {
  /** 정점 위치 (3n) */
  pos: Float64Array;
  /** 서브스텝 시작 위치 (3n) — 속도 갱신용 */
  prev: Float64Array;
  vel: Float64Array;
  /** 1/m. 0이면 고정 정점 */
  invMass: Float64Array;
  n: number;
};

/** 거리 제약: C = |xj - xi| - rest, 컴플라이언스 α = 1/k [k: N/m] */
export type DistanceConstraint = {
  kind: 'dist';
  i: number;
  j: number;
  rest: number;
  /** N/m */
  k: number;
  lambda: number;
};

/** 삼각형 면내 제약 3종 — 그린 변형 G의 성분을 그대로 C로 쓴다.
 *
 * ARCSim(physics.cpp stretching_energy)의 에너지:
 *   E = A/2 * (k0*G00^2 + k2*G11^2 + 2*k1*G00*G11 + k3*G01^2)
 * XPBD 제약 하나의 에너지는 C^2/(2α)이므로 C = G00 에 α = 1/(A*k0)를 주면
 * 두 식이 정확히 일치한다. k1(교차항)은 스칼라 제약 하나로 안 떨어지므로
 * 이 판(ⓑ)에서는 버린다 — 아래 ponytail 주석 참고.
 *
 * du/dv 역행렬 D = [[a, c], [b, d]] 를 미리 접어 둔다:
 *   xu = a*e1 + b*e2,  xv = c*e1 + d*e2   (e1 = x1-x0, e2 = x2-x0)
 */
export type InplaneConstraint = {
  kind: 'inplane';
  i0: number;
  i1: number;
  i2: number;
  a: number;
  b: number;
  c: number;
  d: number;
  /** 정지 상태 면적 [m^2] */
  area: number;
  /** warp/weft/전단 강성 [N/m] */
  kU: number;
  kV: number;
  kS: number;
  /** 갈래 ⓐ: 있으면 «서브스텝마다» 현재 G에서 강성을 룩업해 kU/kV/kS를 덮어쓴다
   * (조각선형 XPBD — α 상수 가정의 근사). 없으면 ⓑ(선형 이방 상수). */
  samples?: Float64Array;
  lambda: [number, number, number];
};

export type Constraint = DistanceConstraint | InplaneConstraint;

export type SolverParams = {
  /** 프레임 시간간격 [s] */
  dt: number;
  /** 프레임당 서브스텝 수 */
  substeps: number;
  /** 중력 [m/s^2], y축 아래로 */
  gravity: number;
  /** 속도 감쇠 [1/s]. 서브스텝 수와 무관하게 만들기 위해 exp(-damping*h)로 쓴다 */
  damping: number;
};

export function makeSolver(n: number): Solver {
  return {
    pos: new Float64Array(n * 3),
    prev: new Float64Array(n * 3),
    vel: new Float64Array(n * 3),
    invMass: new Float64Array(n),
    n,
  };
}

/** 삼각 메시에서 정점 질량 = (인접 삼각형 면적 합 / 3) × 면밀도 [kg/m^2].
 * 고정 질량을 쓰지 않는 이유: 해상도가 바뀌면 물리가 바뀐다(설계 §4 S1). */
export function assignMassFromMesh(
  s: Solver,
  tris: ArrayLike<number>,
  restUV: ArrayLike<number>,
  areaDensity: number,
  pinned: ReadonlySet<number> = new Set(),
): { totalMass: number; totalArea: number } {
  const m = new Float64Array(s.n);
  let totalArea = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const p = tris[t];
    const q = tris[t + 1];
    const r = tris[t + 2];
    const area = triArea(restUV, p, q, r);
    totalArea += area;
    const share = (area * areaDensity) / 3;
    m[p] += share;
    m[q] += share;
    m[r] += share;
  }
  let totalMass = 0;
  for (let v = 0; v < s.n; v++) {
    totalMass += m[v];
    s.invMass[v] = pinned.has(v) || m[v] <= 0 ? 0 : 1 / m[v];
  }
  return { totalMass, totalArea };
}

function triArea(uv: ArrayLike<number>, p: number, q: number, r: number): number {
  const e1x = uv[q * 2] - uv[p * 2];
  const e1y = uv[q * 2 + 1] - uv[p * 2 + 1];
  const e2x = uv[r * 2] - uv[p * 2];
  const e2y = uv[r * 2 + 1] - uv[p * 2 + 1];
  return Math.abs(e1x * e2y - e1y * e2x) / 2;
}

/** 정지 2D 좌표(restUV)에서 면내 제약을 만든다. */
export function makeInplane(
  tris: ArrayLike<number>,
  restUV: ArrayLike<number>,
  kU: number,
  kV: number,
  kS: number,
): InplaneConstraint[] {
  const out: InplaneConstraint[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t];
    const i1 = tris[t + 1];
    const i2 = tris[t + 2];
    // Du = [u1-u0, u2-u0] (2x2), D = Du^-1
    const m00 = restUV[i1 * 2] - restUV[i0 * 2];
    const m10 = restUV[i1 * 2 + 1] - restUV[i0 * 2 + 1];
    const m01 = restUV[i2 * 2] - restUV[i0 * 2];
    const m11 = restUV[i2 * 2 + 1] - restUV[i0 * 2 + 1];
    const det = m00 * m11 - m01 * m10;
    if (Math.abs(det) < 1e-14) throw new Error(`degenerate rest triangle at ${t / 3}`);
    // D = Du^-1;  a=D00 b=D10 c=D01 d=D11
    out.push({
      kind: 'inplane',
      i0,
      i1,
      i2,
      a: m11 / det,
      b: -m10 / det,
      c: -m01 / det,
      d: m00 / det,
      area: Math.abs(det) / 2,
      kU,
      kV,
      kS,
      lambda: [0, 0, 0],
    });
  }
  return out;
}

/** 한 프레임 = substeps개 서브스텝. 서브스텝당 제약 투영 1회. */
export function step(s: Solver, cs: Constraint[], p: SolverParams): void {
  const h = p.dt / p.substeps;
  const h2 = h * h;
  const decay = Math.exp(-p.damping * h);
  for (let sub = 0; sub < p.substeps; sub++) {
    // 예측
    for (let v = 0; v < s.n; v++) {
      const o = v * 3;
      s.prev[o] = s.pos[o];
      s.prev[o + 1] = s.pos[o + 1];
      s.prev[o + 2] = s.pos[o + 2];
      if (s.invMass[v] === 0) continue;
      s.vel[o + 1] -= p.gravity * h;
      s.pos[o] += s.vel[o] * h;
      s.pos[o + 1] += s.vel[o + 1] * h;
      s.pos[o + 2] += s.vel[o + 2] * h;
    }
    // 제약 투영 (서브스텝마다 λ 초기화)
    for (const c of cs) {
      if (c.kind === 'dist') {
        c.lambda = 0;
        projectDistance(s, c, h2);
      } else {
        c.lambda[0] = 0;
        c.lambda[1] = 0;
        c.lambda[2] = 0;
        projectInplane(s, c, h2);
      }
    }
    // 속도 갱신
    for (let v = 0; v < s.n; v++) {
      if (s.invMass[v] === 0) continue;
      const o = v * 3;
      s.vel[o] = ((s.pos[o] - s.prev[o]) / h) * decay;
      s.vel[o + 1] = ((s.pos[o + 1] - s.prev[o + 1]) / h) * decay;
      s.vel[o + 2] = ((s.pos[o + 2] - s.prev[o + 2]) / h) * decay;
    }
  }
}

function projectDistance(s: Solver, c: DistanceConstraint, h2: number): void {
  const oi = c.i * 3;
  const oj = c.j * 3;
  let dx = s.pos[oj] - s.pos[oi];
  let dy = s.pos[oj + 1] - s.pos[oi + 1];
  let dz = s.pos[oj + 2] - s.pos[oi + 2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return;
  dx /= len;
  dy /= len;
  dz /= len;
  const wi = s.invMass[c.i];
  const wj = s.invMass[c.j];
  const wsum = wi + wj;
  if (wsum === 0) return;
  const C = len - c.rest;
  const at = 1 / c.k / h2; // α~ = α/h^2
  const dl = (-C - at * c.lambda) / (wsum + at);
  c.lambda += dl;
  s.pos[oi] -= wi * dl * dx;
  s.pos[oi + 1] -= wi * dl * dy;
  s.pos[oi + 2] -= wi * dl * dz;
  s.pos[oj] += wj * dl * dx;
  s.pos[oj + 1] += wj * dl * dy;
  s.pos[oj + 2] += wj * dl * dz;
}

const g0 = new Float64Array(3);
const g1 = new Float64Array(3);
const g2 = new Float64Array(3);
const kBuf = new Float64Array(4);

/** 갈래 ⓐ — 서브스텝 시작 시점의 G에서 강성을 한 번 룩업한다.
 * 성분 3개를 도는 «안»이 아니라 «밖»에서 부르는 이유: XPBD 유도가 α 상수를
 * 전제하므로, 근사의 구간을 서브스텝으로 두는 것이 v3-01 §1-3 ⓐ의 정의다. */
function reevaluateStiffness(
  s: Solver,
  c: InplaneConstraint,
  o0: number,
  o1: number,
  o2: number,
): void {
  const e1x = s.pos[o1] - s.pos[o0];
  const e1y = s.pos[o1 + 1] - s.pos[o0 + 1];
  const e1z = s.pos[o1 + 2] - s.pos[o0 + 2];
  const e2x = s.pos[o2] - s.pos[o0];
  const e2y = s.pos[o2 + 1] - s.pos[o0 + 1];
  const e2z = s.pos[o2 + 2] - s.pos[o0 + 2];
  const xux = c.a * e1x + c.b * e2x;
  const xuy = c.a * e1y + c.b * e2y;
  const xuz = c.a * e1z + c.b * e2z;
  const xvx = c.c * e1x + c.d * e2x;
  const xvy = c.c * e1y + c.d * e2y;
  const xvz = c.c * e1z + c.d * e2z;
  stiffnessAt(
    c.samples!,
    (xux * xux + xuy * xuy + xuz * xuz - 1) / 2,
    (xvx * xvx + xvy * xvy + xvz * xvz - 1) / 2,
    (xux * xvx + xuy * xvy + xuz * xvz) / 2,
    kBuf,
  );
  // physics.cpp 76-77: k[0]=warp · k[2]=weft · k[3]=전단 (k[1]=교차항은 미사용)
  // 0이면 α가 발산하므로 하한을 둔다 — LUT가 음수를 0으로 클램프하기 때문.
  c.kU = Math.max(kBuf[0], 1e-6);
  c.kV = Math.max(kBuf[2], 1e-6);
  c.kS = Math.max(kBuf[3], 1e-6);
}

function projectInplane(s: Solver, c: InplaneConstraint, h2: number): void {
  const w0 = s.invMass[c.i0];
  const w1 = s.invMass[c.i1];
  const w2 = s.invMass[c.i2];
  if (w0 + w1 + w2 === 0) return;
  const o0 = c.i0 * 3;
  const o1 = c.i1 * 3;
  const o2 = c.i2 * 3;

  if (c.samples) reevaluateStiffness(s, c, o0, o1, o2);

  // ponytail: k1(교차항)은 스칼라 제약 하나로 안 떨어져 이 판에서 버린다.
  // 승격 경로 = 갈래 ⓐ(서브스텝마다 G에서 α 재평가) 도입 시 2×2 블록으로 재유도.
  for (let comp = 0; comp < 3; comp++) {
    const e1x = s.pos[o1] - s.pos[o0];
    const e1y = s.pos[o1 + 1] - s.pos[o0 + 1];
    const e1z = s.pos[o1 + 2] - s.pos[o0 + 2];
    const e2x = s.pos[o2] - s.pos[o0];
    const e2y = s.pos[o2 + 1] - s.pos[o0 + 1];
    const e2z = s.pos[o2 + 2] - s.pos[o0 + 2];
    const xux = c.a * e1x + c.b * e2x;
    const xuy = c.a * e1y + c.b * e2y;
    const xuz = c.a * e1z + c.b * e2z;
    const xvx = c.c * e1x + c.d * e2x;
    const xvy = c.c * e1y + c.d * e2y;
    const xvz = c.c * e1z + c.d * e2z;

    let C: number;
    let stiff: number;
    if (comp === 0) {
      // C = G00 = (xu·xu - 1)/2 ; ∇1 = a*xu, ∇2 = b*xu
      C = (xux * xux + xuy * xuy + xuz * xuz - 1) / 2;
      stiff = c.kU;
      g1[0] = c.a * xux;
      g1[1] = c.a * xuy;
      g1[2] = c.a * xuz;
      g2[0] = c.b * xux;
      g2[1] = c.b * xuy;
      g2[2] = c.b * xuz;
    } else if (comp === 1) {
      // C = G11 = (xv·xv - 1)/2 ; ∇1 = c*xv, ∇2 = d*xv
      C = (xvx * xvx + xvy * xvy + xvz * xvz - 1) / 2;
      stiff = c.kV;
      g1[0] = c.c * xvx;
      g1[1] = c.c * xvy;
      g1[2] = c.c * xvz;
      g2[0] = c.d * xvx;
      g2[1] = c.d * xvy;
      g2[2] = c.d * xvz;
    } else {
      // C = G01 = (xu·xv)/2 ; ∇1 = (a*xv + c*xu)/2, ∇2 = (b*xv + d*xu)/2
      C = (xux * xvx + xuy * xvy + xuz * xvz) / 2;
      stiff = c.kS;
      g1[0] = (c.a * xvx + c.c * xux) / 2;
      g1[1] = (c.a * xvy + c.c * xuy) / 2;
      g1[2] = (c.a * xvz + c.c * xuz) / 2;
      g2[0] = (c.b * xvx + c.d * xux) / 2;
      g2[1] = (c.b * xvy + c.d * xuy) / 2;
      g2[2] = (c.b * xvz + c.d * xuz) / 2;
    }
    g0[0] = -(g1[0] + g2[0]);
    g0[1] = -(g1[1] + g2[1]);
    g0[2] = -(g1[2] + g2[2]);

    const denomW =
      w0 * (g0[0] * g0[0] + g0[1] * g0[1] + g0[2] * g0[2]) +
      w1 * (g1[0] * g1[0] + g1[1] * g1[1] + g1[2] * g1[2]) +
      w2 * (g2[0] * g2[0] + g2[1] * g2[1] + g2[2] * g2[2]);
    if (denomW < 1e-20) continue;
    const at = 1 / (c.area * stiff) / h2; // α = 1/(A*k)
    const lam = c.lambda[comp];
    const dl = (-C - at * lam) / (denomW + at);
    c.lambda[comp] = lam + dl;
    s.pos[o0] += w0 * dl * g0[0];
    s.pos[o0 + 1] += w0 * dl * g0[1];
    s.pos[o0 + 2] += w0 * dl * g0[2];
    s.pos[o1] += w1 * dl * g1[0];
    s.pos[o1 + 1] += w1 * dl * g1[1];
    s.pos[o1 + 2] += w1 * dl * g1[2];
    s.pos[o2] += w2 * dl * g2[0];
    s.pos[o2 + 1] += w2 * dl * g2[1];
    s.pos[o2 + 2] += w2 * dl * g2[2];
  }
}
