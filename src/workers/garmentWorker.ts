import * as THREE from "three";
import { ClothSimulation } from "../lib/clothPhysics";
import type { CollisionResolver } from "../lib/clothPhysics";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { SelfCollision } from "../lib/selfCollision";
import { applyCapsuleCollision, applyFrontBackSidedness } from "../lib/torsoCapsule";
import type { Capsule } from "../lib/torsoCapsule";
import { FABRIC_PRESETS } from "../lib/fabricPresets";
import { buildGarmentSim, pinCorners } from "../lib/buildGarmentSim";
import { buildSleeveSim, pinSleeveRing, seamCircularRing } from "../lib/buildSleeveSim";
import type { SleeveShape } from "../lib/buildSleeveSim";
import { blendSeamRing, pullShoulderCapToSurface, stitchTorsoAndSleeve } from "../lib/garmentStitch";
import {
  ARMHOLE_ROW_FRACTION,
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLISION_MARGIN,
  COLS,
  GRAVITY_BASE,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  MAX_SUBSTEPS,
  PARTICLES_PER_PANEL,
  ROWS,
  SELF_COLLISION_MIN_DIST,
  SLEEVE_DAMPING,
  SLEEVE_ITERATIONS,
  SUBSTEP_DT,
} from "../lib/clothConfig";
import type { MainToGarmentWorkerMessage, GarmentWorkerToMainMessage, SleeveShapeMsg } from "../lib/garmentProtocol";

