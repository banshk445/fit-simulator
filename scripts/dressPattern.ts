// v2 T5 = Stage 2b 하네스 — 정식 패턴 패널의 **첫 착장**. v2-design §4·§6.
//
// 접촉은 T2 분기 결과대로 **흡착 모드**(BVH 기본 경로 + 현 채택 마찰 스택).
// 상태기계는 2a-thin이 통과시킨 `runDressing`을 그대로 쓴다 — 패널만 정식.
//
// 진입: `PATTERNCORE=1 npm run dress:pattern`.
//
// **예산은 §4 스펙 하드다**(S3 = V5 ≤12s = 720프레임). 초과 시 연장 금지 —
// 실패로 기록한다. 2a-thin이 718/720프레임(마진 99.7%)으로 통과했으므로
// 이 채널이 먼저 깨질 후보라고 이미 예고돼 있다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { SelfCollision } from "../src/lib/selfCollision";
import { FABRIC_PRESETS } from "../src/lib/fabricPresets";
import { createGarmentSession, createPanelSplitResolver, buildArmCapsules } from "../src/lib/garmentFrame";
import type { GarmentFrameEnv } from "../src/lib/garmentFrame";
import { applyCapsuleCollision } from "../src/lib/torsoCapsule";
import type { Capsule } from "../src/lib/torsoCapsule";
import { runDressing } from "../src/lib/dressingMachine";
import { deriveBodySkeleton } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { buildPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT } from "../src/lib/patternGarment";
import { buildPatternSim } from "../src/lib/buildPatternSim";
import { correctPlacementPenetration, countInside, countOpenEdges, countSelfIntersections, makeParityInside } from "../src/lib/patternPlacement";
import { computeBodyCoverage, deriveShoulderBand } from "../src/lib/coverageMetric";
import { bakeSdf, createCachedSdfIterationFriction, createSdfFrictionPass, makeRadialSignedSampler } from "../src/lib/sdfCollision";
import {
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLISION_MARGIN,
  DEFAULT_PATTERN_CORE,
  FRICTION_CONTACT_BAND,
  FRICTION_MU_ITER,
  FRICTION_MU_KINETIC,
  FRICTION_MU_STATIC,
  LOCAL_MU_GAIN,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  SDF_FAR,
  SDF_VOXEL,
  SUBSTEP_DT,
  COLLAR_STRAIN_LIMIT,
} from "../src/lib/clothConfig";

const t0 = performance.now();
const patternCore = process.env.PATTERNCORE != null ? process.env.PATTERNCORE !== "0" : DEFAULT_PATTERN_CORE;
if (!patternCore) {
  console.log("[dress] patternCore off(기본) — 아무것도 실행하지 않는다. PATTERNCORE=1로 진입.");
  process.exit(0);
}

const FIXTURE = process.env.FIXTURE ?? "scripts/fixtures/collision-fixture.json";
const META_PATH = process.env.PATTERN_META ?? "scripts/fixtures/pattern-meta.json";
const raw = readFileSync(FIXTURE, "utf8");
const fixtureHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
const fixture = JSON.parse(raw) as {
  layout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  pose: {
    pinLeft: { x: number; y: number; z: number };
    pinRight: { x: number; y: number; z: number };
    armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
    armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
    fabric: keyof typeof FABRIC_PRESETS;
  };
  collision: {
    position: number[];
    frontIndex: number[] | null;
    backIndex: number[] | null;
    wholeBodyIndex: number[] | null;
    capsules: Capsule[];
    centerZ: number;
  };
};
const { layout, pose, collision } = fixture;

const position = Float32Array.from(collision.position);
const torsoIndex = Uint32Array.from([...(collision.frontIndex ?? []), ...(collision.backIndex ?? [])]);
const wholeIndex = collision.wholeBodyIndex ? Uint32Array.from(collision.wholeBodyIndex) : null;
const frontIdx = collision.frontIndex ? Uint32Array.from(collision.frontIndex) : null;
const backIdx = collision.backIndex ? Uint32Array.from(collision.backIndex) : null;
const hemY = collision.capsules[collision.capsules.length - 1].bottom.y;
const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
const arms = [pose.armLeft, pose.armRight] as const;

const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemY);
const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, collision.centerZ);
const garmentDims = {
  lengthM: layout.heightM,
  widthM: layout.widthM,
  shoulderWidthM: Math.abs(pose.pinLeft.x - pose.pinRight.x),
  sleeveLengthM: Math.max(pose.armLeft.length, pose.armRight.length),
  sleeveWidthM: layout.sleeveWidthM,
};
const g = buildPatternGarment(body, garmentDims, arms);
const total = g.panelCounts.reduce((a, b) => a + b, 0);
const cm = (v: number): string => (v * 100).toFixed(2);

