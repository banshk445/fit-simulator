// v2 Stage 2a (2) — 비정형 삼각화. v2-design §3.2.
//
// ## 구현체 결정 (§3.2: "소형 CDT 라이브러리 vs 자체 구현은 Stage 2a에서 결정")
// **자체 구현 · 라이브러리 미도입.** 근거:
//   - 이 저장소의 의존성은 8개뿐이고 delaunator/poly2tri/cdt2d 어느 것도 없다.
//     삼각화 하나를 위해 새 의존성을 들이는 것은 "라이브러리 도입 시 사전
//     보고" 대상인데, 아래 구조가 성립하면 보고할 이유 자체가 없어진다.
//   - **제약 델로네(CDT)의 제약 복원 단계가 필요 없다**: 경계 표본 간격
//     (7~9mm)이 내부 간격(15~18mm)의 절반이므로 경계 엣지는 델로네
//     삼각화에 그대로 살아남는다. 즉 "평면 델로네 + 경계 밖 삼각형 제거"로
//     경계 적합 메시가 나온다. 이 가정은 **검증 대상**이다 —
//     `missingBoundaryEdges`가 0이 아니면 게이트가 즉시 실패하고, 그때가
//     정식 CDT(또는 라이브러리) 도입의 신호다. 가정을 코드가 아니라 게이트로
//     막는다(함정 5: 사실을 하드코딩하지 말고 데이터에서 도출).
//
// ## 파이프라인
//   1. 경계 표본(호장 등간격, 시접 짝은 표본 수 일치 — patternDraft)
//   2. 크기장 h(p): 경계 대역(refined 세그먼트 ~3cm 이내) hBoundary →
//      내부 hInterior로 smoothstep 전이
//   3. 경계점만으로 Bowyer–Watson 델로네 → 다각형 밖 삼각형 제거
//   4. 크기장 기반 Delaunay refinement(외심 삽입, 경계 분할 없음)로 내부 채움
//   6. 라플라시안 스무딩 2패스(내부점만, 다각형 밖으로 나가면 취소)
//   7. 품질·위상 검사값 산출
import type { PatternSegment, Vec2 } from "./patternDraft";

export interface SizeFieldOpts {
  hBoundaryM: number;
  hInteriorM: number;
  bandM: number;
}

export interface MeshQuality {
  vertices: number;
  triangles: number;
  minAngleDeg: number;
  minAngleAt: { x: number; y: number };
  aspectMax: number;
  aspectMaxAt: { x: number; y: number };
  edgeMinM: number;
  edgeMaxM: number;
  edgeMeanM: number;
  // |엣지 길이 / 크기장 − 1|의 최댓값(§3.2 게이트: 크기장 ±30% 이내).
  sizeDeviationMax: number;
  sizeDeviationAt: { x: number; y: number };
  // 이탈 최댓값을 낸 엣지의 실제 길이와 그 지점의 크기장 — "길어서"인지
  // "짧아서"인지 구분 없이 비율만 보면 원인을 못 짚는다.
  sizeDeviationLenM: number;
  sizeDeviationHM: number;
  // |엣지/크기장 − 1| 분포. §3.2의 게이트 문구가 "엣지 길이 **분포**가
  // 크기장 ±30% 이내"이므로 판정은 퍼센타일로 하고, 최댓값은 알려진
  // 이상치로 병기한다(비정형 graded 메시의 전이 구간에서 최댓값은 구조적으로
  // 50%대가 남는다 — 정련 상수 4조합 스윕에서 전부 55~58%).
  sizeDeviationP50: number;
  sizeDeviationP90: number;
  sizeDeviationP99: number;
  // **이탈 상위(>30%) 엣지의 위치 지도** — 2b 실패 귀속용 사전 등록
  // (v2-design §3.2 처분: 이 채널은 게이트가 아니라 기록 채널이고, 2b에서
  // strain·정착이 실패하면 그 maxAt·상위 셀이 여기 등재된 대역과 겹치는지로
  // "메시 투자" 여부를 가른다).
  sizeOutlierCount: number;
  sizeOutlierByRegion: Record<string, number>;
  sizeOutlierExamples: { x: number; y: number; devPct: number; lenMm: number; hMm: number; region: string }[];
  boundaryEdges: number;
  nonManifoldEdges: number;
  duplicateVertices: number;
  // 경계 정점이 패턴 곡선 위에 있는지 — 표본을 그대로 썼으니 0이어야 한다
  // (스무딩이 경계를 건드리면 여기서 잡힌다).
  boundaryOffCurveMaxM: number;
  missingBoundaryEdges: number;
}