// 큰 재설계: 몸판(clothWorker.ts)과 소매(sleeveWorker.ts)를 이 워커
// 하나로 합쳤다 — 두 ClothSimulation 인스턴스(그리드 크기가 달라 하나로
// 합칠 순 없음)를 같은 워커 안에서 함께 들고 있으면서, garmentStitch.ts로
// 소매 이음매 링을 몸판의 "이번 프레임" 진동둘레 가장자리 위치에 직접
// 붙인다. 이전(가벼운 재설계)엔 몸판이 메인 스레드로 위치를 보내고,
// 메인 스레드가 다시 소매 워커로 보내는 두 단계를 거쳐야 해서 최소
// 한 프레임 지연이 있었다 — 이제 같은 워커 안에서 두 시뮬레이션이 바로
// 옆에 있으므로 그 지연이 없다.
//
// (처음엔 진짜 양방향 물리 제약(서로 당기는 스티치 짝)으로 구현했었는데,
// "가까운 정점만 스티치·먼 정점은 원형 핀"이라는 하드 컷오프의 경계에서
// 눈에 띄는 이음새가 생기는 게 실측(확대 화면)으로 확인돼, 모든 정점을
// 거리 기반으로 부드럽게 블렌딩하는 이 방식으로 되돌렸다 — 자세한 이유는
// garmentStitch.ts 참고.)
interface WorkerScope {
  postMessage(message: GarmentWorkerToMainMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToGarmentWorkerMessage>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let torsoSim: ClothSimulation | null = null;
let sleeveSim: ClothSimulation | null = null;
let accumulator = 0;

// --- 몸판 충돌(기존 clothWorker.ts와 동일) ---
const frontCollisionMesh = new ArrayBvhCollision();
const backCollisionMesh = new ArrayBvhCollision();
// 팔 제외 없는 몸 전체 충돌 메시 — 소매 이음매 링을 실제 어깨 곡면에
// 직접 스냅시키는 용도(garmentStitch.ts의 snapToBodySurface, 자세한
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

const columnOrderExtra: CollisionResolver = () => {
  torsoSim?.preserveColumnOrder(dirX, dirY, dirZ, undefined, false);
  torsoSim?.preserveColumnOrder(dirX, dirY, dirZ, undefined, true);
  torsoSim?.preserveRowOrder(undefined, false);
  torsoSim?.preserveRowOrder(undefined, true);
};

const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
const selfCollision = new SelfCollision(PARTICLES_PER_PANEL, COLS, armholeStartRow);
const selfCollisionResolver = selfCollision.createResolver(SELF_COLLISION_MIN_DIST);

const gravityBase = new THREE.Vector3(...GRAVITY_BASE);
const scratchGravity = new THREE.Vector3();
const sleeveGravity = new THREE.Vector3(...GRAVITY_BASE);
// 몸판 충돌 메시가 아직 준비 안 됐을 때 중력을 끄는 용도(아래 "step" 참고).
const ZERO_VEC3 = new THREE.Vector3(0, 0, 0);

// --- 소매 충돌(기존 sleeveWorker.ts와 동일) ---
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

ctx.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      torsoSim = buildGarmentSim(msg.widthM, msg.heightM, msg.topY, msg.centerZ, msg.pinLeft, msg.pinRight);
      // buildSleeveSim이 내부적으로 이음매를 원형 공식으로 한 번 고정해둔다
      // — 몸판과 대조한 블렌딩은 바로 다음 "step" 메시지에서 적용된다.
      sleeveSim = buildSleeveSim(msg.sleeveRows, toShape(msg.sleeveLeft), toShape(msg.sleeveRight));
      accumulator = 0;
      break;
    }
    case "reinitSleeve": {
      // 소매 종류(반팔/긴팔)만 바뀐 경우 — 몸판(torsoSim)은 건드리지
      // 않고 소매만 새로 짓는다. 자세한 이유는 garmentProtocol.ts 참고.
      sleeveSim = buildSleeveSim(msg.sleeveRows, toShape(msg.sleeveLeft), toShape(msg.sleeveRight));
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
      if (!torsoSim || !sleeveSim) return;
      pinCorners(torsoSim, msg.pinLeft, msg.pinRight);
      const leftShape = toShape(msg.sleeveLeft);
      const rightShape = toShape(msg.sleeveRight);
      // 소매 이음매 링을 몸판의 "이번 프레임" 진동둘레 가장자리(방금 위에서
      // pinCorners로 갱신한 어깨선 포함, 그 아래는 지난 프레임 물리 결과)
      // 쪽으로 거리 기반 블렌딩한 뒤, 그걸로 안 닿는 나머지는 실제 마네킹
      // 어깨 표면에 직접 스냅시킨다 — 자세한 이유는 garmentStitch.ts 참고.
      // wholeBodyCollisionMesh가 아직 rebuildCollision을 못 받았으면(마운트
      // 직후 한두 프레임) ready=false이니 null을 넘겨 안전하게 폴백한다.
      const bodySurface = wholeBodyCollisionMesh.ready ? wholeBodyCollisionMesh : null;
      const leftRing = blendSeamRing(torsoSim, 0, seamCircularRing(leftShape), bodySurface);
      const rightRing = blendSeamRing(torsoSim, 1, seamCircularRing(rightShape), bodySurface);
      pinSleeveRing(sleeveSim, 0, leftRing);
      pinSleeveRing(sleeveSim, 1, rightRing);
      // (실측 기록: 0번 행 바로 다음 행까지 같은 방식으로 붙여 탑다운 각도의
      // 잔여 틈을 더 줄여보려는 시도를 두 가지 해봤다 — (1) pinSleeveRing으로
      // 완전히 고정: 인접한 두 행을 동시에 완전 고정하면 이 완화 솔버가
      // 과잉구속을 못 버티고 옷감이 뒤틀리는(텍스처가 대각선으로 찢어진
      // 것처럼 보이는) 회귀가 실측(정면 화면)으로 재현됐다(buildGarmentSim.ts
      // 의 목선 관련 주석에 이미 같은 교훈이 있었다). (2) 완전 고정 대신
      // 서브스텝 루프 시작 전 목표 쪽으로 일부만 당기는 부드러운 버전
      // (nudgeSleeveRing, weight 0.3과 0.7 둘 다 실측): 뒤틀림 회귀는
      // 없었지만, 그 정도 세기로는 경쟁하는 물리력(중력, 인접 행과의 구조
      // 제약)에 밀려 매 프레임 당겨봐야 정착 상태에서 눈에 띄는 개선이
      // 없었다 — 두 시도 모두 폐기하고 0번 행만 고정하는 이 상태로
      // 되돌린다. 남은 잔여 틈은 알려진 한계로 남겨둔다.)
      sleeveCapsules = [...buildArmCapsules(msg.sleeveLeft), ...buildArmCapsules(msg.sleeveRight)];

      const preset = FABRIC_PRESETS[msg.fabric];
      // rebuildCollision은 REBUILD_DEBOUNCE_MS(200ms) 디바운스 + 메인
      // 스레드에서의 충돌 메시 굽기(StaticGeometryGenerator, CPU 비용)를
      // 거쳐야 도착한다 — 그 사이엔 frontCollisionMesh/backCollisionMesh
      // (BVH)와 torsoCapsules가 전부 비어 있어(ArrayBvhCollision.ready가
      // false거나 capsules=[]) torsoResolver가 사실상 아무 일도 안 한다.
      // 즉 그 짧은 초기 구간 동안은 몸판이 마네킹 표면과 전혀 충돌하지
      // 않은 채 중력만으로 자유낙하한다 — 대부분의 환경에서는 이 구간이
      // 워낙 짧아(수 프레임) 눈에 안 띄지만, 이 구간이 더 길어지는
      // 환경(느린 CPU, 무거운 다른 탭 등 — Safari에서 재현된 "어깨가
      // 훤히 드러나 보이는 처짐" 문제가 실측으로 확인됨: 콘솔로 직접
      // 찍어본 어깨 핀 좌표는 항상 정확했는데도 화면은 간헐적으로 무너져
      // 보였다)에서는, 충돌 없이 여러 프레임 자유낙하한 옷감이 뒤늦게
      // 충돌이 활성화돼도 완전히 회복 못 하고 늘어진 채로 굳어버릴 수
      // 있다. 충돌 메시가 아직 준비 안 됐으면 중력을 꺼서(구조 제약과
      // 핀만으로 유지) 이 구간에서 옷감이 무너지지 않게 막는다 — 충돌이
      // 준비되는 즉시(보통 1초 이내) 정상적으로 중력이 들어와 자연스럽게
      // 늘어진다.
      const collisionReady = frontCollisionMesh.ready && backCollisionMesh.ready;
      scratchGravity.copy(collisionReady ? gravityBase : ZERO_VEC3).multiplyScalar(preset.gravityScale);

      const rawDirX = msg.pinRight.x - msg.pinLeft.x;
      const rawDirY = msg.pinRight.y - msg.pinLeft.y;
      const rawDirZ = msg.pinRight.z - msg.pinLeft.z;
      const dirLen = Math.hypot(rawDirX, rawDirY, rawDirZ) || 1;
      dirX = rawDirX / dirLen;
      dirY = rawDirY / dirLen;
      dirZ = rawDirZ / dirLen;

      accumulator = Math.min(accumulator + msg.dt, SUBSTEP_DT * MAX_SUBSTEPS);
      while (accumulator >= SUBSTEP_DT) {
        torsoSim.step(
          SUBSTEP_DT,
          scratchGravity,
          torsoResolver,
          preset.iterations,
          COLLISION_EVERY,
          preset.damping,
          MAX_DISPLACEMENT_PER_SUBSTEP,
          columnOrderExtra,
        );
        selfCollisionResolver(torsoSim.positions, torsoSim.pinned, torsoSim.particlesPerPanel * torsoSim.panels);
        torsoSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false);
        torsoSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true);
        torsoSim.preserveRowOrder(undefined, false);
        torsoSim.preserveRowOrder(undefined, true);
        torsoSim.clampOverstretchedConstraints();

