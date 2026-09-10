/* v4-10 §1-①ㄱ — **셀프 충돌 «근접쌍» 읽기 전용 계기**. 물리를 한 톨도 안 돌린다.
 *
 * 회차 프롬프트: 「v3 의 광역 격자(`solver.ts:531-573`)를 «읽기 전용»으로 호출해 v4@180 상태에서
 * sep(2mm) 안 근접쌍을 세고, 상위 100 정점의 소속 비율 등재. 대조군 = 임의 100 정점.」
 *
 * ★ **광역** = `solver.ts:531-573` 을 그대로 옮겨 적었다(§0-6ㄴ 에 «집행 전» 등재):
 *     cell = mean(엣지 길이) + sep · AABB 를 thickness 씩 확장 · 최소 모서리 셀에서만 1회 ·
 *     정점 공유(인접) 제외 · 확장 AABB 겹침 검사.
 *   `resolveSelfCollisions` 는 **위치를 고친다** ⟹ 부를 수 없다(읽기 전용이 아니다). `src/` diff 0.
 * ★ **협역** = v3 가 «판정»에 쓰는 계기와 **같은 특징 집합**이다 —
 *     `instruments.ts:66 minPairDist` 와 같이 `ptTriSq` **6회**(정점 3 × 양방향)로 거리를 낸다.
 *     `ptTriSq` 는 export 돼 있으므로 **복제 0**. **엣지–엣지 9특징은 «없다»**(과소 계수 방향 · §0-6ㄴ).
 * ★ **기계 검증** — 이 계기의 전역 최소 거리 ↔ `minPairDist(pos, tris, SEP*3)` 의 `min`.
 *   광역이 서로 다른 둘이므로 «누락»이 있으면 갈린다. 눈으로 안 본다.
 *
 * 진입: `POS=<float64 3n bin> [HDR=1] [TOPS=<l3dom json>] [WIN=f170->f180] [TAG=v4-f180]
 *        npx tsx scripts/v4SelfProx.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, THICK, SEP, TOL_SELF } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist, ptTriSq } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'v4-f180';
const D = Number(process.env.D_MM ?? 9) / 1000;

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc;
const n = sc.n;
const tris = sc.tris;
const T = (tris.length / 3) | 0;

/* ── 위치 — `POS` 는 float64 3n 순수 나열(v4 산출) · `HDR=1` 이면 v3 blob 머리를 벗긴다 ── */
const rawBuf = readFileSync(process.env.POS!);
let pos: Float64Array;
if (process.env.HDR === '1') {
  const dv = new DataView(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
  const hl = dv.getUint32(0, true);
  pos = new Float64Array(rawBuf.buffer.slice(rawBuf.byteOffset + 4 + hl,
                                             rawBuf.byteOffset + 4 + hl + n * 3 * 8));
} else {
  pos = new Float64Array(rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + n * 3 * 8));
}
if (pos.length !== n * 3) throw new Error(`위치 길이 ${pos.length} ≠ ${n * 3}`);

/* ══ 광역 — `solver.ts:531-573` 그대로 ══════════════════════════════════════ */
const sep = 2 * THICK;
const SC_CLAMP = 2047;
const scClamp = (v: number) => (v < -SC_CLAMP ? -SC_CLAMP : v > SC_CLAMP ? SC_CLAMP : v | 0);
const scKey = (cx: number, cy: number, cz: number) =>
  ((cx + 2048) * 4096 + (cy + 2048)) * 4096 + (cz + 2048);

const lo = new Int32Array(T * 3), hi = new Int32Array(T * 3), box = new Float64Array(T * 6);
let sumLen = 0;
for (let t = 0; t < T; t++) {
  const o0 = tris[t * 3] * 3, o1 = tris[t * 3 + 1] * 3, o2 = tris[t * 3 + 2] * 3;
  sumLen +=
    Math.hypot(pos[o1] - pos[o0], pos[o1 + 1] - pos[o0 + 1], pos[o1 + 2] - pos[o0 + 2]) +
    Math.hypot(pos[o2] - pos[o1], pos[o2 + 1] - pos[o1 + 1], pos[o2 + 2] - pos[o1 + 2]) +
    Math.hypot(pos[o0] - pos[o2], pos[o0 + 1] - pos[o2 + 1], pos[o0 + 2] - pos[o2 + 2]);
  const b = t * 6;
  for (let k = 0; k < 3; k++) {
    box[b + k] = Math.min(pos[o0 + k], pos[o1 + k], pos[o2 + k]) - THICK;
    box[b + 3 + k] = Math.max(pos[o0 + k], pos[o1 + k], pos[o2 + k]) + THICK;
  }
}
const cell = sumLen / (3 * T) + sep;
const inv = 1 / cell;
const buckets = new Map<number, number[]>();
for (let t = 0; t < T; t++) {
  const b = t * 6;
  for (let k = 0; k < 3; k++) {
    lo[t * 3 + k] = scClamp(Math.floor(box[b + k] * inv));
    hi[t * 3 + k] = scClamp(Math.floor(box[b + 3 + k] * inv));
  }
  for (let cx = lo[t * 3]; cx <= hi[t * 3]; cx++)
    for (let cy = lo[t * 3 + 1]; cy <= hi[t * 3 + 1]; cy++)
      for (let cz = lo[t * 3 + 2]; cz <= hi[t * 3 + 2]; cz++) {
        const key = scKey(cx, cy, cz);
        let bk = buckets.get(key);
        if (!bk) buckets.set(key, (bk = []));
        bk.push(t);
      }
}

