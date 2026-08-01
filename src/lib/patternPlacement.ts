// v2 — 정적 배치의 관통 판정·교정. 2a 게이트와 2b 착장 S0가 **같은 함수**를
// 써야 두 단계의 "관통 0"이 같은 것을 뜻한다(함정 12의 실질).
//
// ## 관통 판정은 레이 패리티다 (골격 부호 샘플러 금지)
// 골격 부호 샘플러(1a 은행 자산)의 참조 방향은 "최근접 골격점에서 밖으로"인데,
// 몸판 바깥쪽 정점은 최근접 선분이 **팔**이고 그 팔이 정점보다 더 바깥이라
// 방향이 뒤집힌다 — 2a 첫 실행에서 옷이 몸 밖 14.7cm에 평평히 놓인 상태로
// 앞판 412·뒤판 143개가 "최심 215mm 관통"으로 찍혔다. 패리티는 star-shaped
// 전제가 없다.
//
// **한계 병기**: 패리티의 전제는 수밀성인데 `wholeBodyIndex`는 비-2회 엣지
// 2,760개로 수밀이 아니다(v2-design §5 등재). 3축 다수결로 완화하지만 근사다.
import * as THREE from "three";

export interface RayMesh {
  raycastFirst(origin: THREE.Vector3, direction: THREE.Vector3, far: number): THREE.Vector3 | null;
  closestPointUnsigned(px: number, py: number, pz: number, r: number): { x: number; y: number; z: number; distance: number } | null;
}

const DIRS: readonly [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const RAY_FAR_M = 4;
const RAY_EPS_M = 1e-4;
const MAX_HITS = 16;

export function makeParityInside(mesh: RayMesh): (x: number, y: number, z: number) => boolean {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return (x, y, z) => {
    let votes = 0;
    for (const d of DIRS) {
      let hits = 0;
      let ox = x, oy = y, oz = z;
      for (let k = 0; k < MAX_HITS; k++) {
        origin.set(ox, oy, oz);
        dir.set(d[0], d[1], d[2]);
        const hit = mesh.raycastFirst(origin, dir, RAY_FAR_M);
        if (!hit) break;
        hits++;
        ox = hit.x + d[0] * RAY_EPS_M;
        oy = hit.y + d[1] * RAY_EPS_M;
        oz = hit.z + d[2] * RAY_EPS_M;
      }
      if (hits % 2 === 1) votes++;
    }
    return votes >= 2;
  };
}

// 수밀성 진단 — 패리티를 쓰기 전에 전제를 먼저 잰다.
export function countOpenEdges(index: ArrayLike<number>): { triangles: number; edges: number; open: number } {
  const use = new Map<number, number>();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const k = Math.min(v[i], v[j]) * 1_000_000 + Math.max(v[i], v[j]);
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const u of use.values()) if (u !== 2) open++;
  return { triangles: index.length / 3, edges: use.size, open };
}

export function countInside(
  positions: Float32Array,
  count: number,
  inside: (x: number, y: number, z: number) => boolean,
): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (inside(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])) n++;
  }
  return n;
}

