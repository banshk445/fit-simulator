// 파라미터(품/소매통) 조합을 자동으로 돌려 관통량/봉제선 갭/톱니를 한
// 표로 뽑는다. checkSleeveSeam.ts와 같은 방식(마네킹 BVH 메시 충돌은
// Node에 GLTF/DOM이 없어 뺌 — 팔 캡슐 충돌만 재현) — 회귀 하나만 보는
// assert 스크립트와 달리 여러 조합을 한 번에 비교해 "어디서부터 나빠지는지"
// 찾는 탐색 도구다.
// ponytail: 조합 그리드는 아래 WIDTHS_M/SLEEVE_WIDTHS_M 배열을 직접 고쳐라
// (CLI 파싱 없음 — 필요해지면 추가).
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { armholeRingVertices, torsoColumnRange, type ArmDir } from "../src/lib/buildGarmentSim";
import { buildArmCapsules as buildFrameArmCapsules, createGarmentSession, createPanelSplitResolver, createUnifiedResolver, PANEL_COUNTS } from "../src/lib/garmentFrame";
import { ArrayBvhCollision } from "../src/lib/bvhFromArrays";
import { SelfCollision } from "../src/lib/selfCollision";
import { buildUnifiedGarmentSim } from "../src/lib/buildUnifiedGarmentSim";
import { applyCapsuleCollision, buildTorsoProxyCapsules, type Capsule } from "../src/lib/torsoCapsule";
import {
  ARM_ROWS,
  ARMHOLE_ROW_FRACTION,
  COLLISION_DETECTION_RADIUS,
  COLLISION_EVERY,
  COLLAR_STRAIN_LIMIT,
  COLLISION_MARGIN,
  LOCAL_MU_GAIN,
  COLS,
  GRAVITY_BASE,
  MAX_DISPLACEMENT_PER_SUBSTEP,
  PANEL_BACK,
  PANEL_FRONT,
  PANEL_SLEEVE_LEFT,
  PANEL_SLEEVE_RIGHT,
  ROWS,
  FRICTION_CONTACT_BAND,
  FRICTION_MU_ITER,
  FRICTION_MU_KINETIC,
  FRICTION_MU_STATIC,
  SDF_FAR,
  SDF_PUSH_RELAXATION,
  SDF_VOXEL,
  SELF_COLLISION_MIN_DIST,
  SLEEVE_RING_COLS,
  SLEEVE_RING_ROWS,
  SUBSTEP_DT,
} from "../src/lib/clothConfig";
import { FABRIC_PRESETS } from "../src/lib/fabricPresets";
import type { Vec3Like } from "../src/lib/clothProtocol";
import { armholeRingJaggedness, ringJaggedness } from "../src/lib/seamDiagnostics";
import { capsuleGapBands, computeCapsuleGapChannels, computeDrapeMetrics, computeOrderViolations, computeRippleMm, type DrapeMetrics, type GapStats } from "../src/lib/drapeMetrics";
import { computeBodyCoverage } from "../src/lib/coverageMetric";
import { bakeSdf, createCachedSdfIterationFriction, createSdfFrictionPass, createSdfIterationFrictionPass, createSdfPushResolver, makeRadialSignedSampler, type SdfField } from "../src/lib/sdfCollision";

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
const SECONDS = process.env.SECONDS ? Number(process.env.SECONDS) : 3;
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
  // 천-몸 이탈(mm) — 영역별 채널(drapeMetrics.ts computeCapsuleGapChannels 주석
  // 참고). shoulder=row0~5(밀착해야 하는 영역, 판정 1순위), torso=row6~20,
  // hem=row21~27(자연 낙하가 정상, 참고용). Garment.tsx가 쓰는
  // buildTorsoProxyCapsules(기본 체형 170cm/가슴100cm)를 그대로 재사용.
  capsuleGap: { shoulder: GapStats; shoulderFree: GapStats; torso: GapStats; hem: GapStats } | null;
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

  // M0(파이프라인 일원화): 워커와 같은 createGarmentSession을 쓴다. env는
  // 이 하네스의 기존 시퀀스(핀→step(collisionEvery=3, 순서훅 없음)→소프트풀
  // →넥라인→yAlign→clamp)를 **정확히 재현**하는 값 — 리팩터링 검증(비트
  // 동일)이 목적이라 여기서 동작을 바꾸면 안 된다. 워커 전체 시퀀스와의
  // 차이는 이 토글들이 명시적으로 문서화한다(BVH/자체충돌/스무딩/순서/
  // 대칭/sleeveArmPull off — fixture 모드가 이 간극을 좁히는 다음 단계).
  const session = createGarmentSession(sim, {
    collisionResolver: resolver,
    collisionEvery: 3,
    selfCollision: null,
    orderColumn: false,
    orderRow: false,
    clampInSubstep: false,
    smoothing: false,
    postOrder: false,
    armSoftPull: true,
    necklineHug: true,
    sleeveArmPull: false,
    yAlign: true,
    symmetry: false,
    clampAfterPost: true,
    maxDisplacement: 0.05,
  });
  const layout = { widthM, heightM, topY, centerZ, sleeveWidthM };
  const pose = { pinLeft, pinRight, armLeft, armRight };
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    session.step(SUBSTEP_DT, gravity, preset, layout, pose);
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
        capsuleGap: null,
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
    capsuleGap: (() => {
      const [shoulder, shoulderFree, torso, hem] = computeCapsuleGapChannels(
        sim,
        [PANEL_FRONT, PANEL_BACK],
        torsoCapsules,
        capsuleGapBands(armholeStartRow, ROWS),
        xMin,
        xMax,
      );
      return { shoulder, shoulderFree, torso, hem };
    })(),
    cuffDroopCm: cuffDroopCm(sim, [
      { panel: PANEL_SLEEVE_LEFT, dir: dirLeft, length: sleeveLengthM },
      { panel: PANEL_SLEEVE_RIGHT, dir: dirRight, length: sleeveLengthM },
    ]),
    physMsPerFrame,
  };
}

