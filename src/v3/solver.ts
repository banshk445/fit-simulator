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

/** 이면각 힌지 굽힘 제약 (v3-01 §3: Wang 데이터가 이미 힌지형이라 그대로 소비한다).
 *
 * ARCSim `physics.cpp:113-129`의 에너지:
 *   E = ke · (l²/(2a)) · (θ − θ_ideal)² / 4,   a = a₀ + a₁ (인접 두 면의 정지 면적 합)
 * XPBD 제약 하나의 에너지가 C²/(2α)이고 C = θ − θ₀ 이므로
 *   1/(2α) = ke·l²/(8a)  ⟹  **α = 4a/(ke·l²)**.
 * `shape = 4a/l²`를 접어 두고 α = shape/ke 로 쓴다. ke 단위는 **N·m**(v3-02 §0-3).
 */
export type BendConstraint = {
  kind: 'bend';
  /** 공유 엣지 */
  p0: number;
  p1: number;
  /** 양쪽 날개 정점 */
  p2: number;
  p3: number;
  /** 정지 이면각 [rad]. 평면 제도이므로 0이어야 한다(S2 완료 조건 ①) */
  restAngle: number;
  /** 굽힘 강성 [N·m] */
  ke: number;
  /** 4a/l² — α = shape/ke */
  shape: number;
  lambda: number;
};

export type Constraint = DistanceConstraint | InplaneConstraint | BendConstraint;

/* ── S3 몸 충돌 — «단방향». 흡착·인력 항 0 ─────────────────────────────────
 *
 * v2는 `bvhFromArrays.ts:105-115`에서 「탐지 반경 안이면 부호 없이 margin 거리로 스냅」
 * 했다(= 흡착). v3는 **관통했을 때만 밀어낸다.** 밖에 있으면 «아무 일도 안 한다».
 *
 * 부호는 해석 형상에서 닫힌 형식으로 나온다 — BVH도 레이 패리티도 필요 없다.
 * 메시 몸의 부호 판정은 S4 몫이다(설계 §2-4의 수밀 제약이 거기서 걸린다).
 */
export type Collider =
  /** 반평면. 법선 n 쪽이 «바깥»(자유 공간)이고 반대쪽이 고체다. */
  | { kind: 'plane'; p: readonly [number, number, number]; n: readonly [number, number, number] }
  | { kind: 'sphere'; c: readonly [number, number, number]; r: number }
  /** 무한 원기둥. a는 «단위» 축 벡터. */
  | {
      kind: 'cylinder';
      c: readonly [number, number, number];
      a: readonly [number, number, number];
      r: number;
    };

export type CollisionParams = {
  colliders: readonly Collider[];
  /** 옷 두께 [m] — 표면에서 이만큼 떨어진 곳을 접촉면으로 본다 */
  thickness: number;
  /** 쿨롱 마찰계수. ARCSim 원단 파일에 마찰 항이 «없다» ⟹ 출처 미확보(시험용 상수) */
  mu: number;
  /** 충돌 해소 주기(서브스텝). 기본 1 = 매 서브스텝 */
  every?: number;
};

/** 부호 있는 거리와 «바깥» 방향 법선. d > 0 이면 자유 공간. */
function sdf(c: Collider, x: number, y: number, z: number, out: Float64Array): number {
  if (c.kind === 'plane') {
    out[0] = c.n[0];
    out[1] = c.n[1];
    out[2] = c.n[2];
    return (x - c.p[0]) * c.n[0] + (y - c.p[1]) * c.n[1] + (z - c.p[2]) * c.n[2];
  }
  if (c.kind === 'sphere') {
    const dx = x - c.c[0];
    const dy = y - c.c[1];
    const dz = z - c.c[2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-12) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return -c.r;
    }
    out[0] = dx / l;
    out[1] = dy / l;
    out[2] = dz / l;
    return l - c.r;
  }
  const dx = x - c.c[0];
  const dy = y - c.c[1];
  const dz = z - c.c[2];
  const t = dx * c.a[0] + dy * c.a[1] + dz * c.a[2];
  const rx = dx - t * c.a[0];
  const ry = dy - t * c.a[1];
  const rz = dz - t * c.a[2];
  const l = Math.hypot(rx, ry, rz);
  if (l < 1e-12) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    return -c.r;
  }
  out[0] = rx / l;
  out[1] = ry / l;
  out[2] = rz / l;
  return l - c.r;
}

