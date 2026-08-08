// v2 T4 = Stage 2a 게이트 하네스 — 패턴 제도·삼각화·정적 배치의 **검사 전용**.
// 드레이프 실행 없음(그건 2b). v2-design §6 2a 행의 게이트 항목을 그대로 낸다:
//   위상 검사(시접 표본수 일치·경계 커버·미러 쌍 정합) / 삼각형 품질 /
//   배치 관통 / 자기충돌 오발화 0 / 정점 수·예산 §1.4.1 대조
//
// 진입: `PATTERNCORE=1 npm run check:pattern`. 기본 off(DEFAULT_PATTERN_CORE) —
// patternCore off 실행은 아무것도 하지 않는다(§6 공통 규칙).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { createHash } from "node:crypto";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { SelfCollision } from "../src/lib/selfCollision";
import { deriveBodySkeleton } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { checkDraft } from "../src/lib/patternDraft";
import { buildPatternGarment, checkPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT, PATTERN_EDGE_INTERIOR_M } from "../src/lib/patternGarment";
import { makeOutlineProvider } from "../src/lib/bodyOutline";
import { makeSkeletonSignedSampler } from "../src/lib/sdfCollision";
import { countPlacementFolds, countSelfIntersections } from "../src/lib/patternPlacement";
import type { Capsule } from "../src/lib/torsoCapsule";
import { COLLISION_MARGIN, DEFAULT_PATTERN_CORE, SDF_FAR, SEAM_REST_LENGTH } from "../src/lib/clothConfig";

const t0 = performance.now();
const patternCore = process.env.PATTERNCORE != null ? process.env.PATTERNCORE !== "0" : DEFAULT_PATTERN_CORE;
if (!patternCore) {
  console.log("[pattern] patternCore off(기본) — 아무것도 실행하지 않는다. PATTERNCORE=1로 진입.");
  process.exit(0);
}

const FIXTURE = process.env.FIXTURE ?? "scripts/fixtures/collision-fixture.json";
const raw = readFileSync(FIXTURE, "utf8");
const fixtureHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
const fixture = JSON.parse(raw) as {
  layout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  pose: {
    pinLeft: { x: number; y: number; z: number };
    pinRight: { x: number; y: number; z: number };
    armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
    armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
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
const hemY = collision.capsules[collision.capsules.length - 1].bottom.y;
const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
const arms = [pose.armLeft, pose.armRight] as const;

const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemY);
// 102 §2 — `MARGIN_ALL` 채널을 게이트 하네스에도 잇는다(문턱 ⑦⑧ 평가용).
// 미설정이면 `COLLISION_MARGIN` — 기존 호출과 비트 동일.
const MARGIN_ALL = process.env.MARGIN_ALL ? Number(process.env.MARGIN_ALL) / 1000 : COLLISION_MARGIN;
const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, collision.centerZ, MARGIN_ALL);

// 옷 치수 — fixture가 워커에 실제로 넘긴 값에서 도출한다(하드코딩 금지).
// 어깨너비는 v1 어깨 핀 간격이 곧 옷 어깨너비다(pinLeft/pinRight = 옷 어깨점).
const garmentDims = {
  lengthM: layout.heightM,
  widthM: layout.widthM,
  shoulderWidthM: Math.abs(pose.pinLeft.x - pose.pinRight.x),
  sleeveLengthM: Math.max(pose.armLeft.length, pose.armRight.length),
  sleeveWidthM: layout.sleeveWidthM,
};

const cm = (v: number): string => (v * 100).toFixed(2);
console.log(`[pattern] fixture ${fixtureHash} · 옷 치수 총장 ${cm(garmentDims.lengthM)} / 품 ${cm(garmentDims.widthM)} / 어깨너비 ${cm(garmentDims.shoulderWidthM)} / 소매길이 ${cm(garmentDims.sleeveLengthM)} / 소매통 ${cm(garmentDims.sleeveWidthM)} (cm)`);
console.log(
  `[pattern] 몸 실측: 가슴 ${cm(body.chestGirthM)}cm@y${cm(body.chestY)} · 허리 ${cm(body.waistGirthM)}cm@y${cm(body.waistY)} · 목 ${cm(body.neckGirthM)}cm@y${cm(body.neckY)} · 어깨 통과 ${cm(body.shoulderPassGirthM)}cm@y${cm(body.shoulderJointY)} · 어깨 관절 간격 ${cm(body.shoulderSpanM)}cm · 최대두께 ${cm(body.maxDepthM)}cm`,
);
console.log(
  `[pattern] 어깨 능선 상면(x cm→topY cm): ${body.ridge.filter((_, i) => i % 3 === 0).map((r) => `${(r.xM * 100).toFixed(0)}:${(r.topY * 100).toFixed(1)}`).join(" ")}`,
);

