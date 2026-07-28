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
import { applyCapsuleCollision, buildTorsoProxyCapsules, type Capsule } from "../src/lib/torsoCapsule";
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
import { armholeRingJaggedness, ringJaggedness } from "../src/lib/seamDiagnostics";
import { computeBodyGapChannels, computeDrapeMetrics, type DrapeMetrics, type GapStats } from "../src/lib/drapeMetrics";

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
  //
  // armholeJaggednessDeg는 앞판↔뒤판 경계 2곳(어깨/겨드랑이)을 모두 제외한
  // 내부값이다 — 두 경계는 천 톱니가 아니라 "앞뒤판이 몇 도로 만나나"라는
  // 기하학적 아티팩트라서 뺐다. 뺀 값들은 armholeShoulderDeg/armholeArmpitDeg로
  // 그대로 낸다(seamDiagnostics.ts의 armholeRingJaggedness 주석 참고).
  armholeJaggednessDeg: number;
  armholeShoulderDeg: number;
  armholeArmpitDeg: number;
  sleeveJaggednessDeg: number;
  // row0(캡)~row(SLEEVE_RING_ROWS-1)(소맷부리) 각 행의 최댓값(좌우 중 큰 쪽) —
  // sleeveJaggednessDeg는 이 배열의 최댓값과 같다.
  sleeveRowsMaxDeg: number[];
  // 드레이프 개선(A안) 전/후 대조용 — drapeMetrics.ts 4개 지표 + 프레임당
  // 물리 ms(이 하네스의 프레임 루프 전체 평균 — 브라우저 절대값과는 다르지만
  // 전/후 상대 비교용으로 충분).
  drape: DrapeMetrics | null;
  // 천-몸 이탈(mm) — 영역별 채널(drapeMetrics.ts computeBodyGapChannels 주석
  // 참고). shoulder=row0~5(밀착해야 하는 영역, 판정 1순위), torso=row6~20,
  // hem=row21~27(자연 낙하가 정상, 참고용). Garment.tsx가 쓰는
  // buildTorsoProxyCapsules(기본 체형 170cm/가슴100cm)를 그대로 재사용.
  bodyGap: { shoulder: GapStats; torso: GapStats; hem: GapStats } | null;
  // 소맷부리 처짐(cm, 좌/우 중 더 처진 쪽) — C단계(소매 스냅 축소)가
  // sleeveArmPull을 낮추면 커질 수 있는 예상 트레이드오프의 정량 감시.
  // 커프 링(마지막 행) 중심이 "이상 커프 중심"(row0 링 중심 + 팔축×팔길이,
  // applySleeveArmPull의 목표식과 동일)보다 얼마나 아래(-)인지.
  cuffDroopCm: number | null;
  physMsPerFrame: number;
}

// 몸 프록시 — 워커의 토르소 캡슐과 같은 함수, 기본 체형(useFitStore 기본값).
const torsoCapsules = buildTorsoProxyCapsules(trueShoulderLeft, trueShoulderRight, 1.7, 1.0).capsules;

// 커프 링 중심의 이상 지점 대비 Y 처짐(cm, 음수=아래) — 좌/우 중 더 처진 쪽.
function cuffDroopCm(
  sim: { index(panel: number, x: number, y: number): number; positions: Float32Array },
  arms: ReadonlyArray<{ panel: number; dir: Vec3Like; length: number }>,
): number {
  let worst = Infinity;
  for (const { panel, dir, length } of arms) {
    const ringCenter = (row: number) => {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < SLEEVE_RING_COLS; k++) {
        const i = sim.index(panel, k, row) * 3;
        cx += sim.positions[i];
        cy += sim.positions[i + 1];
        cz += sim.positions[i + 2];
      }
      return { x: cx / SLEEVE_RING_COLS, y: cy / SLEEVE_RING_COLS, z: cz / SLEEVE_RING_COLS };
    };
    const c0 = ringCenter(0);
    const cuff = ringCenter(SLEEVE_RING_ROWS - 1);
    const idealY = c0.y + dir.y * length;
    const droop = (cuff.y - idealY) * 100;
    if (droop < worst) worst = droop;
  }
  return Number(worst.toFixed(2));
}

