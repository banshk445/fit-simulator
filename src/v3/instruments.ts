import { SEP, TOL_SELF } from './consts.ts';
import { sampleSdf, type GridSdf } from './bodySdf.ts';
import type { Solver } from './solver.ts';

/* v3-35 — 자기충돌 «계기»의 순수 부분. `scripts/v3S4.ts` 에서 줄 그대로 옮겼다.
 *
 * 왜 옮기는가(#65): 이 계기는 **조립**(옆 틈 G 고정점이 판정 조건으로 쓴다)과
 * **측정**(S4 ③ 자기관통) 양쪽이 쓰고, 이제 **Node 하네스 · Node 드라이버 · 브라우저 워커**
 * 셋이 쓴다. 사본을 두면 「같은 이름의 다른 계기」가 생긴다(함정 13 계열) ⟹ **한 곳에 둔다.**
 * v3-34는 인자 주입으로 복제 0을 지켰는데, 소비자가 셋이 되면서 «공유 모듈»이 더 맞다.
 *
 * 로직 변경 0 · 연산 순서 변경 0. 순수성: `node:` 0 · 파일 0 · `process` 0.
 */
/* ══ 계기 — 하네스 «사본». 솔버·격자와 코드를 공유하지 않는다(v3-13 규범) ══ */
/** v3-80 §1-④ — **격자 SDF 오차의 «등재» 비율**(h 대비). **이 판이 정한 수가 아니다.**
 *
 * 출처는 **v3-54 정정**(Q2 승인분 · 이 파일 아래 주석에 원문 무삭제):
 *   구 문언 「h의 **5%**」는 **틀렸다(약 5배)** — 실측 밴드 안 최대차 0.943/0.961/0.975mm
 *   = **h의 23.9~24.7%** ⟹ 새 문언 「**최대 h의 약 25%**」.
 * 이 상수가 생긴 이유는 **소비자가 리터럴을 자기 손으로 다시 쓰지 않게 하기 위해서**다 —
 * `fitReport.ts` 가 정정 «전» 값 `0.05` 를 따로 들고 있어 화면이 **옛 문턱으로 판정**했다.
 * **문턱을 결과에 맞춰 움직인 것이 아니다**(함정 14) — 등재된 실측으로 «되돌린» 것이다. */
export const SDF_ERR_FRAC = 0.25;

export function ptTriSq(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const d3 = abx * (px - bx) + aby * (py - by) + abz * (pz - bz);
    const d4 = acx * (px - bx) + acy * (py - by) + acz * (pz - bz);
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
      else {
        const d5 = abx * (px - cx) + aby * (py - cy) + abz * (pz - cz);
        const d6 = acx * (px - cx) + acy * (py - cy) + acz * (pz - cz);
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); }
            else { const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}


/** G 도출 전용 «가벼운» 최소 거리 — 판정에는 쓰지 않는다(판정은 minPairDist). */
export function minPairDistLite(pos: Float64Array, tris: number[]): number {
  return minPairDist(pos, tris, SEP * 2).min;
}

