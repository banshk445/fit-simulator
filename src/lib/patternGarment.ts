// v2 Stage 2a (3)(4) — 패널 조립 · 시접 테이블 도출 · 정적 배치 · 자기충돌
// 문턱 도출. v2-design §3.2~§3.4, §4 S0.
//
// **물리 0줄**: 이 파일은 ClothSimulation을 만들지 않는다(§6 2a: "물리
// 무변경, 검사·렌더만"). 2b가 이 산출물의 `edgePairs`/`seams`를 솔버에
// 먹인다.
//
// ## 시접 테이블은 **도출**된다 (21-4 교훈: 진단에 사실을 적지 말고 도출)
// `patternDraft.seams`는 "어느 세그먼트가 어느 세그먼트와 만나는가"만
// 말하고, 쌍 목록은 그 세그먼트의 **호장 등간격 표본 id**에서 나온다.
// 표본 수는 짝끼리 강제로 맞춰져 있으므로(아래 `unifySeamSampleCounts`)
// 매핑이 1:1이다 — v1의 1:2 중복 매핑이 4연속 실패한 지점을 구조적으로
// 제거한다(§3.2).
//
// ## 미러 규약
// 몸판은 x ≥ 0 절반만 제도·삼각화하고 미러로 복제한다. 시접도 같은 절반에서
// 도출한 뒤 미러 상대로 한 번 더 등재한다. 좌우 소매는 **같은 메시**를 두 번
// 쓰므로(소매는 형상 상수가 앞뒤 동일해 자기 대칭) 미러 상대의 정점 id가
// 로컬에서 동일하고, 미러 쌍 맵은 패널만 바뀌는 항등 사상이다.
import type { BodyMeasure } from "./bodyMeasure";
import type { GarmentDims, PatternDraft, PanelName } from "./patternDraft";
import { draftTshirtPattern, sampleArcEqual, sampleBySizeField } from "./patternDraft";
import { buildSizeField, flipPanelMeshX, mirrorPanelMesh, triangulatePanel } from "./patternMesh";
import type { MeshQuality, PanelMesh, SizeFieldOpts } from "./patternMesh";
import type { Vec3Like } from "./clothProtocol";
import { ARM_COLLISION_RADIUS, COLLISION_MARGIN, SEAM_REST_LENGTH } from "./clothConfig";

// 목표 엣지 길이 — §1.4.1의 대역 중앙값. 전부 (추정, Stage 2a/2b 실측 확정).
// 경계 7~9mm의 중앙 8mm, 내부 15~18mm의 16mm, 대역 폭 3cm.
export const PATTERN_EDGE_BOUNDARY_M = 0.008;
export const PATTERN_EDGE_INTERIOR_M = 0.016;
export const PATTERN_REFINE_BAND_M = 0.03;
// 자기충돌 문턱 = 생성된 메시의 **최소 엣지 길이 × 이 계수**(§3.2 — 상수
// 하드코딩을 도출로 대체). 0.6은 추정값이고, 동시에 시접 rest(6mm)보다
// 작아야 한다는 기존 제약을 유지한다(clothConfig SELF_COLLISION_MIN_DIST
// 주석 — 시접과 자체충돌의 힘겨루기 방지).
export const SELF_COLLISION_EDGE_FACTOR = 0.6;

export const PANEL_PAT_FRONT = 0;
export const PANEL_PAT_BACK = 1;
// 스파이크와 같은 규약: 2 = x 작은 쪽(미러 복제분), 3 = x 큰 쪽(제도 원본 쪽).
export const PANEL_PAT_SLEEVE_L = 2;
export const PANEL_PAT_SLEEVE_R = 3;

// 시접 짝 한 벌(세그먼트 쌍 × 좌/우) — 경계 호장 일치 검사가 **이 단위**로
// 이뤄져야 한다. 전체 시접을 한 폴리라인으로 이어 재면 벌 사이를 건너뛰는
// 구간이 길이에 섞여 값이 무의미해진다(첫 실행에서 암홀 a변 20138cm).
export interface SeamGroup {
  kind: string;
  label: string;
  a: number[];
  b: number[];
  arcAM: number;
  arcBM: number;
}

export interface PatternSeamEntry {
  a: number;
  b: number;
  kind: string;
  // 램프의 도착점(§4 S1). 이즈는 세그먼트 길이 차로 이미 분배돼 있으므로
  // 쌍마다 같은 목표를 쓴다(§3.1 "정규화 호장 비율로 잇는다").
  targetM: number;
  // 배치 직후 갭 — 진단·정렬 검사용.
  gapM: number;
}

export interface PatternGarment {
  draft: PatternDraft;
  // 패널 4개: front / back / sleeveL / sleeveR
  panelStarts: number[];
  panelCounts: number[];
  // 3D 정적 배치(place가 채운다)
  positions: Float32Array;
  // 패턴 2D 좌표(전역) — UV의 출처이자 Stage 3 프린트 배치의 좌표계
  pos2: Float64Array;
  uv: Float32Array;
  // 전역 인덱스 삼각형 + 패널별 구간
  tris: Uint32Array;
  panelTriRanges: { start: number; count: number }[];
  seams: PatternSeamEntry[];
  seamGroups: SeamGroup[];
  // 메시 엣지 전체(2b의 structural 제약 입력 + 자기충돌 스킵 집합)
  edgePairs: { a: number; b: number }[];
  // 목선 링 — v1 칼라 원주 제약(`setCollarRing`/`limitCollarStrain`)의 대상.
  // 패널 경계(앞목·뒤목 곡선)의 인접 표본 쌍 + 그 미러 상대. **패널을 넘는
  // 접합(앞목점↔뒤목점)은 넣지 않는다** — 그 두 쌍의 배치 거리는 앞뒤판
  // 오프셋(31cm)이라 rest로 굳히면 링이 그만큼 늘어날 수 있게 된다. 그
  // 구간은 어깨 시접(target 6mm)이 이미 잡는다.
  necklineRing: { a: number; b: number }[];
  // 어깨 시접 46쌍 — **구성 시점 결합(사전 봉제)** 대상. 런타임 램프에서 빼고
  // 용접(alias/canon)으로 결합한다(§4 개정: 제조 순서 복원).
  shoulderPairs: { a: number; b: number }[];
  mirrorOf: Int32Array;
  selfCollisionMinDistM: number;
  quality: { panel: string; q: MeshQuality }[];
  place: (offsetScale: number) => void;
  meta: {
    // 목선 정점 높이(이분법 해) — 앞/뒤. `neckApexSat`가 0이 아니면 대역 끝에서
    // 포화했다는 뜻이다(+1 = 위 끝 = 패턴 목선이 몸보다 짧다).
    neckApexY: number[];
    neckApexSat: number[];
    // 미지수 대역 5점 스캔(정점 높이 → 사상된 반곡선 길이) — 자유도의 유효성 증거.
    neckArcScan: { apexY: number; arcM: number }[][];
    neckPointY: number;
    // 사상된 목선 반곡선 길이 vs 그 목표(같은 표본의 2D 폴리라인) — 앞/뒤.
    neckArcM: number[];
    neckArcTargetM: number[];
    armGirthM: number;
    sleeveRadiusM: number;
    torsoOffsetFrontM: number;
    torsoOffsetBackM: number;
    anchorY: number;
    wrapShrink: number;
    seamCounts: Record<string, number>;
  };
}