export interface PanelMesh {
  pos2: Float64Array;
  tris: Uint32Array;
  // 세그먼트 이름 → 정점 id(호장 순서, 끝점 포함·공유)
  segmentVerts: Map<string, number[]>;
  boundaryLoop: number[];
  boundaryCount: number;
  quality: MeshQuality;
  refineIters: number;
  sizeAt: (x: number, y: number) => number;
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function buildSizeField(segments: readonly PatternSegment[], o: SizeFieldOpts): (x: number, y: number) => number {
  const refined: Vec2[] = [];
  for (const s of segments) if (s.refined) refined.push(...s.samples);
  if (refined.length === 0) return () => o.hInteriorM;
  return (x, y) => {
    let d2 = Infinity;
    for (const p of refined) {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < d2) d2 = dd;
    }
    const t = smoothstep(Math.sqrt(d2) / o.bandM);
    return o.hBoundaryM + (o.hInteriorM - o.hBoundaryM) * t;
  };
}

// 이탈 지도용 — 어느 refined 세그먼트에 얼마나 가까운가(대역 귀속).
function buildRegionLabeler(
  segments: readonly PatternSegment[],
  o: SizeFieldOpts,
): (x: number, y: number) => string {
  const refined: { name: string; p: Vec2 }[] = [];
  for (const s of segments) if (s.refined) for (const p of s.samples) refined.push({ name: s.name, p });
  return (x, y) => {
    let best = Infinity, name = "-";
    for (const r of refined) {
      const dd = (r.p.x - x) ** 2 + (r.p.y - y) ** 2;
      if (dd < best) { best = dd; name = r.name; }
    }
    const d = Math.sqrt(best);
    if (d <= o.bandM * 0.34) return `${name}:경계`;
    if (d <= o.bandM) return `${name}:전이`;
    return "내부";
  };
}

// ── 다각형 유틸 ─────────────────────────────────────────────────────────
function insidePolygon(poly: readonly Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToPolygon(poly: readonly Vec2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const abx = b.x - a.x, aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    const t = l2 > 1e-18 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (y - a.y) * aby) / l2)) : 0;
    const d = Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
    if (d < best) best = d;
  }
  return best;
}

// ── Bowyer–Watson ───────────────────────────────────────────────────────
interface Tri { a: number; b: number; c: number; cx: number; cy: number; r2: number }

