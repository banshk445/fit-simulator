// v2 15회차 — **단면 윤곽 계기 3자 대조**. 배치를 돌리지 않는다(계기 검증 전용).
//
// 사전 등록 판정 기준: 신안(레이캐스트)의 **변 중점 최심 ≤ 1cm**.
// 현행 A안(볼록껍질)은 y135에서 7.22cm, B안(bin 반경)은 정점 자체가 3.91cm다.
// 미달이면 원인만 국소화하고 정지 — 배치 부활 금지.
//
// 진입: `PATTERNCORE=1 npm run check:outline`
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { deriveBodySkeleton } from "../src/lib/bodySkeleton";
import { measureBody } from "../src/lib/bodyMeasure";
import { makeParityInside } from "../src/lib/patternPlacement";
import { makeSkeletonSignedSampler } from "../src/lib/sdfCollision";
import { sliceOutline } from "../src/lib/bodyOutline";
import type { EmptyAngleRule } from "../src/lib/bodyOutline";
import { PATTERN_EDGE_INTERIOR_M } from "../src/lib/patternGarment";
import type { Capsule } from "../src/lib/torsoCapsule";
import { COLLISION_MARGIN, DEFAULT_PATTERN_CORE, SDF_FAR } from "../src/lib/clothConfig";

const t0 = performance.now();
const patternCore = process.env.PATTERNCORE != null ? process.env.PATTERNCORE !== "0" : DEFAULT_PATTERN_CORE;
if (!patternCore) {
  console.log("[outline] patternCore off(기본) — 아무것도 실행하지 않는다. PATTERNCORE=1로 진입.");
  process.exit(0);
}

