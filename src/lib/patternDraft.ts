// v2 Stage 2a (1) — 티셔츠 패턴 제도(2D). v2-design §3.1.
//
// 패널 = 이름 있는 경계 세그먼트의 닫힌 루프. 세그먼트는 해석적 정의
// (직선/3차 베지에)이고, 솔버·시접·렌더는 **호장 등간격 표본**만 본다.
//
// ## 좌표계
// 패턴 공간 2D, 단위 m. x = 가로(몸판은 0 = 중심선, 소매는 0 = 소매산 정점),
// y = **아래로 증가**(0 = 어깨선). 몸판은 x ≥ 0 절반만 정의하고 삼각화 후
// 미러로 복제한다(§3.2 — `enforceLeftRightSymmetry` 이식을 위한 미러 쌍).
//
// ## 치수의 출처 (규범 1 — v1 격자 상수 승계 금지)
// 몸: `bodyMeasure.ts`(단면 둘레·어깨 능선 상면·목 최소). 옷: 사용자 슬라이더
// 5개(총장/품/어깨너비/소매길이/소매통). v1의 `necklineRise/Lift`·
// `SHOULDER_PIN_*`·`ARMHOLE_ROW_FRACTION`·`SLEEVE_RING_*`는 **하나도 쓰지
// 않는다** — 그 값들은 44×28 격자와 핀 프로파일에 묶여 있고, 스파이크에서
// v1 어깨 핀 좌표를 목 폭 출처로 썼다가 목구멍이 어깨선을 다 먹는 사고를
// 실측으로 잡은 전례가 있다(metrics-log 2a-thin 계기 결함 4번).
//
// ## 재단 상수 (전부 **추정** — Stage 2a/2b 실측 확정. 근거를 각 상수에 병기)
// 표준 상의 원형 제도의 관계식을 쓴다. 이 관계식 자체가 도출 근거이고,
// 값은 이 저장소의 실측으로 확정된 것이 아니므로 전부 (추정)이다.
import type { BodyMeasure } from "./bodyMeasure";

// 목너비(중심~목점) = 목둘레/6 + 0.5cm. 표준 상의 원형(뒤목너비 = 목둘레/6
// + 여유). (추정, Stage 2b 화면 V1로 확정)
const NECK_WIDTH_DIVISOR = 6;
const NECK_WIDTH_EASE_M = 0.005;
// 앞목깊이 = 목너비 + 1cm. §3.1의 "앞>뒤 목선 깊이"를 **구조적으로** 보장한다
// (뒤목깊이가 2cm 고정이므로 목너비가 1cm 이상이면 항상 앞>뒤). (추정)
const FRONT_NECK_EXTRA_M = 0.010;
// 뒤목깊이 2cm — 표준값. (추정)
const BACK_NECK_DROP_M = 0.020;
// 진동깊이 = 가슴둘레/4. 표준 상의 원형의 대표 관계식(교재별로 B/4 · B/6+7 ·
// B/8+7.5가 있고 B=84cm에서 21.0/21.0/18.0cm로 모여 B/4를 대표로 택했다).
// 정찰 교차검증: 이 마네킹의 팔 제외 최대폭 슬라이스(=흉위 대역)가 어깨
// 관절에서 19.4cm 아래였고 B/4 = 21.0cm와 1.6cm 안에서 일치. (추정)
const ARMHOLE_DEPTH_CHEST_DIVISOR = 4;
// 티셔츠 진동 여유 3cm — 원형은 밀착 기준이고 티셔츠는 낙낙하다. (추정)
const ARMHOLE_DEPTH_EASE_M = 0.030;
// 소매산 이즈 3cm — pattern-redesign 1번 조사의 채택값 그대로 승계
// (우븐 1.5~2.5 / 니트 0.5~1.5 / 핏된 소매 3~4.5 중 우븐 평균). 원단별
// 분기는 이 단계 범위 밖. (추정, 조사 근거 있음)
const SLEEVE_CAP_EASE_M = 0.030;
// 암홀 둘레 하한 = 팔 둘레 + 이 값(팔이 통과할 최소 여유). (추정)
export const ARMHOLE_ARM_CLEARANCE_M = 0.020;
// 암홀 곡선 형상 — 어깨점에서 **어깨선에 수직**으로 출발(암홀은 어깨
// 이음선과 직각으로 만난다)하고 겨드랑이에서 **옆선에 접**한다(C¹). 두
// 계수는 그 접선 방향으로 뻗는 제어점 거리를 현 길이 대비로 준 것. (추정)
const ARMHOLE_TANGENT_SHOULDER = 0.35;
const ARMHOLE_TANGENT_UNDERARM = 0.55;
// 소매산 S곡선 형상 — 정점에서 수평 접선(어깨를 매끄럽게 넘는다), 겨드랑이
// 에서 수직 접선(소매 옆선에 접한다). (추정)
const CAP_TANGENT_APEX = 0.55;
const CAP_TANGENT_UNDERARM = 0.45;
// 4분 타원의 3차 베지에 근사 계수(kappa) — 기하 상수, 추정 아님.
const KAPPA = 0.5522847498;

