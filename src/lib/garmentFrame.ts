// B안 M0(파이프라인 일원화): 워커(src/workers/garmentWorker.ts)의 "step"
// 케이스에 살던 프레임 시퀀스를 여기로 추출해, 워커와 Node 하네스
// (scripts/paramSweep.ts)가 **같은 함수를 import**한다. 지금까지 하네스가
// 워커와 다른 물리를 돌려 "하네스 통과 → 브라우저 실패"가 실측 3회
// (0.72 vs 2.9cm 시접 갭, A-③/C 화면 실패 미검출) 반복된 것의 근본 대응.
//
// 환경 차이는 전부 GarmentFrameEnv로 **명시적 주입**한다 — 충돌 리졸버
// (브라우저=BVH+캡슐 / Node=캡슐만 또는 fixture BVH)와 스테이지 토글.
// 토글이 많은 건 의도된 것: 기존 두 호출자의 시퀀스 차이를 숨기지 않고
// 문서화된 플래그로 드러내는 게 M0의 목적이고, 리팩터링 검증(비트 동일)을
// 위해 두 경로 모두 기존과 정확히 같은 순서를 재현할 수 있어야 한다.
// M2에서 fixture 모드가 "전부 켠" 환경으로 수렴하면 토글은 줄어든다.
import * as THREE from "three";
import { ClothSimulation } from "./clothPhysics";
import type { CollisionResolver } from "./clothPhysics";
import { applyCapsuleCollision, applyFrontBackPairSeparation, applyFrontBackSidedness } from "./torsoCapsule";
import type { Capsule } from "./torsoCapsule";
import {
  applyArmSoftPull,
  applyNecklineHug,
  applySleeveArmPull,
  enforceArmFrontBackYAlignment,
  pinCorners,
  torsoColumnRange,
} from "./buildGarmentSim";
import type { ArmDir } from "./buildGarmentSim";
import { enforceLeftRightSymmetry } from "./garmentStitch";
import {
  ARM_COLLISION_RADIUS,
  ARMHOLE_ROW_FRACTION,
  COLLISION_MARGIN,
  COLS,
  MAX_SUBSTEPS,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  PARTICLES_PER_PANEL,
  ROWS,
  SLEEVE_RING_COLS,
  SLEEVE_RING_ROWS,
  SUBSTEP_DT,
} from "./clothConfig";
import type { Vec3Like } from "./clothProtocol";

export interface ArmShape {
  dir: Vec3Like;
  trueShoulder: Vec3Like;
  length: number;
}

export interface FrameLayout {
  widthM: number;
  heightM: number;
  topY: number;
  centerZ: number;
  sleeveWidthM: number;
}

export interface FramePose {
  pinLeft: Vec3Like;
  pinRight: Vec3Like;
  armLeft: ArmDir;
  armRight: ArmDir;
  necklineLift?: readonly number[];
}

// 워커에서 이사(33번 주석 그대로): 팔 캡슐은 몸판용으로 바깥으로 민
// shoulder가 아니라 실제 어깨 관절(trueShoulder)을 축으로 써야 한다.
export function buildArmCapsules(shape: ArmShape): Capsule[] {
  const midLength = shape.length * 0.55;
  const endLength = shape.length * 1.25;
  const mid = {
    x: shape.trueShoulder.x + shape.dir.x * midLength,
    y: shape.trueShoulder.y + shape.dir.y * midLength,
    z: shape.trueShoulder.z + shape.dir.z * midLength,
  };
  const end = {
    x: shape.trueShoulder.x + shape.dir.x * endLength,
    y: shape.trueShoulder.y + shape.dir.y * endLength,
    z: shape.trueShoulder.z + shape.dir.z * endLength,
  };
  return [
    { top: shape.trueShoulder, bottom: mid, radius: ARM_COLLISION_RADIUS },
    { top: mid, bottom: end, radius: ARM_COLLISION_RADIUS },
  ];
}

