import * as THREE from "three";
import { ClothSimulation } from "../lib/clothPhysics";
import type { CollisionResolver } from "../lib/clothPhysics";
import { ArrayBvhCollision } from "../lib/bvhFromArrays";
import { SelfCollision } from "../lib/selfCollision";
import { FABRIC_PRESETS } from "../lib/fabricPresets";
import { buildUnifiedGarmentSim } from "../lib/buildUnifiedGarmentSim";
import { bakeSdf, createSdfFrictionPass, createSdfPushResolver, type SdfField } from "../lib/sdfCollision";
// M0(파이프라인 일원화): 프레임 시퀀스·unifiedResolver·팔 캡슐 빌더는
// garmentFrame.ts로 이사 — paramSweep(Node)과 이 워커가 같은 함수를 쓴다.
import { buildArmCapsules, createGarmentSession, createPanelSplitResolver, createUnifiedResolver, PANEL_COUNTS } from "../lib/garmentFrame";
import type { CollisionState, GarmentSession } from "../lib/garmentFrame";
import {
  ARMHOLE_ROW_FRACTION,
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLISION_MARGIN,
  COLS,
  FRICTION_CONTACT_BAND,
  FRICTION_MU_KINETIC,
  FRICTION_MU_STATIC,
  GRAVITY_BASE,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  ROWS,
  SDF_FAR,
  SDF_PUSH_RELAXATION,
  SDF_VOXEL,
  SELF_COLLISION_MIN_DIST,
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
// M0: 프레임 시퀀스(핀→서브스텝 루프→후처리)는 세션이 담당 — "init"마다
// 새로 만든다(accumulator 리셋과 동일한 효과).
let session: GarmentSession | null = null;
// 46번(약한 지지): "step" 메시지는 widthM/heightM/topY/centerZ를 싣지
// 않는다(치수가 바뀔 때만 "init"으로 다시 온다) — applyArmSoftPull이 매
// 프레임 이 값들로 목표 지점을 다시 계산해야 하므로 마지막 "init" 값을
// 기억해둔다.
let lastLayout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number } | null = null;

// --- 몸판 충돌 ---
const frontCollisionMesh = new ArrayBvhCollision();
const backCollisionMesh = new ArrayBvhCollision();
// 팔 제외 없는 몸 전체 충돌 메시 — frontCollisionMesh/backCollisionMesh와
// 달리 팔 영역을 일부러 빼지 않은 원본이라야 어깨 곡면이 남아있다(자세한
// 경위는 meshCollision.ts의 wholeBodyIndex 주석 참고). 원래 용도였던
// pullShoulderCapToSurface는 47번에서 삭제됐고, 지금은 아래 핏 맵
// 계측(computeFitCm)이 유일한 소비자다 — 물리 리졸버에는 관여하지 않는
// 순수 조회용으로만 쓰인다.
const wholeBodyCollisionMesh = new ArrayBvhCollision();
// 핏 맵 전용 상수 — 물리 충돌(COLLISION_DETECTION_RADIUS 등)과는 독립된
// 별개 값이다. 실측이 아니라 "어지간히 헐렁한 옷도 놓치지 말자"는
// 눈대중으로 넉넉히 잡은 탐지 반경(60cm) — 이보다 먼 정점은 표면을 못
// 찾아 null이 되고, 화면에서는 "헐렁"(파랑)으로 표시한다.
const FIT_MAP_DETECTION_RADIUS = 0.6;
const FIT_MAP_UNKNOWN_CM = 999;

// 핏 맵 전용 — 물리에 전혀 관여하지 않는 순수 조회 루프. panel 하나의
// 정점 좌표(XYZXYZ...)를 받아 각 정점의 몸 표면까지 부호 있는 거리(cm)를
// 채운 배열을 돌려준다.
function computeFitCm(positions: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count);
  if (!wholeBodyCollisionMesh.ready) {
    out.fill(FIT_MAP_UNKNOWN_CM);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    const clearance = wholeBodyCollisionMesh.signedClearance(positions[ix], positions[ix + 1], positions[ix + 2], FIT_MAP_DETECTION_RADIUS);
    out[i] = clearance === null ? FIT_MAP_UNKNOWN_CM : clearance * 100;
  }
  return out;
}
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

