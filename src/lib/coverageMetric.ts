// 커버리지 지표 — "천이 몸을 덮고 있는가"를 직접 잰다 (M2 게이트).
//
// 배경: A-③/C/B-1 화면 실패(어깨/등 노출, 잔물결)가 거리 기반 지표
// (bodyGap 채널 포함) 전부를 통과했다 — 거리 지표는 커버리지 손실을
// 원리적으로 못 잰다(덮이지 않은 자리엔 잴 천 정점이 없고, 천이
// 미끄러져 다른 데 밀착하면 오히려 "개선"으로 보임). 그래서 방향을
// 뒤집는다: 천이 아니라 **몸 표면**을 샘플링해, 각 샘플점에서 바깥
// 법선 방향으로 짧은 레이를 쏴 천 삼각형과 교차하는지 판정한다.
// 교차 없음 = 그 몸 지점이 노출됨. 정점 근방 판정이 아니라 레이-삼각형
// 교차인 이유: 격자 간격이 ~2cm라 정점 기준이면 반경 설정에 따라
// 결과가 흔들린다 — 삼각형은 면을 연속으로 덮으므로 흔들리지 않는다.
//
// 노출 비율과 함께 "어디가" 노출됐는지(높이 3대역 × 앞/뒤 × 좌/우
// 버킷, 노출 좌표 예시)를 같이 낸다 — max()류 단일 값이 엉뚱한 지배점에
// 고정되는 패턴(이 프로젝트 4회)을 위치 정보로 즉시 검출하기 위해서다.
import type { GridView } from "./drapeMetrics";
import type { Vec3Like } from "./clothProtocol";

export interface CoverageBucket {
  samples: number;
  exposed: number;
}

export interface CoverageResult {
  samples: number;
  exposed: number;
  exposedRatio: number;
  // 키: "top|mid|bot-front|back-left|right"
  buckets: Record<string, CoverageBucket>;
  exposedExamples: { x: number; y: number; z: number }[];
}

// 몸 메시(fixture의 position+index)에서 Y 대역 안 정점들을 샘플로 뽑고,
// 삼각형 와인딩에서 누적한 정점 법선(마네킹 메시는 법선이 몸 바깥을
// 향하도록 감겨 있음 — bvhFromArrays.ts가 같은 전제로 밀어냄)을 레이
// 방향으로 쓴다.
interface BodySamples {
  points: Float32Array; // xyz
  normals: Float32Array; // xyz(정규화)
  count: number;
}

function collectBandSamples(
  position: Float32Array,
  indexes: readonly (ArrayLike<number> | null)[],
  yMin: number,
  yMax: number,
  excludeCenter: Vec3Like,
  excludeRadius: number,
): BodySamples {
  const n = position.length / 3;
  const normalAcc = new Float32Array(n * 3);
  const used = new Uint8Array(n);
  for (const index of indexes) {
    if (!index) continue;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t];
      const b = index[t + 1];
      const c = index[t + 2];
      used[a] = used[b] = used[c] = 1;
      const ax = position[a * 3];
      const ay = position[a * 3 + 1];
      const az = position[a * 3 + 2];
      const ex1 = position[b * 3] - ax;
      const ey1 = position[b * 3 + 1] - ay;
      const ez1 = position[b * 3 + 2] - az;
      const ex2 = position[c * 3] - ax;
      const ey2 = position[c * 3 + 1] - ay;
      const ez2 = position[c * 3 + 2] - az;
      const nx = ey1 * ez2 - ez1 * ey2;
      const ny = ez1 * ex2 - ex1 * ez2;
      const nz = ex1 * ey2 - ey1 * ex2;
      for (const vi of [a, b, c]) {
        normalAcc[vi * 3] += nx;
        normalAcc[vi * 3 + 1] += ny;
        normalAcc[vi * 3 + 2] += nz;
      }
    }
  }
  const pts: number[] = [];
  const nrms: number[] = [];
  const exclR2 = excludeRadius * excludeRadius;
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const y = position[i * 3 + 1];
    if (y < yMin || y > yMax) continue;
    const x = position[i * 3];
    const z = position[i * 3 + 2];
    // 목 구멍(넥라인)은 원래 노출이 정상 — 목 축 주변 수평 반경 안은 제외.
    const dx = x - excludeCenter.x;
    const dz = z - excludeCenter.z;
    if (dx * dx + dz * dz < exclR2) continue;
    const nx = normalAcc[i * 3];
    const ny = normalAcc[i * 3 + 1];
    const nz = normalAcc[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    pts.push(x, y, z);
    nrms.push(nx / len, ny / len, nz / len);
  }
  return { points: Float32Array.from(pts), normals: Float32Array.from(nrms), count: pts.length / 3 };
}

// 천 삼각형(그리드 셀당 2개)을 패널들에서 평탄 배열로 뽑는다.
// colMin/colMax: 렌더와 같은 열 범위만 — 몸통 범위 밖 구 플랩 열은 화면에
// 안 그리는데 지표에서 "덮개"로 세면(초기 버전 실수) 보이지 않는 천이
// 커버리지를 과대평가한다. 렌더가 그리는 삼각형 = 지표가 세는 삼각형.
export interface ClothPanelRange {
  panel: number;
  colMin?: number;
  colMax?: number;
  wrapCols?: boolean; // 소매 튜브(col 마지막↔0 닫힘)
}