// ── 옷 정의 해시 — 함정 8(측정 기준이 버전 관리 밖에 있으면 조용히 바뀐다).
// fixture 해시는 **몸**만 덮는다. v2는 옷이 코드에서 도출되므로 옷 정의도
// 해시로 고정해 병기하고, 커밋된 스냅샷과 다르면 즉시 드러나게 한다.
const patternHash = (() => {
  const h = createHash("sha256");
  h.update(Buffer.from(new Float64Array(g.pos2).buffer));
  h.update(Buffer.from(new Uint32Array(g.tris).buffer));
  for (const s of g.seams) h.update(`${s.a}:${s.b}:${s.kind};`);
  return h.digest("hex").slice(0, 12);
})();
const patternMeta = {
  patternHash,
  fixtureHash,
  garmentDims,
  panelCounts: g.panelCounts,
  triangles: g.tris.length / 3,
  meshEdges: g.edgePairs.length,
  seamCounts: g.meta.seamCounts,
  selfCollisionMinDistMm: Number((g.selfCollisionMinDistM * 1000).toFixed(3)),
  dims: {
    neckHalfWidthCm: Number(cm(g.draft.dims.neckHalfWidthM)),
    armholeGirthCm: Number(cm(g.draft.dims.armholeGirthM)),
    capHeightCm: Number(cm(g.draft.dims.capHeightM)),
    necklineGirthCm: Number(cm(g.draft.dims.necklineGirthM)),
  },
};
if (process.env.EXPORT_META === "1") {
  writeFileSync(META_PATH, `${JSON.stringify(patternMeta, null, 2)}\n`);
  console.log(`[dress] 패턴 메타 내보냄 → ${META_PATH} (patternHash ${patternHash})`);
} else if (existsSync(META_PATH)) {
  const prev = JSON.parse(readFileSync(META_PATH, "utf8")) as { patternHash: string; fixtureHash: string };
  const same = prev.patternHash === patternHash && prev.fixtureHash === fixtureHash;
  console.log(
    `[dress] 옷 정의 해시 대조: pattern ${patternHash} / fixture ${fixtureHash} vs 커밋본 ${prev.patternHash} / ${prev.fixtureHash} → ${same ? "동일" : "**변경됨** — 이전 측정과 비교 불가"}`,
  );
}

console.log(
  `[dress] 패널 정점 ${total}(${g.panelCounts.join("/")}) · 삼각형 ${g.tris.length / 3} · 메시 엣지 ${g.edgePairs.length} · 시접 ${g.seams.length}쌍 ${JSON.stringify(g.meta.seamCounts)}`,
);

// ── S0 배치 관통 교정(2a와 **같은 함수**).
const wholeMesh = new ArrayBvhCollision();
wholeMesh.rebuild(position, wholeIndex);
const insideParity = makeParityInside(wholeMesh);
const skipKeys = new Set<number>();
for (const e of [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))]) {
  skipKeys.add(Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b));
}
{
  const wt = countOpenEdges(wholeIndex ?? torsoIndex);
  console.log(`[dress] 패리티 전제(수밀성): 삼각형 ${wt.triangles} · 엣지 ${wt.edges} · 비-2회 ${wt.open}${wt.open === 0 ? " → 수밀" : " → **비수밀·패리티 근사**(v2-design §5 등재)"}`);
}
const penBefore = countInside(g.positions, total, insideParity);
const corrected = correctPlacementPenetration(
  g.positions, total, wholeMesh, insideParity, COLLISION_MARGIN, g.selfCollisionMinDistM, skipKeys, SDF_FAR,
);
const penAfterPlace = countInside(g.positions, total, insideParity);
console.log(`[dress] S0 배치 관통: ${penBefore} → 교정 ${corrected}정점 → ${penAfterPlace} (패리티 근사)`);

// ── 물리 조립
const preset = FABRIC_PRESETS[pose.fabric];
const ps = buildPatternSim(g, preset.iterations);
const sim = ps.sim;
const DIAG = process.env.DIAG === "1";
const edgeKeySet = new Set(g.edgePairs.map((e) => Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b)));
const seamKeySet = new Set(g.seams.map((e) => Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b)));
const kindOf = (a: number, b: number): string => {
  const k = Math.min(a, b) * 1_000_000 + Math.max(a, b);
  return edgeKeySet.has(k) ? "structural" : seamKeySet.has(k) ? "seam" : "bend";
};
const panelOfIdx = (i: number): number => { for (let p = 3; p >= 0; p--) if (i >= g.panelStarts[p]) return p; return 0; };
const PANEL_NAME = ["앞판", "뒤판", "소매L", "소매R"];
console.log(
  `[dress] 제약: structural ${ps.structuralPairs} · bend ${ps.bendPairs}(반복 보정 배율 ${ps.bendStiffnessPerIteration.toFixed(5)} @ ${ps.iterations}회 = 유효 ${(1 - Math.pow(1 - ps.bendStiffnessPerIteration, ps.iterations)).toFixed(3)}) · seam ${ps.seamPairs} · shear 0(소멸) · 총 ${sim.constraintPairs.length}`,
);
console.log("[dress] 알려진 이탈: 질량 균일(§3.3은 Voronoi 면적 비례 요구 — ClothSimulation에 질량 개념 없음, clothPhysics 무수정 원칙으로 미도입)");