/** 비인접 삼각형 쌍의 최소 거리 — 균일 격자로 후보를 좁힌다(S3b는 O(T²)였다). */
export function minPairDist(pos: Float64Array, tris: number[], window: number) {
  const T = tris.length / 3;
  const box = new Float64Array(T * 6);
  for (let t = 0; t < T; t++) {
    const o = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
    for (let k = 0; k < 3; k++) {
      box[t * 6 + k] = Math.min(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
      box[t * 6 + 3 + k] = Math.max(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
    }
  }
  const cs = Math.max(window * 2, 0.01);
  const grid = new Map<number, number[]>();
  const key = (a: number, b: number, c: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (c + 4096);
  for (let t = 0; t < T; t++) {
    const i0 = Math.floor(box[t * 6] / cs), i1 = Math.floor(box[t * 6 + 3] / cs);
    const j0 = Math.floor(box[t * 6 + 1] / cs), j1 = Math.floor(box[t * 6 + 4] / cs);
    const k0 = Math.floor(box[t * 6 + 2] / cs), k1 = Math.floor(box[t * 6 + 5] / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const kk = key(i, j, k);
      let arr = grid.get(kk); if (!arr) grid.set(kk, (arr = [])); arr.push(t);
    }
  }
  let min = Infinity, viol = 0, near = 0, hits = 0;
  const worst = [-1, -1];
  const seen = new Set<number>();
  for (const arr of grid.values())
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const i = arr[a], j = arr[b];
      const pk = i < j ? i * 1e7 + j : j * 1e7 + i;
      if (seen.has(pk)) continue;
      seen.add(pk);
      const A = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
      const Bt = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]];
      if (A.some((v) => Bt.includes(v))) continue;
      let gap = 0;
      for (let k = 0; k < 3; k++) gap = Math.max(gap, box[i * 6 + k] - box[j * 6 + 3 + k], box[j * 6 + k] - box[i * 6 + 3 + k]);
      if (gap > window) continue;
      let d = Infinity;
      for (let k = 0; k < 3; k++) {
        d = Math.min(d, Math.sqrt(ptTriSq(pos[A[k] * 3], pos[A[k] * 3 + 1], pos[A[k] * 3 + 2], pos[Bt[0] * 3], pos[Bt[0] * 3 + 1], pos[Bt[0] * 3 + 2], pos[Bt[1] * 3], pos[Bt[1] * 3 + 1], pos[Bt[1] * 3 + 2], pos[Bt[2] * 3], pos[Bt[2] * 3 + 1], pos[Bt[2] * 3 + 2])));
        d = Math.min(d, Math.sqrt(ptTriSq(pos[Bt[k] * 3], pos[Bt[k] * 3 + 1], pos[Bt[k] * 3 + 2], pos[A[0] * 3], pos[A[0] * 3 + 1], pos[A[0] * 3 + 2], pos[A[1] * 3], pos[A[1] * 3 + 1], pos[A[1] * 3 + 2], pos[A[2] * 3], pos[A[2] * 3 + 1], pos[A[2] * 3 + 2])));
      }
      if (d < window) near++;
      if (d < SEP - TOL_SELF) viol++;
      // 교차하는 두 삼각형은 AABB 간극이 ≤ 0 이므로 «반드시» 이 후보 집합 안에 있다
      if (triTriHit(pos, A, Bt)) hits++;
      if (d < min) { min = d; worst[0] = i; worst[1] = j; }
    }
  return { min, viol, near, hits, worst };
}

/* ── 삼각형–삼각형 «교차» 판정기 (S3b 정의 그대로 · 하네스 사본) ─────────── */
export function segTriHit(p: Float64Array, s0: number, s1: number, t0: number, t1: number, t2: number): boolean {
  const dx = p[s1] - p[s0], dy = p[s1 + 1] - p[s0 + 1], dz = p[s1 + 2] - p[s0 + 2];
  const e1x = p[t1] - p[t0], e1y = p[t1 + 1] - p[t0 + 1], e1z = p[t1 + 2] - p[t0 + 2];
  const e2x = p[t2] - p[t0], e2y = p[t2 + 1] - p[t0 + 1], e2z = p[t2 + 2] - p[t0 + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-20) return false;
  const inv = 1 / det;
  const tx = p[s0] - p[t0], ty = p[s0 + 1] - p[t0 + 1], tz = p[s0 + 2] - p[t0 + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u <= 0 || u >= 1) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v <= 0 || u + v >= 1) return false;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return tt > 0 && tt < 1;
}
export function triTriHit(p: Float64Array, a: number[], b: number[]): boolean {
  const A = [a[0] * 3, a[1] * 3, a[2] * 3], B = [b[0] * 3, b[1] * 3, b[2] * 3];
  for (let k = 0; k < 3; k++) {
    if (segTriHit(p, A[k], A[(k + 1) % 3], B[0], B[1], B[2])) return true;
    if (segTriHit(p, B[k], B[(k + 1) % 3], A[0], A[1], A[2])) return true;
  }
  return false;
}

