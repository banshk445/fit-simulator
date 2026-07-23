import * as THREE from "three";
import { ClothSimulation } from "../lib/clothPhysics";
import type { CollisionResolver } from "../lib/clothPhysics";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { SelfCollision } from "../lib/selfCollision";
import { applyCapsuleCollision, applyFrontBackSidedness } from "../lib/torsoCapsule";
import type { Capsule } from "../lib/torsoCapsule";
import { FABRIC_PRESETS } from "../lib/fabricPresets";
import { applyArmSoftPull, applyNecklineHug, enforceArmFrontBackYAlignment, pinCorners, torsoColumnRange } from "../lib/buildGarmentSim";
import { buildUnifiedGarmentSim } from "../lib/buildUnifiedGarmentSim";
import { pullShoulderCapToSurface, enforceLeftRightSymmetry } from "../lib/garmentStitch";
import {
  ARMHOLE_ROW_FRACTION,
  ARM_COLLISION_RADIUS,
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLISION_MARGIN,
  COLS,
  GRAVITY_BASE,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  MAX_SUBSTEPS,
  PANEL_BACK,
  PANEL_FRONT,
  PARTICLES_PER_PANEL,
  ROWS,
  SELF_COLLISION_MIN_DIST,
  SUBSTEP_DT,
} from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, ArmShapeMsg } from "../lib/garmentProtocol";

