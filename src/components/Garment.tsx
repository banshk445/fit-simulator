import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFitStore } from "../store/useFitStore";
import { MannequinCollisionMesh } from "../lib/meshCollision";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { mannequinRootRef } from "../lib/mannequinRef";
import { buildTorsoProxyCapsules } from "../lib/torsoCapsule";
import { findArmDirection, findShortSleeveDirection, findShoulderBones } from "../lib/boneUtils";
import { computeShoulderPin } from "../lib/shoulderPin";
import { torsoColumnRange } from "../lib/buildGarmentSim";
import { COLS, PARTICLES_PER_PANEL, REBUILD_DEBOUNCE_MS, ROWS } from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, ArmShapeMsg } from "../lib/garmentProtocol";
import { MODEL_URL } from "./Mannequin";

interface Props {
  imageUrl: string;
}

const shoulderVec = new THREE.Vector3();
const rightShoulderVec = new THREE.Vector3();
const leftDirVec = new THREE.Vector3();
const rightDirVec = new THREE.Vector3();

// 46번(재설계): 목선(0번 행)이 마네킹 어깨 위에서 여전히 부자연스럽게
// 보인다는 지적을 받았다 — SHOULDER_PIN_LIFT를 키워봐도(2cm→5.5cm) 이
// 상수는 "핀 코너 근방 8cm"에서만 실측된 값이라, 어깨 캡(삼각근) 돔의
// 정점은 중심에 가까울수록 더 높이 솟기 때문에 균일한 리프트로는 부족한
// 열이 남았다. 매 프레임 0번 행의 각 열마다 실제로 레이캐스팅해서 마네킹
// 표면 높이를 직접 재고, 그 표면보다 낮으면 끌어올리는 보정치를 계산한다
// — 상수 하나를 또 추측하는 대신, 실제 마네킹 형상을 그대로 따라가게 한다.
const neckRayOrigin = new THREE.Vector3();
const DOWN_VEC = new THREE.Vector3(0, -1, 0);
const NECK_SURFACE_CLEARANCE = 0.012; // 표면 위로 얹히는 옷감 두께 여유
// 46번 실측(버그): 처음엔 광선을 기준선 위 25cm에서 아래로 50cm까지
// 넉넉하게 쐈는데, 목 구멍 중심부 열(u가 0에 가까운, 실제로는 목/턱이
// 있는 위치)에서 광선이 머리(턱 밑)에 맞아버려 그 열이 머리 높이까지
// 확 끌려 올라가는 "뿔"처럼 보이는 회귀가 실측(스크린샷)으로 확인됐다 —
// 그 구간은 애초에 마네킹 표면을 따라갈 필요가 없는(목이 드러나야 하는)
// 목 구멍 자체이므로 레이캐스팅 대상에서 아예 뺀다. 탐색 범위도 어깨 캡
// 돔이 실제로 있을 법한 좁은 창(기준선 위 10cm~아래 5cm)으로 좁혀, 엉뚱한
// 부위에 맞을 여지 자체를 줄인다.
const NECK_RAYCAST_MIN_ABS_U = 0.3; // 이보다 중심에 가까운 열은 목 구멍이라 건너뜀
// 46번 실측(버그): 위 문턱값에서 레이캐스팅 보정을 아예 껐다 켰다(if로
// 완전히 건너뜀) 했더니, 정확히 그 경계 열에서 리프트 값이 뚝 끊겨(옆
// 열은 보정 있음, 이 열은 0) 목선 곡선에 눈에 띄는 꺾임/톱니가 생겼다
// — 경계 근방 몇 열에 걸쳐 부드럽게 0으로 줄어들도록(smoothstep) 블렌드해
// 그 꺾임을 없앤다.
const NECK_RAYCAST_BLEND_WIDTH = 0.08;
function smoothstep01(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}
// 46번(전면 재설계): 몸판 열이 이제 소매 끝까지 뻗어 있으므로, 여기서
// 쓰는 "열 위치 u"는 더 이상 pinLeft~pinRight 사이 어깨 폭 전체를
// 나타내지 않는다 — u=±0.5는 이제 소매 끝이지 어깨점이 아니다. 목선
// 레이캐스팅(그리고 그 기준이 되는 pinLeft~pinRight 보간)은 몸통 폭 안쪽
// 열(xMin~xMax, buildGarmentSim.ts의 torsoColumnRange)에서만 의미가
// 있다 — 그 바깥(소매 쪽, 핀 자체가 없는 열)은 raycasting 대상에서 뺀다.
function computeNecklineLift(
  bvh: ArrayBvhCollision,
  pinLeft: THREE.Vector3,
  pinRight: THREE.Vector3,
  cols: number,
  xMin: number,
  xMax: number,
): Float32Array {
  // 46번(전면 재설계 버그): 여기 t/u는 예전엔 "0=왼쪽 어깨~1=오른쪽 어깨"를
  // 의미했다(COLS가 어깨 폭만 담당하던 시절). 지금은 COLS가 소매 끝까지
  // 담당하므로, 열 index 기준 raw t를 그대로 쓰면 (1) NECK_RAYCAST_MIN_ABS_U
  // 문턱값이 더 이상 "어깨 근처"를 가리키지 않고, (2) baseX/Y/Z가 pinLeft~
  // pinRight를 몸통 범위 전체가 아니라 그 일부만 잘라 보간해버린다 —
  // 실측(스크린샷)에서 쇄골 근처에 남아있던 작은 흰 틈의 원인이었다.
  // 몸통 범위(xMin~xMax)만으로 다시 0~1을 잡아 어깨점 기준 좌표로
  // 되돌린다.
  const lift = new Float32Array(cols);
  const torsoSpan = xMax - xMin;
  for (let x = xMin; x <= xMax; x++) {
    const t = torsoSpan > 0 ? (x - xMin) / torsoSpan : 0.5;
    const u = t - 0.5;
    const absU = Math.abs(u);
    if (absU < NECK_RAYCAST_MIN_ABS_U - NECK_RAYCAST_BLEND_WIDTH) continue;
    const blend = smoothstep01((absU - (NECK_RAYCAST_MIN_ABS_U - NECK_RAYCAST_BLEND_WIDTH)) / NECK_RAYCAST_BLEND_WIDTH);
    const baseX = pinLeft.x + (pinRight.x - pinLeft.x) * t;
    const baseY = pinLeft.y + (pinRight.y - pinLeft.y) * t;
    const baseZ = pinLeft.z + (pinRight.z - pinLeft.z) * t;
    neckRayOrigin.set(baseX, baseY + 0.18, baseZ);
    const hitPoint = bvh.raycastFirst(neckRayOrigin, DOWN_VEC, 0.3);
    if (hitPoint) {
      const surfaceY = hitPoint.y;
      const neededY = surfaceY + NECK_SURFACE_CLEARANCE;
      lift[x] = Math.max(0, neededY - baseY) * blend;
    }
  }
  // 46번 실측(버그): 열마다 독립적으로 레이캐스팅하면, 마네킹이 저해상도
  // 폴리곤이라 이웃 열끼리도 맞은 면(삼각형)이 살짝씩 달라 리프트 값이
  // 계단식으로 들쭉날쭉해진다 — 목선 곡선에 톱니처럼 보이는 원인이었다.
  // 이웃과 평균 내는 가벼운 스무딩을 한 번 통과시켜 매끄럽게 잇는다.
  const smoothed = new Float32Array(cols);
  for (let x = 0; x < cols; x++) {
    const prev = lift[Math.max(0, x - 1)];
    const next = lift[Math.min(cols - 1, x + 1)];
    smoothed[x] = (prev + lift[x] * 2 + next) / 4;
  }
  return smoothed;
}

