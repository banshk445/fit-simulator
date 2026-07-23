import * as THREE from "three";

// "어깨 뼈"(findShoulderBones가 찾는 위팔 뼈대 루트)는 해부학적 관절
// 중심에 있어서, 실제로 눈에 보이는 어깨 캡(삼각근 표면)보다 몸 안쪽에
// 있다. 이 모델(Ch36)에서 직접 측정해보면(마네킹 메시를 어깨 높이에서
// 잘라 X축 최대값을 구함) 관절 위치는 중심에서 18.0cm인데 실제 어깨
// 표면은 24.3cm까지 나가 있다 — 약 6.3cm 차이. 중심에서 바깥쪽(어깨)
// 방향으로 이만큼 밀어내 실제 어깨 표면 근처에 핀이 오도록 보정한다.
//
// 47번: 이 값을 6.0cm→7.5cm→9.5cm→11.5cm로 계속 키워온 이력은 전부
// Z-fighting(핀이 표면에 너무 가까워 마네킹 메시와 옷감이 깊이 방향으로
// 겹쳐 렌더러가 매 프레임 어느 쪽을 앞에 그릴지 오락가락하던 문제)을
// "위치를 표면에서 멀리 띄워서" 우회하려던 시도였다 — 그 부작용으로
// 옷 어깨너비를 아무리 좁게 입력해도 이 마진(11.5cm)이 바닥값에 섞여
// 들어가 실제로는 절대 그보다 좁아지지 않는 클램프 버그가 됐다.
// Z-fighting은 이제 Garment.tsx의 폴리곤 오프셋(렌더 설정)으로 따로
// 해결했으므로, 이 상수는 원래 목적(실측값 6.3cm에 최소 여유만 더함)
// 으로 되돌린다.
export const SHOULDER_PIN_OUTSET = 0.065;

// 36번(큰 재설계): 예전엔 이 OUTSET이 핀 위치를 결정하는 유일한 변수였다
// — 옷의 어깨선이 항상 "몸 어깨 관절 + 고정 여유"에 고정되니, 옷 자체의
// 어깨너비를 아무리 다르게 입력해도 어깨 핀 위치(그리고 그로부터 계산되는
// 몸판 폭 테이퍼·소매 시작점)는 절대 안 바뀌는 구조였다 — "옷이 너무
// 좁다/넓다"는 핏을 확인할 방법이 애초에 없었다. 이제 핀은 "몸 중심에서
// 어깨 방향으로 옷의 실제 어깨너비/2만큼" 위치한다 — 옷이 좁으면 핀이
// 몸 중심 쪽으로 당겨지고(타이트/오프숄더가 아니라 좁은 핏), 넓으면
// 어깨 밖으로 늘어난다(드롭숄더).
//
// 36번 배포 직후 발견한 회귀(중요): 처음엔 이 바닥값을 고정 10cm로
// 잡았는데, 기본 어깨너비(45cm) 자체가 그 절반(22.5cm)이라 이 마네킹의
// 실제 어깨 표면을 벗어나는 데 필요한 거리(위 OUTSET 이력에서 실측·확정된
// 약 29.5cm = 관절 거리 18cm + OUTSET 11.5cm)보다 짧았다 — 기본값에서부터
// 핀이 마네킹 어깨 표면 안쪽에 박혀, 어깨가 충돌 처리로 밀려나며
// 부풀어보이고 목선이 가슴 쪽으로 무너지는(이전에 29~32번에서 이미
// 여러 차례 겪었던 것과 똑같은 증상) 회귀가 실측(사용자 스크린샷)으로
// 확인됐다. 바닥값은 고정 상수가 아니라 "이 몸에서 렌더링이 깨지지 않는
// 최소 거리"(관절 거리 + OUTSET, 즉 옛 기본 공식 그 자체)여야 한다 —
// 실제 옷 어깨너비가 이보다 넓으면 그 값을 그대로 따르고(정상적인 핏
// 차이가 보임), 이보다 좁으면(마네킹 골격보다 좁은 옷은 실제로도
// 어차피 옷이 아니라 골격 위에 얹힌 것처럼 보일 수밖에 없다) 렌더링이
// 깨지지 않는 선에서 멈춘다.
function surfaceClearanceHalfWidth(center: THREE.Vector3, joint: THREE.Vector3): number {
  return center.distanceTo(joint) + SHOULDER_PIN_OUTSET;
}

