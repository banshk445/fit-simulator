/* v3-13 — 몸 메시에서 «부호 있는 거리장»을 굽는다.
 *
 * v2 코드를 임포트하지 않는다(설계 R4-3). 삼각형 배열을 «값으로» 받는다.
 * (`src/lib/sdfCollision.ts`는 v1 Stage 1a 동결분이고, 그 입력은 `splitFrontBack`·
 *  `excludeArms`로 «잘린» 메시라 부호가 정의되지 않는 쪽이다 — 입력 자체가 다르다.)
 *
 * ── 왜 복셀 SDF인가(§2-1) ───────────────────────────────────────────────
 * S3의 해석 충돌체는 `sdf(c,x,y,z,out) → 부호 있는 거리` «하나»의 인터페이스로
 * 들어온다. 복셀 격자는 그것을 그대로 만족하면서 질의가 O(1)이고, 무엇보다
 * **부호 문제를 「굽는 단계 한 번」으로 국한한다.** 메시 질의로 가면 매 질의마다
 * 부호를 정해야 하고(최근접 면 법선은 모서리·오목부에서 뒤집힌다 — v1 Stage 1a가
 * 이 계열에서 부호 모순 2.95%를 등재), 서브스텝이 1e3 규모인 이 솔버에서 그 비용과
 * 위험이 «매 질의»로 곱해진다.
 *
 * ── 부호를 무엇으로 가르는가(§2-3) ──────────────────────────────────────
 * **레이 패리티.** §1이 원본 메시를 **수밀**로 실측했다(열린 엣지 0 · 비다양체 0 ·
 * 와인딩 불일치 0 · 연결 성분 1 · χ=2 · 종수 0) ⟹ 패리티가 **원리적으로 정확**하다.
 * 근사가 아니다. 최근접 면 법선(모서리에서 뒤집힘)도 winding number(전 삼각형
 * 순회로 가장 비쌈)도 필요 없다.
 * **이 몸에서의 실패 위험**: 격자 노드가 메시의 정점·엣지에 «정확히» 얹히면 교차가
 * 두 번 세어져 패리티가 뒤집힌다. 측도 0이지만 격자는 규칙적이라 완전히 무시할 수
 * 없다 ⟹ §3-③이 독립 방법과 교차 검증해 불일치율을 «값으로» 낸다.
 *
 * ── 격자 밖(§2-5) ───────────────────────────────────────────────────────
 * 격자 밖은 **「밖(자유 공간)」으로 간주**한다 — 외삽하지 않는다. 밖으로 간주하면
 * `d ≥ 0`이라 해소가 **아무 일도 하지 않으므로** 흡착이 아니라 «충돌 없음»이다.
 * 절대 조항(흡착·인력 0)에 저촉되지 않는다.
 */

export type GridSdf = {
  kind: 'grid';
  /** 격자 원점(노드 0,0,0의 좌표) */
  ox: number;
  oy: number;
  oz: number;
  /** 격자 간격 [m] */
  h: number;
  nx: number;
  ny: number;
  nz: number;
  /** |d|를 이 값으로 자른다 — 띠 밖은 «부호»만 유효하다 */
  band: number;
  /** 부호 있는 거리 (nx·ny·nz) · 안쪽이 «음수» */
  data: Float32Array;
};

/** 점–삼각형 «제곱» 거리 (Ericson, RTCD §5.1.5와 같은 분기). */
function pointTriSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w;
              qy = ay + aby * v + acy * w;
              qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/** 격자 간격을 «도출»한다 — 손 상수 0 (§2-2).
 *
 *   band   = thickness + 2h                (접촉 판정 띠 + 삼선형 스텐실)
 *   margin = band + 2h
 *   n_k    = floor((L_k + 2·margin)/h) + 1
 *   메모리 = 4 bytes × nx·ny·nz  ≤  예산
 *
 * ⟹ h는 「메모리 ≤ 예산」을 만족하는 «가장 작은» 값. 패딩이 h에 의존해 닫힌 형식이
 *   아니므로 이분 탐색으로 푼다 — 값은 여전히 **예산·두께·몸 크기에서만** 나온다.
 *
 * **h ≤ 두께는 원리적으로 불가능하다**: 이 몸 bbox(0.886 m³)에서 h=1mm면 8.86e8
 * 복셀 = **3.38 GB**다. ⟹ h > 두께를 «받아들이고 오차를 정량화»한다. 삼선형 보간의
 * 주 오차항은 곡률에서 온다: ε ≈ h²/(4R). 몸통·상완(R≈40mm)에서 h=3.75mm면
 * ε=0.088mm로 **두께의 8.8%**다. 손가락(R≈10mm)에서는 35%이지만 티셔츠의 접촉
 * 대역이 아니다.
 */
