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
import { pullShoulderCapToSurface, enforceLeftRightSymmetry } from "../lib/garmentStitch";
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
// 32번: 어깨 캡(목~겨드랑이, rows 1..armholeStartRow) 구간은 이 일반 메시
// 충돌에서 제외한다 — bvhFromArrays.ts의 createResolver 주석 참고. 이
// 구간은 pullShoulderCapToSurface가 "어깨 쪽은 넓게, 겨드랑이 쪽은
// 표면에 밀착"으로 직접 관리하는데, 일반 메시 충돌이 서브스텝마다 훨씬
// 자주 돌면서 그 목표를 매번 표면 margin 거리로 되돌려버려 무효화시키고
// 있었다(실측: 초기 배치·런타임 보정 목표를 둘 다 바꿔도 결과가 거의
// 그대로였던 진짜 원인).
const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
const SHOULDER_CAP_SKIP_START = COLS * 1;
const SHOULDER_CAP_SKIP_END = COLS * (armholeStartRow + 1);
const frontMeshResolver = frontCollisionMesh.createResolver(
  COLLISION_MARGIN,
  COLLISION_DETECTION_RADIUS,
  SHOULDER_CAP_SKIP_START,
  SHOULDER_CAP_SKIP_END,
);
const backMeshResolver = backCollisionMesh.createResolver(
  COLLISION_MARGIN,
  COLLISION_DETECTION_RADIUS,
  SHOULDER_CAP_SKIP_START,
  SHOULDER_CAP_SKIP_END,
);

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

// 37번: 캡슐 충돌도 meshResolver와 똑같이 앞판/뒤판을 나눠서, 각 패널
// 로컬 인덱스 기준으로 어깨 캡 스킵 구간을 적용한다 — 하나로 합쳐서 그냥
// SHOULDER_CAP_SKIP_START/END를 넘기면 뒤판 쪽 어깨 캡 구간(로컬 인덱스가
// PARTICLES_PER_PANEL만큼 밀려 있음)은 전혀 스킵되지 않는다.
const torsoResolver: CollisionResolver = (positions, pinned, n) => {
  meshResolver(positions, pinned, n);
  const frontCount = PARTICLES_PER_PANEL;
  const backCount = n - frontCount;
  applyCapsuleCollision(
    positions.subarray(0, frontCount * 3),
    pinned.subarray(0, frontCount),
    frontCount,
    torsoCapsules,
    COLLISION_MARGIN,
    SHOULDER_CAP_SKIP_START,
    SHOULDER_CAP_SKIP_END,
  );
  applyCapsuleCollision(
    positions.subarray(frontCount * 3, n * 3),
    pinned.subarray(frontCount, n),
    backCount,
    torsoCapsules,
    COLLISION_MARGIN,
    SHOULDER_CAP_SKIP_START,
    SHOULDER_CAP_SKIP_END,
  );
  applyFrontBackSidedness(positions, pinned, PARTICLES_PER_PANEL, centerZ);
};

// --- 소매 충돌 ---
// 33번: 이 캡슐은 실제 마네킹 팔을 근사하는 충돌 표면이므로, 몸판용으로
// 바깥으로 민 shoulder가 아니라 실제 어깨 관절(trueShoulder)을 축으로
// 써야 한다 — shoulder를 쓰면 캡슐 자체가 진짜 팔에서 벗어나 있어 소매가
// 진짜 팔 위에 앉도록 밀어주지 못한다(buildSleeveSim.ts의 centerAt()과
// 같은 원인·같은 수정).
function buildArmCapsules(shape: SleeveShapeMsg): Capsule[] {
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
    { top: shape.trueShoulder, bottom: mid, radius: shape.radiusMax * 0.9 },
    { top: mid, bottom: end, radius: shape.radiusHem * 0.9 },
  ];
}

