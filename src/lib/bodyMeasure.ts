// v2 Stage 2a — 패턴 제도가 쓰는 몸 실측 (규범 1: 전부 몸 메시에서 도출).
//
// 왜 새 파일인가: 스파이크(spikePanels.ts)의 단면 둘레는 x·z 범위의 타원
// 근사(Ramanujan)였고, 그 파일 상단 `ponytail:` 주석이 "정식 둘레 측정은
// Stage 2a 패턴 제도에서 경계 곡선을 뽑을 때 같이 온다"로 미뤄 뒀다. 이
// 파일이 그 이연분이다. 스파이크는 **마이그레이션하지 않는다** — 그 실행
// (958프레임 수렴)이 이미 metrics-log에 등재됐고, 측정 정의를 바꾸면 그
// 기록을 재현할 수 없게 된다(§6: 스파이크 산출물은 병합 대상 아님).
//
// ## 단면 둘레의 정의 (세 번 갈아엎고 정착한 것 — 실측 근거 병기)
//
// `girthAt` = **각도 bin별 최근접 표면점의 볼록껍질 둘레**. 세 층이 각각
// 하나의 오염을 막는다:
//   1. 각도 bin별 **최근접**: 턱·팔을 원리적으로 배제한다. 같은 방향에서
//      더 먼 표면(턱, 팔)은 뽑히지 않는다. 정찰 실측 — 목 최소 단면이
//      볼록껍질 단독에서 43.3cm(턱 포함, depth 16.5cm)였는데 이 층을 넣자
//      32.4cm가 됐다.
//   2. **볼록껍질**: 줄자 의미. 줄자는 겨드랑이·허리 오목부를 가로지른다.
//      최근접 다각형 단독은 오목부를 파고들어 가슴 90.9cm(줄자 ~85cm)로
//      과대평가했다.
//   3. **팔 제외 인덱스 + 최근접 골격 선분 규칙**: 스파이크에서 확정된
//      규칙(계기 결함 3건). 손이 골반 높이에 오는 자세라 반경 게이트로는
//      안 빠진다.
// 알려진 편향: 1번 층은 오목부(턱 밑, 겨드랑이)에서 **과소평가**한다.
// 목 둘레 32.4cm는 해부학적 목 둘레(~36cm)보다 작다 — 목선 하한 게이트에
// 쓸 때 그만큼 관대해진다는 뜻이므로 판정에 이 사실을 병기할 것.
//
// `shoulderPassGirthM`은 **다른 정의**를 쓴다(팔 포함 전체 볼록껍질) —
// "링이 어깨를 넘어 흘러내릴 수 있는가"는 팔·삼각근을 포함한 통과 단면이
// 답이고, v1 B정찰의 106.7cm와 같은 것을 재는 것이 목적이다. 이 정의로
// 어깨 관절 높이에서 **107.0cm**가 나와 v1 값과 0.3cm 안에서 일치했다
// (정의 교차검증 — metrics-log 2026-07-29 B 블록).
import type { Vec3Like } from "./clothProtocol";
import { nearestOnSegments } from "./bodySkeleton";
import type { BodySkeleton } from "./bodySkeleton";

// 슬라이스 두께 — 물리 상수가 아니라 **이산화 폭**이다(bodySkeleton의
// SLICES 주석과 같은 성격). 메시 정점이 슬라이스마다 100개 이상 잡히는
// 선에서 가장 얇게: 2.5cm에서 목 대역 표본 206개(정찰 실측).
const SLICE_THICKNESS_M = 0.025;
// 각도 bin 수. 24-gon의 둘레는 원 둘레의 99.86%라 이산화 손실은 무시 가능.
const GIRTH_BINS = 24;
// 어깨 능선 프로파일을 뽑을 때의 x 슬래브 반폭·z 대역 반폭. 능선은 시상면
// 근방의 상면이므로 z를 좁게 잡는다(넓히면 앞·뒤 표면이 섞여 상면이 아니라
// 최대 y가 된다).
const RIDGE_X_HALF_M = 0.01;
const RIDGE_Z_HALF_M = 0.04;

export interface BodySlice {
  y: number;
  girthM: number;
  widthM: number;
  depthM: number;
  zMin: number;
  zMax: number;
  axisX: number;
  axisZ: number;
  bins: number;
}

export interface BodyMeasure {
  // 뼈대 실측(입력 그대로 — 도출의 출처를 남긴다).
  shoulderJointY: number;
  shoulderSpanM: number;
  hemY: number;
  centerX: number;
  centerZ: number;
  // 슬라이스 스캔(밑단~머리끝).
  slices: BodySlice[];
  // 국소 극값에서 도출한 대표 치수.
  waistGirthM: number; waistY: number;
  chestGirthM: number; chestY: number;
  neckGirthM: number; neckY: number;
  // 밑단~어깨 관절 구간의 최대 앞뒤 두께.
  maxDepthM: number;
  // 몸통 축(centerZ) 기준 **앞/뒤 각각의** 최대 돌출. 정적 배치 오프셋은
  // 이 값을 쓴다 — maxDepth/2를 쓰면 몸의 z 비대칭(가슴이 앞으로 더 나온
  // 만큼)을 못 담아 앞판만 몸에 박힌다(첫 실행: 앞판 325 관통 / 뒤판 0).
  frontExtentM: number;
  backExtentM: number;
  // 팔 포함 통과 단면(위 주석 참고 — 정의가 다르다).
  shoulderPassGirthM: number;
  // 어깨 능선 상면 프로파일(x 오름차순, x는 중심에서의 거리).
  ridge: { xM: number; topY: number }[];
  // 능선 상면 높이 — 프로파일 선형 보간. 표본 밖은 가장 가까운 표본.
  ridgeTopYAt: (xM: number) => number;
}