function circumcircle(p: readonly Vec2[], a: number, b: number, c: number): Tri | null {
  const ax = p[a].x, ay = p[a].y, bx = p[b].x, by = p[b].y, cx0 = p[c].x, cy0 = p[c].y;
  const d = 2 * (ax * (by - cy0) + bx * (cy0 - ay) + cx0 * (ay - by));
  if (Math.abs(d) < 1e-20) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx0 * cx0 + cy0 * cy0;
  const ux = (a2 * (by - cy0) + b2 * (cy0 - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx0 - bx) + b2 * (ax - cx0) + c2 * (bx - ax)) / d;
  return { a, b, c, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
}

// 크기장 대비 외심반경 상한 — 정삼각형(엣지 h)의 외심반경은 h/√3 = 0.577h다.
// 이보다 큰 삼각형에 외심을 꽂는 것이 Delaunay refinement(Ruppert/Chew)의
// 본체이고, 최소각과 엣지 길이 분포를 **동시에** 잡는다. 던지기(dart
// throwing)만으로는 Poisson-disk의 빈 원 반경이 최소간격의 2배까지 벌어져
// 크기장 이탈이 90%대로 남았다(첫 실행 실측) — 그래서 정련으로 교체했다.
// 0.80·0.70 = 스윕 채택값(0.62/0.55 · 0.80/0.70 · 0.90/0.75 · 1.00/0.80).
// 채택 근거: 평균 엣지 15.6mm가 설계 목표(내부 16mm, §1.4.1)에 가장 가깝고
// 총 정점 4,331이 §1.4.1 추정(4,400~4,800)에 붙는다. 0.62는 정점 6,785로
// 추정을 40% 넘고, 1.00은 최소각이 21.4°로 게이트(25°) 아래로 떨어진다.
const REFINE_CIRCUMRADIUS_RATIO = 0.80;
const REFINE_MAX_ITERS = 40;
// 삽입 후보가 경계·기존점에 이보다 가까우면 버린다(h 배수).
const REFINE_MIN_CLEARANCE = 0.70;
// 스프링 스무딩 — 패스 수와 완화 계수. (추정)
// 최장 엣지 상한(크기장 배수) — 게이트 ±30%를 직접 겨눈 값. (추정)
const REFINE_MAX_EDGE_RATIO = 1.40;
const SMOOTH_PASSES = 12;
const SMOOTH_RELAX = 0.3;

function delaunay(pts: Vec2[]): Tri[] {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  }
  const span = Math.max(xMax - xMin, yMax - yMin) * 20 + 1;
  const midX = (xMin + xMax) / 2, midY = (yMin + yMax) / 2;
  const work = [...pts,
    { x: midX - span, y: midY - span },
    { x: midX + span, y: midY - span },
    { x: midX, y: midY + span },
  ];
  const n = pts.length;
  const st = circumcircle(work, n, n + 1, n + 2);
  if (!st) throw new Error("delaunay: 슈퍼삼각형 퇴화");
  let tris: Tri[] = [st];

  for (let i = 0; i < n; i++) {
    const px = work[i].x, py = work[i].y;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) {
      if ((px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2) bad.push(t); else keep.push(t);
    }
    // 경계 폴리곤 = bad 삼각형들의 엣지 중 한 번만 등장하는 것.
    const count = new Map<number, number>();
    const edge = (a: number, b: number): number => Math.min(a, b) * 1_000_000 + Math.max(a, b);
    for (const t of bad) {
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = edge(a, b);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const t of bad) {
      for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        if (count.get(edge(a, b)) !== 1) continue;
        const nt = circumcircle(work, a, b, i);
        if (nt) keep.push(nt);
      }
    }
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n);
}