export interface Vec2 { x: number; y: number }

export type CurveDef =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "cubic"; p0: Vec2; c0: Vec2; c1: Vec2; p1: Vec2 };

export interface PatternSegment {
  name: string;
  curve: CurveDef;
  // 경계 대역 refinement 대상(목선·암홀·어깨선·소매산). 직선 경계(옆선·
  // 밑단·중심선·커프)는 내부 밀도(§1.4.1).
  refined: boolean;
  lengthM: number;
  // 호장 등간격 표본(끝점 포함). 표본 수는 시접 짝과 맞춰 확정된다.
  samples: Vec2[];
}

export type PanelName = "front" | "back" | "sleeve";

export interface PatternPanel {
  name: PanelName;
  // 닫힌 루프 순서. 인접 세그먼트는 끝점을 공유한다.
  segments: PatternSegment[];
  // 몸판: x ≥ 0 절반만 정의 → 삼각화 후 미러. 소매: 전체.
  halfWithMirrorAxis: boolean;
}

export interface SeamSpec {
  kind: "shoulder" | "side" | "armhole" | "sleeveUnder";
  a: { panel: PanelName; segment: string };
  b: { panel: PanelName; segment: string };
  // b 쪽 표본을 역순으로 짝지을지(루프 진행 방향이 반대인 경우).
  reverseB: boolean;
}

export interface PatternDraft {
  panels: PatternPanel[];
  seams: SeamSpec[];
  dims: {
    // 몸 실측 유래
    chestGirthM: number; neckGirthM: number; shoulderPassGirthM: number;
    ridgeAnchorY: number; shoulderSlope: number;
    // 옷 슬라이더 유래
    lengthM: number; halfWidthM: number; shoulderHalfM: number;
    sleeveLengthM: number; sleeveHalfWidthM: number;
    // 도출된 패턴 수치
    neckHalfWidthM: number; frontNeckDropM: number; backNeckDropM: number;
    shoulderDropM: number; shoulderSeamM: number;
    armholeDepthM: number; armholeGirthM: number;
    capHeightM: number; capHeightTriangleM: number; capGirthM: number;
    underSleeveM: number; necklineGirthM: number;
    armGirthM: number; sleeveTubeRadiusM: number;
  };
}

// ── 곡선 ────────────────────────────────────────────────────────────────
export function evalCurve(c: CurveDef, t: number): Vec2 {
  if (c.kind === "line") return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t };
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return {
    x: w0 * c.p0.x + w1 * c.c0.x + w2 * c.c1.x + w3 * c.p1.x,
    y: w0 * c.p0.y + w1 * c.c0.y + w2 * c.c1.y + w3 * c.p1.y,
  };
}

// 호장 표: 세분 폴리라인의 누적 길이. 직선은 2점으로 끝난다.
const ARC_STEPS = 256;
function arcTable(c: CurveDef, forceSteps?: number): { pts: Vec2[]; cum: number[] } {
  const steps = forceSteps ?? (c.kind === "line" ? 1 : ARC_STEPS);
  const pts: Vec2[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= steps; i++) pts.push(evalCurve(c, i / steps));
  for (let i = 1; i <= steps; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum };
}

export function curveLength(c: CurveDef): number {
  const { cum } = arcTable(c);
  return cum[cum.length - 1];
}

// 호장 등간격 표본 count개(양 끝 포함). 표본이 프레임마다 흔들리면 계기의
// 대상이 흔들리므로(§3.1 대안 기각) 여기서 한 번 뽑아 고정한다.
export function sampleArcEqual(c: CurveDef, count: number): Vec2[] {
  if (count < 2) throw new Error(`sampleArcEqual: count ${count} < 2`);
  const { pts, cum } = arcTable(c);
  const total = cum[cum.length - 1];
  const out: Vec2[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 1e-12 ? (target - cum[seg]) / span : 0;
    out.push({ x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t });
  }
  return out;
}

