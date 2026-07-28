// M2: 몸 표면의 부호거리장(SDF) — 마찰 접촉의 기반.
//
// 왜 필요한가: 지금 충돌은 법선 방향 밀어내기만 하고 접선 마찰이 없다.
// 마찰이 없으니 옷이 몸에 얹혀 있지 못하고, 그 하중 지지를 보조 보정
// 12개가 대신 하고 있다 — A-③/C/B-1 실패가 전부 "보정을 빼면 미끄러진다"
// 로 수렴한 이유(M1 이전 조사). 마찰을 넣으려면 접촉 판정과 **매끄러운
// 접촉 법선**이 필요한데, BVH 면 법선은 삼각형 단위로 튀어서(인접 열이
// 서로 다른 삼각형에 달라붙는 잔물결의 발생원) 접선 분해가 불안정하다.
// SDF 기울기는 연속적이라 이 문제가 없다.
//
// 굽기 비용은 rebuildCollision(200ms 디바운스, 워커) 때 한 번뿐이고,
// 조회는 트라이리니어 보간이라 O(1) — BVH 트리 탐색보다 훨씬 싸다.
export interface SdfField {
  originX: number;
  originY: number;
  originZ: number;
  nx: number;
  ny: number;
  nz: number;
  voxel: number;
  data: Float32Array;
  // 탐지 반경 밖(=필드 밖)에서 쓰는 값 — "충분히 멀다"는 뜻의 양수.
  farValue: number;
}

// 와인딩 비의존 부호 샘플러 — SDF 굽기용.
//
// M2-3 1차 시도가 하드 실패(앞뒤판 교차 31~36개)한 원인이 이것이다:
// ArrayBvhCollision.signedClearance는 최근접 삼각형의 면 법선과 내적해
// 부호를 정하는데, 이 마네킹 메시는 일부 영역 와인딩이 뒤집혀 있어 그
// 영역의 부호가 통째로 반대가 된다. 그 필드로 밀어내면 기울기가 몸
// 안쪽을 가리켜 파티클을 관통시킨다.
//
// 대신 coverageMetric.ts의 orientOutward와 **같은 전제**를 쓴다: 몸통은
// 세로축 기준 대략 star-shaped이므로, "표면점 → 질의점" 벡터가 방사
// 바깥 방향과 같은 쪽이면 밖(양수), 반대면 안(음수)이다. 어깨 꼭대기는
// 방사 성분이 0에 가까우므로 위쪽 성분을 조금 섞는다(같은 이유, 같은 계수).
// 이 전제는 커버리지 지표에서 이미 실측 검증됐다.
export function makeRadialSignedSampler(
  mesh: { closestPointUnsigned(px: number, py: number, pz: number, r: number): { x: number; y: number; z: number; distance: number } | null },
  centerX: number,
  centerZ: number,
  detectionRadius: number,
  farValue: number,
): (x: number, y: number, z: number) => number {
  return (x, y, z) => {
    const c = mesh.closestPointUnsigned(x, y, z, detectionRadius);
    if (!c) return farValue;
    const rx = x - centerX;
    const rz = z - centerZ;
    const rLen = Math.hypot(rx, rz) || 1e-9;
    const refX = rx / rLen;
    const refY = 0.25;
    const refZ = rz / rLen;
    const dot = (x - c.x) * refX + (y - c.y) * refY + (z - c.z) * refZ;
    return dot >= 0 ? c.distance : -c.distance;
  };
}

