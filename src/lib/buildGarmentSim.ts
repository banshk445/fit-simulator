import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { ARMHOLE_ROW_FRACTION, ARM_ROWS, COLS, FRONT_BACK_HALF_GAP, ROWS, SEAM_REST_LENGTH } from "./clothConfig";

// 46번(전면 재설계 — 통합 단일 패널): 사용자가 소매를 별도 원통 패널로
// 두지 말고 몸판(앞/뒤판)과 이어진 하나의 넓은 천으로 만들어 달라고
// 요청했다. 몸판 패널 자체를 어깨 폭보다 훨씬 넓게(소매 끝까지) 만들어,
// 열(column) x가 몸통 폭 안쪽이면 기존과 똑같이 몸통 표면을 따라가고,
// 그 바깥이면 어깨 지점에서 실제 팔 방향(dir)으로 뻗어나가게 한다 —
// 봉제선/이음매 없이 같은 격자, 같은 정점이 자연스럽게 이어진다.
export interface ArmDir {
  dir: Vec3Like; // 단위 벡터(어깨→팔꿈치 방향)
  length: number; // 소매 길이(m)
}

// 37번(목선 재설계): 이전 두 차례(9cm/35%→4cm/20%) 모두 "중심에서 아래로
// 파임"만 다뤘는데, 실측(확대 스크린샷)해보니 이 방식은 애초에 크루넥이
// 될 수 없는 구조였다 — 파임 영향 구간 밖(전체 폭의 80%!)은 그냥 어깨선
// 그대로 평평하게 남아, 목 중심의 작은 노치를 빼면 전체 목둘레가 "어깨
// 쪽에서 어깨 쪽으로 거의 일직선"으로 이어지는 셈이었다. 이건 정의상
// 보트넥/오프숄더 모양이다 — 깊이를 얼마로 조정해도 모양 자체가 안 바뀐다.
// 실제 크루넥은 반대다: 목둘레 대부분(가슴/등 중앙 쪽)이 어깨선보다
// 확실히 높게(목에 가깝게) 올라가 있고, 오직 어깨 솔기 바로 근처에서만
// 빠르게 어깨 높이로 떨어진다. "중심에서 파임"이 아니라 "어깨 근처에서만
// 떨어지고 나머지는 목 높이로 들어올려짐"으로 뒤집어야 한다.
// NECKLINE_HOLE_WIDTH_FRACTION: 목 구멍 자체가 차지하는 폭(어깨 실측
// 반폭 대비) — 실제 크루넥 목둘레(약 19cm)/평균 어깨너비(약 45cm) 비율에서
// 가져왔다. 이 구간 안쪽은 거의 목 높이로 평평(살짝 U자로만 굴곡).
//
// 46번 실측(재조정): 물리 복구 후 스크린샷으로 확인해보니, 이 폭(0.42)
// 밖의 "목 구멍 가장자리→어깨점" 전환 구간이 전체 반폭의 29%(0.5-0.21)
// 나 차지해서, 목선이 어깨까지 완만하게 미끄러지듯 내려가는 보트넥/
// 오프숄더처럼 보였다(쇄골이 넓게 드러남) — 크루넥은 이 전환이 어깨
// 솔기 바로 근처에서만 빠르게 끝나야 한다. 0.62로 늘려 전환 구간을
// 반폭의 19%로 좁히고, 그만큼 "목 높이 그대로 유지"되는 구간을 어깨
// 쪽으로 더 넓힌다.
const NECKLINE_HOLE_WIDTH_FRACTION = 0.62;
// 앞판은 깊게(스쿱넥 느낌으로 중심이 살짝 더 내려감), 뒤판은 거의 평평한
// 크루넥 기준.
const NECKLINE_RISE_FRONT = 0.06;
const NECKLINE_RISE_BACK = 0.052;
// 목 구멍 중심이 구멍 가장자리보다 살짝만 더 내려가게(완전히 평평하면
// 부자연스러워 보임) 하는 비율 — RISE 대비 몇 %만큼 중심을 낮출지.
//
// 46번 실측(진짜 원인 발견): 이 값을 0.25로 뒀을 때, 목 구멍 가장자리
// (u=±holeHalf)에서 rise가 "최대"이고 중심(u=0)에서 이 비율만큼 "내려가는"
// 구조라, 대칭으로 펼치면 좌우 두 개의 봉우리와 그 사이 골짜기가 있는
// M자(박쥐 날개) 곡선이 수학적으로 나올 수밖에 없었다 — "살짝 U자"로
// 의도했던 것보다 시각적으로 훨씬 도드라졌다. 0.06으로 크게 줄여 거의
// 평평하게(정말 "살짝"만 내려가게) 만든다.
const NECKLINE_CENTER_DIP_FRACTION = 0.06;
// rise를 0번 행(어깨선)에만 적용했을 때 실측으로 확인된 어깨-목 전환부
// 삼각 틈(아래 layoutTorsoPanels 주석 참고)을 막기 위해, 몇 개 행에 걸쳐
// rise 영향을 서서히 줄인다 — armholeStartRow(겨드랑이선) 대비 이 비율
// 지점에서 영향이 0이 된다.
const NECKLINE_RISE_FADE_FRACTION = 1.0;