function toMsg(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

// 46번(프록시 바인딩 — 렌더링 해상도 분리): 물리는 검증된 저해상도
// (COLS x ROWS)를 그대로 유지하고, 화면에 그리는 지오메트리만 이보다
// 훨씬 촘촘하게 쪼갠다. 무게중심 좌표로 삼각형 내부를 선형 보간하는
// 방식은 그 삼각형과 완전히 같은 평면 위에 머물러(수학적으로 곡률이
// 전혀 안 생김) 시각적으로 아무 효과가 없다 — 대신 우리 메쉬는 임의
// 삼각형이 아니라 규칙적인 격자라, "격자 셀 안 쌍선형(bilinear) 좌표"로
// 바꾸면 같은 GPU 바인딩 개념을 유지하면서 실제로 휘어진 면이 생긴다
// (쌍선형 패치는 네 꼭짓점이 한 평면 위에 있지 않은 한 진짜 곡면).
// PlaneGeometry가 이미 만들어주는 기본 UV(0~1)가 격자 좌표와 그대로
// 대응하므로 별도로 구워 넣을 attribute가 필요 없다 — LinearFilter를
// 켠 DataTexture를 이 UV로 샘플링하면 GPU 하드웨어가 쌍선형 보간을
// 대신 해준다(수동으로 네 모서리를 따로 읽어 섞을 필요가 없음).
const RENDER_SUBDIV = 3; // 저해상도 셀 하나를 3x3으로 쪼갠다(삼각형 수 약 9배)

function makeDataTexture(cols: number, rows: number): { texture: THREE.DataTexture; data: Float32Array } {
  const data = new Float32Array(cols * rows * 4);
  const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  return { texture, data };
}

// 워커가 돌려주는 XYZXYZ... 배열(저해상도 물리 정점)을 DataTexture용
// XYZAXYZA...(RGBA, 4칸씩) 배열로 옮겨 담는다 — 매 프레임 한 번, 입자
// 수만큼(1232개)만 도는 가벼운 루프.
function packXYZIntoRGBA(src: ArrayLike<number>, dst: Float32Array): void {
  const n = src.length / 3;
  for (let i = 0; i < n; i++) {
    dst[i * 4] = src[i * 3];
    dst[i * 4 + 1] = src[i * 3 + 1];
    dst[i * 4 + 2] = src[i * 3 + 2];
    dst[i * 4 + 3] = 1;
  }
}

// MeshStandardMaterial의 표준 버텍스 셰이더에 우리 데이터 텍스처 샘플링을
// 주입한다 — <begin_vertex>(위치)와 <beginnormal_vertex>(법선)를 각각
// 텍스처 샘플로 바꿔치기한다. uv 어트리뷰트를 격자 연속 좌표로 바꾼 뒤
// 텍셀 중심에 맞춰 오프셋(+0.5)해야 LinearFilter가 정확히 물리 격자와
// 같은 쌍선형 가중치로 보간한다.
function injectProxyBinding(
  posTex: THREE.DataTexture,
  normalTex: THREE.DataTexture,
  cols: number,
  rows: number,
): (shader: THREE.WebGLProgramParametersWithUniforms) => void {
  return (shader) => {
    shader.uniforms.uPosTex = { value: posTex };
    shader.uniforms.uNormalTex = { value: normalTex };
    shader.vertexShader = `uniform sampler2D uPosTex;\nuniform sampler2D uNormalTex;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `vec2 gridUv = (uv * vec2(${(cols - 1).toFixed(1)}, ${(rows - 1).toFixed(1)}) + 0.5) / vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
      vec3 objectNormal = normalize(texture2D(uNormalTex, gridUv).xyz);
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
      #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 transformed = texture2D(uPosTex, gridUv).xyz;`,
    );
  };
}

