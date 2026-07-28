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
  STIFFNESS_BEND,
  STIFFNESS_SEAM,
  STIFFNESS_SHEAR,
  STIFFNESS_STRUCTURAL,
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
  // M1(신 코어): 암홀 링 시접(레이아웃이 정확히 겹치게 배치해둔 24쌍 —
  // 중간 10쌍 실측 0.00mm)을 rest 6mm 제약 대신 정점 용접으로 전환.
  // 어깨선(necklineRise 앞뒤 차 0~8mm)·옆선(6mm)·이즈인은 의도된 간격이라
  // 용접 대상이 아니다(과제 실측 결론).
  newCore = false,
): { sim: ClothSimulation; seamSkipPairs: ReadonlyArray<{ a: number; b: number }> } {
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
  layoutSleevePanel(sim, PANEL_SLEEVE_LEFT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, leftArmholeVertex, armLeft, sleeveWidthM);
  layoutSleevePanel(sim, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS, rightArmholeVertex, armRight, sleeveWidthM);

  sim.buildConstraints();
  // 드레이프 개선 A-②: 종류별 목표 강성(clothConfig.ts 주석 참고).
  sim.setKindTargetStiffness(STIFFNESS_STRUCTURAL, STIFFNESS_SHEAR, STIFFNESS_BEND, STIFFNESS_SEAM);
  relaxSleeveStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);
  applyShoulderRollStiffness(sim, widthM, pinLeft, pinRight, armLeft, armRight);

  addNecklineSeamConstraints(sim, PANEL_FRONT, PANEL_BACK);
  addTorsoSideSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, armholeStartRow, pinLeft, pinRight, armLeft, armRight);
  addSleeveUnderarmSeamConstraints(sim, PANEL_FRONT, PANEL_BACK, widthM, pinLeft, pinRight, armLeft, armRight);

  // 범위 B 구현 4번(봉제선 연결): 몸판 암홀 ↔ 새 독립 소매 패널, 소매 링
  // wrap. armholeStartRow/xMin/xMax는 위에서 소매 배치할 때 이미 계산해둔
  // 값을 그대로 재사용한다(같은 규약 — 새 경계를 발명하지 않음).
  //
  // 톱니 결함 조사(docs/sleeve-redesign-B.md): 이 두 함수가 잇는 쌍(암홀
  // 12×2팔 + wrap 12×2팔 = 48쌍)은 자체충돌(selfCollision.ts)의 두 예외
  // 규칙(같은 패널 UV 근접/몸판↔몸판 어깨 시접) 어디에도 안 걸린다 —
  // 특히 소매 wrap(k=11↔k=0)은 같은 패널이지만 UV거리가 커서(11>2) 안
  // 걸리고, 암홀 쪽도 서로 다른 패널(몸판↔소매)이라 안 걸린다. 이 구간
  // 앞뒤로 constraints 배열을 슬라이스해 정확히 이 48쌍만 골라
  // SelfCollision에 세 번째 예외로 넘긴다.
  const seamSkipStart = sim.constraintPairs.length;
  addSleeveArmholeSeam(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_LEFT, xMin, armholeStartRow);
  addSleeveArmholeSeam(sim, PANEL_FRONT, PANEL_BACK, PANEL_SLEEVE_RIGHT, xMax, armholeStartRow);
  // M1: addSleeveArmholeSeam이 등록한 쌍(a=몸판, b=소매 row0)이 곧 용접
  // 테이블 — 같은 출처를 재사용해 wrap 순서 3중 동기화를 늘리지 않는다.
  const armholeWeldPairs = sim.constraintPairs.slice(seamSkipStart).map(({ a, b }) => ({ canon: a, alias: b }));
  addSleeveWrapConstraint(sim, PANEL_SLEEVE_LEFT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
  addSleeveWrapConstraint(sim, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
  const seamSkipPairs = sim.constraintPairs.slice(seamSkipStart).map(({ a, b }) => ({ a, b }));

  if (newCore) sim.applyWelds(armholeWeldPairs);

  pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight, necklineLift);
  // pinCorners가 row0(코너 canon 포함)을 재배치하므로 용접 좌표를 다시
  // 맞춘다 — 구 코어에선 빈 루프.
  sim.syncWeldedPositions();

  // M2-6: row0 닫힌 링(앞판 xMin..xMax → 뒤판 역순 → 복귀). pinCorners
  // 이후에 구성해야 레스트가 "설계 목선 원주"가 된다(정찰 실측 96.2cm).
  {
    const ring: { a: number; b: number }[] = [];
    for (let x = xMin; x < xMax; x++) ring.push({ a: sim.index(PANEL_FRONT, x, 0), b: sim.index(PANEL_FRONT, x + 1, 0) });
    ring.push({ a: sim.index(PANEL_FRONT, xMax, 0), b: sim.index(PANEL_BACK, xMax, 0) });
    for (let x = xMax; x > xMin; x--) ring.push({ a: sim.index(PANEL_BACK, x, 0), b: sim.index(PANEL_BACK, x - 1, 0) });
    ring.push({ a: sim.index(PANEL_BACK, xMin, 0), b: sim.index(PANEL_FRONT, xMin, 0) });
    sim.setCollarRing(ring);
  }

  return { sim, seamSkipPairs };
}