const tBuild = performance.now();
const outlineTorso = new ArrayBvhCollision();
outlineTorso.rebuild(position, torsoIndex);
const outlineWhole = new ArrayBvhCollision();
outlineWhole.rebuild(position, wholeIndex ?? torsoIndex);
const outlineAt = makeOutlineProvider(
  outlineTorso, outlineWhole,
  (h) => { const sl = body.slices.reduce((b, s2) => (Math.abs(s2.y - h) < Math.abs(b.y - h) ? s2 : b), body.slices[0]); return [sl.axisX, sl.axisZ]; },
  PATTERN_EDGE_INTERIOR_M,
);
const g = buildPatternGarment(body, garmentDims, arms as unknown as readonly [typeof pose.armLeft, typeof pose.armRight], outlineAt, undefined, MARGIN_ALL);
const buildMs = Math.round(performance.now() - tBuild);
const d = g.draft.dims;
console.log(
  `[pattern] 제도: 목너비 ${cm(d.neckHalfWidthM)} 앞목 ${cm(d.frontNeckDropM)} 뒤목 ${cm(d.backNeckDropM)} · 어깨 경사 ${(Math.atan(d.shoulderSlope) * 180 / Math.PI).toFixed(1)}°(낙차 ${cm(d.shoulderDropM)}) 어깨선 ${cm(d.shoulderSeamM)} · 진동깊이 ${cm(d.armholeDepthM)} 암홀둘레 ${cm(d.armholeGirthM)} · 소매산 높이 ${cm(d.capHeightM)}(삼각공식 ${cm(d.capHeightTriangleM)}) 소매산둘레 ${cm(d.capGirthM)} 하부 ${cm(d.underSleeveM)} · 목선둘레 ${cm(d.necklineGirthM)} (전부 cm) · 조립 ${buildMs}ms`,
);

const fails: string[] = [];
const report = (rows: { name: string; ok: boolean; detail: string }[], head: string): void => {
  console.log(`\n[pattern] ${head}`);
  for (const r of rows) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
    if (!r.ok) fails.push(r.name);
  }
};

// ── 1. 패턴 수치 자기검사
report(checkDraft(g.draft, g.meta.armGirthM), "패턴 수치 자기검사");

// ── 2. 삼각화 품질
console.log("\n[pattern] 삼각화 품질 (게이트: 최소각 ≥25° · 비매니폴드 0 · 중복정점 0 · 경계 이탈 ≤0.01mm · 경계엣지 누락 0)");
console.log("  ※ 크기장 이탈은 **기록 채널**이다(게이트 아님) — v2-design §3.2 처분: 소비자 미실증, 확정은 2b 실측 후.");
const MIN_ANGLE_DEG = 25;
const BOUNDARY_OFF_MAX_M = 1e-5;
for (const { panel, q } of g.quality) {
  console.log(
    `  ${panel}: 정점 ${q.vertices} 삼각형 ${q.triangles} · 최소각 ${q.minAngleDeg.toFixed(1)}° @(${cm(q.minAngleAt.x)},${cm(q.minAngleAt.y)})cm · 종횡비max ${q.aspectMax.toFixed(2)} @(${cm(q.aspectMaxAt.x)},${cm(q.aspectMaxAt.y)})cm · 엣지 ${(q.edgeMinM * 1000).toFixed(2)}~${(q.edgeMaxM * 1000).toFixed(2)}mm 평균 ${(q.edgeMeanM * 1000).toFixed(2)}mm · 크기장 이탈 p50/p90/p99 ${(q.sizeDeviationP50 * 100).toFixed(1)}/${(q.sizeDeviationP90 * 100).toFixed(1)}/${(q.sizeDeviationP99 * 100).toFixed(1)}% · max ${(q.sizeDeviationMax * 100).toFixed(1)}%(엣지 ${(q.sizeDeviationLenM * 1000).toFixed(2)}mm vs h ${(q.sizeDeviationHM * 1000).toFixed(2)}mm) @(${cm(q.sizeDeviationAt.x)},${cm(q.sizeDeviationAt.y)})cm · 경계엣지 ${q.boundaryEdges} 비매니폴드 ${q.nonManifoldEdges} 중복 ${q.duplicateVertices} · 경계이탈 ${(q.boundaryOffCurveMaxM * 1000).toFixed(6)}mm · 경계엣지누락 ${q.missingBoundaryEdges}`,
  );
  console.log(
    `    이탈>30% 엣지 ${q.sizeOutlierCount}/${q.triangles * 3 / 2 | 0}개 · 대역별 ${JSON.stringify(q.sizeOutlierByRegion)}`,
  );
  for (const e of q.sizeOutlierExamples) {
    console.log(`      예: (${cm(e.x)},${cm(e.y)})cm ${e.region} · 엣지 ${e.lenMm.toFixed(2)}mm vs h ${e.hMm.toFixed(2)}mm = ${e.devPct.toFixed(1)}%`);
  }
  const rows = [
    { name: `최소각(${panel})`, ok: q.minAngleDeg >= MIN_ANGLE_DEG, detail: `${q.minAngleDeg.toFixed(2)}° ≥ ${MIN_ANGLE_DEG}°` },
    { name: `매니폴드(${panel})`, ok: q.nonManifoldEdges === 0, detail: `비매니폴드 엣지 ${q.nonManifoldEdges}` },
    { name: `중복 정점(${panel})`, ok: q.duplicateVertices === 0, detail: `${q.duplicateVertices}` },
    { name: `경계 정점이 곡선 위(${panel})`, ok: q.boundaryOffCurveMaxM <= BOUNDARY_OFF_MAX_M, detail: `최대 이탈 ${(q.boundaryOffCurveMaxM * 1000).toFixed(6)}mm ≤ 0.01mm` },
    { name: `경계 엣지 누락(${panel})`, ok: q.missingBoundaryEdges === 0, detail: `${q.missingBoundaryEdges} (누락 시 CDT 도입 신호)` },
  ];
  for (const r of rows) if (!r.ok) { console.log(`  FAIL  ${r.name} — ${r.detail}`); fails.push(r.name); }
}

