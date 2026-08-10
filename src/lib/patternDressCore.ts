// P2c(e) — **v2 패턴 착장 파이프라인**(브라우저·워커용).
//
// 물리는 한 줄도 여기서 새로 쓰지 않는다. P2b가 뽑아 둔 공유 모듈
// (`createPatternUnifiedResolver` · `bakePatternFrictionSdf` · `makePatternSessionEnv` ·
// `patternDressHooks` 3종)과 기존 라이브러리(`buildPatternGarment` · `buildPatternSim` ·
// `correctPlacementPenetration` · `runDressing`)를 **부르는 순서**만 담는다.
//
// **알려진 이중 경로**: `scripts/dressPattern.ts`는 아직 이 함수를 부르지 않고
// 같은 순서를 자기 안에 갖고 있다(계기 50여 종이 그 사이에 끼어 있어서 이번 판에
// 갈라내지 않았다). 그래서 §g 정합성 대조가 이 파일의 **합격 근거**다 —
// 두 경로가 같은 수를 낸다는 실측이 없으면 이 파일은 신뢰 대상이 아니다.
// 스크립트를 이 함수 위로 옮기는 것이 다음 판의 숙제다.
//
// **env는 채널이다**(P2b (b) 등재분). 스크립트가 env로 받던 물리 스위치는 전부
// `PatternDressOptions`에 있고 **기본값이 스크립트의 「미설정」과 같다**.
// 하나라도 어긋나면 정합성 대조가 통째로 무효다.
import * as THREE from "three";
import { ArrayBvhCollision } from "./bvhFromArrays";
import { SelfCollision } from "./selfCollision";
import { FABRIC_PRESETS } from "./fabricPresets";
import { createGarmentSession, createPanelSplitResolver, createPatternUnifiedResolver, buildArmCapsules, makePatternSessionEnv } from "./garmentFrame";
import type { Capsule } from "./torsoCapsule";
import { runDressing } from "./dressingMachine";
import { createAnchorPinRamp, createRingLimitRamp, projectRingTotalLength } from "./patternDressHooks";
import { deriveBodySkeleton, nearestOnSegments } from "./bodySkeleton";
import { measureBody } from "./bodyMeasure";
import { buildPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT, PATTERN_EDGE_INTERIOR_M } from "./patternGarment";
import { makeOutlineProvider } from "./bodyOutline";
import { buildPatternSim } from "./buildPatternSim";
import { correctPlacementPenetration, countInside, countSelfIntersections, makeParityInside } from "./patternPlacement";
import { computeBodyCoverage } from "./coverageMetric";
import { bakePatternFrictionSdf } from "./sdfCollision";
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
    armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
    armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
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
  /** 옷 치수 override. 미지정이면 fixture `layout`/`pose`에서 도출(= 하네스와 같은 옷). */
  garmentDims?: { lengthM: number; widthM: number; shoulderWidthM: number; sleeveLengthM: number; sleeveWidthM: number };
  /** UI 진행 표시용. 물리에 관여하지 않는다. */
  onProgress?: (frame: number, state: string) => void;
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

const HEM_STRICT = 1e-9;

