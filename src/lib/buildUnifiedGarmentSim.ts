import { ClothSimulation } from "./clothPhysics";
import type { PanelDims } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import type { ArmDir } from "./buildGarmentSim";
import {
  addNecklineSeamConstraints,
  addSleeveUnderarmSeamConstraints,
  addTorsoSideSeamConstraints,
  applyShoulderRollStiffness,
  layoutTorsoPanels,
  pinCorners,
  relaxSleeveStiffness,
} from "./buildGarmentSim";
import { ARMHOLE_ROW_FRACTION, COLS, PANEL_BACK, PANEL_FRONT, ROWS } from "./clothConfig";

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
  ];
  const sim = new ClothSimulation(panelDims);

  layoutTorsoPanels(sim, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);

  sim.buildConstraints();
  relaxSleeveStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);
  applyShoulderRollStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);

  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  addNecklineSeamConstraints(sim, PANEL_FRONT, PANEL_BACK);
  addTorsoSideSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, armholeStartRow, pinLeft, pinRight, armLeft, armRight);
  addSleeveUnderarmSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, widthM, pinLeft, pinRight, armLeft, armRight);

  pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, necklineLift);

  return sim;
}