// 크기장 밀도로 표본화 — **직선 경계 전용**. 곡선 경계(refined)는 균일
// 8mm이지만, 직선 경계(옆선·밑단·중심선·커프)는 한쪽 끝이 경계 대역 안에
// 들어간다(예: 옆선 위쪽 3cm는 암홀 대역). 균일 16mm로 뽑으면 그 구간에서
// 엣지가 크기장의 2배가 되어 삼각화 품질 게이트(±30%)가 원리적으로 통과
// 불가능해진다 — 첫 실행에서 이탈 71.6%가 정확히 그 지점(중심선 y7.7cm,
// 소매 옆선 y8.3cm)에서 나왔다.
export function sampleBySizeField(c: CurveDef, h: (x: number, y: number) => number): Vec2[] {
  // 직선도 반드시 잘게 쪼갠다 — `arcTable`의 기본값은 직선을 2점으로 끝내므로
  // 크기장을 중점 한 곳에서만 읽게 되고, 그러면 밀도가 균일해져 이 함수가
  // 아무 일도 하지 않는다(첫 시도에서 실제로 그렇게 조용히 무효화됐다).
  const { pts, cum } = arcTable(c, ARC_STEPS);
  const sizeCum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i].x + pts[i - 1].x) / 2, my = (pts[i].y + pts[i - 1].y) / 2;
    sizeCum.push(sizeCum[i - 1] + (cum[i] - cum[i - 1]) / h(mx, my));
  }
  const total = sizeCum[sizeCum.length - 1];
  const count = Math.max(2, Math.round(total) + 1);
  const out: Vec2[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (seg < sizeCum.length - 2 && sizeCum[seg + 1] < target) seg++;
    const span = sizeCum[seg + 1] - sizeCum[seg];
    const t = span > 1e-12 ? (target - sizeCum[seg]) / span : 0;
    out.push({ x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t });
  }
  return out;
}

const seg = (name: string, curve: CurveDef, refined: boolean): PatternSegment =>
  ({ name, curve, refined, lengthM: curveLength(curve), samples: [] });

// ── 제도 ────────────────────────────────────────────────────────────────
export interface GarmentDims {
  lengthM: number;        // 총장 — 목점(HPS)에서 밑단
  widthM: number;         // 품(가슴단면) = 몸판 1매의 전체 폭
  shoulderWidthM: number; // 어깨너비 — 옷 어깨점 사이
  sleeveLengthM: number;  // 소매길이 — 어깨점에서 소맷부리
  sleeveWidthM: number;   // 소매통(평면 실측) → 소매 둘레 = 2×이 값
}

