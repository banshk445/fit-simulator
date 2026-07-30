// v2 Stage 2a-thin 스파이크 전용 — **조악한** 패널 4매(직선 경계 사각 몸판 2 +
// 직사각 소매 2)와 시접 테이블.
//
// 왜 조악한가: 이 스파이크가 소진하려는 리스크는 "봉제 착장 상태기계의 코드
// 경로가 수렴하는가"뿐이고, 패턴 제도(곡선 경계·삼각화·grading)는 그 뒤다
// (v2-design §1.3 — 실패 시 패턴 작업 착수 금지). **형식만 실물과 동일**하다:
// 시접 테이블, 하네스 공유, 상태 전이 로그.
//
// 반대로 조악해도 **안 되는 것**은 하드코딩이다(규범 1) — 치수는 전부 몸
// 메시·팔 축·제품 상수에서 도출한다. 여기서 상수를 박으면 2c 체형 슬라이더가
// 따라오지 못하고, 스파이크가 "이 fixture에서만 수렴"을 증명하게 된다.
//
// ponytail: 단면 둘레는 x·z 범위의 타원 근사(Ramanujan)다 — 실제 단면
// 폴리곤 둘레가 아니다. 볼록에 가까운 몸통에서 오차 수 %이고, 스파이크의
// 판정(수렴/발산)을 바꿀 수 없다. 정식 둘레 측정은 Stage 2a 패턴 제도에서
// 경계 곡선을 뽑을 때 같이 온다.
import { ClothSimulation } from "./clothPhysics";
import type { Vec3Like } from "./clothProtocol";
import { ARM_AXIS_RADIUS, nearestOnSegments } from "./bodySkeleton";
import type { Segment } from "./bodySkeleton";
import { ARM_COLLISION_RADIUS, COLLISION_MARGIN, SEAM_REST_LENGTH, SPIKE_EDGE_M } from "./clothConfig";

export interface SpikeArm {
  trueShoulder: Vec3Like;
  dir: Vec3Like;
  length: number;
}

export interface SeamEntry {
  a: number;
  b: number;
  // 램프의 도착점. 이즈 0 — 시접 전체가 같은 target을 쓴다(v1의
  // SEAM_EASE_START 테이퍼는 이즈인이므로 스파이크에선 뺀다).
  target: number;
  // 진단용 라벨(발산 시 어느 시접인지 보고).
  kind: "shoulder" | "side" | "armhole" | "wrap";
}

export interface SpikeGarment {
  sim: ClothSimulation;
  seams: SeamEntry[];
  // 자체충돌 예외(§4 S2: 시접 테이블에서 도출한 전체 인접 집합).
  seamSkipPairs: { a: number; b: number }[];
  panelStarts: number[];
  panelCols: number[];
  dims: {
    cols: number; rows: number;              // 몸판
    sleeveCols: number; sleeveRows: number;   // 소매(cols=팔 둘레 방향)
    armholeRow: number;
    girthM: number; heightM: number; edgeM: number;
    neckGapCols: number;
  };
  // S0 재배치용 — 오프셋 배수를 바꿔 다시 놓는다(RETRY 전략).
  place(offsetScale: number): void;
}

export const PANEL_SPIKE_FRONT = 0;
export const PANEL_SPIKE_BACK = 1;
export const PANEL_SPIKE_SLEEVE_L = 2;
export const PANEL_SPIKE_SLEEVE_R = 3;

