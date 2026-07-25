// 46번(전면 재설계) 이후 실측으로 두 번 잡은 회귀를 다시 자동으로 잡기
// 위한 체크: 소매 열(핀 없음)이 물리를 몇 초 돌린 뒤에도 0번 행(어깨선)
// 에서 앞판/뒤판이 크게 벌어지지 않는지 확인한다. 사람이 스크린샷을 보고
// "찢어졌다"고 알아채기 전에, 이 스크립트가 먼저 잡아준다.
//
// 실제 마네킹 BVH 메시 충돌은 뺐다(Node에 GLTF/DOM이 없어 굽기 자체가
// 불가능) — 이 불변식(앞판/뒤판 정렬)은 중력+구조 제약+소프트 풀만으로도
// 재현되는 문제였으므로, 메시 충돌 없이도 유효한 회귀 테스트다.
// ponytail: 프레임워크 없는 assert 기반 단발 스크립트. garmentWorker.ts의
// 실제 스텝 루프와 완전히 동일하진 않다(어깨 표면 스냅·자체충돌·스무딩
// 등은 뺐다) — 필요해지면 워커의 스텝 로직을 재사용 가능한 함수로 뽑아
// 여기서 그대로 불러쓰는 쪽으로 업그레이드.
import * as THREE from "three";
import { applyArmSoftPull, applyNecklineHug, enforceArmFrontBackYAlignment, pinCorners, type ArmDir } from "../src/lib/buildGarmentSim";
import { buildUnifiedGarmentSim } from "../src/lib/buildUnifiedGarmentSim";
import { applyCapsuleCollision } from "../src/lib/torsoCapsule";
import { COLS, GRAVITY_BASE, PANEL_BACK, PANEL_FRONT, SUBSTEP_DT } from "../src/lib/clothConfig";
import { FABRIC_PRESETS } from "../src/lib/fabricPresets";
import type { Vec3Like } from "../src/lib/clothProtocol";

// 실측 디버그 로그(이 세션 중 __fitDebug로 뽑은 실제 값)에서 가져온 대표
// 포즈 — 반팔 기본값(소매길이 22cm), 어깨너비 45cm 기준.
const pinLeft: Vec3Like = { x: 0.2949635589615682, y: 1.4303697606877606, z: -0.029242269962628405 };
const pinRight: Vec3Like = { x: -0.29496387086321113, y: 1.4303699362752509, z: -0.02649089672959644 };
const trueShoulderLeft: Vec3Like = { x: 0.17996480968877532, y: 1.3753697949162789, z: -0.02870592521141842 };
const trueShoulderRight: Vec3Like = { x: -0.17996512159041828, y: 1.3753699020467327, z: -0.027027241480806423 };
const dirLeft: Vec3Like = { x: 0.5599594528223114, y: -0.8272282597138395, z: 0.046247351553900105 };
const dirRight: Vec3Like = { x: -0.5600986940919868, y: -0.8270393076300492, z: 0.04791071395063927 };
const SLEEVE_LENGTH_M = 0.22;
const SLEEVE_WIDTH_M = 0.18; // UI 기본값(소매통 18cm)과 동일
const armLeft: ArmDir = { dir: dirLeft, length: SLEEVE_LENGTH_M };
const armRight: ArmDir = { dir: dirRight, length: SLEEVE_LENGTH_M };

const widthM = 0.55;
const heightM = 0.7;
const topY = Math.max(pinLeft.y, pinRight.y);
const centerZ = (pinLeft.z + pinRight.z) / 2;

function buildArmCapsules(trueShoulder: Vec3Like, dir: Vec3Like, length: number) {
  const midLength = length * 0.55;
  const endLength = length * 1.25;
  const mid = { x: trueShoulder.x + dir.x * midLength, y: trueShoulder.y + dir.y * midLength, z: trueShoulder.z + dir.z * midLength };
  const end = { x: trueShoulder.x + dir.x * endLength, y: trueShoulder.y + dir.y * endLength, z: trueShoulder.z + dir.z * endLength };
  return [
    { top: trueShoulder, bottom: mid, radius: 0.065 },
    { top: mid, bottom: end, radius: 0.065 },
  ];
}