export function draftTshirtPattern(body: BodyMeasure, g: GarmentDims): PatternDraft {
  const halfWidthM = g.widthM / 2;
  const shoulderHalfM = g.shoulderWidthM / 2;

  // 목 — 몸 목둘레에서 도출.
  const neckHalfWidthM = body.neckGirthM / NECK_WIDTH_DIVISOR + NECK_WIDTH_EASE_M;
  const frontNeckDropM = neckHalfWidthM + FRONT_NECK_EXTRA_M;
  const backNeckDropM = BACK_NECK_DROP_M;

  // 어깨 경사 — 몸 능선 상면의 실제 기울기를 목점~어깨 관절 구간에서 재고,
  // 옷 어깨너비까지 **선형 연장**한다(옷 어깨점은 몸 관절보다 바깥일 수
  // 있다 — 품 55/어깨 45 조합에서 실제로 4.5cm 바깥).
  const ridgeAnchorY = body.ridgeTopYAt(neckHalfWidthM);
  const bodyShoulderHalfM = body.shoulderSpanM / 2;
  const shoulderSlope =
    (ridgeAnchorY - body.ridgeTopYAt(bodyShoulderHalfM)) / Math.max(1e-6, bodyShoulderHalfM - neckHalfWidthM);
  const shoulderDropM = shoulderSlope * (shoulderHalfM - neckHalfWidthM);

  // 진동깊이 — 몸 가슴둘레에서 도출 + 티셔츠 여유.
  const armholeDepthM = body.chestGirthM / ARMHOLE_DEPTH_CHEST_DIVISOR + ARMHOLE_DEPTH_EASE_M;

  const neckPoint: Vec2 = { x: neckHalfWidthM, y: 0 };
  const shoulderPoint: Vec2 = { x: shoulderHalfM, y: shoulderDropM };
  const underarmPoint: Vec2 = { x: halfWidthM, y: armholeDepthM };
  const hemOut: Vec2 = { x: halfWidthM, y: g.lengthM };
  const hemCenter: Vec2 = { x: 0, y: g.lengthM };

  // 암홀 곡선 — 어깨선 수직 출발 + 옆선 접선 도착(위 상수 주석).
  const armholeCurve = (): CurveDef => {
    const dx = shoulderPoint.x - neckPoint.x, dy = shoulderPoint.y - neckPoint.y;
    const sl = Math.hypot(dx, dy) || 1;
    // 어깨선에 수직이면서 패널 안쪽(아래)을 향하는 단위벡터.
    const nx = -dy / sl, ny = dx / sl;
    const chord = Math.hypot(underarmPoint.x - shoulderPoint.x, underarmPoint.y - shoulderPoint.y);
    return {
      kind: "cubic",
      p0: shoulderPoint,
      c0: { x: shoulderPoint.x + nx * ARMHOLE_TANGENT_SHOULDER * chord, y: shoulderPoint.y + ny * ARMHOLE_TANGENT_SHOULDER * chord },
      c1: { x: underarmPoint.x, y: underarmPoint.y - ARMHOLE_TANGENT_UNDERARM * chord },
      p1: underarmPoint,
    };
  };

  // 목선 곡선 — 중심(0,0)을 중심으로 하는 4분 타원(반축 목너비 × 목깊이).
  const necklineCurve = (dropM: number): CurveDef => ({
    kind: "cubic",
    p0: { x: 0, y: dropM },
    c0: { x: KAPPA * neckHalfWidthM, y: dropM },
    c1: { x: neckHalfWidthM, y: KAPPA * dropM },
    p1: neckPoint,
  });

  const torsoPanel = (name: "front" | "back", dropM: number): PatternPanel => ({
    name,
    halfWithMirrorAxis: true,
    segments: [
      seg("neck", necklineCurve(dropM), true),
      seg("shoulder", { kind: "line", a: neckPoint, b: shoulderPoint }, true),
      seg("armhole", armholeCurve(), true),
      seg("side", { kind: "line", a: underarmPoint, b: hemOut }, false),
      seg("hem", { kind: "line", a: hemOut, b: hemCenter }, false),
      seg("center", { kind: "line", a: hemCenter, b: { x: 0, y: dropM } }, false),
    ],
  });

  const front = torsoPanel("front", frontNeckDropM);
  const back = torsoPanel("back", backNeckDropM);

  // 암홀 둘레(한쪽) = 앞 암홀 + 뒤 암홀. 두 곡선은 형상 상수가 같아 길이도
  // 같다(앞뒤 암홀 차등은 이 단계 범위 밖 — §3.1은 목선 깊이 차만 요구).
  const armholeGirthM =
    front.segments[2].lengthM + back.segments[2].lengthM;

  // ── 소매산: "walking the sleeve". 표준 삼각 공식은 **직선** 대각을 주므로
  // 실제로 그린 S곡선의 호장은 그보다 길다. 삼각 공식값을 초깃값으로 두고,
  // 그린 곡선의 총 호장이 (암홀 둘레 + 이즈)와 같아지도록 캡 높이를 이분법
  // 으로 내린다 — 실제 패턴 작업의 "소매 걷기" 보정 그대로.
  const base = g.sleeveWidthM;
  const hyp = (armholeGirthM + SLEEVE_CAP_EASE_M) / 2;
  const capHeightTriangleM = hyp > base ? Math.sqrt(hyp * hyp - base * base) : NaN;
  const capCurveFor = (ch: number): CurveDef => ({
    kind: "cubic",
    p0: { x: 0, y: 0 },
    c0: { x: CAP_TANGENT_APEX * base, y: 0 },
    c1: { x: base, y: ch - CAP_TANGENT_UNDERARM * ch },
    p1: { x: base, y: ch },
  });
  const capHalfTarget = (armholeGirthM + SLEEVE_CAP_EASE_M) / 2;
  let lo = 1e-4, hi = Math.max(hyp, base) * 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (curveLength(capCurveFor(mid)) < capHalfTarget) lo = mid; else hi = mid;
  }
  const capHeightM = (lo + hi) / 2;
  const capFront = capCurveFor(capHeightM);
  const capGirthM = 2 * curveLength(capFront);
  const underSleeveM = g.sleeveLengthM - capHeightM;

  const cuffY = capHeightM + underSleeveM;
  const sleeve: PatternPanel = {
    name: "sleeve",
    halfWithMirrorAxis: false,
    segments: [
      seg("capFront", capFront, true),
      seg("underFront", { kind: "line", a: { x: base, y: capHeightM }, b: { x: base, y: cuffY } }, false),
      seg("cuff", { kind: "line", a: { x: base, y: cuffY }, b: { x: -base, y: cuffY } }, false),
      seg("underBack", { kind: "line", a: { x: -base, y: cuffY }, b: { x: -base, y: capHeightM } }, false),
      // capFront의 x 반전 + 방향 반전(겨드랑이 → 정점).
      seg("capBack", {
        kind: "cubic",
        p0: { x: -base, y: capHeightM },
        c0: { x: -base, y: capHeightM - CAP_TANGENT_UNDERARM * capHeightM },
        c1: { x: -CAP_TANGENT_APEX * base, y: 0 },
        p1: { x: 0, y: 0 },
      }, true),
    ],
  };

  const necklineGirthM = 2 * (front.segments[0].lengthM + back.segments[0].lengthM);

  const seams: SeamSpec[] = [
    { kind: "shoulder", a: { panel: "front", segment: "shoulder" }, b: { panel: "back", segment: "shoulder" }, reverseB: false },
    { kind: "side", a: { panel: "front", segment: "side" }, b: { panel: "back", segment: "side" }, reverseB: false },
    // 앞 암홀(어깨점→겨드랑이) ↔ 소매산 앞(정점→겨드랑이): 같은 방향.
    { kind: "armhole", a: { panel: "front", segment: "armhole" }, b: { panel: "sleeve", segment: "capFront" }, reverseB: false },
    // 뒤 암홀(어깨점→겨드랑이) ↔ 소매산 뒤(겨드랑이→정점): 반대 방향.
    { kind: "armhole", a: { panel: "back", segment: "armhole" }, b: { panel: "sleeve", segment: "capBack" }, reverseB: true },
    // 소매 안쪽 시접(통 닫기): underFront(위→아래) ↔ underBack(아래→위).
    { kind: "sleeveUnder", a: { panel: "sleeve", segment: "underFront" }, b: { panel: "sleeve", segment: "underBack" }, reverseB: true },
  ];

  return {
    panels: [front, back, sleeve],
    seams,
    dims: {
      chestGirthM: body.chestGirthM, neckGirthM: body.neckGirthM,
      shoulderPassGirthM: body.shoulderPassGirthM,
      ridgeAnchorY, shoulderSlope,
      lengthM: g.lengthM, halfWidthM, shoulderHalfM,
      sleeveLengthM: g.sleeveLengthM, sleeveHalfWidthM: base,
      neckHalfWidthM, frontNeckDropM, backNeckDropM,
      shoulderDropM, shoulderSeamM: front.segments[1].lengthM,
      armholeDepthM, armholeGirthM,
      capHeightM, capHeightTriangleM, capGirthM,
      underSleeveM, necklineGirthM,
      // 팔 둘레·소매 튜브 반경 — 소매 여유 판정용. 팔 반경은 47번 실측
      // (ARM_COLLISION_RADIUS 4.56cm), 튜브 반경은 v1
      // `computeArmTubeRadius`(= 소매통/π)와 **같은 식**이라 소매 둘레가
      // 2×소매통이라는 규약이 여기서도 동일하다.
      armGirthM: 0, sleeveTubeRadiusM: g.sleeveWidthM / Math.PI,
    },
  };
}