// M0(fixture 모드): FIXTURE=경로 를 주면 12콤보 대신, 브라우저
// __fitDebug.exportCollision()이 내보낸 스냅샷(몸 BVH 메시/캡슐/실제
// 레이아웃·포즈)으로 **워커와 같은 전체 파이프라인**(BVH 충돌+자체충돌+
// 스무딩+순서+대칭+sleeveArmPull, env 전부 on)을 재현해 돌린다 —
// "하네스 0.72cm 통과 vs 브라우저 2.9cm 실패" 괴리를 좁히는 게 목적.
interface CollisionFixture {
  layout: { widthM: number; heightM: number; topY: number; centerZ: number; sleeveWidthM: number };
  pose: {
    pinLeft: Vec3Like;
    pinRight: Vec3Like;
    necklineLift: number[];
    fabric: keyof typeof FABRIC_PRESETS;
    armLeft: { dir: Vec3Like; trueShoulder: Vec3Like; length: number };
    armRight: { dir: Vec3Like; trueShoulder: Vec3Like; length: number };
  };
  collision: {
    position: number[];
    frontIndex: number[] | null;
    backIndex: number[] | null;
    wholeBodyIndex: number[] | null;
    capsules: Capsule[];
    centerZ: number;
  };
}

function runFixture(path: string): void {
  // NEWCORE=1이면 M1 신 코어(암홀 링 용접) — 신구 대조는 같은 fixture로
  // 이 스위치만 바꿔 두 번 돌린다.
  const newCore = process.env.NEWCORE === "1";
  // PINLIFT=cm 이면 SHOULDER_PIN_LIFT 스윕 — fixture의 핀 좌표에는 브라우저
  // 기준값(5.5cm)이 이미 구워져 있으므로 차이만큼 핀 Y와 topY를 함께
  // 이동시킨다(topY = max(pin.y) 파생값). necklineLift는 불변(단일 변수).
  const fixture0 = JSON.parse(readFileSync(path, "utf8"));
  // 측정 대역(coverage/hover)은 몸 기준이라 핀과 무관하게 고정한다 —
  // 처음엔 layout.topY를 그대로 대역 기준으로 썼다가 샘플 수가 셀마다
  // 달라지는(644→693/720) 배선 함정을 밟았다. 원본 topY를 따로 보관.
  const bandTopY: number = fixture0.layout.topY;
  if (process.env.PINLIFT) {
    const delta = Number(process.env.PINLIFT) / 100 - 0.055;
    fixture0.pose.pinLeft.y += delta;
    fixture0.pose.pinRight.y += delta;
    fixture0.layout.topY += delta;
  }
  const fixture = fixture0 as CollisionFixture;
  const { layout, pose } = fixture;
  const armLeft: ArmDir = { dir: pose.armLeft.dir, length: pose.armLeft.length };
  const armRight: ArmDir = { dir: pose.armRight.dir, length: pose.armRight.length };

  const frontMesh = new ArrayBvhCollision();
  const backMesh = new ArrayBvhCollision();
  const position = Float32Array.from(fixture.collision.position);
  frontMesh.rebuild(position, fixture.collision.frontIndex ? Uint32Array.from(fixture.collision.frontIndex) : null);
  backMesh.rebuild(position, fixture.collision.backIndex ? Uint32Array.from(fixture.collision.backIndex) : null);
  const meshColumnRange = { cols: COLS, min: 0, max: COLS - 1 };
  // M2-4: 신 코어면 흡착 완화(관통 시에만). ADHESION=1로 기존 흡착 복원.
  const penetrationAxis = {
    // M2-4 원복 — 흡착 기본 on(워커와 동일). ADHESION=0으로 끄고 재현만.
    enabled: newCore && process.env.ADHESION === "0",
    x: fixture.collision.capsules[0]?.top.x ?? 0,
    z: fixture.collision.capsules[0]?.top.z ?? 0,
  };
  // MARGIN=값(mm) 이면 COLLISION_MARGIN override — margin 스윕용.
  const collisionMargin = process.env.MARGIN ? Number(process.env.MARGIN) / 1000 : COLLISION_MARGIN;
  const meshResolver = createPanelSplitResolver(
    [
      frontMesh.createResolver(collisionMargin, COLLISION_DETECTION_RADIUS, 0, 0, meshColumnRange, penetrationAxis),
      backMesh.createResolver(collisionMargin, COLLISION_DETECTION_RADIUS, 0, 0, meshColumnRange, penetrationAxis),
      null,
      null,
    ],
    PANEL_COUNTS,
  );
  const collisionState = {
    torsoCapsules: fixture.collision.capsules,
    armCapsules: [...buildFrameArmCapsules(pose.armLeft), ...buildFrameArmCapsules(pose.armRight)],
    centerZ: fixture.collision.centerZ,
    // M2 제거 ①: 신 코어면 sidedness off(SIDEDNESS=1로 강제 복원 가능 — 대조용).
    sidedness: !newCore || process.env.SIDEDNESS === "1",
    // M2-4 선행: 신 코어 기본 on. PAIRSEP=0으로 끄고 대조.
    pairSeparation: newCore && process.env.PAIRSEP !== "0",
  };
  let unified = createUnifiedResolver(meshResolver, collisionState);

  // M2: SDF 굽기 + 마찰(FRICTION=1일 때만) — 굽기 범위는 옷이 실제로 닿는
  // 구간(어깨 위 10cm ~ 밑단 아래 15cm)의 몸 메시 bbox.
  const yTop = layout.topY + 0.1;
  const yBot = layout.topY - layout.heightM - 0.15;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    const y = position[i + 1];
    if (y < yBot || y > yTop) continue;
    if (position[i] < minX) minX = position[i];
    if (position[i] > maxX) maxX = position[i];
    if (position[i + 2] < minZ) minZ = position[i + 2];
    if (position[i + 2] > maxZ) maxZ = position[i + 2];
  }
  const pad = 0.08;
  const sdfMin = { x: minX - pad, y: yBot, z: minZ - pad };
  const sdfMax = { x: maxX + pad, y: yTop, z: maxZ + pad };
  const sdfCx = (sdfMin.x + sdfMax.x) / 2;
  const sdfCz = (sdfMin.z + sdfMax.z) / 2;

  let sdfField: SdfField | null = null;
  if (process.env.FRICTION === "1") {
    const wholeMesh = new ArrayBvhCollision();
    wholeMesh.rebuild(position, fixture.collision.wholeBodyIndex ? Uint32Array.from(fixture.collision.wholeBodyIndex) : null);
    const t = performance.now();
    sdfField = bakeSdf(makeRadialSignedSampler(wholeMesh, sdfCx, sdfCz, SDF_FAR, SDF_FAR), sdfMin, sdfMax, SDF_VOXEL, SDF_FAR);
    console.log(
      `[paramSweep:fixture] SDF 굽기 ${sdfField.nx}x${sdfField.ny}x${sdfField.nz}(${(sdfField.nx * sdfField.ny * sdfField.nz / 1000).toFixed(1)}k복셀) ${Math.round(performance.now() - t)}ms`,
    );
  }
  // MU=값 이면 정지/운동 계수를 그 값으로 함께 덮어쓴다(μ 스윕용).
  const muOverride = process.env.MU ? Number(process.env.MU) : null;
  // M2-3: 신 코어면 밀어내기를 SDF 기울기로(팔 제외 필드 = 기존 BVH
  // 리졸버와 같은 대상). PUSH=bvh로 강제 복원해 대조 가능.
  // M2-3 원복(3연속 실패) — 기본 off. PUSH=sdf 로 재현만 가능.
  // 필드를 앞/뒤로 나눈다 — BVH 리졸버가 frontIndex/backIndex로 분리돼
  // 있었고, 그 분리가 "앞판은 앞면에만 붙는다"는 앞뒤 분리 장치로도
  // 작동하고 있었다(sidedness 제거 후엔 유일한 장치). 단일 필드로 합치면
  // 옆구리로 돌아간 앞판 파티클이 뒤쪽 표면에 붙어 뒤판을 관통한다
  // (1차·2차 시도의 교차 31~33개 원인 — 부호가 아니라 이것이었다).
  let sdfPushFront: SdfField | null = null;
  let sdfPushBack: SdfField | null = null;
  if (newCore && process.env.PUSH === "sdf") {
    const toU32 = (a: number[] | null) => (a ? Uint32Array.from(a) : null);
    const bakeSide = (idx: number[] | null, label: string): SdfField => {
      const m = new ArrayBvhCollision();
      m.rebuild(position, toU32(idx));
      const t = performance.now();
      const f = bakeSdf(makeRadialSignedSampler(m, sdfCx, sdfCz, SDF_FAR, SDF_FAR), sdfMin, sdfMax, SDF_VOXEL, SDF_FAR);
      console.log(`[paramSweep:fixture] SDF ${label} 굽기 ${Math.round(performance.now() - t)}ms`);
      return f;
    };
    sdfPushFront = bakeSide(fixture.collision.frontIndex, "밀어내기/앞면");
    sdfPushBack = bakeSide(fixture.collision.backIndex, "밀어내기/뒷면");
    const push = createPanelSplitResolver(
      [
        createSdfPushResolver(() => sdfPushFront, COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, SDF_PUSH_RELAXATION, meshColumnRange),
        createSdfPushResolver(() => sdfPushBack, COLLISION_MARGIN, COLLISION_DETECTION_RADIUS, SDF_PUSH_RELAXATION, meshColumnRange),
        null,
        null,
      ],
      PANEL_COUNTS,
    );
    unified = createUnifiedResolver(push, collisionState);
  }

  const friction = sdfField
    ? createSdfFrictionPass(() => sdfField, {
        contactBand: FRICTION_CONTACT_BAND,
        muStatic: muOverride ?? FRICTION_MU_STATIC,
        muKinetic: muOverride ?? FRICTION_MU_KINETIC,
      })
    : undefined;

  const { sim, seamSkipPairs } = buildUnifiedGarmentSim(
    layout.widthM, layout.heightM, layout.topY, layout.centerZ,
    pose.pinLeft, pose.pinRight, armLeft, armRight, layout.sleeveWidthM, pose.necklineLift, newCore,
  );
  const panelStarts: number[] = [];
  const panelCols: number[] = [];
  for (let p = 0; p < sim.panels; p++) {
    panelStarts.push(sim.panelParticleStart(p));
    panelCols.push(sim.panelDims[p].cols);
  }
  const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const selfCollision = new SelfCollision(panelStarts, panelCols, armholeStartRow, seamSkipPairs).createResolver(SELF_COLLISION_MIN_DIST);

  const env = {
    collisionResolver: unified,
    collisionEvery: COLLISION_EVERY,
    selfCollision,
    // ④: ORDER_COL=0 / ORDER_ROW=0 / SYMMETRY=0 으로 하나씩 뗀다.
    orderColumn: process.env.ORDER_COL !== "0",
    orderRow: process.env.ORDER_ROW !== "0",
    clampInSubstep: true,
    // M2 제거 ②는 원복됨(워커와 동일하게 기본 on) — SMOOTHING=0으로 끄고,
    // SMOOTH_BLEND=값으로 중간값을 재는 실험 손잡이만 남긴다.
    smoothing: process.env.SMOOTHING !== "0",
    smoothingBlend: process.env.SMOOTH_BLEND ? Number(process.env.SMOOTH_BLEND) : undefined,
    postOrder: true,
    armSoftPull: true,
    necklineHug: true,
    sleeveArmPull: true,
    yAlign: true,
    symmetry: process.env.SYMMETRY !== "0",
    clampAfterPost: false,
    maxDisplacement: MAX_DISPLACEMENT_PER_SUBSTEP,
    columnRange: meshColumnRange,
    friction,
    // M2-5: FRICITER=0으로 끄고 대조. FRIC_LIVE=1이면 캐시 없는 원본
    // 패스(동등성 대조용). MU_ITER=값 으로 반복 모드 μ override.
    ...(sdfField && process.env.FRICITER !== "0"
      ? (() => {
          const fparams = {
            contactBand: FRICTION_CONTACT_BAND,
            muStatic: process.env.MU_ITER ? Number(process.env.MU_ITER) : FRICTION_MU_ITER,
            muKinetic: process.env.MU_ITER ? Number(process.env.MU_ITER) : FRICTION_MU_ITER,
            // M2-8: LOCALMU=배수 (법선 위쪽 성분 기반 μ 증폭).
            localMuGain: process.env.LOCALMU ? Number(process.env.LOCALMU) : LOCAL_MU_GAIN,
          };
          if (process.env.FRIC_LIVE === "1") {
            return { frictionIteration: createSdfIterationFrictionPass(() => sdfField, fparams) };
          }
          const cached = createCachedSdfIterationFriction(() => sdfField, fparams);
          // CONTACT=1: 어깨/몸통 대역 마찰 접촉 발화 카운트(선행 진단).
          // 흡착(BVH)은 탐지 반경 15cm 안이면 항상 발화라 정보가 없다 —
          // 수직항력이 실제로 생기는 접촉(sd <= contactBand)만 센다.
          const wrappedReset =
            process.env.CONTACT === "1"
              ? (positions: Float32Array, pinned: Uint8Array, n: number) => {
                  cached.reset(positions, pinned, n);
                  const loads = cached.getLoads();
                  const { xMin, xMax } = reconRange;
                  let sh = 0, shN = 0, to = 0, toN = 0;
                  for (const panel of [PANEL_FRONT, PANEL_BACK]) {
                    for (let y = 0; y <= 20; y++) {
                      for (let x = xMin; x <= xMax; x++) {
                        const i = sim.index(panel, x, y);
                        const isShoulder = y <= armholeStartRowConst;
                        if (isShoulder) { shN++; if (loads[i] > 0) sh++; }
                        else { toN++; if (loads[i] > 0) to++; }
                      }
                    }
                  }
                  contactShoulder += sh; contactShoulderN += shN;
                  contactTorso += to; contactTorsoN += toN;
                  contactFrames++;
                }
              : cached.reset;
          return { frictionIteration: cached.apply, frictionIterationReset: wrappedReset };
        })()
      : {}),
    // 핀 전환 원복 — 기본 1(하드 핀). PIN=0.5 등으로 재현만 가능.
    pinStrength: process.env.PIN ? Number(process.env.PIN) : 1,
    // PINCONT=1: 반복 안 앵커(연속 핀) 모드. 램프는 자동으로 켠다.
    pinContinuous: process.env.PINCONT === "1",
    // (i) SYNCPREV=0으로 끄고 대조 가능(기본 on).
    anchorSyncPrev: process.env.SYNCPREV !== "0",
    // M2-6: COLLAR=0으로 끄고 대조(신 코어 기본 on).
    collarStrainLimit: newCore && process.env.COLLAR !== "0" ? COLLAR_STRAIN_LIMIT : undefined,
    onCollarFired: (n: number) => {
      collarFired += n;
    },
  };
  const session = createGarmentSession(sim, env);

  let collarFired = 0;
  let clampSaturated = 0;
  let settleFrame = -1;
  let lastMaxDelta = 0, lastMaxIdx = -1;
  let contactShoulder = 0, contactShoulderN = 0, contactTorso = 0, contactTorsoN = 0, contactFrames = 0;
  const armholeStartRowConst = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
  const preset = FABRIC_PRESETS[pose.fabric];
  const gravity = new THREE.Vector3(...GRAVITY_BASE).multiplyScalar(preset.gravityScale);
  const framePose = { pinLeft: pose.pinLeft, pinRight: pose.pinRight, armLeft, armRight, necklineLift: pose.necklineLift };
  // RECON=1(목선 기하 정찰): row0~2 링 원주의 초기(=레스트, 제약이 초기
  // 배치에서 구워지므로) 값과 정착 후 실측값 — 신장률. 링 = 앞판 x
  // xMin..xMax + 뒤판 역순의 닫힌 고리.
  // xMin/xMax는 프레임 루프 뒤에 선언되므로 여기서 지역으로 계산.
  const reconRange = torsoColumnRange(COLS, pose.pinLeft, pose.pinRight, armLeft, armRight);
  const ringCircumference = (row: number): number => {
    const { xMin, xMax } = reconRange;
    let len = 0;
    const seg = (pa: number, pb: number) => {
      const a = pa * 3, b = pb * 3;
      len += Math.hypot(sim.positions[a] - sim.positions[b], sim.positions[a + 1] - sim.positions[b + 1], sim.positions[a + 2] - sim.positions[b + 2]);
    };
    for (let x = xMin; x < xMax; x++) seg(sim.index(PANEL_FRONT, x, row), sim.index(PANEL_FRONT, x + 1, row));
    seg(sim.index(PANEL_FRONT, xMax, row), sim.index(PANEL_BACK, xMax, row));
    for (let x = xMax; x > xMin; x--) seg(sim.index(PANEL_BACK, x, row), sim.index(PANEL_BACK, x - 1, row));
    seg(sim.index(PANEL_BACK, xMin, row), sim.index(PANEL_FRONT, xMin, row));
    return len;
  };
  const reconRest: number[] = process.env.RECON === "1" ? [0, 1, 2].map(ringCircumference) : [];
  const reconRestAlways: number[] = [0, 1, 2].map(ringCircumference);

  // 시계열용 경량 커버리지(tf/tb 히트율만).
  const covParams = () => {
    const rh = layout.heightM / (ROWS - 1);
    return {
      yMin: bandTopY - rh * (armholeStartRowConst + 0.5),
      yMax: bandTopY + 0.03,
      neckCenter: { x: (pose.pinLeft.x + pose.pinRight.x) / 2, y: 0, z: (pose.pinLeft.z + pose.pinRight.z) / 2 },
      neckRadius: 0.09,
      centerX: (pose.pinLeft.x + pose.pinRight.x) / 2,
      centerZ: fixture.collision.centerZ,
    };
  };
  const clothRanges = () => [
    { panel: PANEL_FRONT, colMin: reconRange.xMin, colMax: reconRange.xMax },
    { panel: PANEL_BACK, colMin: reconRange.xMin, colMax: reconRange.xMax },
    { panel: PANEL_SLEEVE_LEFT, wrapCols: true },
    { panel: PANEL_SLEEVE_RIGHT, wrapCols: true },
  ];
  const quickCoverage = () => {
    const cov = computeBodyCoverage(position, [fixture.collision.frontIndex, fixture.collision.backIndex], sim, clothRanges(), covParams());
    const hr = (names: string[]) => {
      let sm = 0, ex = 0;
      for (const nm of names) {
        const b = cov.buckets[nm];
        if (b) { sm += b.samples; ex += b.exposed; }
      }
      return sm ? ((sm - ex) / sm).toFixed(3) : "-";
    };
    return { tf: hr(["top-front-left", "top-front-right"]), tb: hr(["top-back-left", "top-back-right"]) };
  };

  // 구간 경계 스냅샷 — 램프의 어느 구간에서 깨지는지 특정용.
  const snapshot = (label: string, delta20: number): void => {
    const rh = layout.heightM / (ROWS - 1);
    const cov = computeBodyCoverage(
      position,
      [fixture.collision.frontIndex, fixture.collision.backIndex],
      sim,
      [
        { panel: PANEL_FRONT, colMin: reconRange.xMin, colMax: reconRange.xMax },
        { panel: PANEL_BACK, colMin: reconRange.xMin, colMax: reconRange.xMax },
        { panel: PANEL_SLEEVE_LEFT, wrapCols: true },
        { panel: PANEL_SLEEVE_RIGHT, wrapCols: true },
      ],
      {
        yMin: bandTopY - rh * (armholeStartRowConst + 0.5),
        yMax: bandTopY + 0.03,
        neckCenter: { x: (pose.pinLeft.x + pose.pinRight.x) / 2, y: 0, z: (pose.pinLeft.z + pose.pinRight.z) / 2 },
        neckRadius: 0.09,
        centerX: (pose.pinLeft.x + pose.pinRight.x) / 2,
        centerZ: fixture.collision.centerZ,
      },
    );
    const band = (names: string[]) => {
      let sm = 0, ex = 0;
      for (const nm of names) {
        const b = cov.buckets[nm];
        if (b) { sm += b.samples; ex += b.exposed; }
      }
      const hs = cov.hits.filter((h) => names.includes(h.bucket)).map((h) => h.hoverMm).sort((a, b) => a - b);
      const q = (f: number) => (hs.length ? hs[Math.min(hs.length - 1, Math.floor(f * (hs.length - 1)))].toFixed(1) : "-");
      const le20 = hs.length ? ((hs.filter((h) => h <= 20).length / hs.length) * 100).toFixed(1) : "-";
      return { hit: sm ? ((sm - ex) / sm).toFixed(3) : "-", n: hs.length, le20, p25: q(0.25), med: q(0.5), p75: q(0.75) };
    };
    const tf = band(["top-front-left", "top-front-right"]);
    const tb = band(["top-back-left", "top-back-right"]);
    const dm = computeDrapeMetrics(sim, [PANEL_FRONT, PANEL_BACK], reconRange.xMin, reconRange.xMax);
    let crossed = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = reconRange.xMin; x <= reconRange.xMax; x++) {
        if (sim.positions[sim.index(PANEL_FRONT, x, y) * 3 + 2] < sim.positions[sim.index(PANEL_BACK, x, y) * 3 + 2]) crossed++;
      }
    }
    console.log(
      `  [${label}] cov ${(cov.exposedRatio * 100).toFixed(1)}% | tf hit ${tf.hit} 접촉 ${tf.le20}% (n=${tf.n}) med ${tf.med} p25/75 ${tf.p25}/${tf.p75} | tb hit ${tb.hit} 접촉 ${tb.le20}% (n=${tb.n}) med ${tb.med} | strain ${dm.maxStrain} | 교차 ${crossed} | Δ20 ${delta20.toFixed(2)}mm`,
    );
  };

  // 어깨 대역 천 평균 높이(row0~2) — 하강 궤적 추적.
  const shoulderClothY = (): number => {
    let sum = 0, n = 0;
    for (const panel of [PANEL_FRONT, PANEL_BACK]) {
      for (let y = 0; y <= 2; y++) {
        for (let x = reconRange.xMin; x <= reconRange.xMax; x++) {
          sum += sim.positions[sim.index(panel, x, y) * 3 + 1];
          n++;
        }
      }
    }
    return (sum / n) * 100;
  };

  // 수렴 지표 — 프레임당 최대 파티클 변위(mm). 최근 20프레임 최댓값을
  // 정착 판정에 쓴다(직전 PIN 스윕의 "수렴 미검증" 한계 대응).
  const prevFrame = new Float32Array(sim.positions.length);
  prevFrame.set(sim.positions);
  const deltaHist: number[] = [];
  const maxDelta20 = () => (deltaHist.length ? Math.max(...deltaHist.slice(-20)) : 0);

  // M2-7 착의 램프 — 스케줄러만(새 물리 없음). RAMP=1일 때만.
  // P1 하강 0~40%: LIFT 5.5→3.5 / P2 정착 40~55% / P3 해제 55~85%:
  // PIN 1.0→0.0 / P4 정착 85~100%.
  const ramp = process.env.RAMP === "1";
  const rampLiftTo = process.env.RAMP_LIFT ? Number(process.env.RAMP_LIFT) : 3.5;
  const basePinLY = framePose.pinLeft.y;
  const basePinRY = framePose.pinRight.y;
  const baseTopY = layout.topY;
  const applyRamp = (t: number) => {
    if (!ramp) return;
    const liftCm = t < 0.4 ? 5.5 + (rampLiftTo - 5.5) * (t / 0.4) : rampLiftTo;
    const delta = liftCm / 100 - 0.055;
    framePose.pinLeft.y = basePinLY + delta;
    framePose.pinRight.y = basePinRY + delta;
    layout.topY = baseTopY + delta;
    const pin = t < 0.55 ? 1 : t < 0.85 ? 1 - (t - 0.55) / 0.3 : 0;
    (env as { pinStrength?: number }).pinStrength = pin;
    // 램프 중에는 P1부터 연속 모드 — 중간에 모드가 바뀌면 그 지점이
    // 새 불연속이 된다.
    (env as { pinContinuous?: boolean }).pinContinuous = true;
  };

  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    applyRamp(f / FRAMES);
    session.step(SUBSTEP_DT, gravity, preset, layout, framePose);
    let md = 0;
    let mdIdx = -1;
    for (let i = 0; i < sim.positions.length; i += 3) {
      const d = Math.hypot(sim.positions[i] - prevFrame[i], sim.positions[i + 1] - prevFrame[i + 1], sim.positions[i + 2] - prevFrame[i + 2]);
      if (d > md) { md = d; mdIdx = i / 3; }
    }
    if (f >= FRAMES - 20 && md * 1000 > lastMaxDelta) { lastMaxDelta = md * 1000; lastMaxIdx = mdIdx; }
    deltaHist.push(md * 1000);
    if (process.env.TIMESERIES === "1" && md * 1000 >= 49.9) clampSaturated++;
    if (settleFrame < 0 && deltaHist.length >= 20 && maxDelta20() <= 5.6) settleFrame = f;
    if (process.env.DELTALOG === "1" && f % 50 === 0 && f > 0) {
      console.log(`  dlog f=${f} Δ20 ${maxDelta20().toFixed(2)}mm / 어깨높이 ${shoulderClothY().toFixed(2)}cm`);
    }
    prevFrame.set(sim.positions);
    // TIMESERIES=1: P3 시작(55%)~끝까지 5프레임 간격 — 크리프 vs 용량부족 판별.
    if (process.env.TIMESERIES === "1" && f >= Math.floor(FRAMES * 0.55) && f % 5 === 0) {
      const cov = quickCoverage();
      console.log(`  ts f=${f} (${((f / FRAMES) * 100).toFixed(0)}%) 어깨높이 ${shoulderClothY().toFixed(2)}cm / tf hit ${cov.tf} / tb hit ${cov.tb} / Δ20 ${maxDelta20().toFixed(2)}mm`);
    }
    if (ramp && (f === Math.floor(FRAMES * 0.4) - 1 || f === Math.floor(FRAMES * 0.55) - 1 || f === Math.floor(FRAMES * 0.85) - 1)) {
      snapshot(f === Math.floor(FRAMES * 0.4) - 1 ? "P1끝" : f === Math.floor(FRAMES * 0.55) - 1 ? "P2끝" : "P3끝", maxDelta20());
    }
  }
  const physMs = Number(((performance.now() - t0) / FRAMES).toFixed(3));

  const { xMin, xMax } = torsoColumnRange(COLS, pose.pinLeft, pose.pinRight, armLeft, armRight);
  const seamGapCm = (col: number, sleevePanel: number): number[] =>
    armholeRingVertices(sim, PANEL_FRONT, PANEL_BACK, col, armholeStartRow).map((pt, k) => {
      const si = sim.index(sleevePanel, k, 0) * 3;
      return Math.hypot(pt.x - sim.positions[si], pt.y - sim.positions[si + 1], pt.z - sim.positions[si + 2]) * 100;
    });
  const maxSeamGapCm = Math.max(...seamGapCm(xMin, PANEL_SLEEVE_LEFT), ...seamGapCm(xMax, PANEL_SLEEVE_RIGHT));
  const drape = computeDrapeMetrics(sim, [PANEL_FRONT, PANEL_BACK], xMin, xMax);
  const [shoulder, shoulderFree, torso, hem] = computeCapsuleGapChannels(
    sim, [PANEL_FRONT, PANEL_BACK], fixture.collision.capsules, capsuleGapBands(armholeStartRow, ROWS), xMin, xMax,
  );

  // 커버리지 — 어깨~겨드랑이 대역(옷 row0~armholeStartRow가 덮는 높이,
  // 행간격 = heightM/(ROWS-1)). 목 구멍은 원래 노출이 정상이라 목 축 주변
  // 수평 반경 제외 — 반경 9cm는 A-② 상태에서 넥라인 정상 개구부가 노출로
  // 안 잡히는 값으로 보정(calibrated)한 눈대중 초기값.
  const rowH = layout.heightM / (ROWS - 1);
  const coverage = computeBodyCoverage(
    position,
    [fixture.collision.frontIndex, fixture.collision.backIndex],
    sim,
    // 렌더와 같은 삼각형만(몸통 열 범위 + 소매 튜브 wrap) — 구 플랩 열은
    // 화면에 안 그리므로 지표에서도 덮개로 안 센다.
    [
      { panel: PANEL_FRONT, colMin: xMin, colMax: xMax },
      { panel: PANEL_BACK, colMin: xMin, colMax: xMax },
      { panel: PANEL_SLEEVE_LEFT, wrapCols: true },
      { panel: PANEL_SLEEVE_RIGHT, wrapCols: true },
    ],
    {
      yMin: bandTopY - rowH * (armholeStartRow + 0.5),
      yMax: bandTopY + 0.03,
      neckCenter: { x: (pose.pinLeft.x + pose.pinRight.x) / 2, y: 0, z: (pose.pinLeft.z + pose.pinRight.z) / 2 },
      neckRadius: 0.09,
      centerX: (pose.pinLeft.x + pose.pinRight.x) / 2,
      centerZ: fixture.collision.centerZ,
    },
  );

  console.log(`[paramSweep:fixture] ${FRAMES}프레임(${SECONDS}s), fabric=${pose.fabric}, 코어=${newCore ? "신(용접)" : "구"}, 워커 전체 파이프라인 재현`);
  console.log(`  coverage: 노출 ${coverage.exposed}/${coverage.samples} (${(coverage.exposedRatio * 100).toFixed(1)}%)`);
  console.log(`  coverage 버킷(노출/샘플):`, JSON.stringify(Object.fromEntries(Object.entries(coverage.buckets).map(([k, v]) => [k, `${v.exposed}/${v.samples}`]))));
  console.log(`  coverage 노출 예시:`, JSON.stringify(coverage.exposedExamples.slice(0, 5)));
  // 어깨 hover — top 버킷(어깨 상면)의 히트율 + 히트 거리(몸→천).
  {
    const band = (names: string[]) => {
      let samples = 0, exposed = 0, hoverSum = 0, hoverMax = 0;
      let hoverMaxAt: unknown = null;
      for (const nm of names) {
        const b = coverage.buckets[nm];
        if (!b) continue;
        samples += b.samples;
        exposed += b.exposed;
        hoverSum += b.hoverSumMm;
        if (b.hoverMaxMm > hoverMax) {
          hoverMax = b.hoverMaxMm;
          hoverMaxAt = b.hoverMaxAt;
        }
      }
      const hits = samples - exposed;
      return {
        hitRatio: samples ? Number((hits / samples).toFixed(3)) : 0,
        hoverMean: hits ? Number((hoverSum / hits).toFixed(2)) : 0,
        hoverMax: Number(hoverMax.toFixed(2)),
        hoverMaxAt,
      };
    };
    const tf = band(["top-front-left", "top-front-right"]);
    const tb = band(["top-back-left", "top-back-right"]);
    console.log(
      `  shoulderHover top-front: hit ${tf.hitRatio} / hover ${tf.hoverMean}|${tf.hoverMax}mm @ ${JSON.stringify(tf.hoverMaxAt)}`,
    );
    console.log(
      `  shoulderHover top-back : hit ${tb.hitRatio} / hover ${tb.hoverMean}|${tb.hoverMax}mm @ ${JSON.stringify(tb.hoverMaxAt)}`,
    );
    // 접촉률·분포 — **shoulderHover가 히트한 그 샘플 집합 그대로**(몸 표면
    // 좌표계 고정). 천 행 인덱스 대역은 쓰지 않는다.
    const dist = (names: string[], label: string) => {
      const hs = coverage.hits.filter((h) => names.includes(h.bucket)).map((h) => h.hoverMm).sort((a, b) => a - b);
      if (hs.length === 0) {
        console.log(`  contact ${label}: 히트 0`);
        return;
      }
      const q = (f: number) => hs[Math.min(hs.length - 1, Math.floor(f * (hs.length - 1)))].toFixed(1);
      const le = (v: number) => ((hs.filter((h) => h <= v).length / hs.length) * 100).toFixed(1);
      console.log(
        `  contact ${label}: 접촉률(<=20mm) ${le(20)}% / <=15mm ${le(15)}% | 분포 min ${q(0)} p10 ${q(0.1)} p25 ${q(0.25)} med ${q(0.5)} p75 ${q(0.75)} max ${q(1)} (n=${hs.length})`,
      );
    };
    dist(["top-front-left", "top-front-right"], "tf");
    dist(["top-back-left", "top-back-right"], "tb");
  }
  // 신구 대조에서 "새로 노출된 지점"을 집합 차로 특정하기 위한 전체 덤프.
  if (process.env.COVERAGE_DUMP) {
    writeFileSync(process.env.COVERAGE_DUMP, JSON.stringify(coverage.exposedExamples));
    console.log(`  coverage 전체 노출 좌표 → ${process.env.COVERAGE_DUMP}`);
  }
  // 잔물결 — 어깨~겨드랑이(row1~asr) 몸통 열, B-1류(스무딩 완화) 실패 감시.
  const ripple = computeRippleMm(sim, [PANEL_FRONT, PANEL_BACK], 1, armholeStartRow, xMin, xMax);
  console.log(`  ripple(2차차분=곡률): max ${ripple.maxMm}mm @ ${JSON.stringify(ripple.maxAt)} / mean ${ripple.meanMm}mm`);
  console.log(`  jitter(4차차분=지그재그): max ${ripple.jitterMaxMm}mm @ ${JSON.stringify(ripple.jitterMaxAt)} / mean ${ripple.jitterMeanMm}mm / 부호반전 ${ripple.signFlipRatio}`);
  // ④ 게이트: order 도입 사유(어깨 열 역전 → 찢어짐) 자체를 잰다.
  {
    const dx = pose.pinRight.x - pose.pinLeft.x;
    const dy = pose.pinRight.y - pose.pinLeft.y;
    const dz = pose.pinRight.z - pose.pinLeft.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ov = computeOrderViolations(sim, [PANEL_FRONT, PANEL_BACK], armholeStartRow, { x: dx / dl, y: dy / dl, z: dz / dl }, xMin, xMax);
    console.log(
      `  order위반: 열역전 어깨 ${ov.colInvShoulder} / 전체 ${ov.colInvAll} (max ${ov.colInvMaxMm}mm @ ${JSON.stringify(ov.colInvMaxAt)}) / 행역전 ${ov.rowInvAll} (max ${ov.rowInvMaxMm}mm)`,
    );
    console.log(`  bowtie(접힌 쿼드): 어깨 ${ov.bowtieShoulder} / 전체 ${ov.bowtieAll} @ ${JSON.stringify(ov.bowtieMaxAt)}`);
  }
  // M2 제거 ① 게이트: 앞뒤판 관통 — sidedness가 막던 바로 그것.
  // (a) 반평면 위반: 앞판이 centerZ보다 뒤, 뒤판이 앞. (b) 교차: 같은 (x,y)에서 front.z < back.z.
  {
    let halfPlaneViol = 0, halfPlaneMaxMm = 0, crossed = 0, crossMaxMm = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const fz = sim.positions[sim.index(PANEL_FRONT, x, y) * 3 + 2];
        const bz = sim.positions[sim.index(PANEL_BACK, x, y) * 3 + 2];
        const cz = fixture.collision.centerZ;
        if (fz < cz) { halfPlaneViol++; halfPlaneMaxMm = Math.max(halfPlaneMaxMm, (cz - fz) * 1000); }
        if (bz > cz) { halfPlaneViol++; halfPlaneMaxMm = Math.max(halfPlaneMaxMm, (bz - cz) * 1000); }
        if (fz < bz) { crossed++; crossMaxMm = Math.max(crossMaxMm, (bz - fz) * 1000); }
      }
    }
    const total = (xMax - xMin + 1) * ROWS;
    console.log(`  앞뒤판: 반평면위반 ${halfPlaneViol}/${total * 2} (max ${halfPlaneMaxMm.toFixed(1)}mm) / 교차 ${crossed}/${total} (max ${crossMaxMm.toFixed(1)}mm)`);
  }
  console.log(`  maxSeamGapCm: ${maxSeamGapCm.toFixed(2)} (브라우저 실측과 직접 대조용)`);
  console.log(`  drape: ${drape.faceAngleMeanDeg} / ${drape.faceAngleMaxDeg} / ${drape.wrinkleRmsMm} / ${drape.maxStrain}`);
  console.log(
    `  capsuleGap(mm): 어깨 ${shoulder.maxMm}|${shoulder.meanMm} / 어깨free ${shoulderFree.maxMm}|${shoulderFree.meanMm} / 몸통 ${torso.maxMm}|${torso.meanMm} / 밑단 ${hem.maxMm}|${hem.meanMm}`,
  );
  {
    const ringH = (row: number) => {
      let sum = 0, n = 0;
      for (let x = reconRange.xMin; x <= reconRange.xMax; x++) {
        for (const panel of [PANEL_FRONT, PANEL_BACK]) {
          sum += sim.positions[sim.index(panel, x, row) * 3 + 1];
          n++;
        }
      }
      return (sum / n) * 100;
    };
    const st = (row: number) => {
      const rest = reconRestAlways[row];
      return ((ringCircumference(row) / rest - 1) * 100).toFixed(1);
    };
    console.log(`  ring 신장률: row0 ${st(0)}% / row1 ${st(1)}% / row2 ${st(2)}% | row0 평균높이 ${ringH(0).toFixed(2)}cm`);
  }
  if (process.env.CONTACT === "1") {
    console.log(
      `  마찰접촉 발화율: 어깨 ${(contactShoulder / (contactShoulderN || 1) * 100).toFixed(2)}% (${(contactShoulder / (contactFrames || 1)).toFixed(1)}개/프레임) / 몸통 ${(contactTorso / (contactTorsoN || 1) * 100).toFixed(2)}% (${(contactTorso / (contactFrames || 1)).toFixed(1)}개/프레임)`,
    );
  }
  console.log(`  collar 발화 ${collarFired}회 (배선 검증 — 핀 고정 상태면 0이 정상)`);
  if (process.env.TIMESERIES === "1") console.log(`  Δ 클램프(50mm) 포화 프레임 ${clampSaturated}개 — 0이어야 연속`);
  {
    // Δ20 max 정점 위치 — max 인질 함정(6회) 때문에 위치 없이 판정 금지.
    const F = COLS * ROWS;
    const where = lastMaxIdx < 0 ? "?" : lastMaxIdx < F ? `앞판 x${lastMaxIdx % COLS} y${Math.floor(lastMaxIdx / COLS)}`
      : lastMaxIdx < F * 2 ? `뒤판 x${(lastMaxIdx - F) % COLS} y${Math.floor((lastMaxIdx - F) / COLS)}`
      : `소매 idx${lastMaxIdx - F * 2}`;
    console.log(`  Δ20 max 위치(마지막 20프레임): ${lastMaxDelta.toFixed(2)}mm @ ${where}`);
  }
  console.log(`  정착: Δ20<=5.6mm 도달 프레임 ${settleFrame < 0 ? "미도달" : settleFrame} / 총 ${FRAMES}`);
  snapshot(ramp ? "P4끝" : "최종", maxDelta20());
  console.log(`  물리 ${physMs}ms/프레임 (BVH+자체충돌 포함)`);
  if (process.env.RECON === "1") {
    for (const row of [0, 1, 2]) {
      const rest = reconRest[row];
      const now = ringCircumference(row);
      console.log(`  recon row${row} 링: rest ${(rest * 100).toFixed(2)}cm / 실측 ${(now * 100).toFixed(2)}cm / 신장률 ${((now / rest - 1) * 100).toFixed(1)}%`);
    }
    // 마네킹 단면 둘레 — 얇은 Y 슬랩의 XZ convex hull 둘레. 팔(T포즈로
    // 옆으로 뻗음)이 슬라이스에 섬으로 섞이지 않게 |x|<=0.22로 제한
    // (몸 표면 최대 x 20.5cm + 여유).
    const slicePerimeter = (yc: number, half: number): number => {
      const pts: [number, number][] = [];
      for (let i = 0; i < position.length; i += 3) {
        if (Math.abs(position[i + 1] - yc) > half) continue;
        if (Math.abs(position[i]) > 0.22) continue;
        pts.push([position[i], position[i + 2]]);
      }
      if (pts.length < 3) return 0;
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lower: [number, number][] = [];
      for (const pt of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
        lower.push(pt);
      }
      const upper: [number, number][] = [];
      for (let i = pts.length - 1; i >= 0; i--) {
        const pt = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
        upper.push(pt);
      }
      const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      let per = 0;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        per += Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      return per;
    };
    // 목: 어깨선 위 3~6cm 구간에서 최소 둘레. 어깨 통과: 어깨선 -2~+2cm
    // 구간에서 최대 둘레(천이 흘러내리며 넘어야 하는 최대 원주).
    const shoulderY = bandTopY - 0.055; // 핀에서 리프트 제거한 어깨선 근사
    let neckMin = Infinity;
    for (let yc = shoulderY + 0.03; yc <= shoulderY + 0.06; yc += 0.005) {
      const per = slicePerimeter(yc, 0.004);
      if (per > 0 && per < neckMin) neckMin = per;
    }
    let shoulderMax = 0;
    for (let yc = shoulderY - 0.02; yc <= shoulderY + 0.02; yc += 0.005) {
      const per = slicePerimeter(yc, 0.004);
      if (per > shoulderMax) shoulderMax = per;
    }
    console.log(`  recon 몸 단면: 목 최소 둘레 ${(neckMin * 100).toFixed(1)}cm / 어깨 통과 최대 둘레 ${(shoulderMax * 100).toFixed(1)}cm`);
  }
}

