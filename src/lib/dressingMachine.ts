// v2 (c) 착장 시퀀스 상태기계 — v2-design §4 명세 그대로.
//
//   S0 배치 → S1 접근(시접 rest 램프) → S2 봉합 유지 → S3 정착 → DONE
//      └───────────── 실패 시 RETRY(≤2회) ─────────────┘
//                              3회째 → ABORT(보고·정지)
//
// **위치**: 워커가 아니라 공유 세션(garmentFrame) 계층이다 — paramSweep
// 하네스가 같은 경로를 그대로 돌려야 한다(§4 계기 규칙, 함정 12·13). 이
// 모듈은 `GarmentSession.step`을 그대로 호출하는 얇은 스케줄러이고, 새
// 물리를 만들지 않는다(clothPhysics 무변경).
//
// 첫 실행 대상은 2a-thin 스파이크(§1.3): 조악한 패널로 **수렴/발산 이진**만
// 본다. 화면·지표 게이트 없음.
import type * as THREE from "three";
import type { ClothSimulation } from "./clothPhysics";
import type { FrameLayout, FramePose, GarmentSession } from "./garmentFrame";

export type DressingState = "S0" | "S1" | "S2" | "S3" | "DONE" | "ABORT";

export interface DressingSeam {
  a: number;
  b: number;
  target: number;
  kind: string;
}

export interface DressingConfig {
  // S1 램프 길이(프레임). RETRY 1회차에 2배로 늘어난다(§4 RETRY 전략).
  rampFrames: number;
  // S1 진행 정체 판정 창(§4 S1 (ii): "N프레임 동안 단조 감소하지 않음",
  // N 추정 60 — Stage 2b에서 확정).
  stallFrames: number;
  // S2 유지 판정: seamGap이 target+이 값을 재이탈하면 실패.
  seamSlackM: number;
  // S3 정착: Δ20 ≤ settleDeltaMm 가 연속 settleFrames 프레임.
  settleDeltaMm: number;
  settleFrames: number;
  // 상태별 프레임 예산 — 초과는 그 상태의 실패로 본다.
  budget: Record<"S0" | "S1" | "S2" | "S3", number>;
}

export interface DressingLogEntry {
  frame: number;
  elapsedMs: number;
  from: DressingState;
  to: DressingState;
  reason: string;
  retry: number;
}

export interface DressingResult {
  state: DressingState;
  converged: boolean;
  frames: number;
  retries: number;
  log: DressingLogEntry[];
  // 발산·중단 시점의 진단(§1.3: "어느 상태·몇 프레임에서인지 기록").
  failure: { state: DressingState; frame: number; reason: string } | null;
}

export interface DressingHooks {
  // S0 배치 재실행(offsetScale) + 관통 정점 수. §4 S0의 배치 내부 교정은
  // RETRY를 소비하지 않는다.
  place: (offsetScale: number) => void;
  countPenetrating: () => number;
  // 발산 감시 — NaN/Inf 또는 좌표 폭주.
  diverged: () => boolean;
  maxSeamGapM: () => number;
  maxDelta20Mm: () => number;
  onFrame?: (frame: number, state: DressingState) => void;
}

