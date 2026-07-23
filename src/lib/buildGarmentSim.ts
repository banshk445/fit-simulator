import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { ARMHOLE_ROW_FRACTION, ARM_COLLISION_RADIUS, ARM_ROWS, COLS, FRONT_BACK_HALF_GAP, ROWS, SEAM_REST_LENGTH } from "./clothConfig";

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

// 46번 실측(롤백 — 몸통 가로축 강제 수축은 마네킹 충돌체와 안 맞음):
// TORSO_SHOULDER_WIDTH_SHRINK/shoulderWidthShrinkAtRow로 어깨너비 자체를
// 0.75배로 줄였더니, 실제 마네킹 어깨 충돌 부피를 옷이 못 감당해 앞/뒤판
// 재봉선이 터지는 부작용이 났다 — 몸통 폭은 원래대로 되돌리고, 대신
// 아래 sleeveExtensionPoint의 튜브 반지름 쪽에서 뽕을 억제한다(ARM_TUBE_RADIUS_SHOULDER_SCALE 참고).

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
// 47번(벡터 기반 원통 랩핑 전면 재설계): 팔 방향(dir)을 주축(fwd)으로 삼고,
// 월드 업과의 외적으로 가로축(right), 다시 fwd×right로 수직축(up)을 구해
// 팔을 감싸는 직교 기저를 만든다. 팔이 월드 업과 거의 평행(±0.99 이상)해질
// 때는 그 외적이 0에 가까워져 축이 불안정해지므로, 그 경우에만 월드
// 정면(0,0,1)을 기준축으로 바꿔 대신 쓴다 — 동적 포징이 팔을 수직에
// 가깝게(outwardAmount 낮음) 움직이는 구간에서 실제로 부딪히는 경우다.
function armOrthogonalBasis(dir: Vec3Like): { fwd: Vec3Like; right: Vec3Like; up: Vec3Like } {
  const dlen = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const fwd = { x: dir.x / dlen, y: dir.y / dlen, z: dir.z / dlen };
  const reference: Vec3Like = Math.abs(fwd.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  // right = reference × fwd
  let rx = reference.y * fwd.z - reference.z * fwd.y;
  let ry = reference.z * fwd.x - reference.x * fwd.z;
  let rz = reference.x * fwd.y - reference.y * fwd.x;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  // up = fwd × right
  const ux = fwd.y * rz - fwd.z * ry;
  const uy = fwd.z * rx - fwd.x * rz;
  const uz = fwd.x * ry - fwd.y * rx;
  return { fwd, right: { x: rx, y: ry, z: rz }, up: { x: ux, y: uy, z: uz } };
}

// 팔 둘레를 얼마나 도는지(라디안, 편측).
//
// 46번 실측(풍선 소매, 재진단): 반지름(0.085→0.055)과 소프트 풀 가중치
// (0.85→0.45)를 둘 다 낮췄는데도 스크린샷 비교 결과 실루엣이 거의
// 그대로였다 — 사용자가 "전혀 개선되지 않았다"고 정확히 지적한 대로였다.
// 진짜 원인은 반지름이나 가중치가 아니라 이 각도였다: 편측 0.675π(121.5°)
// 면 앞판+뒤판 합쳐 243°— 거의 원 전체를 감싸는 셈이라, 반지름을 아무리
// 줄여도 "작은 튜브"일 뿐 여전히 사방이 막힌 풍선/베개 단면으로 보인다.
// 실제 반팔은 이 정도로 완전히 둘러싸지 않는다 — 어깨 위쪽만 살짝
// 둥글고 나머지(옆・아래)는 그냥 중력에 맡겨 늘어진다. 각도 자체를 크게
// 줄여(편측 0.675π→0.32π, 합쳐서 115°) 완전히 감싸는 대신 "위쪽만 살짝
// 둥글고 나머지는 열려서 처지는" 모양으로 바꾼다.
const ARM_ANGLE_MAX = Math.PI * 0.32;
// 소매가 몸통 가장자리(sleeveT=0)에서 0부터 시작해 이 지점부터 최대
// 반지름을 유지하는 비율 — smoothstep으로 매끄럽게 올린다(각진 접힘선
// 방지, 이전 WRAP_RAMP_T와 같은 이유).
const ARM_TUBE_RADIUS_RAMP_T = 0.3;
// 47번(소매통 UI 슬라이더 연결): 이전엔 튜브 반지름이 고정 상수(0.04,
// 4cm)라 "소매통" 슬라이더를 아무리 움직여도 물리에 반영되지 않았다 —
// 그리고 이 4cm는 실제 팔 충돌 반경(ARM_COLLISION_RADIUS=6.5cm)보다
// 작아, 매 프레임 원통 랩핑 목표가 충돌체 "안쪽"을 가리키는 셈이라
// 충돌 반발력과 소프트 풀이 계속 서로 밀어내 소매가 어깨 쪽으로
// 쪼그라드는 원인이었다. 사용자가 입력한 소매통(단면 실측, cm)을 실제
// 반지름으로 변환해 쓴다 — 단면 W는 원통을 눌러 접었을 때의 폭이라
// 둘레는 2W, 반지름 R=2W/(2π)=W/π. 계산된 반경이 충돌 반경보다 작으면
// (좁은 슬라이더 값 등) 충돌 반발과 매 프레임 계속 싸우게 되므로,
// 최소 1cm 여유를 두고 무조건 충돌 반경보다 크도록 클램프한다.
function computeArmTubeRadius(sleeveWidthM: number): number {
  const fromMeasurement = sleeveWidthM / Math.PI;
  return Math.max(fromMeasurement, ARM_COLLISION_RADIUS + 0.01);
}
// 46번 실측(어깨 뽕 — 새 타격점, 몸통 폭 대신 튜브 반지름): 몸통 가로축을
// 직접 줄이는 시도(TORSO_SHOULDER_WIDTH_SHRINK)는 마네킹 어깨 충돌체와
// 안 맞아 재봉선이 터져 롤백했다 — 대신 소매가 원통형으로 부푸는 반지름
// 자체를 어깨 쪽에서 납작하게 누른다. ARM_TUBE_RADIUS_RAMP_T(경계~0.3)
// 구간은 그대로 0→SHOULDER_SCALE로 매끄럽게 올려 몸통과의 이음매가 갑자기
// 튀어나오지 않게 하고(연속성 유지, 안 그러면 이음매에서 다시 재봉선
// 문제 재현 우려), 그 뒤(0.3~1.0) 구간에서 SHOULDER_SCALE→1.0으로
// 이어지게 해 소매 끝으로 갈수록 원래 의도한 원통 형태가 되게 한다.
const ARM_TUBE_RADIUS_SHOULDER_SCALE = 0.45;
function tubeRadiusScale(sleeveT: number): number {
  const rampT = ARM_TUBE_RADIUS_RAMP_T;
  if (sleeveT <= rampT) {
    const t = rampT > 0 ? sleeveT / rampT : 1;
    const smooth = t * t * (3 - 2 * t);
    return ARM_TUBE_RADIUS_SHOULDER_SCALE * smooth;
  }
  const span = 1 - rampT || 1;
  const t = Math.min((sleeveT - rampT) / span, 1);
  const smooth = t * t * (3 - 2 * t);
  return ARM_TUBE_RADIUS_SHOULDER_SCALE + (1 - ARM_TUBE_RADIUS_SHOULDER_SCALE) * smooth;
}

// 47번(벡터 기반 원통 랩핑 전면 재설계 — 배경): 기존 sleeveExtensionPoint는
// "평면 위 절대 거리(flatAbsX)가 어깨 힌지 기준을 넘으면 그 초과분만 팔
// 축으로 꺾는다"는 방식이었다 — 이 앵커 자체가 팔 각도와 무관한 고정
// 임계값(dynamicShoulderHinge)에 크게 의존해, 이번 세션 내내 검증됐던
// 딱 한 자세(릴랙스드 A포즈, outward≈0.6)에서만 그럴듯한 결과가 나왔다.
// 마네킹 동적 포징(팔이 outward 0.25~0.6로 계속 움직이는 애니메이션)으로
// 실측해보니, 팔이 더 수직에 가까워지는 구간에서 소매가 팔을 따라가지
// 못하고 평평한 "널빤지/날개" 모양으로 남는 회귀가 재현됐다 — 원인은
// 그 자세에서만 우연히 맞았던 하드코딩된 임계값/블렌드 계수 조합이
// 각도가 바뀌면 더 이상 맞지 않았기 때문.
//
// 전면 재설계: 몸통 경계(앵커)에서 시작해 팔의 실제 방향 벡터(fwd)를
// 축으로 하는 직교 기저(armOrthogonalBasis)를 세우고, 그 축을 따라
// sleeveT만큼 나아간 지점(중심선) 둘레를 반지름만큼 감아 원통을 만든다.
// 이 원통은 팔이 어느 각도를 향하든(fwd가 바뀌면 축 자체가 그대로
// 따라 돈다) 항상 팔을 축으로 하는 진짜 원통이므로, 특정 자세에서만
// 맞는 임계값이 필요 없다. "어깨(sleeveT=0)는 평평하게, 소매 끝
// (sleeveT=1)은 완전한 원통으로"라는 블렌딩은 reach(=armLength*sleeveT)와
// tubeRadiusScale(sleeveT)이 둘 다 sleeveT=0에서 0으로 시작해 서서히
// 커지는 것만으로 자연스럽게 달성된다 — sleeveT=0에서는 중심선이 앵커에
// 그대로 머물고 반지름도 0이라 몸통 가장자리와 매끈하게 이어진다.
//
// frac(열별 가로 확장 비율) → sleeveT(0=몸통 경계 진입점, 1=소매 끝)로 정규화.
// sleeveExtensionPoint와 armSoftPullWeight가 같은 진행도 값을 써야 해서 분리.
function computeSleeveT(frac: number, thw0: number, armSpanHalf: number): number {
  const maxFrac = thw0 > 0 ? armSpanHalf / thw0 : 1;
  return maxFrac > 1 ? Math.min((frac - 1) / (maxFrac - 1), 1) : 0;
}

function sleeveExtensionPoint(
  y: number,
  v: number,
  s: number,
  frac: number,
  thw: number,
  thw0: number,
  armSpanHalf: number,
  arm: ArmDir,
  armBasis: { fwd: Vec3Like; right: Vec3Like; up: Vec3Like },
  topY: number,
  heightM: number,
  centerZ: number,
  panelSign: number,
  sideSign: number,
  armFactor: number,
  armholeStartRow: number,
  armTubeRadius: number,
  wrapFactor = 1,
): { x: number; y: number; z: number } {
  const sleeveT = computeSleeveT(frac, thw0, armSpanHalf);
  // 앵커(몸통 경계) — 이 행에서 토르소 패널이 끝나는 지점. torsoWrapCurve는
  // outerness=1(바로 이 경계)에서 0으로 수렴해 앞/뒤판 Z가 이미 하나로
  // 합쳐지지만, shoulderCapZBulge(삼각근 돔 표현)는 반대로 outerness=1에서
  // 최대치라 여기서 무시하면 토르소 쪽 앞/뒤판이 이 경계에서 수 cm 벌어진
  // 채로 소매와 이어붙는 실측 간극이 생긴다(스트레스 테스트로 확인,
  // 2.5cm 문턱 근접/초과). 토르소 branch와 같은 공식으로 이 볼록함만은
  // 그대로 이어받는다 — outerness는 앵커에서 항상 1(경계 자체)이다.
  const anchorX = -sideSign * s * thw;
  const anchorY = topY - v * heightM;
  const anchorZ = centerZ + panelSign * shoulderCapZBulge(y, s * 0.5, armholeStartRow);

  // 팔 축(fwd)을 따라 sleeveT만큼 나아간 변위 — sleeveT=0이면 reach=0이라
  // 앵커 그 자체다. armRowFactor(행 진행도, 0=어깨선~1=ARM_ROWS 경계에서 0)를
  // 반드시 이 reach 변위 자체에 곱해야 한다 — 곱하지 않으면 ARM_ROWS를
  // 한참 지난 행(밑단 근처)까지도 팔 축 방향으로 최대 armLength(58cm 등)
  // 만큼 끌려가, 소매 열 전체가 세로로는 거의 한 점(팔 축 위 한 지점)에
  // 몰리고 가로(열)로만 부채꼴로 퍼지는 평평한 망토/텐트 모양이 된다
  // (실측: 물리 솔버를 끄고 초기 배치만 렌더링해도 이미 저 모양이었다 —
  // 물리 붕괴가 아니라 이 초기 배치 공식 자체의 버그였다).
  const reach = arm.length * sleeveT;
  const dispX = armBasis.fwd.x * reach;
  const dispY = armBasis.fwd.y * reach;
  const dispZ = armBasis.fwd.z * reach;

  // 행 진행도(0=어깨선~1=ARM_ROWS) → 둘레 각도. smoothstep으로 양 끝(팔
  // 맨 위=0, ARM_ROWS 경계=최대각)에서 미분이 0이 되게 해 몸통과의
  // 합류부·정수리부 모두 매끄럽다. 반지름은 tubeRadiusScale(sleeveT)로
  // 어깨(0)에서 0(평면)부터 시작해 소매 끝으로 갈수록 완전한 원통이
  // 되도록 서서히 키운다.
  const rowT = ARM_ROWS > 0 ? Math.min(y / ARM_ROWS, 1) : 1;
  const rowSmooth = rowT * rowT * (3 - 2 * rowT);
  const angle = rowSmooth * ARM_ANGLE_MAX;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle) * panelSign; // 앞판은 +쪽, 뒤판은 -쪽으로 돈다
  const radius = armTubeRadius * tubeRadiusScale(sleeveT) * wrapFactor;
  const wrapX = (armBasis.right.x * cosA + armBasis.up.x * sinA) * radius;
  const wrapY = (armBasis.right.y * cosA + armBasis.up.y * sinA) * radius;
  const wrapZ = (armBasis.right.z * cosA + armBasis.up.z * sinA) * radius;

  return {
    x: anchorX + (dispX + wrapX) * armFactor,
    y: anchorY + (dispY + wrapY) * armFactor,
    z: anchorZ + (dispZ + wrapZ) * armFactor,
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
// 항상 같은 지점으로 계산되도록 이미 구조적으로 고쳐졌다.
//
// 46번 실측(풍선 소매 — 진짜 원인, 그리고 되돌림): 반지름(0.085→0.055)·
// 각도(0.675π→0.32π)를 낮춰도 실루엣이 거의 그대로였던 건, 이 소프트
// 풀이 "목표 형태"를 매 프레임 다시 강하게 찍어 누르고 있었기 때문이었다
// (목표 형태 파라미터를 바꿔봤자 여전히 그 목표 그대로만 보임). 0.15로
// 낮추니 실루엣은 확실히 달라졌지만(스크린샷 확인), 열 x=0 한 곳만 재던
// 최초 검증(7.4mm)이 대표성이 없었다 — 행 0~13·열 전체를 다시 스캔해보니
// 실제로는 최대 3.7cm까지 앞판/뒤판이 벌어져 있었고(사용자 스크린샷에서
// 어깨 쪽에 실제로 찢어짐이 보임), 이 간격에 옆선 시접과 같은 진짜 거리
// 제약을 추가해 봐도 더 악화됐다(8cm) — 거리 제약은 "총 거리"만 고정할
// 뿐 그 거리가 어느 축으로 나타나는지는 못 정하므로(같은 종류의 문제가
// 이미 한 번 있었다, 위 설명 참고), 목표 거리 자체가 0이 아닌(즉 앞뒤가
// 실제로 떨어져 있어야 하는) 행에는 이 방식이 아예 안 통한다. 이 가중치
// 하나로 "풍성함"과 "안 찢어짐"을 동시에 만족시킬 방법을 못 찾아, 일단
// 확실히 검증된 값(0.45)으로 되돌렸었다.
//
// 46번 실측(재시도 — 축 전용 보정 추가): enforceArmFrontBackYAlignment
// (아래)로 Y 벌어짐만 따로 잡는 보정을 추가한 뒤, 다시 낮춰 실제로
// "풍성함"과 "안 찢어짐"이 분리되는지 확인했다 — 0.15 균일값으로 짧은
// 반팔(22cm)에서는 찢어짐 없이 풍선기가 줄었지만, 실제 사용자 사진으로
// 재확인해보니 여전히 어깨가 뽕처럼 부풀고 팔 아래로 빈 틈이 보였다.
//
// 46번 실측(균일 가중치의 한계 — 행별 감쇠로 교체): 지금까지 이 가중치
// 하나를 소매 구간 전체(행 0~ARM_ROWS)에 똑같이 적용해왔다 — 어깨 바로
// 아래(행 1~2)와 소매 끝(행 ARM_ROWS 근처)이 "목표 형태를 향한 복원력"을
// 똑같은 세기로 받고 있었다는 뜻이다. 어깨 근처는 목선/몸통과 매끈하게
// 이어져야 해서 어느 정도 형태를 지켜야 하지만, 소매 끝으로 갈수록 옷이
// 실제 팔을 따라 중력으로 자연스럽게 처지는 게 더 사실적이다 — 이 둘을
// 같은 가중치로 뭉뚱그리면 "소매 끝까지 다 같이 뻣뻣" 아니면 "어깨까지
// 다 같이 축 처짐" 둘 중 하나만 고를 수밖에 없었다. 행 진행도(어깨=0
// ~ARM_ROWS=소매 끝)를 기준으로 가중치 자체를 연속적으로 낮춰(smoothstep),
// 어깨 쪽은 형태를 유지하고 소매 끝은 중력에 훨씬 더 크게 맡긴다.
// 46번 실측(행 기반 감쇠의 한계 — sleeveT 기반 U자 커브로 교체): 위
// armSoftPullWeight(y)는 행(어깨선=0~ARM_ROWS) 기준이라 소매 길이와
// 무관했다 — 58cm 긴팔도 22cm 반팔과 똑같은 9개 행 안에서 가중치가
// 최솟값까지 떨어지므로, 긴팔은 그 좁은 구간 밖(sleeveT 기준 팔 중간
// ~끝 구간)에서 사실상 무방비 상태가 되어 평평한 망토 모양으로 퍼졌다
// (사용자 스크린샷으로 확인). sleeveT(팔 길이 방향 진행도, 0=몸통
// 경계~1=소매 끝)를 기준으로 바꾸면 소매 길이에 무관하게 항상 같은
// 상대 위치에서 같은 세기를 받는다. 어깨(0)~중간(0.5)은 약하게 풀어
// 중력이 자연스럽게 처지게 하고, 중간~끝단(1.0)은 다시 강하게 당겨
// 소매 끝을 includeWrap=true 목표(둥근 원통 형태)로 말아준다 — 중간만
// 늘어지고 끝단은 다시 오므라드는 실제 긴팔 실루엣을 흉내낸다.
// 46번 실측(1D sleeveT 단독의 한계 — 2D 곱연산으로 교체): sleeveT만으로
// 가중치를 정하니(위 주석) frac이 y와 무관해서 어깨-소매 경계 링(row 0)이
// 컬럼과 상관없이 항상 같은 가중치를 받아 특별 보호를 잃었고(반팔 어깨
// 뽕 악화, 실측 스크린샷 확인), 반대로 커프(sleeveT≈1) 가중치를 아무리
// 올려도 초기 배치가 굳힌 구조 제약 rest length(평평하게 뻗은 모양)를
// 못 이겨 긴팔은 여전히 평평했다. 행(어깨 경계 링 보호)과 열(소매 길이
// 진행에 따른 U자 형태 제어)은 서로 다른 독립적인 축이라는 게 실측으로
// 확인된 셈 — 두 가중치를 곱해서 둘 다 만족시킨다.
function armCombinedSoftPullWeight(y: number, sleeveT: number): number {
  const tY = ARM_ROWS > 0 ? Math.min(y / ARM_ROWS, 1) : 1;
  const smoothY = tY * tY * (3 - 2 * tY);
  const rowWeight = 0.5 + (0.1 - 0.5) * smoothY;

  const t = Math.min(Math.max(sleeveT, 0), 1);
  let lengthWeight: number;
  if (t <= 0.5) {
    const local = t / 0.5;
    const smoothT = local * local * (3 - 2 * local);
    lengthWeight = 1.0 + (0.1 - 1.0) * smoothT;
  } else {
    const local = (t - 0.5) / 0.5;
    const smoothT = local * local * (3 - 2 * local);
    lengthWeight = 0.1 + (1.0 - 0.1) * smoothT;
  }

  return rowWeight * lengthWeight;
}

// 46번(옵션 B — 타이트 튜브핏, 증폭): 겨드랑이 밑단(underarm seam)을
// 마네킹 팔뚝에 바짝 당기는 추가 인력의 세기/들어올림 폭 — 스트레스
// 테스트 텐션 마진(최대 1.63cm)이 넉넉해 과감히 올린다.
const UNDERARM_HUG_WEIGHT = 1.0;
const UNDERARM_LIFT = 0.15; // 15cm 위쪽/안쪽으로 추가 당김
// 46번 실측(겨드랑이 드레이프 — 종이박스 문제): 어깨(y=0)는 목선에
// 고정되고 밑단(y=ARM_ROWS)은 UNDERARM_HUG/LIFT로 팔뚝에 바짝 당겨지니,
// 그 둘 사이(소매 안쪽 면)는 양 끝이 다 붙잡혀 중력을 받아도 처질
// 여유가 없어 비행기 날개처럼 평평하게 펴져 보였다 — 행 진행도의
// 포물선(0, ARM_ROWS에서 0, 중간에서 최대)으로 아래로 살짝 더 당겨,
// 양 끝은 그대로 두고 중간만 무게감 있게 늘어지게 한다.
const DRAPE_SAG = 0.05; // 중간 지점 최대 처짐 5cm

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
  sleeveWidthM: number,
): void {
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  if (armSpanHalf <= thw0) return;
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const armTubeRadius = computeArmTubeRadius(sleeveWidthM);
  const armLeftBasis = armOrthogonalBasis(armLeft.dir);
  const armRightBasis = armOrthogonalBasis(armRight.dir);

  for (const [panel, isFront] of [
    [frontPanel, true],
    [backPanel, false],
  ] as const) {
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
        const sleeveT = computeSleeveT(frac, thw0, armSpanHalf);
        const weight = armCombinedSoftPullWeight(y, sleeveT);
        const target = sleeveExtensionPoint(y, v, s, frac, thw, thw0, armSpanHalf, arm, armBasis, topY, heightM, centerZ, panelSign, sideSign, armFactor, armholeStartRow, armTubeRadius);
        // 46번 실측(옵션 B — 겨드랑이 밑단을 팔뚝에 밀착): rowWeight가
        // 정확히 이 행(y=ARM_ROWS, 밑단/최대 각도 지점)에서 최솟값(0.1)
        // 이라, 겨드랑이 시접이 가장 약하게 당겨져 중력에 그대로 처졌다
        // — 밑단에 가까울수록(underarmT), 소매를 따라 나갈수록(sleeveT)
        // 강해지는 별도의 당김을 얹어 팔뚝 표면에 바짝 감기게 한다.
        const underarmT = ARM_ROWS > 0 ? Math.min(y / ARM_ROWS, 1) : 1;
        const underarmSmooth = underarmT * underarmT * (3 - 2 * underarmT);
        const underarmBoost = UNDERARM_HUG_WEIGHT * underarmSmooth * sleeveT;
        const pullWeight = Math.max(weight, underarmBoost);
        const dropBell = 4 * underarmT * (1 - underarmT); // 0(어깨)~1(중간)~0(밑단)
        const targetY = target.y + UNDERARM_LIFT * underarmSmooth * sleeveT - DRAPE_SAG * dropBell * sleeveT;
        const ix = i * 3;
        sim.positions[ix] += (target.x - sim.positions[ix]) * pullWeight;
        sim.positions[ix + 1] += (targetY - sim.positions[ix + 1]) * pullWeight;
        sim.positions[ix + 2] += (target.z - sim.positions[ix + 2]) * pullWeight;
      }
    }
  }
}

