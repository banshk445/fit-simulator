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
import { ARM_AXIS_RADIUS, deriveBodySkeleton, nearestOnSegments } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { buildPatternGarment, PANEL_PAT_BACK, PANEL_PAT_FRONT, PATTERN_EDGE_INTERIOR_M } from "../src/lib/patternGarment";
import { makeOutlineProvider } from "../src/lib/bodyOutline";
import { buildPatternSim } from "../src/lib/buildPatternSim";
import { correctPlacementPenetration, countInside, countOpenEdges, countSelfIntersections, makeParityInside } from "../src/lib/patternPlacement";
import { computeBodyCoverage, deriveShoulderBand } from "../src/lib/coverageMetric";
import { bakeSdf, createCachedSdfIterationFriction, createSdfFrictionPass, makeRadialSignedSampler, makeSkeletonSignedSampler, sampleSdf, sdfNormal } from "../src/lib/sdfCollision";
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
  STIFFNESS_BEND,
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

// ══ 정본 · 몸 반경 프로파일 v1 (42회차 신설 · 영구) ══════════════════════════
//
// **이후 전 회차는 "몸 반경"을 이것만 인용한다.** 39·40·41회차가 서로 다른 세 값을
// 썼고(아래 대조) 그 차이가 처방 판정을 뒤집었다 — 반복 인용되는 물리량은 명명된
// 단일 계기로 고정한다(함정 13 "집합").
//
// 산출 규칙(전부 코드에서 도출 · 손으로 정한 상수 0개):
//  · 대상 = 토르소 시트 정점(`frontIndex` ∪ `backIndex`)
//  · 팔 제외 = `bodySkeleton.ARM_AXIS_RADIUS`(메시 굽기의 `ARM_EXCLUDE_RADIUS`와 같은 값)
//    반경 안에 드는 정점을 뺀다. 기준 선분은 `pose.armLeft/armRight`의 어깨→끝.
//    ※ `frontIndex+backIndex`는 **팔 제외가 아니다** — 41회차에 삼각근이 옆 방향
//      18.6~20.6cm로 남아 있는 것이 실측됐다. 그래서 여기서 한 번 더 뺀다.
//  · 반경 = 몸통 캡슐 축(`capsules[0].top`의 x·z) 기준 수평 거리
//  · 방향 섹터 = 캡슐 축에서 본 방위각. 앞(+z ±30°) / 뒤(−z ±30°) / 나머지 옆
const bodyRadiusProfile = (() => {
  const cap = collision.capsules[0];
  const ax = cap.top.x, az = cap.top.z;
  const armSegs = [pose.armLeft, pose.armRight].map((a) => ({
    sx: a.trueShoulder.x, sy: a.trueShoulder.y, sz: a.trueShoulder.z,
    ex: a.trueShoulder.x + a.dir.x * a.length, ey: a.trueShoulder.y + a.dir.y * a.length, ez: a.trueShoulder.z + a.dir.z * a.length,
  }));
  const nearArm = (x: number, y: number, z: number): boolean => armSegs.some((g) => {
    const vx = g.ex - g.sx, vy = g.ey - g.sy, vz = g.ez - g.sz;
    const t = Math.max(0, Math.min(1, ((x - g.sx) * vx + (y - g.sy) * vy + (z - g.sz) * vz) / (vx * vx + vy * vy + vz * vz)));
    const dx = x - (g.sx + vx * t), dy = y - (g.sy + vy * t), dz = z - (g.sz + vz * t);
    return dx * dx + dy * dy + dz * dz < ARM_AXIS_RADIUS * ARM_AXIS_RADIUS;
  });
  const verts = new Set<number>();
  for (const idx of [collision.frontIndex, collision.backIndex]) { if (!idx) continue; for (let k = 0; k < idx.length; k++) verts.add(idx[k]); }
  const BIN = 0.01;
  const bins = new Map<number, { max: number; front: number; back: number; side: number; n: number }>();
  let excluded = 0;
  for (const v of verts) {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    if (nearArm(x, y, z)) { excluded++; continue; }
    const r = Math.hypot(x - ax, z - az);
    const k = Math.round(y / BIN);
    const b = bins.get(k) ?? { max: 0, front: 0, back: 0, side: 0, n: 0 };
    b.max = Math.max(b.max, r); b.n++;
    const deg = (Math.atan2(z - az, x - ax) * 180) / Math.PI;
    if (deg > 60 && deg < 120) b.front = Math.max(b.front, r);
    else if (deg < -60 && deg > -120) b.back = Math.max(b.back, r);
    else b.side = Math.max(b.side, r);
    bins.set(k, b);
  }
  return {
    axisX: ax, axisZ: az, kept: verts.size - excluded, excluded, total: verts.size,
    at: (yM: number) => bins.get(Math.round(yM / BIN)) ?? null,
  };
})();
{
  const c2 = (v: number): string => (v * 100).toFixed(2);
  console.log(
    `[정본·몸 반경 프로파일 v1] 대상 = frontIndex∪backIndex ${bodyRadiusProfile.total}정점 · 팔 제외 ${bodyRadiusProfile.excluded}(ARM_AXIS_RADIUS ${(ARM_AXIS_RADIUS * 1000).toFixed(0)}mm · pose 팔 선분) → 남은 ${bodyRadiusProfile.kept} · 축(x ${c2(bodyRadiusProfile.axisX)}, z ${c2(bodyRadiusProfile.axisZ)}) · 1cm bin`,
  );
  // 39·40·41회차가 인용한 값과 나란히. 앞 두 열은 **과거 인용값**이지 재측정이 아니다.
  const past40 = new Map<number, number>([[132, 16.03], [135, 14.68], [138, 12.50], [140, 10.99], [143, 8.91], [145, 7.91]]);
  const past41 = new Map<number, number>([[132, 17.07], [135, 16.03], [138, 13.92], [140, 13.08], [143, 12.11], [145, 7.98]]);
  console.log("  y(cm)  정본최대   앞      뒤      옆     n  │ 40회차 인용  41회차 인용  차(정본−40)");
  for (let yc = 128; yc <= 146; yc++) {
    const b = bodyRadiusProfile.at(yc / 100);
    if (!b) continue;
    const p40 = past40.get(yc), p41 = past41.get(yc);
    console.log(
      `  ${String(yc).padStart(5)} ${c2(b.max).padStart(8)} ${c2(b.front).padStart(7)} ${c2(b.back).padStart(7)} ${c2(b.side).padStart(7)} ${String(b.n).padStart(4)}  │ ${(p40 !== undefined ? p40.toFixed(2) : "-").padStart(10)} ${(p41 !== undefined ? p41.toFixed(2) : "-").padStart(12)} ${(p40 !== undefined ? (b.max * 100 - p40).toFixed(2) : "-").padStart(12)}`,
    );
  }
  console.log(
    `  [대조] 39회차가 인용한 "실제 목밑 반경" ${c2(body.neckBaseGirthM / (2 * Math.PI))}cm는 **y${c2(body.neckBaseY)} 한 높이의 등방 등가반경**이고 프로파일이 아니다 — "2.37배" 진술의 분모였다(2b-39 정정).`,
  );
}

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

// ── 82회차 §2 — **환경 스탬프**. 함정 26의 구조적 처방이다.
// 81회차가 기준선 A를 재현하지 못하고 「런타임 드리프트」로 등재했으나, 원인은
// `RINGTOTAL=0` **env 누락**이었다(그 스위치는 `:611`에서 링 총길이 상한을 끈다 =
// 물리 제약이다). 실행 로그 어디에도 「무슨 env로 돌렸는가」가 없어서 3회 실행 ·
// 태그 워크트리 체크아웃 · 원인 격리를 전부 같은 누락 위에서 했다.
// **노트 규율에 맡기면 재발한다 — 계기가 스스로 기록한다.**
// 미설정도 반드시 인쇄한다(이번 사고는 「안 찍힌 것」이 원인이었다).
{
  const ENV_KEYS = [
    // 상태를 바꾸는 것(물리·구성)
    "RINGTOTAL", "TORSOCAP", "SINGLE", "SECONDS", "PINDRESS", "GRAV0", "S0FIX",
    "HEMBEND", "MAGNET", "MAGNET_D0", "ADSORB_PENONLY", "WINDING", "FIXTURE",
    // 계기·출력
    "PATTERNCORE", "DIAG", "PROBE", "EXPORT_META", "PATTERN_META", "SKELSIGN", "SLEEVESIGN",
  ];
  const bvhVer = (() => {
    try {
      return (JSON.parse(readFileSync("node_modules/three-mesh-bvh/package.json", "utf8")) as { version: string }).version;
    } catch { return "미상"; }
  })();
  console.log(
    `[dress] 환경 스탬프: node ${process.version} · v8 ${process.versions.v8} · ${process.platform}/${process.arch} · three ${THREE.REVISION} · three-mesh-bvh ${bvhVer}`,
  );
  console.log(
    `[dress] env: ${ENV_KEYS.map((k) => `${k}=${process.env[k] ?? "미설정"}`).join(" · ")}`,
  );
  console.log(
    `[dress] 해시: pattern ${patternHash} · fixture ${fixtureHash} — **재현하려면 위 env 줄을 그대로 쓴다**(함정 26)`,
  );
}

console.log(
  `[dress] 패널 정점 ${total}(${g.panelCounts.join("/")}) · 삼각형 ${g.tris.length / 3} · 메시 엣지 ${g.edgePairs.length} · 시접 ${g.seams.length}쌍 ${JSON.stringify(g.meta.seamCounts)}`,
);

