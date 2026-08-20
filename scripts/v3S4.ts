/* v3-18 — S4 첫 착장. 해상도 도출(#32) · 패턴 제도 · 배치 · 봉제 · 시험 7종.
 *
 * 진입: `npm run v3:s4`   (부분 실행: `ONLY=0,1,2 npm run v3:s4`)
 *
 * ── 절대 조항 ────────────────────────────────────────────────────────────
 * 흡착·인력 항 0 · 앵커 0 · 핀 0 · 원주 상한 0. `invMass = 0` 정점을 하나도 두지
 * 않는다(§4-⑤가 값으로 확인한다). v2 코드 임포트 0 — `pattern-meta.json`은 «데이터»로
 * 읽고 패널 기하는 이 파일이 «제도»한다(v3-17 §1 결정).
 *
 * ── 문턱은 실행 «전»에 고정한다 ──────────────────────────────────────────
 *   ① 초기 적법성   몸 정확 거리 > 두께 · 패널 간 최소 거리 ≥ 2×두께
 *   ② 봉제 자기검사 대응 1:1 · 양쪽 정지 길이 차 ≤ 1% · 미대응 경계 0
 *   ③ 어깨 유지     어깨 이음선 평균 y 낙하 ≤ 5cm  (v2 2b 1차는 59.6cm 낙하했다.
 *                   문턱은 「달성이 실증된 수준」이 아니라 «설계 §4 S4 ①»이 건 조건
 *                   「어깨에 남는다」를 값으로 옮긴 것이다 — 어깨 대역 폭의 절반)
 *   ④ 목선 원주     3D 링 / 정지 링 ≤ 1.10          (설계 §4 S4 ② 원문)
 *   ⑤ 보조 장치 0   invMass=0 정점 0 · 흡착 0 · 원주 상한 0
 *   ⑥ 몸 관통       최대 관통 / P_pred_ext ∈ [0.5, 1.25]  (v3-16 §5 등록 구간)
 *   ⑦ 자기교차      비인접 쌍 최소 거리 ≥ 2×두께 − 0.1mm (S3b ② 문턱 그대로) · 발산 0
 *
 * ── v3-19 추가 등록 (§5 착장 · 실행 «전»에 고정) ─────────────────────────
 * **해상도 d = 11.0 mm 고정.** ①느슨(ℓ/2 = 11.65mm)을 만족하는 «가장 큰» 값이다.
 * 설계 R3이 「2~3×」로 적었으므로 2×는 범위 안이고, **①엄격(ℓ/3 = 7.77mm)은 미달**이다
 * — 미달을 명시해 등재한다. **결과를 보고 d를 바꾸지 않는다.**
 * 95초 예산(§0-④)은 «제품» 용도의 값이고 이 판은 «물리 검증» 1회 오프라인 실행이다
 * (전략 세션 판정 — 층위 분리 · 문턱 완화가 아니다). **제품 예산 95초는 그대로 유효**하고
 * **S4 통과가 제품 가능성을 뜻하지 않는다.**
 *
 *   정착   `|v|max ≤ 6.0 mm/s` 가 **3프레임 연속**. 도출: S3b ②가 등록한 허용오차
 *          0.1mm(한 서브스텝 재수렴 폭)를 «프레임 이동»으로 환산 = 0.1mm ÷ (1/60 s).
 *          그 속도면 한 프레임의 이동이 접촉/분리 판정을 바꾸지 못한다.
 *          참고 채널로 10배 엄격한 0.6mm/s 도달 프레임도 함께 찍는다.
 *   상한   600프레임. v2가 같은 옷을 정착시킨 실측이 DONE f=369(P34 회귀)이므로
 *          그 1.6배. 상한에 걸리면 «미정착»으로 적고 갈래 F로 간다(추정 0).
 *   체크    25프레임마다 상태 저장. 8.5s/f 실측이므로 손실 상한 ≈ 3.5분.
 *          형식: uint32 헤더길이 + JSON 헤더 + Float64 pos(3n) + Float64 vel(3n).
 *
 * ① 걸린다   (a) 어깨 이음선 평균 y 낙하 ≤ 5cm  (v3-18 등록분 그대로 · v2 2b는 59.6cm)
 *            (b) 어깨 대역(y ≥ 겨드랑이 높이) 접촉 정점 > 0
 *            (c) 정착 문턱 도달
 *            (d) 목선 링 원주 / 정지 ≤ 1.10   (설계 §4 S4 ② 원문)
 * ② 관통     실측 최대 관통 / P_pred_ext(그 점) ∈ [0.5, 1.25]  (v3-16 §1 통계 그대로:
 *            근방 = h 이내 · 축약 = 최대 · c = 0.283 · f(θ)=min(1,θ/(π/2)))
 * ③ 자기관통 삼각형–삼각형 «교차» 0 (S3b 판정기 정의 그대로 · 인접 쌍 제외)
 * ④ 시접     봉합 쌍 간극 − 2×두께 의 중앙·p95·최대를 산출. §3 자기검사와 대조
 * ⑤ 보조 0   invMass=0 정점 0 · 앵커 0 · 핀 0 · 원주 상한 0 · 흡착 항 0
 * ⑥ 비용     총 벽시계 · 프레임당 · 단계별 비중
 * ⑦ 화면     front · sideXplus · back — **CC 판정 0**
 *
 * 진단 전용 스위치(판정에 쓰지 않는다):
 *   `DIAG=1` 패널별 최소각 위치 + 비인접 최소 거리 쌍의 소속 패널
 *   `DIAG=2` 해상도 8종에서 최소각·종횡비 — #33(최소각이 d의 함수가 «아니다»)의 근거
 */
import { bakeSdf, deriveSpacing, sampleSdf, type GridSdf } from '../src/v3/bodySdf.ts';
import { readGlb, weldMap } from './v3Glb.ts';
import {
  makeSolver, makeInplane, makeBend, assignMassFromMesh,
  substepsForBending, substepsForCloth, step, selfStats, collisionStats, stepDiag,
  type Constraint, type DistanceConstraint, type SolverParams, type Solver,
} from '../src/v3/solver.ts';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { render, writePng, VIEWS, type Mesh } from './v3Render.ts';

const GLB = process.env.GLB ?? 'public/models/mannequin.glb';
const META = process.env.META ?? 'scripts/fixtures/pattern-meta.json';
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const run = (k: string) => ONLY.length === 0 || ONLY.includes(k);

/* ── 상수는 «전부» 앞 회차에서 온다. 이 판이 새로 정하는 손 상수 0 ─────────── */
const G = 9.81;
const DT = 1 / 60;
/** 멤브레인 강성 [N/m] — S3·S3b와 «같은 값» */
const KMEM = Number(process.env.MATK ?? 100);
/** 시험용 원단 — ARCSim gray-interlock. S3·S3b·v3-16과 «같은 값» */
const MAT = { rho: Number(process.env.MATRHO ?? 0.187), B: Number(process.env.MATB ?? 23.191698e-6) };
/** 옷 두께 [m] — S3·S3b·v3-13과 «같은 값». 옷–옷 분리 거리는 2× */
const THICK = 1e-3;
const SEP = 2 * THICK;
/** 마찰계수 — v3-16과 «같은 값». 출처 미확보(#23)는 그대로 이월 */
const MU = 0.3;
/** 속도 감쇠 [1/s] — v3-16 상완 장면과 «같은 값» */
const DAMP = 6;
/** SDF 메모리 예산 — v3-13이 상주 GLB 자산에 앵커해 정한 값 그대로 */
const SDF_BUDGET = 64 * 1024 * 1024;
/** v3-19 고정 해상도 [m] — §0 헤더의 등록 사유 참고. env는 진단용이다. */
const D_FIXED = Number(process.env.D_MM ?? 11) / 1000;
/** S3b ② 허용오차 — 한 서브스텝의 재수렴 폭. v3-12 등록분 그대로 */
const TOL_SELF = 1e-4;
/** 정착 문턱 [m/s] — S3b ② 허용오차(0.1mm)를 «프레임 이동»으로 환산. 헤더 참고 */
const V_SETTLE = TOL_SELF / DT;

/* ══ §1 패턴 제도 — 치수는 메타를 «데이터»로 읽는다 ═══════════════════════ */

type Meta = {
  patternHash: string;
  garmentDims: { lengthM: number; widthM: number; shoulderWidthM: number; sleeveLengthM: number; sleeveWidthM: number };
  dims: { neckHalfWidthCm: number; armholeGirthCm: number; capHeightCm: number; necklineGirthCm: number };
  seamCounts: Record<string, number>;
  panelCounts: number[];
  triangles: number;
};
const meta: Meta = JSON.parse(readFileSync(META, 'utf8'));
const MD = meta.garmentDims;
const L = MD.lengthM;              // 총장
const W = MD.widthM;               // 품(평면 패널 폭)
const SW = MD.shoulderWidthM;      // 어깨 너비
const SLEN = MD.sleeveLengthM;     // 소매 길이
const NECK_A = meta.dims.neckHalfWidthCm / 100;    // 목선 반폭
const ARM_G = meta.dims.armholeGirthCm / 100;      // 암홀 둘레(앞+뒤)
const CAP_H = meta.dims.capHeightCm / 100;         // 소매산 높이
const NECK_G = meta.dims.necklineGirthCm / 100;    // 목선 둘레(앞+뒤)

type Pt = [number, number];
type Curve = (t: number) => Pt;


/** 곡선 길이(적응 없는 균일 분할 — 분할 수를 2배로 올려 수렴 확인) */
function arcLen(c: Curve, n = 4096): number {
  let s = 0;
  let p = c(0);
  for (let i = 1; i <= n; i++) {
    const q = c(i / n);
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
    p = q;
  }
  return s;
}

/** f(b) = 목표가 되도록 b를 이분법으로 푼다. 모든 「치수 도출」이 이걸 쓴다. */
function solveB(target: number, f: (b: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/* ── 곡선족 — «패치 모서리에서 접선이 겹치지 않게» 고른다 ─────────────────
 * 구조 격자(Coons)에서 패치 «모서리»의 두 경계 접선이 나란하면 그 칸이 원리적으로
 * 납작해진다(초판: 소매 겨드랑이 모서리 최소각 3.6°). 그래서 곡선족을 모서리 조건
 * 에서 고른다 — 결과를 보고 문턱을 내리는 것이 아니라 «제도»를 고치는 것이다.
 *   암홀  겨드랑이에서 «수직»(옆선과 매끈 · 변 중간이라 무해) · 어깨에서 유한각
 *   소매산 겨드랑이에서 «수평»(옆선과 90°) · 꼭지에서 «수평»(좌우 매끈)
 *   목선  어깨에서 «수직»(어깨선과 90°) · 중앙에서 «수평»(좌우 매끈) = 사분 타원
 * 길이는 전부 메타에서 이분법으로 «푼다» — 모양을 고쳐도 봉제 길이는 그대로다. */
const ARM_A = (W - SW) / 2;
/** 암홀 반쪽: (a,0) → (0,b) 를 (cos(πt/2), t) 로. 겨드랑이 수직 · 어깨 유한각 */
const famArm = (a: number, b: number): Curve => (t) => [a * Math.cos((t * Math.PI) / 2), b * t];
/** 소매산 반쪽: (a,0) → (0,b) 를 (1−t, (1−cos πt)/2) 로. 양 끝 «수평» */
const famCap = (a: number, b: number): Curve => (t) => [a * (1 - t), (b / 2) * (1 - Math.cos(Math.PI * t))];

const ARM_D = solveB(ARM_G / 2, (b) => arcLen(famArm(ARM_A, b)), 1e-4, 2);
const CAP_W = solveB(ARM_G / 2, (a) => arcLen(famCap(a, CAP_H)), 1e-4, 2);
/** 목선 반쪽: (a,0) → (0,b) 를 «양 끝 수평»으로. 어깨선과 C¹로 이어지므로
 * 위 경계에 «모서리가 없다» — 초판은 여기서 90° 모서리가 나서 Coons 칸이 9°까지
 * 기울었다(칸의 문제가 아니라 «제도»의 문제였다). */
const famNeck = (a: number, b: number): Curve => (t) => [a * (1 - t), (b / 2) * (1 - Math.cos(Math.PI * t))];
const NECK_B = solveB(NECK_G / 4, (b) => arcLen(famNeck(NECK_A, b)), 1e-4, 1);

const Y_ARM = L - ARM_D;                 // 옆선 상단(겨드랑이) 높이
const SH_LEN = SW / 2 - NECK_A;          // 어깨 이음선 길이
const SLEEVE_UNDER = SLEN - CAP_H;       // 소매 밑단까지(소매산 아래)

/* 경계 곡선 — 전부 «호길이» 매개변수로 다시 샘플한다 */
function resample(c: Curve, n: number): Pt[] {
  const M = 8192;
  const acc = new Float64Array(M + 1);
  const pts: Pt[] = [];
  let p = c(0);
  for (let i = 1; i <= M; i++) {
    const q = c(i / M);
    acc[i] = acc[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]);
    p = q;
  }
  const total = acc[M];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (k < M && acc[k + 1] < s) k++;
    const seg = acc[k + 1] - acc[k];
    const f = seg > 0 ? (s - acc[k]) / seg : 0;
    pts.push(c((k + f) / M));
  }
  return pts;
}


/* ── 경계 곡선. 전부 «타원 호»다 — 위에서 푼 반축을 그대로 쓴다 ─────────── */
/** 암홀: (W/2, Y_ARM) 겨드랑이 → (SW/2, L) 어깨 */
const armR: Curve = (t) => [SW / 2 + famArm(ARM_A, ARM_D)(t)[0], Y_ARM + famArm(ARM_A, ARM_D)(t)[1]];
/** 목선 전체: (−NECK_A, L) → (0, L−NECK_B) → (NECK_A, L). 양 끝 수평 · 중앙 수평 */
const neckF: Curve = (u) => {
  const x = NECK_A * (2 * u - 1);
  return [x, L - (NECK_B / 2) * (1 + Math.cos((Math.PI * x) / NECK_A))];
};
/** 소매산 전체: (−CAP_W, 0) → (0, CAP_H) → (CAP_W, 0). 좌우 대칭 · 양 끝 수평 */
const capF: Curve = (u) => {
  const q = Math.abs(2 * u - 1);
  return [CAP_W * (2 * u - 1), (CAP_H / 2) * (1 + Math.cos(Math.PI * q))];
};

const LEN_ARM = arcLen(armR);
const LEN_NECK = arcLen(neckF);
const LEN_CAP = arcLen(capF);

if (run('1')) {
  console.log(`\n╔══ §1 패턴 제도 — 치수는 «데이터», 기하는 v3가 제도 ══╗`);
  console.log(`   메타 ${META}  patternHash ${meta.patternHash} (v2 코드 임포트 0)`);
  console.log(`   읽은 값: 총장 ${L}m · 품 ${W}m · 어깨 ${SW.toFixed(4)}m · 소매 ${SLEN}m`);
  console.log(`            목선반폭 ${(NECK_A * 100).toFixed(2)}cm · 암홀둘레 ${(ARM_G * 100).toFixed(2)}cm · 소매산 ${(CAP_H * 100).toFixed(2)}cm · 목선둘레 ${(NECK_G * 100).toFixed(2)}cm`);
  console.log(`   ── 도출(이분법 · 손 상수 0) ──`);
  console.log(`   암홀 깊이 D      = ${(ARM_D * 100).toFixed(3)} cm   ⟸ 암홀 곡선족(a=${(ARM_A * 100).toFixed(2)}cm, b=D) 길이 = 암홀둘레/2`);
  console.log(`   소매산 반폭 w_c  = ${(CAP_W * 100).toFixed(3)} cm   ⟸ 소매산 곡선족(a=w_c, b=소매산높이) 반쪽 길이 = 암홀둘레/2`);
  console.log(`   목선 처짐 b_n    = ${(NECK_B * 100).toFixed(3)} cm   ⟸ 목선 곡선족(a=목선반폭, b) 반쪽 길이 = 목선둘레/4 (앞뒤 «같게»)`);
  console.log(`   ⟹ 겨드랑이 높이 ${(Y_ARM * 100).toFixed(2)}cm · 어깨선 ${(SH_LEN * 100).toFixed(2)}cm · 소매밑 ${(SLEEVE_UNDER * 100).toFixed(2)}cm`);
  console.log(`   봉제 길이 대조: 암홀 1개 ${(LEN_ARM * 100).toFixed(3)}cm × 2 = ${(2 * LEN_ARM * 100).toFixed(3)}cm ↔ 소매산 전체 ${(LEN_CAP * 100).toFixed(3)}cm  (차 ${(Math.abs(2 * LEN_ARM - LEN_CAP) * 1e4).toFixed(4)}mm) · 목선 ${(LEN_NECK * 100).toFixed(3)}cm × 2 = ${(2 * LEN_NECK * 100).toFixed(2)}cm ↔ 메타 ${(NECK_G * 100).toFixed(2)}cm`);
  console.log(`   소매 통둘레(2·w_c) ${(2 * CAP_W * 100).toFixed(2)}cm ↔ 메타 sleeveWidthM ${(MD.sleeveWidthM * 100).toFixed(1)}cm — «맞지 않는다»`);
  console.log(`     ⟹ sleeveWidthM은 이 제도에 쓰지 «않는다». 쓰면 소매산–암홀 길이 일치가 깨진다(봉제 자기검사 ② 실패).`);
}

/* ══ 몸 — GLB를 «데이터»로 읽고 SDF를 굽는다(v3-13과 같은 절차) ═══════════ */
const { prims } = readGlb(GLB);
const prim0 = prims[0];
const weld = weldMap(prim0.pos, 0);
const bodyIdx = Uint32Array.from(prim0.idx, (v) => weld[v]);
const BEXT: [number, number, number] = [1.78, 1.765, 0.282];
const sdfSpec = deriveSpacing(BEXT, SDF_BUDGET, THICK);
const bodyG: GridSdf = bakeSdf(prim0.pos, bodyIdx, sdfSpec.h, sdfSpec.band);

/** 몸 표면의 «단면» 실측 — 높이 y에서 |x| ≤ xLim 인 정점의 x·z 범위. */
function slice(y: number, dy: number, xLim: number) {
  let xMax = 0, zMin = Infinity, zMax = -Infinity, cnt = 0;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const px = prim0.pos[v * 3], py = prim0.pos[v * 3 + 1], pz = prim0.pos[v * 3 + 2];
    if (Math.abs(py - y) > dy || Math.abs(px) > xLim) continue;
    xMax = Math.max(xMax, Math.abs(px));
    zMin = Math.min(zMin, pz);
    zMax = Math.max(zMax, pz);
    cnt++;
  }
  return { xMax, zMin, zMax, zc: (zMin + zMax) / 2, cnt };
}