// 워커의 unifiedResolver에서 이사(37번/범위 B 주석 이력은 워커 원본 참고).
// 살아있는 상태(state)를 참조로 받아, 호출자가 메시지/프레임마다 필드만
// 바꿔치기하면 리졸버가 항상 최신 값을 본다 — 워커의 기존 모듈 변수
// 패턴을 상태 객체로 명시화한 것.
export interface CollisionState {
  torsoCapsules: readonly Capsule[];
  armCapsules: readonly Capsule[];
  centerZ: number;
  // M2 보정 제거 ①: applyFrontBackSidedness(앞/뒤판을 centerZ 반평면에
  // 가두는 클램프) on/off. SDF 마찰이 접촉을 실제로 붙잡게 된 뒤로는
  // 이 클램프가 옆구리에서 천이 몸을 감아 도는 폴드를 원천 금지하는
  // 부작용만 남는다는 게 제거 근거 — 게이트는 3지표 + 앞뒤 관통.
  sidedness: boolean;
  // M2-4 선행: 반평면 클램프 대신 "실제로 자리를 바꾼 쌍만" 되돌리는
  // 경량 분리(applyFrontBackPairSeparation). sidedness와 배타적으로 쓴다.
  pairSeparation: boolean;
}

const armholeStartRowConst = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
const SHOULDER_CAP_SKIP_START = COLS * 1;
const SHOULDER_CAP_SKIP_END = COLS * (armholeStartRowConst + 1);

// 워커에서 이사(범위 B 주석 이력은 git 이력 참고): 패널별 리졸버(없으면
// null=스킵)와 패널별 개수를 받아 각 패널을 정확히 그 폭만큼 잘라 넘긴다.
export function createPanelSplitResolver(resolvers: readonly (CollisionResolver | null)[], panelCounts: readonly number[]): CollisionResolver {
  return (positions, pinned) => {
    let offset = 0;
    for (let p = 0; p < panelCounts.length; p++) {
      const count = panelCounts[p];
      const resolver = resolvers[p];
      if (resolver) {
        resolver(positions.subarray(offset * 3, (offset + count) * 3), pinned.subarray(offset, offset + count), count);
      }
      offset += count;
    }
  };
}

export const PANEL_COUNTS: readonly number[] = [
  PARTICLES_PER_PANEL,
  PARTICLES_PER_PANEL,
  SLEEVE_RING_COLS * SLEEVE_RING_ROWS,
  SLEEVE_RING_COLS * SLEEVE_RING_ROWS,
];

export function createUnifiedResolver(meshResolver: CollisionResolver, state: CollisionState): CollisionResolver {
  return (positions, pinned, n) => {
    meshResolver(positions, pinned, n);
    const frontCount = PARTICLES_PER_PANEL;
    const backCount = PARTICLES_PER_PANEL;
    const backEnd = (frontCount + backCount) * 3;
    applyCapsuleCollision(
      positions.subarray(0, frontCount * 3),
      pinned.subarray(0, frontCount),
      frontCount,
      state.torsoCapsules,
      COLLISION_MARGIN,
      SHOULDER_CAP_SKIP_START,
      SHOULDER_CAP_SKIP_END,
    );
    applyCapsuleCollision(
      positions.subarray(frontCount * 3, backEnd),
      pinned.subarray(frontCount, frontCount + backCount),
      backCount,
      state.torsoCapsules,
      COLLISION_MARGIN,
      SHOULDER_CAP_SKIP_START,
      SHOULDER_CAP_SKIP_END,
    );
    if (state.sidedness) applyFrontBackSidedness(positions, pinned, PARTICLES_PER_PANEL, state.centerZ);
    if (state.pairSeparation) applyFrontBackPairSeparation(positions, pinned, PARTICLES_PER_PANEL);
    applyCapsuleCollision(positions.subarray(0, frontCount * 3), pinned.subarray(0, frontCount), frontCount, state.armCapsules, 0.006);
    applyCapsuleCollision(positions.subarray(frontCount * 3, backEnd), pinned.subarray(frontCount, frontCount + backCount), backCount, state.armCapsules, 0.006);
    const sleeveCount = SLEEVE_RING_COLS * SLEEVE_RING_ROWS;
    const sleeveLeftEnd = backEnd + sleeveCount * 3;
    const sleeveRightEnd = sleeveLeftEnd + sleeveCount * 3;
    applyCapsuleCollision(
      positions.subarray(backEnd, sleeveLeftEnd),
      pinned.subarray(frontCount + backCount, frontCount + backCount + sleeveCount),
      sleeveCount,
      state.armCapsules,
      0.006,
    );
    applyCapsuleCollision(
      positions.subarray(sleeveLeftEnd, sleeveRightEnd),
      pinned.subarray(frontCount + backCount + sleeveCount, frontCount + backCount + sleeveCount * 2),
      sleeveCount,
      state.armCapsules,
      0.006,
    );
  };
}