// Andrew monotone chain. 반환은 둘레만(형상은 쓰는 곳이 없다).
function hullPerimeter(pts: readonly [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (seq: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const q of seq) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out;
  };
  const lower = build(p);
  const upper = build([...p].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

// 위 주석의 3층 정의. `pts`는 이미 팔이 걸러진 (x,z) 표본.
function girthOfSlice(pts: readonly [number, number][], cx: number, cz: number): { girthM: number; bins: number } {
  const bestR = new Array<number>(GIRTH_BINS).fill(Infinity);
  const nearest = new Array<[number, number] | null>(GIRTH_BINS).fill(null);
  for (const [x, z] of pts) {
    const ang = Math.atan2(z - cz, x - cx);
    const b = Math.min(GIRTH_BINS - 1, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * GIRTH_BINS));
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestR[b]) { bestR[b] = d; nearest[b] = [x, z]; }
  }
  const pick = nearest.filter((p): p is [number, number] => p !== null);
  return { girthM: hullPerimeter(pick), bins: pick.length };
}

export function measureBody(
  position: Float32Array,
  // 팔 제외 몸통 삼각형 인덱스(frontIndex+backIndex) — 정점 집합으로 환산해 쓴다.
  torsoIndex: ArrayLike<number>,
  // 전신 삼각형 인덱스(팔 포함) — shoulderPassGirthM 전용.
  wholeIndex: ArrayLike<number> | null,
  arms: readonly [{ trueShoulder: Vec3Like }, { trueShoulder: Vec3Like }],
  skeleton: BodySkeleton,
  hemY: number,
  centerX: number,
  centerZ: number,
): BodyMeasure {
  const shoulderJointY = Math.max(arms[0].trueShoulder.y, arms[1].trueShoulder.y);
  const shoulderSpanM = Math.abs(arms[0].trueShoulder.x - arms[1].trueShoulder.x);

  // 정점 단위로 한 번만 팔 판정 — 슬라이스마다 다시 하면 골격 질의가
  // (정점 × 슬라이스)번 돈다.
  const torsoVerts: number[] = [];
  // 어깨 능선 전용 집합 — **팔 제외를 적용하지 않는다.** 최근접 골격 선분
  // 규칙은 어깨 캡(관절보다 위)의 최근접점을 팔 축 끝점으로 잡으므로 삼각근·
  // 어깨 상면이 통째로 "팔"로 분류된다. 그 집합으로 능선을 재면 x 12cm에서
  // 상면이 y 119cm(몸통 옆면), 18cm에서 42cm(골반)로 무너지고 어깨 경사가
  // 83°·낙차 143cm로 나온다 — 첫 실행에서 실제로 이 오염이 전 게이트를
  // 연쇄 실패시켰다. 능선은 "시상면 근방의 최고점"이라 팔이 섞여도 위쪽
  // 성분만 뽑히므로 필터가 애초에 필요 없다(y ≤ 목 최소 높이 상한이 머리를
  // 막는다).
  const ridgeVerts: number[] = [];
  {
    const seen = new Set<number>();
    const armSegs = new Set(skeleton.arms);
    for (let t = 0; t < torsoIndex.length; t++) {
      const v = torsoIndex[t];
      if (seen.has(v)) continue;
      seen.add(v);
      ridgeVerts.push(v);
      const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
      if (armSegs.has(nearestOnSegments(x, y, z, skeleton.segments).segment)) continue;
      torsoVerts.push(v);
    }
  }

  let yTop = -Infinity;
  for (const v of torsoVerts) if (position[v * 3 + 1] > yTop) yTop = position[v * 3 + 1];

  // 몸통 축 — bodySkeleton 폴리라인을 그 높이에서 선형 보간해 쓴다(같은
  // 출처를 써야 대역·부호 기준이 갈라지지 않는다, 함정 6).
  const axisAt = (y: number): [number, number] => {
    let best = Infinity, bx = centerX, bz = centerZ;
    for (const s of skeleton.torso) {
      for (const p of [s.a, s.b]) {
        const d = Math.abs(p.y - y);
        if (d < best) { best = d; bx = p.x; bz = p.z; }
      }
    }
    return [bx, bz];
  };

  const slices: BodySlice[] = [];
  for (let y = hemY; y <= yTop; y += SLICE_THICKNESS_M) {
    const [cx, cz] = axisAt(y);
    const pts: [number, number][] = [];
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    void 0;
    for (const v of torsoVerts) {
      const vy = position[v * 3 + 1];
      if (Math.abs(vy - y) > SLICE_THICKNESS_M / 2) continue;
      const x = position[v * 3], z = position[v * 3 + 2];
      pts.push([x, z]);
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    if (pts.length < 3) continue;
    const { girthM, bins } = girthOfSlice(pts, cx, cz);
    slices.push({ y, girthM, widthM: xMax - xMin, depthM: zMax - zMin, zMin, zMax, axisX: cx, axisZ: cz, bins });
  }

  // 허리 = 어깨 관절 높이 **아래**에서 둘레 최소. 가슴 = 그 허리보다 위이면서
  // 어깨 관절 높이 아래인 구간의 최대. 상수 없이 국소 극값으로만 도출한다.
  let waistIdx = 0;
  for (let i = 0; i < slices.length; i++) {
    if (slices[i].y > shoulderJointY) break;
    if (slices[i].girthM < slices[waistIdx].girthM) waistIdx = i;
  }
  let chestIdx = waistIdx;
  for (let i = waistIdx; i < slices.length; i++) {
    if (slices[i].y > shoulderJointY) break;
    if (slices[i].girthM > slices[chestIdx].girthM) chestIdx = i;
  }
  // 목 = 어깨 관절 높이 위로 올라가며 만나는 **첫 국소 최소**. 끝까지 최소를
  // 찾으면 정수리(둘레 0으로 수렴)가 잡힌다.
  let neckIdx = -1;
  for (let i = 0; i < slices.length - 1; i++) {
    if (slices[i].y <= shoulderJointY) continue;
    if (neckIdx < 0) { neckIdx = i; continue; }
    if (slices[i].girthM <= slices[neckIdx].girthM) neckIdx = i;
    else break;
  }
  if (neckIdx < 0) throw new Error("measureBody: 어깨 관절 높이 위 슬라이스가 없다 — 몸 인덱스에 목·머리가 빠졌는지 확인");

  // 어깨 통과 단면 — 정의가 다르다(위 파일 주석). 팔 포함 전체 볼록껍질.
  let shoulderPassGirthM = 0;
  {
    const src = wholeIndex ?? torsoIndex;
    const seen = new Set<number>();
    const pts: [number, number][] = [];
    for (let t = 0; t < src.length; t++) {
      const v = src[t];
      if (seen.has(v)) continue;
      seen.add(v);
      const y = position[v * 3 + 1];
      if (Math.abs(y - shoulderJointY) > SLICE_THICKNESS_M / 2) continue;
      pts.push([position[v * 3], position[v * 3 + 2]]);
    }
    shoulderPassGirthM = hullPerimeter(pts);
  }

  // 어깨 능선 상면 — 목 최소 높이(neckY)를 상한으로 두면 머리가 안 섞인다.
  const neckY = slices[neckIdx].y;
  const ridge: { xM: number; topY: number }[] = [];
  for (let xc = 0; xc <= shoulderSpanM / 2 + 0.03; xc += 0.01) {
    let top = -Infinity;
    for (let s = -1; s <= 1; s += 2) {
      const x0 = centerX + s * xc;
      for (const v of ridgeVerts) {
        const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
        if (y > neckY) continue;
        if (Math.abs(x - x0) > RIDGE_X_HALF_M) continue;
        if (Math.abs(z - centerZ) > RIDGE_Z_HALF_M) continue;
        if (y > top) top = y;
      }
    }
    if (top > -Infinity) ridge.push({ xM: xc, topY: top });
  }
  if (ridge.length < 2) throw new Error("어깨 능선 프로파일 표본 부족 — z 대역·목 상한 확인");

  const ridgeTopYAt = (xM: number): number => {
    if (xM <= ridge[0].xM) return ridge[0].topY;
    if (xM >= ridge[ridge.length - 1].xM) return ridge[ridge.length - 1].topY;
    for (let i = 1; i < ridge.length; i++) {
      if (ridge[i].xM >= xM) {
        const t = (xM - ridge[i - 1].xM) / (ridge[i].xM - ridge[i - 1].xM);
        return ridge[i - 1].topY + (ridge[i].topY - ridge[i - 1].topY) * t;
      }
    }
    return ridge[ridge.length - 1].topY;
  };

  return {
    shoulderJointY, shoulderSpanM, hemY, centerX, centerZ,
    slices,
    waistGirthM: slices[waistIdx].girthM, waistY: slices[waistIdx].y,
    chestGirthM: slices[chestIdx].girthM, chestY: slices[chestIdx].y,
    neckGirthM: slices[neckIdx].girthM, neckY,
    maxDepthM: slices.reduce((m, s) => (s.y <= shoulderJointY && s.depthM > m ? s.depthM : m), 0),
    frontExtentM: slices.reduce((m, s) => (s.y <= shoulderJointY && s.zMax - centerZ > m ? s.zMax - centerZ : m), 0),
    backExtentM: slices.reduce((m, s) => (s.y <= shoulderJointY && centerZ - s.zMin > m ? centerZ - s.zMin : m), 0),
    shoulderPassGirthM,
    ridge, ridgeTopYAt,
  };
}