// ── 패턴 수치 자기검사 (2a 정지 조건: 기하 모순이면 여기서 멈춘다) ──────
export interface DraftCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkDraft(d: PatternDraft, armGirthM: number): DraftCheck[] {
  const cm = (v: number): string => (v * 100).toFixed(2);
  const front = d.panels[0], back = d.panels[1];
  const out: DraftCheck[] = [];
  const push = (name: string, ok: boolean, detail: string): void => { out.push({ name, ok, detail }); };

  const sf = front.segments[1].lengthM, sb = back.segments[1].lengthM;
  push("어깨선 길이 앞=뒤", Math.abs(sf - sb) < 1e-9, `앞 ${cm(sf)}cm / 뒤 ${cm(sb)}cm / 차 ${((sf - sb) * 1000).toFixed(6)}mm`);

  const ease = d.dims.capGirthM - d.dims.armholeGirthM;
  push(
    "암홀 둘레 vs 소매산 둘레(이즈 명시)",
    Math.abs(ease - 0.03) < 1e-4,
    `암홀 ${cm(d.dims.armholeGirthM)}cm / 소매산 ${cm(d.dims.capGirthM)}cm / 이즈 ${cm(ease)}cm(목표 3.00cm)`,
  );

  push(
    "목선 둘레 하한(몸 목 최소 단면)",
    d.dims.necklineGirthM > d.dims.neckGirthM,
    `목선 ${cm(d.dims.necklineGirthM)}cm > 몸 목 ${cm(d.dims.neckGirthM)}cm (여유 ${cm(d.dims.necklineGirthM - d.dims.neckGirthM)}cm)`,
  );
  push(
    "목선 둘레 상한(어깨 통과 단면 — v1 96.2<106.7 재도출)",
    d.dims.necklineGirthM < d.dims.shoulderPassGirthM,
    `목선 ${cm(d.dims.necklineGirthM)}cm < 어깨 통과 ${cm(d.dims.shoulderPassGirthM)}cm (필요 신장 ${(((d.dims.shoulderPassGirthM / d.dims.necklineGirthM) - 1) * 100).toFixed(1)}%)`,
  );

