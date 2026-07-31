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
import { deriveBodySkeleton, nearestOnSegments } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { buildPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT, PATTERN_EDGE_INTERIOR_M } from "../src/lib/patternGarment";
import { makeOutlineProvider } from "../src/lib/bodyOutline";
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

// 착장 앵커는 **기본 off**(§4 개정: 앵커 층위 4연속 실패로 소진). 롤백 수단
// 으로만 보존한다 — `PINDRESS=1`.
const PINDRESS = process.env.PINDRESS === "1";
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
const outlineTorso = new ArrayBvhCollision();
outlineTorso.rebuild(position, torsoIndex);
const outlineWhole = new ArrayBvhCollision();
outlineWhole.rebuild(position, wholeIndex ?? torsoIndex);
const outlineAt = makeOutlineProvider(
  outlineTorso, outlineWhole,
  (h) => { const sl = body.slices.reduce((b, s2) => (Math.abs(s2.y - h) < Math.abs(b.y - h) ? s2 : b), body.slices[0]); return [sl.axisX, sl.axisZ]; },
  PATTERN_EDGE_INTERIOR_M,
);
const g = buildPatternGarment(body, garmentDims, arms, outlineAt);
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
// S0 투영 교정은 **하네스가 덧붙인 것**이지 §4 S0의 명세 기제가 아니다(명세는
// 오프셋 확대). 배치 원본 자기교차가 0인데 교정 후가 수백 건이면 교정이 순손해
// 이므로, 무력화 변이를 상시 스위치로 둔다: `S0FIX=0`.
const S0FIX = process.env.S0FIX !== "0";
const penBefore = countInside(g.positions, total, insideParity);
const corrected = S0FIX ? correctPlacementPenetration(
  g.positions, total, wholeMesh, insideParity, COLLISION_MARGIN, g.selfCollisionMinDistM, skipKeys, SDF_FAR,
) : 0;
const penAfterPlace = countInside(g.positions, total, insideParity);
console.log(`[dress] S0 배치 관통: ${penBefore} → 교정 ${corrected}정점 → ${penAfterPlace} (패리티 근사)${S0FIX ? "" : " · **교정 off(S0FIX=0)**"}`);
// ── t=0 게이트 (§4 S0 개정 — 목 스레딩 배치가 성립했는가)
const t0Fails: string[] = [];
{
  const xs0 = countSelfIntersections(g.positions, g.tris, g.edgePairs, 0.03);
  const ok1 = xs0.count <= 3;
  console.log(`[dress] t=0 자기교차(엣지-삼각형): ${xs0.count}건 (기준선 3 이하 ${ok1 ? "OK" : "**초과**"})`);
  if (!ok1) t0Fails.push("t=0 자기교차 ≤3");
  if (penAfterPlace !== 0) t0Fails.push("t=0 배치 관통 0");

  // 링 원주 + "링 안에 목이 있는가"
  let ringM = 0;
  for (const e of g.necklineRing) {
    ringM += Math.hypot(
      g.positions[e.b * 3] - g.positions[e.a * 3],
      g.positions[e.b * 3 + 1] - g.positions[e.a * 3 + 1],
      g.positions[e.b * 3 + 2] - g.positions[e.a * 3 + 2],
    );
  }
  const okRing = Math.abs(ringM - g.draft.dims.necklineGirthM) < 0.005;
  console.log(`[dress] t=0 링 원주 ${cm(ringM)}cm vs 패턴 목선 ${cm(g.draft.dims.necklineGirthM)}cm ${okRing ? "OK" : "**불일치**"}`);
  if (!okRing) t0Fails.push("t=0 링 원주");

  // 링 안에 목 기둥이 들어갔나 — **수평 투영 점-다각형**으로 판정한다.
  //
  // 9회차까지의 판정은 "링 정점의 목축 거리 > 그 높이 단면의 max(width,depth)/2"
  // 였는데, 목선은 어깨에 걸치는 **안장 곡선**이라 그 높이의 단면이 어깨(또는
  // 턱)를 포함한다 — 8회차 8.23cm는 턱, 9회차 8.91cm는 어깨였고 목 기둥 반경은
  // 둘레 32.38cm에서 5.15cm다. 이름이 주장하는 양을 재고 있지 않았다(함정 13).
  // 스레딩은 원래 위상 질문이므로 높이에 의존하지 않는 판정을 쓴다.
  const ringIdx = [...new Set(g.necklineRing.flatMap((e) => [e.a, e.b]))];
  const ringY = ringIdx.reduce((a, i) => a + g.positions[i * 3 + 1], 0) / ringIdx.length;
  // 링은 앞목·뒤목 두 **열린 사슬**이다(패널을 넘는 접합은 rest 오염 때문에
  // 일부러 뺐다 — patternGarment 주석). 폐곡선을 만들려면 두 사슬을 목점에서
  // 이어야 하고, 목선은 패턴 x에 대해 단조라 x로 정렬하면 그 순서가 나온다.
  const ringLoop = (() => {
    const backStart = g.panelStarts[PANEL_PAT_BACK];
    const front = ringIdx.filter((i) => i < backStart).sort((a, b) => g.pos2[a * 2] - g.pos2[b * 2]);
    const back = ringIdx.filter((i) => i >= backStart).sort((a, b) => g.pos2[b * 2] - g.pos2[a * 2]);
    return [...front, ...back];
  })();
  const insideLoopXZ = (px: number, pz: number): boolean => {
    let c = false;
    for (let i = 0, j = ringLoop.length - 1; i < ringLoop.length; j = i++) {
      const x1 = g.positions[ringLoop[i] * 3], z1 = g.positions[ringLoop[i] * 3 + 2];
      const x2 = g.positions[ringLoop[j] * 3], z2 = g.positions[ringLoop[j] * 3 + 2];
      if ((z1 > pz) !== (z2 > pz) && px < x1 + ((pz - z1) / (z2 - z1)) * (x2 - x1)) c = !c;
    }
    return c;
  };
  const neckSlice = body.slices.reduce(
    (best, sl) => (Math.abs(sl.y - body.neckY) < Math.abs(best.y - body.neckY) ? sl : best), body.slices[0],
  );
  const okThread = insideLoopXZ(neckSlice.axisX, neckSlice.axisZ);
  // 변이 역검증 — 목축을 링 밖(반경 1m)으로 옮기면 반드시 false여야 한다.
  const mutOut = insideLoopXZ(neckSlice.axisX + 1, neckSlice.axisZ);
  let minD = Infinity, maxD = 0;
  for (const i of ringIdx) {
    const d = Math.hypot(g.positions[i * 3] - neckSlice.axisX, g.positions[i * 3 + 2] - neckSlice.axisZ);
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  console.log(
    `[dress] t=0 목 스레딩 검사(수평 투영 점-다각형): 링 정점 ${ringIdx.length}개(폐곡선 ${ringLoop.length}) · 링 높이 y${cm(ringY)}cm · 목축(${cm(neckSlice.axisX)},${cm(neckSlice.axisZ)}) → ${okThread ? "**링 안에 목이 있다**" : "**링이 목을 감싸지 못했다**"} · 변이 역검증(목축 +1m) ${mutOut ? "**실패(밖인데 안이라고 함)**" : "OK"} · [기록] 링 정점의 목축 거리 ${cm(minD)}~${cm(maxD)}cm`,
  );
  if (mutOut) t0Fails.push("목 스레딩 판정기 변이 역검증");
  if (!okThread) t0Fails.push("t=0 목 스레딩");
  console.log(`[dress] t=0 게이트: ${t0Fails.length === 0 ? "통과" : `실패 ${t0Fails.join(", ")}`}`);
}

// t=0 게이트가 실패하면 **물리로 넘어가지 않는다**. 9회차까지 이 차단이 배선돼
// 있지 않아 게이트를 찍고도 720프레임을 돌렸고, 무효 배치에서 나온 cov·strain·
// 정착 프레임이 로그에 남았다(계기가 아니라 입력이 무효라 판정 자료가 될 수
// 없는 값들이다). 게이트는 "통과 시에만 물리"라는 뜻이어야 한다.
if (t0Fails.length > 0) {
  console.log(`[dress] **정지** — t=0 게이트 ${t0Fails.length}건 실패. 물리를 실행하지 않는다(무효 배치의 물리값은 판정 자료가 아니다).`);
  process.exit(1);
}

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
console.log(
  `[dress] 어깨 봉합: 용접 ${ps.weldedShoulderPairs}쌍(19회차부터 **반납** — 평면 배치와 배타적) · 어깨를 포함한 전 시접이 S1 램프 대상 · 착장 앵커 ${PINDRESS ? "**on**(PINDRESS=1)" : "off(기본)"}`,
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
// 21회차 — 링 제약의 **시점 분리**. 아래 beforeStep 주석 참고.
let seamClosedAtFrame = -1;
let ringLimitStart = COLLAR_STRAIN_LIMIT;
let ringMaxBeforeCloseM = 0;
// ── 26회차: **링 총 길이 상한**.
//
// 표적은 한 줄이다 — 링이 rest로 수렴하지 않는다(25회차 최종 104.54cm vs
// rest 49.44cm = 2.11배). 21회차가 그 원인을 실측했다: `limitCollarStrain`은
// **엣지별** 상한이라 각 엣지가 1.2배씩 늘면 총 길이는 누적으로 2.7배가 된다.
// **엣지별 상한 강화로는 대체할 수 없다**(21회차가 그 경로의 실패를 이미 쟀다).
//
// ## 적용 방식 (구현 전 명시)
// 총 길이는 링 전체에 걸린 **전역 양**이라 PBD 반복 안의 국소 제약으로
// 표현되지 않는다. clothPhysics를 건드리지 않으려면 솔버 **밖에서** 한 번
// 투영하는 것이 유일한 경로이므로, `session.step` 직후(`onFrame`)에
// **매 프레임 1회 사후 투영**한다. 투영은 링 무게중심 기준 **등방 축소**다 —
// 모든 현이 같은 배율로 줄어 총 길이가 정확히 상한이 되므로 반복이 필요 없다.
// **상시**로 건다(착장 단계 조건부로 하면 21·22회차처럼 전이 타이밍이 새 변수가 된다).
//
// ## 기존 스택과의 상호작용
//  (i)  엣지별 칼라 상한은 **그대로 둔다** — 총 길이가 맞아도 한 엣지에 몰리는
//       것을 막는 상보 제약이다.
//  (ii) 시접은 링 정점 중 목점 2개에만 걸리는데, 축소가 그 둘을 **같은 배율**로
//       옮기므로 갭이 배율만큼 줄어든다(벌리지 않는다).
//  (iii) 핀은 링 정점에 하나도 안 걸린다(24회차에 목점을 앵커에서 뺐다) —
//       축소가 핀과 싸우지 않는다.
//  (iv) 축소는 링을 몸 쪽으로 당기고 충돌 해소가 반작용으로 밀어낸다. 그
//       균형점이 목선의 안착 위치가 된다.
//
// ## 계수 — **재단/착용 근거에서 도출**(화면 보고 내리는 튜닝 금지)
// 풀오버의 목선이 설계상 늘어나야 하는 최대치는 **머리가 통과할 때**다. 그
// 이상은 착용이 아니라 손상이다. 그래서 상한 = 머리 최대 둘레로 잡고, 계수는
// 그것을 링 rest로 나눈 **도출값**이다(체형이 바뀌면 따라 움직인다).
// 머리 대역은 목 최소 단면(neckY) **위** 슬라이스이고 둘레 계기는 몸통과 같다.
// (추정: "머리 통과 이상은 필요 없다"는 재단 관행의 해석이고 이 저장소의
//  실측으로 확정된 것이 아니다 — Stage 2c 체형 일반화에서 확인할 것.)
const headGirthM = body.slices.reduce((m, sl) => (sl.y > body.neckY && sl.girthM > m ? sl.girthM : m), 0);
let ringTotalMaxM = 0;
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

// ── 넥밴드 원주 제약 (2회차 단일 변경) — v1 칼라 기계를 패턴 목선 링에 배선.
// 실물 부품(리브)이고 보조 힘이 아니다. clothPhysics는 이 기계를 이미 갖고
// 있어 수정 0줄.
// ── 25회차: 링을 **폐곡선**으로 닫는다.
// 24회차 힘 분해 — `necklineRing`은 앞목·뒤목 **두 개의 열린 사슬**이고 그
// **끝점이 곧 목점**이라, 각 사슬이 수축하면 앞목점은 앞판 중심으로 뒤목점은
// 뒤판 중심으로 **서로 반대로** 당겨진다(링 길이 ↔ 목점 갭이 반대 위상 진동).
// 닫으면 목점 접합 구간이 원주의 일부가 되므로 **수축의 부호가 뒤집힌다** —
// 같은 힘이 목점을 밀어내는 대신 당긴다.
//
// 구현은 ①(목점 쌍을 링 엣지로 추가)이다. ②(제약 없이 수축 적용 범위만 확장)를
// 선호했으나 `limitCollarStrain`은 **엣지 단위** 기계라 총 원주 항이 없다 —
// clothPhysics 수정 없이는 불가능하다. 시접과 중복되지만 rest가 같으므로
// (아래) 그 두 쌍의 강성이 두 배가 되는 것 외의 부작용은 없다.
//
// §3.3.1: 예전에 이 접합을 뺀 이유는 rest가 **배치 거리**(31cm)로 굳는다는 것이
// 었는데, 평면 배치에서는 그 값이 배치가 아니라 **봉제 명세**에서 나온다 —
// 접합의 rest는 시접 target 그 자체다. 아래에서 그 값을 강제로 심는다
// (`setCollarRing`이 현재 좌표에서 rest를 뜨므로, 그 두 쌍만 target 거리로
//  잠깐 옮겼다 되돌린다 — clothPhysics 무수정).
const ringJoinPairs = (() => {
  const ringVerts = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
  return g.seams.filter((sm) => sm.kind === "shoulder" && ringVerts.has(sm.a) && ringVerts.has(sm.b));
})();
const ringClosed = [...g.necklineRing, ...ringJoinPairs.map((sm) => ({ a: sm.a, b: sm.b }))];
{
  const joinRestM = Math.max(...g.seams.map((sm) => sm.targetM));
  const saved = ringJoinPairs.map((sm) => [
    sim.positions[sm.b * 3], sim.positions[sm.b * 3 + 1], sim.positions[sm.b * 3 + 2],
  ] as [number, number, number]);
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
  // 배선 검증 — 위상이 실제로 닫혔는가(전 정점 차수 2 · 단일 순환).
  const deg = new Map<number, number>();
  const adj = new Map<number, number[]>();
  for (const e of ringClosed) {
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) {
      deg.set(x, (deg.get(x) ?? 0) + 1);
      (adj.get(x) ?? adj.set(x, []).get(x)!).push(y);
    }
  }
  const start = ringClosed[0].a;
  let prev = -1, cur = start, visited = 0;
  for (let i = 0; i < ringClosed.length + 2; i++) {
    visited++;
    const nb = adj.get(cur)!;
    const nxt = nb.find((v) => v !== prev) ?? nb[0];
    prev = cur; cur = nxt;
    if (cur === start) break;
  }
  const allDeg2 = [...deg.values()].every((d) => d === 2);
  console.log(
    `[dress] 링 폐곡선화: 엣지 ${g.necklineRing.length} + 접합 ${ringJoinPairs.length} = ${ringClosed.length} · 정점 ${deg.size} · 전 정점 차수 2 ${allDeg2 ? "OK" : "**아님**"} · 순회 복귀 ${visited}/${deg.size} ${visited === deg.size ? "OK(단일 순환)" : "**분리됨**"} · 접합 rest ${(joinRestM * 1000).toFixed(1)}mm(= 시접 target)`,
  );
}
{
  let ringM = 0;
  for (const e of g.necklineRing) {
    ringM += Math.hypot(
      sim.positions[e.b * 3] - sim.positions[e.a * 3],
      sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1],
      sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2],
    );
  }
  ringRestM = ringM + 2 * Math.max(...g.seams.map((sm) => sm.targetM));
  ringTotalMaxM = headGirthM;
  console.log(
    `[dress] 링 **총 길이** 상한: ${cm(ringTotalMaxM)}cm = 머리 최대 둘레(목 최소 단면 위 슬라이스 최대) · rest ${cm(ringRestM)}cm 대비 계수 **${(ringTotalMaxM / Math.max(1e-9, ringRestM)).toFixed(3)}**(도출) · 적용 = step 직후 무게중심 등방 축소 1회/프레임(상시) · 엣지별 상한은 병존`,
  );
  const targetM = g.draft.dims.necklineGirthM;
  const errCm = (ringM - targetM) * 100;
  console.log(
    `[dress] 넥밴드 원주 제약: 링 엣지 ${g.necklineRing.length}쌍 · 배치 실측 원주 ${cm(ringM)}cm vs 패턴 목선 ${cm(targetM)}cm (오차 ${errCm.toFixed(3)}cm) · 신장 상한 ${COLLAR_STRAIN_LIMIT}(v1 승계·추정)`,
  );
  if (g.necklineRing.length === 0) throw new Error("넥밴드 링 제약 0쌍 — 배선 실패");
  {
    let joinM = 0;
    for (const sm of ringJoinPairs) {
      joinM += Math.hypot(
        sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
        sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
        sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
      );
    }
    console.log(`  [링·폐곡선 실측] 앞목+뒤목 ${cm(ringM)}cm + 접합 2구간 ${cm(joinM)}cm(배치 거리) = ${cm(ringM + joinM)}cm · rest 기준 접합은 ${(2 * Math.max(...g.seams.map((sm) => sm.targetM)) * 100).toFixed(2)}cm`);
  }
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
let ringTotalFired = 0;