/* ══ 협역 — `minPairDist` 와 «같은» 6특징(ptTriSq) ═══════════════════════════ */
const dOf = (i: number, j: number) => {
  const A = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
  const B = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]];
  let d2 = Infinity;
  for (let k = 0; k < 3; k++) {
    d2 = Math.min(d2, ptTriSq(pos[A[k] * 3], pos[A[k] * 3 + 1], pos[A[k] * 3 + 2],
      pos[B[0] * 3], pos[B[0] * 3 + 1], pos[B[0] * 3 + 2],
      pos[B[1] * 3], pos[B[1] * 3 + 1], pos[B[1] * 3 + 2],
      pos[B[2] * 3], pos[B[2] * 3 + 1], pos[B[2] * 3 + 2]));
    d2 = Math.min(d2, ptTriSq(pos[B[k] * 3], pos[B[k] * 3 + 1], pos[B[k] * 3 + 2],
      pos[A[0] * 3], pos[A[0] * 3 + 1], pos[A[0] * 3 + 2],
      pos[A[1] * 3], pos[A[1] * 3 + 1], pos[A[1] * 3 + 2],
      pos[A[2] * 3], pos[A[2] * 3 + 1], pos[A[2] * 3 + 2]));
  }
  return Math.sqrt(d2);
};

const t0 = Date.now();
let cand = 0, contacts = 0, viol19 = 0, missCoarse = 0, globMin = Infinity;
/* `minPairDist(pos, tris, w)` 의 셀 크기 — `instruments.ts:77` `cs = max(window*2, 0.01)` · w = 3·sep */
const CS = Math.max(3 * sep * 2, 0.01);
const vMin = new Float64Array(n).fill(Infinity);   // 정점별 «비인접 삼각형까지의» 최소 거리
const inPair = new Uint8Array(n);                  // sep 안 근접쌍에 «소속»한 정점
for (const list of buckets.values())
  for (let ii = 0; ii < list.length; ii++)
    for (let jj = ii + 1; jj < list.length; jj++) {
      const i = list[ii], j = list[jj];
      /* 중복 제거 — 두 «범위»의 최소 모서리 셀에서만 한 번 처리한다(solver.ts:578-584 와 같은 식).
       * 버킷 배열은 Map 안에서 «유일한 객체»이므로, 최소 모서리 키가 이 배열을 가리키면
       * 지금 도는 버킷이 곧 그 최소 모서리 셀이다. */
      if (buckets.get(scKey(Math.max(lo[i * 3], lo[j * 3]),
                            Math.max(lo[i * 3 + 1], lo[j * 3 + 1]),
                            Math.max(lo[i * 3 + 2], lo[j * 3 + 2]))) !== list) continue;
      const a0 = tris[i * 3], a1 = tris[i * 3 + 1], a2 = tris[i * 3 + 2];
      const b0 = tris[j * 3], b1 = tris[j * 3 + 1], b2 = tris[j * 3 + 2];
      if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 ||
          a2 === b0 || a2 === b1 || a2 === b2) continue;                       // 인접 제외
      const bi = i * 6, bj = j * 6;
      if (box[bi] > box[bj + 3] || box[bj] > box[bi + 3] ||
          box[bi + 1] > box[bj + 4] || box[bj + 1] > box[bi + 4] ||
          box[bi + 2] > box[bj + 5] || box[bj + 2] > box[bi + 5]) continue;    // 확장 AABB
      cand++;
      const d = dOf(i, j);
      if (d < globMin) globMin = d;
      for (const v of [a0, a1, a2, b0, b1, b2]) if (d < vMin[v]) vMin[v] = d;
      if (d < SEP - TOL_SELF) {
        viol19++;
        /* 이 쌍이 `minPairDist` 의 «성긴» 격자에서 셀을 공유하는가 —
         * 그 격자는 AABB 를 «확장하지 않고» 넣으므로(instruments.ts:78-88) 이웃 셀에 각각 앉은
         * 가까운 쌍을 **놓칠 수 있다**. 놓치는 수를 «세어» 두 계기의 차를 기계로 설명한다. */
        let share = true;
        for (let k = 0; k < 3 && share; k++) {
          const a0c = Math.floor((box[i * 6 + k] + THICK) / CS), a1c = Math.floor((box[i * 6 + 3 + k] - THICK) / CS);
          const b0c = Math.floor((box[j * 6 + k] + THICK) / CS), b1c = Math.floor((box[j * 6 + 3 + k] - THICK) / CS);
          if (Math.max(a0c, b0c) > Math.min(a1c, b1c)) share = false;
        }
        if (!share) missCoarse++;
      }
      if (d < sep) {
        contacts++;
        for (const v of [a0, a1, a2, b0, b1, b2]) inPair[v] = 1;
      }
    }