// ── 3. 정점·삼각형 수 §1.4.1 대조
const totalVerts = g.panelCounts.reduce((a, b) => a + b, 0);
const totalTris = g.tris.length / 3;
console.log(
  `\n[pattern] 규모: 정점 ${totalVerts}(패널별 ${g.panelCounts.join("/")}) · 삼각형 ${totalTris} · 메시 엣지 ${g.edgePairs.length} · 시접 ${g.seams.length}쌍 ${JSON.stringify(g.meta.seamCounts)}`,
);
console.log(
  `  §1.4.1 추정 4,400~4,800정점 / ~8,800~9,600삼각형 — 대조: 정점 ${totalVerts} (${totalVerts < 4400 ? "하회" : totalVerts > 4800 ? `상회 +${totalVerts - 4800}` : "대역 내"}) · 삼각형 ${totalTris} (${totalTris < 8800 ? "하회" : totalTris > 9600 ? `상회 +${totalTris - 9600}` : "대역 내"})`,
);
console.log(
  `  패널별 내역: 앞판 ${g.panelCounts[0]} / 뒤판 ${g.panelCounts[1]} / 소매 ${g.panelCounts[2]}×2 — §1.4.1 추정 앞뒤 1,800~1,950 · 소매 400~450`,
);

// ── 4. 자기충돌 문턱 도출
console.log(
  `\n[pattern] 자기충돌 문턱 도출: min엣지 ${(Math.min(...g.quality.map((x) => x.q.edgeMinM)) * 1000).toFixed(2)}mm × 0.6 = ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm (v1 하드코딩 5.50mm 대비) · 시접 rest ${(SEAM_REST_LENGTH * 1000).toFixed(1)}mm`,
);

// ── 5. 시접 테이블 자기검사
report(checkPatternGarment(g), "시접 테이블 자기검사");

// ── 6. 배치 관통 (§4 S0)
// 판정은 **레이 패리티**로 한다. 골격 부호 샘플러(1a 은행 자산)는 참조
// 방향이 "최근접 골격점에서 밖으로"인데, 몸판 바깥쪽·아래쪽 정점은 최근접
// 골격 선분이 **팔**이고 그 팔이 정점보다 더 바깥에 있어 참조 방향이
// 뒤집힌다 — 첫 실행에서 앞판 412·뒤판 143개가 "최심 164~215mm 관통"으로
// 오분류됐다(옷이 몸 밖 14.7cm에 평평히 놓인 상태였다). 패리티는
// star-shaped 전제가 없다.
const wholeMesh = new ArrayBvhCollision();
wholeMesh.rebuild(position, wholeIndex);
const signedAt = makeSkeletonSignedSampler(wholeMesh, skeleton.segments, SDF_FAR, SDF_FAR);

