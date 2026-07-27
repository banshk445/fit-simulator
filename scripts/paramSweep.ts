// 파라미터(품/소매통) 조합을 자동으로 돌려 관통량/봉제선 갭/톱니를 한
// 표로 뽑는다. checkSleeveSeam.ts와 같은 방식(마네킹 BVH 메시 충돌은
// Node에 GLTF/DOM이 없어 뺌 — 팔 캡슐 충돌만 재현) — 회귀 하나만 보는
// assert 스크립트와 달리 여러 조합을 한 번에 비교해 "어디서부터 나빠지는지"
// 찾는 탐색 도구다.
// ponytail: 조합 그리드는 아래 WIDTHS_M/SLEEVE_WIDTHS_M 배열을 직접 고쳐라
// (CLI 파싱 없음 — 필요해지면 추가).
import * as THREE from "three";
import {
  applyArmSoftPull,
  applyNecklineHug,
  armholeRingVertices,
  enforceArmFrontBackYAlignment,
  pinCorners,
  torsoColumnRange,
  type ArmDir,
} from "../src/lib/buildGarmentSim";
import { buildUnifiedGarmentSim } from "../src/lib/buildUnifiedGarmentSim";
import { applyCapsuleCollision, type Capsule } from "../src/lib/torsoCapsule";
import {
  ARM_ROWS,
  ARMHOLE_ROW_FRACTION,
  COLS,
  GRAVITY_BASE,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  ROWS,
  SLEEVE_RING_COLS,
  SLEEVE_RING_ROWS,
  SUBSTEP_DT,
} from "../src/lib/clothConfig";
import { FABRIC_PRESETS } from "../src/lib/fabricPresets";
import type { Vec3Like } from "../src/lib/clothProtocol";
import { ringJaggedness } from "../src/lib/seamDiagnostics";

// 대표 포즈 — checkSleeveSeam.ts와 같은 출처(이 세션 __fitDebug 실측), 반팔
// 기본값(소매길이 22cm), 어깨너비 45cm 기준.
const pinLeft: Vec3Like = { x: 0.2949635589615682, y: 1.4303697606877606, z: -0.029242269962628405 };
const pinRight: Vec3Like = { x: -0.29496387086321113, y: 1.4303699362752509, z: -0.02649089672959644 };
const trueShoulderLeft: Vec3Like = { x: 0.17996480968877532, y: 1.3753697949162789, z: -0.02870592521141842 };
const trueShoulderRight: Vec3Like = { x: -0.17996512159041828, y: 1.3753699020467327, z: -0.027027241480806423 };
const dirLeft: Vec3Like = { x: 0.5599594528223114, y: -0.8272282597138395, z: 0.046247351553900105 };
const dirRight: Vec3Like = { x: -0.5600986940919868, y: -0.8270393076300492, z: 0.04791071395063927 };
const SLEEVE_LENGTH_M = 0.22;
const heightM = 0.7;
const topY = Math.max(pinLeft.y, pinRight.y);
const centerZ = (pinLeft.z + pinRight.z) / 2;

// 조합 그리드 — 오늘 조사(pattern-redesign.md)에서 다룬 두 축(품/소매통).
const WIDTHS_M = [0.5, 0.55, 0.6, 0.65];
const SLEEVE_WIDTHS_M = [0.14, 0.18, 0.22];
const SECONDS = 3;
const FRAMES = Math.round(SECONDS / SUBSTEP_DT);

function buildArmCapsules(trueShoulder: Vec3Like, dir: Vec3Like, length: number): Capsule[] {
  const midLength = length * 0.55;
  const endLength = length * 1.25;
  const mid = { x: trueShoulder.x + dir.x * midLength, y: trueShoulder.y + dir.y * midLength, z: trueShoulder.z + dir.z * midLength };
  const end = { x: trueShoulder.x + dir.x * endLength, y: trueShoulder.y + dir.y * endLength, z: trueShoulder.z + dir.z * endLength };
  return [
    { top: trueShoulder, bottom: mid, radius: 0.065 },
    { top: mid, bottom: end, radius: 0.065 },
  ];
}

// 캡슐 표면까지 여유(mm, 음수=관통) — Garment.tsx armCapsuleRowCheck와 같은 공식(margin=6mm).
function capsuleClearanceMm(p: Vec3Like, capsules: readonly Capsule[]): number {
  let best = Infinity;
  for (const c of capsules) {
    const abx = c.bottom.x - c.top.x;
    const aby = c.bottom.y - c.top.y;
    const abz = c.bottom.z - c.top.z;
    const abLenSq = abx * abx + aby * aby + abz * abz;
    const apx = p.x - c.top.x;
    const apy = p.y - c.top.y;
    const apz = p.z - c.top.z;
    const t = abLenSq > 1e-9 ? THREE.MathUtils.clamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1) : 0;
    const cx = c.top.x + abx * t;
    const cy = c.top.y + aby * t;
    const cz = c.top.z + abz * t;
    const dist = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
    const clearance = dist - (c.radius + 0.006);
    if (clearance < best) best = clearance;
  }
  return best * 1000;
}

