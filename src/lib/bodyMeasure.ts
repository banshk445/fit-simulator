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
import { axisSection } from "./bodyGeodesic";
import { COLLISION_MARGIN } from "./clothConfig";
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
// P11 §1 — 팔 축 단면의 표본 간격. **이 파일의 능선 표본 간격과 같은 1cm**
// (`ridgePoints` 「1cm 간격」 · :385 루프 증분). 새 간격 규약을 만들지 않는다.
const ARM_SECTION_STEP_M = 0.01;
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
  // 목**밑** — 목선이 실제로 앉는 자리. neckGirth(목 기둥 최소 단면)와 다르다.
  // 9회차 실측: 이 몸에서 32.38 vs 45.7cm. 제도 입력은 이쪽이어야 한다.
  neckBaseGirthM: number; neckBaseY: number;
  // 그 폐곡선을 **x 극점 두 곳**(어깨-목점이 놓이는 자리)에서 앞/뒤로 자른 길이.
  // 목선의 앞/뒤 배분이 몸과 맞는지 재는 데 쓴다(제도의 뒤목 깊이 고정 상수가
  // 몸과 어긋나는지가 여기서 드러난다).
  neckBaseFrontM: number; neckBaseBackM: number;
  // 임의 높이의 몸 폐곡선(표면 + 오프셋)을 **볼록껍질 정점 순서대로** 준다.
  // 목밑둘레를 재는 것과 같은 기계이고, 목선 경계를 이 곡선 위에 직접 얹는
  // 소비자(배치)가 쓴다. 표본이 모자라면 빈 배열.
  loopAt: (h: number, marginM: number) => [number, number][];
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
  // 능선 상면의 **실제 표면 정점 좌표**(좌·우 양쪽, 1cm 간격). 프로파일을
  // (x, topY, centerZ)로 재구성하면 z가 실제 정점의 z와 달라 표면을 벗어난다 —
  // 앵커 목표처럼 "몸 표면 위의 점"이 필요한 소비자는 이 집합을 쓴다.
  ridgePoints: Vec3Like[];
  // 능선 상면 높이 — 프로파일 선형 보간. 표본 밖은 가장 가까운 표본.
  ridgeTopYAt: (xM: number) => number;
  // ── P11 §1 — **팔 축 수직 단면 둘레**. 팔꿈치·손 좌표가 없으면(구 fixture) `null`.
  // 자세한 정의·주의는 `measureArmSection` 주석. 위 세 채널과 **이름을 나눈다**.
  armSection: ArmSectionMeasure | null;
}

/**
 * 팔 축에 수직인 평면으로 **전신 메시**를 잘라 낸 단면 둘레.
 *
 * ## 어느 포락선인가 — **표면 단면 폴리라인 그대로**다
 * `axisSection`(bodyGeodesic)이 삼각형을 평면으로 잘라 만든 **실제 교선 고리의 길이**다.
 * 이 파일의 다른 두 채널과 **정의가 다르므로 이름을 나눈다**(103 계기 결함 ② 재발 방지):
 *
 * | 채널 | 포락선 | 값의 성격 |
 * |---|---|---|
 * | `chestGirthM`·`waistGirthM`·`neckGirthM`(`girthOfSlice`) | 각도 bin **최근접**점의 볼록껍질 = **안쪽** | 오목부를 가로지르는 「줄자」 |
 * | `shoulderPassGirthM` / `garmentFitLimits` 슬랩 | 팔 포함 볼록껍질 = **바깥** | 「통과 단면」 |
 * | **여기(`*SectionGirthM`)** | 볼록화 **없음** · 교선 그대로 | 표면을 «따라간» 실둘레 |
 *
 * ⟹ 오목한 자리에서 이 값은 줄자보다 **크게** 나온다. 커프처럼 「천이 표면을 감는」
 * 용도에는 이쪽이 맞지만, 가슴·허리 값과 **직접 비교하지 말 것**.
 *
 * ## 왜 축 수직인가
 * 수평면으로 자르면 축에 비스듬해 둘레가 부푼다(85회차 §3(b) y130). 그리고 축 방향은
 * **구간마다 다르다** — 어깨→팔꿈치와 팔꿈치→손은 서로 다른 방향이므로 각 구간에서
 * 그 구간의 방향을 쓴다(P10 §1이 캡슐을 꺾은 것과 같은 이유).
 *
 * ## 산출 불가
 * 팔이 몸통과 붙어 고리가 하나면(`loopCount === 1`) 그 지점은 **버린다** — 추정치로
 * 채우지 않는다. 어깨 근방이 그렇다.
 */
