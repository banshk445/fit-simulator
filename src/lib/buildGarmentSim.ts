import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { ARMHOLE_ROW_FRACTION, COLS, FRONT_BACK_HALF_GAP, ROWS, SEAM_REST_LENGTH } from "./clothConfig";

// 목선(칼라) 모양. 앞판은 깊게(스쿱넥), 뒤판은 얕게 파인 크루넥 티셔츠를
// 기준으로 잡았다. 중심에서 얼마나 넓은 범위까지 파임의 영향을 받는지는
// 어깨 폭 대비 비율(NECKLINE_WIDTH_FRACTION)로 잡아, 어깨너비 슬라이더가
// 바뀌어도 비례해서 따라온다.
// 실측 결과 이전 값(앞 9cm, 폭 35%)은 어깨 대부분이 훤히 드러나는
// "오프숄더" 느낌이 났다 — 파임 영향 구간(WIDTH_FRACTION)이 너무 넓어서
// 목 중심부만이 아니라 어깨선 전체가 처져 보였다. 일반적인 크루넥
// 티셔츠에 가깝게 깊이를 줄이고(9cm→4cm) 영향 폭도 중앙으로 좁혔다
// (35%→20%) — 목 중심에서만 살짝 파이고 어깨 쪽은 핀 위치 그대로 남는다.
const NECKLINE_DEPTH_FRONT = 0.04;
const NECKLINE_DEPTH_BACK = 0.02;
const NECKLINE_WIDTH_FRACTION = 0.2;

// 큰 재설계(3D 곡면 어깨): 20/21번 수정(소매 스냅 문턱값, 어깨 폭 클램프
// 제거) 이후에도 사용자가 3/4 측면 각도에서 "여전히 똑같다"고 재지적해
// 실측해보니, 어깨~겨드랑이 구간(y=0..armholeStartRow)의 Z(앞뒤 깊이)
// 좌표가 지금껏 단 한 번도 행/열에 따라 변한 적이 없었다 — panelZOffset
// (앞판/뒤판 간격) 하나로 완전히 평평했다. 즉 20/21번은 이 구간이
// "좌우로" 얼마나 넓은지만 고쳤을 뿐, 실제 둥근 어깨 캡이 카메라 쪽으로
// (앞판은 앞으로, 뒤판은 뒤로) 볼록하게 휘어나오는 "앞뒤 곡률"은 전혀
// 반영한 적이 없었다 — 정면에서는 이 곡률이 거의 안 보이지만, 사용자가
// 계속 문제를 지적한 3/4 측면 각도는 정확히 이 앞뒤 곡률이 가장 잘 보이는
// 각도라 아무리 X(좌우) 쪽을 고쳐도 그 각도에서는 여전히 평평한 판자처럼
// 보였던 것 — 이게 진짜 "3D 곡면이 아니다"의 실체였다.
//
// 소매 원통(buildSleeveSim.ts)과 같은 파라메트릭 접근으로, 어깨선(0번 행,
// 이음매라 앞뒤판이 겹치므로 건드리지 않음) 바로 아래부터 겨드랑이까지
// 열(u, 중심 0~가장자리 ±0.5)이 가장자리(어깨 쪽)에 가까울수록, 행(y)이
// 어깨선에 가까울수록 앞판은 +Z(앞), 뒤판은 -Z(뒤)로 볼록하게 부풀려
// 실제 둥근 삼각근 표면을 흉내낸다 — 목 중심(u=0) 쪽은 부풀리지 않아
// 목선 자체는 그대로 평평하게 남는다.
const SHOULDER_CAP_BULGE = 0.06;

function shoulderCapZBulge(y: number, u: number, armholeStartRow: number): number {
  if (y <= 0 || armholeStartRow <= 0) return 0;
  const rowT = Math.min(y / armholeStartRow, 1);
  const rowFalloff = 1 - rowT; // 어깨선 바로 아래(1번 행)에서 최대, 겨드랑이선에서 0
  const outerness = Math.min(Math.abs(u) * 2, 1); // 목 중심(0)에서 0, 어깨 가장자리(±0.5)에서 1
  return SHOULDER_CAP_BULGE * rowFalloff * outerness;
}

// 어깨선(0번 행) 위의 한 점(u = -0.5~0.5, panel 0=앞/1=뒤)이 목선 파임으로
// 인해 얼마나 아래로 내려가는지 계산한다. 중심(u=0)에서 최대, 어깨 쪽
// (|u|가 NECKLINE_WIDTH_FRACTION/2 이상)에서는 0으로 부드럽게 줄어든다.
function necklineDip(panel: number, u: number): number {
  const depth = panel === 0 ? NECKLINE_DEPTH_FRONT : NECKLINE_DEPTH_BACK;
  const closeness = Math.max(0, 1 - Math.abs(u) / (NECKLINE_WIDTH_FRACTION / 2));
  return depth * closeness * closeness;
}

