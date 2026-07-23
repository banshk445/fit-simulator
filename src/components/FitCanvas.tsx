import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { CHEST_HEIGHT_RATIO } from "../constants";
import { Mannequin } from "./Mannequin";
import { Garment } from "./Garment";
import { ArmCapsuleDebug } from "./ArmCapsuleDebug";

// 단위 원기둥(반지름 1, 높이 1)을 scale로 늘려 부드럽게 보간(lerp)한다.
function useLerpedScale(targetScale: THREE.Vector3Tuple, targetPositionY: number) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = 1 - Math.pow(0.001, delta);
    mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, targetScale[0], t);
    mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, targetScale[1], t);
    mesh.scale.z = THREE.MathUtils.lerp(mesh.scale.z, targetScale[2], t);
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, targetPositionY, t);
  });

  return meshRef;
}

function GarmentMesh() {
  const garmentSize = useFitStore((s) => s.garmentSize);
  const bodySize = useFitStore((s) => s.bodySize);

  const heightM = garmentSize.length / 100;
  // 옷 원통 크기는 오직 품(width) 슬라이더로만 결정한다. 가슴둘레는 마네킹
  // 몸통 자체에 아무 영향을 주지 않으므로(Xbot 메시는 굵기가 고정), 옷
  // 반지름 계산에도 관여시키지 않는다 — 그래야 가슴둘레를 움직여도 옷이
  // 반응하지 않는다.
  const radiusM = garmentSize.width / (2 * Math.PI) / 100;
  // 마네킹의 가슴 높이에 옷 밴드 중심을 맞춘다.
  const centerY = (bodySize.height / 100) * CHEST_HEIGHT_RATIO;

  const meshRef = useLerpedScale([radiusM, heightM, radiusM], centerY);

  return (
    <mesh ref={meshRef} scale={[radiusM, heightM, radiusM]} position={[0, centerY, 0]}>
      <cylinderGeometry args={[1, 1, 1, 32]} />
      <meshStandardMaterial
        color={0x3b82f6}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export function FitCanvas() {
  const garmentImage = useFitStore((s) => s.garmentImage);
  const showArmCapsules = useFitStore((s) => s.showArmCapsules);

  return (
    <Canvas camera={{ position: [0, 1.3, 3], fov: 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 2]} intensity={1} />
      <Suspense fallback={null}>
        <Mannequin />
      </Suspense>
      {!garmentImage && <GarmentMesh />}
      {garmentImage && (
        <Suspense fallback={null}>
          <Garment imageUrl={garmentImage} />
        </Suspense>
      )}
      {import.meta.env.DEV && showArmCapsules && (
        <Suspense fallback={null}>
          <ArmCapsuleDebug />
        </Suspense>
      )}
      <gridHelper args={[6, 12]} />
      <OrbitControls target={[0, 1, 0]} />
    </Canvas>
  );
}