// ── 링 상한 상태 스케줄 (3회차 단일 물리 변경)
// 원칙: **봉제 후 착용**. 시접이 아직 열려 있는 동안 링이 상한에 걸려 있으면
// 목점 시접(2회차: 6mm 목표에 54mm 벌어짐)을 당기려면 링이 늘어나야 하고
// 한계기가 그것을 되돌린다 — 넥밴드와 어깨 시접이 서로를 봉쇄했다.
//
// 완화 폭을 **시간이 아니라 seamGap에서 도출**한다:
//   여유(slack) = max(0, maxSeamGap − target)
//   완화 상한   = max(1.02, 1 + slack / 링 rest 원주)
// 근거: 목점 쌍을 target까지 당기려면 두 점이 합쳐 slack만큼 이동해야 하고
// 그 이동은 링을 따라 일어난다 — 링이 그만큼 길어질 여지를 주면 봉쇄가
// 풀린다. slack이 0으로 가면 상한이 1.02로 **연속적으로** 수렴하므로
// (§4 "램프는 연속 함수로만") 별도의 전이 시점이 필요 없다.
// S3 이후는 상태로 고정한다 — 정착 중 갭이 튀어도 다시 완화되지 않게.
let ringRestM = 0;
let ringLimitNow = COLLAR_STRAIN_LIMIT;
let ringFullyEngagedAt = -1;

// ── 넥밴드 원주 제약 (2회차 단일 변경) — v1 칼라 기계를 패턴 목선 링에 배선.
// 실물 부품(리브)이고 보조 힘이 아니다. clothPhysics는 이 기계를 이미 갖고
// 있어 수정 0줄.
{
  sim.setCollarRing(g.necklineRing);
  let ringM = 0;
  for (const e of g.necklineRing) {
    ringM += Math.hypot(
      sim.positions[e.b * 3] - sim.positions[e.a * 3],
      sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1],
      sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2],
    );
  }
  ringRestM = ringM;
  const targetM = g.draft.dims.necklineGirthM;
  const errCm = (ringM - targetM) * 100;
  console.log(
    `[dress] 넥밴드 원주 제약: 링 엣지 ${g.necklineRing.length}쌍 · 배치 실측 원주 ${cm(ringM)}cm vs 패턴 목선 ${cm(targetM)}cm (오차 ${errCm.toFixed(3)}cm) · 신장 상한 ${COLLAR_STRAIN_LIMIT}(v1 승계·추정)`,
  );
  if (g.necklineRing.length === 0) throw new Error("넥밴드 링 제약 0쌍 — 배선 실패");
  if (Math.abs(errCm) > 0.05) {
    console.log(`[dress] **경고** 링 원주가 패턴 목선과 ${errCm.toFixed(3)}cm 어긋난다 — rest가 패턴이 아닌 것을 굳혔을 수 있다`);
  }
}

// ── 핀 상태 명시 (2c 무핀의 전 단계 기록)
console.log(
  "[dress] 핀 상태: v1 하드 핀(`pinCorners`)은 **한 정점에도 안 걸린다** — 그 함수는 COLS/ROWS 격자 인덱스와 목선 코너 규약으로 대상을 찾고(PANEL_FRONT/BACK 고정), 패턴 패널에는 그 인덱스 자체가 없다. env.pinCorners=false로 배선상 차단.",
);
console.log(
  `[dress] 핀 대체물: §4 S1의 **임시 배치 앵커**만 — 대상 = 어깨 시접 앞판 쪽 정점 ${g.seams.filter((s) => s.kind === "shoulder").length}개, 목표 = 배치 시점 좌표 고정, 강도 = 램프로 1→0(S2 진입 시 0). 하드 핀(pinned=1)은 0개.`,
);

const frontMesh = new ArrayBvhCollision();
const backMesh = new ArrayBvhCollision();
frontMesh.rebuild(position, frontIdx);
backMesh.rebuild(position, backIdx);
const armCapsules = [...buildArmCapsules(pose.armLeft), ...buildArmCapsules(pose.armRight)];
const meshResolver = createPanelSplitResolver(
  [
    frontMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS),
    backMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS),
    null,
    null,
  ],
  g.panelCounts,
);
const unified = (positions: Float32Array, pinned: Uint8Array, n: number): void => {
  meshResolver(positions, pinned, n);
  let offset = 0;
  for (let p = 0; p < g.panelCounts.length; p++) {
    const count = g.panelCounts[p];
    const pos = positions.subarray(offset * 3, (offset + count) * 3);
    const pin = pinned.subarray(offset, offset + count);
    if (p === PANEL_PAT_FRONT || p === PANEL_PAT_BACK) {
      applyCapsuleCollision(pos, pin, count, collision.capsules, COLLISION_MARGIN);
    }
    applyCapsuleCollision(pos, pin, count, armCapsules, 0.006);
    offset += count;
  }
  void n;
};