// Ramanujan 근사 — 반축 a,b 타원의 둘레.
function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export function buildSpikeGarment(
  position: Float32Array,
  // 팔 제외 몸통 인덱스(frontIndex+backIndex) — 단면 실측용.
  torsoIndex: ArrayLike<number>,
  arms: readonly [SpikeArm, SpikeArm],
  // 골격(`deriveBodySkeleton` 산출) — 단면 실측에서 팔을 빼는 데만 쓴다
  // (소매 배치는 위 `arms`의 옷 기준 길이를 쓴다).
  skeleton: { segments: readonly Segment[]; arms: readonly Segment[] },
  // 몸통 축 하단 = 토르소 프록시 캡슐 골반 하단(bodySkeleton과 **같은 출처** —
  // 몸 메시 최저점(발)을 쓰면 옷이 다리까지 내려온다).
  hemY: number,
  centerZ: number,
  edgeM = SPIKE_EDGE_M,
): SpikeGarment {
  const shoulderY = Math.max(arms[0].trueShoulder.y, arms[1].trueShoulder.y);
  const heightM = shoulderY - hemY;

  // 팔(전완·손 포함) 제외 판정 — `torsoIndex`(=splitFrontBack 산출)는 팔 축
  // 근방 삼각형만 뺀 것이라 **손이 남아 있다**. 이 마네킹은 팔이 59° 하향
  // 자세라 손이 골반 높이(y 0.78~0.93)에 오고, 그 슬라이스의 x폭이 1.08m로
  // 잡혀 둘레가 228cm(실제 몸통 98cm)로 측정된다 — 첫 실행에서 실제로 이
  // 오염이 잡혔다. 반경은 ARM_AXIS_RADIUS로 통일한다(함정 6: 대역·기준을
  // 서로 다른 몸에서 가져오지 않는다).
  //
  // 판정 규칙은 **"최근접 골격 선분이 팔이면 팔"**이다 — 상수가 하나도 없고
  // 골격이 곧 몸의 분해라는 정의를 그대로 쓴다. 두 번의 오진을 거쳐 여기
  // 왔고 둘 다 실측으로 잡혔다: (1) `ArmShape.length`(0.22m)는 **옷 소매
  // 길이**라 축이 상완 중간에서 끝나 전완·손이 29~46cm 밖에 남았다.
  // (2) 축을 손끝까지 늘려도 반경 게이트(ARM_AXIS_RADIUS 9cm)로는 손이 안
  // 빠진다 — 손은 축에서 9cm보다 넓어서, 골반 슬라이스 x폭이 1.07m로
  // 남아 둘레가 224cm(실제 ~85cm)로 계속 측정됐다.
  const armSegSet = new Set(skeleton.arms);
  const onArm = (x: number, y: number, z: number): boolean =>
    armSegSet.has(nearestOnSegments(x, y, z, skeleton.segments).segment);

  // 몸통 둘레 — 어깨~밑단 대역을 슬라이스해 최댓값(가슴 또는 어깨).
  const SLICES = 12;
  const step = heightM / SLICES;
  let girthM = 0;
  let bodyCenterX = 0;
  let maxDepth = 0;
  {
    let centerSamples = 0;
    for (let s = 0; s <= SLICES; s++) {
      const y0 = hemY + step * s;
      let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity, cnt = 0;
      for (let t = 0; t < torsoIndex.length; t++) {
        const vi = torsoIndex[t];
        const y = position[vi * 3 + 1];
        if (Math.abs(y - y0) > step / 2) continue;
        const x = position[vi * 3], z = position[vi * 3 + 2];
        if (onArm(x, y, z)) continue;
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (z < zMin) zMin = z; if (z > zMax) zMax = z;
        cnt++;
      }
      if (cnt === 0) continue;
      const g = ellipsePerimeter((xMax - xMin) / 2, (zMax - zMin) / 2);
      if (g > girthM) girthM = g;
      if (zMax - zMin > maxDepth) maxDepth = zMax - zMin;
      bodyCenterX += (xMin + xMax) / 2;
      centerSamples++;
    }
    bodyCenterX /= Math.max(1, centerSamples);
  }

  // 몸판 1매 = 둘레의 절반(앞판+뒤판 = 폐곡 튜브). 이즈는 시접의 이즈인을
  // 말하며(0), 옷 여유가 아니다 — 여유 0이면 애초에 안 닫혀 스파이크가
  // 상태기계가 아니라 기하를 재게 된다.
  const panelWidth = girthM / 2;
  const cols = Math.max(4, Math.round(panelWidth / edgeM) + 1);
  const rows = Math.max(4, Math.round(heightM / edgeM) + 1);
  // 암홀 깊이 = 팔 둘레의 절반(= π·r). 앞뒤 두 변을 합쳐 만든 암홀 루프
  // 길이가 팔 둘레와 같아져 소매 머리와 1:1로 맞는다(표본수 불일치는
  // 암홀 리샘플링 4연속 실패의 구조였다 — §8 "다시 열지 않는 항목").
  const armholeRow = Math.max(2, Math.round((Math.PI * ARM_COLLISION_RADIUS) / edgeM));
  const sleeveCols = 2 * (armholeRow + 1);
  const sleeveRows = Math.max(3, Math.round(Math.max(arms[0].length, arms[1].length) / edgeM) + 1);

  const sim = new ClothSimulation([
    { cols, rows },
    { cols, rows },
    { cols: sleeveCols, rows: sleeveRows },
    { cols: sleeveCols, rows: sleeveRows },
  ]);

  // ── 1단계: 2D 패턴을 평면에 눕힌다. buildConstraints()가 **이 좌표에서**
  // rest length를 굳히므로, 이 시점의 배치가 곧 "패턴"이다. 소매를 미리
  // 굽혀놓고 굳히면 그 곡률이 패턴에 박혀 실물과 형식이 달라진다.
  const dx = panelWidth / (cols - 1);
  const dy = heightM / (rows - 1);
  const sdx = (sleeveCols * edgeM) / (sleeveCols - 1); // wrap 엣지 1개 포함 둘레
  const sdy = Math.max(arms[0].length, arms[1].length) / (sleeveRows - 1);
  for (const panel of [PANEL_SPIKE_FRONT, PANEL_SPIKE_BACK]) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) sim.setParticle(sim.index(panel, x, y), x * dx, -y * dy, panel * 1);
    }
  }
  for (const panel of [PANEL_SPIKE_SLEEVE_L, PANEL_SPIKE_SLEEVE_R]) {
    for (let y = 0; y < sleeveRows; y++) {
      for (let x = 0; x < sleeveCols; x++) sim.setParticle(sim.index(panel, x, y), x * sdx, -y * sdy, 2 + panel);
    }
  }
  sim.buildConstraints();

  // ── 2단계: S0 배치(몸 기준 도출). 몸판은 앞/뒤 오프셋 평면, 소매는 팔 축
  // 둘레 반원통 프리벤드(§4 S0).
  const halfDepth = maxDepth / 2;
  const place = (offsetScale: number): void => {
    const offset = (halfDepth + COLLISION_MARGIN * 2) * offsetScale;
    for (const [panel, sign] of [[PANEL_SPIKE_FRONT, 1], [PANEL_SPIKE_BACK, -1]] as const) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // 앞판은 왼→오, 뒤판은 오→왼(뒤에서 봤을 때 같은 방향) — 옆선
          // 시접이 같은 col에서 만나게 하는 규약. 이게 어긋나면 옆선이
          // 몸을 관통해 이어진다.
          const u = sign > 0 ? x : cols - 1 - x;
          sim.setParticle(
            sim.index(panel, x, y),
            bodyCenterX - panelWidth / 2 + u * dx,
            shoulderY - y * dy,
            centerZ + sign * offset,
          );
        }
      }
    }
    // 소매: 팔 축 주위 원통. 축 직교 기저(e1,e2)를 팔 방향에서 도출.
    for (const [panel, arm] of [[PANEL_SPIKE_SLEEVE_L, arms[0]], [PANEL_SPIKE_SLEEVE_R, arms[1]]] as const) {
      const d = arm.dir;
      const up = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const e1 = norm(cross(d, up));
      const e2 = norm(cross(d, e1));
      const radius = ARM_COLLISION_RADIUS + COLLISION_MARGIN * offsetScale;
      const axialStep = arm.length / (sleeveRows - 1);
      for (let y = 0; y < sleeveRows; y++) {
        for (let x = 0; x < sleeveCols; x++) {
          const th = (x / sleeveCols) * Math.PI * 2;
          const t = y * axialStep;
          sim.setParticle(
            sim.index(panel, x, y),
            arm.trueShoulder.x + d.x * t + (e1.x * Math.cos(th) + e2.x * Math.sin(th)) * radius,
            arm.trueShoulder.y + d.y * t + (e1.y * Math.cos(th) + e2.y * Math.sin(th)) * radius,
            arm.trueShoulder.z + d.z * t + (e1.z * Math.cos(th) + e2.z * Math.sin(th)) * radius,
          );
        }
      }
    }
  };
  place(1);

  // ── 3단계: 시접 테이블. rest는 **현재 갭**으로 등록하고 S1이 target까지
  // 램프한다(§4 S1) — 처음부터 target으로 넣으면 S0 배치 갭이 한 프레임에
  // 폭발적으로 당겨져 그게 곧 발산이다.
  const seams: SeamEntry[] = [];
  const gap = (a: number, b: number): number =>
    Math.hypot(
      sim.positions[b * 3] - sim.positions[a * 3],
      sim.positions[b * 3 + 1] - sim.positions[a * 3 + 1],
      sim.positions[b * 3 + 2] - sim.positions[a * 3 + 2],
    );
  // 격자 제약과 **같은 쌍**을 시접으로 또 등록하면, rest 램프(배율 API로
  // 구현 — dressingMachine.setRest)가 그 격자 제약의 rest까지 같이 줄인다.
  // 조용히 패턴이 바뀌는 오염이라 등록 시점에 막는다.
  const gridPairs = new Set(sim.constraintPairs.map(({ a, b }) => Math.min(a, b) * 1_000_000 + Math.max(a, b)));
  const sew = (a: number, b: number, kind: SeamEntry["kind"]): void => {
    const k = Math.min(a, b) * 1_000_000 + Math.max(a, b);
    if (gridPairs.has(k)) throw new Error(`시접 ${kind}가 격자 제약과 같은 쌍(${a},${b}) — 위상 오류`);
    gridPairs.add(k);
    seams.push({ a, b, target: SEAM_REST_LENGTH, kind });
    sim.addConstraint(a, b, gap(a, b));
  };

  // 어깨선 — row0 전체에서 목 구멍(중앙)만 뺀다. 목 구멍 폭은 **어깨 관절
  // 간격에서 좌우 팔 반경을 뺀 값**으로 도출한다: 관절 사이 구간에서 삼각근
  // 반경만큼은 어깨이고 그 안쪽이 목이다. v1 어깨 핀(pinLeft/Right)을 쓰면
  // 안 된다 — 그 두 점은 몸판용으로 바깥으로 밀어낸 옷 좌표라 간격이 실제
  // 관절보다 4.5cm씩 넓고(첫 실행: 목구멍 19열/47열 = 어깨선이 사실상 전부
  // 개방), 그러면 옷을 잡아줄 어깨 시접이 남지 않는다.
  const neckCenterX = (arms[0].trueShoulder.x + arms[1].trueShoulder.x) / 2;
  const neckHalf = Math.max(edgeM, Math.abs(arms[1].trueShoulder.x - arms[0].trueShoulder.x) / 2 - ARM_AXIS_RADIUS);
  let neckGapCols = 0;
  for (let x = 0; x < cols; x++) {
    const worldX = bodyCenterX - panelWidth / 2 + x * dx;
    if (Math.abs(worldX - neckCenterX) < neckHalf) { neckGapCols++; continue; }
    // 앞판 col x ↔ 뒤판 같은 물리 위치의 col — 배치 규약(u 반전)에 맞춰
    // 뒤판은 cols-1-x.
    sew(sim.index(PANEL_SPIKE_FRONT, x, 0), sim.index(PANEL_SPIKE_BACK, cols - 1 - x, 0), "shoulder");
  }

  // 옆선 — 암홀 아래 전 행. 앞판 x=0 ↔ 뒤판 x=cols-1(같은 쪽 옆구리).
  for (let y = armholeRow + 1; y < rows; y++) {
    sew(sim.index(PANEL_SPIKE_FRONT, 0, y), sim.index(PANEL_SPIKE_BACK, cols - 1, y), "side");
    sew(sim.index(PANEL_SPIKE_FRONT, cols - 1, y), sim.index(PANEL_SPIKE_BACK, 0, y), "side");
  }

  // 암홀 — 소매 머리(row0, 둘레 방향 k) ↔ 몸판 옆 변의 루프.
  // 루프 규약: 앞판 위→아래(0..armholeRow) → 뒤판 아래→위(armholeRow..0).
  // 앞판 x=0 쪽이 arms[0](왼팔) 소매, x=cols-1 쪽이 arms[1].
  const armholeLoop = (frontCol: number, backCol: number): number[] => {
    const loop: number[] = [];
    for (let y = 0; y <= armholeRow; y++) loop.push(sim.index(PANEL_SPIKE_FRONT, frontCol, y));
    for (let y = armholeRow; y >= 0; y--) loop.push(sim.index(PANEL_SPIKE_BACK, backCol, y));
    return loop;
  };
  for (const [panel, frontCol, backCol] of [
    [PANEL_SPIKE_SLEEVE_L, 0, cols - 1],
    [PANEL_SPIKE_SLEEVE_R, cols - 1, 0],
  ] as const) {
    const loop = armholeLoop(frontCol, backCol);
    if (loop.length !== sleeveCols) throw new Error(`armhole 표본수 불일치: ${loop.length} vs 소매 ${sleeveCols}`);
    for (let k = 0; k < sleeveCols; k++) sew(loop[k], sim.index(panel, k, 0), "armhole");
    // 소매 통 wrap(마지막 열 ↔ 0열) = 안쪽 소매 시접.
    for (let y = 0; y < sleeveRows; y++) sew(sim.index(panel, sleeveCols - 1, y), sim.index(panel, 0, y), "wrap");
  }

  return {
    sim,
    seams,
    seamSkipPairs: seams.map(({ a, b }) => ({ a, b })),
    panelStarts: [0, 1, 2, 3].map((p) => sim.panelParticleStart(p)),
    panelCols: [cols, cols, sleeveCols, sleeveCols],
    dims: { cols, rows, sleeveCols, sleeveRows, armholeRow, girthM, heightM, edgeM, neckGapCols },
    place,
  };
}

function cross(a: Vec3Like, b: Vec3Like): Vec3Like {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v: Vec3Like): Vec3Like {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