// 46번 실측(거리 제약은 방향을 못 가림 — 진짜 원인 재확인): ARM_SOFT_PULL_WEIGHT
// 를 풍선 실루엣 개선을 위해 낮추면(예: 0.15), 소매 구간(0~ARM_ROWS 행)의
// 앞판/뒤판이 실제로 최대 3.7cm까지 Y로 벌어지는 게 실측(전체 행/열 스캔)
// 으로 확인됐다 — 옆선 시접과 같은 "두 점 사이 총 거리" 제약을 이 구간에
// 추가해봤지만 오히려 8cm로 악화됐다: 그 거리 제약은 "총 거리"만 볼 뿐
// 그 거리가 어느 축(Y든 X/Z든)으로 나타나는지는 전혀 구분하지 못해서,
// 목표 거리 자체가 크고 0이 아닌(원래 앞뒤가 떨어져 있어야 정상인) 이
// 구간에는 아예 안 통했다.
//
// enforceLeftRightSymmetry(좌우 대칭 보정)가 쓰는 것과 같은 원리 —
// "거리를 고정"하는 대신 "특정 축 하나만 평균으로 블렌드"하는 방식으로
// 바꾼다. 앞판/뒤판의 Y만 서로 가깝게 당기고 X/Z(의도한 반경 방향 퍼짐,
// sleeveExtensionPoint의 각도 스윕이 만드는 값)는 그대로 둔다 — 찢어짐의
// 실체가 "Y가 벌어지는 것"이었으므로, Y만 콕 집어 고치면 X/Z로 나타나는
// 의도한 모양(둘레 각도 차이)은 안 건드리면서 찢어짐만 없앨 수 있다.
const ARM_FRONT_BACK_Y_ALIGN_BLEND = 0.5;
// 46번 실측(경계 누수): 딱 ARM_ROWS까지만 보정하니 긴팔(58cm, 반팔보다
// reach가 커서 처짐 폭도 큼)에서 바로 그 경계(행 13, ARM_ROWS=12 바로
// 다음)에 7.26cm짜리 큰 틈이 남았다 — armFactor가 그 행에서 0이 되어
// 이론상 앞/뒤가 같은 지점으로 수렴해야 하지만, 물리 반복이 그 수렴을
// 완벽히 못 따라가는 여유(buffer) 구간이 필요했다. 몇 행 더 여유를 둔다
// (다른 곳의 SEAM_EASE_ROWS와 같은 이유).
const ARM_Y_ALIGN_ROW_BUFFER = 4;

