// v2 T3 = Stage 2a-thin 스파이크 하네스 — 착장 상태기계(§4)의 **수렴/발산
// 이진**만 판정한다. 화면·지표 게이트 없음(§1.3: 패널이 조악하므로 화면
// 판정은 무의미하다).
//
// 왜 paramSweep이 아니라 별 스크립트인가: paramSweep의 fixture 경로는 v1
// 격자(COLS/ROWS·PANEL_FRONT·암홀 열 규약)를 전제로 900줄이 얽혀 있어,
// 패턴 패널을 그 안에 끼우면 두 옷이 한 함수에서 분기하는 계기가 된다.
// **공유는 물리·세션 계층에서 한다** — 이 스크립트는 제품과 같은
// `createGarmentSession`(garmentFrame.ts) + 같은 `runDressing`
// (dressingMachine.ts)을 호출하고, 워커도 2b에서 같은 두 함수를 호출한다
// (§4 계기 규칙·함정 12의 실질: 상태기계가 워커 안에 갇히지 않는 것).
//
// 진입: `PATTERNCORE=1 npm run spike:dressing`. 기본 off(DEFAULT_PATTERN_CORE).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { SelfCollision } from "../src/lib/selfCollision";
import { FABRIC_PRESETS } from "../src/lib/fabricPresets";
import { createGarmentSession, createPanelSplitResolver, buildArmCapsules } from "../src/lib/garmentFrame";
import type { GarmentFrameEnv } from "../src/lib/garmentFrame";
import { applyCapsuleCollision } from "../src/lib/torsoCapsule";
import type { Capsule } from "../src/lib/torsoCapsule";
import { buildSpikeGarment, PANEL_SPIKE_FRONT, PANEL_SPIKE_BACK } from "../src/lib/spikePanels";
import { runDressing } from "../src/lib/dressingMachine";
import { bakeSdf, createCachedSdfIterationFriction, createSdfFrictionPass, makeRadialSignedSampler, makeSkeletonSignedSampler } from "../src/lib/sdfCollision";
import { deriveBodySkeleton } from "../src/lib/bodySkeleton";
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
  SELF_COLLISION_MIN_DIST,
  SPIKE_EDGE_M,
  SUBSTEP_DT,
} from "../src/lib/clothConfig";

const t0 = performance.now();
const patternCore = process.env.PATTERNCORE != null ? process.env.PATTERNCORE !== "0" : DEFAULT_PATTERN_CORE;
if (!patternCore) {
  console.log("[spike] patternCore off(기본) — 아무것도 실행하지 않는다. PATTERNCORE=1로 진입.");
  process.exit(0);
}

const FIXTURE = process.env.FIXTURE ?? "scripts/fixtures/collision-fixture.json";
// 전체 프레임 예산 — S1(240) + S2(120) + S3(720) 합보다 넉넉해야 상태별
// 예산이 아니라 전체 예산이 판정을 가로채지 않는다(첫 실행에서 10s=600프레임이
// S3 예산 안에서 그 짓을 했다). 실측 수렴은 958프레임.
const SECONDS = process.env.SECONDS ? Number(process.env.SECONDS) : 25;
const FRAMES = Math.round(SECONDS * 60);
const raw = readFileSync(FIXTURE, "utf8");
const fixtureHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
const fixture = JSON.parse(raw);
const { layout, pose, collision } = fixture as {
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

const position = Float32Array.from(collision.position);
const toU32 = (a: number[] | null) => (a ? Uint32Array.from(a) : null);
const torsoIndexAll = (() => {
  const fi = collision.frontIndex ?? [];
  const bi = collision.backIndex ?? [];
  const out = new Uint32Array(fi.length + bi.length);
  out.set(fi, 0);
  out.set(bi, fi.length);
  return out;
})();

// ── 골격(팔 축·부호 기준의 단일 출처 — 1a 은행 자산).
const hemY = collision.capsules[collision.capsules.length - 1].bottom.y;
const skeleton = deriveBodySkeleton(
  position, torsoIndexAll, [pose.armLeft, pose.armRight],
  (pose.pinLeft.x + pose.pinRight.x) / 2, collision.centerZ, hemY,
);

// ── 패널 + 시접 테이블(전부 몸 실측 도출).
const garment = buildSpikeGarment(
  position,
  torsoIndexAll,
  [pose.armLeft, pose.armRight],
  skeleton,
  hemY,
  collision.centerZ,
  process.env.EDGE ? Number(process.env.EDGE) / 1000 : SPIKE_EDGE_M,
);
const { sim, seams, dims } = garment;
const particles = sim.positions.length / 3;
const seamCounts = seams.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] ?? 0) + 1 }), {});
console.log(
  `[spike] 패널 몸판 ${dims.cols}x${dims.rows} · 소매 ${dims.sleeveCols}x${dims.sleeveRows} · 엣지 ${(dims.edgeM * 1000).toFixed(0)}mm · 파티클 ${particles} · 제약 ${sim.constraintPairs.length}`,
);
console.log(
  `[spike] 몸 실측: 둘레 ${(dims.girthM * 100).toFixed(1)}cm(몸판 폭 ${((dims.girthM / 2) * 100).toFixed(1)}cm) · 길이 ${(dims.heightM * 100).toFixed(1)}cm · 암홀행 ${dims.armholeRow} · 목구멍 ${dims.neckGapCols}열`,
);
console.log(`[spike] 시접 ${seams.length}쌍 ${JSON.stringify(seamCounts)} · target ${(seams[0].target * 1000).toFixed(1)}mm · 이즈 0`);