// 패리티의 전제는 수밀성이다 — 인덱스 집합의 경계 엣지 수를 먼저 센다.
{
  const use = new Map<number, number>();
  const src = wholeIndex ?? torsoIndex;
  for (let t = 0; t + 2 < src.length; t += 3) {
    const v = [src[t], src[t + 1], src[t + 2]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const k = Math.min(v[i], v[j]) * 1_000_000 + Math.max(v[i], v[j]);
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const u of use.values()) if (u !== 2) open++;
  console.log(`\n[pattern] 패리티 전제(수밀성): wholeBodyIndex 삼각형 ${src.length / 3} · 엣지 ${use.size} · 비-2회 엣지 ${open}${open === 0 ? " → 수밀" : " → 비수밀(패리티 근사)"}`);
}

const DIRS: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
const insideByParity = (x: number, y: number, z: number): boolean => {
  let votes = 0;
  for (const d of DIRS) {
    let hits = 0;
    let ox = x, oy = y, oz = z;
    for (let k = 0; k < 16; k++) {
      rayOrigin.set(ox, oy, oz);
      rayDir.set(d[0], d[1], d[2]);
      const hit = wholeMesh.raycastFirst(rayOrigin, rayDir, 4);
      if (!hit) break;
      hits++;
      // 같은 면을 다시 맞지 않도록 교점 너머로 조금 밀어 재발사.
      const eps = 1e-4;
      ox = hit.x + d[0] * eps; oy = hit.y + d[1] * eps; oz = hit.z + d[2] * eps;
    }
    if (hits % 2 === 1) votes++;
  }
  return votes >= 2;
};
const countPenetrating = (): { n: number; skel: number } => {
  let n = 0, skel = 0;
  for (let i = 0; i < totalVerts; i++) {
    const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
    if (insideByParity(x, y, z)) n++;
    if (signedAt(x, y, z) < 0) skel++;
  }
  return { n, skel };
};
const panelOfIdx = (i: number): number => { for (let p = 3; p >= 0; p--) if (i >= g.panelStarts[p]) return p; return 0; };
const placedRaw = Float32Array.from(g.positions);
// 교정 전 자기교차 — 아래 7-2가 교정 **후**를 재므로, 배치 자체가 깨끗한지를
// 먼저 분리해 둔다(오발화 검사와 같은 방식: 배치 원본 vs S0 교정 후).
const xsecRaw = countSelfIntersections(placedRaw, g.tris, g.edgePairs, 0.03);
const before = countPenetrating();
{
  const per = [0, 0, 0, 0];
  for (let i = 0; i < totalVerts; i++) {
    if (!insideByParity(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2])) continue;
    per[panelOfIdx(i)]++;
  }
  console.log(`[pattern] 관통 패널별(교정 전·패리티): 앞판 ${per[0]} · 뒤판 ${per[1]} · 소매L ${per[2]} · 소매R ${per[3]}`);
}
// §4 S0의 "기울기 방향으로 1회 압출 교정" — 관통 정점은 최근접 표면점
// 너머 margin만큼으로 투영한다(안쪽 점에서 SDF 기울기 방향 = 최근접 표면
// 방향). 부호가 필요 없어 위 오분류 기전에 걸리지 않는다.
// **2b 이식 대상**: 이 교정은 상태기계 S0에 속한다(dressingMachine hooks).
let corrected = 0;
{
  // 이미 교정한 정점들 — 투영은 여러 정점을 같은 표면점 근방으로 모을 수
  // 있고, 그러면 자기충돌 문턱 안으로 들어가 **교정이 오발화를 만든다**
  // (첫 실행: 배치 원본 오발화 0 → 교정 후 2). 법선 방향으로 더 밀어
  // 문턱 밖으로 뺀다.
  // 충돌 판정 상대는 **교정분만이 아니라 전체**다 — 첫 시도에서 교정분끼리만
  // 봤더니 잔여 2건이 그대로 남았다(상대가 교정되지 않은 정점이었다).
  const skipKeys = new Set<number>();
  for (const e of [...g.edgePairs, ...g.seams.map((x) => ({ a: x.a, b: x.b }))]) {
    skipKeys.add(Math.min(e.a, e.b) * 1_000_000 + Math.max(e.a, e.b));
  }
  const clashAt = (i: number, px: number, py: number, pz: number): boolean => {
    for (let j = 0; j < totalVerts; j++) {
      if (j === i) continue;
      if (skipKeys.has(Math.min(i, j) * 1_000_000 + Math.max(i, j))) continue;
      if (Math.hypot(g.positions[j * 3] - px, g.positions[j * 3 + 1] - py, g.positions[j * 3 + 2] - pz) < g.selfCollisionMinDistM) return true;
    }
    return false;
  };
  const done: number[] = [];
  for (let i = 0; i < totalVerts; i++) {
    const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
    if (!insideByParity(x, y, z)) continue;
    const c = wholeMesh.closestPointUnsigned(x, y, z, SDF_FAR);
    if (!c) continue;
    const dx = c.x - x, dy = c.y - y, dz = c.z - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    let out = MARGIN_ALL;
    for (let k = 0; k < 8; k++) {
      const px = c.x + (dx / l) * out, py = c.y + (dy / l) * out, pz = c.z + (dz / l) * out;
      const clash = clashAt(i, px, py, pz);
      g.positions[i * 3] = px; g.positions[i * 3 + 1] = py; g.positions[i * 3 + 2] = pz;
      if (!clash) break;
      out += g.selfCollisionMinDistM;
    }
    done.push(i);
    corrected++;
  }
}
const after = countPenetrating();
console.log(
  `[pattern] 배치 관통(패리티): 교정 전 ${before.n}/${totalVerts} → 표면 투영 교정 ${corrected}정점 → 교정 후 ${after.n} · [참고] 골격 부호 샘플러 계수 ${before.skel}→${after.skel} (스파이크 25는 같은 샘플러 값)`,
);
if (after.n > 0) fails.push("배치 관통 0");

