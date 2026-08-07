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
import { ARM_AXIS_RADIUS, nearestOnSegments, type Segment } from "./bodySkeleton";

export interface CoverageBucket {
  samples: number;
  exposed: number;
  // hover — 히트된(덮인) 샘플의 레이 히트 거리(몸 표면→천). "덮였는가"
  // (coverage)와 별개로 "얼마나 뜬 채 덮였는가"를 잰다. 미스 샘플은
  // hover 집계에서 제외(그건 coverage 몫). maxAt은 몸 샘플 좌표 —
  // max 인질 이력(5회) 때문에 위치 필수.
  hoverSumMm: number;
  hoverMaxMm: number;
  hoverMaxAt: { x: number; y: number; z: number } | null;
}

export interface CoverageResult {
  samples: number;
  exposed: number;
  exposedRatio: number;
  // 키: "top|mid|bot-front|back-left|right"
  buckets: Record<string, CoverageBucket>;
  exposedExamples: { x: number; y: number; z: number }[];
  // probeReverse=true일 때만 채워진다: 노출 샘플 중 반대 방향 레이가 천을
  // 맞힌 수(= 부호 오판 후보). params.probeReverse 주석 참고.
  reverseHits: number;
  // 히트 샘플별 (버킷키, hover mm, 몸 샘플 좌표) — 분포·접촉률 계산용.
  // 영역 정의를 **몸 표면 샘플 좌표계 하나로** 고정하기 위해 원자료를
  // 그대로 노출한다(천 행 인덱스로 대역을 재정의하면 비교 불가 —
  // 이번 세션 2회 재발한 함정).
  hits: { bucket: string; hoverMm: number; x: number; y: number; z: number }[];
  // 83회차 — 버킷별 「관통을 피복으로 센」 건수(옷 면법선·레이 내적 < 0).
  // 히트가 없는 버킷은 키가 없다.
  penetrationHits: Record<string, number>;
}

// ── §9-1 어깨/삼각근(deltoid) 대역 ──────────────────────────────────────
// 기존 몸통 대역이 **버린** 집합을 잰다. frontIndex/backIndex는 팔 축 9cm
// 안쪽 삼각형을 빼고 굽는데(meshCollision.excludeArms), 소매산이 덮어야 할
// 어깨 곡면·삼각근 능선이 정확히 그 제외 영역이다 — 함정 11의 "현
// coverageMetric은 몸통 대역만 봐서 어깨 구간에 면적계 역할을 못 한다"가
// 이것. 신 대역을 그 여집합으로 정의하므로 두 대역은 **구조적으로 서로
// 겹치지 않는다** → 합산 금지·별도 채널 규약이 배선으로 지켜진다.
// (몸통 대역의 절대값은 대역 정의가 그대로이므로 비교 가능성도 유지된다.)
//
// 대역은 전부 **몸 기준 도출**(규범 1) — 옷 치수·행 인덱스 무관:
//   축   = 어깨 관절(trueShoulder, 뼈대) → 팔 방향(dir, 뼈대) 선분
//   반경 = SHOULDER_BAND_RADIUS — meshCollision.ARM_EXCLUDE_RADIUS와 같은
//          값이어야 여집합이 성립한다(둘이 갈라지면 두 대역이 겹치거나
//          사이에 빈틈이 생긴다).
//   길이 = 어깨 반폭 |trueShoulder.x − centerX| (추정, Stage 2a 실측 확정)
//          — 삼각근 축방향 범위의 몸 기준 스케일. 팔 전체를 넣으면 반팔에서
//          정상 노출인 맨살 전완이 노출률을 지배해 게이트가 못 된다.
//   Y범위 = 걸러낸 삼각형 정점의 실측 extent(버킷 3분할의 분모도 이것).
// = bodySkeleton.ARM_AXIS_RADIUS = meshCollision.ARM_EXCLUDE_RADIUS.
export const SHOULDER_BAND_RADIUS = ARM_AXIS_RADIUS;

// 선분 최근접점 수학은 bodySkeleton.ts 공유(부호 기준과 같은 정의를 써야
// 대역과 부호가 같은 몸을 본다 — 함정 6).
export type ArmAxis = Segment;

export interface ShoulderBand {
  mask: Uint8Array;
  triangles: number;
  axes: ArmAxis[];
  yMin: number;
  yMax: number;
  radius: number;
}