export function runPatternDressing(fixture: PatternDressFixture, opts: PatternDressOptions = {}): PatternDressResult {
  const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
  const ringTotalOn = opts.ringTotal ?? true;
  const MARGIN_ALL = opts.marginAllM ?? COLLISION_MARGIN;
  const torsoCap = opts.torsoCap ?? false;
  const armCap = opts.armCap ?? true;
  const singleDeepest = opts.singleDeepest ?? true;
  const s0fix = opts.s0fix ?? true;
  const pinDress = opts.pinDress ?? false;
  const FRAMES = Math.round((opts.seconds ?? 25) * 60);

  const { layout, pose, collision } = fixture;
  const position = collision.position instanceof Float32Array ? collision.position : Float32Array.from(collision.position);
  const torsoIndex = Uint32Array.from([...(collision.frontIndex ?? []), ...(collision.backIndex ?? [])]);
  const wholeIndex = collision.wholeBodyIndex ? Uint32Array.from(collision.wholeBodyIndex) : null;
  const frontIdx = collision.frontIndex ? Uint32Array.from(collision.frontIndex) : null;
  const backIdx = collision.backIndex ? Uint32Array.from(collision.backIndex) : null;
  const hemY = collision.capsules[collision.capsules.length - 1].bottom.y;
  const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
  const arms = [pose.armLeft, pose.armRight] as const;

  const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemY);
  const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, collision.centerZ, MARGIN_ALL);

  const garmentDims = opts.garmentDims ?? {
    lengthM: layout.heightM,
    widthM: layout.widthM,
    shoulderWidthM: Math.abs(pose.pinLeft.x - pose.pinRight.x),
    sleeveLengthM: Math.max(pose.armLeft.length, pose.armRight.length),
    sleeveWidthM: layout.sleeveWidthM,
  };
  const outlineTorso = new ArrayBvhCollision();
  outlineTorso.rebuild(position, torsoIndex);
  const outlineWhole = new ArrayBvhCollision();
  outlineWhole.rebuild(position, wholeIndex ?? torsoIndex);
  const outlineAt = makeOutlineProvider(
    outlineTorso, outlineWhole,
    (h) => { const sl = body.slices.reduce((b, s2) => (Math.abs(s2.y - h) < Math.abs(b.y - h) ? s2 : b), body.slices[0]); return [sl.axisX, sl.axisZ]; },
    PATTERN_EDGE_INTERIOR_M,
  );
  const g = buildPatternGarment(body, garmentDims, arms, outlineAt, undefined, MARGIN_ALL);
  const total = g.panelCounts.reduce((a, b) => a + b, 0);

  const wholeMesh = new ArrayBvhCollision();
  wholeMesh.rebuild(position, wholeIndex);
  const insideParity = makeParityInside(wholeMesh);
  const skipKeys = new Set<number>();
  for (const e of [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))]) {
    skipKeys.add(Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b));
  }
  if (s0fix) {
    correctPlacementPenetration(g.positions, total, wholeMesh, insideParity, MARGIN_ALL, g.selfCollisionMinDistM, skipKeys, SDF_FAR);
  }

  const preset = FABRIC_PRESETS[pose.fabric];
  const ps = buildPatternSim(g, preset.iterations, false, undefined);
  const sim = ps.sim;

  // ── 링 폐곡선화 + 접합 rest 심기(25회차). `setCollarRing`이 현재 좌표에서 rest를
  // 뜨므로 접합 2쌍만 시접 target 거리로 잠깐 옮겼다 되돌린다(clothPhysics 무수정).
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
  const headGirthM = body.slices.reduce((m, sl) => (sl.y > body.neckY && sl.girthM > m ? sl.girthM : m), 0);
  const ringTotalMaxM = ringTotalOn ? headGirthM : 0;
  const ringVertexList = [...new Set<number>(ringClosed.flatMap((e) => [e.a, e.b]))];

  // ── 충돌 리졸버(P2b(a)) + 마찰 SDF(P2b(b))
  const frontMesh = new ArrayBvhCollision();
  const backMesh = new ArrayBvhCollision();
  frontMesh.rebuild(position, frontIdx);
  backMesh.rebuild(position, backIdx);
  const armCapsules = [...buildArmCapsules(pose.armLeft), ...buildArmCapsules(pose.armRight)];
  const meshResolver = createPanelSplitResolver(
    [
      frontMesh.createResolver(MARGIN_ALL, COLLISION_DETECTION_RADIUS),
      backMesh.createResolver(MARGIN_ALL, COLLISION_DETECTION_RADIUS),
      null,
      null,
    ],
    g.panelCounts,
  );
  const unified = createPatternUnifiedResolver(
    meshResolver, g.panelCounts, collision.capsules, armCapsules,
    { torsoCap, armCap, singleDeepest, torsoPanels: [PANEL_PAT_FRONT, PANEL_PAT_BACK] },
  );
  const { field: sdfField } = bakePatternFrictionSdf(
    wholeMesh, skeleton.segments, position, layout.topY, hemY, { skeletonSign: opts.skeletonSign },
  );
  const selfCollision = new SelfCollision(
    [...g.panelStarts], [...g.panelCounts], 0,
    [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))],
    g.selfCollisionMinDistM, 0,
  ).createResolver(g.selfCollisionMinDistM);

  // ── 앵커 목표 = 어깨 능선 호장 비율 매핑(6회차) + 표면 위 margin(20회차).
  const anchorList = (() => {
    const nwHalf = g.draft.dims.neckHalfWidthM;
    const sideCurve = (sign: number): { p: { x: number; y: number; z: number }; cum: number }[] => {
      const pts = body.ridgePoints
        .filter((r) => Math.sign(r.x - body.centerX) === sign && Math.abs(r.x - body.centerX) >= nwHalf)
        .sort((a, b) => Math.abs(a.x - body.centerX) - Math.abs(b.x - body.centerX));
      const out: { p: { x: number; y: number; z: number }; cum: number }[] = [];
      let cum = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) cum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
        out.push({ p: { x: pts[i].x, y: pts[i].y, z: pts[i].z }, cum });
      }
      return out;
    };
    const curves = new Map<number, { p: { x: number; y: number; z: number }; cum: number }[]>([[1, sideCurve(1)], [-1, sideCurve(-1)]]);
    const at = (sign: number, s: number): { x: number; y: number; z: number } => {
      const c = curves.get(sign)!;
      const tot = c[c.length - 1].cum;
      const target = tot * Math.min(1, Math.max(0, s));
      for (let i = 1; i < c.length; i++) {
        if (c[i].cum >= target) {
          const t = (target - c[i - 1].cum) / Math.max(1e-9, c[i].cum - c[i - 1].cum);
          return {
            x: c[i - 1].p.x + (c[i].p.x - c[i - 1].p.x) * t,
            y: c[i - 1].p.y + (c[i].p.y - c[i - 1].p.y) * t,
            z: c[i - 1].p.z + (c[i].p.z - c[i - 1].p.z) * t,
          };
        }
      }
      return c[c.length - 1].p;
    };
    const shoulderSeamM = g.draft.dims.shoulderSeamM;
    return g.seams
      .filter((sm) => sm.kind === "shoulder")
      .filter((sm) => !(ringVertsSet.has(sm.a) || ringVertsSet.has(sm.b)))
      .map((sm) => {
        const px = g.pos2[sm.a * 2], py = g.pos2[sm.a * 2 + 1];
        const s = Math.hypot(Math.abs(px) - nwHalf, py) / Math.max(1e-9, shoulderSeamM);
        const t = at(Math.sign(px) || 1, s);
        return { i: sm.a, x: t.x, y: t.y + COLLISION_MARGIN, z: t.z };
      });
  })();

  // ── 34게이트(영구) — 배치는 rest를 보존해야 한다. **throw로 실행을 끊는 물리 게이트**다.
  // 허용분은 float32 저장 정밀도에서 도출한다(결과에 맞춘 값이 아니다).
  const F32_HALF_ULP = Math.pow(2, -24);
  const seamKeySet = new Set<number>(g.seams.map((s) => Math.min(s.a, s.b) * 1_000_000 + Math.max(s.a, s.b)));
  const placementRestGate = (label: string): void => {
    let maxCoord = 0, minRest = Infinity;
    for (let i = 0; i < total * 3; i++) maxCoord = Math.max(maxCoord, Math.abs(sim.positions[i]));
    for (const c of sim.constraintPairs) if (c.restLength > 0 && c.restLength < minRest) minRest = c.restLength;
    const tol = (2 * maxCoord * F32_HALF_ULP) / minRest;
    let max = 1, min = 1, ext = 0;
    for (const c of sim.constraintPairs) {
      if (c.restLength <= 0) continue;
      if (seamKeySet.has(Math.min(c.a, c.b) * 1_000_000 + Math.max(c.a, c.b))) continue;
      if (c.a >= g.panelStarts[2]) continue; // 소매는 게이트 대상이 아니다(원통 감기 = 비등거리)
      const dd = Math.hypot(
        sim.positions[c.b * 3] - sim.positions[c.a * 3],
        sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
        sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
      );
      const r = dd / c.restLength;
      if (r > max) max = r;
      if (r < min) min = r;
      if (dd > c.restLength) ext += dd - c.restLength;
    }
    if (max - 1 > tol || 1 - min > tol) {
      throw new Error(`배치 실패 — 34게이트 위반 ${label}: 몸판 신장비 ${min.toFixed(6)}~${max.toFixed(6)} (문턱 1.000000±${tol.toExponential(2)}) · 신장총 ${(ext * 100).toFixed(1)}cm`);
    }
  };

  // ── 물리 훅(P2b §2 분류의 「물리」만 배선한다. 계기 훅은 넘기지 않는다.)
  const prevFrame = new Float32Array(sim.positions.length);
  prevFrame.set(sim.positions);
  const deltaHist: number[] = [];
  const maxDelta20Mm = (): number => (deltaHist.length ? Math.max(...deltaHist.slice(-20)) : Infinity);
  const maxSeamGapM = (): number => {
    let m = 0;
    for (const s of g.seams) {
      const d = Math.hypot(
        sim.positions[s.b * 3] - sim.positions[s.a * 3],
        sim.positions[s.b * 3 + 1] - sim.positions[s.a * 3 + 1],
        sim.positions[s.b * 3 + 2] - sim.positions[s.a * 3 + 2],
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

  let anchorStrength = 0;
  const env = makePatternSessionEnv({
    collisionResolver: unified,
    selfCollision,
    sdfField: () => sdfField,
    anchors: () => (pinDress ? anchorList : []),
    collarStrainLimit: COLLAR_STRAIN_LIMIT,
    pinStrength: anchorStrength,
  });
  const session = createGarmentSession(sim, env);

  const RAMP_FRAMES = 120;
  let gateArmed = true;
  const anchorRamp = createAnchorPinRamp(sim, anchorList, RAMP_FRAMES, {
    onFirstRamp: () => { if (gateArmed) { gateArmed = false; placementRestGate("(ii) 핀 발화 직후"); } },
  });
  const ringRamp = createRingLimitRamp(COLLAR_STRAIN_LIMIT, ringRestM, 120);
  let ringTotalFired = 0;

  const gravity = new THREE.Vector3(0, -9.81, 0);
  const frameLayout = { widthM: layout.widthM, heightM: garmentDims.lengthM, topY: layout.topY, centerZ: collision.centerZ, sleeveWidthM: layout.sleeveWidthM };
  const framePose = { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft: pose.armLeft, armRight: pose.armRight };

  const fail = (msg: string): PatternDressResult => ({
    ok: false, error: msg, state: "ABORT", frames: 0, retry: 0,
    elapsedMs: (typeof performance !== "undefined" ? performance.now() : 0) - t0,
    positions: sim.positions.slice(), panelStarts: [...g.panelStarts], panelCounts: [...g.panelCounts],
    panelTriRanges: g.panelTriRanges.map((r) => ({ start: r.start, count: r.count })),
    tris: Uint32Array.from(g.tris), uv: Float32Array.from(g.uv),
    seams: g.seams.map((s) => ({ a: s.a, b: s.b })), metrics: null,
  });

  let result;
  try {
    placementRestGate("(i) 진짜 배치 직후 · 핀 발화 전");
    result = runDressing(
      sim, session, g.seams.map((s) => ({ a: s.a, b: s.b, target: s.targetM, kind: s.kind })),
      { rampFrames: RAMP_FRAMES, stallFrames: 60, seamSlackM: 0.01, settleDeltaMm: 5.6, settleFrames: 20, budget: { S0: 1, S1: 240, S2: 120, S3: 720 } },
      {
        place: (scale) => {
          g.place(scale);
          correctPlacementPenetration(g.positions, total, wholeMesh, insideParity, MARGIN_ALL, g.selfCollisionMinDistM, skipKeys, SDF_FAR);
          for (let i = 0; i < total; i++) sim.setParticle(i, g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
          placementRestGate(`(i) 재배치 직후 · 핀 발화 전 (오프셋 배수 ${scale.toFixed(2)})`);
          gateArmed = true;
        },
        countPenetrating: () => countInside(sim.positions, total, insideParity),
        diverged,
        maxSeamGapM,
        maxDelta20Mm,
        setAnchorHard: anchorRamp.setAnchorHard,
        beforeStep: (frame, state) => {
          (env as { collarStrainLimit?: number }).collarStrainLimit = ringRamp.update(frame, state, ringLenM());
        },
        onFrame: (frame, state) => {
          if (projectRingTotalLength(sim, ringVertexList, ringLenM(), ringTotalMaxM)) ringTotalFired++;
          let md = 0;
          for (let i = 0; i < sim.positions.length; i += 3) {
            const d = Math.hypot(sim.positions[i] - prevFrame[i], sim.positions[i + 1] - prevFrame[i + 1], sim.positions[i + 2] - prevFrame[i + 2]);
            if (d > md) md = d;
          }
          deltaHist.push(md * 1000);
          prevFrame.set(sim.positions);
          opts.onProgress?.(frame, state);
        },
      },
      () => ({ dt: SUBSTEP_DT, gravity, preset, layout: frameLayout, pose: framePose }),
      FRAMES, t0,
      (s) => { anchorStrength = s; (env as { pinStrength?: number }).pinStrength = s; },
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  void ringTotalFired;
  void anchorStrength;

  // ── 계기(§g 대조 채널 9종). 물리에 관여하지 않는다.
  const clothTris = new Float32Array(g.tris.length * 3);
  for (let t = 0; t < g.tris.length; t++) {
    const v = g.tris[t];
    clothTris[t * 3] = sim.positions[v * 3];
    clothTris[t * 3 + 1] = sim.positions[v * 3 + 1];
    clothTris[t * 3 + 2] = sim.positions[v * 3 + 2];
  }
  const gridView = { positions: sim.positions, panelDims: sim.panelDims, index: (p: number, x: number, y: number) => sim.index(p, x, y) };
  const neckCenter = { x: centerX, y: body.neckY, z: collision.centerZ };
  const hemWorldY = g.draft.dims.ridgeAnchorY - g.draft.dims.lengthM;
  const armMask = (() => {
    const n = position.length / 3;
    const mask = new Uint8Array(n).fill(1);
    const armSet = new Set(skeleton.arms);
    for (let v = 0; v < n; v++) {
      const near = nearestOnSegments(position[v * 3], position[v * 3 + 1], position[v * 3 + 2], skeleton.segments);
      if (armSet.has(near.segment)) mask[v] = 0;
    }
    return mask;
  })();
  const cov = computeBodyCoverage(
    position, [frontIdx, backIdx], gridView, [],
    { yMin: hemWorldY, yMax: body.shoulderJointY, neckCenter, neckRadius: 0.12, centerX, centerZ: collision.centerZ, sampleMask: armMask },
    clothTris,
  );
  let maxStrain = 0, maxStrainAt = -1;
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    const d = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    if (d / c.restLength > maxStrain) { maxStrain = d / c.restLength; maxStrainAt = c.a; }
  }
  const hemChain = (() => {
    const lenM = g.draft.dims.lengthM;
    const strict: number[] = [];
    for (let i = 0; i < g.panelStarts[2]; i++) if (Math.abs(g.pos2[i * 2 + 1] - lenM) < HEM_STRICT + 1e-6) strict.push(i);
    const chainOf = (lo: number, hi: number): number[] => strict.filter((i) => i >= lo && i < hi).sort((a, b) => g.pos2[a * 2] - g.pos2[b * 2]);
    return { front: chainOf(0, g.panelStarts[1]), back: chainOf(g.panelStarts[1], g.panelStarts[2]) };
  })();
  const chainLen = (idx: number[]): number => {
    let l = 0;
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1], b = idx[k];
      l += Math.hypot(
        sim.positions[b * 3] - sim.positions[a * 3],
        sim.positions[b * 3 + 1] - sim.positions[a * 3 + 1],
        sim.positions[b * 3 + 2] - sim.positions[a * 3 + 2],
      );
    }
    return l;
  };

  return {
    ok: result.failure === null,
    error: result.failure ? `${result.failure.state} f=${result.failure.frame}: ${result.failure.reason}` : null,
    state: result.state,
    frames: result.frames,
    retry: result.retries,
    elapsedMs: (typeof performance !== "undefined" ? performance.now() : 0) - t0,
    positions: sim.positions.slice(),
    panelStarts: [...g.panelStarts],
    panelCounts: [...g.panelCounts],
    panelTriRanges: g.panelTriRanges.map((r) => ({ start: r.start, count: r.count })),
    tris: Uint32Array.from(g.tris),
    uv: Float32Array.from(g.uv),
    seams: g.seams.map((s) => ({ a: s.a, b: s.b })),
    metrics: {
      covPct: 100 * cov.exposedRatio,
      covExposed: cov.exposed,
      covTotal: cov.samples,
      maxStrain,
      maxStrainAt,
      maxSeamGapMm: maxSeamGapM() * 1000,
      delta20Mm: maxDelta20Mm(),
      selfIntersections: countSelfIntersections(sim.positions, g.tris, g.edgePairs, 0.03, 1_000_000).count,
      insideCount: countInside(sim.positions, total, insideParity),
      insideTotal: total,
      ringLenCm: ringLenM() * 100,
      hemFrontCm: chainLen(hemChain.front) * 100,
      hemBackCm: chainLen(hemChain.back) * 100,
    },
  };
}