// 큰 재설계(3D 곡면 어깨): 어깨선(0번 행) 바로 아래부터 겨드랑이까지,
// 어깨 쪽(shoulderU 절대값이 클수록)일수록·어깨선에 가까울수록 앞판은
// +Z(앞), 뒤판은 -Z(뒤)로 볼록하게 부풀려 실제 둥근 삼각근 표면을
// 흉내낸다 — 목 중심 쪽은 부풀리지 않아 목선 자체는 평평하게 남는다.
const SHOULDER_CAP_BULGE = 0.06;

function shoulderCapZBulge(y: number, shoulderU: number, armholeStartRow: number): number {
  if (y <= 0 || armholeStartRow <= 0) return 0;
  const rowT = Math.min(y / armholeStartRow, 1);
  const rowFalloff = 1 - rowT;
  const outerness = Math.min(Math.abs(shoulderU) * 2, 1);
  return SHOULDER_CAP_BULGE * rowFalloff * outerness;
}

// shoulderU(-0.5~0.5, 0=목 중심, ±0.5=어깨점)가 기준 어깨 높이(baseY)보다
// 얼마나 "위로" 올라가는지 계산한다. isFrontPanel: 30번 병합 이후 패널
// 번호가 더 이상 항상 0=앞/1=뒤가 아니므로 이 값으로 앞/뒤 깊이 차이를
// 구분한다.
function necklineRise(isFrontPanel: boolean, shoulderU: number): number {
  const rise = isFrontPanel ? NECKLINE_RISE_FRONT : NECKLINE_RISE_BACK;
  const holeHalf = NECKLINE_HOLE_WIDTH_FRACTION / 2;
  const absU = Math.abs(shoulderU);
  if (absU <= holeHalf) {
    const t = holeHalf > 0 ? absU / holeHalf : 1;
    return rise * (1 - NECKLINE_CENTER_DIP_FRACTION * (1 - t * t));
  }
  const outerSpan = 0.5 - holeHalf;
  const t = outerSpan > 0 ? (absU - holeHalf) / outerSpan : 1;
  const falloff = 1 - t * t;
  return rise * falloff;
}

// 특정 행(y)에서 좌우 절반 폭이 얼마나 테이퍼됐는지 계산한다(어깨선의 어깨
// 핀 간격 → 겨드랑이선의 전체 폭).
function halfWidthAtRow(y: number, widthM: number, pinLeft: Vec3Like, pinRight: Vec3Like): number {
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const fullHalfWidth = widthM / 2;
  const dx = pinRight.x - pinLeft.x;
  const dz = pinRight.z - pinLeft.z;
  const shoulderHalfWidth = Math.hypot(dx, dz) / 2;
  const linearT = armholeStartRow > 0 ? Math.min(y / armholeStartRow, 1) : 1;
  const taperT = linearT * linearT;
  return shoulderHalfWidth + (fullHalfWidth - shoulderHalfWidth) * taperT;
}

