import * as THREE from "three";
import { ClothSimulation } from "../lib/clothPhysics";
import type { CollisionResolver } from "../lib/clothPhysics";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { SelfCollision } from "../lib/selfCollision";
import { applyCapsuleCollision, applyFrontBackSidedness } from "../lib/torsoCapsule";
import type { Capsule } from "../lib/torsoCapsule";
import { FABRIC_PRESETS } from "../lib/fabricPresets";
import { pinCorners } from "../lib/buildGarmentSim";
import { buildUnifiedGarmentSim, rebuildWithNewSleeve } from "../lib/buildUnifiedGarmentSim";
import { pinSleeveSeamRing } from "../lib/buildSleeveSim";
import type { SleeveShape } from "../lib/buildSleeveSim";
import { pullShoulderCapToSurface } from "../lib/garmentStitch";
import {
  ARMHOLE_ROW_FRACTION,
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLISION_MARGIN,
  COLS,
  GRAVITY_BASE,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  MAX_SUBSTEPS,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  PARTICLES_PER_PANEL,
  ROWS,
  SELF_COLLISION_MIN_DIST,
  SUBSTEP_DT,
} from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, SleeveShapeMsg } from "../lib/garmentProtocol";

// 30번(진짜 물리적 병합): 몸판(앞/뒤)과 소매(좌/우)를 이제 하나의
// ClothSimulation 인스턴스(4개 패널)로 함께 짓고 하나의 step()으로 함께
// 완화한다 — 예전(18~29번)에는 두 개의 독립된 ClothSimulation을 각자
// step() 시킨 뒤 매 프레임 근사적으로("가까운 점끼리 당기기") 갖다
// 붙였는데, 사용자가 "어깨가 두 개의 원통으로 분리돼 있고 하나의 옷처럼
// 안 보인다"고 반복해서 지적한 근본 원인이 바로 이 구조였다 — 자세한
// 이유는 garmentStitch.ts의 addArmholeSeamConstraints 주석 참고.
interface WorkerScope {
  postMessage(message: GarmentWorkerToMainMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToGarmentWorkerMessage>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let sim: ClothSimulation | null = null;
let accumulator = 0;
// "reinitSleeve"(반팔↔긴팔 전환)는 몸판 치수 메시지를 다시 안 받으므로,
// 몸판을 처음부터 다시 배치할 때 쓸 마지막 치수를 기억해둔다 —
// buildUnifiedGarmentSim.ts의 rebuildWithNewSleeve 주석 참고.
let lastTorsoLayout: { widthM: number; heightM: number; topY: number; centerZ: number } | null = null;

// --- 몸판 충돌 ---
const frontCollisionMesh = new ArrayBvhCollision();
const backCollisionMesh = new ArrayBvhCollision();
// 팔 제외 없는 몸 전체 충돌 메시 — 어깨 캡을 실제 마네킹 표면에 직접
// 스냅시키는 용도(garmentStitch.ts의 pullShoulderCapToSurface, 자세한
// 경위는 meshCollision.ts의 wholeBodyIndex 주석 참고). frontCollisionMesh/
// backCollisionMesh와 달리 팔 영역을 일부러 빼지 않은 원본이라야 어깨
// 곡면이 남아있다.
const wholeBodyCollisionMesh = new ArrayBvhCollision();
const frontMeshResolver = frontCollisionMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS);
const backMeshResolver = backCollisionMesh.createResolver(COLLISION_MARGIN, COLLISION_DETECTION_RADIUS);

function createPanelSplitResolver(
  frontResolver: CollisionResolver,
  backResolver: CollisionResolver,
  particlesPerPanel: number,
): CollisionResolver {
  return (positions, pinned, n) => {
    frontResolver(positions.subarray(0, particlesPerPanel * 3), pinned.subarray(0, particlesPerPanel), particlesPerPanel);
    const backCount = n - particlesPerPanel;
    backResolver(positions.subarray(particlesPerPanel * 3, n * 3), pinned.subarray(particlesPerPanel, n), backCount);
  };
}

const meshResolver = createPanelSplitResolver(frontMeshResolver, backMeshResolver, PARTICLES_PER_PANEL);

let torsoCapsules: Capsule[] = [];
let centerZ = 0;
let dirX = 1;
let dirY = 0;
let dirZ = 0;

const torsoResolver: CollisionResolver = (positions, pinned, n) => {
  meshResolver(positions, pinned, n);
  applyCapsuleCollision(positions, pinned, n, torsoCapsules, COLLISION_MARGIN);
  applyFrontBackSidedness(positions, pinned, PARTICLES_PER_PANEL, centerZ);
};

// --- 소매 충돌 ---
function buildArmCapsules(shape: SleeveShapeMsg): Capsule[] {
  const midLength = shape.length * 0.55;
  const endLength = shape.length * 1.25;
  const mid = {
    x: shape.shoulder.x + shape.dir.x * midLength,
    y: shape.shoulder.y + shape.dir.y * midLength,
    z: shape.shoulder.z + shape.dir.z * midLength,
  };
  const end = {
    x: shape.shoulder.x + shape.dir.x * endLength,
    y: shape.shoulder.y + shape.dir.y * endLength,
    z: shape.shoulder.z + shape.dir.z * endLength,
  };
  return [
    { top: shape.shoulder, bottom: mid, radius: shape.radiusMax * 0.78 },
    { top: mid, bottom: end, radius: shape.radiusHem * 0.78 },
  ];
}

function toShape(msg: SleeveShapeMsg): SleeveShape {
  return {
    shoulder: msg.shoulder,
    dir: msg.dir,
    length: msg.length,
    radiusSeam: msg.radiusSeam,
    radiusMax: msg.radiusMax,
    radiusHem: msg.radiusHem,
  };
}

let sleeveCapsules: Capsule[] = [];
const sleeveResolver: CollisionResolver = (positions, pinned, n) => {
  applyCapsuleCollision(positions, pinned, n, sleeveCapsules, 0.006);
};

// 몸판(앞+뒤, 메시+캡슐+앞뒤판 분리)과 소매(캡슐)는 여전히 서로 다른 충돌
// 방식을 쓴다 — 소매는 훨씬 가벼운 캡슐 근사만으로도 충분하고, 몸판과
// 똑같이 무거운 BVH 메시 충돌을 소매까지 매 프레임 돌리면 파티클이 늘어난
// 만큼 비용만 늘고 시각적 이득은 적다(소매는 원통형이라 캡슐과 실제 팔
// 굵기 차이가 몸판-마네킹 굴곡 차이보다 훨씬 작다). torsoParticleCount로
// 병합된 positions/pinned 배열을 두 구간으로 나눠 각자의 리졸버에 넘긴다.
function buildMergedResolver(torsoParticleCount: number): CollisionResolver {
  return (positions, pinned, n) => {
    torsoResolver(positions.subarray(0, torsoParticleCount * 3), pinned.subarray(0, torsoParticleCount), torsoParticleCount);
    const sleeveCount = n - torsoParticleCount;
    sleeveResolver(
      positions.subarray(torsoParticleCount * 3, n * 3),
      pinned.subarray(torsoParticleCount, n),
      sleeveCount,
    );
  };
}

const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
// 자체충돌은 몸판(앞+뒤)에만 적용한다 — 예전부터 소매는 원통형이라 자기
// 자신과 겹칠 일이 거의 없고, 검사 대상을 늘리면 비용만 커진다.
const selfCollision = new SelfCollision(PARTICLES_PER_PANEL, COLS, armholeStartRow);
const selfCollisionResolver = selfCollision.createResolver(SELF_COLLISION_MIN_DIST);

const gravityBase = new THREE.Vector3(...GRAVITY_BASE);
const scratchGravity = new THREE.Vector3();
// 몸판 충돌 메시가 아직 준비 안 됐을 때 중력을 끄는 용도(아래 "step" 참고).
const ZERO_VEC3 = new THREE.Vector3(0, 0, 0);

ctx.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      lastTorsoLayout = { widthM: msg.widthM, heightM: msg.heightM, topY: msg.topY, centerZ: msg.centerZ };
      sim = buildUnifiedGarmentSim(
        msg.widthM,
        msg.heightM,
        msg.topY,
        msg.centerZ,
        msg.pinLeft,
        msg.pinRight,
        msg.sleeveRows,
        toShape(msg.sleeveLeft),
        toShape(msg.sleeveRight),
      );
      accumulator = 0;
      break;
    }
    case "reinitSleeve": {
      // 소매 종류(반팔/긴팔)만 바뀐 경우 — 몸판은 처음부터 다시 짓되 바로
      // 그 직후 기존에 돌고 있던 몸판의 실제 위치로 덮어써서, 몸판이 이미
      // 자연스럽게 늘어져 있던 상태를 그대로 이어간다. 자세한 이유는
      // buildUnifiedGarmentSim.ts의 rebuildWithNewSleeve 주석 참고.
      if (!sim || !lastTorsoLayout) break;
      sim = rebuildWithNewSleeve(
        sim,
        lastTorsoLayout.widthM,
        lastTorsoLayout.heightM,
        lastTorsoLayout.topY,
        lastTorsoLayout.centerZ,
        msg.sleeveRows,
        toShape(msg.sleeveLeft),
        toShape(msg.sleeveRight),
      );
      break;
    }
    case "rebuildCollision": {
      frontCollisionMesh.rebuild(msg.position, msg.frontIndex);
      backCollisionMesh.rebuild(msg.position, msg.backIndex);
      wholeBodyCollisionMesh.rebuild(msg.position, msg.wholeBodyIndex);
      torsoCapsules = msg.capsules;
      centerZ = msg.centerZ;
      break;
    }
    case "step": {
      if (!sim) return;
      pinCorners(sim, msg.pinLeft, msg.pinRight, PANEL_FRONT, PANEL_BACK);
      // 소매 이음매 링도 몸판 어깨선과 같은 타이밍에 매 프레임 다시
      // 고정한다 — 자세한 이유는 buildSleeveSim.ts의 pinSleeveSeamRing
      // 주석 참고(이게 없으면 소매 전체가 자기 무게로 처지면서 재봉
      // 제약을 타고 몸판 어깨까지 끌어내린다).
      pinSleeveSeamRing(sim, PANEL_SLEEVE_LEFT, PANEL_SLEEVE_RIGHT, toShape(msg.sleeveLeft), toShape(msg.sleeveRight));
      sleeveCapsules = [...buildArmCapsules(msg.sleeveLeft), ...buildArmCapsules(msg.sleeveRight)];

      const preset = FABRIC_PRESETS[msg.fabric];
      // rebuildCollision은 REBUILD_DEBOUNCE_MS(200ms) 디바운스 + 메인
      // 스레드에서의 충돌 메시 굽기(StaticGeometryGenerator, CPU 비용)를
      // 거쳐야 도착한다 — 그 사이엔 frontCollisionMesh/backCollisionMesh
      // (BVH)와 torsoCapsules가 전부 비어 있어(ArrayBvhCollision.ready가
      // false거나 capsules=[]) torsoResolver가 사실상 아무 일도 안 한다.
      // 충돌 메시가 아직 준비 안 됐으면 중력을 꺼서(구조 제약과 핀만으로
      // 유지) 이 구간에서 옷감이 무너지지 않게 막는다.
      const collisionReady = frontCollisionMesh.ready && backCollisionMesh.ready;
      scratchGravity.copy(collisionReady ? gravityBase : ZERO_VEC3).multiplyScalar(preset.gravityScale);

      const rawDirX = msg.pinRight.x - msg.pinLeft.x;
      const rawDirY = msg.pinRight.y - msg.pinLeft.y;
      const rawDirZ = msg.pinRight.z - msg.pinLeft.z;
      const dirLen = Math.hypot(rawDirX, rawDirY, rawDirZ) || 1;
      dirX = rawDirX / dirLen;
      dirY = rawDirY / dirLen;
      dirZ = rawDirZ / dirLen;

      const torsoParticleCount = sim.panelParticleStart(PANEL_SLEEVE_LEFT);
      const mergedResolver = buildMergedResolver(torsoParticleCount);

      accumulator = Math.min(accumulator + msg.dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        // 30번 병합: 몸판과 소매(그리고 그 사이 새 암홀 재봉 제약)가 이제
        // 같은 제약 목록 안에 있어 한 번의 step()에서 함께 완화된다 —
        // 예전엔 fabric preset(면/데님/실크/니트별 감쇠·반복 횟수)이
        // 몸판에만 적용되고 소매는 항상 고정값(SLEEVE_DAMPING/ITERATIONS)
        // 을 썼는데, 이제 같은 물리 스텝을 공유하니 원단 선택이 소매에도
        // 자연스럽게 반영된다(부수 효과지만 오히려 더 맞는 동작 — 소매도
        // 같은 원단이니까).
        sim.step(
          SUBSTEP_DT,
          scratchGravity,
          mergedResolver,
          preset.iterations,
          COLLISION_EVERY,
          preset.damping,
          MAX_DISPLACEMENT_PER_SUBSTEP,
        );
        selfCollisionResolver(sim.positions.subarray(0, torsoParticleCount * 3), sim.pinned.subarray(0, torsoParticleCount), torsoParticleCount);
        // 순서 보존 안전장치와 스무딩은 몸판(패널 0,1)에만 의미가 있다 —
        // 소매는 원통형이라 이 문제가 원래도 없었고, 그 범위까지 건드리면
        // 소매 모양을 실수로 흐트러뜨릴 수 있다(29번의 회귀 교훈과 같은
        // 이유로 panelFilter를 명시한다).
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        sim.preserveRowOrder(undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        sim.preserveRowOrder(undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        sim.clampOverstretchedConstraints();

        accumulator -= SUBSTEP_DT;
      }

      // 29번(스무딩-보정 순서 버그, 30번 병합에도 그대로 적용): 스무딩을
      // 먼저 실행해 BVH 충돌의 고주파 잔물결을 지우고, 그 다음에 어깨
      // 표면 스냅을 "마지막 발언권"으로 적용한다 — 순서를 반대로 하면
      // 스무딩이 정밀 보정을 다시 희석시킨다(자세한 경위는 git 히스토리
      // 참고). 몸판 재봉 스티칭(stitchTorsoAndSleeve)은 30번에서 실제
      // 거리 제약(addArmholeSeamConstraints)으로 대체돼 더 이상 필요
      // 없다 — 이제 재봉선이 매 반복(iteration) 안에서 다른 구조 제약과
      // 함께 자동으로 풀린다.
      sim.smoothColumns(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1);
      sim.smoothRows(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1);
      sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const bodySurface = wholeBodyCollisionMesh.ready ? wholeBodyCollisionMesh : null;
      pullShoulderCapToSurface(sim, PANEL_FRONT, PANEL_BACK, armholeStartRow, COLS, dirX, dirY, dirZ, bodySurface);
      sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      sim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const ppp = sim.panelParticleCount(PANEL_FRONT);
      const sppp = sim.panelParticleCount(PANEL_SLEEVE_LEFT);
      const frontStart = sim.panelParticleStart(PANEL_FRONT) * 3;
      const backStart = sim.panelParticleStart(PANEL_BACK) * 3;
      const sleeveLeftStart = sim.panelParticleStart(PANEL_SLEEVE_LEFT) * 3;
      const sleeveRightStart = sim.panelParticleStart(PANEL_SLEEVE_RIGHT) * 3;
      const front = sim.positions.slice(frontStart, frontStart + ppp * 3);
      const back = sim.positions.slice(backStart, backStart + ppp * 3);
      const sleeveLeft = sim.positions.slice(sleeveLeftStart, sleeveLeftStart + sppp * 3);
      const sleeveRight = sim.positions.slice(sleeveRightStart, sleeveRightStart + sppp * 3);
      ctx.postMessage(
        { type: "positions", front, back, sleeveLeft, sleeveRight, generation: msg.generation },
        [front.buffer, back.buffer, sleeveLeft.buffer, sleeveRight.buffer],
      );
      break;
    }
  }
};
