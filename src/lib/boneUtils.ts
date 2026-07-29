import * as THREE from "three";

// 모델마다 뼈대 이름 규칙이 다르다(콜론 유무, 숫자 접미사 등 — 예:
// "mixamorigLeftArm" vs "mixamorig:LeftArm_09"). 정확한 키 문자열에 기대지
// 않고, 실제 THREE.Bone 인스턴스인지 + 이름에 부분 문자열이 포함되는지로만
// 판별해야 어떤 모델을 끼워도 안전하다.
export function isBone(node: THREE.Object3D): boolean {
  return (node as THREE.Bone).isBone === true;
}

export function isDescendantOfAny(node: THREE.Object3D, candidates: Set<THREE.Object3D>): boolean {
  let p = node.parent;
  while (p) {
    if (candidates.has(p)) return true;
    p = p.parent;
  }
  return false;
}

// 이름에 "arm"이 들어가는 실제 Bone을 모으고(위팔+아래팔 다 걸리지만),
// 같은 집합 안에서 조상뻘인 뼈대의 자손은 제외해 각 팔의 최상단(어깨에
// 가장 가까운, 보통 위팔) 뼈대만 남긴다. 정상적인 인체 리그라면 좌우 팔
// 각각 하나씩, 총 2개가 나온다.
export function findArmRootBones(nodes: Record<string, THREE.Object3D>): THREE.Object3D[] {
  const armBones: THREE.Object3D[] = [];
  for (const node of Object.values(nodes)) {
    if (!isBone(node)) continue;
    if (node.name.toLowerCase().includes("arm")) armBones.push(node);
  }
  const set = new Set(armBones);
  return armBones.filter((node) => !isDescendantOfAny(node, set));
}

// armRoot(어깨~위팔)에서 자식 방향으로 내려가며 이름에 "hand"가 들어간
// 첫 뼈대(손가락 이전, 손목 대표 뼈대)를 찾는다. 못 찾으면 체인 맨 끝
// (더 이상 자식 뼈대가 없는 지점, 보통 손끝)을 대신 쓴다. 긴팔 소매
// 길이를 실제 팔 길이(어깨~손목)에 맞추는 데도 재사용한다.
export function findHandBone(armRoot: THREE.Object3D): THREE.Object3D {
  let current = armRoot;
  while (true) {
    if (current.name.toLowerCase().includes("hand")) return current;
    const child = current.children.find((c) => isBone(c));
    if (!child) return current;
    current = child;
  }
}

// 팔 배제 선분의 시작점을 어깨 관절(팔 뼈대 자체)에서 손 방향으로 이만큼
// 안쪽으로 당겨 잡는다. 옷의 어깨 핀(findShoulderBones)은 이 관절 위치에
// 그대로 고정되는데, 배제 선분을 관절에서 그대로 시작하면 반경
// ARM_EXCLUDE_RADIUS(9cm)짜리 구가 어깨 관절을 통째로 감싸버려 목선 바로
// 옆(어깨 캡/삼각근 부위) 몸통 표면까지 충돌 메시에서 통째로 잘려나간다 —
// 그 결과 목선 옆쪽 옷감이 기댈 표면이 전혀 없어 핀에서부터 상당한 거리를
// 지지 없이 늘어지다가 한참 아래(팔이 몸통과 확실히 벌어지는 지점)에야
// 몸통에 닿는 현상이 실측(파티클 Y좌표 직접 대조)으로 확인됐다 — 이게
// "목선이 헐렁하게 벌어져 보이는" 문제의 실제 원인이었다(옷감 처짐이나
// 목선 파임 치수 문제가 아니었다). 시작점을 손 쪽으로 당기면 어깨
// 캡/삼각근 부위는 계속 충돌 표면으로 남아 목선 옆 옷감이 핀 바로 아래에서
// 부터 몸에 기댈 수 있고, 실제 팔(당겨진 시작점부터 손까지)은 여전히
// 배제되어 소매 없는 옷이 팔에 들러붙는 문제도 그대로 막는다.
const ARM_EXCLUDE_START_INSET = 0.07;

// 머리 뼈대(이름에 "head" 포함)의 월드 위치를 구한다. 어깨-소매 이음매
// 스냅(garmentStitch.ts의 snapToBodySurface)이 쓰는 wholeBodyIndex(팔
// 배제가 없는 원본 몸통 인덱스)에서 머리 삼각형을 잘라내는 데 쓴다 —
// scene을 직접 순회해 뼈대를 모으므로 findArmSegments와 마찬가지로
// nodes 딕셔너리가 없는 meshCollision.ts에서도 바로 쓸 수 있다.
export function findHeadPosition(root: THREE.Object3D): THREE.Vector3 | null {
  let headBone: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (headBone) return;
    if (isBone(obj) && obj.name.toLowerCase().includes("head")) headBone = obj;
  });
  if (!headBone) return null;
  (headBone as THREE.Object3D).updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  (headBone as THREE.Object3D).getWorldPosition(pos);
  return pos;
}