// 46번: 어깨선(0번 행) 중 몸통 쪽(frac<=1)만 목선 곡선을 따라 고정한다 —
// 사용자 요청대로 그 바깥(소매 쪽으로 뻗은 부분)은 핀을 전혀 걸지 않고
// 중력·구조 제약에만 맡긴다. frac 계산은 layoutTorsoPanels와 반드시
// 같은 공식을 써야 한다(레이아웃 때 놓은 위치와 핀 목표가 어긋나면 큰
// 초기 위반이 생긴다) — columnLayout()으로 공유한다.
export function pinCorners(
  sim: ClothSimulation,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  frontPanel: number,
  backPanel: number,
  armLeft: ArmDir,
  armRight: ArmDir,
  necklineLift?: readonly number[],
): void {
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  const thw0 = halfWidthAtRow(0, 0, pinLeft, pinRight); // widthM 무관(row0은 항상 shoulderHalfWidth)
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);

  for (const [panel, isFront] of [
    [frontPanel, true],
    [backPanel, false],
  ] as const) {
    for (let x = 0; x < COLS; x++) {
      const u = x / (COLS - 1) - 0.5;
      const s = u >= 0 ? 1 : -1;
      const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
      if (frac > 1) continue; // 소매 쪽 — 핀 없음(중력에 맡김)
      const shoulderU = s * frac * 0.5;
      const baseX = -sideSign * shoulderU * 2 * thw0;
      const baseY = pinLeft.y + (pinRight.y - pinLeft.y) * ((shoulderU + 0.5) / 1);
      const baseZ = pinLeft.z + (pinRight.z - pinLeft.z) * ((shoulderU + 0.5) / 1);
      const rise = necklineRise(isFront, shoulderU);
      const lift = necklineLift?.[x] ?? 0;
      sim.pin(sim.index(panel, x, 0), baseX, baseY + rise + lift, baseZ);
    }
  }
}

// 앞판+뒤판을 배치한다. 몸통 폭 안쪽(frac<=1) 열은 기존과 동일한 방식으로
// 어깨~겨드랑이~밑단 테이퍼를 따라가고, 그 바깥(frac>1) 열은 어깨 지점
// (frac=1 경계)에서 실제 팔 방향(armLeft/armRight.dir)으로 뻗어나간다 —
// 뻗어나가는 길이는 armRowFactor(y)로 어깨선(y=0)에서 최대이고
// ARM_ROWS(겨드랑이 근처)에 이르면 0으로 줄어, 그 아래 행에서는 이
// 열들도 자연스럽게 몸통 가장자리에 다시 합류한다(별도 봉제선 없이
// 같은 격자라 이 합류도 매끈하게 이어진다).
//
// 46번 실측(재조정): 처음엔 y=0에서만 factor=1이고 그 즉시 y가 커질수록
// 줄어드는 곡선(1-t²)을 썼는데, 실측(긴팔 스크린샷)해보니 소매 끝(가장
// 바깥 열)이 row 0 "한 점"에서만 최대 길이에 닿고 바로 다음 행부터
// 급격히 줄어들어, 실제 소매(대략 네모꼴 천을 원통으로 만 모양)가 아니라
// 어깨에서 뾰족하게 튀어나온 "가시" 모양으로 보였다 — 소매 끝단(손목
// 쪽)이 한 점이 아니라 어느 정도 폭이 있는 가장자리여야 하는데, row 0
// 근방 몇 행은 거의 최대 길이를 그대로 유지하다가 겨드랑이 쪽에서야
// 급격히 줄어들게(정체 구간 + 테이퍼 구간) 바꾼다.
const ARM_ROW_PLATEAU_FRACTION = 0.45;
function armRowFactor(y: number): number {
  const plateauRows = ARM_ROWS * ARM_ROW_PLATEAU_FRACTION;
  if (y <= plateauRows) return 1;
  const taperSpan = ARM_ROWS - plateauRows || 1;
  const t = Math.min((y - plateauRows) / taperSpan, 1);
  return 1 - t * t;
}