const cn = new Float64Array(3);

/** 직전 `step` 호출의 충돌 계기. [해소 정점 수, 최대 관통 깊이, 질의 횟수, 충돌 ms] */
export const collisionStats = new Float64Array(4);

/** 단방향 관통 해소 + 쿨롱 마찰. */
function resolveCollisions(s: Solver, cp: CollisionParams): void {
  for (let v = 0; v < s.n; v++) {
    if (s.invMass[v] === 0) continue;
    const o = v * 3;
    for (const col of cp.colliders) {
      collisionStats[2]++;
      const d = sdf(col, s.pos[o], s.pos[o + 1], s.pos[o + 2], cn) - cp.thickness;
      if (d >= 0) continue; // 밖 ⟹ «아무 일도 안 한다»(흡착 0)
      const depth = -d;
      if (depth > collisionStats[1]) collisionStats[1] = depth;
      collisionStats[0]++;
      // 1) 법선 방향으로 «밀어낸다»
      s.pos[o] += depth * cn[0];
      s.pos[o + 1] += depth * cn[1];
      s.pos[o + 2] += depth * cn[2];
      // 2) 쿨롱 마찰 — 이번 서브스텝의 «접선» 변위를 μ·depth 만큼까지 되돌린다.
      //    정지/운동을 따로 두지 않는다: min(1, μ·depth/|Δx_t|)가 둘을 함께 준다.
      //    평형에서 depth ≈ h²g·cosθ, |Δx_t| ≈ h²g·sinθ ⟹ 임계는 tanθ = μ.
      if (cp.mu > 0) {
        let tx = s.pos[o] - s.prev[o];
        let ty = s.pos[o + 1] - s.prev[o + 1];
        let tz = s.pos[o + 2] - s.prev[o + 2];
        const dn = tx * cn[0] + ty * cn[1] + tz * cn[2];
        tx -= dn * cn[0];
        ty -= dn * cn[1];
        tz -= dn * cn[2];
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-15) {
          const k = Math.min(1, (cp.mu * depth) / tl);
          s.pos[o] -= tx * k;
          s.pos[o + 1] -= ty * k;
          s.pos[o + 2] -= tz * k;
        }
      }
    }
  }
}

export type SolverParams = {
  /** 프레임 시간간격 [s] */
  dt: number;
  /** 프레임당 서브스텝 수 */
  substeps: number;
  /** 중력 [m/s^2], y축 아래로 */
  gravity: number;
  /** 속도 감쇠 [1/s]. 서브스텝 수와 무관하게 만들기 위해 exp(-damping*h)로 쓴다 */
  damping: number;
  /** 정점별 외력 [N] (3n). 없으면 중력만. S2 인장 시험이 하중을 «질량비 없이»
   * 걸기 위해 쓴다 — 무거운 추로 대신하면 하중과 관성이 함께 커진다. */
  extForce?: Float64Array;
  /** 서브스텝당 제약 투영 반복 수. 기본 1(small-steps). λ는 «서브스텝마다» 0으로
   * 초기화하고 반복 사이에는 «누적»한다 — XPBD 유도가 그 형태다. */
  iterations?: number;
  /** 몸 충돌. 없으면 충돌 코드가 «한 줄도» 돌지 않는다(기존 경로 비트 동일). */
  collision?: CollisionParams;
};

/** 결합 제약계가 «명목» 강성을 내려면 서브스텝이 **원소** 진동을 풀어야 한다.
 *
 * v3-04 실측 법칙(균일 인장 사슬 · 2자릿수 대역에서 적합 오차 0.00~4.5%):
 *   실효 강성비  r ≈ 1/(1 + (h·ω_el)²),   ω_el = √(k_el / m_절점),  h = dt/substeps
 * — **사슬 길이 N에는 거의 무관하다**(N≥9에서 포화). 제약이 «1개»면 r=1이 정확히
 * 성립하므로(N=1 실측 1.00000000) 단일 제약 계기는 이 축을 원리적으로 못 본다.
 *
 * r ≥ rTarget 을 만족하는 최소 서브스텝 수를 돌려준다.
 */
