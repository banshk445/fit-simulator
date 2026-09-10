// 몸 메시 **와인딩 법선이 바깥을 향하는가**를 참조축 없이 판정한다. (84회차 §2)
//
// 왜 필요했나: `coverageMetric`의 `orientOutward`는 「몸통축/팔축 방사 + y 0.25」라는
// **참조축 근사**로 법선 부호를 교정한다. 83회차가 그 근사를 뺀 열(`rawNormal`)을 냈으나,
// 그 열이 원 채널과 갈릴 때 원인이 「참조축 편향」인지 「와인딩 결함」인지 못 갈랐다 —
// 두 후보가 같은 채널에 합류하기 때문이다(83회차 미해소 반증 1).
//
// 분해 방법: 몸 정점에서 **자기 와인딩 법선 방향**으로 레이를 쏘고 **몸 메시 자신과의
// 교차 패리티**를 센다. 닫힌 메시에서 표면 위의 점은
//   바깥 방향 → 바깥 영역이므로 교차 **짝수**(볼록부는 0)
//   안쪽 방향 → 내부를 지나 반드시 빠져나오므로 교차 **홀수**
// 참조축·옷·정착 상태와 전부 무관하다. fixture가 고정이면 한 번 재면 끝이다.
//
// **자기 삼각형은 인덱스로 배제한다** — t 하한으로 거르지 않는다. 79·80회차가
// 「t 하한이 버리는 것이 전부 실제 히트였다」로 태워먹은 계열이다(함정 19).
// 다만 이 메시는 좌표가 같은데 인덱스가 다른 정점이 있다(UV 접합). 그 정점의 삼각형은
// 인덱스 배제를 빠져나가 t≈0 히트를 낸다 — **거르지 않고 세어서 보고**한다(`nearZeroHits`).

export interface WindingParityResult {
  count: number;
  /** 1 = 와인딩 법선이 안쪽을 향한다(교차 홀수) */
  flipped: Uint8Array;
  /** 1 = 판정 불가(아래 사유 중 하나에 걸림) */
  ambiguous: Uint8Array;
  flippedCount: number;
  ambiguousCount: number;
  /** 자기 삼각형 인덱스 배제를 빠져나간 t≈0 히트 수(좌표 중복 정점 후보) */
  nearZeroHits: number;
  /** 삼각형 경계를 스치는 히트 수 — 패리티가 흔들릴 수 있는 자리 */
  grazingHits: number;
  triangles: number;
}

// 무게중심 좌표가 이 폭 안에서 경계에 걸리면 「스침」으로 세고 그 샘플을 판정 불가로 돌린다.
// 값이 아니라 부동소수 잡음 폭이다(교차 판정의 EPS와 같은 계열).
const GRAZE_EPS = 1e-7;
const DET_EPS = 1e-12;
// t가 이보다 작은 히트 = 원점 자신의 표면. 인덱스 배제를 빠져나간 것만 여기 걸린다.
// **거르는 문턱이 아니라 세는 문턱이다** — 걸린 샘플은 판정 불가로 돌린다.
const NEAR_ZERO_M = 1e-6;

/**
 * @param position     몸 정점 좌표(xyz 평탄)
 * @param bodyIndexes  레이를 쏠 대상 삼각형 집합. **닫힌 집합이어야 한다** —
 *                     열린 집합에 쏘면 패리티가 정의되지 않는다(호출부가 확인할 것).
 * @param samples      `computeBodyCoverage`가 낸 샘플 원자료(표본을 다시 만들지 않는다)
 */