// Garment.tsx의 frontGeometry/sleeveGeometryLeft 등과 같은 프록시 패턴 —
// PlaneGeometry에 현재 위치를 채워 넣고 computeVertexNormals()로 법선을
// 뽑는다(three는 DOM/WebGL 없이도 순수 기하 계산이 동작해 Node에서 그대로 씀).
function buildPanelNormals(sim: { index(panel: number, x: number, y: number): number; positions: Float32Array }, panel: number, cols: number, rows: number): THREE.BufferAttribute {
  const g = new THREE.PlaneGeometry(1, 1, cols - 1, rows - 1);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = sim.index(panel, x, y) * 3;
      pos.setXYZ(y * cols + x, sim.positions[i], sim.positions[i + 1], sim.positions[i + 2]);
    }
  }
  g.computeVertexNormals();
  return g.getAttribute("normal") as THREE.BufferAttribute;
}

function readNormal(attr: THREE.BufferAttribute, i: number): Vec3Like {
  return { x: attr.getX(i), y: attr.getY(i), z: attr.getZ(i) };
}

interface ComboResult {
  widthM: number;
  sleeveWidthM: number;
  diverged: boolean;
  maxPenetrationMm: number;
  maxSeamGapCm: number;
  maxJaggednessDeg: number;
  // 톱니가 몸판(암홀 링, 소매 무관)에서 오는지 소매 링에서 오는지 구분 —
  // pattern-redesign.md 4번(소매 전용 구현) 검증용 세부 지표.
  armholeJaggednessDeg: number;
  sleeveJaggednessDeg: number;
  // row0(캡)~row(SLEEVE_RING_ROWS-1)(소맷부리) 각 행의 최댓값(좌우 중 큰 쪽) —
  // sleeveJaggednessDeg는 이 배열의 최댓값과 같다.
  sleeveRowsMaxDeg: number[];
}