/** 어깨끝 높이 — 몸 표면이 |x| = SW/2 에 «닿는» 가장 높은 y. 손 상수 0. */
function shoulderTopY(): number {
  let best = -Infinity;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const px = Math.abs(prim0.pos[v * 3]);
    if (px >= SW / 2 - 0.005 && px <= SW / 2 + 0.005) best = Math.max(best, prim0.pos[v * 3 + 1]);
  }
  return best;
}

/** 팔 축 — x 대역에서 |x|>armX 인 정점의 (y,z) 중심과 반경 */
function armAxis(x0: number, x1: number) {
  let sy = 0, sz = 0, cnt = 0;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const px = prim0.pos[v * 3];
    if (px < x0 || px > x1) continue;
    sy += prim0.pos[v * 3 + 1]; sz += prim0.pos[v * 3 + 2]; cnt++;
  }
  const yc = sy / cnt, zc = sz / cnt;
  let r = 0;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const px = prim0.pos[v * 3];
    if (px < x0 || px > x1) continue;
    r = Math.max(r, Math.hypot(prim0.pos[v * 3 + 1] - yc, prim0.pos[v * 3 + 2] - zc));
  }
  return { yc, zc, r, cnt };
}

if (run('B')) {
  console.log(`\n╔══ §1-B 몸 실측 (배치의 «입력») ══╗`);
  console.log(`   ${GLB} · 정점 ${prim0.pos.length / 3} · 삼각형 ${bodyIdx.length / 3}`);
  console.log(`   SDF h ${(sdfSpec.h * 1000).toFixed(3)}mm · band ${(sdfSpec.band * 1000).toFixed(1)}mm · ${(sdfSpec.bytes / 1024 ** 2).toFixed(1)}MB`);
  const yTop = shoulderTopY();
  console.log(`   어깨끝 높이(표면이 |x|=${(SW / 2 * 100).toFixed(1)}cm에 닿는 최고 y) = ${yTop.toFixed(4)} m`);
  console.log(`   ${'높이 y'.padStart(8)}${'|x|max'.padStart(9)}${'z범위'.padStart(18)}${'정점'.padStart(7)}`);
  for (const y of [yTop, yTop - 0.1, yTop - 0.2, yTop - 0.35, yTop - 0.5, yTop - 0.7]) {
    const s = slice(y, 0.01, 0.25);
    console.log(`   ${y.toFixed(4).padStart(8)}${(s.xMax * 100).toFixed(2).padStart(9)}${`${(s.zMin * 100).toFixed(2)}~${(s.zMax * 100).toFixed(2)}`.padStart(18)}${String(s.cnt).padStart(7)}`);
  }
  for (const [x0, x1] of [[0.24, 0.34], [0.34, 0.46], [0.46, 0.58]] as const) {
    const a = armAxis(x0, x1);
    console.log(`   팔 x ${x0}~${x1}: 중심 y ${a.yc.toFixed(4)} z ${a.zc.toFixed(4)} · 최대반경 ${(a.r * 1000).toFixed(1)}mm · 정점 ${a.cnt}`);
  }
}

/* ══ §2 메시 + 배치 ═══════════════════════════════════════════════════════ */

type Panel = {
  name: string; nu: number; nv: number; base: number;
  uv: Float64Array;      // 2D 정지 좌표 (2·(nu+1)·(nv+1))
  tris: number[];        // «전역» 인덱스
};
const at = (p: Panel, i: number, j: number) => p.base + j * (p.nu + 1) + i;

/** Coons 사상 — 경계 4곡선을 «호길이»로 샘플하고 내부를 이중선형 혼합으로 채운다.
 * 메셔를 쓰지 않는 이유: 봉제가 요구하는 것은 «양쪽 경계 정점의 1:1 대응»이고,
 * 구조 격자는 그것을 «구성적으로» 준다(자유 메셔는 대응을 다시 풀어야 한다). */
function coons(name: string, base: number, bot: Pt[], top: Pt[], lef: Pt[], rig: Pt[]): Panel {
  const nu = bot.length - 1;
  const nv = lef.length - 1;
  if (top.length - 1 !== nu || rig.length - 1 !== nv) throw new Error(`${name}: 경계 분할 불일치`);
  const uv = new Float64Array((nu + 1) * (nv + 1) * 2);
  const C = [bot[0], bot[nu], top[0], top[nu]];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const k = (j * (nu + 1) + i) * 2;
      for (let c = 0; c < 2; c++)
        uv[k + c] =
          (1 - v) * bot[i][c] + v * top[i][c] + (1 - u) * lef[j][c] + u * rig[j][c] -
          ((1 - u) * (1 - v) * C[0][c] + u * (1 - v) * C[1][c] + (1 - u) * v * C[2][c] + u * v * C[3][c]);
    }
  }
  const tris: number[] = [];
  const idx = (i: number, j: number) => base + j * (nu + 1) + i;
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++)
      tris.push(idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
  return { name, nu, nv, base, uv, tris };
}

const line = (a: Pt, b: Pt, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);
const mirX = (p: Pt[]) => p.map((q) => [-q[0], q[1]] as Pt);

/** 목표 간격 d에서 «네 패널»을 만든다. 봉제가 요구하는 분할 수는 여기서 맞춘다. */
function build(d: number) {
  const N_sh = Math.max(1, Math.round(SH_LEN / d));
  const N_nk = Math.max(2, Math.round(LEN_NECK / d));
  const N_side = Math.max(1, Math.round(Y_ARM / d));
  const N_arm = Math.max(1, Math.round(LEN_ARM / d));
  const N_und = Math.max(1, Math.round(SLEEVE_UNDER / d));
  const nuB = 2 * N_sh + N_nk;
  const nvB = N_side + N_arm;
  const nuS = 2 * N_arm;

  const shL = line([-SW / 2, L], [-NECK_A, L], N_sh);
  const shR = line([NECK_A, L], [SW / 2, L], N_sh);
  const nk = resample(neckF, N_nk);
  const topB: Pt[] = [...shL.slice(0, -1), ...nk.slice(0, -1), ...shR];
  const botB = line([-W / 2, 0], [W / 2, 0], nuB);
  const armUp = resample(armR, N_arm);                       // 겨드랑이 → 어깨(오른쪽)
  const rigB: Pt[] = [...line([W / 2, 0], [W / 2, Y_ARM], N_side).slice(0, -1), ...armUp];
  const lefB = mirX(rigB);

  const panels: Panel[] = [];
  let base = 0;
  const front = coons('front', base, botB, topB, lefB, rigB); base += (nuB + 1) * (nvB + 1); panels.push(front);
  const back = coons('back', base, botB, topB, lefB, rigB); base += (nuB + 1) * (nvB + 1); panels.push(back);
  const capPts = resample(capF, nuS);
  const hem = line([-CAP_W, -SLEEVE_UNDER], [CAP_W, -SLEEVE_UNDER], nuS);
  const slL = line([-CAP_W, -SLEEVE_UNDER], [-CAP_W, 0], N_und);
  const slR = line([CAP_W, -SLEEVE_UNDER], [CAP_W, 0], N_und);
  const slv = ['sleeveR', 'sleeveL'].map((nm) => {
    const p = coons(nm, base, hem, capPts, slL, slR);
    base += (nuS + 1) * (N_und + 1);
    panels.push(p);
    return p;
  });
  return { panels, front, back, slv, N_sh, N_nk, N_side, N_arm, N_und, nuB, nvB, nuS, n: base };
}

/* ── 배치: 몸에서 «도출»한 면 위에 얹는다 ────────────────────────────────── */
const Y_TOP = shoulderTopY();          // 어깨선을 얹을 높이 — 몸에서 잰 값
const Y_HEM = Y_TOP - L;

/* ── 배치면: 몸의 «실루엣»을 감싸는 볼록 기둥 ──────────────────────────────
 * 왜 기둥인가: 기둥면은 «전개 가능»하다 ⟹ 평면 패널을 호길이 보존으로 얹으면
 * 면내 변형이 «정확히 0»이다(배치가 만든 가짜 응력 0).
 * 왜 «실루엣»인가: 초판은 타원 기둥을 썼는데 어깨 높이의 팔을 비우려다 반축이
 * 30cm로 부풀었다 — 타원은 몸의 모양이 아니다. 옷이 덮는 높이대의 몸 정점을
 * (x,z)로 투영해 볼록 껍질을 잡고, 그것을 δ만큼 부풀린 볼록체의 경계를 쓴다.
 * δ는 「놓인 정점의 몸 SDF ≥ SEP」로 이분법으로 «푼다» — 고르는 수는 0이다. */
/* ── v3-21 배치: «높이별» 실루엣 튜브 ────────────────────────────────────
 * v3-18~20의 배치는 옷 높이대 «전체»의 볼록 껍질 하나를 모든 높이에 썼다. 그 껍질은
 * 가장 넓은 곳(어깨)이 정하므로 둘레가 128.84cm가 되고, 패널 110cm는 거기 못 미쳐
 * **옆선이 9.24cm · 어깨가 22.88cm 벌어진 채** 시작했다(v3-18 §3 표). 그 틈을 봉제가
 * f=0에 한꺼번에 당긴 것이 v3-19의 과도 구간이다.
 *
 * 여기서는 **높이마다** 몸 단면의 볼록 껍질을 잡고, 그 높이에서 옷이 «필요로 하는»
 * 둘레와 «몸을 비우는 데 필요한» 둘레 중 **큰 쪽**으로 맞춘다:
 *   P(y) = max( P_body(y) + 여유,  4 × 그 높이의 패널 반폭 )
 * ⟹ 옷이 몸보다 큰 대역(몸통)에서는 **옆선이 정확히 만나고**, 몸이 더 큰 대역(어깨)에서는
 *   몸을 비우되 **필요한 만큼만** 벌어진다. 기둥이 아니므로 면내 변형이 0은 아니다 —
 *   §2가 그 크기를 «값으로» 낸다(회차 프롬프트 §2 조건 ④). */
const AXIS_Z = (() => {
  let z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const y = prim0.pos[v * 3 + 1];
    if (y < Y_HEM || y > Y_TOP) continue;
    z0 = Math.min(z0, prim0.pos[v * 3 + 2]); z1 = Math.max(z1, prim0.pos[v * 3 + 2]);
  }
  return (z0 + z1) / 2;
})();

const NTH = 720;
const TH_S = new Float64Array(NTH), TH_C = new Float64Array(NTH);
for (let k = 0; k < NTH; k++) { const t = (k / NTH) * 2 * Math.PI; TH_S[k] = Math.sin(t); TH_C[k] = Math.cos(t); }

/** 높이 y의 «슬랩»에서 잡은 몸 단면 볼록 껍질의 지지함수. 대역은 몸판이 덮는 |x| ≤ 어깨/2. */
function supportAt(y: number, half: number): Float64Array {
  const h = new Float64Array(NTH).fill(-Infinity);
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const py = prim0.pos[v * 3 + 1];
    if (Math.abs(py - y) > half) continue;
    const x = prim0.pos[v * 3];
    if (Math.abs(x) > SW / 2) continue;
    const z = prim0.pos[v * 3 + 2] - AXIS_Z;
    for (let k = 0; k < NTH; k++) { const d = x * TH_S[k] + z * TH_C[k]; if (d > h[k]) h[k] = d; }
  }
  // 슬랩이 비면(옷 높이대 밖) 이웃 값을 쓰도록 0으로 두지 않고 «작은 값»으로 채운다
  for (let k = 0; k < NTH; k++) if (!Number.isFinite(h[k])) h[k] = 0;
  return h;
}

/** 지지함수 (h+δ)·scale 의 경계점: p(θ) = (h·sinθ + h′·cosθ, h·cosθ − h′·sinθ) */
function boundaryOf(h: Float64Array, delta: number, scale: number): [number, number][] {
  const dth = (2 * Math.PI) / NTH;
  return Array.from({ length: NTH }, (_, k) => {
    const hh = (h[k] + delta) * scale;
    const hp = ((h[(k + 1) % NTH] - h[(k - 1 + NTH) % NTH]) / (2 * dth)) * scale;
    return [hh * TH_S[k] + hp * TH_C[k], hh * TH_C[k] - hp * TH_S[k]] as [number, number];
  });
}

/** 닫힌 곡선의 호길이 표. 원점은 «앞»(z 최대) — `rear`를 주면 «뒤»(z 최소)에서 잰다. */
function arcOn(pts: [number, number][], rear = false) {
  const M = pts.length;
  let o = 0;
  for (let k = 1; k < M; k++) if (rear ? pts[k][1] < pts[o][1] : pts[k][1] > pts[o][1]) o = k;
  const ord = Array.from({ length: M + 1 }, (_, k) => pts[(o + k) % M]);
  const acc = new Float64Array(M + 1);
  for (let k = 1; k <= M; k++) acc[k] = acc[k - 1] + Math.hypot(ord[k][0] - ord[k - 1][0], ord[k][1] - ord[k - 1][1]);
  const total = acc[M];
  return {
    total,
    at: (sArc: number): [number, number] => {
      let a2 = sArc % total;
      if (a2 < 0) a2 += total;
      // 이분 탐색 — 선형 탐색이면 배치 도출이 O(720)×수백만 회로 분 단위가 된다
      let lo2 = 0, hi2 = M;
      while (hi2 - lo2 > 1) { const md = (lo2 + hi2) >> 1; if (acc[md] <= a2) lo2 = md; else hi2 = md; }
      const k = lo2;
      const seg = acc[k + 1] - acc[k];
      const f = seg > 0 ? (a2 - acc[k]) / seg : 0;
      return [ord[k][0] + (ord[k + 1][0] - ord[k][0]) * f, ord[k][1] + (ord[k + 1][1] - ord[k][1]) * f];
    },
  };
}

/** 2D 높이 py에서 «몸판»의 반폭 — 겨드랑이 아래는 품/2, 위는 암홀 곡선. */
function panelHalfWidth(py: number): number {
  if (py <= Y_ARM) return W / 2;
  // armR(t) = (SW/2 + ARM_A cos(πt/2), Y_ARM + ARM_D t) ⟹ t = (py − Y_ARM)/ARM_D
  const t = Math.min(1, (py - Y_ARM) / ARM_D);
  return SW / 2 + ARM_A * Math.cos((t * Math.PI) / 2);
}

const NY = 61;
const yOf = (k: number) => Y_HEM + ((Y_TOP - Y_HEM) * k) / (NY - 1);
/** 슬랩 반폭 — 표본 간격의 절반. 손 상수 0. */
const SLAB = (Y_TOP - Y_HEM) / (2 * (NY - 1));
const HSUP_Y: Float64Array[] = Array.from({ length: NY }, (_, k) => supportAt(yOf(k), SLAB));
const perimOf = (pts: [number, number][]) =>
  pts.reduce((t, q, i) => t + Math.hypot(q[0] - pts[(i + 1) % pts.length][0], q[1] - pts[(i + 1) % pts.length][1]), 0);

/** 높이별 배율 — 「몸을 δ만큼 비운다」와 「그 높이의 패널이 요구하는 둘레」 중 큰 쪽. */
/** 옆선 «틈» G — 앞뒤판이 «닿아 버리면» 자기충돌 분리(2×두께)를 f=0부터 어긴다.
 * 초기값은 분리 거리 그대로 두고, 초기 적법성이 실패하면 §2에서 «값으로» 키운다. */
let GAP_SIDE = SEP;
function scalesFor(delta: number): number[] {
  return HSUP_Y.map((h, k) => {
    const py = yOf(k) - (Y_TOP - L);          // 그 높이에 대응하는 2D 높이
    const need = 4 * panelHalfWidth(Math.max(0, Math.min(L, py))) + 2 * GAP_SIDE;
    const base = perimOf(boundaryOf(h, delta, 1));
    return Math.max(1, need / base);
  });
}

/* 배치 적법성은 «옷이 실제로 놓이는 점»에서만 묻는다. */
const PROBE = (() => {
  const B = build(D_FIXED);
  const grab = (pn: Panel): Pt[] => {
    const out: Pt[] = [];
    for (let j = 0; j <= pn.nv; j++)
      for (let i = 0; i <= pn.nu; i++) out.push([pn.uv[(j * (pn.nu + 1) + i) * 2], pn.uv[(j * (pn.nu + 1) + i) * 2 + 1]]);
    return out;
  };
  return { body: grab(B.front), sleeve: grab(B.slv[0]) };
})();

/** 2D 높이 py → 높이 표 인덱스(선형 보간용) */
const yIndex = (py: number) => {
  const y = Y_TOP - (L - py);
  const t = ((y - Y_HEM) / (Y_TOP - Y_HEM)) * (NY - 1);
  return Math.max(0, Math.min(NY - 1, t));
};

let DELTA = 0;
let SCALES: number[] = [];
let ARCS_F: ReturnType<typeof arcOn>[] = [];
let ARCS_B: ReturnType<typeof arcOn>[] = [];
function rebuildSurface(delta: number): void {
  DELTA = delta;
  SCALES = scalesFor(delta);
  const bs = HSUP_Y.map((h, k) => boundaryOf(h, delta, SCALES[k]));
  ARCS_F = bs.map((pts) => arcOn(pts, false));
  ARCS_B = bs.map((pts) => arcOn(pts, true));
}
/** 몸판 배치 — 높이에서 두 표본을 선형 보간한다(표본 간격 ${SLAB}m). */
function bodyPoint(px: number, py: number, front: boolean): [number, number, number] {
  const t = yIndex(py);
  const k0 = Math.floor(t), k1 = Math.min(NY - 1, k0 + 1), f = t - k0;
  const A = front ? ARCS_F : ARCS_B;
  const p0 = A[k0].at(front ? px : -px), p1 = A[k1].at(front ? px : -px);
  return [p0[0] + (p1[0] - p0[0]) * f, Y_TOP - (L - py), AXIS_Z + p0[1] + (p1[1] - p0[1]) * f];
}

/** δ — 몸판의 놓인 정점이 전부 몸에서 SEP 이상 떨어지는 최소값(이분법). */
function fitDelta(): number {
  const probe = (delta: number) => {
    rebuildSurface(delta);
    let min = Infinity;
    for (const [px, py] of PROBE.body)
      for (const fr of [true, false]) {
        const q = bodyPoint(px, py, fr);
        min = Math.min(min, sampleSdf(bodyG, q[0], q[1], q[2]));
      }
    return min;
  };
  let lo = 0, hi = SEP;
  while (probe(hi) < SEP && hi < 0.30) hi *= 1.6;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (probe(m) < SEP) lo = m; else hi = m;
  }
  rebuildSurface(hi);
  return hi;
}
fitDelta();

