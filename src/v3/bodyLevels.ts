/* v3-52 §1-2 — **몸 높이 도출**(`Y_LOW` · `Y_ARM` · `chestY` · `waistY`). **물리 0프레임 · 몸 메시만.**
 * 규칙은 `docs/v3/33-가슴재정의와5행표.md` §1 이 «먼저» 확정했다(커밋 `64abf32`).
 * 기계는 v3-51 §1-1 그대로이고 «규칙 절»만 바뀌었다 — chestY 는 **겨드랑이 밑**(규격 의미론)이다.
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · console 0 — 브라우저 워커와 Node 계기가 «같은 것»을 쓴다.
 */
import { TOL_SELF } from './consts.ts';

export type Seg = { e0: number; e1: number; p0: [number, number]; p1: [number, number] };
export type Levels = {
  Y_LOW: number; Y_ARM: number; chestY: number; waistY: number;
  C_chest: number; C_waist: number;
  /** `Y_ARM` 전이에서 «새로 생긴» 성분들의 |x| 대역 — §1-3 한계 확인용(사실 인쇄 전용). */
  armFirst: { n: number; xMin: number; xMax: number }[];
  /** 진단 전용 격자 표(1cm) — 판정량 아님. */
  grid: { y: number; nComp: number; C: number }[];
  waistGridIx: number;
};

/** §1-2 ① 평면 정확 단면 — 절단 삼각형마다 선분 1개. 끝점 식별은 «엣지» 정수 키(문턱 0). */
export function sectionSegs(pos: Float32Array, idx: Uint32Array, y: number): Seg[] {
  const out: Seg[] = [];
  const nv = pos.length / 3;
  const key = (a: number, c: number) => (a < c ? a * nv + c : c * nv + a);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const hit: { e: number; p: [number, number] }[] = [];
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3];
      const fp = pos[p * 3 + 1] - y, fq = pos[q * 3 + 1] - y;
      if ((fp > 0) === (fq > 0)) continue;
      const u = fp / (fp - fq);
      hit.push({ e: key(p, q),
        p: [pos[p * 3] + u * (pos[q * 3] - pos[p * 3]), pos[p * 3 + 2] + u * (pos[q * 3 + 2] - pos[p * 3 + 2])] });
    }
    if (hit.length === 2) out.push({ e0: hit[0].e, e1: hit[1].e, p0: hit[0].p, p1: hit[1].p });
  }
  return out;
}

/** §1-2 ② 연결 성분 — 같은 «엣지»를 공유하는 선분끼리(union-find · 근접 문턱 0). */
export function components(segs: Seg[]): Seg[][] {
  const par = segs.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const be = new Map<number, number>();
  segs.forEach((s, i) => {
    for (const e of [s.e0, s.e1]) {
      const j = be.get(e);
      if (j === undefined) be.set(e, i);
      else { const a = find(i), c = find(j); if (a !== c) par[a] = c; }
    }
  });
  const g = new Map<number, Seg[]>();
  segs.forEach((s, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r)!.push(s); });
  return [...g.values()];
}

/** §1-2 ③ 축점 (x=0, z=axisZ) 을 «내부»에 품는가 — 광선 짝수-홀수(문턱 0). */
export function containsAxis(loop: Seg[], axisZ: number): boolean {
  let ins = false;
  for (const s of loop) {
    const [x0, z0] = s.p0, [x1, z1] = s.p1;
    if ((z0 > axisZ) !== (z1 > axisZ)) {
      const xc = x0 + ((axisZ - z0) / (z1 - z0)) * (x1 - x0);
      if (xc > 0) ins = !ins;
    }
  }
  return ins;
}