// 목점(어깨 시접의 첫 쌍) 전역 인덱스 — 닫힘 시점 기록용.
const neckPointPairs = g.seams.filter((x) => x.kind === "shoulder")
  .map((x) => ({ ...x, d2: Math.hypot(g.pos2[x.a * 2] - 0, g.pos2[x.a * 2 + 1] - 0) }))
  .sort((x, y) => x.d2 - y.d2)
  .slice(0, 2);
let closureLog: string | null = null;
// ── 앵커 목표 (5회차 단일 변경): 배치 시점 좌표 → **어깨 능선 최근접 표면점**
// §4 S0/S1의 문구는 "목표 = 배치 시점 좌표"였다. 그 목표는 앞판의 배치 z
// (몸통 축 +11.9cm — 몸 두께를 피해 놓은 위치)를 그대로 가리키므로, 앵커를
// 봉합까지 유지하면 **봉합 목표 지점 자체가 공중**에 남는다(4회차 실측:
// 앞 목점 z+10.02 / 뒤 목점 z+4.76, 중점은 몸 밖 50.5mm). 실물에서 어깨
// 이음선이 가야 하는 곳은 배치 평면이 아니라 **어깨 능선**이므로 목표를
// 그 표면점으로 바꾼다. 능선 집합은 2a 계기의 능선 전용 집합
// (`bodyMeasure.ridgePoints`, 팔 제외 없음·목 최소 높이 상한)을 그대로
// 재사용하고 새 상수는 없다.
// 목표는 **호장 비율 매핑**이다(6회차 단일 변경). 5회차는 정점마다 독립적으로
// 최근접 능선점을 골랐고, 그 결과 46개 앵커가 42개 표본(1cm 간격)에 몰려
// 어깨선의 순서·간격이 보존되지 않았다 — 목점이 패턴 x 5.90cm에서 관측
// x 9.0cm로 3.1cm 밀렸다. 여기서는 어깨 이음선의 호장 비율 s∈[0,1]을
// 능선 곡선의 같은 호장 비율에 대응시킨다:
//   s=0 → 능선의 **목 쪽 끝**(|x| = 목너비)   s=1 → 능선의 바깥 끝
// 능선 표본은 1cm 간격이라 선형 보간으로 충분하다.
const anchorList = (() => {
  const nwHalf = g.draft.dims.neckHalfWidthM;
  // 능선 곡선을 좌·우로 나눠 |x| 오름차순 폴리라인으로 만들고, 목너비 밖만 쓴다.
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
  const curves = new Map<number, { p: { x: number; y: number; z: number }; cum: number }[]>([
    [1, sideCurve(1)], [-1, sideCurve(-1)],
  ]);
  const at = (sign: number, s: number): { x: number; y: number; z: number } => {
    const c = curves.get(sign)!;
    const total = c[c.length - 1].cum;
    const target = total * Math.min(1, Math.max(0, s));
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
  // 어깨 이음선의 호장 비율 — 패턴 좌표에서 목점→어깨점 거리 비.
  const shoulderSeamM = g.draft.dims.shoulderSeamM;
  // 24회차 — **목점 2개를 앵커 집합에서 뺀다**(제약 중복 제거).
  // 목점은 링의 끝점이라 **링 원주 제약이 이미 위치를 정한다**. 거기에 앵커까지
  // 걸면 두 목표가 경쟁하고, 23회차 실측이 그 경쟁의 크기를 8.87cm(핀 잔차)로
  // 찍었다 — 시접 쌍은 능선이 **아닌 곳**에서 10.0mm까지 만났는데 앵커가 앞판만
  // 능선 목표로 끌어 쌍을 벌렸다. **앵커는 봉합을 유지하는 힘이 아니라 찢는
  // 힘이었다.** 힘을 더하거나 목표를 새로 만드는 게 아니라 중복을 없앤다.
  // 식별은 도출이다 — **링 정점이면서 어깨 시접의 정점**(= 공유 코너의 정의).
  const ringVerts = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
  return g.seams
    .filter((sm) => sm.kind === "shoulder")
    .filter((sm) => !(ringVerts.has(sm.a) || ringVerts.has(sm.b)))
    .map((sm) => {
      const px = g.pos2[sm.a * 2], py = g.pos2[sm.a * 2 + 1];
      const s = Math.hypot(Math.abs(px) - nwHalf, py) / Math.max(1e-9, shoulderSeamM);
      const t = at(Math.sign(px) || 1, s);
      // 20회차 단일 변경: 목표를 능선 **표면 위 margin**으로 올린다.
      // 19회차는 목표가 표면 위(거리 0)였는데, 천은 충돌 해소가 항상 margin
      // 만큼 밖으로 밀어내므로 **뒤판이 그 점에 도달할 수 없다** — 앞판만 핀으로
      // 거기 박혀 있고 뒤판은 영원히 margin 밖에 머문다(실측: 목점 2쌍 갭
      // 26.5/26.8mm, 두 점의 중점이 표면 거리 0.00~0.01cm = 몸을 사이에 두고
      // 마주 봄). 능선점은 정의상 그 x의 **최상단** 표면점이라 바깥 방향이 +y다.
      return { i: sm.a, x: t.x, y: t.y + COLLISION_MARGIN, z: t.z, s, sign: Math.sign(px) || 1 };
    });
})();
{
  // 배선 검증 — 목표가 배치 평면(z ≈ +11.9cm)과 구분되는지 + 전부 몸 표면 위인지.
  const ys = anchorList.map((a) => a.y), zs = anchorList.map((a) => a.z);
  let worstOffSurfaceMm = 0;
  for (const a of anchorList) {
    const c = wholeMesh.closestPointUnsigned(a.x, a.y, a.z, SDF_FAR);
    if (c && c.distance * 1000 > worstOffSurfaceMm) worstOffSurfaceMm = c.distance * 1000;
  }
  const placedZ = g.positions[anchorList[0].i * 3 + 2];
  // 배선 검증(24회차) — 제외분이 실제로 링·어깨 시접 양쪽에 속하는가.
  {
    const ringVerts = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
    const shoulder = g.seams.filter((sm) => sm.kind === "shoulder");
    const excluded = shoulder.filter((sm) => ringVerts.has(sm.a) || ringVerts.has(sm.b));
    console.log(
      `  [앵커·제외검증] 어깨 시접 ${shoulder.length}쌍 중 앵커 ${anchorList.length}개(제외 ${excluded.length}개) · 제외분 패턴 ${excluded.map((sm) => `(${cm(g.pos2[sm.a * 2])},${cm(g.pos2[sm.a * 2 + 1])})`).join(" ")} · 전부 링 정점 ${excluded.every((sm) => ringVerts.has(sm.a) && ringVerts.has(sm.b)) ? "OK(앞뒤 모두)" : "**일부만**"}`,
    );
  }
  // 배선 검증(20회차) — 목표가 **전 열에서** 그 x의 승모근 상단보다 위인가.
  let minClearMm = Infinity, worstAt = 0;
  for (const a of anchorList) {
    const top = body.ridgeTopYAt(Math.abs(a.x - body.centerX));
    const clearMm = (a.y - top) * 1000;
    if (clearMm < minClearMm) { minClearMm = clearMm; worstAt = Math.abs(a.x - body.centerX); }
  }
  console.log(
    `[dress] 앵커 목표 = 능선 호장 매핑 + 오프셋 ${anchorList.length}개 · y ${cm(Math.min(...ys))}~${cm(Math.max(...ys))}cm · z ${cm(Math.min(...zs))}~${cm(Math.max(...zs))}cm (배치 평면 z ${cm(placedZ)}cm과 구분됨) · 표면 이탈 ${worstOffSurfaceMm.toFixed(2)}mm(= 오프셋 ${(COLLISION_MARGIN * 1000).toFixed(1)}mm) · 능선 표본 ${body.ridgePoints.length}개(1cm 간격)`,
  );
  const clearOk = minClearMm > 0;
  console.log(
    `  [앵커·배선검증] 승모근 상단 대비 여유 최소 ${minClearMm.toFixed(2)}mm @|x|${cm(worstAt)}cm → ${clearOk ? "전 열에서 위 OK" : "**아래 있음(교착 재발 위험)**"}`,
  );
  // 목점(s≈0) 목표 x가 패턴 목너비로 돌아왔는지 + 순서·간격 단조성.
  for (const sign of [1, -1]) {
    const side = anchorList.filter((a) => a.sign === sign).sort((a, b) => a.s - b.s);
    const neck = side[0];
    const gaps: number[] = [];
    for (let i = 1; i < side.length; i++) {
      gaps.push(Math.hypot(side[i].x - side[i - 1].x, side[i].y - side[i - 1].y, side[i].z - side[i - 1].z));
    }
    const dup = gaps.filter((gp) => gp < 1e-6).length;
    const mono = side.every((a, i) => i === 0 || Math.abs(a.x - body.centerX) >= Math.abs(side[i - 1].x - body.centerX) - 1e-9);
    console.log(
      `  ${sign > 0 ? "x+" : "x−"}쪽 ${side.length}개 · 목점(s=${neck.s.toFixed(3)}) 목표 |x−center| ${cm(Math.abs(neck.x - body.centerX))}cm vs 패턴 목너비 ${cm(g.draft.dims.neckHalfWidthM)}cm · 인접 간격 ${(Math.min(...gaps) * 1000).toFixed(2)}~${(Math.max(...gaps) * 1000).toFixed(2)}mm · 중복(0mm) ${dup} · |x| 단조 ${mono ? "OK" : "**깨짐**"}`,
    );
  }
}
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
  anchors: () => (PINDRESS ? anchorList : []),
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

// ── 앵커 하드 핀 (7회차 단일 변경): 소프트(강도 1.0) → `pinned=1` 위치 고정.
// 6회차 실측 = 목표 |x| 6.26cm인데 정점은 10.5cm(4.2cm 밖) — 소프트 앵커를
// 시접·링·중력의 합력이 이긴다. `pinned=1`은 적분·제약·충돌·변위클램프가
// 전부 스킵하므로 합력과 무관하게 좌표가 유지된다(§4 개정).
// 해제는 상태기계가 봉합 해제창에서 부른다 — 여기서는 켜고 끄기만.
let anchorHard = false;
const setAnchorHard = (hard: boolean): void => {
  if (hard === anchorHard) return;
  anchorHard = hard;
  for (const a of anchorList) {
    if (hard) sim.pin(a.i, a.x, a.y, a.z);
    else sim.pinned[a.i] = 0;
  }
  console.log(
    `[dress] 앵커 ${hard ? "**하드 핀 고정**" : "**핀 해제 → 소프트 램프아웃**"} ${anchorList.length}개 · seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm`,
  );
};
// 배선 검증 — 핀이 실제로 좌표를 잡고 있는가. 목점(s≈0)의 실측 |x|가 6회차
// 목표 6.26cm를 유지하는지 본다(6회차는 10.5cm로 밀렸다).
const neckAnchor = anchorList.reduce((m, a) => (a.sign > 0 && a.s < m.s ? a : m), anchorList.find((a) => a.sign > 0)!);
const pinResidualMm = (): number =>
  Math.hypot(
    sim.positions[neckAnchor.i * 3] - neckAnchor.x,
    sim.positions[neckAnchor.i * 3 + 1] - neckAnchor.y,
    sim.positions[neckAnchor.i * 3 + 2] - neckAnchor.z,
  ) * 1000;

const gravity = new THREE.Vector3(0, -9.81, 0);
const frameLayout = { widthM: layout.widthM, heightM: garmentDims.lengthM, topY: layout.topY, centerZ: collision.centerZ, sleeveWidthM: layout.sleeveWidthM };
const framePose = { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft: pose.armLeft, armRight: pose.armRight };
const FRAMES = Math.round((process.env.SECONDS ? Number(process.env.SECONDS) : 25) * 60);

// S1 램프 대상 = **어깨 제외** 잔여 시접(옆선·암홀·소매 wrap).
// 19회차: 어깨 용접 반납 → **전 시접**이 램프 대상이다(2a-thin 구성 복귀).
const rampSeams = g.seams;
const result = runDressing(
  sim, session, rampSeams.map((s) => ({ a: s.a, b: s.b, target: s.targetM, kind: s.kind })),
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
    setAnchorHard,
    // ── 링 원주 제약의 **시점 분리**(21회차 단일 변경 · §3.3.1/§4 등재)
    //
    // 넥밴드는 **봉제 완료된 옷의 부품**이다. 착장 중의 유지력은 하드 핀이
    // 담당하고(잔차 0.00mm 실증, 19·20회차 6회씩), 링이 조여 있을 이유가 없다.
    // 20회차 실측이 그 대가를 보여줬다 — 링 42쌍 전 엣지가 **매 프레임 상한**
    // (발화 58.9/프레임)이라 뒤 목점이 시접 쪽으로 더 못 당겨지고, 어깨 시접
    // 2쌍이 27.8mm에서 정체했다. 3회차 slack 스케줄의 완전판이고, 이번에는
    // 승모근 교착이 해소된 상태(20회차: 중점이 몸 밖 1.22cm)라 조건이 다르다.
    //
    // 봉합 완료 전: **원단 일반 상한에 위임**한다(완전 off가 아니다). 링 전용
    // 상한만 풀고 `clothPhysics.limitStrain`의 전 제약 상한(1.2)이 과신장을
    // 계속 막는다 — 그래서 여기서 1.2를 다시 적으면 함정 12(계기 하드코딩)다.
    // 조이기 시작 시점은 **상태기계의 S2 진입**이다(22회차 1줄 정정).
    // 21회차는 자체 판정식(gap ≤ target + seamSlack)이 참이 된 순간 조이기
    // 시작했는데, S1→S2 전이는 그것과 `stateFrame ≥ rampFrames`의 **AND**라
    // 아직 전이 전이었다. 조이자 갭이 24.9mm로 되열려 전이 자체를 막았다
    // (f=110 봉합 → f=171 정체 → ABORT · **10프레임 차**).
    // **봉합은 판정되는 순간이 아니라 상태로 확정된 뒤에 조인다.** 전이 신호는
    // 상태기계가 이미 관리하므로 `state`를 구독만 한다(새 조건식 금지 —
    // S1→S2의 AND 조건이 진실의 단일 출처다).
    // 램프는 그 시점 실측 신장에서 1.02까지 smoothstep(길이 = 기존 rampFrames).
    beforeStep: (_frame, state) => {
      if (seamClosedAtFrame < 0) {
        ringMaxBeforeCloseM = Math.max(ringMaxBeforeCloseM, ringLenM());
        if (state === "S2" || state === "S3" || state === "DONE") {
          seamClosedAtFrame = _frame;
          ringLimitStart = Math.max(COLLAR_STRAIN_LIMIT, ringLenM() / Math.max(1e-6, ringRestM));
          console.log(`  [링·시점분리] f=${_frame} **S2 진입**(상태기계 전이) → 상한 램프 시작 ${ringLimitStart.toFixed(4)} → ${COLLAR_STRAIN_LIMIT} (${120}프레임 smoothstep) · 봉합 전 링 최대 ${cm(ringMaxBeforeCloseM)}cm · seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm`);
        }
      }
      if (state === "S3" || state === "DONE") {
        ringLimitNow = COLLAR_STRAIN_LIMIT;
      } else if (seamClosedAtFrame < 0) {
        // 링 전용 상한 해제 — 원단 일반 상한(limitStrain)이 계속 방어한다.
        ringLimitNow = Number.POSITIVE_INFINITY;
      } else {
        const t = Math.min(1, Math.max(0, (_frame - seamClosedAtFrame) / 120));
        const sm = t * t * (3 - 2 * t); // dressingMachine의 램프와 같은 식
        ringLimitNow = ringLimitStart + (COLLAR_STRAIN_LIMIT - ringLimitStart) * sm;
      }
      if (ringFullyEngagedAt < 0 && Math.abs(ringLimitNow - COLLAR_STRAIN_LIMIT) < 1e-9) ringFullyEngagedAt = _frame;
      (env as { collarStrainLimit?: number }).collarStrainLimit = ringLimitNow;
    },
    stateNote: () => {
      const target = Math.max(...g.seams.map((x) => x.targetM));
      const thresh = target + 0.01;
      return `링상한 ${Number.isFinite(ringLimitNow) ? ringLimitNow.toFixed(4) : "∞(일반 상한 위임)"}${Math.abs(ringLimitNow - COLLAR_STRAIN_LIMIT) < 1e-9 ? "(완전 발동)" : ""} · 앵커강도 ${anchorStrength.toFixed(3)}(게이트: seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm vs 해제창 ${(target * 1000).toFixed(1)}~${(thresh * 1000).toFixed(1)}mm)`;
    },
    onFrame: (frame, state) => {
      // ── 링 총 길이 사후 투영(위 설계 문단). 무게중심 기준 등방 축소 1회.
      // 핀 걸린 정점은 못 움직이므로 제외하고, 그만큼 배율을 나머지에 싣는다.
      {
        const L = ringLenM();
        if (ringTotalMaxM > 0 && L > ringTotalMaxM) {
          const idx = [...new Set(ringClosed.flatMap((e) => [e.a, e.b]))].filter((i) => !sim.pinned[i]);
          if (idx.length > 0) {
            let cx0 = 0, cy0 = 0, cz0 = 0;
            for (const i of idx) { cx0 += sim.positions[i * 3]; cy0 += sim.positions[i * 3 + 1]; cz0 += sim.positions[i * 3 + 2]; }
            cx0 /= idx.length; cy0 /= idx.length; cz0 /= idx.length;
            const k = ringTotalMaxM / L;
            for (const i of idx) {
              sim.positions[i * 3] = cx0 + (sim.positions[i * 3] - cx0) * k;
              sim.positions[i * 3 + 1] = cy0 + (sim.positions[i * 3 + 1] - cy0) * k;
              sim.positions[i * 3 + 2] = cz0 + (sim.positions[i * 3 + 2] - cz0) * k;
            }
            ringTotalFired++;
          }
        }
      }
      // 배선 검증(항상) — 하드 핀이 좌표를 잡고 있는가. 6회차는 이 값이
      // 목표 6.26cm에서 10.5cm로 밀렸다(잔차 42mm).
      if (state === "S1" && frame % 60 === 0) {
        console.log(
          `  [pin·검증] f=${String(frame).padStart(4)} 목점 실측 |x−center| ${cm(Math.abs(sim.positions[neckAnchor.i * 3] - centerX))}cm vs 목표 ${cm(Math.abs(neckAnchor.x - centerX))}cm · 잔차 ${pinResidualMm().toFixed(2)}mm · pinned=${sim.pinned[neckAnchor.i]} · 앵커강도 ${anchorStrength.toFixed(3)}`,
        );
      }
      // 전이 근방 프레임별 진단(상시) — 22회차가 S2 진입 **다음 프레임**에
      // 봉합 이탈했다. 60프레임 간격 로그로는 그 한 프레임이 안 보인다.
      if (seamClosedAtFrame >= 0 && frame >= seamClosedAtFrame - 6 && frame <= seamClosedAtFrame + 20) {
        const worst = g.seams.reduce((acc, sm) => {
          const d = Math.hypot(
            sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
            sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
            sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
          );
          return d > acc.d ? { d, kind: sm.kind, i: sm.a } : acc;
        }, { d: 0, kind: "-", i: 0 });
        console.log(
          `  [전이근방] f=${String(frame).padStart(4)} ${state} seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm(최대 ${worst.kind} 패턴 ${cm(g.pos2[worst.i * 2])},${cm(g.pos2[worst.i * 2 + 1])}) · 링상한 ${Number.isFinite(ringLimitNow) ? ringLimitNow.toFixed(4) : "∞"} · 링길이 ${cm(ringLenM())}cm · 앵커 ${anchorStrength.toFixed(3)} pinned=${sim.pinned[neckAnchor.i]} · 핀잔차 ${pinResidualMm().toFixed(2)}mm · 칼라발화누적 ${collarFired}`,
        );
      }
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
          `  [diag] f=${String(frame).padStart(4)} ${state} 앵커 ${anchorStrength.toFixed(3)} 링상한 ${Number.isFinite(ringLimitNow) ? ringLimitNow.toFixed(3) : "∞"} seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm Δ20 ${maxDelta20Mm().toFixed(2)}mm strain ${st.v.toFixed(2)}@${PANEL_NAME[panelOfIdx(st.at)]} prox ${proximityPairs()} 관통 ${countInside(sim.positions, total, insideParity)} 칼라발화 ${collarFired}`,
        );
      }
      // 관측(손잡이 금지·기록만) — 뒤판 상단 들림. 뒤판의 목선·어깨 대역
      // (패턴 y ≤ 3cm) 정점이 몸 표면에서 얼마나 떨어졌나.
      if (DIAG && frame % 120 === 0) {
        let worst = 0, wi = -1, over = 0;
        for (let i = g.panelStarts[1]; i < g.panelStarts[2]; i++) {
          if (g.pos2[i * 2 + 1] > 0.03) continue;
          const c = wholeMesh.closestPointUnsigned(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR);
          if (!c) continue;
          if (c.distance > 0.05) over++;
          if (c.distance > worst) { worst = c.distance; wi = i; }
        }
        console.log(
          `  [obs·뒤판상단] f=${frame} 몸에서 최대 ${(worst * 1000).toFixed(1)}mm @패턴(${cm(g.pos2[wi * 2])},${cm(g.pos2[wi * 2 + 1])})cm 월드 y${cm(sim.positions[wi * 3 + 1])} z${cm(sim.positions[wi * 3 + 2])} · 5cm 초과 정점 ${over}`,
        );
      }
      // 봉합 "닫힘" 순간을 한 번만 기록 — 목점 y vs 승모근 상단 y.
      if (closureLog === null && maxSeamGapM() <= Math.max(...g.seams.map((x) => x.targetM)) + 0.01) {
        const parts = neckPointPairs.map((np) => {
          const ay = sim.positions[np.a * 3 + 1], ax = sim.positions[np.a * 3];
          const by = sim.positions[np.b * 3 + 1];
          const ridgeY = body.ridgeTopYAt(Math.abs(ax - centerX));
          return `앞목점 y${cm(ay)} / 뒤목점 y${cm(by)} · 같은 x(${cm(Math.abs(ax - centerX))})의 승모근 상단 y${cm(ridgeY)} → ${ay > ridgeY ? "**위(자유공간)**" : "아래(교착 위험)"}`;
        });
        closureLog = `f=${frame} seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm · ${parts.join(" | ")}`;
        console.log(`[dress] **봉합 닫힘** ${closureLog}`);
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
// 팔·손 제외 — **최근접 골격 선분이 팔이면 팔**(2a-thin 스파이크 계기 결함 3번이
// 확정한 규칙, 상수 0). 6회차 관측이 지목한 오염이다: 이 마네킹은 팔이 59° 하향이라
// 손이 골반 높이(y80~90)에 오고, cov 몸통 대역의 뒤쪽 노출 샘플이 x 54cm에 찍혔다
// — 티셔츠가 덮을 대상이 아닌 **손 표면**이 분모·분자에 들어가 있었다. 4·5회차의
// 다리 가설이 값을 못 바꾼 이유이기도 하다(제외 대상이 다리가 아니었다).
const armMask = (() => {
  const n = position.length / 3;
  const mask = new Uint8Array(n).fill(1);
  const armSet = new Set(skeleton.arms);
  let excluded = 0;
  for (let v = 0; v < n; v++) {
    const near = nearestOnSegments(position[v * 3], position[v * 3 + 1], position[v * 3 + 2], skeleton.segments);
    if (armSet.has(near.segment)) { mask[v] = 0; excluded++; }
  }
  console.log(`[dress] cov 대역 팔 제외: 최근접 골격 선분이 팔인 정점 ${excluded}/${n} 제외(팔 선분 ${skeleton.arms.length}개)`);
  return mask;
})();
// **cov 몸통 정식 정의(2026-07-30 확정)**: 위 팔 제외 규칙 한 벌만 쓴다.
// 중복 정리 근거: 이 규칙(`armMask`)은 병행 세션 커밋 `6e3caa8`이 먼저 넣은
// 것이고 2a-thin 계기 결함 3번의 확정 규칙과 문구까지 같으므로 **그쪽을 남겼다**.
// 다리 제외본(`legMask`)은 삭제 — 4·5·6회차에서 값을 못 바꿔 세 번 기각됐고
// (분모 −32, 0.1pp) 오염의 정체가 손으로 특정된 뒤에는 채널 유지 근거가 없다.
// 구 정의(팔 포함)만 이력 대조로 병기한다.
const covArmless = computeBodyCoverage(position, [frontIdx, backIdx], gridView, [], { ...covBand, yMin: hemWorldY, sampleMask: armMask }, clothTris);
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
  `  **cov 몸통(정식 · 팔 제외)**: 노출 ${covArmless.exposed}/${covArmless.samples} (${(covArmless.exposedRatio * 100).toFixed(1)}%)`,
);
console.log(
  `  cov 팔포함(폐기 · 이력 병기) yMin = 밑단 월드 ${cm(hemWorldY)}cm = 능선앵커 ${cm(g.draft.dims.ridgeAnchorY)} − 총장 ${cm(g.draft.dims.lengthM)}): 노출 ${cov.exposed}/${cov.samples} (${(cov.exposedRatio * 100).toFixed(1)}%)`,
);
console.log(
  `  cov 몸통(구 정의 yMin = hemY ${cm(hemY)}cm · 병기): 노출 ${covOld.exposed}/${covOld.samples} (${(covOld.exposedRatio * 100).toFixed(1)}%)`,
);

{
  // ── cov 65%의 정체를 **관측으로** 특정한다(가설 금지 — 2b에서 대역 가설이
  // 세 번 기각됐다). `exposedExamples`는 노출 좌표 전수를 담는다.
  const yHist = new Map<number, number>();
  const zHist = new Map<string, number>();
  const allY = new Map<number, number>();
  for (const p of cov.exposedExamples) {
    const yb = Math.floor(p.y * 20) / 20; // 5cm 빈
    yHist.set(yb, (yHist.get(yb) ?? 0) + 1);
    const zs = p.z >= collision.centerZ ? "앞" : "뒤";
    zHist.set(zs, (zHist.get(zs) ?? 0) + 1);
  }
  // 분모(전체 샘플)의 y 분포도 같이 — 노출률이 아니라 "샘플이 어디 있나"를 본다.
  for (const h of cov.hits) {
    const yb = Math.floor(h.y * 20) / 20;
    allY.set(yb, (allY.get(yb) ?? 0) + 1);
  }
  const rows = [...new Set([...yHist.keys(), ...allY.keys()])].sort((a, b) => a - b);
  console.log("  cov 노출 샘플 관측(가설 없음) — 5cm 빈별 노출/전체:");
  console.log(
    `    ${rows.map((y) => {
      const e = yHist.get(y) ?? 0, c = allY.get(y) ?? 0;
      return `y${(y * 100).toFixed(0)}:${e}/${e + c}`;
    }).join(" ")}`,
  );
  console.log(`    앞/뒤 분포: ${JSON.stringify(Object.fromEntries(zHist))}`);
  // 관측: y80~90 앞면 노출 샘플 10개의 **최근접 옷 거리** — 진짜 노출(옷이
  // 멀다)인지 판정 아티팩트(옷이 가까운데 레이가 못 맞힘)인지 특정만 한다.
  {
    const picks = cov.exposedExamples.filter((p) => p.y >= 0.80 && p.y <= 0.90 && p.z >= collision.centerZ).slice(0, 10);
    const nearestCloth = (x: number, y: number, z: number): { d: number; panel: number } => {
      let best = Infinity, bi = 0;
      for (let i = 0; i < total; i++) {
        const d = (sim.positions[i * 3] - x) ** 2 + (sim.positions[i * 3 + 1] - y) ** 2 + (sim.positions[i * 3 + 2] - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      return { d: Math.sqrt(best), panel: panelOfIdx(bi) };
    };
    console.log("    y80~90 앞면 노출 샘플 10개의 최근접 옷 정점 거리(관측만):");
    for (const p of picks) {
      const nc = nearestCloth(p.x, p.y, p.z);
      console.log(`      샘플 y${cm(p.y)} x${cm(p.x)} z${cm(p.z)} → 최근접 옷 ${(nc.d * 1000).toFixed(1)}mm (${PANEL_NAME[nc.panel]})`);
    }
  }
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
console.log(`  링 총 길이 상한 발화: ${ringTotalFired}회 = ${(ringTotalFired / Math.max(1, result.frames)).toFixed(2)}/프레임 · 상한 ${cm(ringTotalMaxM)}cm(계수 ${(ringTotalMaxM / Math.max(1e-9, ringRestM)).toFixed(3)})\n  넥밴드 원주 제약 발화 누적: ${collarFired}회 = ${(collarFired / Math.max(1, result.frames)).toFixed(1)}/프레임 · 봉합 완료 f=${seamClosedAtFrame < 0 ? "미도달" : seamClosedAtFrame}(그 전까지 링 전용 상한은 일반 상한에 위임) · 링 원주 봉합 전 최대 ${cm(ringMaxBeforeCloseM)}cm → 최종 ${cm(ringLenM())}cm (rest ${cm(ringRestM)}cm)`);
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

// ── 관측(구조 사실만): 앞판 중앙 접합부와 옆선 시접의 정체
{
  let axisShared = 0;
  for (let i = g.panelStarts[0]; i < g.panelStarts[1]; i++) {
    if (Math.abs(g.pos2[i * 2]) < 1e-9 && g.mirrorOf[i] === i) axisShared++;
  }
  const centerSeams = g.seams.filter((sm) =>
    Math.abs(g.pos2[sm.a * 2]) < 1e-9 || Math.abs(g.pos2[sm.b * 2]) < 1e-9).length;
  const sideGaps = g.seams.filter((sm) => sm.kind === "side").map((sm) => Math.hypot(
    sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
    sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
    sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
  ));
  console.log(
    `[dress·obs] 앞판 중앙선: 미러축 공유 정점 ${axisShared}개(mirrorOf[i]=i) · 중앙선에 걸린 시접 ${centerSeams}쌍 → **용접도 시접도 아니고 연속 메시**다(미러 복제가 축 정점을 하나로 유지한다)`,
  );
  console.log(
    `[dress·obs] 옆선 시접 ${sideGaps.length}쌍: 갭 ${(Math.min(...sideGaps) * 1000).toFixed(1)}~${(Math.max(...sideGaps) * 1000).toFixed(1)}mm (target ${(g.seams[0].targetM * 1000).toFixed(1)}mm) → 닫혀 있다. 화면의 세로 틈은 **렌더 사실**이다: 패널 4매를 별개 지오메트리로 그리고 §3.4의 SeamStrip 브리지를 아직 배선하지 않았으므로 시접 rest 간격이 그대로 보인다`,
  );
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