const { sim: simInstance } = buildUnifiedGarmentSim(widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, SLEEVE_WIDTH_M);

const preset = FABRIC_PRESETS.cotton;
const gravity = new THREE.Vector3(...GRAVITY_BASE).multiplyScalar(preset.gravityScale);
const armCapsules = [...buildArmCapsules(trueShoulderLeft, dirLeft, SLEEVE_LENGTH_M), ...buildArmCapsules(trueShoulderRight, dirRight, SLEEVE_LENGTH_M)];
const resolver = (positions: Float32Array, pinned: Uint8Array, n: number) => {
  applyCapsuleCollision(positions, pinned, n, armCapsules, 0.006);
};

const SECONDS = 3;
const FRAMES = Math.round(SECONDS / SUBSTEP_DT);
for (let f = 0; f < FRAMES; f++) {
  pinCorners(simInstance, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight);
  simInstance.step(SUBSTEP_DT, gravity, resolver, preset.iterations, 3, preset.damping, 0.05);
  applyArmSoftPull(simInstance, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, SLEEVE_WIDTH_M);
  applyNecklineHug(simInstance, PANEL_FRONT, PANEL_BACK, widthM, centerZ, pinLeft, pinRight, armLeft, armRight);
  enforceArmFrontBackYAlignment(simInstance, PANEL_FRONT, PANEL_BACK, pinLeft, pinRight, armLeft, armRight);
  simInstance.clampOverstretchedConstraints();
}

// 소매 열(핀 없는 바깥쪽) 전체에서 0번 행 앞/뒤판 Y차이의 최댓값을 잰다.
const MAX_ALLOWED_Y_GAP_M = 0.025; // 2.5cm — 과거 버그(5cm)는 확실히 걸러내고, 현재 관측치(~1.5cm)는 통과.
// 46번 실측(버그, 두 번): 처음엔 0번 행만 스캔해서 회귀를 놓쳤고, 그
// 다음엔 ARM_ROWS(12)까지만 스캔해서 그 바로 다음 경계 행(13)의 누수를
// 놓쳤다 — enforceArmFrontBackYAlignment가 ARM_ROWS+버퍼(4)까지 보정하는
// 것과 맞춰, 그 버퍼까지 포함해서 스캔한다.
let maxGap = 0;
let maxGapX = -1;
let maxGapY = -1;
for (let y = 0; y <= 16; y++) {
  for (let x = 0; x < COLS; x++) {
    const fi = simInstance.index(PANEL_FRONT, x, y) * 3;
    const bi = simInstance.index(PANEL_BACK, x, y) * 3;
    const gap = Math.abs(simInstance.positions[fi + 1] - simInstance.positions[bi + 1]);
    if (gap > maxGap) {
      maxGap = gap;
      maxGapX = x;
      maxGapY = y;
    }
  }
}

let hasNaN = false;
for (let i = 0; i < simInstance.positions.length; i++) {
  if (!Number.isFinite(simInstance.positions[i])) {
    hasNaN = true;
    break;
  }
}

console.log(`[checkSleeveSeam] ${FRAMES}프레임(${SECONDS}s) 시뮬레이션 후 0~16번 행 앞/뒤판 최대 Y차이: ${(maxGap * 100).toFixed(2)}cm (행 y=${maxGapY}, 열 x=${maxGapX})`);

if (hasNaN) {
  console.error("[checkSleeveSeam] FAIL: 위치 배열에 NaN/Infinity 발생 — 시뮬레이션이 발산함.");
  process.exit(1);
}
if (maxGap > MAX_ALLOWED_Y_GAP_M) {
  console.error(`[checkSleeveSeam] FAIL: 최대 Y차이 ${(maxGap * 100).toFixed(2)}cm > 허용치 ${(MAX_ALLOWED_Y_GAP_M * 100).toFixed(1)}cm — 목선/소매 경계가 찢어지는 회귀로 보임.`);
  process.exit(1);
}
console.log("[checkSleeveSeam] PASS");
