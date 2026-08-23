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

/* ══ v3-55 §1 — **접촉 모델의 «정의» 등재**(전략 세션 처분 ①). 코드 0줄 · `solver.ts` 무변경 ══
 *
 * **물리 접촉의 «몸 표면» = `bodySdf`(근사)다.** 실측 오차는 **최대 h의 약 25%**
 *   (밴드 안 최대차 **0.943 / 0.961 / 0.975mm** — gray/swim/sweat · v3-53 §2-1 등재분 · h 3.951mm).
 * 이것은 **결함이 아니라 «모델의 정의»**다 — 충돌체가 «메시»가 아니라 «그 메시에서 구운 격자장»이다.
 * 근사인 채로 두는 대신, **양쪽 방향을 «게이트»로 유계로 묶는다**:
 *   **음(−) 방향** = 옷이 몸 «안»으로 들어간 정도 → **③a**(`penMaxM` ≤ 0.5mm · **정확 거리로 판정**)
 *   **양(+) 방향** = 물리가 «떠 있다»고 본 거리와 실제 거리의 벌어짐 → **③b**(v3-55 신설 · 아래)
 * ⟹ **두 게이트가 함께 「SDF 를 접촉에 써도 결과가 유계다」를 보증**한다.
 * **선택지 ③(물리를 정확 거리로 교체)은 기각**됐다 — blob 무효화·재시뮬 예산이 **사용자 소유**다
 *   (v3-55 §0-1 · 전략 세션 처분).
 *
 * ── **게이트 ③b 정의**(측정은 `scripts/v3Gate3b.ts` · **이 파일의 판정 로직 0줄**) ──
 *   정의역  한 정착 blob 에서 **min(정확거리, `sampleSdf`) ≤ `SEP`** 인 정점 **전량**
 *           (= «접촉 근방» · **물리 0프레임 · 주입 경로**)
 *   측정    **Δ = |정확거리 − `sampleSdf`|** 의 **max · p95 · 표본수**
 *   문턱    그 SDF 필드에 대해 **이미 등재된 «밴드 안 최대차»**(v3-53 §2-1) —
 *           **새 수 0**(gray 0.943 / swim 0.961 / sweat 0.975mm 를 «인용»한다)
 *   판정    **max Δ ≤ 문턱 ⟹ 통과.** 초과하면 **접촉 근방이 밴드 전체보다 나쁘다**는 뜻이고,
 *           그때는 「밴드 가장자리에 몰린다」(v3-53 §2-1)는 등재 사실이 깨진 것이다
 * ══════════════════════════════════════════════════════════════════════════════ */

/** v3 누적 등재 문턱 — **이 파일이 새로 정하는 수는 0이다.** */
export const S4_THRESHOLD = {
  penMaxM: 5e-4,        // ③a 절대 관통 ≤ 0.5mm (v3-29 「두께의 절반」 도출분)
  crossings: 0,         // 자기관통 삼각형 교차 0
  /** v3-40 §1 — 목선 «초과비» R = C_ring / C_allow ≤ **1**.
   * C_allow = C_body + 2π(THICK + TOL_SELF) · C_body = 링을 몸에 정사영한 닫힌 둘레.
   * **1 은 고른 수가 아니라 «정의»다** — 어림수 1.10(v3-24)을 교체했다.
   * 구 채널(휴지 대비 비율)은 삭제하지 않고 `ringRestRatio` 로 **병기**한다(판정 아님). */
  ringExcess: 1,
  settleNetM: TOL_SELF, // 창 순변위 ≤ 0.1mm (v3-22 형상 불변 채널)
  pinned: 0,            // 보조 장치 0
} as const;

export type S4Result = {
  pass: boolean;
  penMaxM: number; penCnt: number; penWorstVertex: number; penWorstXYZ: [number, number, number];
  crossings: number; minPairM: number;
  seamMedM: number; seamMaxM: number;
  lambdaMax: number;
  /** v3-40 판정 채널 */ ringExcess: number; ringM: number; ringBodyM: number; ringAllowM: number;
  /** 구 채널 · 참고(판정 아님 · 옛 문턱 1.10) */ ringRestRatio: number;
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
  /** 구 채널 — 삭제하지 않고 병기(v3-40 §0-4). **판정에 쓰지 않는다.** */
  const ringRestRatio = (polyLen(P.neckF) + polyLen(P.neckB)) / P.ringRest;

  /* v3-40 §1 — 목선 «초과비». 링을 «닫힌 고리»로 보고, 그 링이 놓인 몸 자리의 둘레와 견준다. */
  const loop = [...P.neckF, ...[...P.neckB].reverse()];
  const closed = (pts: number[][]) => pts.reduce((t, _, k) => {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    return t + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }, 0);
  const ringM = closed(loop.map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
  const ringBodyM = closed(loop.map((v) => bd.nearestBodyPoint(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])));
  const ringAllowM = ringBodyM + 2 * Math.PI * (THICK + TOL_SELF);
  const ringExcess = ringM / ringAllowM;

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
  if (!(ringExcess <= S4_THRESHOLD.ringExcess))
    fails.push(`목선 초과비 ${ringExcess.toFixed(4)} > 1 (링 ${(ringM * 100).toFixed(2)}cm > 허용 ${(ringAllowM * 100).toFixed(2)}cm)`);
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
    lambdaMax, ringExcess, ringM, ringBodyM, ringAllowM, ringRestRatio,
    settleNetM, settled, pinned, diverged, fails,
  };
}
