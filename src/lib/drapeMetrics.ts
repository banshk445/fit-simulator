// 드레이프 개선(A안) 공통 검증 지표 — 각 단계 전/후를 같은 4개 숫자로
// 대조하기 위한 순수 계산 모듈. paramSweep.ts(Node, 12콤보)가 쓴다.
// - faceAngle: 몸통 패널 인접 셀(quad) 법선 사이 각도(평균/최대, deg) —
//   각짐 지표. 값이 클수록 큰 평면 폴리곤이 꺾여 만나는 "갑옷" 실루엣.
// - wrinkleRms: 내부 파티클이 상하좌우 4이웃 평균에서 벗어난 거리의
//   RMS(mm) — 주름 에너지. 보정들이 주름을 죽이면 0에 가깝게 붙는다.
// - maxStrain: 전체 제약의 현재길이/원래길이 최댓값 — 찢어짐 감시
//   (clampOverstretchedConstraints의 1.2 상한과 같은 단위).
import type { ClothSimulation, PanelDims } from "./clothPhysics";
import type { Capsule } from "./torsoCapsule";

// 브라우저(Garment.tsx)는 ClothSimulation 인스턴스가 아니라 워커가 보내온
// 위치 배열(front/backPositions)만 갖는다 — 같은 공식을 양쪽이 공유하려면
// (armholeRingJaggedness 패턴) 계산에 실제로 필요한 최소 표면만 받는다.
// ClothSimulation은 이 인터페이스를 구조적으로 만족한다.
export interface GridView {
  readonly panelDims: readonly PanelDims[];
  positions: Float32Array;
  index(panel: number, x: number, y: number): number;
}