// 옷에 소매가 없어 팔과는 충돌할 필요가 없는데, 몸통 표면과 팔 표면이
// 옷자락 높이에서 가까이 겹쳐 있으면 "가장 가까운 표면"이 프레임마다
// 오락가락해 찢어진 것처럼 보이는 아티팩트가 생긴다(실측으로 확인).
// 각 팔을 어깨~손 사이의 선분(캡슐)으로 근사해서, 충돌 메시를 구운 뒤
// 이 선분 근처 삼각형을 걸러내는 데 쓴다. scene을 직접 순회해 뼈대를
// 모으므로(nodes 딕셔너리가 없는 meshCollision.ts에서도) 바로 쓸 수 있다.
export function findArmSegments(root: THREE.Object3D): Array<{ start: THREE.Vector3; end: THREE.Vector3 }> {
  const nodes: Record<string, THREE.Object3D> = {};
  root.traverse((obj) => {
    if (isBone(obj)) nodes[obj.uuid] = obj;
  });
  const armRoots = findArmRootBones(nodes);
  return armRoots.map((armRoot) => {
    const hand = findHandBone(armRoot);
    armRoot.updateWorldMatrix(true, false);
    hand.updateWorldMatrix(true, false);
    const shoulder = new THREE.Vector3();
    const end = new THREE.Vector3();
    armRoot.getWorldPosition(shoulder);
    hand.getWorldPosition(end);
    const armLength = shoulder.distanceTo(end);
    const inset = armLength > 1e-6 ? Math.min(ARM_EXCLUDE_START_INSET / armLength, 0.9) : 0;
    const start = shoulder.clone().lerp(end, inset);
    return { start, end };
  });
}

// 어깨 뼈대에서 팔이 뻗어나가는 방향(단위 벡터, 월드 좌표)을 구한다.
// 소매가 이 방향을 따라 늘어지도록 원통 축을 잡는 데 쓴다. 처음엔 어깨의
// "바로 아래 자식 뼈대" 하나만 보면 충분할 거라 가정했는데, 실측해보니
// (마네킹 자세는 분명 수평에 가까운 T포즈인데 계산된 방향이 아래로 60도
// 가까이 꺾여 있었다) 이 리그는 바로 아래 자식이 실제 팔 진행 방향과
// 다른 보조 뼈대(트위스트/롤 뼈대 등)일 수 있다는 게 드러났다 — 뼈대
// 이름 규칙에 기대지 않고 계층 구조 첫 자식만 믿은 게 원인이었다. 체인
// 끝(손, findHandBone)까지 내려가 실제 손 위치로 방향을 잡으면 중간에
// 어떤 보조 뼈대가 끼어 있든 항상 해부학적으로 맞는 방향이 나온다.
export function findArmDirection(armRoot: THREE.Object3D): THREE.Vector3 {
  const hand = findHandBone(armRoot);
  const shoulder = new THREE.Vector3();
  armRoot.updateWorldMatrix(true, false);
  armRoot.getWorldPosition(shoulder);
  hand.updateWorldMatrix(true, false);
  const childPos = new THREE.Vector3();
  hand.getWorldPosition(childPos);
  const dir = childPos.sub(shoulder);
  return dir.lengthSq() > 1e-9 ? dir.normalize() : new THREE.Vector3(0, -1, 0);
}

// findHandBone과 같은 방식으로 체인을 내려가되, 이름에 "forearm"이 들어간
// 첫 뼈대(아래팔 시작 = 팔꿈치)에서 멈춘다. 못 찾으면 손 뼈대로 폴백한다
// (Mixamo가 아닌 다른 리그라도 최소한 크래시 없이 예전 동작으로 돌아간다).
export function findElbowBone(armRoot: THREE.Object3D): THREE.Object3D {
  let current = armRoot;
  while (true) {
    if (current !== armRoot && current.name.toLowerCase().includes("forearm")) return current;
    if (current.name.toLowerCase().includes("hand")) return current;
    const child = current.children.find((c) => isBone(c));
    if (!child) return current;
    current = child;
  }
}