const idealCount = (lengthM: number, hM: number): number => Math.max(2, Math.round(lengthM / hM) + 1);

const segKey = (p: PanelName, s: string): string => `${p}/${s}`;

// 경계 표본화 — 두 단계다.
//   A. 곡선 경계(refined): 균일 hBoundary. 시접 짝끼리 표본 수를 큰 쪽으로
//      통일한다(§3.2 — 1:1 매핑의 구조적 보장).
//   B. 직선 경계: 크기장 밀도(sampleBySizeField). 크기장은 A가 끝난 뒤에야
//      만들 수 있다(refined 표본이 그 입력이다). 직선 경계의 시접 짝은
//      기하가 동일해 표본 수가 저절로 같고, 아니면 아래에서 큰 쪽으로 맞춘다.
function sampleAllSegments(draft: PatternDraft, o: SizeFieldOpts): void {
  const count = new Map<string, number>();
  for (const p of draft.panels) {
    for (const s of p.segments) {
      if (s.refined) count.set(segKey(p.name, s.name), idealCount(s.lengthM, o.hBoundaryM));
    }
  }
  for (const seam of draft.seams) {
    const ka = segKey(seam.a.panel, seam.a.segment), kb = segKey(seam.b.panel, seam.b.segment);
    if (!count.has(ka) || !count.has(kb)) continue;
    const n = Math.max(count.get(ka)!, count.get(kb)!);
    count.set(ka, n);
    count.set(kb, n);
  }
  for (const p of draft.panels) {
    for (const s of p.segments) if (s.refined) s.samples = sampleArcEqual(s.curve, count.get(segKey(p.name, s.name))!);
  }
  const fields = new Map<PanelName, (x: number, y: number) => number>();
  for (const p of draft.panels) fields.set(p.name, buildSizeField(p.segments, o));
  for (const p of draft.panels) {
    for (const s of p.segments) if (!s.refined) s.samples = sampleBySizeField(s.curve, fields.get(p.name)!);
  }
  // 직선 경계 시접 짝의 표본 수 불일치 — 기하가 같으면 안 생긴다. 생기면
  // 큰 쪽으로 재표본(균일)하고 그 사실을 남긴다.
  const find = (pn: PanelName, sn: string) => draft.panels.find((p) => p.name === pn)!.segments.find((s) => s.name === sn)!;
  for (const seam of draft.seams) {
    const sa = find(seam.a.panel, seam.a.segment), sb = find(seam.b.panel, seam.b.segment);
    if (sa.refined || sb.refined || sa.samples.length === sb.samples.length) continue;
    const n = Math.max(sa.samples.length, sb.samples.length);
    sa.samples = sampleArcEqual(sa.curve, n);
    sb.samples = sampleArcEqual(sb.curve, n);
  }
}

function panelEdges(tris: Uint32Array): { a: number; b: number }[] {
  const seen = new Set<number>();
  const out: { a: number; b: number }[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t], tris[t + 1], tris[t + 2]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const a = Math.min(v[i], v[j]), b = Math.max(v[i], v[j]);
      const k = a * 1_000_000 + b;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ a, b });
    }
  }
  return out;
}

export interface PatternArm {
  trueShoulder: Vec3Like;
  dir: Vec3Like;
  length: number;
}