export function substepsFor(dt: number, kEl: number, mNode: number, rTarget = 0.95): number {
  const hwMax = Math.sqrt(1 / rTarget - 1);
  const w = Math.sqrt(kEl / mNode);
  return Math.max(1, Math.ceil((dt * w) / hwMax));
}

/** 천 메시용 편의형: 멤브레인 강성 k [N/m] · 면밀도 ρ [kg/m²] · 엣지 길이 d [m].
 * 삼각 메시에서 원소 스프링 ≈ k(폭/길이 = 1), 절점 질량 ≈ ρ·d² ⟹ ω_el = √(k/ρ)/d. */
export function substepsForCloth(
  dt: number,
  k: number,
  areaDensity: number,
  edgeLen: number,
  rTarget = 0.95,
): number {
  return substepsFor(dt, k, areaDensity * edgeLen * edgeLen, rTarget);
}

/** 굽힘 제약의 «원소» 진동수 [rad/s] — v3-06 #16.
 *
 * v3-04가 신장에서 찾은 법칙 `r ≈ 1/(1+(h·ω)²)`의 ω를 굽힘에도 «같은 정의»로 쓴다:
 *   ω² = (1/α)·Σᵢ wᵢ|∇Cᵢ|²,   α = shape/ke
 * 폐형 비례식(v3-05 §1의 `ω_bend ∝ 1/d²`)을 쓰지 않고 **현재 상태에서 기울기를 직접
 * 계산**한다. 이유: 비례식은 «정규 격자» 가정 위에 있는데 등록 장면은 원소 종횡비가
 * 2.2이고 v3 실제 메시는 비정형이다. 상태에서 재면 가정이 필요 없다.
 */
export function bendOmega(s: Solver, c: BendConstraint): number {
  bendGradients(s, c);
  const denomW =
    s.invMass[c.p0] * (b0[0] * b0[0] + b0[1] * b0[1] + b0[2] * b0[2]) +
    s.invMass[c.p1] * (b1[0] * b1[0] + b1[1] * b1[1] + b1[2] * b1[2]) +
    s.invMass[c.p2] * (b2[0] * b2[0] + b2[1] * b2[1] + b2[2] * b2[2]) +
    s.invMass[c.p3] * (b3[0] * b3[0] + b3[1] * b3[1] + b3[2] * b3[2]);
  return Math.sqrt((c.ke / c.shape) * denomW);
}

/** 굽힘 제약 집합이 r ≥ rTarget 을 내는 최소 서브스텝 수(가장 «빠른» 제약 기준).
 * 멤브레인은 `substepsForCloth`가 그대로 담당한다 — 실제 예산은 **둘 중 큰 쪽**이다. */
export function substepsForBending(
  dt: number,
  s: Solver,
  bends: readonly BendConstraint[],
  rTarget = 0.95,
): number {
  let wMax = 0;
  for (const c of bends) wMax = Math.max(wMax, bendOmega(s, c));
  if (!(wMax > 0)) return 1;
  return Math.max(1, Math.ceil((dt * wMax) / Math.sqrt(1 / rTarget - 1)));
}

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

/** 내부 삼각 엣지마다 힌지 굽힘 제약을 만든다. 정지 길이·면적은 정지 2D 좌표에서 뜬다
 * (제도가 평면이므로 restUV가 곧 정지 형상이다 — 별도 배열을 만들지 않는다, 함정 12). */
export function makeBend(
  tris: ArrayLike<number>,
  restUV: ArrayLike<number>,
  ke: number,
): BendConstraint[] {
  // 엣지 → (반대편 정점, 삼각형 면적) 두 개까지
  const edges = new Map<string, { a: number; b: number; wings: number[]; areas: number[] }>();
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t], tris[t + 1], tris[t + 2]];
    const area = triArea(restUV, v[0], v[1], v[2]);
    for (let i = 0; i < 3; i++) {
      const a = v[i];
      const b = v[(i + 1) % 3];
      const w = v[(i + 2) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let e = edges.get(key);
      if (!e) {
        e = { a: Math.min(a, b), b: Math.max(a, b), wings: [], areas: [] };
        edges.set(key, e);
      }
      e.wings.push(w);
      e.areas.push(area);
    }
  }
  const out: BendConstraint[] = [];
  for (const e of edges.values()) {
    if (e.wings.length !== 2) continue; // 경계 엣지 — 힌지 없음
    const l = Math.hypot(
      restUV[e.b * 2] - restUV[e.a * 2],
      restUV[e.b * 2 + 1] - restUV[e.a * 2 + 1],
    );
    const a = e.areas[0] + e.areas[1];
    out.push({
      kind: 'bend',
      p0: e.a,
      p1: e.b,
      p2: e.wings[0],
      p3: e.wings[1],
      restAngle: 0, // 평면 제도 ⟹ 0. 하네스가 실측으로 확인한다(완료 조건 ①)
      ke,
      shape: (4 * a) / (l * l),
      lambda: 0,
    });
  }
  return out;
}