// ── 패널 삼각화 ─────────────────────────────────────────────────────────
export function triangulatePanel(segments: readonly PatternSegment[], o: SizeFieldOpts): PanelMesh {
  // 1) 경계 정점 — 인접 세그먼트가 공유하는 끝점은 한 번만.
  const verts: Vec2[] = [];
  const segmentVerts = new Map<string, number[]>();
  const boundaryLoop: number[] = [];
  for (const s of segments) {
    if (s.samples.length < 2) throw new Error(`triangulatePanel: ${s.name} 표본 미설정`);
    const ids: number[] = [];
    for (let i = 0; i < s.samples.length; i++) {
      const p = s.samples[i];
      // 루프의 마지막 점은 다음 세그먼트의 첫 점과 같다 — 마지막 세그먼트의
      // 끝점은 루프의 첫 점으로 되돌아온다.
      const isLast = i === s.samples.length - 1;
      let id: number;
      if (isLast) {
        const first = boundaryLoop[0];
        id = first !== undefined && Math.hypot(verts[first].x - p.x, verts[first].y - p.y) < 1e-12
          ? first
          : (verts.push(p), verts.length - 1);
      } else if (i === 0 && boundaryLoop.length > 0) {
        id = boundaryLoop[boundaryLoop.length - 1];
      } else {
        verts.push(p);
        id = verts.length - 1;
      }
      ids.push(id);
      if (!(isLast && id === boundaryLoop[0]) && !(i === 0 && boundaryLoop.length > 0)) boundaryLoop.push(id);
    }
    segmentVerts.set(s.name, ids);
  }
  const boundaryCount = verts.length;
  const poly = boundaryLoop.map((i) => verts[i]);
  const sizeAt = buildSizeField(segments, o);

  // 2~5) 경계점만으로 델로네를 만든 뒤 **크기장 기반 정련**으로 내부를 채운다.
  // 외심을 꽂되 경계를 쪼개지 않는다(Ruppert의 encroachment 분할 금지) —
  // 경계 표본 수는 시접 짝과 1:1로 묶여 있어 여기서 바꿀 수 없다. 외심이
  // 경계에 너무 붙으면 무게중심으로 대체하고, 그마저 붙으면 건너뛴다.
  const insideTris = (all: Tri[]): Tri[] =>
    all.filter((t) => insidePolygon(poly,
      (verts[t.a].x + verts[t.b].x + verts[t.c].x) / 3,
      (verts[t.a].y + verts[t.b].y + verts[t.c].y) / 3));

  let triObjs = insideTris(delaunay(verts));
  let refineIters = 0;
  for (; refineIters < REFINE_MAX_ITERS; refineIters++) {
    const inserts: Vec2[] = [];
    const nearest = (x: number, y: number): number => {
      let best = Infinity;
      for (const p of verts) { const d = Math.hypot(p.x - x, p.y - y); if (d < best) best = d; }
      for (const p of inserts) { const d = Math.hypot(p.x - x, p.y - y); if (d < best) best = d; }
      return best;
    };
    for (const t of triObjs) {
      const gx = (verts[t.a].x + verts[t.b].x + verts[t.c].x) / 3;
      const gy = (verts[t.a].y + verts[t.b].y + verts[t.c].y) / 3;
      const h = sizeAt(gx, gy);
      // 두 기준의 OR: 외심반경(형상 품질·최소각)과 **최장 엣지**(크기장 이탈).
      // 외심반경만 쓰면 L ≤ 2R ≤ 2·ratio·h라 이탈 상한이 구조적으로
      // (2·ratio − 1) = +60%로 고정된다 — 그 상한이 곧 p99 실패의 기전이라
      // 지표를 직접 겨누는 기준을 하나 더 둔다.
      const maxEdge = Math.max(
        Math.hypot(verts[t.b].x - verts[t.a].x, verts[t.b].y - verts[t.a].y),
        Math.hypot(verts[t.c].x - verts[t.b].x, verts[t.c].y - verts[t.b].y),
        Math.hypot(verts[t.a].x - verts[t.c].x, verts[t.a].y - verts[t.c].y),
      );
      if (Math.sqrt(t.r2) <= h * REFINE_CIRCUMRADIUS_RATIO && maxEdge <= h * REFINE_MAX_EDGE_RATIO) continue;
      const ok = (x: number, y: number): boolean =>
        insidePolygon(poly, x, y) && distToPolygon(poly, x, y) >= h * REFINE_MIN_CLEARANCE && nearest(x, y) >= h * REFINE_MIN_CLEARANCE;
      if (ok(t.cx, t.cy)) inserts.push({ x: t.cx, y: t.cy });
      else if (ok(gx, gy)) inserts.push({ x: gx, y: gy });
    }
    if (inserts.length === 0) break;
    for (const p of inserts) verts.push(p);
    triObjs = insideTris(delaunay(verts));
  }

  const tris: number[][] = [];
  for (const t of triObjs) {
    // 와인딩 통일(패널 안에서 부호가 섞이면 법선·면적 검사가 무의미해진다).
    const cross =
      (verts[t.b].x - verts[t.a].x) * (verts[t.c].y - verts[t.a].y) -
      (verts[t.b].y - verts[t.a].y) * (verts[t.c].x - verts[t.a].x);
    tris.push(cross >= 0 ? [t.a, t.b, t.c] : [t.a, t.c, t.b]);
  }

  // 6) **스프링 스무딩** — 각 엣지를 크기장이 지시하는 길이 h_ij로 당기거나
  // 민다. 라플라시안(이웃 평균)은 graded 메시에서 정점을 성긴 쪽으로 끌고
  // 가 이탈을 오히려 키운다 — 여기서 최소화해야 하는 양이 "이웃과의 평균
  // 위치"가 아니라 **|엣지/크기장 − 1|** 자체이므로 그 잔차를 직접 민다.
  {
    const nbr: Set<number>[] = verts.map(() => new Set<number>());
    for (const [a, b, c] of tris) {
      nbr[a].add(b); nbr[a].add(c);
      nbr[b].add(a); nbr[b].add(c);
      nbr[c].add(a); nbr[c].add(b);
    }
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
      const next = verts.map((p) => ({ ...p }));
      for (let i = boundaryCount; i < verts.length; i++) {
        const ns = nbr[i];
        if (ns.size === 0) continue;
        const hi = sizeAt(verts[i].x, verts[i].y);
        let dx = 0, dy = 0;
        for (const j of ns) {
          const ex = verts[j].x - verts[i].x, ey = verts[j].y - verts[i].y;
          const len = Math.hypot(ex, ey);
          if (len < 1e-12) continue;
          const target = (hi + sizeAt(verts[j].x, verts[j].y)) / 2;
          // len > target이면 j 쪽으로, 짧으면 반대로.
          const f = (len - target) / len;
          dx += ex * f; dy += ey * f;
        }
        const nx = verts[i].x + (dx / ns.size) * SMOOTH_RELAX;
        const ny = verts[i].y + (dy / ns.size) * SMOOTH_RELAX;
        if (!insidePolygon(poly, nx, ny) || distToPolygon(poly, nx, ny) < sizeAt(nx, ny) * 0.5) continue;
        next[i] = { x: nx, y: ny };
      }
      for (let i = boundaryCount; i < verts.length; i++) verts[i] = next[i];
    }
  }

  // 7) 품질·위상
  const quality = measureQuality(verts, tris, boundaryLoop, boundaryCount, poly, sizeAt, buildRegionLabeler(segments, o));

  const pos2 = new Float64Array(verts.length * 2);
  for (let i = 0; i < verts.length; i++) { pos2[i * 2] = verts[i].x; pos2[i * 2 + 1] = verts[i].y; }
  const flat = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) { flat[i * 3] = tris[i][0]; flat[i * 3 + 1] = tris[i][1]; flat[i * 3 + 2] = tris[i][2]; }

  return { pos2, tris: flat, segmentVerts, boundaryLoop, boundaryCount, quality, refineIters, sizeAt };
}