/** §1-2 ④ 볼록 껍질(monotone chain · 정확) 둘레. 각도 표본·δ 를 쓰지 않는다. */
export function hullPerim(loop: Seg[]): number {
  const pts: [number, number][] = [];
  for (const s of loop) { pts.push(s.p0); pts.push(s.p1); }
  if (pts.length < 3) return NaN;
  pts.sort((a, c) => (a[0] - c[0]) || (a[1] - c[1]));
  const cr = (o: [number, number], a: [number, number], c: [number, number]) =>
    (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const half = (src: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of src) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
    return h;
  };
  const lo = half(pts), hi = half([...pts].reverse());
  const H = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  if (H.length < 3) return NaN;
  let s = 0;
  for (let i = 0; i < H.length; i++) { const a = H[i], c = H[(i + 1) % H.length]; s += Math.hypot(a[0] - c[0], a[1] - c[1]); }
  return s;
}

/** 진단 전용 이산화 — 등재 1cm 규약(v2 `bodyMeasure` 슬라이스 · v3-44 「1cm bin」). */
export const GRID_M = 0.01;

/**
 * §1-2 도출. `throw` 는 사전 등록 갈래(B)의 발화이고 **문언을 여기 적는다**.
 * `yTop` 은 등재량(`garmentScene.Y_TOP`), `axisZ` 는 `AXIS_Z`.
 */
