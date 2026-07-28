import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFitStore } from "../store/useFitStore";
import { MannequinCollisionMesh } from "../lib/meshCollision";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { mannequinRootRef } from "../lib/mannequinRef";
import { buildTorsoProxyCapsules, type Capsule } from "../lib/torsoCapsule";
import { bodyGapBands, computeBodyGapChannels, type GridView } from "../lib/drapeMetrics";
import { findArmDirection, findShortSleeveDirection, findShoulderBones } from "../lib/boneUtils";
import { computeShoulderPin } from "../lib/shoulderPin";
import { compositeGarmentTexture } from "../lib/garmentTextureComposite";
import { torsoColumnRange } from "../lib/buildGarmentSim";
import { angleDegBetweenNormals, armholeRingJaggedness, ringJaggedness } from "../lib/seamDiagnostics";
import {
  ARM_COLLISION_RADIUS,
  ARMHOLE_ROW_FRACTION,
  COLS,
  PARTICLES_PER_PANEL,
  REBUILD_DEBOUNCE_MS,
  ROWS,
  SEAM_REST_LENGTH,
  SLEEVE_RING_COLS,
  SLEEVE_RING_ROWS,
} from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, ArmShapeMsg } from "../lib/garmentProtocol";
import { MODEL_URL } from "./Mannequin";
import { armholeSeamStrip, buildSeamBridge, shoulderSeamStrip, sideSeamStrip, updateSeamBridge } from "./seamBridge";

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
const RENDER_SUBDIV_OFF = 1; // renderSmoothing 토글 끔 = 물리 격자 해상도 그대로(원복 비교용)

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

// 핏 맵: 워커가 돌려주는 정점별 여유(cm) 스칼라 배열을 DataTexture의 R
// 채널에 담는다(G/B/A는 안 씀) — packXYZIntoRGBA와 같은 자리, 같은 빈도.
function packScalarIntoR(src: ArrayLike<number>, dst: Float32Array): void {
  const n = src.length;
  for (let i = 0; i < n; i++) {
    dst[i * 4] = src[i];
  }
}

// 소매 프록시 지오메트리(sleeveGeometryLeft/Right)는 감김 없는 평면이라
// computeVertexNormals()가 col=0/col=last(원통 이음매)를 경계로 취급해
// 서로 다른 법선을 낸다 — row마다 두 값을 더해 normalize한 뒤 양쪽에
// 똑같이 대입해 이음매를 지운다. computeVertexNormals() 직후, 텍스처
// 업로드 전에 호출해야 한다.
function averageSleeveSeamNormals(geometry: THREE.BufferGeometry, cols: number, rows: number): void {
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const first = new THREE.Vector3();
  const last = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const iFirst = row * cols;
    const iLast = row * cols + (cols - 1);
    first.fromBufferAttribute(normal, iFirst);
    last.fromBufferAttribute(normal, iLast);
    first.add(last).normalize();
    normal.setXYZ(iFirst, first.x, first.y, first.z);
    normal.setXYZ(iLast, first.x, first.y, first.z);
  }
  normal.needsUpdate = true;
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

// 47번(핏 맵 — 일반 기능, DEV 아님): 옷감 정점마다 몸 표면까지의 여유(cm)를
// 색으로 보여준다. injectProxyBinding과 같은 정점 위치/법선 바인딩을 하되,
// 색은 프래그먼트 셰이더에서 결정해야 해서 gridUv를 varying으로 프래그먼트
// 까지 넘긴다 — three.js 내장 vUv는 map 등 USE_UV 관련 매크로가 켜져 있을
// 때만 보장되므로 거기 의존하지 않고 직접 varying을 선언한다. vertexColors
// (attribute)는 전혀 쓰지 않는다(과거 color attribute 누락으로 전부 검게
// 렌더된 사고가 있어 그 경로 자체를 피한다). injectProxyBinding(다른
// 토글들이 공유하는 함수)은 건드리지 않고 완전히 별도 함수로 둔다.
//
// 색 경계(0cm/1cm/3cm)와 색상 자체는 실측이 아니라 눈대중 초기값이다 —
// 사용자 피드백으로 나중에 조정될 수 있다.
function injectFitMapBinding(
  posTex: THREE.DataTexture,
  normalTex: THREE.DataTexture,
  fitTex: THREE.DataTexture,
  cols: number,
  rows: number,
): (shader: THREE.WebGLProgramParametersWithUniforms) => void {
  return (shader) => {
    shader.uniforms.uPosTex = { value: posTex };
    shader.uniforms.uNormalTex = { value: normalTex };
    shader.uniforms.uFitTex = { value: fitTex };
    shader.vertexShader = `uniform sampler2D uPosTex;\nuniform sampler2D uNormalTex;\nvarying vec2 vGridUv;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `vec2 gridUv = (uv * vec2(${(cols - 1).toFixed(1)}, ${(rows - 1).toFixed(1)}) + 0.5) / vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
      vGridUv = gridUv;
      vec3 objectNormal = normalize(texture2D(uNormalTex, gridUv).xyz);
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
      #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 transformed = texture2D(uPosTex, gridUv).xyz;`,
    );
    shader.fragmentShader = `uniform sampler2D uFitTex;\nvarying vec2 vGridUv;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        // 실측 아님, 눈대중 초기값 — 경계(0/1/3cm)와 색은 피드백으로 조정될 수 있음.
        float clearanceCm = texture2D(uFitTex, vGridUv).r;
        vec3 purple = vec3(0.55, 0.0, 0.85); // 관통(디버그)
        vec3 red    = vec3(0.85, 0.15, 0.15); // 타이트
        vec3 yellow = vec3(0.95, 0.85, 0.1); // 적정
        vec3 blue   = vec3(0.15, 0.45, 0.95); // 헐렁
        vec3 fitColor = mix(purple, red, smoothstep(-0.6, 0.0, clearanceCm));
        fitColor = mix(fitColor, yellow, smoothstep(0.6, 1.4, clearanceCm));
        fitColor = mix(fitColor, blue, smoothstep(2.4, 3.6, clearanceCm));
        diffuseColor.rgb = fitColor;
      }`,
    );
  };
}

// 47번(디버그 전용 — 영역별 와이어프레임): frontRenderGeometry/backRenderGeometry와
// 똑같이 실제 정점 위치는 셰이더가 uv로 uPosTex를 샘플링해 통째로 덮어쓰므로
// (위 주석 참고), 이 PlaneGeometry 자체의 X/Y좌표는 의미가 없고 uv만 의미가
// 있다. 열 범위[colStart,colEnd](inclusive)만 담당하는 부분 지오메트리를
// 만들려면, 그 범위만큼만 세그먼트를 잘라 만든 뒤 기본 UV(0~1)를 그 열
// 범위에 해당하는 u구간([colStart/(cols-1), colEnd/(cols-1)])으로 다시
// 매핑하면 된다 — injectProxyBinding의 gridUv 계산이 그대로 그 구간만
// 샘플링하게 된다.
function buildRegionPlaneGeometry(colStart: number, colEnd: number, cols: number, rows: number, subdiv: number): THREE.PlaneGeometry {
  const colCount = Math.max(1, colEnd - colStart);
  const geometry = new THREE.PlaneGeometry(1, 1, colCount * subdiv, (rows - 1) * subdiv);
  const uv = geometry.getAttribute("uv");
  const uStart = colStart / (cols - 1);
  const uEnd = colEnd / (cols - 1);
  for (let i = 0; i < uv.count; i++) {
    const localU = uv.getX(i);
    uv.setX(i, uStart + localU * (uEnd - uStart));
  }
  uv.needsUpdate = true;
  return geometry;
}

// 47번(디버그 전용 — 소매 양쪽 구간 버그 수정): 소매는 몸통(xMin~xMax) 밖의
// 양쪽 두 구간(왼쪽: x<xMin, 오른쪽: x>xMax)이다 — buildRegionPlaneGeometry
// 하나로는 한쪽만 표현되므로, 양쪽을 각각 만들어 하나의 지오메트리로
// 합친다. xMin/xMax 열 자체는 몸통 쪽에도 포함되는 경계라 양쪽에 걸쳐
// 살짝 겹치지만(공유 정점), 시각화 목적상 무해하다.
function buildSleeveRegionGeometry(xMin: number, xMax: number, cols: number, rows: number, subdiv: number): THREE.BufferGeometry {
  const left = buildRegionPlaneGeometry(0, xMin, cols, rows, subdiv);
  const right = buildRegionPlaneGeometry(xMax, cols - 1, cols, rows, subdiv);
  const merged = mergeGeometries([left, right]);
  if (merged) {
    left.dispose();
    right.dispose();
    return merged;
  }
  right.dispose(); // 병합 실패(드문 경우) — 왼쪽 소매만이라도 반환.
  return left;
}

// 범위 B 구현 5번(소매 렌더링): 소매는 원통이라 마지막 열(col=cols-1)과
// 첫 열(col=0)이 이어져야 한다 — 평범한 PlaneGeometry(cols-1 세그먼트)는
// 열이 안 닫힌 평면이라 이 이음매가 없다. widthSegments를 cols(세그먼트
// 하나 더)로 만들면 PlaneGeometry가 이미 (cols+1)번째 "여분 열"과 그
// 인덱스 버퍼(삼각형)를 자동으로 만들어준다 — 그 여분 열의 uv.x를 1이
// 아니라 0으로 다시 매핑하면(injectProxyBinding의 gridUv 공식이 uv.x=0을
// col=0 텍셀 중심으로 매핑) 그 마지막 삼각형 스트립이 "실제 col=cols-1
// 열 → col=0 텍셀을 다시 샘플링하는 여분 열"을 잇게 되어 원통이 닫힌다.
// 실제 col 0..cols-1은 그대로 c/(cols-1) 간격(frontRenderGeometry가 이미
// 쓰는, 리매핑 없이 자연스러운 PlaneGeometry 간격과 동일 공식)이라 별도
// 보정이 필요 없다 — 여분 열 하나만 예외 처리.
//
// ponytail: 이음매(col=cols-1↔col=0) 양쪽의 법선은 각자 독립적으로
// computeVertexNormals()된 값이라(이음매를 가로지르는 인접면을 감안 못함)
// 이 한 줄에서만 음영이 살짝 튈 수 있다 — 12각형 해상도에서 눈에 띄는
// 수준인지 실측 전이라 지금은 손대지 않는다. 문제로 보이면 이음매 법선만
// 평균내는 보정을 추가.
function buildSleeveTubeGeometry(cols: number, rows: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, cols, rows - 1);
  const uv = geometry.getAttribute("uv");
  const colsPerRow = cols + 1;
  for (let i = 0; i < uv.count; i++) {
    const col = i % colsPerRow;
    uv.setX(i, col === cols ? 0 : col / (cols - 1));
  }
  uv.needsUpdate = true;
  return geometry;
}