export interface DrapeMetrics {
  faceAngleMeanDeg: number;
  faceAngleMaxDeg: number;
  wrinkleRmsMm: number;
  maxStrain: number;
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

function cellNormal(sim: GridView, panel: number, x: number, y: number, out: Vec): void {
  // 셀 (x,y)의 법선 = (오른쪽 변) × (아래 변). quad가 비평면이어도 대표
  // 법선으로 충분하다 — 인접 셀과의 "각도 차이"만 보므로.
  const p = sim.positions;
  const a = sim.index(panel, x, y) * 3;
  const r = sim.index(panel, x + 1, y) * 3;
  const d = sim.index(panel, x, y + 1) * 3;
  const rx = p[r] - p[a];
  const ry = p[r + 1] - p[a + 1];
  const rz = p[r + 2] - p[a + 2];
  const dx = p[d] - p[a];
  const dy = p[d + 1] - p[a + 1];
  const dz = p[d + 2] - p[a + 2];
  out.x = ry * dz - rz * dy;
  out.y = rz * dx - rx * dz;
  out.z = rx * dy - ry * dx;
  const len = Math.hypot(out.x, out.y, out.z) || 1e-9;
  out.x /= len;
  out.y /= len;
  out.z /= len;
}

function angleDeg(a: Vec, b: Vec): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

// restLength가 이보다 짧은 제약(동일점 스티치 — buildGarmentSim.ts의
// Math.hypot(...)≈0 시접)은 strain 비율(dist/rest)이 무의미하게 폭발하므로
// maxStrain 집계에서 뺀다.
const STRAIN_MIN_REST_M = 1e-4;

// panels: 지표를 계산할 패널 인덱스 목록(몸통 앞/뒤). colMin/colMax는 몸통
// 열 범위(torsoColumnRange) — 그 밖(구 플랩 연장부)은 퇴화 셀이 섞여 면각이
// 180°로 포화되므로 범위를 좁혀야 지표가 개선에 반응한다. maxStrain만은
// 패널/열 구분이 없는 제약 전체(시접 포함) 기준이다.
export function computeDrapeMetrics(
  sim: GridView & Pick<ClothSimulation, "constraintPairs">, // maxStrain은 제약 정보가 필요 — Node(실제 sim) 전용
  panels: readonly number[],
  colMin = 0,
  colMax = Infinity,
): DrapeMetrics {
  const nA: Vec = { x: 0, y: 0, z: 0 };
  const nB: Vec = { x: 0, y: 0, z: 0 };
  let angleSum = 0;
  let angleCount = 0;
  let angleMax = 0;
  let devSqSum = 0;
  let devCount = 0;
  const p = sim.positions;

  for (const panel of panels) {
    const { cols, rows } = sim.panelDims[panel];
    const x0 = Math.max(0, colMin);
    const x1 = Math.min(cols - 1, colMax);
    // 인접 셀 법선 각도 — 가로 이웃(x,x+1)과 세로 이웃(y,y+1) 모두.
    // 셀 (x,y)는 정점 x..x+1을 쓰므로 셀 범위는 x0..x1-1.
    for (let y = 0; y < rows - 1; y++) {
      for (let x = x0; x < x1; x++) {
        cellNormal(sim, panel, x, y, nA);
        if (x < x1 - 1) {
          cellNormal(sim, panel, x + 1, y, nB);
          const deg = angleDeg(nA, nB);
          angleSum += deg;
          angleCount++;
          if (deg > angleMax) angleMax = deg;
        }
        if (y < rows - 2) {
          cellNormal(sim, panel, x, y + 1, nB);
          const deg = angleDeg(nA, nB);
          angleSum += deg;
          angleCount++;
          if (deg > angleMax) angleMax = deg;
        }
      }
    }
    // 주름 RMS — 내부 파티클의 4이웃 평균 대비 편차.
    for (let y = 1; y < rows - 1; y++) {
      for (let x = Math.max(1, x0 + 1); x <= Math.min(cols - 2, x1 - 1); x++) {
        const i = sim.index(panel, x, y) * 3;
        const l = sim.index(panel, x - 1, y) * 3;
        const r = sim.index(panel, x + 1, y) * 3;
        const u = sim.index(panel, x, y - 1) * 3;
        const d = sim.index(panel, x, y + 1) * 3;
        const ax = (p[l] + p[r] + p[u] + p[d]) / 4 - p[i];
        const ay = (p[l + 1] + p[r + 1] + p[u + 1] + p[d + 1]) / 4 - p[i + 1];
        const az = (p[l + 2] + p[r + 2] + p[u + 2] + p[d + 2]) / 4 - p[i + 2];
        devSqSum += ax * ax + ay * ay + az * az;
        devCount++;
      }
    }
  }

  let maxStrain = 0;
  for (const c of sim.constraintPairs) {
    if (c.restLength < STRAIN_MIN_REST_M) continue;
    const ai = c.a * 3;
    const bi = c.b * 3;
    const dist = Math.hypot(p[bi] - p[ai], p[bi + 1] - p[ai + 1], p[bi + 2] - p[ai + 2]);
    const strain = dist / c.restLength;
    if (strain > maxStrain) maxStrain = strain;
  }

  return {
    faceAngleMeanDeg: Number((angleSum / (angleCount || 1)).toFixed(3)),
    faceAngleMaxDeg: Number(angleMax.toFixed(2)),
    wrinkleRmsMm: Number((Math.sqrt(devSqSum / (devCount || 1)) * 1000).toFixed(3)),
    maxStrain: Number(maxStrain.toFixed(4)),
  };
}

// 천-몸 이탈 거리(mm) — A-③ 사후 추가, C 사후 채널 분리로 재설계.
//
// 1차 버전(전역 max 하나)의 실패: C단계가 12/12 "개선"으로 나왔는데
// 화면은 A-③과 동일한 참사(어깨/등 상단 노출)였다. max가 암홀 가장자리
// 열의 기하 아티팩트(어깨 반폭 ~29.5cm vs 캡슐 반지름 ~15.9cm → 어느
// 상태든 ~130mm)에 인질로 잡혀, 어깨 들뜸(수 cm)이 그 밑에 묻혔다 —
// 암홀 톱니 max()가 패널 경계에 인질로 잡혔던 것과 같은 계열.
//
// 2차 버전: 행 대역별 채널(어깨/몸통/밑단)로 분리하고, 채널마다 max와
// mean을 같이 낸다 — 위 가장자리 아티팩트는 행 분리만으론 어깨 채널에
// 그대로 남으므로(가장자리 열도 row0~5에 있다), 실패 검출은 상태 무관
// 상수인 아티팩트가 평균에 희석되는 mean 쪽이 담당할 수 있다. 어느
// 통계가 실제 실패(A-③·C)를 잡는지는 세 상태 재측정으로 검증한다.
// 절대값엔 캡슐 근사 오차+COLLISION_MARGIN 포함 — 상대 비교 전용.
export interface GapBand {
  rowStart: number;
  rowEndInclusive: number;
}

export interface GapStats {
  maxMm: number;
  meanMm: number;
  // max를 만든 정점 — max가 무관한 지배점에 인질로 잡히는 패턴(이 프로젝트
  // 네 번째)을 진단하기 위해 항상 같이 낸다. panel 0=앞판, 1=뒤판.
  maxAt: { panel: number; x: number; y: number };
}

// (개명: bodyGap → capsuleGap — 이 채널은 **토르소 캡슐 근사** 기준이다.
// "상대 비교 전용" 주석만으론 절대 목표 오용을 못 막았다(margin 스윕에서
// 어깨 mean을 '0 근처' 목표로 오용, 지표 함정 6번). 이름에 캡슐임을 박아
// 구조적으로 차단한다. 메시 기준 안착은 computeShoulderSeatMm가 담당.)
// 대역 정의의 단일 출처 — paramSweep(Node)과 Garment.tsx(브라우저)가 각자
// 배열을 들고 있으면 stale 함정 재발 경로라 여기로 모은다. 순서 고정:
// [shoulder(row0~asr), shoulderFree(row1~asr, row0 핀 제외), torso, hem].
// shoulderFree: 브라우저 실측에서 shoulder max(58.2mm)가 물리 변경(C)에
// 소수점까지 불변 — row0은 pinCorners가 매 프레임 고정하는 행이라 물리에
// 반응하지 않는 고정점이 max를 지배할 수 있다는 가설의 검증용 채널.
export function capsuleGapBands(armholeStartRow: number, rows: number): GapBand[] {
  return [
    { rowStart: 0, rowEndInclusive: armholeStartRow },
    { rowStart: 1, rowEndInclusive: armholeStartRow },
    { rowStart: armholeStartRow + 1, rowEndInclusive: 20 },
    { rowStart: 21, rowEndInclusive: rows - 1 },
  ];
}

// 잔물결(리플) 지표 — B-1(스무딩 완화) 실패("인접 열 잔물결 재현", 과거
// 실측 인접 열 Y차 최대 2cm)를 정량화. 커버리지 지표는 이 실패를 원리적으로
// 못 잡는다(잔물결은 노출이 아님 — 실측: B-1에서 커버리지는 오히려 개선).
// 인접 열 1차 차분은 어깨 경사(정상 기울기)가 섞이므로, 행 방향 2차 차분
// |p(x-1)+p(x+1)-2p(x)| (지그재그만 반응)의 max/mean을 낸다.
export interface RippleStats {
  maxMm: number;
  meanMm: number;
  maxAt: { panel: number; x: number; y: number };
  // columnRipple — **열(x) 방향 공간 4차 중앙차분**
  // |p(x-2)-4p(x-1)+6p(x)-4p(x+1)+p(x+2)|을 호출 시점의 위치 1장에서 낸다
  // (호출부 paramSweep은 프레임 루프가 끝난 뒤 = 최종 프레임 1장).
  // 2차 차분은 임의의 2차식(=상수 곡률 = 정상 폴드)에 비례해 반응해서
  // 곡률 측정기였고(스무딩 off 5셀에서 면각평균과 완전 단조, 비율 ±8%
  // 고정), 4차 차분은 3차 이하를 정확히 소멸시켜 열 방향 교대 성분만
  // 남긴다.
  //
  // **개명 이력(2026-07-30): jitter → columnRipple.** 옛 이름은 시간
  // 떨림을 주장했으나 이 식에는 시간 축도 dt도 없다 — 축(열)과 시점
  // (호출 시점 1장)을 이름에 박아 오독을 구조적으로 막는다(README 함정 13).
  // 정규화가 없어 절대값은 변위가 아니다: 공간 파수 k 이득 (4sin²(k/2))²
  // = 순수 교대(파장 2열) 16 / 파장 4열 4 / 파장 6열 1.0. 파장 대역을
  // 구분하지 못하므로 **채택 시점에 식을 재도출**하고 쓸 것.
  columnRippleMaxMm: number;
  columnRippleMeanMm: number;
  columnRippleMaxAt: { panel: number; x: number; y: number };
  // 부호 반전 비율 — D²(x)와 D²(x+1)의 부호가 다른 열의 비율. 교대
  // 패턴이면 1에 가깝고 매끄러운 폴드면 0에 가깝다(스케일 무관 보조 지표).
  signFlipRatio: number;
}

export function computeRippleMm(
  sim: GridView,
  panels: readonly number[],
  rowStart: number,
  rowEndInclusive: number,
  colMin = 0,
  colMax = Infinity,
): RippleStats {
  const p = sim.positions;
  let maxV = 0;
  let sum = 0;
  let count = 0;
  let maxAt = { panel: -1, x: -1, y: -1 };
  let jMax = 0;
  let jSum = 0;
  let jCount = 0;
  let jMaxAt = { panel: -1, x: -1, y: -1 };
  let flips = 0;
  let flipCount = 0;
  // 축별 2차 차분(부호 유지) — 4차 차분과 부호반전 계산에 재사용.
  const d2 = (panel: number, x: number, y: number, k: number): number => {
    const i = sim.index(panel, x, y) * 3 + k;
    const l = sim.index(panel, x - 1, y) * 3 + k;
    const r = sim.index(panel, x + 1, y) * 3 + k;
    return p[l] + p[r] - 2 * p[i];
  };
  for (const panel of panels) {
    const { cols, rows } = sim.panelDims[panel];
    const x0 = Math.max(1, colMin + 1);
    const x1 = Math.min(cols - 2, colMax - 1);
    const yEnd = Math.min(rows - 1, rowEndInclusive);
    for (let y = Math.max(0, rowStart); y <= yEnd; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = d2(panel, x, y, 0);
        const dy = d2(panel, x, y, 1);
        const dz = d2(panel, x, y, 2);
        const v = Math.hypot(dx, dy, dz);
        sum += v;
        count++;
        if (v > maxV) {
          maxV = v;
          maxAt = { panel, x, y };
        }
        // 부호 반전 — Y축(처짐 방향) 2차 차분 부호로 판정.
        if (x + 1 <= x1) {
          const next = d2(panel, x + 1, y, 1);
          if (dy * next < 0) flips++;
          flipCount++;
        }
        // 4차 차분 = 2차 차분의 2차 차분(같은 창 안쪽 한 칸씩 좁힘).
        if (x - 1 >= x0 && x + 1 <= x1) {
          let jx = 0;
          let jy = 0;
          let jz = 0;
          jx = d2(panel, x - 1, y, 0) + d2(panel, x + 1, y, 0) - 2 * dx;
          jy = d2(panel, x - 1, y, 1) + d2(panel, x + 1, y, 1) - 2 * dy;
          jz = d2(panel, x - 1, y, 2) + d2(panel, x + 1, y, 2) - 2 * dz;
          const jv = Math.hypot(jx, jy, jz);
          jSum += jv;
          jCount++;
          if (jv > jMax) {
            jMax = jv;
            jMaxAt = { panel, x, y };
          }
        }
      }
    }
  }
  return {
    maxMm: Number((maxV * 1000).toFixed(2)),
    meanMm: Number(((sum / (count || 1)) * 1000).toFixed(2)),
    maxAt,
    columnRippleMaxMm: Number((jMax * 1000).toFixed(2)),
    columnRippleMeanMm: Number(((jSum / (jCount || 1)) * 1000).toFixed(2)),
    columnRippleMaxAt: jMaxAt,
    signFlipRatio: Number((flips / (flipCount || 1)).toFixed(3)),
  };
}