export function enforceArmFrontBackYAlignment(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const thw0 = halfWidthAtRow(0, 0, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  if (armSpanHalf <= thw0) return;

  const maxRow = Math.min(ARM_ROWS + ARM_Y_ALIGN_ROW_BUFFER, ROWS - 1);
  for (let y = 0; y <= maxRow; y++) {
    for (let x = 0; x < COLS; x++) {
      const u = x / (COLS - 1) - 0.5;
      const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
      if (frac <= 1) continue;
      const fi = sim.index(frontPanel, x, y);
      const bi = sim.index(backPanel, x, y);
      const fPinned = sim.pinned[fi];
      const bPinned = sim.pinned[bi];
      if (fPinned && bPinned) continue;
      const fiy = fi * 3 + 1;
      const biy = bi * 3 + 1;
      const fy = sim.positions[fiy];
      const by = sim.positions[biy];
      const avgY = (fy + by) / 2;
      if (!fPinned) sim.positions[fiy] += (avgY - fy) * ARM_FRONT_BACK_Y_ALIGN_BLEND;
      if (!bPinned) sim.positions[biy] += (avgY - by) * ARM_FRONT_BACK_Y_ALIGN_BLEND;
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
  sleeveWidthM: number,
): void {
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  // 열 방향 부호 — pinCorners와 반드시 같은 공식을 써야 한다(자세한 이유는
  // 그 함수 주석 참고).
  const sideSign = Math.sign(pinLeft.x - pinRight.x) || 1;
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  const armTubeRadius = computeArmTubeRadius(sleeveWidthM);
  const armLeftBasis = armOrthogonalBasis(armLeft.dir);
  const armRightBasis = armOrthogonalBasis(armRight.dir);

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
          // 46번 실측(몸통 랩핑 — 평평한 널빤지 문제): panelZOffset(±5cm)이
          // 몸통 폭 전체에 균일하게 적용돼, 가슴 중앙이든 옆구리든 앞/뒤판
          // Z간격이 똑같았다 — 실제 흉곽은 중앙(가슴/등)이 가장 튀어나오고
          // 옆선으로 갈수록 앞/뒤가 하나로 모이는 둥근 단면이다. outerness
          // (0=중앙~1=옆선)에 코사인 곡선을 곱해, 중앙은 원래 두께 그대로
          // 두고 옆선에서는 Z가 centerZ로 수렴하도록 굴곡을 준다 — 소매
          // 랩핑(sleeveExtensionPoint의 각도 스윕)과 같은 원리를 몸통에도
          // 적용한 것.
          const outerness = Math.min(Math.abs(shoulderU) * 2, 1);
          const torsoWrapCurve = Math.cos((Math.PI / 2) * outerness);
          sim.setParticle(
            sim.index(panel, x, y),
            -sideSign * shoulderU * 2 * thw,
            topY - v * heightM + rise,
            centerZ + panelZOffset * torsoWrapCurve + panelSign * capZ,
          );
        } else {
          // 46번 실측(rest length 자체에 pre-bend 주입): wrapFactor=false(0)
          // 균일 직선 배치로는 구조 제약이 "완전히 평평한 모양"을 rest
          // length로 굳혀버려, 긴 소매(58cm)는 소프트 풀 가중치를 아무리
          // 올려도 그 평평함을 못 이겼다(위 armCombinedSoftPullWeight 주석
          // 실측 참고). sleeveT(0=몸통 경계~1=소매 끝)를 그대로 wrapFactor로
          // 써서, 초기 배치 자체를 어깨는 평평하게(뽕 방지) 끝단은 점점
          // 둥글게(원통형으로) 놓는다 — 구조 제약이 매 반복 100% 강도로
          // 지키는 rest length 자체가 이미 커프 쪽에서 말려있으므로,
          // 소프트 풀은 그 위에 얹는 약한 보정만 하면 된다.
          const wrapFactor = computeSleeveT(frac, thw0, armSpanHalf);
          const p = sleeveExtensionPoint(y, v, s, frac, thw, thw0, armSpanHalf, arm, armBasis, topY, heightM, centerZ, panelSign, sideSign, armFactor, armholeStartRow, armTubeRadius, wrapFactor);
          sim.setParticle(sim.index(panel, x, y), p.x, p.y, p.z);
        }
      }
    }
  }
}

