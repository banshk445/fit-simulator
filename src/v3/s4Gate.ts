/* v3-37 §3 — **브라우저용 S4 게이트**. 문턱은 Node 게이트와 «같은 값»이고 새 문턱 0.
 *
 * 왜 필요한가: v3-36 #72가 「Node 에서 통과한 ③a 가 브라우저에서 깨진다」를 실증했다
 * ⟹ **Node 게이트가 제품을 보증하지 못한다.** 제품이 도는 곳에서 재야 한다.
 *
 * 판정 로직은 하네스의 그것을 «옮긴 것»이고 계기는 `instruments.ts` 를 공유한다(#65).
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · console 0.
 */
import { SEP, THICK, TOL_SELF, DAMP, DT } from './consts.ts';
import { minPairDist, makeBodyDistance } from './instruments.ts';
import type { Prepared } from './dressRun.ts';

/** v3 누적 등재 문턱 — **이 파일이 새로 정하는 수는 0이다.** */
export const S4_THRESHOLD = {
  penMaxM: 5e-4,        // ③a 절대 관통 ≤ 0.5mm (v3-29 「두께의 절반」 도출분)
  crossings: 0,         // 자기관통 삼각형 교차 0
  ringRatio: 1.1,       // 목선 원주비 ≤ 1.10 (설계 §4 S4 ② · v3-24 확인)
  settleNetM: TOL_SELF, // 창 순변위 ≤ 0.1mm (v3-22 형상 불변 채널)
  pinned: 0,            // 보조 장치 0
} as const;

export type S4Result = {
  pass: boolean;
  penMaxM: number; penCnt: number; penWorstVertex: number; penWorstXYZ: [number, number, number];
  crossings: number; minPairM: number;
  seamMedM: number; seamMaxM: number;
  lambdaMax: number; ringRatio: number;
  settleNetM: number; settled: boolean;
  pinned: number; diverged: boolean;
  fails: string[];
};

/** N_WIN 프레임의 «창 순변위» — v3-22 채널. `before` 는 그 창의 시작 상태다. */
export const N_WIN = Math.round(1 / (DAMP * DT));

/**
 * 정착 상태로 본 장면에 S4 시험 전량을 건다.
 * `before` 를 주면 창 순변위를 함께 낸다(없으면 정착은 «미확인»으로 둔다).
 */
export function runS4Gate(P: Prepared, before?: Float64Array): S4Result {
  const sc = P.sc;
  const pos = sc.s.pos;
  const fails: string[] = [];

  const bd = makeBodyDistance({
    pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK,
  });
  const bc = bd.bodyClearance(sc.s);
  const mp = minPairDist(pos, sc.tris, SEP * 3);

  const gaps: number[] = [];
  for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++)
    gaps.push(Math.hypot(pos[sm.a[k] * 3] - pos[sm.b[k] * 3],
                         pos[sm.a[k] * 3 + 1] - pos[sm.b[k] * 3 + 1],
                         pos[sm.a[k] * 3 + 2] - pos[sm.b[k] * 3 + 2]));
  gaps.sort((a, b) => a - b);

  let lambdaMax = 0;
  for (const c of sc.cons) {
    if (c.kind !== 'inplane') continue;
    const o0 = c.i0 * 3, o1 = c.i1 * 3, o2 = c.i2 * 3;
    const e1 = [pos[o1] - pos[o0], pos[o1 + 1] - pos[o0 + 1], pos[o1 + 2] - pos[o0 + 2]];
    const e2 = [pos[o2] - pos[o0], pos[o2 + 1] - pos[o0 + 1], pos[o2 + 2] - pos[o0 + 2]];
    const xu = [c.a * e1[0] + c.b * e2[0], c.a * e1[1] + c.b * e2[1], c.a * e1[2] + c.b * e2[2]];
    const xv = [c.c * e1[0] + c.d * e2[0], c.c * e1[1] + c.d * e2[1], c.c * e1[2] + c.d * e2[2]];
    const C00 = xu[0] ** 2 + xu[1] ** 2 + xu[2] ** 2, C11 = xv[0] ** 2 + xv[1] ** 2 + xv[2] ** 2;
    const C01 = xu[0] * xv[0] + xu[1] * xv[1] + xu[2] * xv[2];
    const tr = C00 + C11, dt2 = Math.sqrt(Math.max(0, (C00 - C11) ** 2 + 4 * C01 * C01));
    lambdaMax = Math.max(lambdaMax, Math.sqrt(Math.max(0, 0.5 * (tr + dt2))));
  }

  const polyLen = (ix: number[]) => ix.slice(1).reduce((t, v, k) =>
    t + Math.hypot(pos[v * 3] - pos[ix[k] * 3], pos[v * 3 + 1] - pos[ix[k] * 3 + 1],
                   pos[v * 3 + 2] - pos[ix[k] * 3 + 2]), 0);
  const ringRatio = (polyLen(P.neckF) + polyLen(P.neckB)) / P.ringRest;

  let pinned = 0;
  for (let v = 0; v < sc.n; v++) if (sc.s.invMass[v] === 0) pinned++;

  let settleNetM = NaN, settled = false;
  if (before) {
    let net = 0;
    for (let v = 0; v < sc.n; v++)
      net = Math.max(net, Math.hypot(pos[v * 3] - before[v * 3], pos[v * 3 + 1] - before[v * 3 + 1],
                                     pos[v * 3 + 2] - before[v * 3 + 2]));
    settleNetM = net;
    settled = net <= S4_THRESHOLD.settleNetM;
  }
  const diverged = !Number.isFinite(pos[0]);

  if (!(bc.maxPen <= S4_THRESHOLD.penMaxM)) fails.push(`③a 관통 ${(bc.maxPen * 1000).toFixed(4)}mm > 0.5mm`);
  if (mp.hits !== S4_THRESHOLD.crossings) fails.push(`자기관통 교차 ${mp.hits} ≠ 0`);
  if (!(ringRatio <= S4_THRESHOLD.ringRatio)) fails.push(`목선 원주비 ${ringRatio.toFixed(4)} > 1.10`);
  if (pinned !== S4_THRESHOLD.pinned) fails.push(`보조 장치(invMass=0) ${pinned} ≠ 0`);
  if (before && !settled) fails.push(`정착 창 순변위 ${(settleNetM * 1000).toFixed(4)}mm > 0.1mm`);
  if (diverged) fails.push('발산');

  const wo = bc.worstPen >= 0 ? bc.worstPen : 0;
  return {
    pass: fails.length === 0,
    penMaxM: bc.maxPen, penCnt: bc.penCnt, penWorstVertex: bc.worstPen,
    penWorstXYZ: [pos[wo * 3], pos[wo * 3 + 1], pos[wo * 3 + 2]],
    crossings: mp.hits, minPairM: mp.min,
    seamMedM: gaps[Math.floor(gaps.length / 2)], seamMaxM: gaps[gaps.length - 1],
    lambdaMax, ringRatio, settleNetM, settled, pinned, diverged, fails,
  };
}
