// P2c(e) → P2d — **v2 패턴 착장 파이프라인**. 물리 호출 «순서»의 단일 출처다.
//
// 물리 로직은 한 줄도 여기서 새로 쓰지 않는다. P2b가 뽑아 둔 공유 모듈
// (`createPatternUnifiedResolver` · `bakePatternFrictionSdf` · `makePatternSessionEnv` ·
// `patternDressHooks` 3종)과 기존 라이브러리(`buildPatternGarment` · `buildPatternSim` ·
// `correctPlacementPenetration` · `runDressing`)를 부르는 순서만 담는다.
//
// **왜 단계형인가(P2d)**: P2c까지 `scripts/dressPattern.ts`가 같은 순서를 자기 안에
// 갖고 있었다 — 물리 «로직» 복제는 0이었지만 순서가 두 벌이었고, 한쪽만 고치면
// 조용히 갈린다(92 §4-1이 이중 경로 때문에 처방을 집행 금지로 막은 전례).
// 하네스의 계기 50여 종은 물리 단계 «사이»에 끼어 있으므로, 순서를 6단계로 갈라
// 하네스가 단계를 부르고 그 사이에 계기를 넣게 한다. 순서는 여기 한 벌뿐이다.
//
// **코어는 계기를 «알지» 않는다.** 계기는 전부 `PatternDressObservers`의 불투명
// 콜백이고, 코어는 그것이 무엇을 하는지 모른 채 정해진 지점에서 부르기만 한다.
// 브라우저는 옵저버를 아예 넘기지 않는다(P2c부터 그렇게 돌고 있다).
//
// **env는 채널이다**(P2b (b) 등재분). 하네스가 env로 받던 물리 스위치는 전부
// `PatternDressOptions`에 있고 **기본값이 하네스의 「미설정」과 같다**.
import * as THREE from "three";
import { ArrayBvhCollision } from "./bvhFromArrays";
import { SelfCollision } from "./selfCollision";
import { FABRIC_PRESETS } from "./fabricPresets";
import { createGarmentSession, createPanelSplitResolver, createPatternUnifiedResolver, buildArmCapsules, makePatternSessionEnv } from "./garmentFrame";
import type { ArmShape } from "./garmentFrame";
import type { GarmentFrameEnv, GarmentSession } from "./garmentFrame";
import type { Capsule } from "./torsoCapsule";
import type { CollisionResolver } from "./clothPhysics";
import { runDressing } from "./dressingMachine";
import type { DressingResult } from "./dressingMachine";
import { createAnchorPinRamp, createRingLimitRamp, projectRingTotalLength } from "./patternDressHooks";
import { deriveBodySkeleton, nearestOnSegments } from "./bodySkeleton";
import { measureBody } from "./bodyMeasure";
import { buildPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT, PATTERN_EDGE_INTERIOR_M } from "./patternGarment";
import { makeOutlineProvider } from "./bodyOutline";
import { buildPatternSim } from "./buildPatternSim";
import { correctPlacementPenetration, countInside, countSelfIntersections, makeParityInside } from "./patternPlacement";
import { computeBodyCoverage } from "./coverageMetric";
import { bakePatternFrictionSdf } from "./sdfCollision";
import type { SdfField, PatternSdfBox } from "./sdfCollision";
import {
  COLLISION_DETECTION_RADIUS,
  COLLISION_MARGIN,
  SDF_FAR,
  SUBSTEP_DT,
  COLLAR_STRAIN_LIMIT,
} from "./clothConfig";

export interface PatternDressFixture {
  layout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  pose: {
    pinLeft: { x: number; y: number; z: number };
    pinRight: { x: number; y: number; z: number };
    // P10 §1 — `ArmShape`로 통일(종전 인라인 3필드와 동형 + 선택 `elbow`/`hand`).
    armLeft: ArmShape;
    armRight: ArmShape;
    fabric: keyof typeof FABRIC_PRESETS;
  };
  collision: {
    position: number[] | Float32Array;
    frontIndex: number[] | null;
    backIndex: number[] | null;
    wholeBodyIndex: number[] | null;
    capsules: Capsule[];
    centerZ: number;
  };
}

// 기본값 = `dressPattern.ts`의 env **미설정** 상태. 바꾸면 기준선 A와 비교 불가.
export interface PatternDressOptions {
  /** `RINGTOTAL` — false면 링 총 길이 상한 off(= 기준선 A의 `RINGTOTAL=0`). 기본 true. */
  ringTotal?: boolean;
  /** `MARGIN_ALL` — 정착 물리·배치 교정·배치 기하·제도 시접 공통. 기본 COLLISION_MARGIN. */
  marginAllM?: number;
  /** `MESHMARGIN` / `PLACEMARGIN` — 각각 정착 물리 / 배치 교정. 기본 marginAllM.
   *  `"self"`는 **값이 아니라 도출**이다(101 §1(a)): 옷↔몸 배제거리 ≡ 옷↔옷 배제거리
   *  ⟹ `g.selfCollisionMinDistM`. 메시가 바뀌면 따라 움직인다(손 상수 금지 · 함정 12). */
  meshMarginM?: number | "self";
  placeMarginM?: number;
  /** `TORSOCAP` 기본 false(45회차 승격) · `ARMCAP` 기본 true(94회차) · `SINGLE` 기본 true(42회차 처방 A). */
  torsoCap?: boolean;
  armCap?: boolean;
  singleDeepest?: boolean;
  /** `S0FIX` — 배치 관통 교정. 기본 true. */
  s0fix?: boolean;
  /** `SKELSIGN` — 마찰 SDF 부호 기준. 기본 false(radial). */
  skeletonSign?: boolean;
  /** `PINDRESS` — 착장 소프트 앵커. 기본 false. */
  pinDress?: boolean;
  /** `SECONDS` — 프레임 예산 = round(seconds × 60). 기본 25(= 1500프레임). */
  seconds?: number;
  /** `ADSORB_PENONLY` — 관통-only 흡착(49회차 P-α1 ablation). 기본 미적용. */
  penetrationAxis?: { enabled: boolean; x: number; z: number };
  /** `MAGNET` / `MAGNET_D0` — 국면1 가중(53·54회차). 기본 미적용. */
  magnet?: { w: () => number };
  /** `HEMBEND` — 밑단 대역 bend 강화 프로브(기본 미적용). 술어는 코어가 만든다
   *  (제도 총장에서 대역을 뜬다 — 하네스가 같은 식을 다시 적지 않게). */
  hemBend?: { raw: number; bandM: number };
  /** 옷 치수 override — **부분 지정**. 준 항목만 덮고 나머지는 fixture `layout`/`pose`에서
   *  도출한다(= 하네스와 같은 옷). 브라우저는 슬라이더가 «실제로 대응하는» 항목만 넘긴다:
   *  `shoulderWidthM`은 포즈 핀 간격(44.9995cm)에서 나오고 슬라이더 기본값 45cm와 다르므로
   *  넘기지 않는다 — 넘기면 기본 슬라이더에서 기준선 A가 깨진다(P3 §1). */
  garmentDims?: Partial<{ lengthM: number; widthM: number; shoulderWidthM: number; sleeveLengthM: number; sleeveWidthM: number }>;
  /** UI 진행 표시용. 물리에 관여하지 않는다. */
  onProgress?: (frame: number, state: string) => void;
}