export interface GarmentFrameEnv {
  // step() 내부에서 collisionEvery 주기로 도는 충돌 리졸버.
  collisionResolver: CollisionResolver;
  collisionEvery: number;
  // 서브스텝마다 step() 직후 실행되는 자체충돌(없으면 스킵).
  selfCollision: CollisionResolver | null;
  // torsoOrderExtra — 매 Gauss-Seidel 반복(step의 everyIterationExtra) +
  // 서브스텝 직후 1회. ④에서 하나씩 떼기 위해 열/행을 분리한다.
  // postOrder(후처리 열 순서 2회)는 같은 연산자라 orderColumn에 종속시킨다 —
  // 그걸 남기면 "제거"가 아니다.
  orderColumn: boolean;
  orderRow: boolean;
  // 서브스텝 안(자체충돌·order 직후) clamp. 워커의 위치.
  clampInSubstep: boolean;
  // 프레임 후처리: 스무딩 → order → (softPull/hug/sleevePull) → yAlign →
  // symmetry → order. 각 토글은 기존 두 호출자의 실제 차이 그대로.
  smoothing: boolean;
  // 라플라시안 blend(기본 0.5) — 완전 제거(smoothing:false)와 유지 사이의
  // 중간값을 재기 위한 손잡이. B-1 이력: 구 코어에서 0.5→0.15가 화면 실패.
  smoothingBlend?: number;
  postOrder: boolean;
  armSoftPull: boolean;
  necklineHug: boolean;
  sleeveArmPull: boolean;
  yAlign: boolean;
  symmetry: boolean;
  // 기존 하네스 위치(후처리 끝) clamp. 워커 off.
  clampAfterPost: boolean;
  maxDisplacement: number;
  // 살아있는 몸통 열 범위 — 주면 매 프레임 torsoColumnRange로 갱신해준다
  // (워커는 이 객체를 meshResolver와 공유). 스무딩 경계로도 쓰인다.
  columnRange?: { min: number; max: number };
  // M2: 접선 마찰 패스(sdfCollision.ts) — 서브스텝의 충돌 해소 직후,
  // 자체충돌 전에 1회. prevPositions를 고쳐야 해서 CollisionResolver와
  // 시그니처가 다르다. 없으면 스킵(기존과 비트 동일).
  friction?: (positions: Float32Array, prevPositions: Float32Array, pinned: Uint8Array, n: number) => void;
}

export interface GarmentSession {
  step(
    dt: number,
    gravity: THREE.Vector3,
    preset: { iterations: number; damping: number },
    layout: FrameLayout,
    pose: FramePose,
  ): void;
}