/** 배치면까지의 (x,z) 거리 — 소매가 몸판과 겹치지 않게 하는 데 쓴다(가장 가까운 높이 표본). */
function distToSurface(x: number, y: number, z: number): number {
  const t = Math.max(0, Math.min(NY - 1, ((y - Y_HEM) / (Y_TOP - Y_HEM)) * (NY - 1)));
  const pts = boundaryOf(HSUP_Y[Math.round(t)], DELTA, SCALES[Math.round(t)]);
  let m = Infinity;
  for (let k = 0; k < pts.length; k++) {
    const a2 = pts[k], b2 = pts[(k + 1) % pts.length];
    const ex = b2[0] - a2[0], ez = b2[1] - a2[1];
    const u = Math.max(0, Math.min(1, ((x - a2[0]) * ex + (z - a2[1]) * ez) / (ex * ex + ez * ez || 1)));
    m = Math.min(m, Math.hypot(x - (a2[0] + ex * u), z - (a2[1] + ez * u)));
  }
  return m;
}

function armProfile(x0: number, x1: number) {
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < prim0.pos.length / 3; v++) {
    const px = prim0.pos[v * 3];
    if (px < x0 || px >= x1) continue;
    y0 = Math.min(y0, prim0.pos[v * 3 + 1]); y1 = Math.max(y1, prim0.pos[v * 3 + 1]);
    z0 = Math.min(z0, prim0.pos[v * 3 + 2]); z1 = Math.max(z1, prim0.pos[v * 3 + 2]);
  }
  return { yc: (y0 + y1) / 2, zc: (z0 + z1) / 2 };
}
/** 팔 축 — «소매 아랫절반이 놓이는» x 대역에서 잰다. 두 값 다 패턴에서 온다.
 * (어깨끝부터 재면 몸통·다리 정점이 섞여 축이 y≈0.74로 내려간다.) */
const ARM = armProfile(SW / 2 + CAP_H, SW / 2 + SLEN);

/** 소매 배치 — «열린 관». 반지름 R을 키우면 덮는 각도가 줄고(호길이 보존)
 * 남는 각도가 겨드랑이 쪽 «봉제 전 틈»이 된다. R의 하한은 닫힌 관 CAP_W/π다.
 * x0는 어깨끝(SW/2)에서 시작해 필요하면 5mm씩 바깥으로 민다. */
function fitSleeve(): { x0: number; R: number } {
  const RMIN = CAP_W / Math.PI;
  const probe = (x0: number, R: number) => {
    let min = Infinity;
    for (const [px, py] of PROBE.sleeve) {
      const ph = px / R;
      const x = x0 + (CAP_H - py), y = ARM.yc + R * Math.cos(ph), z = ARM.zc + R * Math.sin(ph);
      min = Math.min(min, sampleSdf(bodyG, x, y, z));
      // 몸판(수직 기둥)과도 SEP 이상 떨어져야 한다 — 옷–옷 분리 거리다
      if (y >= Y_HEM && y <= Y_TOP) min = Math.min(min, distToSurface(x, y, z - AXIS_Z));
    }
    return min;
  };
  for (let x0 = SW / 2; x0 < SW / 2 + SLEN; x0 += 0.005) {
    let lo = RMIN, hi = RMIN;
    while (probe(x0, hi) < SEP && hi < 0.30) hi *= 1.15;
    if (probe(x0, hi) < SEP) continue;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (probe(x0, m) < SEP) lo = m; else hi = m;
    }
    return { x0, R: hi };
  }
  throw new Error('소매를 적법하게 놓을 수 없다 — 갈래 G');
}
const SLV = fitSleeve();
const SLV_X0 = SLV.x0, SLV_R = SLV.R;
/** 배치 «서명» — 체크포인트가 다른 배치의 상태를 이어받지 못하게 한다(v3-21에서 실제로 발생). */
const PLACE_SIG = [DELTA, GAP_SIDE, SLV_X0, SLV_R].map((v) => v.toFixed(6)).join('/');

/** 2D 패널 좌표 → 3D 배치 위치. 흡착·앵커 없음 — «놓는 것»뿐이다. */
function place(panel: Panel, i: number, j: number, out: Float64Array, o: number): void {
  const k = (j * (panel.nu + 1) + i) * 2;
  const px = panel.uv[k], py = panel.uv[k + 1];
  if (panel.name === 'front' || panel.name === 'back') {
    const q = bodyPoint(px, py, panel.name === 'front');
    out[o] = q[0]; out[o + 1] = q[1]; out[o + 2] = q[2];
  } else {
    const sgn = panel.name === 'sleeveR' ? 1 : -1;
    /* φ = 0 이 팔 «위», φ > 0 이 «앞»(+z). 좌우는 x «만» 거울로 뒤집는다 —
     * 초판은 φ까지 뒤집어 왼쪽 소매의 «앞 절반이 뒤로» 갔다(암홀앞L 초기 틈 16.09cm ↔
     * 앞R 9.80cm · f=100에서 왼쪽 암홀만 98.87mm로 안 닫히고 |v| 상위 20이 전부 거기였다). */
    const ph = px / SLV_R;                            // 호길이 보존
    out[o] = sgn * (SLV_X0 + (CAP_H - py));
    out[o + 1] = ARM.yc + SLV_R * Math.cos(ph);
    out[o + 2] = ARM.zc + SLV_R * Math.sin(ph);
  }
}

/* ── 봉제 — 「이음선 = 정지 길이 2×두께인 거리 제약」. 새 상수 0 ───────────
 * rest를 0으로 두면 자기충돌(분리 2×두께)과 «서로 싸운다». 두 겹의 원단이
 * 이음선에서 갖는 실제 간격이 정확히 두 두께이므로 rest = 2×두께가 옳고,
 * 강성은 멤브레인과 «같은 값»을 쓴다(이음선을 원단보다 뻣뻣하게 만들지 않는다 ·
 * 서브스텝 산정이 바뀌지 않는다). */
type Seam = { name: string; a: number[]; b: number[] };

function assemble(d: number) {
  const B = build(d);
  const n = B.n;
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (const p of B.panels) {
    uv.set(p.uv, p.base * 2);
    tris.push(...p.tris);
  }
  const s = makeSolver(n);
  for (const p of B.panels)
    for (let j = 0; j <= p.nv; j++) for (let i = 0; i <= p.nu; i++) place(p, i, j, s.pos, at(p, i, j) * 3);

  const { front, back, slv, N_sh, N_nk, N_side, N_arm, N_und, nuB, nvB, nuS } = B;
  const col = (p: Panel, i: number, j0: number, j1: number) => Array.from({ length: j1 - j0 + 1 }, (_, k) => at(p, i, j0 + k));
  const row = (p: Panel, j: number, i0: number, i1: number) => Array.from({ length: Math.abs(i1 - i0) + 1 }, (_, k) => at(p, i0 + (i1 >= i0 ? k : -k), j));
  const seams: Seam[] = [
    { name: '어깨L', a: row(front, nvB, 0, N_sh), b: row(back, nvB, 0, N_sh) },
    { name: '어깨R', a: row(front, nvB, N_sh + N_nk, nuB), b: row(back, nvB, N_sh + N_nk, nuB) },
    { name: '옆선L', a: col(front, 0, 0, N_side), b: col(back, 0, 0, N_side) },
    { name: '옆선R', a: col(front, nuB, 0, N_side), b: col(back, nuB, 0, N_side) },
    { name: '암홀앞R', a: col(front, nuB, N_side, nvB), b: row(slv[0], N_und, nuS, N_arm) },
    { name: '암홀뒤R', a: col(back, nuB, N_side, nvB), b: row(slv[0], N_und, 0, N_arm) },
    { name: '암홀앞L', a: col(front, 0, N_side, nvB), b: row(slv[1], N_und, nuS, N_arm) },
    { name: '암홀뒤L', a: col(back, 0, N_side, nvB), b: row(slv[1], N_und, 0, N_arm) },
    { name: '소매밑R', a: col(slv[0], 0, 0, N_und), b: col(slv[0], nuS, 0, N_und) },
    { name: '소매밑L', a: col(slv[1], 0, 0, N_und), b: col(slv[1], nuS, 0, N_und) },
  ];
  const seamCons: DistanceConstraint[] = [];
  for (const sm of seams)
    for (let k = 0; k < sm.a.length; k++)
      seamCons.push({ kind: 'dist', i: sm.a[k], j: sm.b[k], rest: SEP, k: KMEM, lambda: 0 });

  assignMassFromMesh(s, tris, uv, MAT.rho, new Set());
  const bends = makeBend(tris, uv, MAT.B);
  const cons: Constraint[] = [...makeInplane(tris, uv, KMEM, KMEM, KMEM), ...bends, ...seamCons];
  return { ...B, n, uv, tris, s, seams, seamCons, bends, cons };
}

type Scene = ReturnType<typeof assemble>;

/* 옆 틈 G 도출 — 「비인접 삼각형 최소 거리 ≥ 2×두께」가 f=0에서 성립하는 «최소» G.
 * G를 키우면 옆선 짝거리가 그만큼 벌어지므로 «가장 작은 것»을 고른다. 손 상수 0. */
{
  const need = SEP;                     // 문턱(SEP−TOL)이 아니라 SEP 자체로 여유를 둔다
  let ok = false;
  for (let i = 0; i < 8 && !ok; i++) {
    fitDelta();
    const sc0 = assemble(D_FIXED);
    const m0 = minPairDistLite(sc0.s.pos, sc0.tris);
    if (m0 >= need) { ok = true; break; }
    GAP_SIDE *= 1.5;
  }
  if (!ok) throw new Error('옆 틈 G를 8회 안에 못 찾았다 — 갈래 D');
}

if (process.env.DIAG === '2') {
  for (const dm of [30, 25, 20, 16, 13, 11, 9, 8]) {
    const sc = assemble(dm / 1000);
    const q = meshQuality(sc.tris, sc.uv);
    const per = sc.panels.map((p) => {
      const t: number[] = []; for (const x of p.tris) t.push(x);
      return meshQuality(t, sc.uv).minAng.toFixed(1);
    }).join(' / ');
    console.log(`   d=${String(dm).padStart(3)}mm 정점 ${String(sc.n).padStart(6)} 최소각 ${q.minAng.toFixed(2)}° 종횡비 ${q.aspMax.toFixed(2)} 패널별 ${per}`);
  }
  process.exit(0);
}
if (process.env.DIAG === '1') {
  const sc = assemble(0.025);
  // 최소각이 어느 패널·어느 셀에서 나오는지
  for (const p of sc.panels) {
    let worst = 999, wi = 0, wj = 0;
    for (let j = 0; j < p.nv; j++) for (let i = 0; i < p.nu; i++) {
      const q = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, b]) => [p.uv[(b * (p.nu + 1) + a) * 2], p.uv[(b * (p.nu + 1) + a) * 2 + 1]]);
      for (const tri of [[0, 1, 2], [1, 3, 2]]) {
        const e = [0, 1, 2].map((k) => Math.hypot(q[tri[(k + 1) % 3]][0] - q[tri[k]][0], q[tri[(k + 1) % 3]][1] - q[tri[k]][1]));
        for (let k = 0; k < 3; k++) {
          const c = (e[(k + 1) % 3] ** 2 + e[(k + 2) % 3] ** 2 - e[k] ** 2) / (2 * e[(k + 1) % 3] * e[(k + 2) % 3]);
          const ang = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
          if (ang < worst) { worst = ang; wi = i; wj = j; }
        }
      }
    }
    console.log(`   ${p.name}: 최소각 ${worst.toFixed(2)}° @ (i=${wi}/${p.nu}, j=${wj}/${p.nv})  uv=${sc.uv[(at(p, wi, wj)) * 2].toFixed(4)},${sc.uv[(at(p, wi, wj)) * 2 + 1].toFixed(4)}`);
  }
  // 비인접 최소거리 쌍이 어느 패널인지
  const mp = minPairDist(sc.s.pos, sc.tris, SEP * 3);
  const owner = (t: number) => sc.panels.find((p) => sc.tris[t * 3] >= p.base && sc.tris[t * 3] < p.base + (p.nu + 1) * (p.nv + 1))?.name;
  console.log(`   최소 거리 ${(mp.min * 1000).toFixed(3)}mm 쌍: ${owner(mp.worst[0])} ↔ ${owner(mp.worst[1])} (위반 ${mp.viol})`);
  process.exit(0);
}

/** 삼각화 품질 — 최소각 · 종횡비max · 엣지 길이. v3-08 §3과 «같은 정의». */
function meshQuality(tris: number[], uv: Float64Array) {
  let minAng = 180, aspMax = 0, eMin = Infinity, eMax = 0, eSum = 0, eN = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const p = [tris[t], tris[t + 1], tris[t + 2]].map((v) => [uv[v * 2], uv[v * 2 + 1]] as Pt);
    const e = [0, 1, 2].map((k) => Math.hypot(p[(k + 1) % 3][0] - p[k][0], p[(k + 1) % 3][1] - p[k][1]));
    for (const l of e) { eMin = Math.min(eMin, l); eMax = Math.max(eMax, l); eSum += l; eN++; }
    aspMax = Math.max(aspMax, Math.max(...e) / Math.min(...e));
    for (let k = 0; k < 3; k++) {
      const a = e[k], b = e[(k + 1) % 3], c = e[(k + 2) % 3];
      const cosA = (b * b + c * c - a * a) / (2 * b * c);
      minAng = Math.min(minAng, (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI);
    }
  }
  return { minAng, aspMax, eMin, eMax, eMean: eSum / eN, eN };
}

/** 이 장면의 서브스텝 — 멤브레인·굽힘 «둘 중 큰 쪽». 실제 식을 그대로 부른다. */
function substepsOf(sc: Scene) {
  const q = meshQuality(sc.tris, sc.uv);
  const a = substepsForCloth(DT, KMEM, MAT.rho, q.eMin, 0.95);
  const b = substepsForBending(DT, sc.s, sc.bends, 0.95);
  return { sub: Math.max(a, b), memb: a, bend: b, q };
}

if (run('2')) {
  console.log(`\n╔══ §2 배치 — 몸에서 «푼» 값. 손 상수 0 ══╗`);
  console.log(`   어깨선 높이 Y_TOP ${Y_TOP.toFixed(4)}m (몸 표면이 |x|=어깨/2 에 닿는 최고 y) · 밑단 ${Y_HEM.toFixed(4)}m`);
  console.log(`   배치면 = «높이별» 몸 단면 볼록 껍질 · 축 z ${(AXIS_Z * 100).toFixed(2)}cm · 높이 표본 ${NY}개(슬랩 ±${(SLAB * 1000).toFixed(1)}mm)`);
  console.log(`   ⟹ δ = ${(DELTA * 1000).toFixed(2)}mm · 배율 = max(1, 그 높이의 «필요 둘레 4×반폭» / «몸 둘레»)`);
  console.log(`   ${'2D y[cm]'.padStart(9)}${'세계 y[cm]'.padStart(11)}${'몸 둘레[cm]'.padStart(12)}${'필요 둘레'.padStart(11)}${'배율'.padStart(8)}${'실제 둘레'.padStart(11)}`);
  for (const k of [0, 15, 30, 45, 52, 57, 60]) {
    const py = yOf(k) - (Y_TOP - L);
    const base = perimOf(boundaryOf(HSUP_Y[k], DELTA, 1));
    console.log(`   ${(py * 100).toFixed(1).padStart(9)}${(yOf(k) * 100).toFixed(1).padStart(11)}${(base * 100).toFixed(2).padStart(12)}${(4 * panelHalfWidth(Math.max(0, Math.min(L, py))) * 100).toFixed(2).padStart(11)}${SCALES[k].toFixed(3).padStart(8)}${(base * SCALES[k] * 100).toFixed(2).padStart(11)}`);
  }
  console.log(`   ⟹ 소매 관: x0 ${(SLV_X0 * 100).toFixed(1)}cm (어깨끝 ${(SW / 2 * 100).toFixed(1)}cm) · R ${(SLV_R * 1000).toFixed(1)}mm · 덮는 각 ${((2 * CAP_W / SLV_R) * 180 / Math.PI).toFixed(0)}° · 팔축 y ${ARM.yc.toFixed(4)} z ${ARM.zc.toFixed(4)}`);
  console.log(`      닫힌 관 하한 ${(CAP_W / Math.PI * 1000).toFixed(1)}mm — R이 그보다 크면 «겨드랑이 쪽이 열린 채» 놓인다(봉제가 닫는다)`);
}

/* ══ §0 해상도 도출 (#32) — «비용에서» 나온다. 손 상수 0 ══════════════════
 *
 * 입력 넷을 전부 값으로 놓고 «가장 고운» d 를 고른다:
 *   ① 주름 파장   설계 R3 — 격자보다 짧은 파장은 표현 자체가 안 된다.
 *                 원단의 굽힘–중력 길이 ℓ = (B/(ρg))^(1/3) 를 특성 파장으로 쓰고
 *                 R3의 「파장 ≥ 2~3×격자」를 그대로 적용한다 ⟹ d ≤ ℓ/3 (엄격) · ℓ/2 (느슨)
 *   ② 원소 종횡비 v3-08 §3 — 최소각 게이트 25°가 종횡비를 위에서 묶는다(1/sin25° = 2.37)
 *   ③ 서브스텝   `substepsForCloth` · `substepsForBending`를 «그대로» 부른다(모형 0)
 *   ④ 벽시계     설계 §2-5 개정3이 «감당 범위 안»이라고 적은 최대치 = 300프레임 95초
 * 넷 중 하나라도 만족하는 d 가 없으면 «갈래 G»로 정지한다 — 문턱을 내리지 않는다. */
const L_BEND = Math.cbrt(MAT.B / (MAT.rho * G));
const D_WAVE_STRICT = L_BEND / 3;
const D_WAVE_LOOSE = L_BEND / 2;
/** 설계 §2-5 개정 3 — 「8mm의 70~95초는 감당 범위 안」의 상한. 300프레임 기준. */
const WALL_BUDGET_S = 95;
const WALL_FRAMES = 300;
/** v3-08 §3 삼각화 품질 게이트 */
const MIN_ANGLE_GATE = 25;

let D_CHOSEN = D_FIXED;
let derivNote = 'v3-19 등록: ①느슨을 만족하는 최대 d (①엄격 미달 명시)';

