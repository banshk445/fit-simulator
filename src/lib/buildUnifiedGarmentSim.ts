import { ClothSimulation } from "./clothPhysics";
import type { PanelDims } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import type { ArmDir } from "./buildGarmentSim";
import {
  addNecklineSeamConstraints,
  addSleeveArmholeSeam,
  addSleeveUnderarmSeamConstraints,
  addSleeveWrapConstraint,
  addTorsoSideSeamConstraints,
  applyShoulderRollStiffness,
  armholeRingVertices,
  layoutSleevePanel,
  layoutTorsoPanels,
  pinCorners,
  relaxSleeveStiffness,
  torsoColumnRange,
} from "./buildGarmentSim";
import {
  ARMHOLE_ROW_FRACTION,
  COLS,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  ROWS,
  SLEEVE_RING_COLS,
  SLEEVE_RING_ROWS,
} from "./clothConfig";

// 46번(전면 재설계 — 통합 단일 패널): 소매가 더 이상 별도 패널이 아니라
// 몸판(앞/뒤) 자체의 넓은 바깥쪽 열이므로, 이제 패널은 2개(앞/뒤)뿐이다 —
// 예전에 여기 있던 소매 패널 레이아웃/재봉/링 핀 호출은 전부 필요 없다.
export function buildUnifiedGarmentSim(
  widthM: number,
  heightM: number,
  topY: number,
  centerZ: number,
  pinLeft: Vec3Like,
  pinRight: Vec3Like,
  armLeft: ArmDir,
  armRight: ArmDir,
  sleeveWidthM: number,
  necklineLift?: readonly number[],
): ClothSimulation {
  const panelDims: PanelDims[] = [
    { cols: COLS, rows: ROWS }, // PANEL_FRONT
    { cols: COLS, rows: ROWS }, // PANEL_BACK
    { cols: SLEEVE_RING_COLS, rows: SLEEVE_RING_ROWS }, // PANEL_SLEEVE_LEFT
    { cols: SLEEVE_RING_COLS, rows: SLEEVE_RING_ROWS }, // PANEL_SLEEVE_RIGHT
  ];
  const sim = new ClothSimulation(panelDims);

  layoutTorsoPanels(sim, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);

  // 범위 B(소매 재설계 — 별도 패널, 구현 1번: 격자 생성). 몸판 암홀
  // 가장자리(xMin=왼팔 쪽, xMax=오른팔 쪽 — layoutTorsoPanels가 u<0을
  // armLeft로 놓는 것과 같은 규약)를 뽑아 소매 링을 압출 배치한다.
  // buildConstraints() 이전에 해야 한다 — 그게 현재 positions로 rest
  // length를 굳히므로.
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const { xMin, xMax } = torsoColumnRange(COLS, pinLeft, pinRight, armLeft, armRight);
  const leftArmholeVertex = armholeRingVertices(sim, PANEL_FRONT, PANEL_BACK, xMin, armholeStartRow);
  const rightArmholeVertex = armholeRingVertices(sim, PANEL_FRONT, PANEL_BACK, xMax, armholeStartRow);
  layoutSleevePanel(sim, PANEL_SLEEVE_LEFT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, leftArmholeVertex, armLeft);
  layoutSleevePanel(sim, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, rightArmholeVertex, armRight);

  sim.buildConstraints();
  relaxSleeveStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);
  applyShoulderRollStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);

  addNecklineSeamConstraints(sim, PANEL_FRONT, PANEL_BACK);
  addTorsoSideSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, armholeStartRow, pinLeft, pinRight, armLeft, armRight);
  addSleeveUnderarmSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, widthM, pinLeft, pinRight, armLeft, armRight);

  // 범위 B 구현 4번(봉제선 연결): 몸판 암홀 ↔ 새 독립 소매 패널, 소매 링
  // wrap. armholeStartRow/xMin/xMax는 위에서 소매 배치할 때 이미 계산해둔
  // 값을 그대로 재사용한다(같은 규약 — 새 경계를 발명하지 않음).
  addSleeveArmholeSeam(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_LEFT, xMin, armholeStartRow);
  addSleeveArmholeSeam(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_RIGHT, xMax, armholeStartRow);
  addSleeveWrapConstraint(sim, PANEL_SLEEVE_LEFT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
  addSleeveWrapConstraint(sim, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);

  pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, necklineLift);

  return sim;
}