// createPanelSplitResolver/PANEL_COUNTS는 garmentFrame.ts로 이사(M0).
const meshResolver = createPanelSplitResolver([frontMeshResolver, backMeshResolver, null, null], PANEL_COUNTS);


// 37번/범위 B의 unifiedResolver 본체는 garmentFrame.ts의
// createUnifiedResolver로 이사(M0) — 워커는 살아있는 상태 객체만 관리한다.
const collisionState: CollisionState = { torsoCapsules: [], armCapsules: [], centerZ: 0, sidedness: true };
const unifiedResolver = createUnifiedResolver(meshResolver, collisionState);

// 자체충돌은 몸판(앞+뒤)+소매(좌+우) 전체에 적용한다. 범위 B(소매 재설계
// — 별도 패널): 패널 크기가 더 이상 균일(1232/1232/144/144)하지 않아,
// PARTICLES_PER_PANEL/COLS 고정값으로는 소매 패널 경계를 못 찾는다(소매
// 두 패널이 하나로 뭉개지고 좌표도 틀어짐 — selfCollision.ts panelAndUV
// 주석 참고). sim이 실제로 만들어진 뒤(각 "init")에 sim.panelParticleStart/
// panelDims에서 그대로 뽑아 재구성한다 — panelDims는 전부 상수(COLS/ROWS/
// SLEEVE_RING_*)라 매 rebuild마다 값 자체는 같지만, sim 인스턴스 없이는
// 이 값을 들고 있는 곳이 없어 sim 생성 이후로 옮겨야 한다.
let selfCollisionResolver: CollisionResolver | null = null;

// M2(SDF 마찰): rebuildCollision이 준 몸 메시를 들고 있다가, 레이아웃까지
// 확정된 뒤(첫 step) 한 번 굽는다 — 굽기 범위가 옷이 닿는 Y 구간에
// 의존하기 때문. 몸이 바뀌면(rebuildCollision) 무효화 후 재굽기.
// 두 필드를 따로 굽는다. 마찰용은 몸 전체(팔 포함) — 소매가 팔에 대해
// 마찰을 받아야 하므로. 밀어내기용은 팔 제외(frontIndex+backIndex 합집합)
// — 기존 BVH 리졸버가 정확히 그 인덱스를 쓰고 팔은 캡슐이 따로 담당하기
// 때문. 하나로 합치면 몸통 천이 팔 표면에도 흡착돼 M2-3에 변화가 하나 더
// 섞인다. 비용은 rebuild당 2회(각 ~0.36s, 디바운스 200ms 뒤 워커에서).
let bakedBody: {
  position: Float32Array;
  wholeBodyIndex: Uint32Array | null;
  frontIndex: Uint32Array | null;
  backIndex: Uint32Array | null;
} | null = null;
let sdfField: SdfField | null = null;
let sdfPushField: SdfField | null = null;
let sdfFrictionEnabled = false;
let sdfPushEnabled = false;

