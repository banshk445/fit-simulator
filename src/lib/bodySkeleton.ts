// 몸 골격 선분 — 부호·대역 판정의 공통 기준(규범 1: 몸 기준 도출).
//
// 왜 있나: 이 저장소의 부호 판정은 두 번 같은 이유로 틀렸다.
//   (1) SDF 밀어내기 M2-3 1차 — 와인딩 의존 부호 → 하드 실패.
//   (2) 그 대체물인 `makeRadialSignedSampler`의 **세로축 단일 방사 + 위쪽
//       25% 특례** — 어깨 능선처럼 방사 성분이 0에 가까운 곳에서 부호가
//       흔들린다. Stage 1a 1회차의 어깨 부양(hover top-back +41%)이 그
//       증상이고, 소매 콜라이더 기각의 확정 원인 후보도 같은 전제
//       (star-shaped)의 붕괴다.
//
// 해법의 일반화: 기준을 "세로축 하나"에서 **골격 선분 집합**으로 올린다.
// 질의점의 최근접 골격점을 찾아 그 점에서 밖으로 나가는 방향을 참조로 쓴다.
// 몸은 세로축 하나에 대해 star-shaped가 아니지만, 몸통 축 + 팔 축의
// 합집합에 대해서는 국소적으로 star-shaped에 훨씬 가깝다.
//
// **몸통 축이 어깨 관절 높이에서 끝나는 것이 이 설계의 핵심**이다 —
// 어깨 캡(관절보다 위)의 최근접 골격점은 축의 끝점이 되고, 참조 방향이
// 자동으로 위쪽 성분을 얻는다. 즉 `refY = 0.25` 특례가 손으로 흉내던
// 것을 기하가 원리로 준다. 축을 머리까지 연장하면 그 성분이 사라져
// 특례 이전 상태로 되돌아간다(연장 금지).
import type { Vec3Like } from "./clothProtocol";

export interface Segment {
  a: Vec3Like;
  b: Vec3Like;
}

// 점 p에서 선분 ab의 최근접점. t는 [0,1]로 클램프 — 끝점 밖은 끝점으로
// 접히고, 그 접힘이 위 주석의 "어깨 캡이 위쪽 성분을 얻는" 기전이다.
export function closestOnSegment(px: number, py: number, pz: number, s: Segment): [number, number, number] {
  const abx = s.b.x - s.a.x, aby = s.b.y - s.a.y, abz = s.b.z - s.a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  const t = abLenSq > 1e-9 ? Math.min(1, Math.max(0, ((px - s.a.x) * abx + (py - s.a.y) * aby + (pz - s.a.z) * abz) / abLenSq)) : 0;
  return [s.a.x + abx * t, s.a.y + aby * t, s.a.z + abz * t];
}

export function nearestOnSegments(
  px: number, py: number, pz: number,
  segments: readonly Segment[],
): { d2: number; segment: Segment; x: number; y: number; z: number } {
  let best = Infinity;
  let bx = px, by = py, bz = pz;
  let bestSeg = segments[0];
  for (const s of segments) {
    const [cx, cy, cz] = closestOnSegment(px, py, pz, s);
    const d2 = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
    if (d2 < best) { best = d2; bx = cx; by = cy; bz = cz; bestSeg = s; }
  }
  return { d2: best, segment: bestSeg, x: bx, y: by, z: bz };
}

export interface BodySkeleton {
  // 몸통 축 폴리라인 + 좌우 팔 — 부호 참조는 이 전체 집합의 최근접점.
  segments: Segment[];
  torso: Segment[];
  arms: Segment[];
}

// 팔 축 근방으로 인정할 수직 거리 — meshCollision.ARM_EXCLUDE_RADIUS,
// coverageMetric.SHOULDER_BAND_RADIUS와 **같은 값**이어야 한다. 세 곳이
// 전부 "여기부터는 팔 영역"이라는 같은 판단을 하고 있고, 갈라지면 대역과
// 부호 기준이 서로 다른 몸을 보게 된다(함정 6).
export const ARM_AXIS_RADIUS = 0.09;

