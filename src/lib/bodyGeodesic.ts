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
  /** 86회차 — 경로가 지난 정점 좌표(출발 → 도착). 경로가 능선을 따라가는지 눈으로 확인하려면 필요하다. */
  pathPoints: { x: number; y: number; z: number }[];
  /**
   * 86회차 — **끝점 스냅 진단.** 질의점이 표면에서 떨어져 있으면(관절 중심 등)
   * 최근접 정점 후보 1·2위의 거리 마진이 작아지고, 미세한 질의점 차이가 순위를 뒤집는다.
   * 그 경우 경로 길이는 「같은 양의 두 판본」이 되므로 좌우 대조에 쓸 수 없다.
   */
  snap: {
    end: "from" | "to";
    /** 질의점 → 스냅된 정점 거리(m). 크면 질의점이 표면 위가 아니다. */
    distM: number;
    /** 1위와 2위 후보의 거리 차(m). 작으면 순위가 불안정하다. */
    marginM: number;
    /** 1·2위 후보가 서로 얼마나 떨어져 있는가(m). 크면 뒤집힘의 대가가 크다. */
    candidateGapM: number;
  }[];
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
  // 최근접 정점과 **2위까지** 낸다 — 스냅 순위가 얼마나 아슬아슬한지가 이 계기의 신뢰도다.
  const nearest = (p: { x: number; y: number; z: number }): { i: number; d: number; i2: number; d2: number } => {
    let best = Infinity, bi = -1, best2 = Infinity, bi2 = -1;
    for (const v of adj.keys()) {
      const d = (position[v * 3] - p.x) ** 2 + (position[v * 3 + 1] - p.y) ** 2 + (position[v * 3 + 2] - p.z) ** 2;
      if (d < best) { best2 = best; bi2 = bi; best = d; bi = v; } else if (d < best2) { best2 = d; bi2 = v; }
    }
    return { i: bi, d: Math.sqrt(best), i2: bi2, d2: Math.sqrt(best2) };
  };
  const ns = nearest(from), nd = nearest(to);
  const src = ns.i, dst = nd.i;
  const gap = (a: number, b: number): number => (a < 0 || b < 0 ? NaN : Math.hypot(
    position[a * 3] - position[b * 3],
    position[a * 3 + 1] - position[b * 3 + 1],
    position[a * 3 + 2] - position[b * 3 + 2],
  ));
  const snap: GeodesicResult["snap"] = [
    { end: "from", distM: ns.d, marginM: ns.d2 - ns.d, candidateGapM: gap(ns.i, ns.i2) },
    { end: "to", distM: nd.d, marginM: nd.d2 - nd.d, candidateGapM: gap(nd.i, nd.i2) },
  ];
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
  const rev: number[] = [dst];
  for (let v = dst; prev.has(v); v = prev.get(v)!) rev.push(prev.get(v)!);
  rev.reverse();
  const pathPoints = rev.map((v) => ({ x: position[v * 3], y: position[v * 3 + 1], z: position[v * 3 + 2] }));
  return { pathM, straightM, hops: rev.length - 1, unreachable: !Number.isFinite(pathM), pathPoints, snap };
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
 * 교선 선분들을 끝점 좌표 용접으로 이어 붙여 **연결 성분(고리)** 으로 가른다.
 * 어깨·팔 대역의 단면은 몸통과 팔을 함께 자르므로 합계만 내면 섞인다 —
 * 상수로 팔을 빼지 않고 연결성으로 가르는 것이 이 저장소의 규율이다(85회차 §3).
 * `flat`은 3D 끝점을 그 평면의 2D 좌표로 보내는 사영이다(키·중심 계산용).
 */
function groupLoops(
  segs: { a: number[]; b: number[]; L: number; back: boolean }[],
  flat: (q: number[]) => [number, number],
): SectionResult["loops"] {
  const key = (q: number[]): string => {
    const [u, v] = flat(q);
    return `${Math.round(u / 1e-4)},${Math.round(v / 1e-4)}`;
  };
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
  return loops;
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
  const loops = groupLoops(segs, (q) => [q[0], q[2]]);
  loops.sort((a, b) => b.totalM - a.totalM);
  return { y, totalM, backM, frontM, segments, loops };
}