// 마찰 SDF — 스파이크·1b와 같은 스택.
const yTop = layout.topY + 0.1;
const yBot = hemY - 0.15;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < position.length; i += 3) {
  const y = position[i + 1];
  if (y < yBot || y > yTop) continue;
  if (position[i] < minX) minX = position[i];
  if (position[i] > maxX) maxX = position[i];
  if (position[i + 2] < minZ) minZ = position[i + 2];
  if (position[i + 2] > maxZ) maxZ = position[i + 2];
}
const pad = 0.08;
const tBake = performance.now();
const sdfField = bakeSdf(
  makeRadialSignedSampler(wholeMesh, (minX + maxX) / 2, (minZ + maxZ) / 2, SDF_FAR, SDF_FAR),
  { x: minX - pad, y: yBot, z: minZ - pad },
  { x: maxX + pad, y: yTop, z: maxZ + pad },
  SDF_VOXEL, SDF_FAR,
);
console.log(`[dress] SDF 굽기 ${sdfField.nx}x${sdfField.ny}x${sdfField.nz} elapsedMs ${Math.round(performance.now() - tBake)}`);
const cachedFric = createCachedSdfIterationFriction(() => sdfField, {
  contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_ITER, muKinetic: FRICTION_MU_ITER, localMuGain: LOCAL_MU_GAIN,
});

let anchorStrength = 0;
let collarFired = 0;

const anchorList = g.seams
  .filter((s) => s.kind === "shoulder")
  .map((s) => ({ i: s.a, x: g.positions[s.a * 3], y: g.positions[s.a * 3 + 1], z: g.positions[s.a * 3 + 2] }));
const selfCollision = new SelfCollision(
  [...g.panelStarts], [...g.panelCounts], 0,
  [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))],
  g.selfCollisionMinDistM, 0,
).createResolver(g.selfCollisionMinDistM);
const env: GarmentFrameEnv = {
  collisionResolver: unified,
  collisionEvery: COLLISION_EVERY,
  selfCollision,
  orderColumn: false, orderRow: false, clampInSubstep: true, smoothing: false, postOrder: false,
  armSoftPull: false, necklineHug: false, sleeveArmPull: false, yAlign: false, symmetry: false,
  clampAfterPost: false,
  maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
  friction: createSdfFrictionPass(() => sdfField, {
    contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_STATIC, muKinetic: FRICTION_MU_KINETIC,
  }),
  frictionIteration: cachedFric.apply,
  frictionIterationReset: cachedFric.reset,
  collarStrainLimit: ringLimitNow,
  onCollarFired: (n) => { collarFired += n; },
  pinCorners: false,
  anchors: () => anchorList,
  pinContinuous: true,
  pinStrength: anchorStrength,
  anchorSyncPrev: true,
};
const session = createGarmentSession(sim, env);

// ── 진단 채널
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
const maxStrain = (): { v: number; at: number } => {
  let m = 0, at = -1;
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    const d = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    if (d / c.restLength > m) { m = d / c.restLength; at = c.a; }
  }
  return { v: m, at };
};
// **개명**: 이 채널은 "비인접 정점 쌍의 문턱 위반 수"이고 삼각형 교차 판정이
// 아니다 — 뭉친 천의 정상 폴드 접촉이 그대로 잡히므로 게이트 부적격이고
// **기록 채널**로만 쓴다(함정 13 계열). 게이트는 countSelfIntersections
// (엣지-삼각형)가 맡는다.
const proximityPairs = (): number => {
  const cell = g.selfCollisionMinDistM;
  const buckets = new Map<number, number[]>();
  const key = (x: number, y: number, z: number): number =>
    (Math.floor(x / cell) + 512) * 1_048_576 + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512);
  for (let i = 0; i < total; i++) {
    const k = key(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2]);
    const b = buckets.get(k);
    if (b) b.push(i); else buckets.set(k, [i]);
  }
  let n = 0;
  for (let i = 0; i < total; i++) {
    const cx = Math.floor(sim.positions[i * 3] / cell), cy = Math.floor(sim.positions[i * 3 + 1] / cell), cz = Math.floor(sim.positions[i * 3 + 2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = buckets.get((cx + dx + 512) * 1_048_576 + (cy + dy + 512) * 1024 + (cz + dz + 512));
      if (!b) continue;
      for (const j of b) {
        if (j <= i) continue;
        if (skipKeys.has(i * 1_000_000 + j)) continue;
        const d = Math.hypot(
          sim.positions[j * 3] - sim.positions[i * 3],
          sim.positions[j * 3 + 1] - sim.positions[i * 3 + 1],
          sim.positions[j * 3 + 2] - sim.positions[i * 3 + 2],
        );
        if (d < g.selfCollisionMinDistM) n++;
      }
    }
  }
  return n;
};