export function Garment({ imageUrl }: Props) {
  const texture = useTexture(imageUrl);
  const { nodes } = useGLTF(MODEL_URL) as unknown as { nodes: Record<string, THREE.Object3D> };
  const shoulderBones = useMemo(() => findShoulderBones(nodes), [nodes]);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const bodySize = useFitStore((s) => s.bodySize);
  const fabric = useFitStore((s) => s.fabric);
  const sleeveType = useFitStore((s) => s.sleeveType);

  // --- 몸판 지오메트리 (소매는 이제 별도 메시가 아니라 이 패널의 넓은
  // 바깥쪽 열이다 — 46번 전면 재설계) ---
  const frontPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  const backPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  // position에 DynamicDrawUsage를 명시하는 이유: 워커가 매 프레임 돌려주는
  // 값으로 이 버퍼가 통째로 덮어써지는데, WebKit(Metal 백엔드)은
  // StaticDrawUsage 힌트가 걸린 버퍼의 매 프레임 재업로드를 화면에 반영하지
  // 않는 문제가 실측(WebKit 독립 재현 스크립트)으로 확인됐다 — 크롬(ANGLE)은
  // 이 힌트를 무시하고 정상 처리하지만 WebKit은 그러지 않는다.
  const frontGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, COLS - 1, ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(frontPositions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [frontPositions]);
  const backGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, COLS - 1, ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(backPositions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [backPositions]);

  // 46번(프록시 바인딩): 화면에 실제로 그리는 지오메트리는 이 저해상도
  // (frontGeometry/backGeometry) 대신 훨씬 촘촘한 별도 지오메트리를 쓴다 —
  // 이 둘은 더 이상 렌더링용이 아니라, 매 프레임 워커 결과를 받아 법선을
  // 계산하는 "데이터 원본"(물리 프록시) 역할만 한다. position/uv는
  // PlaneGeometry 기본값 그대로 두고(어차피 셰이더가 덮어씀) 실제로
  // 쓰는 건 uv뿐이다.
  const frontRenderGeometry = useMemo(
    () => new THREE.PlaneGeometry(1, 1, (COLS - 1) * RENDER_SUBDIV, (ROWS - 1) * RENDER_SUBDIV),
    [],
  );
  const backRenderGeometry = useMemo(
    () => new THREE.PlaneGeometry(1, 1, (COLS - 1) * RENDER_SUBDIV, (ROWS - 1) * RENDER_SUBDIV),
    [],
  );
  const frontPosTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const backPosTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const frontNormalTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const backNormalTex = useMemo(() => makeDataTexture(COLS, ROWS), []);

  // 46번 실측(버그): 앞판(frontGeometry)에 원본 texture를 그대로 물렸더니
  // 글자가 거울상으로 뒤집혀 보였다(사용자 스크린샷으로 확인, "TINY
  // BEAR"가 반전). 원인은 layoutTorsoPanels가 앞판 정점을 배치할 때 쓰는
  // 부호 규칙(u→X 변환)이 PlaneGeometry의 기본 UV 방향과 반대라서 —
  // 즉 이 원단 좌우 반전 보정은 원래 "뒤판"이 아니라 "앞판"에 필요했던
  // 것이었다. 두 메시에 물리는 텍스처를 맞바꿔, 반전 보정본은 앞판에,
  // 원본은 뒤판에 쓴다.
  const mirroredTexture = useMemo(() => {
    const clone = texture.clone();
    clone.repeat.x = -1;
    clone.offset.x = 1;
    clone.needsUpdate = true;
    return clone;
  }, [texture]);

  // 30번 이후 사용자가 "옷이 가슴 위쪽에서 뚝 끊긴다"고 지적해 실측(Playwright로
  // 몸판 메시의 실제 정점 Y 범위를 직접 측정)해보니, 총장 슬라이더를 70cm로
  // 둬도 몸판이 실제로는 약 25cm 높이만 차지하고 있었다 — 원인은 이 아래
  // "이미지 비율에 맞춰 박스 안에 맞추기"(object-fit: contain과 같은 의도)
  // 계산에서 `boxWidthM`을 `garmentSize.width/100/2`로 미리 절반을 냈던 것.
  // `buildGarmentSim.ts`의 `halfWidthAtRow`가 전달받은 widthM을 "전체 폭"으로
  // 보고 자기 안에서 또 한 번 절반을 내므로(`fullHalfWidth = widthM/2`), 여기서
  // 미리 절반 낸 값을 넘기면 실질적으로 폭이 1/4로 줄어들고 — 그 축소된 폭이
  // 다시 boxAspect(가로세로 비율) 계산에 들어가 비교 기준 자체를 왜곡시켜,
  // 세그멘테이션으로 크롭된 이미지(예: 723×668, 비율 약 1.08)가 실제보다 훨씬
  // "가로로 넓은 이미지"인 것처럼 취급되면서 heightM까지 실제 설정값(0.7m)의
  // 1/3 수준으로 줄어드는 연쇄 오류였다. `boxWidthM`은 전체 폭(절반 내지 않은
  // 값)이어야 한다 — 절반 내는 건 buildGarmentSim.ts 한 곳에서만 해야 한다.
  //
  // 36번(큰 재설계): 그런데 그 수정 뒤에도 이 함수는 여전히 "이미지 비율에
  // 맞춰 박스 안에 맞추기"(object-fit: contain) 방식으로 widthM/heightM 중
  // 하나를 사진 비율에 맞춰 사용자가 입력한 총장/품보다 더 작게 줄이고
  // 있었다 — 즉 사용자가 총장 70cm/품 110cm를 입력해도 사진 비율이 안 맞으면
  // 실제 렌더링 치수는 그보다 작아졌다. "실측을 입력하면 그 치수 그대로
  // 핏이 보여야 한다"는 목적과 정면으로 배치되는 동작이었다 — 사진이 옷을
  // 정확히 어느 비율로 담았는지와 무관하게, 3D 형태는 항상 사용자가 입력한
  // 실측 치수를 그대로 따라야 한다. 사진 비율이 안 맞으면 텍스처가 약간
  // 눌리거나 늘어나 보일 수 있지만(세그멘테이션 크롭이 이미 옷 실루엣에
  // 맞춰 잘라내므로 대부분 크게 어긋나지 않는다), 그 정도가 "치수가 아예
  // 사용자 입력과 달라지는 것"보다는 훨씬 나은 트레이드오프다.
  const widthM = garmentSize.width / 100;
  const heightM = garmentSize.length / 100;

  const collisionMesh = useMemo(() => new MannequinCollisionMesh(), []);
  // 46번(프레임 드랍 수정): 목선 레이캐스팅용 메인 스레드 BVH — 몸 실측이
  // 바뀔 때만 구워지는 정적 스냅샷이라, 이 인스턴스에 물린 position 배열은
  // 절대 워커로 transfer(detach)하면 안 된다(아래 굽기 effect 참고).
  const neckSurfaceBvh = useMemo(() => new ArrayBvhCollision(), []);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);
  const pendingDtRef = useRef(0);
  const generationRef = useRef(0);

  // 워커는 컴포넌트 생명주기 동안 하나만 띄우고 언마운트 시 종료한다.
  // frontGeometry/backGeometry/frontPositions/backPositions는 몸판
  // 파티클 수(PARTICLES_PER_PANEL)에만 의존해 컴포넌트 생명주기 내내
  // 정체성이 바뀌지 않는다 — 의존성 배열에 남겨둬도 실질적으로 재실행을
  // 유발하지 않는다.
  useEffect(() => {
    const worker = new Worker(new URL("../workers/garmentWorker.ts", import.meta.url), { type: "module" });
    // 이전엔 워커 에러 핸들러가 아예 없었다 — 워커 안에서 예외가 나면 그
    // 프레임의 "step" 응답만 조용히 안 오고(옷감이 그 자리에 얼어붙은
    // 채로 멈춤) 브라우저 콘솔에 아무 흔적도 안 남을 수 있어, 실측으로
    // 원인을 추적하기 어려웠다(사용자가 보고한 "옷이 처져 보인다" 문제를
    // 재현하려다 발견). 최소한 콘솔에 남기기라도 하도록 추가한다.
    worker.onerror = (e) => {
      console.error("Garment worker error:", e.message, `${e.filename}:${e.lineno}`, e.error);
    };
    worker.onmessageerror = (e) => {
      console.error("Garment worker message deserialization error:", e);
    };
    worker.onmessage = (event: MessageEvent<GarmentWorkerToMainMessage>) => {
      const msg = event.data;
      if (msg.type !== "positions") return;
      pendingRef.current = false;
      if (msg.generation !== generationRef.current) return; // 낡은 세대의 응답은 버린다.

      frontPositions.set(msg.front);
      backPositions.set(msg.back);
      (frontGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (backGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      frontGeometry.computeVertexNormals();
      backGeometry.computeVertexNormals();
      frontGeometry.computeBoundingSphere();
      backGeometry.computeBoundingSphere();

      // 46번(프록시 바인딩): 저해상도 물리 결과(위치)와 그로부터 계산한
      // 법선을 매 프레임 DataTexture로 GPU에 올린다 — 무거운 고해상도
      // BufferGeometry를 매 프레임 다시 쓰는 대신, 가벼운 COLS x ROWS
      // 텍스처만 갱신하고 실제 정점 계산은 버텍스 셰이더가 담당한다.
      packXYZIntoRGBA(msg.front, frontPosTex.data);
      packXYZIntoRGBA(msg.back, backPosTex.data);
      packXYZIntoRGBA(frontGeometry.getAttribute("normal").array, frontNormalTex.data);
      packXYZIntoRGBA(backGeometry.getAttribute("normal").array, backNormalTex.data);
      frontPosTex.texture.needsUpdate = true;
      backPosTex.texture.needsUpdate = true;
      frontNormalTex.texture.needsUpdate = true;
      backNormalTex.texture.needsUpdate = true;

      // 임시 디버그 훅(worker.onerror 근처와 짝) — 워커가 실제로 돌려준
      // 몸판 0번 행(어깨선) 전체를 그대로 노출한다. __fitDebug의 "의도한
      // 핀 값"과 이 값이 다르면 워커 내부(물리 시뮬레이션)에서 문제가
      // 생기는 것이고, 같은데도 화면이 이상하면 렌더링 쪽 문제로 좁혀진다.
      const frontRow0Y: number[] = [];
      for (let x = 0; x < COLS; x++) frontRow0Y.push(msg.front[x * 3 + 1]);
      const lastRow = ROWS - 1;
      const frontLastRowXY: Array<[number, number]> = [];
      for (let x = 0; x < COLS; x++) {
        frontLastRowXY.push([msg.front[(lastRow * COLS + x) * 3], msg.front[(lastRow * COLS + x) * 3 + 1]]);
      }
      (window as unknown as { __fitDebugActual?: unknown }).__fitDebugActual = {
        frontRow0Y,
        frontRow0First3: Array.from(msg.front.slice(0, 3)),
        backRow0First3: Array.from(msg.back.slice(0, 3)),
        frontLastRowXY,
      };
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [frontGeometry, backGeometry, frontPositions, backPositions, frontPosTex, backPosTex, frontNormalTex, backNormalTex]);

  // 어깨/팔 방향과 소매 길이에서 현재 팔 모양(ArmShapeMsg)을 계산한다 —
  // init(빌드)과 step(매 프레임) 양쪽에서 같은 공식을 쓰게 한 곳에 모은다.
  // 46번(전면 재설계): 반지름 필드는 더 이상 없다 — 굵기는 워커가 실제
  // 팔에 대해 고정 반지름(ARM_COLLISION_RADIUS)으로 충돌시켜 결정한다.
  function computeArmShapes(): { left: ArmShapeMsg; right: ArmShapeMsg } | null {
    const { left: leftBone, right: rightBone } = shoulderBones;
    if (!leftBone || !rightBone) return null;

    leftBone.updateWorldMatrix(true, false);
    rightBone.updateWorldMatrix(true, false);
    leftBone.getWorldPosition(shoulderVec);
    rightBone.getWorldPosition(rightShoulderVec);

    // 33번: 반팔은 위팔(어깨~팔꿈치) 방향을 따라야 한다 — 어깨~손 직선
    // 방향(findArmDirection)은 팔꿈치가 굽은 포즈에서 위팔 구간과 상당히
    // 어긋나, 반팔 소매가 어깨에서 뚝 떨어져 팔꿈치 쪽으로 삐져나가는
    // 원인이었다(자세한 경위는 boneUtils.ts의 findShortSleeveDirection
    // 주석 참고). 긴팔은 손목까지 닿아야 하므로 기존 방향을 그대로 쓴다.
    if (sleeveType === "long") {
      leftDirVec.copy(findArmDirection(leftBone));
      rightDirVec.copy(findArmDirection(rightBone));
    } else {
      leftDirVec.copy(findShortSleeveDirection(leftBone));
      rightDirVec.copy(findShortSleeveDirection(rightBone));
    }

    // 36번(큰 재설계): 길이는 몸 치수에서 계산하지 않고 옷 실측
    // (garmentSize.sleeveLength) 그대로 쓴다 — 옷이 짧으면 손목에 못
    // 미치고, 길면 손을 덮는 게 그대로 드러난다.
    const length = garmentSize.sleeveLength / 100;

    return {
      left: { dir: toMsg(leftDirVec), trueShoulder: toMsg(shoulderVec), length },
      right: { dir: toMsg(rightDirVec), trueShoulder: toMsg(rightShoulderVec), length },
    };
  }

  // 몸 실측이 바뀔 때만(매 프레임이 아니라) 충돌 메시를 다시 굽어 워커로
  // 보낸다 — 굽는 비용이 커서 슬라이더 드래그 중 매 틱마다 하면 버벅인다.
  useEffect(() => {
    const root = mannequinRootRef.current;
    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    if (!root || !leftShoulder || !rightShoulder) return;
    const timer = setTimeout(() => {
      const { position, frontIndex, backIndex, wholeBodyIndex } = collisionMesh.bake(root);
      // 46번(프레임 드랍 수정): position/wholeBodyIndex는 메인 스레드
      // neckSurfaceBvh가 그대로 붙잡고 계속 쓸 배열이라 transfer(detach)
      // 하면 안 된다 — 구조적 복제(구운 스냅샷이라 데이터가 작지도 않고,
      // 어차피 디바운스로 자주 안 일어나므로 복제 비용은 무시할 만하다)로
      // 워커에는 별도 사본이 간다. frontIndex/backIndex는 워커 전용이라
      // 그대로 transfer해도 안전하다.
      neckSurfaceBvh.rebuild(position, wholeBodyIndex);
      const transfer: Transferable[] = [];
      if (frontIndex) transfer.push(frontIndex.buffer);
      if (backIndex) transfer.push(backIndex.buffer);

      leftShoulder.updateWorldMatrix(true, false);
      rightShoulder.updateWorldMatrix(true, false);
      leftShoulder.getWorldPosition(shoulderVec);
      rightShoulder.getWorldPosition(rightShoulderVec);

      const { capsules, centerZ } = buildTorsoProxyCapsules(
        { x: shoulderVec.x, y: shoulderVec.y, z: shoulderVec.z },
        { x: rightShoulderVec.x, y: rightShoulderVec.y, z: rightShoulderVec.z },
        bodySize.height / 100,
        bodySize.chest / 100,
      );

      workerRef.current?.postMessage(
        { type: "rebuildCollision", position, frontIndex, backIndex, wholeBodyIndex, capsules, centerZ } satisfies MainToGarmentWorkerMessage,
        transfer,
      );
    }, REBUILD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [collisionMesh, neckSurfaceBvh, shoulderBones, bodySize.height, bodySize.chest, bodySize.armLength, bodySize.legLength, bodySize.shoulderWidth]);

  // 몸판 치수(옷 크기 슬라이더, 몸 사이즈)가 바뀌면 워커에 새 시뮬레이션을
  // 처음부터 구성하도록 요청한다 — 마운트 시 최초 1회 빌드도 여기서
  // 이뤄진다. 46번(전면 재설계): 소매가 이제 같은 패널의 일부라 소매
  // 길이/종류가 바뀌면 그 열들의 초기 배치·제약 rest length 자체가
  // 달라져야 하므로, 더 이상 "몸판은 그대로 두고 소매만 다시 짓는" 가벼운
  // 경로(reinitSleeve)가 성립하지 않는다 — 소매 관련 값도 이 전체 재구성
  // 의존성에 합류시킨다(다른 치수 변경과 동일하게, 재구성 시 몸판도 함께
  // 처음 자세로 돌아간다).
  useEffect(() => {
    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    const worker = workerRef.current;
    const armShapes = computeArmShapes();
    if (!leftShoulder || !rightShoulder || !worker || !armShapes) return;

    leftShoulder.updateWorldMatrix(true, false);
    rightShoulder.updateWorldMatrix(true, false);
    leftShoulder.getWorldPosition(shoulderVec);
    rightShoulder.getWorldPosition(rightShoulderVec);
    const pins = computeShoulderPin(shoulderVec, rightShoulderVec, garmentSize.shoulderWidth / 100 / 2);
    const topY = Math.max(pins.left.y, pins.right.y);
    const centerZ = (pins.left.z + pins.right.z) / 2;
    const { xMin, xMax } = torsoColumnRange(COLS, pins.left, pins.right, armShapes.left, armShapes.right);
    const necklineLift = neckSurfaceBvh.ready ? Array.from(computeNecklineLift(neckSurfaceBvh, pins.left, pins.right, COLS, xMin, xMax)) : [];

    generationRef.current += 1;
    worker.postMessage({
      type: "init",
      widthM,
      heightM,
      topY,
      centerZ,
      sleeveWidthM: garmentSize.sleeveWidth / 100,
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      necklineLift,
      armLeft: armShapes.left,
      armRight: armShapes.right,
    } satisfies MainToGarmentWorkerMessage);
    pendingDtRef.current = 0;
    pendingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nodes,
    widthM,
    heightM,
    bodySize.armLength,
    bodySize.shoulderWidth,
    bodySize.height,
    garmentSize.shoulderWidth,
    sleeveType,
    garmentSize.sleeveLength,
    garmentSize.sleeveWidth,
  ]);

  useFrame((_, delta) => {
    const worker = workerRef.current;
    if (!worker) return;

    const { left: leftShoulder, right: rightShoulder } = shoulderBones;
    if (!leftShoulder || !rightShoulder) return;
    const armShapes = computeArmShapes();
    if (!armShapes) return;

    leftShoulder.updateWorldMatrix(true, false);
    rightShoulder.updateWorldMatrix(true, false);
    leftShoulder.getWorldPosition(shoulderVec);
    rightShoulder.getWorldPosition(rightShoulderVec);
    const pins = computeShoulderPin(shoulderVec, rightShoulderVec, garmentSize.shoulderWidth / 100 / 2);

    // 임시 디버그 훅 — Safari에서만 재현되는 어깨 처짐 문제를 사용자
    // 브라우저 콘솔에서 직접 확인하기 위해 추가(원인 확정되면 제거할 것).
    // 콘솔에 `window.__fitDebug`를 입력하면 매 프레임 갱신되는 실제 어깨
    // 본 위치·계산된 핀·팔 방향을 볼 수 있다.
    (window as unknown as { __fitDebug?: unknown }).__fitDebug = {
      leftShoulderBoneRaw: { x: shoulderVec.x, y: shoulderVec.y, z: shoulderVec.z },
      rightShoulderBoneRaw: { x: rightShoulderVec.x, y: rightShoulderVec.y, z: rightShoulderVec.z },
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      leftShoulderBoneName: leftShoulder.name,
      rightShoulderBoneName: rightShoulder.name,
      collisionMeshReady: collisionMesh.ready,
      armDirLeft: armShapes.left.dir,
      armDirRight: armShapes.right.dir,
      armLength: armShapes.left.length,
      armTrueShoulderLeft: armShapes.left.trueShoulder,
    };

    pendingDtRef.current += delta;
    // 워커가 아직 이전 step을 처리 중이면 이번 프레임은 건너뛴다(렌더는
    // 계속 진행되고, 옷감은 워커가 따라잡는 대로 갱신된다).
    if (pendingRef.current) return;
    pendingRef.current = true;
    const dt = pendingDtRef.current;
    pendingDtRef.current = 0;

    const { xMin, xMax } = torsoColumnRange(COLS, pins.left, pins.right, armShapes.left, armShapes.right);
    const necklineLift = neckSurfaceBvh.ready ? Array.from(computeNecklineLift(neckSurfaceBvh, pins.left, pins.right, COLS, xMin, xMax)) : [];

    worker.postMessage({
      type: "step",
      dt,
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      necklineLift,
      fabric,
      armLeft: armShapes.left,
      armRight: armShapes.right,
      generation: generationRef.current,
    } satisfies MainToGarmentWorkerMessage);
  });

  // 임시 디버그 훅 — 어깨 근처에 나타나는 회색/무늬 없는 삼각형 조각이
  // 텍스처 로딩 실패인지 지오메트리 문제인지 확인하는 용도.
  (window as unknown as { __fitDebugTex?: unknown }).__fitDebugTex = {
    textureImageComplete: (texture.image as HTMLImageElement | undefined)?.complete,
    textureImageSize: texture.image
      ? [(texture.image as HTMLImageElement).width, (texture.image as HTMLImageElement).height]
      : null,
    frontPositionsSample: Array.from(frontPositions.slice(0, 9)),
    backPositionsSample: Array.from(backPositions.slice(0, 9)),
  };

  const frontOnBeforeCompile = useMemo(
    () => injectProxyBinding(frontPosTex.texture, frontNormalTex.texture, COLS, ROWS),
    [frontPosTex, frontNormalTex],
  );
  const backOnBeforeCompile = useMemo(
    () => injectProxyBinding(backPosTex.texture, backNormalTex.texture, COLS, ROWS),
    [backPosTex, backNormalTex],
  );

  return (
    <group>
      <mesh geometry={frontRenderGeometry} frustumCulled={false}>
        <meshStandardMaterial map={mirroredTexture} side={THREE.DoubleSide} roughness={0.85} onBeforeCompile={frontOnBeforeCompile} />
      </mesh>
      <mesh geometry={backRenderGeometry} frustumCulled={false}>
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.85} onBeforeCompile={backOnBeforeCompile} />
      </mesh>
    </group>
  );
}

useGLTF.preload(MODEL_URL);