if (run('0')) {
  console.log(`\n╔══ §0 해상도 도출 (#32) — 비용에서 «도출». 손 상수 0 ══╗`);
  console.log(`   ① 파장: ℓ = (B/ρg)^(1/3) = ${(L_BEND * 1000).toFixed(2)}mm  ⟹  d ≤ ${(D_WAVE_STRICT * 1000).toFixed(2)}mm(ℓ/3 엄격) · ${(D_WAVE_LOOSE * 1000).toFixed(2)}mm(ℓ/2 느슨)`);
  console.log(`   ④ 벽시계 예산 ${WALL_BUDGET_S}초 / ${WALL_FRAMES}프레임 (설계 §2-5 개정3 「감당 범위 안」 상한)`);

  const CAND = [36, 30, 25, 21, 18, 15, 13.4, 12, 11, 10, 9, 8];
  console.log(`\n   ── 후보별 메시·서브스텝(시뮬 없이 «식»에서) ──`);
  console.log(`   ${'d[mm]'.padStart(7)}${'정점'.padStart(8)}${'삼각형'.padStart(8)}${'제약'.padStart(8)}${'최소각'.padStart(8)}${'종횡비'.padStart(8)}${'엣지min'.padStart(9)}${'sub멤'.padStart(7)}${'sub굽'.padStart(7)}${'sub'.padStart(6)}`);
  const rows: { d: number; n: number; sub: number; ok: boolean; q: ReturnType<typeof meshQuality> }[] = [];
  for (const dm of CAND) {
    const sc = assemble(dm / 1000);
    const st = substepsOf(sc);
    rows.push({ d: dm / 1000, n: sc.n, sub: st.sub, ok: st.q.minAng >= MIN_ANGLE_GATE, q: st.q });
    console.log(
      `   ${dm.toFixed(1).padStart(7)}${String(sc.n).padStart(8)}${String(sc.tris.length / 3).padStart(8)}${String(sc.cons.length).padStart(8)}` +
        `${st.q.minAng.toFixed(1).padStart(8)}${st.q.aspMax.toFixed(2).padStart(8)}${(st.q.eMin * 1000).toFixed(2).padStart(9)}` +
        `${String(st.memb).padStart(7)}${String(st.bend).padStart(7)}${String(st.sub).padStart(6)}${st.q.minAng >= MIN_ANGLE_GATE ? '' : '  ← 최소각 미달'}`,
    );
  }

  console.log(`\n   ── 비용 «실측» (파일럿 4프레임 · 몸 SDF + 자기충돌 포함 = 본 실행과 같은 구성) ──`);
  const PILOT = [32, 24, 18];
  const meas: { d: number; n: number; sub: number; msF: number }[] = [];
  for (const dm of PILOT) {
    const sc = assemble(dm / 1000);
    const st = substepsOf(sc);
    const p: SolverParams = {
      dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: sc.tris, thickness: THICK },
    };
    const t0 = performance.now();
    for (let f = 0; f < 4; f++) step(sc.s, sc.cons, p);
    const msF = (performance.now() - t0) / 4;
    meas.push({ d: dm / 1000, n: sc.n, sub: st.sub, msF });
    console.log(`   d=${dm}mm  정점 ${String(sc.n).padStart(6)} · sub ${String(st.sub).padStart(4)} ⟹ ${msF.toFixed(1)} ms/프레임 · 정점·서브스텝당 ${((msF * 1e6) / (sc.n * st.sub)).toFixed(1)} ns`);
  }
  // 비용이 어디로 가는지 — 「해상도를 올리면 무엇이 먼저 터지는가」(설계 §2-5 미확인분)
  {
    const sc = assemble(0.024);
    const st = substepsOf(sc);
    const base = { dt: DT, substeps: st.sub, gravity: G, damping: DAMP } as SolverParams;
    const variants: [string, SolverParams][] = [
      ['제약만(충돌 0)', { ...base }],
      ['＋몸 충돌', { ...base, collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU } }],
      ['＋자기충돌(본 구성)', { ...base, collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU }, selfCollision: { tris: sc.tris, thickness: THICK } }],
    ];
    console.log(`   ── 비용 분해 (d=24mm · 정점 ${sc.n} · sub ${st.sub} · 각 3프레임) ──`);
    for (const [nm, pv] of variants) {
      const s2 = assemble(0.024);
      selfStats.fill(0); collisionStats.fill(0);
      const t0 = performance.now();
      for (let f = 0; f < 3; f++) step(s2.s, s2.cons, pv.selfCollision ? { ...pv, selfCollision: { tris: s2.tris, thickness: THICK } } : pv);
      const ms = (performance.now() - t0) / 3;
      console.log(`   ${nm.padEnd(22)}${ms.toFixed(1).padStart(9)} ms/프레임${pv.selfCollision ? `  (그중 자기충돌 ${(selfStats[6] / 3).toFixed(1)} = ${((selfStats[6] / 3 / ms) * 100).toFixed(0)}% · 광역 ${(selfStats[3] / 3).toFixed(1)} 협역 ${(selfStats[4] / 3).toFixed(1)} 해소 ${(selfStats[5] / 3).toFixed(1)})` : ''}${pv.collision && !pv.selfCollision ? `  (그중 몸 충돌 ${(collisionStats[3] / 3).toFixed(1)})` : ''}`);
    }
  }

  // 로그–로그 최소제곱: ms/프레임 = C · d^(−p)
  const lx = meas.map((m) => Math.log(m.d)), ly = meas.map((m) => Math.log(m.msF));
  const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length;
  const slope = lx.reduce((s, x, i) => s + (x - mx) * (ly[i] - my), 0) / lx.reduce((s, x) => s + (x - mx) ** 2, 0);
  const lnC = my - slope * mx;
  const predMs = (d: number) => Math.exp(lnC + slope * Math.log(d));
  console.log(`   적합: ms/프레임 = ${Math.exp(lnC).toExponential(3)} · d^${slope.toFixed(3)}  (해상도 지수 ${(-slope).toFixed(2)} — 「정점 ∝ d⁻² × 서브스텝 ∝ d⁻¹」의 3에 대조)`);
  for (const m of meas) console.log(`     대조 d=${(m.d * 1000).toFixed(0)}mm 실측 ${m.msF.toFixed(1)} ↔ 적합 ${predMs(m.d).toFixed(1)} ms (오차 ${(((predMs(m.d) - m.msF) / m.msF) * 100).toFixed(1)}%)`);

  console.log(`\n   ── 판정: 네 조건을 «동시에» 만족하는 가장 고운 d ──`);
  console.log(`   ${'d[mm]'.padStart(7)}${'예측 300프레임'.padStart(16)}${'④예산'.padStart(8)}${'①파장(엄격/느슨)'.padStart(20)}${'②최소각'.padStart(9)}`);
  let pick = 0;
  for (const r of rows) {
    const wall = (predMs(r.d) * WALL_FRAMES) / 1000;
    const okW = wall <= WALL_BUDGET_S, okS = r.d <= D_WAVE_STRICT, okL = r.d <= D_WAVE_LOOSE;
    console.log(
      `   ${(r.d * 1000).toFixed(1).padStart(7)}${`${wall.toFixed(1)}초`.padStart(16)}${(okW ? '통과' : '초과').padStart(8)}` +
        `${`${okS ? '통과' : '미달'} / ${okL ? '통과' : '미달'}`.padStart(20)}${(r.ok ? '통과' : '미달').padStart(9)}`,
    );
    if (okW && okL && (pick === 0 || r.d < pick)) pick = r.d;
  }
  const strictPick = rows.filter((r) => (predMs(r.d) * WALL_FRAMES) / 1000 <= WALL_BUDGET_S && r.d <= D_WAVE_STRICT).sort((a, b) => a.d - b.d)[0];
  const angs = rows.map((r) => r.q.minAng);
  console.log(`\n   ── ② «정의역 정정» ─────────────────────────────────────────────`);
  console.log(`   최소각은 d의 함수가 «아니다»: ${(rows[0].d * 1000).toFixed(0)}→${(rows[rows.length - 1].d * 1000).toFixed(0)}mm 에서 ${Math.min(...angs).toFixed(1)}~${Math.max(...angs).toFixed(1)}° 로 «불변»이고`);
  console.log(`   종횡비max도 ${Math.min(...rows.map((r) => r.q.aspMax)).toFixed(2)}~${Math.max(...rows.map((r) => r.q.aspMax)).toFixed(2)} 로 불변이다(구조 격자에서 각도는 사상의 야코비안이 정하므로 «원리적»이다).`);
  console.log(`   ⟹ ②는 «해상도»의 제약이 아니라 «삼각화 방법»의 제약이다. 문턱(v3-08 §3 최소각 25°)은`);
  console.log(`      ${Math.max(...angs) >= MIN_ANGLE_GATE ? '충족' : '«미달»'}이고 d를 낮춰도 변하지 않는다 ⟹ d를 «고르지 못한다». 문턱은 내리지 않고 그대로 두고,`);
  console.log(`      미달을 «잔여»로 등재한 뒤 d 선택은 ①③④로 한다(v2 Stage 2a §3.2 선례 — 품질 1건 미달·나머지 진행).`);
  console.log(`      대조: v2 제품 메시 최소각 24.7~25.6° · 종횡비max 2.19~2.38 (v3-08 §3)`);
  console.log(`\n   ① 엄격(ℓ/3)+③④ 만족하는 가장 고운 d: ${strictPick ? `${(strictPick.d * 1000).toFixed(1)}mm` : '«없다»'}`);
  console.log(`   ① 느슨(ℓ/2)+③④ 만족하는 가장 고운 d: ${pick ? `${(pick * 1000).toFixed(1)}mm` : '«없다» ⟹ 갈래 G'}`);
  if (!pick && !strictPick) {
    // 도출 실패 — 사전 등록대로 «갈래 G». 얼마나 모자란지를 값으로 남긴다.
    const dLoose = rows.filter((r) => r.d <= D_WAVE_LOOSE).sort((a, b) => b.d - a.d)[0];
    const dBudget = rows.filter((r) => (predMs(r.d) * WALL_FRAMES) / 1000 <= WALL_BUDGET_S).sort((a, b) => a.d - b.d)[0];
    const need = (predMs(dLoose.d) * WALL_FRAMES) / 1000;
    console.log(`\n   ⟹ ①(느슨)과 ④를 «동시에» 만족하는 d가 «없다» — 사전 등록대로 «갈래 G».`);
    // dBudget은 «없을 수 있다»(후보 전체가 예산을 넘는 경우) — 그때도 멈추지 않고 그 사실을 적는다
    console.log(`      ④만 보면 가장 고운 d = ${dBudget ? `${(dBudget.d * 1000).toFixed(1)}mm(${((predMs(dBudget.d) * WALL_FRAMES) / 1000).toFixed(1)}초)` : '«후보 전량 초과»'} · ①만 보면 가장 거친 d = ${(dLoose.d * 1000).toFixed(1)}mm(${need.toFixed(0)}초)`);
    console.log(`      ⟹ 필요한 비용 절감 = ${(need / WALL_BUDGET_S).toFixed(1)}배. 예산을 설계가 「밖」이라 적은 3~4분(240초)까지 늘려도 ${(need / 240).toFixed(1)}배 부족하다.`);
    console.log(`      ⟹ 충돌(몸+자기)을 «공짜»로 만들어도 제약 투영만으로 ${(need * 0.129).toFixed(0)}초 — 여전히 예산 밖이다(분해 실측 13%).`);
    console.log(`      ⟹ v2 자기 간격 13.4mm에서도 ${((predMs(0.0134) * WALL_FRAMES) / 1000).toFixed(0)}초 = v2 실측 25~34초의 «약 ${((predMs(0.0134) * WALL_FRAMES) / 1000 / 30).toFixed(0)}배». 설계 §2-5 표(반복수 동일 가정)가 «깨진다».`);
    // 착장은 «실행하지 않는다». 배치·봉제 자기검사는 d에 의존하지 않는 조항이므로
    // ①③이 고르는 «가장 고운 적법 해상도»에서 값으로 남긴다(비용이 고른 값이 아니다).
    console.log(`      ⟹ v3-18이 낸 갈래 G는 «그대로 유효»하다. v3-19는 전략 세션 판정에 따라`);
    console.log(`         ④(95초)를 «제품 예산»으로 두고 «물리 검증» 1회 오프라인 실행으로 층위를 분리한다`);
    console.log(`         — 문턱 완화가 아니다. 제품 예산 95초는 유효하고 S4 통과가 제품 가능성을 뜻하지 않는다.`);
  }
  console.log(`   ⟹ 채택 d = ${D_CHOSEN ? (D_CHOSEN * 1000).toFixed(1) + 'mm' : '없음'}  (근거 ${derivNote})`);
  // 외삽 검증 — 설계 §2-5가 스스로 경고한 「선형 외삽이다」를 «실측»으로 닫는다.
  // 3프레임만 돌린다. 착장 판정이 아니라 «비용»을 재는 것이고, 상태는 버린다.
  if (D_CHOSEN > 0) {
    const scv = assemble(D_CHOSEN);
    const stv = substepsOf(scv);
    const pv: SolverParams = {
      dt: DT, substeps: stv.sub, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: scv.tris, thickness: THICK },
    };
    const tv = performance.now();
    for (let f = 0; f < 3; f++) step(scv.s, scv.cons, pv);
    const msv = (performance.now() - tv) / 3;
    console.log(`   외삽 «검증»(3프레임 · 상태 폐기): d=${(D_CHOSEN * 1000).toFixed(1)}mm 실측 ${msv.toFixed(0)} ms/프레임 ↔ 적합 ${predMs(D_CHOSEN).toFixed(0)} ms (오차 ${(((predMs(D_CHOSEN) - msv) / msv) * 100).toFixed(1)}%)`);
    console.log(`      ⟹ 300프레임 «실측 기준» ${((msv * WALL_FRAMES) / 1000).toFixed(0)}초 · 예산 ${WALL_BUDGET_S}초의 ${((msv * WALL_FRAMES) / 1000 / WALL_BUDGET_S).toFixed(1)}배 — 갈래 G는 외삽이 아니라 «실측»이다`);
  }
}

/* ══ 계기 — 하네스 «사본». 솔버·격자와 코드를 공유하지 않는다(v3-13 규범) ══ */
function ptTriSq(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const d3 = abx * (px - bx) + aby * (py - by) + abz * (pz - bz);
    const d4 = acx * (px - bx) + acy * (py - by) + acz * (pz - bz);
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
      else {
        const d5 = abx * (px - cx) + aby * (py - cy) + abz * (pz - cz);
        const d6 = acx * (px - cx) + acy * (py - cy) + acz * (pz - cz);
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); }
            else { const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/** 몸까지의 «정확» 무부호 거리 — 격자 근방 후보만 정밀 계산한다.
 * 사전 거르기는 격자 SDF가 하되 «판정»은 정확 거리가 한다(SDF 오차 ≤ h의 5%,
 * 거르기 문턱 10h = ${} 로 두 자릿수 여유). */
const CELL = sdfSpec.h * 10;
/** 몸 삼각형의 균일 격자 — «정확» 거리 계산의 후보만 좁힌다(값은 브루트포스와 같다). */
const BGRID = (() => {
  const cs = 0.05;
  const g = new Map<number, number[]>();
  const key = (a: number, b: number, c: number) => ((a + 2048) * 4096 + (b + 2048)) * 4096 + (c + 2048);
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const o = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3];
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(prim0.pos[o[0] + k], prim0.pos[o[1] + k], prim0.pos[o[2] + k]) / cs));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(prim0.pos[o[0] + k], prim0.pos[o[1] + k], prim0.pos[o[2] + k]) / cs));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const kk = key(i, j, k);
      let arr = g.get(kk); if (!arr) g.set(kk, (arr = [])); arr.push(t);
    }
  }
  return { cs, g, key };
})();
/** 몸 위의 «최근접 점» — 격자 후보 안에서 삼각형별 최근접점을 직접 고른다.
 * v3-23 §1-② 「목선 링을 몸에 정사영한 둘레」에 쓴다. */
function nearestBodyPoint(x: number, y: number, z: number): [number, number, number] {
  const { cs, g, key } = BGRID;
  const ci = Math.floor(x / cs), cj = Math.floor(y / cs), ck = Math.floor(z / cs);
  let best = Infinity;
  const out: [number, number, number] = [x, y, z];
  for (let r = 1; r <= 12; r++) {
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
      if (r > 1 && Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
      const arr = g.get(key(i, j, k));
      if (!arr) continue;
      for (const t of arr) {
        const a = bodyIdx[t] * 3, b = bodyIdx[t + 1] * 3, c = bodyIdx[t + 2] * 3;
        // 삼각형 위 최근접점을 «질량 좌표»로 직접 구한다(가장자리 포함)
        const ax = prim0.pos[a], ay = prim0.pos[a + 1], az = prim0.pos[a + 2];
        const abx = prim0.pos[b] - ax, aby = prim0.pos[b + 1] - ay, abz = prim0.pos[b + 2] - az;
        const acx = prim0.pos[c] - ax, acy = prim0.pos[c + 1] - ay, acz = prim0.pos[c + 2] - az;
        const d00 = abx * abx + aby * aby + abz * abz;
        const d01 = abx * acx + aby * acy + abz * acz;
        const d11 = acx * acx + acy * acy + acz * acz;
        const den = d00 * d11 - d01 * d01;
        const apx = x - ax, apy = y - ay, apz = z - az;
        const d20 = apx * abx + apy * aby + apz * abz;
        const d21 = apx * acx + apy * acy + apz * acz;
        let u = 0, v = 0;
        if (Math.abs(den) > 1e-24) { u = (d11 * d20 - d01 * d21) / den; v = (d00 * d21 - d01 * d20) / den; }
        if (u < 0) u = 0; if (v < 0) v = 0;
        if (u + v > 1) { const sSum = u + v; u /= sSum; v /= sSum; }
        const qx = ax + abx * u + acx * v, qy = ay + aby * u + acy * v, qz = az + abz * u + acz * v;
        const dd = (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2;
        if (dd < best) { best = dd; out[0] = qx; out[1] = qy; out[2] = qz; }
      }
    }
    if (best < (r * cs) ** 2) break;
  }
  return out;
}

function exactBodyDist(x: number, y: number, z: number): number {
  const { cs, g, key } = BGRID;
  const ci = Math.floor(x / cs), cj = Math.floor(y / cs), ck = Math.floor(z / cs);
  let best = Infinity;
  for (let r = 1; r <= 12; r++) {
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
      if (r > 1 && Math.abs(i - ci) < r && Math.abs(j - cj) < r && Math.abs(k - ck) < r) continue;
      const arr = g.get(key(i, j, k));
      if (!arr) continue;
      for (const t of arr) {
        const a = bodyIdx[t] * 3, b = bodyIdx[t + 1] * 3, c = bodyIdx[t + 2] * 3;
        const d2 = ptTriSq(x, y, z, prim0.pos[a], prim0.pos[a + 1], prim0.pos[a + 2], prim0.pos[b], prim0.pos[b + 1], prim0.pos[b + 2], prim0.pos[c], prim0.pos[c + 1], prim0.pos[c + 2]);
        if (d2 < best) best = d2;
      }
    }
    // 반경 r 셀 안에 «확실히» 최근접이 있으면 종료
    if (best < ((r - 0) * cs) ** 2) break;
  }
  return Math.sqrt(best);
}
/** 옷 정점 전체의 «몸 부호 있는 거리» 최소/관통 — 격자로 거르고 정확 거리로 판정 */
function bodyClearance(s: Solver) {
  let minD = Infinity, maxPen = 0, penCnt = 0, exactN = 0, worst = -1, worstPen = -1;
  for (let v = 0; v < s.n; v++) {
    const x = s.pos[v * 3], y = s.pos[v * 3 + 1], z = s.pos[v * 3 + 2];
    const g = sampleSdf(bodyG, x, y, z);
    if (g > CELL) { if (g < minD) minD = g; continue; }
    exactN++;
    const e = exactBodyDist(x, y, z);
    const signed = g < 0 ? -e : e;
    if (signed < minD) { minD = signed; worst = v; }
    const pen = THICK - signed;
    if (pen > 1e-9) { penCnt++; if (pen > maxPen) { maxPen = pen; worstPen = v; } }
  }
  return { minD, maxPen, penCnt, exactN, worst, worstPen };
}