// §4 S0의 "기울기 방향으로 1회 압출 교정". 안쪽 점에서 SDF 기울기 방향 =
// 최근접 표면 방향이므로 부호가 필요 없다.
//
// `minSepM`(= 자기충돌 문턱)을 함께 지킨다: 투영은 여러 정점을 같은 표면점
// 근방으로 모을 수 있고 그러면 **교정이 자기충돌 오발화를 만든다**(2a 첫
// 구현에서 오발화 0 → 2). 법선 방향으로 더 밀어 문턱 밖으로 뺀다.
export function correctPlacementPenetration(
  positions: Float32Array,
  count: number,
  mesh: RayMesh,
  inside: (x: number, y: number, z: number) => boolean,
  marginM: number,
  minSepM: number,
  // 문턱 검사에서 제외할 쌍(메시 엣지 + 시접) — 이웃끼리는 원래 가깝다.
  skipPairKeys: ReadonlySet<number>,
  detectionRadiusM: number,
): number {
  let corrected = 0;
  const clashAt = (i: number, px: number, py: number, pz: number): boolean => {
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      if (skipPairKeys.has(Math.min(i, j) * 1_000_000 + Math.max(i, j))) continue;
      if (Math.hypot(positions[j * 3] - px, positions[j * 3 + 1] - py, positions[j * 3 + 2] - pz) < minSepM) return true;
    }
    return false;
  };
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (!inside(x, y, z)) continue;
    const c = mesh.closestPointUnsigned(x, y, z, detectionRadiusM);
    if (!c) continue;
    const dx = c.x - x, dy = c.y - y, dz = c.z - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    let out = marginM;
    for (let k = 0; k < 8; k++) {
      const px = c.x + (dx / l) * out, py = c.y + (dy / l) * out, pz = c.z + (dz / l) * out;
      const clash = clashAt(i, px, py, pz);
      positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
      if (!clash) break;
      out += minSepM;
    }
    corrected++;
  }
  return corrected;
}

// ── 배치 삼각형 뒤집힘 (사상 전단사성의 직접 검사) ──────────────────────
// 왜 필요한가: 배치 사상이 (경계 위치, 안쪽 깊이)류의 매개화면 패널 중앙부에서
// 모호해질 수 있고, 그때 생기는 접힘은 관통·자기교차 채널에 **안 잡히는**
// 경우가 있다(접힌 두 면이 서로를 뚫지 않고 겹치기만 하면 교차가 0이다).
// 판정: 엣지를 공유하는 두 삼각형의 법선 내적이 음수면 그 엣지에서 면이 접혔다.
// 메시 엣지가 8~16mm이고 몸 곡률 반경이 수 cm이므로 정상 곡면에서 인접 면각이
// 90°를 넘을 수 없다 — 음의 내적은 곡률이 아니라 접힘이다.
export function countPlacementFolds(
  positions: Float32Array,
  tris: Uint32Array,
): { folds: number; worstDot: number; examples: number[] } {
  const triCount = tris.length / 3;
  const nx = new Float64Array(triCount), ny = new Float64Array(triCount), nz = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    nx[t] = x / l; ny[t] = y / l; nz[t] = z / l;
  }
  const owner = new Map<number, number>();
  let folds = 0, worstDot = 1;
  const examples: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const v = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const k = Math.min(v[i], v[j]) * 1_000_000 + Math.max(v[i], v[j]);
      const other = owner.get(k);
      if (other === undefined) { owner.set(k, t); continue; }
      const dot = nx[t] * nx[other] + ny[t] * ny[other] + nz[t] * nz[other];
      if (dot < worstDot) worstDot = dot;
      if (dot < 0) { folds++; if (examples.length < 5) examples.push(t); }
    }
  }
  return { folds, worstDot, examples };
}

// ── 자기교차 판정 (엣지-삼각형) ─────────────────────────────────────────
// 왜 새로 만드나: 2b 1회차의 `자기교차` 게이트는 실제로 "비인접 정점 쌍의
// 문턱 위반 수"를 셌다 — 뭉친 천의 **정상적인 폴드 접촉**이 그대로 잡히므로
// 게이트로 쓸 수 없는 채널이었다(함정 13 계열: 지표 이름이 계산되지 않은
// 물리량을 주장한다). 그 채널은 `proximityPairs`로 개명해 기록만 하고,
// 게이트는 여기 있는 **실제 교차**가 맡는다.
//
// 판정: 메시 엣지 선분이 자기 자신과 인접하지 않은 삼각형을 관통하는가
// (Möller–Trumbore). 삼각형을 균일 격자에 버킷팅해 엣지 AABB가 걸치는
// 셀만 본다 — 전수 비교는 15k엣지 × 9.8k삼각형 = 1.5억 회로 프레임 밖이다.
// 무게중심·선분 파라미터의 경계 허용오차 — 모서리·정점을 스치는 접촉을
// 교차로 세지 않는다.
const PARAM_EPS = 1e-6;