/** 34게이트 누적치 한 쪽(몸판 또는 소매). 코어가 계산하고 계기가 인쇄한다. */
export interface RestGateAcc { n: number; max: number; maxAt: number; min: number; ext: number; comp: number }

// 계기가 물리 «사이»에 끼는 지점 전량. 코어는 이 콜백들이 무엇을 하는지 모른다.
// 브라우저는 하나도 넘기지 않는다.
export interface PatternDressObservers {
  /** 배치 교정 호출을 감싼다(전후 변위 계기). 넘기지 않으면 코어가 그냥 부른다. */
  wrapPlaceCorrect?: (label: string, positions: Float32Array, run: () => number) => void;
  /** 충돌 리졸버를 감싼다(패스 경계 프로브). */
  wrapResolver?: (r: CollisionResolver) => CollisionResolver;
  /** 서브스텝 안 패스 경계 프로브(env.probe). */
  probe?: (label: string) => void;
  onCollarFired?: (count: number) => void;
  /** 34게이트 실측치 — throw «전»에 부른다(위반해도 두 줄은 찍힌다). */
  onRestGate?: (label: string, tol: number, torso: RestGateAcc, sleeve: RestGateAcc) => void;
  /** `place` 훅 끝(RETRY 재배치 직후). */
  onPlaced?: (scale: number) => void;
  onAnchorToggle?: (hard: boolean) => void;
  onRingClose?: (frame: number, limitStart: number, maxBeforeCloseM: number) => void;
  /** 링 전용 상한을 그 프레임 값으로 갱신한 «직후». 계기가 같은 값을 인용한다. */
  onRingLimit?: (frame: number, limit: number) => void;
  onAnchorStrength?: (s: number) => void;
  beforeStep?: (frame: number, state: string) => void;
  /** onFrame 전반 — **링 총 길이 투영 전**. */
  onFrameBeforeProject?: (frame: number, state: string) => void;
  /** onFrame 후반 — 투영 후, Δ 기록 전. */
  onFrameAfterProject?: (frame: number, state: string) => void;
  /** 프레임 최대 변위와 그 정점(Δ20 판정의 원자료). */
  onDelta?: (frame: number, maxDeltaM: number, atVertex: number) => void;
  stateNote?: () => string;
}

/**
 * P8 — **부위별 핏**. 값은 `signedClearance`(옷 정점 → 몸 표면 부호거리)이고,
 * 하네스의 53계기b(`phaseStat`)가 쓰는 것과 **같은 원자료·같은 국면 경계**다.
 * 새 물리 0줄 · 새 술어 0 — 정착 «후» 1회 읽는다.
 */
export interface FitBand {
  /** 부위 이름(목선 · 가슴 · 허리 · 밑단). */
  name: string;
  /** 유효 표본 / 정의역 크기. `signedClearance`가 null이면 탈락한다(97 §1 결함 A). */
  n: number;
  domain: number;
  /** 간극 분위수(mm). 표본 0이면 NaN. */
  p25Mm: number; medianMm: number; p75Mm: number;
  /** 국면 3분할 — 경계는 흡착 margin 그 자체다(물리가 껍질 목표로 쓰는 거리). */
  touchN: number;
  snugN: number;
  looseN: number;
}

export interface PatternDressMetrics {
  covPct: number;
  covExposed: number;
  covTotal: number;
  maxStrain: number;
  maxStrainAt: number;
  maxSeamGapMm: number;
  delta20Mm: number;
  selfIntersections: number;
  insideCount: number;
  insideTotal: number;
  ringLenCm: number;
  hemFrontCm: number;
  hemBackCm: number;
  /** P8 핏 리포트. 국면 경계(mm)를 함께 실어 **화면이 문턱을 스스로 밝히게** 한다. */
  fit: { marginMm: number; bands: FitBand[] };
}

export interface PatternDressResult {
  ok: boolean;
  /** 실패 사유(34게이트 throw 포함). ok=true면 null. */
  error: string | null;
  state: string;
  frames: number;
  retry: number;
  elapsedMs: number;
  positions: Float32Array;
  panelStarts: number[];
  panelCounts: number[];
  panelTriRanges: { start: number; count: number }[];
  tris: Uint32Array;
  uv: Float32Array;
  seams: { a: number; b: number }[];
  metrics: PatternDressMetrics | null;
}

type Vec3 = { x: number; y: number; z: number };

const HEM_STRICT = 1e-9;
const RAMP_FRAMES = 120;
/** 링 전용 상한 램프 길이(21회차). 하네스 인쇄가 이 값을 인용한다. */
export const RING_LIMIT_RAMP_FRAMES = 120;