// columnRipple 정점별 분해 — computeRippleMm이 내는 columnRippleMeanMm의 피가산항을
// 그대로 정점 단위로 내보낸다(집계 전 값). 창·인덱스 범위는 위 함수와
// 동일해야 하므로 kernel을 같은 식으로 유지할 것. 호출부에서 평균이
// columnRippleMeanMm과 일치하는지 자체 검사한다(계기 동일성 증명).
export function columnRipplePerVertex(
  sim: GridView,
  panels: readonly number[],
  rowStart: number,
  rowEndInclusive: number,
  colMin = 0,
  colMax = Infinity,
): { panel: number; x: number; y: number; mm: number }[] {
  const p = sim.positions;
  const out: { panel: number; x: number; y: number; mm: number }[] = [];
  const d2 = (panel: number, x: number, y: number, k: number): number => {
    const i = sim.index(panel, x, y) * 3 + k;
    const l = sim.index(panel, x - 1, y) * 3 + k;
    const r = sim.index(panel, x + 1, y) * 3 + k;
    return p[l] + p[r] - 2 * p[i];
  };
  for (const panel of panels) {
    const { cols, rows } = sim.panelDims[panel];
    const x0 = Math.max(1, colMin + 1);
    const x1 = Math.min(cols - 2, colMax - 1);
    const yEnd = Math.min(rows - 1, rowEndInclusive);
    for (let y = Math.max(0, rowStart); y <= yEnd; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x - 1 < x0 || x + 1 > x1) continue;
        const jx = d2(panel, x - 1, y, 0) + d2(panel, x + 1, y, 0) - 2 * d2(panel, x, y, 0);
        const jy = d2(panel, x - 1, y, 1) + d2(panel, x + 1, y, 1) - 2 * d2(panel, x, y, 1);
        const jz = d2(panel, x - 1, y, 2) + d2(panel, x + 1, y, 2) - 2 * d2(panel, x, y, 2);
        out.push({ panel, x, y, mm: Math.hypot(jx, jy, jz) * 1000 });
      }
    }
  }
  return out;
}