export interface AxisSectionResult {
  /** 축을 따라 잰 거리(m). 평면은 이 지점에서 축에 수직이다. */
  sM: number;
  /** 고리 수. 1이면 팔이 몸통과 붙어 **분리 불가**다. */
  loopCount: number;
  /** 축 지점을 품은 고리(= 팔 고리)가 있으면 그 값. 없으면 null. */
  arm: {
    girthM: number;
    /** 둘레에서 낸 등가 반경 = girth / 2π */
    equivRadiusM: number;
    /** 고리 중심이 축에서 얼마나 벗어났는가(m) */
    centerOffsetM: number;
    /** 축 지점 → 단면 점 거리의 통계(m). 원 근사가 얼마나 깨지는가. */
    rMinM: number; rMaxM: number; rMeanM: number; rStdM: number;
    segments: number;
    /**
     * 선분별 [축거리 r0, r1, 선분 길이, 방위각 th0, th1]. 「반경 r인 원기둥 밖에 있는 둘레가
     * 얼마인가」와 「**어느 방향에서** 그런가」를 호출부가 낼 수 있어야 한다 —
     * 등가반경(둘레/2π)은 **방향평균**이라 국소 돌출도 그 방향도 못 잰다(함정 18).
     * `th`는 `basis`를 넘겼을 때만 의미가 있다(안 넘기면 기저가 임의로 세워진다).
     */
    segRadii: [number, number, number, number, number][];
  } | null;
  /** 팔 고리를 뺀 나머지 고리들의 둘레(m) — 몸통 등 */
  otherM: number[];
}

/**
 * 축(origin + dir·s)에 **수직인 평면**으로 메시를 자르고 연결 고리로 가른다.
 * 팔 대역은 수평면으로 자르면 축에 비스듬해 둘레가 부풀므로(85회차 §3(b) y130 참고)
 * 팔 기하를 재려면 축 수직 평면이어야 한다.
 *
 * 팔 고리 선택은 **축 지점을 품은 고리**로 한다 — 반경 상수로 고르지 않는다.
 * 판정: 고리의 2D 중심이 축 지점에 가장 가까운 것. 고리가 1개면 몸통과 붙은 것이므로
 * `arm`을 내지 않고 `loopCount = 1`로 보고한다(분리 불가를 값으로 채우지 않는다).
 */