type Garment = ReturnType<typeof buildPatternGarment>;
type PatternSim = ReturnType<typeof buildPatternSim>;

export interface StageBody {
  position: Float32Array;
  torsoIndex: Uint32Array;
  wholeIndex: Uint32Array | null;
  frontIdx: Uint32Array | null;
  backIdx: Uint32Array | null;
  hemY: number;
  centerX: number;
  arms: readonly [PatternDressFixture["pose"]["armLeft"], PatternDressFixture["pose"]["armRight"]];
  skeleton: ReturnType<typeof deriveBodySkeleton>;
  body: ReturnType<typeof measureBody>;
  marginAllM: number;
}
/** 해소된 옷 치수(전 항목 필수). */
export interface GarmentDimsResolved {
  lengthM: number; widthM: number; shoulderWidthM: number; sleeveLengthM: number; sleeveWidthM: number;
}

export interface StageGarment {
  garmentDims: GarmentDimsResolved;
  outlineTorso: ArrayBvhCollision;
  outlineWhole: ArrayBvhCollision;
  g: Garment;
  total: number;
}
/** 몸 BVH·패리티·교정 제외 엣지. 배치 교정 «전»에 계기가 읽는다. */
export interface StageMesh {
  wholeMesh: ArrayBvhCollision;
  insideParity: ReturnType<typeof makeParityInside>;
  skipKeys: Set<number>;
}
export interface StagePlace {
  penBefore: number;
  corrected: number;
  penAfter: number;
}
export interface StageSim {
  preset: (typeof FABRIC_PRESETS)[keyof typeof FABRIC_PRESETS];
  ps: PatternSim;
  sim: PatternSim["sim"];
  ringJoinPairs: Garment["seams"];
  ringClosed: { a: number; b: number }[];
  ringVertexList: number[];
  ringLenM: () => number;
  ringRestConfirmedM: number;
  ringRestM: number;
  headGirthM: number;
  ringTotalMaxM: number;
}
export interface StageCollide {
  frontMesh: ArrayBvhCollision;
  backMesh: ArrayBvhCollision;
  armCapsules: Capsule[];
  meshResolver: CollisionResolver;
  unified: CollisionResolver;
  sdfField: SdfField;
  sdfBox: PatternSdfBox;
  selfCollision: CollisionResolver;
}
/** 앵커 목표 + 34게이트. 세션 조립 «전»에 계기가 읽는다. */
export interface StageAnchors {
  anchorList: { i: number; x: number; y: number; z: number; s: number; sign: number }[];
  placementRestGate: (label: string) => void;
}
export interface StageSession {
  env: GarmentFrameEnv;
  ringRamp: ReturnType<typeof createRingLimitRamp>;
  /** `session.step()` 인자 — 정착 «후» ablation을 도는 계기가 같은 값을 써야 한다. */
  frameLayout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  framePose: { pinLeft: Vec3; pinRight: Vec3; armLeft: PatternDressFixture["pose"]["armLeft"]; armRight: PatternDressFixture["pose"]["armRight"] };
  session: GarmentSession;
  anchorRamp: ReturnType<typeof createAnchorPinRamp>;
  maxSeamGapM: () => number;
  maxDelta20Mm: () => number;
  diverged: () => boolean;
  countPenetrating: () => number;
  rampFrames: number;
}

export interface StageMargins { meshMarginM: number; placeMarginM: number }

export interface PatternDressing {
  opts: Required<Pick<PatternDressOptions, "ringTotal" | "s0fix" | "pinDress">> & PatternDressOptions;
  body: () => StageBody;
  garment: () => StageGarment;
  /** margin 2채널 — `place()`보다 먼저 인쇄해야 하는 계기가 있어 따로 뗀다(값 도출은 한 곳). */
  margins: () => StageMargins;
  /** 몸 BVH·패리티·skipKeys. `place()`가 좌표를 고치기 **전** 상태다. */
  mesh: () => StageMesh;
  place: () => StagePlace;
  sim: () => StageSim;
  collide: () => StageCollide;
  /** 앵커 목표·34게이트. `session()`보다 먼저 계기가 검증 인쇄를 한다. */
  anchors: () => StageAnchors;
  session: () => StageSession;
  run: () => DressingResult;
  /** 링 총 길이 투영 발화 누적(계기 인쇄용). */
  ringTotalFired: () => number;
  /** 대조 채널 9종. `run()` 뒤에 부른다. */
  metrics: () => PatternDressMetrics;
  frames: number;
  t0: number;
}

/**
 * 물리 호출 순서를 6단계로 노출한다. 각 단계는 **한 번만** 돌고(메모) 앞 단계를
 * 알아서 부른다 — 순서를 호출자가 재정의할 수 없다. 하네스는 단계 사이에 계기를 넣고,
 * 브라우저는 `runPatternDressing`으로 전부 이어 돌린다.
 */
