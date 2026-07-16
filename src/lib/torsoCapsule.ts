import * as THREE from "three";

export interface Capsule {
  top: { x: number; y: number; z: number };
  bottom: { x: number; y: number; z: number };
  radius: number;
}

const scratchAP = new THREE.Vector3();

// 캡슐 충돌 하나만으로는 인접 열의 "순서"를 보존할 방법이 없다 — 각
// 파티클을 이웃과 무관하게 독립적으로, 그것도 목표 지점까지 단번에
// 스냅시키기 때문에, 목선처럼 열 간격이 좁은 구간에서 이웃한 두 열이
// 한 번의 충돌 계산 만에 서로를 앞질러 자리를 바꿔버릴 수 있다(실측으로
// 확인: 캡슐 축 기준 각도조차 열 순서와 어긋남 — 반지름을 아무리
// 조정해도 재현됨). 구조 제약(이웃 거리 유지)은 "거리"만 볼 뿐 "순서"는
// 모르므로, 한 번 순서가 뒤바뀌면 그 상태로도 거리 조건은 만족될 수 있어
// 스스로 못 풀린다. 목표 지점까지 한 번에 스냅하지 않고 일부만
// 이동시키면(under-relaxation), 구조 제약이 매 반복마다 그만큼 더 저항할
// 기회를 얻어 순서 역전이 애초에 잘 일어나지 않는다 — 자체충돌(꺼둠) 없이
// 이 문제를 완화하는 값싼 방법이다.
const PUSH_RELAXATION = 0.35;

// "웹 최적화 게임형" 아키텍처: 실제 마네킹 메시(Xbot 스킨/BVH)와 충돌 검사를
// 하는 대신, 가슴/골반에 맞춘 캡슐 2개로 몸통을 아주 거칠게 근사해서
// 그것과만 충돌한다. 정밀한 굴곡 표현은 포기하지만, 그 대신
// - BVH 탐색이 없어 충돌 비용이 파티클당 O(캡슐 수)로 고정되고
// - "탐지 반경 밖이라 못 찾음" 문제 자체가 없어(거리 임계값이 없으므로)
// 메시 폭발이나 파티클이 몸속에 갇히는 수치 불안정이 구조적으로 발생하지
// 않는다. 실제 몸 굴곡 대신 "그럴듯한 드레이핑"을 60fps로 안정적으로
// 보여주는 게 목표라 이 트레이드오프를 받아들인다.
// margin: 캡슐 표면(반지름 r)에서 얼마나 더 띄워 놓을지(옷감 두께
// 근사치). 캡슐 반경 자체는 몸통 굵기를 나타내므로, 실제 충돌/밀어내기
// 판정 반지름은 r + margin이다.
//
// clothPhysics.ts의 CollisionResolver 타입과 시그니처가 같지만 팩토리로
// 감싸지 않고 평범한 함수로 둔다 — capsules 배열이 몸 실측이 바뀔 때마다
// 통째로 교체되는데, 매 반복(step()의 iterations × substeps × 60fps)마다
// 새 클로저를 만들면서 그 배열을 캡처하면 불필요한 할당이 쌓인다. 호출부
// (clothWorker.ts)에서 최신 capsules를 직접 넘기면 그럴 필요가 없다.
// 37번: 어깨 캡(목선 상승부) 구간은 pullShoulderCapToSurface가 매 프레임
// "핀 쪽으로 넓게/높게 유지" 목표를 직접 관리하도록 이미 설계돼 있는데
// (bvhFromArrays.ts의 메시 충돌 리졸버는 33번에서 이 구간을 건너뛰게
// 고쳤다), 이 캡슐 충돌은 그 스킵 대상에서 빠져 있었다 — 몸통 전체를
// 뭉뚱그린 거친 캡슐이 이 구간에도 여전히 매 반복 적용돼, 방금 목선을
// 위로 끌어올린 결과를 다시 캡슐 표면 쪽으로 끌어내리며 경쟁하고
// 있었다(실측: 어깨-목 전환부 근처 열에서 0번-1번 행 사이 수직 간격이
// 정상보다 훨씬 크게 벌어져 그 틈으로 마네킹이 비쳐 보임 — 메시 충돌
// 리졸버만 스킵하고 캡슐 충돌은 안 건너뛴 게 원인이었다). 메시 충돌과
// 똑같은 스킵 구간을 여기도 적용한다.
export function applyCapsuleCollision(
  positions: Float32Array,
  pinned: Uint8Array,
  n: number,
  capsules: readonly Capsule[],
  margin: number,
  skipLocalStart?: number,
  skipLocalEndExclusive?: number,
): void {
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    if (skipLocalStart !== undefined && skipLocalEndExclusive !== undefined && i >= skipLocalStart && i < skipLocalEndExclusive) {
      continue;
    }
    const ix = i * 3;

    for (const capsule of capsules) {
      const a = capsule.top;
      const b = capsule.bottom;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const abLenSq = abx * abx + aby * aby + abz * abz;
      const r = capsule.radius + margin;

      scratchAP.set(positions[ix] - a.x, positions[ix + 1] - a.y, positions[ix + 2] - a.z);
      const t =
        abLenSq > 1e-9
          ? THREE.MathUtils.clamp((scratchAP.x * abx + scratchAP.y * aby + scratchAP.z * abz) / abLenSq, 0, 1)
          : 0;
      const cx = a.x + abx * t;
      const cy = a.y + aby * t;
      const cz = a.z + abz * t;
      const dx = positions[ix] - cx;
      const dy = positions[ix + 1] - cy;
      const dz = positions[ix + 2] - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= r * r) continue;

      const dist = Math.sqrt(distSq) || 1e-6;
      const scale = r / dist;
      const targetX = cx + dx * scale;
      const targetY = cy + dy * scale;
      const targetZ = cz + dz * scale;
      positions[ix] += (targetX - positions[ix]) * PUSH_RELAXATION;
      positions[ix + 1] += (targetY - positions[ix + 1]) * PUSH_RELAXATION;
      positions[ix + 2] += (targetZ - positions[ix + 2]) * PUSH_RELAXATION;
    }
  }
}

