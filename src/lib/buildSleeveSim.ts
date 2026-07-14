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
// angle)을 계산한다. buildSleeveSim의 초기 배치와 pinSleeveTop의 매 프레임
// 어깨 고정 양쪽에서 반드시 같은 공식을 써야 한다 — 몸판 쪽에서 이미
// "초기 배치와 핀이 서로 다른 부호/공식을 쓰면 거대한 초기 위반이 생겨
// 매 프레임 다시 풀어야 하고, 드물게 아예 못 풀고 뒤엉킨다" 문제를
// 실측으로 겪었다(buildGarmentSim.ts 참고) — 소매에서 그 실수를 반복하지
// 않기 위해 이 함수 하나로 통일한다.
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
// 시접 구간(0→SEAM_T)을 0.25→0.12로 줄여 "가는 원뿔" 구간을 짧게 하고
// 팔 굵기까지 더 빨리 벌어지게 했다 — 소매가 어깨에서 실 한 가닥처럼
// 가늘게 시작해 서서히 벌어지는 느낌 대신, 어깨 자체에서 바로 두툼하게
// 시작하는 느낌을 준다.
const SEAM_T = 0.12;
// 손목 쪽 테이퍼가 SEAM_T 직후(t=0.25)부터 t=1까지 쭉 이어지면, 긴팔
// 전체 길이의 3/4 구간에서 반지름이 계속 줄어드는 셈이라 팔뚝 중간
// 즈음부터 이미 마네킹 실제 팔뚝 두께보다 얇아져, 마네킹 팔 메시가
// 얇아진 소매 천을 뚫고 앞에 그려지는(오클루전) 문제가 실측(마네킹을
// 잠깐 숨기고 비교)으로 확인됐다 — 반지름/길이 계산 자체는 처음부터
// 맞았고 화면에서 "잘려 보인" 것뿐이었다. 테이퍼 시작점을 훨씬 뒤(팔뚝
// 대부분을 radiusMax로 넉넉히 유지)로 미뤄, 진짜 손목에 가까운 마지막
// 구간에서만 좁아지게 한다.
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
// 종이 한 장이 아니라 실제 통 모양이 된다.
function addWrapConstraints(sim: ClothSimulation, rows: number): void {
  for (let p = 0; p < 2; p++) {
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

// 이음매 근처 행(rowT, 0=이음매 자체)의 "원형 기준" 목표 위치를
// 계산한다(아직 핀은 안 건다). 큰 재설계: garmentStitch.ts의
// blendSeamRing이 이 원형 위치를 받아 몸판의 실제 진동둘레 가장자리(및
// 마네킹 어깨 곡면) 쪽으로 블렌딩한 최종 위치를 돌려주고, pinSleeveRing이
// 그 결과를 실제로 고정한다. 몸판 데이터가 없을 때(예: 몸판 없이 소매만
// 테스트)는 이 원형 위치를 그대로 pinSleeveRing에 넘기면 된다.
//
// rowT: 0번 행(이음매 자체, radiusSeam)뿐 아니라 그 바로 다음 행(예:
// 1/(rows-1), 이미 radiusMax까지 벌어진 지점)도 같은 방식으로 계산해
// 고정할 수 있게 일반화했다 — 실측(탑다운 각도)해보니 0번 행만 몸판
// 경계/마네킹 표면에 붙여도, 반지름이 SEAM_T 구간에서 급격히
// radiusSeam(2cm)→radiusMax(6.5cm)로 벌어지는 바로 다음 행들은 여전히
// 순수 물리 시뮬레이션(초기 원형 배치의 rest length)에만 의존해 실제
// 어깨 곡면을 따라가지 못하고, 그 사이(0번 행과 그다음 행 사이)에 마네킹
// 피부가 비쳐 보이는 틈이 남았다 — 1번 행까지 같은 방식으로 실제 표면에
// 붙이면 그 틈이 훨씬 좁아진다(자세한 경위는 garmentStitch.ts 참고).
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

// ring(길이 SLEEVE_COLS, seamCircularRing 또는 blendSeamRing의 결과)을
// 패널 panel의 row번 행에 그대로 고정한다.
export function pinSleeveRing(sim: ClothSimulation, panel: number, ring: Vec3Like[], row = 0): void {
  for (let x = 0; x < SLEEVE_COLS; x++) {
    const pt = ring[x];
    sim.pin(sim.index(panel, x, row), pt.x, pt.y, pt.z);
  }
}

// (0번 행에 인접한 1번 행까지 붙여 탑다운 각도의 잔여 틈을 더 줄여보려고
// pinSleeveRing 완전 고정과, "매 프레임 목표 쪽으로 일부만 당기는" 부드러운
// 버전을 둘 다 시도했지만 — 완전 고정은 인접 두 행 과잉구속으로 옷감이
// 뒤틀리는 회귀가, 부드러운 버전은 뚜렷한 개선이 없는 것으로 실측 확인돼
// 둘 다 폐기했다. 자세한 경위는 garmentWorker.ts의 "step" 핸들러 주석
// 참고 — 남은 잔여 틈은 알려진 한계로 남겨둔다.)

// 어깨선(0번 행) 링 전체를 원형 공식 그대로 고정한다(몸판 블렌딩 없는
// 기본 버전) — buildSleeveSim의 초기 빌드, 그리고 몸판 데이터를 아직
// 못 구했을 때의 안전한 폴백으로 쓴다.
export function pinSleeveTop(sim: ClothSimulation, left: SleeveShape, right: SleeveShape): void {
  pinSleeveRing(sim, 0, seamCircularRing(left));
  pinSleeveRing(sim, 1, seamCircularRing(right));
}

// 좌/우 소매를 하나의 ClothSimulation(패널 2개)으로 만든다. 몸판과는
// 그리드 크기가 달라(COLS x ROWS vs SLEEVE_COLS x rows) 하나의
// ClothSimulation으로 합칠 수 없어 별도 인스턴스로 남겨두지만, 진짜
// 스티칭(garmentStitch.ts)을 위해 몸판과 같은 워커(garmentWorker.ts)
// 안에서 함께 관리된다. 초기 빌드 시점에는 스티치 짝을 아직 몰라서
// 이음매 전체를 원형 공식으로 고정해둔다 — 워커가 이 직후에 몸판과
// 대조해 스티치 짝을 계산하고, 그 정점들만 다시 풀어준다(pinned=0으로
// 되돌림).
export function buildSleeveSim(rows: number, left: SleeveShape, right: SleeveShape): ClothSimulation {
  const sim = new ClothSimulation(SLEEVE_COLS, rows, 2);
  const shapes = [left, right];
  for (let p = 0; p < 2; p++) {
    const shape = shapes[p];
    const { right: rightVec, up } = perpendicularBasis(shape.dir);
    for (let y = 0; y < rows; y++) {
      const t = y / (rows - 1);
      const radiusAtY = radiusAt(shape, t);
      for (let x = 0; x < SLEEVE_COLS; x++) {
        const angle = (x / SLEEVE_COLS) * Math.PI * 2;
        const pt = ringPoint(shape.shoulder, shape.dir, rightVec, up, radiusAtY, t, shape.length, angle);
        sim.setParticle(sim.index(p, x, y), pt.x, pt.y, pt.z);
      }
    }
  }
  sim.buildConstraints();
  addWrapConstraints(sim, rows);
  pinSleeveTop(sim, left, right);
  return sim;
}