export function classifyWindingOutward(
  position: Float32Array,
  bodyIndexes: readonly (ArrayLike<number> | null)[],
  samples: { points: Float32Array; normals: Float32Array; vertexIndexes: Int32Array; count: number },
): WindingParityResult {
  // 삼각형을 평탄 배열로 모으되 **정점 인덱스를 나란히 보존**한다 — 자기 배제가 인덱스라서.
  const tri: number[] = [];
  const triV: number[] = [];
  for (const index of bodyIndexes) {
    if (!index) continue;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      tri.push(
        position[a * 3], position[a * 3 + 1], position[a * 3 + 2],
        position[b * 3], position[b * 3 + 1], position[b * 3 + 2],
        position[c * 3], position[c * 3 + 1], position[c * 3 + 2],
      );
      triV.push(a, b, c);
    }
  }
  const tris = Float32Array.from(tri);
  const triVerts = Int32Array.from(triV);
  const nTri = triVerts.length / 3;

  // 정점 → 인접 삼각형. 자기 배제를 O(인접수)로 하기 위한 것뿐이다.
  const adj = new Map<number, number[]>();
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t * 3 + k];
      const list = adj.get(v);
      if (list) list.push(t); else adj.set(v, [t]);
    }
  }

  const flipped = new Uint8Array(samples.count);
  const ambiguous = new Uint8Array(samples.count);
  const skip = new Uint8Array(nTri);
  let flippedCount = 0, ambiguousCount = 0, nearZeroHits = 0, grazingHits = 0;

  for (let s = 0; s < samples.count; s++) {
    const ox = samples.points[s * 3], oy = samples.points[s * 3 + 1], oz = samples.points[s * 3 + 2];
    const dx = samples.normals[s * 3], dy = samples.normals[s * 3 + 1], dz = samples.normals[s * 3 + 2];
    const own = adj.get(samples.vertexIndexes[s]);
    if (own) for (const t of own) skip[t] = 1;

    let crossings = 0, amb = false;
    for (let t = 0; t < nTri; t++) {
      if (skip[t]) continue;
      const o = t * 9;
      const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
      const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
      const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -DET_EPS && det < DET_EPS) continue;
      const invDet = 1 / det;
      const tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * invDet;
      if (u < -GRAZE_EPS || u > 1 + GRAZE_EPS) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * invDet;
      if (v < -GRAZE_EPS || u + v > 1 + GRAZE_EPS) continue;
      const hitT = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      if (hitT <= 0) continue;
      if (hitT < NEAR_ZERO_M) { nearZeroHits++; amb = true; continue; }
      if (u < GRAZE_EPS || v < GRAZE_EPS || u + v > 1 - GRAZE_EPS) { grazingHits++; amb = true; }
      crossings++;
    }

    if (own) for (const t of own) skip[t] = 0;
    if (amb) { ambiguous[s] = 1; ambiguousCount++; }
    if ((crossings & 1) === 1) { flipped[s] = 1; flippedCount++; }
  }

  return { count: samples.count, flipped, ambiguous, flippedCount, ambiguousCount, nearZeroHits, grazingHits, triangles: nTri };
}

/**
 * 자체 검사 — 닫힌 정사면체에서 바깥 법선은 전부 짝수(정상), 뒤집으면 전부 홀수.
 * 계기가 「무엇을 재는가」를 실행 때마다 한 줄로 증명한다. 실패하면 문자열에 FAIL이 들어간다.
 */
export function windingParitySelfCheck(): string {
  const position = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // 바깥 향 와인딩 정사면체(4면).
  const index = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
  // 정점 법선 = 삼각형 외적 누적(`collectBandSamples`와 같은 식 — 면적 가중, 마지막에 정규화).
  const acc = new Float32Array(12);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const p = (i: number, k: number) => position[i * 3 + k];
    const e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k));
    const e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k));
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[v * 3 + k] += n[k];
  }
  // 샘플 = **정점 자신**. 실제 계기와 같은 자리다(원점이 표면 위 · 자기 삼각형은 인덱스 배제).
  // 정점 i에서 자기 삼각형 3개를 빼면 맞은편 면 1개만 남는다:
  //   바깥 법선 → 맞은편 면을 등지므로 교차 0 = 짝수 = 정상
  //   뒤집으면  → 맞은편 면을 맞히므로 교차 1 = 홀수 = flipped
  const run = (sign: number): number => {
    const nrm = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      const L = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]);
      for (let k = 0; k < 3; k++) nrm[i * 3 + k] = (acc[i * 3 + k] / L) * sign;
    }
    return classifyWindingOutward(position, [index], {
      points: position, normals: nrm, vertexIndexes: Int32Array.from([0, 1, 2, 3]), count: 4,
    }).flippedCount;
  };
  const out = run(+1), inw = run(-1);
  const ok = out === 0 && inw === 4;
  return `자체검사 ${ok ? "PASS" : "**FAIL**"} — 정사면체 정점: 바깥법선 홀수 ${out}/4(기대 0) · 반전법선 홀수 ${inw}/4(기대 4)`;
}
