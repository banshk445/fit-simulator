// 목선 리프트 — row0 핀 목표를 마네킹 목/어깨 표면 위로 끌어올리는 보정값.
//
// Garment.tsx에서 이사(2026-07-29). 이유: 이 값은 fixture의
// `pose.necklineLift`로 **얼어붙어** 저장되기 때문에, 여기 로직을 고쳐도
// Node 하네스(paramSweep)는 옛 배열을 계속 읽어 변화가 안 잡힌다.
// 하네스가 같은 함수를 import해 fixture의 몸 메시(`collision.position` +
// `wholeBodyIndex` — 브라우저의 neckSurfaceBvh와 같은 입력)로 다시 계산할
// 수 있어야 게이트가 성립한다.
import * as THREE from "three";
import type { ArrayBvhCollision } from "./bvhFromArrays";

function smoothstep01(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}


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
// 46번 실측(버그): 목 구멍 경계에서 레이캐스팅 보정을 아예 껐다 켰다(if로
// 완전히 건너뜀) 했더니, 정확히 그 경계 열에서 리프트 값이 뚝 끊겨(옆
// 열은 보정 있음, 이 열은 0) 목선 곡선에 눈에 띄는 꺾임/톱니가 생겼다
// — 경계 근방 몇 열에 걸쳐 부드럽게 0으로 줄어들도록(smoothstep) 블렌드해
// 그 꺾임을 없앤다.
//
// △3-2 후속(C¹ 연속화) 2건:
// (1) 경계 위치를 `neckHoleColumnRange()`에서 받는다. 예전엔 여기 상수
//     `NECK_RAYCAST_MIN_ABS_U = 0.30`이 따로 있었는데, 패턴 쪽 경계는
//     `NECKLINE_HOLE_WIDTH_FRACTION/2 = 0.31`이었다 — **같은 선을 두 값으로
//     관리**하고 있었고 0.01만큼 어긋나 있었다(함정 5 계열: 사실을 적지 말고
//     도출할 것).
// (2) 블렌드 폭을 **격자에서 도출**한다. 고정 0.08은 몸통 열 간격(1/21 =
//     0.0476)의 1.7배라, smoothstep이 연속함수여도 격자에 찍히면 사실상
//     2점 계단이었다 — 실측 결과 이 안쪽 flank가 row0 곡률 첨두(-7.34mm
//     @열15)의 발생원이었다. 램프가 최소 이 열 수만큼은 걸치게 한다.
//     값(첨두 높이)은 안 건드린다 — LIFT 하향은 기각된 조작이다.
const NECK_RAYCAST_BLEND_COLS = 3;
// 46번(전면 재설계): 몸판 열이 이제 소매 끝까지 뻗어 있으므로, 여기서
// 쓰는 "열 위치 u"는 더 이상 pinLeft~pinRight 사이 어깨 폭 전체를
// 나타내지 않는다 — u=±0.5는 이제 소매 끝이지 어깨점이 아니다. 목선
// 레이캐스팅(그리고 그 기준이 되는 pinLeft~pinRight 보간)은 몸통 폭 안쪽
// 열(xMin~xMax, buildGarmentSim.ts의 torsoColumnRange)에서만 의미가
// 있다 — 그 바깥(소매 쪽, 핀 자체가 없는 열)은 raycasting 대상에서 뺀다.
export function computeNecklineLift(
  bvh: ArrayBvhCollision,
  pinLeft: THREE.Vector3,
  pinRight: THREE.Vector3,
  cols: number,
  xMin: number,
  xMax: number,
  // 목 구멍 열 경계 — 패턴(necklineRise)이 쓰는 것과 **같은 출처**
  // (neckHoleColumnRange)에서 받는다. 하드코딩·중복 상수 금지.
  neckHoleMin: number,
  neckHoleMax: number,
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
  if (torsoSpan <= 0) return lift;
  // 목 구멍 경계를 열 번호 → 같은 u 좌표계로 환산. 좌우 대칭이라 두 쪽
  // 크기를 평균 내 한 값으로 쓴다(반올림 잔차 흡수).
  const holeAbsU =
    (Math.abs((neckHoleMin - xMin) / torsoSpan - 0.5) + Math.abs((neckHoleMax - xMin) / torsoSpan - 0.5)) / 2;
  // 램프 폭 = max(격자 N열, 예전 고정폭) — 격자가 촘촘해져도 최소 N열은
  // 걸치고, 성겨져도 예전보다 좁아지지 않는다.
  const blendWidth = Math.max(NECK_RAYCAST_BLEND_COLS / torsoSpan, 0.08);
  for (let x = xMin; x <= xMax; x++) {
    const t = (x - xMin) / torsoSpan;
    const u = t - 0.5;
    const absU = Math.abs(u);
    if (absU < holeAbsU - blendWidth) continue;
    const blend = smoothstep01((absU - (holeAbsU - blendWidth)) / blendWidth);
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