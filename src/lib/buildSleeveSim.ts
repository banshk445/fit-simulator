import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { SLEEVE_COLS } from "./clothConfig";

// 팔 축(dir)에 수직인 정규직교 기저(right/up)를 구한다. 원통 단면(링)을
// 그리려면 축에 수직인 두 방향이 필요한데, dir이 어느 쪽을 향하든(포즈가
// 바뀌어도) 외적이 0벡터가 되지 않도록 기준축을 상황에 따라 골라 쓴다 —
// dir이 world Y와 거의 평행(팔이 수직에 가까움)하면 X를 기준으로, 아니면
// Y를 기준으로 삼는다.
export function perpendicularBasis(dir: Vec3Like): { right: Vec3Like; up: Vec3Like } {
  const useYRef = Math.abs(dir.y) < 0.9;
  const refX = useYRef ? 0 : 1;
  const refY = useYRef ? 1 : 0;
  const refZ = 0;
  let rx = refY * dir.z - refZ * dir.y;
  let ry = refZ * dir.x - refX * dir.z;
  let rz = refX * dir.y - refY * dir.x;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  const ux = dir.y * rz - dir.z * ry;
  const uy = dir.z * rx - dir.x * rz;
  const uz = dir.x * ry - dir.y * rx;
  return { right: { x: rx, y: ry, z: rz }, up: { x: ux, y: uy, z: uz } };
}

// 어깨 위치+팔 방향을 축으로 하는 원통 위 한 점(행 진행률 t, 열 각도
// angle)을 계산한다. buildSleeveLayout의 초기 배치와 seamCircularRing
// 양쪽에서 반드시 같은 공식을 써야 한다 — 몸판 쪽에서 이미 "초기 배치와
// 핀이 서로 다른 부호/공식을 쓰면 거대한 초기 위반이 생겨 매 프레임 다시
// 풀어야 하고, 드물게 아예 못 풀고 뒤엉킨다" 문제를 실측으로 겪었다
// (buildGarmentSim.ts 참고) — 소매에서 그 실수를 반복하지 않기 위해 이
// 함수 하나로 통일한다.
function ringPoint(center: Vec3Like, right: Vec3Like, up: Vec3Like, radius: number, angle: number): Vec3Like {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + (right.x * cos + up.x * sin) * radius,
    y: center.y + (right.y * cos + up.y * sin) * radius,
    z: center.z + (right.z * cos + up.z * sin) * radius,
  };
}

export interface SleeveShape {
  shoulder: Vec3Like;
  // buildSleeveSim.ts의 centerAt() 참고 — shoulder(몸판 어깨 모서리와
  // 맞추기 위해 바깥으로 민 값)와 이 실제 어깨 관절 위치 사이를 t에 따라
  // 보간해 소매 중심축을 잡는다.
  trueShoulder: Vec3Like;
  dir: Vec3Like; // 단위 벡터(어깨→팔꿈치 방향)
  length: number;
  radiusSeam: number;
  radiusMax: number;
  radiusHem: number;
}

// 33번: 소매 중심축이 shoulder(SHOULDER_PIN_OUTSET만큼 밖으로 민 몸판용
// 좌표)에서 그대로 dir 방향으로 쭉 뻗으면, 실제 마네킹 팔 중심선보다
// 계속 바깥쪽에 떠 있게 된다 — 몸판 어깨 모서리는 원래 평평한 패널을
// 둥근 어깨 밖으로 밀어내려고 만든 보정인데, 원통 소매의 중심축까지 같이
// 밀려버린 것. 실측(마네킹을 숨겨 소매 지오메트리 자체는 멀쩡함을 확인한
// 뒤 다시 보이면 대부분이 마네킹 팔에 가려 어깨 옆 작은 조각만 남음)으로
// 확인했다. 이음매(t=0)는 몸판 가장자리와 맞아야 하니 shoulder를 그대로
// 쓰되, t가 커질수록(CENTER_CONVERGE_T 지점까지) 실제 어깨 관절
// (trueShoulder) 기준 축으로 수렴시켜, 소매 대부분이 진짜 팔 중심선 위에
// 자리잡게 한다.
// 38번: 처음엔 이 수렴 거리로 SEAM_T(0.12, 반지름 전환용)를 그대로
// 재사용했는데, 실측(정점 좌표 직접 대조)해보니 소매 1번 행(짧은 소매
// 기준 t≈0.11)에서 이미 블렌드가 93%까지 끝나 있어, 몸판 어깨 캡이
// "겨드랑이 근처까지 넓게 유지"하도록 설계된 구간(halfWidthAtRow의
// 제곱 이즈인, armholeStartRow까지)과 정면으로 어긋났다 — 몸판은 계속
// 넓게 남아있는데 소매는 몇 행 만에 이미 진짜 팔 쪽으로 확 좁혀 들어가,
// 그 사이에 삼각형 모양의 마네킹 피부 틈이 생겼다(이음매 자체는 안
// 어긋나 있어서 못 보고 지나칠 뻔함 — 0번 행만 보면 정상으로 보임).
// 반지름 전환(SEAM_T)과 중심축 수렴은 서로 다른 의미라 별도 상수로
// 분리하고, 몸판의 "넓게 유지" 구간과 보조를 맞추도록 훨씬 느리게 잡는다.
const CENTER_CONVERGE_T = 0.4;
function centerAt(shape: SleeveShape, t: number): Vec3Like {
  const axial = Math.min(t, 1);
  const outsetX = shape.shoulder.x + shape.dir.x * axial * shape.length;
  const outsetY = shape.shoulder.y + shape.dir.y * axial * shape.length;
  const outsetZ = shape.shoulder.z + shape.dir.z * axial * shape.length;
  const trueX = shape.trueShoulder.x + shape.dir.x * axial * shape.length;
  const trueY = shape.trueShoulder.y + shape.dir.y * axial * shape.length;
  const trueZ = shape.trueShoulder.z + shape.dir.z * axial * shape.length;
  const blend = Math.min(t / CENTER_CONVERGE_T, 1);
  return {
    x: outsetX + (trueX - outsetX) * blend,
    y: outsetY + (trueY - outsetY) * blend,
    z: outsetZ + (trueZ - outsetZ) * blend,
  };
}