export function computeCapsuleGapChannels(
  sim: GridView,
  panels: readonly number[],
  capsules: readonly Capsule[],
  bands: readonly GapBand[],
  colMin = 0,
  colMax = Infinity,
): GapStats[] {
  const p = sim.positions;
  const surfaceDist = (px: number, py: number, pz: number): number => {
    let best = Infinity;
    for (const c of capsules) {
      const abx = c.bottom.x - c.top.x;
      const aby = c.bottom.y - c.top.y;
      const abz = c.bottom.z - c.top.z;
      const abLenSq = abx * abx + aby * aby + abz * abz;
      const apx = px - c.top.x;
      const apy = py - c.top.y;
      const apz = pz - c.top.z;
      const t = abLenSq > 1e-9 ? Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / abLenSq)) : 0;
      const dist = Math.hypot(px - (c.top.x + abx * t), py - (c.top.y + aby * t), pz - (c.top.z + abz * t)) - c.radius;
      if (dist < best) best = dist;
    }
    return best;
  };

  return bands.map(({ rowStart, rowEndInclusive }) => {
    let maxGap = -Infinity;
    let maxAt = { panel: -1, x: -1, y: -1 };
    let sum = 0;
    let count = 0;
    for (const panel of panels) {
      const { cols, rows } = sim.panelDims[panel];
      const x0 = Math.max(0, colMin);
      const x1 = Math.min(cols - 1, colMax);
      const yEnd = Math.min(rows - 1, rowEndInclusive);
      for (let y = Math.max(0, rowStart); y <= yEnd; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = sim.index(panel, x, y) * 3;
          const d = surfaceDist(p[i], p[i + 1], p[i + 2]);
          if (d > maxGap) {
            maxGap = d;
            maxAt = { panel, x, y };
          }
          sum += d;
          count++;
        }
      }
    }
    return {
      maxMm: Number((maxGap * 1000).toFixed(1)),
      meanMm: Number(((sum / (count || 1)) * 1000).toFixed(1)),
      maxAt,
    };
  });
}