// 어깨 뼈대(관절)에서 수평으로만 밀어내던 것과 별개로, 실제로는 수직으로도
// 살짝 낮다 — 실측(Playwright evaluate로 굽힌 마네킹 표면 중 핀 좌표
// 반경 8cm 안의 최고 Y를 직접 스캔)해보니 핀 Y가 실제 어깨 표면
// 꼭대기보다 항상 약 1.8cm 낮았다. 사용자가 "옷이 어깨가 아니라
// 가슴에 있다"고 지적한 원인 중 하나 — 옷깃/어깨선 자체가 진짜 어깨
// 꼭대기보다 낮게 고정돼 있었다. 실측값(1.8cm)에 약간의 여유를 더해
// 2cm 위로 올린다(SHOULDER_PIN_OUTSET처럼 수평 오프셋과는 별개 축).
//
// 46번 실측(재조정): 이 1.8cm는 "핀 좌표(어깨 가장자리) 반경 8cm 안"만
// 스캔한 값이라, u가 0.5(어깨점)에 가까운 위치 기준이다. 그런데
// necklineRise는 u가 작아질수록(목 중심에 가까워질수록) row0을 원래도
// 더 들어올리지만, 그 사이(목 구멍 밖 ~ 어깨점 전) 구간은 어깨 캡(삼각근)
// 돔의 정점이 관절 위치보다 훨씬 더 높이 솟아있어(둥근 표면이라 중심에
// 가까울수록 정점이 더 높다) 이 2cm로는 부족했다 — 물리 복구 후
// 스크린샷에서 목-어깨 사이로 마네킹 어깨 캡이 fabric 위로 뻐끔히
// 솟아 보이는 문제가 재현됐다. 목선 폭/상승 조정(buildGarmentSim.ts)과
// 함께, 이 리프트 자체도 5.5cm로 늘려 row0 전체(어깨 가장자리뿐 아니라
// 그 안쪽 곡선까지)가 어깨 캡 정점보다 확실히 위에 오도록 여유를 더 준다.
//
// 47번(아웃셋 축소 후 재검증): OUTSET을 6.5cm로 되돌리면서 핀 위치 자체가
// 바뀌었으니 이 리프트도 다시 맞아야 하는지 실측했다 — 브라우저에서 실제
// 앱이 쓰는 것과 같은 BVH(neckSurfaceBvh)로 새 핀 좌표 반경 8cm 안의
// 마네킹 표면 최고 Y를 직접 재보니 필요한 리프트는 좌우 대칭으로 약
// 5.16cm였다. 현재 값(5.5cm)이 이보다 커서 이미 충분하므로 근거 없이
// 올리지 않는다 — 다만 이 5.16cm는 Node에서 GLB를 직접 로드해 스키닝을
// 재현하려다 실패한 뒤(SkinnedMesh.bindMatrix가 파싱 시점에 Armature의
// 스케일/회전과 안 맞게 얼어붙어 있어 정점이 엉뚱한 좌표로 튐 — 파일
// 자체의 본-메시 좌표계 불일치로 보이며 재조사 필요) 검증된 경로(브라우저
// BVH)로만 잰 값이다. 아웃셋이나 마네킹 모델이 다시 바뀌면 같은 방식으로
// 재측정할 것 — 눈대중으로 이 상수를 올리지 말 것.
export const SHOULDER_PIN_LIFT = 0.055;

// garmentHalfWidthM: 옷의 실제 어깨너비(실측 입력)/2. 생략하면(디버그 등
// 옛 호출부 호환용) 예전처럼 "몸 어깨 관절 + OUTSET"을 그대로 쓴다.
export function computeShoulderPin(
  left: THREE.Vector3,
  right: THREE.Vector3,
  garmentHalfWidthM?: number,
): { left: THREE.Vector3; right: THREE.Vector3 } {
  const center = left.clone().add(right).multiplyScalar(0.5);
  const leftDir = left.clone().sub(center);
  const rightDir = right.clone().sub(center);
  if (leftDir.lengthSq() > 1e-9) leftDir.normalize();
  if (rightDir.lengthSq() > 1e-9) rightDir.normalize();
  const leftClearance = surfaceClearanceHalfWidth(center, left);
  const rightClearance = surfaceClearanceHalfWidth(center, right);
  const leftHalfWidth = garmentHalfWidthM === undefined ? leftClearance : Math.max(garmentHalfWidthM, leftClearance);
  const rightHalfWidth = garmentHalfWidthM === undefined ? rightClearance : Math.max(garmentHalfWidthM, rightClearance);
  const pinLeft = center.clone().addScaledVector(leftDir, leftHalfWidth);
  const pinRight = center.clone().addScaledVector(rightDir, rightHalfWidth);
  pinLeft.y += SHOULDER_PIN_LIFT;
  pinRight.y += SHOULDER_PIN_LIFT;
  return { left: pinLeft, right: pinRight };
}