// 몸판의 암홀(팔 구멍)은 원형이 아니라 어깨 핀 한 점에서 시작해 아래로
// 갈수록 넓어지는 각진 트임이다 — 그 좁은 시작점에 원통 소매의 "굵은"
// 링을 그대로 붙이면, 실 옷깃처럼 붙지 않고 어깨 위에 붕 뜬 넓은
// 깃/플레어처럼 보이는 문제가 실측(카메라를 돌려 확인)으로 확인됐다.
// 실제 옷은 이음매(시접) 자체는 가늘고, 이음매 바로 아래에서 팔 굵기까지
// 빠르게 벌어진다 — 그 모양을 흉내 내어 0번 행(이음매)은 아주 가는
// 반지름(radiusSeam)으로 시작해, SEAM_T 지점까지 빠르게 radiusMax(실제
// 팔 굵기)로 벌어지고, 그 뒤로는 밑단(radiusHem)까지 서서히 변한다.
const SEAM_T = 0.12;
// 손목 쪽 테이퍼가 SEAM_T 직후부터 t=1까지 쭉 이어지면 팔뚝 중간부터 이미
// 마네킹 실제 팔뚝 두께보다 얇아져 마네킹 팔 메시가 소매를 뚫고 앞에
// 그려지는 문제가 있었다 — 테이퍼 시작점을 훨씬 뒤로 미뤄, 진짜 손목에
// 가까운 마지막 구간에서만 좁아지게 한다.
const TAPER_START_T = 0.7;

function radiusAt(shape: SleeveShape, t: number): number {
  if (t <= SEAM_T) {
    const localT = t / SEAM_T;
    return shape.radiusSeam + (shape.radiusMax - shape.radiusSeam) * localT;
  }
  if (t <= TAPER_START_T) {
    return shape.radiusMax;
  }
  const localT = (t - TAPER_START_T) / (1 - TAPER_START_T);
  return shape.radiusMax + (shape.radiusHem - shape.radiusMax) * localT;
}

function distanceBetween(sim: ClothSimulation, a: number, b: number): number {
  const ax = sim.positions[a * 3];
  const ay = sim.positions[a * 3 + 1];
  const az = sim.positions[a * 3 + 2];
  const bx = sim.positions[b * 3];
  const by = sim.positions[b * 3 + 1];
  const bz = sim.positions[b * 3 + 2];
  return Math.hypot(bx - ax, by - ay, bz - az);
}

// buildConstraints()는 격자를 평면으로 가정해 마지막 열과 첫 열을 잇지
// 않는다 — 원통(소매)은 이 "이음매"를 명시적으로 이어붙여야 옆이 트인
// 종이 한 장이 아니라 실제 통 모양이 된다. sim.buildConstraints() 호출
// "이후"에 불러야 한다.
export function addSleeveWrapConstraints(sim: ClothSimulation, panelLeft: number, panelRight: number, rows: number): void {
  for (const p of [panelLeft, panelRight]) {
    for (let y = 0; y < rows; y++) {
      const a = sim.index(p, SLEEVE_COLS - 1, y);
      const b = sim.index(p, 0, y);
      sim.addConstraint(a, b, distanceBetween(sim, a, b)); // 구조(같은 행, 이음매)
      if (y < rows - 1) {
        const bNext = sim.index(p, 0, y + 1);
        const aNext = sim.index(p, SLEEVE_COLS - 1, y + 1);
        sim.addConstraint(a, bNext, distanceBetween(sim, a, bNext)); // 전단(대각, 이음매)
        sim.addConstraint(b, aNext, distanceBetween(sim, b, aNext));
      }
    }
  }
}

