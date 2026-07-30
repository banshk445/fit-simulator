// M1(신 코어) 용접 토폴로지 검사 — check:seambridge의 신 코어 대응물.
// 브리지("간격을 덮는 별도 메시")가 검사 대상이던 구 코어와 달리, 신
// 코어의 암홀은 용접이라 "간격이 구조적으로 존재하지 않음"을 검사한다.
// assert 실패 시 exit 1 (checkSleeveSeam.ts와 같은 회귀 스크립트 스타일).
import { buildUnifiedGarmentSim } from "../src/lib/buildUnifiedGarmentSim";
import { torsoColumnRange, type ArmDir } from "../src/lib/buildGarmentSim";
import { ARMHOLE_ROW_FRACTION, COLS, ROWS, SLEEVE_RING_COLS } from "../src/lib/clothConfig";
import type { Vec3Like } from "../src/lib/clothProtocol";

// 대표 포즈 — paramSweep.ts와 같은 출처.
const pinLeft: Vec3Like = { x: 0.2949635589615682, y: 1.4303697606877606, z: -0.029242269962628405 };
const pinRight: Vec3Like = { x: -0.29496387086321113, y: 1.4303699362752509, z: -0.02649089672959644 };
const dirLeft: Vec3Like = { x: 0.5599594528223114, y: -0.8272282597138395, z: 0.046247351553900105 };
const dirRight: Vec3Like = { x: -0.5600986940919868, y: -0.8270393076300492, z: 0.04791071395063927 };
const armLeft: ArmDir = { dir: dirLeft, length: 0.22 };
const armRight: ArmDir = { dir: dirRight, length: 0.22 };

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const armholeStartRow = Math.round(ROWS * ARMHOLE_ROW_FRACTION);
// 링 불변식 — check:seambridge에서 승계. 어긋나면 소매 인덱스 k가 row0을
// 조용히 넘어간다(sim.index 바운드 체크 없음).
check("링 불변식 2*(asr+1) === SLEEVE_RING_COLS", 2 * (armholeStartRow + 1) === SLEEVE_RING_COLS, `${2 * (armholeStartRow + 1)} vs ${SLEEVE_RING_COLS}`);

const { sim } = buildUnifiedGarmentSim(0.55, 0.7, pinLeft.y, (pinLeft.z + pinRight.z) / 2, pinLeft, pinRight, armLeft, armRight, 0.18, undefined, true);
const { aliases, canons } = sim.weldPairs;
const n = sim.positions.length / 3;

// 1) 용접 쌍 수 — 좌우 각 링 12쌍.
check("용접 쌍 수 = 2*SLEEVE_RING_COLS", aliases.length === 2 * SLEEVE_RING_COLS, `${aliases.length}`);

// 2) alias는 전부 소매 row0, canon은 전부 몸판(앞/뒤) 암홀 가장자리 열.
const sleeveStart = sim.panelParticleStart(2);
const torsoEnd = sim.panelParticleStart(2); // 앞+뒤 몸판 구간의 끝
const { xMin, xMax } = torsoColumnRange(COLS, pinLeft, pinRight, armLeft, armRight);
let aliasesOk = true;
let canonsOk = true;
let canonColOk = true;
for (let i = 0; i < aliases.length; i++) {
  const a = aliases[i];
  const c = canons[i];
  const panel = a >= sim.panelParticleStart(3) ? 3 : 2;
  const local = a - sim.panelParticleStart(panel);
  if (a < sleeveStart || Math.floor(local / SLEEVE_RING_COLS) !== 0) aliasesOk = false;
  if (c >= torsoEnd) canonsOk = false;
  const col = (c % (COLS * ROWS)) % COLS;
  if (col !== xMin && col !== xMax) canonColOk = false;
}
check("alias 전부 소매 row0", aliasesOk);
check("canon 전부 몸판 파티클", canonsOk);
check("canon 열 = xMin 또는 xMax", canonColOk, `xMin=${xMin} xMax=${xMax}`);

// 3) 제약 무결성: 자기 제약 0, alias를 참조하는 제약 0, 중복 canonical 쌍 0.
const aliasSet = new Set<number>(Array.from(aliases));
let selfCount = 0;
let aliasRefCount = 0;
let dupCount = 0;
const seen = new Set<number>();
for (const c of sim.constraintPairs) {
  if (c.a === c.b) selfCount++;
  if (aliasSet.has(c.a) || aliasSet.has(c.b)) aliasRefCount++;
  const key = Math.min(c.a, c.b) * n + Math.max(c.a, c.b);
  if (seen.has(key)) dupCount++;
  seen.add(key);
}
check("자기 자신 제약 0", selfCount === 0, `${selfCount}`);
check("alias 참조 제약 0", aliasRefCount === 0, `${aliasRefCount}`);
check("중복 제약 0", dupCount === 0, `${dupCount}`);

// 4) alias 고정 + 좌표 일치(빌드 직후).
let pinnedOk = true;
let coincideOk = true;
for (let i = 0; i < aliases.length; i++) {
  if (!sim.pinned[aliases[i]]) pinnedOk = false;
  for (let k = 0; k < 3; k++) {
    if (sim.positions[aliases[i] * 3 + k] !== sim.positions[canons[i] * 3 + k]) coincideOk = false;
  }
}
check("alias 전부 pinned", pinnedOk);
check("alias 좌표 = canon 좌표(비트)", coincideOk);

// 5) 플래그 격리 — 구 코어 빌드엔 용접 없음.
const old = buildUnifiedGarmentSim(0.55, 0.7, pinLeft.y, (pinLeft.z + pinRight.z) / 2, pinLeft, pinRight, armLeft, armRight, 0.18, undefined, false);
check("구 코어 weldPairs 비어 있음", old.sim.weldPairs.aliases.length === 0);

if (failures > 0) {
  console.error(`[checkWeldTopology] ${failures}개 실패`);
  process.exit(1);
}
console.log("[checkWeldTopology] 전부 통과");