// ── S0 배치 관통 교정(2a와 **같은 함수**).
const wholeMesh = new ArrayBvhCollision();
wholeMesh.rebuild(position, wholeIndex);
const insideParity = makeParityInside(wholeMesh);
// ── 65회차 §2 **와인딩 실측**(`WINDING=1` · 진단 전용 · 물리 0줄) ────────────────
// `bvhFromArrays.ts:113-120`이 "이 마네킹은 일부 영역 와인딩이 뒤집혀 있다(M2-3 3연속
// 실패 원인)"를 명기하는데 **팔 대역을 잰 회차가 없다**(64 §9). 소매 접촉 후보는
// 전부 "면 법선이 바깥을 향한다"를 전제하므로 이 값이 그 전제의 근거다.
// 기준 방향은 **골격**이다 — 61·62회차가 라디얼보다 6.5배 정확함을 오라클로 확증했다.
// 대역 라벨도 골격에서 나온다(최근접 선분이 팔이면 팔 대역) — 새 손 상수 0.
if (process.env.WINDING === "1" && wholeIndex) {
  const armSet = new Set(skeleton.arms);
  type Row = { flipped: boolean; y: number; st: number; arm: boolean; cos: number };
  const rows: Row[] = [];
  for (let t = 0; t + 2 < wholeIndex.length; t += 3) {
    const ia = wholeIndex[t] * 3, ib = wholeIndex[t + 1] * 3, ic = wholeIndex[t + 2] * 3;
    const ax = position[ia], ay = position[ia + 1], az = position[ia + 2];
    const e1x = position[ib] - ax, e1y = position[ib + 1] - ay, e1z = position[ib + 2] - az;
    const e2x = position[ic] - ax, e2y = position[ic + 1] - ay, e2z = position[ic + 2] - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue; // 퇴화 삼각형 — 방향 미정의. 세지 않는다
    nx /= nl; ny /= nl; nz /= nl;
    const cx = (ax + position[ib] + position[ic]) / 3;
    const cy = (ay + position[ib + 1] + position[ic + 1]) / 3;
    const cz = (az + position[ib + 2] + position[ic + 2]) / 3;
    const k = nearestOnSegments(cx, cy, cz, skeleton.segments);
    let ox = cx - k.x, oy = cy - k.y, oz = cz - k.z;
    const ol = Math.hypot(ox, oy, oz);
    if (ol < 1e-9) continue; // 축 위 — 바깥 방향 미정의
    ox /= ol; oy /= ol; oz /= ol;
    const cos = nx * ox + ny * oy + nz * oz;
    const ka = nearestOnSegments(cx, cy, cz, skeleton.arms);
    const arm = ka.d2 <= k.d2 + 1e-12 && armSet.size > 0; // 최근접이 팔 선분
    const st = Math.hypot(ka.x - skeleton.arms[0].a.x, ka.y - skeleton.arms[0].a.y, ka.z - skeleton.arms[0].a.z);
    rows.push({ flipped: cos < 0, y: cy, st, arm, cos });
  }
  const q = (a: number[], f: number): string => (a.length ? a[Math.floor(f * (a.length - 1))].toFixed(1) : "-");
  console.log(`  [65계기·와인딩] 삼각형 ${rows.length}개(퇴화 제외) · 기준 = 골격 바깥 방향(라디얼 아님)`);
  for (const [nm, set] of [["팔 대역", rows.filter((r) => r.arm)], ["몸통 대역(대조군)", rows.filter((r) => !r.arm)]] as const) {
    if (set.length === 0) { console.log(`    ${nm} n=0 — 산출 불가`); continue; }
    const fl = set.filter((r) => r.flipped);
    const cs = set.map((r) => r.cos).sort((a, b) => a - b);
    const ys = fl.map((r) => r.y * 100).sort((a, b) => a - b);
    const sts = fl.map((r) => r.st * 100).sort((a, b) => a - b);
    console.log(
      `    ${nm} n=${set.length} · **뒤집힘 ${fl.length} (${((100 * fl.length) / set.length).toFixed(1)}%)**` +
      ` · cos(법선, 바깥) p10/중앙/p90 ${cs[Math.floor(0.1 * (cs.length - 1))].toFixed(3)}/${cs[Math.floor(0.5 * (cs.length - 1))].toFixed(3)}/${cs[Math.floor(0.9 * (cs.length - 1))].toFixed(3)}` +
      (fl.length ? ` · 뒤집힘 y p10/중앙/p90 ${q(ys, 0.1)}/${q(ys, 0.5)}/${q(ys, 0.9)}cm · 팔축 station ${q(sts, 0.1)}/${q(sts, 0.5)}/${q(sts, 0.9)}cm` : ""),
    );
  }
}
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
// 46회차 — t=0 자기교차(정착 분해의 대조 기준).
let xs0Count = -1;
// ── t=0 게이트 (§4 S0 개정 — 목 스레딩 배치가 성립했는가)
const t0Fails: string[] = [];
{
  const xs0 = countSelfIntersections(g.positions, g.tris, g.edgePairs, 0.03);
  xs0Count = xs0.count; // 46회차 — 정착 분해에서 t=0 대조로 쓴다
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
// ── 60회차 **H3 대조군**(`HEMBEND=1` · 기본 off · 진단 전용 · 승격 금지) ─────────
// 목적은 **굽힘 강성이 프릴의 주 기전인가**를 가르는 것뿐이다. 59회차가 H3를
// "「부품 대신 힘」 재발 = 대체품 3층"으로 등재했으므로 **처방 후보가 아니고**,
// 아래 두 값은 **판정용이 아니라 기전 탐침**이라 결과가 좋아도 채택하지 않는다.
//   대역폭 2.5cm — v2-design:427의 「접음단 2~3cm」 중앙. H4가 만들 두 겹과 **같은
//     자리**를 짚어야 비교가 되기 때문이지, 이 값이 최적이라는 근거는 없다.
//   raw 0.6 — STIFFNESS_BEND 0.1의 6배. 배수를 크게 잡은 것은 "안 움직인다"가
//     나왔을 때 그것이 **약해서가 아님**을 확보하려는 것이다(귀무 쪽 보호).
// **둘 다 스윕하지 않는다** — 스윕해서 좋은 값을 고르면 그 순간 함정 14다.
const HEMBEND = process.env.HEMBEND === "1";
const HEMBEND_BAND_M = 0.025, HEMBEND_RAW = 0.6;
const hemBendProbe = HEMBEND
  ? {
      raw: HEMBEND_RAW,
      is: (a: number, b: number): boolean => {
        const lo = g.draft.dims.lengthM - HEMBEND_BAND_M;
        const ya = a < g.panelStarts[2] ? g.pos2[a * 2 + 1] : -1;
        const yb = b < g.panelStarts[2] ? g.pos2[b * 2 + 1] : -1;
        return ya > lo && yb > lo; // 양 끝이 다 대역 안일 때만(경계 걸침 제외)
      },
    }
  : undefined;
const ps = buildPatternSim(g, preset.iterations, false, hemBendProbe);
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
let ringRestConfirmedM = 0;
let ringPlacedM = 0;
// 38회차 계기 C — 폐곡선 순회 순서(정점 인덱스). 위 검증 블록이 만들어 내보낸다.
let ringOrder: number[] = [];
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
  // ── 38회차 계기 C — 정의역 확정(37회차 A1·B1). 순회를 **버리지 않고** 내보낸다.
  // 37회차 B1: 이 블록이 adj/deg를 만들어 검증만 하고 블록 스코프로 폐기했다.
  ringOrder = (() => {
    const out: number[] = [];
    let p = -1, c = ringClosed[0].a;
    for (let i = 0; i < deg.size; i++) {
      out.push(c);
      const nb = adj.get(c)!;
      const nxt = nb.find((v) => v !== p) ?? nb[0];
      p = c; c = nxt;
    }
    return out;
  })();
  // 사슬 분할 — necklineRing은 **열린 사슬 2개**(앞판 1 · 뒤판 1)다. 37회차 A1이
  // "앞/뒤 30/30인지 미인쇄 = 확인 불가"로 남긴 항목을 런타임에서 뽑는다.
  {
    const chain = (lo: number, hi: number) => {
      const es = g.necklineRing.filter((e) => e.a >= lo && e.a < hi);
      const vs = new Set<number>(es.flatMap((e) => [e.a, e.b]));
      let rest = 0;
      for (const e of es) rest += Math.hypot(g.pos2[e.b * 2] - g.pos2[e.a * 2], g.pos2[e.b * 2 + 1] - g.pos2[e.a * 2 + 1]);
      return { n: es.length, v: vs.size, rest };
    };
    const f = chain(0, g.panelStarts[1]), b = chain(g.panelStarts[1], g.panelStarts[2]);
    console.log(
      `  [38계기C·사슬 분할] 앞판 사슬 엣지 ${f.n}·정점 ${f.v}·rest ${cm(f.rest)}cm · 뒤판 사슬 엣지 ${b.n}·정점 ${b.v}·rest ${cm(b.rest)}cm · 합 엣지 ${f.n + b.n}·rest ${cm(f.rest + b.rest)}cm`,
    );
    console.log(`  [38계기C·순회 순서] 폐곡선 정점 ${ringOrder.length}개 · 앞판 ${ringOrder.filter((i) => i < g.panelStarts[1]).length} / 뒤판 ${ringOrder.filter((i) => i >= g.panelStarts[1]).length} · 시작 #${ringOrder[0]} → ${ringOrder.slice(0, 8).map((i) => `#${i}`).join("→")}…`);
    // rest 3종 구분(37회차 A3 — 셋을 한 이름으로 부르면 함정13)
    const distRest = ringJoinPairs.map((sm) => {
      const c = [...sim.constraintPairs].find((q) => (q.a === sm.a && q.b === sm.b) || (q.a === sm.b && q.b === sm.a));
      return c?.restLength ?? NaN;
    });
    console.log(
      `  [38계기C·접합 rest 3종] ① 거리 제약 rest ${distRest.map((v) => cm(v)).join(" / ")}cm(엣지별 · buildPatternSim이 배치 3D 갭에서 등록) · ② collarRing rest ${(joinRestM * 1000).toFixed(1)}mm(setCollarRing · S1 내내 미발화) · ③ 시접 target ${(joinRestM * 1000).toFixed(1)}mm(램프 도착점) — **서로 다른 값이다**`,
    );
  }
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
  // 29회차 확정 — 제약이 순회하는 집합(necklineRing)에서 직접 뜬 rest.
  // ringRestM(하네스 재구성분)은 ringLimitStart 배선 때문에 이번 회차엔 못 고친다.
  ringRestConfirmedM = ringM;
  ringPlacedM = ringM;
  // RINGTOTAL=0 — 26회차 총 길이 상한 제거(= 25회차 상태 재현). 계기용 ablation.
  ringTotalMaxM = process.env.RINGTOTAL === "0" ? 0 : headGirthM;
  console.log(
    `[dress] 링 **총 길이** 상한: ${cm(ringTotalMaxM)}cm = 머리 최대 둘레(목 최소 단면 위 슬라이스 최대) · rest ${cm(ringRestM)}cm 대비 계수 **${(ringTotalMaxM / Math.max(1e-9, ringRestM)).toFixed(3)}**(도출) · 적용 = step 직후 무게중심 등방 축소 1회/프레임(상시) · 엣지별 상한은 병존`,
  );
  const targetM = g.draft.dims.necklineGirthM;
  const errCm = (ringM - targetM) * 100;
  console.log(
    `[dress] 넥밴드 원주 제약: 링 엣지 ${g.necklineRing.length}쌍 · 배치 실측 원주 ${cm(ringM)}cm vs 패턴 목선 ${cm(targetM)}cm (오차 ${errCm.toFixed(3)}cm) · 신장 상한 ${COLLAR_STRAIN_LIMIT}(v1 승계·추정)` +
    ` · **rest 집합 주의**: 여기 ${cm(ringM)}cm = \`necklineRing\` **${g.necklineRing.length}엣지**(= ringLenM이 순회하는 집합). 별도로 인쇄되는 ${cm(ringRestM)}cm는 **접합 2엣지의 시접 target을 더한 값**(ringRestM)이고 같은 것이 아니다 — 29회차 계열`,
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
// ── 49회차 P-α1 (진단 전용 · 기본 off · v1 0줄) — **관통-only 흡착**.
// 47회차 후보 α: 양방향 흡착이 탐지반경 15cm 안 **비관통 정점까지** 표면+margin으로
// 끌어당겨(서브스텝당 4회 = 목표까지 87.0%) 여분 둘레를 몸에 감고 면내 압축을 만든다.
// `penetrationAxis`를 넘기면 리졸버가 "표면 밖(d≥0)은 안 건드리고 안쪽만 밀어낸다"로
// 바뀐다(bvhFromArrays.ts:227-238). 축은 몸통 캡슐 축을 그대로 쓴다(새 상수 0).
// ※ 이것은 **ablation이지 처방이 아니다** — 47회차가 그렇게 등록했다.
const ADSORB_PENONLY = process.env.ADSORB_PENONLY === "1";
const penAxis = ADSORB_PENONLY
  ? { enabled: true, x: collision.capsules[0].top.x, z: collision.capsules[0].top.z }
  : undefined;
// 53회차 축① — **거동 무변화 실증용**. `MAGNET=1`이면 국면 판정 경로를 켜되 가중은 w ≡ 1이라
// 기준선과 **계산 동치**여야 한다(21채널 비트 대조가 그 실증이다). 처방(가중 on)은 54회차.
const MAGNET_AXIS1 = process.env.MAGNET === "1";
// ── 54회차 처방 **D0** — 국면1(자석분) 차단. `MAGNET_D0=1` · 기본 off.
// 축①이 이미 배선했으므로 **공유 파일 추가 수정 0**이고 변수는 가중 `w`뿐이다.
// D0는 **법선을 쓰지 않는다** — `w`가 `ny`를 무시하는 상수 함수라 얼룩 장·법선 출처
// 문제가 원천적으로 없다(규범 9: 함수 형태 자유도 0).
// 국면2(껍질 안착)·국면3(관통 해소)은 **불변**이다.
const MAGNET_D0 = process.env.MAGNET_D0 === "1";
const magnetArg = MAGNET_D0 ? { w: (): number => 0 } : MAGNET_AXIS1 ? { w: (): number => 1 } : undefined;
const meshResolver = createPanelSplitResolver(
  [
    frontMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, undefined, undefined, undefined, penAxis, magnetArg),
    backMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, undefined, undefined, undefined, penAxis, magnetArg),
    null,
    null,
  ],
  g.panelCounts,
);
// **45회차 승격**: 몸통 캡슐 전면 제거가 새 기준선이다(사전 등록 3/3 통과 —
// 재현성 21채널 비트 일치 · DONE·RETRY 0 · A 대비 회귀 5종 전부 개선).
// 기본값을 뒤집는다. `TORSOCAP=1`이 **처방 A(몸통 캡슐 구성)를 그대로 복원**하므로
// 43회차가 확정한 A 기준선은 보존된다(45회차 등재 ①).
// 44회차 (a) 실측: 이 분기는 `dressPattern.ts` 안에만 있고 그 파일은 어디서도
// import되지 않는 진입 스크립트다 → v1 제품 0줄 · 12콤보 불변 · **fixture 불변**.
// 39회차 ablation 스위치(원래 진단 전용) — 몸통 캡슐만 끈다.
// 함정16 규범("근접을 기전으로 승격하려면 ablation으로 흔들어라")의 이행 수단이다.
// 처방이 아니다: 관통·cov 붕괴는 예상된 부작용이고 판정 대상이 아니다.
const TORSOCAP = process.env.TORSOCAP === "1";
// 42회차 처방 A — 정점당 **가장 깊이 파묻힌 캡슐 1개만** 민다(기본 on · `SINGLE=0`으로 해제).
const SINGLE_DEEPEST = process.env.SINGLE !== "0";
const unified = (positions: Float32Array, pinned: Uint8Array, n: number): void => {
  meshResolver(positions, pinned, n);
  let offset = 0;
  for (let p = 0; p < g.panelCounts.length; p++) {
    const count = g.panelCounts[p];
    const pos = positions.subarray(offset * 3, (offset + count) * 3);
    const pin = pinned.subarray(offset, offset + count);
    if (TORSOCAP && (p === PANEL_PAT_FRONT || p === PANEL_PAT_BACK)) {
      // 42회차 P2 재시도 — **정점당 캡슐 1개만**(가장 깊이 파묻힌 것). 사전 반증 (a) 참:
      // 19단 스택에서 한 정점이 4~7개를 동시 발화시켜 실효 완화가 0.35 → 0.76~0.83으로
      // 2.4배 약해지고 축(y) 성분이 새로 생겼다. 캡슐 2개인 기준선에선 링 밴드에서
      // 1개만 발화하므로 이 플래그가 켜져도 **거동이 같다**(비트 동일 확인 대상).
      applyCapsuleCollision(pos, pin, count, collision.capsules, COLLISION_MARGIN, undefined, undefined, SINGLE_DEEPEST);
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
// ── 62회차 처방 **S3** — 마찰 SDF 부호 기준 교체(`SKELSIGN=1` · 기본 off) ──────
// 62회차 §1 오라클이 확증한 것: 구면행진 공 오라클 확정 표본 831개에서
//   레이패리티 0/831(0.0%) · **골격 31/831(3.7%)** · **라디얼 202/831(24.3%)**
// 라디얼이 소매 대역에서 24.3% 오분류하고, 골격이 라디얼보다 **6.5배 정확**하다.
// 오분류 정점은 마찰 `load = 1.0`(최대)을 받아 접선 이동을 잃는다(sdfCollision.ts:232).
// **기준 교체만 한다 — 값 스윕 없음**(함정 14). `makeSkeletonSignedSampler`는
// Stage 1a 은행 자산이라 신규 코드 0줄이다.
// **필드는 전 정점 공유**이므로 몸판 마찰도 함께 바뀐다 — A 17채널의 이동은
// 예상된 것이고 그 자체는 실패가 아니다(회차 프롬프트 §3 등재).
const SKELSIGN = process.env.SKELSIGN === "1";
const sdfField = bakeSdf(
  SKELSIGN
    ? makeSkeletonSignedSampler(wholeMesh, skeleton.segments, SDF_FAR, SDF_FAR)
    : makeRadialSignedSampler(wholeMesh, (minX + maxX) / 2, (minZ + maxZ) / 2, SDF_FAR, SDF_FAR),
  { x: minX - pad, y: yBot, z: minZ - pad },
  { x: maxX + pad, y: yTop, z: maxZ + pad },
  SDF_VOXEL, SDF_FAR,
);
console.log(`[dress] SDF 굽기 ${sdfField.nx}x${sdfField.ny}x${sdfField.nz} elapsedMs ${Math.round(performance.now() - tBake)}`);
// ── 62회차 §1 **부호 오라클**(진단 전용 · 물리 0줄 · `SLEEVESIGN=1`) ──────────
// S3(마찰 SDF 부호 기준 교체)의 선행 조건. 61회차가 t=0 소매 948정점에서
// 라디얼 sd≤0 252(26.6%) vs 레이 패리티 관통 0/948을 실측했는데, **어느 쪽이
// 옳은지 가릴 판정자가 없었다**. 계기를 계기로 고치는 것을 막는 것이 이 절이다.
//
// **은행 SIGNMAP 공 오라클은 방향이 반대다** — `paramSweep.ts:517-520`의 구성은
// "골격점 a는 내부다 · |p−a| < unsignedDist(a)면 p도 내부"로 **확정 내부만** 증명한다.
// 소매 정점은 전량 몸 밖에 놓이므로 그 오라클로는 아무것도 확정되지 않는다.
// 여기서는 **같은 공 논증을 양방향으로** 세운다(레이 패리티 불필요 · 새 상수 0):
//   확정 내부  |p − a| < unsignedDist(a),  a = 최근접 골격점(축은 내부 · 승인 전제)
//   확정 외부  |p − q| < unsignedDist(q),  q = bbox 밖 씨앗(자명한 외부)
// 둘 다 **충분조건**이다 — 확정 못 한 점은 "불명"으로 남기고 추정하지 않는다.
const SLEEVESIGN = process.env.SLEEVESIGN === "1";
if (SLEEVESIGN) {
  const skelSample = makeSkeletonSignedSampler(wholeMesh, skeleton.segments, SDF_FAR, SDF_FAR);
  const radSample = makeRadialSignedSampler(wholeMesh, (minX + maxX) / 2, (minZ + maxZ) / 2, SDF_FAR, SDF_FAR);
  const s0 = g.panelStarts[2], s1 = total;
  const armSegs = skeleton.arms;
  type Row = { i: number; par: number; ball: number; skel: number; rad: number; baked: number; st: number; inward: boolean; cap: boolean };
  const rows: Row[] = [];
  // **확정 외부 — 구면행진(sphere marching).** 단일 공은 원리적으로 못 닿는다:
  // bbox 밖 씨앗 q에서 |p−q| < d(q)를 요구하면 q가 멀수록 d(q)도 같이 커져
  // 부등식이 결코 성립하지 않는다(첫 실행 실측: 확정 외부 0/948).
  // 대신 **밖의 점 x에서 어느 방향으로든 d(x)보다 짧게 움직이면 여전히 밖**이라는
  // 같은 공 논증을 **사슬로** 잇는다. 표적 p를 향해 반경만큼씩 전진해 p에 닿으면
  // **p는 확정 외부**다. 레이 캐스팅이 아니므로 패리티 가정(수밀성)이 안 들어간다.
  // 씨앗은 p를 지나는 **팔축 바깥 방향** 먼 점 — 경로가 몸을 스칠 확률이 가장 낮다.
  // 닿지 못하면 "불명"으로 남긴다(추정 금지). 이것은 충분조건이지 필요조건이 아니다.
  const MARCH_MAX = 400;
  const marchOutside = (px: number, py: number, pz: number, ax: number, ay: number, az: number): boolean => {
    // 씨앗 = 팔축에서 p 방향으로 3m 밖.
    let ux = px - ax, uy = py - ay, uz = pz - az;
    const ul = Math.hypot(ux, uy, uz) || 1e-9;
    ux /= ul; uy /= ul; uz /= ul;
    let x = ax + ux * 3.0, y = ay + uy * 3.0, z = az + uz * 3.0;
    for (let s = 0; s < MARCH_MAX; s++) {
      const c = wholeMesh.closestPointUnsigned(x, y, z, 1e9);
      if (!c) return false;
      const r = c.distance;
      const dx = px - x, dy = py - y, dz = pz - z;
      const dl = Math.hypot(dx, dy, dz);
      if (dl < r) return true; // p가 "밖임이 보장된 공" 안 — 확정 외부
      const step = r * 0.9; // 보수적으로 반경보다 짧게
      if (step < 1e-6) return false; // 표면에 붙어 더 못 간다 — 불명
      x += (dx / dl) * step; y += (dy / dl) * step; z += (dz / dl) * step;
    }
    return false;
  };
  for (let i = s0; i < s1; i++) {
    const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
    // ① 레이 패리티 — 하네스가 스스로 "비수밀 · 패리티 근사"로 인쇄하는 그 채널.
    const par = insideParity(x, y, z) ? -1 : 1;
    // ② 공 오라클(양방향). +1 확정 외부 / −1 확정 내부 / 0 불명.
    const k = nearestOnSegments(x, y, z, skeleton.segments);
    const a = wholeMesh.closestPointUnsigned(k.x, k.y, k.z, SDF_FAR);
    let ball = 0;
    if (a && Math.sqrt(k.d2) < a.distance) ball = -1;
    else if (marchOutside(x, y, z, nearestOnSegments(x, y, z, armSegs).x, nearestOnSegments(x, y, z, armSegs).y, nearestOnSegments(x, y, z, armSegs).z)) ball = 1;
    // ③④⑤ 세 부호 규칙.
    const skel = skelSample(x, y, z), rad = radSample(x, y, z);
    const baked = sampleSdf(sdfField, x, y, z);
    // 위치 라벨 — 팔축 station · 몸통 쪽인가 · 캡 대역인가(새 상수 0).
    const ka = nearestOnSegments(x, y, z, armSegs);
    const st = Math.hypot(ka.x - skeleton.arms[0].a.x, ka.y - skeleton.arms[0].a.y, ka.z - skeleton.arms[0].a.z);
    const inward = (x - ka.x) * (centerX - ka.x) + (z - ka.z) * (collision.centerZ - ka.z) > 0;
    rows.push({ i, par, ball, skel, rad, baked, st, inward, cap: g.pos2[i * 2 + 1] <= g.draft.dims.capHeightM });
  }
  const n = rows.length;
  const cnt = (f: (r: Row) => boolean): number => rows.filter(f).length;
  console.log(`  [62오라클·소매 부호] t=0 소매 정점 ${n}개(패널 2·3) · 기준 4종 + 공 오라클`);
  console.log(
    `    "몸 안"이라 답한 수 — 레이패리티 ${cnt((r) => r.par < 0)} · **골격 ${cnt((r) => r.skel < 0)}** · **라디얼(해석) ${cnt((r) => r.rad < 0)}** · 라디얼(구운필드) ${cnt((r) => r.baked < 0)}` +
    ` │ 공 오라클: **확정 내부 ${cnt((r) => r.ball < 0)} · 확정 외부 ${cnt((r) => r.ball > 0)} · 불명 ${cnt((r) => r.ball === 0)}**`,
  );
  // 공 오라클이 확정한 표본에서만 오분류를 센다 — 불명은 판정에 안 쓴다.
  const det = rows.filter((r) => r.ball !== 0);
  const bad = (f: (r: Row) => number): string => {
    const b = det.filter((r) => (f(r) < 0 ? -1 : 1) !== r.ball).length; // 안=−1 / 밖=+1 (첫 구현에서 뒤집혀 있었다 — 62회차 자기검사가 잡음)
    return `${b}/${det.length}${det.length ? ` (${((100 * b) / det.length).toFixed(1)}%)` : ""}`;
  };
  console.log(`    **공 오라클 확정 표본 ${det.length}개 대비 오분류** — 레이패리티 ${bad((r) => r.par)} · 골격 ${bad((r) => r.skel)} · 라디얼(해석) ${bad((r) => r.rad)} · 라디얼(구운필드) ${bad((r) => r.baked)}`);
  // 불일치의 위치 분포 — 61회차가 "전량 몸통 쪽"이라 한 것의 재확인.
  const rb = rows.filter((r) => r.rad < 0), sb = rows.filter((r) => r.skel < 0);
  const q = (a: number[], f: number): string => (a.length ? (a[Math.floor(f * (a.length - 1))] * 100).toFixed(1) : "-");
  for (const [nm, set] of [["라디얼 음수", rb], ["골격 음수", sb]] as const) {
    const sts = set.map((r) => r.st).sort((a, b) => a - b);
    console.log(
      `    ${nm} ${set.length}개 위치 — 몸통 쪽 ${set.filter((r) => r.inward).length} / 바깥 쪽 ${set.filter((r) => !r.inward).length}` +
      ` · 캡 대역 ${set.filter((r) => r.cap).length} / 하부 ${set.filter((r) => !r.cap).length}` +
      ` · 팔축 station p10/중앙/p90 ${q(sts, 0.1)}/${q(sts, 0.5)}/${q(sts, 0.9)}cm` +
      ` · 그중 공 오라클 확정외부 ${set.filter((r) => r.ball > 0).length} 불명 ${set.filter((r) => r.ball === 0).length} 확정내부 ${set.filter((r) => r.ball < 0).length}`,
    );
  }
}
const cachedFric = createCachedSdfIterationFriction(() => sdfField, {
  contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_ITER, muKinetic: FRICTION_MU_ITER, localMuGain: LOCAL_MU_GAIN,
});

let anchorStrength = 0;
let collarFired = 0;
let ringTotalFired = 0;
// ── 27회차 계기(기록 전용 · 물리 0줄)
// (1) 축소 잔여 일량 = 축소 전 총 길이 − 상한. 링이 "아직 일하고 있나"의 직접 채널.
const shrinkWorkSeries: number[] = [];
// (2) 하중 배분 — 균일 질량이므로 중량은 정점 수에 비례한다. 프레임마다
//     자유낙하 예상 Δy(중력만 받았을 때)와 실제 Δy의 차 = 그 정점이 **받쳐진 양**이다.
//     대역별로 합하면 "옷을 무엇이 들고 있는가"가 나온다(접촉력 계기가 없어도
//     운동학에서 도출된다 — clothPhysics 무수정).
//     60회차 계기② — **밑단 분류 추가**(6회차 연속 이월분 해소). 55회차 ⓓ가
//     "밑단 마찰은 애초에 지지에 안 쓰인다"를 단정했으나, 58회차 사전 반증이
//     그 근거가 **밑단이 `other`에 묻혀 산출 불가였던 것**임을 밝혔다.
//     술어는 `hemChain.strict`를 그대로 재사용한다 — **새 술어 0 · 손 상수 0**(함정 12).
const holdSeries: { ring: number; shoulder: number; hem: number; other: number }[] = [];
// 29회차 계기 — 링 중심 y와 링 길이의 시계열. 지지 실패(미끄러져 내려감)와
// 인장(제자리에서 벌어짐)을 **가르는** 채널이다. 둘은 같은 "링이 크다"로 보인다.
const ringYSeries: { f: number; st: string; y: number; top: number; bot: number; L: number }[] = [];
let prevPos: Float32Array | null = null;
const ringVertexSet = new Set<number>(ringClosed.flatMap((e) => [e.a, e.b]));

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
// ── 31회차 계기: 패스별 링 길이 프로브(읽기 전용). 무장된 프레임에서만
// 서브스텝 안 각 패스 경계의 링 길이를 적는다. 위치는 건드리지 않는다.
let probeArmed = false;
let probeSub = 0;
let probeFrameLabel = "";
// 39회차 필수 조건 ③ — 기본값 1,8,62,280은 표적 수량의 **65.7%**(f2~f4 +22.25cm)를
// 통과시켰다(38회차). `probeArmed`는 로깅 게이트일 뿐이라 프레임 추가는 물리 불변이다.
const PROBE_FRAMES = new Set<number>((process.env.PROBE ?? "1,2,3,4,8,62,280").split(",").map(Number));
// 38회차 계기 A — 접합 실거리를 찍을 프레임(회차 프롬프트 지정 + 정착은 종료 후 별도).
const JOIN_FRAMES = new Set<number>([0, 1, 2, 4, 8, 62, 110, 117]);
// 39회차 — 계기 D(링 형상) · 계기 B(성분 3분리 · 순차 in-situ) 무장 프레임.
const SHAPE_FRAMES = new Set<number>([0, 1, 2, 3, 4, 8, 62]);
// 40회차 계기 E는 f1·f2·f4·f8을 요구한다 — f3(=_frame 2)도 이미 무장돼 있어 그대로 둔다.
const COMP_FRAMES = new Set<number>([0, 1, 2, 3, 7, 61]); // f1·f2·f3·f4·f8·f62 직전(43회차 f62 추가)
const probeReports: string[] = [];
const probeLog: { sub: number; label: string; L: number; J: number }[] = [];
// 38회차 계기 A — **접합 2엣지 실거리 합**. 링 60엣지와 같은 패스 경계에서 읽어
// 같은 표에 놓는다(37회차 C3: 이 시계열을 찍는 코드가 없었다).
const joinLenM = (): number => {
  let l = 0;
  for (const sm of ringJoinPairs) {
    l += Math.hypot(
      sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
      sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
      sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
    );
  }
  return l;
};
// 접합 2엣지의 **거리 제약 rest**(제약이 실제로 순회하는 집합에서 직접 뜬다 — 함정 12).
// collarRing rest(6.0mm)도 시접 target(6.0mm)도 아니다 — 37회차 A3.
const joinConstraints = ringJoinPairs.map((sm) =>
  [...sim.constraintPairs].find((q) => (q.a === sm.a && q.b === sm.b) || (q.a === sm.b && q.b === sm.a)),
);
// 이름 주의: 위 폐곡선화 블록의 블록 스코프 `joinRestM`(= 시접 target 6.0mm)과 **다른 값**이다.
const joinDistRestSumM = (): number => joinConstraints.reduce((s, c) => s + (c?.restLength ?? 0), 0);
const probe = (label: string): void => {
  if (!probeArmed) return;
  if (label.startsWith("0.")) probeSub++;
  probeLog.push({ sub: probeSub, label, L: ringLenM(), J: joinLenM() });
};
// sim.step 내부 분해 — 충돌(흡착)과 반복 안 마찰만 하네스에서 감쌀 수 있다.
// 앵커(`sim.applyAnchors`)와 거리 제약은 garmentFrame이 만든 iterExtra 안이라
// 분리 불가 → 잔여로 남긴다(정직하게 그렇게 표기한다).
const unifiedProbed: typeof unified = (pos, pinned, n) => {
  probe("0b.충돌 직전");
  unified(pos, pinned, n);
  probe("1a.충돌(흡착)");
};
// ══ 35회차 계기 (읽기 전용 · 물리 0줄) — 흡착이 정점을 어디로 옮기는가 ══
//
// 계기는 **제약이 실제로 순회하는 집합에서 직접 뜬다**(함정 12): 흡착 목표를
// 다시 계산하지 않고 `unified` 리졸버 **자신**을 스크래치 사본에 한 번 돌려
// 그 차이를 읽는다. `sim.positions`는 건드리지 않는다.
//
// **1회 호출 = 목표까지 PUSH_RELAXATION(0.4)만큼만**이다(bvhFromArrays 29행).
// 그래서 "함의 목표"는 pos + Δ/0.4로 역산해 병기한다 — 캡슐 충돌은 완화가
// 없으므로 그 역산은 **메시 흡착이 지배적인 정점에서만** 유효하다(그렇게 표기).
const adsorbScratch = new Float32Array(sim.positions.length);
// 핀 면제분도 "핀이 없었다면 흡착이 어디로 보내는가"를 봐야 하므로 0으로 돈다.
const adsorbNoPin = new Uint8Array(total);
const adsorbRun = (): void => {
  adsorbScratch.set(sim.positions);
  unified(adsorbScratch, adsorbNoPin, total);
};
// ── 39회차 계기 B **재구현** — 흡착 Δ의 성분 3분리를 **순차 in-situ**로 잰다.
//
// 38회차 구현은 성분마다 사본을 `sim.positions`로 되돌렸다. 그런데 `unified`는
// mesh를 **먼저** 돌려 정점을 캡슐 반경 안으로 넣은 **뒤** 캡슐을 부른다. 그래서
// 앞판 캡슐 성분이 구조적으로 0으로 나왔다 — 실측이 아니라 설계 인공물이었다
// (38회차 §5 결함 ①). 여기서는 **한 사본**에 실제 순서대로 3구간 스냅샷을 뜬다.
//
// **단위(필수 조건 ②)**: 이 계기는 충돌 **1회 호출분**이다. 실제 서브스텝은
// 반복 18 · `collisionEvery` 6이라 충돌이 **4회** 돈다(iter 0·6·12·17,
// clothPhysics.ts:479). 패스표의 `1a.흡착`은 그 4회 in-situ 합이므로
// **이 표의 값과 같은 축에 놓지 않는다.**
const compScratch = new Float32Array(sim.positions.length);
const snapA = new Float32Array(sim.positions.length);
const snapB = new Float32Array(sim.positions.length);
// 캡슐 축(fixture capsule[0])에서의 반경 — 계기 D·B가 공유한다.
const CAP0 = collision.capsules[0];
const capRadiusOf = (x: number, z: number): number => Math.hypot(x - CAP0.top.x, z - CAP0.top.z);
const CAP0_PUSH_R = CAP0.radius + COLLISION_MARGIN; // 캡슐이 밀어내는 반경(현행 기하)
// 39회차 실측 시점의 값(0.159155 + 0.015). 계기 D의 `r≥` 열을 여기 동결해 회차 간
// 대조를 지킨다 — 캡슐 기하가 바뀌어도 같은 이름의 열이 같은 대상을 재게 한다.
const R39_BASELINE = 0.15915494309189535 + 0.015;
// 순차 in-situ 3구간: [before] → mesh → [snapA] → 몸통 캡슐 → [snapB] → 팔 캡슐 → [after]
const compSequential = (): { mesh: Float32Array; torso: Float32Array; arm: Float32Array } => {
  compScratch.set(sim.positions);
  meshResolver(compScratch, adsorbNoPin, total);
  snapA.set(compScratch);
  let offset = 0;
  for (let p = 0; p < g.panelCounts.length; p++) {
    const count = g.panelCounts[p];
    // **ablation 게이트**(39회차 정정): TORSOCAP=0이면 `unified`가 이 리졸버를 부르지
    // 않으므로 계기도 부르면 안 된다. 안 그러면 "실행되지 않은 리졸버의 가정 프로브"를
    // 실측처럼 인쇄한다 — 39회차 ablation 로그의 몸통 캡슐 행이 그랬다.
    if (TORSOCAP && (p === PANEL_PAT_FRONT || p === PANEL_PAT_BACK)) {
      // 계기도 물리와 **같은 인자**로 부른다 — 안 그러면 계기가 다른 대상을 잰다(함정 19).
      applyCapsuleCollision(compScratch.subarray(offset * 3, (offset + count) * 3), adsorbNoPin.subarray(offset, offset + count), count, collision.capsules, COLLISION_MARGIN, undefined, undefined, SINGLE_DEEPEST);
    }
    offset += count;
  }
  snapB.set(compScratch);
  offset = 0;
  for (let p = 0; p < g.panelCounts.length; p++) {
    const count = g.panelCounts[p];
    applyCapsuleCollision(compScratch.subarray(offset * 3, (offset + count) * 3), adsorbNoPin.subarray(offset, offset + count), count, armCapsules, 0.006);
    offset += count;
  }
  return { mesh: snapA, torso: snapB, arm: compScratch };
};
const compReport = (label: string): string => {
  const front = ringOrder.filter((i) => i < g.panelStarts[1]);
  const back = ringOrder.filter((i) => i >= g.panelStarts[1]);
  const { mesh, torso, arm } = compSequential();
  const lines = [`  [39계기B·흡착 성분 3분리 · **순차 in-situ**] ${label} · 앞판 링 ${front.length} / 뒤판 링 ${back.length} · **충돌 1회 호출분**(실제 서브스텝은 4회 — 패스표와 단위 다름)`];
  const seg = (from: Float32Array | null, to: Float32Array, idx: number[]): string => {
    const base = (i: number, k: number): number => (from ? from[i * 3 + k] : sim.positions[i * 3 + k]);
    const mags = idx.map((i) => Math.hypot(to[i * 3] - base(i, 0), to[i * 3 + 1] - base(i, 1), to[i * 3 + 2] - base(i, 2)) * 1000);
    const fired = mags.filter((m) => m > 1e-6).length;
    const sorted = [...mags].sort((a, b) => a - b);
    let zPos = 0, zNeg = 0;
    for (const i of idx) { const dz = (to[i * 3 + 2] - base(i, 2)) * 1000; if (dz > 0) zPos += dz; else zNeg += dz; }
    return `발화 ${fired}/${idx.length} · |Δ| 중앙 ${sorted[Math.floor(sorted.length * 0.5)].toFixed(2)} 최대 ${sorted[sorted.length - 1].toFixed(2)}mm · Δz 총 +${zPos.toFixed(1)}/${zNeg.toFixed(1)}mm`;
  };
  const rows: [string, Float32Array | null, Float32Array][] = [
    ["meshResolver", null, mesh], ["몸통 캡슐(15mm)", mesh, torso], ["팔 캡슐(6mm)", torso, arm],
  ];
  for (const [nm, from, to] of rows) {
    lines.push(`    ${nm.padEnd(16)} 앞판 ${seg(from, to, front)}`);
    lines.push(`    ${"".padEnd(16)} 뒤판 ${seg(from, to, back)}`);
  }
  // ── R_mesh — mesh 표적의 캡슐축 기준 반경 중앙값. 고정점 식의 입력이다.
  //    T_i = p_i + Δ_mesh/0.4 (PUSH_RELAXATION 역산)
  const rmesh = (idx: number[]): number[] =>
    idx.map((i) => capRadiusOf(
      sim.positions[i * 3] + (mesh[i * 3] - sim.positions[i * 3]) / 0.4,
      sim.positions[i * 3 + 2] + (mesh[i * 3 + 2] - sim.positions[i * 3 + 2]) / 0.4,
    )).sort((a, b) => a - b);
  const all = rmesh(ringOrder), fr = rmesh(front), bk = rmesh(back);
  const med = (a: number[]): number => a[Math.floor(a.length / 2)];
  const Rm = med(all);
  // 고정점: mesh가 R_mesh로 0.4씩 당기고 캡슐이 17.4155로 0.35씩 밀 때의 평형
  const rStar = (0.4 * Rm + 0.35 * CAP0_PUSH_R) / 0.75;
  lines.push(`    [R_mesh] mesh 표적 반경 중앙 전체 ${cm(Rm)}cm(앞판 ${cm(med(fr))} / 뒤판 ${cm(med(bk))}) · 범위 ${cm(all[0])}~${cm(all[all.length - 1])}cm`);
  // 43회차 — **stale 표기.** 이 식은 "캡슐 **1개**가 완화 **0.35**로 민다"를 분자·계수에
  // 박아 둔 고정점 계기다. 42회차 사전 반증 실측: 다캡슐에서 한 정점이 4~7개를 동시
  // 발화시키면 **실효 완화가 0.76~0.83**이 되고, `singleDeepest`가 켜지면 반대로 캡슐이
  // 1개로 강제된다. 두 경우 모두 이 식의 전제가 성립하지 않는다 → 참고값으로만 읽을 것.
  lines.push(`    [고정점·**계기 stale**] r* = (0.4·R_mesh + 0.35×${cm(CAP0_PUSH_R)}) / 0.75 = ${cm(rStar)}cm → 원 둘레 ${cm(2 * Math.PI * rStar)}cm` +
    ` · **전제: 캡슐 1개 · 실효 완화 0.35** (현행 캡슐 ${collision.capsules.length}개 · singleDeepest ${SINGLE_DEEPEST ? "on" : "off"})${TORSOCAP ? "" : " · **[무효 — TORSOCAP off라 캡슐 항이 실행되지 않는다. 이 값은 식이 그대로 산출한 수이지 예측이 아니다]**"}`);
  // ── 계기 E — 후보 1 판별. mesh 표적점을 **ringOrder 순서로** 이은 다각형 길이.
  {
    // 40회차 정의역 정정(39회차 §8-2) — 링60과 **같은 집합**으로 다시 낸다.
    // 39회차 E는 폐곡선 62엣지 합이라 링60(60엣지)과 나란히 놓을 수 없었다.
    // 접합 2엣지는 `ringJoinPairs`이므로 순회에서 그 두 엣지만 건너뛴다.
    const joinKeys = new Set(ringJoinPairs.map((sm) => (sm.a < sm.b ? `${sm.a}_${sm.b}` : `${sm.b}_${sm.a}`)));
    const T = (v: number, c: number): number => sim.positions[v * 3 + c] + (mesh[v * 3 + c] - sim.positions[v * 3 + c]) / 0.4;
    let L62 = 0, L60 = 0, skipped = 0;
    for (let k = 0; k < ringOrder.length; k++) {
      const i = ringOrder[k], j = ringOrder[(k + 1) % ringOrder.length];
      const d = Math.hypot(T(j, 0) - T(i, 0), T(j, 1) - T(i, 1), T(j, 2) - T(i, 2));
      L62 += d;
      if (joinKeys.has(i < j ? `${i}_${j}` : `${j}_${i}`)) { skipped++; continue; }
      L60 += d;
    }
    // 시점 명기(39회차 §8-2 · 함정13 "시점"): 이 블록은 `beforeStep`에서 도므로
    // **step 직전 = 직전 프레임 종료 상태**다. 블록 이름(f_n)의 종료값이 아니다.
    lines.push(`    [40계기E·mesh 표적 다각형 · **step 직전(=직전 프레임 종료 상태)**]` +
      ` **링60 사슬 ${cm(L60)}cm**(건너뛴 접합 ${skipped}엣지) vs 같은 시점 실측 링60 ${cm(ringLenM())}cm` +
      ` │ 참고 폐곡선 62엣지 ${cm(L62)}cm vs 폐곡선 실측 ${cm(ringLenM() + joinLenM())}cm`);
  }
  return lines.join("\n");
};
// ── 39회차 계기 D — 링 형상 채널(38회차 §6 "확인 불가" 해소).
// 반경으로 부푼 원인가, 제자리에서 물결친 곡선인가. 캡슐축 기준 반경의 분포를 본다.
// ── 43회차 계기 정정 2 — **per-vertex 캡슐 카운트**(42회차 "산출 불가" 항목).
// 계기 B의 `발화 n/35`는 *발화한 정점 수*이지 **정점당 캡슐 수**가 아니다. 여기서는
// 한 정점이 동시에 몇 개의 캡슐 안에 들어가 있는지를 직접 센다 — `singleDeepest`가
// 실제로 1개만 미는지 확인하는 채널이다(발화 판정식은 리졸버와 같은 것을 쓴다:
// 캡슐 축 선분까지 거리 < radius + margin).
const capsuleHitCount = (i: number): number => {
  let n = 0;
  for (const c of collision.capsules) {
    const ax = c.top.x, ay = c.top.y, az = c.top.z;
    const bx = c.bottom.x - ax, by = c.bottom.y - ay, bz = c.bottom.z - az;
    const L = bx * bx + by * by + bz * bz;
    const px = sim.positions[i * 3] - ax, py = sim.positions[i * 3 + 1] - ay, pz = sim.positions[i * 3 + 2] - az;
    const t = L > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / L)) : 0;
    const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
    const r = c.radius + COLLISION_MARGIN;
    if (dx * dx + dy * dy + dz * dz < r * r) n++;
  }
  return n;
};
const capsuleCountReport = (label: string): string => {
  const rows = ringOrder.map(capsuleHitCount).sort((a, b) => a - b);
  const hist = new Map<number, number>();
  for (const v of rows) hist.set(v, (hist.get(v) ?? 0) + 1);
  const zero = rows.filter((v) => v === 0).length;
  // 44회차 정정 — **TORSOCAP 게이트**. 캡슐이 꺼져 있으면 이 채널은 "실행되지 않은
  // 리졸버의 가정 프로브"다(39회차 계기 B와 같은 결함의 재발 · 함정 13).
  const gate = TORSOCAP ? "" : " · **[가정 프로브 — TORSOCAP=0이라 이 캡슐들은 실행되지 않는다]**";
  return `  [43계기·정점당 캡슐 수] ${label}${gate} · 링 ${rows.length}정점 · 캡슐 총 ${collision.capsules.length}개 · singleDeepest ${SINGLE_DEEPEST ? "on" : "off"}` +
    ` · 중앙 ${rows[Math.floor(rows.length / 2)]} 최대 ${rows[rows.length - 1]} · 0개(캡슐 밖) ${zero}` +
    ` · 히스토그램 ${[...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}개:${v}`).join(" ")}` +
    ` · **밀어내기 적용 수 = ${!TORSOCAP ? "0(캡슐 off)" : SINGLE_DEEPEST ? "정점당 1(가장 깊은 것)" : "위 개수 그대로(in-situ 누적)"}**`;
};
// ══ 48회차 계기 — 밑단 사슬 형상(프릴/말림) ══════════════════════════════════
// 규칙 노트 `밑단형상계기-체크리스트` 이행. **정의역은 이미 코드에 있는 술어를 재사용**한다
// (dressPattern `[diag·y]`의 hemIdx와 같은 식) — 두 번째 정의를 만들지 않는다(함정 12).
//
// **"요동"의 식 재도출(체크리스트 C)**: 축 기준 반경을 쓰지 않는다 — 밑단 높이의 몸 단면은
// 원이 아니고 가랑이 아래에선 닫힌 곡선조차 아니다(35회차 반경 분해 실패의 재현 조건).
// 기준선은 **사슬 자신의 고정 호장 창 저역통과**이고, 진폭은 평활 곡선의 **수평면 단위
// 법선** 성분이다(프릴). 수직 성분은 따로 낸다(말림) — 다른 현상이다.
const HEM_STRICT = 1e-9;
const hemChain = (() => {
  const lenM = g.draft.dims.lengthM;
  const loose: number[] = [], strict: number[] = [];
  for (let i = 0; i < g.panelStarts[2]; i++) {
    const y = g.pos2[i * 2 + 1];
    if (y > lenM - 0.01) loose.push(i);
    if (Math.abs(y - lenM) < HEM_STRICT + 1e-6) strict.push(i);
  }
  // 사슬은 패널별로 나누고 **패턴 x 정렬 = 호장 순서**(밑단은 제도상 직선이다).
  const chainOf = (lo: number, hi: number): number[] =>
    strict.filter((i) => i >= lo && i < hi).sort((a, b) => g.pos2[a * 2] - g.pos2[b * 2]);
  const front = chainOf(0, g.panelStarts[1]), back = chainOf(g.panelStarts[1], g.panelStarts[2]);
  // 검증: 연속 쌍이 실제 메시 엣지인가(체크리스트 B). 아니면 그 사슬은 물리 경계가 아니다.
  const edgeKey = new Set<number>(g.edgePairs.map((e) => Math.min(e.a, e.b) * 1e6 + Math.max(e.a, e.b)));
  const bad = (c: number[]): number => {
    let n = 0;
    for (let k = 1; k < c.length; k++) if (!edgeKey.has(Math.min(c[k - 1], c[k]) * 1e6 + Math.max(c[k - 1], c[k]))) n++;
    return n;
  };
  return { loose, strict, front, back, badFront: bad(front), badBack: bad(back) };
})();
// 60회차 계기② — 하중 분류가 쓰는 집합. `hemChain.strict`를 **그대로** 뜬다
// (별도 배열·별도 술어를 만들지 않는다 — 함정 12).
const hemVertexSet = new Set<number>(hemChain.strict);
// 사슬 하나의 요동 채널. `pos`는 좌표 소스(자기검사에서 합성 사슬을 넣는다).
const hemWobble = (chain: number[], W: number, pos: Float32Array): {
  L: number; amp: number[]; vert: number[]; lam: number; perLam: number; edge: number;
} => {
  const n = chain.length;
  const P = (k: number, c: number): number => pos[chain[k] * 3 + c];
  // 호장
  const sArr = new Float64Array(n);
  for (let k = 1; k < n; k++) sArr[k] = sArr[k - 1] + Math.hypot(P(k, 0) - P(k - 1, 0), P(k, 1) - P(k - 1, 1), P(k, 2) - P(k - 1, 2));
  const L = sArr[n - 1];
  // 고정 호장 창 저역통과(정점 개수 창 금지 — 간격이 변한다)
  const sm = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    let wx = 0, wy = 0, wz = 0, cnt = 0;
    for (let j = 0; j < n; j++) if (Math.abs(sArr[j] - sArr[k]) <= W / 2) { wx += P(j, 0); wy += P(j, 1); wz += P(j, 2); cnt++; }
    sm[k * 3] = wx / cnt; sm[k * 3 + 1] = wy / cnt; sm[k * 3 + 2] = wz / cnt;
  }
  const amp: number[] = [], vert: number[] = [];
  // **경계 제외**: 이동평균 창이 한쪽만 차는 양 끝 W/2 구간은 기준선이 편향된다
  // (48회차 자기검사가 이 편향을 진폭 1.55배로 잡아냈다). 통계에서 뺀다.
  const interior = (k: number): boolean => sArr[k] >= W / 2 && sArr[k] <= L - W / 2;
  for (let k = 0; k < n; k++) {
    if (!interior(k)) continue;
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    // 평활 곡선의 접선 → 수평면 단위 법선(프릴 방향). 수직은 y 성분으로 따로.
    const tx = sm[b * 3] - sm[a * 3], tz = sm[b * 3 + 2] - sm[a * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    amp.push(((P(k, 0) - sm[k * 3]) * nx + (P(k, 2) - sm[k * 3 + 2]) * nz) * 1000);
    vert.push((P(k, 1) - sm[k * 3 + 1]) * 1000);
  }
  let flips = 0;
  for (let k = 1; k < amp.length; k++) if (amp[k - 1] * amp[k] < 0) flips++;
  // 파장은 **부호변화를 센 그 구간의 호장**으로 낸다. 전체 L을 쓰면 내부만 센 flips와
  // 정의역이 어긋나 파장이 부풀려진다(48회차 자기검사가 12.21 vs 8.00으로 잡았다).
  let lo = -1, hi = -1;
  for (let k = 0; k < n; k++) if (sArr[k] >= W / 2 && sArr[k] <= L - W / 2) { if (lo < 0) lo = k; hi = k; }
  const Lint = lo >= 0 && hi > lo ? sArr[hi] - sArr[lo] : L;
  const lam = flips > 0 ? (2 * Lint) / flips : Infinity;
  const edge = amp.length > 1 ? Lint / (amp.length - 1) : 0;
  return { L, amp, vert, lam, perLam: edge > 0 ? lam / edge : 0, edge };
};
// 밑단 형상 보고 + **합성 주입 자기검사**(체크리스트 E) — 프릴을 재는 식이 프릴을 재는지의
// 유일한 직접 증거다. 실패하면 그 회차 수치를 쓰지 않는다.
// ── 57회차 계기 A — **부양 상태 자기검사**. 48회차는 A 상태(몸거리 14mm)에서만
// 통과시켰다. D0는 옷이 39mm 떠 있고(국면1 94.3%) 그 조건에서 계기가 여전히 유효한지
// 확인된 적이 없다. 두 가지를 잰다:
//   ① 주입 재검증 — 부양된 사슬에 λ=8cm·A=10mm를 주입하고 복원되는지
//   ② **부양 대조군** — 주입 없이 부양만(= 가짜 진폭이 생기는가)
// 부양은 실측 D0 프로파일을 쓴다(중앙 39.0mm · p99 104.7mm = **불균일**).
const hemLiftTest = (): string => {
  const c = hemChain.front;
  if (c.length < 8) return "  [57계기A·부양 자기검사] 사슬 길이 부족 — 산출 불가";
  const lines: string[] = [];
  const step = 0.016;
  // 부양 프로파일: 사슬 위치 s에 따라 중앙 39mm ~ p99 105mm로 변하는 **불균일** 부양.
  // (균일 평행이동은 이동평균 기준선이 원리적으로 상쇄한다 — 불균일이 관건이다)
  const liftAt = (k: number, n: number): number => {
    const t = k / Math.max(1, n - 1);
    return 0.039 + 0.066 * Math.pow(Math.sin(Math.PI * t), 4); // 39mm → 105mm 봉우리
  };
  for (const [nm, amp] of [["① 주입+부양", 0.01], ["② 부양만(대조군)", 0.0]] as const) {
    const fake = new Float32Array(sim.positions.length);
    for (let k = 0; k < c.length; k++) {
      fake[c[k] * 3] = k * step;
      fake[c[k] * 3 + 1] = 0.75;
      fake[c[k] * 3 + 2] = liftAt(k, c.length) + amp * Math.sin((2 * Math.PI * (k * step)) / 0.08);
    }
    const r = hemWobble(c, 0.16, fake);
    const A = r.amp.length ? Math.max(...r.amp.map(Math.abs)) : NaN;
    const med = r.amp.length ? [...r.amp.map(Math.abs)].sort((a, b) => a - b)[Math.floor(r.amp.length / 2)] : NaN;
    lines.push(`    ${nm} · 주입 A=${(amp * 1000).toFixed(1)}mm λ=8.00cm · 부양 39→105mm(불균일)` +
      ` → 측정 최대 ${A.toFixed(1)}mm 중앙 ${med.toFixed(1)}mm · λ ${Number.isFinite(r.lam) ? cm(r.lam) + "cm" : "∞"}` +
      (amp === 0 ? ` — **이 값이 곧 부양이 만드는 가짜 진폭**` : ""));
  }
  return [`  [57계기A·부양 자기검사] 48회차 자기검사는 A 상태(몸거리 14mm)에서만 통과했다`, ...lines].join("\n");
};
const hemSelfTest = (): string => {
  const c = hemChain.front;
  if (c.length < 8) return "  [48계기·자기검사] 사슬 길이 부족 — **산출 불가**";
  // 합성: 실제 사슬 위치를 x축 직선으로 놓고 z에 λ=8cm·A=1cm 사인파를 주입한다.
  const fake = new Float32Array(sim.positions.length);
  const step = 0.016; // 밑단 국소 엣지(설계 16mm)
  for (let k = 0; k < c.length; k++) {
    fake[c[k] * 3] = k * step;
    fake[c[k] * 3 + 1] = 0.75;
    fake[c[k] * 3 + 2] = 0.01 * Math.sin((2 * Math.PI * (k * step)) / 0.08);
  }
  const r = hemWobble(c, 0.16, fake);
  const A = Math.max(...r.amp.map(Math.abs));
  const okL = Number.isFinite(r.lam) && Math.abs(r.lam - 0.08) < 0.01;
  const okA = Math.abs(A - 10) < 1.0;
  return `  [48계기·자기검사] 주입 λ=8.00cm A=10.0mm → 측정 λ=${Number.isFinite(r.lam) ? cm(r.lam) : "∞"}cm A=${A.toFixed(1)}mm · λ ${okL ? "OK" : "**실패**"} · A ${okA ? "OK" : "**실패**"} → ${okL && okA ? "계기 유효" : "**계기 무효 — 이번 회차 밑단 수치를 쓰지 않는다**"}`;
};
// ── 57회차 계기 B — **화면 측 정량 채널**(영구). 48계기와 **다른 기준선**을 쓴다.
// 육안은 밑단을 **폐곡선 하나**로 보고 "원에서 얼마나 벗어났나"를 판단한다.
// 48계기는 **열린 사슬 2개**를 따로 잡고 **사슬 자신의 이동평균**을 기준선으로 쓴다
// (= 고역통과. 큰 반경 변화는 기준선이 따라가 버려 잔차에 안 남고, 부양이 불균일하면
// 그 잔차가 진폭으로 기록된다 — 57계기A가 실측).
// 여기서는 **폐곡선 + 평균 반경 기준**으로 잰다: 캡슐축에서의 반경을 방위각 순으로 놓고
// 평균 반경 대비 편차를 본다. 두 채널이 같은 대상을 다르게 재는지 가리는 재료다.
const hemRenderReport = (label: string): string => {
  const all = [...hemChain.front, ...hemChain.back];
  if (all.length < 8) return `  [57계기B·밑단 폐곡선 반경] ${label} — 산출 불가`;
  const ax = collision.capsules[0].top.x, az = collision.capsules[0].top.z;
  const pts = all.map((i) => {
    const x = sim.positions[i * 3] - ax, z = sim.positions[i * 3 + 2] - az;
    return { i, r: Math.hypot(x, z), th: Math.atan2(z, x), y: sim.positions[i * 3 + 1] };
  }).sort((a, b) => a.th - b.th);
  const rs = pts.map((p) => p.r);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const dev = rs.map((r) => (r - mean) * 1000);
  const absd = dev.map(Math.abs).sort((a, b) => a - b);
  let flips = 0;
  for (let k = 1; k < dev.length; k++) if (dev[k - 1] * dev[k] < 0) flips++;
  // 폐곡선이므로 마지막↔첫 쌍도 센다.
  if (dev[dev.length - 1] * dev[0] < 0) flips++;
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const sorted = [...rs].sort((a, b) => a - b);
  // ── 58회차 §3 — **정의역 확인**(57회차 등재만 3번째). 이 채널을 판정자로 쓰기 전에
  // 옆선 4곳이 실제로 표본에 있는지 확인한다. 48계기는 정의역이 옆선을 구조적으로
  // 제외한 채 9회차 인용됐다(함정 19). 옆선 = **사슬 끝점**이다(chainOf가 패턴 x 정렬 → 끝 = 옆선 시접).
  const deg = (t: number): number => ((t * 180) / Math.PI + 360) % 360;
  const seamIdx = [hemChain.front[0], hemChain.front[hemChain.front.length - 1], hemChain.back[0], hemChain.back[hemChain.back.length - 1]];
  const seamAt = seamIdx.map((si) => {
    const k = pts.findIndex((p) => p.i === si);
    return k < 0 ? "없음" : `#${k}/${pts.length}@${deg(pts[k].th).toFixed(0)}°`;
  });
  // 각도 공백: 표본이 어느 방향에서 비는가(옆선 근방이 비면 그것이 제외의 증거다).
  let gapMax = 0, gapAt = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k].th, b = k + 1 < pts.length ? pts[k + 1].th : pts[0].th + 2 * Math.PI;
    if (b - a > gapMax) { gapMax = b - a; gapAt = (a + b) / 2; }
  }
  const bins = new Array(12).fill(0);
  for (const p of pts) bins[Math.min(11, Math.floor(deg(p.th) / 30))]++;
  return `  [57계기B·밑단 폐곡선 반경] ${label} · n=${pts.length}(앞 ${hemChain.front.length}+뒤 ${hemChain.back.length}) · 축(x ${cm(ax)}, z ${cm(az)})` +
    ` · **정의역** 옆선4 ${seamAt.join(" ")} · 최대 각도공백 ${((gapMax * 180) / Math.PI).toFixed(1)}°@${deg(gapAt).toFixed(0)}° · 30°빈 ${bins.join("/")}` +
    ` · **반경 평균 ${cm(mean)}cm** 중앙 ${cm(sorted[Math.floor(sorted.length / 2)])} 최소 ${cm(sorted[0])} 최대 ${cm(sorted[sorted.length - 1])}` +
    ` · **평균 대비 편차** 중앙 ${absd[Math.floor(absd.length / 2)].toFixed(2)} p99 ${absd[Math.floor(absd.length * 0.99)].toFixed(2)} 최대 ${absd[absd.length - 1].toFixed(2)}mm` +
    ` · 부호변화 ${flips}회(파장 환산 ${flips > 0 ? (360 / flips).toFixed(1) : "∞"}°) · y ${cm(ys[0])}~${cm(ys[ys.length - 1])}cm`;
};
const hemReport = (label: string): string => {
  const lines = [`  [48계기·밑단 형상] ${label} · 정의역 loose(1cm) ${hemChain.loose.length} / **strict ${hemChain.strict.length}** · 앞판 사슬 ${hemChain.front.length} 뒤판 ${hemChain.back.length} · 사슬 연속쌍 비-엣지 앞 ${hemChain.badFront} 뒤 ${hemChain.badBack}`];
  for (const [nm, c] of [["앞판", hemChain.front], ["뒤판", hemChain.back]] as const) {
    if (c.length < 8) { lines.push(`    ${nm} — 사슬 8정점 미만, 산출 불가`); continue; }
    for (const W of [0.08, 0.16]) {
      const r = hemWobble(c, W, sim.positions);
      const abs = r.amp.map(Math.abs).sort((a, b) => a - b);
      const maxAt = r.amp.reduce((m, v, i) => (Math.abs(v) > Math.abs(r.amp[m]) ? i : m), 0);
      const pos = r.amp.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const neg = r.amp.filter((v) => v < 0).reduce((a, b) => a + b, 0);
      const vAbs = r.vert.map(Math.abs).sort((a, b) => a - b);
      // 파장당 표본 < 4면 Nyquist 근방 — 숫자를 쓰지 않는다(체크리스트 C).
      const nyq = r.perLam < 4;
      lines.push(
        `    ${nm} W=${cm(W)}cm · 사슬 ${cm(r.L)}cm(엣지 ${(r.edge * 1000).toFixed(1)}mm) · **프릴(수평법선)** 중앙 ${abs[Math.floor(abs.length / 2)].toFixed(2)} p99 ${abs[Math.floor(abs.length * 0.99)].toFixed(2)} 최대 ${abs[abs.length - 1].toFixed(2)}mm@#${c[maxAt]} · 양총 +${pos.toFixed(0)}/음총 ${neg.toFixed(0)}mm` +
        ` · **말림(수직)** 중앙 ${vAbs[Math.floor(vAbs.length / 2)].toFixed(2)} 최대 ${vAbs[vAbs.length - 1].toFixed(2)}mm` +
        ` · 파장 ${nyq ? "**산출 불가(파장당 표본 " + r.perLam.toFixed(1) + " < 4 · Nyquist)**" : cm(r.lam) + "cm(엣지 " + r.perLam.toFixed(1) + "배)"}`,
      );
    }
    // 접힘 계수 = 사슬 길이 / (x,z) 투영 볼록껍질 둘레 — 거리 지표가 못 재는 것을 잡는다.
    const pts = c.map((i) => [sim.positions[i * 3], sim.positions[i * 3 + 2]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const hull: [number, number][] = [];
    for (const pt of pts) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], pt) <= 0) hull.pop(); hull.push(pt); }
    const lower = hull.length;
    for (let i = pts.length - 2; i >= 0; i--) { const pt = pts[i]; while (hull.length > lower && cross(hull[hull.length - 2], hull[hull.length - 1], pt) <= 0) hull.pop(); hull.push(pt); }
    let hp = 0;
    for (let i = 1; i < hull.length; i++) hp += Math.hypot(hull[i][0] - hull[i - 1][0], hull[i][1] - hull[i - 1][1]);
    const r0 = hemWobble(c, 0.16, sim.positions);
    // 몸까지 부호없는 거리 — 흡착 목표(margin 15mm)에 붙었는지 떠 있는지.
    const ds = c.map((i) => (wholeMesh.closestPointUnsigned(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR)?.distance ?? NaN) * 1000)
      .filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    {
      const m = c[0] < g.panelStarts[1] ? frontMesh : backMesh;
      const dv = c.map((i) => m.signedClearance(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR))
        .filter((q): q is number => q !== null);
      if (dv.length > 0) {
        const p1 = dv.filter((x) => x > COLLISION_MARGIN).length, p2 = dv.filter((x) => x > 0 && x <= COLLISION_MARGIN).length, p3 = dv.filter((x) => x <= 0).length;
        const so = [...dv].sort((a, b) => a - b);
        const q = (f: number): string => (so[Math.min(so.length - 1, Math.floor(f * so.length))] * 1000).toFixed(1);
        lines.push(`    ${nm} **국면**(경계 margin 15.0mm) 1(자석) ${p1}(${(100 * p1 / dv.length).toFixed(1)}%) · 2(안착) ${p2}(${(100 * p2 / dv.length).toFixed(1)}%) · 3(관통) ${p3}(${(100 * p3 / dv.length).toFixed(1)}%) · d(mm) p25 ${q(0.25)} 중앙 ${q(0.5)} p75 ${q(0.75)} p99 ${q(0.99)}`);
      }
    }
    lines.push(`    ${nm} 접힘계수 = 사슬 ${cm(r0.L)} / 투영 볼록껍질 ${cm(hp)} = **${(r0.L / Math.max(1e-9, hp)).toFixed(3)}** · 몸거리 중앙 ${ds.length ? ds[Math.floor(ds.length / 2)].toFixed(1) : "-"} p99 ${ds.length ? ds[Math.floor(ds.length * 0.99)].toFixed(1) : "-"} 최소 ${ds.length ? ds[0].toFixed(1) : "-"}mm (흡착 margin 15.0mm)`);
  }
  return lines.join("\n");
};
// ══ 50회차 β 채널 (47회차 후보 β 판별자 · 49회차 미이행 이월) ═══════════════
// β = 흡착 **목표장의 불연속** — ① 앞/뒤 반쪽 시트 절단면(옆선) ② 가랑이 두 다리(밑단).
// 세 채널: 옆선 ±k홉 요동 · 봉우리와 splitZ 절단 경계의 거리 · 흡착 목표 도약.
const SPLIT_Z = collision.centerZ; // splitFrontBack의 절단면(무게중심 z 중간면)
// 옆선 시접에서 k홉인 정점 띠 — 46계기와 같은 BFS 기계(hopFromHem.side)를 **재사용**한다.
const sideBandIdx = (k: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < g.panelStarts[2]; i++) if (hopFromHem.side[i] === k) out.push(i);
  return out;
};
const betaReport = (label: string): string => {
  const lines = [`  [50계기·β] ${label} · splitZ ${cm(SPLIT_Z)}cm`];
  // ── β-1 옆선 ±k홉 띠의 법선 방향 요동.
  // "요동"의 식은 48계기와 **같은 것**을 쓴다(새 식을 만들지 않는다 — 자기검사가 그 식을
  // 검증했다). 띠를 패턴 y 순으로 정렬해 사슬로 보고 같은 저역통과를 건다.
  for (const k of [0, 1, 2]) {
    const band = sideBandIdx(k);
    // **좌우를 갈라야 사슬이 된다**(1차 구현은 ±x를 섞어 62정점에 사슬 18m가 나왔다 —
    // 계기 결함). 옆선은 패널당 좌·우 두 개이고 각각 패턴 y 오름차순이 호장 순서다.
    // 63회차 §3 — **뒤판 행 추가**(62 §8: 앞판만 출력해 대조가 반쪽이었다).
    // 패널 경계는 기존 `panelStarts`를 그대로 쓴다(새 술어 0). 뒤판은 미러 뒤집기
    // 대상이 아니므로(소매만 flip) `pos2.x` 부호가 앞판과 같은 의미다.
    for (const [pn, lo, hi] of [["앞판", 0, g.panelStarts[1]], ["뒤판", g.panelStarts[1], g.panelStarts[2]]] as const) {
    for (const sgn of [1, -1]) {
      const fr = band.filter((i) => i >= lo && i < hi && Math.sign(g.pos2[i * 2]) === sgn)
        .sort((a, b) => g.pos2[a * 2 + 1] - g.pos2[b * 2 + 1]);
      if (fr.length < 8) { lines.push(`    β-1 옆선 ${k}홉 ${pn} x${sgn > 0 ? "+" : "−"} n=${fr.length} — 8정점 미만, 산출 불가`); continue; }
      const r = hemWobble(fr, 0.16, sim.positions);
      const abs = r.amp.map(Math.abs).sort((a, b) => a - b);
      if (abs.length === 0) { lines.push(`    β-1 옆선 ${k}홉 ${pn} x${sgn > 0 ? "+" : "−"} — 내부 표본 0, 산출 불가`); continue; }
      lines.push(`    β-1 옆선 ${k}홉 ${pn} x${sgn > 0 ? "+" : "−"} n=${fr.length} · 사슬 ${cm(r.L)}cm · 요동 중앙 ${abs[Math.floor(abs.length / 2)].toFixed(2)} p99 ${abs[Math.floor(abs.length * 0.99)].toFixed(2)} 최대 ${abs[abs.length - 1].toFixed(2)}mm · 파장 ${r.perLam < 4 ? "산출 불가(표본 " + r.perLam.toFixed(1) + "<4)" : cm(r.lam) + "cm"}`);
    }
    }
  }
  // ── β-2 밑단 프릴 봉우리와 splitZ 절단 경계의 거리 분포.
  // 봉우리 = 48계기 진폭의 국소 극대(|amp|가 이웃 둘보다 큰 정점).
  for (const [nm, c] of [["앞판", hemChain.front], ["뒤판", hemChain.back]] as const) {
    if (c.length < 8) continue;
    const r = hemWobble(c, 0.16, sim.positions);
    // hemWobble은 내부 구간만 amp를 담는다 — 인덱스 대응을 위해 내부 정점 목록을 다시 만든다.
    const sArr: number[] = [0];
    for (let k = 1; k < c.length; k++) sArr.push(sArr[k - 1] + Math.hypot(
      sim.positions[c[k] * 3] - sim.positions[c[k - 1] * 3],
      sim.positions[c[k] * 3 + 1] - sim.positions[c[k - 1] * 3 + 1],
      sim.positions[c[k] * 3 + 2] - sim.positions[c[k - 1] * 3 + 2]));
    const Ltot = sArr[sArr.length - 1];
    const inner = c.filter((_, k) => sArr[k] >= 0.08 && sArr[k] <= Ltot - 0.08);
    const peaks: number[] = [];
    for (let k = 1; k < r.amp.length - 1; k++) {
      if (Math.abs(r.amp[k]) > Math.abs(r.amp[k - 1]) && Math.abs(r.amp[k]) > Math.abs(r.amp[k + 1]) && Math.abs(r.amp[k]) > 1.0) peaks.push(k);
    }
    if (peaks.length === 0 || inner.length !== r.amp.length) {
      lines.push(`    β-2 ${nm} 봉우리 ${peaks.length}개 · 인덱스 대응 ${inner.length === r.amp.length ? "OK" : "**깨짐(" + inner.length + " vs " + r.amp.length + ") — 산출 불가**"}`);
      continue;
    }
    const dz = peaks.map((k) => Math.abs(sim.positions[inner[k] * 3 + 2] - SPLIT_Z) * 100).sort((a, b) => a - b);
    const allz = inner.map((i) => Math.abs(sim.positions[i * 3 + 2] - SPLIT_Z) * 100).sort((a, b) => a - b);
    lines.push(`    β-2 ${nm} 봉우리 ${peaks.length}개(|amp|>1mm) · **봉우리의 |z−splitZ|** 중앙 ${dz[Math.floor(dz.length / 2)].toFixed(2)} 최소 ${dz[0].toFixed(2)}cm │ **배경(전 정점)** 중앙 ${allz[Math.floor(allz.length / 2)].toFixed(2)} 최소 ${allz[0].toFixed(2)}cm — 봉우리가 경계 근방이면 중앙이 배경보다 작아야 한다`);
  }
  // ── β-3 흡착 목표 역산 도약. target = p + Δ/0.4(1회 호출 = 목표까지 40%).
  // Δ는 **기존 스크래치 리졸버**로 뜬다(BVH 재쿼리 금지 — 38회차 독립 사본 결함).
  {
    const { mesh } = compSequential();
    for (const [nm, c] of [["밑단 앞판", hemChain.front], ["밑단 뒤판", hemChain.back]] as const) {
      if (c.length < 3) continue;
      const T = (v: number, k: number): number => sim.positions[v * 3 + k] + (mesh[v * 3 + k] - sim.positions[v * 3 + k]) / 0.4;
      const jump: number[] = [];
      for (let k = 1; k < c.length; k++) {
        const a = c[k - 1], b = c[k];
        const dT = Math.hypot(T(b, 0) - T(a, 0), T(b, 1) - T(a, 1), T(b, 2) - T(a, 2));
        const dP = Math.hypot(sim.positions[b * 3] - sim.positions[a * 3], sim.positions[b * 3 + 1] - sim.positions[a * 3 + 1], sim.positions[b * 3 + 2] - sim.positions[a * 3 + 2]);
        if (dP > 1e-6) jump.push(dT / dP);
      }
      jump.sort((a, b) => a - b);
      if (jump.length === 0) { lines.push(`    β-3 ${nm} — 표본 0, 산출 불가`); continue; }
      const over3 = jump.filter((v) => v >= 3).length;
      lines.push(`    β-3 ${nm} 목표 도약비(이웃 목표거리/이웃 정점거리) 중앙 ${jump[Math.floor(jump.length / 2)].toFixed(2)} p99 ${jump[Math.floor(jump.length * 0.99)].toFixed(2)} 최대 ${jump[jump.length - 1].toFixed(2)} · **≥3배 ${over3}/${jump.length}**`);
    }
  }
  return lines.join("\n");
};
// ── 55회차 계기 1 — **링·뒤판 중배부 국면 비율을 f1/f8에도**(53계기b는 정착 1회만 인쇄해
// 54회차가 "f1/f8 산출 불가"로 남겼다). 식은 53계기b와 **같은 것**을 쓴다(새 정의 금지).
const phaseLine = (nm: string, idx: number[]): string => {
  const v = idx.map((i) => {
    const m = i < g.panelStarts[1] ? frontMesh : backMesh;
    return m.signedClearance(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR);
  }).filter((q): q is number => q !== null).sort((a, b) => a - b);
  if (v.length === 0) return `    ${nm} — 산출 불가`;
  const q = (f: number): string => (v[Math.min(v.length - 1, Math.floor(f * v.length))] * 1000).toFixed(1);
  const p1 = v.filter((x) => x > COLLISION_MARGIN).length, p2 = v.filter((x) => x > 0 && x <= COLLISION_MARGIN).length, p3 = v.filter((x) => x <= 0).length;
  const pc = (n: number): string => (100 * n / v.length).toFixed(1);
  return `    ${nm} n=${v.length} · d(mm) p25 ${q(0.25)} 중앙 ${q(0.5)} p99 ${q(0.99)} · 국면1 ${p1}(${pc(p1)}%) · 국면2 ${p2}(${pc(p2)}%) · 국면3 ${p3}(${pc(p3)}%)`;
};
const ringMidReport = (label: string): string => {
  const fr = ringOrder.filter((i) => i < g.panelStarts[1]), bk = ringOrder.filter((i) => i >= g.panelStarts[1]);
  const mid: number[] = [];
  for (let i = g.panelStarts[1]; i < g.panelStarts[2]; i++) {
    const y = sim.positions[i * 3 + 1];
    if (y >= 1.10 && y <= 1.25) mid.push(i);
  }
  return [`  [55계기·링/중배부 국면] ${label} · 경계 margin ${(COLLISION_MARGIN * 1000).toFixed(1)}mm`,
    phaseLine("링 앞판", fr), phaseLine("링 뒤판", bk), phaseLine("뒤판 중배부(y110~125)", mid)].join("\n");
};
const ringShapeReport = (label: string): string => {
  const stat = (idx: number[], nm: string): string => {
    if (idx.length === 0) return `${nm} —`;
    const rs = idx.map((i) => capRadiusOf(sim.positions[i * 3], sim.positions[i * 3 + 2])).sort((a, b) => a - b);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const varc = rs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rs.length;
    // 40회차 정정 — 이 열의 비교 상수를 **39회차 값에 동결**한다. `CAP0_PUSH_R`을 그대로
    // 쓰면 캡슐 기하를 바꾸는 순간 같은 이름의 열이 다른 대상을 재서 회차 간 대조가
    // 끊긴다(함정 13). 살아 있는 값은 오른쪽에 따로 병기한다.
    const over = rs.filter((r) => r >= R39_BASELINE - 1e-6).length;
    const overLive = rs.filter((r) => r >= CAP0_PUSH_R - 1e-6).length;
    return `${nm} n=${idx.length} 중앙 ${cm(rs[Math.floor(rs.length / 2)])} 최소 ${cm(rs[0])} 최대 ${cm(rs[rs.length - 1])} 표준편차 ${(Math.sqrt(varc) * 100).toFixed(2)}cm · r≥${cm(R39_BASELINE)}(39회차 동결) ${over}/${idx.length}${Math.abs(CAP0_PUSH_R - R39_BASELINE) > 1e-9 ? ` · r≥${cm(CAP0_PUSH_R)}(현행) ${overLive}/${idx.length}` : ""}`;
  };
  const front = ringOrder.filter((i) => i < g.panelStarts[1]);
  const back = ringOrder.filter((i) => i >= g.panelStarts[1]);
  const ys = ringOrder.map((i) => sim.positions[i * 3 + 1]).sort((a, b) => a - b);
  return [
    `  [39계기D·링 형상] ${label} · 링60 ${cm(ringLenM())}cm · 폐곡선 ${cm(ringLenM() + joinLenM())}cm · y ${cm(ys[0])}~${cm(ys[ys.length - 1])}cm`,
    `    캡슐축(x ${cm(CAP0.top.x)}, z ${cm(CAP0.top.z)}) 기준 반경(cm): ${stat(ringOrder, "전체")}`,
    `      ${stat(front, "앞판")}`,
    `      ${stat(back, "뒤판")}`,
    // 40회차 라벨 정정 — 이 두 값은 **링 대역의 몸 반경이 아니다**.
    //  · `neckBaseGirthM/(2π)`는 **y145.23 한 높이의 등방 등가반경**인데 위 링 반경은
    //    링이 실제로 있는 y(정착 131.85~140.86)에서 잰다. 높이가 4~13cm 다르다.
    //  · 몸 단면은 비등방이라(뒤 3.4~7.8 / 앞 7.2~14.8 / 옆 9~26cm) 등가반경 하나로
    //    "관통했는가"를 판정할 수 없다. 관통은 레이 패리티 채널이 따로 센다.
    // 이 줄은 **참고 상수**이고 판정 채널이 아니다. (함정 13 "시점·집합" · 함정 14)
    `    참고 상수(판정 채널 아님): 캡슐 밀어내기 반경 ${cm(CAP0_PUSH_R)}cm(원 둘레 ${cm(2 * Math.PI * CAP0_PUSH_R)}cm) · 목밑 등가반경 **@y${cm(body.neckBaseY)}만** ${cm(body.neckBaseGirthM / (2 * Math.PI))}cm(등방 환산 · 링 대역 몸 반경 아님)`,
  ].join("\n");
};
// 몸 부위 분류 — 전부 `bodyMeasure` 실측 랜드마크에서 도출한다(새 상수 0).
//   목 기둥 = 목밑둘레 높이 위 · 어깨 능선 = 그 |x|의 최상단 표면점 근방(margin)
//   팔 = 어깨너비 절반 밖 · 나머지는 centerZ 기준 가슴/등
const bodyPartOf = (x: number, y: number, z: number): string => {
  const dx = Math.abs(x - centerX);
  if (y > body.neckBaseY) return "목기둥";
  if (y >= body.ridgeTopYAt(dx) - COLLISION_MARGIN) return "어깨능선";
  if (dx > body.shoulderSpanM / 2) return "팔";
  return z > collision.centerZ ? "가슴" : "등";
};
// 링 중심(xz 평면) — 반경 방향 분해의 기준. 링 정점 무게중심에서 뜬다.
const ringCenterXZ = (): { cx: number; cz: number } => {
  const idx = [...new Set(g.necklineRing.flatMap((e) => [e.a, e.b]))];
  let cx = 0, cz = 0;
  for (const i of idx) { cx += sim.positions[i * 3]; cz += sim.positions[i * 3 + 2]; }
  return { cx: cx / idx.length, cz: cz / idx.length };
};
type Dis = { i: number; dxm: number; dym: number; dzm: number; mag: number; radial: number; part: string; pinned: boolean };
const dissect = (label: string, idx: number[]): Dis[] => {
  adsorbRun();
  const { cx, cz } = ringCenterXZ();
  const out: Dis[] = [];
  for (const i of idx) {
    const px = sim.positions[i * 3], py = sim.positions[i * 3 + 1], pz = sim.positions[i * 3 + 2];
    const dx = adsorbScratch[i * 3] - px, dy = adsorbScratch[i * 3 + 1] - py, dz = adsorbScratch[i * 3 + 2] - pz;
    // 함의 목표 = pos + Δ/PUSH_RELAXATION(0.4). 부위는 그 목표로 분류한다.
    const tx = px + dx / 0.4, ty = py + dy / 0.4, tz = pz + dz / 0.4;
    const rx = px - cx, rz = pz - cz;
    const rl = Math.hypot(rx, rz) || 1e-9;
    out.push({
      i, dxm: dx * 1000, dym: dy * 1000, dzm: dz * 1000, mag: Math.hypot(dx, dy, dz) * 1000,
      radial: ((dx * rx + dz * rz) / rl) * 1000, part: bodyPartOf(tx, ty, tz), pinned: !!sim.pinned[i],
    });
  }
  void label;
  return out;
};
const disReport = (label: string, rows: Dis[]): string => {
  if (rows.length === 0) return `  [35계기·흡착 해부] ${label} — 대상 0개`;
  const mags = rows.map((r) => r.mag).sort((a, b) => a - b);
  const rads = rows.map((r) => r.radial);
  const outward = rads.filter((v) => v > 0), inward = rads.filter((v) => v < 0);
  const parts = new Map<string, number>();
  for (const r of rows) parts.set(r.part, (parts.get(r.part) ?? 0) + 1);
  const worst = [...rows].sort((a, b) => b.mag - a.mag).slice(0, 5);
  const P = (r: Dis): string =>
    `#${r.i}(${cm(g.pos2[r.i * 2])},${cm(g.pos2[r.i * 2 + 1])})${r.pinned ? "[핀]" : ""} 위치(${cm(sim.positions[r.i * 3])},${cm(sim.positions[r.i * 3 + 1])},${cm(sim.positions[r.i * 3 + 2])}) Δ(${r.dxm.toFixed(1)},${r.dym.toFixed(1)},${r.dzm.toFixed(1)})mm |Δ|${r.mag.toFixed(1)} 반경${r.radial >= 0 ? "+" : ""}${r.radial.toFixed(1)} ${r.part}`;
  return [
    `  [35계기·흡착 해부] ${label} n=${rows.length} · 1회 호출분(=목표까지 40%)`,
    `    |Δ| 중앙 ${mags[Math.floor(mags.length * 0.5)].toFixed(2)}mm · p99 ${mags[Math.floor(mags.length * 0.99)].toFixed(2)}mm · 최대 ${mags[mags.length - 1].toFixed(2)}mm · 합 ${(mags.reduce((a, b) => a + b, 0)).toFixed(1)}mm`,
    `    반경 분해: 외향 ${outward.length}개 총 +${outward.reduce((a, b) => a + b, 0).toFixed(1)}mm · 내향 ${inward.length}개 총 ${inward.reduce((a, b) => a + b, 0).toFixed(1)}mm · 순 ${(rads.reduce((a, b) => a + b, 0)).toFixed(1)}mm · **[폐기 채널]** 반경→둘레 환산 ${(2 * Math.PI * rads.reduce((a, b) => a + b, 0) / Math.max(1, rows.length) / 10).toFixed(2)}cm (35회차: 반경 분해는 링 길이를 원리적으로 못 잰다 — 참고만)`,
    `    목표 부위: ${[...parts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `    최대 5: ${worst.map(P).join("\n           ")}`,
  ].join("\n");
};
const ringIdx = [...new Set(g.necklineRing.flatMap((e) => [e.a, e.b]))];
// 어깨 시접 앵커 36 · 암홀 시접 대역(양끝 전부) — 5번 항목.
const anchorIdx = anchorList.map((a) => a.i);
const armholeIdx = [...new Set(g.seams.filter((s) => s.kind === "armhole").flatMap((s) => [s.a, s.b]))];
// 4번 항목 — f8 최악 엣지(앞판 ±22.31,4.21 → ±22.29,4.94)를 패턴 좌표로 찾는다.
const trackEdges = (() => {
  const near = (i: number, x: number, y: number): boolean =>
    Math.abs(Math.abs(g.pos2[i * 2]) - x) < 0.002 && Math.abs(g.pos2[i * 2 + 1] - y) < 0.002;
  const out: { a: number; b: number; rest: number }[] = [];
  for (const c of sim.constraintPairs) {
    if (c.a >= g.panelStarts[1]) continue;
    const hit = (near(c.a, 0.2231, 0.0421) && near(c.b, 0.2229, 0.0494)) || (near(c.b, 0.2231, 0.0421) && near(c.a, 0.2229, 0.0494));
    if (hit) out.push({ a: c.a, b: c.b, rest: c.restLength });
  }
  return out;
})();
// ── 32회차 계기: **rest 정합 지도**. 부호 있는 신장비(현재/rest)를 대역별로.
// 대역은 링에서의 엣지 홉 수로 도출한다(상수 신설 없음).
const ringVertsForMap = new Set<number>(g.necklineRing.flatMap((e) => [e.a, e.b]));
const hopFromRing = (() => {
  const adj = new Map<number, number[]>();
  for (const e of g.edgePairs) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const d = new Int32Array(g.pos2.length / 2).fill(-1);
  let q = [...ringVertsForMap];
  for (const i of q) d[i] = 0;
  for (let depth = 1; depth <= 3 && q.length > 0; depth++) {
    const nx: number[] = [];
    for (const i of q) for (const j of adj.get(i) ?? []) if (d[j] < 0) { d[j] = depth; nx.push(j); }
    q = nx;
  }
  return d;
})();
const seamKeyMap = new Set<string>(g.seams.map((sm) => (sm.a < sm.b ? `${sm.a}_${sm.b}` : `${sm.b}_${sm.a}`)));
// 49회차 — 밑단·옆선 대역을 rest 지도에 신설(48회차 미이행분).
// 홉 기계는 46계기와 같은 BFS를 쓰되 **시드가 다르다**(밑단 사슬 / 옆선 시접).
const hopFromHem = (() => {
  const adj = new Map<number, number[]>();
  for (const e of g.edgePairs) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const mk = (seed: number[]): Int32Array => {
    const d = new Int32Array(total).fill(-1);
    let q = [...seed];
    for (const v of q) d[v] = 0;
    for (let k = 1; q.length && k <= 4; k++) {
      const nx: number[] = [];
      for (const v of q) for (const w of adj.get(v) ?? []) if (d[w] < 0) { d[w] = k; nx.push(w); }
      q = nx;
    }
    return d;
  };
  const lenM = g.draft.dims.lengthM;
  const hemSeed: number[] = [];
  for (let i = 0; i < g.panelStarts[2]; i++) if (g.pos2[i * 2 + 1] > lenM - 0.01) hemSeed.push(i);
  const sideSeed = [...new Set(g.seams.filter((sm) => sm.kind === "side").flatMap((sm) => [sm.a, sm.b]))];
  return { hem: mk(hemSeed), side: mk(sideSeed) };
})();
const bandOf = (a: number, b: number): string => {
  if (seamKeyMap.has(a < b ? `${a}_${b}` : `${b}_${a}`)) return "시접 쌍";
  {
    const hh = Math.max(hopFromHem.hem[a], hopFromHem.hem[b]);
    if (hh >= 0 && hh <= 4) return `밑단 ${hh}홉`;
    const sh = Math.max(hopFromHem.side[a], hopFromHem.side[b]);
    if (sh >= 0 && sh <= 4) return `옆선 ${sh}홉`;
  }
  const h = Math.max(hopFromRing[a], hopFromRing[b]);
  if (h >= 0 && h <= 3) return `링 인접 ${h === 0 ? "0(링 자신)" : h}홉`;
  if (a >= g.panelStarts[2]) return "소매";
  return a < g.panelStarts[1] ? "앞판 내부" : "뒤판 내부";
};
const totals = new Map<string, { comp: number; ext: number; max: number; at: number }>();
const restMap = (label: string): string => {
  const bands = new Map<string, number[]>();
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    const dd = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    const key = bandOf(c.a, c.b);
    const arr = bands.get(key) ?? []; bands.set(key, arr);
    arr.push(dd / c.restLength);
    // 부호별 총량은 별도 누적(아래에서 같은 순회를 다시 돌지 않게 음수 인코딩 대신 맵 하나 더)
    const t = totals.get(key) ?? { comp: 0, ext: 0, max: 0, at: -1 };
    if (dd < c.restLength) t.comp += c.restLength - dd; else t.ext += dd - c.restLength;
    if (dd / c.restLength > t.max) { t.max = dd / c.restLength; t.at = c.a; }
    totals.set(key, t);
  }
  const lines = [`  [32계기·rest 정합 지도] ${label}`];
  const order = ["링 인접 0(링 자신)", "링 인접 1홉", "링 인접 2홉", "링 인접 3홉", "밑단 0홉", "밑단 1홉", "밑단 2홉", "밑단 3홉", "밑단 4홉", "옆선 0홉", "옆선 1홉", "옆선 2홉", "옆선 3홉", "옆선 4홉", "앞판 내부", "뒤판 내부", "소매", "시접 쌍"];
  for (const k of order) {
    const arr = bands.get(k); if (!arr) continue;
    arr.sort((x, y) => x - y);
    const t = totals.get(k)!;
    const md = arr[Math.floor(arr.length * 0.5)], p99 = arr[Math.floor(arr.length * 0.99)];
    lines.push(`    ${k.padEnd(14)} n=${String(arr.length).padStart(5)} 중앙 ${md.toFixed(3)} p99 ${p99.toFixed(3)} 최대 ${t.max.toFixed(3)}@${t.at} · 압축총 ${(t.comp * 100).toFixed(1)}cm · 신장총 ${(t.ext * 100).toFixed(1)}cm`);
  }
  // 최악 엣지 국소화 — 어느 패널 어느 패턴 좌표인가(대역 평균으로는 안 보인다).
  const worst: { r: number; a: number; b: number }[] = [];
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    const dd = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    worst.push({ r: dd / c.restLength, a: c.a, b: c.b });
  }
  worst.sort((x, y) => y.r - x.r);
  const pn = (i: number): string => (i < g.panelStarts[1] ? "앞판" : i < g.panelStarts[2] ? "뒤판" : "소매");
  {
    const w = worst[0];
    const P = (i: number) => `#${i}[${i < g.panelStarts[1] ? "앞" : i < g.panelStarts[2] ? "뒤" : "소매"}] 2D(${cm(g.pos2[i*2])},${cm(g.pos2[i*2+1])}) 3D(${cm(sim.positions[i*3])},${cm(sim.positions[i*3+1])},${cm(sim.positions[i*3+2])})`;
    const c = [...sim.constraintPairs].find((q) => q.a === w.a && q.b === w.b);
    lines.push(`    [배치 상수] panelStarts ${g.panelStarts.join(",")} · topY(meta neckPointY) ${cm(g.meta.neckPointY)} · centerZ ${cm(collision.centerZ)} · torsoOffset 앞 ${cm(g.meta.torsoOffsetFrontM)} 뒤 ${cm(g.meta.torsoOffsetBackM)} · 앞판면 z ${cm(collision.centerZ + g.meta.torsoOffsetFrontM)} · 뒤판면 z ${cm(collision.centerZ - g.meta.torsoOffsetBackM)}`);
    lines.push(`    [최악 1 해부] ${P(w.a)} ↔ ${P(w.b)} · restLength ${((c?.restLength ?? 0)*1000).toFixed(2)}mm · 2D거리 ${(Math.hypot(g.pos2[w.b*2]-g.pos2[w.a*2], g.pos2[w.b*2+1]-g.pos2[w.a*2+1])*1000).toFixed(2)}mm · 3D거리 ${(Math.hypot(sim.positions[w.b*3]-sim.positions[w.a*3], sim.positions[w.b*3+1]-sim.positions[w.a*3+1], sim.positions[w.b*3+2]-sim.positions[w.a*3+2])*1000).toFixed(2)}mm`);
  }
  lines.push(`    최악 6: ${worst.slice(0, 6).map((w) => `${w.r.toFixed(1)}배 ${pn(w.a)}(${cm(g.pos2[w.a * 2])},${cm(g.pos2[w.a * 2 + 1])})→(${cm(g.pos2[w.b * 2])},${cm(g.pos2[w.b * 2 + 1])}) rest ${(Math.hypot(g.pos2[w.b * 2] - g.pos2[w.a * 2], g.pos2[w.b * 2 + 1] - g.pos2[w.a * 2 + 1]) * 1000).toFixed(1)}mm`).join(" · ")}`);
  // ── 63회차 §3 — **소매 엣지의 2D 방향별 분해**(61회차는 일회성 프로브였다).
  // 소매 배치는 원주 방향에만 신장을 넣고(`radius = sleeveRadiusM + COLLISION_MARGIN`)
  // 축 방향은 `d·yp`로 보존한다 — 단일 중앙값 1.108은 **어느 정점에서도 실현되지 않는
  // 혼합 중앙값**이다(61회차 반증). 방향을 갈라야 그 사실이 매 실행 보인다(함정 18).
  {
    const bin: number[][] = [[], [], [], []];
    for (const c of sim.constraintPairs) {
      if (c.restLength <= 0 || c.a < g.panelStarts[2]) continue;
      const dx = g.pos2[c.b * 2] - g.pos2[c.a * 2], dy = g.pos2[c.b * 2 + 1] - g.pos2[c.a * 2 + 1];
      if (dx === 0 && dy === 0) continue;
      // 0° = 원주(패턴 x) · 90° = 축(패턴 y).
      const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
      const dd = Math.hypot(
        sim.positions[c.b * 3] - sim.positions[c.a * 3],
        sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
        sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
      );
      bin[ang < 15 ? 0 : ang < 45 ? 1 : ang < 75 ? 2 : 3].push(dd / c.restLength);
    }
    const nm = ["0~15°(원주)", "15~45°", "45~75°", "75~90°(축)"];
    lines.push(`    [63계기·소매 방향 분해] ${bin.map((a, j) => {
      if (a.length === 0) return `${nm[j]} n=0 산출 불가`;
      a.sort((x, y) => x - y);
      return `${nm[j]} n=${a.length} 중앙 ${a[Math.floor(a.length * 0.5)].toFixed(4)} p99 ${a[Math.floor(a.length * 0.99)].toFixed(3)} 최대 ${a[a.length - 1].toFixed(3)}`;
    }).join(" │ ")}`);
  }
  totals.clear();
  return lines.join("\n");
};