function toShape(msg: SleeveShapeMsg): SleeveShape {
  return {
    shoulder: msg.shoulder,
    trueShoulder: msg.trueShoulder,
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
      // torsoOrderExtra는 클로저라 sim이 나중에(예: 다음 메시지 처리로)
      // null로 바뀔 수 있다고 타입체커가 보수적으로 판단해 위 null 체크로
      // 좁혀지지 않는다(tsc --noEmit은 못 잡지만 tsc -b는 잡는 차이가
      // 실측으로 확인됨) — 지역 상수에 담아 이 case 블록 안에서는 항상
      // non-null임을 명시한다.
      const activeSim = sim;
      pinCorners(activeSim, msg.pinLeft, msg.pinRight, PANEL_FRONT, PANEL_BACK);
      // 소매 이음매 링도 몸판 어깨선과 같은 타이밍에 매 프레임 다시
      // 고정한다 — 자세한 이유는 buildSleeveSim.ts의 pinSleeveSeamRing
      // 주석 참고(이게 없으면 소매 전체가 자기 무게로 처지면서 재봉
      // 제약을 타고 몸판 어깨까지 끌어내린다).
      pinSleeveSeamRing(activeSim, PANEL_SLEEVE_LEFT, PANEL_SLEEVE_RIGHT, toShape(msg.sleeveLeft), toShape(msg.sleeveRight));
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

      const torsoParticleCount = activeSim.panelParticleStart(PANEL_SLEEVE_LEFT);
      const mergedResolver = buildMergedResolver(torsoParticleCount);

      // 31번: 30번 병합 리라이트에서 이 훅이 통째로 빠져 있었다 — 병합 전
      // 코드는 이걸 everyIterationExtra로 넘겨 매 Gauss-Seidel 반복(원단별
      // 12~24회)마다 무조건 실행했는데(clothPhysics.ts의 step() 주석 참고:
      // "값싼 순서 보존을 비싼 메시 충돌과 같은 주기로 스로틀링하면 그
      // 사이 반복들에서 구조 제약이 순서를 뒤집을 기회를 열어준다"), 병합
      // 리라이트는 서브스텝당 딱 한 번만(step() 밖에서) 부르는 것으로
      // 바뀌어 있었다. 그 결과 몸판 배(허리~엉덩이 높이) 부분에서 마네킹
      // 배 충돌이 특정 행을 바깥으로 밀어내는 동안 구조 제약 반복이 그
      // 위아래 행과 순서를 뒤집어(정점 Y좌표를 행 순서대로 찍어보면 15번
      // 행 아래에서 19번 행이 다시 위로 튀어 오르는 것을 실측으로 확인)
      // 옷자락이 실제로 접혀 겹치는 회귀가 있었다 — 사용자가 "옷이 가슴에
      // 있다"고 지적한 원인 중 상당 부분이 총장 버그가 아니라 이 접힘
      // 이었던 것으로 보인다(총장 버그를 먼저 고치기 전엔 셔츠가 배까지
      // 닿지도 않아 이 회귀 자체가 가려져 있었다). everyIterationExtra를
      // 되살려 원래 있던 매 반복 보정을 복원한다.
      const torsoOrderExtra: CollisionResolver = () => {
        activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveRowOrder(undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveRowOrder(undefined, true, PANEL_FRONT, PANEL_BACK + 1);
      };

      accumulator = Math.min(accumulator + msg.dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        // 30번 병합: 몸판과 소매(그리고 그 사이 새 암홀 재봉 제약)가 이제
        // 같은 제약 목록 안에 있어 한 번의 step()에서 함께 완화된다 —
        // 예전엔 fabric preset(면/데님/실크/니트별 감쇠·반복 횟수)이
        // 몸판에만 적용되고 소매는 항상 고정값(SLEEVE_DAMPING/ITERATIONS)
        // 을 썼는데, 이제 같은 물리 스텝을 공유하니 원단 선택이 소매에도
        // 자연스럽게 반영된다(부수 효과지만 오히려 더 맞는 동작 — 소매도
        // 같은 원단이니까).
        activeSim.step(
          SUBSTEP_DT,
          scratchGravity,
          mergedResolver,
          preset.iterations,
          COLLISION_EVERY,
          preset.damping,
          MAX_DISPLACEMENT_PER_SUBSTEP,
          torsoOrderExtra,
        );
        selfCollisionResolver(activeSim.positions.subarray(0, torsoParticleCount * 3), activeSim.pinned.subarray(0, torsoParticleCount), torsoParticleCount);
        // step() 안에서도 매 반복 돌긴 하지만, 자체충돌(step() 밖에서
        // 실행)이 그 직후 다시 순서를 흐트러뜨릴 수 있어 여기서도 한 번
        // 더 정리한다 — 병합 이전부터 있던 이중 안전장치.
        torsoOrderExtra(activeSim.positions, activeSim.pinned, activeSim.positions.length / 3);
        activeSim.clampOverstretchedConstraints();

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
      activeSim.smoothColumns(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.smoothRows(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const bodySurface = wholeBodyCollisionMesh.ready ? wholeBodyCollisionMesh : null;
      pullShoulderCapToSurface(activeSim, PANEL_FRONT, PANEL_BACK, armholeStartRow, COLS, dirX, dirY, dirZ, bodySurface);
      enforceLeftRightSymmetry(activeSim, PANEL_FRONT, PANEL_BACK, COLS, ROWS);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const ppp = activeSim.panelParticleCount(PANEL_FRONT);
      const sppp = activeSim.panelParticleCount(PANEL_SLEEVE_LEFT);
      const frontStart = activeSim.panelParticleStart(PANEL_FRONT) * 3;
      const backStart = activeSim.panelParticleStart(PANEL_BACK) * 3;
      const sleeveLeftStart = activeSim.panelParticleStart(PANEL_SLEEVE_LEFT) * 3;
      const sleeveRightStart = activeSim.panelParticleStart(PANEL_SLEEVE_RIGHT) * 3;
      const front = activeSim.positions.slice(frontStart, frontStart + ppp * 3);
      const back = activeSim.positions.slice(backStart, backStart + ppp * 3);
      const sleeveLeft = activeSim.positions.slice(sleeveLeftStart, sleeveLeftStart + sppp * 3);
      const sleeveRight = activeSim.positions.slice(sleeveRightStart, sleeveRightStart + sppp * 3);
      ctx.postMessage(
        { type: "positions", front, back, sleeveLeft, sleeveRight, generation: msg.generation },
        [front.buffer, back.buffer, sleeveLeft.buffer, sleeveRight.buffer],
      );
      break;
    }
  }
};