// 앞판/뒤판이 서로 반대쪽(centerZ 기준 +/-)에 남아있도록 강제하는 값싼
// 안전장치. 원기둥형 캡슐은 "앞/뒤" 구분 없이 중심선에서 먼 쪽으로만
// 밀어내므로, 자체충돌(self-collision, 성능을 위해 꺼둠)이 없으면 어느
// 한쪽 패널이 순간적으로 중심선을 넘어가도 캡슐이 그걸 되돌려 놓을
// 방법이 없다 — 실측으로 확인: 앞판 전체가 뒤판과 완전히 자리를 바꿔
// (앞판 Z가 음수, 뒤판 Z가 양수) 옷이 짧고 뒤틀려 보이는 원인이었다.
// 페어 비교가 필요한 자체충돌과 달리 각 파티클을 중심 Z 평면과만
// 비교하면 되므로 O(n)으로 충분하다. 간격을 아주 좁게(수 mm) 두는 이유는
// 옆선 시접(SEAM_REST_LENGTH=6mm)과 정면 충돌하지 않게 하기 위함 —
// "완전히 반대쪽에 있어야 한다"는 것만 보장하고, 세밀한 겹침 방지는
// 여전히 옆선 제약에 맡긴다.
export function applyFrontBackSidedness(
  positions: Float32Array,
  pinned: Uint8Array,
  particlesPerPanel: number,
  centerZ: number,
  minHalfGap = 0.001,
): void {
  const frontMinZ = centerZ + minHalfGap;
  for (let i = 0; i < particlesPerPanel; i++) {
    if (pinned[i]) continue;
    const iz = i * 3 + 2;
    if (positions[iz] < frontMinZ) positions[iz] = frontMinZ;
  }
  const backMaxZ = centerZ - minHalfGap;
  for (let i = particlesPerPanel; i < particlesPerPanel * 2; i++) {
    if (pinned[i]) continue;
    const iz = i * 3 + 2;
    if (positions[iz] > backMaxZ) positions[iz] = backMaxZ;
  }
}