const env: GarmentFrameEnv = {
  probe,
  collisionResolver: unifiedProbed,
  collisionEvery: COLLISION_EVERY,
  selfCollision,
  orderColumn: false, orderRow: false, clampInSubstep: true, smoothing: false, postOrder: false,
  armSoftPull: false, necklineHug: false, sleeveArmPull: false, yAlign: false, symmetry: false,
  clampAfterPost: false,
  maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
  friction: createSdfFrictionPass(() => sdfField, {
    contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_STATIC, muKinetic: FRICTION_MU_KINETIC,
  }),
  frictionIteration: (pos, prev, pinned, n) => { cachedFric.apply(pos, prev, pinned, n); probe("1b.반복내 마찰"); },
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
// 60회차 계기① — deltaHist와 **같은 순서**의 병렬 배열(정착 판정식 무변경).
const deltaArg: { f: number; i: number }[] = [];
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

// ── 34회차 게이트(영구) — **배치는 rest를 보존해야 한다.**
//
// 문턱은 결과에 맞춘 값이 아니라 **같은 기계가 이미 달성한 수준**에서 도출한다:
// 뒤판 내부는 하드 핀이 안 걸리는 패널이라 32회차 t=0 실측이 최대 신장비
// **1.000 · 신장총 0.0cm**였다. 몸판 사상(`mapTorso`)은 평면 등거리이고 rest는
// 패턴 2D 거리(`buildPatternSim`)이므로 앞뒤 **둘 다** 정확히 1.000이어야 한다.
// 남는 허용분은 `Math.hypot` 반올림뿐이다.
//
// **소매는 게이트 대상이 아니다**(값은 보고만): 원통 감기라 등거리 사상이 아니고,
// 중앙값 1.108의 전역·균일 신장은 33회차가 **별도 결함으로 등재**했다(배치 반경
// vs wrapShrink). 이번 회차 변수가 아니라 제외하는 것이지, 통과시키는 게 아니다.
// **시접 쌍도 제외**: rest가 3D 갭으로 등록돼 S1이 target까지 램프하는 대상이라
// 배치 시점 정합의 의미가 없다.
//
// 허용분은 **저장 형식에서 도출한다**(결과에 맞춰 조정한 값이 아니다 · 규범 "문턱").
// rest는 `pos2`(Float64) 2D 거리인데 3D 좌표는 `sim.positions`(**Float32**)다.
// 좌표 크기 |c| ≈ 1.5m에서 float32 반올림은 |c|·2⁻²⁴ ≈ 0.09µm이고, 거리는 양 끝점
// 오차를 받으므로 최대 2·|c|·2⁻²⁴. 이걸 **가장 짧은 rest 엣지**(≈6.6mm)로 나눈
// 것이 배율 단위 허용분이다 ⇒ 2·1.5·5.96e−8 / 0.0066 ≈ **2.7e−5**.
// 즉 배율 1.000에 3자리 이상을 요구하는 것은 float32가 표현할 수 없는 정밀도다.
// 33회차가 "이산화 오차 허용분만 별도 명명"이라 적은 항목이 이것이다.
// 잡아야 할 결함(30.1배)과는 6자릿수 떨어져 있으므로 탐지력은 잃지 않는다.
const F32_HALF_ULP = Math.pow(2, -24);
const placementRestTol = (): number => {
  let maxCoord = 0, minRest = Infinity;
  for (let i = 0; i < total * 3; i++) maxCoord = Math.max(maxCoord, Math.abs(sim.positions[i]));
  for (const c of sim.constraintPairs) if (c.restLength > 0 && c.restLength < minRest) minRest = c.restLength;
  return (2 * maxCoord * F32_HALF_ULP) / minRest;
};
const placementRestGate = (label: string): void => {
  const PLACEMENT_REST_TOL = placementRestTol();
  const acc = { torso: { n: 0, max: 1, maxAt: -1, min: 1, ext: 0, comp: 0 }, sleeve: { n: 0, max: 1, maxAt: -1, min: 1, ext: 0, comp: 0 } };
  for (const c of sim.constraintPairs) {
    if (c.restLength <= 0) continue;
    if (seamKeyMap.has(c.a < c.b ? `${c.a}_${c.b}` : `${c.b}_${c.a}`)) continue;
    const dd = Math.hypot(
      sim.positions[c.b * 3] - sim.positions[c.a * 3],
      sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
      sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
    );
    const t = c.a < g.panelStarts[2] ? acc.torso : acc.sleeve;
    const r = dd / c.restLength;
    t.n++;
    if (r > t.max) { t.max = r; t.maxAt = c.a; }
    if (r < t.min) t.min = r;
    if (dd > c.restLength) t.ext += dd - c.restLength; else t.comp += c.restLength - dd;
  }
  const row = (k: string, t: typeof acc.torso): string =>
    `${k} n=${t.n} 최대 ${t.max.toFixed(6)}${t.maxAt >= 0 ? `@정점${t.maxAt}(패턴 ${cm(g.pos2[t.maxAt * 2])},${cm(g.pos2[t.maxAt * 2 + 1])})` : ""} · 최소 ${t.min.toFixed(6)} · 신장총 ${(t.ext * 100).toFixed(1)}cm · 압축총 ${(t.comp * 100).toFixed(1)}cm`;
  console.log(`  [34게이트·배치 rest 보존] ${label} · 허용분 ±${PLACEMENT_REST_TOL.toExponential(2)}(float32 좌표/최단 rest에서 도출)`);
  console.log(`    ${row("몸판(게이트)", acc.torso)}`);
  console.log(`    ${row("소매(보고만)", acc.sleeve)}`);
  const bad = acc.torso.max - 1 > PLACEMENT_REST_TOL || 1 - acc.torso.min > PLACEMENT_REST_TOL;
  if (bad) {
    throw new Error(
      `배치 실패 — 34게이트 위반 ${label}: 몸판 신장비 ${acc.torso.min.toFixed(6)}~${acc.torso.max.toFixed(6)} (문턱 1.000000±${PLACEMENT_REST_TOL.toExponential(2)} · 값=뒤판 32회차 실측, 허용분=float32 저장 정밀도에서 도출) · 신장총 ${(acc.torso.ext * 100).toFixed(1)}cm`,
    );
  }
};

// 상태기계의 램프 길이. S1 시접 rest 램프·앵커 강도 램프아웃·앵커 위치 램프가
// **같은 값 한 곳**을 쓴다(새 상수 신설 금지 — §4 "램프는 연속 함수로만").
const RAMP_FRAMES = 120;

// ── 앵커 하드 핀 (7회차 단일 변경): 소프트(강도 1.0) → `pinned=1` 위치 고정.
// 6회차 실측 = 목표 |x| 6.26cm인데 정점은 10.5cm(4.2cm 밖) — 소프트 앵커를
// 시접·링·중력의 합력이 이긴다. `pinned=1`은 적분·제약·충돌·변위클램프가
// 전부 스킵하므로 합력과 무관하게 좌표가 유지된다(§4 개정).
// 해제는 상태기계가 봉합 해제창에서 부른다 — 여기서는 켜고 끄기만.
//
// ── 34회차 단일 변경 (B: 램프) — **핀이 rest를 찢는 이동을 수행하지 않는다.**
// 33회차가 지점을 확정했다: `sim.pin(a.i, a.x, a.y, a.z)`가 정점을 배치 평면
// (앞판면 z +17.07cm)에서 어깨 능선(z −2.65cm)으로 **한 프레임에** 옮겼고,
// 그 정점이 속한 rest 6.64mm 엣지가 3D 199.80mm(**30.1배**)가 됐다. 핀은 이웃
// 엣지의 rest를 모르므로 이동분 전량이 이웃에 저장된다.
// 처방: 목표까지 `RAMP_FRAMES`·같은 smoothstep으로 **나눠** 옮긴다. 프레임당
// 증분이 작아 거리 제약 반복이 그 자리에서 분산할 시간이 생긴다. 핀의 유지력은
// 반납하지 않는다 — 정점은 여전히 `pinned=1`이고 목표에 도달한다.
let anchorHard = false;
let anchorRampFrame = 0;
// 42회차 — 34게이트 (ii) 1회 무장 플래그. `place`(배치·재배치)가 다시 세운다.
let gateArmed = true;
let anchorRampS = 0;
const anchorFrom = new Float32Array(anchorList.length * 3);
const setAnchorHard = (hard: boolean): void => {
  if (hard !== anchorHard) {
    anchorHard = hard;
    anchorRampFrame = 0;
    for (let k = 0; k < anchorList.length; k++) {
      const a = anchorList[k];
      if (hard) {
        // 출발점 = **현재 좌표**(배치 결과). 좌표는 여기서 건드리지 않는다.
        anchorFrom[k * 3] = sim.positions[a.i * 3];
        anchorFrom[k * 3 + 1] = sim.positions[a.i * 3 + 1];
        anchorFrom[k * 3 + 2] = sim.positions[a.i * 3 + 2];
        sim.pinned[a.i] = 1;
      } else {
        sim.pinned[a.i] = 0;
      }
    }
    console.log(
      `[dress] 앵커 ${hard ? `**하드 핀 위치 램프 시작**(${RAMP_FRAMES}프레임 smoothstep · 순간이동 아님)` : "**핀 해제 → 소프트 램프아웃**"} ${anchorList.length}개 · seamGap ${(maxSeamGapM() * 1000).toFixed(1)}mm`,
    );
  }
  if (!hard) { anchorRampS = 0; return; }
  const t = Math.min(1, anchorRampFrame / RAMP_FRAMES);
  anchorRampS = t * t * (3 - 2 * t);
  for (let k = 0; k < anchorList.length; k++) {
    const a = anchorList[k];
    sim.setParticle(
      a.i,
      anchorFrom[k * 3] + (a.x - anchorFrom[k * 3]) * anchorRampS,
      anchorFrom[k * 3 + 1] + (a.y - anchorFrom[k * 3 + 1]) * anchorRampS,
      anchorFrom[k * 3 + 2] + (a.z - anchorFrom[k * 3 + 2]) * anchorRampS,
    );
  }
  // 게이트 (ii) — 핀이 좌표를 쓴 **직후**. 램프면 s=0이라 (i)과 같아야 한다.
  //
  // 42회차 배선 정정: **배치 직후 첫 핀 발화에만** 돈다. 34회차 설계 의도가 그것인데
  // `setAnchorHard`는 S1에서 `closure <= 0`이면 매 프레임 불리므로, seamGap이 다시
  // 열려 하드 핀이 재결합하면 **시뮬 220프레임 뒤에도** "핀 발화 직후"라는 이름으로
  // 배치 rest 정합을 검사했다(41회차 6회째 위반 = 함정 13 "시점").
  // 재무장은 `place` 훅이 한다 — 재배치는 좌표를 배치 상태로 되돌리므로 그 뒤의
  // 첫 핀 발화는 다시 "배치 직후"가 맞다.
  if (anchorRampFrame === 0 && gateArmed) { gateArmed = false; placementRestGate("(ii) 핀 발화 직후"); }
  anchorRampFrame++;
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
// 게이트 (i) — **진짜 배치 직후 · 핀 발화 전.** 상태기계의 첫 setAnchorHard는
// 루프 안(S1 분기)에 있고 그건 이미 핀이 돈 뒤다. 여기가 유일한 "핀 전" 시점이다.
placementRestGate("(i) 진짜 배치 직후 · 핀 발화 전");
const result = runDressing(
  sim, session, rampSeams.map((s) => ({ a: s.a, b: s.b, target: s.targetM, kind: s.kind })),
  {
    rampFrames: RAMP_FRAMES,
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
      placementRestGate(`(i) 재배치 직후 · 핀 발화 전 (오프셋 배수 ${scale.toFixed(2)})`);
      gateArmed = true; // 재배치가 좌표를 배치 상태로 되돌렸다 → 다음 핀 발화는 다시 "배치 직후"다
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
      // 31회차 — 표적 프레임에서만 프로브 무장. f1(문제의 +32cm) · f8 · f62(S1 최대) · 정착.
      // 34회차 **계기 라벨 정정**(함정 13 계열): 이 지도는 "t=0 = 배치 직후"가
      // 아니다. 상태기계는 루프 진입 → S1 분기에서 `setAnchorHard`를 부른 **뒤**
      // `beforeStep`을 부른다(dressingMachine 196행 vs 219행). 즉 32회차가
      // "t=0(배치 직후)"라고 부른 지도는 **핀이 이미 돈 뒤**의 지도다.
      // 진짜 배치 직후는 `placementRestGate("(i) …")`가 잰다.
      if (_frame === 0) probeReports.push(restMap("f0 beforeStep (**핀 발화 직후** · 첫 적분 전) — 32회차가 't=0'이라 부른 시점"));
      // ── 38회차 계기 A — 접합 실거리 시계열(37회차 C3). beforeStep은 step 직전이라
      // 여기 값이 "f=_frame 종료 상태 = f=_frame+1 시작 상태"다. 라벨을 그렇게 붙인다.
      if (JOIN_FRAMES.has(_frame)) {
        const rows = ringJoinPairs.map((sm, k) => {
          const d = Math.hypot(
            sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
            sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
            sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
          );
          const r = joinConstraints[k]?.restLength ?? NaN;
          // 부호 규약: rest−실거리 > 0 = **압축**(제약이 두 목점을 밀어낸다)
          //           rest−실거리 < 0 = **신장**(제약이 두 목점을 당긴다)
          return `#${sm.a}↔#${sm.b} 실거리 ${cm(d)} rest ${cm(r)} (rest−실) ${((r - d) * 100 >= 0 ? "+" : "")}${((r - d) * 100).toFixed(2)}cm ${r > d ? "**압축→밀어냄**" : "신장→당김"}`;
        });
        probeReports.push(`  [38계기A·접합 실거리] f=${String(_frame).padStart(3)} 링60 ${cm(ringLenM())}cm · 접합합 실거리 ${cm(joinLenM())}cm rest ${cm(joinDistRestSumM())}cm · ${rows.join(" · ")}`);
      }
      // 39회차 계기 D(형상) · B(성분 3분리) — f1·f2·f3·f4·f8 + f62. beforeStep은 step 직전이라
      // 여기 값은 "f=_frame 종료 상태". D는 t=0(=f0)도 찍는다.
      if (SHAPE_FRAMES.has(_frame)) { probeReports.push(ringShapeReport(`f=${_frame}`)); probeReports.push(capsuleCountReport(`f=${_frame}`)); }
      if (_frame === 0 || _frame === 1 || _frame === 8) { probeReports.push(hemReport(`f=${_frame}`)); probeReports.push(hemRenderReport(`f=${_frame}`)); probeReports.push(betaReport(`f=${_frame}`)); probeReports.push(ringMidReport(`f=${_frame}`)); }
      if (_frame === 0) { probeReports.push(hemSelfTest()); probeReports.push(hemLiftTest()); }
      if (COMP_FRAMES.has(_frame)) probeReports.push(compReport(`f${_frame + 1} 직전(=f${_frame} 종료 상태)`));
      // ── 35회차 계기. beforeStep(_frame)은 f=_frame+1을 만드는 step **직전**이다.
      if (_frame === 0 || _frame === 7) {
        const fl = `f${_frame + 1}`;
        probeReports.push(disReport(`${fl} 링 62정점`, dissect(fl, ringIdx)));
        probeReports.push(disReport(`${fl} 링 1홉 이웃`, dissect(fl, [...new Set(sim.constraintPairs.filter((c) => Math.max(hopFromRing[c.a], hopFromRing[c.b]) === 1).flatMap((c) => [c.a, c.b]))].filter((i) => !ringIdx.includes(i)))));
        probeReports.push(disReport(`${fl} 어깨 시접 앵커 36`, dissect(fl, anchorIdx)));
        probeReports.push(disReport(`${fl} 암홀 시접 대역`, dissect(fl, armholeIdx)));
      }
      // 4번 — 앞판 최대 신장 엣지의 프레임별 추적(f0~f8 · step 직전 값).
      if (_frame <= 8 && trackEdges.length > 0) {
        adsorbRun();
        const line = trackEdges.map((e) => {
          const d = Math.hypot(
            sim.positions[e.b * 3] - sim.positions[e.a * 3],
            sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1],
            sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2],
          );
          const dm = (i: number): string => `${(Math.hypot(adsorbScratch[i * 3] - sim.positions[i * 3], adsorbScratch[i * 3 + 1] - sim.positions[i * 3 + 1], adsorbScratch[i * 3 + 2] - sim.positions[i * 3 + 2]) * 1000).toFixed(2)}`;
          return `#${e.a}${sim.pinned[e.a] ? "[핀]" : ""}↔#${e.b}${sim.pinned[e.b] ? "[핀]" : ""} ${(d / e.rest).toFixed(3)}배(${(d * 1000).toFixed(1)}mm) 흡착Δ ${dm(e.a)}/${dm(e.b)}mm`;
        }).join(" · ");
        probeReports.push(`  [35계기·추적 엣지] step 직전 f=${_frame} → ${line}`);
      }
      probeArmed = PROBE_FRAMES.has(_frame + 1);
      if (probeArmed) {
        probeSub = 0; probeLog.length = 0; probeFrameLabel = `f${_frame + 1}/${state}`;
        // 0b 구간(적분+거리제약)을 더 가른다 — Verlet 적분이 만들 수 있는 변위는
        // 관성 |pos−prev| + g·dt²가 상한이다. 이게 작으면 적분은 무죄이고
        // 그 구간의 변화는 전부 **거리 제약 반복**이 만든 것이다.
        let vmax = 0;
        for (let i = 0; i < sim.positions.length; i++) vmax = Math.max(vmax, Math.abs(sim.positions[i] - sim.prevPositions[i]));
        const gdt2 = 9.81 * SUBSTEP_DT * SUBSTEP_DT;
        probeReports.push(`  [31계기·적분 상한] ${probeFrameLabel} 관성 최대 |pos−prev| ${(vmax * 1000).toFixed(3)}mm · g·dt² ${(gdt2 * 1000).toFixed(3)}mm · 정점당 적분 변위 상한 ≈ ${((vmax + gdt2) * 1000).toFixed(3)}mm → 링 ${g.necklineRing.length}엣지(= ringLenM이 순회하는 집합 · 폐곡선 62엣지가 아니다) 전체가 그만큼 벌어져도 최대 ${((vmax + gdt2) * 2 * g.necklineRing.length * 100).toFixed(2)}cm`);
      }
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
      if (frame === 1 || frame === 8) probeReports.push(restMap(`f${frame} 직후`));
      if (probeArmed && probeLog.length > 0) {
        const restM = ringRestConfirmedM;
        const lines: string[] = [`  [31계기·패스별 링 길이] ${probeFrameLabel} · rest ${cm(restM)}cm · 서브스텝 ${probeSub}개`];
        let prev = -1;
        for (let k = 0; k < probeLog.length; k++) {
          const q = probeLog[k];
          const d = k === 0 ? 0 : q.L - probeLog[k - 1].L;
          if (q.sub !== prev) { lines.push(`    ── 서브스텝 ${q.sub}`); prev = q.sub; }
          const dJ = k === 0 ? 0 : q.J - probeLog[k - 1].J;
          lines.push(`      ${q.label.padEnd(34)} 링60 ${cm(q.L).padStart(7)}cm (${(q.L / restM).toFixed(3)}배)  Δ${(d * 100 >= 0 ? "+" : "")}${(d * 100).toFixed(2)}cm │ 접합 ${cm(q.J).padStart(7)}cm  Δ${(dJ * 100 >= 0 ? "+" : "")}${(dJ * 100).toFixed(2)}cm`);
        }
        // 패스별 기여 합계 — 라벨별로 Δ를 모은다.
        const byPass = new Map<string, number>();
        for (let k = 1; k < probeLog.length; k++) {
          const q = probeLog[k];
          byPass.set(q.label, (byPass.get(q.label) ?? 0) + (q.L - probeLog[k - 1].L));
        }
        const totalUp = [...byPass.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
        lines.push(`    [기여 합계] 프레임 순변화 ${((probeLog[probeLog.length - 1].L - probeLog[0].L) * 100).toFixed(2)}cm · 양의 기여 총합 ${(totalUp * 100).toFixed(2)}cm`);
        // 38회차 계기 A — 같은 패스 경계에서 **접합 2엣지**의 기여도 가른다.
        {
          const byPassJ = new Map<string, number>();
          for (let k = 1; k < probeLog.length; k++) byPassJ.set(probeLog[k].label, (byPassJ.get(probeLog[k].label) ?? 0) + (probeLog[k].J - probeLog[k - 1].J));
          lines.push(`    [접합 기여] 프레임 순변화 ${((probeLog[probeLog.length - 1].J - probeLog[0].J) * 100).toFixed(2)}cm · ${[...byPassJ].filter(([, v]) => Math.abs(v) > 1e-6).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([l, v]) => `${l} ${(v * 100 >= 0 ? "+" : "")}${(v * 100).toFixed(2)}cm`).join(" · ")}`);
        }
        for (const [lab, v] of [...byPass].sort((a, b) => b[1] - a[1])) {
          lines.push(`      ${lab.padEnd(34)} ${(v * 100 >= 0 ? "+" : "")}${(v * 100).toFixed(2)}cm ${v > 0 ? `(양의 기여의 ${(100 * v / Math.max(1e-9, totalUp)).toFixed(1)}%)` : ""}`);
        }
        probeReports.push(lines.join("\n"));
        probeArmed = false;
      }
      // ── 링 총 길이 사후 투영(위 설계 문단). 무게중심 기준 등방 축소 1회.
      // 핀 걸린 정점은 못 움직이므로 제외하고, 그만큼 배율을 나머지에 싣는다.
      {
        const L0 = ringLenM();
        if (ringTotalMaxM > 0) shrinkWorkSeries.push(Math.max(0, L0 - ringTotalMaxM));
      }
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
      {
        // 중심 y만으로는 판정이 안 된다 — 목선은 **곡선**이라 배치 시점부터
        // 중심이 목점보다 앞목/뒤목 깊이만큼 아래다. "미끄러졌는가"를 재는 건
        // 링 **최상점**(= 목점·어깨 이음선 쪽)이다. 둘 다 남긴다.
        const idx = [...new Set(ringClosed.flatMap((e) => [e.a, e.b]))];
        let cy = 0, top = -Infinity, bot = Infinity;
        for (const i of idx) {
          const yv = sim.positions[i * 3 + 1];
          cy += yv; if (yv > top) top = yv; if (yv < bot) bot = yv;
        }
        ringYSeries.push({ f: frame, st: state, y: cy / idx.length, top, bot, L: ringLenM() });
      }
      // 배선 검증(항상) — 하드 핀이 좌표를 잡고 있는가. 6회차는 이 값이
      // 목표 6.26cm에서 10.5cm로 밀렸다(잔차 42mm).
      if (state === "S1" && frame % 60 === 0) {
        console.log(
          `  [pin·검증] f=${String(frame).padStart(4)} 목점 실측 |x−center| ${cm(Math.abs(sim.positions[neckAnchor.i * 3] - centerX))}cm vs 목표 ${cm(Math.abs(neckAnchor.x - centerX))}cm · 잔차 ${pinResidualMm().toFixed(2)}mm · pinned=${sim.pinned[neckAnchor.i]} · 앵커강도 ${anchorStrength.toFixed(3)} · **핀 위치램프 s=${anchorRampS.toFixed(3)}**(${anchorRampFrame}/${RAMP_FRAMES})`,
        );
      }
      // (2) 하중 배분 — 정착 구간(마지막 60프레임)만 누적한다.
      if (prevPos) {
        const gdt2 = 9.81 * SUBSTEP_DT * SUBSTEP_DT;
        const rec = { ring: 0, shoulder: 0, hem: 0, other: 0 };
        for (let i = 0; i < total; i++) {
          const held = (sim.positions[i * 3 + 1] - prevPos[i * 3 + 1]) + gdt2;
          if (held <= 0) continue;
          // 순서 ring → shoulder → hem → other. 앞의 셋은 서로소다(링·패턴 상단·패턴 하단).
          if (ringVertexSet.has(i)) rec.ring += held;
          else if (i < g.panelStarts[2] && g.pos2[i * 2 + 1] <= 0.03) rec.shoulder += held;
          else if (hemVertexSet.has(i)) rec.hem += held;
          else rec.other += held;
        }
        holdSeries.push(rec);
      }
      if (!prevPos) prevPos = new Float32Array(total * 3);
      prevPos.set(sim.positions.subarray(0, total * 3));
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
      // 60회차 계기① — **argmax 기록**. 59회차 §2①: 지금까지 max만 쌓고 어느 정점이
      // 그 값을 냈는지 안 남겼다. A 여유가 5.16 vs 문턱 5.6 = **0.44mm**뿐이라,
      // 밑단 정점이 느는 처방에서 ABORT가 나면 "처방 실패"인지 "새 정점이 정착
      // 판정을 인질로 잡음"인지 **구별할 수단이 없다**(함정 1). 대역 라벨은
      // 기존 `bandOf`를 그대로 쓴다 — **새 술어 0 · 새 손 상수 0**(함정 12).
      let md = 0, mi = -1;
      for (let i = 0; i < sim.positions.length; i += 3) {
        const d = Math.hypot(sim.positions[i] - prevFrame[i], sim.positions[i + 1] - prevFrame[i + 1], sim.positions[i + 2] - prevFrame[i + 2]);
        if (d > md) { md = d; mi = i / 3; }
      }
      deltaHist.push(md * 1000);
      deltaArg.push({ f: frame, i: mi });
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
// ── 47회차 부수 계기 — covShoulder **대역 제한 병기**(정의 변경 아님).
// 46회차가 대역이 yMin 113.31 ~ yMax 143.71cm로 **겨드랑이 아래까지 내려온다**는 것을
// 인쇄했다. 화면("back 전부 덮임")과 채널(44.8% 노출)의 불일치가 대역 차이인지 보려면
// **같은 판정식으로 대역만 y124 이상으로 좁힌 수치**가 필요하다. 원 채널은 그대로 둔다.
const covShHi = computeBodyCoverage(
  position, [wholeIndex], gridView, [],
  {
    yMin: Math.max(band.yMin, 1.24), yMax: band.yMax,
    neckCenter, neckRadius: 0.12,
    centerX, centerZ: collision.centerZ,
    outwardAxes: band.axes,
    sampleMask: band.mask,
  },
  // ── 80회차 결함 ② 수리 — **6번째 인자 `clothTris`가 빠져 있었다.**
  // 바로 아래 `covSh` 호출에는 있는데 여기만 없어서 `clothTrisOverride`가
  // undefined → `clothTriangles(sim, [])` → **삼각형 0개** → 전 레이 미스 →
  // **전량 노출**이 됐다. 그것이 로그의 「y124↑ 병기 1038/1038 (100.0%)」다.
  // 46·47·48회차가 그 100%를 「대역마다 표본 재생성」으로 오귀속했고
  // 79회차가 반증했다(1038은 1421의 정상 부분집합이다).
  clothTris,
);
// ── 80회차 결함 ① 수리 **병기 채널**(`nearSign`) — 원 채널은 손대지 않는다.
// 79·80회차: `rayMin 5mm`가 버리는 히트가 전부 실제 옷 히트이고(레이가 쏘는
// `tris`에 몸 메시가 없다) 80 §3이 그 구간 top 95건을 **근접 피복 97.9% /
// 관통 1.1% / 모호 1.1%**로 분해해 사전 등록 문턱 3개를 통과시켰다.
// **구/신을 나란히 낸다** — 병기 없이 교체하면 25~78회차 대조가 끊긴다.
const covShNew = computeBodyCoverage(
  position, [wholeIndex], gridView, [],
  {
    yMin: band.yMin, yMax: band.yMax,
    neckCenter, neckRadius: 0.12,
    centerX, centerZ: collision.centerZ,
    outwardAxes: band.axes,
    sampleMask: band.mask,
    nearSign: true,
  },
  clothTris,
);
const covNew = computeBodyCoverage(
  position, [frontIdx, backIdx], gridView, [],
  { ...covBand, yMin: hemWorldY, nearSign: true },
  clothTris,
);
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
const xsec = countSelfIntersections(sim.positions, g.tris, g.edgePairs, 0.03, 1_000_000);
// ── 46회차 계기 — **자기교차 위치 분해**(총량만 있고 위치가 한 번도 인쇄된 적 없다).
// 관통 귀속과 같은 방식: y 1cm bin · 패널 조합 · **옆선 시접 인접 홉수**.
// 홉수는 `g.edgePairs`(메시 엣지)에서 BFS로 뜬다 — `hopFromRing`과 같은 기계.
{
  const sideVerts = new Set<number>(g.seams.filter((sm) => sm.kind === "side").flatMap((sm) => [sm.a, sm.b]));
  const adj = new Map<number, number[]>();
  for (const e of g.edgePairs) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const hop = new Int32Array(total).fill(-1);
  let q = [...sideVerts];
  for (const v of q) hop[v] = 0;
  for (let d = 1; q.length && d <= 6; d++) {
    const nx: number[] = [];
    for (const v of q) for (const w of adj.get(v) ?? []) if (hop[w] < 0) { hop[w] = d; nx.push(w); }
    q = nx;
  }
  const yBin: Record<string, number> = {};
  const pairKind: Record<string, number> = {};
  const pairY: Record<string, number> = {};   // 65회차 §3 — 패널조합 × y 교차표
  const hopBin: Record<string, number> = {};
  const triVert = (t: number): number => g.tris[t * 3];
  for (const ex of xsec.examples) {
    const [a, b] = ex.edge;
    const c = triVert(ex.tri);
    const yc = Math.round(((sim.positions[a * 3 + 1] + sim.positions[b * 3 + 1]) / 2) * 100);
    yBin[`y${yc}`] = (yBin[`y${yc}`] ?? 0) + 1;
    const k = [PANEL_NAME[panelOfIdx(a)], PANEL_NAME[panelOfIdx(c)]].sort().join("↔");
    pairKind[k] = (pairKind[k] ?? 0) + 1;
    // 65회차 §3 — **패널조합 × y 교차표**. 64 §9: 두 축을 따로 인쇄해 왔기 때문에
    // "겨드랑이의 그 픽셀이 소매↔몸판 자기충돌인가"를 기존 로그로 못 갈랐다.
    // 새 술어 0 · 손 상수 0(위 `k`와 `yBin`이 쓰는 것을 그대로 곱한다).
    {
      const yy = Math.round(sim.positions[a * 3 + 1] * 100);
      const bd = yy >= 130 && yy <= 143 ? "y130~143" : yy >= 124 && yy <= 129 ? "y124~129"
        : yy >= 94 && yy <= 123 ? "y94~123" : yy >= 70 && yy <= 93 ? "y70~93" : "그외";
      pairY[`${k}@${bd}`] = (pairY[`${k}@${bd}`] ?? 0) + 1;
    }
    // 엣지 양 끝점 중 옆선 시접에 더 가까운 홉수로 귀속(미도달은 ">6").
    const h = Math.min(hop[a] < 0 ? 99 : hop[a], hop[b] < 0 ? 99 : hop[b]);
    const lab = h >= 99 ? ">6홉" : `${h}홉`;
    hopBin[lab] = (hopBin[lab] ?? 0) + 1;
  }
  const total3 = xsec.examples.length;
  const top = (o: Record<string, number>, n: number): string =>
    Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k}:${v}(${(100 * v / Math.max(1, total3)).toFixed(1)}%)`).join(" ");
  console.log(`  [46계기·자기교차 위치] 총 ${xsec.count}건(t=0 ${xs0Count}건 → **전량 런타임 발생**) · 분해 표본 ${total3}건`);
  console.log(`    패널 조합: ${top(pairKind, 8)}`);
  console.log(`    **패널조합 × y 교차표**(65회차 신설): ${top(pairY, 12)}`);
  {
    // 겨드랑이 후보 ②를 **직접** 세는 유일한 채널 — 소매가 낀 조합만 y대역별로 뽑는다.
    const sl = Object.entries(pairY).filter(([kk]) => kk.includes("소매")).sort((x, y) => y[1] - x[1]);
    const slTot = sl.reduce((a, [, v]) => a + v, 0);
    console.log(`    **소매 관여 자기교차 ${slTot}건**: ${sl.length ? sl.map(([kk, v]) => `${kk} ${v}`).join(" / ") : "없음"}`);
  }
  console.log(`    옆선 시접 인접(홉): ${top(hopBin, 8)}`);
  console.log(`    y 1cm bin 상위 12: ${top(yBin, 12)}`);
  {
    const band = (lo: number, hi: number): number =>
      Object.entries(yBin).filter(([k]) => { const y = Number(k.slice(1)); return y >= lo && y <= hi; }).reduce((a, [, v]) => a + v, 0);
    console.log(`    대역 합산: y70~83 ${band(70, 83)} · y84~93 ${band(84, 93)} · y94~123 ${band(94, 123)} · y124~129 ${band(124, 129)} · **y130~143 ${band(130, 143)}** · 그 외 ${total3 - band(70, 143)}`);
  }
  console.log(`    [대역 정의] covShoulder 측정 대역 = yMin ${cm(band.yMin)} ~ yMax ${cm(band.yMax)}cm · 목중심 반경 12.0cm 제외 · 축 ${band.axes.length}종 · 마스크 ${band.mask ? "있음" : "없음"} — **몸 표면 샘플에서 바깥 법선 레이가 옷을 맞히는가**를 센다(옷 정점 집합이 아니다)`);
}
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
// 55회차 계기 정정 — 버킷 분모가 **정식 채널과 달랐다**(합 5439 vs 1728).
// `cov`는 팔 마스크가 없는 집합이고 정식 채널은 `covArmless`다 → **같은 집합으로 맞춘다**.
// 구 정의(팔 포함) 버킷은 이력 대조용으로 별도 라벨에 병기한다(함정 13 — 이름·대상 일치).
console.log(`  cov 몸통 버킷(**정식·팔 제외** — 분모 합 = ${covArmless.samples}): ${JSON.stringify(Object.fromEntries(Object.entries(covArmless.buckets).map(([k, b]) => [k, `${b.exposed}/${b.samples}`])))}`);
console.log(`  cov 버킷(구 정의·팔 포함 · 이력 대조용 · 분모 합 = ${cov.samples}): ${JSON.stringify(Object.fromEntries(Object.entries(cov.buckets).map(([k, b]) => [k, `${b.exposed}/${b.samples}`])))}`);
console.log(`  covShoulder: 노출 ${covSh.exposed}/${covSh.samples} (${(covSh.exposedRatio * 100).toFixed(1)}%)`);
console.log(`  covShoulder(**병기 · 대역 y124↑ 제한** · 정의 변경 아님): 노출 ${covShHi.exposed}/${covShHi.samples} (${(covShHi.exposedRatio * 100).toFixed(1)}%) — 원 채널 대역은 y${cm(band.yMin)}~${cm(band.yMax)}cm · **80회차 결함② 수리 후 값**(그 전에는 clothTris 인자 누락으로 항상 100.0%였다)`);
console.log(`  **[80회차 병기 · 결함① 수리]** covShoulder_old ${covSh.exposed}/${covSh.samples} (${(covSh.exposedRatio * 100).toFixed(1)}%) → **covShoulder_new(nearSign) ${covShNew.exposed}/${covShNew.samples} (${(covShNew.exposedRatio * 100).toFixed(1)}%)** · cov_old ${cov.exposed}/${cov.samples} (${(cov.exposedRatio * 100).toFixed(1)}%) → **cov_new ${covNew.exposed}/${covNew.samples} (${(covNew.exposedRatio * 100).toFixed(1)}%)** — 원 채널은 손대지 않았다(25~78회차 대조 보존)`);
console.log(`    버킷 old→new: ${Object.keys(covSh.buckets).sort().map((k) => `${k} ${covSh.buckets[k].exposed}→${covShNew.buckets[k]?.exposed ?? "-"}/${covSh.buckets[k].samples}`).join(" · ")}`);
{
  // ── 81회차 §1 — `covSh.exposedExamples`가 계산만 되고 인쇄되지 않았다(감사 §6).
  // 이 출력이 없으면 §2 재계산·79회차 좌표 분포가 **하네스 로그로 검증되지 않는다**.
  // `cov` 히스토그램과 **섞지 않는다** — 분모(1421 vs 5439) · 참조축(팔축 vs 몸통축) ·
  // 정의역(대역 y113~144 · 목 12cm 제외)이 다르다(함정 13).
  const dist = (pts: { x: number; y: number; z: number }[]): string => {
    const yb = new Map<number, number>(), xb = new Map<number, number>();
    let front = 0;
    for (const p of pts) {
      const y = Math.floor(p.y * 20) / 20; // 5cm 빈
      yb.set(y, (yb.get(y) ?? 0) + 1);
      const ax = Math.floor(Math.abs(p.x - centerX) * 20) / 20;
      xb.set(ax, (xb.get(ax) ?? 0) + 1);
      if (p.z >= collision.centerZ) front++;
    }
    const fmt = (m: Map<number, number>): string =>
      [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${(k * 100).toFixed(0)}:${v}`).join(" ");
    return `앞${front}/뒤${pts.length - front} · y빈(5cm) ${fmt(yb)} · |x|빈(5cm) ${fmt(xb)}`;
  };
  console.log(`    covSh 노출 좌표 old(${covSh.exposedExamples.length}): ${dist(covSh.exposedExamples)}`);
  console.log(`    covSh 노출 좌표 new(${covShNew.exposedExamples.length}): ${dist(covShNew.exposedExamples)}`);
  // §4 추가 검증점 — 마젠타 캡처의 삼각근 2패치 영역(y128~134 · |x|16~19 · 후면)에
  // 잔여 노출이 공간적으로 대응하는가. **등재만 · 판정 아님.**
  const patch = (pts: { x: number; y: number; z: number }[]): number =>
    pts.filter((p) => p.y >= 1.28 && p.y <= 1.34 && Math.abs(p.x - centerX) >= 0.16 && Math.abs(p.x - centerX) <= 0.19 && p.z < collision.centerZ).length;
  console.log(`    [§4 검증점] 삼각근 패치창(y128~134 · |x|16~19 · 뒤) 노출 old ${patch(covSh.exposedExamples)} · new ${patch(covShNew.exposedExamples)}`);
}
console.log(`  covShoulder 버킷: ${JSON.stringify(Object.fromEntries(Object.entries(covSh.buckets).map(([k, b]) => [k, `${b.exposed}/${b.samples}`])))}`);
console.log(`  shoulderHover top-front: hit ${tf.hit.toFixed(3)} / hover ${tf.mean.toFixed(2)}|${tf.max.toFixed(2)}mm`);
console.log(`  shoulderHover top-back : hit ${tb.hit.toFixed(3)} / hover ${tb.mean.toFixed(2)}|${tb.max.toFixed(2)}mm`);
console.log(`  maxStrain ${strain.v.toFixed(3)} (정점 ${strain.at}) · maxSeamGap ${(maxSeamGapM() * 1000).toFixed(2)}mm · Δ20 ${maxDelta20Mm().toFixed(2)}mm`);
// 60회차 계기① — Δ20을 **누가** 냈는가. 판정에 쓰이는 창(마지막 20프레임)만 본다.
{
  const w = deltaHist.length - Math.min(20, deltaHist.length);
  const win = deltaHist.slice(w).map((v, k) => ({ v, ...deltaArg[w + k] }));
  if (win.length === 0) console.log(`  [60계기①·Δ20 argmax] 산출 불가 — 프레임 0`);
  else {
    const top = win.reduce((a, b) => (b.v > a.v ? b : a));
    // 창 안에서 어느 대역이 몇 번 최댓값을 잡았나 — 1프레임 우연과 상시 인질을 가른다.
    const freq = new Map<string, number>();
    for (const r of win) { const b = r.i < 0 ? "미정" : bandOf(r.i, r.i); freq.set(b, (freq.get(b) ?? 0) + 1); }
    const rank = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `  [60계기①·Δ20 argmax] 창 ${win.length}프레임 · **최대 ${top.v.toFixed(2)}mm @f${top.f} 정점 ${top.i}` +
      ` = ${top.i < 0 ? "미정" : bandOf(top.i, top.i)}** (패널 ${top.i < 0 ? "-" : PANEL_NAME[panelOfIdx(top.i)]}` +
      `${top.i < 0 ? "" : ` · pos2.y ${cm(g.pos2[top.i * 2 + 1])}cm`}) · 창 내 대역 점유 ${rank.map(([b, n]) => `${b} ${n}`).join(" / ")}`,
    );
  }
}
// ── 38계기 A: 정착 시점 접합 실거리(시계열의 마지막 행).
{
  const rows = ringJoinPairs.map((sm, k) => {
    const d = Math.hypot(
      sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
      sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
      sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
    );
    const r = joinConstraints[k]?.restLength ?? NaN;
    return `#${sm.a}↔#${sm.b} 실거리 ${cm(d)} rest ${cm(r)} (rest−실) ${((r - d) * 100 >= 0 ? "+" : "")}${((r - d) * 100).toFixed(2)}cm ${r > d ? "**압축→밀어냄**" : "신장→당김"}`;
  });
  console.log(`  [38계기A·접합 실거리] 정착 링60 ${cm(ringLenM())}cm · 접합합 실거리 ${cm(joinLenM())}cm rest ${cm(joinDistRestSumM())}cm · ${rows.join(" · ")}`);
  console.log(`    폐곡선(링60+접합) 실측 ${cm(ringLenM() + joinLenM())}cm · 폐곡선 rest(거리 제약 기준) ${cm(ringRestConfirmedM + joinDistRestSumM())}cm`);
  // ── 56회차 **0-처방 판별자**(사전 반증 2) — **프레임 끝** 링 per-edge 신장비 분포.
  // ⓒ("집행이 늦어서 안 잡힌다")와 반증 2("한 스윕이 닫힌 사슬에서 길이를 제거 못 하고
  // 이웃으로 재분배한다")를 가른다. 발화 카운트는 **방문 시점** 값이라 프레임 끝 위반을
  // 재지 못한다(함정 1). 여기서는 정착 시점에 **실제로 상한을 넘고 있는 엣지 수**를 센다.
  {
    const lim = COLLAR_STRAIN_LIMIT;
    const rs = ringClosed.map((e) => {
      const c = [...sim.constraintPairs].find((q) => (q.a === e.a && q.b === e.b) || (q.a === e.b && q.b === e.a));
      const d = Math.hypot(
        sim.positions[e.b * 3] - sim.positions[e.a * 3],
        sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1],
        sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2],
      );
      return c && c.restLength > 0 ? d / c.restLength : NaN;
    }).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const over = rs.filter((v) => v > lim).length;
    const q = (f: number): string => rs[Math.min(rs.length - 1, Math.floor(f * rs.length))].toFixed(3);
    console.log(
      `  [56판별자·프레임 끝 링 per-edge 신장비] 정착 · 상한 ${lim} · n=${rs.length}` +
      ` · 중앙 ${q(0.5)} p99 ${q(0.99)} 최대 ${rs[rs.length - 1].toFixed(3)} 최소 ${rs[0].toFixed(3)}` +
      ` · **상한 초과 ${over}/${rs.length}(${(100 * over / rs.length).toFixed(1)}%)**` +
      ` — 초과가 0에 가까우면 "집행 위상"(ⓒ), 대부분이면 **"한 스윕이 재분배만 한다"(반증 2)**`,
    );
  }
  console.log(ringShapeReport("정착"));
  console.log(capsuleCountReport("정착"));
  console.log(hemReport("정착"));
  console.log(hemRenderReport("정착"));
  console.log(betaReport("정착"));
  // ── 51회차 진단(처방 아님 · 공유 파일 0줄) — 링·밑단 정점의 **최근접 몸 면 법선 n·ŷ**.
  // C1 술어("위를 보는 면에서만 자석분 유지")가 어느 대역을 켜고 끄는지 실측한다.
  // faceNormal은 private이지만 두 public 메서드의 **차**로 복원된다:
  //   n = closestSurfacePoint(p, margin=1, r) − closestPointUnsigned(p, r)
  // (bvhFromArrays.ts:99-111 vs :121-128). `bvhFromArrays.ts` 무수정 → 12콤보 불요.
  {
    // 52회차 정정 — **리졸버가 보는 메시로 잰다.** 51회차 1차 구현은 `wholeMesh`(전신·팔 포함)를
    // 썼는데 자석을 만드는 리졸버는 `frontMesh`/`backMesh`(torso-only · z중점 반쪽 시트)에
    // 질의한다(`:577-578, 592-593`). 삼각형 집합이 다르면 **선택되는 최근접 면이 다르다** —
    // 밑단 앞 n·ŷ 최소 −0.976(거의 정하방)이 전신 메시의 아랫면을 잡은 신호였다.
    const nyOf = (i: number): number | null => {
      const x = sim.positions[i * 3], y = sim.positions[i * 3 + 1], z = sim.positions[i * 3 + 2];
      const m = i < g.panelStarts[1] ? frontMesh : backMesh;
      const sp = m.closestSurfacePoint(x, y, z, 1, SDF_FAR);
      const cp = m.closestPointUnsigned(x, y, z, SDF_FAR);
      if (!sp || !cp) return null;
      return sp.y - cp.y; // margin=1 이므로 차 = 면 법선(단위) 그대로
    };
    const stat = (nm: string, idx: number[]): string => {
      const v = idx.map(nyOf).filter((q): q is number => q !== null).sort((a, b) => a - b);
      if (v.length === 0) return `    ${nm} — 산출 불가(표본 0)`;
      const on = v.filter((q) => q > 0).length;
      // 도출 문턱(마찰각): μs 0.6 → tanθ=0.6 → cosθ = 1/√(1+0.6²) = 0.857
      const MU_THRESH = 1 / Math.sqrt(1 + FRICTION_MU_STATIC * FRICTION_MU_STATIC);
      const onT = v.filter((q) => q >= MU_THRESH).length;
      return `    ${nm} n=${v.length} · n·ŷ 중앙 ${v[Math.floor(v.length / 2)].toFixed(3)} 최소 ${v[0].toFixed(3)} 최대 ${v[v.length - 1].toFixed(3)}` +
        ` · **n·ŷ>0 ${on}/${v.length}(${(100 * on / v.length).toFixed(1)}%)** · n·ŷ≥${MU_THRESH.toFixed(3)}(마찰각 도출) ${onT}/${v.length}(${(100 * onT / v.length).toFixed(1)}%)`;
    };
    const fr = ringOrder.filter((i) => i < g.panelStarts[1]), bk = ringOrder.filter((i) => i >= g.panelStarts[1]);
    console.log(`  [51진단·최근접 면 n·ŷ] 정착 · **52회차 정정: 리졸버 메시(frontMesh/backMesh)로 측정** · 처방 미구현·진단만`);
    console.log(stat("링 앞판", fr));
    console.log(stat("링 뒤판", bk));
    console.log(stat("밑단 앞판", hemChain.front));
    console.log(stat("밑단 뒤판", hemChain.back));
    const ys = ringOrder.map((i) => sim.positions[i * 3 + 1]).sort((a, b) => a - b);
    console.log(`    [창 여유] 정착 링 y ${cm(ys[0])}~${cm(ys[ys.length - 1])}cm — 사전 반증 (d)의 "켜짐 창 뒤 y133~146 · 앞 y137~145"와 대조`);

    // ── 53회차 (c) — **SDF 기울기 n·ŷ**를 BVH 면 법선과 나란히. D2의 (c)(d) 전체가 여기 달렸다.
    // 필드는 마찰용으로 **이미 굽고 있다**(`sdfField`) → 추가 굽기 0.
    const gv = { x: 0, y: 0, z: 0 };
    const sdfNyOf = (i: number): number | null =>
      sdfNormal(sdfField, sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], gv) ? gv.y : null;
    const sdfStat = (nm: string, idx: number[]): string => {
      const v = idx.map(sdfNyOf).filter((q): q is number => q !== null).sort((a, b) => a - b);
      if (v.length === 0) return `    ${nm} — 산출 불가(SDF 표본 0)`;
      const on = v.filter((q) => q > 0).length;
      return `    ${nm} n=${v.length} · **SDF ∇d·ŷ** 중앙 ${v[Math.floor(v.length / 2)].toFixed(3)} 최소 ${v[0].toFixed(3)} 최대 ${v[v.length - 1].toFixed(3)} · >0 ${on}/${v.length}(${(100 * on / v.length).toFixed(1)}%)`;
    };
    console.log(`  [53계기c·SDF 기울기 n·ŷ] 정착 · 위 BVH 면 법선과 **같은 정점 집합**에서`);
    console.log(sdfStat("링 앞판", fr)); console.log(sdfStat("링 뒤판", bk));
    console.log(sdfStat("밑단 앞판", hemChain.front)); console.log(sdfStat("밑단 뒤판", hemChain.back));

    // ── 53회차 (b) — **대역별 몸거리 d의 분위수 + 국면 비율**. D0의 유일한 판별자.
    // d는 리졸버가 보는 메시의 부호거리(`signedClearance`). 국면 경계는 COLLISION_MARGIN 자체다.
    const dOf = (i: number): number | null => {
      const m = i < g.panelStarts[1] ? frontMesh : backMesh;
      return m.signedClearance(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR);
    };
    const phaseStat = (nm: string, idx: number[]): string => {
      const v = idx.map(dOf).filter((q): q is number => q !== null).sort((a, b) => a - b);
      if (v.length === 0) return `    ${nm} — 산출 불가`;
      const q = (f: number): string => (v[Math.min(v.length - 1, Math.floor(f * v.length))] * 1000).toFixed(1);
      const p1 = v.filter((x) => x > COLLISION_MARGIN).length;
      const p2 = v.filter((x) => x > 0 && x <= COLLISION_MARGIN).length;
      const p3 = v.filter((x) => x <= 0).length;
      return `    ${nm} n=${v.length} · d(mm) p25 ${q(0.25)} 중앙 ${q(0.5)} p75 ${q(0.75)} p99 ${q(0.99)}` +
        ` · **국면1(자석 d>15) ${p1}(${(100 * p1 / v.length).toFixed(1)}%) · 국면2(안착 0<d≤15) ${p2}(${(100 * p2 / v.length).toFixed(1)}%) · 국면3(관통 d≤0) ${p3}(${(100 * p3 / v.length).toFixed(1)}%)**`;
    };
    console.log(`  [53계기b·몸거리 d 분위수·국면] 정착 · 경계 = COLLISION_MARGIN ${(COLLISION_MARGIN * 1000).toFixed(1)}mm`);
    console.log(phaseStat("링 앞판", fr)); console.log(phaseStat("링 뒤판", bk));
    console.log(phaseStat("밑단 앞판", hemChain.front)); console.log(phaseStat("밑단 뒤판", hemChain.back));
    {
      const mid: number[] = [];
      for (let i = g.panelStarts[1]; i < g.panelStarts[2]; i++) {
        const y = sim.positions[i * 3 + 1];
        if (y >= 1.10 && y <= 1.25) mid.push(i);
      }
      console.log(phaseStat("뒤판 중배부(y110~125)", mid));
      console.log(sdfStat("뒤판 중배부(y110~125)", mid));
      console.log(stat("뒤판 중배부(y110~125)", mid));
    }
  }
  // ── 53회차 §3 — 5회차 이월분 2건.
  {
    // ① 자기교차 **홉 재집계**(46계기 분해 재사용 · y bin 대신 밑단/옆선 홉으로 귀속)
    const hb: Record<string, number> = {};
    for (const ex of xsec.examples) {
      const [a, b] = ex.edge;
      const hh = Math.min(hopFromHem.hem[a] < 0 ? 99 : hopFromHem.hem[a], hopFromHem.hem[b] < 0 ? 99 : hopFromHem.hem[b]);
      const sh = Math.min(hopFromHem.side[a] < 0 ? 99 : hopFromHem.side[a], hopFromHem.side[b] < 0 ? 99 : hopFromHem.side[b]);
      const k = hh <= 4 ? `밑단${hh}홉` : sh <= 4 ? `옆선${sh}홉` : "그 외";
      hb[k] = (hb[k] ?? 0) + 1;
    }
    const tot = xsec.examples.length;
    console.log(`  [53계기·자기교차 홉 귀속] 총 ${tot}건 · ${Object.entries(hb).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}(${(100 * v / Math.max(1, tot)).toFixed(1)}%)`).join(" ")}`);
    // ② sliceOutline 유효성 — 밑단 높이의 몸 단면이 닫힌 곡선인가(28회차 "가랑이 대역" 확인)
    const hemY0 = hemChain.front.reduce((a, i) => a + sim.positions[i * 3 + 1], 0) / Math.max(1, hemChain.front.length);
    const sl = body.slices.reduce((m, s) => (Math.abs(s.y - hemY0) < Math.abs(m.y - hemY0) ? s : m), body.slices[0]);
    console.log(`  [53계기·sliceOutline 유효성] 밑단 평균 y ${cm(hemY0)}cm · 최근접 슬라이스 y ${cm(sl.y)}cm · 둘레 ${cm(sl.girthM)}cm · 폭 ${cm(sl.widthM)} 깊이 ${cm(sl.depthM)} · bins ${sl.bins} — **28회차 등재(y76.11은 두 다리로 갈라져 대역 밖 16.85cm)와 대조**`);
  }
  // 49회차 — **정착 시점 rest 정합 지도**(48회차 미이행 · f8 값을 정착으로 인용하던 금지 해소).
  console.log(restMap("**정착**(49회차 신설 — 이전까지 f0/f1/f8뿐이었다)"));
  console.log(`  [54·처방 상태] D0(국면1 자석 차단) ${MAGNET_D0 ? "**on**(MAGNET_D0=1)" : MAGNET_AXIS1 ? "off · 축① w≡1(무변화)" : "**off**(기본)"} · 흡착 ${ADSORB_PENONLY ? "**관통-only**(ADSORB_PENONLY=1 · 진단 전용)" : "**양방향**(기본)"} · 몸통 캡슐 ${TORSOCAP ? "**on**(TORSOCAP=1 · 43회차 처방 A 복원)" : "**OFF**(기본 — 45회차 승격 기준선)"} · **마찰 SDF 부호 ${SKELSIGN ? "골격(SKELSIGN=1 · 62회차 처방 S3)" : "라디얼(기본)"}** · 밑단 굽힘 ${HEMBEND ? `**H3 대조군 on**(HEMBEND=1 · 대역 ${HEMBEND_BAND_M*100}cm · raw ${HEMBEND_RAW} = 기본 ${STIFFNESS_BEND}의 ${(HEMBEND_RAW/STIFFNESS_BEND).toFixed(0)}배 · **진단 탐침 · 처방 아님 · 승격 금지**)` : "**off**(기본)"}`);
}
// ── 35계기 6번: maxSeamGap의 **공간 분포**. 어느 종류·어느 자리가 벌어졌는가.
{
  const rows = g.seams.map((sm) => ({
    kind: sm.kind, a: sm.a, b: sm.b, target: sm.targetM,
    d: Math.hypot(
      sim.positions[sm.b * 3] - sim.positions[sm.a * 3],
      sim.positions[sm.b * 3 + 1] - sim.positions[sm.a * 3 + 1],
      sim.positions[sm.b * 3 + 2] - sim.positions[sm.a * 3 + 2],
    ),
  })).sort((x, y) => y.d - x.d);
  const byKind = new Map<string, { n: number; max: number; sum: number }>();
  for (const r of rows) {
    const t = byKind.get(r.kind) ?? { n: 0, max: 0, sum: 0 };
    t.n++; t.sum += r.d; if (r.d > t.max) t.max = r.d;
    byKind.set(r.kind, t);
  }
  console.log(`  [35계기·시접 갭 분포] 종류별 최대|평균(mm): ${[...byKind].map(([k, t]) => `${k} ${(t.max * 1000).toFixed(2)}|${(t.sum / t.n * 1000).toFixed(2)}(n=${t.n})`).join(" · ")}`);
  console.log(`    상위 10쌍 (갭mm · target mm · 패턴좌표 · 3D):`);
  for (const r of rows.slice(0, 10)) {
    console.log(
      `      ${(r.d * 1000).toFixed(2)}mm ${r.kind.padEnd(11)} target ${(r.target * 1000).toFixed(1)}mm · 패턴 a(${cm(g.pos2[r.a * 2])},${cm(g.pos2[r.a * 2 + 1])}) b(${cm(g.pos2[r.b * 2])},${cm(g.pos2[r.b * 2 + 1])}) · 3D a(${cm(sim.positions[r.a * 3])},${cm(sim.positions[r.a * 3 + 1])},${cm(sim.positions[r.a * 3 + 2])})`,
    );
  }
}
// ── 35계기 3번: 흡착 파라미터를 **코드에서** 인쇄한다(문서 인용 금지 — 함정 13).
console.log(`  [35계기·흡착 파라미터] margin ${(COLLISION_MARGIN * 1000).toFixed(1)}mm(clothConfig · 근거="옷감 두께 근사치" **정성적**) · 탐지반경 ${(COLLISION_DETECTION_RADIUS * 1000).toFixed(1)}mm(근거=관통 파티클 구조 여유 **정성적·수치 도출 없음**) · under-relaxation 0.4(bvhFromArrays PUSH_RELAXATION · 근거=탐지반경 15cm에서 shrink-wrap **실측**) · 검사 주기 ${COLLISION_EVERY}반복마다`);
console.log(`    표적 선택 = BVH closestPointToPoint(**최근접 삼각형**) → 목표 = hit.point + 그 삼각형 **면 법선** × margin. 법선 방향 제한 **없음**.`);
console.log(`    penetrationAxis ${ADSORB_PENONLY ? "**전달됨(ADSORB_PENONLY=1)** → **관통-only**(표면 밖 정점은 안 건드린다)" : "**미전달** → 관통-only 아님 = **양방향 흡착**"}${ADSORB_PENONLY ? "" : "(탐지반경 안이면 관통 여부 무관하게 항상 표면+margin으로 40%씩 끌어당김)"}. 대상 = 앞/뒤판만(소매는 null 리졸버 + 팔 캡슐).`);
console.log(
  `  proximityPairs(기록 채널 · 문턱 ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm · 게이트 아님 — 뭉친 폴드의 정상 접촉을 센다): ${prox}쌍`,
);
// 46회차 라벨 정정 — "t=0 기준선 3건"은 **정적 문구**였고 실측과 어긋난다(이번 실행 t=0 0건).
// 실측값을 그대로 인쇄한다(함정 13 — 문서 숫자를 코드 확인 없이 승격하지 않는다).
console.log(`  자기교차(엣지-삼각형 · 게이트): ${xsec.count}건 (배치 t=0 **실측 ${xs0Count}건** → 정착분 전량 런타임 발생)`);
{
  const tail = <T,>(a: T[]): T[] => a.slice(Math.max(0, a.length - 60));
  const sw = tail(shrinkWorkSeries);
  const swMean = sw.reduce((a, b) => a + b, 0) / Math.max(1, sw.length);
  const hb = tail(holdSeries).reduce((a, r) => ({ ring: a.ring + r.ring, shoulder: a.shoulder + r.shoulder, hem: a.hem + r.hem, other: a.other + r.other }), { ring: 0, shoulder: 0, hem: 0, other: 0 });
  const tot = hb.ring + hb.shoulder + hb.hem + hb.other || 1;
  const ringN = ringVertexSet.size;
  let shoulderN = 0;
  for (let i = 0; i < g.panelStarts[2]; i++) if (!ringVertexSet.has(i) && g.pos2[i * 2 + 1] <= 0.03) shoulderN++;
  let hemN = 0;
  for (const i of hemVertexSet) if (!ringVertexSet.has(i) && !(i < g.panelStarts[2] && g.pos2[i * 2 + 1] <= 0.03)) hemN++;
  for (const rep of probeReports) console.log(rep);

  // ── 30계기 B: 목선 대역 제약 잔차. `limitStrain`이 집행하는 상한은
  //    clothPhysics 안의 **maxStretch = 1.2**이고 `clampInSubstep: true`로
  //    매 서브스텝 호출된다(2패스). 잔차 = 그 상한을 넘어 남은 길이.
  //    크면 "못 지킨다"(수렴 부족), 0에 가까우면 "제약이 그 값을 허용한다".
  {
    const ENFORCED = 1.2; // clothPhysics.limitStrain의 하드코딩 상한
    // 목선 대역 = 몸판 정점 중 패턴 y가 앞목 깊이 이내(도출: 목선 곡선이
    // 차지하는 세로 대역). 상수 신설 없음.
    const bandY = g.draft.dims.frontNeckDropM;
    const inBand = (i: number): boolean => i < g.panelStarts[2] && g.pos2[i * 2 + 1] <= bandY;
    const rows: { ratio: number; overMm: number; a: number; b: number; pinned: boolean }[] = [];
    let allMax = 0, allMaxAt = -1;
    for (const c of sim.constraintPairs) {
      if (c.restLength <= 0) continue;
      const dd = Math.hypot(
        sim.positions[c.b * 3] - sim.positions[c.a * 3],
        sim.positions[c.b * 3 + 1] - sim.positions[c.a * 3 + 1],
        sim.positions[c.b * 3 + 2] - sim.positions[c.a * 3 + 2],
      );
      const ratio = dd / c.restLength;
      if (ratio > allMax) { allMax = ratio; allMaxAt = c.a; }
      if (!inBand(c.a) || !inBand(c.b)) continue;
      rows.push({ ratio, overMm: Math.max(0, dd - c.restLength * ENFORCED) * 1000, a: c.a, b: c.b, pinned: !!(sim.pinned[c.a] && sim.pinned[c.b]) });
    }
    rows.sort((x, y) => x.ratio - y.ratio);
    const q = (f: number): { ratio: number; overMm: number } => rows[Math.min(rows.length - 1, Math.floor(f * rows.length))] ?? { ratio: 0, overMm: 0 };
    const worst = rows[rows.length - 1];
    const over = rows.filter((x) => x.overMm > 1e-6).length;
    const pinnedExempt = rows.filter((x) => x.pinned).length;
    console.log(`  [30계기·목선 대역 잔차] 집행 상한 **${ENFORCED}**(clothPhysics.limitStrain 하드코딩 · clampInSubstep=true 2패스) · 대역 = 몸판 패턴 y ≤ 앞목 ${cm(bandY)}cm · 제약 ${rows.length}개(양끝 핀 면제 ${pinnedExempt})`);
    console.log(`    신장비 중앙값 ${q(0.5).ratio.toFixed(3)} · p99 ${q(0.99).ratio.toFixed(3)} · 최대 ${worst ? worst.ratio.toFixed(3) : "-"}@정점${worst?.a}(패턴 ${worst ? cm(g.pos2[worst.a * 2]) : "-"},${worst ? cm(g.pos2[worst.a * 2 + 1]) : "-"})`);
    console.log(`    상한 초과 잔차 — 위반 ${over}/${rows.length}개 · 중앙값 ${q(0.5).overMm.toFixed(2)}mm · p99 ${q(0.99).overMm.toFixed(2)}mm · 최대 ${worst ? worst.overMm.toFixed(2) : "-"}mm`);
    console.log(`    전 메시 최대 신장비 ${allMax.toFixed(3)}@정점${allMaxAt} — **집행 상한 ${ENFORCED}의 ${(allMax / ENFORCED).toFixed(1)}배**`);
  }

  // ── 30계기 A: 링 길이 단계별 분해.  // ── 30계기 A: 링 길이 단계별 분해. 신장이 (i)배치 (ii)봉합 (iii)정착 중
  //    어디서 생겼는지 가른다. 배율 기준은 **확정 rest 48.24cm**(29회차).
  {
    const restM = ringRestConfirmedM;
    const r = (L: number): string => `${cm(L)}cm(${(L / restM).toFixed(3)}배)`;
    const byState = new Map<string, { first: number; last: number; max: number; maxF: number; n: number }>();
    for (const q of ringYSeries) {
      const e = byState.get(q.st) ?? { first: q.L, last: q.L, max: -1, maxF: -1, n: 0 };
      e.last = q.L; e.n++;
      if (q.L > e.max) { e.max = q.L; e.maxF = q.f; }
      byState.set(q.st, e);
    }
    console.log(`  [30계기·링 길이 단계 분해] rest(확정) ${cm(restM)}cm · 배치 t=0 ${r(ringPlacedM)}`);
    for (const [st, e] of byState) {
      console.log(`    ${st.padEnd(3)} 진입 ${r(e.first)} → 이탈 ${r(e.last)} · 구간 최대 ${r(e.max)}@f${e.maxF} · ${e.n}프레임`);
    }
    console.log(`    초반 정밀: ${ringYSeries.slice(0, 8).map((q) => `f${q.f} ${r(q.L)}`).join(" · ")}`);
    const gmax = ringYSeries.reduce((b, q) => (q.L > b.L ? q : b), ringYSeries[0]);
    console.log(`    전 구간 최대 ${r(gmax.L)} @f${gmax.f}/${gmax.st} · 최종 ${r(ringYSeries[ringYSeries.length - 1].L)} · 봉합 완료 f=${seamClosedAtFrame}`);
  }

  // ── 29계기: 링 y 시계열.  // ── 29계기: 링 y 시계열. 지지 실패(내려감)와 인장(제자리에서 벌어짐)의 분리.
  {
    const ridgeTopY = Math.max(...body.ridge.map((r) => r.topY));
    const step = Math.max(1, Math.round(ringYSeries.length / 12));
    const line = ringYSeries.filter((_, i) => i % step === 0 || i === ringYSeries.length - 1)
      .map((r) => `f${r.f}/${r.st} 정${cm(r.top)}/중${cm(r.y)} L${cm(r.L)}`).join(" · ");
    const y0 = ringYSeries[0]?.y ?? 0, yN = ringYSeries[ringYSeries.length - 1]?.y ?? 0;
    const t0 = ringYSeries[0]?.top ?? 0, tN = ringYSeries[ringYSeries.length - 1]?.top ?? 0;
    const yMin = Math.min(...ringYSeries.map((r) => r.y));
    console.log(`  [29계기·링 y 시계열] 기준선 — 목밑점 y ${cm(body.neckBaseY)} · 어깨 능선 최상단 y ${cm(ridgeTopY)} · 어깨 관절 y ${cm(body.shoulderJointY)}`);
    console.log(`    ${line}`);
    console.log(`    [최상점] 시작 ${cm(t0)} → 최종 ${cm(tN)} (낙차 ${cm(t0 - tN)}cm) · 목밑점 대비 ${cm(tN - body.neckBaseY)}cm · 능선 최상단 대비 ${cm(tN - ridgeTopY)}cm · 어깨관절 대비 ${cm(tN - body.shoulderJointY)}cm`);
    console.log(`    [중심]   시작 ${cm(y0)} → 최종 ${cm(yN)} (낙차 ${cm(y0 - yN)}cm) · 최저 ${cm(yMin)} — 목선이 곡선이라 중심은 배치 시점부터 목점보다 앞목/뒤목 깊이만큼 아래다(제도 앞목 ${cm(g.draft.dims.frontNeckDropM)} 뒤목 ${cm(g.draft.dims.backNeckDropM)})`);
    console.log(`  [29계기·자유 평형 대조] 링 최종 길이 ${cm(ringLenM())}cm · 상한 ${ringTotalMaxM > 0 ? cm(ringTotalMaxM) + "cm" : "없음(RINGTOTAL=0)"} · **어깨 통과 둘레 ${cm(body.shoulderPassGirthM)}cm @ y${cm(body.shoulderJointY)} 단면**(2a 통과 조건의 그 값) · 링/어깨통과 ${(ringLenM() / body.shoulderPassGirthM).toFixed(3)}배`);
  }
  console.log(`  [27계기·축소 잔여 일량] 정착 60프레임 평균 ${(swMean * 100).toFixed(3)}cm · 최대 ${(Math.max(0, ...sw) * 100).toFixed(3)}cm · 전 구간 최대 ${(Math.max(0, ...shrinkWorkSeries) * 100).toFixed(2)}cm`);
  console.log(`  [27계기·하중 배분] 정착 60프레임 받쳐진 양 — 링 ${(100 * hb.ring / tot).toFixed(1)}%(정점 ${ringN}) · 어깨대역 ${(100 * hb.shoulder / tot).toFixed(1)}%(정점 ${shoulderN}) · **밑단 ${(100 * hb.hem / tot).toFixed(1)}%(정점 ${hemN})** · 나머지 ${(100 * hb.other / tot).toFixed(1)}%(정점 ${total - ringN - shoulderN - hemN}) · **중량 대비**(정점당) 링 ${((hb.ring / ringN) / (tot / total)).toFixed(2)}배 · 어깨 ${((hb.shoulder / Math.max(1, shoulderN)) / (tot / total)).toFixed(2)}배 · **밑단 ${((hb.hem / Math.max(1, hemN)) / (tot / total)).toFixed(2)}배**`);
  const st: { v: number; i: number }[] = [];
  for (const e of g.edgePairs) {
    const rest = Math.hypot(g.pos2[e.b * 2] - g.pos2[e.a * 2], g.pos2[e.b * 2 + 1] - g.pos2[e.a * 2 + 1]);
    if (rest < 1e-6) continue;
    const d = Math.hypot(sim.positions[e.b * 3] - sim.positions[e.a * 3], sim.positions[e.b * 3 + 1] - sim.positions[e.a * 3 + 1], sim.positions[e.b * 3 + 2] - sim.positions[e.a * 3 + 2]);
    st.push({ v: d / rest, i: e.a });
  }
  st.sort((a, b) => b.v - a.v);
  console.log(`  [27계기·strain 상위 11] ${st.slice(0, 11).map((q) => `${q.v.toFixed(2)}@${PANEL_NAME[panelOfIdx(q.i)]}(${cm(g.pos2[q.i * 2])},${cm(g.pos2[q.i * 2 + 1])})`).join(" · ")}`);
}
console.log(`  링 총 길이 상한 발화: ${ringTotalFired}회 = ${(ringTotalFired / Math.max(1, result.frames)).toFixed(2)}/프레임 · 상한 ${cm(ringTotalMaxM)}cm(계수 ${(ringTotalMaxM / Math.max(1e-9, ringRestM)).toFixed(3)})\n  넥밴드 원주 제약 발화 누적: ${collarFired}회 = ${(collarFired / Math.max(1, result.frames)).toFixed(1)}/프레임 · 봉합 완료 f=${seamClosedAtFrame < 0 ? "미도달" : seamClosedAtFrame}(그 전까지 링 전용 상한은 일반 상한에 위임) · 링 원주 봉합 전 최대 ${cm(ringMaxBeforeCloseM)}cm → 최종 ${cm(ringLenM())}cm (rest ${cm(ringRestM)}cm)`);
console.log(`  관통(레이 패리티·비수밀 근사): 배치 후 ${penAfterPlace} → 정착 후 ${penEnd} / ${total}`);
// ── 63회차 §2 — 관통의 **패널 귀속**(62 §8 최우선 등재 해소). 두 계기가 총계만 내
// 소매분을 못 갈랐고, 그래서 62회차 S3의 효과 판정이 **원리적으로 불가능**했다.
// 분류는 기존 `panelOfIdx`를 그대로 쓴다 — 새 술어 0 · 손 상수 0(함정 12).
// y bin과 **패널을 함께** 인쇄한다: 45회차가 y130~143을 "링 대역"으로 라벨했는데
// 61회차 산술로 그건 소매 캡 대역이었다 — **y bin이 패널을 안 본다**(함정 13·19).
{
  const attribute = (label: string, pos: Float32Array): void => {
    const byPanel = [0, 0, 0, 0];
    const byPanelY = new Map<string, number>();
    let n = 0;
    for (let i = 0; i < total; i++) {
      if (!insideParity(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) continue;
      n++;
      const p = panelOfIdx(i);
      byPanel[p]++;
      const yc = Math.round(pos[i * 3 + 1] * 100);
      const band = yc >= 130 && yc <= 143 ? "y130~143" : yc >= 94 && yc <= 129 ? "y94~129" : yc >= 70 && yc <= 93 ? "y70~93" : "그외";
      const k = `${PANEL_NAME[p]}·${band}`;
      byPanelY.set(k, (byPanelY.get(k) ?? 0) + 1);
    }
    const rank = [...byPanelY.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `    [63계기·관통 패널 귀속] ${label} 총 ${n} — ${PANEL_NAME.map((nm, p) => `${nm} ${byPanel[p]}`).join(" · ")}` +
      ` │ **소매 합 ${byPanel[2] + byPanel[3]} (${n ? ((100 * (byPanel[2] + byPanel[3])) / n).toFixed(1) : "0.0"}%)**` +
      ` │ 패널×y대역: ${rank.length ? rank.map(([k, v]) => `${k} ${v}`).join(" / ") : "없음"}`,
    );
  };
  attribute("S0 배치 후", g.positions);
  attribute("정착 후", sim.positions);
}
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
  // 44회차 정정 2건:
  //  ① bin이 **10cm였다** — `positions`는 **미터**인데 `*10`으로 반올림했다(라벨 `y1.2`도 미터).
  //     y124~129의 6cm 띠를 원리적으로 못 갈랐다. **1cm(=`*100`)로 고친다.**
  //  ② 대역 귀속을 y bin이 아니라 **캡슐 소속**으로도 낸다 — `capsuleHitCount`가 리졸버와
  //     같은 판정식(축선분 거리 < radius+margin)을 쓰므로 y 경계의 임의성을 우회한다
  //     (43회차 (a)가 지적한 임의성 4곳을 안 만든다). 캡슐이 꺼져 있어도 순수 기하로 계산된다.
  {
    const per = [0, 0, 0, 0];
    const yBand: Record<string, number> = {};
    let inCapsule = 0, outCapsule = 0;
    for (let i = 0; i < total; i++) {
      if (!insideParity(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2])) continue;
      per[panelOfIdx(i)]++;
      const yc = Math.round(sim.positions[i * 3 + 1] * 100);
      yBand[`y${yc}`] = (yBand[`y${yc}`] ?? 0) + 1;
      if (capsuleHitCount(i) > 0) inCapsule++; else outCapsule++;
    }
    console.log(`[dress·diag] 관통 패널별: ${PANEL_NAME.map((n, i) => `${n} ${per[i]}`).join(" / ")} · 높이대역(1cm bin) ${JSON.stringify(yBand)}`);
    // 55회차 — **함정22 대조 재료**: 레이 패리티가 "관통"이라 센 정점의 `signedClearance`를
    // 직접 본다. 두 계기가 같은 정점을 관통이라 하는가, 다른 대역을 가리키는가.
    {
      const ds: number[] = [];
      let neg = 0, inMargin = 0, out = 0;
      const byPanel: Record<string, number> = {};
      for (let i = 0; i < total; i++) {
        if (!insideParity(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2])) continue;
        const m = i < g.panelStarts[1] ? frontMesh : i < g.panelStarts[2] ? backMesh : null;
        if (!m) { byPanel["소매(리졸버 없음)"] = (byPanel["소매(리졸버 없음)"] ?? 0) + 1; continue; }
        const d = m.signedClearance(sim.positions[i * 3], sim.positions[i * 3 + 1], sim.positions[i * 3 + 2], SDF_FAR);
        if (d === null) { byPanel["질의 실패"] = (byPanel["질의 실패"] ?? 0) + 1; continue; }
        ds.push(d * 1000);
        if (d <= 0) neg++; else if (d <= COLLISION_MARGIN) inMargin++; else out++;
      }
      ds.sort((a, b) => a - b);
      const q = (f: number): string => (ds.length ? ds[Math.min(ds.length - 1, Math.floor(f * ds.length))].toFixed(1) : "-");
      console.log(
        `[dress·diag] **함정22 대조** — 레이 패리티가 관통이라 센 정점의 signedClearance:` +
        ` n=${ds.length}(+ ${JSON.stringify(byPanel)}) · d(mm) 최소 ${q(0)} p25 ${q(0.25)} 중앙 ${q(0.5)} p99 ${q(0.99)}` +
        ` · **d≤0(국면3 일치) ${neg} · 0<d≤15(국면2) ${inMargin} · d>15(국면1) ${out}**`,
      );
    }
    console.log(`[dress·diag] 관통 정점의 **캡슐 소속**(y bin 임의성 없는 귀속 · TORSOCAP ${TORSOCAP ? "on" : "off"}): 캡슐 안 ${inCapsule} / 밖 ${outCapsule}`);
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

// ── 30계기 C: **중력 0 ablation**(one-shot). 정착 도달 후 중력만 끄고 추가
// 300프레임. 링이 rest 쪽으로 회수되면 "붙잡는 것 없음(하중 하 연성 평형)",
// 유지되면 "무언가 능동적으로 벌리고 있음". 모든 판정·측정이 끝난 뒤에만
// 돌린다 — sim을 변형하므로 위 수치를 오염시키면 안 된다.
if (process.env.GRAV0 !== "0") {
  const zero = new THREE.Vector3(0, 0, 0);
  const L0 = ringLenM();
  const before = { y: 0, n: 0 };
  {
    const idx = [...new Set(ringClosed.flatMap((e) => [e.a, e.b]))];
    for (const i of idx) before.y += sim.positions[i * 3 + 1];
    before.n = idx.length; before.y /= idx.length;
  }
  const track: { f: number; L: number }[] = [];
  for (let k = 1; k <= 300; k++) {
    session.step(SUBSTEP_DT, zero, preset, frameLayout, framePose);
    if (k % 30 === 0 || k === 1) track.push({ f: k, L: ringLenM() });
  }
  const L1 = ringLenM();
  let afterY = 0;
  {
    const idx = [...new Set(ringClosed.flatMap((e) => [e.a, e.b]))];
    for (const i of idx) afterY += sim.positions[i * 3 + 1];
    afterY /= idx.length;
  }
  const restM = ringRestConfirmedM;
  const recovered = (L0 - L1) / Math.max(1e-9, L0 - restM);
  console.log(`\n[dress] [30계기·중력 0 ablation] 정착 후 중력만 0으로 300프레임 (상한 상태: ${ringTotalMaxM > 0 ? "총길이 상한 on" : "RINGTOTAL=0"})`);
  console.log(`  링 ${cm(L0)}cm(${(L0 / restM).toFixed(3)}배) → ${cm(L1)}cm(${(L1 / restM).toFixed(3)}배) · rest ${cm(restM)}cm`);
  console.log(`  **회수율 ${(recovered * 100).toFixed(1)}%** (여분 ${cm(L0 - restM)}cm 중 ${cm(L0 - L1)}cm 회수) · 링 중심 y ${cm(before.y)} → ${cm(afterY)}`);
  console.log(`  경과: ${track.map((t) => `f+${t.f} ${cm(t.L)}`).join(" · ")}`);
  // 링이 감고 있는 몸의 굵기 — "회수 못 함"이 능동 힘인지 **기하 하한**인지의 입력.
  const sliceAt = (h: number) => body.slices.reduce((b, sl) => (Math.abs(sl.y - h) < Math.abs(b.y - h) ? sl : b), body.slices[0]);
  let topY = -Infinity;
  for (const i of [...new Set(ringClosed.flatMap((e) => [e.a, e.b]))]) topY = Math.max(topY, sim.positions[i * 3 + 1]);
  const sc = sliceAt(afterY), st2 = sliceAt(topY);
  console.log(`  링이 감은 몸 굵기 — 중심 y${cm(afterY)} 단면 ${cm(sc.girthM)}cm(링/몸 ${(L1 / sc.girthM).toFixed(3)}배) · 최상점 y${cm(topY)} 단면 ${cm(st2.girthM)}cm(${(L1 / st2.girthM).toFixed(3)}배) · 어깨 통과 ${cm(body.shoulderPassGirthM)}cm@y${cm(body.shoulderJointY)}`);
}
process.exit(fails.length === 0 ? 0 : 1);