export interface ArmSectionMeasure {
  /** 팔 축 호장(어깨 관절 기준, m) → 단면 둘레(m). 산출된 표본만. 좌·우 팔 평균이 아니라 **왼팔**이다. */
  profile: { sM: number; girthM: number; equivRadiusM: number; loopCount: number }[];
  /** 어깨→팔꿈치 / 팔꿈치→손 구간 길이(m). */
  upperArmLenM: number;
  foreArmLenM: number;
  /** 위팔 중간(어깨→팔꿈치 50%)의 단면 둘레. 산출 불가면 null. */
  upperSectionGirthM: number | null;
  /** 팔꿈치(전완 구간 s=0). */
  elbowSectionGirthM: number | null;
  /** 전완 중간(팔꿈치→손 50%). */
  foreSectionGirthM: number | null;
  /** **손 직전** — 손 뼈대보다 앞에서 산출된 마지막 표본. 커프가 앉는 자리의 정의다. */
  wristSectionGirthM: number | null;
  /** 손목 표본의 호장(어깨 기준, m) — 정의가 「손 직전」이라 위치를 함께 낸다. */
  wristAtSM: number | null;
  /**
   * 산출된 표본 중 **최대** 둘레와 그 호장. 「팔이 암홀·소매통을 통과하는가」의 구속값은
   * 중간값이 아니라 이쪽이다(함정 18: 대역을 한 수로 요약하지 않는다 — 중간·최대를 병기).
   * 어깨 융합 대역 오염 감시도 겸한다(몸통이 뽑히면 여기서 몸통급 값으로 드러난다).
   */
  maxSectionGirthM: number | null;
  maxAtSM: number | null;
  /** 표본 간격(m)과 시도/성공 개수 — 산출 불가를 침묵으로 넘기지 않는다. */
  stepM: number; sampled: number; valid: number;
}

/**
 * 축 지점이 이 고리 «안»에 있는가 — 선분 방위각이 전 각도 bin을 덮는지로 본다.
 * 선분 하나가 걸치는 [th0, th1]은 짧은 쪽 호(|Δ| ≤ π)로 읽는다. 고리가 축을 감싸면
 * 모든 방향에 표면이 있고, 축이 고리 밖이면 반드시 비는 방향이 생긴다.
 */
function axisEnclosedByLoop(segRadii: readonly [number, number, number, number, number][]): boolean {
  const hit = new Uint8Array(GIRTH_BINS);
  const bin = (th: number): number =>
    Math.min(GIRTH_BINS - 1, Math.max(0, Math.floor(((th + Math.PI) / (2 * Math.PI)) * GIRTH_BINS)));
  for (const [, , , th0, th1] of segRadii) {
    let d = th1 - th0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    // 호를 bin 해상도보다 촘촘히 훑어 사이 bin이 빠지지 않게 한다.
    const steps = Math.max(1, Math.ceil((Math.abs(d) / (2 * Math.PI)) * GIRTH_BINS * 2));
    for (let k = 0; k <= steps; k++) hit[bin(th0 + (d * k) / steps)] = 1;
  }
  return hit.every((h) => h === 1);
}