// 몸 실측(키/가슴둘레)과 어깨 뼈 월드 좌표만으로 가슴/골반 캡슐 2개를
// 만든다. 실제 뼈대 메시를 굽지 않으므로 살아있는 Object3D 없이도 계산
// 가능하다. 골반 둘레 슬라이더가 없어 가슴둘레를 그대로 재사용한다 —
// 정밀한 체형 표현이 아니라 "몸통이 있다"는 정도만 알려주는 안전망이므로
// 충분하다.
//
// 어깨를 가로지르는 별도의 수평 캡슐은 일부러 넣지 않는다 — 시도해봤지만
// 상단 핀(옷깃 라인이 바로 이 캡슐 중심선 위에 고정됨)과 반경이 훨씬 큰
// 가슴 캡슐이 같은 높이(topY)에서 만나면서, 핀 바로 아래에서 "가는 목
// 튜브 → 굵은 가슴 튜브"로 반지름이 급격히 튀어 옷이 어깨선에서 조여
// 묶인 것처럼 쪼글쪼글해지는 아티팩트가 실측으로 확인됐다. 상단 핀이
// 이미 실제 어깨 뼈 위치에 고정돼 있어 "옷이 어깨에 걸쳐지는" 모양은
// 핀 자체와 중력만으로 충분히 나온다.
export function buildTorsoProxyCapsules(
  leftShoulder: { x: number; y: number; z: number },
  rightShoulder: { x: number; y: number; z: number },
  heightM: number,
  chestM: number,
): { capsules: Capsule[]; centerZ: number } {
  const centerX = (leftShoulder.x + rightShoulder.x) / 2;
  const centerZ = (leftShoulder.z + rightShoulder.z) / 2;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const torsoHeight = heightM * 0.35; // 어깨~골반 대략치
  const chestBottomY = shoulderY - torsoHeight * 0.45;
  const pelvisBottomY = shoulderY - torsoHeight;
  // 캡슐의 "끝점"(top/bottom)은 원기둥 옆면이 아니라 반구 캡으로 마감된다
  // (점-선분 최근접점 계산에서 t가 [0,1]로 클램프되므로, 끝점 근처에서는
  // "선분에서 가장 가까운 점"이 아니라 "끝점 자체에서 가장 가까운 점"이
  // 된다). 목선 핀이 캡슐 상단 바로 근처에 있으면, 옷감이 이 둥근 캡을
  // 타고 넘어가면서 위로 봉긋 솟았다가 다시 내려오는 모양이 되어 그만큼
  // 총장을 까먹는 문제가 실측으로 확인됐다(어깨선 바로 아래 열이 핀보다
  // 오히려 더 높이 올라갔다가 한참 뒤에야 다시 처지기 시작함). 캡슐
  // 상단을 옷감이 절대 닿지 않을 만큼 충분히 위(어깨보다 훨씬 높이)로
  // 잡아, 목선 핀과 그 아래 모든 행이 항상 원기둥 "옆면"만 만나고 이
  // 반구 캡에는 닿지 않게 한다.
  const topY = shoulderY + 0.3;
  // 가슴둘레를 원 둘레 공식(C/2π)으로 그대로 쓴다. 한때 실제 앞/뒤 두께
  // 근사치로 줄여보려 했지만(0.75배), 그러면 반지름이 패널의 절반 폭(품의
  // 1/4에 가까움)보다 작아져서 문제가 생긴다 — 캡슐 충돌은 각 파티클을
  // 축에서 뻗어나가는 방향 그대로(각도 보존 없이) 반지름 위치로 밀어낼
  // 뿐이라, 평평했을 때 폭이 90도 감기는 호 길이보다 넓으면 바깥쪽 열들이
  // 안쪽 열보다 더 안쪽으로 밀리는 순서 역전이 생겨 그물이 스스로 꼬이는
  // 현상이 실측으로 확인됐다(인접 열의 X좌표가 들쭉날쭉). 원 둘레 공식
  // 그대로의 반지름이 패널 반폭(사분원 호 길이 기준)과 대략 맞아떨어져
  // 이 꼬임을 피한다.
  const chestRadius = chestM / (2 * Math.PI);

  const capsules: Capsule[] = [
    {
      top: { x: centerX, y: topY, z: centerZ },
      bottom: { x: centerX, y: chestBottomY, z: centerZ },
      radius: chestRadius,
    },
    {
      top: { x: centerX, y: chestBottomY, z: centerZ },
      bottom: { x: centerX, y: pelvisBottomY, z: centerZ },
      radius: chestRadius * 0.95,
    },
  ];
  return { capsules, centerZ };
}