export function deriveSpacing(
  ext: readonly [number, number, number],
  budgetBytes: number,
  thickness: number,
): { h: number; band: number; voxels: number; bytes: number } {
  const cost = (h: number) => {
    const band = thickness + 2 * h;
    const margin = band + 2 * h;
    let n = 1;
    for (const L of ext) n *= Math.floor((L + 2 * margin) / h) + 1;
    return { band, voxels: n, bytes: n * 4 };
  };
  let lo = 1e-4; // 확실히 예산 초과
  let hi = 1; // 확실히 예산 이하
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cost(mid).bytes > budgetBytes) lo = mid;
    else hi = mid;
  }
  const c = cost(hi);
  return { h: hi, band: c.band, voxels: c.voxels, bytes: c.bytes };
}

/** 메시 → 부호 있는 거리장.
 *
 * 1) **좁은 띠 정확 거리** — 삼각형마다 bbox를 band만큼 넓혀 그 안의 노드에만
 *    «정확한» 점–삼각형 거리를 넣는다. 띠 밖은 band로 자른다(부호만 의미).
 *    먼 곳의 정확한 거리는 이 용도에 필요 없다: d ≥ thickness면 해소가 아무 일도
 *    안 하므로 그 값은 «물리에 도달하지 않는다».
 * 2) **부호는 레이 패리티** — x축에 평행한 격자 선마다 삼각형 교차 x를 모아 정렬하고
 *    홀짝으로 안/밖을 가른다. (y,z) 버킷으로 후보를 줄인다.
 */
export function bakeSdf(pos: Float32Array, idx: Uint32Array, h: number, band: number): GridSdf {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i + k]);
      hi[k] = Math.max(hi[k], pos[i + k]);
    }
  const margin = band + 2 * h;
  const ox = lo[0] - margin, oy = lo[1] - margin, oz = lo[2] - margin;
  const nx = Math.floor((hi[0] - lo[0] + 2 * margin) / h) + 1;
  const ny = Math.floor((hi[1] - lo[1] + 2 * margin) / h) + 1;
  const nz = Math.floor((hi[2] - lo[2] + 2 * margin) / h) + 1;
  const data = new Float32Array(nx * ny * nz).fill(band);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const tris = idx.length / 3;

  /* 1) 좁은 띠 정확 거리 (부호는 아직 없다 — 전부 양수) */
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const i0 = Math.max(0, Math.ceil((Math.min(pos[a], pos[b], pos[c]) - band - ox) / h));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(pos[a], pos[b], pos[c]) + band - ox) / h));
    const j0 = Math.max(0, Math.ceil((Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - band - oy) / h));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) + band - oy) / h));
    const k0 = Math.max(0, Math.ceil((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - band - oz) / h));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) + band - oz) / h));
    for (let k = k0; k <= k1; k++) {
      const pz = oz + k * h;
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * h;
        for (let i = i0; i <= i1; i++) {
          const o = at(i, j, k);
          const cur = data[o];
          const d2 = pointTriSq(
            ox + i * h, py, pz,
            pos[a], pos[a + 1], pos[a + 2],
            pos[b], pos[b + 1], pos[b + 2],
            pos[c], pos[c + 1], pos[c + 2],
          );
          if (d2 < cur * cur) data[o] = Math.sqrt(d2);
        }
      }
    }
  }

  /* 2) 부호 — x축 레이 패리티 */
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const j0 = Math.max(0, Math.ceil((Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - oy) / h));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) - oy) / h));
    const k0 = Math.max(0, Math.ceil((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / h));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / h));
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        const key = k * ny + j;
        let arr = buckets.get(key);
        if (!arr) buckets.set(key, (arr = []));
        arr.push(t);
      }
  }
  const hits: number[] = [];
  for (const [key, list] of buckets) {
    const j = key % ny;
    const k = (key - j) / ny;
    const py = oy + j * h;
    const pz = oz + k * h;
    hits.length = 0;
    for (const t of list) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      // (y,z)로 투영해 점 포함 판정 → 그 무게중심으로 x를 얻는다
      const y0 = pos[a + 1], z0 = pos[a + 2];
      const e1y = pos[b + 1] - y0, e1z = pos[b + 2] - z0;
      const e2y = pos[c + 1] - y0, e2z = pos[c + 2] - z0;
      const det = e1y * e2z - e1z * e2y;
      if (det === 0) continue; // x축과 «나란한» 삼각형 — 패리티에 기여하지 않는다
      const ry = py - y0, rz = pz - z0;
      const u = (ry * e2z - rz * e2y) / det;
      const v = (rz * e1y - ry * e1z) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      hits.push(pos[a] + u * (pos[b] - pos[a]) + v * (pos[c] - pos[a]));
    }
    if (hits.length === 0) continue;
    hits.sort((p, q) => p - q);
    let front = 0;
    for (let i = 0; i < nx; i++) {
      const px = ox + i * h;
      while (front < hits.length && hits[front] < px) front++;
      if ((hits.length - front) & 1) data[at(i, j, k)] = -data[at(i, j, k)]; // 앞쪽 교차 홀수 ⟹ 안
    }
  }

  return { kind: 'grid', ox, oy, oz, h, nx, ny, nz, band, data };
}