// 팔 축 근방(= 몸통 대역이 뺀 영역) 삼각형의 정점 마스크와 그 Y extent.
// 입력 인덱스는 wholeBodyIndex(팔 포함·머리 제외) — 머리 삼각형은 팔 축에서
// 9cm보다 멀어 어차피 걸러지므로 머리 제외 여부는 결과를 바꾸지 않는다.
export function deriveShoulderBand(
  position: Float32Array,
  wholeBodyIndex: ArrayLike<number> | null,
  arms: readonly { trueShoulder: Vec3Like; dir: Vec3Like }[],
  centerX: number,
  radius = SHOULDER_BAND_RADIUS,
): ShoulderBand {
  const axes: ArmAxis[] = arms.map(({ trueShoulder, dir }) => {
    const len = Math.abs(trueShoulder.x - centerX);
    return {
      a: trueShoulder,
      b: { x: trueShoulder.x + dir.x * len, y: trueShoulder.y + dir.y * len, z: trueShoulder.z + dir.z * len },
    };
  });
  const mask = new Uint8Array(position.length / 3);
  if (!wholeBodyIndex || axes.length === 0) return { mask, triangles: 0, axes, yMin: 0, yMax: 0, radius };
  const r2 = radius * radius;
  let triangles = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let t = 0; t < wholeBodyIndex.length; t += 3) {
    const a = wholeBodyIndex[t], b = wholeBodyIndex[t + 1], c = wholeBodyIndex[t + 2];
    const cx = (position[a * 3] + position[b * 3] + position[c * 3]) / 3;
    const cy = (position[a * 3 + 1] + position[b * 3 + 1] + position[c * 3 + 1]) / 3;
    const cz = (position[a * 3 + 2] + position[b * 3 + 2] + position[c * 3 + 2]) / 3;
    if (nearestOnSegments(cx, cy, cz, axes).d2 >= r2) continue;
    triangles++;
    for (const vi of [a, b, c]) {
      mask[vi] = 1;
      const y = position[vi * 3 + 1];
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  return { mask, triangles, axes, yMin, yMax, radius };
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
  // 샘플로 쓸 정점 마스크(없으면 전부). **법선은 언제나 넘겨받은 인덱스
  // 전체에서 누적**하고 마스크는 샘플 선택만 한다 — 대역만 잘라낸 조각
  // 메시로 법선을 누적하면 조각 경계 정점이 한쪽 삼각형만 받아 법선이
  // 기울고, 그 기울기가 부호 판정을 흔든다(어깨 대역 3자 불일치의 원인).
  mask?: Uint8Array,
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
    if (mask && !mask[i]) continue;
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
// 최근접 히트 거리(m)를 돌려준다(없으면 -1). hover 지표가 거리를 쓰므로
// 조기 탈출 대신 전 삼각형에서 최소 t를 찾는다.
function rayNearestHit(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tris: Float32Array,
  tMin: number,
  tMax: number,
  nearSign?: boolean,
  // 83회차 — 채택된 히트의 **부호**(옷 면법선 · 레이 방향 내적)를 밖으로 낸다.
  // 값 도입 0: 판정식은 아래 `nearSign` 블록이 이미 쓰던 것과 같고 문턱은 0이다.
  // 미전달이면 반환값·`best` 갱신 경로가 전부 그대로다(회귀 0).
  signOut?: { v: number },
): number {
  const EPS = 1e-9;
  let best = -1;
  let bestSign = 0;
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
    if (hitT > tMax || (best >= 0 && hitT >= best)) continue;
    // 면법선·레이 내적 — 아래 `nearSign` 블록이 쓰던 식을 위로 끌어올렸을 뿐이다.
    // `best` 갱신 조건에는 관여하지 않으므로 부동소수 결과가 바뀌지 않는다.
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;
    const fd = fnx * dx + fny * dy + fnz * dz;
    if (hitT >= tMin) { best = hitT; bestSign = fd; continue; }
    // ── 80회차 결함 ① 수리(`nearSign` 전달 시에만) ────────────────────────────
    // `tMin`(5mm)은 「두께 0의 몸 메시 자기 자신을 안 맞히도록」이라 적혀 있었으나
    // 이 레이가 쏘는 `tris`는 **옷 삼각형뿐이고 몸 메시가 들어 있지 않다**
    // → 이 하한이 버리는 것은 전부 **실제 옷 히트**다(79회차 등재 · 함정 19).
    // 문턱을 그냥 낮추면 관통을 피복으로 센다(함정 11) — 그래서 **부호**로 가른다.
    // 80회차 §3 실측: tMin 5→0mm 구간 130건 중 top 95건이
    // **근접 피복 93(97.9%) / 관통 1(1.1%) / 부호 모호 1(1.1%)** → 사전 등록 문턱 3개 통과.
    // 판정식: 옷 면법선과 레이 방향의 내적이 양수면 「옷 바깥면이 레이를 향한다」
    // = 근접 피복. 음수면 옷 바깥면이 몸을 향하므로 관통으로 보고 **버린다**(기존과 같다).
    // **새 상수 0** — `nearSign`은 켜고 끄는 스위치일 뿐 값이 아니다.
    if (!nearSign || hitT < 0) continue;
    if (fd > 0) { best = hitT; bestSign = fd; }
  }
  if (signOut) signOut.v = bestSign;
  return best;
}

// 첫 실측(A-② fixture)에서 mid-back 버킷이 93~96% "노출"로 나왔다 — 화면상
// 멀쩡히 덮인 상태라 지표 버그: 몸 메시 일부 영역의 삼각형 와인딩이
// 뒤집혀 있어 누적 정점 법선이 몸 안쪽을 향하고, 레이가 몸속으로 들어가
// 천을 못 만난 것. 와인딩을 신뢰하지 않고, 몸통 축 기준 방사 방향
// (+위쪽 성분 약간 — 어깨 꼭대기는 방사 성분이 0에 가까워서)과 내적이
// 음수면 법선을 뒤집어 항상 바깥을 향하게 교정한다.
function orientOutward(nx: number, ny: number, nz: number, refX: number, refY: number, refZ: number): [number, number, number] {
  const dot = nx * refX + ny * refY + nz * refZ;
  return dot < 0 ? [-nx, -ny, -nz] : [nx, ny, nz];
}

// 몸통 축 기준 바깥 방향 참조 벡터 — 방사 + 위쪽 25%(어깨 꼭대기는
// 방사 성분이 0에 가까워서).
function torsoOutwardRef(px: number, pz: number, centerX: number, centerZ: number): [number, number, number] {
  const rx = px - centerX;
  const rz = pz - centerZ;
  const rLen = Math.hypot(rx, rz) || 1e-9;
  return [rx / rLen, 0.25, rz / rLen];
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
  // 어깨/삼각근 대역(§9-1)용 — 바깥 방향 참조를 몸통 축이 아니라 **팔 축**
  // 기준으로 잡는다. 팔 표면은 몸통 축 방사 전제(star-shaped)가 깨져서
  // (소매 콜라이더 기각의 확정 원인 후보) 겨드랑이 쪽 법선이 뒤집혀 정상
  // 상태가 "노출"로 나온다 — mid-back 93% 오판(위 주석)의 팔 버전.
  outwardAxes?: readonly ArmAxis[];
  // 계기 검증 채널 — 노출로 판정된 샘플에서 **반대 방향 근거리**(기본 2cm)
  // 레이도 쏴 본다. 바로 뒤에 천이 있으면 (i) 법선 부호 오판(몸 안으로 쏘고
  // "노출"이라 우긴 mid-back 93% 오판의 팔 버전) 또는 (ii) 천이 몸 안으로
  // 관통한 상태 — 둘 다 노출률을 게이트로 쓰기 전에 0에 가까워야 한다.
  // **근거리 제한이 핵심**: 무제한으로 쏘면 반대쪽 레이가 몸을 관통해 소매
  // 튜브의 **반대편 벽**을 맞히므로(팔 두께 ~9cm < rayMax 25cm) 정상 상태에서
  // 도 대부분 히트한다 — 실제로 그렇게 재서 92%가 나왔다(계기 오설계).
  probeReverse?: boolean;
  probeReverseMax?: number;
  // 샘플 정점 마스크 — collectBandSamples의 mask 주석 참고.
  sampleMask?: Uint8Array;
  // 80회차 — `rayMin` 미만 히트를 **부호로** 살린다(위 rayNearestHit 주석).
  // 기본 off라 미전달이면 25~78회차와 비트 동일이다(병기용).
  nearSign?: boolean;
  // 83회차 결함 ③-b 병기 — `orientOutward`(참조축 근사)를 **건너뛰고**
  // `collectBandSamples`가 누적한 와인딩 법선을 그대로 레이 방향으로 쓴다.
  // 기본 off · 미전달이면 값이 안 바뀐다.
  // **제한**: 절단 시트(`[frontIdx, backIdx]`)에는 물리지 말 것 — 절단선
  // 정점이 한쪽 삼각형만 받아 법선이 기운다(:140-143 주석). covShoulder 전용.
  // **해석 제한**: 이 법선은 「진리」가 아니라 **와인딩 법선**이다. 이 메시는
  // 일부 영역 와인딩이 뒤집혀 있고(아래 orientOutward 주석의 mid-back 93~96%)
  // 그것이 `orientOutward`의 존재 이유다 — old/new와 갈릴 때 그 차이가
  // 「참조축 편향」인지 「와인딩 결함」인지 **이 채널 하나로는 못 가른다**.
  rawNormal?: boolean;
}

export function computeBodyCoverage(
  bodyPosition: Float32Array,
  bodyIndexes: readonly (ArrayLike<number> | null)[],
  sim: GridView,
  clothPanels: readonly ClothPanelRange[],
  params: CoverageParams,
  // v2(patternCore): 비정형 메시는 격자 셀에서 삼각형을 뽑을 수 없다 —
  // 호출자가 실제 삼각형(평탄 xyz 3개×3)을 직접 넘긴다. 없으면 기존
  // 격자 경로 그대로이므로 v1은 비트 동일.
  clothTrisOverride?: Float32Array,
): CoverageResult {
  const rayMin = params.rayMin ?? 0.005;
  const rayMax = params.rayMax ?? 0.25;
  const body = collectBandSamples(bodyPosition, bodyIndexes, params.yMin, params.yMax, params.neckCenter, params.neckRadius, params.sampleMask);
  const tris = clothTrisOverride ?? clothTriangles(sim, clothPanels);

  const buckets: Record<string, CoverageBucket> = {};
  const exposedExamples: { x: number; y: number; z: number }[] = [];
  const hits: { bucket: string; hoverMm: number; x: number; y: number; z: number }[] = [];
  let exposed = 0;
  let reverseHits = 0;
  // 83회차 — 「피복」으로 센 히트 중 옷 바깥면이 **몸을 향한** 것(= 관통을
  // 피복으로 오분류). 버킷별 건수. 문턱은 0(부호)이고 새 상수는 없다.
  const penetrationHits: Record<string, number> = {};
  const sgn = { v: 0 };
  const bandH = (params.yMax - params.yMin) / 3;
  for (let i = 0; i < body.count; i++) {
    const x = body.points[i * 3];
    const y = body.points[i * 3 + 1];
    const z = body.points[i * 3 + 2];
    const yBand = y > params.yMax - bandH ? "top" : y > params.yMax - 2 * bandH ? "mid" : "bot";
    const key = `${yBand}-${z >= params.centerZ ? "front" : "back"}-${x >= params.centerX ? "left" : "right"}`;
    const bucket = (buckets[key] ??= { samples: 0, exposed: 0, hoverSumMm: 0, hoverMaxMm: 0, hoverMaxAt: null });
    bucket.samples++;
    // 바깥 방향 참조: 몸통 축 방사(기존) 또는 팔 축 방사(어깨 대역).
    let refX: number, refY: number, refZ: number;
    if (params.outwardAxes && params.outwardAxes.length > 0) {
      const { x: cx, y: cy, z: cz } = nearestOnSegments(x, y, z, params.outwardAxes);
      const rl = Math.hypot(x - cx, y - cy, z - cz) || 1e-9;
      refX = (x - cx) / rl;
      refY = (y - cy) / rl + 0.25;
      refZ = (z - cz) / rl;
    } else {
      [refX, refY, refZ] = torsoOutwardRef(x, z, params.centerX, params.centerZ);
    }
    const [nx, ny, nz] = params.rawNormal
      ? [body.normals[i * 3], body.normals[i * 3 + 1], body.normals[i * 3 + 2]]
      : orientOutward(
        body.normals[i * 3], body.normals[i * 3 + 1], body.normals[i * 3 + 2],
        refX, refY, refZ,
      );
    const hitT = rayNearestHit(x, y, z, nx, ny, nz, tris, rayMin, rayMax, params.nearSign, sgn);
    const hit = hitT >= 0;
    if (hit) {
      if (sgn.v < 0) penetrationHits[key] = (penetrationHits[key] ?? 0) + 1;
      const mm = hitT * 1000;
      hits.push({ bucket: key, hoverMm: Number(mm.toFixed(2)), x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), z: Number(z.toFixed(4)) });
      bucket.hoverSumMm += mm;
      if (mm > bucket.hoverMaxMm) {
        bucket.hoverMaxMm = mm;
        bucket.hoverMaxAt = { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), z: Number(z.toFixed(4)) };
      }
    }
    if (!hit) {
      exposed++;
      bucket.exposed++;
      if (params.probeReverse && rayNearestHit(x, y, z, -nx, -ny, -nz, tris, rayMin, params.probeReverseMax ?? 0.02) >= 0) reverseHits++;
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
    hits,
    reverseHits,
    penetrationHits,
  };
}