// 47번(벡터 기반 원통 랩핑 재설계 — 길이 축소 하드코딩 제거): 예전
// sleeveExtensionPoint는 평면에 배치한 뒤 팔 축으로 "꺾는" 방식이라 실제
// 팔보다 넓게 재단된 잉여 표면적이 남았고, 그걸 rest length를 사후에
// 줄여(SLEEVE_SHRINK_AT_TIP/CIRCUM_SHRINK_AT_TIP) 보정해야 했다 — 지금은
// layoutTorsoPanels가 sleeveExtensionPoint(진짜 원통 삼각함수)로 애초에
// 기하학적으로 맞는 좌표를 놓으므로 buildConstraints()가 굳히는 rest
// length 자체가 이미 정확한 원통 간격이다. 사후 길이 축소는 더 이상
// 필요 없어 제거하고, 아래 강성 완화(중력이 원통을 실제로 늘어뜨리게
// 하는 것)만 남긴다.
// 46번 실측(A자 텐트 다음 문제 — PBD 격자 잠김, 골판지 현상): 원통으로
// 랩핑될 때 대각선(전단) 제약이 매 반복 100% 강도로 저항해 각진 채로
// 굳었다 — clothPhysics.ts에 제약별 stiffness를 추가해(scaleConstraintStiffness),
// 소매 영역(구조/전단/벤드 전부, sleeveT로 갈수록)을 완화한다. 여러 차례
// 실측 끝에 15%가 가장 자연스러운 드레이프를 보였다(60%/35%는 너무
// 뻣뻣해 비행기 날개처럼 보였다).
const SLEEVE_STIFFNESS_AT_TIP = 0.15;
export function relaxSleeveStiffness(
  sim: ClothSimulation,
  widthM: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  if (armSpanHalf <= thw0) return;
  const rowOf = (i: number): number => Math.floor((i % (COLS * ROWS)) / COLS);
  // sleeveT는 열(x)에만 좌우된다(panel/행과 무관 — sleeveExtensionPoint의
  // frac 공식 참고) — 파티클 인덱스에서 열만 뽑아내면 된다. 두 패널 모두
  // COLS*ROWS 크기라 panel 오프셋이 COLS의 배수라, i % COLS가 그대로 열이다.
  const sleeveTOf = (i: number): number => {
    const x = i % COLS;
    const u = x / (COLS - 1) - 0.5;
    const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
    if (frac <= 1) return 0;
    return computeSleeveT(frac, thw0, armSpanHalf) * armRowFactor(rowOf(i));
  };
  sim.scaleConstraintStiffness((a, b) => {
    const avgT = (sleeveTOf(a) + sleeveTOf(b)) / 2;
    if (avgT <= 0) return 1;
    return 1 + (SLEEVE_STIFFNESS_AT_TIP - 1) * avgT;
  });
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

// 46번(디테일 조각 1단계 — 넥라인/어깨 안착): 목~쇄골 중앙부(frac이 0에
// 가까운 안쪽 열, y=1~2)는 레이아웃이 배치한 그대로 굳어 있어 마네킹
// 피부에서 살짝 붕 떠 보였다 — pullShoulderCapToSurface는 rowT가 row1
// 에서 거의 0(핀 위치에 가깝게 유지)이라 이 구간을 거의 안 건드린다.
// 매 프레임 가벼운 소프트 풀로 Y는 살짝 아래로, Z는 몸 중심(centerZ)
// 쪽으로 당겨 자연스럽게 가라앉힌다 — 목 중앙(|u|≈0)일수록 강하고
// 어깨 쪽(|u|↑)으로 갈수록 약해진다.
const NECKLINE_HUG_ROWS = 2; // y=1~2에 적용(0은 핀)
const NECKLINE_HUG_WEIGHT = 0.15;
const NECKLINE_HUG_DOWN = 0.02; // 2cm
const NECKLINE_HUG_CENTER_SPAN = 0.3; // |u|가 이 값을 넘으면 효과 0
export function applyNecklineHug(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  widthM: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  for (const panel of [frontPanel, backPanel]) {
    for (let y = 1; y <= NECKLINE_HUG_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const u = x / (COLS - 1) - 0.5;
        const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
        if (frac > 1) continue; // 몸통 안쪽만(소매 열 제외)
        const centerCloseness = 1 - Math.min(Math.abs(u) / NECKLINE_HUG_CENTER_SPAN, 1);
        if (centerCloseness <= 0) continue;
        const i = sim.index(panel, x, y);
        if (sim.pinned[i]) continue;
        const w = NECKLINE_HUG_WEIGHT * centerCloseness;
        const ix = i * 3;
        sim.positions[ix + 1] -= NECKLINE_HUG_DOWN * w;
        sim.positions[ix + 2] += (centerZ - sim.positions[ix + 2]) * w;
      }
    }
  }
}