/** G 도출 전용 «가벼운» 최소 거리 — 판정에는 쓰지 않는다(판정은 minPairDist). */
function minPairDistLite(pos: Float64Array, tris: number[]): number {
  return minPairDist(pos, tris, SEP * 2).min;
}

/** 비인접 삼각형 쌍의 최소 거리 — 균일 격자로 후보를 좁힌다(S3b는 O(T²)였다). */
function minPairDist(pos: Float64Array, tris: number[], window: number) {
  const T = tris.length / 3;
  const box = new Float64Array(T * 6);
  for (let t = 0; t < T; t++) {
    const o = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
    for (let k = 0; k < 3; k++) {
      box[t * 6 + k] = Math.min(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
      box[t * 6 + 3 + k] = Math.max(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
    }
  }
  const cs = Math.max(window * 2, 0.01);
  const grid = new Map<number, number[]>();
  const key = (a: number, b: number, c: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (c + 4096);
  for (let t = 0; t < T; t++) {
    const i0 = Math.floor(box[t * 6] / cs), i1 = Math.floor(box[t * 6 + 3] / cs);
    const j0 = Math.floor(box[t * 6 + 1] / cs), j1 = Math.floor(box[t * 6 + 4] / cs);
    const k0 = Math.floor(box[t * 6 + 2] / cs), k1 = Math.floor(box[t * 6 + 5] / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const kk = key(i, j, k);
      let arr = grid.get(kk); if (!arr) grid.set(kk, (arr = [])); arr.push(t);
    }
  }
  let min = Infinity, viol = 0, near = 0, hits = 0;
  const worst = [-1, -1];
  const seen = new Set<number>();
  for (const arr of grid.values())
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const i = arr[a], j = arr[b];
      const pk = i < j ? i * 1e7 + j : j * 1e7 + i;
      if (seen.has(pk)) continue;
      seen.add(pk);
      const A = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
      const Bt = [tris[j * 3], tris[j * 3 + 1], tris[j * 3 + 2]];
      if (A.some((v) => Bt.includes(v))) continue;
      let gap = 0;
      for (let k = 0; k < 3; k++) gap = Math.max(gap, box[i * 6 + k] - box[j * 6 + 3 + k], box[j * 6 + k] - box[i * 6 + 3 + k]);
      if (gap > window) continue;
      let d = Infinity;
      for (let k = 0; k < 3; k++) {
        d = Math.min(d, Math.sqrt(ptTriSq(pos[A[k] * 3], pos[A[k] * 3 + 1], pos[A[k] * 3 + 2], pos[Bt[0] * 3], pos[Bt[0] * 3 + 1], pos[Bt[0] * 3 + 2], pos[Bt[1] * 3], pos[Bt[1] * 3 + 1], pos[Bt[1] * 3 + 2], pos[Bt[2] * 3], pos[Bt[2] * 3 + 1], pos[Bt[2] * 3 + 2])));
        d = Math.min(d, Math.sqrt(ptTriSq(pos[Bt[k] * 3], pos[Bt[k] * 3 + 1], pos[Bt[k] * 3 + 2], pos[A[0] * 3], pos[A[0] * 3 + 1], pos[A[0] * 3 + 2], pos[A[1] * 3], pos[A[1] * 3 + 1], pos[A[1] * 3 + 2], pos[A[2] * 3], pos[A[2] * 3 + 1], pos[A[2] * 3 + 2])));
      }
      if (d < window) near++;
      if (d < SEP - TOL_SELF) viol++;
      // 교차하는 두 삼각형은 AABB 간극이 ≤ 0 이므로 «반드시» 이 후보 집합 안에 있다
      if (triTriHit(pos, A, Bt)) hits++;
      if (d < min) { min = d; worst[0] = i; worst[1] = j; }
    }
  return { min, viol, near, hits, worst };
}

/* ── v3-16 관통 모형의 θ 항 (하네스 사본 · v3Body.ts와 «독립») ───────────── */
const EKEY4 = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
/** 몸 메시의 엣지별 이면각 결손 — v3-15 §1이 등록한 정의 그대로 */
function edgeDihedrals(pos: Float32Array, idx: Uint32Array) {
  const w = weldMap(pos, 0);
  const em = new Map<number, number[]>();
  for (let t = 0; t < idx.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const a = w[idx[t * 3 + k]], b = w[idx[t * 3 + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = EKEY4(a, b);
      let ar = em.get(key); if (!ar) em.set(key, (ar = [])); ar.push(t);
    }
  const N = (t: number) => {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const Ln = Math.hypot(nx, ny, nz) || 1;
    return [nx / Ln, ny / Ln, nz / Ln];
  };
  const out: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; th: number }[] = [];
  for (const [key, ar] of em) {
    if (ar.length !== 2) continue;
    const n1 = N(ar[0]), n2 = N(ar[1]);
    const th = Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2])));
    const b = key % 4194304, a = (key - b) / 4194304;
    out.push({ ax: pos[a * 3], ay: pos[a * 3 + 1], az: pos[a * 3 + 2], bx: pos[b * 3], by: pos[b * 3 + 1], bz: pos[b * 3 + 2], th });
  }
  return out;
}
type Dihedrals = ReturnType<typeof edgeDihedrals>;
/** 점에서 h 이내 엣지의 «최대» 이면각 결손 — v3-16 §1이 확정한 축약 */
function thetaAt(ed: Dihedrals, x: number, y: number, z: number, h: number): number {
  let best = 0;
  const h2 = h * h;
  for (const e of ed) {
    if (e.th <= best) continue;
    const ex = e.bx - e.ax, ey = e.by - e.ay, ez = e.bz - e.az;
    const ll = ex * ex + ey * ey + ez * ez;
    let t = ll > 0 ? ((x - e.ax) * ex + (y - e.ay) * ey + (z - e.az) * ez) / ll : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = e.ax + t * ex - x, dy = e.ay + t * ey - y, dz = e.az + t * ez - z;
    if (dx * dx + dy * dy + dz * dz <= h2) best = e.th;
  }
  return best;
}
/** 격자에서 잰 «매끈한» 예측 관통 = (1/8)·Σ 2차 중심차분 (v3-14 §1) */
function predSmooth(g: GridSdf, x: number, y: number, z: number): number {
  const c = sampleSdf(g, x, y, z);
  return (
    (sampleSdf(g, x + g.h, y, z) + sampleSdf(g, x - g.h, y, z) +
      sampleSdf(g, x, y + g.h, z) + sampleSdf(g, x, y - g.h, z) +
      sampleSdf(g, x, y, z + g.h) + sampleSdf(g, x, y, z - g.h) - 6 * c) / 8
  );
}
/** P_pred_ext = P_smooth + c·f(θ)·h — v3-15 §1 등록 · c·f·통계 전부 그대로 */
const CREASE_C = 0.283;
const predExt = (g: GridSdf, ed: Dihedrals, x: number, y: number, z: number) =>
  predSmooth(g, x, y, z) + CREASE_C * Math.min(1, thetaAt(ed, x, y, z, g.h) / (Math.PI / 2)) * g.h;

/* ── 삼각형–삼각형 «교차» 판정기 (S3b 정의 그대로 · 하네스 사본) ─────────── */
function segTriHit(p: Float64Array, s0: number, s1: number, t0: number, t1: number, t2: number): boolean {
  const dx = p[s1] - p[s0], dy = p[s1 + 1] - p[s0 + 1], dz = p[s1 + 2] - p[s0 + 2];
  const e1x = p[t1] - p[t0], e1y = p[t1 + 1] - p[t0 + 1], e1z = p[t1 + 2] - p[t0 + 2];
  const e2x = p[t2] - p[t0], e2y = p[t2 + 1] - p[t0 + 1], e2z = p[t2 + 2] - p[t0 + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-20) return false;
  const inv = 1 / det;
  const tx = p[s0] - p[t0], ty = p[s0 + 1] - p[t0 + 1], tz = p[s0 + 2] - p[t0 + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u <= 0 || u >= 1) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v <= 0 || u + v >= 1) return false;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return tt > 0 && tt < 1;
}
function triTriHit(p: Float64Array, a: number[], b: number[]): boolean {
  const A = [a[0] * 3, a[1] * 3, a[2] * 3], B = [b[0] * 3, b[1] * 3, b[2] * 3];
  for (let k = 0; k < 3; k++) {
    if (segTriHit(p, A[k], A[(k + 1) % 3], B[0], B[1], B[2])) return true;
    if (segTriHit(p, B[k], B[(k + 1) % 3], A[0], A[1], A[2])) return true;
  }
  return false;
}