/** 팔 축 폴리라인 위를 걸으며 `axisSection`을 부른다. 새 기하 연산 0 — 기존 도구 재사용. */
export function measureArmSection(
  position: Float32Array,
  wholeIndex: ArrayLike<number>,
  arm: { trueShoulder: Vec3Like; elbow?: Vec3Like; hand?: Vec3Like },
  stepM = ARM_SECTION_STEP_M,
): ArmSectionMeasure | null {
  const { trueShoulder: sh, elbow, hand } = arm;
  if (!elbow || !hand) return null;
  const sub = (a: Vec3Like, b: Vec3Like): Vec3Like => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const len = (a: Vec3Like): number => Math.hypot(a.x, a.y, a.z);
  const upperV = sub(elbow, sh), foreV = sub(hand, elbow);
  const upperArmLenM = len(upperV), foreArmLenM = len(foreV);
  if (upperArmLenM < 1e-6 || foreArmLenM < 1e-6) return null;

  const profile: ArmSectionMeasure["profile"] = [];
  let sampled = 0;
  // 구간마다 **그 구간의 방향**으로 자른다. `sM`은 어깨 기준 누적 호장이다.
  const walk = (origin: Vec3Like, dir: Vec3Like, segLenM: number, baseS: number): void => {
    for (let s = 0; s <= segLenM + 1e-9; s += stepM) {
      sampled++;
      const r = axisSection(position, wholeIndex, origin, dir, s);
      // 고리가 하나면 팔이 몸통과 붙어 **분리 불가**다 — 버린다(추정치로 안 채운다).
      if (!r.arm || r.loopCount < 2) continue;
      // 어깨 근방에서는 축 지점이 아직 «몸통 안»이라 `axisSection`의 「중심이 가장 가까운
      // 고리」가 **몸통**을 뽑는다(실측: s=3cm에서 118.89cm = 몸통급). 그래서 「축이 그
      // 고리 «안»에 있는가」를 직접 판정한다 — 선분 방위각이 **한 바퀴를 다 덮는가**.
      // 밖에 있는 고리는 축에서 볼 때 제한된 각도 부채꼴로만 보인다.
      // 문턱 상수 0: 이 파일의 각도 bin 규약(`GIRTH_BINS`)을 그대로 쓰고, 기준은 **전 bin**이다.
      // (방위각 기저는 임의여도 된다 — 「덮는가」는 기저 회전에 불변이다.)
      if (!axisEnclosedByLoop(r.arm.segRadii)) continue;
      // 그러나 어깨 근방에서는 축이 **정말로 몸통 안**이라 위 판정만으로는 안 걸러진다
      // (실측: s=3cm에서 여전히 118.89cm). 그 자리는 팔이 몸통과 **융합**되어 있어
      // 애초에 팔 단면이 존재하지 않는다. 융합은 「뽑힌 고리가 그 단면의 **최대 고리**」로
      // 정확히 드러난다 — 팔이 분리돼 있으면 몸통이 따로 더 큰 고리로 잡히기 때문이다.
      // **문턱 상수 0**(비교만 한다). 산출 불가는 산출 불가로 낸다.
      if (r.otherM.some((g) => g >= r.arm!.girthM)) { /* 몸통이 따로 있다 = 분리됨 */ } else continue;
      profile.push({ sM: baseS + s, girthM: r.arm.girthM, equivRadiusM: r.arm.equivRadiusM, loopCount: r.loopCount });
    }
  };
  walk(sh, upperV, upperArmLenM, 0);
  walk(elbow, foreV, foreArmLenM, upperArmLenM);

  // 지정 호장에 가장 가까운 «산출된» 표본. 절반 간격을 넘게 떨어지면 산출 불가로 낸다.
  const at = (target: number): number | null => {
    let best: (typeof profile)[number] | null = null;
    for (const p of profile) if (!best || Math.abs(p.sM - target) < Math.abs(best.sM - target)) best = p;
    return best && Math.abs(best.sM - target) <= stepM / 2 + 1e-9 ? best.girthM : null;
  };
  // 손목 = **손 직전**. 손 뼈대(sM = 위팔+전완)보다 앞에서 산출된 마지막 표본.
  const wrist = profile.length ? profile[profile.length - 1] : null;
  const max = profile.reduce<(typeof profile)[number] | null>((b, p) => (!b || p.girthM > b.girthM ? p : b), null);

  return {
    maxSectionGirthM: max ? max.girthM : null,
    maxAtSM: max ? max.sM : null,
    profile, upperArmLenM, foreArmLenM,
    upperSectionGirthM: at(upperArmLenM / 2),
    elbowSectionGirthM: at(upperArmLenM),
    foreSectionGirthM: at(upperArmLenM + foreArmLenM / 2),
    wristSectionGirthM: wrist ? wrist.girthM : null,
    wristAtSM: wrist ? wrist.sM : null,
    stepM, sampled, valid: profile.length,
  };
}