export function axisSection(
  position: Float32Array,
  index: ArrayLike<number>,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  sM: number,
  /**
   * 평면 안의 기준 방향. **넘기지 않으면 기저가 임의로 세워지고 방위각에 의미가 없다**
   * (87회차는 안 넘겼다 — 등가반경 대조라 방향에 둔감했다).
   * 88회차는 소매 배치 프레임(`patternGarment.ts:490-503`의 e1·e2)을 그대로 넘긴다:
   * 이미 소매 메시가 그 프레임으로 놓여 있고 좌우 미러 정합이 성립하는 유일한 기저다.
   */
  basis?: { u: { x: number; y: number; z: number }; v: { x: number; y: number; z: number } },
): AxisSectionResult {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const n = [dir.x / dl, dir.y / dl, dir.z / dl];
  const o = [origin.x + n[0] * sM, origin.y + n[1] * sM, origin.z + n[2] * sM];
  // 평면 안의 정규직교 기저 — n과 가장 덜 나란한 축에서 만든다.
  const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a: number[], b: number[]): number[] =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: number[]): number[] => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
  // 기저: `basis`가 있으면 그것을 n에 직교화해서 쓰고, 없으면 seed 규칙(방위각 무의미).
  const u = basis
    ? norm((() => { const b = [basis.u.x, basis.u.y, basis.u.z]; const k = b[0] * n[0] + b[1] * n[1] + b[2] * n[2]; return [b[0] - n[0] * k, b[1] - n[1] * k, b[2] - n[2] * k]; })())
    : norm(cross(seed, n));
  const v = basis
    ? norm((() => { const b = [basis.v.x, basis.v.y, basis.v.z]; const k = b[0] * n[0] + b[1] * n[1] + b[2] * n[2]; return [b[0] - n[0] * k, b[1] - n[1] * k, b[2] - n[2] * k]; })())
    : cross(n, u);
  const sd = (v3: number): number =>
    (position[v3 * 3] - o[0]) * n[0] + (position[v3 * 3 + 1] - o[1]) * n[1] + (position[v3 * 3 + 2] - o[2]) * n[2];
  const flat = (q: number[]): [number, number] => {
    const d = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]];
  };
  const segs: { a: number[]; b: number[]; L: number; back: boolean }[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const vs = [index[t], index[t + 1], index[t + 2]];
    const hit: number[][] = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const d0 = sd(vs[i]), d1 = sd(vs[j]);
      if ((d0 < 0 && d1 < 0) || (d0 > 0 && d1 > 0)) continue;
      if (d0 === d1) continue;
      const w = d0 / (d0 - d1);
      if (w < 0 || w > 1) continue;
      hit.push([0, 1, 2].map((k) => position[vs[i] * 3 + k] + (position[vs[j] * 3 + k] - position[vs[i] * 3 + k]) * w));
    }
    if (hit.length !== 2) continue;
    const L = Math.hypot(hit[0][0] - hit[1][0], hit[0][1] - hit[1][1], hit[0][2] - hit[1][2]);
    segs.push({ a: hit[0], b: hit[1], L, back: false });
  }
  // 고리별 통계를 다시 내려면 선분→고리 대응이 필요하다. `groupLoops`는 합계만 주므로
  // 여기서는 같은 용접 키로 한 번 더 묶어 **고리별 선분 목록**을 만든다.
  const key = (q: number[]): string => { const [a, b] = flat(q); return `${Math.round(a / 1e-4)},${Math.round(b / 1e-4)}`; };
  const node = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const e of [s.a, s.b]) { const k = key(e); const l = node.get(k); if (l) l.push(i); else node.set(k, [i]); } });
  const seen = new Uint8Array(segs.length);
  const groups: number[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (seen[i]) continue;
    const stack = [i]; seen[i] = 1; const g: number[] = [];
    while (stack.length) {
      const c = stack.pop()!; g.push(c);
      for (const e of [segs[c].a, segs[c].b]) for (const j of node.get(key(e)) ?? []) if (!seen[j]) { seen[j] = 1; stack.push(j); }
    }
    groups.push(g);
  }
  if (groups.length <= 1) {
    return { sM, loopCount: groups.length, arm: null, otherM: groups.map((g) => g.reduce((a, i) => a + segs[i].L, 0)) };
  }
  const stat = (g: number[]): { girthM: number; cu: number; cv: number; rs: number[]; segRadii: [number, number, number, number, number][] } => {
    let girthM = 0, cu = 0, cv = 0, cnt = 0;
    const rs: number[] = [];
    const segRadii: [number, number, number, number, number][] = [];
    for (const i of g) {
      girthM += segs[i].L;
      const pair: number[] = [], ths: number[] = [];
      for (const e of [segs[i].a, segs[i].b]) {
        const [a, b] = flat(e);
        cu += a; cv += b; cnt++;
        const r = Math.hypot(a, b);
        rs.push(r); pair.push(r); ths.push(Math.atan2(b, a));
      }
      segRadii.push([pair[0], pair[1], segs[i].L, ths[0], ths[1]]);
    }
    return { girthM, cu: cu / (cnt || 1), cv: cv / (cnt || 1), rs, segRadii };
  };
  const stats = groups.map(stat);
  // 팔 고리 = 중심이 축 지점(평면 원점)에 가장 가까운 고리.
  let bi = 0;
  for (let i = 1; i < stats.length; i++) {
    if (Math.hypot(stats[i].cu, stats[i].cv) < Math.hypot(stats[bi].cu, stats[bi].cv)) bi = i;
  }
  const s = stats[bi];
  const mean = s.rs.reduce((a, b) => a + b, 0) / (s.rs.length || 1);
  const varr = s.rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.rs.length || 1);
  return {
    sM,
    loopCount: groups.length,
    arm: {
      girthM: s.girthM,
      equivRadiusM: s.girthM / (2 * Math.PI),
      centerOffsetM: Math.hypot(s.cu, s.cv),
      rMinM: Math.min(...s.rs), rMaxM: Math.max(...s.rs), rMeanM: mean, rStdM: Math.sqrt(varr),
      segments: groups[bi].length,
      segRadii: s.segRadii,
    },
    otherM: stats.filter((_, i) => i !== bi).map((q) => q.girthM),
  };
}