// 46번(형태 재설계 — 진짜 원통 수학): Z축으로만 부풀리는 근사(위 이전
// 버전)는 목선 찢어짐(강한 지지로 고침) → 각진 갑옷 모양(해상도를
// 올려도 그대로, 실측으로 확인)으로 이어져, 사용자가 "같은 평면 공식
// 안에서, 소매 구간만 진짜 각도 기반 원통 수학으로 다시 설계"를
// 선택했다(위험 감수 확인). 열(column)은 그대로 "팔 방향을 따라 얼마나
// 뻗었는지"(sleeveT, 0=몸통 경계~1=소매 끝)를 맡고, 행(row)이 새로
// "팔 둘레를 얼마나 돌았는지"(각도)를 맡는다 — 앞판은 팔 위쪽(행 0)에서
// 시작해 팔 앞쪽으로, 뒤판은 같은 위쪽에서 시작해 팔 뒤쪽으로 각각
// ANGLE_MAX만큼 돌아 내려가며(합쳐서 팔 위쪽 대부분을 덮는 원통면),
// ARM_ROWS에 이르면 armFactor가 0이 되어 원통 성분 전체가 사라지고 그
// 행의 몸통 가장자리로 되돌아온다(별도 봉제선 없이 매끈하게 합류).
function armPerpBasis(dir: Vec3Like): { up: Vec3Like; side: Vec3Like } {
  // dir와 수직인 "위쪽" 성분 — 월드 업(0,1,0)에서 dir 방향 성분을 뺀
  // 나머지. 실제 마네킹 팔이 수직에 아주 가깝게 들리지 않는 한(T/A포즈,
  // 팔을 내린 포즈 모두 해당) 안정적으로 계산된다.
  const dot = dir.y; // dir·(0,1,0)
  let ux = -dir.x * dot;
  let uy = 1 - dir.y * dot;
  let uz = -dir.z * dot;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  // side = dir × up — up과 dir 둘 다에 수직, 앞/뒤(대략 월드 Z)로 향한다.
  let sx = dir.y * uz - dir.z * uy;
  let sy = dir.z * ux - dir.x * uz;
  let sz = dir.x * uy - dir.y * ux;
  const slen = Math.hypot(sx, sy, sz) || 1;
  sx /= slen;
  sy /= slen;
  sz /= slen;
  return { up: { x: ux, y: uy, z: uz }, side: { x: sx, y: sy, z: sz } };
}

// 팔 둘레를 얼마나 도는지(라디안, 편측). 두 반쪽(앞판+뒤판)을 합치면
// 2*ANGLE_MAX(현재 약 243°)만큼 덮는다 — 완전한 360도는 아니지만(가장
// 헐렁한 팔 안쪽/겨드랑이 쪽은 애초에 armhole로 트여 있어야 하는 부분과
// 겹쳐 실제로도 안 보임), 대부분의 각도를 덮어 "위에서/옆에서/살짝
// 아래서" 어느 각도로 봐도 납작한 판이 아니라 둥근 단면으로 보인다.
const ARM_ANGLE_MAX = Math.PI * 0.675;
// 소매가 몸통 가장자리(sleeveT=0)에서 0부터 시작해 이 지점부터 최대
// 반지름을 유지하는 비율 — smoothstep으로 매끄럽게 올린다(각진 접힘선
// 방지, 이전 WRAP_RAMP_T와 같은 이유).
const ARM_TUBE_RADIUS_RAMP_T = 0.3;
// 46번 실측(풍선 소매): 0.085(팔 충돌 반경 0.065보다 넉넉히 큼)로 뒀더니
// 실제 팔보다 훨씬 굵게 부풀어 폼핏 반팔이 아니라 퍼프소매처럼 보였다 —
// 사용자가 직접 스크린샷으로 확인. 실제 팔 충돌 반경(ARM_COLLISION_RADIUS)
// 에 옷감 여유 정도만 더한 값으로 줄여, 팔에 붙는 느낌에 가깝게 한다.
const ARM_TUBE_RADIUS = 0.055;