const fixturePath = process.env.FIXTURE;
if (fixturePath) {
  runFixture(fixturePath);
  process.exit(0);
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
console.log("[paramSweep] capsuleGap 채널 (어깨 max|mean / 어깨free(row0제외) max|mean / 몸통 max|mean / 밑단 max|mean, mm):");
for (const r of results) {
  const g = r.capsuleGap;
  console.log(
    `  품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm: ${g ? `${g.shoulder.maxMm}|${g.shoulder.meanMm} / ${g.shoulderFree.maxMm}|${g.shoulderFree.meanMm} / ${g.torso.maxMm}|${g.torso.meanMm} / ${g.hem.maxMm}|${g.hem.meanMm}` : "발산"}`,
  );
}

// 긴팔(58cm) 대표 1콤보 — 커프 U자 커브 최소값 유지가 실제로 망토화를
// 막는지 감시(46번 이력: 소매 중간~끝이 무방비면 평평한 망토로 퍼짐).
// 12콤보 전부 x2 길이로 돌리면 런타임 두 배라 대표 1개만.
const longSleeve = runCombo(0.55, 0.18, 0.58);
const ld = longSleeve.drape;
console.log(
  `[paramSweep] 긴팔(58cm) 품55/소매통18: ${ld ? `${ld.faceAngleMeanDeg} / ${ld.faceAngleMaxDeg} / ${ld.wrinkleRmsMm} / ${ld.maxStrain}` : "발산"} / 어깨갭 ${longSleeve.capsuleGap ? `${longSleeve.capsuleGap.shoulder.maxMm}|${longSleeve.capsuleGap.shoulder.meanMm}` : "-"} / 커프처짐 ${longSleeve.cuffDroopCm ?? "-"}cm / sleeve톱니 ${longSleeve.sleeveJaggednessDeg}° / 관통 ${longSleeve.maxPenetrationMm}mm / seamGap ${longSleeve.maxSeamGapCm}cm`,
);

const diverged = results.filter((r) => r.diverged);
if (diverged.length > 0) {
  console.error(`[paramSweep] ${diverged.length}개 조합 발산(NaN/Infinity):`, diverged.map((r) => `품${r.widthM * 100}cm/소매통${r.sleeveWidthM * 100}cm`));
  process.exit(1);
}