// ④(order/symmetry 제거) 전용 게이트 — 일반 지표가 아니라 **도입 사유였던
// 실패 자체**를 잰다. preserveColumnOrder는 "어깨 테이퍼 구간에서 같은 행의
// 인접 두 열이 서로를 추월해 자리를 바꿔(순서 역전) 찢어진 것처럼 보인다"는
// 실측 때문에 들어왔다(clothPhysics.ts preserveColumnOrder 주석). 그
// minGap(6mm) 미달은 위반이 아니다 — 실제 역전(투영이 음수)만 실패다.
//
// bowtie: 격자 쿼드의 두 삼각형 법선이 반대를 향하면 그 쿼드는 접혀
// 겹친 것 = 화면에서 찢어짐/나비넥타이로 보이는 바로 그 형태다. 어느
// 보정이 원인이든 결과를 직접 잡으므로 order/symmetry 공통 게이트로 쓴다.
export interface OrderViolationStats {
  colInvShoulder: number;
  colInvAll: number;
  colInvMaxMm: number;
  colInvMaxAt: { panel: number; x: number; y: number };
  rowInvAll: number;
  rowInvMaxMm: number;
  bowtieShoulder: number;
  bowtieAll: number;
  bowtieMaxAt: { panel: number; x: number; y: number };
}