// 46번(전면 재설계 — 통합 단일 패널): 소매가 더 이상 별도 패널이 아니라
// 몸판(앞/뒤) 자체의 넓은 바깥쪽 열이므로, 이 워커도 더 이상 "몸판 범위 /
// 소매 범위"를 나눠서 각기 다른 리졸버를 태울 필요가 없다 — 전체가 앞/뒤
// 두 패널뿐이다. 팔은 여전히 캡슐로 근사 충돌하지만, 이제 그 캡슐은
// 몸판(앞/뒤) 전체 범위 위에 그냥 하나 더 얹는 방식으로 적용된다(소매
// 열이 실제로 팔 쪽으로 뻗어 있는 부분에서만 캡슐과 실제로 맞닿으므로,
// 나머지 몸통 부분에 적용해도 무해하다 — torsoCapsules 안전망과 같은
// 방식).
interface WorkerScope {
  postMessage(message: GarmentWorkerToMainMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToGarmentWorkerMessage>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let sim: ClothSimulation | null = null;
let accumulator = 0;
// 46번(약한 지지): "step" 메시지는 widthM/heightM/topY/centerZ를 싣지
// 않는다(치수가 바뀔 때만 "init"으로 다시 온다) — applyArmSoftPull이 매
// 프레임 이 값들로 목표 지점을 다시 계산해야 하므로 마지막 "init" 값을
// 기억해둔다.
let lastLayout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number } | null = null;

// --- 몸판 충돌 ---
const frontCollisionMesh = new ArrayBvhCollision();
const backCollisionMesh = new ArrayBvhCollision();
// 팔 제외 없는 몸 전체 충돌 메시 — 어깨 캡을 실제 마네킹 표면에 직접
// 스냅시키는 용도(garmentStitch.ts의 pullShoulderCapToSurface, 자세한
// 경위는 meshCollision.ts의 wholeBodyIndex 주석 참고). frontCollisionMesh/
// backCollisionMesh와 달리 팔 영역을 일부러 빼지 않은 원본이라야 어깨
// 곡면이 남아있다.
const wholeBodyCollisionMesh = new ArrayBvhCollision();
// 32번: 어깨 캡(목~겨드랑이, rows 1..armholeStartRow) 구간은 캡슐 충돌에서
// 제외한다 — bvhFromArrays.ts의 createResolver 주석 참고. 이 구간은
// pullShoulderCapToSurface가 "어깨 쪽은 넓게, 겨드랑이 쪽은 표면에 밀착"
// 으로 직접 관리하고, 46번 이후로는 소매 열(같은 행 범위)도 캡슐 충돌이
// 직접 관리한다.
//
// 47번(조사 → 수정 — 메시 충돌 스킵을 캡슐 스킵에서 분리): 이 스킵 범위는
// 원래 캡슐(균일 반경 15.9cm 원기둥)이 목~어깨에서 반경이 급변하며 옷이
// 쪼그라드는 아티팩트를 막으려고 도입됐다(32번) — 그런데 BVH 메시 충돌
// (frontMeshResolver/backMeshResolver)은 실제 마네킹 형상을 그대로 따라가는
// 충돌이라 그 급변 문제 자체가 없는데도, 같은 상수(SHOULDER_CAP_SKIP_*)를
// 공유해서 함께 꺼져 있었다. 그 결과 row1~5는 캡슐도 메시도 전혀 충돌하지
// 않는 완전 무방비 구간이 됐고, 그 구간을 관리하는 pullShoulderCapToSurface/
// applyNecklineHug의 목표점이 몸 쪽으로 충분히 밀어주지 못하는 자세에서는
// 옷감이 실제로 몸속으로 파고드는 게 실측(BVH 레이캐스팅: row4 −2.0cm,
// row5 −0.9cm 관통)으로 확인됐다. 메시 충돌은 스킵할 이유가 없으므로 별도
// 상수로 분리해 스킵 범위를 0으로 둔다 — 캡슐 쪽 SHOULDER_CAP_SKIP_*는
// 그대로 유지(그 아티팩트는 여전히 유효한 이유이므로).
const MESH_SKIP_START = 0;
const MESH_SKIP_END = 0;
const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
const SHOULDER_CAP_SKIP_START = COLS * 1;
const SHOULDER_CAP_SKIP_END = COLS * (armholeStartRow + 1);
// 46번(프레임 드랍 진짜 원인 — BVH 트리 탐색 스킵): 몸통 열 범위(torsoColumnRange
// 로 매 스텝 갱신)만 이 비싼 메시 충돌 대상으로 삼는다 — 소매로 뻗은 바깥쪽
// 열은 어차피 팔 캡슐이 따로 관리하므로 트리 탐색 자체가 낭비였다. 초기값은
// "전체 범위"(min=0, max=COLS-1)로 둬 collisionRange가 아직 갱신되기 전에도
// 안전하게 동작한다.
const meshColumnRange = { cols: COLS, min: 0, max: COLS - 1 };
const frontMeshResolver = frontCollisionMesh.createResolver(
  COLLISION_MARGIN,
  COLLISION_DETECTION_RADIUS,
  MESH_SKIP_START,
  MESH_SKIP_END,
  meshColumnRange,
);
const backMeshResolver = backCollisionMesh.createResolver(
  COLLISION_MARGIN,
  COLLISION_DETECTION_RADIUS,
  MESH_SKIP_START,
  MESH_SKIP_END,
  meshColumnRange,
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
let armCapsules: Capsule[] = [];
let centerZ = 0;
let dirX = 1;
let dirY = 0;
let dirZ = 0;

// 33번: 이 캡슐은 실제 마네킹 팔을 근사하는 충돌 표면이므로, 몸판용으로
// 바깥으로 민 shoulder가 아니라 실제 어깨 관절(trueShoulder)을 축으로
// 써야 한다 — shoulder를 쓰면 캡슐 자체가 진짜 팔에서 벗어나 있어 소매가
// 진짜 팔 위에 앉도록 밀어주지 못한다.
function buildArmCapsules(shape: ArmShapeMsg): Capsule[] {
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

// 37번: 캡슐 충돌도 meshResolver와 똑같이 앞판/뒤판을 나눠서, 각 패널
// 로컬 인덱스 기준으로 어깨 캡 스킵 구간을 적용한다 — 하나로 합쳐서 그냥
// SHOULDER_CAP_SKIP_START/END를 넘기면 뒤판 쪽 어깨 캡 구간(로컬 인덱스가
// PARTICLES_PER_PANEL만큼 밀려 있음)은 전혀 스킵되지 않는다. 팔 캡슐은
// 반대로 스킵 구간을 안 준다 — 소매 열이 실제로 팔에 걸치는 구간이 바로
// 이 어깨 캡 행 범위이므로 여기서 빠지면 안 된다.
const unifiedResolver: CollisionResolver = (positions, pinned, n) => {
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
  applyCapsuleCollision(positions.subarray(0, frontCount * 3), pinned.subarray(0, frontCount), frontCount, armCapsules, 0.006);
  applyCapsuleCollision(positions.subarray(frontCount * 3, n * 3), pinned.subarray(frontCount, n), backCount, armCapsules, 0.006);
};

// 자체충돌은 몸판(앞+뒤) 전체에 적용한다 — 이제 이게 곧 전체 시뮬레이션
// 범위다(더 이상 소매를 뺀 부분범위가 아님).
const selfCollision = new SelfCollision(PARTICLES_PER_PANEL, COLS, armholeStartRow);
const selfCollisionResolver = selfCollision.createResolver(SELF_COLLISION_MIN_DIST);

const gravityBase = new THREE.Vector3(...GRAVITY_BASE);
const scratchGravity = new THREE.Vector3();
// 몸판 충돌 메시가 아직 준비 안 됐을 때 중력을 끄는 용도(아래 "step" 참고).
const ZERO_VEC3 = new THREE.Vector3(0, 0, 0);

function toArmDir(shape: ArmShapeMsg) {
  return { dir: shape.dir, length: shape.length };
}

ctx.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      lastLayout = { widthM: msg.widthM, heightM: msg.heightM, topY: msg.topY, centerZ: msg.centerZ, sleeveWidthM: msg.sleeveWidthM };
      sim = buildUnifiedGarmentSim(
        msg.widthM,
        msg.heightM,
        msg.topY,
        msg.centerZ,
        msg.pinLeft,
        msg.pinRight,
        toArmDir(msg.armLeft),
        toArmDir(msg.armRight),
        msg.sleeveWidthM,
        msg.necklineLift,
      );
      accumulator = 0;
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
      const armLeft = toArmDir(msg.armLeft);
      const armRight = toArmDir(msg.armRight);
      pinCorners(activeSim, msg.pinLeft, msg.pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, msg.necklineLift);
      armCapsules = [...buildArmCapsules(msg.armLeft), ...buildArmCapsules(msg.armRight)];
      // 46번: 이번 스텝에서 쓸 몸통 열 범위를 서브스텝 루프(비싼 메시 충돌이
      // 실제로 도는 곳) 시작 전에 미리 갱신해둔다 — meshColumnRange는 살아있는
      // 참조라 여기서 값만 바꿔주면 frontMeshResolver/backMeshResolver가
      // 그대로 최신 값을 읽는다.
      {
        const range = torsoColumnRange(COLS, msg.pinLeft, msg.pinRight, armLeft, armRight);
        meshColumnRange.min = range.xMin;
        meshColumnRange.max = range.xMax;
      }

      const preset = FABRIC_PRESETS[msg.fabric];
      // rebuildCollision은 REBUILD_DEBOUNCE_MS(200ms) 디바운스 + 메인
      // 스레드에서의 충돌 메시 굽기(StaticGeometryGenerator, CPU 비용)를
      // 거쳐야 도착한다 — 그 사이엔 frontCollisionMesh/backCollisionMesh
      // (BVH)와 torsoCapsules가 전부 비어 있어(ArrayBvhCollision.ready가
      // false거나 capsules=[]) unifiedResolver가 사실상 아무 일도 안 한다.
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

      // 31번: 31번에서 발견된 회귀(값싼 순서 보존을 비싼 메시 충돌과 같은
      // 주기로 스로틀링하면 그 사이 반복들에서 구조 제약이 순서를 뒤집을
      // 기회를 열어준다)를 다시 만들지 않도록, 매 Gauss-Seidel 반복마다
      // 순서 보존을 돌리는 훅을 유지한다.
      const torsoOrderExtra: CollisionResolver = () => {
        activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveRowOrder(undefined, false, PANEL_FRONT, PANEL_BACK + 1);
        activeSim.preserveRowOrder(undefined, true, PANEL_FRONT, PANEL_BACK + 1);
      };

      accumulator = Math.min(accumulator + msg.dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        activeSim.step(
          SUBSTEP_DT,
          scratchGravity,
          unifiedResolver,
          preset.iterations,
          COLLISION_EVERY,
          preset.damping,
          MAX_DISPLACEMENT_PER_SUBSTEP,
          torsoOrderExtra,
        );
        selfCollisionResolver(activeSim.positions, activeSim.pinned, activeSim.positions.length / 3);
        // step() 안에서도 매 반복 돌긴 하지만, 자체충돌(step() 밖에서
        // 실행)이 그 직후 다시 순서를 흐트러뜨릴 수 있어 여기서도 한 번
        // 더 정리한다 — 병합 이전부터 있던 이중 안전장치.
        torsoOrderExtra(activeSim.positions, activeSim.pinned, activeSim.positions.length / 3);
        activeSim.clampOverstretchedConstraints();

        accumulator -= SUBSTEP_DT;
      }

      // 29번(스무딩-보정 순서 버그): 스무딩을 먼저 실행해 BVH 충돌의
      // 고주파 잔물결을 지우고, 그 다음에 어깨 표면 스냅을 "마지막
      // 발언권"으로 적용한다 — 순서를 반대로 하면 스무딩이 정밀 보정을
      // 다시 희석시킨다.
      activeSim.smoothColumns(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1, meshColumnRange.min, meshColumnRange.max);
      activeSim.smoothRows(armholeStartRow + 1, 0.5, PANEL_FRONT, PANEL_BACK + 1, meshColumnRange.min, meshColumnRange.max);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const bodySurface = wholeBodyCollisionMesh.ready ? wholeBodyCollisionMesh : null;
      pullShoulderCapToSurface(activeSim, PANEL_FRONT, PANEL_BACK, armholeStartRow, meshColumnRange.min, meshColumnRange.max, COLS, dirX, dirY, dirZ, bodySurface);
      if (lastLayout) {
        applyArmSoftPull(
          activeSim,
          PANEL_FRONT,
          PANEL_BACK,
          lastLayout.widthM,
          lastLayout.heightM,
          lastLayout.topY,
          lastLayout.centerZ,
          msg.pinLeft,
          msg.pinRight,
          armLeft,
          armRight,
          lastLayout.sleeveWidthM,
        );
        applyNecklineHug(
          activeSim,
          PANEL_FRONT,
          PANEL_BACK,
          lastLayout.widthM,
          lastLayout.centerZ,
          msg.pinLeft,
          msg.pinRight,
          armLeft,
          armRight,
        );
      }
      enforceArmFrontBackYAlignment(activeSim, PANEL_FRONT, PANEL_BACK, msg.pinLeft, msg.pinRight, armLeft, armRight);
      enforceLeftRightSymmetry(activeSim, PANEL_FRONT, PANEL_BACK, COLS, ROWS);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false, PANEL_FRONT, PANEL_BACK + 1);
      activeSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true, PANEL_FRONT, PANEL_BACK + 1);

      const ppp = activeSim.panelParticleCount(PANEL_FRONT);
      const frontStart = activeSim.panelParticleStart(PANEL_FRONT) * 3;
      const backStart = activeSim.panelParticleStart(PANEL_BACK) * 3;
      const front = activeSim.positions.slice(frontStart, frontStart + ppp * 3);
      const back = activeSim.positions.slice(backStart, backStart + ppp * 3);
      ctx.postMessage({ type: "positions", front, back, generation: msg.generation }, [front.buffer, back.buffer]);
      break;
    }
  }
};