// ── 7. 자기충돌 오발화 (문턱은 도출값). 스킵 집합 = 메시 엣지 + 시접 전체.
//    UV 스킵은 끈다(비정형 메시에 격자 UV가 없다 — 켜두면 무관한 쌍을 조용히
//    스킵해 오발화가 과소 보고된다).
{
  const skip = [...g.edgePairs, ...g.seams.map((s) => ({ a: s.a, b: s.b }))];
  const resolver = new SelfCollision(
    [...g.panelStarts], [...g.panelCounts], 0, skip, g.selfCollisionMinDistM, 0,
  ).createResolver(g.selfCollisionMinDistM);
  const probeAt = (src: Float32Array): { same: number; cross: number; worstMm: number } => {
    const probe = Float32Array.from(src);
    resolver(probe, new Uint8Array(totalVerts), totalVerts);
    let same = 0, cross = 0, worstMm = 0;
    for (let i = 0; i < totalVerts; i++) {
      const dd = Math.hypot(probe[i * 3] - src[i * 3], probe[i * 3 + 1] - src[i * 3 + 1], probe[i * 3 + 2] - src[i * 3 + 2]);
      if (dd <= 1e-12) continue;
      if (dd * 1000 > worstMm) worstMm = dd * 1000;
      // 같은 패널 안에서 밀렸으면 **오발화**(비연결 이웃이 문턱 안에 든 것),
      // 다른 패널이면 실제 근접이다(§3.2가 걱정한 건 전자다).
      let isSame = false;
      for (let j = 0; j < totalVerts; j++) {
        if (j === i || panelOfIdx(j) !== panelOfIdx(i)) continue;
        const d = Math.hypot(src[j * 3] - src[i * 3], src[j * 3 + 1] - src[i * 3 + 1], src[j * 3 + 2] - src[i * 3 + 2]);
        if (d < g.selfCollisionMinDistM) { isSame = true; break; }
      }
      if (isSame) same++; else cross++;
    }
    return { same, cross, worstMm };
  };
  const raw = probeAt(placedRaw);
  const cor = probeAt(g.positions);
  console.log(
    `\n[pattern] 자기충돌 오발화: 문턱 ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm · 스킵 ${skip.length}쌍(메시 엣지 ${g.edgePairs.length} + 시접 ${g.seams.length})`,
  );
  console.log(
    `  배치 원본:   같은 패널 ${raw.same}(오발화) / 다른 패널 ${raw.cross}(실제 근접) · 최대 ${raw.worstMm.toFixed(3)}mm`,
  );
  console.log(
    `  S0 교정 후:  같은 패널 ${cor.same}(오발화) / 다른 패널 ${cor.cross}(실제 근접) · 최대 ${cor.worstMm.toFixed(3)}mm`,
  );
  if (raw.same !== 0) fails.push("자기충돌 오발화(배치 원본·같은 패널) 0");
  if (cor.same !== 0) fails.push("자기충돌 오발화(S0 교정 후·같은 패널) 0");
}

