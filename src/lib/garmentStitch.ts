import { ClothSimulation } from "./clothPhysics";
import type { ArrayBvhCollision } from "./bvhFromArrays";
import { SLEEVE_COLS } from "./clothConfig";

// 30번(진짜 물리적 병합): 사용자가 "어깨를 분리하지 말고 하나의 옷으로
// 해달라"고 여러 차례 지적한 게 정확한 진단이었다 — 18~29번까지 이
// 파일의 이전 버전(blendSeamRing/stitchTorsoAndSleeve)이 하던 일은 결국
// 몸판과 소매라는 "물리적으로 완전히 분리된 두 시뮬레이션"을 매 프레임
// 근사적으로("가까운 점끼리 절반씩 당기기") 갖다 붙이는 것이었다. 이
// 방식은 두 가지 근본적 한계가 있었다: (1) 몸판이 이번 프레임 다 풀린
// "뒤"에 소매를 갖다 붙이므로, 소매 쪽의 장력/접힘이 몸판의 구조 제약에
// 같은 반복(iteration) 안에서 되먹임되지 못한다 — 즉 진짜 재봉선이라면
// 소매를 당기면 몸판도 같이 딸려와야 하는데, 그게 "같은 완화 루프 안"이
// 아니라 "그 다음에 한 번" 일어나므로 늘 한 박자 늦고 약하다. (2) 대응
// 관계(어느 소매 점이 어느 몸판 점과 짝인지)를 매 프레임 최근접 탐색으로
// 다시 구했으므로, 완전히 고정된 관계가 아니라 미세하게 흔들릴 수 있었다.
//
// 이제 몸판과 소매가 clothPhysics.ts의 PanelDims 일반화 덕분에 진짜 같은
// ClothSimulation 인스턴스(같은 파티클 배열, 같은 제약 목록) 안에 있으므로,
// "당기기"가 아니라 진짜 거리 제약(addConstraint)으로 이어붙일 수 있다 —
// 다른 모든 구조/전단/벤드/시접 제약과 똑같은 방식으로 매 반복(iteration)
// 안에서 함께 풀리므로, 장력이 이음매를 가로질러 양방향으로 실시간
// 전파된다(소매를 당기면 몸판도 그 반복 안에서 같이 움직인다). 대응
// 관계도 빌드 시점에 한 번만 계산해 고정한다(매 프레임 재탐색 없음).
export function addArmholeSeamConstraints(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  sleevePanel: number,
  torsoOuterX: number,
  armholeStartRow: number,
): void {
  const boundary = torsoBoundaryIndices(sim, frontPanel, backPanel, torsoOuterX, armholeStartRow);
  if (boundary.length < 2) return;

  for (let x = 0; x < SLEEVE_COLS; x++) {
    const ringIndex = sim.index(sleevePanel, x, 0);
    const seg = nearestBoundarySegment(sim, boundary, ringIndex);
    if (!seg || seg.distSq > SEAM_ATTACH_THRESHOLD * SEAM_ATTACH_THRESHOLD) continue;
    // 두 끝점 모두에 짧게 연결한다(하나의 최근접 정점 하나에만 연결하면,
    // 소매 링(24개)이 몸판 경계 표본(~11개)보다 촘촘해서 여러 링 점이 같은
    // 표본 하나로 한꺼번에 쏠려 뭉치는 문제가 16번 항목에서 이미 실측으로
    // 확인된 바 있다 — 두 끝점에 걸치면 사실상 그 선분 위 지점에
    // 삼각측량되듯 자연스럽게 분산된다).
    sim.addConstraint(ringIndex, seg.a, SEAM_CONSTRAINT_REST_LENGTH);
    sim.addConstraint(ringIndex, seg.b, SEAM_CONSTRAINT_REST_LENGTH);
  }
}

// 이 거리보다 먼 소매 링 정점은 재봉 제약을 안 건다 — 몸판이 평평한
// 패널이라 진짜 3D 곡면 어깨를 감쌀 수 없는 한계(17번 항목에서 실측으로
// 확정)는 이 병합으로도 사라지지 않는다: 소매 링의 "몸 바깥쪽을 향한"
// 절반은 애초에 근처에 붙일 몸판 경계 자체가 없다. 억지로 먼 표본에
// 붙이면(예전 PULL_RADIUS를 너무 크게 잡았을 때처럼) 엉뚱한 방향으로
// 세게 당겨져 비틀림/뭉침이 생기므로, 문턱 밖은 재봉하지 않고 소매 자체
// 구조+어깨 표면 스냅(pullShoulderCapToSurface)+캡슐 충돌에 맡겨 자연스럽게
// 드레이프되게 둔다.
const SEAM_ATTACH_THRESHOLD = 0.06;
// 재봉 제약의 목표 간격 — 옆선 시접(SEAM_REST_LENGTH, 6mm)과 같은
// 수준으로 바짝 당겨 붙인다.
const SEAM_CONSTRAINT_REST_LENGTH = 0.006;

