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

// 대역 정의의 단일 출처 — paramSweep(Node)과 Garment.tsx(브라우저)가 각자
// 배열을 들고 있으면 stale 함정 재발 경로라 여기로 모은다. 순서 고정:
// [shoulder(row0~asr), shoulderFree(row1~asr, row0 핀 제외), torso, hem].
// shoulderFree: 브라우저 실측에서 shoulder max(58.2mm)가 물리 변경(C)에
// 소수점까지 불변 — row0은 pinCorners가 매 프레임 고정하는 행이라 물리에
// 반응하지 않는 고정점이 max를 지배할 수 있다는 가설의 검증용 채널.
export function bodyGapBands(armholeStartRow: number, rows: number): GapBand[] {
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
  // 4차 중앙차분 |p(x-2)-4p(x-1)+6p(x)-4p(x+1)+p(x+2)| — 2차 차분은 임의의
  // 2차식(=상수 곡률 = 정상 폴드)에 비례해 반응해서 "떨림 측정기"가 아니라
  // 곡률 측정기였다(스무딩 off 5셀에서 면각평균과 완전 단조, 비율 ±8%
  // 고정 — 전략가 실측). 4차 차분은 2차식을 정확히 소멸시켜 열 방향 교대
  // 성분만 남기므로 정상 주름과 지그재그를 구분한다.
  jitterMaxMm: number;
  jitterMeanMm: number;
  jitterMaxAt: { panel: number; x: number; y: number };
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
    jitterMaxMm: Number((jMax * 1000).toFixed(2)),
    jitterMeanMm: Number(((jSum / (jCount || 1)) * 1000).toFixed(2)),
    jitterMaxAt: jMaxAt,
    signFlipRatio: Number((flips / (flipCount || 1)).toFixed(3)),
  };
}

export function computeBodyGapChannels(
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