// ── 7-2. 자기교차(엣지-삼각형) + **심은 교차 1건 역검증**
// 판정기를 새로 만들 때 "0이 나왔다"는 그 판정기가 아무것도 못 잡는다는
// 뜻일 수도 있다 — 변이를 심어 반응하는지 먼저 본다(check:seambridge와 같은
// 방식).
{
  const clean = countSelfIntersections(g.positions, g.tris, g.edgePairs, 0.03);
  const backup = Float32Array.from(g.positions);
  // 앞판 첫 삼각형의 무게중심·법선을 구해, 뒤판 엣지 하나를 그 면을 꿰뚫도록 옮긴다.
  const t0i = g.panelTriRanges[0].start * 3;
  const A = g.tris[t0i], B = g.tris[t0i + 1], C = g.tris[t0i + 2];
  const cx = (g.positions[A * 3] + g.positions[B * 3] + g.positions[C * 3]) / 3;
  const cy = (g.positions[A * 3 + 1] + g.positions[B * 3 + 1] + g.positions[C * 3 + 1]) / 3;
  const cz = (g.positions[A * 3 + 2] + g.positions[B * 3 + 2] + g.positions[C * 3 + 2]) / 3;
  const ux = g.positions[B * 3] - g.positions[A * 3], uy = g.positions[B * 3 + 1] - g.positions[A * 3 + 1], uz = g.positions[B * 3 + 2] - g.positions[A * 3 + 2];
  const vx = g.positions[C * 3] - g.positions[A * 3], vy = g.positions[C * 3 + 1] - g.positions[A * 3 + 1], vz = g.positions[C * 3 + 2] - g.positions[A * 3 + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const victim = g.edgePairs.find((e) => e.a >= g.panelStarts[1] && e.b >= g.panelStarts[1] && e.b < g.panelStarts[2]);
  if (!victim) throw new Error("변이 대상 뒤판 엣지를 못 찾았다");
  const put = (i: number, sgn: number): void => {
    g.positions[i * 3] = cx + nx * 0.01 * sgn;
    g.positions[i * 3 + 1] = cy + ny * 0.01 * sgn;
    g.positions[i * 3 + 2] = cz + nz * 0.01 * sgn;
  };
  put(victim.a, 1);
  put(victim.b, -1);
  const mutated = countSelfIntersections(g.positions, g.tris, g.edgePairs, 0.03);
  g.positions.set(backup);
  const pName = ["앞판", "뒤판", "소매L", "소매R"];
  const pOf = (i: number): number => { for (let p = 3; p >= 0; p--) if (i >= g.panelStarts[p]) return p; return 0; };
  console.log(
    `\n[pattern] 자기교차(엣지-삼각형): 정적 배치 ${clean.count}건 · 변이(뒤판 엣지 1개를 앞판 삼각형에 꿰뚫음) ${mutated.count}건`,
  );
  for (const e of clean.examples) {
    const t = e.tri * 3;
    console.log(
      `    위치: 엣지 ${pName[pOf(e.edge[0])]}(${cm(g.pos2[e.edge[0] * 2])},${cm(g.pos2[e.edge[0] * 2 + 1])})cm↔(${cm(g.pos2[e.edge[1] * 2])},${cm(g.pos2[e.edge[1] * 2 + 1])})cm · 삼각형 ${pName[pOf(g.tris[t])]}(${cm(g.pos2[g.tris[t] * 2])},${cm(g.pos2[g.tris[t] * 2 + 1])})cm`,
    );
  }
  console.log(
    `    배치 원본 ${xsecRaw.count}건 / S0 교정 후 ${clean.count}건 — 차이는 **교정이 만든 것**이다(표면 투영이 이웃 정점을 서로 다른 표면점으로 보내 국소 접힘을 만든다). §4 S0의 명세 기제는 오프셋 확대이고 투영 교정은 이 하네스가 추가한 것 — 다음 단일 변경 후보.`,
  );
  const rows = [
    { name: "자기교차 0(배치 원본)", ok: xsecRaw.count === 0, detail: `${xsecRaw.count}건` },
    { name: "자기교차 0(S0 교정 후)", ok: clean.count === 0, detail: `${clean.count}건 (배치 원본 ${xsecRaw.count})` },
    { name: "자기교차 판정기 변이 역검증", ok: mutated.count > clean.count, detail: `심은 뒤 ${mutated.count} > 심기 전 ${clean.count}` },
  ];
  for (const r of rows) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name} — ${r.detail}`);
    if (!r.ok) fails.push(r.name);
  }
}

// ── 8. 시접 배치 갭 — S1 램프가 좁혀야 할 거리(2b 예산의 입력)
{
  const byKind = new Map<string, number[]>();
  for (const s of g.seams) {
    const list = byKind.get(s.kind);
    if (list) list.push(s.gapM); else byKind.set(s.kind, [s.gapM]);
  }
  const parts: string[] = [];
  for (const [kind, gaps] of byKind) {
    parts.push(`${kind} ${(Math.min(...gaps) * 100).toFixed(1)}~${(Math.max(...gaps) * 100).toFixed(1)}cm(평균 ${((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100).toFixed(1)})`);
  }
  console.log(`\n[pattern] 배치 시접 갭(S1 램프 입력): ${parts.join(" · ")}`);
}

// ── 9. 시접 그룹이 **경계 순서**인가 — 렌더 브리지(§3.4)가 기대는 유일한 가정.
// `PatternPreview`는 seamGroups.a/b를 그대로 스트립 쌍 순서로 쓰고 이웃 쌍끼리
// 사각형을 만든다. 순서가 깨지면 띠가 패널을 가로질러 접히는데, 그건 화면에서만
// 보이고 물리 채널은 전부 통과한다 — 그래서 여기서 수치로 잡는다.
// 판정: 연속 정점 간격이 메시 엣지 상한을 넘지 않을 것(넘으면 목록이 건너뛴 것).
{
  const P = g.positions;
  const dist = (i: number, j: number): number =>
    Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
  // 상한 = **메시 엣지 최대**. 경계 순서라면 연속 두 정점은 실제 메시 엣지이므로
  // 그 길이를 넘을 수 없다 — 상수를 새로 만들지 않고 메시에서 직접 뽑는다.
  let limit = 0;
  for (const e of g.edgePairs) {
    const d = dist(e.a, e.b);
    if (d > limit) limit = d;
  }
  let worst = 0, worstLabel = "", n = 0;
  for (const grp of g.seamGroups) {
    for (let k = 1; k < grp.a.length; k++) {
      for (const step of [dist(grp.a[k - 1], grp.a[k]), dist(grp.b[k - 1], grp.b[k])]) {
        n++;
        if (step > worst) { worst = step; worstLabel = grp.label; }
      }
    }
  }
  const ok = worst <= limit;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  시접 그룹 경계 순서(브리지 전제) — 연속 정점 최대 간격 ${(worst * 1000).toFixed(2)}mm ≤ 상한 ${(limit * 1000).toFixed(2)}mm @${worstLabel} (표본 ${n})`,
  );
  if (!ok) fails.push("시접 그룹 경계 순서(브리지 전제)");
}