// 46번(디테일 조각 1단계 — 어깨 둥글리기): 어깨 끝(힌지)으로 넘어가는
// 몸통 상단부(y=0~3)의 구조 제약이 다른 부위와 똑같이 100% 강성이라,
// 마네킹의 둥근 어깨뼈를 뻣뻣하게 그대로 덮었다 — 소매 열(frac>1)은
// 이미 SLEEVE_STIFFNESS_AT_TIP으로 따로 관리되므로 건드리지 않고,
// 몸통 열(frac<=1)의 이 상단 구간만 살짝(0.8배) 완화해 천이 어깨를
// 부드럽게 감싸며 떨어지게 한다.
const SHOULDER_ROLL_STIFFNESS = 0.8;
const SHOULDER_ROLL_ROWS = 3; // y=0~3
export function applyShoulderRollStiffness(
  sim: ClothSimulation,
  widthM: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  const rowOf = (i: number): number => Math.floor((i % (COLS * ROWS)) / COLS);
  const colOf = (i: number): number => i % COLS;
  const isTorso = (i: number): boolean => {
    const x = colOf(i);
    const u = x / (COLS - 1) - 0.5;
    const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
    return frac <= 1;
  };
  sim.scaleConstraintStiffness((a, b) => {
    if (rowOf(a) > SHOULDER_ROLL_ROWS || rowOf(b) > SHOULDER_ROLL_ROWS) return 1;
    if (!isTorso(a) || !isTorso(b)) return 1;
    return SHOULDER_ROLL_STIFFNESS;
  });
}