const gravity = new THREE.Vector3(0, -9.81, 0);
const frameLayout = { widthM: layout.widthM, heightM: garmentDims.lengthM, topY: layout.topY, centerZ: collision.centerZ, sleeveWidthM: layout.sleeveWidthM };
const framePose = { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft: pose.armLeft, armRight: pose.armRight };
const FRAMES = Math.round((process.env.SECONDS ? Number(process.env.SECONDS) : 25) * 60);

const result = runDressing(
  sim, session, g.seams.map((s) => ({ a: s.a, b: s.b, target: s.targetM, kind: s.kind })),
  {
    rampFrames: 120,
    stallFrames: 60,
    seamSlackM: 0.01,
    settleDeltaMm: 5.6,
    settleFrames: 20,
    // §4 스펙 그대로. **연장 금지** — 초과는 실패로 기록한다.
    budget: { S0: 1, S1: 240, S2: 120, S3: 720 },
  },
  {
    place: (scale) => {
      g.place(scale);
      correctPlacementPenetration(g.positions, total, wholeMesh, insideParity, COLLISION_MARGIN, g.selfCollisionMinDistM, skipKeys, SDF_FAR);
      for (let i = 0; i < total; i++) sim.setParticle(i, g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
    },
    countPenetrating: () => countInside(sim.positions, total, insideParity),
    diverged,
    maxSeamGapM,
    maxDelta20Mm,
    beforeStep: (_frame, state) => {
      const target = Math.max(...g.seams.map((s) => s.targetM));
      const slack = Math.max(0, maxSeamGapM() - target);
      const relaxed = 1 + slack / Math.max(1e-6, ringRestM);
      // S3·DONE에서는 완전 발동으로 고정(상태 기반 클램프).
      ringLimitNow = state === "S3" || state === "DONE"
        ? COLLAR_STRAIN_LIMIT
        : Math.max(COLLAR_STRAIN_LIMIT, relaxed);
      if (ringFullyEngagedAt < 0 && Math.abs(ringLimitNow - COLLAR_STRAIN_LIMIT) < 1e-9) ringFullyEngagedAt = _frame;
      (env as { collarStrainLimit?: number }).collarStrainLimit = ringLimitNow;
    },
    stateNote: () => `링상한 ${ringLimitNow.toFixed(4)}${Math.abs(ringLimitNow - COLLAR_STRAIN_LIMIT) < 1e-9 ? "(완전 발동)" : "(완화)"}`,
    onFrame: (frame, state) => {
      if (DIAG && frame % 60 === 0) {
        const st = maxStrain();
        const meanY = (list: number[]): number => list.reduce((a, i) => a + sim.positions[i * 3 + 1], 0) / Math.max(1, list.length);
        const shoulderIdx = g.seams.filter((x) => x.kind === "shoulder").map((x) => x.a);
        const sleeveIdx: number[] = [];
        for (let i = g.panelStarts[2]; i < total; i++) sleeveIdx.push(i);
        const hemIdx: number[] = [];
        for (let i = 0; i < g.panelStarts[2]; i++) if (g.pos2[i * 2 + 1] > g.draft.dims.lengthM - 0.01) hemIdx.push(i);
        console.log(
          `  [diag·y] f=${String(frame).padStart(4)} 어깨시접 ${(meanY(shoulderIdx) * 100).toFixed(1)}cm(배치 ${(g.draft.dims.ridgeAnchorY * 100).toFixed(1)}) · 밑단 ${(meanY(hemIdx) * 100).toFixed(1)}cm · 소매 ${(meanY(sleeveIdx) * 100).toFixed(1)}cm`,
        );
        console.log(
          `  [diag] f=${String(frame).padStart(4)} ${state} 링상한 ${ringLimitNow.toFixed(3)} seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm Δ20 ${maxDelta20Mm().toFixed(2)}mm strain ${st.v.toFixed(2)}@${PANEL_NAME[panelOfIdx(st.at)]} prox ${proximityPairs()} 관통 ${countInside(sim.positions, total, insideParity)} 칼라발화 ${collarFired}`,
        );
      }
      let md = 0;
      for (let i = 0; i < sim.positions.length; i += 3) {
        const d = Math.hypot(sim.positions[i] - prevFrame[i], sim.positions[i + 1] - prevFrame[i + 1], sim.positions[i + 2] - prevFrame[i + 2]);
        if (d > md) md = d;
      }
      deltaHist.push(md * 1000);
      prevFrame.set(sim.positions);
    },
  },
  () => ({ dt: SUBSTEP_DT, gravity, preset, layout: frameLayout, pose: framePose }),
  FRAMES, t0,
  (s) => { anchorStrength = s; (env as { pinStrength?: number }).pinStrength = s; },
);
const elapsedS = (performance.now() - t0) / 1000;

console.log(`\n[dress] 상태 전이 로그 (fixture ${fixtureHash} · pattern ${patternHash} · 예산 ${FRAMES}프레임)`);
for (const e of result.log) {
  console.log(`  f=${String(e.frame).padStart(4)} ${String(e.elapsedMs).padStart(6)}ms  ${e.from} → ${e.to}  retry=${e.retry}  ${e.reason}`);
}

// ── 지표 (전부 기록 — v1 기준선과 비교 금지, 옷이 다르다)
const clothTris = (() => {
  const out = new Float32Array(g.tris.length * 3);
  for (let t = 0; t < g.tris.length; t++) {
    const v = g.tris[t];
    out[t * 3] = sim.positions[v * 3];
    out[t * 3 + 1] = sim.positions[v * 3 + 1];
    out[t * 3 + 2] = sim.positions[v * 3 + 2];
  }
  return out;
})();
const gridView = { positions: sim.positions, panelDims: sim.panelDims, index: (p: number, x: number, y: number) => sim.index(p, x, y) };
const neckCenter = { x: centerX, y: body.neckY, z: collision.centerZ };
// cov 몸통 대역 — **범위를 옷 명세에서 도출**한다(대역 자체는 몸 표면 기준
// 유지 = 규범 1). 구 정의는 yMin을 v1 `hemY`(토르소 캡슐 골반 하단)로 박아
// 두어 옷이 덮을 의무가 없는 구간까지 분모에 넣었다(2회차: bot-front
// 3,341/4,042가 그 구간). 신 정의는 패턴 총장에서 나온 **밑단 월드 높이**다.
// 정의 변경이므로 두 값을 같은 실행에서 병기한다(함정 8 계열).
const hemWorldY = g.draft.dims.ridgeAnchorY - g.draft.dims.lengthM;
const covBand = { yMax: body.shoulderJointY, neckCenter, neckRadius: 0.12, centerX, centerZ: collision.centerZ };
const covOld = computeBodyCoverage(position, [frontIdx, backIdx], gridView, [], { ...covBand, yMin: hemY }, clothTris);
const cov = computeBodyCoverage(position, [frontIdx, backIdx], gridView, [], { ...covBand, yMin: hemWorldY }, clothTris);
const band = deriveShoulderBand(position, wholeIndex, [pose.armLeft, pose.armRight], centerX);
const covSh = computeBodyCoverage(
  position, [wholeIndex], gridView, [],
  {
    yMin: band.yMin, yMax: band.yMax,
    neckCenter, neckRadius: 0.12,
    centerX, centerZ: collision.centerZ,
    outwardAxes: band.axes,
    sampleMask: band.mask,
  },
  clothTris,
);
const hoverOf = (r: typeof cov, keys: readonly string[]): { hit: number; mean: number; max: number } => {
  let samples = 0, hits = 0, sum = 0, max = 0;
  for (const k of keys) {
    const b = r.buckets[k];
    if (!b) continue;
    samples += b.samples;
    hits += b.samples - b.exposed;
    sum += b.hoverSumMm;
    if (b.hoverMaxMm > max) max = b.hoverMaxMm;
  }
  return { hit: samples ? hits / samples : 0, mean: hits ? sum / hits : 0, max };
};
const tf = hoverOf(covSh, ["top-front-left", "top-front-right"]);
const tb = hoverOf(covSh, ["top-back-left", "top-back-right"]);
const strain = maxStrain();
const penEnd = countInside(sim.positions, total, insideParity);
const prox = proximityPairs();
const xsec = countSelfIntersections(sim.positions, g.tris, g.edgePairs, 0.03);
const settleFrame = (() => {
  for (const e of result.log) if (e.to === "DONE") return e.frame;
  return -1;
})();

console.log(`\n[dress] 지표 (프레임 ${result.frames} · fixture ${fixtureHash} · pattern ${patternHash} · 경과 ${elapsedS.toFixed(1)}s · v1 기준선과 비교 금지)`);
console.log(
  `  cov 몸통(신 정의 yMin = 밑단 월드 ${cm(hemWorldY)}cm = 능선앵커 ${cm(g.draft.dims.ridgeAnchorY)} − 총장 ${cm(g.draft.dims.lengthM)}): 노출 ${cov.exposed}/${cov.samples} (${(cov.exposedRatio * 100).toFixed(1)}%)`,
);
console.log(
  `  cov 몸통(구 정의 yMin = hemY ${cm(hemY)}cm · 병기): 노출 ${covOld.exposed}/${covOld.samples} (${(covOld.exposedRatio * 100).toFixed(1)}%)`,
);
{
  // 노출 샘플의 높이 분포 — 대역 결함을 눈으로 확인할 채널.
  const hist: Record<string, number> = {};
  for (const p of cov.exposedExamples) void p;
  for (const [k, b] of Object.entries(cov.buckets)) hist[k] = b.exposed;
  void hist;
}
console.log(`  cov 몸통 버킷: ${JSON.stringify(Object.fromEntries(Object.entries(cov.buckets).map(([k, b]) => [k, `${b.exposed}/${b.samples}`])))}`);
console.log(`  covShoulder: 노출 ${covSh.exposed}/${covSh.samples} (${(covSh.exposedRatio * 100).toFixed(1)}%)`);
console.log(`  covShoulder 버킷: ${JSON.stringify(Object.fromEntries(Object.entries(covSh.buckets).map(([k, b]) => [k, `${b.exposed}/${b.samples}`])))}`);
console.log(`  shoulderHover top-front: hit ${tf.hit.toFixed(3)} / hover ${tf.mean.toFixed(2)}|${tf.max.toFixed(2)}mm`);
console.log(`  shoulderHover top-back : hit ${tb.hit.toFixed(3)} / hover ${tb.mean.toFixed(2)}|${tb.max.toFixed(2)}mm`);
console.log(`  maxStrain ${strain.v.toFixed(3)} (정점 ${strain.at}) · maxSeamGap ${(maxSeamGapM() * 1000).toFixed(2)}mm · Δ20 ${maxDelta20Mm().toFixed(2)}mm`);
console.log(
  `  proximityPairs(기록 채널 · 문턱 ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm · 게이트 아님 — 뭉친 폴드의 정상 접촉을 센다): ${prox}쌍`,
);
console.log(`  자기교차(엣지-삼각형 · 게이트): ${xsec.count}건 (배치 t=0 기준선 3건 = S0 투영 교정 산출물)`);
console.log(`  넥밴드 원주 제약 발화 누적: ${collarFired}회 = ${(collarFired / Math.max(1, result.frames)).toFixed(1)}/프레임 (링 42쌍 — 전 엣지가 매 프레임 상한에 걸림 = 상시 하중 지지)`);
console.log(`  관통(레이 패리티·비수밀 근사): 배치 후 ${penAfterPlace} → 정착 후 ${penEnd} / ${total}`);
console.log(`  정착 프레임 ${settleFrame} · 물리 ${(elapsedS * 1000 / Math.max(1, result.frames)).toFixed(1)}ms/프레임`);
if (result.failure) console.log(`  발산/중단: 상태 ${result.failure.state} · 프레임 ${result.failure.frame} · ${result.failure.reason}`);

if (DIAG) {
  // 상위 신장 제약 — 어느 종류·어느 패널·패턴 어디인지.
  const rows = sim.constraintPairs
    .map((c) => {
      const d = Math.hypot(
        sim.positions[c.b * 3] - sim.positions[c.a * 3],
        sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
        sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
      );
      return { c, ratio: c.restLength > 0 ? d / c.restLength : 0, d };
    })
    .sort((x, y) => y.ratio - x.ratio)
    .slice(0, 10);
  console.log("\n[dress·diag] 상위 신장 제약");
  for (const r of rows) {
    console.log(
      `  ${r.ratio.toFixed(2)}배 ${kindOf(r.c.a, r.c.b).padEnd(10)} ${PANEL_NAME[panelOfIdx(r.c.a)]}→${PANEL_NAME[panelOfIdx(r.c.b)]} · rest ${(r.c.restLength * 1000).toFixed(2)}mm → ${(r.d * 1000).toFixed(2)}mm · 패턴 a=(${cm(g.pos2[r.c.a * 2])},${cm(g.pos2[r.c.a * 2 + 1])})cm`,
    );
  }
  // 닫히지 않은 시접 쌍 사이에 **무엇이 있나** — 봉쇄의 정체를 직접 잰다.
  {
    const worst = g.seams
      .map((sm) => ({
        sm,
        d: Math.hypot(
          sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
          sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
          sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
        ),
      }))
      .sort((x, y) => y.d - x.d)
      .slice(0, 4);
    console.log("[dress·diag] 최대 시접 갭 쌍 — 두 점 사이에 몸이 있는가");
    for (const w of worst) {
      const mx = (sim.positions[w.sm.a * 3] + sim.positions[w.sm.b * 3]) / 2;
      const my = (sim.positions[w.sm.a * 3 + 1] + sim.positions[w.sm.b * 3 + 1]) / 2;
      const mz = (sim.positions[w.sm.a * 3 + 2] + sim.positions[w.sm.b * 3 + 2]) / 2;
      const insideMid = insideParity(mx, my, mz);
      const near = wholeMesh.closestPointUnsigned(mx, my, mz, SDF_FAR);
      console.log(
        `  ${w.sm.kind} 갭 ${(w.d * 1000).toFixed(1)}mm · a y${cm(sim.positions[w.sm.a * 3 + 1])} x${cm(sim.positions[w.sm.a * 3])} z${cm(sim.positions[w.sm.a * 3 + 2])} / b y${cm(sim.positions[w.sm.b * 3 + 1])} x${cm(sim.positions[w.sm.b * 3])} z${cm(sim.positions[w.sm.b * 3 + 2])} · 중점 ${insideMid ? "**몸 안쪽**" : "몸 밖"} · 중점→표면 ${near ? (near.distance * 1000).toFixed(1) : "?"}mm`,
      );
    }
  }
  // 관통 정점의 패널·대역 분포.
  {
    const per = [0, 0, 0, 0];
    const yBand: Record<string, number> = {};
    for (let i = 0; i < total; i++) {
      if (!insideParity(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2])) continue;
      per[panelOfIdx(i)]++;
      const yc = Math.round(sim.positions[i * 3 + 1] * 10) / 10;
      yBand[`y${yc.toFixed(1)}`] = (yBand[`y${yc.toFixed(1)}`] ?? 0) + 1;
    }
    console.log(`[dress·diag] 관통 패널별: ${PANEL_NAME.map((n, i) => `${n} ${per[i]}`).join(" / ")} · 높이대역 ${JSON.stringify(yBand)}`);
  }
  // 문턱 위반 쌍의 패널 조합 분포 — "폴드 접촉"인지 "패널 관통"인지 가른다.
  {
    const pairKind: Record<string, number> = {};
    const cell = g.selfCollisionMinDistM;
    for (let i = 0; i < total; i++) {
      for (let j = i + 1; j < total; j++) {
        const d = Math.abs(sim.positions[j * 3] - sim.positions[i * 3]);
        if (d > cell) continue;
        const dy = Math.abs(sim.positions[j * 3 + 1] - sim.positions[i * 3 + 1]);
        if (dy > cell) continue;
        const dz = Math.abs(sim.positions[j * 3 + 2] - sim.positions[i * 3 + 2]);
        if (dz > cell) continue;
        if (Math.hypot(d, dy, dz) >= cell) continue;
        if (skipKeys.has(i * 1_000_000 + j)) continue;
        const k = `${PANEL_NAME[panelOfIdx(i)]}↔${PANEL_NAME[panelOfIdx(j)]}`;
        pairKind[k] = (pairKind[k] ?? 0) + 1;
      }
    }
    console.log(`[dress·diag] 문턱 위반 쌍의 패널 조합: ${JSON.stringify(pairKind)}`);
  }
}