function runCombo(widthM: number, sleeveWidthM: number): ComboResult {
  const armLeft: ArmDir = { dir: dirLeft, length: SLEEVE_LENGTH_M };
  const armRight: ArmDir = { dir: dirRight, length: SLEEVE_LENGTH_M };
  const { sim } = buildUnifiedGarmentSim(widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);

  const preset = FABRIC_PRESETS.cotton;
  const gravity = new THREE.Vector3(...GRAVITY_BASE).multiplyScalar(preset.gravityScale);
  const armCapsules = [...buildArmCapsules(trueShoulderLeft, dirLeft, SLEEVE_LENGTH_M), ...buildArmCapsules(trueShoulderRight, dirRight, SLEEVE_LENGTH_M)];
  const resolver = (positions: Float32Array, pinned: Uint8Array, n: number) => {
    applyCapsuleCollision(positions, pinned, n, armCapsules, 0.006);
  };

  for (let f = 0; f < FRAMES; f++) {
    pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight);
    sim.step(SUBSTEP_DT, gravity, resolver, preset.iterations, 3, preset.damping, 0.05);
    applyArmSoftPull(sim, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);
    applyNecklineHug(sim, PANEL_FRONT, PANEL_BACK, widthM, centerZ, pinLeft, pinRight, armLeft, armRight);
    enforceArmFrontBackYAlignment(sim, PANEL_FRONT, PANEL_BACK, pinLeft, pinRight, armLeft, armRight);
    sim.clampOverstretchedConstraints();
  }

  for (let i = 0; i < sim.positions.length; i++) {
    if (!Number.isFinite(sim.positions[i])) {
      return {
        widthM,
        sleeveWidthM,
        diverged: true,
        maxPenetrationMm: NaN,
        maxSeamGapCm: NaN,
        maxJaggednessDeg: NaN,
        armholeJaggednessDeg: NaN,
        sleeveJaggednessDeg: NaN,
      };
    }
  }

  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const { xMin, xMax } = torsoColumnRange(COLS, pinLeft, pinRight, armLeft, armRight);

  // 봉제선 갭(cm) — sleeveSeamCheck과 같은 순서(k0..11), 암홀 링 vs 소매 링 row0.
  const seamGapCm = (col: number, sleevePanel: number): number[] =>
    armholeRingVertices(sim, PANEL_FRONT, PANEL_BACK, col, armholeStartRow).map((pt, k) => {
      const si = sim.index(sleevePanel, k, 0) * 3;
      return Math.hypot(pt.x - sim.positions[si], pt.y - sim.positions[si + 1], pt.z - sim.positions[si + 2]) * 100;
    });
  const maxSeamGapCm = Math.max(...seamGapCm(xMin, PANEL_SLEEVE_LEFT), ...seamGapCm(xMax, PANEL_SLEEVE_RIGHT));

  // 관통량(mm) — 몸판 0~ARM_ROWS+4행(전체 열) 스캔, armCapsuleRowCheck과 같은 공식.
  let minClearanceMm = Infinity;
  for (let y = 0; y <= ARM_ROWS + 4; y++) {
    for (const panel of [PANEL_FRONT, PANEL_BACK]) {
      for (let x = 0; x < COLS; x++) {
        const i = sim.index(panel, x, y) * 3;
        const p = { x: sim.positions[i], y: sim.positions[i + 1], z: sim.positions[i + 2] };
        const cl = capsuleClearanceMm(p, armCapsules);
        if (cl < minClearanceMm) minClearanceMm = cl;
      }
    }
  }
  const maxPenetrationMm = Math.max(0, -minClearanceMm);

  // 톱니 — 암홀 링 + 소매 링(row0) 법선의 인접 각도차 최댓값(4개 링 중 최댓값).
  const frontNormals = buildPanelNormals(sim, PANEL_FRONT, COLS, ROWS);
  const backNormals = buildPanelNormals(sim, PANEL_BACK, COLS, ROWS);
  const sleeveLeftNormals = buildPanelNormals(sim, PANEL_SLEEVE_LEFT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
  const sleeveRightNormals = buildPanelNormals(sim, PANEL_SLEEVE_RIGHT, SLEEVE_RING_COLS, SLEEVE_RING_ROWS);
  const armholeRingNormalsAt = (col: number): Vec3Like[] => {
    const pts: Vec3Like[] = [];
    for (let y = 0; y <= armholeStartRow; y++) pts.push(readNormal(frontNormals, y * COLS + col));
    for (let y = armholeStartRow; y >= 0; y--) pts.push(readNormal(backNormals, y * COLS + col));
    return pts;
  };
  const sleeveRingNormalsAt = (attr: THREE.BufferAttribute, row: number): Vec3Like[] => {
    const pts: Vec3Like[] = [];
    for (let k = 0; k < SLEEVE_RING_COLS; k++) pts.push(readNormal(attr, row * SLEEVE_RING_COLS + k));
    return pts;
  };
  const armholeJaggednessDeg = Math.max(ringJaggedness(armholeRingNormalsAt(xMin)).maxDeg, ringJaggedness(armholeRingNormalsAt(xMax)).maxDeg);
  // row0(캡)뿐 아니라 링 전체(row0~SLEEVE_RING_ROWS-1)를 훑는다 —
  // pattern-redesign.md 11번(화면 확인 후 row0만으론 부족할 수 있다는 가설).
  const sleeveRowsMaxDeg: number[] = [];
  for (let row = 0; row < SLEEVE_RING_ROWS; row++) {
    sleeveRowsMaxDeg.push(
      Math.max(ringJaggedness(sleeveRingNormalsAt(sleeveLeftNormals, row)).maxDeg, ringJaggedness(sleeveRingNormalsAt(sleeveRightNormals, row)).maxDeg),
    );
  }
  const sleeveJaggednessDeg = Math.max(...sleeveRowsMaxDeg);
  const maxJaggednessDeg = Math.max(armholeJaggednessDeg, sleeveJaggednessDeg);

  return {
    widthM,
    sleeveWidthM,
    diverged: false,
    maxPenetrationMm: Number(maxPenetrationMm.toFixed(2)),
    maxSeamGapCm: Number(maxSeamGapCm.toFixed(2)),
    maxJaggednessDeg: Number(maxJaggednessDeg.toFixed(1)),
    armholeJaggednessDeg: Number(armholeJaggednessDeg.toFixed(1)),
    sleeveJaggednessDeg: Number(sleeveJaggednessDeg.toFixed(1)),
    sleeveRowsMaxDeg: sleeveRowsMaxDeg.map((d) => Number(d.toFixed(1))),
  };
}

const results: ComboResult[] = [];
for (const widthM of WIDTHS_M) {
  for (const sleeveWidthM of SLEEVE_WIDTHS_M) {
    results.push(runCombo(widthM, sleeveWidthM));
  }
}

console.log(`[paramSweep] ${FRAMES}프레임(${SECONDS}s) × ${results.length}조합`);
console.table(results);
console.log("[paramSweep] sleeve row0~row%d breakdown (품/소매통 → 행별 최댓값):", SLEEVE_RING_ROWS - 1);
for (const r of results) {
  console.log(`  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm:`, r.sleeveRowsMaxDeg);
}

const diverged = results.filter((r) => r.diverged);
if (diverged.length > 0) {
  console.error(`[paramSweep] ${diverged.length}개 조합 발산(NaN/Infinity):`, diverged.map((r) => `품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm`));
  process.exit(1);
}