export function buildPatternGarment(
  body: BodyMeasure,
  garment: GarmentDims,
  arms: readonly [PatternArm, PatternArm],
  sizeOpts: SizeFieldOpts = {
    hBoundaryM: PATTERN_EDGE_BOUNDARY_M,
    hInteriorM: PATTERN_EDGE_INTERIOR_M,
    bandM: PATTERN_REFINE_BAND_M,
  },
): PatternGarment {
  const draft = draftTshirtPattern(body, garment);
  sampleAllSegments(draft, sizeOpts);

  // ── 삼각화. 몸판은 절반 → 미러, 소매는 전체(좌우가 서로의 미러).
  const half: Record<"front" | "back", PanelMesh> = {
    front: triangulatePanel(draft.panels[0].segments, sizeOpts),
    back: triangulatePanel(draft.panels[1].segments, sizeOpts),
  };
  const sleeveMesh = triangulatePanel(draft.panels[2].segments, sizeOpts);
  const sleeveFlipped = flipPanelMeshX(sleeveMesh);
  const mFront = mirrorPanelMesh(half.front);
  const mBack = mirrorPanelMesh(half.back);

  const panelPos2 = [mFront.pos2, mBack.pos2, sleeveFlipped.pos2, sleeveMesh.pos2];
  const panelTris = [mFront.tris, mBack.tris, sleeveFlipped.tris, sleeveMesh.tris];
  const panelCounts = panelPos2.map((p) => p.length / 2);
  const panelStarts: number[] = [];
  {
    let off = 0;
    for (const c of panelCounts) { panelStarts.push(off); off += c; }
  }
  const total = panelCounts.reduce((a, b) => a + b, 0);

  const pos2 = new Float64Array(total * 2);
  for (let p = 0; p < 4; p++) pos2.set(panelPos2[p], panelStarts[p] * 2);

  const triList: number[] = [];
  const panelTriRanges: { start: number; count: number }[] = [];
  for (let p = 0; p < 4; p++) {
    const start = triList.length / 3;
    for (let i = 0; i < panelTris[p].length; i++) triList.push(panelTris[p][i] + panelStarts[p]);
    panelTriRanges.push({ start, count: panelTris[p].length / 3 });
  }
  const tris = Uint32Array.from(triList);

  // ── UV: 패턴 2D를 그대로 보존(§3.3). 패널별로 자기 bbox 원점으로 옮기고
  // **공통 축척**으로 나눈다 — 축척이 패널마다 다르면 텍셀 밀도가 갈라져
  // 체커 검사와 Stage 3 프린트 배치가 둘 다 왜곡된다.
  const uv = new Float32Array(total * 2);
  {
    const bbox = panelPos2.map((p) => {
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < xMin) xMin = p[i]; if (p[i] > xMax) xMax = p[i];
        if (p[i + 1] < yMin) yMin = p[i + 1]; if (p[i + 1] > yMax) yMax = p[i + 1];
      }
      return { xMin, xMax, yMin, yMax };
    });
    const scale = Math.max(...bbox.map((b) => Math.max(b.xMax - b.xMin, b.yMax - b.yMin)));
    for (let p = 0; p < 4; p++) {
      const b = bbox[p];
      for (let i = 0; i < panelCounts[p]; i++) {
        const gi = panelStarts[p] + i;
        uv[gi * 2] = (panelPos2[p][i * 2] - b.xMin) / scale;
        // v는 패턴 y가 아래로 증가하므로 뒤집어 넣는다(텍스처 위쪽 = 어깨).
        uv[gi * 2 + 1] = 1 - (panelPos2[p][i * 2 + 1] - b.yMin) / scale;
      }
    }
  }

  // ── 미러 쌍 맵(전역)
  const mirrorOf = new Int32Array(total);
  for (let i = 0; i < panelCounts[0]; i++) mirrorOf[panelStarts[0] + i] = panelStarts[0] + mFront.mirrorOf[i];
  for (let i = 0; i < panelCounts[1]; i++) mirrorOf[panelStarts[1] + i] = panelStarts[1] + mBack.mirrorOf[i];
  for (let i = 0; i < panelCounts[2]; i++) {
    mirrorOf[panelStarts[2] + i] = panelStarts[3] + i;
    mirrorOf[panelStarts[3] + i] = panelStarts[2] + i;
  }

  // ── 목선 링(전역) — 미러 상대까지.
  const necklineRing: { a: number; b: number }[] = [];
  for (const [panel, mesh] of [[PANEL_PAT_FRONT, half.front], [PANEL_PAT_BACK, half.back]] as const) {
    const chain = mesh.segmentVerts.get("neck");
    if (!chain) throw new Error("목선 세그먼트 정점 목록 없음");
    const start = panelStarts[panel];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = start + chain[i], b = start + chain[i + 1];
      necklineRing.push({ a, b });
      const ma = mirrorOf[a], mb = mirrorOf[b];
      if (ma !== a || mb !== b) necklineRing.push({ a: ma, b: mb });
    }
  }

  // ── 엣지(전역)
  const edgePairs: { a: number; b: number }[] = [];
  for (let p = 0; p < 4; p++) {
    for (const e of panelEdges(panelTris[p])) edgePairs.push({ a: e.a + panelStarts[p], b: e.b + panelStarts[p] });
  }

  // ── 시접 테이블 도출
  const meshOf: Record<PanelName, PanelMesh> = { front: half.front, back: half.back, sleeve: sleeveMesh };
  const directPanel: Record<PanelName, number> = {
    front: PANEL_PAT_FRONT, back: PANEL_PAT_BACK, sleeve: PANEL_PAT_SLEEVE_R,
  };
  const seams: PatternSeamEntry[] = [];
  const seamGroups: SeamGroup[] = [];
  const seamKeys = new Set<number>();
  const pairKey = (a: number, b: number): number => Math.min(a, b) * 1_000_000 + Math.max(a, b);
  const addSeam = (a: number, b: number, kind: string): void => {
    if (a === b) throw new Error(`시접 ${kind}: 같은 정점(${a})을 자기 자신과 잇는다 — 위상 오류`);
    const k = pairKey(a, b);
    if (seamKeys.has(k)) return;
    seamKeys.add(k);
    seams.push({ a, b, kind, targetM: SEAM_REST_LENGTH, gapM: 0 });
  };
  for (const spec of draft.seams) {
    const va = meshOf[spec.a.panel].segmentVerts.get(spec.a.segment);
    const vb = meshOf[spec.b.panel].segmentVerts.get(spec.b.segment);
    if (!va || !vb) throw new Error(`시접 ${spec.kind}: 세그먼트 정점 목록 없음`);
    if (va.length !== vb.length) {
      throw new Error(`시접 ${spec.kind} 표본수 불일치: ${spec.a.segment} ${va.length} vs ${spec.b.segment} ${vb.length}`);
    }
    const startA = panelStarts[directPanel[spec.a.panel]];
    const startB = panelStarts[directPanel[spec.b.panel]];
    const direct = { a: [] as number[], b: [] as number[] };
    const mirrored = { a: [] as number[], b: [] as number[] };
    for (let k = 0; k < va.length; k++) {
      const ia = startA + va[k];
      const ib = startB + vb[spec.reverseB ? vb.length - 1 - k : k];
      addSeam(ia, ib, spec.kind);
      direct.a.push(ia); direct.b.push(ib);
      // 미러 상대 — 몸판은 대칭 정점, 소매는 반대쪽 패널의 같은 로컬 id.
      addSeam(mirrorOf[ia], mirrorOf[ib], spec.kind);
      mirrored.a.push(mirrorOf[ia]); mirrored.b.push(mirrorOf[ib]);
    }
    const arc = (idxs: number[]): number => {
      let l = 0;
      for (let i = 1; i < idxs.length; i++) {
        l += Math.hypot(pos2[idxs[i] * 2] - pos2[idxs[i - 1] * 2], pos2[idxs[i] * 2 + 1] - pos2[idxs[i - 1] * 2 + 1]);
      }
      return l;
    };
    for (const [side, gp] of [["x+", direct], ["x-", mirrored]] as const) {
      seamGroups.push({
        kind: spec.kind,
        label: `${spec.a.panel}.${spec.a.segment} ↔ ${spec.b.panel}.${spec.b.segment} (${side})`,
        a: gp.a, b: gp.b, arcAM: arc(gp.a), arcBM: arc(gp.b),
      });
    }
  }

  const shoulderPairs = seams.filter((sm) => sm.kind === "shoulder").map((sm) => ({ a: sm.a, b: sm.b }));

  // ── 자기충돌 문턱 도출(§3.2)
  const edgeMinM = Math.min(half.front.quality.edgeMinM, half.back.quality.edgeMinM, sleeveMesh.quality.edgeMinM);
  const selfCollisionMinDistM = edgeMinM * SELF_COLLISION_EDGE_FACTOR;

  // ── 정적 배치(§4 S0) ---------------------------------------------------
  const positions = new Float32Array(total * 3);
  const armPlus = arms[0].trueShoulder.x >= arms[1].trueShoulder.x ? arms[0] : arms[1];
  const armMinus = armPlus === arms[0] ? arms[1] : arms[0];
  const sleeveRadiusM = draft.dims.sleeveTubeRadiusM;
  // wrap 각을 표본 간격 하나만큼 덜 감는다. 두 시접 변이 완전히 겹친 채
  // 시작하면 시접 rest가 밀어낼 **방향**이 부동소수 오차로 정해진다 —
  // selfCollision.ts의 seamRowExclusive 주석이 기록한 잔물결 병리와 같은
  // 기전이다.
  const cuffSamples = draft.panels[2].segments[2].samples.length;
  const wrapShrink = 1 - 1 / Math.max(2, cuffSamples - 1);
  const anchorY = draft.dims.ridgeAnchorY;
  // 앞/뒤 오프셋을 **따로** 도출한다(몸 z 비대칭).
  const torsoOffsetFront = body.frontExtentM + COLLISION_MARGIN * 2;
  const torsoOffsetBack = body.backExtentM + COLLISION_MARGIN * 2;

  const norm = (v: Vec3Like): Vec3Like => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const cross = (a: Vec3Like, b: Vec3Like): Vec3Like =>
    ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  // ── 배치 사상 — **전단사 구성**(§4 S0 3판). 8회차 결함 2건의 처방이다.
  //
  // 몸판 사상은 두 단계이고 양쪽 다 단조라 접힘이 원리적으로 생기지 않는다.
  //   (1) 패턴 (x, y) → (u, v):  v = y(어깨선에서의 드리움),
  //       u = x / outerX(v) ∈ [-1, 1]. outerX는 **y로 x를 찾는** 룩업이다
  //       (어깨선→암홀→옆선은 y 단조). 8회차는 반대로 x로 y를 찾았는데 암홀이
  //       x에 대해 비단조(22.5→20.3→27.5cm)라 그 구간에서 행 순서가 뒤집혔고
  //       그것이 자기교차 806건의 발생원이었다(결함 2).
  //   (2) (u, v) → 3D:  가장자리 곡선 E(v)와 중심선 C(v)를 사분타원(sin/cos)
  //       으로 섞는다. u=±1이 정확히 E, u=0이 정확히 C.
  //
  // 코너 8개(목점·어깨끝·겨드랑이·밑단 좌우)는 이 식의 u=1 값으로 **자동으로**
  // 선사상된다 — 목점 = ridge(s=0), 어깨끝 = ridge(s=1)이므로 목선과 어깨
  // 능선이 같은 점을 공유하고, 8회차의 C⁰ 단절(결함 1)이 구조적으로 소멸한다.
  const nwHalfM = draft.dims.neckHalfWidthM;
  const shoulderDropM = draft.dims.shoulderDropM;
  const armholeDepthM = draft.dims.armholeDepthM;
  // (1) outerX — 가장자리(어깨선→암홀→옆선) 표본을 y 오름차순으로 이은 룩업.
  //     삼각화가 쓴 것과 **같은 표본**이라 경계 정점은 정확히 u=1이 되고 내부
  //     정점은 그 폴리곤 안이므로 u<1이다(클램프가 필요 없다).
  const outerXFor = (panelIdx: number): ((v: number) => number) => {
    const pts: { y: number; x: number }[] = [];
    for (const name of ["shoulder", "armhole", "side"]) {
      const sg = draft.panels[panelIdx].segments.find((s) => s.name === name);
      if (sg) for (const p of sg.samples) pts.push({ y: p.y, x: Math.abs(p.x) });
    }
    pts.sort((a, b) => a.y - b.y);
    return (v: number): number => {
      if (v <= pts[0].y) return pts[0].x;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].y >= v) {
          const r = (v - pts[i - 1].y) / Math.max(1e-12, pts[i].y - pts[i - 1].y);
          return pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r;
        }
      }
      return pts[pts.length - 1].x;
    };
  };
  const outerXPanel = [outerXFor(0), outerXFor(1)];
  // (2) 어깨 능선 호장 매핑 — 6회차 앵커 매핑과 **같은 사상**(목 쪽 끝 → 바깥 끝).
  const ridgeAt = (() => {
    const side = (sign: number): { p: Vec3Like; cum: number }[] => {
      const all = body.ridgePoints
        .filter((r) => Math.sign(r.x - body.centerX) === sign)
        .sort((a, b) => Math.abs(a.x - body.centerX) - Math.abs(b.x - body.centerX));
      const pts = all.filter((r) => Math.abs(r.x - body.centerX) > nwHalfM);
      // 목점(s=0)은 **정확히 목너비 x**여야 한다. 걸러내기만 하면 능선 정점이
      // 1cm 간격이라 첫 점이 x 6.26cm에 찍히고(목너비 5.90), 그 0.36cm가
      // 뒤목 반곡선의 현을 6.30 → 6.64cm로 밀어 이분법 하한을 넘겨버린다
      // (실측: 뒤목 목표 6.559cm). 폴리라인을 그 x에서 보간해 끼워 넣는다.
      const inner = all.filter((r) => Math.abs(r.x - body.centerX) <= nwHalfM).pop();
      if (inner && pts.length > 0) {
        const o = pts[0];
        const r = (nwHalfM - Math.abs(inner.x - body.centerX)) /
          Math.max(1e-12, Math.abs(o.x - body.centerX) - Math.abs(inner.x - body.centerX));
        pts.unshift({
          x: body.centerX + sign * nwHalfM,
          y: inner.y + (o.y - inner.y) * r,
          z: inner.z + (o.z - inner.z) * r,
        });
      }
      const out: { p: Vec3Like; cum: number }[] = [];
      let cum = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) cum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
        out.push({ p: pts[i], cum });
      }
      return out;
    };
    const curves = new Map<number, { p: Vec3Like; cum: number }[]>([[1, side(1)], [-1, side(-1)]]);
    return (sign: number, s: number): Vec3Like => {
      const c = curves.get(sign) ?? curves.get(1)!;
      if (c.length === 0) return { x: body.centerX, y: draft.dims.ridgeAnchorY, z: body.centerZ };
      const total = c[c.length - 1].cum;
      const want = total * Math.min(1, Math.max(0, s));
      for (let i = 1; i < c.length; i++) {
        if (c[i].cum >= want) {
          const r = (want - c[i - 1].cum) / Math.max(1e-9, c[i].cum - c[i - 1].cum);
          return {
            x: c[i - 1].p.x + (c[i].p.x - c[i - 1].p.x) * r,
            y: c[i - 1].p.y + (c[i].p.y - c[i - 1].p.y) * r,
            z: c[i - 1].p.z + (c[i].p.z - c[i - 1].p.z) * r,
          };
        }
      }
      return c[c.length - 1].p;
    };
  })();
  // (3) 가장자리 곡선 E(v) — 어깨 구간은 능선, 그 아래는 **그 높이 몸 단면의
  //     측면 극값 + margin**. z는 패널 부호 × margin뿐이라 옆선이 거의 닫힌 채
  //     시작한다(제조 순서 정합 — 어깨는 사전 봉제, 옆선은 S1이 마저 닫는다).
  const sliceByY = [...body.slices].sort((a, b) => a.y - b.y);
  const lateralHalfAt = (h: number): number => {
    if (sliceByY.length === 0) return draft.dims.halfWidthM;
    if (h <= sliceByY[0].y) return sliceByY[0].widthM / 2;
    for (let i = 1; i < sliceByY.length; i++) {
      if (sliceByY[i].y >= h) {
        const r = (h - sliceByY[i - 1].y) / Math.max(1e-12, sliceByY[i].y - sliceByY[i - 1].y);
        return (sliceByY[i - 1].widthM + (sliceByY[i].widthM - sliceByY[i - 1].widthM) * r) / 2;
      }
    }
    return sliceByY[sliceByY.length - 1].widthM / 2;
  };
  const neckPointY = ridgeAt(1, 0).y;
  // 행 높이 — 가장자리와 중심선이 **같은 높이 법칙**을 써야 행이 수평이 된다.
  // 1차 구현은 가장자리를 능선(목점 y145.23 → 어깨끝 141.76, 낙차 3.47cm),
  // 중심선을 "목점 y − 패턴 v"(낙차 6.08cm)로 뒀는데 그 2.6cm 차이가 행을
  // 기울여 어깨~암홀 전이 구간에서 배치 접힘 16건을 만들었다(실측 국소화:
  // 패턴(21.70,6.46)이 (22.28,6.79)보다 월드에서 더 **낮게** 찍혔다).
  // 원인은 제도(`ridgeTopYAt` 프로파일)와 배치(`ridgePoints` 표면 정점)가
  // 같은 능선을 1.64cm 다르게 말한다는 것 — 배치 안에서는 한쪽으로 통일한다.
  //
  // 능선의 **y만** 목점~어깨끝 선형으로 편다. 실제 능선은 목 근처가 가파르고
  // (x 1cm당 1.5cm) 바깥이 평평해서, 호장 비율로 읽으면 첫 표본 하나가 y를
  // 1.05cm 떨어뜨린다 — 뒤목은 깊이가 2.0cm뿐이라 그 한 걸음이 곧 뒤목
  // 전체이고, 그래서 뒤목 반곡선이 목표보다 길어진다. x·z는 능선 그대로라
  // 어깨선은 여전히 능선 위를 지나고, 편 y는 실제 능선보다 **위**에 있어
  // (볼록) 관통을 만들지 않는다.
  const shoulderTopY = ridgeAt(1, 0).y;
  const shoulderTipY = ridgeAt(1, 1).y;
  const shoulderY = (v: number): number =>
    shoulderTopY - (shoulderTopY - shoulderTipY) * (v / Math.max(1e-9, shoulderDropM));
  const heightAt = (v: number): number => (v <= shoulderDropM ? shoulderY(v) : shoulderTipY - (v - shoulderDropM));
  const edgeAt = (sign: number, panelSign: number, v: number, scale: number): Vec3Like => {
    if (v <= shoulderDropM) {
      const p = ridgeAt(sign, v / Math.max(1e-9, shoulderDropM));
      return { x: p.x, y: shoulderY(v), z: p.z };
    }
    const tip = ridgeAt(sign, 1);
    const h = heightAt(v);
    const m = COLLISION_MARGIN * scale;
    const side = { x: body.centerX + sign * (lateralHalfAt(h) + m), y: h, z: body.centerZ + panelSign * m };
    if (v >= armholeDepthM) return side;
    const w = (v - shoulderDropM) / Math.max(1e-9, armholeDepthM - shoulderDropM);
    return { x: tip.x + (side.x - tip.x) * w, y: h, z: tip.z + (side.z - tip.z) * w };
  };

  // (4) 중심선 C(v) — 목선 정점은 **몸 표면 + 옷 오프셋 위**에 두고, 그 정점의
  //     **높이**를 이분법 미지수로 잡는다. z는 그 높이의 표면에서 도출되므로
  //     별도 자유도가 아니다(부풂이 z였던 10회차까지의 형태를 뒤집은 것).
  //
  //     10회차 실측이 이 변경의 근거다 — 배치 원본 링/패턴 초과율이 패턴 크기와
  //     **무관하게** +11.6~14.0%로 고정이었다(패턴 33.24 / 44.89 / 48.24cm 3점).
  //     원인은 `heightAt`이 패턴 목깊이를 세로 낙차로 사상해 목선 정점이 몸의
  //     목밑 폐곡선보다 9.8cm 아래에 놓인 것이었다. 실제 몸에서 그 깊이는
  //     대부분 가슴/등 쪽으로 감아 도는 거리다.
  const surfaceZAt = (h: number, panelSign: number, scale: number): number => {
    const m = COLLISION_MARGIN * scale;
    const pick = (s: { zMin: number; zMax: number }): number => (panelSign > 0 ? s.zMax + m : s.zMin - m);
    if (sliceByY.length === 0) return body.centerZ + panelSign * m;
    if (h <= sliceByY[0].y) return pick(sliceByY[0]);
    for (let i = 1; i < sliceByY.length; i++) {
      if (sliceByY[i].y >= h) {
        const r = (h - sliceByY[i - 1].y) / Math.max(1e-12, sliceByY[i].y - sliceByY[i - 1].y);
        return pick(sliceByY[i - 1]) + (pick(sliceByY[i]) - pick(sliceByY[i - 1])) * r;
      }
    }
    return pick(sliceByY[sliceByY.length - 1]);
  };
  const neckAxis = (() => {
    let best = Infinity, ax = body.centerX, az = body.centerZ;
    for (const sl of body.slices) {
      const d = Math.abs(sl.y - body.neckY);
      if (d < best) { best = d; ax = sl.axisX; az = sl.axisZ; }
    }
    return { x: ax, z: az };
  })();
  const neckDropOf = [draft.dims.frontNeckDropM, draft.dims.backNeckDropM];
  const torsoOffsetOf = [torsoOffsetFront, torsoOffsetBack];
  // 미지수 apexY의 대역. 위 끝은 목점 높이 — 그보다 위면 중심선이 v에 대해
  // 비단조가 되어 행이 서로 넘는다(접힘). 아래 끝은 밑단.
  const apexYHi = neckPointY;
  const apexYLo = heightAt(draft.dims.lengthM);
  const centerAt = (panelIdx: number, panelSign: number, v: number, scale: number, apexY: number): Vec3Like => {
    const drop = neckDropOf[panelIdx];
    const apexZ = surfaceZAt(apexY, panelSign, scale);
    if (v <= drop) {
      // 목점 높이의 목축에서 정점까지 — 상단 행이 등거리에 가깝게 유지된다.
      const t = v / Math.max(1e-9, drop);
      return { x: body.centerX, y: neckPointY + (apexY - neckPointY) * t, z: neckAxis.z + (apexZ - neckAxis.z) * t };
    }
    // 정점 아래는 가장자리와 **같은 밑단 높이**로 내려간다(밑단이 수평이 되고
    // 기울기가 아래로 갈수록 0으로 수렴한다 — 새 상수 없음).
    const rate = (apexY - apexYLo) / Math.max(1e-6, draft.dims.lengthM - drop);
    const y = apexY - (v - drop) * rate;
    const target = torsoOffsetOf[panelIdx] * scale;
    const far = body.centerZ + panelSign * target;
    const r = Math.min(1, (v - drop) / Math.max(1e-6, target));
    return { x: body.centerX, y, z: apexZ + (far - apexZ) * r };
  };

  // (5) 행 곡선 — 중심선 C에서 가장자리 E까지의 사분타원. u는 각도가 아니라
  //     **호장 비율**로 읽는다. 각도로 읽으면 t=1(가장자리)에서 dP/dt = 0이라
  //     어깨 대역의 좁은 띠(폭 1.4cm)가 0.4cm로 뭉개지고, 그 반작용으로 목선이
  //     바깥으로 부풀어 링이 44.6cm가 된다(1차 실행 실측). 호장 매개화면 u
  //     방향이 등거리라 패턴 폭이 그대로 보존된다.
  const ROW_ARC_SAMPLES = 32;
  const rowCum = new Float64Array(ROW_ARC_SAMPLES + 1);
  const mapTorso = (panelIdx: number, xp: number, yp: number, scale: number, apexY: number): Vec3Like => {
    const panelSign = panelIdx === PANEL_PAT_FRONT ? 1 : -1;
    const v = Math.max(0, yp);
    const sign = xp >= 0 ? 1 : -1;
    const u = Math.min(1, Math.abs(xp) / Math.max(1e-9, outerXPanel[panelIdx](v)));
    const e = edgeAt(sign, panelSign, v, scale);
    const c = centerAt(panelIdx, panelSign, v, scale, apexY);
    const dx = e.x - body.centerX, dy = c.y - e.y, dz = c.z - e.z;
    // 형상은 사분타원(x = sin, y·z = cos). 대안으로 x를 t에 선형인 "코사인
    // 아치"도 재봤는데 링 35.96cm·교차 84로 낫지만 관통 1860(vs 1162)·뒤집힘
    // 34(vs 16)로 나빠진다 — 몸을 덜 감싸기 때문이다. 감싸는 쪽을 택한다.
    const at = (t: number): Vec3Like => {
      const sn = Math.sin(t * Math.PI / 2), cs = Math.cos(t * Math.PI / 2);
      return { x: body.centerX + dx * sn, y: e.y + dy * cs, z: e.z + dz * cs };
    };
    if (u <= 0) return at(0);
    if (u >= 1) return at(1);
    let px = body.centerX, py = e.y + dy, pz = e.z + dz;
    rowCum[0] = 0;
    for (let k = 1; k <= ROW_ARC_SAMPLES; k++) {
      const q = at(k / ROW_ARC_SAMPLES);
      rowCum[k] = rowCum[k - 1] + Math.hypot(q.x - px, q.y - py, q.z - pz);
      px = q.x; py = q.y; pz = q.z;
    }
    const want = rowCum[ROW_ARC_SAMPLES] * u;
    for (let k = 1; k <= ROW_ARC_SAMPLES; k++) {
      if (rowCum[k] >= want) {
        const r = (want - rowCum[k - 1]) / Math.max(1e-12, rowCum[k] - rowCum[k - 1]);
        return at((k - 1 + r) / ROW_ARC_SAMPLES);
      }
    }
    return at(1);
  };

  // 정점 높이 이분법 — 낮출수록 반곡선이 길어진다(단조). 대역 끝에서 포화하면
  // 그 자체가 신호다(위쪽 포화 = 패턴 목선이 몸보다 짧다).
  const solveNeckApexY = (panelIdx: number, scale: number): number => {
    const sp = draft.panels[panelIdx].segments.find((s) => s.name === "neck")?.samples ?? [];
    if (sp.length < 2) return 0;
    let target = 0;
    for (let i = 1; i < sp.length; i++) target += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
    const lenAt = (a: number): number => {
      let l = 0;
      for (let i = 1; i < sp.length; i++) {
        const p = mapTorso(panelIdx, sp[i - 1].x, sp[i - 1].y, scale, a);
        const q = mapTorso(panelIdx, sp[i].x, sp[i].y, scale, a);
        l += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      }
      return l;
    };
    neckArcTargetM[panelIdx] = target;
    // 대역 스캔 — 자유도가 실제로 길이를 줄이는지 5점으로 남긴다. 포화가
    // "대역이 좁아서"인지 "함수가 그 방향으로 안 줄어서"인지 구분하는 근거다.
    neckArcScan[panelIdx] = [0, 1, 2, 3, 4].map((k) => {
      const a = apexYLo + ((apexYHi - apexYLo) * k) / 4;
      return { apexY: a, arcM: lenAt(a) };
    });
    if (lenAt(apexYHi) >= target) { neckArcM[panelIdx] = lenAt(apexYHi); neckApexSat[panelIdx] = 1; return apexYHi; }
    if (lenAt(apexYLo) <= target) { neckArcM[panelIdx] = lenAt(apexYLo); neckApexSat[panelIdx] = -1; return apexYLo; }
    let lo = apexYLo, hi = apexYHi;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (lenAt(mid) < target) hi = mid; else lo = mid;
    }
    const a = (lo + hi) / 2;
    neckArcM[panelIdx] = lenAt(a);
    neckApexSat[panelIdx] = 0;
    return a;
  };
  const neckApexYM = [0, 0];
  const neckApexSat = [0, 0];
  const neckArcScan: { apexY: number; arcM: number }[][] = [[], []];
  const neckArcM = [0, 0];
  const neckArcTargetM = [0, 0];

  const place = (offsetScale: number): void => {
    // ── 몸판: 위 (1)~(5)의 합성. 8개 코너는 u=1 값으로 자동 선사상된다.
    for (const panel of [PANEL_PAT_FRONT, PANEL_PAT_BACK] as const) {
      neckApexYM[panel] = solveNeckApexY(panel, offsetScale);
      const start = panelStarts[panel];
      for (let i = 0; i < panelCounts[panel]; i++) {
        const gi = start + i;
        const p = mapTorso(panel, pos2[gi * 2], pos2[gi * 2 + 1], offsetScale, neckApexYM[panel]);
        positions[gi * 3] = p.x;
        positions[gi * 3 + 1] = p.y;
        positions[gi * 3 + 2] = p.z;
      }
    }
    // 소매 — 팔 축 둘레 원통으로 프리벤드. 패턴 y가 곧 팔 축 방향 거리라
    // 소매산 정점(y=0)이 어깨 관절, 겨드랑이 코너(y=캡높이)가 그만큼 팔을
    // 내려간 지점에 온다.
    //
    // §4 S0의 문구는 "반원통"인데 여기서는 **전원통**으로 감는다. 이유:
    // 반원통이면 두 시접 변이 π·r ≈ 18cm 벌어진 채 시작해 S1 램프가 그
    // 거리를 전부 좁혀야 하고, 2a-thin 스파이크가 수렴을 실증한 배치는
    // 전원통이었다(spikePanels.ts). 관통 위험은 게이트로 측정한다.
    for (const [panel, arm, flipSign] of [[PANEL_PAT_SLEEVE_R, armPlus, 1], [PANEL_PAT_SLEEVE_L, armMinus, -1]] as const) {
      const d = norm(arm.dir);
      const up = { x: 0, y: 1, z: 0 };
      // e1 = 팔 축에 직교하는 "위쪽" 방향(어깨 능선 쪽) — 소매산 정점이 이
      // 방향에 놓인다. 축 방향에서 위 성분을 뺀 것이라 상수가 없다.
      const dot = up.x * d.x + up.y * d.y + up.z * d.z;
      const e1 = norm({ x: up.x - d.x * dot, y: up.y - d.y * dot, z: up.z - d.z * dot });
      let e2 = norm(cross(d, e1));
      // e2가 앞(+z)을 향하게 고정한다 — 패턴 x>0 = 앞판 쪽 소매산. 뒤집힌
      // 조각(SLEEVE_L)은 패턴 x가 반전돼 있으므로 e2도 함께 반전해야 앞판
      // 쪽 소매산이 계속 앞을 향한다 — 이 부호 하나가 좌우 배치를 정확한
      // 거울상으로 만든다(미러 쌍 정합 검사가 이것을 잡는다).
      if (e2.z < 0) e2 = { x: -e2.x, y: -e2.y, z: -e2.z };
      if (flipSign < 0) e2 = { x: -e2.x, y: -e2.y, z: -e2.z };
      const radius = sleeveRadiusM + COLLISION_MARGIN * offsetScale;
      const start = panelStarts[panel];
      const base = draft.dims.sleeveHalfWidthM;
      for (let i = 0; i < panelCounts[panel]; i++) {
        const gi = start + i;
        const xp = pos2[gi * 2], yp = pos2[gi * 2 + 1];
        const th = (xp / base) * Math.PI * wrapShrink;
        const c = Math.cos(th), s = Math.sin(th);
        positions[gi * 3] = arm.trueShoulder.x + d.x * yp + (e1.x * c + e2.x * s) * radius;
        positions[gi * 3 + 1] = arm.trueShoulder.y + d.y * yp + (e1.y * c + e2.y * s) * radius;
        positions[gi * 3 + 2] = arm.trueShoulder.z + d.z * yp + (e1.z * c + e2.z * s) * radius;
      }
    }
    for (const s of seams) {
      s.gapM = Math.hypot(
        positions[s.b * 3] - positions[s.a * 3],
        positions[s.b * 3 + 1] - positions[s.a * 3 + 1],
        positions[s.b * 3 + 2] - positions[s.a * 3 + 2],
      );
    }
  };
  place(1);

  const seamCounts: Record<string, number> = {};
  for (const s of seams) seamCounts[s.kind] = (seamCounts[s.kind] ?? 0) + 1;

  return {
    draft,
    panelStarts, panelCounts,
    positions, pos2, uv, tris, panelTriRanges,
    seams, seamGroups, edgePairs, necklineRing, shoulderPairs, mirrorOf,
    selfCollisionMinDistM,
    quality: [
      { panel: "front(절반)", q: half.front.quality },
      { panel: "back(절반)", q: half.back.quality },
      { panel: "sleeve", q: sleeveMesh.quality },
    ],
    place,
    meta: {
      neckApexY: [neckApexYM[0], neckApexYM[1]], neckApexSat: [neckApexSat[0], neckApexSat[1]],
      neckArcScan: [neckArcScan[0], neckArcScan[1]], neckPointY,
      neckArcM: [neckArcM[0], neckArcM[1]], neckArcTargetM: [neckArcTargetM[0], neckArcTargetM[1]],
      armGirthM: 2 * Math.PI * ARM_COLLISION_RADIUS,
      sleeveRadiusM,
      torsoOffsetFrontM: torsoOffsetFront,
      torsoOffsetBackM: torsoOffsetBack,
      anchorY,
      wrapShrink,
      seamCounts,
    },
  };
}