// 몸판의 진동둘레(암홀) 가장자리를 겨드랑이(뒤판)→어깨→겨드랑이(앞판)
// 순서로 나열한 파티클 인덱스 목록. 이 순서(뒤판 위로, 앞판 아래로)가
// 실제 3D 공간에서 연속된 폴리라인이 되도록 만든다 — 어깨 핀(row 0)이
// 앞/뒤판이 겹치는 공유 지점이라 이 목록에서 정확히 한 번만 나온다.
function torsoBoundaryIndices(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  x: number,
  armholeStartRow: number,
): number[] {
  const idx: number[] = [];
  for (let y = armholeStartRow; y >= 1; y--) idx.push(sim.index(backPanel, x, y)); // 뒤판
  for (let y = 0; y <= armholeStartRow; y++) idx.push(sim.index(frontPanel, x, y)); // 앞판(어깨 핀 포함)
  return idx;
}

// 소매 링 정점 하나(ringIndex)에서 몸판 경계 폴리라인(boundary, 인덱스
// 목록) 위 가장 가까운 "선분"을 찾아 그 두 끝점 인덱스를 돌려준다. 빌드
// 시점의 현재 위치(sim.positions)를 한 번만 읽어 계산하고, 그 뒤로는 이
// 함수를 다시 부르지 않는다 — 대응 관계 자체가 고정 제약이 되기 때문에
// 매 프레임 다시 찾을 필요가 없다(이전 blendSeamRing과의 핵심 차이).
function nearestBoundarySegment(
  sim: ClothSimulation,
  boundary: number[],
  ringIndex: number,
): { a: number; b: number; distSq: number } | null {
  const px = sim.positions[ringIndex * 3];
  const py = sim.positions[ringIndex * 3 + 1];
  const pz = sim.positions[ringIndex * 3 + 2];

  let best: { a: number; b: number; distSq: number } | null = null;
  for (let i = 0; i < boundary.length - 1; i++) {
    const a = boundary[i];
    const b = boundary[i + 1];
    const ax = sim.positions[a * 3];
    const ay = sim.positions[a * 3 + 1];
    const az = sim.positions[a * 3 + 2];
    const bx = sim.positions[b * 3];
    const by = sim.positions[b * 3 + 1];
    const bz = sim.positions[b * 3 + 2];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const abLenSq = abx * abx + aby * aby + abz * abz || 1e-9;
    let t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    const cz = az + abz * t;
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (!best || distSq < best.distSq) best = { a, b, distSq };
  }
  return best;
}

// 어깨 뼈대(관절)에서 수평으로만 밀어내던 것과 별개로, 실제로는 수직으로도
// 살짝 낮다 — 실측(핀 좌표 반경 8cm 안의 최고 Y를 직접 스캔)해보니 핀 Y가
// 실제 어깨 표면 꼭대기보다 항상 약 1.8cm 낮았다. 사용자가 "옷이 어깨가
// 아니라 가슴에 있다"고 지적한 원인 중 하나였다 — shoulderPin.ts의
// SHOULDER_PIN_LIFT로 고쳤다.
//
// 아래 pullShoulderCapToSurface는 그와는 별개로, 어깨~겨드랑이 구간
// 전체를 매 프레임 실제 마네킹 표면 쪽으로 능동적으로 재보정한다 — 자체
// 충돌을 꺼둔 상태에서 이 구간은 중력만으로도 안쪽으로 처지려는 경향이
// 있어(halfWidthAtRow가 초기 배치를 넓혀도 활성 지지가 없으면 도로
// 좁아짐), 옆선 시접(armholeStartRow부터 시작)이 잡아주기 전까지는 이
// 능동 보정이 필요하다. 30번 병합 이후에도 몸판은 여전히 평평한 패널
// 2장이라(진짜 3D 곡면 메쉬가 아님) 이 보정의 필요성 자체는 그대로다.
const SHOULDER_SURFACE_PUSH = 0.13;
const SHOULDER_SURFACE_PULL_WEIGHT = 0.7;

export function pullShoulderCapToSurface(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  armholeStartRow: number,
  cols: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  bodySurface: ArrayBvhCollision | null,
): void {
  if (!bodySurface) return;
  for (const panel of [frontPanel, backPanel]) {
    for (let y = 1; y <= armholeStartRow; y++) {
      for (let x = 0; x < cols; x++) {
        const i = sim.index(panel, x, y);
        if (sim.pinned[i]) continue;
        const ix = i * 3;
        const px = sim.positions[ix];
        const py = sim.positions[ix + 1];
        const pz = sim.positions[ix + 2];
        const u = x / (cols - 1) - 0.5;
        const outwardSign = u >= 0 ? 1 : -1;
        const qx = px + dirX * outwardSign * SHOULDER_SURFACE_PUSH;
        const qy = py + dirY * outwardSign * SHOULDER_SURFACE_PUSH;
        const qz = pz + dirZ * outwardSign * SHOULDER_SURFACE_PUSH;
        const target = bodySurface.closestSurfacePoint(qx, qy, qz, SURFACE_MARGIN, SURFACE_DETECTION_RADIUS);
        if (!target) continue;
        sim.positions[ix] = px + (target.x - px) * SHOULDER_SURFACE_PULL_WEIGHT;
        sim.positions[ix + 1] = py + (target.y - py) * SHOULDER_SURFACE_PULL_WEIGHT;
        sim.positions[ix + 2] = pz + (target.z - pz) * SHOULDER_SURFACE_PULL_WEIGHT;
      }
    }
  }
}

// snapToBodySurface: 마네킹 표면과 옷감 사이 여유(원단 두께 근사) — 몸판
// 충돌(COLLISION_MARGIN=0.015)과 비슷한 수준으로 잡는다.
const SURFACE_MARGIN = 0.012;
const SURFACE_DETECTION_RADIUS = 0.1;