// smoothstep — §4 S1 "램프는 연속 함수로만"(함정 7: 불리언 전환이 M2-7
// 램프 붕괴의 원인이었다).
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function runDressing(
  sim: ClothSimulation,
  session: GarmentSession,
  seams: readonly DressingSeam[],
  cfg: DressingConfig,
  hooks: DressingHooks,
  // step 인자 — 프레임마다 그대로 전달(하네스·워커 공통).
  stepArgs: () => {
    dt: number;
    gravity: THREE.Vector3;
    preset: { iterations: number; damping: number };
    layout: FrameLayout;
    pose: FramePose;
  },
  maxFrames: number,
  t0: number,
  // 앵커 강도 스케줄을 호출자 env에 반영하는 훅(S1만 켜고 S2 진입 시 끔).
  setAnchorStrength: (s: number) => void,
): DressingResult {
  const log: DressingLogEntry[] = [];
  let state: DressingState = "S0";
  let retry = 0;
  let frame = 0;
  let stateFrame = 0;
  let failure: DressingResult["failure"] = null;
  // 램프 시작 rest = 시접 테이블 등록 시점의 rest(= S0 갭).
  let startRest = snapshotRest(sim, seams);
  let rampFrames = cfg.rampFrames;
  let iterationBoost = 0;
  let settleRun = 0;
  let bestGap = Infinity;
  let stallFrame = 0;

  // TS는 클로저 안의 대입을 CFA에 반영하지 않아 `state`가 "S0"로 좁혀진다.
  // 선언 타입으로 되읽는 접근자 하나로 우회한다(런타임 동작 무관).
  const cur = (): DressingState => state;

  const transition = (to: DressingState, reason: string): void => {
    log.push({ frame, elapsedMs: Math.round(performance.now() - t0), from: cur(), to, reason, retry });
    state = to;
    stateFrame = 0;
  };

  const fail = (reason: string): void => {
    const from = cur();
    if (retry >= 2) {
      failure = { state: from, frame, reason };
      transition("ABORT", `${reason} — RETRY 2회 소진`);
      return;
    }
    retry++;
    // §4 RETRY 전략: 1회차 = 배치 오프셋 +50% + 램프 길이 2배,
    // 2회차 = 추가로 반복 수 상향 1단계.
    hooks.place(1 + 0.5 * retry);
    rampFrames = cfg.rampFrames * (1 + retry);
    if (retry >= 2) iterationBoost = 1;
    startRest = snapshotRest(sim, seams);
    setRest(sim, seams, startRest, 0);
    settleRun = 0;
    bestGap = Infinity;
    stallFrame = 0;
    transition("S0", `${reason} → RETRY ${retry}`);
  };

  // S0: 배치 관통 검사 + 내부 교정(RETRY 소비 안 함).
  const doPlacement = (): void => {
    let scale = 1 + 0.5 * retry;
    let pen = hooks.countPenetrating();
    for (let attempt = 0; pen > 0 && attempt < 2; attempt++) {
      scale *= 1.5;
      hooks.place(scale);
      pen = hooks.countPenetrating();
    }
    startRest = snapshotRest(sim, seams);
    log.push({
      frame, elapsedMs: Math.round(performance.now() - t0), from: "S0", to: "S0",
      reason: `배치 관통 정점 ${pen} (오프셋 배수 ${scale.toFixed(2)})`, retry,
    });
    transition("S1", pen === 0 ? "배치 관통 0" : `관통 ${pen} 잔여 — 교정 소진, 그대로 진행`);
  };

  doPlacement();

  while (frame < maxFrames && cur() !== "DONE" && cur() !== "ABORT") {
    // ── S1: 시접 rest 램프(연속). 적용은 프레임 파라미터 갱신이고, 제약
    // 해소 자체는 sim.step의 매 반복이 한다.
    if (cur() === "S1") {
      setRest(sim, seams, startRest, smoothstep(stateFrame / rampFrames));
      setAnchorStrength(1 - smoothstep(stateFrame / rampFrames));
    } else {
      setRest(sim, seams, startRest, 1);
      setAnchorStrength(0);
    }

    const { dt, gravity, preset, layout, pose } = stepArgs();
    session.step(dt, gravity, { ...preset, iterations: preset.iterations + iterationBoost }, layout, pose);
    frame++;
    stateFrame++;
    hooks.onFrame?.(frame, state);

    // 하드: 발산은 어느 상태에서든 즉시 ABORT(§4 S1 (i)).
    if (hooks.diverged()) {
      failure = { state: cur(), frame, reason: "발산(NaN/Inf 또는 좌표 폭주)" };
      transition("ABORT", "발산 — 하드");
      break;
    }

    const gapM = hooks.maxSeamGapM();
    const delta20 = hooks.maxDelta20Mm();

    if (cur() === "S1") {
      // (ii) 진행 정체 — maxSeamGap이 stallFrames 동안 단조 감소하지 않음.
      if (gapM < bestGap - 1e-5) { bestGap = gapM; stallFrame = 0; } else { stallFrame++; }
      if (stallFrame > cfg.stallFrames) { fail(`S1 정체(seamGap ${(gapM * 1000).toFixed(1)}mm, ${cfg.stallFrames}프레임 무개선)`); continue; }
      if (stateFrame >= rampFrames && gapM <= maxTarget(seams) + cfg.seamSlackM) {
        transition("S2", `램프 완료 seamGap ${(gapM * 1000).toFixed(1)}mm`);
      } else if (stateFrame > cfg.budget.S1) {
        fail(`S1 예산 초과(seamGap ${(gapM * 1000).toFixed(1)}mm)`);
      }
      continue;
    }

    if (cur() === "S2") {
      // 봉합이 안 버티면(target+문턱 재이탈) 실패.
      if (gapM > maxTarget(seams) + cfg.seamSlackM) { fail(`S2 봉합 이탈(seamGap ${(gapM * 1000).toFixed(1)}mm)`); continue; }
      if (stateFrame >= cfg.budget.S2) transition("S3", `봉합 유지 ${cfg.budget.S2}프레임`);
      continue;
    }

    if (cur() === "S3") {
      settleRun = delta20 <= cfg.settleDeltaMm ? settleRun + 1 : 0;
      if (settleRun >= cfg.settleFrames) { transition("DONE", `정착 Δ20 ${delta20.toFixed(2)}mm × ${cfg.settleFrames}프레임`); break; }
      if (stateFrame > cfg.budget.S3) fail(`S3 예산 초과(Δ20 ${delta20.toFixed(2)}mm 지속 진동)`);
      continue;
    }

    if (cur() === "S0") doPlacement();
  }

  if (cur() !== "DONE" && cur() !== "ABORT") {
    failure = { state: cur(), frame, reason: `프레임 예산 ${maxFrames} 소진(미정착)` };
    transition("ABORT", "전체 프레임 예산 소진");
  }

  return { state: cur(), converged: cur() === "DONE", frames: frame, retries: retry, log, failure };
}