// 소매 쪽(frac>1) 한 정점의 "이상적" 위치. layoutTorsoPanels(초기 배치)와
// applyArmSoftPull(매 프레임 약한 지지, 아래)이 이 공식을 공유한다 — 두
// 곳이 서로 다른 공식을 쓰면 소프트 풀이 매 프레임 엉뚱한 목표로
// 당기게 된다.
function sleeveExtensionPoint(
  y: number,
  v: number,
  s: number,
  frac: number,
  thw: number,
  thw0: number,
  armSpanHalf: number,
  arm: ArmDir,
  armBasis: { up: Vec3Like; side: Vec3Like },
  topY: number,
  heightM: number,
  centerZ: number,
  panelZOffset: number,
  panelSign: number,
  sideSign: number,
  armholeStartRow: number,
  armFactor: number,
): { x: number; y: number; z: number } {
  const edgeShoulderU = s * 0.5;
  const edgeX = -sideSign * edgeShoulderU * 2 * thw;
  const edgeY = topY - v * heightM; // rise(edgeShoulderU=±0.5)는 항상 0
  const edgeCapZ = shoulderCapZBulge(y, edgeShoulderU, armholeStartRow);
  const edgeZ = centerZ + panelZOffset + panelSign * edgeCapZ;
  const maxFrac = thw0 > 0 ? armSpanHalf / thw0 : 1;
  const sleeveT = maxFrac > 1 ? Math.min((frac - 1) / (maxFrac - 1), 1) : 0;
  // 열(sleeveT) → 팔 축 방향(길이) 성분. 행(y) → 둘레 각도(아래 angle).
  const reach = arm.length * sleeveT;
  const radiusRampRaw = ARM_TUBE_RADIUS_RAMP_T > 0 ? Math.min(Math.max(sleeveT / ARM_TUBE_RADIUS_RAMP_T, 0), 1) : 1;
  const radiusT = radiusRampRaw * radiusRampRaw * (3 - 2 * radiusRampRaw);
  const tubeRadius = ARM_TUBE_RADIUS * radiusT;
  // 행 진행도(0=어깨선~1=ARM_ROWS) → 각도. smoothstep으로 양 끝(팔
  // 맨 위=0, ARM_ROWS 경계=최대각)에서 미분이 0이 되게 해 몸통과의
  // 합류부·정수리부 모두 매끄럽다.
  const rowT = ARM_ROWS > 0 ? Math.min(y / ARM_ROWS, 1) : 1;
  const rowSmooth = rowT * rowT * (3 - 2 * rowT);
  const angle = rowSmooth * ARM_ANGLE_MAX;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle) * panelSign; // 앞판은 +쪽, 뒤판은 -쪽으로 돈다
  const offsetX = arm.dir.x * reach + (armBasis.up.x * cosA + armBasis.side.x * sinA) * tubeRadius;
  const offsetY = arm.dir.y * reach + (armBasis.up.y * cosA + armBasis.side.y * sinA) * tubeRadius;
  const offsetZ = arm.dir.z * reach + (armBasis.up.z * cosA + armBasis.side.z * sinA) * tubeRadius;
  return {
    x: edgeX + offsetX * armFactor,
    y: edgeY + offsetY * armFactor,
    z: edgeZ + offsetZ * armFactor,
  };
}

