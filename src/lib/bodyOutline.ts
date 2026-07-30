// v2 — **단면 윤곽 계기**(15회차). 높이 h 평면에서 각도별 레이캐스트로 몸 표면
// 교점을 직접 취득한다.
//
// ## 왜 새로 만드나
// 기존 두 계기는 **둘레를 재려고** 만든 것이라 그 위에 정점을 얹으면 몸을
// 파고든다(14회차 실측):
//   - 볼록껍질(`bodyMeasure.loopAt`): 정점은 밖이지만 **변**이 최대 7.22cm
//     가로지른다(y135). 팔 제외로 각도 bin이 비는 대역에서 껍질 정점이
//     8~12개로 줄고 그 긴 변이 몸통을 질러가기 때문.
//   - 각도 bin 최근접 반경 폴리곤: **정점 자체**가 최대 3.91cm 안쪽이다.
//     bin 반경이 그 bin 안 **최소** 거리이고 빈 bin은 이웃 보간이라서.
// 둘 다 근사의 방향이 안쪽이다. 레이캐스트는 표면과의 **실제 교점**이라
// 그 편향이 원리적으로 없다.
//
// ## 빈 각도(팔 제외 구멍) 규칙 — 계기 안에서 정한다
// 몸통 메시는 팔 축 반경 9cm 안 삼각형이 빠져 있어(`excludeArms`) 어깨~가슴
// 대역에서 레이가 아무것도 못 맞히는 각도가 생긴다. **이웃 보간은 금지**
// (14회차의 실패원 — 실제 표면보다 안쪽으로 잡힌다). 두 규칙을 두고 검사로
// 고른다:
//   "fallback" — 그 각도에서 **전신 메시**의 첫 교점을 쓴다(팔 표면을 따라간다).
//   "drop"     — 그 각도를 곡선에서 빼고 이웃끼리 현으로 잇는다.
import * as THREE from "three";

export interface OutlineMesh {
  raycastFirst(origin: THREE.Vector3, direction: THREE.Vector3, far: number): THREE.Vector3 | null;
}

export type EmptyAngleRule = "fallback" | "drop";

export interface SliceOutline {
  // 오프셋까지 적용된 닫힌 폴리라인(순서대로, 마지막은 첫 점과 잇는다).
  points: [number, number][];
  // 계기 진단 — 요청 각도 수 / 몸통 교점을 얻은 수 / 규칙이 처리한 수.
  angles: number;
  hitTorso: number;
  handled: number;
  // 오프셋 전 평균 반경(각도 분해능의 출처).
  meanRadiusM: number;
}

const RAY_FAR_M = 0.8;

function castRadius(
  mesh: OutlineMesh, cx: number, h: number, cz: number, dx: number, dz: number,
): number | null {
  const origin = new THREE.Vector3(cx, h, cz);
  const dir = new THREE.Vector3(dx, 0, dz);
  const hit = mesh.raycastFirst(origin, dir, RAY_FAR_M);
  if (!hit) return null;
  return Math.hypot(hit.x - cx, hit.z - cz);
}

/**
 * 높이 h의 단면 윤곽. `torso`는 팔 제외 몸통 메시, `whole`은 전신 메시
 * (빈 각도 규칙 "fallback"에서만 쓴다).
 *
 * 각도 분해능은 **도출**한다: 목표 엣지 길이가 그 높이 둘레에서 몇 등분인가.
 * 굵은 대역은 촘촘히, 목처럼 가는 대역은 성기게 — 상수 없음.
 */
export function sliceOutline(
  torso: OutlineMesh,
  whole: OutlineMesh,
  h: number,
  cx: number,
  cz: number,
  marginM: number,
  targetEdgeM: number,
  rule: EmptyAngleRule,
): SliceOutline {
  // 1) 거친 패스로 그 높이의 평균 반경을 잡는다(각도 분해능의 입력).
  const COARSE = 16;
  let sum = 0, n = 0;
  for (let i = 0; i < COARSE; i++) {
    const a = (i / COARSE) * 2 * Math.PI;
    const r = castRadius(torso, cx, h, cz, Math.cos(a), Math.sin(a));
    if (r !== null) { sum += r; n++; }
  }
  const meanRadiusM = n > 0 ? sum / n : 0;
  if (n === 0) return { points: [], angles: 0, hitTorso: 0, handled: 0, meanRadiusM: 0 };
  const angles = Math.max(8, Math.ceil((2 * Math.PI * meanRadiusM) / Math.max(1e-6, targetEdgeM)));

  // 2) 본 패스 — 각도마다 몸통 교점. 못 맞히면 규칙대로.
  const raw: { a: number; r: number }[] = [];
  let hitTorso = 0, handled = 0;
  for (let i = 0; i < angles; i++) {
    const a = (i / angles) * 2 * Math.PI;
    const dx = Math.cos(a), dz = Math.sin(a);
    const r = castRadius(torso, cx, h, cz, dx, dz);
    if (r !== null) { raw.push({ a, r }); hitTorso++; continue; }
    if (rule === "fallback") {
      const rw = castRadius(whole, cx, h, cz, dx, dz);
      if (rw !== null) { raw.push({ a, r: rw }); handled++; }
    } else {
      handled++; // drop — 이웃끼리 현으로 이어진다
    }
  }
  if (raw.length < 3) return { points: [], angles, hitTorso, handled, meanRadiusM };

  // 3) 옷 오프셋은 **표면 법선 방향**이다. 단면 안에서의 법선은 이웃 두 점이
  //    만드는 접선의 수직(바깥쪽)이고, 그것이 반경 방향보다 옳다 — 반경으로
  //    밀면 오목한 구간에서 오프셋이 표면을 향해 눕는다.
  const m = raw.length;
  const base: [number, number][] = raw.map((q) => [cx + Math.cos(q.a) * q.r, cz + Math.sin(q.a) * q.r]);
  const points: [number, number][] = [];
  for (let i = 0; i < m; i++) {
    const p = base[i], a = base[(i - 1 + m) % m], b = base[(i + 1) % m];
    const tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    // 바깥 방향: 접선의 수직 두 개 중 축에서 멀어지는 쪽.
    let nx = tz / l, nz = -tx / l;
    if ((p[0] - cx) * nx + (p[1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    points.push([p[0] + nx * marginM, p[1] + nz * marginM]);
  }
  return { points, angles, hitTorso, handled, meanRadiusM };
}

/**
 * 배치가 그대로 쓰는 형태의 제공자. 축은 몸 슬라이스에서 그 높이로 조회하고,
 * 각도 분해능의 입력(목표 엣지 길이)과 빈 각도 규칙은 호출부가 정한다.
 * 빈 각도 규칙은 `check:outline` 3자 대조에서 **fallback**이 이겼다
 * (변중점 최심 0.00cm vs drop 2.85cm) — 기본값이 그것이다.
 */
export function makeOutlineProvider(
  torso: OutlineMesh,
  whole: OutlineMesh,
  axisAt: (h: number) => [number, number],
  targetEdgeM: number,
  rule: EmptyAngleRule = "fallback",
): (h: number, marginM: number) => [number, number][] {
  return (h, marginM) => {
    const [cx, cz] = axisAt(h);
    return sliceOutline(torso, whole, h, cx, cz, marginM, targetEdgeM, rule).points;
  };
}
