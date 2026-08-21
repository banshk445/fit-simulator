import { SEP, TOL_SELF } from './consts.ts';

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