export function countSelfIntersections(
  positions: Float32Array,
  tris: Uint32Array,
  edges: readonly { a: number; b: number }[],
  cellM: number,
  // 46회차 — 위치 분해용. 기본 5는 기존 동작 그대로(다른 호출부 비트 동일).
  maxExamples = 5,
): { count: number; examples: { edge: [number, number]; tri: number }[] } {
  const triCount = tris.length / 3;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number, cz: number): number =>
    (cx + 4096) * 16_777_216 + (cy + 4096) * 4096 + (cz + 4096);
  const cellOf = (v: number): number => Math.floor(v / cellM);
  for (let t = 0; t < triCount; t++) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k];
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
    for (let cx = cellOf(xMin); cx <= cellOf(xMax); cx++) {
      for (let cy = cellOf(yMin); cy <= cellOf(yMax); cy++) {
        for (let cz = cellOf(zMin); cz <= cellOf(zMax); cz++) {
          const k = key(cx, cy, cz);
          const b = grid.get(k);
          if (b) b.push(t); else grid.set(k, [t]);
        }
      }
    }
  }

  let count = 0;
  const examples: { edge: [number, number]; tri: number }[] = [];
  const seen = new Set<number>();
  for (const e of edges) {
    const ax = positions[e.a * 3], ay = positions[e.a * 3 + 1], az = positions[e.a * 3 + 2];
    const bx = positions[e.b * 3], by = positions[e.b * 3 + 1], bz = positions[e.b * 3 + 2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    seen.clear();
    for (let cx = cellOf(Math.min(ax, bx)); cx <= cellOf(Math.max(ax, bx)); cx++) {
      for (let cy = cellOf(Math.min(ay, by)); cy <= cellOf(Math.max(ay, by)); cy++) {
        for (let cz = cellOf(Math.min(az, bz)); cz <= cellOf(Math.max(az, bz)); cz++) {
          const bucket = grid.get(key(cx, cy, cz));
          if (!bucket) continue;
          for (const t of bucket) {
            if (seen.has(t)) continue;
            seen.add(t);
            const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
            // 엣지 끝점을 공유하는 삼각형은 인접 — 교차가 아니다.
            if (i0 === e.a || i1 === e.a || i2 === e.a || i0 === e.b || i1 === e.b || i2 === e.b) continue;
            const e1x = positions[i1 * 3] - positions[i0 * 3];
            const e1y = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
            const e1z = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
            const e2x = positions[i2 * 3] - positions[i0 * 3];
            const e2y = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
            const e2z = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            // 상대 허용오차 — 미터 단위 좌표에서 det의 정상 크기는 (1e-2)^3 =
            // 1e-6 규모다. 1e-16 같은 절대 하한은 **거의 평행한** 경우를
            // 통과시켜 곡면 위 이웃 삼각형을 스치는 것을 "교차"로 세게 된다
            // (정적 배치 소매에서 3건이 그렇게 잡혔다 — 원통 위 (θ,t) 사상은
            // 단사라 원리적으로 교차가 불가능한데도).
            if (Math.abs(det) < 1e-12) continue;
            const inv = 1 / det;
            const tx = ax - positions[i0 * 3], ty = ay - positions[i0 * 3 + 1], tz = az - positions[i0 * 3 + 2];
            const u = (tx * px + ty * py + tz * pz) * inv;
            if (u < PARAM_EPS || u > 1 - PARAM_EPS) continue;
            const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < PARAM_EPS || u + v > 1 - PARAM_EPS) continue;
            const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (s < PARAM_EPS || s > 1 - PARAM_EPS) continue;
            count++;
            if (examples.length < maxExamples) examples.push({ edge: [e.a, e.b], tri: t });
          }
        }
      }
    }
  }
  return { count, examples };
}
