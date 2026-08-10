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
  COLLISION_EVERY,
  COLLISION_MARGIN,
  COLS,
  FRICTION_CONTACT_BAND,
  FRICTION_MU_ITER,
  FRICTION_MU_KINETIC,
  FRICTION_MU_STATIC,
  LOCAL_MU_GAIN,
  MAX_DISPLACEMENT_PER_SUBSTEP,
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
import { createCachedSdfIterationFriction, createSdfFrictionPass } from "./sdfCollision";
import type { SdfField } from "./sdfCollision";

export interface ArmShape {
  dir: Vec3Like;
  trueShoulder: Vec3Like;
  length: number;
  // P10 §1 — 팔꿈치·손 월드 좌표(몸 뼈대에서 뜬다, 새 상수 0). **선택**이다:
  // 주지 않으면 종전 직선 캡슐 그대로다(v1 워커·하네스·커밋 fixture 경로).
  elbow?: Vec3Like;
  hand?: Vec3Like;
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
  // P10 §1 — **소매가 팔꿈치를 넘어갈 때만**(긴팔) 캡슐을 꺾는다: 어깨→팔꿈치 /
  // 팔꿈치→손 두 세그먼트. 조건은 옷 실측(`length`) vs 몸 실측(위팔 길이)에서
  // 나온다 — 새 상수 0. 반팔은 소매가 위팔 안에서 끝나고 종전 식이 이미 위팔 축
  // (`findShortSleeveDirection`)을 따르므로 그대로 둔다 → **기준선 B 비트 동일**.
  // (1.25배 오버슛까지로 조건을 잡으면 반팔도 꺾여 기준선 B가 갈린다 — 실측:
  //  f 260→319 · 자기교차 2143→2070 · 밑단 합 114.04→112.84cm.)
  // 전완 캡슐은 **손에서 끊는다**. 종전 1.25배 오버슛을 호장으로 유지해 손 너머까지
  // 늘리는 변형을 실측했더니 **ABORT**였다(긴팔 S1 정체 f=1212 · seamGap 7.7mm ·
  // 60프레임 무개선). 오버슛은 직선 축 근사의 보정이었고, 축이 팔을 따르면 근거가 없다.
  if (shape.elbow && shape.hand) {
    const upperLen = Math.hypot(
      shape.elbow.x - shape.trueShoulder.x, shape.elbow.y - shape.trueShoulder.y, shape.elbow.z - shape.trueShoulder.z,
    );
    const foreLen = Math.hypot(
      shape.hand.x - shape.elbow.x, shape.hand.y - shape.elbow.y, shape.hand.z - shape.elbow.z,
    );
    if (upperLen > 1e-6 && foreLen > 1e-6 && shape.length > upperLen) {
      const t = Math.min(endLength - upperLen, foreLen) / foreLen;
      return [
        { top: shape.trueShoulder, bottom: shape.elbow, radius: ARM_COLLISION_RADIUS },
        {
          top: shape.elbow,
          bottom: {
            x: shape.elbow.x + (shape.hand.x - shape.elbow.x) * t,
            y: shape.elbow.y + (shape.hand.y - shape.elbow.y) * t,
            z: shape.elbow.z + (shape.hand.z - shape.elbow.z) * t,
          },
          radius: ARM_COLLISION_RADIUS,
        },
      ];
    }
  }
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

// ── P2b(a) — **v2 패턴 착장의 통합 리졸버**. `dressPattern.ts`에 있던 `unified` 클로저를
// 그대로 옮긴 것이고 **거동 무변경**이다(항등 리팩터 · 값 변경 0 · 물리 수정 0).
//
// 왜 여기로 옮기는가: v2 브라우저 워커가 «같은» 리졸버를 써야 한다. v1이 이미 같은 이유로
// `createUnifiedResolver`를 이 파일로 이사시켰다(M0 · `garmentWorker.ts:151` 「워커는
// 살아있는 상태 객체만 관리한다」). 복제하면 v1/v2에 이어 **세 번째 경로**가 생기고,
// 92 §4-1이 이중 경로 때문에 처방을 집행 금지로 막은 전례가 있다.
//
// **기본값은 여기 한 곳에만 둔다** — 스크립트와 브라우저가 갈릴 수 없게.
//   `torsoCap`  기본 **false** — 45회차 승격(몸통 캡슐 전면 제거가 새 기준선)
//   `armCap`    기본 **true**  — 94회차 절제 스위치의 기본 on
//   `singleDeepest` 기본 **true** — 42회차 처방 A(정점당 가장 깊이 파묻힌 캡슐 1개만)
//   `armMarginM` 기본 **0.006** — `dressPattern.ts`가 쓰던 리터럴 그대로
// `torsoPanels`는 호출부가 넘긴다(패널 인덱스 정본은 `patternGarment.ts`이고
// 이 파일이 그것을 import하면 순환이 된다).
export interface PatternUnifiedOpts {
  torsoCap?: boolean;
  armCap?: boolean;
  singleDeepest?: boolean;
  torsoMarginM?: number;
  armMarginM?: number;
  torsoPanels?: readonly number[];
}

// ── P2b(c) — **v2 패턴 착장 세션 env 조립**. `dressPattern.ts`에 있던 조립을
// 그대로 옮긴 것이고 거동 무변경(항등 리팩터 · 값 변경 0).
//
// 여기 담긴 것은 **어느 소비자든 같아야 하는 물리 배선**이다:
//   · v1 후처리 12종 전량 off(order/스무딩/softPull/hug/sleevePull/yAlign/symmetry)
//     — v2 패턴 패널에는 COLS·ROWS 격자 규약이 없어 의미 자체가 없다(:765 핀 주석과 같은 이유)
//   · `pinCorners: false` — v1 하드 핀은 패턴 패널에 인덱스가 안 맞는다
//   · `clampInSubstep: true` / `clampAfterPost: false` — 워커 위치
//   · 마찰 2종(서브스텝 말미 `friction` · 반복 내 `frictionIteration`)의 상수 배분
//     — 중복 감쇠를 피하려고 μ를 갈라 쓴다(STATIC/KINETIC vs MU_ITER+LOCAL_MU_GAIN)
// 브라우저 워커가 이 조립을 다시 손으로 적으면 한 줄만 어긋나도 물리가 갈린다.
//
// **가변 항 2개는 호출자가 env를 직접 고쳐 쓴다**(기존 그대로):
//   `collarStrainLimit`(링 상한 램프 · 매 프레임) · `pinStrength`(앵커 램프).
// 그래서 이 함수는 **그 env 객체 자체**를 돌려준다.
export interface PatternSessionEnvOpts {
  collisionResolver: CollisionResolver;
  selfCollision: CollisionResolver | null;
  sdfField: () => SdfField | null;
  anchors?: () => { i: number; x: number; y: number; z: number }[];
  /** 초기값. 이후 램프는 호출자가 env.collarStrainLimit를 갱신한다. */
  collarStrainLimit?: number;
  /** 초기값. 이후 램프는 호출자가 env.pinStrength를 갱신한다. */
  pinStrength?: number;
  /** 계기 — 위치를 건드리면 안 된다. */
  probe?: (label: string) => void;
  /** 계기 — 발화 카운트. */
  onCollarFired?: (count: number) => void;
}

export function makePatternSessionEnv(o: PatternSessionEnvOpts): GarmentFrameEnv {
  const cachedFriction = createCachedSdfIterationFriction(o.sdfField, {
    contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_ITER, muKinetic: FRICTION_MU_ITER, localMuGain: LOCAL_MU_GAIN,
  });
  const env: GarmentFrameEnv = {
    probe: o.probe,
    collisionResolver: o.collisionResolver,
    collisionEvery: COLLISION_EVERY,
    selfCollision: o.selfCollision,
    orderColumn: false, orderRow: false, clampInSubstep: true, smoothing: false, postOrder: false,
    armSoftPull: false, necklineHug: false, sleeveArmPull: false, yAlign: false, symmetry: false,
    clampAfterPost: false,
    maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
    friction: createSdfFrictionPass(o.sdfField, {
      contactBand: FRICTION_CONTACT_BAND, muStatic: FRICTION_MU_STATIC, muKinetic: FRICTION_MU_KINETIC,
    }),
    frictionIteration: (pos, prev, pinned, n) => { cachedFriction.apply(pos, prev, pinned, n); o.probe?.("1b.반복내 마찰"); },
    frictionIterationReset: cachedFriction.reset,
    collarStrainLimit: o.collarStrainLimit,
    onCollarFired: o.onCollarFired,
    pinCorners: false,
    anchors: o.anchors,
    pinContinuous: true,
    pinStrength: o.pinStrength,
    anchorSyncPrev: true,
  };
  return env;
}

export function createPatternUnifiedResolver(
  meshResolver: CollisionResolver,
  panelCounts: readonly number[],
  torsoCapsules: readonly Capsule[],
  armCapsules: readonly Capsule[],
  opts: PatternUnifiedOpts = {},
): CollisionResolver {
  const torsoCap = opts.torsoCap ?? false;
  const armCap = opts.armCap ?? true;
  const singleDeepest = opts.singleDeepest ?? true;
  const torsoMarginM = opts.torsoMarginM ?? COLLISION_MARGIN;
  const armMarginM = opts.armMarginM ?? 0.006;
  const torsoPanels = opts.torsoPanels ?? [0, 1];
  return (positions, pinned, n) => {
    meshResolver(positions, pinned, n);
    let offset = 0;
    for (let p = 0; p < panelCounts.length; p++) {
      const count = panelCounts[p];
      const pos = positions.subarray(offset * 3, (offset + count) * 3);
      const pin = pinned.subarray(offset, offset + count);
      if (torsoCap && torsoPanels.includes(p)) {
        applyCapsuleCollision(pos, pin, count, torsoCapsules, torsoMarginM, undefined, undefined, singleDeepest);
      }
      if (armCap) applyCapsuleCollision(pos, pin, count, armCapsules, armMarginM);
      offset += count;
    }
    void n;
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

// 스무딩 기본값의 단일 출처 — 워커(제품)와 paramSweep(하네스)이 이 식을
// 같이 본다. 신 코어는 스무딩 off(M2 제거 ②), 구 코어는 on. 계기 쪽에서
// 하드코딩하면 제품만 바뀌어도 침묵한다(함정 12).
export function defaultSmoothing(newCore: boolean): boolean {
  return !newCore;
}

export interface GarmentFrameEnv {
  // **읽기 전용 프로브**(31회차 계기). 서브스텝 안 각 위치 수정 패스의 경계에서
  // 호출된다. 위치를 건드리면 안 된다 — 계기 전용. 미설정이면 빈 호출도 없다.
  probe?: (label: string) => void;
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
  // M2-5: 반복 안 위치 수준 마찰(createSdfIterationFrictionPass) — 매
  // Gauss-Seidel 반복(everyIterationExtra 훅)에서 접선 이동을 죽인다.
  // 서브스텝 말미 속도 보정(friction)과 역할 분담(중복 감쇠 방지).
  frictionIteration?: (positions: Float32Array, prevPositions: Float32Array, pinned: Uint8Array, n: number) => void;
  // 비용 최적화용 — 서브스텝 시작마다 접촉/법선/하중 캐시 갱신 훅.
  frictionIterationReset?: (positions: Float32Array, pinned: Uint8Array, n: number) => void;
  // 핀 전환 3단계: 1=하드 핀(기존), 1미만=칼라 소프트 앵커, 0=앵커 없음.
  pinStrength?: number;
  // 연속 핀 모드(램프 전용) — pinCorners 주석 참고.
  pinContinuous?: boolean;
  // (i) 반복 내 앵커 prev 동기화 — 밀림→스냅 왕복의 속도 누적 차단.
  anchorSyncPrev?: boolean;
  // M2-6: row0 링 신장 상한(예: 1.02). 0/undefined면 미적용.
  collarStrainLimit?: number;
  // 발화 카운트 수집(배선 검증용) — 있으면 프레임마다 누적 호출.
  onCollarFired?: (count: number) => void;
  // v2(patternCore): v1 목선 핀 배치를 끈다. v1 `pinCorners`는 COLS·ROWS
  // 격자와 목선 코너 규약에 묶여 있어 패턴 패널에는 의미가 없다(인덱스도
  // 안 맞는다). **undefined = true = 기존 동작**이라 구 경로는 비트 동일.
  pinCorners?: boolean;
  // v2(patternCore): 앵커 목표를 호출자가 프레임마다 공급한다(§4 S1의
  // "임시 배치 앵커"). pinCorners:false와 짝으로만 쓴다 — 켠 상태로 두면
  // pinCorners가 만든 목표를 덮어써 v1 경로가 조용히 바뀐다.
  anchors?: () => { i: number; x: number; y: number; z: number }[];
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
      let anchorTargets: { i: number; x: number; y: number; z: number }[] = [];
      if (env.pinCorners ?? true) {
        pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, pose.necklineLift, env.pinStrength ?? 1, env.pinContinuous ?? false, anchorTargets);
      } else {
        anchorTargets = env.anchors?.() ?? [];
      }
      sim.setAnchors(anchorTargets);
      // 복리 보정 — 반복 n회 누적 유효 강성이 프레임당 1회 모드의
      // strength와 일치하도록 k'=1-(1-k)^(1/n)(A-①과 같은 식). 보정 없이
      // 넣으면 strength 0.1도 사실상 하드 핀이 되어 스윕이 또 2점 측정.
      const anchorK = env.pinContinuous
        ? 1 - Math.pow(1 - Math.min(1, Math.max(0, env.pinStrength ?? 1)), 1 / preset.iterations)
        : 0;

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
      // everyIterationExtra 훅 — order 패스 + (M2-5) 반복 안 마찰.
      const iterExtra: CollisionResolver | undefined =
        anyOrder || env.frictionIteration || anchorK > 0
          ? (positions, pinned, n) => {
              if (anyOrder) torsoOrderExtra(positions, pinned, n);
              env.frictionIteration?.(positions, sim.prevPositions, pinned, n);
              // 앵커는 반복의 **마지막**(충돌·마찰·순서 이후). 하드 핀이
              // pinned=1로 충돌에서 아예 제외됐던 것과 같은 위상을 준다 —
              // 흡착이 row0을 표면으로 끌어당기므로 앵커가 그 뒤에 와야
              // 목표가 살아남는다. 반대 순서면 흡착이 마지막 발언권을
              // 가져 등가성이 깨진다.
              if (anchorK > 0) sim.applyAnchors(anchorK, env.anchorSyncPrev ?? false);
            }
          : undefined;

      accumulator = Math.min(accumulator + dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        // 반복 안 마찰 캐시 — 적분 직전 위치 기준(적분 한 스텝 오차는
        // 변위 클램프 이하, 법선장 연속이라 허용 — 동등성 실측으로 검증).
        env.frictionIterationReset?.(sim.positions, sim.pinned, sim.positions.length / 3);
        env.probe?.("0.서브스텝 시작");
        sim.step(
          SUBSTEP_DT,
          gravity,
          env.collisionResolver,
          preset.iterations,
          env.collisionEvery,
          preset.damping,
          env.maxDisplacement,
          iterExtra,
        );
        env.probe?.("1.sim.step(적분+거리제약×n+충돌+iterExtra)");
        // M2: 마찰 — 충돌이 법선 방향을 푼 직후, 그 접촉의 접선 성분을
        // 감쇠/정지시킨다(자체충돌·순서 보정 이전).
        env.friction?.(sim.positions, sim.prevPositions, sim.pinned, sim.positions.length / 3);
        env.probe?.("2.friction(SDF 마찰)");
        if (env.selfCollision) {
          env.selfCollision(sim.positions, sim.pinned, sim.positions.length / 3);
          // 자체충돌이 흐트러뜨린 순서를 한 번 더 정리 — 이중 안전장치(워커 원본 주석).
        }
        env.probe?.("3.selfCollision");
        if (anyOrder) torsoOrderExtra(sim.positions, sim.pinned, sim.positions.length / 3);
        env.probe?.("4.order");
        if (env.clampInSubstep) sim.clampOverstretchedConstraints();
        env.probe?.("5.limitStrain(1.2)");
        if (env.collarStrainLimit) {
          const fired = sim.limitCollarStrain(env.collarStrainLimit);
          if (fired > 0) env.onCollarFired?.(fired);
        }
        env.probe?.("6.limitCollarStrain(1.02)");
        // M1(용접): alias 파티클을 canon 최신 위치로 동기화 — 후처리(sleeve
        // ArmPull의 row0 링 중심 등)가 alias를 읽기 전에 반영돼야 한다.
        // 용접 없는 구 코어에선 빈 루프(비트 동일).
        sim.syncWeldedPositions();
        env.probe?.("7.syncWelded(서브스텝 끝)");
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
