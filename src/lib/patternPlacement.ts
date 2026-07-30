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
