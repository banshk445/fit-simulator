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
  // maxDeg/varianceDeg2에서 제외한 앞판↔뒤판 경계 두 지점 — 버리지 않고
  // 그대로 노출해 정보 손실이 없게 한다.
  panelBoundaryDeg: { shoulder: number; armpit: number };
}

// 암홀 링 전용 — 순회 순서가 front row0..armholeStartRow + back
// row armholeStartRow..0(역순)이라, 링 길이 n = 2*(armholeStartRow+1)이고
// 인접쌍 n개 중 정확히 2개만 앞판↔뒤판 경계를 넘는다:
//   diffsDeg[n-1]     = back row0 ↔ front row0   = 어깨 접합부
//   diffsDeg[n/2 - 1] = front row(asr) ↔ back row(asr) = 겨드랑이 접합부
//
// 이 두 지점은 앞판/뒤판이 별개 BufferGeometry라 computeVertexNormals()가
// 서로 독립적으로 법선을 계산한다 — 어깨에서 앞판은 가슴 쪽(+Z), 뒤판은 등
// 쪽(-Z)을 향해 구조적으로 크게 어긋나는 게 정상이다(실측 90~111°). 즉 두
// 값은 "천이 얼마나 톱니졌나"가 아니라 "앞뒤판이 몇 도로 만나나"라는 기하학적
// 아티팩트라, 천 품질 지표에 섞이면 안 된다.
//
// 어깨를 안 뺐을 때: max()를 독점해서 나머지 인접쌍이 아무리 개선돼도 지표가
// 전혀 안 움직였다(docs/pattern-redesign.md 8/10번 — 소매 전용 변형 다섯 번
// 내내 armhole 고정, 16/17번 — 링을 24점으로 늘려도 무변화가 전부 이걸로
// 설명된다).
//
// 어깨만 뺐을 때(18번 실측): 이번엔 겨드랑이가 max를 잡았다 — 품50·품65에서
// "어깨제외 max"가 겨드랑이값과 정확히 일치(47.7/64.1/87.1/87.9/89.7). 게다가
// 겨드랑이 자체가 품55 9.6° ~ 품65 89.7°로 9배 변동해, 천이 아니라 품(둘레)에
// 따라 앞뒤판이 만나는 각도가 달라지는 것을 그대로 재고 있었다.
//
// 그래서 둘 다 통계에서 뺀다. 뺀 값은 panelBoundaryDeg로 그대로 노출하고
// diffsDeg도 링 전체를 유지하므로 정보 손실은 없다.
export function armholeRingJaggedness(normals: readonly Vec3Like[]): ArmholeRingJaggedness {
  const n = normals.length;
  const diffsDeg = ringDiffsDeg(normals);
  // ponytail: 링은 구성상 항상 2*(armholeStartRow+1)이라 짝수 — 홀수가 들어오면
  // armpitIdx가 반칸 어긋난다. 호출부가 하나뿐이라 방어 대신 전제만 적어둔다.
  const shoulderIdx = n - 1;
  const armpitIdx = n / 2 - 1;
  const considered = diffsDeg.filter((_, k) => k !== shoulderIdx && k !== armpitIdx);
  return {
    ...summarize(diffsDeg, considered),
    panelBoundaryDeg: {
      shoulder: Number(diffsDeg[shoulderIdx].toFixed(2)),
      armpit: Number(diffsDeg[armpitIdx].toFixed(2)),
    },
  };
}