// 46번 실측(약한 지지 추가): 소매 열을 완전 무핀으로 두니(사용자 명시적
// 요청) 중력이 곧바로 끌어내려, 실측(긴팔 측면 스크린샷)해보니 팔 축
// 위에 아무 지지가 없어 어깨에 매달린 짧은 자락처럼 처지고 긴팔조차 팔
// 대부분이 노출됐다. 사용자에게 "완전 무핀 유지 + 소매가 팔 쪽으로
// 자연스럽게 끌려가는 부드러운 힘 추가" vs "지금 상태 그대로" vs "일부
// 열만 다시 핀 고정"을 물어봤고, 첫 번째를 명시적으로 선택했다
// (AskUserQuestion). 매 프레임 소매 열의 "이상적 팔 위 지점"(팔이
// 움직이면 이 목표도 같이 움직인다)으로 아주 약하게(가중치, 완전 스냅이
// 아님) 끌어당긴다 — 핀처럼 강제로 고정하지 않으므로 여전히 중력/충돌의
// 영향을 받아 자연스럽게 늘어지지만, 이 힘이 없을 때처럼 완전히 무너지지는
// 않는다.
// 46번 실측(버그): 0.08로는 눈에 띄는 변화가 전혀 없었다 — 이 보정은
// 프레임당 딱 한 번만 적용되는데, 그 사이 중력+구조 제약 완화가 서브스텝
// (최대 2회)마다 원단별 12~24회씩 돌아 훨씬 큰 "표"를 행사하므로, 작은
// 가중치로는 매 프레임 도로 씻겨 내려간다. 이 보정이 실제로 체감될
// 정도로 무게를 키운다 — 그래도 1.0(완전 스냅)은 아니므로 여전히 처짐
// 자체는 남는다.
//
// 46번 실측(진짜 원인 — 거리 제약은 방향을 모른다): 0.45로도 앞판/뒤판이
// 같은 소매 열(x=0, row0)에서 Y가 5cm나 벌어지는 게 실측(정점 좌표
// 직접 대조: 앞 y=1.246 대 뒤 y=1.296)으로 확인됐다 — addNecklineSeamConstraints
// 가 이 열도 이어주고 있지만, 그건 "거리"만 고정하는 제약이라 그 거리가
// Z 차이(의도한 랩)로 나타나든 Y 차이(중력이 만든 처짐)로 나타나든
// 상관하지 않는다. 매 프레임 중력+구조 완화가 12~24회(서브스텝 최대
// 2회)씩 돌며 이 방향을 계속 Y 쪽으로 밀어붙이는데, 소프트 풀은 프레임당
// 딱 한 번(0.45)만 되돌리니 남은 절반 이상이 매번 다시 중력에 잠식된다
// — 그 결과가 화면에서 목선/소매 경계의 들쭉날쭉한 찢어짐으로 보였다.
// 1.0(완전 스냅)에 훨씬 가깝게 올려, 목표 지점과의 잔차가 매 프레임
// 거의 다 지워지게 한다 — 그래도 완전 핀(sim.pin)은 아니므로 순간적인
// 충돌 반발 등에는 여전히 밀릴 수 있어 "완전히 뻣뻣하게 고정"까지는
// 아니다.
//
// 46번 실측(재조정 — 뻣뻣함 완화): 사용자가 "소매가 중력을 못 이기고
// 뻣뻣하게 고정돼 보인다"고 재지적했다. 0.85는 찢어짐(위 설명)을 막으려고
// 올린 값인데, 그 찢어짐의 진짜 원인은 가중치가 아니라 0번 행에서
// 앞판/뒤판이 서로 다른 지점으로 수렴하던 것이었고, 이후 형태 재설계
// (진짜 원통 각도 수학)로 0번 행은 각도=0이라 앞판/뒤판이 공식 자체에서
// 항상 같은 지점으로 계산되도록 이미 구조적으로 고쳐졌다 — 즉 이 가중치를
// 낮춰도 그 찢어짐이 재발하지 않을 가능성이 높다(실측으로 검증 필요).
// 낮춰서 중력이 더 이기게 하고, 낮춘 뒤에도 0번 행 앞/뒤 간격이 다시
// 벌어지지 않는지 반드시 재확인한다.
const ARM_SOFT_PULL_WEIGHT = 0.02;

