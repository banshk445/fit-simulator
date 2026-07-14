import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_BODY_SIZE, useFitStore } from "../store/useFitStore";
import { mannequinRootRef } from "../lib/mannequinRef";
import { isBone, isDescendantOfAny } from "../lib/boneUtils";

// public/models/mannequin.glb — Adobe Fuse/Mixamo 기반의 맨몸 남성 캐릭터
// ("Ch36")를 T포즈로 내려받아 Blender로 glTF 변환한 파일. 단일 메시라
// Remy처럼 옷 아래에 몸통이 안 뚫려 있는(구멍 없는) 게 확인돼 골랐다 —
// 자세한 경위는 public/models/CREDITS.md 참고.
//
// 절대 경로("/models/...")로 하드코딩했더니 Electron 데스크톱 앱(프로덕션
// 빌드를 file:// 프로토콜로 직접 여는 방식)에서 이 경로가 사이트 루트가
// 아니라 파일시스템 루트를 가리켜버려 모델을 못 찾고(Failed to fetch)
// 마네킹은 물론 옷까지 아무것도 안 그려져 화면이 완전히 검게 보이는
// 문제가 실측(패키징된 앱을 터미널에서 직접 실행해 렌더러 콘솔 로그
// 확인)으로 드러났다 — `import.meta.env.BASE_URL`을 쓰면 vite.config.ts의
// `base` 설정(웹 배포용 "/"든 Electron용 "./"든)에 맞춰 항상 올바르게
// 해석된다.
export const MODEL_URL = `${import.meta.env.BASE_URL}models/mannequin.glb`;

// 헬멧 바이저처럼 중립적인 마네킹 형태에 맞지 않는 메시나, "joints"처럼 실제
// 몸 표면과 거의 같은 범위를 겹쳐 덮고 있는 보조 메시는 렌더링에서 숨긴다
// (두 표면이 겹쳐 보이면 Z-파이팅처럼 지저분하게 깜빡인다). 충돌 메시를
// 굽는 StaticGeometryGenerator도 visible=false인 메시는 통째로 건너뛰므로,
// 몸통 자체를 구성하는 메시(예: 옷으로만 덮이고 그 아래 스킨이 없는 형태의
// 캐릭터의 "몸 위에 입혀진 옷" 메시)는 여기 넣지 않도록 주의할 것 — 숨기면
// 그 부분이 충돌 표면 자체가 없는 구멍이 되어 옷이 몸을 그냥 뚫고 지나가
// 버린다(실측으로 확인한 실제 사례가 있다).
const HIDDEN_MESH_KEYWORDS = ["visor", "joints"];

type BoneCategory = "arm" | "leg" | "shoulder";
type Axis = "x" | "y" | "z";

interface ScalableBone {
  bone: THREE.Object3D;
  axis: Axis;
}

// 모델마다 뼈대 이름이 달라도 대응할 수 있도록 이름 기반으로 느슨하게 분류한다.
// ForeArm/UpLeg은 각각 Arm/Leg의 부분 문자열을 포함하므로, 같은 카테고리로
// 합쳐서(팔 = Arm+ForeArm, 다리 = UpLeg+Leg) 인식한다.
//
// 주의: "Armature"(arm 포함), "Legacy"(leg 포함) 같은 비-뼈대 컨테이너 이름도
// 부분 문자열 매칭에 걸릴 수 있다. 그래서 이름 매칭 대상은 실제 THREE.Bone
// 인스턴스로만 제한한다(isBone, isDescendantOfAny는 boneUtils.ts 공용 함수 —
// GarmentCloth.tsx도 어깨 핀 뼈대를 찾을 때 같은 판별 로직을 쓴다).
function classifyBone(name: string): BoneCategory | null {
  const n = name.toLowerCase();
  if (n.includes("shoulder")) return "shoulder";
  if (n.includes("arm")) return "arm";
  if (n.includes("leg")) return "leg";
  return null;
}