export function createGarmentSession(sim: ClothSimulation, env: GarmentFrameEnv): GarmentSession {
  let accumulator = 0;
  const armholeStartRow = armholeStartRowConst;

  return {
    step(dt, gravity, preset, layout, pose) {
      const { pinLeft, pinRight, armLeft, armRight } = pose;
      pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, pose.necklineLift);

      if (env.columnRange) {
        const range = torsoColumnRange(COLS, pinLeft, pinRight, armLeft, armRight);
        env.columnRange.min = range.xMin;
        env.columnRange.max = range.xMax;
      }

      const rawDirX = pinRight.x - pinLeft.x;
      const rawDirY = pinRight.y - pinLeft.y;
      const rawDirZ = pinRight.z - pinLeft.z;
      const dirLen = Math.hypot(rawDirX, rawDirY, rawDirZ) || 1;
      const dirX = rawDirX / dirLen;
      const dirY = rawDirY / dirLen;
      const dirZ = rawDirZ / dirLen;

      const torsoOrderExtra: CollisionResolver = () => {
        if (env.orderColumn) {
          sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
          sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        }
        if (env.orderRow) {
          sim.preserveRowOrder(undefined, false, PANEL_FRONT, PANEL_BACK + 1);
          sim.preserveRowOrder(undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        }
      };
      const anyOrder = env.orderColumn || env.orderRow;

      accumulator = Math.min(accumulator + dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        sim.step(
          SUBSTEP_DT,
          gravity,
          env.collisionResolver,
          preset.iterations,
          env.collisionEvery,
          preset.damping,
          env.maxDisplacement,
          anyOrder ? torsoOrderExtra : undefined,
        );
        // M2: 마찰 — 충돌이 법선 방향을 푼 직후, 그 접촉의 접선 성분을
        // 감쇠/정지시킨다(자체충돌·순서 보정 이전).
        env.friction?.(sim.positions, sim.prevPositions, sim.pinned, sim.positions.length / 3);
        if (env.selfCollision) {
          env.selfCollision(sim.positions, sim.pinned, sim.positions.length / 3);
          // 자체충돌이 흐트러뜨린 순서를 한 번 더 정리 — 이중 안전장치(워커 원본 주석).
        }
        if (anyOrder) torsoOrderExtra(sim.positions, sim.pinned, sim.positions.length / 3);
        if (env.clampInSubstep) sim.clampOverstretchedConstraints();
        // M1(용접): alias 파티클을 canon 최신 위치로 동기화 — 후처리(sleeve
        // ArmPull의 row0 링 중심 등)가 alias를 읽기 전에 반영돼야 한다.
        // 용접 없는 구 코어에선 빈 루프(비트 동일).
        sim.syncWeldedPositions();
        accumulator -= SUBSTEP_DT;
      }

      // 29번(스무딩-보정 순서): 스무딩 먼저, 정밀 보정이 "마지막 발언권".
      if (env.smoothing && env.columnRange) {
        const blend = env.smoothingBlend ?? 0.5;
        sim.smoothColumns(armholeStartRow + 1, blend, PANEL_FRONT, PANEL_BACK + 1, env.columnRange.min, env.columnRange.max);
        sim.smoothRows(armholeStartRow + 1, blend, PANEL_FRONT, PANEL_BACK + 1, env.columnRange.min, env.columnRange.max);
      }
      if (env.postOrder && env.orderColumn) {
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
      }

      if (env.armSoftPull) {
        applyArmSoftPull(sim, PANEL_FRONT, PANEL_BACK, layout.widthM, layout.heightM, layout.topY, layout.centerZ, pinLeft, pinRight, armLeft, armRight, layout.sleeveWidthM);
      }
      if (env.necklineHug) {
        applyNecklineHug(sim, PANEL_FRONT, PANEL_BACK, layout.widthM, layout.centerZ, pinLeft, pinRight, armLeft, armRight);
      }
      if (env.sleeveArmPull) {
        applySleeveArmPull(sim, PANEL_SLEEVE_LEFT, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, armLeft, armRight, layout.sleeveWidthM);
      }
      if (env.yAlign) {
        enforceArmFrontBackYAlignment(sim, PANEL_FRONT, PANEL_BACK, pinLeft, pinRight, armLeft, armRight);
      }
      if (env.symmetry) {
        enforceLeftRightSymmetry(sim, PANEL_FRONT, PANEL_BACK, COLS, ROWS);
      }
      if (env.postOrder && env.orderColumn) {
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
      }
      if (env.clampAfterPost) {
        sim.clampOverstretchedConstraints();
      }
      // 후처리(스무딩/order/소프트풀 등)가 canon을 움직였을 수 있어 프레임
      // 확정 직전 한 번 더 동기화 — 렌더/지표는 항상 용접 일치 상태를 본다.
      sim.syncWeldedPositions();
    },
  };
}