export function applyArmSoftPull(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  if (armSpanHalf <= thw0) return;
  const armLeftBasis = armPerpBasis(armLeft.dir);
  const armRightBasis = armPerpBasis(armRight.dir);

  for (const [panel, isFront] of [
    [frontPanel, true],
    [backPanel, false],
  ] as const) {
    const panelZOffset = isFront ? FRONT_BACK_HALF_GAP : -FRONT_BACK_HALF_GAP;
    const panelSign = isFront ? 1 : -1;
    for (let y = 0; y < ROWS; y++) {
      const armFactor = armRowFactor(y);
      if (armFactor <= 0) continue;
      const v = y / (ROWS - 1);
      const thw = halfWidthAtRow(y, widthM, pinLeft, pinRight);
      for (let x = 0; x < COLS; x++) {
        const u = x / (COLS - 1) - 0.5;
        const s = u >= 0 ? 1 : -1;
        const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
        if (frac <= 1) continue;
        const arm = u < 0 ? armLeft : armRight;
        const armBasis = u < 0 ? armLeftBasis : armRightBasis;
        const i = sim.index(panel, x, y);
        if (sim.pinned[i]) continue;
        const target = sleeveExtensionPoint(y, v, s, frac, thw, thw0, armSpanHalf, arm, armBasis, topY, heightM, centerZ, panelZOffset, panelSign, sideSign, armholeStartRow, armFactor);
        const ix = i * 3;
        sim.positions[ix] += (target.x - sim.positions[ix]) * ARM_SOFT_PULL_WEIGHT;
        sim.positions[ix + 1] += (target.y - sim.positions[ix + 1]) * ARM_SOFT_PULL_WEIGHT;
        sim.positions[ix + 2] += (target.z - sim.positions[ix + 2]) * ARM_SOFT_PULL_WEIGHT;
      }
    }
  }
}

export function layoutTorsoPanels(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  // 열 방향 부호 — pinCorners와 반드시 같은 공식을 써야 한다(자세한 이유는
  // 그 함수 주석 참고).
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  const armLeftBasis = armPerpBasis(armLeft.dir);
  const armRightBasis = armPerpBasis(armRight.dir);

  for (const [panel, isFront] of [
    [frontPanel, true],
    [backPanel, false],
  ] as const) {
    const panelZOffset = isFront ? FRONT_BACK_HALF_GAP : -FRONT_BACK_HALF_GAP;
    const panelSign = isFront ? 1 : -1;
    for (let y = 0; y < ROWS; y++) {
      const v = y / (ROWS - 1); // 0 어깨선 ~ 1 밑단
      const thw = halfWidthAtRow(y, widthM, pinLeft, pinRight);
      const armFactor = armRowFactor(y);
      for (let x = 0; x < COLS; x++) {
        const u = x / (COLS - 1) - 0.5;
        const s = u >= 0 ? 1 : -1;
        const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
        const arm = u < 0 ? armLeft : armRight;
        const armBasis = u < 0 ? armLeftBasis : armRightBasis;

        if (frac <= 1) {
          // 몸통 폭 안쪽 — 기존과 동일(테이퍼에 비례해 매 행마다 폭이
          // 자연스럽게 넓어지는 원뿔형 실루엣을 유지).
          const shoulderU = s * frac * 0.5;
          const riseRowFalloff =
            armholeStartRow > 0 ? Math.max(0, 1 - y / (armholeStartRow * NECKLINE_RISE_FADE_FRACTION)) : y === 0 ? 1 : 0;
          const rise = necklineRise(isFront, shoulderU) * riseRowFalloff;
          const capZ = shoulderCapZBulge(y, shoulderU, armholeStartRow);
          sim.setParticle(
            sim.index(panel, x, y),
            -sideSign * shoulderU * 2 * thw,
            topY - v * heightM + rise,
            centerZ + panelZOffset + panelSign * capZ,
          );
        } else {
          const p = sleeveExtensionPoint(y, v, s, frac, thw, thw0, armSpanHalf, arm, armBasis, topY, heightM, centerZ, panelZOffset, panelSign, sideSign, armholeStartRow, armFactor);
          sim.setParticle(sim.index(panel, x, y), p.x, p.y, p.z);
        }
      }
    }
  }
}

