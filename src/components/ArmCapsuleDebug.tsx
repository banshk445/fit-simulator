import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { findArmDirection, findShortSleeveDirection, findShoulderBones } from "../lib/boneUtils";
import { ARM_COLLISION_RADIUS } from "../lib/clothConfig";
import { MODEL_URL } from "./Mannequin";

// 47번(디버그 전용 시각화 — 물리/렌더링 경로는 건드리지 않음): garmentWorker.ts의
// buildArmCapsules와 정확히 같은 공식(어깨→55% 지점→125% 지점, 반지름
// ARM_COLLISION_RADIUS)을 별도로 복제해 와이어프레임으로 그린다 — 실제
// 충돌 계산에 쓰이는 값이 아니라 순수 시각적 검증용이므로, garmentWorker와
// 로직이 갈라져도 물리 결과에는 영향이 없다(다만 두 곳을 계속 맞춰야
// 시각화가 실제 충돌체와 일치한다).
const shoulderVec = new THREE.Vector3();
const rightShoulderVec = new THREE.Vector3();
const leftDirVec = new THREE.Vector3();
const rightDirVec = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const midPoint = new THREE.Vector3();
const segDir = new THREE.Vector3();
const leftMidVec = new THREE.Vector3();
const leftEndVec = new THREE.Vector3();
const rightMidVec = new THREE.Vector3();
const rightEndVec = new THREE.Vector3();

interface SegmentRefs {
  cylinder: THREE.Mesh | null;
  sphereTop: THREE.Mesh | null;
  sphereBottom: THREE.Mesh | null;
}

function updateSegment(refs: SegmentRefs, top: THREE.Vector3, bottom: THREE.Vector3) {
  const { cylinder, sphereTop, sphereBottom } = refs;
  if (!cylinder || !sphereTop || !sphereBottom) return;

  sphereTop.position.copy(top);
  sphereBottom.position.copy(bottom);

  segDir.subVectors(bottom, top);
  const length = segDir.length();
  midPoint.copy(top).addScaledVector(segDir, 0.5);
  cylinder.position.copy(midPoint);
  cylinder.scale.set(1, length, 1);
  if (length > 1e-6) {
    segDir.normalize();
    cylinder.quaternion.setFromUnitVectors(UP_AXIS, segDir);
  }
}

const RED_WIREFRAME = { color: 0xff0000, wireframe: true, depthTest: false } as const;

// 세그먼트 4개(왼팔 2 + 오른팔 2) × 파트 3개(원기둥+구 2개)를 고정 배열로
// 미리 만들어, ref 콜백으로 직접 채운다 — 렌더 단계에서 캡처한 ref는
// 아직 마운트 전이라 항상 null이므로, 콜백 방식으로 마운트 시점의 실제
// 인스턴스를 받는다.
const SEGMENT_COUNT = 4;

export function ArmCapsuleDebug() {
  const { nodes } = useGLTF(MODEL_URL) as unknown as { nodes: Record<string, THREE.Object3D> };
  const shoulderBones = useMemo(() => findShoulderBones(nodes), [nodes]);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const sleeveType = useFitStore((s) => s.sleeveType);

  const segmentRefsArr = useRef<SegmentRefs[]>(
    Array.from({ length: SEGMENT_COUNT }, () => ({ cylinder: null, sphereTop: null, sphereBottom: null })),
  );

  useFrame(() => {
    const { left: leftBone, right: rightBone } = shoulderBones;
    if (!leftBone || !rightBone) return;

    leftBone.updateWorldMatrix(true, false);
    rightBone.updateWorldMatrix(true, false);
    leftBone.getWorldPosition(shoulderVec);
    rightBone.getWorldPosition(rightShoulderVec);

    if (sleeveType === "long") {
      leftDirVec.copy(findArmDirection(leftBone));
      rightDirVec.copy(findArmDirection(rightBone));
    } else {
      leftDirVec.copy(findShortSleeveDirection(leftBone));
      rightDirVec.copy(findShortSleeveDirection(rightBone));
    }

    const length = garmentSize.sleeveLength / 100;
    const midLength = length * 0.55;
    const endLength = length * 1.25;

    const [leftSeg0, leftSeg1, rightSeg0, rightSeg1] = segmentRefsArr.current;

    leftMidVec.copy(shoulderVec).addScaledVector(leftDirVec, midLength);
    leftEndVec.copy(shoulderVec).addScaledVector(leftDirVec, endLength);
    updateSegment(leftSeg0, shoulderVec, leftMidVec);
    updateSegment(leftSeg1, leftMidVec, leftEndVec);

    rightMidVec.copy(rightShoulderVec).addScaledVector(rightDirVec, midLength);
    rightEndVec.copy(rightShoulderVec).addScaledVector(rightDirVec, endLength);
    updateSegment(rightSeg0, rightShoulderVec, rightMidVec);
    updateSegment(rightSeg1, rightMidVec, rightEndVec);
  });

  return (
    <>
      {segmentRefsArr.current.map((_, i) => (
        <group key={i}>
          <mesh
            ref={(el) => {
              segmentRefsArr.current[i].cylinder = el;
            }}
            renderOrder={999}
          >
            <cylinderGeometry args={[ARM_COLLISION_RADIUS, ARM_COLLISION_RADIUS, 1, 12, 1, true]} />
            <meshBasicMaterial {...RED_WIREFRAME} />
          </mesh>
          <mesh
            ref={(el) => {
              segmentRefsArr.current[i].sphereTop = el;
            }}
            renderOrder={999}
          >
            <sphereGeometry args={[ARM_COLLISION_RADIUS, 10, 8]} />
            <meshBasicMaterial {...RED_WIREFRAME} />
          </mesh>
          <mesh
            ref={(el) => {
              segmentRefsArr.current[i].sphereBottom = el;
            }}
            renderOrder={999}
          >
            <sphereGeometry args={[ARM_COLLISION_RADIUS, 10, 8]} />
            <meshBasicMaterial {...RED_WIREFRAME} />
          </mesh>
        </group>
      ))}
    </>
  );
}