// ── 10. 배치 사상이 **전단사**인가 (§4 S0 3판의 3검증)
// 전부 `placedRaw`(S0 교정 **전**)에서 잰다 — 교정은 하네스가 덧붙인 것이고
// 그 산출물을 섞으면 사상 자체의 성질을 못 본다.
{
  const P = placedRaw;
  const at = (i: number): [number, number, number] => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  // (a) 코너 8개 일치 — 목점·어깨끝은 앞뒤판이 **같은 점**이어야 하고(링·능선
  //     공유), 겨드랑이·밑단은 z만 패널 부호 × margin 만큼 갈라져야 한다.
  const nearest = (panel: number, x: number, y: number): number => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < g.panelCounts[panel]; i++) {
      const gi = g.panelStarts[panel] + i;
      const d = Math.hypot(g.pos2[gi * 2] - x, g.pos2[gi * 2 + 1] - y);
      if (d < bd) { bd = d; best = gi; }
    }
    return best;
  };
  const D = g.draft.dims;
  // 기대 z 분리는 **배치에서 도출**한다(하드코딩 금지·함정 12). 평면 배치에서는
  // 앞뒤판이 각자의 평면에 있으므로 모든 코너가 앞 오프셋 + 뒤 오프셋만큼 떨어진다.
  // 검사의 취지는 "짝지어야 할 코너가 x·y에서 일치하는가"이고, z 분리는 배치
  // 규약이 정하는 값이다.
  const expectDz = g.meta.torsoOffsetFrontM + g.meta.torsoOffsetBackM;
  const corners: { name: string; x: number; y: number; expectDzM: number }[] = [];
  for (const s of [1, -1]) {
    corners.push({ name: `목점(${s > 0 ? "x+" : "x-"})`, x: s * D.neckHalfWidthM, y: 0, expectDzM: expectDz });
    corners.push({ name: `어깨끝(${s > 0 ? "x+" : "x-"})`, x: s * D.shoulderHalfM, y: D.shoulderDropM, expectDzM: expectDz });
    corners.push({ name: `겨드랑이(${s > 0 ? "x+" : "x-"})`, x: s * D.halfWidthM, y: D.armholeDepthM, expectDzM: expectDz });
    corners.push({ name: `밑단(${s > 0 ? "x+" : "x-"})`, x: s * D.halfWidthM, y: D.lengthM, expectDzM: expectDz });
  }
  let worstCornerMm = 0, worstCornerName = "";
  for (const c of corners) {
    const f = at(nearest(PANEL_PAT_FRONT, c.x, c.y));
    const b = at(nearest(PANEL_PAT_BACK, c.x, c.y));
    // z는 기대 분리량만큼 어긋나는 게 정상 — 그만큼 뺀 잔차를 본다.
    const err = Math.hypot(f[0] - b[0], f[1] - b[1], Math.abs(f[2] - b[2]) - c.expectDzM);
    if (err * 1000 > worstCornerMm) { worstCornerMm = err * 1000; worstCornerName = c.name; }
  }
  const okCorner = worstCornerMm < 0.01;
  console.log(`\n[pattern] 배치 사상 전단사 검증`);
  console.log(
    `  ${okCorner ? "PASS" : "FAIL"}  코너 8개 앞뒤판 일치 — 최대 잔차 ${worstCornerMm.toFixed(4)}mm @${worstCornerName} (앞뒤 평면 z 분리 ${(expectDz * 1000).toFixed(1)}mm 제외 — 배치에서 도출)`,
  );
  if (!okCorner) fails.push("배치 코너 일치");

  // (b) 링 길이 — 부풂 이분법이 목표로 삼은 것은 표본 폴리라인이므로 해석
  //     길이(necklineGirthM)와의 잔차는 **이산화분뿐**이어야 한다.
  let ringM = 0;
  for (const e of g.necklineRing) {
    ringM += Math.hypot(P[e.b * 3] - P[e.a * 3], P[e.b * 3 + 1] - P[e.a * 3 + 1], P[e.b * 3 + 2] - P[e.a * 3 + 2]);
  }
  // 같은 표본의 2D 폴리라인 길이 = 이산화 하한. 링이 이 값이면 오차는 전부 이산화분.
  let poly2dM = 0;
  for (const pi of [0, 1]) {
    const sp = g.draft.panels[pi].segments.find((s) => s.name === "neck")?.samples ?? [];
    for (let i = 1; i < sp.length; i++) poly2dM += 2 * Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
  }
  const discCm = (D.necklineGirthM - poly2dM) * 100;
  const errCm = (ringM - poly2dM) * 100;
  // 링은 몸 폐곡선 위에 얹히므로 잔차의 출처는 **이산화 두 곳**뿐이다:
  //   (i) 폐곡선이 24 각도 bin의 볼록껍질이라 안착 높이 이분법이 계단이다
  //   (ii) 목선 표본이 껍질 정점 사이에 떨어져 현이 모서리를 자른다
  // 둘 다 껍질의 해상도에 묶여 있으므로 문턱을 그 규모(패턴 목선의 1%)로 둔다.
  const loopCm = g.meta.neckLoopGirthM * 100;
  const okRing = Math.abs(errCm) <= 0.01 * D.necklineGirthM * 100;
  console.log(
    `  ${okRing ? "PASS" : "FAIL"}  링 길이 = 패턴 목선(이산화분만) — 배치 ${(ringM * 100).toFixed(3)}cm vs 표본 폴리라인 ${(poly2dM * 100).toFixed(3)}cm (잔차 ${errCm.toFixed(4)}cm) · 해석 목선 ${(D.necklineGirthM * 100).toFixed(3)}cm(이산화 손실 ${discCm.toFixed(3)}cm) · 안착 높이 y${(g.meta.neckLoopY * 100).toFixed(2)}cm · 이산화 분해: 폐곡선 ${loopCm.toFixed(3)}cm(이분법 계단 ${(loopCm - poly2dM * 100).toFixed(3)}) → 배치 링(모서리 컷 ${(ringM * 100 - loopCm).toFixed(3)}) · 반곡선 앞 ${(g.meta.neckArcM[0] * 100).toFixed(3)}/${(g.meta.neckArcTargetM[0] * 100).toFixed(3)}cm 뒤 ${(g.meta.neckArcM[1] * 100).toFixed(3)}/${(g.meta.neckArcTargetM[1] * 100).toFixed(3)}cm`,
  );
  if (!okRing) fails.push("배치 링 길이(이산화분만)");

  // (c) 삼각형 뒤집힘 — 내부 깊이 매개화가 패널 중앙부에서 모호해지면 여기서
  //     드러난다. 다른 채널(관통·자기교차)은 겹치기만 한 접힘을 못 잡는다.
  const foldRaw = countPlacementFolds(placedRaw, g.tris);
  const foldCor = countPlacementFolds(g.positions, g.tris);
  const okFold = foldRaw.folds === 0;
  for (const t of foldRaw.examples) {
    const c = [0, 1, 2].map((k) => g.tris[t * 3 + k]);
    const mx = c.reduce((a, i) => a + g.pos2[i * 2], 0) / 3, my = c.reduce((a, i) => a + g.pos2[i * 2 + 1], 0) / 3;
    console.log(`    접힘 위치: 패널${panelOfIdx(c[0])} 패턴(${cm(mx)},${cm(my)})cm`);
  }
  console.log(
    `  ${okFold ? "PASS" : "FAIL"}  삼각형 뒤집힘 0(배치 원본) — ${foldRaw.folds}건 · 최악 인접 법선 내적 ${foldRaw.worstDot.toFixed(4)} · [참고] S0 교정 후 ${foldCor.folds}건(내적 ${foldCor.worstDot.toFixed(4)})`,
  );
  if (!okFold) fails.push("배치 삼각형 뒤집힘 0");

  // (d) **예측** — 링이 안착할 높이 = 몸 폐곡선(표면+옷 오프셋)이 링 길이와
  //     같아지는 높이. 볼록 폐곡선의 오프셋은 정확히 2πm만큼 늘어나므로
  //     슬라이스 둘레에서 바로 도출한다(새 계측 없음). 정착 후 실측과 대조할 것.
  {
    const offM = 2 * Math.PI * MARGIN_ALL;
    const up = body.slices.filter((s) => s.y >= body.shoulderJointY).sort((a, b) => a.y - b.y);
    let pred = NaN, lo = "", hi2 = "";
    for (let i = 1; i < up.length; i++) {
      const g0 = up[i - 1].girthM + offM, g1 = up[i].girthM + offM;
      if ((g0 - D.necklineGirthM) * (g1 - D.necklineGirthM) <= 0 && g0 !== g1) {
        pred = up[i - 1].y + (up[i].y - up[i - 1].y) * ((D.necklineGirthM - g0) / (g1 - g0));
        lo = `y${cm(up[i - 1].y)}:${cm(g0)}`; hi2 = `y${cm(up[i].y)}:${cm(g1)}`;
        break;
      }
    }
    console.log(
      `  [예측] 링 안착 높이 = 몸 폐곡선(표면+오프셋 ${cm(MARGIN_ALL)}cm) ${cm(D.necklineGirthM)}cm 지점 → **y${Number.isNaN(pred) ? "미교차" : cm(pred)}cm** (보간 구간 ${lo} ~ ${hi2}) · 목밑 y${cm(D.neckBaseY)}cm · 정착 후 실측과 대조할 것`,
    );
  }
}

console.log(
  `\n[pattern] 게이트: ${fails.length === 0 ? "통과" : `실패 ${fails.length}건 — ${fails.join(", ")}`} · 경과 ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
process.exit(fails.length === 0 ? 0 : 1);