/**
 * 소매 배치 프레임 — `patternGarment.ts:490-503`과 **같은 식**이다.
 * 88회차가 방위각 기저로 채택했고 89회차도 같은 θ를 쓴다. 두 곳이 갈리면 회차 간 대조가 끊기므로
 * 한 군데로 모은다(식을 옮겨 적지 않는다).
 *   e1 = 팔축에 직교하는 「위쪽」(어깨 능선 쪽 · 소매산 정점이 놓이는 방향) · θ=0
 *   e2 = 앞(+z 고정 · 미러 패널은 flipSign으로 반전) · θ=+π/2
 */
export function sleeveArmFrame(
  dir: { x: number; y: number; z: number },
  flipSign: number,
): { d: number[]; e1: number[]; e2: number[] } {
  const nrm = (a: number[]): number[] => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
  const crs = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = nrm([dir.x, dir.y, dir.z]);
  const k = d[1]; // up=(0,1,0)과의 내적
  const e1 = nrm([-d[0] * k, 1 - d[1] * k, -d[2] * k]);
  let e2 = nrm(crs(d, e1));
  if (e2[2] < 0) e2 = e2.map((q) => -q);
  if (flipSign < 0) e2 = e2.map((q) => -q);
  return { d, e1, e2 };
}

/**
 * 점 → 삼각형 최근접점(평탄 배열 9개씩). 정점 최근접이 아니라 **면** 최근접이다.
 * 89회차 필요: 정점 최근접은 삼각형 최근접보다 최대 「엣지 절반」만큼 과대평가하는데
 * 소매 패널 엣지가 5.3~22.3mm(평균 13.9mm)라 그 편향이 해석 중인 차(0.76cm)와 **같은 자릿수**다.
 * 반환은 최근접점 좌표와 거리.
 */