// Andrew monotone chain. 목밑 앞/뒤 배분을 재려면 **형상**이 필요해서
// 껍질 자체를 돌려주고 둘레는 그 위에서 잰다.
function convexHull(pts: readonly [number, number][]): [number, number][] {
  if (pts.length < 3) return [];
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
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function hullPerimeter(pts: readonly [number, number][]): number {
  const hull = convexHull(pts);
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

// 위 주석의 3층 정의. `pts`는 이미 팔이 걸러진 (x,z) 표본.
function girthOfSlice(
  pts: readonly [number, number][], cx: number, cz: number,
  // 표면에서 바깥으로 밀어낼 거리(0이면 표면 그대로 — 기존 소비자는 비트 동일).
  marginM = 0,
): { girthM: number; bins: number; points: [number, number][] } {
  const bestR = new Array<number>(GIRTH_BINS).fill(Infinity);
  const nearest = new Array<[number, number] | null>(GIRTH_BINS).fill(null);
  for (const [x, z] of pts) {
    const ang = Math.atan2(z - cz, x - cx);
    const b = Math.min(GIRTH_BINS - 1, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * GIRTH_BINS));
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestR[b]) { bestR[b] = d; nearest[b] = [x, z]; }
  }
  const pick = nearest.filter((p): p is [number, number] => p !== null);
  const off = pick.map(([x, z]): [number, number] => {
    const d = Math.hypot(x - cx, z - cz) || 1;
    return [cx + (x - cx) * (1 + marginM / d), cz + (z - cz) * (1 + marginM / d)];
  });
  return { girthM: hullPerimeter(off), bins: pick.length, points: off };
}