// sample: 월드 좌표의 부호거리(몸 안쪽 음수). null이면 탐지 반경 밖.
export function bakeSdf(
  sample: (x: number, y: number, z: number) => number | null,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  voxel: number,
  farValue = 0.3,
): SdfField {
  const nx = Math.max(2, Math.ceil((max.x - min.x) / voxel) + 1);
  const ny = Math.max(2, Math.ceil((max.y - min.y) / voxel) + 1);
  const nz = Math.max(2, Math.ceil((max.z - min.z) / voxel) + 1);
  const data = new Float32Array(nx * ny * nz);
  let i = 0;
  for (let iz = 0; iz < nz; iz++) {
    const z = min.z + iz * voxel;
    for (let iy = 0; iy < ny; iy++) {
      const y = min.y + iy * voxel;
      for (let ix = 0; ix < nx; ix++) {
        const x = min.x + ix * voxel;
        const d = sample(x, y, z);
        data[i++] = d === null ? farValue : d;
      }
    }
  }
  return { originX: min.x, originY: min.y, originZ: min.z, nx, ny, nz, voxel, data, farValue };
}

// 트라이리니어 보간. 필드 밖은 farValue(=접촉 없음).
export function sampleSdf(f: SdfField, x: number, y: number, z: number): number {
  const gx = (x - f.originX) / f.voxel;
  const gy = (y - f.originY) / f.voxel;
  const gz = (z - f.originZ) / f.voxel;
  if (gx < 0 || gy < 0 || gz < 0 || gx > f.nx - 1 || gy > f.ny - 1 || gz > f.nz - 1) return f.farValue;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const x1 = Math.min(x0 + 1, f.nx - 1);
  const y1 = Math.min(y0 + 1, f.ny - 1);
  const z1 = Math.min(z0 + 1, f.nz - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const tz = gz - z0;
  const idx = (a: number, b: number, c: number) => a + b * f.nx + c * f.nx * f.ny;
  const d = f.data;
  const c00 = d[idx(x0, y0, z0)] * (1 - tx) + d[idx(x1, y0, z0)] * tx;
  const c10 = d[idx(x0, y1, z0)] * (1 - tx) + d[idx(x1, y1, z0)] * tx;
  const c01 = d[idx(x0, y0, z1)] * (1 - tx) + d[idx(x1, y0, z1)] * tx;
  const c11 = d[idx(x0, y1, z1)] * (1 - tx) + d[idx(x1, y1, z1)] * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

// 중앙차분 기울기(정규화) = 표면 바깥 법선.
export function sdfNormal(f: SdfField, x: number, y: number, z: number, out: { x: number; y: number; z: number }): boolean {
  const h = f.voxel;
  const gx = sampleSdf(f, x + h, y, z) - sampleSdf(f, x - h, y, z);
  const gy = sampleSdf(f, x, y + h, z) - sampleSdf(f, x, y - h, z);
  const gz = sampleSdf(f, x, y, z + h) - sampleSdf(f, x, y, z - h);
  const len = Math.hypot(gx, gy, gz);
  if (len < 1e-9) return false;
  out.x = gx / len;
  out.y = gy / len;
  out.z = gz / len;
  return true;
}

// M2-3: 밀어내기를 BVH 면 법선 → SDF 기울기로 교체. 의미는 기존
// ArrayBvhCollision.createResolver와 **문자 그대로 동일**하게 유지한다:
// 탐지 반경 안이면 관통 여부와 무관하게 목표를 "표면 + margin"으로 잡고
// PUSH_RELAXATION만큼 이동(= 양방향 흡착). 바뀌는 건 법선의 출처뿐 —
// BVH는 삼각형 단위로 법선이 튀어서 인접 열이 서로 다른 면에 달라붙는
// 잔물결(스무딩 도입 사유)을 만들고, SDF 기울기는 연속이라 그게 없다.
// 흡착 자체를 완화하는 건 별개 단계(M2-4)로 분리한다 — 한 번에 두 개를
// 바꾸면 원인 분리가 안 된다.
//
// columnRange: 몸통 열 범위만 대상(소매 열은 팔 캡슐 담당) — 기존
// 리졸버와 같은 살아있는 참조 객체.
export function createSdfPushResolver(
  getField: () => SdfField | null,
  margin: number,
  detectionRadius: number,
  relaxation: number,
  columnRange?: { cols: number; min: number; max: number },
): (positions: Float32Array, pinned: Uint8Array, n: number) => void {
  const normal = { x: 0, y: 0, z: 0 };
  return (positions, pinned, n) => {
    const field = getField();
    if (!field) return;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      if (columnRange) {
        const col = i % columnRange.cols;
        if (col < columnRange.min || col > columnRange.max) continue;
      }
      const ix = i * 3;
      const px = positions[ix];
      const py = positions[ix + 1];
      const pz = positions[ix + 2];
      const d = sampleSdf(field, px, py, pz);
      // BVH의 "hit 없으면 continue"에 대응 — 필드 밖은 farValue라 자동 스킵.
      if (d > detectionRadius) continue;
      if (!sdfNormal(field, px, py, pz, normal)) continue;
      // 표면점 = p - d*n, 목표 = 표면점 + margin*n = p + (margin - d)*n.
      const push = (margin - d) * relaxation;
      positions[ix] = px + normal.x * push;
      positions[ix + 1] = py + normal.y * push;
      positions[ix + 2] = pz + normal.z * push;
    }
  };
}

export interface FrictionParams {
  // 접촉으로 볼 거리(표면에서 이 이내면 접촉) — COLLISION_MARGIN 근처.
  contactBand: number;
  // 정지/운동 마찰 계수(무차원). 정지: 접선 이동량이 muStatic*침투깊이보다
  // 작으면 통째로 되돌린다(안 미끄러짐). 운동: 그 이상이면 비례 감쇠.
  muStatic: number;
  muKinetic: number;
}

// Verlet 마찰: 위치는 그대로 두고 prevPositions의 접선 성분만 보정한다 —
// 위치를 건드리면 충돌/제약이 방금 푼 것을 되돌리게 되고, prev를 안 고치면
// 다음 스텝에서 같은 접선 속도가 그대로 되살아나 "감쇠"일 뿐 마찰이 아니다.
// (이 구분을 놓치면 에너지가 새거나 마찰이 안 먹는다 — 설계 노트의 함정.)
export function createSdfFrictionPass(
  getField: () => SdfField | null,
  params: FrictionParams,
): (positions: Float32Array, prevPositions: Float32Array, pinned: Uint8Array, n: number) => void {
  const normal = { x: 0, y: 0, z: 0 };
  return (positions, prevPositions, pinned, n) => {
    const field = getField();
    if (!field) return;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const ix = i * 3;
      const px = positions[ix];
      const py = positions[ix + 1];
      const pz = positions[ix + 2];
      const sd = sampleSdf(field, px, py, pz);
      if (sd > params.contactBand) continue;
      if (!sdfNormal(field, px, py, pz, normal)) continue;
      // 접촉 하중 근사 — 표면에 가까울수록(파고들수록) 크다.
      const load = Math.min(1, Math.max(0, (params.contactBand - sd) / params.contactBand));
      if (load <= 0) continue;

      const dx = px - prevPositions[ix];
      const dy = py - prevPositions[ix + 1];
      const dz = pz - prevPositions[ix + 2];
      const dn = dx * normal.x + dy * normal.y + dz * normal.z;
      let tx = dx - dn * normal.x;
      let ty = dy - dn * normal.y;
      let tz = dz - dn * normal.z;
      const tLen = Math.hypot(tx, ty, tz);
      if (tLen < 1e-9) continue;

      // 정지 마찰 문턱 — contactBand 스케일로 정규화한 하중 기준.
      const staticLimit = params.muStatic * load * params.contactBand;
      let scale: number;
      if (tLen <= staticLimit) {
        scale = 0; // 완전 정지(안 미끄러짐)
      } else {
        const drop = params.muKinetic * load * params.contactBand;
        scale = Math.max(0, (tLen - drop) / tLen);
      }
      tx *= scale;
      ty *= scale;
      tz *= scale;
      // prev = pos - (법선 성분 + 감쇠된 접선 성분)
      prevPositions[ix] = px - (dn * normal.x + tx);
      prevPositions[ix + 1] = py - (dn * normal.y + ty);
      prevPositions[ix + 2] = pz - (dn * normal.z + tz);
    }
  };
}
