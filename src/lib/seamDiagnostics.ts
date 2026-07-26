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

// 정점 인접(랩 포함) 법선 각도차의 분산/최댓값 — 값이 클수록 그 링을
// 따라 법선이 급격히 꺾인다(=톱니가 심하다)는 뜻. Garment.tsx의
// seamNormalJaggedness(브라우저)와 scripts/paramSweep.ts(Node)가 같이 쓴다.
export function ringJaggedness(normals: readonly Vec3Like[]): RingJaggedness {
  const n = normals.length;
  const diffsDeg = normals.map((v, k) => angleDegBetweenNormals(v, normals[(k + 1) % n]));
  const mean = diffsDeg.reduce((s, d) => s + d, 0) / n;
  const varianceDeg2 = diffsDeg.reduce((s, d) => s + (d - mean) ** 2, 0) / n;
  return {
    diffsDeg: diffsDeg.map((d) => Number(d.toFixed(2))),
    maxDeg: Number(Math.max(...diffsDeg).toFixed(2)),
    varianceDeg2: Number(varianceDeg2.toFixed(2)),
  };
}