const FIXTURE = process.env.FIXTURE ?? "scripts/fixtures/collision-fixture.json";
const raw = readFileSync(FIXTURE, "utf8");
const fixtureHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
const fixture = JSON.parse(raw) as {
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
const { pose, collision } = fixture;
const position = Float32Array.from(collision.position);
const torsoIndex = Uint32Array.from([...(collision.frontIndex ?? []), ...(collision.backIndex ?? [])]);
const wholeIndex = Uint32Array.from(collision.wholeBodyIndex ?? []);
const caps = collision.capsules as Capsule[];
const hemY = caps[caps.length - 1].bottom.y;
const centerX = (pose.pinLeft.x + pose.pinRight.x) / 2;
const arms = [pose.armLeft, pose.armRight] as const;
const skeleton = deriveBodySkeleton(position, torsoIndex, [pose.armLeft, pose.armRight], centerX, collision.centerZ, hemY);
// 103 §2 — 게이트 하네스 판 배선(100회차 규범의 «범위 확장»).
// 미설정이면 `COLLISION_MARGIN` — 기존 호출과 비트 동일.
const MARGIN_ALL = process.env.MARGIN_ALL ? Number(process.env.MARGIN_ALL) / 1000 : COLLISION_MARGIN;
const body = measureBody(position, torsoIndex, wholeIndex, arms, skeleton, hemY, centerX, collision.centerZ, MARGIN_ALL);

const torsoMesh = new ArrayBvhCollision();
torsoMesh.rebuild(position, torsoIndex);
const wholeMesh = new ArrayBvhCollision();
wholeMesh.rebuild(position, wholeIndex);
// 판정자 두 벌 — **계기끼리 순환 검증 금지**라 서로 독립인 것을 쓴다.
//   (1) 레이 패리티: t=0 게이트가 쓰는 것과 같은 판정자
//   (2) 골격 부호 샘플러(1a 은행 · 공 오라클, 패리티 없음)
const insideParity = makeParityInside(wholeMesh);
const signedSkel = makeSkeletonSignedSampler(wholeMesh, skeleton.segments, SDF_FAR, SDF_FAR);
const insideSkel = (x: number, y: number, z: number): boolean => signedSkel(x, y, z) < 0;

const cm = (v: number): string => (v * 100).toFixed(2);
console.log(`[outline] fixture ${fixtureHash} · 몸통 삼각형 ${torsoIndex.length / 3} · 전신 ${wholeIndex.length / 3} · 오프셋 ${cm(MARGIN_ALL)}cm · 목표 엣지 ${cm(PATTERN_EDGE_INTERIOR_M)}cm`);

// ── 대조군 B: 각도 bin 최근접 반경 폴리곤(14회차 대안 — 여기서 재현만 한다)
const GIRTH_BINS = 24;
const armSegs = new Set(skeleton.arms);
const torsoVerts: number[] = (() => {
  const seen = new Set<number>(), out: number[] = [];
  for (let t = 0; t < torsoIndex.length; t++) {
    const v = torsoIndex[t];
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
})();
void armSegs;
const binRadiusLoop = (h: number, cx: number, cz: number, marginM: number): [number, number][] => {
  const r = new Array<number>(GIRTH_BINS).fill(Infinity);
  for (const v of torsoVerts) {
    if (Math.abs(position[v * 3 + 1] - h) > 0.0125) continue;
    const x = position[v * 3], z = position[v * 3 + 2];
    const ang = Math.atan2(z - cz, x - cx);
    const b = Math.min(GIRTH_BINS - 1, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * GIRTH_BINS));
    const d = Math.hypot(x - cx, z - cz);
    if (d < r[b]) r[b] = d;
  }
  if (r.filter((q) => Number.isFinite(q)).length < 3) return [];
  for (let b = 0; b < GIRTH_BINS; b++) {
    if (Number.isFinite(r[b])) continue;
    let lo = 1, hi = 1;
    while (!Number.isFinite(r[(b - lo + GIRTH_BINS) % GIRTH_BINS])) lo++;
    while (!Number.isFinite(r[(b + hi) % GIRTH_BINS])) hi++;
    const a = r[(b - lo + GIRTH_BINS) % GIRTH_BINS], c = r[(b + hi) % GIRTH_BINS];
    r[b] = a + (c - a) * (lo / (lo + hi));
  }
  const out: [number, number][] = [];
  for (let b = 0; b < GIRTH_BINS; b++) {
    const ang = ((b + 0.5) / GIRTH_BINS) * 2 * Math.PI - Math.PI;
    out.push([cx + Math.cos(ang) * (r[b] + marginM), cz + Math.sin(ang) * (r[b] + marginM)]);
  }
  return out;
};

// ── 공통 측정: 정점·변중점의 몸 안 개수와 최심
interface Score { verts: number; vertsIn: number; vertWorstM: number; midIn: number; midTotal: number; midWorstM: number; lenM: number; skelMidIn: number; offMinM: number; offMaxM: number }
const MID_PER_EDGE = 3;
const score = (pts: [number, number][], h: number): Score => {
  let vertsIn = 0, vertWorst = 0, midIn = 0, midWorst = 0, lenM = 0, skelMidIn = 0, midTotal = 0;
  // 부호가 필요 없는 제3의 검사 — 오프셋 곡선이면 표면과의 거리가 어디서나
  // margin 근처여야 한다. 안으로 파고들든 밖으로 뜨든 이 값이 벌어진다.
  let offMin = Infinity, offMax = 0;
  const off = (x: number, z: number): void => {
    const c = wholeMesh.closestPointUnsigned(x, h, z, 0.4);
    if (!c) return;
    if (c.distance < offMin) offMin = c.distance;
    if (c.distance > offMax) offMax = c.distance;
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    lenM += Math.hypot(b[0] - a[0], b[1] - a[1]);
    off(a[0], a[1]);
    if (insideParity(a[0], h, a[1])) {
      vertsIn++;
      const c = wholeMesh.closestPointUnsigned(a[0], h, a[1], 0.4);
      if (c && c.distance > vertWorst) vertWorst = c.distance;
    }
    for (let k = 1; k <= MID_PER_EDGE; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / (MID_PER_EDGE + 1);
      const z = a[1] + ((b[1] - a[1]) * k) / (MID_PER_EDGE + 1);
      midTotal++;
      if (insideParity(x, h, z)) {
        midIn++;
        const c = wholeMesh.closestPointUnsigned(x, h, z, 0.4);
        if (c && c.distance > midWorst) midWorst = c.distance;
      }
      if (insideSkel(x, h, z)) skelMidIn++;
      off(x, z);
    }
  }
  return { verts: pts.length, vertsIn, vertWorstM: vertWorst, midIn, midTotal, midWorstM: midWorst, lenM, skelMidIn, offMinM: Number.isFinite(offMin) ? offMin : 0, offMaxM: offMax };
};

const HEIGHTS: number[] = [];
for (let h = 1.05; h <= 1.451; h += 0.05) HEIGHTS.push(Number(h.toFixed(4)));

const axisAt = (h: number): [number, number] => {
  const sl = body.slices.reduce((b, s) => (Math.abs(s.y - h) < Math.abs(b.y - h) ? s : b), body.slices[0]);
  return [sl.axisX, sl.axisZ];
};

let bakeMs = 0;
const rows: { h: number; a: Score; b: Score; f: Score; d: Score; fMeta: string; dMeta: string }[] = [];
for (const h of HEIGHTS) {
  const [cx, cz] = axisAt(h);
  const aPts = body.loopAt(h, MARGIN_ALL);
  const bPts = binRadiusLoop(h, cx, cz, MARGIN_ALL);
  const made: Record<EmptyAngleRule, ReturnType<typeof sliceOutline>> = { fallback: null!, drop: null! };
  for (const rule of ["fallback", "drop"] as EmptyAngleRule[]) {
    const t = performance.now();
    made[rule] = sliceOutline(torsoMesh, wholeMesh, h, cx, cz, MARGIN_ALL, PATTERN_EDGE_INTERIOR_M, rule);
    bakeMs += performance.now() - t;
  }
  rows.push({
    h,
    a: score(aPts, h), b: score(bPts, h),
    f: score(made.fallback.points, h), d: score(made.drop.points, h),
    fMeta: `각도 ${made.fallback.angles}(몸통 ${made.fallback.hitTorso} · 규칙 ${made.fallback.handled})`,
    dMeta: `각도 ${made.drop.angles}(몸통 ${made.drop.hitTorso} · 규칙 ${made.drop.handled})`,
  });
}

const fmt = (s: Score): string =>
  `정점 ${String(s.verts).padStart(3)} 안 ${String(s.vertsIn).padStart(3)}(${cm(s.vertWorstM)}) · 변중점 ${String(s.midIn).padStart(3)}/${String(s.midTotal).padStart(3)}(${cm(s.midWorstM)}) · 길이 ${cm(s.lenM)}`;

console.log("\n[outline] 3자 대조 (안 개수(최심cm) · 길이cm) — 판정자 = 레이 패리티");
for (const r of rows) {
  console.log(`  y${cm(r.h)}`);
  console.log(`    A 볼록껍질   ${fmt(r.a)}`);
  console.log(`    B bin 반경   ${fmt(r.b)}`);
  console.log(`    C 레이(fb)   ${fmt(r.f)}  ${r.fMeta}`);
  console.log(`    C 레이(drop) ${fmt(r.d)}  ${r.dMeta}`);
}

const worst = (sel: (r: typeof rows[number]) => Score): { mid: number; vert: number; at: number; skel: number; offMax: number } => {
  let mid = 0, vert = 0, at = rows[0].h, skel = 0;
  for (const r of rows) {
    const s = sel(r);
    if (s.midWorstM > mid) { mid = s.midWorstM; at = r.h; }
    if (s.vertWorstM > vert) vert = s.vertWorstM;
    skel += s.skelMidIn;
  }
  return { mid, vert, at, skel, offMax: rows.reduce((m, r) => Math.max(m, sel(r).offMaxM), 0) };
};
const wa = worst((r) => r.a), wb = worst((r) => r.b), wf = worst((r) => r.f), wd = worst((r) => r.d);
console.log("\n[outline] 요약 — 변중점 최심 / 정점 최심 (cm) · [독립 오라클] 골격 부호가 '안'이라 한 변중점 총합");
console.log(`  A 볼록껍질   ${cm(wa.mid)} @y${cm(wa.at)} / ${cm(wa.vert)}  · 오라클 ${wa.skel} · 표면거리 최대 ${cm(wa.offMax)}cm`);
console.log(`  B bin 반경   ${cm(wb.mid)} @y${cm(wb.at)} / ${cm(wb.vert)}  · 오라클 ${wb.skel} · 표면거리 최대 ${cm(wb.offMax)}cm`);
console.log(`  C 레이(fb)   ${cm(wf.mid)} @y${cm(wf.at)} / ${cm(wf.vert)}  · 오라클 ${wf.skel} · 표면거리 최대 ${cm(wf.offMax)}cm`);
console.log(`  C 레이(drop) ${cm(wd.mid)} @y${cm(wd.at)} / ${cm(wd.vert)}  · 오라클 ${wd.skel} · 표면거리 최대 ${cm(wd.offMax)}cm`);
console.log("  ※ 오라클은 최근접 골격점 기준이라 팔 근방을 오분류한다(함정 10) — 순위 확인용이고 절대값은 패리티가 정본이다.");
console.log(`[outline] 굽기 비용: 높이 ${HEIGHTS.length} × 규칙 2 = ${HEIGHTS.length * 2}벌 · ${bakeMs.toFixed(0)}ms (평균 ${(bakeMs / (HEIGHTS.length * 2)).toFixed(1)}ms/벌)`);

// ── 사전 등록 판정
const LIMIT_M = 0.01;
const best = wf.mid <= wd.mid ? { name: "fallback", w: wf } : { name: "drop", w: wd };
const ok = best.w.mid <= LIMIT_M;
console.log(
  `\n[outline] 판정(사전 등록 기준 변중점 최심 ≤ ${cm(LIMIT_M)}cm): 신안 최선 = ${best.name} ${cm(best.w.mid)}cm @y${cm(best.w.at)} → ${ok ? "**통과**" : "**미달**"}` +
  ` (대조 A ${cm(wa.mid)} · B ${cm(wb.mid)}cm)`,
);
console.log(`[outline] 경과 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