export function deriveLevels(pos: Float32Array, idx: Uint32Array, axisZ: number, yTop: number): Levels {
  const at = (y: number) => {
    const comps = components(sectionSegs(pos, idx, y));
    const torso = comps.find((L) => containsAxis(L, axisZ));
    return { comps, nComp: comps.length, hasTorso: !!torso, C: torso ? hullPerim(torso) : NaN };
  };
  const bisect = (yTrue: number, yFalse: number, pred: (y: number) => boolean): [number, number] => {
    let a = yTrue, c = yFalse;
    for (let i = 0; i < 200 && Math.abs(a - c) > TOL_SELF; i++) {
      const m = (a + c) / 2;
      if (pred(m)) a = m; else c = m;
    }
    return [a, c];
  };

  /* `Y_LOW` — 몸통 고리가 «사라지는» 높이(가랑이 · 성분 1→2). v3-51 과 같은 절. */
  let yA = yTop;
  for (; yA > -1 && !at(yA).hasTorso; yA -= GRID_M);
  let yB = yA;
  for (; yB > -1 && at(yB).hasTorso; yB -= GRID_M);
  if (yB <= -1) throw new Error('몸통 고리가 사라지는 높이를 못 찾는다 — 갈래 B');
  const Y_LOW = bisect(yB + GRID_M, yB, (y) => at(y).hasTorso)[0];

  /* `chestY`·`Y_ARM` — **팔이 몸통 고리에 «흡수»되는 높이**(= 겨드랑이).
   * v4-39 §0-3 등재 문언 그대로다. 몸통 고리는 축점을 품는 성분이고, 겨드랑이 밑에서는 몸통만,
   * 겨드랑이를 지나면 **같은 고리가 팔 표면까지 감싼다** ⟹ 그 둘레 `C(y)` 가 **불연속으로 뛴다**.
   * ★ 구 규칙(성분 1 → >1 «첫» 전이 · 이력)은 실은 **팔 표면의 «최저점»** 을 집었다 —
   *   T포즈에서만 우연히 겨드랑이 근처였고(전이 성분의 |x| 754 mm), A포즈에서는 **손끝**을 집어
   *   `chestY` 가 `waistY` 아래로 내려갔다(v4-38 §1-③ 실측). 포즈 불변인 사건으로 바꾼다.
   * ★ 문턱 0 — 「상대 증가가 «최대»인 전이」는 극값 규칙이고(허리의 최소와 같은 성격),
   *   이분법 술어의 중점 `(C_lo + C_hi)/2` 도 **그 몸에서 잰 두 값**에서 뜬다(손 상수 0). */
  const cGrid: { y: number; C: number }[] = [];
  for (let y = Y_LOW + GRID_M; y <= yTop; y += GRID_M) {
    const a = at(y);
    if (Number.isFinite(a.C)) cGrid.push({ y, C: a.C });
  }
  let jump = -1, best = 1;
  for (let i = 0; i + 1 < cGrid.length; i++) {
    const r = cGrid[i + 1].C / cGrid[i].C;
    if (r > best) { best = r; jump = i; }
  }
  if (jump < 0) throw new Error('팔이 몸통 고리에 흡수되는 전이를 못 찾는다 — 갈래 B');
  const cMid = (cGrid[jump].C + cGrid[jump + 1].C) / 2;
  const [lowSide, hiSide] = bisect(cGrid[jump].y, cGrid[jump + 1].y, (y) => at(y).C < cMid);
  const chestY = lowSide, Y_ARM = hiSide;
  const C_chest = at(chestY).C;

  /* §1-3 한계 확인 — 전이 «위»에서 새로 생긴 성분들의 |x| 대역(사실 인쇄 전용). */
  const armFirst = at(Y_ARM).comps
    .filter((L) => !containsAxis(L, axisZ))
    .map((L) => {
      let xMin = Infinity, xMax = -Infinity;
      for (const s of L) for (const p of [s.p0, s.p1]) { const ax = Math.abs(p[0]); xMin = Math.min(xMin, ax); xMax = Math.max(xMax, ax); }
      return { n: L.length, xMin, xMax };
    })
    .sort((a, b) => a.xMin - b.xMin);

  /* `waistY` — 몸통 고리가 «존재하는 전 구간» 안에서 C 의 «내부» 최소.
   * v4-38 §1-② — 구 규칙의 창은 `(Y_LOW, chestY)` 였다. 그 상한은 «팔이 단면에 들어오면
   * 몸통 판정이 흐려진다»는 우려에서 온 것인데, `at()` 는 **축점을 품는 고리**만 쓰므로
   * 팔이 있어도 몸통 둘레는 그대로 정의된다(위 `armFirst` 가 그 사실을 인쇄해 왔다).
   * A포즈 몸에서는 팔이 내려와 `chestY` 가 **팔 표면의 최저점**(손끝)으로 내려가고,
   * 그 아래로 잘린 창에서는 C 가 단조 감소해 최소가 «끝»에 붙는다 — 그것이 v4-24~37 의 던짐이다.
   * ⟹ 창의 상한을 **몸통 고리가 존재하는 높이 전부**로 넓힌다(손 상수 0 · 몸에서 유도).
   *   T포즈에서는 chestY 위의 C 가 전부 허리 최소보다 크므로 **같은 최소·같은 이웃**을 집는다
   *   (v4-38 §1-② 회귀에서 층3 6/6 동일로 확인). */
  const grid: { y: number; nComp: number; C: number }[] = [];
  for (let y = Y_LOW + GRID_M; y <= yTop; y += GRID_M) {
    const a = at(y);
    if (Number.isFinite(a.C)) grid.push({ y, nComp: a.nComp, C: a.C });
  }
  if (grid.length < 3) throw new Error(`허리 구간 격자점 ${grid.length}개 — 극값 판정 불가 · 갈래 B`);
  const jMin = grid.reduce((b, q, i) => (q.C < grid[b].C ? i : b), 0);
  if (jMin === 0 || jMin === grid.length - 1) throw new Error('C 최소가 구간 «끝»에 붙는다(내부 극값 없음) — 갈래 B');
  /* 삼분 탐색 — 격자 이웃 안에서 `TOL_SELF` 까지. */
  let a2 = grid[jMin - 1].y, c2 = grid[jMin + 1].y;
  for (let i = 0; i < 200 && c2 - a2 > TOL_SELF; i++) {
    const m1 = a2 + (c2 - a2) / 3, m2 = c2 - (c2 - a2) / 3;
    if (at(m1).C < at(m2).C) c2 = m2; else a2 = m1;
  }
  const waistY = (a2 + c2) / 2;
  return { Y_LOW, Y_ARM, chestY, waistY, C_chest, C_waist: at(waistY).C, armFirst, grid, waistGridIx: jMin };
}