function maxTarget(seams: readonly DressingSeam[]): number {
  let m = 0;
  for (const s of seams) if (s.target > m) m = s.target;
  return m;
}

// 시접 쌍의 현재 rest를 **한 번의 순회**로 뽑는다(쌍마다 전체 스캔하면
// 시접 1k × 제약 50k = 프레임 밖이라도 부담).
function snapshotRest(sim: ClothSimulation, seams: readonly DressingSeam[]): number[] {
  const want = new Map<number, number>();
  for (const s of seams) want.set(key(s.a, s.b), s.target);
  for (const c of sim.constraintPairs) {
    const k = key(c.a, c.b);
    if (want.has(k)) want.set(k, c.restLength);
  }
  return seams.map((s) => want.get(key(s.a, s.b)) ?? s.target);
}

// rest = lerp(startRest, target, t). clothPhysics를 고치지 않기 위해
// 기존 `scaleConstraintRestLengths`(배율 API)에 목표/현재 비를 넘긴다 —
// 시접 쌍만 배율이 1이 아니므로 격자 제약은 손대지 않는다.
function setRest(sim: ClothSimulation, seams: readonly DressingSeam[], startRest: readonly number[], t: number): void {
  const want = new Map<number, number>();
  for (let i = 0; i < seams.length; i++) {
    want.set(key(seams[i].a, seams[i].b), startRest[i] + (seams[i].target - startRest[i]) * t);
  }
  const cur = new Map<number, number>();
  for (const c of sim.constraintPairs) {
    const k = key(c.a, c.b);
    if (want.has(k)) cur.set(k, c.restLength);
  }
  sim.scaleConstraintRestLengths((a, b) => {
    const k = key(a, b);
    const w = want.get(k);
    const c = cur.get(k);
    if (w === undefined || c === undefined || c <= 0) return 1;
    return w / c;
  });
}

function key(a: number, b: number): number {
  return Math.min(a, b) * 1_000_000 + Math.max(a, b);
}