// 46번: 몸통 폭 안쪽(frac<=1) 열의 [xMin, xMax] 범위 — pinCorners/
// layoutTorsoPanels와 같은 frac 공식을 재사용해, garmentStitch.ts의
// pullShoulderCapToSurface가 소매 쪽(핀 풀린) 열을 건드리지 않고 딱
// 몸통 열만 마네킹 표면으로 보정하도록 범위를 알려준다.
export function torsoColumnRange(
  cols: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): { xMin: number; xMax: number } {
  const thw0 = halfWidthAtRow(0, 0, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  let xMin = 0;
  let xMax = cols - 1;
  for (let x = 0; x < cols; x++) {
    const u = x / (cols - 1) - 0.5;
    const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
    if (frac <= 1) {
      xMin = x;
      break;
    }
  }
  for (let x = cols - 1; x >= 0; x--) {
    const u = x / (cols - 1) - 0.5;
    const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
    if (frac <= 1) {
      xMax = x;
      break;
    }
  }
  return { xMin, xMax };
}

// 옆선 시접이 armholeStartRow에서 곧바로 꽉 조인 간격(SEAM_REST_LENGTH,
// 6mm)으로 시작하면, 시접 바로 안쪽 열(자유롭게 몸 곡면을 따라가는 열)과
// 너무 튀는 차이가 생겨 옆에서 보면 그 경계가 접힌 것처럼 뾰족하게
// 튀어나와 보이는 문제가 실측(측면 카메라 각도)으로 확인됐다. 시접 시작
// 지점에서 몇 행에 걸쳐 넉넉한 간격에서 원래 목표 간격까지 서서히
// 좁혀가면(이즈인), 이 급격한 전환이 완화된다. sim.buildConstraints()
// 호출 "이후"에 불러야 한다(그 전에 부르면 buildConstraints가 이 제약까지
// 지워버린다).
export function addTorsoSideSeamConstraints(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  armholeStartRow: number,
): void {
  const SEAM_EASE_ROWS = 4;
  const SEAM_EASE_START = 0.03;
  for (let y = armholeStartRow; y < ROWS; y++) {
    const easeT = Math.min((y - armholeStartRow) / SEAM_EASE_ROWS, 1);
    const restLength = SEAM_EASE_START + (SEAM_REST_LENGTH - SEAM_EASE_START) * easeT;
    sim.addConstraint(sim.index(frontPanel, 0, y), sim.index(backPanel, 0, y), restLength);
    sim.addConstraint(sim.index(frontPanel, COLS - 1, y), sim.index(backPanel, COLS - 1, y), restLength);
  }
}

// 46번(물리 복구 후 실측): 목선~겨드랑이 사이(암홀 시접이 시작되기 전,
// y=0 어깨선 자체) 구간은 앞판과 뒤판을 잇는 제약이 하나도 없었다 — 둘은
// 어깨 양 끝(핀 코너, u=±0.5)에서만 만나고, 그 안쪽은 목선 높이
// (necklineRise)가 앞판/뒤판마다 다르게 설계돼 서로 다른 높이로 완전히
// 따로 논다. 옆선 시접(addTorsoSideSeamConstraints)과 같은 방식으로
// 진짜 거리 제약을 추가해 이어붙인다. 목표 간격은 0(딱 붙임)이 아니라
// layoutTorsoPanels가 배치한 "원래 의도한 간격"을 그대로 유지해야
// 하므로, 이 함수는 sim.buildConstraints() 직후(아직 물리가 한 스텝도
// 안 돈, 배치 그대로인 상태)에 호출해 그 시점의 실제 거리를 그대로 잰다.
export function addNecklineSeamConstraints(sim: ClothSimulation, frontPanel: number, backPanel: number): void {
  for (let x = 0; x < COLS; x++) {
    const a = sim.index(frontPanel, x, 0);
    const b = sim.index(backPanel, x, 0);
    const dx = sim.positions[b * 3] - sim.positions[a * 3];
    const dy = sim.positions[b * 3 + 1] - sim.positions[a * 3 + 1];
    const dz = sim.positions[b * 3 + 2] - sim.positions[a * 3 + 2];
    sim.addConstraint(a, b, Math.hypot(dx, dy, dz));
  }
}