// 이음매 근처 행(rowT, 0=이음매 자체)의 "원형 기준" 목표 위치를 계산한다.
export function seamCircularRing(shape: SleeveShape, rowT = 0): Vec3Like[] {
  const { right, up } = perpendicularBasis(shape.dir);
  const radius = radiusAt(shape, rowT);
  const center = centerAt(shape, rowT);
  const ring: Vec3Like[] = [];
  for (let x = 0; x < SLEEVE_COLS; x++) {
    const angle = (x / SLEEVE_COLS) * Math.PI * 2;
    ring.push(ringPoint(center, right, up, radius, angle));
  }
  return ring;
}

// 30번(병합) 직후 소매 이음매 핀을 완전히 없애 봤더니(실제 재봉 제약만
// 남기고), 소매 전체가 이제 다른 어디에도 안 붙들린 자유낙하하는 몸통이 돼
// 자기 무게로 팔 방향으로 축 처지고, 그 처짐이 새로 건 재봉 제약을 타고
// 몸판 어깨~목선까지 함께 끌어내리는 회귀가 실측(사용자 스크린샷 — 쇄골이
// 훤히 드러나는 보트넥처럼 처짐)으로 확인됐다 — 사용자가 "여전히 어깨
// 쇄골이 드러나 있다"고 재지적한 원인이었다. 이음매 링을 예전처럼 이
// 함수로 매 프레임 실제 어깨 위치 기준 원형 위치에 다시 고정한다 — 몸판
// 어깨선(row 0)이 pinCorners로 고정되는 것과 똑같은 역할: 소매가 안정된
// "닻"을 가져야 처지지 않고, 그 닻에 재봉 제약(garmentStitch.ts의
// addArmholeSeamConstraints)이 몸판 경계를 진짜로 끌어당겨 준다 — 이
// 조합이 "소매도 안 처지고 + 몸판도 소매 쪽으로 진짜 물리적으로 당겨짐"
// 둘 다를 만족한다.
export function pinSleeveSeamRing(
  sim: ClothSimulation,
  panelLeft: number,
  panelRight: number,
  left: SleeveShape,
  right: SleeveShape,
): void {
  for (const [panel, shape] of [
    [panelLeft, left],
    [panelRight, right],
  ] as const) {
    const ring = seamCircularRing(shape, 0);
    for (let x = 0; x < SLEEVE_COLS; x++) {
      const pt = ring[x];
      sim.pin(sim.index(panel, x, 0), pt.x, pt.y, pt.z);
    }
  }
}

// 좌/우 소매를 기존 sim(몸판과 공유하는 병합 인스턴스, 30번)의 지정된
// 패널 위치에 배치한다. 격자 내부 제약은 호출부가 모든 패널을 다 배치한
// 뒤 한 번에 sim.buildConstraints()로 만든다 — buildGarmentSim.ts의
// layoutTorsoPanels와 같은 이유로 배치와 제약 생성을 분리했다. 이음매
// 링(0번 행) 고정은 여기서 하지 않는다 — pinSleeveSeamRing이 매 프레임
// (몸판 어깨선의 pinCorners와 같은 타이밍에) 다시 고정한다.
export function layoutSleevePanels(
  sim: ClothSimulation,
  panelLeft: number,
  panelRight: number,
  rows: number,
  left: SleeveShape,
  right: SleeveShape,
): void {
  const shapes: Array<[number, SleeveShape]> = [
    [panelLeft, left],
    [panelRight, right],
  ];
  for (const [panel, shape] of shapes) {
    const { right: rightVec, up } = perpendicularBasis(shape.dir);
    for (let y = 0; y < rows; y++) {
      const t = y / (rows - 1);
      const radiusAtY = radiusAt(shape, t);
      const center = centerAt(shape, t);
      for (let x = 0; x < SLEEVE_COLS; x++) {
        const angle = (x / SLEEVE_COLS) * Math.PI * 2;
        const pt = ringPoint(center, rightVec, up, radiusAtY, angle);
        sim.setParticle(sim.index(panel, x, y), pt.x, pt.y, pt.z);
      }
    }
  }
}