function runCombo(widthM: number, sleeveWidthM: number, sleeveLengthM = SLEEVE_LENGTH_M): ComboResult {
  const armLeft: ArmDir = { dir: dirLeft, length: sleeveLengthM };
  const armRight: ArmDir = { dir: dirRight, length: sleeveLengthM };
  const { sim } = buildUnifiedGarmentSim(widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);

  const preset = FABRIC_PRESETS.cotton;
  const gravity = new THREE.Vector3(...GRAVITY_BASE).multiplyScalar(preset.gravityScale);
  const armCapsules = [...buildArmCapsules(trueShoulderLeft, dirLeft, sleeveLengthM), ...buildArmCapsules(trueShoulderRight, dirRight, sleeveLengthM)];
  const resolver = (positions: Float32Array, pinned: Uint8Array, n: number) => {
    applyCapsuleCollision(positions, pinned, n, armCapsules, 0.006);
  };

  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    pinCorners(sim, pinLeft, pinRight, PANEL_FRONT, PANEL_BACK, armLeft, armRight);
    sim.step(SUBSTEP_DT, gravity, resolver, preset.iterations, 3, preset.damping, 0.05);
    applyArmSoftPull(sim, PANEL_FRONT, PANEL_BACK, widthM, heightM, topY, centerZ, pinLeft, pinRight, armLeft, armRight, sleeveWidthM);
    applyNecklineHug(sim, PANEL_FRONT, PANEL_BACK, widthM, centerZ, pinLeft, pinRight, armLeft, armRight);
    enforceArmFrontBackYAlignment(sim, PANEL_FRONT, PANEL_BACK, pinLeft, pinRight, armLeft, armRight);
    sim.clampOverstretchedConstraints();
  }
  const physMsPerFrame = Number(((performance.now() - t0) / FRAMES).toFixed(3));

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
        armholeShoulderDeg: NaN,
        armholeArmpitDeg: NaN,
        sleeveJaggednessDeg: NaN,
        // 원래 빠져 있어 발산 조합에서 undefined가 나갔다(아래 행별 출력이
        // 그대로 터짐) — scripts/는 tsc -b 대상이 아니라 여태 안 잡혔다.
        sleeveRowsMaxDeg: [],
        drape: null,
        bodyGap: null,
        cuffDroopCm: null,
        physMsPerFrame,
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
  // 암홀만 armholeRingJaggedness — maxDeg가 경계 2곳을 뺀 내부값이라
  // "실제 개선에 반응하는" 지표다. 뺀 두 경계값은 좌우 중 큰 쪽을 같이 낸다.
  const armholeLeft = armholeRingJaggedness(armholeRingNormalsAt(xMin));
  const armholeRight = armholeRingJaggedness(armholeRingNormalsAt(xMax));
  const armholeJaggednessDeg = Math.max(armholeLeft.maxDeg, armholeRight.maxDeg);
  const armholeShoulderDeg = Math.max(armholeLeft.panelBoundaryDeg.shoulder, armholeRight.panelBoundaryDeg.shoulder);
  const armholeArmpitDeg = Math.max(armholeLeft.panelBoundaryDeg.armpit, armholeRight.panelBoundaryDeg.armpit);
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
    armholeShoulderDeg: Number(armholeShoulderDeg.toFixed(1)),
    armholeArmpitDeg: Number(armholeArmpitDeg.toFixed(1)),
    sleeveJaggednessDeg: Number(sleeveJaggednessDeg.toFixed(1)),
    sleeveRowsMaxDeg: sleeveRowsMaxDeg.map((d) => Number(d.toFixed(1))),
    drape: computeDrapeMetrics(sim, [PANEL_FRONT, PANEL_BACK], xMin, xMax),
    bodyGap: (() => {
      const [shoulder, torso, hem] = computeBodyGapChannels(
        sim,
        [PANEL_FRONT, PANEL_BACK],
        torsoCapsules,
        [
          { rowStart: 0, rowEndInclusive: armholeStartRow }, // 어깨·등 상단 — 판정 1순위
          { rowStart: armholeStartRow + 1, rowEndInclusive: 20 },
          { rowStart: 21, rowEndInclusive: ROWS - 1 }, // 참고용
        ],
        xMin,
        xMax,
      );
      return { shoulder, torso, hem };
    })(),
    cuffDroopCm: cuffDroopCm(sim, [
      { panel: PANEL_SLEEVE_LEFT, dir: dirLeft, length: sleeveLengthM },
      { panel: PANEL_SLEEVE_RIGHT, dir: dirRight, length: sleeveLengthM },
    ]),
    physMsPerFrame,
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
// armhole은 내부값(=지표) / 뺀 어깨값 / 뺀 겨드랑이값을 나란히 찍는다 —
// console.table이 잘려도 이 셋은 항상 보이게, 그리고 두 경계값이 계속
// 내부값과 뚜렷이 다른 자릿수인지(=제외 인덱스가 맞게 잡혔는지) 매번
// 자체 확인되도록.
console.log("[paramSweep] armhole (지표=경계2개제외 / 어깨접합부 / 겨드랑이접합부):");
for (const r of results) {
  console.log(`  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm: ${r.armholeJaggednessDeg}° / ${r.armholeShoulderDeg}° / ${r.armholeArmpitDeg}°`);
}
console.log("[paramSweep] sleeve row0~row%d breakdown (품/소매통 → 행별 최댓값):", SLEEVE_RING_ROWS - 1);
for (const r of results) {
  console.log(`  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm:`, r.sleeveRowsMaxDeg);
}
console.log("[paramSweep] drape (면각평균° / 면각최대° / 주름RMSmm / maxStrain / 커프처짐cm / 물리ms):");
for (const r of results) {
  const d = r.drape;
  console.log(
    `  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm: ${d ? `${d.faceAngleMeanDeg} / ${d.faceAngleMaxDeg} / ${d.wrinkleRmsMm} / ${d.maxStrain}` : "발산"} / ${r.cuffDroopCm ?? "-"} / ${r.physMsPerFrame}ms`,
  );
}
console.log("[paramSweep] bodyGap 채널 (어깨 max|mean / 몸통 max|mean / 밑단 max|mean, mm — 어깨가 판정 1순위):");
for (const r of results) {
  const g = r.bodyGap;
  console.log(
    `  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm: ${g ? `${g.shoulder.maxMm}|${g.shoulder.meanMm} / ${g.torso.maxMm}|${g.torso.meanMm} / ${g.hem.maxMm}|${g.hem.meanMm}` : "발산"}`,
  );
}