// 옆선 시접이 armholeStartRow에서 곧바로 꽉 조인 간격(SEAM_REST_LENGTH,
// 6mm)으로 시작하면, 시접 바로 안쪽 열(자유롭게 몸 곡면을 따라가는 열)과
// 너무 튀는 차이가 생겨 옆에서 보면 그 경계가 접힌 것처럼 뾰족하게
// 튀어나와 보이는 문제가 실측(측면 카메라 각도)으로 확인됐다. 시접 시작
// 지점에서 몇 행에 걸쳐 넉넉한 간격에서 원래 목표 간격까지 서서히
// 좁혀가면(이즈인), 이 급격한 전환이 완화된다. sim.buildConstraints()
// 호출 "이후"에 불러야 한다(그 전에 부르면 buildConstraints가 이 제약까지
// 지워버린다).
// 46번 실측(진짜 원인 — 옆구리 시접 위치 자체가 틀림): x=0/COLS-1은
// 그리드 맨 끝(=반대쪽 소매 끝단)이지 몸통 옆선이 아니다 — COLS=44 폭이
// 좌측 소매 끝~몸통~우측 소매 끝을 전부 아우르므로, 이 시접은 사실
// 엉뚱하게 소매 커프끼리 잇고 있었고 정작 몸통 옆구리(겨드랑이~밑단)는
// 한 번도 안 이어져 판초우의처럼 옆이 뚫려 있었다(탑다운 스크린샷으로
// 확인). torsoColumnRange로 실제 몸통 경계에 가장 가까운 좌/우 열을
// 찾아 그 위치를 잇는다.
export function addTorsoSideSeamConstraints(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  armholeStartRow: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const { xMin, xMax } = torsoColumnRange(COLS, pinLeft, pinRight, armLeft, armRight);
  const SEAM_EASE_ROWS = 4;
  const SEAM_EASE_START = 0.03;
  for (let y = armholeStartRow; y < ROWS; y++) {
    const easeT = Math.min((y - armholeStartRow) / SEAM_EASE_ROWS, 1);
    const restLength = SEAM_EASE_START + (SEAM_REST_LENGTH - SEAM_EASE_START) * easeT;
    sim.addConstraint(sim.index(frontPanel, xMin, y), sim.index(backPanel, xMin, y), restLength);
    sim.addConstraint(sim.index(frontPanel, xMax, y), sim.index(backPanel, xMax, y), restLength);
  }
}