// 특정 행(y)에서 좌우 절반 폭이 얼마나 테이퍼됐는지 계산한다(어깨선의 어깨
// 핀 간격 → 겨드랑이선의 전체 폭). buildGarmentSim의 초기 격자 배치가 쓴다.
//
// 큰 재설계(3D 곡면 어깨 마감): shoulderHalfWidth를 fullHalfWidth로
// 클램프(Math.min)하던 걸 없앴다. shoulderPin.ts가 어깨 핀을 관절
// 위치에서 실제 어깨 표면 쪽으로 밀어내는 SHOULDER_PIN_OUTSET을 여러 차례
// (6.0→7.5→9.5→11.5cm) 키워왔는데, 그때마다 사용자가 "여전히 어깨가
// 분리돼 보인다"고 재지적한 근본 원인이 바로 이 클램프였다 — 기본
// 슬라이더 값(어깨너비 45cm, 품 110cm)에서 핀 간격(약 68cm, 반폭 34cm)이
// 이미 몸통 반폭(fullHalfWidth, 약 27.5cm)보다 넓은데, 이 클램프가
// shoulderHalfWidth를 fullHalfWidth로 깎아버려 0번 행의 "초기 배치 및
// 그로부터 계산되는 rest length"는 계속 27.5cm 기준으로 좁게 잡히고,
// 그 직후 pinCorners()가 0번 행을 실제 핀 위치(34cm)로 강제로 잡아당겨
// 버렸다 — 즉 SHOULDER_PIN_OUTSET을 아무리 키워도 핀 "위치"만 바깥으로
// 갈 뿐, 그 아래 몇 행이 따라 넓어질 근거(rest length)가 전혀 안 바뀌어
// 곧바로 다시 좁아져 보였다(사용자가 어깨너비를 키울수록 더 크게
// 체감했을 이유이기도 하다). 클램프를 없애면 shoulderHalfWidth가
// fullHalfWidth보다 넓을 때 taperT가 그대로 "어깨(넓다)→겨드랑이(몸통
// 반폭으로 좁아짐)" 방향으로 자연스럽게 좁아지는 곡선을 만든다 — 실제
// 티셔츠도 어깨 솔기가 가슴 폭보다 넓게 시작해 암홀 쪽으로 좁아지는
// 경우가 흔하므로 해부학적으로도 맞는 방향이다.
function halfWidthAtRow(y: number, widthM: number, pinLeft: Vec3Like, pinRight: Vec3Like): number {
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const fullHalfWidth = widthM / 2;
  const dx = pinRight.x - pinLeft.x;
  const dz = pinRight.z - pinLeft.z;
  const shoulderHalfWidth = Math.hypot(dx, dz) / 2;
  const taperT = armholeStartRow > 0 ? Math.min(y / armholeStartRow, 1) : 1;
  return shoulderHalfWidth + (fullHalfWidth - shoulderHalfWidth) * taperT;
}

// 어깨선(0번 행) 전체를 목선 곡선을 따라 고정한다 — 양 끝(어깨)만 고정하고
// 나머지를 물리에 맡기면 직선 그대로 축 처지거나 뻣뻣하게 남아 "실제로
// 입은" 느낌이 안 난다. pinLeft~pinRight를 선형보간한 기준선에서, 중심에
// 가까울수록 necklineDip만큼 아래로 내려서 고정하면 목 파임이 유지된다.
// 앞판/뒤판이 어깨 양 끝에서는 같은 지점에 고정되므로 실제 어깨 시접처럼
// 동작한다.
//
// (한때 1번 행도 함께 고정해 크루넥 옷깃 골지 밴드를 흉내 내보려 했으나,
// 인접한 두 행을 통째로 고정하면 그 아래 행들과의 구조/전단 제약이
// 과잉구속되어 옷감이 뒤틀리는(정점 순서가 꼬여 텍스처가 대각선으로
// 찢어진 것처럼 보임) 심각한 회귀가 실측으로 확인돼 되돌렸다 — 이 완화
// 방식의 솔버는 인접 행을 동시에 완전 고정하는 것을 잘 버티지 못한다.)
export function pinCorners(sim: ClothSimulation, pinLeft: Vec3Like, pinRight: Vec3Like): void {
  for (let panel = 0; panel < 2; panel++) {
    for (let x = 0; x < COLS; x++) {
      const t = x / (COLS - 1); // 0(왼쪽 어깨) ~ 1(오른쪽 어깨)
      const u = t - 0.5;
      const baseX = pinLeft.x + (pinRight.x - pinLeft.x) * t;
      const baseY = pinLeft.y + (pinRight.y - pinLeft.y) * t;
      const baseZ = pinLeft.z + (pinRight.z - pinLeft.z) * t;
      const dip = necklineDip(panel, u);
      sim.pin(sim.index(panel, x, 0), baseX, baseY - dip, baseZ);
    }
  }
}

