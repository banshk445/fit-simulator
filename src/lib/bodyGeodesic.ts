// 몸 표면 기하 실측 — 측지 경로 길이와 수평 단면 둘레. (85회차 §1)
//
// 왜 필요했나: 표적 ①(후면 삼각근 패치 노출 54.2%)이 **패턴 층위**로 확정됐다(84 §3).
// 「패턴 치수가 부족한가」를 물으려면 **몸 쪽 길이를 패턴과 무관하게 먼저 재야 한다**
// (원리/몸에서-가져와라). 패턴 값을 먼저 읽고 몸을 맞추면 대조가 아니라 사후 정당화가 된다.
//
// 두 계기 모두 **좌표 용접**을 쓴다 — 이 메시는 UV 접합으로 좌표가 같은데 인덱스가 다른
// 정점이 1,383개 있고(84 §4-3), 인덱스 기준으로 연결성을 보면 표면이 끊겨 보인다.

/** 좌표 양자화 용접 — 84회차 `countOpenEdgesWelded`와 같은 격자(기본 0.1mm). */
function weldMap(position: Float32Array, quantM: number): Int32Array {
  const rep = new Int32Array(position.length / 3);
  const seen = new Map<string, number>();
  for (let i = 0; i < rep.length; i++) {
    const q = (k: number) => Math.round(position[i * 3 + k] / quantM);
    const key = `${q(0)},${q(1)},${q(2)}`;
    const r = seen.get(key);
    if (r === undefined) { seen.set(key, i); rep[i] = i; } else rep[i] = r;
  }
  return rep;
}

export interface GeodesicResult {
  /** 메시 엣지를 따라간 최단 경로 길이(m). 참 측지의 **상한**이다. */
  pathM: number;
  /** 두 끝점의 직선 거리(m) */
  straightM: number;
  /** 경로가 지난 정점 수 */
  hops: number;
  /** 목적지에 닿지 못했으면 true(연결 성분이 갈림) */
  unreachable: boolean;
}

/**
 * 몸 표면 위 두 점 사이의 **엣지 그래프 최단 경로**. 참 측지선이 아니라 그 상한이다
 * (엣지를 따라가므로 항상 ≥ 참 측지). 이름을 「측지」로 쓰지 않는 이유다(함정 13).
 */
export function surfacePathLength(
  position: Float32Array,
  index: ArrayLike<number>,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  quantM = 1e-4,
): GeodesicResult {
  const rep = weldMap(position, quantM);
  const adj = new Map<number, Map<number, number>>();
  const link = (a: number, b: number): void => {
    if (a === b) return;
    const d = Math.hypot(
      position[a * 3] - position[b * 3],
      position[a * 3 + 1] - position[b * 3 + 1],
      position[a * 3 + 2] - position[b * 3 + 2],
    );
    let m = adj.get(a);
    if (!m) { m = new Map(); adj.set(a, m); }
    const prev = m.get(b);
    if (prev === undefined || d < prev) m.set(b, d);
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const v = [rep[index[t]], rep[index[t + 1]], rep[index[t + 2]]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) { link(v[i], v[j]); link(v[j], v[i]); }
  }
  const nearest = (p: { x: number; y: number; z: number }): number => {
    let best = Infinity, bi = -1;
    for (const v of adj.keys()) {
      const d = (position[v * 3] - p.x) ** 2 + (position[v * 3 + 1] - p.y) ** 2 + (position[v * 3 + 2] - p.z) ** 2;
      if (d < best) { best = d; bi = v; }
    }
    return bi;
  };
  const src = nearest(from), dst = nearest(to);
  const straightM = Math.hypot(
    position[src * 3] - position[dst * 3],
    position[src * 3 + 1] - position[dst * 3 + 1],
    position[src * 3 + 2] - position[dst * 3 + 2],
  );
  // 다익스트라 — 이 규모(정점 2만 대)에서는 정렬 배열 큐로 충분하다.
  // ponytail: O(V log V)가 아니라 선형 스캔 큐. 정점이 10배가 되면 힙으로 바꿀 것.
  const dist = new Map<number, number>([[src, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  for (;;) {
    let u = -1, bd = Infinity;
    for (const [v, d] of dist) if (!done.has(v) && d < bd) { bd = d; u = v; }
    if (u < 0 || u === dst) break;
    done.add(u);
    for (const [v, w] of adj.get(u) ?? []) {
      const nd = bd + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
    }
  }
  const pathM = dist.get(dst) ?? Infinity;
  let hops = 0;
  for (let v = dst; prev.has(v); v = prev.get(v)!) hops++;
  return { pathM, straightM, hops, unreachable: !Number.isFinite(pathM) };
}

export interface SectionResult {
  y: number;
  /** 단면 전체 둘레(m) */
  totalM: number;
  /** z < centerZ 쪽(후면) 길이(m) */
  backM: number;
  /** z >= centerZ 쪽(전면) 길이(m) */
  frontM: number;
  segments: number;
  /**
   * 연결 고리별 분해. 어깨 높이의 수평면은 **몸통과 두 팔을 함께 자른다** —
   * 합계만 내면 팔 단면이 섞여 암홀 길이와 대조할 수 없다(85회차 1차 실행에서 실제로
   * y130 둘레가 153cm로 나왔다). 상수로 팔을 빼지 않고 **연결 성분으로 가른다**.
   * xCenter 순이 아니라 길이 내림차순으로 준다.
   */
  loops: { totalM: number; backM: number; frontM: number; xCenter: number; segments: number }[];
}

/**
 * 높이 y의 수평 평면과 메시의 교선 길이. 삼각형별 선분을 모아 합한다
 * (닫힌 고리로 정렬하지 않는다 — 길이 합은 순서에 무관하다).
 */
export function horizontalSection(
  position: Float32Array,
  index: ArrayLike<number>,
  y: number,
  centerZ: number,
): SectionResult {
  let totalM = 0, backM = 0, frontM = 0, segments = 0;
  const p = (v: number, k: number): number => position[v * 3 + k];
  const segs: { a: number[]; b: number[]; L: number; back: boolean }[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]];
    const hit: number[][] = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const y0 = p(v[i], 1), y1 = p(v[j], 1);
      if ((y0 < y && y1 < y) || (y0 > y && y1 > y)) continue;
      if (y0 === y1) continue;
      const s = (y - y0) / (y1 - y0);
      if (s < 0 || s > 1) continue;
      hit.push([
        p(v[i], 0) + (p(v[j], 0) - p(v[i], 0)) * s,
        y,
        p(v[i], 2) + (p(v[j], 2) - p(v[i], 2)) * s,
      ]);
    }
    if (hit.length !== 2) continue; // 꼭짓점을 정확히 지나는 퇴화 경우는 버린다
    const L = Math.hypot(hit[0][0] - hit[1][0], hit[0][2] - hit[1][2]);
    const back = (hit[0][2] + hit[1][2]) / 2 < centerZ;
    totalM += L;
    segments++;
    if (back) backM += L; else frontM += L;
    segs.push({ a: hit[0], b: hit[1], L, back });
  }
  // 끝점을 좌표 용접해 이어 붙여 연결 성분(고리)을 만든다. 상수는 용접 격자뿐이다.
  const key = (q: number[]): string => `${Math.round(q[0] / 1e-4)},${Math.round(q[2] / 1e-4)}`;
  const node = new Map<string, number[]>(); // 끝점 키 → 인접 선분 목록
  segs.forEach((s, i) => {
    for (const e of [s.a, s.b]) {
      const k = key(e);
      const l = node.get(k);
      if (l) l.push(i); else node.set(k, [i]);
    }
  });
  const seenSeg = new Uint8Array(segs.length);
  const loops: SectionResult["loops"] = [];
  for (let i = 0; i < segs.length; i++) {
    if (seenSeg[i]) continue;
    const stack = [i];
    seenSeg[i] = 1;
    let lt = 0, lb = 0, lf = 0, xs = 0, n = 0;
    while (stack.length) {
      const s = segs[stack.pop()!];
      lt += s.L; if (s.back) lb += s.L; else lf += s.L;
      xs += (s.a[0] + s.b[0]) / 2; n++;
      for (const e of [s.a, s.b]) for (const j of node.get(key(e)) ?? []) {
        if (!seenSeg[j]) { seenSeg[j] = 1; stack.push(j); }
      }
    }
    loops.push({ totalM: lt, backM: lb, frontM: lf, xCenter: xs / (n || 1), segments: n });
  }
  loops.sort((a, b) => b.totalM - a.totalM);
  return { y, totalM, backM, frontM, segments, loops };
}