// "길이 방향" 축은 모델마다 다를 수 있다 (Soldier.glb는 로컬 Y가 길이 방향이지만
// Xbot.glb는 로컬 X였다 — Y로 하드코딩했다가 팔이 길어지는 대신 두꺼워지는
// 버그가 났었다). 그래서 자식 뼈대의 로컬 위치에서 절대값이 가장 큰 성분의
// 축을 그 뼈대의 "길이 방향"으로 동적으로 판별한다.
function lengthAxis(bone: THREE.Object3D): Axis {
  const child = bone.children.find((c) => isBone(c));
  if (!child) return "y";
  const { x, y, z } = child.position;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return "x";
  if (ay >= ax && ay >= az) return "y";
  return "z";
}

function firstBoneChild(bone: THREE.Object3D): THREE.Object3D | undefined {
  return bone.children.find((c) => isBone(c));
}

// bone에서 child로 향하는 방향을 월드 공간 기준으로 계산한다.
function worldDirection(bone: THREE.Object3D, child: THREE.Object3D): THREE.Vector3 {
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
function pointBoneTowardWorldDirection(
  bone: THREE.Object3D,
  currentDirWorld: THREE.Vector3,
  targetDirWorld: THREE.Vector3,
) {
  const parent = bone.parent;
  if (!parent) return;
  const worldDelta = new THREE.Quaternion().setFromUnitVectors(currentDirWorld, targetDirWorld);
  const parentWorldQuat = new THREE.Quaternion();
  parent.getWorldQuaternion(parentWorldQuat);
  const localDelta = parentWorldQuat.clone().invert().multiply(worldDelta).multiply(parentWorldQuat);
  bone.quaternion.premultiply(localDelta);
}

export function Mannequin() {
  const bodySize = useFitStore((s) => s.bodySize);
  const { scene, nodes } = useGLTF(MODEL_URL) as unknown as {
    scene: THREE.Object3D;
    nodes: Record<string, THREE.Object3D>;
  };
  const outerRef = useRef<THREE.Group>(null);

  // GarmentCloth가 충돌 메시를 구울 때 참조할 수 있도록, 실제 렌더 루트를
  // 공유 모듈에 등록한다.
  useEffect(() => {
    mannequinRootRef.current = outerRef.current;
    return () => {
      mannequinRootRef.current = null;
    };
  }, []);

  // 마네킹처럼 보이도록 원본 텍스처/머티리얼을 무광 회색으로 통일하고,
  // 헬멧 바이저 등 마네킹에 어울리지 않는 파츠는 숨긴다.
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const name = obj.name.toLowerCase();
        if (HIDDEN_MESH_KEYWORDS.some((kw) => name.includes(kw))) {
          obj.visible = false;
          return;
        }
        obj.material = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 });
      }
    });
  }, [scene]);

  // 카테고리별 뼈대를 찾고, 같은 카테고리 안에서 조상-자손 관계인 뼈대는
  // 자손을 제외해 최상단 뼈대 하나에만 스케일을 적용한다 (Arm 하나만 늘려도
  // 하위의 ForeArm/Hand는 계층 구조를 통해 함께 늘어나므로 중복 적용 불필요).
  // 각 최상단 뼈대에는 자식 위치로부터 판별한 길이축도 함께 저장한다.
  const boneGroups = useMemo(() => {
    const grouped: Record<BoneCategory, THREE.Object3D[]> = { arm: [], leg: [], shoulder: [] };
    for (const [name, node] of Object.entries(nodes)) {
      if (!isBone(node)) continue;
      const category = classifyBone(name);
      if (category) grouped[category].push(node);
    }

    const rootsOnly = {} as Record<BoneCategory, ScalableBone[]>;
    for (const category of Object.keys(grouped) as BoneCategory[]) {
      const set = new Set(grouped[category]);
      rootsOnly[category] = grouped[category]
        .filter((node) => !isDescendantOfAny(node, set))
        .map((bone) => ({ bone, axis: lengthAxis(bone) }));
    }
    return rootsOnly;
  }, [nodes]);

  // T-pose(바인드 포즈)는 팔이 수평으로 뻗어 있어 부자연스럽다. 팔 뼈대가
  // 현재 향하고 있는 방향을 측정해서, 완전히 수직(월드 -Y)이 아니라 몸
  // 중심선에서 살짝 바깥쪽으로 벌어진 방향("릴랙스드 A-포즈")을 향하도록
  // 1회만 회전시킨다. 팔을 곧게 내리면 손(특히 손가락)이 배/골반에 딱
  // 붙게 되는데, 옷자락이 그 높이까지 늘어질 때 손가락처럼 얇고 복잡한
  // 형체와 충돌 계산을 해야 해서 그 부분이 찢어진 것처럼 불안정해지는
  // 문제가 실측으로 확인됐다 — 실제 옷 피팅 3D 도구에서도 흔히 A-포즈를
  // 쓰는 이유와 같다. 어깨 뼈의 월드 X 좌표 부호로 좌/우를 판별해 바깥쪽
  // 방향을 정하므로, 모델이 바뀌어도(뼈대 이름과 무관하게) 안전하다.
  useEffect(() => {
    const shoulderPos = new THREE.Vector3();
    for (const { bone } of boneGroups.arm) {
      const child = firstBoneChild(bone);
      if (!child) continue;
      const currentDir = worldDirection(bone, child);
      bone.getWorldPosition(shoulderPos);
      const sign = Math.sign(shoulderPos.x) || 1;
      // 실측 결과 0.3(약 17˚)로는 부족했다 — 손이 여전히 옷자락이 닿는
      // 높이를 스쳐 지나가며 충돌 메시에 토르소 표면과 겹치는 애매한 이중
      // 표면을 만들었다(같은 높이·각도에서 반지름이 크게 다른 두 표면이
      // 잡히는 것을 raycasting으로 확인). 0.6(약 31˚)까지 벌려 손을 토르소
      // 반경 밖으로 확실히 뺀다.
      const outwardDown = new THREE.Vector3(sign * 0.6, -1, 0).normalize();
      pointBoneTowardWorldDirection(bone, currentDir, outwardDown);
    }
  }, [boneGroups]);

  // 소스 파일마다 단위가 다를 수 있다(m, cm, inch...) — 원본 바운딩 박스
  // 높이를 재서 기준 신장(DEFAULT_BODY_SIZE.height)에 맞도록 스케일을 자동
  // 보정한다. 이미 미터 단위인 파일(Xbot)은 비율이 1에 가까워 실질적인
  // 영향이 없고, cm 단위 파일은 자동으로 1/100로 줄어든다 — 모델을 바꿀
  // 때마다 단위를 직접 확인/하드코딩할 필요가 없다.
  const { groundOffsetY, unitScale } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const rawHeight = box.max.y - box.min.y;
    const targetHeight = DEFAULT_BODY_SIZE.height / 100;
    const scale = rawHeight > 0.001 ? targetHeight / rawHeight : 1;
    return { groundOffsetY: -box.min.y * scale, unitScale: scale };
  }, [scene]);

  // 위에서 계산한 단위 보정 스케일을 실제로 적용한다. groundOffsetY(발이
  // 바닥에 닿는 오프셋)도 마운트 시 1회만 측정해 고정값으로 쓴다 — 동적
  // 다리 길이 변화까지 실시간으로 접지 보정하지는 않는다.
  useEffect(() => {
    scene.scale.setScalar(unitScale);
  }, [scene, unitScale]);

  useFrame((_, delta) => {
    const outer = outerRef.current;
    if (!outer) return;
    const t = 1 - Math.pow(0.001, delta);

    const heightMultiplier = bodySize.height / DEFAULT_BODY_SIZE.height;
    const armMultiplier = bodySize.armLength / DEFAULT_BODY_SIZE.armLength;
    const legMultiplier = bodySize.legLength / DEFAULT_BODY_SIZE.legLength;
    const shoulderMultiplier = bodySize.shoulderWidth / DEFAULT_BODY_SIZE.shoulderWidth;

    const s = THREE.MathUtils.lerp(outer.scale.x, heightMultiplier, t);
    outer.scale.setScalar(s);

    for (const { bone, axis } of boneGroups.arm) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], armMultiplier, t);
    }
    for (const { bone, axis } of boneGroups.leg) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], legMultiplier, t);
    }
    for (const { bone, axis } of boneGroups.shoulder) {
      bone.scale[axis] = THREE.MathUtils.lerp(bone.scale[axis], shoulderMultiplier, t);
    }
  });

  return (
    <group ref={outerRef}>
      <group position={[0, groundOffsetY, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