export function computeOrderViolations(
  sim: GridView,
  panels: readonly number[],
  shoulderRowEnd: number,
  dir: { x: number; y: number; z: number },
  colMin = 0,
  colMax = Infinity,
): OrderViolationStats {
  const p = sim.positions;
  let colInvShoulder = 0, colInvAll = 0, colInvMaxMm = 0;
  let colInvMaxAt = { panel: -1, x: -1, y: -1 };
  let rowInvAll = 0, rowInvMaxMm = 0;
  let bowtieShoulder = 0, bowtieAll = 0;
  let bowtieMaxAt = { panel: -1, x: -1, y: -1 };
  let worstBowtie = 1;

  for (const panel of panels) {
    const { cols, rows } = sim.panelDims[panel];
    const x0 = Math.max(0, colMin);
    const x1 = Math.min(cols - 1, colMax);
    for (let y = 0; y < rows; y++) {
      for (let x = x0; x < x1; x++) {
        const a = sim.index(panel, x, y) * 3;
        const b = sim.index(panel, x + 1, y) * 3;
        // 열 역전 — 어깨 방향 투영이 음수면 두 열이 자리를 바꾼 것.
        const proj = (p[b] - p[a]) * dir.x + (p[b + 1] - p[a + 1]) * dir.y + (p[b + 2] - p[a + 2]) * dir.z;
        if (proj < 0) {
          colInvAll++;
          if (y <= shoulderRowEnd) colInvShoulder++;
          const mm = -proj * 1000;
          if (mm > colInvMaxMm) {
            colInvMaxMm = mm;
            colInvMaxAt = { panel, x, y };
          }
        }
        // 행 역전 — 아래 행이 위 행보다 위에 있으면 뒤집힌 것.
        if (y < rows - 1) {
          const c = sim.index(panel, x, y + 1) * 3;
          const down = p[a + 1] - p[c + 1]; // 위 행이 더 높아야 양수
          if (down < 0) {
            rowInvAll++;
            const mm = -down * 1000;
            if (mm > rowInvMaxMm) rowInvMaxMm = mm;
          }
          // bowtie — 쿼드의 두 삼각형 법선이 반대면 접혀 겹친 것.
          const d = sim.index(panel, x + 1, y + 1) * 3;
          const n = (i: number, j: number, k: number) => {
            const e1x = p[j] - p[i], e1y = p[j + 1] - p[i + 1], e1z = p[j + 2] - p[i + 2];
            const e2x = p[k] - p[i], e2y = p[k + 1] - p[i + 1], e2z = p[k + 2] - p[i + 2];
            return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
          };
          const [n1x, n1y, n1z] = n(a, b, c);
          const [n2x, n2y, n2z] = n(b, d, c);
          const l1 = Math.hypot(n1x, n1y, n1z) || 1e-12;
          const l2 = Math.hypot(n2x, n2y, n2z) || 1e-12;
          const cosA = (n1x * n2x + n1y * n2y + n1z * n2z) / (l1 * l2);
          if (cosA < 0) {
            bowtieAll++;
            if (y <= shoulderRowEnd) bowtieShoulder++;
            if (cosA < worstBowtie) {
              worstBowtie = cosA;
              bowtieMaxAt = { panel, x, y };
            }
          }
        }
      }
    }
  }
  return {
    colInvShoulder, colInvAll,
    colInvMaxMm: Number(colInvMaxMm.toFixed(2)),
    colInvMaxAt,
    rowInvAll,
    rowInvMaxMm: Number(rowInvMaxMm.toFixed(2)),
    bowtieShoulder, bowtieAll, bowtieMaxAt,
  };
}

// (폐기 기록) shoulderSeatMm — 어깨 대역 천 정점의 메시 무부호 거리로
// "어깨 안착"을 재려던 시도. 화면 정답지 검증(metrics-log 2026-07-28
// 22:20 블록)에서 즉시 기각: 흘러내린 상태(PIN 0.5, 화면상 견갑골
// 노출)가 mean 14.2로 정상(22.0)보다 **작게** 나왔다 — 흘러내린 천은
// 가슴/등 벽면에 붙어 거리가 오히려 줄고, 정상 안착은 목선 아치가
// 승모근 위 공중을 가로질러 거리가 크다. 즉 "몸 어딘가에 가깝다"와
// "어깨를 덮고 있다"는 다른 질문이다. 재구현하려면 천 쪽이 아니라
// **몸 쪽**(어깨 상면 샘플)에서 천까지의 레이 거리로 — coverage 지표
// 계열의 확장이 맞다.