function clothTriangles(sim: GridView, panels: readonly ClothPanelRange[]): Float32Array {
  const out: number[] = [];
  const p = sim.positions;
  const push = (i: number) => {
    out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  };
  for (const { panel, colMin, colMax, wrapCols } of panels) {
    const { cols, rows } = sim.panelDims[panel];
    const x0 = Math.max(0, colMin ?? 0);
    const x1 = Math.min(cols - 1, colMax ?? cols - 1);
    for (let y = 0; y < rows - 1; y++) {
      for (let x = x0; x < (wrapCols ? x1 + 1 : x1); x++) {
        const x2 = (x + 1) % cols;
        const a = sim.index(panel, x, y);
        const b = sim.index(panel, x2, y);
        const c = sim.index(panel, x, y + 1);
        const d = sim.index(panel, x2, y + 1);
        push(a); push(b); push(c);
        push(b); push(d); push(c);
      }
    }
  }
  return Float32Array.from(out);
}

// Möller–Trumbore. 양면 판정(천은 안팎 어느 쪽이든 덮은 것) — t가
// [tMin, tMax] 안이면 교차.
function rayHitsAnyTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tris: Float32Array,
  tMin: number,
  tMax: number,
): boolean {
  const EPS = 1e-9;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const e1x = tris[t + 3] - ax, e1y = tris[t + 4] - ay, e1z = tris[t + 5] - az;
    const e2x = tris[t + 6] - ax, e2y = tris[t + 7] - ay, e2z = tris[t + 8] - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) continue;
    const invDet = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) continue;
    const hitT = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (hitT >= tMin && hitT <= tMax) return true;
  }
  return false;
}

// 첫 실측(A-② fixture)에서 mid-back 버킷이 93~96% "노출"로 나왔다 — 화면상
// 멀쩡히 덮인 상태라 지표 버그: 몸 메시 일부 영역의 삼각형 와인딩이
// 뒤집혀 있어 누적 정점 법선이 몸 안쪽을 향하고, 레이가 몸속으로 들어가
// 천을 못 만난 것. 와인딩을 신뢰하지 않고, 몸통 축 기준 방사 방향
// (+위쪽 성분 약간 — 어깨 꼭대기는 방사 성분이 0에 가까워서)과 내적이
// 음수면 법선을 뒤집어 항상 바깥을 향하게 교정한다.
function orientOutward(nx: number, ny: number, nz: number, px: number, pz: number, centerX: number, centerZ: number): [number, number, number] {
  const rx = px - centerX;
  const rz = pz - centerZ;
  const rLen = Math.hypot(rx, rz) || 1e-9;
  // 방사 + 위쪽 25% — 어깨 캡 정점(방사≈0, 법선≈+y)도 안정적으로 판정.
  const refX = rx / rLen;
  const refY = 0.25;
  const refZ = rz / rLen;
  const dot = nx * refX + ny * refY + nz * refZ;
  return dot < 0 ? [-nx, -ny, -nz] : [nx, ny, nz];
}

export interface CoverageParams {
  // 몸 샘플 대역(월드 Y) — 어깨~겨드랑이(실패 셋의 노출 부위).
  yMin: number;
  yMax: number;
  // 목 구멍 제외(수평 반경) — 넥라인은 원래 노출이 정상.
  neckCenter: Vec3Like;
  neckRadius: number;
  // 앞/뒤·좌/우 버킷 기준.
  centerX: number;
  centerZ: number;
  // 레이 범위: 표면 자기 자신(두께 0의 몸 메시)을 안 맞히도록 5mm부터,
  // 헐렁한 옷(품65도 밑단 이탈 ~18cm)까지 넉넉히.
  rayMin?: number;
  rayMax?: number;
}

export function computeBodyCoverage(
  bodyPosition: Float32Array,
  bodyIndexes: readonly (ArrayLike<number> | null)[],
  sim: GridView,
  clothPanels: readonly ClothPanelRange[],
  params: CoverageParams,
): CoverageResult {
  const rayMin = params.rayMin ?? 0.005;
  const rayMax = params.rayMax ?? 0.25;
  const body = collectBandSamples(bodyPosition, bodyIndexes, params.yMin, params.yMax, params.neckCenter, params.neckRadius);
  const tris = clothTriangles(sim, clothPanels);

  const buckets: Record<string, CoverageBucket> = {};
  const exposedExamples: { x: number; y: number; z: number }[] = [];
  let exposed = 0;
  const bandH = (params.yMax - params.yMin) / 3;
  for (let i = 0; i < body.count; i++) {
    const x = body.points[i * 3];
    const y = body.points[i * 3 + 1];
    const z = body.points[i * 3 + 2];
    const yBand = y > params.yMax - bandH ? "top" : y > params.yMax - 2 * bandH ? "mid" : "bot";
    const key = `${yBand}-${z >= params.centerZ ? "front" : "back"}-${x >= params.centerX ? "left" : "right"}`;
    const bucket = (buckets[key] ??= { samples: 0, exposed: 0 });
    bucket.samples++;
    const [nx, ny, nz] = orientOutward(
      body.normals[i * 3], body.normals[i * 3 + 1], body.normals[i * 3 + 2],
      x, z, params.centerX, params.centerZ,
    );
    const hit = rayHitsAnyTriangle(x, y, z, nx, ny, nz, tris, rayMin, rayMax);
    if (!hit) {
      exposed++;
      bucket.exposed++;
      // 전체 노출 좌표를 담는다(수백 개 수준) — 신구 대조 시 "새로 노출된
      // 지점"을 집합 차로 특정하는 데 필요. 출력부가 알아서 잘라 보여준다.
      exposedExamples.push({ x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), z: Number(z.toFixed(4)) });
    }
  }
  return {
    samples: body.count,
    exposed,
    exposedRatio: Number((exposed / (body.count || 1)).toFixed(4)),
    buckets,
    exposedExamples,
  };
}