export function closestPointOnTriangles(
  tris: Float32Array,
  px: number, py: number, pz: number,
): { x: number; y: number; z: number; distM: number; tri: number } {
  let bestD2 = Infinity, bx = 0, by = 0, bz = 0, bt = -1;
  for (let o = 0; o + 8 < tris.length; o += 9) {
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const abx = tris[o + 3] - ax, aby = tris[o + 4] - ay, abz = tris[o + 5] - az;
    const acx = tris[o + 6] - ax, acy = tris[o + 7] - ay, acz = tris[o + 8] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let cx: number, cy: number, cz: number;
    if (d1 <= 0 && d2 <= 0) { cx = ax; cy = ay; cz = az; } else {
      const bpx = px - tris[o + 3], bpy = py - tris[o + 4], bpz = pz - tris[o + 5];
      const d3 = abx * bpx + aby * bpy + abz * bpz;
      const d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { cx = tris[o + 3]; cy = tris[o + 4]; cz = tris[o + 5]; } else {
        const cpx = px - tris[o + 6], cpy = py - tris[o + 7], cpz = pz - tris[o + 8];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { cx = tris[o + 6]; cy = tris[o + 7]; cz = tris[o + 8]; } else {
          const vc = d1 * d4 - d3 * d2;
          if (vc <= 0 && d1 >= 0 && d3 <= 0) {
            const v = d1 / (d1 - d3);
            cx = ax + abx * v; cy = ay + aby * v; cz = az + abz * v;
          } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              const w = d2 / (d2 - d6);
              cx = ax + acx * w; cy = ay + acy * w; cz = az + acz * w;
            } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                cx = tris[o + 3] + (tris[o + 6] - tris[o + 3]) * w;
                cy = tris[o + 4] + (tris[o + 7] - tris[o + 4]) * w;
                cz = tris[o + 5] + (tris[o + 8] - tris[o + 5]) * w;
              } else {
                const den = 1 / (va + vb + vc);
                const v = vb * den, w = vc * den;
                cx = ax + abx * v + acx * w; cy = ay + aby * v + acy * w; cz = az + abz * v + acz * w;
              }
            }
          }
        }
      }
    }
    const dd = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;
    if (dd < bestD2) { bestD2 = dd; bx = cx; by = cy; bz = cz; bt = o / 9; }
  }
  return { x: bx, y: by, z: bz, distM: Math.sqrt(bestD2), tri: bt };
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
  // `axisSection` — 같은 상자 + x로 10 떨어진 사본(= 「몸통」). y축 수직 평면으로 자르면
  // 고리 2개가 나오고, 축 지점을 품은 쪽(원본)만 골라야 한다. 기대 둘레 6.
  const far = Float32Array.from([...position].map((v, i) => (i % 3 === 0 ? v + 10 : v)));
  const both = Float32Array.from([...position, ...far]);
  const idx2 = [...index, ...index.map((v) => v + position.length / 3)];
  const ax = axisSection(both, idx2, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 2);
  const okAx = ax.loopCount === 2 && ax.arm !== null && near(ax.arm.girthM, 6)
    && near(ax.arm.equivRadiusM, 6 / (2 * Math.PI)) && ax.arm.centerOffsetM < 1e-6;
  // `closestPointOnTriangles` — 삼각형 (0,0,0)(1,0,0)(0,1,0) 하나.
  //   내부 위 점(0.25,0.25,3) → 최근접 = 수직 투영, 거리 3
  //   꼭짓점 밖 점(−1,−1,0)   → 최근접 = 꼭짓점 (0,0,0), 거리 √2
  const tri1 = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cIn = closestPointOnTriangles(tri1, 0.25, 0.25, 3);
  const cOut = closestPointOnTriangles(tri1, -1, -1, 0);
  const okTri = near(cIn.distM, 3) && near(cIn.x, 0.25) && near(cIn.y, 0.25) && near(cIn.z, 0)
    && near(cOut.distM, Math.SQRT2) && near(cOut.x, 0) && near(cOut.y, 0);
  const ok = near(sec.totalM, 6) && near(sec.backM, 3) && near(sec.frontM, 3)
    && near(g.pathM, 2) && near(g.straightM, 2) && okAx && okTri;
  return `자체검사 ${ok ? "PASS" : "**FAIL**"} — 직육면체: 단면 둘레 ${sec.totalM.toFixed(4)}(기대 6) ·`
    + ` 후면 ${sec.backM.toFixed(4)}(기대 3) · 표면경로 ${g.pathM.toFixed(4)}(기대 2) · 직선 ${g.straightM.toFixed(4)}(기대 2)`
    + ` │ 축수직단면: 고리 ${ax.loopCount}(기대 2) · 축 고리 둘레 ${(ax.arm?.girthM ?? -1).toFixed(4)}(기대 6)`
    + ` · 중심편차 ${((ax.arm?.centerOffsetM ?? -1) * 1000).toFixed(4)}mm(기대 0)`
    + ` │ 점-삼각형: 내부 ${cIn.distM.toFixed(4)}(기대 3) · 꼭짓점밖 ${cOut.distM.toFixed(4)}(기대 1.4142)`;
}