export function createPatternDressing(
  fixture: PatternDressFixture,
  opts: PatternDressOptions = {},
  obs: PatternDressObservers = {},
): PatternDressing {
  const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
  const ringTotalOn = opts.ringTotal ?? true;
  const marginAllM = opts.marginAllM ?? COLLISION_MARGIN;
  const placeMarginM = opts.placeMarginM ?? marginAllM;
  const s0fix = opts.s0fix ?? true;
  const pinDress = opts.pinDress ?? false;
  const FRAMES = Math.round((opts.seconds ?? 25) * 60);
  const { layout, pose, collision } = fixture;

  let _body: StageBody | null = null;
  let _garment: StageGarment | null = null;
  let _place: StagePlace | null = null;
  let _sim: StageSim | null = null;
  let _collide: StageCollide | null = null;
  let _session: StageSession | null = null;
  let _result: DressingResult | null = null;

  const body = (): StageBody => {
    if (_body) return _body;
    const position = collision.position instanceof Float32Array ? collision.position : Float32Array.from(collision.position);
    const torsoIndex = Uint32Array.from([...(collision.frontIndex ?? []), ...(collision.backIndex ?? [])]);
    const wholeIndex = collision.wholeBodyIndex ? Uint32Array.from(collision.wholeBodyIndex) : null;
    const frontIdx = collision.frontIndex ? Uint32Array.from(collision.frontIndex) : null;
    const backIdx = collision.backIndex ? Uint32Array.from(collision.backIndex) : null;
    const hemY = collision.capsules[collision.capsules.length - 1].bottom.y;
    const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
    const arms = [pose.armLeft, pose.armRight] as const;
    const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemY);
    const measured = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, collision.centerZ, marginAllM);
    _body = { position, torsoIndex, wholeIndex, frontIdx, backIdx, hemY, centerX, arms, skeleton, body: measured, marginAllM };
    return _body;
  };

  const garment = (): StageGarment => {
    if (_garment) return _garment;
    const b = body();
    const garmentDims: GarmentDimsResolved = {
      lengthM: layout.heightM,
      widthM: layout.widthM,
      shoulderWidthM: Math.abs(pose.pinLeft.x - pose.pinRight.x),
      sleeveLengthM: Math.max(pose.armLeft.length, pose.armRight.length),
      sleeveWidthM: layout.sleeveWidthM,
      ...opts.garmentDims,
    };
    const outlineTorso = new ArrayBvhCollision();
    outlineTorso.rebuild(b.position, b.torsoIndex);
    const outlineWhole = new ArrayBvhCollision();
    outlineWhole.rebuild(b.position, b.wholeIndex ?? b.torsoIndex);
    const outlineAt = makeOutlineProvider(
      outlineTorso, outlineWhole,
      (h) => { const sl = b.body.slices.reduce((q, s2) => (Math.abs(s2.y - h) < Math.abs(q.y - h) ? s2 : q), b.body.slices[0]); return [sl.axisX, sl.axisZ]; },
      PATTERN_EDGE_INTERIOR_M,
    );
    const g = buildPatternGarment(b.body, garmentDims, b.arms, outlineAt, undefined, marginAllM);
    _garment = { garmentDims, outlineTorso, outlineWhole, g, total: g.panelCounts.reduce((x, y) => x + y, 0) };
    return _garment;
  };

  let _margins: StageMargins | null = null;
  const margins = (): StageMargins => {
    if (_margins) return _margins;
    const { g } = garment();
    _margins = {
      meshMarginM: opts.meshMarginM === "self" ? g.selfCollisionMinDistM : (opts.meshMarginM ?? marginAllM),
      placeMarginM,
    };
    return _margins;
  };

  let _mesh: StageMesh | null = null;
  const mesh = (): StageMesh => {
    if (_mesh) return _mesh;
    const b = body();
    const { g } = garment();
    const wholeMesh = new ArrayBvhCollision();
    wholeMesh.rebuild(b.position, b.wholeIndex);
    const insideParity = makeParityInside(wholeMesh);
    const skipKeys = new Set<number>();
    for (const e of [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))]) {
      skipKeys.add(Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b));
    }
    _mesh = { wholeMesh, insideParity, skipKeys };
    return _mesh;
  };

  const place = (): StagePlace => {
    if (_place) return _place;
    const { g, total } = garment();
    const m = mesh();
    const penBefore = countInside(g.positions, total, m.insideParity);
    let corrected = 0;
    if (s0fix) {
      const run = (): number => (corrected = correctPlacementPenetration(
        g.positions, total, m.wholeMesh, m.insideParity, placeMarginM, g.selfCollisionMinDistM, m.skipKeys, SDF_FAR,
      ));
      if (obs.wrapPlaceCorrect) obs.wrapPlaceCorrect("S0 배치", g.positions, run); else run();
    }
    const penAfter = countInside(g.positions, total, m.insideParity);
    _place = { penBefore, corrected, penAfter };
    return _place;
  };

  const simStage = (): StageSim => {
    if (_sim) return _sim;
    const b = body();
    const { g } = garment();
    place();
    const preset = FABRIC_PRESETS[pose.fabric];
    const hemBendProbe = opts.hemBend
      ? {
          raw: opts.hemBend.raw,
          is: (x: number, y: number): boolean => {
            const lo = g.draft.dims.lengthM - opts.hemBend!.bandM;
            const ya = x < g.panelStarts[2] ? g.pos2[x * 2 + 1] : -1;
            const yb = y < g.panelStarts[2] ? g.pos2[y * 2 + 1] : -1;
            return ya > lo && yb > lo; // 양 끝이 다 대역 안일 때만(경계 걸침 제외)
          },
        }
      : undefined;
    const ps = buildPatternSim(g, preset.iterations, false, hemBendProbe);
    const sim = ps.sim;
    // 링 폐곡선화 + 접합 rest 심기(25회차). `setCollarRing`이 현재 좌표에서 rest를 뜨므로
    // 접합 2쌍만 시접 target 거리로 잠깐 옮겼다 되돌린다(clothPhysics 무수정).
    const ringVertsSet = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
    const ringJoinPairs = g.seams.filter((sm) => sm.kind === "shoulder" && ringVertsSet.has(sm.a) && ringVertsSet.has(sm.b));
    const ringClosed = [...g.necklineRing, ...ringJoinPairs.map((sm) => ({ a: sm.a, b: sm.b }))];
    {
      const joinRestM = Math.max(...g.seams.map((sm) => sm.targetM));
      const saved = ringJoinPairs.map((sm) => [sim.positions[sm.b * 3], sim.positions[sm.b * 3 + 1], sim.positions[sm.b * 3 + 2]] as [number, number, number]);
      for (const sm of ringJoinPairs) {
        const dx = sim.positions[sm.b * 3] - sim.positions[sm.a * 3];
        const dy = sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1];
        const dz = sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2];
        const l = Math.hypot(dx, dy, dz) || 1;
        sim.positions[sm.b * 3] = sim.positions[sm.a * 3] + (dx / l) * joinRestM;
        sim.positions[sm.b * 3 + 1] = sim.positions[sm.a * 3 + 1] + (dy / l) * joinRestM;
        sim.positions[sm.b * 3 + 2] = sim.positions[sm.a * 3 + 2] + (dz / l) * joinRestM;
      }
      sim.setCollarRing(ringClosed);
      ringJoinPairs.forEach((sm, k) => {
        sim.positions[sm.b * 3] = saved[k][0];
        sim.positions[sm.b * 3 + 1] = saved[k][1];
        sim.positions[sm.b * 3 + 2] = saved[k][2];
      });
    }
    const ringLenM = (): number => {
      let l = 0;
      for (const e of g.necklineRing) {
        l += Math.hypot(
          sim.positions[e.b * 3] - sim.positions[e.a * 3],
          sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1],
          sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2],
        );
      }
      return l;
    };
    const ringRestConfirmedM = ringLenM();
    const ringRestM = ringRestConfirmedM + 2 * Math.max(...g.seams.map((sm) => sm.targetM));
    const headGirthM = b.body.slices.reduce((m, sl) => (sl.y > b.body.neckY && sl.girthM > m ? sl.girthM : m), 0);
    _sim = {
      preset, ps, sim, ringJoinPairs, ringClosed,
      ringVertexList: [...new Set<number>(ringClosed.flatMap((e) => [e.a, e.b]))],
      ringLenM, ringRestConfirmedM, ringRestM, headGirthM,
      ringTotalMaxM: ringTotalOn ? headGirthM : 0,
    };
    return _sim;
  };

  const collide = (): StageCollide => {
    if (_collide) return _collide;
    const b = body();
    const { g } = garment();
    place();
    simStage();
    const frontMesh = new ArrayBvhCollision();
    const backMesh = new ArrayBvhCollision();
    frontMesh.rebuild(b.position, b.frontIdx);
    backMesh.rebuild(b.position, b.backIdx);
    const armCapsules = [...buildArmCapsules(pose.armLeft), ...buildArmCapsules(pose.armRight)];
    const meshResolver = createPanelSplitResolver(
      [
        frontMesh.createResolver(margins().meshMarginM, COLLISION_DETECTION_RADIUS, undefined, undefined, undefined, opts.penetrationAxis, opts.magnet),
        backMesh.createResolver(margins().meshMarginM, COLLISION_DETECTION_RADIUS, undefined, undefined, undefined, opts.penetrationAxis, opts.magnet),
        null,
        null,
      ],
      g.panelCounts,
    );
    const unified = createPatternUnifiedResolver(
      meshResolver, g.panelCounts, collision.capsules, armCapsules,
      { torsoCap: opts.torsoCap, armCap: opts.armCap, singleDeepest: opts.singleDeepest, torsoPanels: [PANEL_PAT_FRONT, PANEL_PAT_BACK] },
    );
    const { field: sdfField, box: sdfBox } = bakePatternFrictionSdf(
      mesh().wholeMesh, b.skeleton.segments, b.position, layout.topY, b.hemY, { skeletonSign: opts.skeletonSign },
    );
    const selfCollision = new SelfCollision(
      [...g.panelStarts], [...g.panelCounts], 0,
      [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))],
      g.selfCollisionMinDistM, 0,
    ).createResolver(g.selfCollisionMinDistM);
    _collide = { frontMesh, backMesh, armCapsules, meshResolver, unified, sdfField, sdfBox, selfCollision };
    return _collide;
  };

  // 하네스가 계기에서 쓰는 상태. 코어가 소유한다(물리 흐름의 일부).
  let gateArmed = true;
  let ringTotalFired = 0;
  const deltaHist: number[] = [];
  let prevFrame: Float32Array | null = null;

  let _anchors: StageAnchors | null = null;
  const anchors = (): StageAnchors => {
    if (_anchors) return _anchors;
    const b = body();
    const { g, total } = garment();
    place();
    const sim = simStage().sim;

    // 앵커 목표 = 어깨 능선 호장 비율 매핑(6회차) + 표면 위 margin(20회차).
    const ringVertsSet = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
    const anchorList = (() => {
      const nwHalf = g.draft.dims.neckHalfWidthM;
      const sideCurve = (sign: number): { p: { x: number; y: number; z: number }; cum: number }[] => {
        const pts = b.body.ridgePoints
          .filter((r) => Math.sign(r.x - b.body.centerX) === sign && Math.abs(r.x - b.body.centerX) >= nwHalf)
          .sort((x, y) => Math.abs(x.x - b.body.centerX) - Math.abs(y.x - b.body.centerX));
        const out: { p: { x: number; y: number; z: number }; cum: number }[] = [];
        let cum = 0;
        for (let i = 0; i < pts.length; i++) {
          if (i > 0) cum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
          out.push({ p: { x: pts[i].x, y: pts[i].y, z: pts[i].z }, cum });
        }
        return out;
      };
      const curves = new Map<number, { p: { x: number; y: number; z: number }; cum: number }[]>([[1, sideCurve(1)], [-1, sideCurve(-1)]]);
      const at = (sign: number, sv: number): { x: number; y: number; z: number } => {
        const cv = curves.get(sign)!;
        const tot = cv[cv.length - 1].cum;
        const target = tot * Math.min(1, Math.max(0, sv));
        for (let i = 1; i < cv.length; i++) {
          if (cv[i].cum >= target) {
            const t = (target - cv[i - 1].cum) / Math.max(1e-9, cv[i].cum - cv[i - 1].cum);
            return {
              x: cv[i - 1].p.x + (cv[i].p.x - cv[i - 1].p.x) * t,
              y: cv[i - 1].p.y + (cv[i].p.y - cv[i - 1].p.y) * t,
              z: cv[i - 1].p.z + (cv[i].p.z - cv[i - 1].p.z) * t,
            };
          }
        }
        return cv[cv.length - 1].p;
      };
      const shoulderSeamM = g.draft.dims.shoulderSeamM;
      return g.seams
        .filter((sm) => sm.kind === "shoulder")
        .filter((sm) => !(ringVertsSet.has(sm.a) || ringVertsSet.has(sm.b)))
        .map((sm) => {
          const px = g.pos2[sm.a * 2], py = g.pos2[sm.a * 2 + 1];
          const sv = Math.hypot(Math.abs(px) - nwHalf, py) / Math.max(1e-9, shoulderSeamM);
          const t = at(Math.sign(px) || 1, sv);
          return { i: sm.a, x: t.x, y: t.y + COLLISION_MARGIN, z: t.z, s: sv, sign: Math.sign(px) || 1 };
        });
    })();

    // ── 34게이트(영구) — **배치는 rest를 보존해야 한다.** throw로 실행을 끊는 물리다.
    // 허용분은 결과에 맞춘 값이 아니라 **저장 형식**(float32 좌표 / 최단 rest)에서 도출한다.
    const F32_HALF_ULP = Math.pow(2, -24);
    const seamKeySet = new Set<number>(g.seams.map((x) => Math.min(x.a, x.b) * 1_000_000 + Math.max(x.a, x.b)));
    const placementRestGate = (label: string): void => {
      let maxCoord = 0, minRest = Infinity;
      for (let i = 0; i < total * 3; i++) maxCoord = Math.max(maxCoord, Math.abs(sim.positions[i]));
      for (const cst of sim.constraintPairs) if (cst.restLength > 0 && cst.restLength < minRest) minRest = cst.restLength;
      const tol = (2 * maxCoord * F32_HALF_ULP) / minRest;
      const acc = {
        torso: { n: 0, max: 1, maxAt: -1, min: 1, ext: 0, comp: 0 },
        sleeve: { n: 0, max: 1, maxAt: -1, min: 1, ext: 0, comp: 0 },
      };
      for (const cst of sim.constraintPairs) {
        if (cst.restLength <= 0) continue;
        if (seamKeySet.has(Math.min(cst.a, cst.b) * 1_000_000 + Math.max(cst.a, cst.b))) continue;
        const dd = Math.hypot(
          sim.positions[cst.b * 3] - sim.positions[cst.a * 3],
          sim.positions[cst.b * 3 + 1] - sim.positions[cst.a * 3 + 1],
          sim.positions[cst.b * 3 + 2] - sim.positions[cst.a * 3 + 2],
        );
        const t = cst.a < g.panelStarts[2] ? acc.torso : acc.sleeve;
        const r = dd / cst.restLength;
        t.n++;
        if (r > t.max) { t.max = r; t.maxAt = cst.a; }
        if (r < t.min) t.min = r;
        if (dd > cst.restLength) t.ext += dd - cst.restLength; else t.comp += cst.restLength - dd;
      }
      obs.onRestGate?.(label, tol, acc.torso, acc.sleeve);
      if (acc.torso.max - 1 > tol || 1 - acc.torso.min > tol) {
        throw new Error(
          `배치 실패 — 34게이트 위반 ${label}: 몸판 신장비 ${acc.torso.min.toFixed(6)}~${acc.torso.max.toFixed(6)} (문턱 1.000000±${tol.toExponential(2)} · 값=뒤판 32회차 실측, 허용분=float32 저장 정밀도에서 도출) · 신장총 ${(acc.torso.ext * 100).toFixed(1)}cm`,
        );
      }
    };

    _anchors = { anchorList, placementRestGate };
    return _anchors;
  };

  const session = (): StageSession => {
    if (_session) return _session;
    const { g, total } = garment();
    const s = simStage();
    const c = collide();
    const sim = s.sim;
    const { anchorList, placementRestGate } = anchors();

    const maxDelta20Mm = (): number => (deltaHist.length ? Math.max(...deltaHist.slice(-20)) : Infinity);
    const maxSeamGapM = (): number => {
      let m = 0;
      for (const sm of g.seams) {
        const d = Math.hypot(
          sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
          sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
          sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
        );
        if (d > m) m = d;
      }
      return m;
    };
    const diverged = (): boolean => {
      for (let i = 0; i < sim.positions.length; i++) {
        const v = sim.positions[i];
        if (!Number.isFinite(v) || Math.abs(v) > 100) return true;
      }
      return false;
    };
    const countPenetrating = (): number => countInside(sim.positions, total, mesh().insideParity);

    const env = makePatternSessionEnv({
      collisionResolver: obs.wrapResolver ? obs.wrapResolver(c.unified) : c.unified,
      selfCollision: c.selfCollision,
      sdfField: () => c.sdfField,
      anchors: () => (pinDress ? anchorList : []),
      collarStrainLimit: COLLAR_STRAIN_LIMIT,
      pinStrength: 0,
      probe: obs.probe,
      onCollarFired: obs.onCollarFired,
    });
    const sessionObj = createGarmentSession(sim, env);
    const anchorRamp = createAnchorPinRamp(sim, anchorList, RAMP_FRAMES, {
      // 지연 위임 — 하네스가 이 콜백을 세션 조립 «뒤»에 붙일 수 있다(구성 시점 포획 금지).
      onToggle: (hard) => obs.onAnchorToggle?.(hard),
      onFirstRamp: () => { if (gateArmed) { gateArmed = false; placementRestGate("(ii) 핀 발화 직후"); } },
    });
    prevFrame = new Float32Array(sim.positions.length);
    prevFrame.set(sim.positions);
    _session = {
      env, session: sessionObj, anchorRamp,
      frameLayout: { widthM: layout.widthM, heightM: garment().garmentDims.lengthM, topY: layout.topY, centerZ: collision.centerZ, sleeveWidthM: layout.sleeveWidthM },
      framePose: { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft: pose.armLeft, armRight: pose.armRight },
      ringRamp: createRingLimitRamp(COLLAR_STRAIN_LIMIT, s.ringRestM, RING_LIMIT_RAMP_FRAMES, (f, st, mb) => obs.onRingClose?.(f, st, mb)),
      maxSeamGapM, maxDelta20Mm, diverged, countPenetrating, rampFrames: RAMP_FRAMES,
    };
    return _session;
  };

  const run = (): DressingResult => {
    if (_result) return _result;
    const b = body();
    const { g, total } = garment();
    place();
    const s = simStage();
    const se = session();
    const sim = s.sim;
    const gravity = new THREE.Vector3(0, -9.81, 0);
    void b;

    // 게이트 (i) — **진짜 배치 직후 · 핀 발화 전.** 상태기계의 첫 setAnchorHard는
    // 루프 안(S1 분기)에 있고 그건 이미 핀이 돈 뒤다. 여기가 유일한 "핀 전" 시점이다.
    anchors().placementRestGate("(i) 진짜 배치 직후 · 핀 발화 전");
    _result = runDressing(
      sim, se.session, g.seams.map((x) => ({ a: x.a, b: x.b, target: x.targetM, kind: x.kind })),
      { rampFrames: RAMP_FRAMES, stallFrames: 60, seamSlackM: 0.01, settleDeltaMm: 5.6, settleFrames: 20, budget: { S0: 1, S1: 240, S2: 120, S3: 720 } },
      {
        place: (scale) => {
          g.place(scale);
          const runFix = (): number => correctPlacementPenetration(
            g.positions, total, mesh().wholeMesh, mesh().insideParity, placeMarginM, g.selfCollisionMinDistM, mesh().skipKeys, SDF_FAR,
          );
          const label = `재배치(오프셋 배수 ${scale.toFixed(2)})`;
          if (obs.wrapPlaceCorrect) obs.wrapPlaceCorrect(label, g.positions, runFix); else runFix();
          for (let i = 0; i < total; i++) sim.setParticle(i, g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
          anchors().placementRestGate(`(i) 재배치 직후 · 핀 발화 전 (오프셋 배수 ${scale.toFixed(2)})`);
          // 재배치가 좌표를 배치 상태로 되돌렸다 → 다음 핀 발화는 다시 "배치 직후"다
          gateArmed = true;
          obs.onPlaced?.(scale);
        },
        countPenetrating: se.countPenetrating,
        diverged: se.diverged,
        maxSeamGapM: se.maxSeamGapM,
        maxDelta20Mm: se.maxDelta20Mm,
        setAnchorHard: se.anchorRamp.setAnchorHard,
        beforeStep: (frame, state) => {
          obs.beforeStep?.(frame, state);
          const lim = se.ringRamp.update(frame, state, s.ringLenM());
          (se.env as { collarStrainLimit?: number }).collarStrainLimit = lim;
          obs.onRingLimit?.(frame, lim);
        },
        stateNote: obs.stateNote,
        onFrame: (frame, state) => {
          obs.onFrameBeforeProject?.(frame, state);
          if (projectRingTotalLength(sim, s.ringVertexList, s.ringLenM(), s.ringTotalMaxM)) ringTotalFired++;
          obs.onFrameAfterProject?.(frame, state);
          let md = 0, mi = -1;
          for (let i = 0; i < sim.positions.length; i += 3) {
            const d = Math.hypot(sim.positions[i] - prevFrame![i], sim.positions[i + 1] - prevFrame![i + 1], sim.positions[i + 2] - prevFrame![i + 2]);
            if (d > md) { md = d; mi = i / 3; }
          }
          deltaHist.push(md * 1000);
          obs.onDelta?.(frame, md, mi);
          prevFrame!.set(sim.positions);
          opts.onProgress?.(frame, state);
        },
      },
      () => ({ dt: SUBSTEP_DT, gravity, preset: s.preset, layout: se.frameLayout, pose: se.framePose }),
      FRAMES, t0,
      (sv) => { (se.env as { pinStrength?: number }).pinStrength = sv; obs.onAnchorStrength?.(sv); },
    );
    return _result;
  };

  const metrics = (): PatternDressMetrics => {
    const b = body();
    const { g, total } = garment();
    place();
    const s = simStage();
    const se = session();
    const sim = s.sim;
    const clothTris = new Float32Array(g.tris.length * 3);
    for (let t = 0; t < g.tris.length; t++) {
      const v = g.tris[t];
      clothTris[t * 3] = sim.positions[v * 3];
      clothTris[t * 3 + 1] = sim.positions[v * 3 + 1];
      clothTris[t * 3 + 2] = sim.positions[v * 3 + 2];
    }
    const gridView = { positions: sim.positions, panelDims: sim.panelDims, index: (pi: number, x: number, y: number) => sim.index(pi, x, y) };
    const neckCenter = { x: b.centerX, y: b.body.neckY, z: collision.centerZ };
    const hemWorldY = g.draft.dims.ridgeAnchorY - g.draft.dims.lengthM;
    const armMask = (() => {
      const n = b.position.length / 3;
      const mask = new Uint8Array(n).fill(1);
      const armSet = new Set(b.skeleton.arms);
      for (let v = 0; v < n; v++) {
        const near = nearestOnSegments(b.position[v * 3], b.position[v * 3 + 1], b.position[v * 3 + 2], b.skeleton.segments);
        if (armSet.has(near.segment)) mask[v] = 0;
      }
      return mask;
    })();
    const cov = computeBodyCoverage(
      b.position, [b.frontIdx, b.backIdx], gridView, [],
      { yMin: hemWorldY, yMax: b.body.shoulderJointY, neckCenter, neckRadius: 0.12, centerX: b.centerX, centerZ: collision.centerZ, sampleMask: armMask },
      clothTris,
    );
    let maxStrain = 0, maxStrainAt = -1;
    for (const cst of sim.constraintPairs) {
      if (cst.restLength <= 0) continue;
      const d = Math.hypot(
        sim.positions[cst.b * 3] - sim.positions[cst.a * 3],
        sim.positions[cst.b * 3 + 1] - sim.positions[cst.a * 3 + 1],
        sim.positions[cst.b * 3 + 2] - sim.positions[cst.a * 3 + 2],
      );
      if (d / cst.restLength > maxStrain) { maxStrain = d / cst.restLength; maxStrainAt = cst.a; }
    }
    const lenM = g.draft.dims.lengthM;
    const strict: number[] = [];
    for (let i = 0; i < g.panelStarts[2]; i++) if (Math.abs(g.pos2[i * 2 + 1] - lenM) < HEM_STRICT + 1e-6) strict.push(i);
    const chainOf = (lo: number, hi: number): number[] => strict.filter((i) => i >= lo && i < hi).sort((x, y) => g.pos2[x * 2] - g.pos2[y * 2]);
    const chainLen = (idx: number[]): number => {
      let l = 0;
      for (let k = 1; k < idx.length; k++) {
        const a = idx[k - 1], bb = idx[k];
        l += Math.hypot(
          sim.positions[bb * 3] - sim.positions[a * 3],
          sim.positions[bb * 3 + 1] - sim.positions[a * 3 + 1],
          sim.positions[bb * 3 + 2] - sim.positions[a * 3 + 2],
        );
      }
      return l;
    };
    // ── P8 — 부위별 핏. `signedClearance`는 **몸통 메시**(앞/뒤)만 본다.
    // 소매 정점은 그 메시에서 `excludeArms`로 지워진 팔 대역을 향하므로 **잴 수 없다** —
    // 부위에서 제외했고 그 사실은 P8 문서가 진다.
    const c2 = collide();
    const dOf = (i: number): number | null => {
      const mesh = i < g.panelStarts[1] ? c2.frontMesh : c2.backMesh;
      return mesh.signedClearance(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR);
    };
    const fitMarginM = margins().meshMarginM;
    const bandOf = (name: string, idx: readonly number[]): FitBand => {
      const raw = idx.map(dOf);
      const v = raw.filter((q): q is number => q !== null).sort((x, y) => x - y);
      const qt = (f: number): number => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] * 1000 : NaN);
      return {
        name, n: v.length, domain: raw.length,
        p25Mm: qt(0.25), medianMm: qt(0.5), p75Mm: qt(0.75),
        touchN: v.filter((x) => x <= 0).length,
        snugN: v.filter((x) => x > 0 && x <= fitMarginM).length,
        looseN: v.filter((x) => x > fitMarginM).length,
      };
    };
    // 대역은 **몸에서 뜬다**(새 손 상수 0). 폭 ±2.5cm는 하네스 101 §2-2 가슴 대역과 같은 값이고
    // 근거는 `bodyMeasure` 슬라이스 간격(1cm)이다.
    const FIT_HALF_M = 0.025;
    const bandByY = (cy: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i < g.panelStarts[2]; i++) {
        const y = sim.positions[i * 3 + 1];
        if (y >= cy - FIT_HALF_M && y <= cy + FIT_HALF_M) out.push(i);
      }
      return out;
    };
    const ringIdx = [...new Set(g.necklineRing.flatMap((e) => [e.a, e.b]))];
    const hemIdx = [...chainOf(0, g.panelStarts[1]), ...chainOf(g.panelStarts[1], g.panelStarts[2])];

    return {
      fit: {
        marginMm: fitMarginM * 1000,
        bands: [
          bandOf("목선", ringIdx),
          bandOf("가슴", bandByY(b.body.chestY)),
          bandOf("허리", bandByY(b.body.waistY)),
          bandOf("밑단", hemIdx),
        ],
      },
      covPct: 100 * cov.exposedRatio,
      covExposed: cov.exposed,
      covTotal: cov.samples,
      maxStrain,
      maxStrainAt,
      maxSeamGapMm: se.maxSeamGapM() * 1000,
      delta20Mm: se.maxDelta20Mm(),
      selfIntersections: countSelfIntersections(sim.positions, g.tris, g.edgePairs, 0.03, 1_000_000).count,
      insideCount: countInside(sim.positions, total, mesh().insideParity),
      insideTotal: total,
      ringLenCm: s.ringLenM() * 100,
      hemFrontCm: chainLen(chainOf(0, g.panelStarts[1])) * 100,
      hemBackCm: chainLen(chainOf(g.panelStarts[1], g.panelStarts[2])) * 100,
    };
  };

  return {
    opts: { ...opts, ringTotal: ringTotalOn, s0fix, pinDress },
    body, garment, margins, mesh, place, sim: simStage, collide, anchors, session, run, metrics,
    ringTotalFired: () => ringTotalFired,
    frames: FRAMES, t0,
  };
}