// 46번 실측(옵션 B — 소매 밑단 재봉선 부재가 진짜 원인): addTorsoSideSeamConstraints는
// x=0/COLS-1(그리드 맨 끝, 사실상 반대쪽 소매 끝단)과 armholeStartRow
// 이후 행만 잇는다 — 소매 몸체(중간 열, frac>1)는 앞판/뒤판을 실제로
// 붙드는 거리 제약이 하나도 없이 소프트 풀/Y정렬만으로 간접 결합돼
// 있었다. 이게 "원통이 아니라 커튼처럼 펄럭이는" 진짜 원인이었다 — 소매가
// 최대로 감싸는 행(ARM_ROWS, 각도 최대 지점=겨드랑이 밑단)에서 소매
// 열(frac>1) 전체에 걸쳐 앞/뒤판을 옆선 시접과 같은 이즈인 패턴으로
// 잇는다. restLength를 곧장 0으로 스냅하면(이번 세션 내내 확인된 패턴)
// 아직 Z-fade가 덜 수렴한 sleeveT≈0 근처에서 다시 찢어지므로, sleeveT가
// 커질수록(몸통 경계→소매 끝) 서서히 SEAM_REST_LENGTH까지 좁아지게 한다.
export function addSleeveUnderarmSeamConstraints(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  widthM: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
): void {
  const thw0 = halfWidthAtRow(0, widthM, pinLeft, pinRight);
  const armSpanHalf = thw0 + Math.max(armLeft.length, armRight.length);
  if (armSpanHalf <= thw0) return;
  const bottomY = ARM_ROWS;
  const SEAM_EASE_START = 0.03;
  for (let x = 0; x < COLS; x++) {
    const u = x / (COLS - 1) - 0.5;
    const frac = thw0 > 0 ? (Math.abs(u) * 2 * armSpanHalf) / thw0 : 0;
    if (frac <= 1) continue;
    const sleeveT = computeSleeveT(frac, thw0, armSpanHalf);
    const restLength = SEAM_EASE_START + (SEAM_REST_LENGTH - SEAM_EASE_START) * sleeveT;
    sim.addConstraint(sim.index(frontPanel, x, bottomY), sim.index(backPanel, x, bottomY), restLength);
    // 46번 실측: 소매 밑단(겨드랑이)만 꿰매고 위쪽(어깨선, y=0)은 그대로
    // 열려 있었다 — row 0은 소매 열(frac>1)에서 무핀이라(사용자 명시적
    // 요청) 자유롭게 움직이는데도 앞/뒤판을 잇는 제약이 전혀 없어, 이
    // 어깨쪽 트임도 커튼처럼 벌어지는 데 한몫했다. 같은 이즈인 배수를
    // 재사용해 위쪽도 마저 닫는다.
    sim.addConstraint(sim.index(frontPanel, x, 0), sim.index(backPanel, x, 0), restLength);
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
//
// 46번 실측(약한 소프트 풀 → 진짜 찢어짐): ARM_SOFT_PULL_WEIGHT를 낮춰
// 풍선 실루엣을 개선하자, 소매 구간(0~ARM_ROWS 행)에서 앞판/뒤판이 실제로
// 최대 3.7cm까지 벌어지는 게 실측(전체 행/열 스캔)으로 확인됐다 — 사용자가
// "끊겨 보인다"고 정확히 지적한 원인이었다. 소프트 풀(매 프레임 한 번,
// 완전 스냅 아님)만으로 이 간격을 붙잡고 있었는데, 가중치를 낮추면 그
// 붙잡는 힘 자체가 약해져 중력이 이 방향(간격을 벌리는 쪽)으로도 자유롭게
// 이길 수 있게 된 것 — "풍성함"과 "붙어있음"이 같은 손잡이(가중치)에
// 묶여 있었다는 뜻이다. 이 둘을 분리한다: 소매 구간(row 0~ARM_ROWS)
// 전체에 옆선 시접과 같은 진짜 거리 제약을 추가해, 다른 구조 제약과
// 똑같이 매 반복(iteration)마다 풀리게 한다 — 소프트 풀 가중치를 아무리
// 낮춰도(풍성함은 마음껏 조정해도) 이 제약은 별개로 항상 유지된다.
export function addNecklineSeamConstraints(
  sim: ClothSimulation,
  frontPanel: number,
  backPanel: number,
  maxRow = 0,
): void {
  for (let y = 0; y <= maxRow; y++) {
    for (let x = 0; x < COLS; x++) {
      const a = sim.index(frontPanel, x, y);
      const b = sim.index(backPanel, x, y);
      const dx = sim.positions[b * 3] - sim.positions[a * 3];
      const dy = sim.positions[b * 3 + 1] - sim.positions[a * 3 + 1];
      const dz = sim.positions[b * 3 + 2] - sim.positions[a * 3 + 2];
      sim.addConstraint(a, b, Math.hypot(dx, dy, dz));
    }
  }
}