/** 삼선형 보간. 격자 «밖»이면 band(자유 공간)를 돌려준다 — 외삽 0 · 흡착 0. */
export function sampleSdf(g: GridSdf, x: number, y: number, z: number): number {
  const fx = (x - g.ox) / g.h;
  const fy = (y - g.oy) / g.h;
  const fz = (z - g.oz) / g.h;
  if (fx < 0 || fy < 0 || fz < 0 || fx > g.nx - 1 || fy > g.ny - 1 || fz > g.nz - 1) return g.band;
  const i = Math.min(g.nx - 2, Math.floor(fx));
  const j = Math.min(g.ny - 2, Math.floor(fy));
  const k = Math.min(g.nz - 2, Math.floor(fz));
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const at = (a: number, b: number, c: number) => g.data[(c * g.ny + b) * g.nx + a];
  const c00 = at(i, j, k) * (1 - tx) + at(i + 1, j, k) * tx;
  const c10 = at(i, j + 1, k) * (1 - tx) + at(i + 1, j + 1, k) * tx;
  const c01 = at(i, j, k + 1) * (1 - tx) + at(i + 1, j, k + 1) * tx;
  const c11 = at(i, j + 1, k + 1) * (1 - tx) + at(i + 1, j + 1, k + 1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}

/** 해석 함수를 그대로 격자에 «구워» 넣는다 — v3-13 §3-④ 전용.
 *
 * 메시를 거치지 않는다: ④가 묻는 것은 「**표현**(격자+삼선형)이 물리를 바꾸는가」이고,
 * 메시→SDF 경로의 정확도는 §3-②가 «따로» 검증했다. 두 오차원을 섞지 않는다.
 */
export function gridFromFn(
  fn: (x: number, y: number, z: number) => number,
  lo: readonly [number, number, number],
  hi: readonly [number, number, number],
  h: number,
  band: number,
): GridSdf {
  const nx = Math.floor((hi[0] - lo[0]) / h) + 1;
  const ny = Math.floor((hi[1] - lo[1]) / h) + 1;
  const nz = Math.floor((hi[2] - lo[2]) / h) + 1;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const d = fn(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
        data[(k * ny + j) * nx + i] = Math.max(-band, Math.min(band, d));
      }
  return { kind: 'grid', ox: lo[0], oy: lo[1], oz: lo[2], h, nx, ny, nz, band, data };
}