/** 이면각 [rad]. 평면이면 0. 부호는 엣지 방향 기준. */
export function dihedral(s: Solver, c: BendConstraint): number {
  const o0 = c.p0 * 3;
  const o1 = c.p1 * 3;
  const o2 = c.p2 * 3;
  const o3 = c.p3 * 3;
  const ex = s.pos[o1] - s.pos[o0];
  const ey = s.pos[o1 + 1] - s.pos[o0 + 1];
  const ez = s.pos[o1 + 2] - s.pos[o0 + 2];
  const d2x = s.pos[o2] - s.pos[o0];
  const d2y = s.pos[o2 + 1] - s.pos[o0 + 1];
  const d2z = s.pos[o2 + 2] - s.pos[o0 + 2];
  const d3x = s.pos[o3] - s.pos[o0];
  const d3y = s.pos[o3 + 1] - s.pos[o0 + 1];
  const d3z = s.pos[o3 + 2] - s.pos[o0 + 2];
  // n1 = e × d2, n2 = d3 × e  ⟹ 평면일 때 두 법선이 «같은» 방향(θ=0)
  const n1x = ey * d2z - ez * d2y;
  const n1y = ez * d2x - ex * d2z;
  const n1z = ex * d2y - ey * d2x;
  const n2x = d3y * ez - d3z * ey;
  const n2y = d3z * ex - d3x * ez;
  const n2z = d3x * ey - d3y * ex;
  const l1 = Math.hypot(n1x, n1y, n1z);
  const l2 = Math.hypot(n2x, n2y, n2z);
  const le = Math.hypot(ex, ey, ez);
  if (l1 < 1e-14 || l2 < 1e-14 || le < 1e-14) return 0;
  const a1x = n1x / l1;
  const a1y = n1y / l1;
  const a1z = n1z / l1;
  const a2x = n2x / l2;
  const a2y = n2y / l2;
  const a2z = n2z / l2;
  const cx = a1y * a2z - a1z * a2y;
  const cy = a1z * a2x - a1x * a2z;
  const cz = a1x * a2y - a1y * a2x;
  const sin = (cx * ex + cy * ey + cz * ez) / le;
  const cos = a1x * a2x + a1y * a2y + a1z * a2z;
  return Math.atan2(sin, cos);
}

const b0 = new Float64Array(3);
const b1 = new Float64Array(3);
const b2 = new Float64Array(3);
const b3 = new Float64Array(3);