/* ── 몸 «부호 있는 거리» 계기 — v3-37에서 하네스에서 옮겼다(줄 그대로 · 인자화만) ──
 * 소비자가 셋이 됐다: Node 하네스 · Node 드라이버 · **브라우저 게이트**.
 * 사본을 두면 「같은 이름의 다른 계기」가 생긴다(#65 · 함정 13 계열) ⟹ 한 곳에 둔다. */
export function makeBodyDistance(cfg: {
  pos: Float32Array; idx: Uint32Array; bodyG: GridSdf; h: number; thick: number;
}) {
  const prim0 = { pos: cfg.pos };
  const bodyIdx = cfg.idx;
  const bodyG = cfg.bodyG;
  const sdfSpec = { h: cfg.h };
  const THICK = cfg.thick;
  /** 몸까지의 «정확» 무부호 거리 — 격자 근방 후보만 정밀 계산한다.
   * 사전 거르기는 격자 SDF가 하되 «판정»은 정확 거리가 한다.
   *
   * **v3-54 정정(Q2 승인분) — 원문 무삭제**:
   *   구 문언 ┈ 「SDF 오차 ≤ **h의 5%**, 거르기 문턱 10h 로 **두 자릿수 여유**」
   *   실측    ┈ 밴드 안 최대차 **0.943 / 0.961 / 0.975mm**(gray/swim/sweat · v3-53 §2-1)
   *            = **h의 23.9~24.7%**. 초과 표본 6.5~8.1%. 초과는 **밴드 가장자리**에 몰린다
   *            (|c| 6~8.9mm 에서 19.5~88.9% · |c| < 2mm 에서 0.7~4.1%).
   *   ⟹ **오차 «크기» 문언은 틀렸다(약 5배).** 다만 **결론은 유지된다** —
   *     거르기 문턱 10h = 39.5mm 는 실측 최대 오차 0.98mm 의 **약 40배**이고,
   *     관통은 `signed < THICK`(1mm)이라야 하므로 **거르기가 관통 정점을 놓칠 수 없다**.
   *   **새 문언**: 「격자 SDF 오차는 **최대 h의 약 25%**(실측 ≤ 0.98mm)이고, 거르기 문턱 10h 가
   *              그 **약 40배**라 «거르기»에는 충분하다. **거리 «값»으로는 쓰지 말 것**」 */
  const CELL = sdfSpec.h * 10;
  /** 몸 삼각형의 균일 격자 — «정확» 거리 계산의 후보만 좁힌다(값은 브루트포스와 같다). */
  const BGRID = (() => {
    const cs = 0.05;
    const g = new Map<number, number[]>();
    const key = (a: number, b: number, c: number) => ((a + 2048) * 4096 + (b + 2048)) * 4096 + (c + 2048);
    for (let t = 0; t < bodyIdx.length; t += 3) {
      const o = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3];
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(prim0.pos[o[0] + k], prim0.pos[o[1] + k], prim0.pos[o[2] + k]) / cs));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(prim0.pos[o[0] + k], prim0.pos[o[1] + k], prim0.pos[o[2] + k]) / cs));
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const kk = key(i, j, k);
        let arr = g.get(kk); if (!arr) g.set(kk, (arr = [])); arr.push(t);
      }
    }
    return { cs, g, key };
  })();
  /** 몸 위의 «최근접 점» — 격자 후보 안에서 삼각형별 최근접점을 직접 고른다.
   * v3-23 §1-② 「목선 링을 몸에 정사영한 둘레」에 쓴다. */
  function nearestBodyPoint(x: number, y: number, z: number): [number, number, number] {
    const { cs, g, key } = BGRID;
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs), ck = Math.floor(z / cs);
    let best = Infinity;
    const out: [number, number, number] = [x, y, z];
    for (let r = 1; r <= 12; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (r > 1 && Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
        const arr = g.get(key(i, j, k));
        if (!arr) continue;
        for (const t of arr) {
          const a = bodyIdx[t] * 3, b = bodyIdx[t + 1] * 3, c = bodyIdx[t + 2] * 3;
          // 삼각형 위 최근접점을 «질량 좌표»로 직접 구한다(가장자리 포함)
          const ax = prim0.pos[a], ay = prim0.pos[a + 1], az = prim0.pos[a + 2];
          const abx = prim0.pos[b] - ax, aby = prim0.pos[b + 1] - ay, abz = prim0.pos[b + 2] - az;
          const acx = prim0.pos[c] - ax, acy = prim0.pos[c + 1] - ay, acz = prim0.pos[c + 2] - az;
          const d00 = abx * abx + aby * aby + abz * abz;
          const d01 = abx * acx + aby * acy + abz * acz;
          const d11 = acx * acx + acy * acy + acz * acz;
          const den = d00 * d11 - d01 * d01;
          const apx = x - ax, apy = y - ay, apz = z - az;
          const d20 = apx * abx + apy * aby + apz * abz;
          const d21 = apx * acx + apy * acy + apz * acz;
          let u = 0, v = 0;
          if (Math.abs(den) > 1e-24) { u = (d11 * d20 - d01 * d21) / den; v = (d00 * d21 - d01 * d20) / den; }
          if (u < 0) u = 0; if (v < 0) v = 0;
          if (u + v > 1) { const sSum = u + v; u /= sSum; v /= sSum; }
          const qx = ax + abx * u + acx * v, qy = ay + aby * u + acy * v, qz = az + abz * u + acz * v;
          const dd = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
          if (dd < best) { best = dd; out[0] = qx; out[1] = qy; out[2] = qz; }
        }
      }
      if (best < (r * cs) ** 2) break;
    }
    return out;
  }

  function exactBodyDist(x: number, y: number, z: number): number {
    const { cs, g, key } = BGRID;
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs), ck = Math.floor(z / cs);
    let best = Infinity;
    for (let r = 1; r <= 12; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (r > 1 && Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
        const arr = g.get(key(i, j, k));
        if (!arr) continue;
        for (const t of arr) {
          const a = bodyIdx[t] * 3, b = bodyIdx[t + 1] * 3, c = bodyIdx[t + 2] * 3;
          const d2 = ptTriSq(x, y, z, prim0.pos[a], prim0.pos[a + 1], prim0.pos[a + 2], prim0.pos[b], prim0.pos[b + 1], prim0.pos[b + 2], prim0.pos[c], prim0.pos[c + 1], prim0.pos[c + 2]);
          if (d2 < best) best = d2;
        }
      }
      // 반경 r 셀 안에 «확실히» 최근접이 있으면 종료
      if (best < ((r - 0) * cs) ** 2) break;
    }
    return Math.sqrt(best);
  }
  /** 옷 정점 전체의 «몸 부호 있는 거리» 최소/관통 — 격자로 거르고 정확 거리로 판정 */
  function bodyClearance(s: Solver) {
    let minD = Infinity, maxPen = 0, penCnt = 0, exactN = 0, worst = -1, worstPen = -1;
    for (let v = 0; v < s.n; v++) {
      const x = s.pos[v * 3], y = s.pos[v * 3 + 1], z = s.pos[v * 3 + 2];
      const g = sampleSdf(bodyG, x, y, z);
      if (g > CELL) { if (g < minD) minD = g; continue; }
      exactN++;
      const e = exactBodyDist(x, y, z);
      const signed = g < 0 ? -e : e;
      if (signed < minD) { minD = signed; worst = v; }
      const pen = THICK - signed;
      if (pen > 1e-9) { penCnt++; if (pen > maxPen) { maxPen = pen; worstPen = v; } }
    }
    return { minD, maxPen, penCnt, exactN, worst, worstPen };
  }

  return { nearestBodyPoint, exactBodyDist, bodyClearance, CELL };
}
