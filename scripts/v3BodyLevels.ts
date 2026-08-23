/* v3-51 §2 — **몸 높이 도출 계기**(chestY · waistY). **물리 0프레임 · 몸 메시만 읽는다.**
 * 규칙은 `docs/v3/32-요건과몸높이도출.md` §1 이 «먼저» 확정했다 — 이 파일은 그 규칙의 구현이고
 * 새 수를 도입하지 않는다(§1-5 표). v2 임포트 0 · v2 데이터 읽기 0 · `V2DIMS` 미사용(G1).
 * 진입: `npx tsx scripts/v3BodyLevels.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, TOL_SELF } from '../src/v3/consts.ts';

const b = readFileSync('public/models/mannequin.glb');
const P = prepare({ glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  fabric: FABRICS.gray, d: 0.009, garment: DEFAULT_GARMENT, minPairDistLite });
const pos = P.prim0.pos, idx = P.bodyIdx;
const { Y_TOP, Y_NECK, AXIS_Z } = P.S;

/** §1-1 ① 평면 정확 단면 — 절단 삼각형마다 «선분 1개». 끝점은 «절단된 엣지»로 식별한다. */
type Seg = { e0: number; e1: number; p0: [number, number]; p1: [number, number] };
function sectionSegs(y: number): Seg[] {
  const out: Seg[] = [];
  const nv = pos.length / 3;
  const key = (a: number, c: number) => (a < c ? a * nv + c : c * nv + a);   // 정수 키 · 문턱 0
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

/** §1-1 ② 연결 성분 — 같은 «엣지»를 공유하는 선분끼리 묶는다(union-find · 근접 문턱 0). */
function components(segs: Seg[]): Seg[][] {
  const par = segs.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  const byEdge = new Map<number, number>();
  segs.forEach((s, i) => {
    for (const e of [s.e0, s.e1]) {
      const j = byEdge.get(e);
      if (j === undefined) byEdge.set(e, i);
      else { const a = find(i), c = find(j); if (a !== c) par[a] = c; }
    }
  });
  const g = new Map<number, Seg[]>();
  segs.forEach((s, i) => { const r = find(i); (g.get(r) ?? g.set(r, []).get(r)!).push(s); });
  return [...g.values()];
}

/** §1-1 ③ 축점 (x=0, z=AXIS_Z) 을 «내부»에 품는가 — 광선 짝수-홀수 교차(문턱 0). */
function containsAxis(loop: Seg[]): boolean {
  const X = 0, Z = AXIS_Z;
  let inside = false;
  for (const s of loop) {
    const [x0, z0] = s.p0, [x1, z1] = s.p1;
    if ((z0 > Z) !== (z1 > Z)) {
      const xc = x0 + ((Z - z0) / (z1 - z0)) * (x1 - x0);
      if (xc > X) inside = !inside;
    }
  }
  return inside;
}

/** §1-1 ④ 볼록 껍질(monotone chain · 정확) 둘레. 각도 표본·δ 를 쓰지 않는다. */
function hullPerim(loop: Seg[]): number {
  const pts: [number, number][] = [];
  for (const s of loop) { pts.push(s.p0); pts.push(s.p1); }
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
  for (let i = 0; i < H.length; i++) {
    const a = H[i], c = H[(i + 1) % H.length];
    s += Math.hypot(a[0] - c[0], a[1] - c[1]);
  }
  return s;
}

/** 한 높이의 «단면 사실»: 성분 수 · 몸통 고리 유무 · C(y). */
function at(y: number) {
  const comps = components(sectionSegs(y));
  const torso = comps.find(containsAxis);
  return { nComp: comps.length, hasTorso: !!torso, C: torso ? hullPerim(torso) : NaN };
}

/** §1-4 위상 전이를 TOL_SELF 까지 이분한다. `pred` 가 true 인 쪽이 «위». */
function bisect(yTrue: number, yFalse: number, pred: (y: number) => boolean): number {
  let a = yTrue, c = yFalse;
  for (let i = 0; i < 200 && Math.abs(a - c) > TOL_SELF; i++) {
    const m = (a + c) / 2;
    if (pred(m)) a = m; else c = m;
  }
  return (a + c) / 2;
}

const GRID = 0.01;                                    // §1-4 진단 전용 이산화(등재 1cm 규약)
console.log(`[v3BodyLevels] 몸 정점 ${pos.length / 3} · 삼각형 ${idx.length / 3} · 축 z ${(AXIS_Z * 100).toFixed(2)}cm`);
console.log(`  등재량: Y_TOP ${(Y_TOP * 100).toFixed(2)}cm · Y_NECK ${(Y_NECK * 100).toFixed(2)}cm · TOL_SELF ${(TOL_SELF * 1000).toFixed(1)}mm · 격자 ${(GRID * 100).toFixed(1)}cm(진단 전용)`);

/* ── §1-2 하한 Y_LOW: 몸통 고리가 «사라지는» 높이(1→2 · 가랑이) ── */
let yA = Y_TOP;                                        // 위(몸통 고리 있음)에서 내려간다
for (; yA > -1 && !at(yA).hasTorso; yA -= GRID);
let yB = yA;
for (; yB > -1 && at(yB).hasTorso; yB -= GRID);
if (yB <= -1) throw new Error('몸통 고리가 사라지는 높이를 못 찾는다 — 갈래 B');
const Y_LOW = bisect(yB + GRID, yB, (y) => at(y).hasTorso);
console.log(`  **Y_LOW**(가랑이 · 몸통 고리 소멸) 격자 ${((yB + GRID) * 100).toFixed(2)}cm → 정밀 **${(Y_LOW * 100).toFixed(3)}cm** · 그 아래 성분 ${at(yB).nComp}개`);

/* ── §1-2 상한 Y_UP: 팔 고리가 몸통에 «합쳐지는» 높이(3→1) ── */
let yC = NaN;                                          // 위에서 내려오며 «성분 ≥ 3» 을 처음 만나는 곳
for (let y = Y_TOP; y > Y_LOW; y -= GRID) if (at(y).nComp >= 3) { yC = y; break; }
if (!Number.isFinite(yC)) throw new Error('팔 고리 분리(성분 ≥ 3)를 못 찾는다 — 갈래 B');
const Y_UP = bisect(yC, yC + GRID, (y) => at(y).nComp >= 3);
console.log(`  **Y_UP**(겨드랑이 · 성분 3→1) 격자 ${(yC * 100).toFixed(2)}cm → 정밀 **${(Y_UP * 100).toFixed(3)}cm** · 그 위 성분 ${at(yC + GRID).nComp}개`);
console.log(`  순서 확인 Y_NECK > Y_UP : ${(Y_NECK * 100).toFixed(2)} > ${(Y_UP * 100).toFixed(2)} ⟹ ${Y_NECK > Y_UP ? '성립' : '**불성립**'}`);

/* ── §1-3 극값 ── */
const grid: { y: number; C: number }[] = [];
for (let y = Y_LOW + GRID; y < Y_UP; y += GRID) { const a = at(y); if (Number.isFinite(a.C)) grid.push({ y, C: a.C }); }
if (grid.length < 3) throw new Error(`도출 구간 격자점 ${grid.length}개 — 극값 판정 불가 · 갈래 B`);
const iMax = grid.reduce((b2, q, i) => (q.C > grid[b2].C ? i : b2), 0);
console.log(`  구간 격자점 ${grid.length}개 (${(grid[0].y * 100).toFixed(1)}~${(grid[grid.length - 1].y * 100).toFixed(1)}cm)`);
console.log(`  C(y) 격자 최대 @ ${(grid[iMax].y * 100).toFixed(2)}cm = ${(grid[iMax].C * 100).toFixed(2)}cm · 색인 ${iMax}/${grid.length - 1}`);
if (iMax === 0 || iMax === grid.length - 1) throw new Error('C 최대가 구간 «끝»에 붙는다(내부 극값 없음) — 갈래 B');

/** 삼분 탐색 — 격자 이웃 안에서 TOL_SELF 까지. */
const ternary = (lo: number, hi: number, better: (a: number, c: number) => boolean): number => {
  let a = lo, c = hi;
  for (let i = 0; i < 200 && c - a > TOL_SELF; i++) {
    const m1 = a + (c - a) / 3, m2 = c - (c - a) / 3;
    if (better(at(m1).C, at(m2).C)) c = m2; else a = m1;
  }
  return (a + c) / 2;
};
const chestY = ternary(grid[iMax - 1].y, grid[iMax + 1].y, (x, y2) => x > y2);
const gridW = grid.slice(0, iMax + 1);
const jMin = gridW.reduce((b2, q, i) => (q.C < gridW[b2].C ? i : b2), 0);
console.log(`  C(y) 격자 최소 @ ${(gridW[jMin].y * 100).toFixed(2)}cm = ${(gridW[jMin].C * 100).toFixed(2)}cm · 색인 ${jMin}/${gridW.length - 1} (하한~chest 구간)`);
if (jMin === 0 || jMin === gridW.length - 1) throw new Error('C 최소가 구간 «끝»에 붙는다(내부 극값 없음) — 갈래 B');
const waistY = ternary(gridW[jMin - 1].y, gridW[jMin + 1].y, (x, y2) => x < y2);

const Cc = at(chestY).C, Cw = at(waistY).C;
console.log(`  ── 도출 결과 ──`);
console.log(`  **chestY** 격자 ${(grid[iMax].y * 100).toFixed(2)}cm → **정밀 ${(chestY * 100).toFixed(3)}cm** · C = **${(Cc * 100).toFixed(3)}cm**`);
console.log(`  **waistY** 격자 ${(gridW[jMin].y * 100).toFixed(2)}cm → **정밀 ${(waistY * 100).toFixed(3)}cm** · C = **${(Cw * 100).toFixed(3)}cm**`);
console.log(`  순서 정합 Y_NECK ${(Y_NECK * 100).toFixed(2)} > chestY ${(chestY * 100).toFixed(2)} > waistY ${(waistY * 100).toFixed(2)} > Y_LOW ${(Y_LOW * 100).toFixed(2)} ⟹ ${Y_NECK > chestY && chestY > waistY && waistY > Y_LOW ? '**성립**' : '**불성립 — 갈래 B**'}`);
console.log(`  물리 정합 C(chestY) > C(waistY) : ${(Cc * 100).toFixed(3)} > ${(Cw * 100).toFixed(3)} ⟹ ${Cc > Cw ? '**성립**' : '**불성립 — 갈래 B**'}`);
console.log(`  서명(결정성 대조용) ${[Y_LOW, Y_UP, chestY, waistY, Cc, Cw].map((v) => v.toFixed(9)).join('/')}`);
