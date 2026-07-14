import { ClothSimulation } from "./clothPhysics";
import type { PanelDims } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { addTorsoSideSeamConstraints, layoutTorsoPanels, pinCorners } from "./buildGarmentSim";
import { addSleeveWrapConstraints, layoutSleevePanels } from "./buildSleeveSim";
import type { SleeveShape } from "./buildSleeveSim";
import { addArmholeSeamConstraints } from "./garmentStitch";
import {
  ARMHOLE_ROW_FRACTION,
  COLS,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  ROWS,
  SLEEVE_COLS,
} from "./clothConfig";

// 30번(진짜 물리적 병합): 몸판(앞/뒤)과 소매(좌/우)를 하나의
// ClothSimulation 인스턴스에 4개 패널로 함께 짓는다. 각 패널을 배치하고
// (layoutTorsoPanels/layoutSleevePanels), 그 자리를 기준으로 격자 내부
// 제약을 전부 한 번에 만든 뒤(buildConstraints — 이 시점의 위치가 각
// 제약의 "자연 길이"가 된다), 패널 사이를 잇는 제약(옆선 시접, 소매
// 이음매, 그리고 새로 추가된 진짜 재봉선인 암홀 시접)을 얹고, 마지막으로
// 어깨선을 고정한다. 이 순서(배치 → buildConstraints → 부가 제약 → 고정)
// 는 buildGarmentSim.ts/buildSleeveSim.ts의 예전 버전과 동일한 순서를
// 유지한다 — 순서가 바뀌면 rest length가 잘못된 기준(예: 아직 안 놓인
// 위치)으로 계산될 수 있다.
export function buildUnifiedGarmentSim(
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  sleeveRows: number,
  sleeveLeft: SleeveShape,
  sleeveRight: SleeveShape,
): ClothSimulation {
  const panelDims: PanelDims[] = [
    { cols: COLS, rows: ROWS }, // PANEL_FRONT
    { cols: COLS, rows: ROWS }, // PANEL_BACK
    { cols: SLEEVE_COLS, rows: sleeveRows }, // PANEL_SLEEVE_LEFT
    { cols: SLEEVE_COLS, rows: sleeveRows }, // PANEL_SLEEVE_RIGHT
  ];
  const sim = new ClothSimulation(panelDims);

  layoutTorsoPanels(sim, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight);
  layoutSleevePanels(sim, PANEL_SLEEVE_LEFT, PANEL_SLEEVE_RIGHT, sleeveRows, sleeveLeft, sleeveRight);

  sim.buildConstraints();

  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  addTorsoSideSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, armholeStartRow);
  addSleeveWrapConstraints(sim, PANEL_SLEEVE_LEFT, PANEL_SLEEVE_RIGHT, sleeveRows);
  // 몸판 x=0 열은 소매 왼쪽 패널과, x=COLS-1 열은 소매 오른쪽 패널과
  // 짝짓는다(이 코드베이스 전반에서 쓰인 기존 관례 — torsoBoundaryPositions
  // 등 이전 코드에서도 동일했다).
  addArmholeSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_LEFT, 0, armholeStartRow);
  addArmholeSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_RIGHT, COLS - 1, armholeStartRow);

  pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK);

  return sim;
}

// "반팔↔긴팔 전환"처럼 소매만 바뀌었을 때, 몸판은 처음부터 다시 짓되(그래야
// 위 buildUnifiedGarmentSim의 buildConstraints가 올바른 rest length를
// 계산한다) 그 직후 몸판 범위(앞+뒤판)의 실제 위치/속도/핀 상태를 기존에
// 돌고 있던 시뮬레이션 것으로 덮어써서, 화면상 몸판이 이미 자연스럽게
// 늘어져 있던 상태를 그대로 이어간다 — 16번 항목에서 겪은 "소매 종류만
// 바꿔도 몸판이 평평한 미착용 상태로 순간 리셋되는" 회귀를 다시 만들지
// 않기 위함이다. 소매 범위는 항상 새로 배치된 상태(무착용 초기 자세)로
// 시작한다 — 소매 종류가 바뀌면 소매는 물리적으로 다른 옷이므로 당연하다.
export function rebuildWithNewSleeve(
  oldSim: ClothSimulation,
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  sleeveRows: number,
  sleeveLeft: SleeveShape,
  sleeveRight: SleeveShape,
): ClothSimulation {
  const pinLeft = readPinnedCorner(oldSim, PANEL_FRONT, 0);
  const pinRight = readPinnedCorner(oldSim, PANEL_FRONT, COLS - 1);
  const newSim = buildUnifiedGarmentSim(
    widthM,
    heightM,
    topY,
    centerZ,
    pinLeft,
    pinRight,
    sleeveRows,
    sleeveLeft,
    sleeveRight,
  );

  const torsoParticleCount = newSim.panelParticleStart(PANEL_SLEEVE_LEFT);
  newSim.positions.set(oldSim.positions.subarray(0, torsoParticleCount * 3));
  newSim.prevPositions.set(oldSim.prevPositions.subarray(0, torsoParticleCount * 3));
  newSim.pinned.set(oldSim.pinned.subarray(0, torsoParticleCount));

  return newSim;
}

function readPinnedCorner(sim: ClothSimulation, panel: number, x: number): Vec3Like {
  const i = sim.index(panel, x, 0) * 3;
  return { x: sim.positions[i], y: sim.positions[i + 1], z: sim.positions[i + 2] };
}