// 긴팔(58cm) 대표 1콤보 — 커프 U자 커브 최소값 유지가 실제로 망토화를
// 막는지 감시(46번 이력: 소매 중간~끝이 무방비면 평평한 망토로 퍼짐).
// 12콤보 전부 x2 길이로 돌리면 런타임 두 배라 대표 1개만.
const longSleeve = runCombo(0.55, 0.18, 0.58);
const ld = longSleeve.drape;
console.log(
  `[paramSweep] 긴팔(58cm) 품55/소매통18: ${ld ? `${ld.faceAngleMeanDeg} / ${ld.faceAngleMaxDeg} / ${ld.wrinkleRmsMm} / ${ld.maxStrain}` : "발산"} / 어깨갭 ${longSleeve.bodyGap ? `${longSleeve.bodyGap.shoulder.maxMm}|${longSleeve.bodyGap.shoulder.meanMm}` : "-"} / 커프처짐 ${longSleeve.cuffDroopCm ?? "-"}cm / sleeve톱니 ${longSleeve.sleeveJaggednessDeg}° / 관통 ${longSleeve.maxPenetrationMm}mm / seamGap ${longSleeve.maxSeamGapCm}cm`,
);

const diverged = results.filter((r) => r.diverged);
if (diverged.length > 0) {
  console.error(`[paramSweep] ${diverged.length}개 조합 발산(NaN/Infinity):`, diverged.map((r) => `품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm`));
  process.exit(1);
}
