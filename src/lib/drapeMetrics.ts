// 드레이프 개선(A안) 공통 검증 지표 — 각 단계 전/후를 같은 4개 숫자로
// 대조하기 위한 순수 계산 모듈. paramSweep.ts(Node, 12콤보)가 쓴다.
// - faceAngle: 몸통 패널 인접 셀(quad) 법선 사이 각도(평균/최대, deg) —
//   각짐 지표. 값이 클수록 큰 평면 폴리곤이 꺾여 만나는 "갑옷" 실루엣.
// - wrinkleRms: 내부 파티클이 상하좌우 4이웃 평균에서 벗어난 거리의
//   RMS(mm) — 주름 에너지. 보정들이 주름을 죽이면 0에 가깝게 붙는다.
// - maxStrain: 전체 제약의 현재길이/원래길이 최댓값 — 찢어짐 감시
//   (clampOverstretchedConstraints의 1.2 상한과 같은 단위).
import type { ClothSimulation } from "./clothPhysics";
import type { Capsule } from "./torsoCapsule";

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

function cellNormal(sim: ClothSimulation, panel: number, x: number, y: number, out: Vec): void {
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
  sim: ClothSimulation,
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

// 천-몸 이탈 거리(mm) — A-③ 사후 추가. A-③(shear 0.6)이 기존 지표
// 전부(면각/주름/strain/관통/seamGap)를 통과하고도 화면에선 어깨 천이
// 몸에서 떨어져 등판이 노출되는 참사였다 — 관통(음의 방향)만 재고 그
// 반대(천이 몸에서 떠서 노출)를 재는 지표가 없었기 때문. 어깨~겨드랑이
// 구간(row < rowEndExclusive)의 몸통 열 파티클이 몸 프록시(토르소 캡슐)
// 표면에서 얼마나 떠 있는지의 최댓값을 잰다 — 겨드랑이 아래는 천이
// 원래 몸에서 떨어져 낙하하는 게 정상이라 포함하면 지표가 무의미해진다.
// 절대값엔 캡슐 근사 오차+COLLISION_MARGIN이 포함되므로 전/후 상대
// 비교용이다.
export function computeBodyGapMm(
  sim: ClothSimulation,
  panels: readonly number[],
  capsules: readonly Capsule[],
  rowEndExclusive: number,
  colMin = 0,
  colMax = Infinity,
): number {
  const p = sim.positions;
  let maxGap = -Infinity;
  for (const panel of panels) {
    const { cols } = sim.panelDims[panel];
    const x0 = Math.max(0, colMin);
    const x1 = Math.min(cols - 1, colMax);
    for (let y = 0; y < rowEndExclusive; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = sim.index(panel, x, y) * 3;
        const px = p[i];
        const py = p[i + 1];
        const pz = p[i + 2];
        // 가장 가까운 캡슐 표면까지의 부호 있는 거리(양수=표면 밖).
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
        if (best > maxGap) maxGap = best;
      }
    }
  }
  return Number((maxGap * 1000).toFixed(1));
}