// 47번(디버그 전용 — 와이어프레임 토글, 실측으로 확정한 원인): 처음엔
// MeshBasicMaterial로 와이어프레임 전용 머티리얼을 새로 만들었는데
// "program not valid" 컴파일 실패가 났다 — injectProxyBinding이 gridUv
// 변수를 "#include <beginnormal_vertex>" 자리에서 선언하는데,
// MeshBasicMaterial은 조명 계산이 없어(무광원 머티리얼) 이 셰이더 청크
// 자체가 애초에 없다. 그래서 그 선언이 통째로 빠진 채 바로 다음
// "#include <begin_vertex>" 자리에서 정의 안 된 gridUv를 참조해 컴파일이
// 깨졌다(map 유무와 무관 — 처음엔 uv 어트리뷰트 문제로 오판했었다).
// injectProxyBinding이 원래 대상으로 삼는 MeshStandardMaterial을 그대로
// 쓰면(그 청크가 항상 존재) 이 문제가 없다 — 아래에서 그대로 재사용.

export function Garment({ imageUrl }: Props) {
  const rawTexture = useTexture(imageUrl);
  // 47번(원단색+프린트 합성): 사진 전체를 몸판 UV에 그대로 늘려 붙이는
  // 대신, 원단 대표색(테두리 기반 샘플링 — garmentTextureComposite.ts의
  // borderRepresentativeColor)으로 칠한 캔버스 위에 실제 프린트 영역만
  // 실제 비율로 얹는다. cropToGarmentRegion(garmentSegmentation.ts)은
  // 그대로 재사용하고 수정하지 않는다.
  // 47번(디코드 보장): useTexture가 넘겨주는 image는 'load' 이벤트 기준
  // (complete=true)이라 useMemo 안에서 바로 캔버스에 그리면, 브라우저가
  // 아직 픽셀 디코드를 끝내지 않은 상태를 읽을 수 있다 — image.decode()가
  // 리졸브된 뒤에만 샘플링해야 매번 같은 값이 나온다. useMemo는 비동기를
  // 못 기다리므로 useEffect+state로 바꾼다.
  const [compositedTexture, setCompositedTexture] = useState<THREE.Texture>(rawTexture);
  // 범위 B 구현 5번(문서 결정 #4): 소매는 텍스처 없이 원단 대표색만 쓴다.
  // compositeGarmentTexture가 이미 만드는 캔버스는 코너 픽셀이 항상 대표색
  // 그대로다(프린트 박스는 중앙 고정 배치 — garmentTextureComposite.ts의
  // destX/destY 참고) — 그 캔버스를 재사용해 픽셀 1개만 더 읽는다.
  // garmentTextureComposite.ts는 손 안 댐(borderRepresentativeColor 재노출
  // 불필요). CSS 문자열(rgb(...))로 유지 — new THREE.Color(r,g,b)(숫자
  // 3개 생성자)는 sRGB 바이트를 linear로 오인해 감마를 이중으로 먹이는
  // 함정이 이 파일 43-42행 위쪽 주석에 이미 실측 기록돼 있다(같은 파일의
  // 다른 이유였지만 THREE.Color 자체의 함정이라 여기도 똑같이 적용된다).
  const [sleeveColor, setSleeveColor] = useState("#888888");
  // 문서 21번(시임 브리지): 실제 봉제선처럼 대표색보다 살짝 어둡게. 0.8 배율은
  // 실측이 아니라 눈대중 초기값 — 화면 확인 후 조정될 수 있다.
  const seamColor = useMemo(() => new THREE.Color(sleeveColor).multiplyScalar(0.8), [sleeveColor]);
  useEffect(() => {
    const image = rawTexture.image as HTMLImageElement | undefined;
    if (!image) {
      setCompositedTexture(rawTexture);
      return;
    }
    let cancelled = false;
    image
      .decode()
      .catch(() => {}) // 디코드 실패해도 이미 로드는 됐으니 계속 진행
      .then(() => {
        if (cancelled) return;
        const canvas = compositeGarmentTexture(image);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = rawTexture.colorSpace;
        setCompositedTexture(tex);
        const ctx2d = canvas.getContext("2d");
        if (ctx2d) {
          const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data;
          setSleeveColor(`rgb(${r}, ${g}, ${b})`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rawTexture]);
  const { nodes } = useGLTF(MODEL_URL) as unknown as { nodes: Record<string, THREE.Object3D> };
  const shoulderBones = useMemo(() => findShoulderBones(nodes), [nodes]);
  const garmentSize = useFitStore((s) => s.garmentSize);
  const bodySize = useFitStore((s) => s.bodySize);
  const fabric = useFitStore((s) => s.fabric);
  const sleeveType = useFitStore((s) => s.sleeveType);
  const showFrontWireframe = useFitStore((s) => s.showFrontWireframe);
  const showBackTorsoWireframe = useFitStore((s) => s.showBackTorsoWireframe);
  const showFrontSleeveWireframe = useFitStore((s) => s.showFrontSleeveWireframe);
  const showBackSleeveWireframe = useFitStore((s) => s.showBackSleeveWireframe);
  const showAllRegionsWireframe = useFitStore((s) => s.showAllRegionsWireframe);
  const showFitMap = useFitStore((s) => s.showFitMap);
  const renderSmoothing = useFitStore((s) => s.renderSmoothing);
  const renderSubdiv = renderSmoothing ? RENDER_SUBDIV : RENDER_SUBDIV_OFF;
  // 47번(디버그 전용): 영역별 와이어프레임 지오메트리를 나눌 몸통(xMin~xMax)
  // 경계 — torsoColumnRange가 이미 계산하는 값을 아래 useEffect에서 그대로
  // 채워 넣는다(포즈가 바뀔 때마다 다시 자르진 않는다 — 치수가 바뀔 때만
  // 갱신되는 기존 useEffect 의존성을 그대로 재사용). 소매는 이 범위 밖
  // 양쪽(x<torsoSleeveMin, x>torsoSleeveMax) 두 구간이다.
  const [torsoSleeveMin, setTorsoSleeveMin] = useState(0);
  const [torsoSleeveMax, setTorsoSleeveMax] = useState(COLS - 1);

  // --- 몸판 지오메트리 (소매는 이제 별도 메시가 아니라 이 패널의 넓은
  // 바깥쪽 열이다 — 46번 전면 재설계) ---
  const frontPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  const backPositions = useMemo(() => new Float32Array(PARTICLES_PER_PANEL * 3), []);
  // sleeveSeamCheck 검증용 + 아래 sleeveGeometryLeft/Right(법선 계산용
  // 프록시)의 position attribute로 이제 렌더링에도 쓰인다(범위 B 구현 5번).
  const sleevePositionsLeft = useMemo(() => new Float32Array(SLEEVE_RING_COLS * SLEEVE_RING_ROWS * 3), []);
  const sleevePositionsRight = useMemo(() => new Float32Array(SLEEVE_RING_COLS * SLEEVE_RING_ROWS * 3), []);
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
  // 소매용 법선-계산 프록시(frontGeometry/backGeometry와 같은 역할, 같은
  // 이유로 DynamicDrawUsage). 이음매(wrap) 인덱스가 없는 평범한 PlaneGeometry라
  // computeVertexNormals()가 이음매를 가로지르는 면은 감안 못한다 —
  // buildSleeveTubeGeometry 주석의 ponytail 메모와 같은 자리.
  const sleeveGeometryLeft = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, SLEEVE_RING_COLS - 1, SLEEVE_RING_ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(sleevePositionsLeft, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [sleevePositionsLeft]);
  const sleeveGeometryRight = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, SLEEVE_RING_COLS - 1, SLEEVE_RING_ROWS - 1);
    const positionAttr = new THREE.BufferAttribute(sleevePositionsRight, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", positionAttr);
    return g;
  }, [sleevePositionsRight]);

  // 46번(프록시 바인딩): 화면에 실제로 그리는 지오메트리는 이 저해상도
  // (frontGeometry/backGeometry) 대신 훨씬 촘촘한 별도 지오메트리를 쓴다 —
  // 이 둘은 더 이상 렌더링용이 아니라, 매 프레임 워커 결과를 받아 법선을
  // 계산하는 "데이터 원본"(물리 프록시) 역할만 한다. position/uv는
  // PlaneGeometry 기본값 그대로 두고(어차피 셰이더가 덮어씀) 실제로
  // 쓰는 건 uv뿐이다.
  // 범위 B 구현 5번: 뒤판엔 앞판(showFrontWireframe)과 달리 "전체 폭 유지"
  // 디버그 토글이 없어 backRenderGeometry가 아래 메인 메시 전환 이후
  // 완전히 미사용이 됐다 — noUnusedLocals라 제거. 구 플랩 자체(물리 격자,
  // addSleeveUnderarmSeamConstraints, frontSleeveRenderGeometry 등 실제
  // "구 플랩" 시스템)는 안 건드렸다 — 이건 그 시스템이 아니라 이 렌더
  // 전환으로 생긴 부산물 변수 하나였을 뿐이다.
  const frontRenderGeometry = useMemo(
    () => new THREE.PlaneGeometry(1, 1, (COLS - 1) * renderSubdiv, (ROWS - 1) * renderSubdiv),
    [renderSubdiv],
  );
  // 47번(디버그 전용): 영역별 와이어프레임 토글용 부분 지오메트리. 몸통은
  // [torsoSleeveMin, torsoSleeveMax], 소매는 그 밖의 양쪽(x<min, x>max)
  // 두 구간이다(buildSleeveRegionGeometry). frontTorsoRenderGeometry는
  // "전 영역 표시" 진단 모드에서만 쓴다 — 기존 showFrontWireframe 토글은
  // 그대로 전체 앞판(frontRenderGeometry)을 쓴다.
  const frontTorsoRenderGeometry = useMemo(
    () => buildRegionPlaneGeometry(torsoSleeveMin, torsoSleeveMax, COLS, ROWS, renderSubdiv),
    [torsoSleeveMin, torsoSleeveMax, renderSubdiv],
  );
  const backTorsoRenderGeometry = useMemo(
    () => buildRegionPlaneGeometry(torsoSleeveMin, torsoSleeveMax, COLS, ROWS, renderSubdiv),
    [torsoSleeveMin, torsoSleeveMax, renderSubdiv],
  );
  const frontSleeveRenderGeometry = useMemo(
    () => buildSleeveRegionGeometry(torsoSleeveMin, torsoSleeveMax, COLS, ROWS, renderSubdiv),
    [torsoSleeveMin, torsoSleeveMax, renderSubdiv],
  );
  const backSleeveRenderGeometry = useMemo(
    () => buildSleeveRegionGeometry(torsoSleeveMin, torsoSleeveMax, COLS, ROWS, renderSubdiv),
    [torsoSleeveMin, torsoSleeveMax, renderSubdiv],
  );
  // 범위 B 구현 5번: 새 독립 소매 패널의 실제 렌더 지오메트리(원통, wrap
  // 닫힘) — 위 frontSleeveRenderGeometry(구 플랩 디버그용, 몸통 밖 두
  // 구간)와는 다른 물건이다. 해상도는 문서 결정 #2(12각형이면 각짐 없음)
  // 그대로 — RENDER_SUBDIV 세분화 없이 원본 SLEEVE_RING_COLS×ROWS 그대로 쓴다.
  const sleeveTubeGeometryLeft = useMemo(() => buildSleeveTubeGeometry(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);
  const sleeveTubeGeometryRight = useMemo(() => buildSleeveTubeGeometry(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);
  // 문서 21번: 이음매를 덮는 폴리곤이 하나도 없어 생기는 구멍을 메우는 렌더
  // 전용 띠. 1단계 어깨선(0.8cm)이 화면 확인에서 법선 아티팩트 없이 통과해,
  // 2단계로 실제 주범인 암홀 링(2.7cm, 좌우 2개)을 같은 메커니즘에 쌍 목록만
  // 추가했다 — 스트립 = (순서있는 쌍 목록, closed 플래그) 형태 그대로.
  const seamBridge = useMemo(() => {
    const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
    return buildSeamBridge([
      shoulderSeamStrip(torsoSleeveMin, torsoSleeveMax, COLS),
      // 좌/우 대응은 buildUnifiedGarmentSim의 addSleeveArmholeSeam 호출부와 동일:
      // 왼팔 소매 ↔ xMin, 오른팔 소매 ↔ xMax.
      armholeSeamStrip("armholeLeft", torsoSleeveMin, "sleeveLeft", armholeStartRow, COLS),
      armholeSeamStrip("armholeRight", torsoSleeveMax, "sleeveRight", armholeStartRow, COLS),
      // 3단계: 옆선(겨드랑이~밑단). 암홀 링의 겨드랑이 쿼드와 변 하나를 공유해
      // 이어진다 — 시작 행이 armholeStartRow로 같기 때문(문서 21-4).
      sideSeamStrip("sideLeft", torsoSleeveMin, armholeStartRow, ROWS, COLS),
      sideSeamStrip("sideRight", torsoSleeveMax, armholeStartRow, ROWS, COLS),
    ]);
  }, [torsoSleeveMin, torsoSleeveMax]);
  // onmessage 클로저는 torsoSleeveMin/Max를 deps에 안 갖고 있어 사이즈 변경 시
  // 낡은 seamBridge를 붙들 수 있다 — torsoColumnRangeRef와 같은 ref 패턴으로
  // 항상 현재 것을 보게 한다(지오메트리와 쌍 테이블이 같은 useMemo에서 나오므로
  // 둘이 어긋날 일도 없다).
  const seamBridgeRef = useRef(seamBridge);
  seamBridgeRef.current = seamBridge;
  const frontPosTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const backPosTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const frontNormalTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const backNormalTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  // 47번(핏 맵): posTex/normalTex와 같은 방식 — R 채널에 여유(cm) 스칼라만 담는다.
  const frontFitTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const backFitTex = useMemo(() => makeDataTexture(COLS, ROWS), []);
  const sleevePosTexLeft = useMemo(() => makeDataTexture(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);
  const sleevePosTexRight = useMemo(() => makeDataTexture(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);
  const sleeveNormalTexLeft = useMemo(() => makeDataTexture(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);
  const sleeveNormalTexRight = useMemo(() => makeDataTexture(SLEEVE_RING_COLS, SLEEVE_RING_ROWS), []);

  // 46번 실측(버그): 앞판(frontGeometry)에 원본 texture를 그대로 물렸더니
  // 글자가 거울상으로 뒤집혀 보였다(사용자 스크린샷으로 확인, "TINY
  // BEAR"가 반전). 원인은 layoutTorsoPanels가 앞판 정점을 배치할 때 쓰는
  // 부호 규칙(u→X 변환)이 PlaneGeometry의 기본 UV 방향과 반대라서 —
  // 즉 이 원단 좌우 반전 보정은 원래 "뒤판"이 아니라 "앞판"에 필요했던
  // 것이었다. 두 메시에 물리는 텍스처를 맞바꿔, 반전 보정본은 앞판에,
  // 원본은 뒤판에 쓴다. 47번: 합성된 캔버스 텍스처(compositedTexture)에도
  // 그대로 적용된다.
  const mirroredTexture = useMemo(() => {
    const clone = compositedTexture.clone();
    clone.repeat.x = -1;
    clone.offset.x = 1;
    clone.needsUpdate = true;
    return clone;
  }, [compositedTexture]);

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
  // 범위 B(소매 재설계) 조사용 — torsoColumnRange는 자세(팔 각도)에 따라
  // 매 프레임 바뀔 수 있어(useFrame 안에서 재계산), window.__fitDebug 함수가
  // React state가 아니라 이 ref로 최신 xMin/xMax를 동기적으로 읽는다.
  const torsoColumnRangeRef = useRef({ xMin: 0, xMax: COLS - 1 });
  // bodyGapChannels 디버그용 — rebuildCollision effect가 워커로 보내는 것과
  // 같은 토르소 캡슐의 최신본(같은 물체를 봐야 stale 함정이 없다).
  const torsoCapsulesRef = useRef<Capsule[] | null>(null);
  // M0(fixture 수출용): 마지막 "init" 레이아웃과 마지막 "step" 포즈를 그대로
  // 보관 — exportCollision()이 워커가 실제로 받은 값과 동일한 것을 내보내야
  // Node 재현이 의미 있다(다시 계산하면 미세하게 어긋날 수 있음).
  const lastInitLayoutRef = useRef<{ widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number } | null>(null);
  const lastStepPoseRef = useRef<Extract<MainToGarmentWorkerMessage, { type: "step" }> | null>(null);
  // 범위 B 구현 1번(격자 생성) 검증용 — 워커가 "init"마다 한 번 보내는
  // gridDebug(물리 이전 순수 초기 배치)를 그대로 들고 있는다.
  const sleeveGridDebugRef = useRef<Extract<GarmentWorkerToMainMessage, { type: "gridDebug" }> | null>(null);

  // 범위 B(소매 재설계) 조사 — 몸판 암홀 가장자리(왼쪽: 열 x=xMin,
  // row0~armholeStartRow, 앞판+뒤판 총 12정점)를 실측한다. row0(어깨,
  // 앞뒤 공유)부터 시작해 앞판을 타고 내려간 뒤 뒤판을 타고 올라오는
  // "위→앞→아래→뒤" 순서로 정점을 이어 인접 거리를 찍는다 — 큰 점프가
  // 있으면 그 지점에서 고리가 안 닫힌다는 뜻이다(현재 구조에서는 안
  // 닫힐 걸로 예상 — addSleeveUnderarmSeamConstraints가 겨드랑이를
  // armholeStartRow가 아니라 ARM_ROWS에서 잇고 있어서 서로 다른 행을
  // 기준으로 한다). 마운트 시 한 번만 등록해 __fitDebug 객체가 매 프레임
  // 교체돼도(위 useFrame 참고) 이 함수는 안 사라진다 — 콘솔에서
  // `window.__fitDebug.armholeCheck()` 직접 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.armholeCheck = () => {
      const { xMin } = torsoColumnRangeRef.current;
      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      const col = xMin;
      type Pt = { panel: "front" | "back"; row: number; col: number; x: number; y: number; z: number };
      const pts: Pt[] = [];
      for (let y = 0; y <= armholeStartRow; y++) {
        const i = (y * COLS + col) * 3;
        pts.push({ panel: "front", row: y, col, x: frontPositions[i], y: frontPositions[i + 1], z: frontPositions[i + 2] });
      }
      for (let y = 0; y <= armholeStartRow; y++) {
        const i = (y * COLS + col) * 3;
        pts.push({ panel: "back", row: y, col, x: backPositions[i], y: backPositions[i + 1], z: backPositions[i + 2] });
      }
      const frontHalf = pts.slice(0, armholeStartRow + 1); // front row0(어깨)→armholeStartRow(겨드랑이 쪽)
      const backHalf = pts.slice(armholeStartRow + 1).slice().reverse(); // back armholeStartRow→row0(어깨)
      const loop = [...frontHalf, ...backHalf];
      const distances = loop.map((a, idx) => {
        const b = loop[(idx + 1) % loop.length];
        const cm = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100;
        return { from: `${a.panel}${a.row}`, to: `${b.panel}${b.row}`, cm: Number(cm.toFixed(3)) };
      });
      const result = { armholeStartRow, col, points: pts, loopOrder: loop.map((p) => `${p.panel}${p.row}`), distances };
      console.log("[ARMHOLE-CHECK]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions]);

  // 천-몸 이탈 채널(어깨/몸통/밑단) — Node 하네스(paramSweep)와 완전히 같은
  // 공식(drapeMetrics.ts computeBodyGapChannels 공유)을 워커 실좌표(BVH/
  // 스무딩/자체충돌 포함 파이프라인 결과인 front/backPositions)에 대고
  // 실행한다. C단계류(소프트 풀) 실패가 하네스에서 원리적으로 안 잡혀
  // (실패 원인 물리가 하네스에 없음) 브라우저 측 게이트로 신설.
  // 마운트 시 한 번만 등록(armholeCheck과 같은 이유) — 콘솔에서
  // `window.__fitDebug.bodyGapChannels()` 직접 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.bodyGapChannels = () => {
      const capsules = torsoCapsulesRef.current;
      if (!capsules) {
        console.log("[BODY-GAP] 캡슐 아직 없음(초기화 대기) — 잠시 후 다시 호출");
        return null;
      }
      // front/backPositions를 GridView로 감싼다 — 패널 0=앞판, 1=뒤판.
      const n = PARTICLES_PER_PANEL;
      const positions = new Float32Array(n * 2 * 3);
      positions.set(frontPositions, 0);
      positions.set(backPositions, n * 3);
      const view: GridView = {
        panelDims: [
          { cols: COLS, rows: ROWS },
          { cols: COLS, rows: ROWS },
        ],
        positions,
        index: (panel, x, y) => panel * n + y * COLS + x,
      };
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      // 대역 정의는 bodyGapBands(단일 출처) — paramSweep.ts와 자동 동일.
      const [shoulder, shoulderFree, torso, hem] = computeBodyGapChannels(
        view,
        [0, 1],
        capsules,
        bodyGapBands(armholeStartRow, ROWS),
        xMin,
        xMax,
      );
      const result = { xMin, xMax, shoulder, shoulderFree, torso, hem };
      console.log("[BODY-GAP]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions]);

  // 소매 범위 B 별개 이슈(뒤판 겨드랑이 캡슐 침투) 조사용 — 지정한 행(기본
  // row4)의 front/back 정점이 왼팔 캡슐(armCapsuleCollision과 완전히 같은
  // 점-선분 거리 + margin 6mm)까지 얼마나 여유가 있는지 잰다. row5는 이미
  // 실측했고(back -1.7mm 침투), row4가 같은 문제를 갖는지 확인하려는 용도.
  // 마운트 시 한 번만 등록(armholeCheck과 같은 이유) — 콘솔에서
  // `window.__fitDebug.armCapsuleRowCheck(4)` 직접 호출(인자 생략 시 row4).
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.armCapsuleRowCheck = (row = 4) => {
      const trueShoulder = win.__fitDebug!.armTrueShoulderLeft as { x: number; y: number; z: number } | undefined;
      const dir = win.__fitDebug!.armDirLeft as { x: number; y: number; z: number } | undefined;
      const length = win.__fitDebug!.armLength as number | undefined;
      if (!trueShoulder || !dir || length === undefined) {
        console.log("[ARM-CAPSULE-ROW-CHECK] 아직 준비 안 됨(마운트 직후) — 잠시 후 다시 호출");
        return null;
      }
      const midLength = length * 0.55;
      const endLength = length * 1.25;
      const mid = { x: trueShoulder.x + dir.x * midLength, y: trueShoulder.y + dir.y * midLength, z: trueShoulder.z + dir.z * midLength };
      const end = { x: trueShoulder.x + dir.x * endLength, y: trueShoulder.y + dir.y * endLength, z: trueShoulder.z + dir.z * endLength };
      // garmentWorker.ts buildArmCapsules / torsoCapsule.ts applyCapsuleCollision과 동일한 공식(margin=6mm).
      const capsules = [
        { top: trueShoulder, bottom: mid },
        { top: mid, bottom: end },
      ];
      const clearanceMm = (px: number, py: number, pz: number) => {
        let best = Infinity;
        for (const c of capsules) {
          const abx = c.bottom.x - c.top.x;
          const aby = c.bottom.y - c.top.y;
          const abz = c.bottom.z - c.top.z;
          const abLenSq = abx * abx + aby * aby + abz * abz;
          const apx = px - c.top.x;
          const apy = py - c.top.y;
          const apz = pz - c.top.z;
          const t = abLenSq > 1e-9 ? THREE.MathUtils.clamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1) : 0;
          const cx = c.top.x + abx * t;
          const cy = c.top.y + aby * t;
          const cz = c.top.z + abz * t;
          const dist = Math.hypot(px - cx, py - cy, pz - cz);
          const clearance = dist - (ARM_COLLISION_RADIUS + 0.006);
          if (clearance < best) best = clearance;
        }
        return Number((best * 1000).toFixed(2));
      };
      const { xMin } = torsoColumnRangeRef.current;
      const col = xMin;
      const fi = (row * COLS + col) * 3;
      const bi = (row * COLS + col) * 3;
      const front = { x: frontPositions[fi], y: frontPositions[fi + 1], z: frontPositions[fi + 2] };
      const back = { x: backPositions[bi], y: backPositions[bi + 1], z: backPositions[bi + 2] };
      const result = {
        row,
        col,
        front: { ...front, clearanceMm: clearanceMm(front.x, front.y, front.z) },
        back: { ...back, clearanceMm: clearanceMm(back.x, back.y, back.z) },
      };
      console.log("[ARM-CAPSULE-ROW-CHECK]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions]);

  // 범위 B 구현 1번(격자 생성) 검증 — 4개 항목. gridDebug는 sim 생성 직후
  // (물리 이전) 순수 초기 배치라 시접 거리/신장 길이가 흔들리지 않는다.
  // 마운트 시 한 번만 등록(armholeCheck과 같은 이유) — 콘솔에서
  // `window.__fitDebug.sleeveGridCheck()` 직접 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.sleeveGridCheck = () => {
      const dbg = sleeveGridDebugRef.current;
      if (!dbg) {
        console.log("[SLEEVE-GRID-CHECK] gridDebug 아직 없음(초기화 대기)");
        return null;
      }
      const ringN = SLEEVE_RING_COLS * SLEEVE_RING_ROWS;
      const countNonZero = (arr: Float32Array): number => {
        let n = 0;
        for (let i = 0; i < ringN; i++) {
          const ix = i * 3;
          if (arr[ix] !== 0 || arr[ix + 1] !== 0 || arr[ix + 2] !== 0) n++;
        }
        return n;
      };

      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const torsoPt = (panel: Float32Array, col: number, row: number) => {
        const i = (row * COLS + col) * 3;
        return { x: panel[i], y: panel[i + 1], z: panel[i + 2] };
      };
      // idx0-5=front row0..armholeStartRow, idx6-11=back armholeStartRow..0(역순)
      const ringVerts = (col: number) => {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let y = 0; y <= armholeStartRow; y++) pts.push(torsoPt(dbg.front, col, y));
        for (let y = armholeStartRow; y >= 0; y--) pts.push(torsoPt(dbg.back, col, y));
        return pts;
      };
      const leftArmhole = ringVerts(xMin);
      const rightArmhole = ringVerts(xMax);

      const sleevePt = (sleeve: Float32Array, k: number, r: number) => {
        const i = (r * SLEEVE_RING_COLS + k) * 3;
        return { x: sleeve[i], y: sleeve[i + 1], z: sleeve[i + 2] };
      };
      const cm = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Number((Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100).toFixed(4));

      const row0Diff = (sleeve: Float32Array, armhole: { x: number; y: number; z: number }[]) =>
        Array.from({ length: SLEEVE_RING_COLS }, (_, k) => cm(sleevePt(sleeve, k, 0), armhole[k]));

      const lastRow = SLEEVE_RING_ROWS - 1;
      const rowLastReach = (sleeve: Float32Array, armhole: { x: number; y: number; z: number }[]) =>
        Array.from({ length: SLEEVE_RING_COLS }, (_, k) => cm(sleevePt(sleeve, k, lastRow), armhole[k]));

      const armDirLeft = win.__fitDebug!.armDirLeft as { x: number; y: number; z: number } | undefined;
      const armDirRight = win.__fitDebug!.armDirRight as { x: number; y: number; z: number } | undefined;
      const armLength = win.__fitDebug!.armLength as number | undefined;

      const result = {
        // 1) panel 2·3 정점 채움 여부(0,0,0이 아닌 개수 / 144)
        filled: { sleeveLeft: countNonZero(dbg.sleeveLeft), sleeveRight: countNonZero(dbg.sleeveRight), expectedEach: ringN },
        // 2) row0 12점이 armholeVertex와 좌표 일치(시접 0cm 기대)
        row0SeamDistanceCm: { left: row0Diff(dbg.sleeveLeft, leftArmhole), right: row0Diff(dbg.sleeveRight, rightArmhole) },
        // 3) row(rows-1)가 armDir*armLength만큼 뻗었는지(armhole점 기준 거리 ≈ armLength*100cm)
        // 단면 원형화 재설계(layoutSleevePanel, buildGarmentSim.ts) 이후로는 이
        // "≈armLength" 기대가 더 이상 안 맞는다 — row(rows-1)이 순수 팔축
        // 방향으로만 안 뻗고 이상원 쪽으로 완전히 블렌드돼(슬릿 정점의 실제
        // 각도가 이상각과 최대 177° 어긋남, 실측 확인) 축+반경이 섞인 거리가
        // 됨. k마다 15~29cm로 들쭉날쭉해도 회귀 아님 — expectedReachCm과 직접
        // 비교하는 자동 체크를 추가하지 말 것.
        rowLastReachCm: { left: rowLastReach(dbg.sleeveLeft, leftArmhole), right: rowLastReach(dbg.sleeveRight, rightArmhole) },
        expectedReachCm: armLength !== undefined ? Number((armLength * 100).toFixed(2)) : null,
        armDirLeft,
        armDirRight,
        // 4) panelParticleStart(0)/(1)이 여전히 몸판을 가리키는지
        panelParticleStart: { front: dbg.panelParticleStart[0], back: dbg.panelParticleStart[1], sleeveLeft: dbg.panelParticleStart[2], sleeveRight: dbg.panelParticleStart[3] },
        panelParticleCount: { front: dbg.panelParticleCount[0], back: dbg.panelParticleCount[1], sleeveLeft: dbg.panelParticleCount[2], sleeveRight: dbg.panelParticleCount[3] },
        expectedFrontStart: 0,
        expectedBackStart: PARTICLES_PER_PANEL,
        frontRow0First3: [dbg.front[0], dbg.front[1], dbg.front[2]],
        backRow0First3: [dbg.back[0], dbg.back[1], dbg.back[2]],
      };
      console.log("[SLEEVE-GRID-CHECK]", JSON.stringify(result));
      return result;
    };
  }, []);

  // 범위 B 구현 4번(봉제선 연결) 검증 — sleeveGridCheck과 달리 "step" 응답이
  // 갱신할 때마다 바뀌는 살아있는 위치(frontPositions/backPositions/
  // sleevePositionsLeft/Right)를 읽는다 — 물리가 몇 프레임 돌아간 뒤
  // addSleeveArmholeSeam의 어깨 코너 이즈인(k=0/k=마지막, SEAM_EASE_START)이
  // 실제로 SEAM_REST_LENGTH 근처로 수렴하는지, 나머지(k=1..10)는 여전히
  // 0에 가까운지(회귀 감시)를 프레임마다 콘솔에서 직접 확인하려는 용도.
  // 마운트 시 한 번만 등록 — 콘솔에서 `window.__fitDebug.sleeveSeamCheck()`
  // 직접 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.sleeveSeamCheck = () => {
      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const torsoPt = (arr: Float32Array, col: number, row: number) => {
        const i = (row * COLS + col) * 3;
        return { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
      };
      const sleevePt = (arr: Float32Array, k: number, r: number) => {
        const i = (r * SLEEVE_RING_COLS + k) * 3;
        return { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
      };
      const cm = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Number((Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100).toFixed(4));
      // armholeRingVertices(buildGarmentSim.ts)와 같은 순서: idx0..armholeStartRow=front
      // row0..armholeStartRow, idx(armholeStartRow+1)..마지막=back armholeStartRow..0(역순).
      const ringVerts = (col: number) => {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let y = 0; y <= armholeStartRow; y++) pts.push(torsoPt(frontPositions, col, y));
        for (let y = armholeStartRow; y >= 0; y--) pts.push(torsoPt(backPositions, col, y));
        return pts;
      };
      const seamDistancesCm = (col: number, sleeve: Float32Array) => {
        const armhole = ringVerts(col);
        return armhole.map((pt, k) => cm(pt, sleevePt(sleeve, k, 0)));
      };
      const left = seamDistancesCm(xMin, sleevePositionsLeft);
      const right = seamDistancesCm(xMax, sleevePositionsRight);
      const result = {
        left,
        right,
        // k=0/마지막은 이즈인(SEAM_EASE_START=3cm 목표), k=1..(마지막-1)은 SEAM_REST_LENGTH 목표.
        easedCornerTargetCm: 3,
        directTargetCm: Number((SEAM_REST_LENGTH * 100).toFixed(2)),
      };
      console.log("[SLEEVE-SEAM-CHECK]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions, sleevePositionsLeft, sleevePositionsRight]);

  // 어깨-소매 접합부 톱니(sleeve-redesign-B.md 다음 세션 지점) — 이음매
  // (col=0 vs col=SLEEVE_RING_COLS-1) 법선이 averageSleeveSeamNormals 보정
  // 후 실제로 일치하는지 지정 row에서 확인. 콘솔에서
  // `window.__fitDebug.sleeveSeamNormalCheck(0)` / `(6)` / `(11)` 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.sleeveSeamNormalCheck = (row = 0) => {
      const read = (geometry: THREE.BufferGeometry, side: "left" | "right") => {
        const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
        const iFirst = row * SLEEVE_RING_COLS;
        const iLast = row * SLEEVE_RING_COLS + (SLEEVE_RING_COLS - 1);
        const first = { x: normal.getX(iFirst), y: normal.getY(iFirst), z: normal.getZ(iFirst) };
        const last = { x: normal.getX(iLast), y: normal.getY(iLast), z: normal.getZ(iLast) };
        const diff = Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
        return { side, row, first, last, diffMagnitude: Number(diff.toFixed(6)) };
      };
      const result = [read(sleeveGeometryLeft, "left"), read(sleeveGeometryRight, "right")];
      console.log("[SLEEVE-SEAM-NORMAL-CHECK]", JSON.stringify(result));
      return result;
    };
  }, [sleeveGeometryLeft, sleeveGeometryRight]);

  // 이음매 커버리지 진단 — 어느 구간이 시임 브리지로 덮여 있고, 어느 구간이
  // 아직 폴리곤 없이 뚫려 있는지 가른다.
  //
  // 배경(문서 21번): 앞판/뒤판/소매는 각자 별개 BufferGeometry + 별개 위치
  // 텍스처라, 원래 이음매를 잇는 폴리곤이 하나도 없었다 — 물리 제약으로만
  // 붙어 있어서 물리가 6mm까지 좁혀도 화면엔 그대로 구멍이었다. seamBridge가
  // 그중 어깨선과 암홀 링을 덮었고, 이 훅은 (a) 브리지가 실제로 몇 개
  // 삼각형으로 무엇을 덮고 있는지와 (b) 아직 안 덮인 이음매의 개구폭을
  // 나눠서 보고한다.
  //
  // **bridgedSpanCm은 "구멍 폭"이 아니라 "브리지가 덮고 있는 폭"이다** —
  // 값이 커도 결함이 아니다(그만큼 넓은 띠가 덮고 있다는 뜻). 진짜 구멍은
  // unbridgedSpanCm 쪽이다.
  // 콘솔에서 `window.__fitDebug.shoulderGapGeometry()` 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.shoulderGapGeometry = () => {
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const arrays = {
        front: frontPositions,
        back: backPositions,
        sleeveLeft: sleevePositionsLeft,
        sleeveRight: sleevePositionsRight,
      };
      const refPt = (ref: { source: keyof typeof arrays; index: number }) => {
        const arr = arrays[ref.source];
        const i = ref.index * 3;
        return { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
      };
      const cm = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Number((Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100).toFixed(3));
      const maxOf = (a: number[]) => (a.length === 0 ? 0 : Number(Math.max(...a).toFixed(3)));

      // (a) 브리지가 실제로 무엇을 덮고 있나 — 지오메트리에서 직접 센다
      // (예전엔 여기가 "구조적으로 0"이라고 하드코딩돼 있었다).
      const bridge = seamBridgeRef.current;
      const bridgeIndex = bridge.geometry.getIndex();
      const perStrip = bridge.layouts.map(({ strip }) => {
        const p = strip.pairs.length;
        return { name: strip.name, pairs: p, closed: strip.closed, triangles: 2 * (strip.closed ? p : p - 1) };
      });
      // 스트립별 폭 = 각 쌍의 두 정점 사이 거리(=그 자리에서 띠가 덮는 폭).
      const bridgedSpanCm = Object.fromEntries(
        bridge.layouts.map(({ strip }) => {
          const spans = strip.pairs.map((pr) => cm(refPt(pr.a), refPt(pr.b)));
          return [strip.name, { perPair: spans, max: maxOf(spans) }];
        }),
      );

      // (b) 아직 안 덮인 구간이 있나 — 하드코딩하지 않고 실제 쌍 목록에서 훑는다.
      // (이 필드를 "옆선은 미봉합"으로 적어뒀다가 3단계에서 옆선을 덮는 순간
      // 곧바로 stale이 됐던 전례가 있다 — 그래서 사실을 적지 말고 도출한다.)
      //
      // 몸판 경계열(xMin/xMax)의 앞/뒤 각 행이 어느 스트립엔가 등장하는지 본다.
      // 등장하지 않는 행 = 그 자리에 폴리곤이 없다 = 구멍.
      const coveredTorso = new Set<string>();
      for (const { strip } of bridge.layouts) {
        for (const pr of strip.pairs) {
          for (const ref of [pr.a, pr.b]) {
            if (ref.source !== "front" && ref.source !== "back") continue;
            const row = Math.floor(ref.index / COLS);
            coveredTorso.add(`${ref.source}:${ref.index % COLS}:${row}`);
          }
        }
      }
      const uncoveredTorsoRows: string[] = [];
      for (const col of [xMin, xMax]) {
        for (const source of ["front", "back"] as const) {
          for (let y = 0; y < ROWS; y++) {
            if (!coveredTorso.has(`${source}:${col}:${y}`)) uncoveredTorsoRows.push(`${source} col${col} row${y}`);
          }
        }
      }

      // (c) 스트립 접합부 정점 일치 — 어깨 스트립 양 끝 쌍과 암홀 링의
      // 첫/마지막 쌍이 같은 몸판 정점을 참조해야 두 띠가 변 하나를 공유하며
      // 이어진다. 참조(source+index) 동일성과 실제 좌표 거리를 둘 다 본다.
      const stripByName = new Map(bridge.layouts.map(({ strip }) => [strip.name, strip]));
      const shoulder = stripByName.get("shoulder");
      const junction = ["armholeLeft", "armholeRight"].map((ringName) => {
        const ring = stripByName.get(ringName);
        if (!ring || !shoulder) return { ring: ringName, ok: false, note: "스트립 없음" };
        // 왼팔 링은 어깨 스트립의 첫 쌍(xMin), 오른팔 링은 마지막 쌍(xMax)과 만난다.
        const sh = ringName === "armholeLeft" ? shoulder.pairs[0] : shoulder.pairs[shoulder.pairs.length - 1];
        const ringFirst = ring.pairs[0]; // k=0 = front row0
        const ringLast = ring.pairs[ring.pairs.length - 1]; // k=마지막 = back row0
        const sameRef = (p: { source: string; index: number }, q: { source: string; index: number }) => p.source === q.source && p.index === q.index;
        return {
          ring: ringName,
          frontRefMatches: sameRef(ringFirst.a, sh.a),
          backRefMatches: sameRef(ringLast.a, sh.b),
          frontCoordDistCm: cm(refPt(ringFirst.a), refPt(sh.a)),
          backCoordDistCm: cm(refPt(ringLast.a), refPt(sh.b)),
        };
      });

      const result = {
        bridge: {
          triangles: bridgeIndex ? bridgeIndex.count / 3 : 0,
          strips: perStrip,
        },
        // 구멍 아님 — 브리지가 덮고 있는 폭.
        bridgedSpanCm,
        // 몸판 경계열에서 아직 어느 스트립에도 안 덮인 행(=구멍). 비어 있으면
        // 경계열은 전부 덮인 것. 목둘레/밑단/소맷부리는 애초에 열려 있어야 하는
        // 개구부라 여기 대상이 아니다(그 행들은 스트립에 등장하므로 안 잡힌다).
        uncoveredTorsoRows,
        stripJunction: junction,
      };
      console.log("[SEAM-COVERAGE]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions, sleevePositionsLeft, sleevePositionsRight]);

  // 톱니 정도를 링 전체로 일반화한 지표 — sleeveSeamNormalCheck는 wrap
  // 지점(첫/끝)만 비교하지만, 이번 조사(sleeveSeamCheck 실측)에서 코너
  // 인접 열(k1/k10)이 코너 자체보다 더 벌어지는 게 확인돼 wrap 지점만
  // 보는 걸로는 부족하다 — 링을 따라 인접(랩 포함) 정점쌍의 법선 각도차를
  // 전부 재서 분산/최댓값을 낸다. 값이 클수록 그 링을 따라 법선이 급격히
  // 꺾인다는(=톱니가 심하다는) 뜻. 콘솔에서
  // `window.__fitDebug.seamNormalJaggedness()` 호출.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.seamNormalJaggedness = () => {
      const readNormal = (geometry: THREE.BufferGeometry, i: number) => {
        const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
        return { x: normal.getX(i), y: normal.getY(i), z: normal.getZ(i) };
      };

      // armholeRingVertices/sleeveSeamCheck와 같은 순서: front row0..armholeStartRow,
      // back armholeStartRow..0(역순) — 어깨 wrap(k0↔k11)도 링으로 취급(문서 선례).
      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const armholeRingNormals = (col: number) => {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let y = 0; y <= armholeStartRow; y++) pts.push(readNormal(frontGeometry, y * COLS + col));
        for (let y = armholeStartRow; y >= 0; y--) pts.push(readNormal(backGeometry, y * COLS + col));
        return pts;
      };
      const sleeveRingNormals = (geometry: THREE.BufferGeometry, row = 0) => {
        const pts: { x: number; y: number; z: number }[] = [];
        for (let k = 0; k < SLEEVE_RING_COLS; k++) pts.push(readNormal(geometry, row * SLEEVE_RING_COLS + k));
        return pts;
      };

      // row0(어깨 캡)뿐 아니라 링 전체(row0~SLEEVE_RING_ROWS-1, 캡~소맷부리)를
      // 훑는다 — row0만 보면 캡 바깥(row3~8 등)의 톱니를 놓칠 수 있어서
      // (pattern-redesign.md 11번, 화면 확인 후 지표 확장 필요성 확인).
      const sleeveRowsJaggedness = (geometry: THREE.BufferGeometry) =>
        Array.from({ length: SLEEVE_RING_ROWS }, (_, row) => ringJaggedness(sleeveRingNormals(geometry, row)));
      const sleeveLeftRows = sleeveRowsJaggedness(sleeveGeometryLeft);
      const sleeveRightRows = sleeveRowsJaggedness(sleeveGeometryRight);

      const result = {
        // 암홀만 armholeRingJaggedness — maxDeg에서 앞판↔뒤판 경계 2곳
        // (어깨/겨드랑이)을 빼고, 뺀 값은 panelBoundaryDeg로 따로 본다
        // (seamDiagnostics.ts 주석 참고). 소매 링은 같은 패널 하나로 닫힌
        // 원통이라 기존 ringJaggedness 그대로.
        armholeLeft: armholeRingJaggedness(armholeRingNormals(xMin)),
        armholeRight: armholeRingJaggedness(armholeRingNormals(xMax)),
        sleeveLeftRows,
        sleeveRightRows,
        sleeveLeftMax: Number(Math.max(...sleeveLeftRows.map((r) => r.maxDeg)).toFixed(2)),
        sleeveRightMax: Number(Math.max(...sleeveRightRows.map((r) => r.maxDeg)).toFixed(2)),
      };
      console.log("[SEAM-NORMAL-JAGGEDNESS]", JSON.stringify(result));
      return result;
    };
  }, [frontGeometry, backGeometry, sleeveGeometryLeft, sleeveGeometryRight]);

  // pattern-redesign.md 다음 가설(탄젠트 매칭) 1번 — 위 세 시도(각도 재배분류)가
  // 전부 실패한 뒤 나온 가설: row0(=암홀, 위치는 정확히 일치)에서 소매가
  // "뻗어나가는 방향"이 몸판 표면이 그 자리에서 이어졌을 방향과 얼마나
  // 어긋나는지 실측한다 — 세 시도 전부 "position은 lerp, 각도/반지름 목표는
  // 새로 계산"이라 이 방향(도함수) 자체는 한 번도 직접 맞춘 적이 없었다.
  // 몸판 쪽 탄젠트: 같은 행(row)에서 암홀 열(xMin/xMax)과 그 바로 바깥
  // 열(xMin-1/xMax+1, 같은 패널의 소매 확장 열 — 구 플랩, 아직 살아있음)을
  // 잇는 방향 — "이 표면이 이음매를 넘어 계속됐다면 향했을 방향"의 근사.
  // 소매 쪽 탄젠트: 그냥 row0→row1 방향(소매가 실제로 처음 뻗는 방향).
  // 콘솔에서 `window.__fitDebug.sleeveRow0TangentCheck()` 호출 — 코드 변경
  // 없음, 순수 측정.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.sleeveRow0TangentCheck = () => {
      const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
      const { xMin, xMax } = torsoColumnRangeRef.current;
      const torsoPt = (arr: Float32Array, col: number, row: number) => {
        const i = (row * COLS + col) * 3;
        return { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
      };
      const sleevePt = (arr: Float32Array, k: number, r: number) => {
        const i = (r * SLEEVE_RING_COLS + k) * 3;
        return { x: arr[i], y: arr[i + 1], z: arr[i + 2] };
      };
      const normalize = (v: { x: number; y: number; z: number }) => {
        const len = Math.hypot(v.x, v.y, v.z) || 1e-9;
        return { x: v.x / len, y: v.y / len, z: v.z / len };
      };
      const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z,
      });

      // armholeRingVertices/sleeveSeamCheck와 같은 순서: front row0..armholeStartRow,
      // back armholeStartRow..0(역순) — (panel, row) 쌍을 k 순서대로 뽑는다.
      const ringRowPanels: Array<{ front: boolean; row: number }> = [];
      for (let y = 0; y <= armholeStartRow; y++) ringRowPanels.push({ front: true, row: y });
      for (let y = armholeStartRow; y >= 0; y--) ringRowPanels.push({ front: false, row: y });

      const sideCheck = (col: number, neighborCol: number, sleeveArr: Float32Array) => {
        const diffsDeg = ringRowPanels.map(({ front, row }, k) => {
          const panelArr = front ? frontPositions : backPositions;
          const torsoTangent = normalize(sub(torsoPt(panelArr, col, row), torsoPt(panelArr, neighborCol, row)));
          const sleeveTangent = normalize(sub(sleevePt(sleeveArr, k, 1), sleevePt(sleeveArr, k, 0)));
          return Number(angleDegBetweenNormals(torsoTangent, sleeveTangent).toFixed(2));
        });
        const maxDeg = Number(Math.max(...diffsDeg).toFixed(2));
        const meanDeg = Number((diffsDeg.reduce((s, d) => s + d, 0) / diffsDeg.length).toFixed(2));
        return { diffsDeg, maxDeg, meanDeg };
      };

      const result = {
        // 몸통 쪽 이웃 열이 그리드 밖으로 안 나가는지만 확인(구 플랩 열이 항상
        // 존재해 실무에서는 항상 참이지만, 극단적으로 좁은 소매/품 조합 대비 방어).
        left: xMin > 0 ? sideCheck(xMin, xMin - 1, sleevePositionsLeft) : null,
        right: xMax < COLS - 1 ? sideCheck(xMax, xMax + 1, sleevePositionsRight) : null,
      };
      console.log("[SLEEVE-ROW0-TANGENT-CHECK]", JSON.stringify(result));
      return result;
    };
  }, [frontPositions, backPositions, sleevePositionsLeft, sleevePositionsRight]);

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
      if (msg.type === "gridDebug") {
        sleeveGridDebugRef.current = msg;
        return;
      }
      if (msg.type !== "positions") return;
      pendingRef.current = false;
      if (msg.generation !== generationRef.current) return; // 낡은 세대의 응답은 버린다.

      frontPositions.set(msg.front);
      backPositions.set(msg.back);
      sleevePositionsLeft.set(msg.sleeveLeft);
      sleevePositionsRight.set(msg.sleeveRight);
      (frontGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (backGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (sleeveGeometryLeft.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (sleeveGeometryRight.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      frontGeometry.computeVertexNormals();
      backGeometry.computeVertexNormals();
      sleeveGeometryLeft.computeVertexNormals();
      sleeveGeometryRight.computeVertexNormals();
      averageSleeveSeamNormals(sleeveGeometryLeft, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
      averageSleeveSeamNormals(sleeveGeometryRight, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
      // 네 위치 배열이 다 갱신된 직후 — 시임 브리지는 그 배열들에서 좌표를
      // 그대로 복사하므로 여기가 올바른 지점이다(법선은 스트립 자체 기하에서
      // 뽑으므로 패널 법선 계산 순서와는 무관).
      updateSeamBridge(seamBridgeRef.current, {
        front: frontPositions,
        back: backPositions,
        sleeveLeft: sleevePositionsLeft,
        sleeveRight: sleevePositionsRight,
      });
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
      packXYZIntoRGBA(msg.sleeveLeft, sleevePosTexLeft.data);
      packXYZIntoRGBA(msg.sleeveRight, sleevePosTexRight.data);
      packXYZIntoRGBA(sleeveGeometryLeft.getAttribute("normal").array, sleeveNormalTexLeft.data);
      packXYZIntoRGBA(sleeveGeometryRight.getAttribute("normal").array, sleeveNormalTexRight.data);
      sleevePosTexLeft.texture.needsUpdate = true;
      sleevePosTexRight.texture.needsUpdate = true;
      sleeveNormalTexLeft.texture.needsUpdate = true;
      sleeveNormalTexRight.texture.needsUpdate = true;

      // 47번(핏 맵, 물리 무관): 워커가 같은 메시지에 실어 보낸 정점별
      // 여유(cm)를 위와 같은 방식으로 텍스처에 올린다.
      packScalarIntoR(msg.frontFit, frontFitTex.data);
      packScalarIntoR(msg.backFit, backFitTex.data);
      frontFitTex.texture.needsUpdate = true;
      backFitTex.texture.needsUpdate = true;

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
  }, [
    frontGeometry,
    backGeometry,
    sleeveGeometryLeft,
    sleeveGeometryRight,
    frontPositions,
    backPositions,
    sleevePositionsLeft,
    sleevePositionsRight,
    frontPosTex,
    backPosTex,
    frontNormalTex,
    backNormalTex,
    frontFitTex,
    backFitTex,
    sleevePosTexLeft,
    sleevePosTexRight,
    sleeveNormalTexLeft,
    sleeveNormalTexRight,
  ]);

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
    // M0(fixture 수출): 충돌 스냅샷(몸 메시/캡슐)+마지막 레이아웃·포즈를
    // JSON으로 다운로드 — Node 하네스(FIXTURE=경로 npm run sweep:pattern)가
    // 워커와 같은 환경을 재현하는 입력. 이 effect 안에 두는 이유: 아래
    // 워커 전송과 같은 굽기(collisionMesh.bake)·같은 캡슐 공식을 쓰는
    // 최신 클로저를 공유하기 위해서다.
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.exportCollision = () => {
      const layout = lastInitLayoutRef.current;
      const step = lastStepPoseRef.current;
      if (!layout || !step) {
        console.log("[EXPORT-COLLISION] init/step 아직 없음 — 옷 마운트 후 다시 호출");
        return null;
      }
      const baked = collisionMesh.bake(root);
      leftShoulder.updateWorldMatrix(true, false);
      rightShoulder.updateWorldMatrix(true, false);
      leftShoulder.getWorldPosition(shoulderVec);
      rightShoulder.getWorldPosition(rightShoulderVec);
      const proxy = buildTorsoProxyCapsules(
        { x: shoulderVec.x, y: shoulderVec.y, z: shoulderVec.z },
        { x: rightShoulderVec.x, y: rightShoulderVec.y, z: rightShoulderVec.z },
        bodySize.height / 100,
        bodySize.chest / 100,
      );
      const fixture = {
        layout,
        pose: {
          pinLeft: step.pinLeft,
          pinRight: step.pinRight,
          necklineLift: step.necklineLift,
          fabric: step.fabric,
          armLeft: step.armLeft,
          armRight: step.armRight,
        },
        collision: {
          position: Array.from(baked.position),
          frontIndex: baked.frontIndex ? Array.from(baked.frontIndex) : null,
          backIndex: baked.backIndex ? Array.from(baked.backIndex) : null,
          wholeBodyIndex: baked.wholeBodyIndex ? Array.from(baked.wholeBodyIndex) : null,
          capsules: proxy.capsules,
          centerZ: proxy.centerZ,
        },
      };
      const blob = new Blob([JSON.stringify(fixture)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "collision-fixture.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const summary = {
        positionFloats: baked.position.length,
        frontIndex: baked.frontIndex?.length ?? 0,
        backIndex: baked.backIndex?.length ?? 0,
        wholeBodyIndex: baked.wholeBodyIndex?.length ?? 0,
        capsules: proxy.capsules.length,
        fabric: step.fabric,
      };
      console.log("[EXPORT-COLLISION]", JSON.stringify(summary));
      return summary;
    };
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

      // bodyGapChannels 디버그가 워커와 같은 캡슐을 보도록 최신본을 ref에 보관.
      torsoCapsulesRef.current = capsules;

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
    // 47번(디버그 전용 와이어프레임) 영역 분할 경계.
    setTorsoSleeveMin(xMin);
    setTorsoSleeveMax(xMax);

    generationRef.current += 1;
    lastInitLayoutRef.current = { widthM, heightM, topY, centerZ, sleeveWidthM: garmentSize.sleeveWidth / 100 };
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
    // 범위 B: 이 객체를 통째로 교체하면 armholeCheck 같은 함수 프로퍼티가
    // 매 프레임 날아가므로, 아래에서는 새 객체로 덮어쓰지 않고 기존
    // 객체(마운트 시 만들어둔 것, armholeCheck 포함)에 매 프레임 값만
    // 병합한다.
    Object.assign((window as unknown as { __fitDebug: Record<string, unknown> }).__fitDebug, {
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
    });

    pendingDtRef.current += delta;
    // 워커가 아직 이전 step을 처리 중이면 이번 프레임은 건너뛴다(렌더는
    // 계속 진행되고, 옷감은 워커가 따라잡는 대로 갱신된다).
    if (pendingRef.current) return;
    pendingRef.current = true;
    const dt = pendingDtRef.current;
    pendingDtRef.current = 0;

    const { xMin, xMax } = torsoColumnRange(COLS, pins.left, pins.right, armShapes.left, armShapes.right);
    torsoColumnRangeRef.current = { xMin, xMax };
    const necklineLift = neckSurfaceBvh.ready ? Array.from(computeNecklineLift(neckSurfaceBvh, pins.left, pins.right, COLS, xMin, xMax)) : [];

    const stepMsg = {
      type: "step",
      dt,
      pinLeft: { x: pins.left.x, y: pins.left.y, z: pins.left.z },
      pinRight: { x: pins.right.x, y: pins.right.y, z: pins.right.z },
      necklineLift,
      fabric,
      armLeft: armShapes.left,
      armRight: armShapes.right,
      generation: generationRef.current,
    } satisfies MainToGarmentWorkerMessage;
    lastStepPoseRef.current = stepMsg;
    worker.postMessage(stepMsg);
  });

  // 임시 디버그 훅 — 어깨 근처에 나타나는 회색/무늬 없는 삼각형 조각이
  // 텍스처 로딩 실패인지 지오메트리 문제인지 확인하는 용도.
  (window as unknown as { __fitDebugTex?: unknown }).__fitDebugTex = {
    textureImageComplete: (rawTexture.image as HTMLImageElement | undefined)?.complete,
    textureImageSize: rawTexture.image
      ? [(rawTexture.image as HTMLImageElement).width, (rawTexture.image as HTMLImageElement).height]
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
  const frontFitMapOnBeforeCompile = useMemo(
    () => injectFitMapBinding(frontPosTex.texture, frontNormalTex.texture, frontFitTex.texture, COLS, ROWS),
    [frontPosTex, frontNormalTex, frontFitTex],
  );
  const backFitMapOnBeforeCompile = useMemo(
    () => injectFitMapBinding(backPosTex.texture, backNormalTex.texture, backFitTex.texture, COLS, ROWS),
    [backPosTex, backNormalTex, backFitTex],
  );
  // 범위 B 구현 5번: injectProxyBinding은 cols/rows로 이미 일반화돼 있어
  // 소매(SLEEVE_RING_COLS/ROWS)에도 그대로 재사용된다 — 새 셰이더 코드 없음.
  const sleeveLeftOnBeforeCompile = useMemo(
    () => injectProxyBinding(sleevePosTexLeft.texture, sleeveNormalTexLeft.texture, SLEEVE_RING_COLS, SLEEVE_RING_ROWS),
    [sleevePosTexLeft, sleeveNormalTexLeft],
  );
  const sleeveRightOnBeforeCompile = useMemo(
    () => injectProxyBinding(sleevePosTexRight.texture, sleeveNormalTexRight.texture, SLEEVE_RING_COLS, SLEEVE_RING_ROWS),
    [sleevePosTexRight, sleeveNormalTexRight],
  );

  return (
    <group>
      {/* 47번(디버그 전용 — "전 영역 표시" 진단 모드): 텍스처 완전 교체를
          위해, 그 모드가 켜져 있으면 원본 앞/뒤판 메시 자체를 렌더하지
          않는다(오버레이가 아니라 교체 — 아래 4구역 메시만 보이게 됨). */}
      {!showAllRegionsWireframe && (
        // 범위 B 구현 5번(렌더링 전환): 기본 경로는 몸통 폭만(frontTorsoRenderGeometry)
        // 그린다 — 구 플랩(frontRenderGeometry, 전체 폭)은 아직 지우지 않고
        // showFrontWireframe 토글 전용으로 남겨둔다(408행 기존 의도 유지 —
        // "전체 앞판과 비교"가 이 토글의 목적이라 여기서만 예외적으로 전체 폭).
        <mesh geometry={showFrontWireframe ? frontRenderGeometry : frontTorsoRenderGeometry} frustumCulled={false}>
          {showFitMap ? (
            // 47번(핏 맵 — 일반 기능): 텍스처 대신 여유(cm) 기반 색상.
            // customProgramCacheKey 필수 — three.js의 WebGLPrograms 캐시는
            // 렌더러 전역이고 onBeforeCompile 안에서 바꾼 셰이더 문자열은
            // 기본 캐시 키 계산에 안 들어간다. 안 주면 텍스처 머티리얼이
            // 이미 컴파일해둔 프로그램과 키가 같아 보여, 이 머티리얼은
            // onBeforeCompile이 아예 호출되지도 않고 그 프로그램을 그대로
            // 재사용해버린다(실측: 콘솔 로그로 onBeforeCompile 호출 자체가
            // 0회임을 확인).
            <meshStandardMaterial
              key="fit-map-front"
              side={THREE.DoubleSide}
              roughness={0.85}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
              onBeforeCompile={frontFitMapOnBeforeCompile}
              customProgramCacheKey={() => "fitMap"}
            />
          ) : showFrontWireframe ? (
            // 47번(디버그 전용): 텍스처 대신 와이어프레임만 — onBeforeCompile은
            // 그대로 넘겨야 실제 물리 시뮬레이션 위치(uPosTex)가 반영된다.
            // MeshStandardMaterial을 그대로 쓰는 이유는 위 injectProxyBinding
            // 주석 참고(MeshBasicMaterial은 gridUv를 선언하는 셰이더 청크 자체가 없음).
            // color만으로는 조명 각도에 따라 어둡게 보여(실측 확인) emissive를
            // 추가해 조명과 무관하게 항상 밝게 보이게 한다.
            <meshStandardMaterial
              key="front-wireframe"
              color="#00ff00"
              emissive="#00ff00"
              emissiveIntensity={1}
              wireframe
              depthTest={false}
              side={THREE.DoubleSide}
              onBeforeCompile={frontOnBeforeCompile}
            />
          ) : (
            <meshStandardMaterial
              key="front-textured"
              map={mirroredTexture}
              side={THREE.DoubleSide}
              roughness={0.85}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
              onBeforeCompile={frontOnBeforeCompile}
            />
          )}
        </mesh>
      )}
      {!showAllRegionsWireframe && (
        // 범위 B 구현 5번(렌더링 전환): 뒤판엔 앞판 같은 "전체 폭" 디버그
        // 토글이 없으므로(showBackTorsoWireframe은 이미 몸통 전용) 조건 없이
        // 바로 교체 — 구 플랩(backRenderGeometry) 정의 자체는 아직 안 지운다.
        <mesh geometry={backTorsoRenderGeometry} frustumCulled={false}>
          {showFitMap ? (
            // 47번(핏 맵 — 일반 기능): customProgramCacheKey 필요한 이유는
            // 위 앞판 블록 주석 참고.
            <meshStandardMaterial
              key="fit-map-back"
              side={THREE.DoubleSide}
              roughness={0.85}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
              onBeforeCompile={backFitMapOnBeforeCompile}
              customProgramCacheKey={() => "fitMap"}
            />
          ) : (
            <meshStandardMaterial
              key="back-textured"
              map={compositedTexture}
              side={THREE.DoubleSide}
              roughness={0.85}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
              onBeforeCompile={backOnBeforeCompile}
            />
          )}
        </mesh>
      )}
      {/* 범위 B 구현 5번(문서 결정 #4): 소매는 텍스처 map 없이 대표색
          (sleeveColor)만 — UV 매핑 자체가 필요 없다. onBeforeCompile은
          위치/법선 바인딩(injectProxyBinding)만, injectFitMapBinding류는
          핏 맵이 몸판 전용 기능이라 소매엔 적용 안 함. */}
      {!showAllRegionsWireframe && (
        <mesh geometry={sleeveTubeGeometryLeft} frustumCulled={false}>
          <meshStandardMaterial key="sleeve-left" color={sleeveColor} side={THREE.DoubleSide} roughness={0.85} onBeforeCompile={sleeveLeftOnBeforeCompile} />
        </mesh>
      )}
      {!showAllRegionsWireframe && (
        <mesh geometry={sleeveTubeGeometryRight} frustumCulled={false}>
          <meshStandardMaterial key="sleeve-right" color={sleeveColor} side={THREE.DoubleSide} roughness={0.85} onBeforeCompile={sleeveRightOnBeforeCompile} />
        </mesh>
      )}
      {/* 문서 21번(시임 브리지 1단계 — 어깨선): 위치가 이미 월드 좌표로
          들어있는 평범한 지오메트리라 onBeforeCompile이 아예 없다 —
          핏맵/와이어프레임/사진맵 셰이더 변형과 상호작용할 여지 자체가 없고,
          three.js 프로그램 캐시 사고(위 핏맵 주석 참고)와도 무관하다.
          색은 실제 봉제선처럼 대표색보다 살짝 어둡게. */}
      {!showAllRegionsWireframe && (
        <mesh geometry={seamBridge.geometry} frustumCulled={false}>
          <meshStandardMaterial key="seam-bridge" color={seamColor} side={THREE.DoubleSide} roughness={0.85} />
        </mesh>
      )}
      {/* 47번(디버그 전용): 영역별 와이어프레임 — showFrontWireframe(초록,
          전체 앞판)과 같은 방식(단색 머티리얼 교체)이지만, 기존 메시를
          바꿔치기하는 대신 별도 오버레이 메시로 얹는다(꺼져있을 때 아예
          렌더하지 않기 위함) — 각각 독립적으로 켜고 끌 수 있다. */}
      {showBackTorsoWireframe && (
        <mesh geometry={backTorsoRenderGeometry} frustumCulled={false}>
          <meshStandardMaterial
            color="#0000ff"
            emissive="#0000ff"
            emissiveIntensity={1}
            wireframe
            depthTest={false}
            side={THREE.DoubleSide}
            onBeforeCompile={backOnBeforeCompile}
          />
        </mesh>
      )}
      {showFrontSleeveWireframe && (
        <mesh geometry={frontSleeveRenderGeometry} frustumCulled={false}>
          <meshStandardMaterial
            color="#ff0000"
            emissive="#ff0000"
            emissiveIntensity={1}
            wireframe
            depthTest={false}
            side={THREE.DoubleSide}
            onBeforeCompile={frontOnBeforeCompile}
          />
        </mesh>
      )}
      {showBackSleeveWireframe && (
        <mesh geometry={backSleeveRenderGeometry} frustumCulled={false}>
          <meshStandardMaterial
            color="#ff8800"
            emissive="#ff8800"
            emissiveIntensity={1}
            wireframe
            depthTest={false}
            side={THREE.DoubleSide}
            onBeforeCompile={backOnBeforeCompile}
          />
        </mesh>
      )}
      {/* 47번(디버그 전용 — "전 영역 표시" 진단 모드): 4구역(앞판 몸통/뒤판
          몸통/앞판 소매/뒤판 소매)을 원본 텍스처 없이 항상 동시에 그린다 —
          개별 토글 상태와 무관하게 이 모드 하나로 독립 제어된다. 이 모드에서
          검은 픽셀이 남으면 어느 구역에도 안 속하는 정점이 있다는 뜻이다.

          한계 1(깊이 판단 불가): 4개 메시 전부 depthTest={false}라 실제
          앞/뒤 층위(카메라와의 거리)가 아니라 그리기 순서(JSX 나열 순서)로
          어느 색이 위에 보일지 정해진다 — "이 지점에서 뭐가 진짜 앞에 있나"
          같은 깊이 판단에는 이 모드를 쓸 수 없다(가려짐/겹침 확인용이 아님).

          한계 2(소매 색이 밑단까지 번짐): 영역 분할이 순수 열(column)
          기준이라(buildRegionPlaneGeometry의 uv 재매핑, x<xMin 또는
          x>xMax) 물리적으로 소매가 끝나는 지점(armFactor가 0이 되어
          실제로는 몸통 가장자리로 되돌아가는 행)과 무관하게, 그 열
          전체가 ROWS 끝(밑단)까지 전부 소매색으로 칠해진다 — 실제 소매
          모양(어깨~손목만)과 색칠된 범위(그 열의 세로 전체)가 다르다. */}
      {showAllRegionsWireframe && (
        <>
          <mesh geometry={frontTorsoRenderGeometry} frustumCulled={false}>
            <meshStandardMaterial
              color="#00ff00"
              emissive="#00ff00"
              emissiveIntensity={1}
              wireframe
              depthTest={false}
              side={THREE.DoubleSide}
              onBeforeCompile={frontOnBeforeCompile}
            />
          </mesh>
          <mesh geometry={backTorsoRenderGeometry} frustumCulled={false}>
            <meshStandardMaterial
              color="#0000ff"
              emissive="#0000ff"
              emissiveIntensity={1}
              wireframe
              depthTest={false}
              side={THREE.DoubleSide}
              onBeforeCompile={backOnBeforeCompile}
            />
          </mesh>
          <mesh geometry={frontSleeveRenderGeometry} frustumCulled={false}>
            <meshStandardMaterial
              color="#ff0000"
              emissive="#ff0000"
              emissiveIntensity={1}
              wireframe
              depthTest={false}
              side={THREE.DoubleSide}
              onBeforeCompile={frontOnBeforeCompile}
            />
          </mesh>
          <mesh geometry={backSleeveRenderGeometry} frustumCulled={false}>
            <meshStandardMaterial
              color="#ff8800"
              emissive="#ff8800"
              emissiveIntensity={1}
              wireframe
              depthTest={false}
              side={THREE.DoubleSide}
              onBeforeCompile={backOnBeforeCompile}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

useGLTF.preload(MODEL_URL);
