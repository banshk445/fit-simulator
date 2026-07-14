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
function ringPoint(
  shoulder: Vec3Like,
  dir: Vec3Like,
  right: Vec3Like,
  up: Vec3Like,
  radius: number,
  t: number,
  length: number,
  angle: number,
): Vec3Like {
  const cx = shoulder.x + dir.x * t * length;
  const cy = shoulder.y + dir.y * t * length;
  const cz = shoulder.z + dir.z * t * length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cx + (right.x * cos + up.x * sin) * radius,
    y: cy + (right.y * cos + up.y * sin) * radius,
    z: cz + (right.z * cos + up.z * sin) * radius,
  };
}

export interface SleeveShape {
  shoulder: Vec3Like;
  dir: Vec3Like; // 단위 벡터(어깨→팔꿈치 방향)
  length: number;
  radiusSeam: number;
  radiusMax: number;
  radiusHem: number;
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
// 30번(병합) 이후로는 이 원형 위치를 그대로 파티클에 심어두기만 하고(아래
// buildSleeveLayout), 실제로 몸판 암홀에 붙이는 일은 더 이상 매 프레임
// 위치를 억지로 갖다 놓는 방식(예전 blendSeamRing+pinSleeveRing 하드 핀)이
// 아니라, 몸판 진동둘레 경계와 소매 이음매 링 사이에 실제 재봉 제약
// (armholeSeam.ts)을 걸어 물리 스스로 붙어있게 한다 — rowT=0(이음매)
// 자체의 "출발" 위치를 정하는 용도로만 남는다.
export function seamCircularRing(shape: SleeveShape, rowT = 0): Vec3Like[] {
  const { right, up } = perpendicularBasis(shape.dir);
  const radius = radiusAt(shape, rowT);
  const ring: Vec3Like[] = [];
  for (let x = 0; x < SLEEVE_COLS; x++) {
    const angle = (x / SLEEVE_COLS) * Math.PI * 2;
    ring.push(ringPoint(shape.shoulder, shape.dir, right, up, radius, rowT, shape.length, angle));
  }
  return ring;
}

// 좌/우 소매를 기존 sim(몸판과 공유하는 병합 인스턴스, 30번)의 지정된
// 패널 위치에 배치한다. 격자 내부 제약은 호출부가 모든 패널을 다 배치한
// 뒤 한 번에 sim.buildConstraints()로 만든다 — buildGarmentSim.ts의
// layoutTorsoPanels와 같은 이유로 배치와 제약 생성을 분리했다. 이음매
// 링(0번 행)을 예전처럼 pin()으로 고정하지 않는다 — 몸판 암홀 경계와의
// 실제 재봉 제약(armholeSeam.ts)이 그 역할을 대신하므로, 여기서는 그저
// 물리적으로 그럴듯한 "시작 위치"만 심어둔다.
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
      for (let x = 0; x < SLEEVE_COLS; x++) {
        const angle = (x / SLEEVE_COLS) * Math.PI * 2;
        const pt = ringPoint(shape.shoulder, shape.dir, rightVec, up, radiusAtY, t, shape.length, angle);
        sim.setParticle(sim.index(panel, x, y), pt.x, pt.y, pt.z);
      }
    }
  }
}