// 앞판(패널 0)+뒤판(패널 1)을 어깨선 아래로 평평하게 배치하고, 격자 내부
// 제약(구조/전단/벤드)과 옆선 시접 제약을 만든 뒤 상단 모서리를 고정한다.
// 순수 함수라(THREE 수학 외 DOM/React 의존성 없음) 메인 스레드와 물리
// 워커 양쪽에서 재사용할 수 있다.
export function buildGarmentSim(
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
): ClothSimulation {
  const sim = new ClothSimulation(COLS, ROWS, 2);
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  // 열 방향 부호. 아래 X 배치 공식(u*2*halfWidth)은 x=0(u=-0.5)을 항상
  // 음의 X로, x=COLS-1(u=+0.5)을 항상 양의 X로 놓는데, pinCorners()가
  // 0번 행을 고정하는 방향(x=0 → pinLeft, x=COLS-1 → pinRight)은 실제
  // pinLeft/pinRight의 실제 좌표 부호와 무관하게 항상 고정이다. 이 마네킹
  // 장면에서는 pinLeft.x가 양수(+), pinRight.x가 음수(-)라 두 부호가
  // 서로 반대로 어긋난다 — 즉 0번 행을 다 배치한 직후 pinCorners가 그
  // 자리를 반대쪽(양→음 전체 폭만큼)으로 홱 뒤집어버리는 셈이라, 1번
  // 행과의 구조 제약이 시작부터 실제 폭의 2배에 달하는 거리를 억지로
  // 줄여야 하는 거대한 초기 위반 상태로 출발한다. 몇 프레임 안에 저절로
  // 풀리기도 하지만(대부분의 경우), 드물게 못 풀고 매듭처럼 영구히
  // 뒤엉킨 채로 굳어버리는 문제가 실측으로 확인됐다(특히 옷 치수를 이미
  // 돌고 있는 시뮬레이션에서 바꿔 다시 짓는 경우 재현율이 높았다). 부호를
  // 실제 pinLeft/pinRight 방향에 맞춰 동적으로 계산해 이 불일치 자체를
  // 없앤다.
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  // 옆선 시접이 없는 암홀 구간(어깨~겨드랑이)을 폭 그대로 두면 사각형
  // 조각이 어깨 밖으로 뻣뻣하게 튀어나와 보인다. 어깨선에서는 실제 어깨 핀
  // 간격만큼 좁게 시작해서 겨드랑이 선(armholeStartRow)까지 점점 전체
  // 폭으로 넓어지도록, 초기 배치(=제약 조건의 rest length)를 그렇게
  // 좁혀서 잡는다 — 물리가 진행돼도 rest length가 유지되므로 이 모양이
  // 그대로 이어진다.
  for (let panel = 0; panel < 2; panel++) {
    const panelZOffset = panel === 0 ? FRONT_BACK_HALF_GAP : -FRONT_BACK_HALF_GAP;
    const panelSign = panel === 0 ? 1 : -1;
    for (let y = 0; y < ROWS; y++) {
      const v = y / (ROWS - 1); // 0 어깨선 ~ 1 밑단
      const halfWidth = halfWidthAtRow(y, widthM, pinLeft, pinRight);
      for (let x = 0; x < COLS; x++) {
        const u = x / (COLS - 1) - 0.5; // -0.5 ~ 0.5
        // 0번 행은 목선 파임만큼 미리 내려서 배치해 둔다 — 그래야 이
        // 위치에서 계산되는 구조/전단 제약의 rest length가 핀으로 고정될
        // 최종 목선 모양과 맞아서, 목 둘레에 불필요한 인장이 생기지 않는다.
        const dip = y === 0 ? necklineDip(panel, u) : 0;
        const capZ = shoulderCapZBulge(y, u, armholeStartRow);
        sim.setParticle(
          sim.index(panel, x, y),
          sideSign * -u * 2 * halfWidth,
          topY - v * heightM - dip,
          centerZ + panelZOffset + panelSign * capZ,
        );
      }
    }
  }
  sim.buildConstraints();

  // 옆선 시접을 armholeStartRow에서 곧바로 꽉 조인 간격(SEAM_REST_LENGTH,
  // 6mm)으로 시작하면, 시접 바로 안쪽 열(자유롭게 몸 곡면을 따라가는 열)과
  // 너무 튀는 차이가 생겨 옆에서 보면 그 경계가 접힌 것처럼 뾰족하게
  // 튀어나와 보이는 문제가 실측(측면 카메라 각도, 소매를 꺼도 재현)으로
  // 확인됐다 — 소매와 무관한 몸판 자체의 문제였다. 시접 시작 지점에서
  // 몇 행에 걸쳐 넉넉한 간격에서 원래 목표 간격까지 서서히 좁혀가면(이즈인),
  // 이 급격한 전환이 완화된다.
  const SEAM_EASE_ROWS = 4;
  const SEAM_EASE_START = 0.03;
  for (let y = armholeStartRow; y < ROWS; y++) {
    const easeT = Math.min((y - armholeStartRow) / SEAM_EASE_ROWS, 1);
    const restLength = SEAM_EASE_START + (SEAM_REST_LENGTH - SEAM_EASE_START) * easeT;
    sim.addConstraint(sim.index(0, 0, y), sim.index(1, 0, y), restLength);
    sim.addConstraint(sim.index(0, COLS - 1, y), sim.index(1, COLS - 1, y), restLength);
  }

  pinCorners(sim, pinLeft, pinRight);
  return sim;
}