// ── 접촉 모드: 1b 분기 결과에 따라 **흡착**(BVH 기본 경로, penetrationAxis
// 미전달 = 탐지 반경 안이면 항상 margin으로 끌어당김). 1b 실측이 관통-only의
// 붕괴를 확인했으므로(cov 6.4→54.2%) 스파이크는 흡착으로 돈다.
const frontMesh = new ArrayBvhCollision();
const backMesh = new ArrayBvhCollision();
frontMesh.rebuild(position, toU32(collision.frontIndex));
backMesh.rebuild(position, toU32(collision.backIndex));
const armCapsules = [...buildArmCapsules(pose.armLeft), ...buildArmCapsules(pose.armRight)];
const panelCounts = [0, 1, 2, 3].map((p) => sim.panelParticleCount(p));
const meshResolver = createPanelSplitResolver(
  [
    frontMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS),
    backMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS),
    null,
    null,
  ],
  panelCounts,
);
// createUnifiedResolver는 v1 패널 크기(PARTICLES_PER_PANEL)를 상수로 박고
// 있어 스파이크 격자에 못 쓴다 — **같은 프리미티브**로 같은 순서를 다시
// 조립한다(몸통 캡슐 → 팔 캡슐, 몸판/소매 전부).
const unified = (positions: Float32Array, pinned: Uint8Array, n: number): void => {
  meshResolver(positions, pinned, n);
  let offset = 0;
  for (let p = 0; p < panelCounts.length; p++) {
    const count = panelCounts[p];
    const pos = positions.subarray(offset * 3, (offset + count) * 3);
    const pin = pinned.subarray(offset, offset + count);
    // 몸판만 몸통 캡슐(소매는 팔 캡슐이 담당 — v1과 같은 역할 분담).
    if (p === PANEL_SPIKE_FRONT || p === PANEL_SPIKE_BACK) {
      applyCapsuleCollision(pos, pin, count, collision.capsules, COLLISION_MARGIN);
    }
    applyCapsuleCollision(pos, pin, count, armCapsules, 0.006);
    offset += count;
  }
  void n;
};

// ── 마찰 스택: 제품(신 코어)과 같은 2단(서브스텝 말미 속도 보정 +
// 반복 안 위치 마찰). 1b와 같은 스택.
const wholeMesh = new ArrayBvhCollision();
wholeMesh.rebuild(position, toU32(collision.wholeBodyIndex));
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
const sdfMin = { x: minX - pad, y: yBot, z: minZ - pad };
const sdfMax = { x: maxX + pad, y: yTop, z: maxZ + pad };
const tBake = performance.now();
const sdfField = bakeSdf(
  makeRadialSignedSampler(wholeMesh, (sdfMin.x + sdfMax.x) / 2, (sdfMin.z + sdfMax.z) / 2, SDF_FAR, SDF_FAR),
  sdfMin, sdfMax, SDF_VOXEL, SDF_FAR,
);
console.log(
  `[spike] SDF 굽기 ${sdfField.nx}x${sdfField.ny}x${sdfField.nz}(${((sdfField.nx * sdfField.ny * sdfField.nz) / 1000).toFixed(1)}k복셀 · 복셀 ${(SDF_VOXEL * 1000).toFixed(0)}mm) elapsedMs ${Math.round(performance.now() - tBake)}`,
);
const fparams = { contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_ITER, muKinetic: FRICTION_MU_ITER, localMuGain: LOCAL_MU_GAIN };
const cachedFric = createCachedSdfIterationFriction(() => sdfField, fparams);

// ── S0 관통 판정: 골격 부호 샘플러(1a 은행 자산). 몸 안쪽이 음수.
const signedAt = makeSkeletonSignedSampler(wholeMesh, skeleton.segments, SDF_FAR, SDF_FAR);
const countPenetrating = (): number => {
  let n = 0;
  for (let i = 0; i < particles; i++) {
    if (signedAt(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2]) < 0) n++;
  }
  return n;
};