function ensureSdf(): void {
  if (!bakedBody || !lastLayout) return;
  if (!sdfFrictionEnabled && !sdfPushEnabled) return;
  if ((sdfField || !sdfFrictionEnabled) && (sdfPushField || !sdfPushEnabled)) return;
  const { position, wholeBodyIndex, frontIndex, backIndex } = bakedBody;
  const yTop = lastLayout.topY + 0.1;
  const yBot = lastLayout.topY - lastLayout.heightM - 0.15;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    const y = position[i + 1];
    if (y < yBot || y > yTop) continue;
    if (position[i] < minX) minX = position[i];
    if (position[i] > maxX) maxX = position[i];
    if (position[i + 2] < minZ) minZ = position[i + 2];
    if (position[i + 2] > maxZ) maxZ = position[i + 2];
  }
  if (!Number.isFinite(minX)) return;
  const pad = 0.08;
  const min = { x: minX - pad, y: yBot, z: minZ - pad };
  const max = { x: maxX + pad, y: yTop, z: maxZ + pad };
  const bake = (index: Uint32Array | null, label: string): SdfField => {
    const mesh = new ArrayBvhCollision();
    mesh.rebuild(position, index);
    const t = performance.now();
    const f = bakeSdf((x, y, z) => mesh.signedClearance(x, y, z, SDF_FAR), min, max, SDF_VOXEL, SDF_FAR);
    console.log(`[SDF:${label}] ${f.nx}x${f.ny}x${f.nz} (${((f.nx * f.ny * f.nz) / 1000).toFixed(1)}k복셀) ${Math.round(performance.now() - t)}ms`);
    return f;
  };
  if (sdfFrictionEnabled && !sdfField) sdfField = bake(wholeBodyIndex, "마찰/몸전체");
  if (sdfPushEnabled && !sdfPushField) {
    // frontIndex+backIndex 합집합 = 팔 제외 몸통(기존 BVH 리졸버와 동일 대상).
    let merged: Uint32Array | null = null;
    if (frontIndex && backIndex) {
      merged = new Uint32Array(frontIndex.length + backIndex.length);
      merged.set(frontIndex, 0);
      merged.set(backIndex, frontIndex.length);
    } else {
      merged = frontIndex ?? backIndex;
    }
    sdfPushField = bake(merged, "밀어내기/팔제외");
  }
}

// M2-3: BVH 면 법선 밀어내기(meshResolver) 대신 SDF 기울기 밀어내기.
// 나머지 스테이지(토르소/팔 캡슐, sidedness)는 createUnifiedResolver가
// 그대로 담당하므로 mesh 자리만 바꿔 끼운다.
const sdfPushResolver = createPanelSplitResolver(
  [
    createSdfPushResolver(() => sdfPushField, COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, SDF_PUSH_RELAXATION, meshColumnRange),
    createSdfPushResolver(() => sdfPushField, COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, SDF_PUSH_RELAXATION, meshColumnRange),
    null,
    null,
  ],
  PANEL_COUNTS,
);
const sdfUnifiedResolver = createUnifiedResolver(sdfPushResolver, collisionState);