/**
 * 자체 검사 — 축 정렬 직육면체(가로 2 · 세로 4 · 깊이 1). 알려진 값과 대조한다.
 *   중간 높이 단면 둘레 = 2*(2+1) = 6 · 후면(z<0) = 절반 = 3
 *   아래앞왼 모서리 → 아래앞오른 모서리 표면 경로 = 직선 2(같은 엣지 위)
 */
export function bodyGeodesicSelfCheck(): string {
  // 8정점 직육면체: x ±1 · y 0..4 · z ±0.5
  const P: number[] = [];
  for (const x of [-1, 1]) for (const yv of [0, 4]) for (const z of [-0.5, 0.5]) P.push(x, yv, z);
  const position = Float32Array.from(P);
  const id = (xi: number, yi: number, zi: number): number => xi * 4 + yi * 2 + zi;
  const quad = (a: number, b: number, c: number, d: number): number[] => [a, b, c, a, c, d];
  const index = [
    ...quad(id(0, 0, 0), id(0, 0, 1), id(0, 1, 1), id(0, 1, 0)), // x=-1
    ...quad(id(1, 0, 0), id(1, 1, 0), id(1, 1, 1), id(1, 0, 1)), // x=+1
    ...quad(id(0, 0, 0), id(1, 0, 0), id(1, 0, 1), id(0, 0, 1)), // y=0
    ...quad(id(0, 1, 0), id(0, 1, 1), id(1, 1, 1), id(1, 1, 0)), // y=4
    ...quad(id(0, 0, 0), id(0, 1, 0), id(1, 1, 0), id(1, 0, 0)), // z=-0.5
    ...quad(id(0, 0, 1), id(1, 0, 1), id(1, 1, 1), id(0, 1, 1)), // z=+0.5
  ];
  const sec = horizontalSection(position, index, 2, 0);
  const g = surfacePathLength(position, index, { x: -1, y: 0, z: -0.5 }, { x: 1, y: 0, z: -0.5 });
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const ok = near(sec.totalM, 6) && near(sec.backM, 3) && near(sec.frontM, 3) && near(g.pathM, 2) && near(g.straightM, 2);
  return `자체검사 ${ok ? "PASS" : "**FAIL**"} — 직육면체: 단면 둘레 ${sec.totalM.toFixed(4)}(기대 6) ·`
    + ` 후면 ${sec.backM.toFixed(4)}(기대 3) · 표면경로 ${g.pathM.toFixed(4)}(기대 2) · 직선 ${g.straightM.toFixed(4)}(기대 2)`;
}