// 33번: 반팔은 위팔(어깨~팔꿈치)만 덮으므로, 이 구간의 실제 방향을 축으로
// 써야 한다. findArmDirection(어깨→손)은 애초에 "몇몇 리그는 어깨 바로
// 아래 자식이 트위스트 뼈대라 방향이 틀어진다"는 문제 때문에 손까지
// 내려가도록 설계됐는데(위 주석 참고), 이 마네킹처럼 팔꿈치가 굽어있는
// 포즈에서는 어깨→손 직선이 위팔 구간의 실제 방향과 상당히 어긋난다(실측:
// 어깨→손 벡터가 수평에서 56도나 꺾여 있었는데, 실제 위팔은 훨씬 수평에
// 가까웠다) — 반팔 소매가 위팔 겉면을 따라가지 못하고 팔꿈치 쪽을 향해
// 대각선으로 삐져나가, 어깨에서 뚝 떨어진 뭉툭한 쐐기처럼 보이는 문제의
// 원인이었다. 긴팔은 손목까지 닿아야 하므로 기존 findArmDirection을 그대로
// 쓴다(이미 극단값 테스트로 검증된 동작이라 건드리지 않는다).
export function findShortSleeveDirection(armRoot: THREE.Object3D): THREE.Vector3 {
  const elbow = findElbowBone(armRoot);
  const shoulder = new THREE.Vector3();
  armRoot.updateWorldMatrix(true, false);
  armRoot.getWorldPosition(shoulder);
  elbow.updateWorldMatrix(true, false);
  const childPos = new THREE.Vector3();
  elbow.getWorldPosition(childPos);
  const dir = childPos.sub(shoulder);
  return dir.lengthSq() > 1e-9 ? dir.normalize() : findArmDirection(armRoot);
}

// 옷감의 어깨 핀으로 쓸 두 팔 최상단 뼈대를 월드 X 좌표 부호로 나눈다 —
// 뼈대 이름("Left"/"Right" 등)에 기대지 않으므로 이름 규칙이 다른 모델도
// 그대로 동작한다. 어느 쪽을 "left"/"right"라 부르는지는 중요하지 않고,
// 매 프레임 같은 두 뼈대를 일관되게 가리키기만 하면 된다.
export function findShoulderBones(nodes: Record<string, THREE.Object3D>): {
  left: THREE.Object3D | null;
  right: THREE.Object3D | null;
} {
  const armBones = findArmRootBones(nodes);
  if (armBones.length === 0) return { left: null, right: null };
  if (armBones.length === 1) return { left: armBones[0], right: armBones[0] };

  const pos = new THREE.Vector3();
  const withX = armBones.map((bone) => {
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(pos);
    return { bone, x: pos.x };
  });
  withX.sort((a, b) => b.x - a.x);
  return { left: withX[0].bone, right: withX[withX.length - 1].bone };
}

// bone에서 child로 향하는 방향을 월드 공간 기준으로 계산한다.
export function worldDirection(bone: THREE.Object3D, child: THREE.Object3D): THREE.Vector3 {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const bonePos = new THREE.Vector3();
  const childPos = new THREE.Vector3();
  bone.getWorldPosition(bonePos);
  child.getWorldPosition(childPos);
  return childPos.sub(bonePos).normalize();
}

// bone이 현재 currentDirWorld를 가리키고 있는데, 대신 targetDirWorld를
// 가리키도록 회전시킨다. bone.quaternion은 부모 로컬 공간 기준이므로,
// 월드 공간 회전량을 부모의 월드 회전으로 컨쥬게이트해 로컬 공간으로 변환한다.
export function pointBoneTowardWorldDirection(
  bone: THREE.Object3D,
  currentDirWorld: THREE.Vector3,
  targetDirWorld: THREE.Vector3,
) {
  const parent = bone.parent;
  if (!parent) return;
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(currentDirWorld, targetDirWorld);
  const parentWorldQuat = new THREE.Quaternion();
  parent.getWorldQuaternion(parentWorldQuat);
  // **정규화가 필수다.** getWorldQuaternion은 부모 월드 행렬을 분해해서
  // 회전을 뽑는데, 조상 중에 비균등 스케일이 있고 그 아래에 회전이 섞이면
  // (가슴둘레 슬라이더가 몸통 본에 축별로 다른 스케일을 건다) 분해 결과가
  // 순수 회전이 아니라 크기가 1이 아닌 쿼터니언이 된다. 이 함수는 매
  // 프레임 호출돼 bone.quaternion에 **누적 곱**을 하므로, 1이 아닌 크기가
  // 프레임마다 복리로 곱해져 지수로 발산한다.
  //
  // 실측(2026-07-29): 가슴 100(스케일 정확히 1)에서는 멀쩡하고, 101만
  // 돼도 25초 뒤 팔 정점 6,172개(전체의 38.9%)가 Float32 포화값(3.4e38)이
  // 됐다. 가슴이 클수록 발산이 빨랐다(102는 3초에 이미 Y가 8.4까지).
  // 화면에서는 마네킹 팔이 사라지고, 구운 충돌 메시가 손상돼 옷이 몸에서
  // 떨어졌다. check:demo가 이 상황을 재현해 지킨다.
  parentWorldQuat.normalize();
  const localDelta = parentWorldQuat.clone().invert().multiply(worldDelta).multiply(parentWorldQuat);
  bone.quaternion.premultiply(localDelta).normalize();
}