export function measureBody(
  position: Float32Array,
  // 팔 제외 몸통 삼각형 인덱스(frontIndex+backIndex) — 정점 집합으로 환산해 쓴다.
  torsoIndex: ArrayLike<number>,
  // 전신 삼각형 인덱스(팔 포함) — shoulderPassGirthM 전용.
  wholeIndex: ArrayLike<number> | null,
  // P11 §1 — `elbow`/`hand`는 **선택**이다(P10 §1이 fixture pose에 실은 값).
  // 없으면 `armSection`이 null이고 나머지 채널은 **비트 동일**하다.
  arms: readonly [
    { trueShoulder: Vec3Like; elbow?: Vec3Like; hand?: Vec3Like },
    { trueShoulder: Vec3Like; elbow?: Vec3Like; hand?: Vec3Like },
  ],
  skeleton: BodySkeleton,
  hemY: number,
  centerX: number,
  centerZ: number,
  // ── 102 §1 — **제도 시접 채널**(101 §1(c)). 목밑 슬라이스를 표면에서 이만큼 방사
  // 오프셋한 뒤 볼록껍질 둘레를 잰다 = 「목선이 얹힐 껍질의 반경」.
  // 기본값이 `COLLISION_MARGIN`이므로 **인자를 안 넘기는 호출은 비트 동일**이다.
  // v1 3경로(garmentWorker · paramSweep · spikeDressing)는 `measureBody`를 **부르지 않는다**
  // (호출부 전량: dressPattern · checkPattern · checkBoundary · checkOutline · PatternPreview).
  shellMarginM: number = COLLISION_MARGIN,
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
  const ridgePoints: Vec3Like[] = [];
  for (let xc = 0; xc <= shoulderSpanM / 2 + 0.03; xc += 0.01) {
    let top = -Infinity;
    for (let s = -1; s <= 1; s += 2) {
      const x0 = centerX + s * xc;
      let bestY = -Infinity, best: Vec3Like | null = null;
      for (const v of ridgeVerts) {
        const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
        if (y > neckY) continue;
        if (Math.abs(x - x0) > RIDGE_X_HALF_M) continue;
        if (Math.abs(z - centerZ) > RIDGE_Z_HALF_M) continue;
        if (y > bestY) { bestY = y; best = { x, y, z }; }
      }
      if (best) { ridgePoints.push(best); if (bestY > top) top = bestY; }
    }
    if (top > -Infinity) ridge.push({ xM: xc, topY: top });
  }
  if (ridge.length < 2) throw new Error("어깨 능선 프로파일 표본 부족 — z 대역·목 상한 확인");

  // ── 목밑 — 어깨 능선 상면 프로파일이 **가장 가파르게 떨어지는** 지점이 목
  // 기둥이 어깨로 꺾이는 전이다(실측: x 7cm에서 1.52cm 하강, 이웃 구간의 1.3배
  // 이상이고 그 위 x 0~5cm는 하강 0). 그 높이의 표면 + 옷 오프셋 최소 폐곡선이
  // 목선이 앉을 자리이고, 9회차 배치가 관통 교정으로 41.1cm를 잰 것과 같은 양이다.
  // 둘레 계산은 단면 둘레와 **같은 함수**를 쓴다(각도 bin 최근접 + 볼록껍질).
  let kneeI = 1, kneeDrop = -Infinity;
  for (let i = 1; i < ridge.length; i++) {
    const drop = ridge[i - 1].topY - ridge[i].topY;
    if (drop > kneeDrop) { kneeDrop = drop; kneeI = i; }
  }
  const neckBaseY = ridge[kneeI].topY;
  const neckBase = (() => {
    const [cx, cz] = axisAt(neckBaseY);
    const pts: [number, number][] = [];
    for (const v of torsoVerts) {
      if (Math.abs(position[v * 3 + 1] - neckBaseY) > SLICE_THICKNESS_M / 2) continue;
      pts.push([position[v * 3], position[v * 3 + 2]]);
    }
    if (pts.length < 3) throw new Error("목밑 단면 표본 부족 — 능선 무릎 높이 확인");
    const { girthM, points } = girthOfSlice(pts, cx, cz, shellMarginM);
    // 앞/뒤 배분 — 같은 폐곡선을 x 최대·최소 정점에서 자른다.
    const hull = convexHull(points);
    let iMax = 0, iMin = 0;
    for (let i = 1; i < hull.length; i++) {
      if (hull[i][0] > hull[iMax][0]) iMax = i;
      if (hull[i][0] < hull[iMin][0]) iMin = i;
    }
    const walk = (from: number, to: number): number => {
      let l = 0;
      for (let i = from; i !== to; i = (i + 1) % hull.length) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        l += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return l;
    };
    const aSide = walk(iMax, iMin), bSide = walk(iMin, iMax);
    // z가 큰 쪽(앞)을 고른다 — 두 조각의 중점 z로 판별한다.
    const midZ = (from: number, to: number): number => {
      let sum = 0, n = 0;
      for (let i = from; i !== to; i = (i + 1) % hull.length) { sum += hull[i][1]; n++; }
      return n > 0 ? sum / n : cz;
    };
    const aIsFront = midZ(iMax, iMin) > midZ(iMin, iMax);
    return { girthM, frontM: aIsFront ? aSide : bSide, backM: aIsFront ? bSide : aSide };
  })();

  const loopAt = (h: number, marginM: number): [number, number][] => {
    const [cx, cz] = axisAt(h);
    const pts: [number, number][] = [];
    for (const v of torsoVerts) {
      if (Math.abs(position[v * 3 + 1] - h) > SLICE_THICKNESS_M / 2) continue;
      pts.push([position[v * 3], position[v * 3 + 2]]);
    }
    if (pts.length < 3) return [];
    return convexHull(girthOfSlice(pts, cx, cz, marginM).points);
  };

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
    neckBaseGirthM: neckBase.girthM, neckBaseY,
    neckBaseFrontM: neckBase.frontM, neckBaseBackM: neckBase.backM,
    maxDepthM: slices.reduce((m, s) => (s.y <= shoulderJointY && s.depthM > m ? s.depthM : m), 0),
    frontExtentM: slices.reduce((m, s) => (s.y <= shoulderJointY && s.zMax - centerZ > m ? s.zMax - centerZ : m), 0),
    backExtentM: slices.reduce((m, s) => (s.y <= shoulderJointY && centerZ - s.zMin > m ? centerZ - s.zMin : m), 0),
    shoulderPassGirthM,
    ridge, ridgePoints, ridgeTopYAt, loopAt,
    // P11 §1 — **전신 인덱스**(`wholeIndex`)로 자른다. 몸통 인덱스(`torsoIndex` =
    // front+back)는 `excludeArms`로 팔을 도려낸 것이라 팔 단면이 원리적으로 안 나온다.
    // `wholeIndex`가 없는 호출은 산출 불가(null)로 낸다.
    armSection: wholeIndex ? measureArmSection(position, wholeIndex, arms[0]) : null,
  };
}
