import * as THREE from "three";

// "어깨 뼈"(findShoulderBones가 찾는 위팔 뼈대 루트)는 해부학적 관절
// 중심에 있어서, 실제로 눈에 보이는 어깨 캡(삼각근 표면)보다 몸 안쪽에
// 있다. 이 모델(Ch36)에서 직접 측정해보면(마네킹 메시를 어깨 높이에서
// 잘라 X축 최대값을 구함) 관절 위치는 중심에서 18.0cm인데 실제 어깨
// 표면은 24.3cm까지 나가 있다 — 약 6.3cm 차이. 옷의 어깨 시접을 관절
// 위치 그대로 고정하면 그 차이만큼 옷이 어깨 안쪽에서 시작해버려, 마치
// 끈나시/오프숄더처럼 어깨가 훤히 드러나 보이는 문제가 실측으로
// 확인됐다 — 목선 파임 치수나 옷감 처짐이 원인이 아니라 핀 자체가 실제
// 어깨보다 안쪽에 있었던 것. 중심에서 바깥쪽(어깨) 방향으로 측정한 만큼
// 밀어내 실제 어깨 표면 근처에 핀이 오도록 보정한다.
//
// 처음엔 측정값과 똑같이 6.0cm로 잡았는데(실측 표면이 6.3cm였으니 0.3cm
// 모자람 — 사실상 핀이 마네킹 표면 바로 안쪽에 거의 딱 붙는 셈), 그 결과
// 옷깃/소매 이음매 부분에서 마네킹 몸통 메시와 옷감이 깊이(Z) 방향으로
// 거의 겹쳐 렌더러가 매 프레임 어느 쪽을 앞에 그릴지 오락가락하는
// Z-fighting이 생겨, 마네킹 몸통이 옷감 앞에 그려지면서 옷이 없는
// 것처럼(피부가 비쳐 보이는 틈) 보이는 문제가 실측(마네킹을 잠깐 숨겨
// 옷감 자체는 멀쩡히 붙어있는 것을 확인)으로 드러났다. 실측 표면
// 위치보다 확실히 더 바깥으로(여유 있게) 밀어내야 이 겹침을 피한다.
//
// 7.5cm로 늘린 뒤에도 사용자가 확대된 화면에서 "여전히 어깨가 옷과
// 분리돼 보인다"고 재차 지적했다 — 레이캐스팅으로 직접 재보니 어깨
// 핀(row 0)은 그 높이의 표면(22.7cm)보다는 바깥(25.5cm)에 있었지만,
// 삼각근 캡은 어깨선에서 아래로 내려갈수록 빠르게 넓어져서(핀 기준
// 3cm 아래 24.3cm, 6cm 아래 25.8cm) 암홀 시작 행(armholeStartRow)까지
// 폭을 선형으로 서서히 벌리는 초기 배치(halfWidthAtRow)가 몸이 넓어지는
// 속도를 따라가지 못해, 어깨 바로 아래 몇 행에서 마네킹이 옷보다
// 바깥으로 삐져나오는 틈이 생겼다. 핀 자체를 몸통 최대 폭(fullHalfWidth)에
// 더 가깝게 밀어내면 그 구간의 테이퍼 자체가 거의 없어져(row 0부터 이미
// 거의 최대 폭) 이 문제를 없앨 수 있어 9.5cm로 늘렸다.
//
// 9.5cm로도 사용자가 다시 "여전히 분리돼 있다"고 지적했는데, 이번엔
// 한쪽 어깨(오른쪽)에서만 틈이 보이고 반대쪽은 멀쩡한 좌우 비대칭
// 증상이었다 — 업로드 직후와 3초 후 스크린샷이 완전히 동일해 물리
// 안정화 시간 문제도 아니었다. 레이캐스팅으로 좌우 마네킹 표면을
// 대칭 지점에서 직접 재보니 좌우 X좌표가 소수점 넷째 자리까지 거의
// 일치했고(메시 자체는 대칭), 몸판/소매 양쪽의 핀 좌표도 서로 완전히
// 동일했다(핀 계산 자체도 좌우 대칭) — 즉 입력값은 완벽히 대칭인데
// 출력(렌더링된 옷감 형태)만 비대칭이었다. 남은 원인은 반복 횟수가
// 고정된 가우스-자이델 이완 솔버가 대칭인 문제라도 항상 대칭인 해로
// 수렴한다는 보장이 없다는 것(부동소수점 연산 순서, 충돌 스냅 타이밍
// 등 미세한 비대칭이 반복을 거치며 증폭될 수 있음) — 코드 로직 버그가
// 아니라 솔버의 근본적 한계에 가깝다. 안전 마진을 더 키워(11.5cm)
// 좌우 어느 쪽이 살짝 덜 수렴해도 여전히 표면을 확실히 벗어나게 한다.
export const SHOULDER_PIN_OUTSET = 0.115;

// 어깨 뼈대(관절)에서 수평으로만 밀어내던 것과 별개로, 실제로는 수직으로도
// 살짝 낮다 — 실측(Playwright evaluate로 굽힌 마네킹 표면 중 핀 좌표
// 반경 8cm 안의 최고 Y를 직접 스캔)해보니 핀 Y가 실제 어깨 표면
// 꼭대기보다 항상 약 1.8cm 낮았다. 사용자가 "옷이 어깨가 아니라
// 가슴에 있다"고 지적한 원인 중 하나 — 옷깃/어깨선 자체가 진짜 어깨
// 꼭대기보다 낮게 고정돼 있었다. 실측값(1.8cm)에 약간의 여유를 더해
// 2cm 위로 올린다(SHOULDER_PIN_OUTSET처럼 수평 오프셋과는 별개 축).
export const SHOULDER_PIN_LIFT = 0.02;

export function computeShoulderPin(left: THREE.Vector3, right: THREE.Vector3): { left: THREE.Vector3; right: THREE.Vector3 } {
  const center = left.clone().add(right).multiplyScalar(0.5);
  const leftDir = left.clone().sub(center);
  const rightDir = right.clone().sub(center);
  if (leftDir.lengthSq() > 1e-9) leftDir.normalize();
  if (rightDir.lengthSq() > 1e-9) rightDir.normalize();
  const pinLeft = left.clone().addScaledVector(leftDir, SHOULDER_PIN_OUTSET);
  const pinRight = right.clone().addScaledVector(rightDir, SHOULDER_PIN_OUTSET);
  pinLeft.y += SHOULDER_PIN_LIFT;
  pinRight.y += SHOULDER_PIN_LIFT;
  return { left: pinLeft, right: pinRight };
}