// ── 시접 테이블 자기검사 (task 4: 쌍 수·좌우 대칭·경계 길이 일치) ────────
export interface SeamCheck { name: string; ok: boolean; detail: string }

export function checkPatternGarment(g: PatternGarment): SeamCheck[] {
  const out: SeamCheck[] = [];
  const push = (name: string, ok: boolean, detail: string): void => { out.push({ name, ok, detail }); };
  const panelOf = (i: number): number => {
    for (let p = 3; p >= 0; p--) if (i >= g.panelStarts[p]) return p;
    return 0;
  };

  // 좌우 대칭 — 모든 시접 쌍의 미러 상대도 시접이어야 한다.
  const key = (a: number, b: number): number => Math.min(a, b) * 1_000_000 + Math.max(a, b);
  const set = new Set(g.seams.map((s) => key(s.a, s.b)));
  let missingMirror = 0;
  for (const s of g.seams) if (!set.has(key(g.mirrorOf[s.a], g.mirrorOf[s.b]))) missingMirror++;
  push("시접 좌우 대칭(미러 상대도 시접)", missingMirror === 0, `누락 ${missingMirror} / ${g.seams.length}쌍`);

  // 미러 쌍 정합 — mirrorOf가 대합(involution)이고 좌표가 x 반전인가.
  let mirrorBad = 0, mirrorMaxErrM = 0;
  for (let i = 0; i < g.mirrorOf.length; i++) {
    const j = g.mirrorOf[i];
    if (g.mirrorOf[j] !== i) { mirrorBad++; continue; }
    const err = Math.max(
      Math.abs(g.pos2[i * 2] + g.pos2[j * 2]),
      Math.abs(g.pos2[i * 2 + 1] - g.pos2[j * 2 + 1]),
    );
    if (err > mirrorMaxErrM) mirrorMaxErrM = err;
  }
  push("미러 쌍 정합(대합·x반전)", mirrorBad === 0 && mirrorMaxErrM < 1e-12,
    `비대합 ${mirrorBad} · 최대 좌표 오차 ${(mirrorMaxErrM * 1000).toFixed(9)}mm`);

  // 경계 길이 일치 — 짝 한 벌씩. 암홀만 이즈(3cm)만큼 차이나야 하고 나머지는 0.
  for (const grp of g.seamGroups) {
    const diffCm = Math.abs(grp.arcAM - grp.arcBM) * 100;
    const expectCm = grp.kind === "armhole" ? 1.5 : 0;
    const tolCm = 0.05;
    push(
      `경계 호장 일치(${grp.label})`,
      Math.abs(diffCm - expectCm) <= tolCm,
      `a변 ${(grp.arcAM * 100).toFixed(3)}cm / b변 ${(grp.arcBM * 100).toFixed(3)}cm / 차 ${diffCm.toFixed(3)}cm (기대 ${expectCm.toFixed(2)}cm = 암홀 이즈 3cm의 앞·뒤 절반, 허용 ±${tolCm})`,
    );
  }

  // 시접 쌍이 격자 아닌 **메시 엣지**와 겹치지 않는가(스파이크의 gridPairs
  // 검사와 같은 목적 — 같은 쌍을 두 번 제약하면 rest 램프가 구조 제약의
  // rest까지 끌고 간다).
  const edgeSet = new Set(g.edgePairs.map((e) => key(e.a, e.b)));
  let overlap = 0;
  for (const s of g.seams) if (edgeSet.has(key(s.a, s.b))) overlap++;
  push("시접 ∩ 메시 엣지 = 0", overlap === 0, `겹침 ${overlap}쌍`);

  // 시접이 패널을 넘어가는지(같은 패널 안에서 이어지는 건 소매 wrap만).
  let sameP = 0;
  for (const s of g.seams) if (panelOf(s.a) === panelOf(s.b) && s.kind !== "sleeveUnder") sameP++;
  push("패널 간 시접(wrap 제외)", sameP === 0, `같은 패널 시접 ${sameP}쌍(sleeveUnder 제외)`);

  // 자기충돌 문턱 제약(§3.2: 도출값이 시접 rest보다 작아야 한다)
  push(
    "자기충돌 문턱 < 시접 rest",
    g.selfCollisionMinDistM < SEAM_REST_LENGTH,
    `문턱 ${(g.selfCollisionMinDistM * 1000).toFixed(2)}mm < 시접 rest ${(SEAM_REST_LENGTH * 1000).toFixed(1)}mm`,
  );

  return out;
}