/** θ의 정점별 기울기. 하네스가 유한차분으로 검증한다(v3S2.ts 자기검사). */
function bendGradients(s: Solver, c: BendConstraint): number {
  const o0 = c.p0 * 3;
  const o1 = c.p1 * 3;
  const o2 = c.p2 * 3;
  const o3 = c.p3 * 3;
  const ex = s.pos[o1] - s.pos[o0];
  const ey = s.pos[o1 + 1] - s.pos[o0 + 1];
  const ez = s.pos[o1 + 2] - s.pos[o0 + 2];
  const d2x = s.pos[o2] - s.pos[o0];
  const d2y = s.pos[o2 + 1] - s.pos[o0 + 1];
  const d2z = s.pos[o2 + 2] - s.pos[o0 + 2];
  const d3x = s.pos[o3] - s.pos[o0];
  const d3y = s.pos[o3 + 1] - s.pos[o0 + 1];
  const d3z = s.pos[o3 + 2] - s.pos[o0 + 2];
  const n1x = ey * d2z - ez * d2y;
  const n1y = ez * d2x - ex * d2z;
  const n1z = ex * d2y - ey * d2x;
  const n2x = d3y * ez - d3z * ey;
  const n2y = d3z * ex - d3x * ez;
  const n2z = d3x * ey - d3y * ex;
  const l1 = Math.hypot(n1x, n1y, n1z);
  const l2 = Math.hypot(n2x, n2y, n2z);
  const le2 = ex * ex + ey * ey + ez * ez;
  const le = Math.sqrt(le2);
  if (l1 < 1e-14 || l2 < 1e-14 || le < 1e-14) return 0;
  // ∇p2θ = −n̂1/hA,  hA = |n1|/|e|  ⟹  −n1·|e|/|n1|²
  const kA = -le / (l1 * l1);
  const kB = -le / (l2 * l2);
  b2[0] = kA * n1x;
  b2[1] = kA * n1y;
  b2[2] = kA * n1z;
  b3[0] = kB * n2x;
  b3[1] = kB * n2y;
  b3[2] = kB * n2z;
  const tA = (d2x * ex + d2y * ey + d2z * ez) / le2;
  const tB = (d3x * ex + d3y * ey + d3z * ez) / le2;
  for (let i = 0; i < 3; i++) {
    b0[i] = (tA - 1) * b2[i] + (tB - 1) * b3[i];
    b1[i] = -tA * b2[i] - tB * b3[i];
  }
  return dihedral(s, c);
}

function projectBend(s: Solver, c: BendConstraint, h2: number): void {
  const w0 = s.invMass[c.p0];
  const w1 = s.invMass[c.p1];
  const w2 = s.invMass[c.p2];
  const w3 = s.invMass[c.p3];
  if (w0 + w1 + w2 + w3 === 0) return;
  const theta = bendGradients(s, c);
  const denomW =
    w0 * (b0[0] * b0[0] + b0[1] * b0[1] + b0[2] * b0[2]) +
    w1 * (b1[0] * b1[0] + b1[1] * b1[1] + b1[2] * b1[2]) +
    w2 * (b2[0] * b2[0] + b2[1] * b2[1] + b2[2] * b2[2]) +
    w3 * (b3[0] * b3[0] + b3[1] * b3[1] + b3[2] * b3[2]);
  if (denomW < 1e-20) return;
  const C = theta - c.restAngle;
  const at = c.shape / c.ke / h2; // α = 4a/(ke·l²)
  const dl = (-C - at * c.lambda) / (denomW + at);
  c.lambda += dl;
  const o0 = c.p0 * 3;
  const o1 = c.p1 * 3;
  const o2 = c.p2 * 3;
  const o3 = c.p3 * 3;
  for (let i = 0; i < 3; i++) {
    s.pos[o0 + i] += w0 * dl * b0[i];
    s.pos[o1 + i] += w1 * dl * b1[i];
    s.pos[o2 + i] += w2 * dl * b2[i];
    s.pos[o3 + i] += w3 * dl * b3[i];
  }
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
      if (p.extForce) {
        const w = s.invMass[v];
        s.vel[o] += p.extForce[o] * w * h;
        s.vel[o + 1] += p.extForce[o + 1] * w * h;
        s.vel[o + 2] += p.extForce[o + 2] * w * h;
      }
      s.pos[o] += s.vel[o] * h;
      s.pos[o + 1] += s.vel[o + 1] * h;
      s.pos[o + 2] += s.vel[o + 2] * h;
    }
    // λ 초기화는 «서브스텝마다» 한 번. 반복 사이에는 누적한다(XPBD 유도 그대로).
    for (const c of cs) {
      if (c.kind === 'inplane') {
        c.lambda[0] = 0;
        c.lambda[1] = 0;
        c.lambda[2] = 0;
      } else c.lambda = 0;
    }
    const iters = p.iterations ?? 1;
    for (let it = 0; it < iters; it++)
      for (const c of cs) {
        if (c.kind === 'dist') projectDistance(s, c, h2);
        else if (c.kind === 'bend') projectBend(s, c, h2);
        else projectInplane(s, c, h2);
      }
    // 몸 충돌 — 제약 투영 «뒤», 속도 갱신 «앞». 단방향 · 흡착 0.
    if (p.collision && sub % (p.collision.every ?? 1) === 0) {
      const t0 = performance.now();
      resolveCollisions(s, p.collision);
      collisionStats[3] += performance.now() - t0;
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