// 골격을 몸 메시와 뼈대 실측에서 도출한다. 하드코딩 금지 —
// 어깨 관절/팔 방향은 뼈대(trueShoulder, dir), 팔 길이와 축 하단은 메시.
export function deriveBodySkeleton(
  position: Float32Array,
  // 팔 제외 몸통 인덱스(frontIndex+backIndex 계열) — 단면 중앙 도출용.
  torsoIndex: ArrayLike<number> | null,
  arms: readonly { trueShoulder: Vec3Like; dir: Vec3Like }[],
  centerX: number,
  centerZ: number,
  // 몸통 축 하단 — 토르소 프록시 캡슐의 골반 하단
  // (`buildTorsoProxyCapsules`: shoulderY − heightM×0.35, 몸 실측 도출).
  // **몸 메시 최저점(발)을 쓰면 안 된다**: 축이 가랑이 밑에서 다리 사이
  // 공기 중으로 나가고, 그러면 (i) 허벅지 안쪽 표면의 참조 방향이 뒤집히고
  // (ii) "축은 몸 내부"라는 오라클 전제가 깨진다. 첫 실행에서 실제로
  // 이 오염이 잡혔다(몸통 대조군 불일치 11~29%의 주 성분).
  torsoBottomY: number,
): BodySkeleton {
  const n = position.length / 3;
  // 팔 길이 = 팔 반직선 수직거리 ARM_AXIS_RADIUS 안쪽 정점의 최대 축방향
  // 투영(= 손끝). 반경 게이트 없이 전체 최대를 쓰면 dir의 아래 성분 때문에
  // **발**이 최대가 된다(팔 59° 하향 자세에서 실제로 그렇다).
  const armLen = arms.map(({ trueShoulder, dir }) => {
    let maxT = 0;
    for (let i = 0; i < n; i++) {
      const vx = position[i * 3] - trueShoulder.x;
      const vy = position[i * 3 + 1] - trueShoulder.y;
      const vz = position[i * 3 + 2] - trueShoulder.z;
      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t <= 0) continue;
      const px = vx - dir.x * t, py = vy - dir.y * t, pz = vz - dir.z * t;
      if (px * px + py * py + pz * pz > ARM_AXIS_RADIUS * ARM_AXIS_RADIUS) continue;
      if (t > maxT) maxT = t;
    }
    return maxT;
  });
  const shoulderY = Math.max(...arms.map((a) => a.trueShoulder.y));
  // 몸통 축은 **직선이 아니라 폴리라인**이다. 어깨에서 딴 (x,z)로 수직선을
  // 그으면 몸통 중앙을 벗어난다 — 이 마네킹의 단면 z중앙은 골반 +0.024 →
  // 허리(y1.08) +0.050 → 어깨 −0.014로 6.4cm 흐른다(실측). 그 직선축은
  // 허리에서 등 표면과 0.7cm까지 붙어, (i) 참조 방향이 거의 퇴화하고
  // (ii) "축은 몸 내부" 오라클 전제가 깨진다. 높이별 단면 중앙을 이어
  // 폴리라인으로 만들면 두 문제가 같이 사라진다.
  // 슬라이스 수는 물리 상수가 아니라 이산화 폭이다(축 드리프트를 따라갈
  // 만큼 촘촘하면 된다 — 구간 길이의 1/12 ≈ 5cm).
  const SLICES = 12;
  const torso: Segment[] = [];
  {
    const step = (shoulderY - torsoBottomY) / SLICES;
    const center = (y0: number): Vec3Like => {
      let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity, cnt = 0;
      // 팔 제외 몸통 인덱스의 정점만 — 팔이 섞이면 단면 극값이 팔로 잡힌다.
      if (torsoIndex) {
        for (let t = 0; t < torsoIndex.length; t++) {
          const vi = torsoIndex[t];
          const y = position[vi * 3 + 1];
          if (Math.abs(y - y0) > step / 2) continue;
          const x = position[vi * 3], z = position[vi * 3 + 2];
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (z < zMin) zMin = z; if (z > zMax) zMax = z;
          cnt++;
        }
      }
      // 표본이 없으면(슬라이스가 비면) 어깨 기준 축으로 폴백.
      return cnt > 0 ? { x: (xMin + xMax) / 2, y: y0, z: (zMin + zMax) / 2 } : { x: centerX, y: y0, z: centerZ };
    };
    let prev = center(torsoBottomY);
    for (let i = 1; i <= SLICES; i++) {
      const next = center(torsoBottomY + step * i);
      torso.push({ a: prev, b: next });
      prev = next;
    }
  }
  const armSegs: Segment[] = arms.map(({ trueShoulder, dir }, i) => ({
    a: trueShoulder,
    b: { x: trueShoulder.x + dir.x * armLen[i], y: trueShoulder.y + dir.y * armLen[i], z: trueShoulder.z + dir.z * armLen[i] },
  }));
  return { segments: [...torso, ...armSegs], torso, arms: armSegs };
}