// ── 세션: v1 후처리는 전부 off(패턴 패널에 의미가 없다). pinCorners:false +
// 앵커 공급으로 §4 S1의 "착장 중에만 켜는 임시 배치 앵커"를 만든다.
let anchorStrength = 0;
// 앵커 대상 = 어깨선 시접 정점(배치 시점 좌표로 고정) — 하드 핀이 아니다.
const anchorList = seams
  .filter((s) => s.kind === "shoulder")
  .map((s) => ({ i: s.a, x: sim.positions[s.a * 3], y: sim.positions[s.a * 3 + 1], z: sim.positions[s.a * 3 + 2] }));
const selfCollision = new SelfCollision(garment.panelStarts, garment.panelCols, 0, garment.seamSkipPairs).createResolver(SELF_COLLISION_MIN_DIST);
const env: GarmentFrameEnv = {
  collisionResolver: unified,
  collisionEvery: COLLISION_EVERY,
  selfCollision,
  orderColumn: false,
  orderRow: false,
  clampInSubstep: true,
  smoothing: false,
  postOrder: false,
  armSoftPull: false,
  necklineHug: false,
  sleeveArmPull: false,
  yAlign: false,
  symmetry: false,
  clampAfterPost: false,
  maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
  friction: createSdfFrictionPass(() => sdfField, {
    contactBand: FRICTION_CONTACT_BAND,
    muStatic: FRICTION_MU_STATIC,
    muKinetic: FRICTION_MU_KINETIC,
  }),
  frictionIteration: cachedFric.apply,
  frictionIterationReset: cachedFric.reset,
  pinCorners: false,
  anchors: () => anchorList,
  pinContinuous: true,
  pinStrength: anchorStrength,
  anchorSyncPrev: true,
};
const session = createGarmentSession(sim, env);

// ── 진단 채널.
const prevFrame = new Float32Array(sim.positions.length);
prevFrame.set(sim.positions);
const deltaHist: number[] = [];
const maxDelta20Mm = (): number => (deltaHist.length ? Math.max(...deltaHist.slice(-20)) : Infinity);
const maxSeamGapM = (): number => {
  let m = 0;
  for (const s of seams) {
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

const gravity = new THREE.Vector3(0, -9.81, 0);
const preset = FABRIC_PRESETS[pose.fabric];
const frameLayout = { widthM: layout.widthM, heightM: dims.heightM, topY: layout.topY, centerZ: collision.centerZ, sleeveWidthM: layout.sleeveWidthM };
const framePose = { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft: pose.armLeft, armRight: pose.armRight };

const result = runDressing(
  sim, session, seams,
  {
    rampFrames: 120,
    // §4 S1 (ii)의 N — "추정 60, Stage 2b 확정".
    stallFrames: 60,
    seamSlackM: 0.01,
    // §4 S3 — 현 문턱 승계(Δ20 ≤ 5.6mm 연속 20프레임).
    settleDeltaMm: 5.6,
    settleFrames: 20,
    // 예산은 **§4가 준 값**을 쓴다: S3 = V5 ≤12s = 720프레임. 첫 실행에서
    // S3를 240으로 잡았다가 "S3 예산 초과"로 실패했는데, 그건 설계 예산보다
    // 3배 빡빡한 내 계기 설정이었다 — 물리 판정이 아니라 계기 판정이 된다.
    budget: { S0: 1, S1: 240, S2: 120, S3: 720 },
  },
  {
    place: garment.place,
    countPenetrating,
    diverged,
    maxSeamGapM,
    maxDelta20Mm,
    onFrame: () => {
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

// ── 상태 전이 로그(규범 4: 프레임·경과 시간 병기).
console.log(`[spike] 상태 전이 로그 (fixture ${fixtureHash} · 예산 ${FRAMES}프레임)`);
for (const e of result.log) {
  console.log(`  f=${String(e.frame).padStart(4)} ${String(e.elapsedMs).padStart(6)}ms  ${e.from} → ${e.to}  retry=${e.retry}  ${e.reason}`);
}
const strain = (() => {
  let m = 0;
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    const d = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    if (d / c.restLength > m) m = d / c.restLength;
  }
  return m;
})();
console.log(
  `[spike] 진단: seamGap max ${(maxSeamGapM() * 1000).toFixed(1)}mm · Δ20 ${maxDelta20Mm().toFixed(2)}mm · maxStrain ${strain.toFixed(2)} · 관통 정점 ${countPenetrating()} · 물리 ${((performance.now() - t0) / Math.max(1, result.frames)).toFixed(1)}ms/프레임`,
);
if (result.failure) console.log(`[spike] 발산/중단 지점: 상태 ${result.failure.state} · 프레임 ${result.failure.frame} · ${result.failure.reason}`);
// 이진 게이트 — 화면·지표 없음.
console.log(
  `[spike] 게이트(이진): ${result.converged ? "수렴 통과" : "발산/미수렴 실패"} — 종료 상태 ${result.state} · ${result.frames}프레임 · RETRY ${result.retries} · 경과 ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
process.exit(result.converged ? 0 : 1);