        sleeveSim.step(SUBSTEP_DT, sleeveGravity, sleeveResolver, SLEEVE_ITERATIONS, 1, SLEEVE_DAMPING, MAX_DISPLACEMENT_PER_SUBSTEP);
        sleeveSim.clampOverstretchedConstraints();

        accumulator -= SUBSTEP_DT;
      }

      // 29번(스무딩-보정 순서 버그): smoothColumns/smoothRows는 원래 BVH
      // 충돌의 삼각형 단위 잔물결(고주파 노이즈)만 지우려고 만들었는데,
      // 이 둘도 정확히 어깨 캡 구간(rows 1..armholeStartRow)에 대해
      // 이웃과의 평균으로 끌어당기는 라플라시안 스무딩이다 — 그런데
      // 지금까지는 pullShoulderCapToSurface(어깨를 실제 마네킹 표면에
      // 정밀하게 스냅)와 stitchTorsoAndSleeve(몸판-소매 재봉) *바로 뒤에*
      // 실행되고 있었다. 즉 두 정밀 보정이 방금 딱 붙여놓은 위치를, 그
      // 직후 8회 반복되는 스무딩이 "덜 보정된 이웃 점들의 평균" 쪽으로
      // 다시 희석시켜버리는 순서였다 — 사용자가 3/4 뒷모습에서 재지적한
      // "소매가 어깨 위에 붕 뜬 별도 조각처럼 보이고 그 밑에 맨살이
      // 드러나는" 잔여 틈이 바로 이 순서 문제였을 가능성이 높다(스무딩
      // 자체가 필요 없는 게 아니라, 스무딩→정밀 보정 순서여야 정밀 보정이
      // 최종적으로 이긴다). 순서를 뒤집는다: 먼저 스무딩으로 충돌의 고주파
      // 잔물결을 지우고, 그 다음에 어깨 표면 스냅과 재봉선을 "마지막
      // 발언권"으로 적용한다.
      for (let i = 0; i < 8; i++) torsoSim.smoothColumns(armholeStartRow + 1, 0.5);
      for (let i = 0; i < 8; i++) torsoSim.smoothRows(armholeStartRow + 1, 0.5);
      torsoSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, false);
      torsoSim.preserveColumnOrder(dirX, dirY, dirZ, undefined, true);

      // 큰 재설계(3D 곡면 어깨): 위 substep 루프(+ 방금 위의 스무딩)가
      // 중력+구조 제약+이웃 평균으로 다시 안쪽으로 처지게/희석되게 만든
      // 어깨~겨드랑이 구간을, 실제 마네킹 표면 쪽으로 매 프레임 능동적으로
      // 재보정한다 — 자세한 이유는 garmentStitch.ts의
      // pullShoulderCapToSurface 주석 참고. 스무딩 이후에 실행해 이
      // 보정이 스무딩에 다시 희석되지 않고 최종 위치로 남게 한다.
      pullShoulderCapToSurface(torsoSim, armholeStartRow, COLS, dirX, dirY, dirZ, bodySurface);
      // 몸판과 소매를 서로를 향해 동시에 당기는 진짜 재봉선 — 자세한
      // 이유는 garmentStitch.ts의 stitchTorsoAndSleeve 주석 참고
      // (everyIterationExtra로 옮겨봤다가 소매 쪽 반복에 걸면 오히려
      // 불안정해지는 걸 실측으로 확인해 이 프레임당 한 번 방식으로
      // 되돌렸다). 이것도 스무딩 뒤에 실행해 재봉 결과가 최종적으로 남게
      // 한다.
      stitchTorsoAndSleeve(torsoSim, sleeveSim, armholeStartRow, COLS);

      const ppp = torsoSim.particlesPerPanel;
      const front = torsoSim.positions.slice(0, ppp * 3);
      const back = torsoSim.positions.slice(ppp * 3, ppp * 6);
      const sppp = sleeveSim.particlesPerPanel;
      const sleeveLeft = sleeveSim.positions.slice(0, sppp * 3);
      const sleeveRight = sleeveSim.positions.slice(sppp * 3, sppp * 6);
      ctx.postMessage(
        { type: "positions", front, back, sleeveLeft, sleeveRight, generation: msg.generation },
        [front.buffer, back.buffer, sleeveLeft.buffer, sleeveRight.buffer],
      );
      break;
    }
  }
};