  push(
    "앞목깊이 > 뒤목깊이",
    d.dims.frontNeckDropM > d.dims.backNeckDropM,
    `앞 ${cm(d.dims.frontNeckDropM)}cm / 뒤 ${cm(d.dims.backNeckDropM)}cm`,
  );

  push(
    "암홀 둘레 ≥ 팔 둘레 + 여유",
    d.dims.armholeGirthM >= armGirthM + ARMHOLE_ARM_CLEARANCE_M,
    `암홀 ${cm(d.dims.armholeGirthM)}cm vs 팔 ${cm(armGirthM)}cm + ${cm(ARMHOLE_ARM_CLEARANCE_M)}cm`,
  );

  push(
    "소매길이 > 소매산 높이(소매 하부 > 0)",
    d.dims.underSleeveM > 0,
    `소매길이 ${cm(d.dims.sleeveLengthM)}cm − 캡 ${cm(d.dims.capHeightM)}cm = 하부 ${cm(d.dims.underSleeveM)}cm (삼각공식 초깃값 ${cm(d.dims.capHeightTriangleM)}cm, 곡선 보정 −${cm(d.dims.capHeightTriangleM - d.dims.capHeightM)}cm)`,
  );

  push(
    "몸판 반폭 ≥ 어깨 반폭",
    d.dims.halfWidthM >= d.dims.shoulderHalfM,
    `반폭 ${cm(d.dims.halfWidthM)}cm / 어깨 반폭 ${cm(d.dims.shoulderHalfM)}cm`,
  );
  push(
    "목너비 < 어깨 반폭",
    d.dims.neckHalfWidthM < d.dims.shoulderHalfM,
    `목너비 ${cm(d.dims.neckHalfWidthM)}cm / 어깨 반폭 ${cm(d.dims.shoulderHalfM)}cm`,
  );
  push(
    "소매 둘레 > 팔 둘레",
    2 * d.dims.sleeveHalfWidthM > armGirthM,
    `소매 둘레 ${cm(2 * d.dims.sleeveHalfWidthM)}cm / 팔 둘레 ${cm(armGirthM)}cm`,
  );

  // 루프 닫힘 — 인접 세그먼트 끝점이 실제로 같은 점인가(제도 버그 탐지).
  for (const p of d.panels) {
    let maxGap = 0;
    for (let i = 0; i < p.segments.length; i++) {
      const cur = p.segments[i].curve;
      const nxt = p.segments[(i + 1) % p.segments.length].curve;
      const e = cur.kind === "line" ? cur.b : cur.p1;
      const s = nxt.kind === "line" ? nxt.a : nxt.p0;
      maxGap = Math.max(maxGap, Math.hypot(e.x - s.x, e.y - s.y));
    }
    push(`루프 닫힘(${p.name})`, maxGap < 1e-12, `최대 끝점 간극 ${(maxGap * 1000).toFixed(9)}mm`);
  }

  return out;
}
