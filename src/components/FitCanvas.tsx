import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { checkGarmentFit } from "../lib/garmentFitLimits";
import { CHEST_HEIGHT_RATIO } from "../constants";
import { Mannequin } from "./Mannequin";
import { Garment } from "./Garment";
import { ArmCapsuleDebug } from "./ArmCapsuleDebug";
import { lazy } from "react";

// v2 Stage 2a — `?patterncore=1`에서만 로드되는 정적 배치 미리보기(DEV).
// **삼항의 조건이 빌드 시 리터럴 false로 치환**되므로 프로덕션 번들에서는
// import 자체가 도달 불가가 되어 통째로 잘린다. 이 가드가 없으면 fixture
// 1.8MB가 dist에 청크로 남는다(실측 — `npm run build` 산출물에서 확인).
const PatternPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./PatternPreview")).PatternPreview }))
  : null;

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

// 판정용 고정 시점. 값은 기본 카메라(0,1.3,3 / fov45 / target 0,1,0)에서
// 출발해 목·소매만 당긴 것이다.
const CAPTURE_VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number]; fov?: number }> = {
  front: { pos: [0, 1.3, 3], target: [0, 1, 0] },
  back: { pos: [0, 1.3, -3], target: [0, 1, 0] },
  neck: { pos: [0, 1.5, 1.0], target: [0, 1.38, 0], fov: 35 },
  neckback: { pos: [0, 1.5, -1.0], target: [0, 1.38, 0], fov: 35 },
  // 27회차 정정: 기존 cuff는 target이 몸통 중심(0,1.15,0)이라 **몸통 원경**이
  // 잡혔다(26회차 캡처가 그래서 V3 판정 불가였다). 소맷부리는 팔 축 끝이므로
  // 오른팔 커프 근방을 직접 겨눈다.
  cuff: { pos: [0.30, 1.30, 0.75], target: [0.27, 1.20, 0], fov: 30 },
  // 밑단 프릴 대조용(회차 간 같은 구도).
  hem: { pos: [0, 0.95, 1.5], target: [0, 0.82, 0], fov: 35 },
};

export function FitCanvas() {
  const garmentImage = useFitStore((s) => s.garmentImage);
  const showArmCapsules = useFitStore((s) => s.showArmCapsules);
  // 착용 불가 조합에서는 시뮬 자체를 안 돌린다 — 발산은 안 하지만
  // 천이 몸을 못 덮어 의미 없는 화면이 나온다(garmentFitLimits.ts 실측).
  const chest = useFitStore((s) => s.bodySize.chest);
  const width = useFitStore((s) => s.garmentSize.width);
  const fit = checkGarmentFit(chest, width);
  const wearable = fit.verdict !== "impossible";

  // DEV: ?view=front|back|neck|cuff 로 카메라를 고정 시점에 놓는다.
  // 판정용 캡처(npm run capture)가 사람 손 없이 같은 구도를 다시 잡기
  // 위한 것 — 눈대중으로 돌린 각도는 전후 대조가 안 된다.
  const query = new URLSearchParams(window.location.search);
  const view = query.get("view");
  const shot = view ? CAPTURE_VIEWS[view] : undefined;
  // v2 patternCore — 켜면 v1 옷 대신 패턴 정적 배치만 그린다(물리 없음).
  const patternCore = import.meta.env.DEV && query.get("patterncore") === "1";
  // **68회차 정정**: 이 문장은 원래 "사진이 화면에 안 나온다"였고 그건 그때까지 참이었다
  // (v2 렌더러가 store를 안 봤다). 68회차가 `PatternPreview`에 배선을 넣어 **v2도 사진을 그린다**.
  // 경고를 지우지 않고 내용을 바꾼다 — 두 경로의 화면이 서로 다르므로(아래) 지금 무엇을
  // 보고 있는지는 여전히 알려야 한다.
  if (patternCore && garmentImage) {
    console.warn(
      "[fit] ?patterncore=1 — v2 경로가 업로드 사진을 그린다(68회차 배선). 단 패널 UV가 겹쳐 있어 앞/뒤/소매가 같은 그림을 반복한다(69회차). v1 렌더를 보려면 patterncore 파라미터를 뺄 것(http://localhost:5173/).",
    );
  }

  return (
    <Canvas camera={{ position: shot?.pos ?? [0, 1.3, 3], fov: shot?.fov ?? 45 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 2]} intensity={1} />
      <Suspense fallback={null}>
        <Mannequin />
      </Suspense>
      {patternCore && PatternPreview && (
        <Suspense fallback={null}>
          <PatternPreview />
        </Suspense>
      )}
      {!patternCore && (!garmentImage || !wearable) && <GarmentMesh />}
      {!patternCore && garmentImage && wearable && (
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
      <OrbitControls target={shot?.target ?? [0, 1, 0]} />
    </Canvas>
  );
}
