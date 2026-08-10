// P2b(d) — **v2 패턴 착장의 «물리» 훅**. `dressPattern.ts`의 `runDressing` 훅
// 뭉치에서 실행 흐름을 바꾸는 것만 갈라 옮겼다. 거동 무변경(항등 리팩터 ·
// 값 변경 0 · 물리 로직 수정 0).
//
// 분류 기준(P2b §2): **실행 흐름을 바꾸면 물리, 인쇄만 하면 계기.**
// 여기 있는 것은 전부 `sim.positions`/`sim.pinned`를 고치거나 물리 파라미터를
// 프레임마다 갱신한다 — 브라우저 워커가 손으로 다시 적으면서 하나라도 빠뜨리면
// 옷이 다르게 앉는다. 인쇄는 전부 콜백으로 빼서 하네스가 계속 소유한다.
//
// 이 파일에 **없는** 물리 훅(다음 판): `place`(재배치 — 하네스 계기 3종과 얽혀 있다) ·
// 정착 판정 트래커(`maxDelta20Mm` — deltaArg/prevFrame/bandOf 계기와 같은 루프).
import type { ClothSimulation } from "./clothPhysics";

/** 착장 앵커 — 어깨 이음선의 목표 좌표(호장 비율 매핑 결과). */
export interface DressAnchor { i: number; x: number; y: number; z: number }

export interface AnchorPinRamp {
  /** `runDressing`의 `setAnchorHard` 훅 그대로. */
  setAnchorHard: (hard: boolean) => void;
  /** 계기용 — 현재 위치 램프 s(0~1)와 경과 프레임. */
  rampS: () => number;
  rampFrame: () => number;
}

// 앵커 하드 핀 on/off + **위치 램프**. 순간이동이 아니라 smoothstep으로 옮긴다
// (함정 7 — 불리언 전환이 M2-7 램프 붕괴의 원인이었다).
// 출발점은 토글 시점의 **현재 좌표**(배치 결과)이고, 좌표를 여기서 튀게 하지 않는다.
export function createAnchorPinRamp(
  sim: ClothSimulation,
  anchors: readonly DressAnchor[],
  rampFrames: number,
  hooks: {
    /** 계기 — 하드 핀 결합/해제 순간 1회. */
    onToggle?: (hard: boolean) => void;
    /** 물리 게이트 — 램프 첫 프레임(핀이 좌표를 쓴 직후). */
    onFirstRamp?: () => void;
  } = {},
): AnchorPinRamp {
  let hardNow = false;
  let frame = 0;
  let s = 0;
  const from = new Float32Array(anchors.length * 3);
  const setAnchorHard = (hard: boolean): void => {
    if (hard !== hardNow) {
      hardNow = hard;
      frame = 0;
      for (let k = 0; k < anchors.length; k++) {
        const a = anchors[k];
        if (hard) {
          from[k * 3] = sim.positions[a.i * 3];
          from[k * 3 + 1] = sim.positions[a.i * 3 + 1];
          from[k * 3 + 2] = sim.positions[a.i * 3 + 2];
          sim.pinned[a.i] = 1;
        } else {
          sim.pinned[a.i] = 0;
        }
      }
      hooks.onToggle?.(hard);
    }
    if (!hard) { s = 0; return; }
    const t = Math.min(1, frame / rampFrames);
    s = t * t * (3 - 2 * t);
    for (let k = 0; k < anchors.length; k++) {
      const a = anchors[k];
      sim.setParticle(
        a.i,
        from[k * 3] + (a.x - from[k * 3]) * s,
        from[k * 3 + 1] + (a.y - from[k * 3 + 1]) * s,
        from[k * 3 + 2] + (a.z - from[k * 3 + 2]) * s,
      );
    }
    if (frame === 0) hooks.onFirstRamp?.();
    frame++;
  };
  return { setAnchorHard, rampS: () => s, rampFrame: () => frame };
}

// ── 링 총 길이 사후 투영(21회차 설계). step 직후 무게중심 기준 등방 축소 1회.
// 핀 걸린 정점은 못 움직이므로 제외하고, 그만큼 배율을 나머지에 싣는다.
// `maxM <= 0`(RINGTOTAL=0)이면 아무것도 하지 않는다. 반환 = 발화했는가.
export function projectRingTotalLength(
  sim: ClothSimulation,
  ringVertices: readonly number[],
  currentLenM: number,
  maxM: number,
): boolean {
  if (!(maxM > 0) || !(currentLenM > maxM)) return false;
  const idx = ringVertices.filter((i) => !sim.pinned[i]);
  if (idx.length === 0) return false;
  let cx = 0, cy = 0, cz = 0;
  for (const i of idx) { cx += sim.positions[i * 3]; cy += sim.positions[i * 3 + 1]; cz += sim.positions[i * 3 + 2]; }
  cx /= idx.length; cy /= idx.length; cz /= idx.length;
  const k = maxM / currentLenM;
  for (const i of idx) {
    sim.positions[i * 3] = cx + (sim.positions[i * 3] - cx) * k;
    sim.positions[i * 3 + 1] = cy + (sim.positions[i * 3 + 1] - cy) * k;
    sim.positions[i * 3 + 2] = cz + (sim.positions[i * 3 + 2] - cz) * k;
  }
  return true;
}

export interface RingLimitRamp {
  /** `beforeStep`에서 매 프레임. 반환 = 그 프레임에 쓸 링 전용 상한. */
  update: (frame: number, state: string, ringLenM: number) => number;
  closedAtFrame: () => number;
  maxBeforeCloseM: () => number;
  fullyEngagedAt: () => number;
}

// ── 링 원주 제약의 **시점 분리**(21·22회차). 봉합 완료 전에는 링 전용 상한을
// 풀어 원단 일반 상한(`clothPhysics.limitStrain`)에 위임하고, **상태기계의 S2
// 진입**부터 그 시점 실측 신장 → `limit`까지 smoothstep으로 조인다.
// 조이기 시작 신호로 자체 판정식을 쓰지 않는다 — S1→S2의 AND 조건이 진실의
// 단일 출처다(21회차: 자체 판정식으로 조였다가 갭이 되열려 ABORT).
export function createRingLimitRamp(
  limit: number,
  ringRestM: number,
  rampFrames: number,
  onClose?: (frame: number, limitStart: number, maxBeforeCloseM: number) => void,
): RingLimitRamp {
  let closedAt = -1;
  let maxBeforeClose = 0;
  let limitStart = limit;
  let fullyEngagedAt = -1;
  return {
    update: (frame, state, ringLenM) => {
      if (closedAt < 0) {
        maxBeforeClose = Math.max(maxBeforeClose, ringLenM);
        if (state === "S2" || state === "S3" || state === "DONE") {
          closedAt = frame;
          limitStart = Math.max(limit, ringLenM / Math.max(1e-6, ringRestM));
          onClose?.(frame, limitStart, maxBeforeClose);
        }
      }
      let now: number;
      if (state === "S3" || state === "DONE") {
        now = limit;
      } else if (closedAt < 0) {
        now = Number.POSITIVE_INFINITY;
      } else {
        const t = Math.min(1, Math.max(0, (frame - closedAt) / rampFrames));
        const sm = t * t * (3 - 2 * t); // dressingMachine의 램프와 같은 식
        now = limitStart + (limit - limitStart) * sm;
      }
      if (fullyEngagedAt < 0 && Math.abs(now - limit) < 1e-9) fullyEngagedAt = frame;
      return now;
    },
    closedAtFrame: () => closedAt,
    maxBeforeCloseM: () => maxBeforeClose,
    fullyEngagedAt: () => fullyEngagedAt,
  };
}