// ── 화면 판정용 최종 상태 덤프 (1급 게이트는 화면이다 — §2)
{
  const out = "public/dress-state.json";
  writeFileSync(out, JSON.stringify({
    patternHash, fixtureHash, frames: result.frames, state: result.state,
    garmentDims,
    positions: Array.from(sim.positions, (v) => Number(v.toFixed(5))),
  }));
  console.log(`\n[dress] 최종 상태 덤프 → ${out} (브라우저 ?patterncore=1&patternstate=1 로 렌더 · 커밋 대상 아님)`);
}

// ── 하드 게이트
const hard: { name: string; ok: boolean; detail: string }[] = [
  { name: "DONE 도달", ok: result.converged, detail: `종료 상태 ${result.state}` },
  { name: "RETRY ≤ 2", ok: result.retries <= 2, detail: `${result.retries}회` },
  { name: "발산 0", ok: !diverged(), detail: diverged() ? "NaN/Inf 또는 좌표 폭주" : "없음" },
  { name: "자기교차 0(엣지-삼각형)", ok: xsec.count === 0, detail: `${xsec.count}건 · [기록] proximityPairs ${prox}쌍` },
  { name: "정착 예산(S3 ≤720f)", ok: settleFrame >= 0, detail: settleFrame >= 0 ? `정착 f=${settleFrame}` : "미정착 — 연장 금지 규약대로 실패" },
];
console.log("\n[dress] 하드 게이트");
for (const h of hard) console.log(`  ${h.ok ? "PASS" : "FAIL"}  ${h.name} — ${h.detail}`);
const fails = hard.filter((h) => !h.ok);
console.log(
  `\n[dress] 판정: ${fails.length === 0 ? "통과 — v2 잠정 기준선 후보" : `실패 ${fails.length}건 — ${fails.map((h) => h.name).join(", ")}`} · 경과 ${elapsedS.toFixed(1)}s`,
);
process.exit(fails.length === 0 ? 0 : 1);
