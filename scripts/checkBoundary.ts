// v2 2b **경계 길이 감사**(28회차 추가 A) — 계기 전용. 물리·제약 0줄.
//
// 화면 3현상(목선 개구 · 어깨~겨드랑이 들뜸 · 밑단 프릴)이 전부 "그 자리에서
// 필요한 것보다 경계가 길다"는 같은 서명을 보인다. 세 경계를 같은 표에 놓고
// **제도값 / 삼각화 후 실측값 / 차이**로 가른다. 셋이 같은 방향·같은 배율대면
// 공통 원인(제도 층위), 아니면 별개 층위다.
//
// 진입: `PATTERNCORE=1 npx tsx scripts/checkBoundary.ts`
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { deriveBodySkeleton } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { SLEEVE_CAP_EASE_M } from "../src/lib/patternDraft";
import { buildPatternGarment, PATTERN_EDGE_INTERIOR_M } from "../src/lib/patternGarment";
import { makeOutlineProvider } from "../src/lib/bodyOutline";
import type { Capsule } from "../src/lib/torsoCapsule";
import { COLLISION_MARGIN, DEFAULT_PATTERN_CORE } from "../src/lib/clothConfig";

const patternCore = process.env.PATTERNCORE != null ? process.env.PATTERNCORE !== "0" : DEFAULT_PATTERN_CORE;
if (!patternCore) { console.log("[boundary] patternCore off — PATTERNCORE=1로 진입."); process.exit(0); }

const FIXTURE = process.env.FIXTURE ?? "scripts/fixtures/collision-fixture.json";
const raw = readFileSync(FIXTURE, "utf8");
const fixtureHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
const fixture = JSON.parse(raw) as {
  layout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  pose: {
    pinLeft: { x: number; y: number; z: number }; pinRight: { x: number; y: number; z: number };
    armLeft: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
    armRight: { dir: { x: number; y: number; z: number }; trueShoulder: { x: number; y: number; z: number }; length: number };
  };
  collision: {
    position: number[]; frontIndex: number[] | null; backIndex: number[] | null;
    wholeBodyIndex: number[] | null; capsules: Capsule[]; centerZ: number;
  };
};
const { layout, pose, collision } = fixture;

const position = Float32Array.from(collision.position);
const torsoIndex = Uint32Array.from([...(collision.frontIndex ?? []), ...(collision.backIndex ?? [])]);
const wholeIndex = collision.wholeBodyIndex ? Uint32Array.from(collision.wholeBodyIndex) : null;
const hemCapsuleY = collision.capsules[collision.capsules.length - 1].bottom.y;
const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
const arms = [pose.armLeft, pose.armRight] as const;

const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemCapsuleY);
// 102 §2 — `MARGIN_ALL` 채널을 게이트 하네스에도 잇는다(문턱 ⑦⑧ 평가용).
// 미설정이면 `COLLISION_MARGIN` — 기존 호출과 비트 동일.
const MARGIN_ALL = process.env.MARGIN_ALL ? Number(process.env.MARGIN_ALL) / 1000 : COLLISION_MARGIN;
const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemCapsuleY, centerX, collision.centerZ, MARGIN_ALL);

const garmentDims = {
  lengthM: layout.heightM,
  widthM: layout.widthM,
  shoulderWidthM: Math.abs(pose.pinLeft.x - pose.pinRight.x),
  sleeveLengthM: Math.max(pose.armLeft.length, pose.armRight.length),
  sleeveWidthM: layout.sleeveWidthM,
};

const outlineTorso = new ArrayBvhCollision(); outlineTorso.rebuild(position, torsoIndex);
const outlineWhole = new ArrayBvhCollision(); outlineWhole.rebuild(position, wholeIndex ?? torsoIndex);
const axisAt = (h: number): [number, number] => {
  const sl = body.slices.reduce((b, s) => (Math.abs(s.y - h) < Math.abs(b.y - h) ? s : b), body.slices[0]);
  return [sl.axisX, sl.axisZ];
};
const outlineAt = makeOutlineProvider(outlineTorso, outlineWhole, axisAt, PATTERN_EDGE_INTERIOR_M);
const g = buildPatternGarment(body, garmentDims, arms as unknown as readonly [typeof pose.armLeft, typeof pose.armRight], outlineAt, undefined, MARGIN_ALL);
const d = g.draft.dims;
const cm = (v: number): string => (v * 100).toFixed(2);
const pad = (s: string, n: number): string => s + " ".repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));