/** 브라우저·워커용 — 단계를 전부 이어 돌린다(계기 0). */
export function runPatternDressing(fixture: PatternDressFixture, opts: PatternDressOptions = {}): PatternDressResult {
  const d = createPatternDressing(fixture, opts);
  const t0 = d.t0;
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);
  const shell = (): Omit<PatternDressResult, "ok" | "error" | "state" | "frames" | "retry" | "metrics"> => {
    const { g } = d.garment();
    return {
      elapsedMs: now() - t0,
      positions: d.sim().sim.positions.slice(),
      panelStarts: [...g.panelStarts],
      panelCounts: [...g.panelCounts],
      panelTriRanges: g.panelTriRanges.map((r) => ({ start: r.start, count: r.count })),
      tris: Uint32Array.from(g.tris),
      uv: Float32Array.from(g.uv),
      seams: g.seams.map((s) => ({ a: s.a, b: s.b })),
    };
  };
  let result: DressingResult;
  try {
    result = d.run();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), state: "ABORT", frames: 0, retry: 0, ...shell(), metrics: null };
  }
  return {
    ok: result.failure === null,
    error: result.failure ? `${result.failure.state} f=${result.failure.frame}: ${result.failure.reason}` : null,
    state: result.state,
    frames: result.frames,
    retry: result.retries,
    ...shell(),
    metrics: d.metrics(),
  };
}