const frictionPass = createSdfFrictionPass(() => sdfField, {
  contactBand: FRICTION_CONTACT_BAND,
  muStatic: FRICTION_MU_STATIC,
  muKinetic: FRICTION_MU_KINETIC,
});

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
      const built = buildUnifiedGarmentSim(
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
        msg.newCore ?? false,
      );
      sim = built.sim;


      {
        const panelStarts: number[] = [];
        const panelCols: number[] = [];
        for (let p = 0; p < sim.panels; p++) {
          panelStarts.push(sim.panelParticleStart(p));
          panelCols.push(sim.panelDims[p].cols);
        }
        selfCollisionResolver = new SelfCollision(panelStarts, panelCols, armholeStartRow, built.seamSkipPairs).createResolver(SELF_COLLISION_MIN_DIST);
      }

      // M0: 워커의 기존 시퀀스를 그대로 재현하는 환경 — 토글 전부 on,
      // clamp는 서브스텝 안(기존 위치). columnRange는 meshResolver와 공유하는
      // 살아있는 객체라 세션이 매 스텝 갱신하면 리졸버가 최신 값을 본다.
      // M2: 마찰은 신 코어 경로에서만(구 코어는 비트 동일 유지). 레이아웃이
      // 바뀌면 굽기 범위도 달라지므로 여기서 무효화한다.
      sdfFrictionEnabled = (msg.newCore ?? false) && (msg.friction ?? true);
      // M2-3 원복: SDF 밀어내기는 하드 실패(앞뒤판 실제 교차 31~36개
      // 발생, coverage +10.8pp). 원인은 마네킹 메시의 삼각형 와인딩 불일치
      // — signedClearance가 면 법선 내적으로 부호를 정하므로 그 영역에서
      // 부호가 뒤집힌 필드가 구워지고, 기울기가 몸 안쪽을 가리켜 파티클을
      // 관통시킨다(같은 와인딩 문제를 coverageMetric에서 이미 실측해
      // 방사방향 교정으로 우회한 전례가 있다). 부호 결정을 와인딩에
      // 의존하지 않는 방식으로 바꾸기 전엔 켜지 말 것.
      // 부수 확인: ripple mean이 3.22→3.21(팔제외)/2.98(팔포함)로 거의
      // 불변 — **잔물결 원인은 BVH 면 법선 튐이 아니다**. ②(스무딩 제거)의
      // 전제가 이 측정으로 기각됐다.
      sdfPushEnabled = false;
      // M2 보정 제거 ①: 신 코어에선 sidedness 클램프를 끄고 SDF/마찰에 맡긴다.
      collisionState.sidedness = !(msg.newCore ?? false);
      sdfField = null;
      sdfPushField = null;
      session = createGarmentSession(sim, {
        collisionResolver: sdfPushEnabled ? sdfUnifiedResolver : unifiedResolver,
        collisionEvery: COLLISION_EVERY,
        selfCollision: (positions, pinned, n) => selfCollisionResolver!(positions, pinned, n),
        orderPasses: true,
        clampInSubstep: true,
        // M2 보정 제거 ②: 원복됨. 스무딩을 끄면 ripple mean이 3.22→5.95
        // (+85%)로 튀었다 — B-1 실패값(5.03)보다도 나쁘다. 전제("SDF가
        // 잔물결 발생원을 없앴다")가 아직 성립 안 하는 게 원인: 밀어내기는
        // 여전히 BVH 면 법선을 쓰고 SDF는 마찰 접촉에만 쓰인다. 밀어내기를
        // SDF로 교체한 뒤 재시도할 것.
        smoothing: true,
        postOrder: true,
        armSoftPull: true,
        necklineHug: true,
        sleeveArmPull: true,
        yAlign: true,
        symmetry: true,
        clampAfterPost: false,
        maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
        columnRange: meshColumnRange,
        friction: sdfFrictionEnabled ? frictionPass : undefined,
      });

      // 범위 B 구현 1번(격자 생성) 검증용 — buildConstraints()/step() 이전
      // 순수 초기 배치를 그대로 echo. "init"마다 한 번만.
      {
        const frontCount = sim.panelParticleCount(PANEL_FRONT);
        const backCount = sim.panelParticleCount(PANEL_BACK);
        const sleeveCount = sim.panelParticleCount(PANEL_SLEEVE_LEFT);
        const frontStart = sim.panelParticleStart(PANEL_FRONT) * 3;
        const backStart = sim.panelParticleStart(PANEL_BACK) * 3;
        const sleeveLeftStart = sim.panelParticleStart(PANEL_SLEEVE_LEFT) * 3;
        const sleeveRightStart = sim.panelParticleStart(PANEL_SLEEVE_RIGHT) * 3;
        const front = sim.positions.slice(frontStart, frontStart + frontCount * 3);
        const back = sim.positions.slice(backStart, backStart + backCount * 3);
        const sleeveLeft = sim.positions.slice(sleeveLeftStart, sleeveLeftStart + sleeveCount * 3);
        const sleeveRight = sim.positions.slice(sleeveRightStart, sleeveRightStart + sleeveCount * 3);
        ctx.postMessage(
          {
            type: "gridDebug",
            front,
            back,
            sleeveLeft,
            sleeveRight,
            panelParticleStart: [
              sim.panelParticleStart(PANEL_FRONT),
              sim.panelParticleStart(PANEL_BACK),
              sim.panelParticleStart(PANEL_SLEEVE_LEFT),
              sim.panelParticleStart(PANEL_SLEEVE_RIGHT),
            ],
            panelParticleCount: [
              frontCount,
              backCount,
              sim.panelParticleCount(PANEL_SLEEVE_LEFT),
              sim.panelParticleCount(PANEL_SLEEVE_RIGHT),
            ],
          },
          [front.buffer, back.buffer, sleeveLeft.buffer, sleeveRight.buffer],
        );
      }
      break;
    }
    case "rebuildCollision": {
      frontCollisionMesh.rebuild(msg.position, msg.frontIndex);
      backCollisionMesh.rebuild(msg.position, msg.backIndex);
      wholeBodyCollisionMesh.rebuild(msg.position, msg.wholeBodyIndex);
      collisionState.torsoCapsules = msg.capsules;
      collisionState.centerZ = msg.centerZ;
      // M2: 몸이 바뀌었으니 SDF 재굽기(다음 step에서 ensureSdf가 처리).
      bakedBody = { position: msg.position, wholeBodyIndex: msg.wholeBodyIndex, frontIndex: msg.frontIndex, backIndex: msg.backIndex };
      sdfField = null;
      sdfPushField = null;
      break;
    }
    case "step": {
      if (!sim || !session || !lastLayout) return;
      const activeSim = sim;
      const armLeft = toArmDir(msg.armLeft);
      const armRight = toArmDir(msg.armRight);
      collisionState.armCapsules = [...buildArmCapsules(msg.armLeft), ...buildArmCapsules(msg.armRight)];

      const preset = FABRIC_PRESETS[msg.fabric];
      // rebuildCollision은 REBUILD_DEBOUNCE_MS(200ms) 디바운스 + 메인
      // 스레드에서의 충돌 메시 굽기(StaticGeometryGenerator, CPU 비용)를
      // 거쳐야 도착한다 — 그 사이엔 frontCollisionMesh/backCollisionMesh
      // (BVH)와 torsoCapsules가 전부 비어 있어(ArrayBvhCollision.ready가
      // false거나 capsules=[]) unifiedResolver가 사실상 아무 일도 안 한다.
      // 충돌 메시가 아직 준비 안 됐으면 중력을 꺼서(구조 제약과 핀만으로
      // 유지) 이 구간에서 옷감이 무너지지 않게 막는다.
      ensureSdf();
      const collisionReady = frontCollisionMesh.ready && backCollisionMesh.ready;
      scratchGravity.copy(collisionReady ? gravityBase : ZERO_VEC3).multiplyScalar(preset.gravityScale);

      // M0: 핀→열범위 갱신→서브스텝 루프(충돌/자체충돌/순서/clamp)→후처리
      // (스무딩/order/소프트풀/hug/sleevePull/yAlign/symmetry/order) 전체가
      // garmentFrame.ts의 세션으로 이사 — 순서·경위 주석도 그쪽 참고.
      session.step(
        msg.dt,
        scratchGravity,
        preset,
        lastLayout,
        { pinLeft: msg.pinLeft, pinRight: msg.pinRight, armLeft, armRight, necklineLift: msg.necklineLift },
      );

      const ppp = activeSim.panelParticleCount(PANEL_FRONT);
      const frontStart = activeSim.panelParticleStart(PANEL_FRONT) * 3;
      const backStart = activeSim.panelParticleStart(PANEL_BACK) * 3;
      const front = activeSim.positions.slice(frontStart, frontStart + ppp * 3);
      const back = activeSim.positions.slice(backStart, backStart + ppp * 3);
      // 핏 맵(물리 무관, 순수 조회) — 방금 확정된 이번 프레임 위치를 그대로 재사용한다.
      const frontFit = computeFitCm(front, ppp);
      const backFit = computeFitCm(back, ppp);
      const sleeveCount = activeSim.panelParticleCount(PANEL_SLEEVE_LEFT);
      const sleeveLeftStart = activeSim.panelParticleStart(PANEL_SLEEVE_LEFT) * 3;
      const sleeveRightStart = activeSim.panelParticleStart(PANEL_SLEEVE_RIGHT) * 3;
      const sleeveLeft = activeSim.positions.slice(sleeveLeftStart, sleeveLeftStart + sleeveCount * 3);
      const sleeveRight = activeSim.positions.slice(sleeveRightStart, sleeveRightStart + sleeveCount * 3);
      ctx.postMessage(
        { type: "positions", front, back, frontFit, backFit, sleeveLeft, sleeveRight, generation: msg.generation },
        [front.buffer, back.buffer, frontFit.buffer, backFit.buffer, sleeveLeft.buffer, sleeveRight.buffer],
      );
      break;
    }
  }
};