// ── 몸 둘레 계기: 그 높이 단면 윤곽(레이캐스트)의 폴리라인 둘레 ──────────
const outlineGirthAt = (h: number): number => {
  const pts = outlineAt(h, MARGIN_ALL);
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return l;
};

// ── 삼각화 후 경계 엣지를 제도 세그먼트에 귀속 ──────────────────────────
// 경계 = 그 패널 안에서 삼각형 하나에만 속한 엣지. 귀속은 엣지 중점에서
// 각 제도 세그먼트 표본 폴리라인까지의 거리 최소 — 미러 패널은 |x|로 접는다.
const distToPolyline = (px: number, py: number, pts: { x: number; y: number }[]): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
  }
  return best;
};

interface Row { panel: string; seg: string; draftM: number; measM: number; edges: number }
const rows: Row[] = [];
const panelOfMesh = [0, 1, 2, 2]; // front / back / sleeveFlipped / sleeve → draft.panels 인덱스
for (let p = 0; p < 4; p++) {
  const { start, count } = g.panelTriRanges[p];
  const seen = new Map<string, number>();
  for (let t = 0; t < count; t++) {
    const i0 = g.tris[(start + t) * 3], i1 = g.tris[(start + t) * 3 + 1], i2 = g.tris[(start + t) * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]] as const) {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  const panel = g.draft.panels[panelOfMesh[p]];
  const acc = new Map<string, { len: number; n: number }>();
  for (const [k, n] of seen) {
    if (n !== 1) continue;
    const [a, b] = k.split("_").map(Number);
    const ax = g.pos2[a * 2], ay = g.pos2[a * 2 + 1], bx = g.pos2[b * 2], by = g.pos2[b * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let bestSeg = "?", bestD = Infinity;
    for (const s of panel.segments) {
      // 몸판은 **반쪽 제도**라 |x|로 접어야 하지만, 소매는 좌우 비대칭
      // 세그먼트(capFront/capBack)가 서로의 x 반전이라 접으면 전부 한쪽으로
      // 몰린다. 소매는 패널의 flip 여부(panel 2 = flipPanelMeshX)만 적용한다.
      const dd = panel.halfWithMirrorAxis
        ? Math.min(distToPolyline(mx, my, s.samples), distToPolyline(-mx, my, s.samples))
        : distToPolyline(p === 2 ? -mx : mx, my, s.samples);
      if (dd < bestD) { bestD = dd; bestSeg = s.name; }
    }
    const cur = acc.get(bestSeg) ?? { len: 0, n: 0 };
    cur.len += len; cur.n++; acc.set(bestSeg, cur);
  }
  const mult = panel.halfWithMirrorAxis ? 2 : 1; // 반쪽 제도는 완성 패널에서 2배
  for (const s of panel.segments) {
    const a = acc.get(s.name) ?? { len: 0, n: 0 };
    rows.push({ panel: ["front", "back", "sleeveL", "sleeveR"][p], seg: s.name, draftM: s.lengthM * mult, measM: a.len, edges: a.n });
  }
}

console.log(`[boundary] fixture ${fixtureHash} · 패턴 정점 ${g.pos2.length / 2} · 삼각형 ${g.tris.length / 3}`);
console.log("\n[boundary] 패널 경계 전량 (제도 = 완성 패널 기준, 반쪽 제도는 ×2)");
console.log(`  ${pad("패널", 10)}${pad("세그먼트", 12)}${pad("제도cm", 10)}${pad("실측cm", 10)}${pad("차이cm", 10)}엣지`);
for (const r of rows) {
  const diff = r.measM - r.draftM;
  console.log(`  ${pad(r.panel, 10)}${pad(r.seg, 12)}${pad(cm(r.draftM), 10)}${pad(cm(r.measM), 10)}${pad((diff * 100).toFixed(2), 10)}${r.edges}`);
}

const sum = (panel: string, seg: string, key: "draftM" | "measM"): number =>
  rows.filter((r) => r.panel === panel && r.seg === seg).reduce((s, r) => s + r[key], 0);

// ── 감사 3항목 ──────────────────────────────────────────────────────────
// 1) 목선 — 제도 목선둘레 / 경계 실측 / 링 rest(necklineRing 2D 합) / 몸 목밑둘레
let ringRest = 0;
for (const e of g.necklineRing) {
  ringRest += Math.hypot(g.pos2[e.a * 2] - g.pos2[e.b * 2], g.pos2[e.a * 2 + 1] - g.pos2[e.b * 2 + 1]);
}
const neckMeas = sum("front", "neck", "measM") + sum("back", "neck", "measM");
const neckDraft = sum("front", "neck", "draftM") + sum("back", "neck", "draftM");

// 2) 소매산 — seamGroups가 삼각화 후 호장을 직접 준다(암홀 ↔ 캡, x+ 한쪽).
const ah = g.seamGroups.filter((s) => s.kind === "armhole" && s.label.endsWith("(x+)"));
const armholeMeas = ah.reduce((s, q) => s + q.arcAM, 0);
const capMeas = ah.reduce((s, q) => s + q.arcBM, 0);

// 3) 밑단 — 옷 밑단 높이의 몸 둘레와 대조. 밑단 높이는 옷 top에서 총장만큼 내린 곳.
const hemY = g.meta.neckPointY - d.lengthM;
const hemMeas = sum("front", "hem", "measM") + sum("back", "hem", "measM");
const hemDraft = sum("front", "hem", "draftM") + sum("back", "hem", "draftM");
// 밑단 높이의 몸 둘레 — **sliceOutline은 이 대역에서 대역 밖이다**(밑단 y가
// 가랑이 아래라 몸통 메시가 두 다리로 갈라져 레이가 한쪽만 맞힌다: 16.85cm).
// 그 높이 슬라이스 둘레를 쓴다.
const hemSliceGirth = body.slices.reduce((b, s) => (Math.abs(s.y - hemY) < Math.abs(b.y - hemY) ? s : b), body.slices[0]);
const hemBodyGirth = hemSliceGirth.girthM;
const hemOutlineGirth = outlineGirthAt(hemY);

console.log("\n[boundary] 감사 3항목 — 제도 / 삼각화 후 실측 / 차이");
const audit = (name: string, draftM: number, measM: number, needM: number, needName: string): void => {
  console.log(
    `  ${pad(name, 10)} 제도 ${pad(cm(draftM), 9)} 실측 ${pad(cm(measM), 9)} 차이 ${pad(((measM - draftM) * 100).toFixed(2), 8)}` +
    ` | ${needName} ${pad(cm(needM), 9)} → 실측/필요 ${(measM / needM).toFixed(3)}배 (여분 ${cm(measM - needM)}cm)`,
  );
};
audit("목선", neckDraft, neckMeas, body.neckBaseGirthM, "몸 목밑둘레");
console.log(`             링 rest(necklineRing 2D 합) ${cm(ringRest)}cm — 경계 실측의 ${(ringRest / neckMeas * 100).toFixed(1)}% (패널 넘는 접합 2쌍 제외분)`);
audit("소매산", d.capGirthM, capMeas, armholeMeas, "암홀 실측");
console.log(`             제도 이즈 ${cm(SLEEVE_CAP_EASE_M)}cm · 제도 암홀 ${cm(d.armholeGirthM)} → 실측 이즈 ${cm(capMeas - armholeMeas)}cm`);
audit("밑단", hemDraft, hemMeas, hemBodyGirth, "몸 슬라이스둘레");
console.log(`             밑단 y=${cm(hemY)}cm@슬라이스 y${cm(hemSliceGirth.y)} · (참고 sliceOutline ${cm(hemOutlineGirth)}cm = 대역 밖)`);
console.log(`             밑단 둘레는 옆선이 직선이라 **가슴 여유가 그대로 내려온 값**이다 — 가슴 대역 여유 ${cm(2 * d.halfWidthM * 2 - body.chestGirthM)}cm(${(2 * d.halfWidthM * 2 / body.chestGirthM).toFixed(3)}배)`);

console.log("\n[boundary] 사전 등록 판정 — 세 배율");
const ratios = [
  ["목선", neckMeas / body.neckBaseGirthM],
  ["소매산", capMeas / armholeMeas],
  ["밑단", hemMeas / hemBodyGirth],
] as const;
console.log(`  ${ratios.map(([n, r]) => `${n} ${r.toFixed(3)}배`).join(" · ")}`);
const rs = ratios.map(([, r]) => r);
const allOver = rs.every((r) => r > 1);
const spread = Math.max(...rs) / Math.min(...rs);
console.log(`  방향 ${allOver ? "전부 과다(+)" : "혼재"} · 배율 산포 최대/최소 ${spread.toFixed(2)}배`);
console.log(`  → ${allOver && spread < 1.5 ? "공통 원인(같은 방향·같은 배율대)" : allOver ? "같은 방향이나 배율대가 다르다 — 층위 분리 필요" : "별개 층위(방향이 다르다)"}`);