const seg3 = (p: Float64Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
const polyLen3 = (p: Float64Array, ix: number[]) => ix.slice(1).reduce((s, v, k) => s + seg3(p, ix[k], v), 0);

/* ══ §3~§7 — 봉제 자기검사 · 착장 · 시험 7종 · 갈래 ═══════════════════════ */
if (run('3') && D_CHOSEN > 0) {
  const sc = assemble(D_CHOSEN);
  const { front, back, N_sh, N_nk, nvB } = sc;
  const s = sc.s;
  const pos0 = Float64Array.from(s.pos);

  console.log(`\n╔══ §3 봉제 — 이음선 = 정지 길이 2×두께(${SEP * 1000}mm)인 거리 제약 · 강성 = 멤브레인 ══╗`);
  console.log(`   메시 d=${(D_CHOSEN * 1000).toFixed(1)}mm · 정점 ${sc.n} · 삼각형 ${sc.tris.length / 3} · 제약 ${sc.cons.length}(이음선 ${sc.seamCons.length})`);
  console.log(`   ${'이음선'.padEnd(10)}${'쌍'.padStart(5)}${'정지A[cm]'.padStart(11)}${'정지B[cm]'.padStart(11)}${'차[%]'.padStart(7)}${'초기 짝거리 중앙[cm]'.padStart(21)}${'p95'.padStart(8)}${'최대'.padStart(8)}${'중앙/2mm'.padStart(10)}`);
  let selfOk = true, pairTot = 0;
  for (const sm of sc.seams) {
    const la = sm.a.slice(1).reduce((t, v, k) => t + Math.hypot(sc.uv[v * 2] - sc.uv[sm.a[k] * 2], sc.uv[v * 2 + 1] - sc.uv[sm.a[k] * 2 + 1]), 0);
    const lb = sm.b.slice(1).reduce((t, v, k) => t + Math.hypot(sc.uv[v * 2] - sc.uv[sm.b[k] * 2], sc.uv[v * 2 + 1] - sc.uv[sm.b[k] * 2 + 1]), 0);
    const diff = (Math.abs(la - lb) / Math.max(la, lb)) * 100;
    const gaps = sm.a.map((v, k) => seg3(pos0, v, sm.b[k]));
    pairTot += sm.a.length;
    if (sm.a.length !== sm.b.length || diff > 1) selfOk = false;
    const gs = [...gaps].sort((x, y2) => x - y2);
    const gq = (t: number) => gs[Math.min(gs.length - 1, Math.floor(t * gs.length))];
    console.log(`   ${sm.name.padEnd(10)}${String(sm.a.length).padStart(5)}${(la * 100).toFixed(3).padStart(11)}${(lb * 100).toFixed(3).padStart(11)}${diff.toFixed(4).padStart(7)}${(gq(0.5) * 100).toFixed(2).padStart(21)}${(gq(0.95) * 100).toFixed(2).padStart(8)}${(gs[gs.length - 1] * 100).toFixed(2).padStart(8)}${(gq(0.5) / SEP).toFixed(1).padStart(10)}`);
  }
  // 미대응 경계 — 경계 엣지 중 이음선에 들어가지 않은 정점
  const sewn = new Set<number>();
  for (const sm of sc.seams) { for (const v of sm.a) sewn.add(v); for (const v of sm.b) sewn.add(v); }
  const bnd = new Set<number>();
  for (const p of sc.panels) {
    for (let i = 0; i <= p.nu; i++) { bnd.add(at(p, i, 0)); bnd.add(at(p, i, p.nv)); }
    for (let j = 0; j <= p.nv; j++) { bnd.add(at(p, 0, j)); bnd.add(at(p, p.nu, j)); }
  }
  const free = [...bnd].filter((v) => !sewn.has(v)).length;
  /* 봉제되지 «않아야» 하는 경계를 «집합으로» 만들어 대조한다(식으로 세면 모서리를
   * 두 번 세거나 빠뜨린다 — 초판이 130 vs 138로 어긋났다). */
  const freeSet = new Set<number>();
  for (const pn of [front, back]) {
    for (let i = 1; i < sc.nuB; i++) freeSet.add(at(pn, i, 0));                    // 밑단(옆선 끝점 제외)
    for (let i = N_sh + 1; i < N_sh + N_nk; i++) freeSet.add(at(pn, i, nvB));      // 목선(어깨 끝점 제외)
  }
  for (const pn of sc.slv) for (let i = 1; i < sc.nuS; i++) freeSet.add(at(pn, i, 0)); // 소매 밑단
  const freeExpect = freeSet.size;
  const mismatch = [...bnd].filter((v) => (sewn.has(v) ? freeSet.has(v) : !freeSet.has(v))).length;
  console.log(`   ② 자기검사: 대응 1:1 ${selfOk ? 'PASS' : 'FAIL'} · 쌍 총 ${pairTot} · 미봉제 경계 정점 ${free} (밑단+목선+소매밑단 집합 ${freeExpect} · 불일치 ${mismatch}) ⟹ ${free === freeExpect && mismatch === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`   메타 대조(v2 해상도): shoulder ${meta.seamCounts.shoulder} · side ${meta.seamCounts.side} · armhole ${meta.seamCounts.armhole} · sleeveUnder ${meta.seamCounts.sleeveUnder} — 해상도가 달라 수는 다르다(길이가 정본)`);
  const gate2 = selfOk && free === freeExpect && mismatch === 0;

  console.log(`\n╔══ §4 초기 적법성 ══╗`);
  const st = substepsOf(sc);
  const bc0 = bodyClearance(s);
  const mp0 = minPairDist(s.pos, sc.tris, SEP * 3);
  const pinned = Array.from({ length: sc.n }, (_, v) => v).filter((v) => s.invMass[v] === 0).length;
  console.log(`   몸 최소 «부호 있는» 거리 ${(bc0.minD * 1000).toFixed(3)}mm (두께 ${THICK * 1000}mm · 정확 계산 ${bc0.exactN}점) ⟹ ${bc0.minD > THICK ? '적법' : '위법'}`);
  console.log(`   비인접 삼각형 최소 거리 ${(mp0.min * 1000).toFixed(3)}mm (sep ${SEP * 1000}mm) ⟹ ${mp0.min >= SEP - TOL_SELF ? '적법' : '위법'}`);
  console.log(`   고정 정점(invMass=0) ${pinned} · 서브스텝 ${st.sub}(멤 ${st.memb} / 굽 ${st.bend}) · 최소각 ${st.q.minAng.toFixed(1)}° · 종횡비max ${st.q.aspMax.toFixed(2)}`);
  const gate1 = bc0.minD > THICK && mp0.min >= SEP - TOL_SELF;
  if (!gate1) console.log(`   ⟹ ① 위법 — 착장을 «판정하지 않는다»(v3-12 선례)`);

  const FRAMES = Number(process.env.FRAMES ?? 600);
  const shoulderIx = [...sc.seams.filter((x) => x.name.startsWith('어깨')).flatMap((x) => [...x.a, ...x.b])];
  const neckF = Array.from({ length: N_nk + 1 }, (_, k) => at(front, N_sh + k, nvB));
  const neckB = Array.from({ length: N_nk + 1 }, (_, k) => at(back, N_sh + k, nvB));
  const ringRest = 2 * LEN_NECK;
  const meanY = (ix: number[], p: Float64Array) => ix.reduce((t, v) => t + p[v * 3 + 1], 0) / ix.length;
  const ring = (p: Float64Array) => polyLen3(p, neckF) + polyLen3(p, neckB);
  const seamGap = (p: Float64Array) => {
    let mx = 0, sum = 0, n = 0;
    for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) { const g = Math.abs(seg3(p, sm.a[k], sm.b[k]) - SEP); mx = Math.max(mx, g); sum += g; n++; }
    return { mean: sum / n, max: mx };
  };

  /* ── 체크포인트 — 85분 실행이 죽어도 잃지 않는다 ────────────────────────
   * 25프레임마다 저장(8.5s/f 실측 ⟹ 손실 상한 ≈ 3.5분). 형식은 헤더 길이(uint32 LE) +
   * JSON 헤더 + Float64 pos(3n) + Float64 vel(3n). 헤더의 (n, d)가 다르면 «무시»한다 —
   * 다른 장면의 상태를 이어받는 것이 가장 나쁜 실패다. */
  const CKPT = process.env.CKPT ?? '.v3cache/s4-checkpoint.bin';
  const CK_EVERY = 25;
  function saveCk(frame: number) {
    mkdirSync(dirname(CKPT), { recursive: true });
    // CKKEEP=1 이면 프레임 번호를 붙여 «보존»한다 — v3-19의 f=175를 남기지 않아
    // v3-22 §2 안전장치의 대조 상태를 잃었다(재생성 비용 약 1.7시간).
    const hdr = Buffer.from(JSON.stringify({ frame, n: sc.n, d: D_CHOSEN, sub: st.sub, sig: PLACE_SIG }), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(hdr.length, 0);
    const blob = Buffer.concat([len, hdr, Buffer.from(s.pos.buffer.slice(0)), Buffer.from(s.vel.buffer.slice(0))]);
    writeFileSync(CKPT, blob);
    if (process.env.CKKEEP === '1') writeFileSync(CKPT.replace(/\.bin$/, `.f${frame}.bin`), blob);
  }
  function loadCk(): number {
    if (!existsSync(CKPT)) return 0;
    const b = readFileSync(CKPT);
    const hl = b.readUInt32LE(0);
    const h = JSON.parse(b.subarray(4, 4 + hl).toString('utf8'));
    if (h.n !== sc.n || Math.abs(h.d - D_CHOSEN) > 1e-12 || h.sig !== PLACE_SIG) {
      console.log(`   [체크포인트] 장면 불일치(n ${h.n}/${sc.n} · d ${h.d}/${D_CHOSEN} · 배치 ${h.sig}/${PLACE_SIG}) ⟹ «무시»하고 처음부터`);
      return 0;
    }
    const off = 4 + hl;
    const nb = sc.n * 3 * 8;
    s.pos.set(new Float64Array(b.buffer.slice(b.byteOffset + off, b.byteOffset + off + nb)));
    s.vel.set(new Float64Array(b.buffer.slice(b.byteOffset + off + nb, b.byteOffset + off + 2 * nb)));
    console.log(`   [체크포인트] f=${h.frame} 에서 «재개»`);
    return h.frame;
  }

  /* ── v3-19b 진단 계기 (전부 «판정 아님» · 기본 off · 처방 0) ─────────────
   * `ANALYZE=1`  체크포인트 상태를 읽어 |v| 분포 · 패널별 · 이음선별로 낸다
   * `PROBE=<끌 것들>` 체크포인트에서 이어 PROBEF 프레임만 돌리되 층을 «하나씩 끈다».
   *   끌 것: none | self | body | seam | bend | inplane | all (쉼표 결합 가능)
   *   끄면 물리가 틀려지지만 «어느 층이 |v| 를 만드는가»를 가르는 것이 목적이다.
   * `FINAL=1`  체크포인트 상태로 §6 참고 산출 + §7 캡처만 한다(스텝 0)
   * 계기 규범(함정 18)대로 |v| 는 «분포»로 낸다 — 정착 «문턱»은 등록값 그대로다. */
  const vList = () => Array.from({ length: sc.n }, (_, i) => Math.hypot(s.vel[i * 3], s.vel[i * 3 + 1], s.vel[i * 3 + 2]));
  const ownerOf = (vi: number) => sc.panels.find((pn) => vi >= pn.base && vi < pn.base + (pn.nu + 1) * (pn.nv + 1))?.name ?? '?';
  /** 정점이 «어느 이음선»에 걸려 있는가(없으면 빈 문자열) */
  const seamOf = (() => {
    const m = new Map<number, string>();
    for (const sm of sc.seams) { for (const v of sm.a) m.set(v, sm.name); for (const v of sm.b) m.set(v, sm.name); }
    return (vi: number) => m.get(vi) ?? '';
  })();
  function vReport(tag: string) {
    const v = vList();
    const srt = [...v].sort((x, y2) => x - y2);
    const qq = (t: number) => srt[Math.min(srt.length - 1, Math.floor(t * srt.length))];
    console.log(`   ${tag.padEnd(26)}중앙 ${(qq(0.5) * 1000).toFixed(1).padStart(9)} · p95 ${(qq(0.95) * 1000).toFixed(1).padStart(9)} · 최대 ${(srt[srt.length - 1] * 1000).toFixed(1).padStart(10)} · 문턱초과 ${String(v.filter((q2) => q2 > V_SETTLE).length).padStart(5)}/${sc.n}`);
    return { v, med: qq(0.5), max: srt[srt.length - 1] };
  }
  function topVerts(v: number[], k: number) {
    const ix = v.map((_, i) => i).sort((x, y2) => v[y2] - v[x]).slice(0, k);
    console.log(`   |v| 상위 ${k} — 위치[cm] · 패널 · 이음선`);
    for (const i of ix)
      console.log(`     ${(v[i] * 1000).toFixed(0).padStart(8)} mm/s  (${[0, 1, 2].map((c) => (s.pos[i * 3 + c] * 100).toFixed(1).padStart(7)).join(',')})  ${ownerOf(i).padEnd(8)} ${seamOf(i)}`);
    const byPanel = new Map<string, number>(), bySeam = new Map<string, number>();
    for (const i of ix) {
      byPanel.set(ownerOf(i), (byPanel.get(ownerOf(i)) ?? 0) + 1);
      const sn = seamOf(i) || '(비이음선)';
      bySeam.set(sn, (bySeam.get(sn) ?? 0) + 1);
    }
    console.log(`     ⟹ 패널 분포 ${[...byPanel].map(([k2, c]) => `${k2} ${c}`).join(' · ')}`);
    console.log(`     ⟹ 이음선 분포 ${[...bySeam].map(([k2, c]) => `${k2} ${c}`).join(' · ')}`);
  }

  if (process.env.ANALYZE === '1') {
    const fr = loadCk();
    console.log(`\n╔══ 체크포인트 진단 (f=${fr} · 판정 아님) ══╗`);
    const r = vReport('|v| [mm/s] 전체');
    console.log(`   0.6mm/s 초과 ${r.v.filter((q2) => q2 > V_SETTLE / 10).length} / ${sc.n}`);
    for (const pn of sc.panels) {
      const N = (pn.nu + 1) * (pn.nv + 1);
      let sy = 0, mx = 0, over = 0;
      for (let i = pn.base; i < pn.base + N; i++) { sy += s.pos[i * 3 + 1]; mx = Math.max(mx, r.v[i]); if (r.v[i] > V_SETTLE) over++; }
      console.log(`   ${pn.name.padEnd(8)} 평균 y ${((sy / N) * 100).toFixed(2)}cm · |v|max ${(mx * 1000).toFixed(1)}mm/s · 문턱 초과 ${over}/${N}`);
    }
    for (const sm of sc.seams) {
      const g = sm.a.map((a2, k) => seg3(s.pos, a2, sm.b[k])).sort((x, y2) => x - y2);
      console.log(`   ${sm.name.padEnd(8)} 간극 중앙 ${(g[Math.floor(g.length / 2)] * 1000).toFixed(2)} · 최대 ${(g[g.length - 1] * 1000).toFixed(2)} mm`);
    }
    topVerts(r.v, 20);
    // §3 대조 — 서브스텝 산정은 «어느 시점의 상태»인가
    const subB0 = substepsForBending(DT, s, sc.bends, 0.95);
    console.log(`   서브스텝 재산정 @f=${fr}: 굽힘 ${subB0} (배치 시점 ${st.bend} · 멤브레인 ${st.memb} · 실행값 ${st.sub})`);
    process.exit(0);
  }

  if (process.env.PROBE) {
    const off = new Set(process.env.PROBE.split(',').map((x) => x.trim()));
    const all = off.has('all');
    const K = Number(process.env.PROBEF ?? 5);
    const fr = loadCk();
    const cons = sc.cons.filter((c) =>
      c.kind === 'dist' ? !(all || off.has('seam')) :
      c.kind === 'bend' ? !(all || off.has('bend')) : !(all || off.has('inplane')));
    const pp: SolverParams = {
      dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
      ...(all || off.has('body') ? {} : { collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU } }),
      ...(all || off.has('self') ? {} : { selfCollision: { tris: sc.tris, thickness: THICK } }),
    };
    const t0 = performance.now();
    for (let k = 0; k < K; k++) step(s, cons, pp);
    const label = `PROBE=${process.env.PROBE} (제약 ${cons.length}/${sc.cons.length})`;
    const r = vReport(label);
    console.log(`   f=${fr}+${K} · ${((performance.now() - t0) / K / 1000).toFixed(2)} s/f`);
    if (process.env.TOPV === '1') topVerts(r.v, 20);
    process.exit(0);
  }

  /* ── v3-22 §1 정착 채널 — 정의는 «측정 전»에 커밋됐다(1be41fd) ─────────────
   * 주  창 N=10프레임의 정점 «순변위» 최대 ≤ 0.1mm   (N = 1/damping · θ = S3b ② 재수렴 폭)
   * 부  목선 링/정지 ≤ 1e-4 · 밑단 평균 y ≤ 0.1mm · 시접 틈 중앙 ≤ 0.1mm
   * 참고 |v|max 및 |v| 분포 — 판정에 쓰지 않고 «함께» 적는다
   * `SETTLE=1` · 대조군은 `NOBODY=1`(몸 충돌을 끄면 옷이 떨어진다 ⟹ 반드시 FAIL) */
  /* ── v3-23 §1 목선 신장의 «자리» — 재는 것이 전부다(처방 0) ─────────────── */
  /* ── v3-24 §1 원소 변형률 — 시험이 재는 통계를 «국소»로 맞춘다 ──────────── */
  /* ── v3-26 S5 — 원단 1종 실행 + 관측량 4종. 정의는 §0(커밋)에 «실행 전» 등재 ──
   * `S5=1 S5TAG=<이름> MATK/MATRHO/MATB [SUBMUL=2]` · 조기 종료 = v3-22 형상 불변 채널 */
  if (process.env.S5 === '1') {
    const TAG = process.env.S5TAG ?? 'fabric';
    const SUBMUL = Number(process.env.SUBMUL ?? 1);
    const stS = substepsOf(sc);
    /** v3-27 §1 — 축을 «따로» 움직인다. 기본은 산정값 그대로(비트 동일) */
    const SUB = Number(process.env.SUBSTEPS ?? stS.sub * SUBMUL);
    const SELF_EVERY = Number(process.env.SELFEVERY ?? 1);
    const N_WIN = Math.round(1 / (DAMP * DT));
    const TH_POS = 1e-4;
    const hemIx = Array.from({ length: sc.nuB + 1 }, (_, i) => at(front, i, 0)).concat(
      Array.from({ length: sc.nuB + 1 }, (_, i) => at(back, i, 0)));
    /* 밑단 «닫힌 고리» — 앞판 밑단(좌→우) + 뒤판 밑단(우→좌). 옆선에서 이어진다 */
    const hemLoop = [
      ...Array.from({ length: sc.nuB + 1 }, (_, i) => at(front, i, 0)),
      ...Array.from({ length: sc.nuB + 1 }, (_, i) => at(back, sc.nuB - i, 0)),
    ];
    const seamMed = (pp: Float64Array) => {
      const g: number[] = [];
      for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) g.push(seg3(pp, sm.a[k], sm.b[k]));
      g.sort((x, y2) => x - y2);
      return g[Math.floor(g.length / 2)];
    };
    /* O1 밑단 둘레 · O2 주름 파장 (§0-2 정의 그대로) */
    function hemObs() {
      const pts: [number, number, number][] = hemLoop.map((v) => [s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]]);
      const M = pts.length;
      const acc = [0];
      for (let k = 1; k <= M; k++) {
        const a = pts[k - 1], b = pts[k % M];
        acc.push(acc[k - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
      const total = acc[M];
      const NS2 = 256;
      const r: number[] = [];
      for (let i = 0; i < NS2; i++) {
        const t = (total * i) / NS2;
        let k = 0;
        while (k < M && acc[k + 1] < t) k++;
        const seg = acc[k + 1] - acc[k];
        const f2 = seg > 0 ? (t - acc[k]) / seg : 0;
        const a = pts[k], b = pts[(k + 1) % M];
        const x = a[0] + (b[0] - a[0]) * f2, z = a[2] + (b[2] - a[2]) * f2;
        r.push(Math.hypot(x, z - AXIS_Z));
      }
      const W2 = Math.max(2, Math.round(NS2 / 8));
      let cross = 0;
      let prev = 0;
      for (let i = 0; i < NS2; i++) {
        let sm2 = 0;
        for (let j = -W2; j <= W2; j++) sm2 += r[(i + j + NS2 * 4) % NS2];
        const res = r[i] - sm2 / (2 * W2 + 1);
        if (i > 0 && res * prev < 0) cross++;
        prev = res;
      }
      return { girth: total, lambda: cross >= 2 ? total / (cross / 2) : NaN, cross };
    }
    const bodyObs = () => {
      const d: number[] = [];
      for (let v = 0; v < sc.n; v++) d.push(sampleSdf(bodyG, s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]));
      d.sort((x, y2) => x - y2);
      return { med: d[Math.floor(sc.n / 2)], touch: (d.filter((x) => x <= SEP).length / sc.n) * 100 };
    };

    const rest0 = sc.seamCons.map((c) => seg3(pos0, c.i, c.j));
    const RAMP_N = Math.ceil((Math.max(...rest0) - SEP) / (G * DT * DT));
    const setRest = (f: number) => {
      const t = Math.min(1, f / RAMP_N);
      for (let k = 0; k < sc.seamCons.length; k++) sc.seamCons[k].rest = rest0[k] + (SEP - rest0[k]) * t;
    };
    const p5: SolverParams = {
      dt: DT, substeps: SUB, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: sc.tris, thickness: THICK, every: SELF_EVERY },
    };
    console.log(`\n╔══ S5 [${TAG}] k=${KMEM} ρ=${MAT.rho} B=${MAT.B.toExponential(3)} · sub ${SUB}(산정 ${stS.sub} 멤 ${stS.memb}/굽 ${stS.bend}) · 자기충돌 주기 ${SELF_EVERY} · d ${(D_CHOSEN * 1000).toFixed(1)}mm · 램프 ${RAMP_N} · 상한 ${FRAMES} ══╗`);
    let f0 = loadCk();
    let ref = Float64Array.from(s.pos);
    let refO = { ring: ring(s.pos) / ringRest, hem: meanY(hemIx, s.pos), seam: seamMed(s.pos) };
    let settledAt = 0, diverged = false;
    const t0 = performance.now();
    let f = f0;
    for (; f < FRAMES; f++) {
      setRest(f + 1);
      step(s, sc.cons, p5);
      if (!Number.isFinite(s.pos[0])) { diverged = true; break; }
      if ((f + 1) % 25 === 0) saveCk(f + 1);
      if ((f + 1) % N_WIN === 0) {
        let net = 0;
        for (let v = 0; v < sc.n; v++)
          net = Math.max(net, Math.hypot(s.pos[v * 3] - ref[v * 3], s.pos[v * 3 + 1] - ref[v * 3 + 1], s.pos[v * 3 + 2] - ref[v * 3 + 2]));
        const o1 = { ring: ring(s.pos) / ringRest, hem: meanY(hemIx, s.pos), seam: seamMed(s.pos) };
        const ok = net <= TH_POS && Math.abs(o1.ring - refO.ring) <= 1e-4 &&
          Math.abs(o1.hem - refO.hem) <= TH_POS && Math.abs(o1.seam - refO.seam) <= TH_POS;
        if (f + 1 > RAMP_N && ok) { settledAt = f + 1; break; }
        if ((f + 1) % 50 === 0)
          console.log(`   f=${String(f + 1).padStart(4)} ${((performance.now() - t0) / 1000).toFixed(0).padStart(6)}s · 창 순변위 ${(net * 1000).toFixed(4)}mm · 밑단y ${(o1.hem * 100).toFixed(2)}cm · 목선 ${o1.ring.toFixed(4)}`);
        ref = Float64Array.from(s.pos);
        refO = o1;
      }
    }
    const wall = (performance.now() - t0) / 1000;
    const H = hemObs(), Bo = bodyObs();
    const bc = bodyClearance(s);
    const mp = minPairDist(s.pos, sc.tris, SEP * 3);
    const ed = edgeDihedrals(prim0.pos, bodyIdx);
    let pex = 0;
    if (bc.worstPen >= 0) pex = predExt(bodyG, ed, s.pos[bc.worstPen * 3], s.pos[bc.worstPen * 3 + 1], s.pos[bc.worstPen * 3 + 2]);
    let lamMax = 0;
    for (const c of sc.cons) {
      if (c.kind !== 'inplane') continue;
      const o0 = c.i0 * 3, o1b = c.i1 * 3, o2 = c.i2 * 3;
      const e1 = [s.pos[o1b] - s.pos[o0], s.pos[o1b + 1] - s.pos[o0 + 1], s.pos[o1b + 2] - s.pos[o0 + 2]];
      const e2 = [s.pos[o2] - s.pos[o0], s.pos[o2 + 1] - s.pos[o0 + 1], s.pos[o2 + 2] - s.pos[o0 + 2]];
      const xu = [c.a * e1[0] + c.b * e2[0], c.a * e1[1] + c.b * e2[1], c.a * e1[2] + c.b * e2[2]];
      const xv = [c.c * e1[0] + c.d * e2[0], c.c * e1[1] + c.d * e2[1], c.c * e1[2] + c.d * e2[2]];
      const C00 = xu[0] ** 2 + xu[1] ** 2 + xu[2] ** 2, C11 = xv[0] ** 2 + xv[1] ** 2 + xv[2] ** 2;
      const C01 = xu[0] * xv[0] + xu[1] * xv[1] + xu[2] * xv[2];
      const tr = C00 + C11, dt2 = Math.sqrt(Math.max(0, (C00 - C11) ** 2 + 4 * C01 * C01));
      lamMax = Math.max(lamMax, Math.sqrt(Math.max(0, 0.5 * (tr + dt2))));
    }
    const gaps: number[] = [];
    for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) gaps.push(seg3(s.pos, sm.a[k], sm.b[k]));
    gaps.sort((x, y2) => x - y2);
    console.log(`   [S5:${TAG}] 정착 ${settledAt || '미도달'} · 프레임 ${f + 1} · ${wall.toFixed(0)}초 · ${(wall / Math.max(1, f + 1 - f0)).toFixed(2)} s/f · 발산 ${diverged ? '있음' : '0'}`);
    console.log(`   [O:${TAG}] O1 밑단둘레 ${(H.girth * 100).toFixed(2)}cm · O2 파장 ${(H.lambda * 100).toFixed(2)}cm(영교차 ${H.cross}) · O3 간극중앙 ${(Bo.med * 1000).toFixed(3)}mm · O4 접촉 ${Bo.touch.toFixed(2)}%`);
    console.log(`   [S4:${TAG}] 관통 ${(bc.maxPen * 1000).toFixed(4)}mm/P_ext ${(pex * 1000).toFixed(4)} = ${(bc.maxPen / (pex || 1)).toFixed(3)} · 교차 ${mp.hits} · 시접중앙 ${(gaps[Math.floor(gaps.length / 2)] * 1000).toFixed(2)}mm · 목선 ${(ring(s.pos) / ringRest).toFixed(4)} · λmax ${lamMax.toFixed(4)} · 고정정점 ${pinned}`);
    const OUT = process.env.CAPDIR ?? `docs/captures/v3-26-S5/${TAG}`;
    mkdirSync(OUT, { recursive: true });
    const clothPos = Float64Array.from(s.pos);
    const colors: [number, number, number][] = [[40, 90, 200], [200, 70, 60], [60, 160, 90], [60, 160, 90]];
    const meshes: Mesh[] = [{ pos: prim0.pos, idx: bodyIdx, color: [190, 185, 178] }];
    for (const [pi, pn] of sc.panels.entries()) meshes.push({ pos: clothPos, idx: Uint32Array.from(pn.tris), color: colors[pi] });
    // 카메라를 4종에서 «같게» 두려고 bbox를 몸 기준으로 고정한다
    const lo: [number, number, number] = [-0.45, Y_HEM - 0.15, AXIS_Z - 0.35];
    const hi: [number, number, number] = [0.45, Y_TOP + 0.12, AXIS_Z + 0.35];
    for (const view of VIEWS) writePng(`${OUT}/${view.name}.png`, 760, 1000, render(meshes, view, { lo, hi }, 760, 1000));
    console.log(`   [캡처:${TAG}] ${OUT}/{front,sideXplus,back}.png · CC 판정 0`);
    process.exit(0);
  }

  if (process.env.STRAIN === '1') {
    const fr = loadCk();
    const lam: number[] = [];
    let wmax = 0, wi = -1;
    for (const c of sc.cons) {
      if (c.kind !== 'inplane') continue;
      const o0 = c.i0 * 3, o1 = c.i1 * 3, o2 = c.i2 * 3;
      const e1 = [s.pos[o1] - s.pos[o0], s.pos[o1 + 1] - s.pos[o0 + 1], s.pos[o1 + 2] - s.pos[o0 + 2]];
      const e2 = [s.pos[o2] - s.pos[o0], s.pos[o2 + 1] - s.pos[o0 + 1], s.pos[o2 + 2] - s.pos[o0 + 2]];
      const xu = [c.a * e1[0] + c.b * e2[0], c.a * e1[1] + c.b * e2[1], c.a * e1[2] + c.b * e2[2]];
      const xv = [c.c * e1[0] + c.d * e2[0], c.c * e1[1] + c.d * e2[1], c.c * e1[2] + c.d * e2[2]];
      const C00 = xu[0] * xu[0] + xu[1] * xu[1] + xu[2] * xu[2];
      const C11 = xv[0] * xv[0] + xv[1] * xv[1] + xv[2] * xv[2];
      const C01 = xu[0] * xv[0] + xu[1] * xv[1] + xu[2] * xv[2];
      // C = FᵀF 의 큰 고유값 ⟹ 주신장 λ = √λ_max
      const tr = C00 + C11, det = Math.sqrt(Math.max(0, (C00 - C11) ** 2 + 4 * C01 * C01));
      const l = Math.sqrt(Math.max(0, 0.5 * (tr + det)));
      lam.push(l);
      if (l > wmax) { wmax = l; wi = c.i0; }
    }
    const v = [...lam].sort((x, y2) => x - y2);
    const q = (t: number) => v[Math.min(v.length - 1, Math.floor(t * v.length))];
    /* Wang LUT 정의역: G00·G11 = −0.25 + i/30, i ∈ [0, 29] ⟹ G_max = 0.7167
       C = 2G+I ⟹ λ_max = √(2·0.7167+1) = 1.5599.  그 밖은 clamp(=외삽 아님 · 상수 연장) */
    const LUT_LAM = Math.sqrt(2 * (-0.25 + 29 / 30) + 1);
    console.log(`\n╔══ §1 원소 주신장 λ (f=${fr} · 원소 ${lam.length}개 · 판정 아님) ══╗`);
    console.log(`   중앙 ${q(0.5).toFixed(4)} · p95 ${q(0.95).toFixed(4)} · p99 ${q(0.99).toFixed(4)} · 최대 ${v[v.length - 1].toFixed(4)}`);
    console.log(`   1.10 초과 원소 ${lam.filter((x) => x > 1.1).length} / ${lam.length}  ·  LUT 정의역 상한 ${LUT_LAM.toFixed(4)} 초과 ${lam.filter((x) => x > LUT_LAM).length} / ${lam.length}`);
    console.log(`   최대 위치 ${wi >= 0 ? [0, 1, 2].map((c2) => (s.pos[wi * 3 + c2] * 100).toFixed(1)).join(', ') : '—'} cm`);
    console.log(`   대조: v2 maxStrain 5.670(뒤판 목선 · 같은 «국소» 통계) · v3 목선 엣지 최대 1.2224`);
    process.exit(0);
  }

  /* ── v3-24 §2 비용 산정 검증 — 원단 물성만 바꿔 3프레임(판정 아님) ───────── */
  if (process.env.COST === '1') {
    const fr = loadCk();
    const st2 = substepsOf(sc);
    const pc: SolverParams = {
      dt: DT, substeps: st2.sub, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: sc.tris, thickness: THICK },
    };
    const K = Number(process.env.COSTF ?? 3);
    const t0 = performance.now();
    for (let k = 0; k < K; k++) step(s, sc.cons, pc);
    const ms = (performance.now() - t0) / K;
    console.log(`\n[비용] f=${fr}+${K} · k=${KMEM} N/m · ρ=${MAT.rho} · sub ${st2.sub}(멤 ${st2.memb}/굽 ${st2.bend}) ⟹ ${(ms / 1000).toFixed(2)} s/f`);
    process.exit(0);
  }

  if (process.env.NECK === '1') {
    const fr = loadCk();
    const ringIx = [...neckF, ...neckB];
    const dd = (a: number[]) => {
      const v = [...a].sort((x, y2) => x - y2);
      const q = (t: number) => v[Math.min(v.length - 1, Math.floor(t * v.length))];
      return { min: v[0], med: q(0.5), p95: q(0.95), max: v[v.length - 1] };
    };
    console.log(`\n╔══ §1 목선 신장의 자리 (f=${fr} · 판정 아님 · 처방 0) ══╗`);
    // ① 높이 분포
    const hy = ringIx.map((v) => s.pos[v * 3 + 1]);
    const h1 = dd(hy);
    console.log(`   ① 목선 정점 높이[cm]  중앙 ${(h1.med * 100).toFixed(2)} · 최소 ${(h1.min * 100).toFixed(2)} · 최대 ${(h1.max * 100).toFixed(2)} · 정점 ${ringIx.length}`);
    console.log(`      대조: 어깨선 Y_TOP ${(Y_TOP * 100).toFixed(2)}cm · 밑단 ${(Y_HEM * 100).toFixed(2)}cm`);
    // ④ 몸까지의 거리(정확)
    const dist4 = ringIx.map((v) => exactBodyDist(s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]));
    const d4 = dd(dist4);
    const touch = dist4.filter((x) => x <= SEP).length;
    console.log(`   ④ 몸까지 거리[mm]     중앙 ${(d4.med * 1000).toFixed(2)} · 최소 ${(d4.min * 1000).toFixed(2)} · p95 ${(d4.p95 * 1000).toFixed(2)} · 최대 ${(d4.max * 1000).toFixed(2)}`);
    console.log(`      2×두께(2mm) 이내 = «닿아 있다» 로 세면 ${touch} / ${ringIx.length} 정점`);
    // ② 몸에 정사영한 링 둘레 (앞·뒤를 «하나의 닫힌 고리»로 잇는다)
    const loop = [...neckF, ...[...neckB].reverse()];
    let proj = 0, cur3 = 0;
    const pr = loop.map((v) => nearestBodyPoint(s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]));
    for (let k = 0; k < loop.length; k++) {
      const a = pr[k], b = pr[(k + 1) % loop.length];
      proj += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const p1 = loop[k] * 3, p2 = loop[(k + 1) % loop.length] * 3;
      cur3 += Math.hypot(s.pos[p1] - s.pos[p2], s.pos[p1 + 1] - s.pos[p2 + 1], s.pos[p1 + 2] - s.pos[p2 + 2]);
    }
    console.log(`   ② 몸에 «정사영»한 목선 둘레 ${(proj * 100).toFixed(2)}cm  ↔  목선 정지 ${(ringRest * 100).toFixed(2)}cm  ⟹ 비 ${(proj / ringRest).toFixed(4)}`);
    console.log(`      (평면 절단이 아니라 «링을 몸 표면에 정사영»한 둘레다 — 링이 기울어 있으므로)`);
    console.log(`      참고: 링 3D 둘레(닫힌 고리) ${(cur3 * 100).toFixed(2)}cm · 판정에 쓰는 비 ${(ring(s.pos) / ringRest).toFixed(4)}`);
    // ③ 국소 변형률
    const loc: number[] = [];
    let wi = 0, wv = 1;
    for (const arr of [neckF, neckB])
      for (let k = 0; k + 1 < arr.length; k++) {
        const a = arr[k], b = arr[k + 1];
        const rest = Math.hypot(sc.uv[a * 2] - sc.uv[b * 2], sc.uv[a * 2 + 1] - sc.uv[b * 2 + 1]);
        const now = seg3(s.pos, a, b);
        const r2 = now / rest;
        loc.push(r2);
        if (r2 > wv) { wv = r2; wi = a; }
      }
    const l3 = dd(loc);
    console.log(`   ③ 국소 변형률(엣지별 현재/정지) 중앙 ${l3.med.toFixed(4)} · p95 ${l3.p95.toFixed(4)} · 최대 ${l3.max.toFixed(4)} · 엣지 ${loc.length}`);
    console.log(`      1.10 초과 엣지 ${loc.filter((x) => x > 1.1).length} / ${loc.length} · 최대 위치 ${[0, 1, 2].map((c) => (s.pos[wi * 3 + c] * 100).toFixed(1)).join(', ')} cm`);
    console.log(`      ⟹ 「균일하게 늘었나 한 곳이 늘었나」: 중앙 ${l3.med.toFixed(4)} vs 최대 ${l3.max.toFixed(4)}`);
    process.exit(0);
  }

  if (process.env.SETTLE === '1') {
    const N_WIN = Math.round(1 / (DAMP * DT));
    const TH_POS = 1e-4;
    const fr = loadCk();
    const noBody = process.env.NOBODY === '1';
    const hemIx2 = Array.from({ length: sc.nuB + 1 }, (_, i) => at(front, i, 0)).concat(
      Array.from({ length: sc.nuB + 1 }, (_, i) => at(back, i, 0)));
    const seamMed = (pp: Float64Array) => {
      const g: number[] = [];
      for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) g.push(seg3(pp, sm.a[k], sm.b[k]));
      g.sort((x, y2) => x - y2);
      return g[Math.floor(g.length / 2)];
    };
    const before = Float64Array.from(s.pos);
    const o0 = { ring: ring(s.pos) / ringRest, hem: meanY(hemIx2, s.pos), seam: seamMed(s.pos) };
    const pw: SolverParams = {
      dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
      ...(noBody ? {} : { collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU } }),
      selfCollision: { tris: sc.tris, thickness: THICK },
    };
    for (let k = 0; k < N_WIN; k++) step(s, sc.cons, pw);
    const net: number[] = [];
    for (let v = 0; v < sc.n; v++)
      net.push(Math.hypot(s.pos[v * 3] - before[v * 3], s.pos[v * 3 + 1] - before[v * 3 + 1], s.pos[v * 3 + 2] - before[v * 3 + 2]));
    const srt = [...net].sort((x, y2) => x - y2);
    const q = (t: number) => srt[Math.min(srt.length - 1, Math.floor(t * srt.length))];
    const o1 = { ring: ring(s.pos) / ringRest, hem: meanY(hemIx2, s.pos), seam: seamMed(s.pos) };
    const vv = vList().sort((x, y2) => x - y2);
    const main = srt[srt.length - 1] <= TH_POS;
    const dRing = Math.abs(o1.ring - o0.ring), dHem = Math.abs(o1.hem - o0.hem), dSeam = Math.abs(o1.seam - o0.seam);
    const subOk = dRing <= 1e-4 && dHem <= TH_POS && dSeam <= TH_POS;
    console.log(`\n╔══ §1 정착 채널 (f=${fr} · 창 N=${N_WIN}프레임${noBody ? ' · 대조군 NOBODY' : ''}) ══╗`);
    console.log(`   주  순변위[mm] 중앙 ${(q(0.5) * 1000).toFixed(5)} · p95 ${(q(0.95) * 1000).toFixed(5)} · 최대 ${(srt[srt.length - 1] * 1000).toFixed(5)} ≤ ${TH_POS * 1000} ⟹ ${main ? 'PASS' : 'FAIL'}`);
    console.log(`   부  목선 Δ ${dRing.toExponential(3)} ≤ 1e-4 ${dRing <= 1e-4 ? '✓' : '✗'} · 밑단 Δ ${(dHem * 1000).toFixed(5)}mm ${dHem <= TH_POS ? '✓' : '✗'} · 시접 Δ ${(dSeam * 1000).toFixed(5)}mm ${dSeam <= TH_POS ? '✓' : '✗'} ⟹ ${subOk ? 'PASS' : 'FAIL'}`);
    console.log(`   참고 |v|[mm/s] 중앙 ${(vv[Math.floor(sc.n / 2)] * 1000).toFixed(3)} · p95 ${(vv[Math.floor(sc.n * 0.95)] * 1000).toFixed(3)} · 최대 ${(vv[sc.n - 1] * 1000).toFixed(2)} · 6.0 초과 ${vv.filter((x) => x > V_SETTLE).length}/${sc.n}`);
    console.log(`   ⟹ 정착 «${main && subOk ? 'PASS' : 'FAIL'}»  (주 AND 부)`);
    process.exit(0);
  }

  if (process.env.FINAL === '1') {
    const fr = loadCk();
    console.log(`\n╔══ §2 참고 산출 (f=${fr} 상태 · 갈래 F ⟹ «판정 아님») ══╗`);
    const y0 = meanY(shoulderIx, pos0), y1 = meanY(shoulderIx, s.pos);
    const hemIx = Array.from({ length: sc.nuB + 1 }, (_, i) => at(front, i, 0)).concat(
      Array.from({ length: sc.nuB + 1 }, (_, i) => at(back, i, 0)));
    const r1 = ring(s.pos) / ringRest;
    const bc1 = bodyClearance(s);
    const mp1 = minPairDist(s.pos, sc.tris, SEP * 3);
    const ed = edgeDihedrals(prim0.pos, bodyIdx);
    let pexAtWorst = 0, pexMax = 0, thWorst = 0;
    for (let v = 0; v < sc.n; v++) {
      const x = s.pos[v * 3], y = s.pos[v * 3 + 1], z = s.pos[v * 3 + 2];
      if (sampleSdf(bodyG, x, y, z) > SEP) continue;
      const pe = predExt(bodyG, ed, x, y, z);
      if (pe > pexMax) pexMax = pe;
      if (v === bc1.worstPen) { pexAtWorst = pe; thWorst = thetaAt(ed, x, y, z, bodyG.h); }
    }
    const ratio = pexAtWorst > 0 ? bc1.maxPen / pexAtWorst : NaN;
    const gaps: number[] = [];
    for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) gaps.push(seg3(s.pos, sm.a[k], sm.b[k]));
    gaps.sort((x, y2) => x - y2);
    const qg = (t: number) => gaps[Math.min(gaps.length - 1, Math.floor(t * gaps.length))];
    let shContact = 0;
    const yArmWorld = Y_TOP - ARM_D;
    for (let v = 0; v < sc.n; v++)
      if (s.pos[v * 3 + 1] >= yArmWorld && sampleSdf(bodyG, s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]) <= SEP) shContact++;
    console.log(`   ② 몸 관통  최대 ${(bc1.maxPen * 1000).toFixed(4)}mm / P_ext(그 점) ${(pexAtWorst * 1000).toFixed(4)}mm = ${ratio.toFixed(3)} (등록 구간 [0.5,1.25]) · θ ${((thWorst * 180) / Math.PI).toFixed(2)}° · 관통 정점 ${bc1.penCnt} · P_ext 최대 ${(pexMax * 1000).toFixed(4)}mm`);
    console.log(`   ③ 자기관통 삼각형–삼각형 교차 ${mp1.hits} · 비인접 최소 거리 ${(mp1.min * 1000).toFixed(3)}mm · 문턱 위반 쌍 ${mp1.viol}`);
    console.log(`      접촉 밀도: 근접 쌍 ${mp1.near} · 정점당 ${(mp1.near / sc.n).toFixed(4)}  (v3-20 §4 규모 대조용)`);
    console.log(`   ④ 시접 간극 중앙 ${(qg(0.5) * 1000).toFixed(2)} · p95 ${(qg(0.95) * 1000).toFixed(2)} · 최대 ${(gaps[gaps.length - 1] * 1000).toFixed(2)}mm (정지 ${SEP * 1000}mm · 쌍 ${gaps.length})`);
    console.log(`   ⑤ 보조 0   invMass=0 정점 ${pinned} · 앵커 0 · 핀 0 · 원주 상한 0 · 흡착 항 0`);
    console.log(`   부수      어깨 ${(y0 * 100).toFixed(2)}→${(y1 * 100).toFixed(2)}cm · 밑단 ${(meanY(hemIx, pos0) * 100).toFixed(2)}→${(meanY(hemIx, s.pos) * 100).toFixed(2)}cm · 목선/정지 ${r1.toFixed(4)} · 어깨 대역 접촉 ${shContact}`);
    const OUT = process.env.CAPDIR ?? 'docs/captures/v3-19-첫착장';
    mkdirSync(OUT, { recursive: true });
    const clothPos = Float64Array.from(s.pos);
    const colors: [number, number, number][] = [[40, 90, 200], [200, 70, 60], [60, 160, 90], [60, 160, 90]];
    const meshes: Mesh[] = [{ pos: prim0.pos, idx: bodyIdx, color: [190, 185, 178] }];
    for (const [pi, pn] of sc.panels.entries()) meshes.push({ pos: clothPos, idx: Uint32Array.from(pn.tris), color: colors[pi] });
    const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < sc.n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.pos[v * 3 + k]); hi[k] = Math.max(hi[k], s.pos[v * 3 + k]); }
    for (let k = 0; k < 3; k++) { lo[k] -= 0.10; hi[k] += 0.10; }
    hi[1] = Math.max(hi[1], Y_TOP + 0.12);
    for (const view of VIEWS) writePng(`${OUT}/${view.name}.png`, 760, 1000, render(meshes, view, { lo, hi }, 760, 1000));
    console.log(`   ⑦ 캡처 3장 → ${OUT}/{front,sideXplus,back}.png (정사영 · 난수 0 · CC 판정 0)`);
    process.exit(0);
  }

  /* ── v3-20 진단 (#37) — «처방 0 · 구현 0». 전부 env gate 뒤 ───────────────
   * `DIAGDX=1`  §1 층별 «실제로 옮긴 거리» Δx 를 재고 Δx/h 를 |v| 와 짝지어 본다
   * `SUBSCAN=1` §2 서브스텝만 바꿔 |v| · Δx_self · 잔여 침투의 스케일링을 잰다
   * `SELFIT=1`  §3 한 서브스텝 «안»에서 자기충돌 해소를 반복하면 침투가 주는가 */
  const dist = (a: ArrayLike<number>, n: number) => {
    const v = Array.from({ length: n }, (_, i) => a[i]).sort((x, y2) => x - y2);
    const q = (t: number) => v[Math.min(n - 1, Math.floor(t * n))];
    return { med: q(0.5), p95: q(0.95), max: v[n - 1] };
  };
  const mm = (x: number) => (x * 1000).toFixed(3).padStart(10);
  const ms = (x: number) => (x * 1000).toFixed(1).padStart(10);

  if (process.env.DIAGDX === '1') {
    const fr = loadCk();
    const K = Number(process.env.DIAGF ?? 2);
    const p1: SolverParams = {
      dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: sc.tris, thickness: THICK },
    };
    stepDiag.on = true;
    for (let k = 0; k < K; k++) step(s, sc.cons, p1);
    stepDiag.on = false;
    const h = stepDiag.h;
    const dSelf = dist(stepDiag.dxSelf, sc.n), dCon = dist(stepDiag.dxCon, sc.n), dBody = dist(stepDiag.dxBody, sc.n);
    const vv = dist(vList(), sc.n);
    console.log(`\n╔══ §1 층별 «실제로 옮긴 거리» (f=${fr}+${K} · 마지막 서브스텝 · h=${(h * 1e6).toFixed(2)}µs) ══╗`);
    console.log(`   ${'층'.padEnd(14)}${'Δx 중앙[mm]'.padStart(12)}${'p95'.padStart(10)}${'최대'.padStart(10)}   ${'Δx/h 중앙[mm/s]'.padStart(16)}${'p95'.padStart(11)}${'최대'.padStart(11)}`);
    for (const [nm, d] of [['자기충돌', dSelf], ['제약 투영', dCon], ['몸 충돌', dBody]] as const)
      console.log(`   ${nm.padEnd(14)}${mm(d.med)}${mm(d.p95)}${mm(d.max)}   ${ms(d.med / h)}${ms(d.p95 / h)}${ms(d.max / h)}`);
    console.log(`   ${'|v| 실측'.padEnd(14)}${''.padStart(32)}   ${ms(vv.med)}${ms(vv.p95)}${ms(vv.max)}`);
    console.log(`   ⟹ Δx_self/h ÷ |v| = 중앙 ${(dSelf.med / h / vv.med).toFixed(3)} · p95 ${(dSelf.p95 / h / vv.p95).toFixed(3)} · 최대 ${(dSelf.max / h / vv.max).toFixed(3)}`);
    console.log(`   ⟹ Δx_con/h ÷ |v| = 중앙 ${(dCon.med / h / vv.med).toFixed(3)} · Δx_body/h ÷ |v| = 중앙 ${(dBody.med / h / vv.med).toFixed(3)}`);
    console.log(`   제약 «종류별» 보정 총량(마지막 서브스텝 · 정점 변위 합): 신장 ${(stepDiag.sumInplane * 1000).toFixed(1)}mm · 굽힘 ${(stepDiag.sumBend * 1000).toFixed(1)}mm · 봉제 ${(stepDiag.sumDist * 1000).toFixed(1)}mm`);
    console.log(`   대조: 서브스텝당 분리 목표 2×두께 = ${SEP * 1000}mm · 격자 간격 ${(D_CHOSEN * 1000).toFixed(1)}mm`);
    process.exit(0);
  }

  if (process.env.SUBSCAN === '1') {
    const K = Number(process.env.DIAGF ?? 2);
    console.log(`\n╔══ §2 서브스텝 스케일링 (체크포인트에서 ${K}프레임씩 · 예측: |v| ∝ 서브스텝 · Δx_self 둔감) ══╗`);
    console.log(`   ${'sub'.padStart(5)}${'h[µs]'.padStart(9)}${'|v|중앙'.padStart(11)}${'|v|최대'.padStart(11)}${'Δx_self중앙'.padStart(12)}${'Δx_self최대'.padStart(12)}${'교차'.padStart(9)}${'분리위반'.padStart(10)}${'s/f'.padStart(8)}`);
    for (const sub of [246, 123, 62, 31, 16]) {
      loadCk();
      const pp: SolverParams = {
        dt: DT, substeps: sub, gravity: G, damping: DAMP,
        collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
        selfCollision: { tris: sc.tris, thickness: THICK },
      };
      stepDiag.on = true;
      const t0 = performance.now();
      for (let k = 0; k < K; k++) step(s, sc.cons, pp);
      const sec = (performance.now() - t0) / K / 1000;
      stepDiag.on = false;
      const dS = dist(stepDiag.dxSelf, sc.n), vv = dist(vList(), sc.n);
      const mp = minPairDist(s.pos, sc.tris, SEP * 3);
      console.log(`   ${String(sub).padStart(5)}${(stepDiag.h * 1e6).toFixed(1).padStart(9)}${(vv.med * 1000).toFixed(0).padStart(11)}${(vv.max * 1000).toFixed(0).padStart(11)}${(dS.med * 1000).toFixed(4).padStart(12)}${(dS.max * 1000).toFixed(3).padStart(12)}${String(mp.hits).padStart(9)}${String(mp.viol).padStart(10)}${sec.toFixed(2).padStart(8)}`);
    }
    process.exit(0);
  }

  if (process.env.SELFIT === '1') {
    const K = Number(process.env.DIAGF ?? 2);
    console.log(`\n╔══ §3 한 서브스텝 «안»의 반복 (줄면 «반복 부족» · 안 줄면 «순환») ══╗`);
    console.log(`   ${'반복'.padStart(5)}${'|v|중앙'.padStart(11)}${'Δx_self중앙'.padStart(12)}${'Δx_self최대'.padStart(12)}${'교차'.padStart(9)}${'분리위반'.padStart(10)}${'최소거리[mm]'.padStart(13)}${'s/f'.padStart(8)}`);
    for (const it of [1, 2, 4, 8]) {
      loadCk();
      const pp: SolverParams = {
        dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
        collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
        selfCollision: { tris: sc.tris, thickness: THICK, iterations: it },
      };
      stepDiag.on = true;
      const t0 = performance.now();
      for (let k = 0; k < K; k++) step(s, sc.cons, pp);
      const sec = (performance.now() - t0) / K / 1000;
      stepDiag.on = false;
      const dS = dist(stepDiag.dxSelf, sc.n), vv = dist(vList(), sc.n);
      const mp = minPairDist(s.pos, sc.tris, SEP * 3);
      console.log(`   ${String(it).padStart(5)}${(vv.med * 1000).toFixed(0).padStart(11)}${(dS.med * 1000).toFixed(4).padStart(12)}${(dS.max * 1000).toFixed(3).padStart(12)}${String(mp.hits).padStart(9)}${String(mp.viol).padStart(10)}${(mp.min * 1000).toFixed(4).padStart(13)}${sec.toFixed(2).padStart(8)}`);
    }
    process.exit(0);
  }

  if (gate1 && gate2) {
    console.log(`\n╔══ §5 착장 실행 — 앵커 0 · 핀 0 · 흡착 0 · 원주 상한 0 ══╗`);
    console.log(`   d=${(D_CHOSEN * 1000).toFixed(1)}mm · 서브스텝 ${st.sub}(산정 그대로) · 상한 ${FRAMES}프레임 · 정착 |v|max ≤ ${(V_SETTLE * 1000).toFixed(1)}mm/s ×3연속`);
    const p: SolverParams = {
      dt: DT, substeps: st.sub, gravity: G, damping: DAMP,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: MU },
      selfCollision: { tris: sc.tris, thickness: THICK },
    };
    /* ── §3 점진 봉제 — 「고정점은 그대로, 경로만 바꾼다」 ────────────────────
     * rest를 «초기 짝거리»에서 시작해 N프레임에 걸쳐 2×두께로 줄인다.
     * N 도출(손 상수 0): 봉제가 «중력보다 빠르게» 당기지 않게 한다 —
     *   수축 속도 (d0−rest)/(N·dt) ≤ 중력이 한 프레임에 주는 속도 g·dt
     *   ⟹ N ≥ (d0_max − SEP)/(g·dt²).  g·dt² = 9.81/3600 = 2.7250 mm/프레임
     * 절대 조항: f ≥ N 에서 rest = 2×두께 «정확히». 평형(고정점)은 설계 그대로이고
     * 흡착과 다르다 — 몸 쪽으로 당기지 않고, 끝 상태의 평형을 바꾸지 않는다. */
    const rest0 = sc.seamCons.map((c) => seg3(pos0, c.i, c.j));
    const d0max = Math.max(...rest0);
    /* NORAMP=1 — §2(배치)와 §3(램프)의 «몫을 가르는» 대조군. 판정 아님 · 기본 off */
    const RAMP_N = process.env.NORAMP === '1' ? 0 : Math.ceil((d0max - SEP) / (G * DT * DT));
    console.log(`   §3 점진 봉제: N = ${RAMP_N}프레임 ⟸ (짝거리 최대 ${(d0max * 100).toFixed(2)}cm − ${SEP * 1000}mm) / (g·dt² = ${(G * DT * DT * 1000).toFixed(4)}mm/프레임)`);
    const setRest = (f: number) => {
      const t = RAMP_N <= 0 ? 1 : Math.min(1, f / RAMP_N);
      for (let k = 0; k < sc.seamCons.length; k++) sc.seamCons[k].rest = rest0[k] + (SEP - rest0[k]) * t;
    };
    const yArmWorld = Y_TOP - ARM_D;
    const contactCount = (lo: number) => {
      let c = 0;
      for (let v = 0; v < sc.n; v++)
        if (s.pos[v * 3 + 1] >= lo && sampleSdf(bodyG, s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2]) <= SEP) c++;
      return c;
    };
    const hemIx = Array.from({ length: sc.nuB + 1 }, (_, i) => at(front, i, 0)).concat(
      Array.from({ length: sc.nuB + 1 }, (_, i) => at(back, i, 0)));

    let f0 = loadCk();
    const t0 = performance.now();
    let diverged = false, settledAt = 0, softAt = 0, run3 = 0;
    let vmax = Infinity;
    console.log(`   ${'f'.padStart(5)}${'벽시계[s]'.padStart(10)}${'|v|max[mm/s]'.padStart(13)}${'어깨y[cm]'.padStart(11)}${'밑단y[cm]'.padStart(11)}${'목선/정지'.padStart(11)}${'시접틈[mm]'.padStart(12)}${'어깨접촉'.padStart(9)}`);
    let f = f0;
    for (; f < FRAMES; f++) {
      setRest(f + 1);
      step(s, sc.cons, p);
      vmax = 0;
      for (let v = 0; v < sc.n; v++) {
        const q = Math.hypot(s.vel[v * 3], s.vel[v * 3 + 1], s.vel[v * 3 + 2]);
        if (q > vmax) vmax = q;
      }
      if (!Number.isFinite(vmax)) { diverged = true; break; }
      if (vmax <= V_SETTLE) { run3++; if (run3 >= 3 && !settledAt) settledAt = f + 1; } else run3 = 0;
      if (vmax <= V_SETTLE / 10 && !softAt) softAt = f + 1;
      if ((f + 1) % CK_EVERY === 0 || settledAt || f + 1 === FRAMES) {
        saveCk(f + 1);
        const g = seamGap(s.pos);
        console.log(
          `   ${String(f + 1).padStart(5)}${((performance.now() - t0) / 1000).toFixed(1).padStart(10)}${(vmax * 1000).toFixed(2).padStart(13)}` +
            `${(meanY(shoulderIx, s.pos) * 100).toFixed(2).padStart(11)}${(meanY(hemIx, s.pos) * 100).toFixed(2).padStart(11)}` +
            `${(ring(s.pos) / ringRest).toFixed(4).padStart(11)}${(g.mean * 1000).toFixed(2).padStart(12)}${String(contactCount(yArmWorld)).padStart(9)}`,
        );
      }
      if (settledAt) break;
    }
    const wall = (performance.now() - t0) / 1000;
    const fEnd = f + (diverged ? 0 : 1);
    // 절대 조항 확인 — 끝에서 rest가 «전부» 2×두께인가
    const restBad = sc.seamCons.filter((c) => Math.abs(c.rest - SEP) > 1e-12).length;
    console.log(`   §3 절대 조항: 마지막 rest ≠ ${SEP * 1000}mm 인 이음선 ${restBad} / ${sc.seamCons.length} ⟹ ${restBad === 0 ? 'PASS' : 'FAIL — 갈래 E'}`);

    /* ── §6 시험 7종 ─────────────────────────────────────────────────────── */
    console.log(`\n╔══ §6 시험 7종 — 문턱은 실행 «전»에 고정된 값 ══╗`);
    const y0 = meanY(shoulderIx, pos0), y1 = meanY(shoulderIx, s.pos);
    const h0 = meanY(hemIx, pos0), h1 = meanY(hemIx, s.pos);
    const r1 = ring(s.pos) / ringRest;
    const shContact = contactCount(yArmWorld);
    const bc1 = bodyClearance(s);
    const mp1 = minPairDist(s.pos, sc.tris, SEP * 3);

    // ② — v3-16 §1 통계 그대로: 접촉점마다 P_ext, 최대 관통이 «난 그 점»의 값과 대조
    const ed = edgeDihedrals(prim0.pos, bodyIdx);
    let pexAtWorst = 0, pexMax = 0, thWorst = 0;
    const pexAll: number[] = [];
    for (let v = 0; v < sc.n; v++) {
      const x = s.pos[v * 3], y = s.pos[v * 3 + 1], z = s.pos[v * 3 + 2];
      if (sampleSdf(bodyG, x, y, z) > SEP) continue;
      const pe = predExt(bodyG, ed, x, y, z);
      pexAll.push(pe);
      if (pe > pexMax) pexMax = pe;
      if (v === bc1.worstPen) { pexAtWorst = pe; thWorst = thetaAt(ed, x, y, z, bodyG.h); }
    }
    pexAll.sort((a2, b2) => a2 - b2);
    const ratio = pexAtWorst > 0 ? bc1.maxPen / pexAtWorst : NaN;

    // ④ — 봉합 쌍 «간극» 분포
    const gaps: number[] = [];
    for (const sm of sc.seams) for (let k = 0; k < sm.a.length; k++) gaps.push(seg3(s.pos, sm.a[k], sm.b[k]));
    gaps.sort((a2, b2) => a2 - b2);
    const q = (arr: number[], t: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] : NaN);

    const T: [string, string, boolean][] = [
      ['① 걸린다', `어깨 ${(y0 * 100).toFixed(2)}→${(y1 * 100).toFixed(2)}cm 낙하 ${((y0 - y1) * 100).toFixed(2)}≤5 · 어깨접촉 ${shContact}>0 · 정착 ${settledAt ? `f=${settledAt}` : '«미도달»'} · 목선 ${r1.toFixed(4)}≤1.10`,
        y0 - y1 <= 0.05 && shContact > 0 && settledAt > 0 && r1 <= 1.1],
      ['② 몸 관통', `최대 ${(bc1.maxPen * 1000).toFixed(4)}mm / P_ext(그 점) ${(pexAtWorst * 1000).toFixed(4)}mm = ${ratio.toFixed(3)} ∈ [0.5,1.25] · θ ${((thWorst * 180) / Math.PI).toFixed(2)}° · 관통 정점 ${bc1.penCnt} · P_ext 최대 ${(pexMax * 1000).toFixed(4)}mm`,
        ratio >= 0.5 && ratio <= 1.25],
      ['③ 자기관통', `삼각형–삼각형 교차 ${mp1.hits} (비인접 쌍 · S3b 판정기 정의) · 비인접 최소거리 ${(mp1.min * 1000).toFixed(3)}mm`, mp1.hits === 0],
      ['④ 시접 간극', `중앙 ${(q(gaps, 0.5) * 1000).toFixed(2)} · p95 ${(q(gaps, 0.95) * 1000).toFixed(2)} · 최대 ${(gaps[gaps.length - 1] * 1000).toFixed(2)}mm (정지 ${SEP * 1000}mm · 쌍 ${gaps.length})`, true],
      ['⑤ 보조 장치 0', `invMass=0 정점 ${pinned} · 앵커 0 · 핀 0 · 원주 상한 0 · 흡착 항 0(단방향 해소만)`, pinned === 0],
      ['⑥ 비용', `${wall.toFixed(1)}초 / ${fEnd - f0}프레임 = ${((wall * 1000) / Math.max(1, fEnd - f0)).toFixed(0)} ms/f · 자기충돌 ${((selfStats[6] / Math.max(1, wall * 1000)) * 100).toFixed(0)}% · 몸 충돌 ${((collisionStats[3] / Math.max(1, wall * 1000)) * 100).toFixed(0)}%`, true],
      ['⑦ 화면', `front · sideXplus · back — CC 판정 0`, true],
    ];
    for (const [nm, detail, ok] of T) console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${nm.padEnd(12)} ${detail}`);
    console.log(`   부수: 밑단 ${(h0 * 100).toFixed(2)}→${(h1 * 100).toFixed(2)}cm · 발산 ${diverged ? '있음' : '0'} · |v|max 최종 ${(vmax * 1000).toFixed(2)}mm/s · 0.6mm/s 도달 ${softAt || '미도달'}`);

    /* ── §7 화면 ─────────────────────────────────────────────────────────── */
    const OUT = process.env.CAPDIR ?? 'docs/captures/v3-19-첫착장';
    mkdirSync(OUT, { recursive: true });
    const clothPos = Float64Array.from(s.pos);
    const colors: [number, number, number][] = [[40, 90, 200], [200, 70, 60], [60, 160, 90], [60, 160, 90]];
    const meshes: Mesh[] = [{ pos: prim0.pos, idx: bodyIdx, color: [190, 185, 178] }];
    for (const [pi, pn] of sc.panels.entries()) meshes.push({ pos: clothPos, idx: Uint32Array.from(pn.tris), color: colors[pi] });
    let lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < sc.n; v++)
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.pos[v * 3 + k]); hi[k] = Math.max(hi[k], s.pos[v * 3 + k]); }
    for (let k = 0; k < 3; k++) { lo[k] -= 0.10; hi[k] += 0.10; }
    hi[1] = Math.max(hi[1], Y_TOP + 0.12);
    for (const view of VIEWS) {
      const px = render(meshes, view, { lo, hi }, 760, 1000);
      writePng(`${OUT}/${view.name}.png`, 760, 1000, px);
    }
    console.log(`   캡처 3장 → ${OUT}/{front,sideXplus,back}.png  (정사영 · z버퍼 · 난수 0 · CC 판정 0)`);

    /* ── §8 갈래 ─────────────────────────────────────────────────────────── */
    console.log(`\n╔══ §8 갈래 ══╗`);
    const ok1 = T[0][2], ok2 = T[1][2], ok3 = T[2][2];
    const branches: string[] = [];
    if (diverged) branches.push('H(발산 — 실행이 죽었다)');
    if (!settledAt && !diverged) branches.push(`F(정착 미도달 — 상한 ${FRAMES}프레임 · ②③④⑦은 «참고 산출»이고 판정 아님)`);
    if (!ok1 && settledAt) branches.push('B(흘러내린다 — 흡착으로 돌아가지 않는다)');
    if (!ok2) branches.push('C(② 관통이 일치 구간 밖 — #29 재개)');
    if (!ok3) branches.push('D(③ 자기관통 — S3b가 이 규모에서 부족하다)');
    if (ok1 && ok2 && ok3 && settledAt) branches.push('A(①~⑥ 통과 · ⑦ 캡처 — 화면 판정을 전략 세션에 넘긴다)');
    if (!branches.length) branches.push('K(판정 불가 — 상태를 원문으로)');
    console.log(`   ⟹ ${branches.join(' · ')}`);
  } else {
    console.log(`\n   ⟹ ①② 중 실패가 있어 §5 착장을 «실행하지 않는다» — 갈래 H(초기 적법성 위반)`);
  }
}