const ms = Date.now() - t0;

/* ── 기계 검증 — 광역이 «서로 다른» 두 계기가 같은 집합을 세는가 ────────────
 * `minPairDist(pos, tris, w)` 는 AABB 간극 ≤ w 인 쌍을 «전부» 본다(w = 3·sep = 6mm).
 * 이 계기는 AABB 를 thickness 씩 확장해 겹치는 쌍(= 간극 ≤ 2mm)을 본다.
 * ⟹ 간극 ≤ 1.9mm 인 쌍은 **두 집합 «모두»에 든다** ⟹ `d < SEP − TOL_SELF`(1.9mm) 인 쌍 수는
 *   **정확히 같아야 한다**. 같지 않으면 어느 한쪽 광역에 누락이 있다. 눈으로 안 본다.
 * (전역 최소는 «참고»다 — 최근접 쌍의 간극이 2mm 를 넘으면 이 계기의 시야 밖이라
 *  `mp.min ≤ globMin` 이 되고, 그것은 결함이 아니라 정의역 차이다.) */
const mp = minPairDist(pos, tris, 3 * sep);
const agree = mp.viol === viol19;

/* ── 상위 100 ↔ 대조군 ────────────────────────────────────────────────────── */
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const stat = (idx: number[]) => {
  const fin = idx.map((v) => vMin[v]).filter((x) => Number.isFinite(x));
  return {
    n: idx.length, 근접쌍소속: idx.filter((v) => inPair[v] === 1).length,
    최소거리유한: fin.length,
    최소거리mm: { 중앙: med(fin) * 1000, 최소: fin.length ? Math.min(...fin) * 1000 : NaN,
                  최대: fin.length ? Math.max(...fin) * 1000 : NaN },
    'sep(2mm)안': idx.filter((v) => vMin[v] < sep).length,
    '4mm안': idx.filter((v) => vMin[v] < 2 * sep).length,
  };
};
/* 대조군 — 결정적 LCG(씨앗 12345 · 손으로 고른 정점 0) */
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const ctrl: number[] = [];
const seen = new Set<number>();
while (ctrl.length < 100) { const v = Math.floor(rnd() * n); if (!seen.has(v)) { seen.add(v); ctrl.push(v); } }

const tops: Record<string, number[]> = {};
if (process.env.TOPS) {
  const j = JSON.parse(readFileSync(process.env.TOPS, 'utf8'));
  for (const [k, v] of Object.entries(j.tops as Record<string, { top100: number[] }>))
    tops[k] = v.top100;
}

const out = {
  what: 'v4-10 §1-①ㄱ — 셀프 충돌 근접쌍(읽기 전용 · 물리 0스텝)',
  cell: CELL, tag: TAG, n, T, sepMm: sep * 1000, thickMm: THICK * 1000,
  광역: { cellM: cell, 버킷수: buckets.size, 후보쌍: cand, ms },
  협역: { 특징: '정점–삼각형 6(ptTriSq) · 엣지–엣지 없음', 'sep안_쌍': contacts,
          '1.9mm안_쌍': viol19, 전역최소mm: globMin * 1000 },
  기계검증: { 이계기_viol_1_9mm: viol19, minPairDist_viol: mp.viol, 같은가: agree,
              '성긴격자_셀공유_실패': missCoarse, 차: viol19 - mp.viol,
              차가_설명되는가: viol19 - mp.viol === missCoarse,
              minPairDist_min_mm: mp.min * 1000, minPairDist_near_6mm: mp.near, 삼교차: mp.hits },
  전체: stat(Array.from({ length: n }, (_, v) => v)),
  대조군_임의100: stat(ctrl),
  상위100: Object.fromEntries(Object.entries(tops).map(([k, v]) => [k, stat(v)])),
};
writeFileSync(`${OUT}/l3prox-${CELL}-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(`  → ${OUT}/l3prox-${CELL}-${TAG}.json`);
