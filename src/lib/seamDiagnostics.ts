import type { Vec3Like } from "./clothProtocol";

export function angleDegBetweenNormals(a: Vec3Like, b: Vec3Like): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

export interface RingJaggedness {
  diffsDeg: number[];
  maxDeg: number;
  varianceDeg2: number;
}

// 링을 따라 인접(랩 포함) 법선 각도차 — diffsDeg[k] = normals[k] ↔ normals[k+1].
function ringDiffsDeg(normals: readonly Vec3Like[]): number[] {
  const n = normals.length;
  return normals.map((v, k) => angleDegBetweenNormals(v, normals[(k + 1) % n]));
}

// diffsDeg는 언제나 링 전체를 그대로 담고(정보 손실 없음), 통계(maxDeg/
// varianceDeg2)만 considered 부분집합으로 낸다 — 즉 max(diffsDeg)와 maxDeg가
// 다를 수 있다(armholeRingJaggedness가 그 경우).
function summarize(diffsDeg: readonly number[], considered: readonly number[]): RingJaggedness {
  const mean = considered.reduce((s, d) => s + d, 0) / considered.length;
  const varianceDeg2 = considered.reduce((s, d) => s + (d - mean) ** 2, 0) / considered.length;
  return {
    diffsDeg: diffsDeg.map((d) => Number(d.toFixed(2))),
    maxDeg: Number(Math.max(...considered).toFixed(2)),
    varianceDeg2: Number(varianceDeg2.toFixed(2)),
  };
}

// 정점 인접(랩 포함) 법선 각도차의 분산/최댓값 — 값이 클수록 그 링을
// 따라 법선이 급격히 꺾인다(=톱니가 심하다)는 뜻. Garment.tsx의
// seamNormalJaggedness(브라우저)와 scripts/paramSweep.ts(Node)가 같이 쓴다.
//
// 소매 링(같은 패널 하나로 닫힌 원통)에는 이걸 그대로 쓴다 — wrap 이음매
// (col0 ↔ col(cols-1))는 같은 BufferGeometry라 법선이 이어져야 정상이고,
// Garment.tsx의 averageSleeveSeamNormals가 이미 그 두 열의 법선을 평균내
// 맞춰준다. 암홀 링은 사정이 다르므로 아래 armholeRingJaggedness를 쓸 것.
export function ringJaggedness(normals: readonly Vec3Like[]): RingJaggedness {
  const diffsDeg = ringDiffsDeg(normals);
  return summarize(diffsDeg, diffsDeg);
}

export interface ArmholeRingJaggedness extends RingJaggedness {
  // 패널 경계 두 지점을 따로 보고한다. shoulder는 maxDeg/varianceDeg2에서
  // 제외된 값이고, armpit은 포함돼 있지만 경계라서 참고용으로 같이 낸다.
  panelBoundaryDeg: { shoulder: number; armpit: number };
}

// 암홀 링 전용 — 순회 순서가 front row0..armholeStartRow + back
// row armholeStartRow..0(역순)이라, 링 길이 n = 2*(armholeStartRow+1)이고
// 인접쌍 n개 중 정확히 2개만 앞판↔뒤판 경계를 넘는다:
//   diffsDeg[n-1]     = back row0 ↔ front row0   = 어깨 접합부
//   diffsDeg[n/2 - 1] = front row(asr) ↔ back row(asr) = 겨드랑이 접합부
//
// 어깨 접합부는 앞판/뒤판이 별개 BufferGeometry라 computeVertexNormals()가
// 서로 독립적으로 법선을 계산한다 — 앞판은 가슴 쪽(+Z), 뒤판은 등 쪽(-Z)을
// 향해 구조적으로 크게 어긋나는 게 정상이다(실측 90~111°). 이 값이 max()를
// 독점해서, 나머지 10개 인접쌍이 아무리 개선돼도 지표가 전혀 안 움직였다
// (docs/pattern-redesign.md 8/10번: 다섯 가지 소매 전용 변형 내내 armhole
// 성분이 고정이었던 것, 16/17번: 링을 24점으로 늘려도 무변화였던 것이 전부
// 이걸로 설명된다). 그래서 maxDeg/varianceDeg2에서 어깨만 빼고, 뺀 값은
// panelBoundaryDeg.shoulder로 그대로 노출해 놓친 게 없게 한다.
//
// 겨드랑이는 실측 32~40°로 내부값과 같은 자릿수라 이상치가 아니다 — 빼지
// 않고 통계에 그대로 포함하되 위치가 경계라는 것만 별도로 보고한다.
export function armholeRingJaggedness(normals: readonly Vec3Like[]): ArmholeRingJaggedness {
  const n = normals.length;
  const diffsDeg = ringDiffsDeg(normals);
  // ponytail: 링은 구성상 항상 2*(armholeStartRow+1)이라 짝수 — 홀수가 들어오면
  // armpitIdx가 반칸 어긋난다. 호출부가 하나뿐이라 방어 대신 전제만 적어둔다.
  const shoulderIdx = n - 1;
  const armpitIdx = n / 2 - 1;
  const considered = diffsDeg.filter((_, k) => k !== shoulderIdx);
  return {
    ...summarize(diffsDeg, considered),
    panelBoundaryDeg: {
      shoulder: Number(diffsDeg[shoulderIdx].toFixed(2)),
      armpit: Number(diffsDeg[armpitIdx].toFixed(2)),
    },
  };
}