function measureQuality(
  verts: readonly Vec2[],
  tris: readonly number[][],
  boundaryLoop: readonly number[],
  boundaryCount: number,
  poly: readonly Vec2[],
  sizeAt: (x: number, y: number) => number,
  regionAt: (x: number, y: number) => string,
): MeshQuality {
  let minAngleDeg = 180, minAngleAt = { x: 0, y: 0 };
  let aspectMax = 0, aspectMaxAt = { x: 0, y: 0 };
  let edgeMin = Infinity, edgeMax = 0, edgeSum = 0, edgeCount = 0;
  let sizeDevMax = 0, sizeDevAt = { x: 0, y: 0 }, sizeDevLen = 0, sizeDevH = 0;
  const sizeDevs: number[] = [];
  const OUTLIER = 0.30;
  const outlierByRegion: Record<string, number> = {};
  const outlierExamples: { x: number; y: number; devPct: number; lenMm: number; hMm: number; region: string }[] = [];
  let outlierCount = 0;
  const edgeUse = new Map<number, number>();
  const ekey = (a: number, b: number): number => Math.min(a, b) * 1_000_000 + Math.max(a, b);

  for (const [a, b, c] of tris) {
    const P = [verts[a], verts[b], verts[c]];
    const L = [
      Math.hypot(P[1].x - P[2].x, P[1].y - P[2].y),
      Math.hypot(P[2].x - P[0].x, P[2].y - P[0].y),
      Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y),
    ];
    for (let i = 0; i < 3; i++) {
      const cosA = (L[(i + 1) % 3] ** 2 + L[(i + 2) % 3] ** 2 - L[i] ** 2) / (2 * L[(i + 1) % 3] * L[(i + 2) % 3]);
      const ang = (Math.acos(Math.min(1, Math.max(-1, cosA))) * 180) / Math.PI;
      if (ang < minAngleDeg) { minAngleDeg = ang; minAngleAt = { x: P[i].x, y: P[i].y }; }
    }
    const asp = Math.max(...L) / Math.min(...L);
    if (asp > aspectMax) { aspectMax = asp; aspectMaxAt = { x: (P[0].x + P[1].x + P[2].x) / 3, y: (P[0].y + P[1].y + P[2].y) / 3 }; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ekey(u, v);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  for (const [k, use] of edgeUse) {
    void use;
    const a = Math.floor(k / 1_000_000), b = k % 1_000_000;
    const len = Math.hypot(verts[a].x - verts[b].x, verts[a].y - verts[b].y);
    edgeMin = Math.min(edgeMin, len);
    edgeMax = Math.max(edgeMax, len);
    edgeSum += len; edgeCount++;
    const mx = (verts[a].x + verts[b].x) / 2, my = (verts[a].y + verts[b].y) / 2;
    // 엣지의 목표 길이는 **양 끝점 크기장의 평균**이다 — 중점 한 곳에서만
    // 읽으면 gradation 구간에서 기울기를 이중으로 물어 이탈이 부풀려진다
    // (경계 대역 h=8 정점과 내부 h=16 정점을 잇는 엣지의 정당한 목표는
    // 12mm인데 중점 h로 재면 16mm를 요구해 −25%가 그냥 찍힌다). 스프링
    // 스무딩이 미는 목표와도 같은 정의라 계기와 생성기가 일치한다.
    const hTarget = (sizeAt(verts[a].x, verts[a].y) + sizeAt(verts[b].x, verts[b].y)) / 2;
    const dev = Math.abs(len / hTarget - 1);
    sizeDevs.push(dev);
    if (dev > OUTLIER) {
      outlierCount++;
      const region = regionAt(mx, my);
      outlierByRegion[region] = (outlierByRegion[region] ?? 0) + 1;
      if (outlierExamples.length < 6) {
        outlierExamples.push({ x: mx, y: my, devPct: dev * 100, lenMm: len * 1000, hMm: hTarget * 1000, region });
      }
    }
    if (dev > sizeDevMax) { sizeDevMax = dev; sizeDevAt = { x: mx, y: my }; sizeDevLen = len; sizeDevH = hTarget; }
  }
  sizeDevs.sort((a, b) => a - b);
  const pct = (q: number): number => (sizeDevs.length ? sizeDevs[Math.min(sizeDevs.length - 1, Math.floor(q * sizeDevs.length))] : 0);

  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const use of edgeUse.values()) {
    if (use === 1) boundaryEdges++;
    else if (use > 2) nonManifoldEdges++;
  }

  // 중복 정점 — 격자 셀 단위 비교(모든 쌍 비교는 불필요).
  let duplicateVertices = 0;
  {
    const cell = 1e-6;
    const seen = new Set<string>();
    for (const p of verts) {
      const k = `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
      if (seen.has(k)) duplicateVertices++;
      seen.add(k);
    }
  }

  // 경계 정점이 곡선(=표본 폴리라인) 위에 있는지.
  let boundaryOffCurveMaxM = 0;
  for (let i = 0; i < boundaryCount; i++) {
    const d = distToPolygon(poly, verts[i].x, verts[i].y);
    if (d > boundaryOffCurveMaxM) boundaryOffCurveMaxM = d;
  }

  // 경계 엣지가 삼각화에 전부 존재하는가(CDT 생략의 검증 대상).
  let missingBoundaryEdges = 0;
  for (let i = 0; i < boundaryLoop.length; i++) {
    const a = boundaryLoop[i], b = boundaryLoop[(i + 1) % boundaryLoop.length];
    if (!edgeUse.has(ekey(a, b))) missingBoundaryEdges++;
  }

  return {
    vertices: verts.length, triangles: tris.length,
    minAngleDeg, minAngleAt, aspectMax, aspectMaxAt,
    edgeMinM: edgeMin, edgeMaxM: edgeMax, edgeMeanM: edgeSum / Math.max(1, edgeCount),
    sizeDeviationMax: sizeDevMax, sizeDeviationAt: sizeDevAt, sizeDeviationLenM: sizeDevLen, sizeDeviationHM: sizeDevH,
    sizeDeviationP50: pct(0.5), sizeDeviationP90: pct(0.9), sizeDeviationP99: pct(0.99),
    sizeOutlierCount: outlierCount, sizeOutlierByRegion: outlierByRegion, sizeOutlierExamples: outlierExamples,
    boundaryEdges, nonManifoldEdges, duplicateVertices,
    boundaryOffCurveMaxM, missingBoundaryEdges,
  };
}

// ── 미러 복제 (§3.2 좌우 대칭 보장) ─────────────────────────────────────
export interface MirroredMesh {
  pos2: Float64Array;
  tris: Uint32Array;
  // mirrorOf[i] = i의 좌우 대칭 상대. 축 위 정점은 자기 자신.
  mirrorOf: Int32Array;
  // 원본(x ≥ 0) 정점 수 — segmentVerts의 id는 이 범위 안에서 유효하다.
  originalCount: number;
}

// 좌우 소매용 — **복제가 아니라 뒤집기**다. 정점 수·인덱스가 그대로이고
// x만 반전, 와인딩만 반전된다(실제 패턴에서 좌우 소매는 같은 조각을 뒤집어
// 재단한 한 쌍이다). 정점 id가 보존되므로 미러 쌍 맵이 항등 사상이 되고,
// UV·법선도 뒤집힌 조각의 것이 되어 텍스처가 한쪽만 거울상이 되지 않는다.
export function flipPanelMeshX(mesh: PanelMesh): { pos2: Float64Array; tris: Uint32Array } {
  const pos2 = Float64Array.from(mesh.pos2);
  for (let i = 0; i < pos2.length; i += 2) pos2[i] = -pos2[i];
  const tris = Uint32Array.from(mesh.tris);
  for (let t = 0; t < tris.length; t += 3) { const b = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = b; }
  return { pos2, tris };
}

export function mirrorPanelMesh(mesh: PanelMesh, axisEpsM = 1e-9): MirroredMesh {
  const n = mesh.pos2.length / 2;
  const map = new Int32Array(n).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) { xs.push(mesh.pos2[i * 2]); ys.push(mesh.pos2[i * 2 + 1]); }
  const mirrorOfList: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (Math.abs(xs[i]) <= axisEpsM) { map[i] = i; mirrorOfList[i] = i; continue; }
    xs.push(-xs[i]); ys.push(ys[i]);
    const j = xs.length - 1;
    map[i] = j;
    mirrorOfList[i] = j;
    mirrorOfList[j] = i;
  }
  const triCount = mesh.tris.length / 3;
  const tris = new Uint32Array(mesh.tris.length * 2);
  tris.set(mesh.tris, 0);
  for (let t = 0; t < triCount; t++) {
    const a = mesh.tris[t * 3], b = mesh.tris[t * 3 + 1], c = mesh.tris[t * 3 + 2];
    // 미러는 와인딩을 뒤집는다 — 되돌려 통일한다.
    tris[mesh.tris.length + t * 3] = map[a];
    tris[mesh.tris.length + t * 3 + 1] = map[c];
    tris[mesh.tris.length + t * 3 + 2] = map[b];
  }
  const pos2 = new Float64Array(xs.length * 2);
  for (let i = 0; i < xs.length; i++) { pos2[i * 2] = xs[i]; pos2[i * 2 + 1] = ys[i]; }
  return { pos2, tris, mirrorOf: Int32Array.from(mirrorOfList), originalCount: n };
}
