/* v3-34 — 장면 조립(제도 · 배치 · 봉제 · 파라미터 산정)의 «순수» 모듈.
 *
 * `scripts/v3S4.ts` 에서 **줄을 그대로 옮긴 것**이다. 로직 변경 0 · 연산 순서 변경 0 ·
 * 최적화 0 · 이름 개선 0(v3-34 §2 금지 조항). 바뀐 것은 «닫는 방식»뿐이다 —
 * 모듈 최상위 `const` 였던 것이 `createScene(cfg)` 의 지역 `const` 가 됐고,
 * `process.env` 로 읽던 값이 `cfg` 인자로 올라왔다.
 *
 * **순수성**(v3-34 §0 ㉡): `node:` 임포트 0 · 파일 접근 0 · `process.env` 직독 0.
 * 몸 메시(GLB)와 SDF는 «인자로» 받는다 — GLB 읽기는 `node:fs` 라서 하네스에 남는다.
 *
 * 판정 기준은 **비트 동일**이다(§0 ㉠). 이 파일이 v3S4 의 원문과 다르게 계산하면
 * 정점 위치 해시부터 갈린다.
 */
import type { GridSdf } from './bodySdf.ts';
import { sampleSdf } from './bodySdf.ts';
/* v3-90 §1-① — 실패 문언이 «최소쌍 패널·값»을 싣기 위해 쓴다(판정 채널은 그대로). */
import { minPairDist } from './instruments.ts';
import {
  makeSolver, makeInplane, makeBend, assignMassFromMesh,
  substepsForBending, substepsForCloth,
  type Constraint, type DistanceConstraint,
} from './solver.ts';

export type Pt = [number, number];
export type Curve = (t: number) => Pt;

/** 파생 치수 대조/고정용 — `undefined` 면 «몸에서 도출»한다(v3-31 §1-C). */
export type DimsOverride = { neckHalfWidthCm: number; necklineGirthCm: number; capHeightCm: number };

/* ── v4-28 §1-② **`fitSleeve` 계기**(전략 세션 v4-27 §4 「계기 인쇄만 · 로직 0줄」) ──────────
 * ★ **값을 만들지 않는다.** 아래 기록은 `probe` 의 `Math.min` 사슬 «뒤»에서 같은 읽기를 한 번 더 해
 *   담기만 한다 — 반환값·탐색 경로·`SLV_R` 은 켜든 끄든 **같은 수**다(§1-② 에서 값으로 확인한다).
 * 끄면(기본) `if (sleeveTrace.on)` 한 줄을 지나갈 뿐이다. */
export const sleeveTrace: {
  on: boolean; all: boolean;
  calls: { x0: number; R: number; min: number; minBody: number; minCol: number; minSelf: number;
           argBody: [number, number, number, number, number]; argCol: [number, number, number, number, number] }[];
  samples: { px: number; py: number; x: number; y: number; z: number; body: number; col: number }[];
  probe?: (x0: number, R: number) => number;
  dims?: { CAP_W: number; CAP_H: number; RMIN: number; SW: number; SLEN: number; W: number;
           Y_ARM: number; ARM_D: number; Y_TOP: number; Y_HEM: number; L: number; AXIS_Z: number; SEP: number };
} = { on: false, all: false, calls: [], samples: [] };

export type SceneConfig = {
  /** 몸 메시 — 하네스가 GLB에서 읽어 «배열»로 넘긴다 */
  body: { pos: Float32Array };
  bodyIdx: Uint32Array;
  bodyG: GridSdf;
  sdfSpec: { h: number; band: number; bytes: number };
  /** 옷 치수(UI 입력) [m] */
  L: number; W: number; SW: number; SLEN: number;
  /** 암홀 둘레 [m] — 몸에서 도출되지 않는 «옷 사양»(v3-31 §1-3) */
  ARM_G: number;
  /** 물성·수치 상수 — v3S4 원문과 «같은 값»을 하네스가 넘긴다 */
  G: number; DT: number; THICK: number; SEP: number; KMEM: number;
  MAT: { rho: number; B: number };
  TOL_SELF: number;
  /** 기본 해상도 [m] — `build`/`assemble` 은 인자로도 받는다 */
  D_FIXED: number;
  /** 대조 전용(기본 off) — 파생 4종을 v2 값으로 «고정»한다 */
  dimsOverride?: DimsOverride;
  /** v4-18 §1-③ — **팔 축**(좌·우 · 단위 벡터 · 월드). 조립 안에는 «뼈»가 없다(`body` 는 정점뿐)이므로
   * **뼈를 가진 하네스가 넘긴다**. 안 넘기면 기본값 = **±x**(T포즈 실측이 x 와 1.3° 이내 · v4-17 §1-②ㄴ).
   * ★ v3 동결 «예외 1번»(전략 세션 v4-17 §4 승인 · 조립 코드 한정 · 물리 0줄 · T포즈 비트 동일이 조건). */
  /* v4-26 §1-① — `origin` = **대역 산정 원점 C**(어깨 피벗 · 호출부가 몸에서 읽어 넘긴다).
   * 넘기지 «않으면» 아래 `axDot`·`axPoint` 는 **옛 식 그대로**다(분기 자체를 안 탄다). */
  armAxis?: { left: [number, number, number]; right: [number, number, number];
              origin?: { left: [number, number, number]; right: [number, number, number] };
              /* v4-29 §1-③ — `pivot` = **원통 «중심»의 자리 P**(어깨 피벗 원좌표 · 투영 «전»).
               * v4-26 은 대역 측정(C)과 원통 배치를 한 변수에 실었는데, 둘의 «수직 오프셋»이
               * A포즈에서 102.0632 mm 였다(v4-29 §1-①) ⟹ 전략 세션 v4-28 §4 가 **원점 분리**를 승인했다.
               * 넘기지 «않으면» `origin` 을 그대로 쓴다(= v4-26 거동 보존). */
              pivot?: { left: [number, number, number]; right: [number, number, number] } };
  /** 옆 틈 G 도출이 쓰는 «가벼운» 최소 거리 계기. 계기는 하네스에 남고(§1 분류)
   * 조립은 그것을 «인자로» 받는다 — 정의가 둘로 갈리지 않게 하는 유일한 방법이다. */
  minPairDistLite: (pos: Float64Array, tris: number[]) => number;
  /** ★ v5-12 — **조립 2세대 플래그**(기본 `undefined` = 현행). 켜지지 않으면 이 파일의 거동은
   * 한 줄도 다르지 않다(off 비트 불변이 회차 조건이다 · v5-12 §0-4ㄱ).
   * 설계 정본 = `docs/v5/설계-조립2세대.md`(v5-11) · 검수 결정 = `docs/v5/12-2세대구현.md` §0-1. */
  asm2?: boolean;
  /** ★ v5-15 — **S4 붕괴 처방 «하위 플래그»**(진단 전용 · 기본 `undefined` = v5-14 거동).
   * `'A'` = S4 걸음 상한(`THICK`) + 봉제선→아래 **행 순서** 훑기 · `'B'` = **표면 추종 S3**.
   * `asm2` 가 꺼져 있으면 이 값은 읽히지 않는다(정본 off 비트 불변). */
  asm2Fix?: 'A' | 'B' | 'AB' | 'ABI' | 'BLEND' | 'ARM' | 'RC' | 'ARMRC' | 'NOS4';
};

/** ★ v5-12 — **어깨 경사 낙차 `SH_DROP` [m]**(조립 2세대 템플릿 상수 · 이름·값·출처 공개).
 * 값 = **2½ in = 63.5 mm** — 의류 제도 관행의 «표준 어깨» 경사 깊이.
 *   출처 ① My Golden Thimble, "How to Draft a Bodice Sloper" —
 *     「On standard shoulders, the shoulder slope is **2 ½"**. On high shoulders, 2", and on dropped shoulders, 3"」
 *     https://www.mygoldenthimble.com/how-to-draft-a-bodice-sloper/
 *   출처 ② Pattern Academy, "How To Make A Basic Bodice Block" —
 *     「C to D is the Back shoulder slope depth … **Use 2'' for all sizes**」
 *     https://charnold.com/how-to-make-basic-bodice-block-tutorial/
 * ★ **몸에서 도출하지 않는다**(전략 세션 v5-11 검수 결정 ① — 「몸 도출 기각(옷의 몸 종속)」) ⟹
 *   이 상수는 몸을 **읽지 않는다**. 실측표에 이 항목이 생기면 그때 실측표가 이긴다(`specToPattern.ts` 문).
 * ★ 몸의 실제 목↔어깨 낙차는 `Y_NECK − Y_TOP` 이고 v5-10 실측으로 **48.5991 mm**(SW 44.5) ·
 *   **82.2598 mm**(SW 52) 다 ⟹ 이 상수와의 차(**14.9 / 18.8 mm**)는 **측정 대상**이다(v5-12 §0-2①). */
export const ASM2_SH_DROP = 0.0635;

export function createScene(cfg: SceneConfig) {
  const { bodyIdx, bodyG, sdfSpec, L, W, SW, SLEN, ARM_G, DT, SEP, KMEM, MAT, TOL_SELF, D_FIXED, minPairDistLite } = cfg;
  const prim0 = cfg.body;
  const ASM2 = cfg.asm2 === true;
  /* v5-15 신설 · ★ v5-16 — **(A) 를 기본값으로 올린다**(전략 세션 v5-15 §4 「(A) 걸음 상한 THICK 채택」) ·
   * `'B'`(표면 추종)는 **보류**로 코드에 남긴다(삭제 0 · 열 간격 항이 생기면 다시 시험한다). */
  /* ★ v5-18 — **`'BLEND'` 를 기본값으로 승격**(전략 세션 v5-17 §4 「BLEND 채택(값 = 설계 의도)」). */
  const FIX = ASM2 ? (cfg.asm2Fix ?? 'BLEND') : undefined;
  /* ★ v5-17 — 후보 조합 해석(§0-4 형식화 그대로 · 새 상수 0):
   *   (ㄱ) `'AB'`   = 표면 추종 S3 + 걸음 상한·행 순서 S4
   *   (ㄴ) `'ABI'`  = (ㄱ) + **열 간격 항**(같은 행 `i↔i+1` 거리를 2D 패턴 거리로 투영)
   *   (ㄷ) `'BLEND'`= 튜브(오늘 통과하는 배치) ↔ 드레이프의 **행 비율 보간** + `SEP` 사영 · S4 는 잔여만 */
  /* ★ v5-18 — 후보 2종(§0-6 형식화 그대로 · 새 상수 0):
   *   ㉮ `'ARM'`   = BLEND + **암홀 열의 블렌드 목표를 «팔 관 표면»(반지름 `SLV_R` · SEP 등위면)으로**
   *   ㉯ `'RC'`    = BLEND + **행·열 간격 «동시» 보존 항**((ㄴ) 정정판 — 옛 `'ABI'` 는 열만 잡았다)
   *     `'ARMRC'`  = ㉮ + ㉯
   * ★ `'AB'` 는 **폐기**다(v5-17 실측 교차 **73,131** = 기준선의 49배) — 삭제 0 · 이력으로만 남긴다.
   *   새 시험에서 `'AB'` 를 후보로 올리지 않는다. `'A'`·`'B'`·`'ABI'` 도 이력 그대로 둔다. */
  /* ★ v5-19 — `'NOS4'` = BLEND 의 S3 그대로 · **S4 밀어냄 루프를 돌지 않는다**(§0-5 형식화).
   * `'ARM'`·`'RC'`·`'ARMRC'` 는 **코드 유지 · 이 판 미사용**(v5-18 이력 · 삭제 0). */
  const BLENDFAM = FIX === 'BLEND' || FIX === 'ARM' || FIX === 'RC' || FIX === 'ARMRC' || FIX === 'NOS4';
  const S4NONE = FIX === 'NOS4';
  const S3SURF = FIX === 'B' || FIX === 'AB' || FIX === 'ABI' || BLENDFAM;
  const S4CAP = FIX === 'A' || FIX === 'AB' || FIX === 'ABI' || BLENDFAM;
  const S3INTERVAL = FIX === 'ABI';
  const S3BLEND = BLENDFAM;                         // v5-12 — 플래그(기본 false ⟹ 아래 분기 전부 죽는다)
  const S3ARM = FIX === 'ARM' || FIX === 'ARMRC';   // ㉮
  const S3RC = FIX === 'RC' || FIX === 'ARMRC';     // ㉯
  const SH_DROP = ASM2 ? ASM2_SH_DROP : 0;         // off 면 0 ⟹ 제도식이 «수평 직선» 그대로다
  const V2DIMS = cfg.dimsOverride !== undefined;
  const V2REF = cfg.dimsOverride ?? { neckHalfWidthCm: 0, necklineGirthCm: 0, capHeightCm: 0 };

  /* ══ §1-B 몸 링 계기 — 평면 «정확» 단면 + 볼록 껍질 지지함수 ═════════════
   * v2는 `bodyGeodesic`/`bodyMeasure`의 측지 링과 능선 폴리라인을 쓴다. v3는 그 자료
   * 구조를 «갖고 있지 않고 만들지도 않는다» — 가진 것(삼각형 메시 · SDF · 볼록 껍질
   * 지지함수)으로 «같은 기하 문제»를 푼다. v2 코드 임포트 0(R4-3). */
  const RTH = 720;
  const RS = new Float64Array(RTH), RC = new Float64Array(RTH);
  for (let k = 0; k < RTH; k++) { const t = (k / RTH) * 2 * Math.PI; RS[k] = Math.sin(t); RC[k] = Math.cos(t); }

  /** 평면 n·(x,y) = c 와 메시의 «정확한» 교선점. 면내 좌표 (z, n⊥·(x,y)) 로 낸다. */
  function planeSection(nx: number, ny: number, c: number): [number, number][] {
    const out: [number, number][] = [];
    const f = (i: number) => nx * prim0.pos[i * 3] + ny * prim0.pos[i * 3 + 1] - c;
    for (let t = 0; t < bodyIdx.length; t += 3) {
      const v = [bodyIdx[t], bodyIdx[t + 1], bodyIdx[t + 2]];
      for (let e = 0; e < 3; e++) {
        const p = v[e], q = v[(e + 1) % 3];
        const fp = f(p), fq = f(q);
        if ((fp > 0) === (fq > 0)) continue;
        const u = fp / (fp - fq);
        const X = prim0.pos[p * 3] + u * (prim0.pos[q * 3] - prim0.pos[p * 3]);
        const Y = prim0.pos[p * 3 + 1] + u * (prim0.pos[q * 3 + 1] - prim0.pos[p * 3 + 1]);
        const Z = prim0.pos[p * 3 + 2] + u * (prim0.pos[q * 3 + 2] - prim0.pos[p * 3 + 2]);
        out.push([Z, -nx * Y + ny * X]);
      }
    }
    return out;
  }
  /** 단면점의 볼록 껍질을 δ 부풀린 링. 볼록체를 δ 부풀리면 둘레가 «정확히» 2πδ 는다. */
  function ringOf(pts: [number, number][], delta: number) {
    if (pts.length < 3) return { girth: NaN, umax: NaN, vmax: NaN, n: pts.length };
    const h = new Float64Array(RTH).fill(-Infinity);
    for (const [u, v] of pts) for (let k = 0; k < RTH; k++) { const q = u * RS[k] + v * RC[k]; if (q > h[k]) h[k] = q; }
    const dth = (2 * Math.PI) / RTH;
    let s = 0, um = 0, vm = 0, px = 0, pz = 0;
    const pt = (k: number) => {
      const hh = h[k] + delta, hp = (h[(k + 1) % RTH] - h[(k - 1 + RTH) % RTH]) / (2 * dth);
      return [hh * RS[k] + hp * RC[k], hh * RC[k] - hp * RS[k]] as [number, number];
    };
    const first = pt(0); px = first[0]; pz = first[1];
    for (let k = 1; k <= RTH; k++) {
      const [a, b] = pt(k % RTH);
      s += Math.hypot(a - px, b - pz); px = a; pz = b;
      um = Math.max(um, Math.abs(a)); vm = Math.max(vm, Math.abs(b));
    }
    return { girth: s, umax: um, vmax: vm, n: pts.length };
  }
  /** 높이 y «그 자리»의 벽 비율 — 대역 없이 «면적 밀도»로 가중한다.
   * v3-31은 두께 2h(≈7.9mm) «대역의 면적»으로 쟀다. 대역이 곧 분해능 하한이라
   * 근찾기를 아무리 정밀하게 해도 그 아래로 못 내려간다(#59).
   *
   * **가중을 «교선 길이»로 하면 안 된다** — 수평에 가까운 면(지붕)은 수평면과 거의
   * 나란해서 교선이 거의 안 생기고, 그러면 지붕이 통째로 빠져 벽 비율이 위로 편향된다
   * (실측: 그렇게 재면 Y_NECK이 1.4904m로 11.5mm 내려가 어깨 한복판을 집는다).
   *
   * 옳은 가중은 «단위 높이당 면적»이다. 면 위에서 높이가 dy 오를 때 진행 거리는
   * dl = dy / |n_h| (n_h = 법선의 수평 성분 크기 · 수직 벽은 |n_h|=1, 수평 지붕은 0).
   * ⟹ dA = ds · dy / |n_h| ⟹ 가중치 = 교선길이 / |n_h| = seg·|n| / √(n_x²+n_z²).
   * 대역→0 극한에서 v3-31의 «대역 면적»과 같은 양이고, 대역은 사라진다.
   * 문턱은 그대로 |n_y| ≤ 1/√2(45°)다 — **기준은 손대지 않는다.** */
  function wallFracAt(y: number): number {
    let lw = 0, lt = 0;
    const P = prim0.pos;
    for (let t = 0; t < bodyIdx.length; t += 3) {
      const i0 = bodyIdx[t] * 3, i1 = bodyIdx[t + 1] * 3, i2 = bodyIdx[t + 2] * 3;
      const d0 = P[i0 + 1] - y, d1 = P[i1 + 1] - y, d2 = P[i2 + 1] - y;
      if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
      // 평면을 가르는 두 엣지에서 교점을 잡는다(삼각형 ∩ 평면 = 선분)
      const pts: number[][] = [];
      const edge = (ia: number, ib: number, da: number, db: number) => {
        if ((da > 0) === (db > 0)) return;
        const u = da / (da - db);
        pts.push([P[ia] + u * (P[ib] - P[ia]), P[ia + 2] + u * (P[ib + 2] - P[ia + 2])]);
      };
      edge(i0, i1, d0, d1); edge(i1, i2, d1, d2); edge(i2, i0, d2, d0);
      if (pts.length < 2) continue;
      const seg = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (!(seg > 0)) continue;
      const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
      const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (!len) continue;
      const nh = Math.hypot(nx, nz);
      if (!(nh > 0)) continue;                 // 완전 수평면 — 이 평면과 만나지 않는다
      const wgt = (seg * len) / nh;            // 단위 높이당 면적
      lt += wgt;
      if (Math.abs(ny) / len <= Math.SQRT1_2) lw += wgt;
    }
    return lt ? lw / lt : NaN;
  }

  /* ── 어깨끝 높이 — 몸 표면이 |x| = 어깨/2 에 «닿는» 가장 높은 y ─────────── */
  function shoulderTopY(): number {
    let best = -Infinity;
    for (let v = 0; v < prim0.pos.length / 3; v++) {
      const px = Math.abs(prim0.pos[v * 3]);
      if (px >= SW / 2 - sdfSpec.h && px <= SW / 2 + sdfSpec.h) best = Math.max(best, prim0.pos[v * 3 + 1]);
    }
    if (!Number.isFinite(best)) throw new Error('어깨끝 높이를 못 찾는다 — 갈래 D');
    return best;
  }
  const Y_TOP = shoulderTopY();

  /* ── §1-C 파생 치수 도출 — 「옷의 구멍 = 몸의 링을 두께(SEP)만큼 부풀린 것」 ──
   * 여유(ease)를 새로 «고르지 않는다». 부풀림은 v3가 이미 등재한 유일한 간극
   * 척도인 SEP = 2×두께(옷–옷 분리 거리 · 배치의 몸 간극)를 그대로 쓴다. */

  /** 목 밑동 높이 — 기준은 v3-31 그대로(벽 비율이 1/2 을 가르는 높이). **바뀐 것은
   * 근을 찾는 정밀도뿐이다**: 복셀 간격 표본 + 선형 보간 → «구간 포착 후 이분법».
   * 수렴 문턱 = `TOL_SELF` 0.1mm — v3-12가 등재한 「한 서브스텝 재수렴 폭」이고,
   * v3가 «두 기하를 같다고 보는» 길이다. 새 상수 0. */
  const neckDiag = { iters: 0, bracket: 0, dPdy: 0, precMm: 0 };
  function neckBaseY(): number {
    const h = sdfSpec.h;
    let yTopBody = -Infinity;
    for (let v = 0; v < prim0.pos.length / 3; v++) yTopBody = Math.max(yTopBody, prim0.pos[v * 3 + 1]);
    const g = (y: number) => ringOf(planeSection(0, 1, y), 0).girth;
    // 어깨끝에서 «위로» 올라가며 «첫» 국소 최소 — 목이다. (머리 꼭대기가 전역 최소라
    // 전역 탐색은 정수리를 집는다. 목은 어깨와 턱 사이의 국소 최소다.)
    let yMin = NaN;
    for (let y = Y_TOP + 2 * h; y <= yTopBody - 2 * h; y += h) {
      const c = g(y);
      if (Number.isFinite(c) && c < g(y - h) && c < g(y + h)) { yMin = y; break; }
    }
    if (!Number.isFinite(yMin)) throw new Error('목 단면 국소 최소 둘레를 못 찾는다 — 갈래 D');
    // ① 구간 포착 — 아래로 내려가며 1/2 을 «처음» 가르는 한 칸을 잡는다
    let hi = yMin, hiW = wallFracAt(yMin), lo = NaN;
    for (let y = yMin - h; y >= Y_TOP; y -= h) {
      const w = wallFracAt(y);
      if (!Number.isFinite(w)) continue;
      if (w < 0.5) { lo = y; break; }
      hi = y; hiW = w;
    }
    if (!Number.isFinite(lo)) throw new Error('목 밑동(벽/지붕 전이)을 못 찾는다 — 갈래 D');
    if (!(hiW >= 0.5)) throw new Error('목 밑동 구간 포착 실패 — 위쪽 끝이 이미 1/2 아래다 — 갈래 D');
    neckDiag.bracket = hi - lo;
    // ② 이분법 — 대역이 없으므로 «칸» 아래로 내려간다
    let it = 0;
    for (; it < 200 && hi - lo > TOL_SELF; it++) {
      const m = (lo + hi) / 2, w = wallFracAt(m);
      if (Number.isFinite(w) && w < 0.5) lo = m; else hi = m;
    }
    neckDiag.iters = it;
    const y0 = (lo + hi) / 2;
    // 둘레 정밀도 = |dP/dy| × 문턱. 근찾기가 얼마나 «값»으로 정밀한지 값으로 낸다.
    neckDiag.dPdy = (g(y0 + TOL_SELF) - g(y0 - TOL_SELF)) / (2 * TOL_SELF);
    neckDiag.precMm = Math.abs(neckDiag.dPdy) * TOL_SELF * 1000;
    return y0;
  }
  const Y_NECK = neckBaseY();
  /** ★ v5-12 — **옷 높이대의 «앵커»**. 실측표의 총장은 「옷을 눕혀 **뒷목 중심**에서 밑단까지」
   * (`src/v5/specToPattern.ts` 머리주석)인데 현행은 그 길이를 **어깨끝 높이 `Y_TOP`** 에 매달고 있다
   * (전략 세션 v5-11 검수 = **버그**). 2세대는 `Y_NECK`(목 밑동)에 매단다.
   * ★ off 면 `Y_TOP` 그대로다 ⟹ 아래 «옷 높이대» 자리 전부가 바이트 불변이다.
   * ★ 「몸 어깨끝」을 뜻하는 자리(`shoulderTopY` 정의 · `neckBaseY` 탐색 구간)는 **`Y_TOP` 을 그대로** 쓴다. */
  const Y_ANCHOR = ASM2 ? Y_NECK : Y_TOP;
  const NECK_RING = ringOf(planeSection(0, 1, Y_NECK), SEP);
  /** 목선 반폭 [m] — 목 밑동 링의 x 반폭 */
  const NECK_A = V2DIMS ? V2REF.neckHalfWidthCm / 100 : NECK_RING.vmax;
  /** 목선 둘레(앞+뒤) [m] — 목 밑동 링의 둘레 */
  const NECK_G = V2DIMS ? V2REF.necklineGirthCm / 100 : NECK_RING.girth;

  /** 팔 단면 — |x| = x0 평면에서 «최고 성분»만(다리·받침 제외). 성분 분리 간격은
   * SDF 대역폭(몸 표현의 두께 척도). */
  function armRingAt(x0: number) {
    const pts = planeSection(1, 0, x0).map(([z, t]) => [z, -t] as [number, number]);   // (z, y)
    if (pts.length < 3) return { girth: NaN, umax: NaN, vmax: NaN, n: pts.length };
    const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
    let lo = ys[ys.length - 1];
    for (let i = ys.length - 2; i >= 0; i--) { if (lo - ys[i] > sdfSpec.band) break; lo = ys[i]; }
    return ringOf(pts.filter((p) => p[1] >= lo - 1e-12), SEP);
  }
  /** 소매 통둘레 [m] — 소매가 덮는 x 대역에서 팔 단면의 «최대». 소매는 가장 굵은
   * 곳을 지나야 하므로 최대다(평균·중앙이 아니다). */
  const CAP_TUBE = (() => {
    let m = 0, at = NaN;
    for (let x = SW / 2; x <= SW / 2 + SLEN + 1e-12; x += sdfSpec.h) {
      const g = armRingAt(x).girth;
      if (Number.isFinite(g) && g > m) { m = g; at = x; }
    }
    if (!(m > 0)) throw new Error('소매 대역 팔 단면을 못 찾는다 — 갈래 D');
    return { girth: m, at };
  })();
  /** 소매산 반폭 [m] = 소매 통둘레의 절반 */
  const CAP_W = CAP_TUBE.girth / 2;   // 소매산 반폭 — CAP_H 도출의 입력

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
  /** 소매산 높이 [m] — 소매 통둘레(몸에서 잰 값)와 암홀 길이가 «둘 다» 맞는 높이.
   * 실수해의 조건은 암홀 반쪽 ≥ 소매산 반폭이다(곡선 길이 ≥ 밑변). 안 되면 정지한다. */
  if (!(ARM_G / 2 >= CAP_W)) {
    throw new Error(`소매산 실수해 없음 — 암홀 반쪽 ${(ARM_G / 2 * 100).toFixed(2)}cm < 소매산 반폭 ${(CAP_W * 100).toFixed(2)}cm — 갈래 D`);
  }
  const CAP_H = V2DIMS ? V2REF.capHeightCm / 100 : solveB(ARM_G / 2, (b) => arcLen(famCap(CAP_W, b)), 0, 2);
  /** 목선 반쪽: (a,0) → (0,b) 를 «양 끝 수평»으로. 어깨선과 C¹로 이어지므로
   * 위 경계에 «모서리가 없다» — 초판은 여기서 90° 모서리가 나서 Coons 칸이 9°까지
   * 기울었다(칸의 문제가 아니라 «제도»의 문제였다). */
  const famNeck = (a: number, b: number): Curve => (t) => [a * (1 - t), (b / 2) * (1 - Math.cos(Math.PI * t))];
  const NECK_B = solveB(NECK_G / 4, (b) => arcLen(famNeck(NECK_A, b)), 1e-4, 1);

  /* ★ v5-12 — **암홀 강체 이동**. `armR` 의 위 끝점이 «어깨점»이므로 어깨가 `SH_DROP` 내려가면
   * 암홀도 그만큼 내려가야 한다. 곡선 «모양»과 호길이가 보존되므로 `ARM_D = solveB(ARM_G/2, …)`
   * 의 제약(암홀 둘레)이 유지된다(v5-12 §0-4ㄴ). off 면 `SH_DROP = 0` ⟹ 옛 식과 같다. */
  const Y_ARM = L - SH_DROP - ARM_D;       // 옆선 상단(겨드랑이) 높이
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
    /* ★ v5-12 — 어깨 이음선이 경사지면 실제 길이는 `hypot(SH_LEN, SH_DROP)` 다 ⟹ 분할 수도 그것으로
     * 센다(설계서 ①-5 자리 8). off 면 `SH_DROP = 0` 이라 `hypot(SH_LEN, 0) = SH_LEN` — **같은 수**다. */
    const N_sh = Math.max(1, Math.round(Math.hypot(SH_LEN, SH_DROP) / d));
    const N_nk = Math.max(2, Math.round(LEN_NECK / d));
    const N_side = Math.max(1, Math.round(Y_ARM / d));
    const N_arm = Math.max(1, Math.round(LEN_ARM / d));
    const N_und = Math.max(1, Math.round(SLEEVE_UNDER / d));
    const nuB = 2 * N_sh + N_nk;
    const nvB = N_side + N_arm;
    const nuS = 2 * N_arm;

    /* ★ v5-12 — **어깨 경사**: 어깨끝이 목점보다 `SH_DROP` 낮다(off 면 0 ⟹ 수평 직선 그대로). */
    const shL = line([-SW / 2, L - SH_DROP], [-NECK_A, L], N_sh);
    const shR = line([NECK_A, L], [SW / 2, L - SH_DROP], N_sh);
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
  const Y_HEM = Y_ANCHOR - L;   // v5-12 — 앵커(off = Y_TOP)

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
      if (y < Y_HEM || y > Y_ANCHOR) continue;
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
  const yOf = (k: number) => Y_HEM + ((Y_ANCHOR - Y_HEM) * k) / (NY - 1);
  /** 슬랩 반폭 — 표본 간격의 절반. 손 상수 0. */
  const SLAB = (Y_ANCHOR - Y_HEM) / (2 * (NY - 1));
  const HSUP_Y: Float64Array[] = Array.from({ length: NY }, (_, k) => supportAt(yOf(k), SLAB));
  const perimOf = (pts: [number, number][]) =>
    pts.reduce((t, q, i) => t + Math.hypot(q[0] - pts[(i + 1) % pts.length][0], q[1] - pts[(i + 1) % pts.length][1]), 0);

  /** 높이별 배율 — 「몸을 δ만큼 비운다」와 「그 높이의 패널이 요구하는 둘레」 중 큰 쪽. */
  /** 옆선 «틈» G — 앞뒤판이 «닿아 버리면» 자기충돌 분리(2×두께)를 f=0부터 어긴다.
   * 초기값은 분리 거리 그대로 두고, 초기 적법성이 실패하면 §2에서 «값으로» 키운다. */
  let GAP_SIDE = SEP;
  function scalesFor(delta: number): number[] {
    return HSUP_Y.map((h, k) => {
      const py = yOf(k) - (Y_ANCHOR - L);       // 그 높이에 대응하는 2D 높이
      const need = 4 * panelHalfWidth(Math.max(0, Math.min(L, py))) + 2 * GAP_SIDE;
      const base = perimOf(boundaryOf(h, delta, 1));
      /* v3-90 §1-① — **인쇄 «전용» 계기**(동작 0). 클램프 `Math.max(1, …)` 발화 = `need < base`.
       * ★ v3-91 §1-③ — **δ 증분의 호 길이 반응**도 «인쇄 전용»으로 함께 낸다.
       *   `boundaryOf` 는 `hh = (h[k] + delta) * scale` 이므로 δ 는 «반경 오프셋»이다 ⟹
       *   δ 를 키우면 폴리라인이 커진다. **얼마나** 커지는지를 값으로 남긴다(반환값 불변 · 동작 0). */
      const bump = (dd: number) => perimOf(boundaryOf(h, delta + dd, 1));
      (globalThis as unknown as { __v3clampProbe?: (r: Record<string, number>) => void })
        .__v3clampProbe?.({ k, need, base, ratio: need / base, GAP_SIDE, delta,
          base_d1: bump(0.001), base_d2: bump(0.002), base_d5: bump(0.005) });
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
    const y = Y_ANCHOR - (L - py);
    const t = ((y - Y_HEM) / (Y_ANCHOR - Y_HEM)) * (NY - 1);
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
    return [p0[0] + (p1[0] - p0[0]) * f, Y_ANCHOR - (L - py), AXIS_Z + p0[1] + (p1[1] - p0[1]) * f];
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
    const t = Math.max(0, Math.min(NY - 1, ((y - Y_HEM) / (Y_ANCHOR - Y_HEM)) * (NY - 1)));
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
      const px = axDot(prim0.pos[v * 3], prim0.pos[v * 3 + 1], prim0.pos[v * 3 + 2]);
      if (px < x0 || px >= x1) continue;
      y0 = Math.min(y0, prim0.pos[v * 3 + 1]); y1 = Math.max(y1, prim0.pos[v * 3 + 1]);
      z0 = Math.min(z0, prim0.pos[v * 3 + 2]); z1 = Math.max(z1, prim0.pos[v * 3 + 2]);
    }
    return { yc: (y0 + y1) / 2, zc: (z0 + z1) / 2 };
  }
  /* ── v4-18 §1-③ 팔 축 «하나» — 아래 다섯 자리가 전부 이 벡터를 참조한다 ─────────
   * 기본값 = **+x**(오른팔 기준 · 왼팔은 `sgn` 으로 거울). 하네스가 `cfg.armAxis` 를 넘기면 그것을 쓴다.
   * ★ **T포즈(+x)에서는 아래 식이 옛 식으로 «정확히» 줄어든다** — `0 + t·1 + R(c·0 + s·0) = t` ·
   *   `yc + t·0 + R(c·1 + s·0) = yc + R·c` · `zc + t·0 + R(c·0 + s·1) = zc + R·s`.
   *   더해지는 것이 전부 «정확한 0» 이라 **비트가 흔들리지 않는다**(§1-③ 회귀가 값으로 확인한다). */
  const AX: [number, number, number] = cfg.armAxis
    ? [Math.abs(cfg.armAxis.right[0]), cfg.armAxis.right[1], cfg.armAxis.right[2]]
    : [1, 0, 0];
  /** 축의 직교 보완 — **v3 가 이미 쓰는 유도 규칙의 «벡터 일반형»**(손 벡터 0 · v4-19 §1-①).
   * 인용 = `src/lib/bodyGeodesic.ts:281-289` 「평면 안의 정규직교 기저 — n과 «가장 덜 나란한» 축에서
   * 만든다」 · `seed = |n.x| < 0.9 ? [1,0,0] : [0,1,0]` · `u = norm(seed × n)` · `v = n × u`.
   * 이 파일은 같은 규칙을 축 `AX` 에 걸고, **원통의 cos/sin 자리에 맞게** 두 번 외적한다:
   *   `w = norm(seed × a)` → `AU = a × w` → `AV = a × AU`.
   * ★ `a = +x` 이면 seed = (0,1,0) · w = (0,0,−1) · **AU = (0,1,0) · AV = (0,0,1)** 이 «정확히» 나온다
   *   (길이 1 로 나누고, 곱해지는 것이 0 과 ±1 뿐이라 반올림이 없다) ⟹ 옛 식으로 그대로 줄어든다.
   *   v4-18 은 이 자리에 «손으로» 쓴 up 벡터를 두어 v3 규칙과 0.05° 어긋났다(귀책 = 전략 세션 스케치). */
  const [AU, AV]: [[number, number, number], [number, number, number]] = (() => {
    const n = Math.hypot(AX[0], AX[1], AX[2]) || 1;
    const a: [number, number, number] = [AX[0] / n, AX[1] / n, AX[2] / n];
    const cr = (p: [number, number, number], q: [number, number, number]): [number, number, number] =>
      [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const nz = (p: [number, number, number]): [number, number, number] => {
      const L = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] / L, p[1] / L, p[2] / L];
    };
    const seed: [number, number, number] = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const w = nz(cr(seed, a));                       // bodyGeodesic.ts:289 `u = norm(seed × n)`
    const u = cr(a, w);                              // 〃 `v = n × u` 의 자리 — 원통 cos 축
    return [u, cr(a, u)];                            // sin 축 = a × u
  })();
  /* ── v4-26 §1-① **대역 산정 «원점» 일반화**(v3 동결 예외 대장 3건째 · 전략 세션 v4-25 §4 승인) ──
   * 승인 문언 — 「armAxis 전달 시에만 `axDot(p) = AX·(p − C)` · C = 어깨 피벗(몸에서 · 손 상수 0) ·
   * `axPoint`(원통 중심)도 같은 원점 의미 · **미전달 경로는 분기 자체를 안 탄다**」.
   * ★ 왜 필요한가(v4-25 §1-② 실측) — 옛 `axDot` 은 **세계 원점**에서 잰 투영인데 대역 경계
   *   `[SW/2+CAP_H, SW/2+SLEN]` 은 **몸 중심선에서 잰 길이**다. 축이 기울면 두 뜻이 갈라져
   *   대역이 «비고»(A포즈 실측 축에서 정점 0 · +x 에서 493) `ARM.yc/zc` 가 NaN 이 됐다.
   * ★ 좌우 거울 — 원통은 **x 만** 뒤집는다. 옛 식의 `tt = sgn·t` 는 축이 +x 일 때만 거울과 같고,
   *   기울면 왼팔의 y 가 «위»로 간다 ⟹ 전달 분기에서는 `sgn` 을 **x 성분에만** 건다(v4-26 §0-4ㄹ 등재). */
  const AO: [number, number, number] | null = cfg.armAxis?.origin
    ? [cfg.armAxis.origin.right[0], cfg.armAxis.origin.right[1], cfg.armAxis.origin.right[2]]
    : null;
  /* v4-29 §1-③ — **원점 «분리»**(예외 대장 3건째 «정정» · 전략 세션 v4-28 §4 승인 문언):
   *   `axDot`(대역 «길이») = **C** 기준 «유지» · `axPoint`(원통 «중심») = **P**(어깨 피벗) 기준.
   * `pivot` 이 없으면 `AO` 로 떨어진다 ⟹ **v4-26 거동 그대로**. 미전달 분기는 애초에 이 변수를 안 본다. */
  const AP: [number, number, number] | null = cfg.armAxis?.pivot
    ? [Math.abs(cfg.armAxis.pivot.right[0]), cfg.armAxis.pivot.right[1], cfg.armAxis.pivot.right[2]]
    : AO;
  /** 정점 하나를 **축 위 좌표**로 — `armProfile` 의 대역 가름이 이 값으로 선다. */
  const axDot = AO
    ? (px: number, py: number, pz: number) =>
        AX[0] * (px - AO[0]) + AX[1] * (py - AO[1]) + AX[2] * (pz - AO[2])
    : (px: number, py: number, pz: number) => AX[0] * px + AX[1] * py + AX[2] * pz;
  /** 축 둘레 원통 위의 점 — 중심 `(0, ARM.yc, ARM.zc)` · 축 방향 `sgn·t` · 반지름 R · 위상 ph.
   * 전달 분기에서는 중심이 **C**(어깨 피벗)이고 `sgn` 은 **x 성분에만** 붙는다. */
  const axPoint = AP
    ? (t: number, R: number, ph: number, sgn: number): [number, number, number] => {
        const c0 = Math.cos(ph), s0 = Math.sin(ph);
        return [
          sgn * (AP[0] + t * AX[0] + R * (c0 * AU[0] + s0 * AV[0])),
          AP[1] + t * AX[1] + R * (c0 * AU[1] + s0 * AV[1]),
          AP[2] + t * AX[2] + R * (c0 * AU[2] + s0 * AV[2]),
        ];
      }
    : (t: number, R: number, ph: number, sgn: number): [number, number, number] => {
        const c0 = Math.cos(ph), s0 = Math.sin(ph), tt = sgn * t;
        return [
          0 + tt * AX[0] + R * (c0 * AU[0] + s0 * AV[0]),
          ARM.yc + tt * AX[1] + R * (c0 * AU[1] + s0 * AV[1]),
          ARM.zc + tt * AX[2] + R * (c0 * AU[2] + s0 * AV[2]),
        ];
      };

  /** 팔 축 — «소매 아랫절반이 놓이는» 축 대역에서 잰다. 두 값 다 패턴에서 온다.
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
        const [x, y, z] = axPoint(x0 + (CAP_H - py), R, ph, 1);
        min = Math.min(min, sampleSdf(bodyG, x, y, z));
        // 몸판(수직 기둥)과도 SEP 이상 떨어져야 한다 — 옷–옷 분리 거리다
        if (y >= Y_HEM && y <= Y_ANCHOR) min = Math.min(min, distToSurface(x, y, z - AXIS_Z));
      }
      /* ★ v3-90 §1-① — **소매 «자기» 최소쌍도 본다**(항 «하나» · 시드·브래킷 불변).
       * 옛 probe 는 몸과 몸판만 봐서, 감김이 한 바퀴를 채워 두 끝이 겹쳐도 통과시켰다(v3-87 §1-③′).
       * 감김의 두 끝은 px 의 양 극단이고 **x 가 같으므로** 거리는 (y, z) 차다 —
       * 원통 이음매에서 `minPairDist` 가 재는 것과 **같은 양**이고 삼각화 해상도에 안 흔들린다.
       * 문턱은 이 함수의 반환값이 `SEP` 와 비교되는 것을 **그대로** 쓴다 — **새 상수 0 · 새 문턱 0**.
       * ★ `RMIN`(:624)·브래킷(:636-643)·손 상수는 **한 글자도 안 건드린다**(함정 37 · v3-89 증명). */
      let pxMin = Infinity, pxMax = -Infinity;
      for (const [px] of PROBE.sleeve) { if (px < pxMin) pxMin = px; if (px > pxMax) pxMax = px; }
      const phA = pxMin / R, phB = pxMax / R;
      min = Math.min(min, Math.hypot(R * (Math.cos(phB) - Math.cos(phA)), R * (Math.sin(phB) - Math.sin(phA))));
      /* ── v4-28 §1-② 계기(값 0줄) — 위에서 «이미 정해진» min 을 바꾸지 않고, 같은 읽기를 되풀이해 담는다 ── */
      if (sleeveTrace.on) {
        let mb = Infinity, mc = Infinity;
        let ab: [number, number, number, number, number] = [NaN, NaN, NaN, NaN, NaN];
        let ac: [number, number, number, number, number] = [NaN, NaN, NaN, NaN, NaN];
        for (const [px, py] of PROBE.sleeve) {
          const ph = px / R;
          const [x, y, z] = axPoint(x0 + (CAP_H - py), R, ph, 1);
          const dB = sampleSdf(bodyG, x, y, z);
          const dC = (y >= Y_HEM && y <= Y_ANCHOR) ? distToSurface(x, y, z - AXIS_Z) : Infinity;
          if (dB < mb) { mb = dB; ab = [x, y, z, px, py]; }
          if (dC < mc) { mc = dC; ac = [x, y, z, px, py]; }
          if (sleeveTrace.all) sleeveTrace.samples.push({ px, py, x, y, z, body: dB, col: dC });
        }
        const ms = Math.hypot(R * (Math.cos(phB) - Math.cos(phA)), R * (Math.sin(phB) - Math.sin(phA)));
        sleeveTrace.calls.push({ x0, R, min, minBody: mb, minCol: mc, minSelf: ms, argBody: ab, argCol: ac });
      }
      return min;
    };
    if (sleeveTrace.on) sleeveTrace.probe = probe;     // v4-28 §1-③ 계기 손잡이(로직 0줄)
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
  /* v4-28 §1-③ — 계기가 켜져 있으면 «같은 검사»를 밖에서도 부를 수 있게 손잡이만 넘긴다(로직 0줄). */
  if (sleeveTrace.on) sleeveTrace.dims = { CAP_W, CAP_H, RMIN: CAP_W / Math.PI, SW, SLEN, W,
    Y_ARM, ARM_D, Y_TOP, Y_HEM, L, AXIS_Z, SEP };
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
      const q3 = axPoint(SLV_X0 + (CAP_H - py), SLV_R, ph, sgn);
      out[o] = q3[0]; out[o + 1] = q3[1]; out[o + 2] = q3[2];
    }
  }

  /* ── 봉제 — 「이음선 = 정지 길이 2×두께인 거리 제약」. 새 상수 0 ───────────
   * rest를 0으로 두면 자기충돌(분리 2×두께)과 «서로 싸운다». 두 겹의 원단이
   * 이음선에서 갖는 실제 간격이 정확히 두 두께이므로 rest = 2×두께가 옳고,
   * 강성은 멤브레인과 «같은 값»을 쓴다(이음선을 원단보다 뻣뻣하게 만들지 않는다 ·
   * 서브스텝 산정이 바뀌지 않는다). */
  type Seam = { name: string; a: number[]; b: number[] };

  /* ── ★ v5-12 — **조립 2세대 배치(S1~S4)**(`asm2` 가 참일 때만 돈다 · `place()` 수정 0줄) ──
   * 설계 정본 `docs/v5/설계-조립2세대.md` ②-2 · 검수 결정 = `docs/v5/12-2세대구현.md` §0-2②.
   *   S1 목선 토막 → **목 밑동 링**(`Y_NECK` 의 링 · 앞뒤 각자 자기 반쪽)
   *   S2 어깨 토막 → 그 높이 링의 **`|x|` 최대 점**(= 앞뒤 패널이 만나는 자리) ⟹ 앞뒤에 **같은 점**을
   *      주므로 어깨 봉제쌍 거리가 **0** 이다(「이미 닫힌 상태」)
   *   S3 드레이프 → 각 열을 상단점에서 **2D 패턴 열 엣지 길이만큼 아래로** 누적해 내린다
   *      (면내 변형 0 인 «자유 낙하» 형태 ⟹ 하위 행 신장률이 설계상 1.0 이다)
   *   S4 밀어냄 → 몸 SDF 안(또는 `SEP` 미만)인 정점을 **기울기 방향**으로 민다
   *      · 수렴 = 최대 이동 < `TOL_SELF`(v3 가 「두 기하를 같다고 보는 길이」) ·
   *      · 반복 상한 = **8**(이 파일 δ 보정 루프의 상한과 같은 수를 쓴다 · 새 상수 0) ·
   *      · 상한에 닿으면 인쇄만 하고 그 사실을 값으로 남긴다(판정은 회차가 한다)
   *   S5 소매 → **손대지 않는다**(전략 세션 v5-11 검수 승인 · v5-9 「소매 관 무죄」)
   * ★ 인쇄 전용 훅 `__asm2Probe` — 있으면 값을 넘긴다(없으면 아무 일도 없다 · 동작 0). */
  function redrapeAsm2(B: ReturnType<typeof build>, pos: Float64Array): void {
    const { front, back, N_sh, N_nk, N_side, nuB, nvB } = B;
    /* ★ v5-17 (ㄷ) — **튜브 위치 스냅숏**. `place()` 가 놓은 그 배치가 «오늘 자기검사를 통과하는»
     * 결 보존 배치다(판정문 「메시 결 보존 + 몸 밖」) ⟹ 블렌드의 한쪽 재료로 쓴다. */
    const tube = S3BLEND ? Float64Array.from(pos) : null;
    const ringAt = (y: number) => boundaryOf(supportAt(y, SLAB), DELTA, 1);
    const nkPts = ringAt(Y_NECK);
    const nkF = arcOn(nkPts, false), nkB = arcOn(nkPts, true);
    /** 그 높이 링에서 `sgn` 쪽 `|x|` 최대 점 — 앞뒤 패널이 만나는 자리다. */
    const xExtreme = (y: number, sgn: number): [number, number] => {
      const pts = ringAt(y);
      let bx = -Infinity, bz = 0;
      for (const [x, z] of pts) if (sgn * x > bx) { bx = sgn * x; bz = z; }
      return [sgn * bx, bz];
    };
    /* ★ 정정 1(v5-12 §1-① 사고 1) — 능선을 **폴리라인으로 한 번** 만들고 «호길이»로 배치한다.
     * `supportAt(y, SLAB)` 의 슬랩 반폭이 어깨 표본 간격보다 «클» 수 있어 i 마다 링을 뽑으면
     * **인접 링이 같아져 정점이 겹친다**(실측: `front↔front 0.000mm` 로 자기검사가 던졌다).
     * 규칙(링 `|x|` 최대)은 그대로 두고 **구성만** 바꾼다 — 저장소의 「호길이 보존」과 같은 방식. */
    /* ★ v5-13 §1-② — **호길이 사상**. `needLen` 만큼 «갈 수 있을 때까지» 능선을 내린다 —
     * 패턴 어깨선이 `Y_NECK − SH_DROP` 까지의 능선보다 길면 **팔 윗면 능선으로 연속**된다
     * (전략 세션 v5-12 중간 판정문 「끝이 몸 어깨점 앞에서 멈추거나 팔 윗면으로 넘어간다」).
     * 상한은 «옷 높이대»(`Y_HEM`)와 표본 수 `NY` — 둘 다 이미 도출된 값이다(새 상수 0). */
    const ridgeOf = (sgn: number, needLen: number) => {
      const step = Math.max(sdfSpec.h, SLAB);
      const pts: [number, number, number][] = [];
      const acc: number[] = [0];
      for (let k = 0; k < NY; k++) {
        const y = Y_NECK - step * k;
        if (y < Y_HEM) break;
        const e = xExtreme(y, sgn);
        const q = [e[0], y, AXIS_Z + e[1]] as [number, number, number];
        if (k > 0) {
          const pv = pts[k - 1];
          acc.push(acc[k - 1] + Math.hypot(q[0] - pv[0], q[1] - pv[1], q[2] - pv[2]));
        }
        pts.push(q);
        /* 필요 길이를 넘기면 한 표본 더 두고 멈춘다(보간 여유) */
        if (acc[acc.length - 1] > needLen && y <= Y_NECK - SH_DROP) break;
      }
      const total = acc[acc.length - 1];
      /** ★ 호길이 «절대» 사상 — 인자는 목점으로부터의 호길이 `sArc`[m] 다(정규화 0). */
      const atS = (sArcIn: number): [number, number, number] => {
        const sArc = Math.max(0, Math.min(total, sArcIn));
        let k = 1; while (k < acc.length - 1 && acc[k] < sArc) k++;
        const u = (sArc - acc[k - 1]) / Math.max(1e-12, acc[k] - acc[k - 1]);
        return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u,
                pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u,
                pts[k - 1][2] + (pts[k][2] - pts[k - 1][2]) * u];
      };
      /* v5-13 §1-① — **현 길이**(두 끝점 직선). 폴리라인/현 비가 «부풂»의 자다(v5-10 z 튐 계열). */
      const a0 = pts[0], a1 = pts[pts.length - 1];
      const chord = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]);
      return { atS, total, pts, chord, need: needLen };
    };
    const PATLEN = Math.hypot(SH_LEN, SH_DROP);          // 패턴 어깨 이음선의 «자기» 길이
    const rgL = ridgeOf(-1, PATLEN), rgR = ridgeOf(1, PATLEN);
    /* ★ 정정 2(사고 2) — 「이미 닫힌」은 **거리 0 이 아니라 «거리 = rest = SEP»**(간극 0)이다.
     * 이 저장소의 봉제 rest 가 `SEP`(2×두께)이고 자기충돌이 그 분리를 요구한다(위 「봉제」 절 주석).
     * 앞판 `+z` · 뒤판 `−z` 로 `SEP/2` 씩 벌려 능선을 «사이에» 둔다(새 상수 0 — `SEP` 뿐). */
    const ZHALF = SEP / 2;
    const uvAt = (pan: Panel, i: number, j: number): [number, number] => {
      const k = (j * (pan.nu + 1) + i) * 2;
      return [pan.uv[k], pan.uv[k + 1]];
    };
    /* S1·S2 — 상단 행 */
    for (const isFront of [true, false]) {
      const pan = isFront ? front : back;
      for (let i = 0; i <= nuB; i++) {
        const v = at(pan, i, nvB);
        const [px] = uvAt(pan, i, nvB);
        let q: [number, number, number];
        if (i < N_sh || i >= N_sh + N_nk) {                 // 어깨 토막(S2)
          /* 목점(호길이 0)에서 패턴 위 거리만큼 능선을 «따라» 간다 — 끝점을 맞추지 않는다. */
          const sArc = (i < N_sh ? (N_sh - i) : (i - (N_sh + N_nk))) / N_sh * PATLEN;
          const r3 = (i < N_sh ? rgL : rgR).atS(sArc);
          q = [r3[0], r3[1], r3[2] + (isFront ? ZHALF : -ZHALF)];
        } else {                                            // 목선 토막(S1)
          const rz = (isFront ? nkF : nkB).at(isFront ? px : -px);
          q = [rz[0], Y_NECK, AXIS_Z + rz[1]];
        }
        pos[v * 3] = q[0]; pos[v * 3 + 1] = q[1]; pos[v * 3 + 2] = q[2];
      }
    }
    const hh = sdfSpec.h;
    /** 그 점의 몸 SDF 기울기 단위 벡터(S4 가 쓰는 그 중앙차분과 «같은 식»). */
    const nHat = (x: number, y: number, z: number): [number, number, number] | null => {
      const gx = sampleSdf(bodyG, x + hh, y, z) - sampleSdf(bodyG, x - hh, y, z);
      const gy = sampleSdf(bodyG, x, y + hh, z) - sampleSdf(bodyG, x, y - hh, z);
      const gz = sampleSdf(bodyG, x, y, z + hh) - sampleSdf(bodyG, x, y, z - hh);
      const gn = Math.hypot(gx, gy, gz);
      return gn > 1e-12 ? [gx / gn, gy / gn, gz / gn] : null;
    };
    /** ★ v5-15 (B) — **접평면 낙하 방향** `d = normalize(−ŷ − (−ŷ·n̂) n̂)` · 평행이면 전역 `−y`. */
    const fallDir = (n: [number, number, number] | null): [number, number, number] => {
      if (!n) return [0, -1, 0];
      const dot = -n[1];                               // (−ŷ)·n̂
      const v: [number, number, number] = [-dot * n[0], -1 - dot * n[1], -dot * n[2]];
      const vn = Math.hypot(v[0], v[1], v[2]);
      return vn > 1e-9 ? [v[0] / vn, v[1] / vn, v[2] / vn] : [0, -1, 0];
    };
    /** 그 점을 몸 밖 `SEP` 까지 민다(한 번 · (B) 의 관통 원천 차단용). */
    const pushOut = (q: [number, number, number]): [number, number, number] => {
      const dd = sampleSdf(bodyG, q[0], q[1], q[2]);
      if (!(dd < SEP)) return q;
      const n = nHat(q[0], q[1], q[2]);
      if (!n) return q;
      const st = SEP - dd;
      return [q[0] + n[0] * st, q[1] + n[1] * st, q[2] + n[2] * st];
    };
    /* ★ v5-18 ㉮ — **팔 관 표면 사영**(§0-6 형식화 그대로 · 새 상수 0).
     * 관 = `axPoint` 가 소매를 놓는 그 관이다 — 축 `AX` · 피벗 `AP`(없으면 중심 `(0, ARM.yc, ARM.zc)`) ·
     * 반지름 **`SLV_R`**(= `fitSleeve()` 가 몸에서 `SEP` 떨어지도록 고른 등위면 · 이 판은 «읽기만» 한다).
     * 축 좌표와 위상은 보존하고 **반경만** `SLV_R` 로 옮긴다. 축 위(반경 0)면 그대로 둔다. */
    const armProj = (q: [number, number, number]): [number, number, number] => {
      const sgn = q[0] >= 0 ? 1 : -1;                 // `axPoint` 의 AP 분기가 x 를 거울하는 그 방식
      const qx = AP ? sgn * q[0] : q[0];
      const O: [number, number, number] = AP ? AP : [0, ARM.yc, ARM.zc];
      const dx = qx - O[0], dy = q[1] - O[1], dz = q[2] - O[2];
      const t = dx * AX[0] + dy * AX[1] + dz * AX[2];
      const rx = dx - t * AX[0], ry = dy - t * AX[1], rz = dz - t * AX[2];
      const rho = Math.hypot(rx, ry, rz);
      if (!(rho > 1e-12)) return q;
      const k = SLV_R / rho;
      const px = O[0] + t * AX[0] + rx * k, py = O[1] + t * AX[1] + ry * k, pz = O[2] + t * AX[2] + rz * k;
      return [AP ? sgn * px : px, py, pz];
    };
    /** ★ v5-18 ㉮ — **열 가중** `u(i) = max(0, 1 − dEdge/N_sh)` · `dEdge = min(i, nuB − i)`.
     * `i = 0 · nuB`(암홀 봉제선)에서 1 · `dEdge ≥ N_sh`(목선 구간)에서 0 ⟹ `u ≡ 0` 이면 BLEND 와 «같은 계산». */
    const uArm = (i: number) => Math.max(0, 1 - Math.min(i, nuB - i) / N_sh);
    /* S3 — 드레이프(위에서 아래로 · 열마다) · `FIX === 'B'` 면 **표면 추종** */
    for (const isFront of [true, false]) {
      const pan = isFront ? front : back;
      for (let i = 0; i <= nuB; i++)
        for (let j = nvB - 1; j >= 0; j--) {
          const vt = at(pan, i, j + 1), vb = at(pan, i, j);
          const [ax, ay] = uvAt(pan, i, j + 1), [bx2, by2] = uvAt(pan, i, j);
          const len = Math.hypot(ax - bx2, ay - by2);
          if (S3SURF) {
            const px2 = pos[vt * 3], py2 = pos[vt * 3 + 1], pz2 = pos[vt * 3 + 2];
            const d = fallDir(nHat(px2, py2, pz2));
            const q = pushOut([px2 + d[0] * len, py2 + d[1] * len, pz2 + d[2] * len]);
            pos[vb * 3] = q[0]; pos[vb * 3 + 1] = q[1]; pos[vb * 3 + 2] = q[2];
          } else {
            pos[vb * 3] = pos[vt * 3];
            pos[vb * 3 + 1] = pos[vt * 3 + 1] - len;
            pos[vb * 3 + 2] = pos[vt * 3 + 2];
          }
        }
    }
    /* ★ v5-17 (ㄷ) — **블렌드**: `j ∈ (N_side, nvB]` 에서 `w = (j − N_side)/(nvB − N_side)` 로
     * 튜브(w=0)와 드레이프(w=1)를 섞고 `SEP` 등위면으로 사영한다 · `j ≤ N_side` 는 **튜브 그대로**. */
    if (S3BLEND && tube) {
      const span = Math.max(1, nvB - N_side);
      for (const pan of [front, back])
        for (let i = 0; i <= pan.nu; i++)
          for (let j = 0; j <= nvB; j++) {
            const v = at(pan, i, j);
            if (j <= N_side) {
              pos[v * 3] = tube[v * 3]; pos[v * 3 + 1] = tube[v * 3 + 1]; pos[v * 3 + 2] = tube[v * 3 + 2];
              continue;
            }
            const w = Math.min(1, (j - N_side) / span);
            /* ★ v5-18 ㉮ — `w = 0` 쪽 재료(= 몸통 튜브)를 **열에 따라** 팔 관 표면으로 바꾼다.
             * `T = (1 − u)·tube + u·armProj(tube)` · `S3ARM` 이 꺼져 있으면 `T = tube`(v5-17 그대로). */
            let T0 = tube[v * 3], T1 = tube[v * 3 + 1], T2 = tube[v * 3 + 2];
            if (S3ARM) {
              const u = uArm(i);
              if (u > 0) {
                const a = armProj([T0, T1, T2]);
                T0 += (a[0] - T0) * u; T1 += (a[1] - T1) * u; T2 += (a[2] - T2) * u;
              }
            }
            const q: [number, number, number] = [
              T0 * (1 - w) + pos[v * 3] * w,
              T1 * (1 - w) + pos[v * 3 + 1] * w,
              T2 * (1 - w) + pos[v * 3 + 2] * w];
            const r = pushOut(q);
            pos[v * 3] = r[0]; pos[v * 3 + 1] = r[1]; pos[v * 3 + 2] = r[2];
          }
    }
    /* ★ v5-17 (ㄴ) — **열 간격 항**: 같은 행의 이웃 열 거리를 2D 패턴 거리로 투영한다(중점 대칭 이동) ·
     * 수렴 `TOL_SELF` · 상한 `NY`(등재 값) · 그 뒤 `SEP` 밀어냄. 새 상수 0. */
    if (S3INTERVAL) {
      for (let it = 0; it < NY; it++) {
        let mx = 0;
        for (const pan of [front, back])
          for (let j = 0; j <= nvB; j++)
            for (let i = 0; i < pan.nu; i++) {
              const a = at(pan, i, j), b = at(pan, i + 1, j);
              const ka = (j * (pan.nu + 1) + i) * 2, kb = (j * (pan.nu + 1) + i + 1) * 2;
              const L2 = Math.hypot(pan.uv[ka] - pan.uv[kb], pan.uv[ka + 1] - pan.uv[kb + 1]);
              const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1],
                    dz = pos[b * 3 + 2] - pos[a * 3 + 2];
              const L3 = Math.hypot(dx, dy, dz);
              if (!(L3 > 1e-12)) continue;
              const sh = (L2 - L3) / 2;
              if (Math.abs(sh) > mx) mx = Math.abs(sh);
              const ux = dx / L3, uy = dy / L3, uz = dz / L3;
              pos[a * 3] -= ux * sh; pos[a * 3 + 1] -= uy * sh; pos[a * 3 + 2] -= uz * sh;
              pos[b * 3] += ux * sh; pos[b * 3 + 1] += uy * sh; pos[b * 3 + 2] += uz * sh;
            }
        if (mx <= TOL_SELF) break;
      }
      for (const pan of [front, back])
        for (let j = 0; j <= nvB; j++) for (let i = 0; i <= pan.nu; i++) {
          const v = at(pan, i, j);
          const r = pushOut([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
          pos[v * 3] = r[0]; pos[v * 3 + 1] = r[1]; pos[v * 3 + 2] = r[2];
        }
    }
    /* ★ v5-18 ㉯ — **행·열 간격 «동시» 보존 항**((ㄴ) 정정판 · §0-6 형식화 그대로).
     * 옛 `'ABI'` 는 같은 행의 `i↔i+1` 만 잡아 **열이 안쪽으로 수렴**했다 ⟹ 같은 열의 `j↔j+1` 도 같이 잡는다.
     * 목표 거리 = 2D 패턴 거리 · 중점 대칭 이동 · 수렴 `TOL_SELF` · 상한 `NY` · 끝나고 `SEP` 밀어냄.
     * 셋 다 이미 등재된 값이다 — 새 상수 0. */
    if (S3RC) {
      const rest = (pan: Panel, ia: number, ja: number, ib: number, jb: number) => {
        const ka = (ja * (pan.nu + 1) + ia) * 2, kb = (jb * (pan.nu + 1) + ib) * 2;
        return Math.hypot(pan.uv[ka] - pan.uv[kb], pan.uv[ka + 1] - pan.uv[kb + 1]);
      };
      let mx = 0;
      const relax = (a: number, b: number, L2: number) => {
        const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const L3 = Math.hypot(dx, dy, dz);
        if (!(L3 > 1e-12)) return;
        const sh = (L2 - L3) / 2;
        if (Math.abs(sh) > mx) mx = Math.abs(sh);
        const ux = dx / L3, uy = dy / L3, uz = dz / L3;
        pos[a * 3] -= ux * sh; pos[a * 3 + 1] -= uy * sh; pos[a * 3 + 2] -= uz * sh;
        pos[b * 3] += ux * sh; pos[b * 3 + 1] += uy * sh; pos[b * 3 + 2] += uz * sh;
      };
      for (let it = 0; it < NY; it++) {
        mx = 0;
        for (const pan of [front, back]) {
          for (let j = 0; j <= nvB; j++)                       // (가) 열 간격 — 같은 행의 이웃 열
            for (let i = 0; i < pan.nu; i++)
              relax(at(pan, i, j), at(pan, i + 1, j), rest(pan, i, j, i + 1, j));
          for (let i = 0; i <= pan.nu; i++)                    // (나) 행 간격 — 같은 열의 이웃 행
            for (let j = 0; j < nvB; j++)
              relax(at(pan, i, j), at(pan, i, j + 1), rest(pan, i, j, i, j + 1));
        }
        if (mx <= TOL_SELF) break;
      }
      for (const pan of [front, back])
        for (let j = 0; j <= nvB; j++) for (let i = 0; i <= pan.nu; i++) {
          const v = at(pan, i, j);
          const r = pushOut([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
          pos[v * 3] = r[0]; pos[v * 3 + 1] = r[1]; pos[v * 3 + 2] = r[2];
        }
    }
    /* ★ v5-18 — **「S3 직후 vs S4 직후」 훅**(v5-17 미측정 해소 · **인쇄 전용 · 거동 0줄**).
     * `pos` 사본만 넘긴다 — 교차는 계기가 «같은 `tris`» 로 단계별로 센다. */
    (globalThis as unknown as { __asm2StageProbe?: (stage: string, p: Float64Array) => void })
      .__asm2StageProbe?.('S3', Float64Array.from(pos));
    /* S4 — 밀어냄 */
    const gradPush: number[] = [];
    let iter = 0, maxMove = Infinity;
    /* ★ v5-15 (A) — 걸음 상한 `THICK`(행 간격의 «한 자릿수 아래» · 등재 자 인용 · 손 상수 0) ·
     * 훑는 순서 = **봉제선(맨 위 행)에서 아래로** · 반복 상한 = `NY`(이 함수가 이미 쓰는 등재 값). */
    const STEPCAP = S4CAP ? cfg.THICK : Infinity;
    const ITERCAP = S4NONE ? 0 : S4CAP ? NY : 8;   // ★ v5-19 — 0 이면 아래 루프가 «한 번도» 돌지 않는다
    const list: number[] = [];
    if (S4CAP) {
      for (let j = nvB; j >= 0; j--) for (const pan of [front, back])
        for (let i = 0; i <= pan.nu; i++) list.push(at(pan, i, j));
    } else {
      for (const pan of [front, back])
        for (let j = 0; j <= pan.nv; j++) for (let i = 0; i <= pan.nu; i++) list.push(at(pan, i, j));
    }
    for (; iter < ITERCAP && maxMove > TOL_SELF; iter++) {
      maxMove = 0;
      for (const v of list) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        const dd = sampleSdf(bodyG, x, y, z);
        if (!(dd < SEP)) continue;
        const gx = sampleSdf(bodyG, x + hh, y, z) - sampleSdf(bodyG, x - hh, y, z);
        const gy = sampleSdf(bodyG, x, y + hh, z) - sampleSdf(bodyG, x, y - hh, z);
        const gz = sampleSdf(bodyG, x, y, z + hh) - sampleSdf(bodyG, x, y, z - hh);
        const gn = Math.hypot(gx, gy, gz);
        if (!(gn > 1e-12)) continue;
        const step = Math.min(SEP - dd, STEPCAP);
        pos[v * 3] += (gx / gn) * step; pos[v * 3 + 1] += (gy / gn) * step; pos[v * 3 + 2] += (gz / gn) * step;
        if (step > maxMove) maxMove = step;
      }
      gradPush.push(maxMove);
    }
    (globalThis as unknown as { __asm2StageProbe?: (stage: string, p: Float64Array) => void })
      .__asm2StageProbe?.('S4', Float64Array.from(pos));
    /* ★ v5-19 §1-① — **몸 관통 분포**(인쇄 전용 · 거동 0줄). 자는 `S4`·`pushOut` 이 쓰는 그 `sampleSdf` 다.
     * `signed` = 몸 부호 있는 거리 · **침투 `P = max(0, −signed)`** · **밴드 안 ⟺ `P ≤ sdfSpec.band`** ·
     * 게이트 식 `pen = THICK − signed` 도 함께 낸다(`instruments.ts:255` · `s4Gate.ts:142` 그 채널).
     * ★ 손 상수 0 — `band` 는 `sdfSpec` 에서 읽는다(v4-34 의 8.5054 를 적지 않는다). */
    const BAND = sdfSpec.band;
    const penAll: { v: number; signed: number; pan: string; i: number; j: number }[] = [];
    for (const pan of B.panels)
      for (let j = 0; j <= pan.nv; j++)
        for (let i = 0; i <= pan.nu; i++) {
          const v = at(pan, i, j);
          const sg = sampleSdf(bodyG, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          if (sg < 0) penAll.push({ v, signed: sg, pan: pan.name, i, j });
        }
    const penP = penAll.map((r) => -r.signed).sort((a, b) => b - a);
    const outBand = penAll.filter((r) => -r.signed > BAND);
    /* ★ v5-13 §1-③ — **맞닿는 «자리»를 잰다**(v5-12 ㉡ 가 남긴 「계기 한 줄」 · 인쇄 전용 · 동작 0).
     * 자기검사는 «삼각형 쌍»만 알려 주고 «어느 정점·어느 행»인지 말하지 않는다. 상단 4행에 한해
     * 정점 쌍 최소 거리를 그 «자리»(패널 · i · j)와 함께 낸다(같은 열의 이웃 행은 뺀다 — 설계상 붙어 있다). */
    const near = { d: Infinity, a: '', b: '' };
    {
      const cand: { v: number; pan: string; i: number; j: number }[] = [];
      for (const [nm, pan] of [['front', front], ['back', back]] as const)
        for (let j = Math.max(0, nvB - 3); j <= nvB; j++)
          for (let i = 0; i <= pan.nu; i++) cand.push({ v: at(pan, i, j), pan: nm, i, j });
      for (let a = 0; a < cand.length; a++)
        for (let b = a + 1; b < cand.length; b++) {
          const A = cand[a], B2 = cand[b];
          if (A.pan === B2.pan && A.i === B2.i && Math.abs(A.j - B2.j) <= 1) continue;
          if (A.pan === B2.pan && Math.abs(A.i - B2.i) <= 1 && A.j === B2.j) continue;
          const d = Math.hypot(pos[A.v * 3] - pos[B2.v * 3], pos[A.v * 3 + 1] - pos[B2.v * 3 + 1],
                               pos[A.v * 3 + 2] - pos[B2.v * 3 + 2]);
          if (d < near.d) { near.d = d; near.a = `${A.pan}(i${A.i},j${A.j})`; near.b = `${B2.pan}(i${B2.i},j${B2.j})`; }
        }
    }
    /* ★ v5-14 §1-① — **㉡ 사실**(처방 «전»): 같은 `i` 의 앞뒤 간격을 **행별로** 추적한다.
     * 어느 행에서 `SEP` 밑으로 가는지 + 그 `i` 의 **능선 기울기**(`|t·ŷ|`)와 `n`↔`ẑ` 각을 함께 낸다.
     * 같은 행끼리(`d_same`)와 **대각 이웃**(`d_diag` · v5-13 의 최근접 쌍이 전부 대각이었다)을 둘 다 본다.
     * 인쇄 전용 · 동작 0. */
    /* ★ v5-15 §1-① — **(B) 산수 사전 점검**: 팔 윗면 곡률 반경을 «낙하 방향»으로 잰다.
     * `R ≈ Δ / ∠(n̂(c), n̂(c + d·Δ))` · `Δ = SEP`(등재 자 · 새 상수 0) ⟹ 「R < 행 길이」면
     * 접평면 한 걸음이 표면을 벗어난다(그 사실을 값으로 적는다 · 후보를 미리 떨구지 않는다). */
    const curvR: number[] = [];
    for (const side of [-1, 1]) {
      const rg = side < 0 ? rgL : rgR;
      for (let k = 1; k <= N_sh; k++) {
        const c = rg.atS((k / N_sh) * PATLEN);
        const n1 = nHat(c[0], c[1], c[2]); if (!n1) continue;
        const d = fallDir(n1);
        const c2: [number, number, number] = [c[0] + d[0] * SEP, c[1] + d[1] * SEP, c[2] + d[2] * SEP];
        const n2 = nHat(c2[0], c2[1], c2[2]); if (!n2) continue;
        const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        const ang = Math.acos(dot);
        curvR.push(ang > 1e-9 ? SEP / ang : Infinity);
      }
    }
    const curvFin = curvR.filter((x) => Number.isFinite(x));
    const rowTrace: Record<string, unknown>[] = [];
    for (const side of [-1, 1]) {
      const rg = side < 0 ? rgL : rgR;
      for (let k = 1; k <= N_sh; k++) {
        const i = side < 0 ? N_sh - k : N_sh + N_nk + k - 1;
        if (i < 0 || i > nuB) continue;
        const sArc = (k / N_sh) * PATLEN;
        const e = 1e-4;
        const pA = rg.atS(Math.max(0, sArc - e)), pB = rg.atS(Math.min(rg.total, sArc + e));
        const tv = [pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]];
        const tn = Math.hypot(tv[0], tv[1], tv[2]) || 1;
        const tHatY = Math.abs(tv[1] / tn);                       // |t·ŷ| — 능선 기울기
        const c = rg.atS(sArc);
        const gx = sampleSdf(bodyG, c[0] + hh, c[1], c[2]) - sampleSdf(bodyG, c[0] - hh, c[1], c[2]);
        const gy = sampleSdf(bodyG, c[0], c[1] + hh, c[2]) - sampleSdf(bodyG, c[0], c[1] - hh, c[2]);
        const gz = sampleSdf(bodyG, c[0], c[1], c[2] + hh) - sampleSdf(bodyG, c[0], c[1], c[2] - hh);
        const gn2 = Math.hypot(gx, gy, gz) || 1;
        const nzDeg = (Math.acos(Math.max(-1, Math.min(1, gz / gn2))) * 180) / Math.PI;  // n↔ẑ 각
        let firstJ = -1, dTop = NaN;
        for (let j = nvB; j >= 0; j--) {
          const vf = at(front, i, j), vb2 = at(back, i, j);
          const dS = Math.hypot(pos[vf * 3] - pos[vb2 * 3], pos[vf * 3 + 1] - pos[vb2 * 3 + 1],
                                pos[vf * 3 + 2] - pos[vb2 * 3 + 2]);
          let dD = Infinity;
          for (const dj of [-1, 1]) {
            const jj = j + dj; if (jj < 0 || jj > nvB) continue;
            const vb3 = at(back, i, jj);
            dD = Math.min(dD, Math.hypot(pos[vf * 3] - pos[vb3 * 3], pos[vf * 3 + 1] - pos[vb3 * 3 + 1],
                                         pos[vf * 3 + 2] - pos[vb3 * 3 + 2]));
          }
          if (j === nvB) dTop = dS;
          if (firstJ < 0 && Math.min(dS, dD) < SEP) firstJ = j;
        }
        /* ★ v5-14 §1-① 보충 — 실패 자리의 «행 간격»과 대각 거리를 함께 낸다(원인 후보를 가른다). */
        let rowGap = NaN, dSameAt = NaN, dDiagAt = NaN;
        if (firstJ >= 0) {
          const vf = at(front, i, firstJ), vb2 = at(back, i, firstJ);
          dSameAt = Math.hypot(pos[vf * 3] - pos[vb2 * 3], pos[vf * 3 + 1] - pos[vb2 * 3 + 1],
                               pos[vf * 3 + 2] - pos[vb2 * 3 + 2]);
          let dd = Infinity;
          for (const dj of [-1, 1]) {
            const jj = firstJ + dj; if (jj < 0 || jj > nvB) continue;
            const vb3 = at(back, i, jj);
            dd = Math.min(dd, Math.hypot(pos[vf * 3] - pos[vb3 * 3], pos[vf * 3 + 1] - pos[vb3 * 3 + 1],
                                         pos[vf * 3 + 2] - pos[vb3 * 3 + 2]));
          }
          dDiagAt = dd;
          if (firstJ < nvB) {
            const vu = at(front, i, firstJ + 1);
            rowGap = Math.hypot(pos[vf * 3] - pos[vu * 3], pos[vf * 3 + 1] - pos[vu * 3 + 1],
                                pos[vf * 3 + 2] - pos[vu * 3 + 2]);
          }
        }
        rowTrace.push({ side: side < 0 ? 'L' : 'R', i, 'sArc mm': sArc * 1000, 'tHatY': tHatY,
                        'n↔z deg': nzDeg, '상단 간격 mm': dTop * 1000, 'SEP 밑 첫 j': firstJ,
                        'nvB': nvB, '그 자리 같은행 mm': dSameAt * 1000, '그 자리 대각 mm': dDiagAt * 1000,
                        '그 자리 행간격 mm': rowGap * 1000 });
      }
    }
    (globalThis as unknown as { __asm2Probe?: (r: Record<string, unknown>) => void }).__asm2Probe?.({
      '최근접 정점쌍 mm': near.d * 1000, '최근접 자리': [near.a, near.b], '행별 추적': rowTrace,
      SH_DROP, Y_ANCHOR, Y_NECK, Y_TOP, DELTA, 'S4 반복': iter, 'S4 상한': ITERCAP,
      FIX: FIX ?? null, 'S4 걸음 상한 mm': STEPCAP === Infinity ? null : STEPCAP * 1000,
      '곡률 반경 mm': { 표본: curvR.length, 유한: curvFin.length,
        최소: curvFin.length ? Math.min(...curvFin) * 1000 : null,
        중앙: curvFin.length ? [...curvFin].sort((a, b) => a - b)[Math.floor(curvFin.length / 2)] * 1000 : null,
        '행 길이보다 작은 표본': curvFin.filter((x) => x < L / nvB).length },
      '행 간격(설계) mm': (L / nvB) * 1000,
      '능선 표본': rgL.pts.length, '능선 길이 mm(좌/우)': [rgL.total * 1000, rgR.total * 1000],
      '패턴 어깨선 길이(PATLEN) mm': PATLEN * 1000,
      '능선이 PATLEN 을 담는가(좌/우)': [rgL.total >= PATLEN, rgR.total >= PATLEN],
      '능선 끝 y m(좌/우)': [rgL.pts[rgL.pts.length - 1][1], rgR.pts[rgR.pts.length - 1][1]],
      '어깨끝(호길이 PATLEN) 좌': rgL.atS(PATLEN), '어깨끝(호길이 PATLEN) 우': rgR.atS(PATLEN),
      '능선 현 mm(좌/우)': [rgL.chord * 1000, rgR.chord * 1000],
      '폴리라인/현(좌/우)': [rgL.total / Math.max(1e-12, rgL.chord), rgR.total / Math.max(1e-12, rgR.chord)],
      '패턴 어깨선 길이 mm': Math.hypot(SH_LEN, SH_DROP) * 1000,
      '능선/패턴': rgL.total / Math.max(1e-12, Math.hypot(SH_LEN, SH_DROP)),
      'S4 최대이동 궤적 mm': gradPush.map((x) => x * 1000), 'S4 수렴': maxMove <= TOL_SELF,
      'TOL_SELF mm': TOL_SELF * 1000, '정점': list.length,
      /* ★ v5-18 §1-① — **패턴 분할 수**(암홀 열 정의가 여기서 선다) · **팔 관 값 «그대로»**. 인쇄 전용. */
      '패턴 분할': { N_sh, N_nk, N_side, N_arm: B.N_arm, N_und: B.N_und, nuB, nvB, nuS: B.nuS },
      '팔 관': { AX, 'AP(피벗)': AP, 'AO(원점)': AO, 'ARM.yc': ARM.yc, 'ARM.zc': ARM.zc,
        'SLV_R mm': SLV_R * 1000, 'SLV_X0 mm': SLV_X0 * 1000, 'SEP mm': SEP * 1000 },
      'u(i) 표본': Array.from({ length: nuB + 1 }, (_, i) => uArm(i)).filter((x) => x > 0).length,
      /* ★ v5-19 §1-① — **목선 링 / rest**(인쇄 전용). 링 = 맨 윗행의 목선 토막(`i ∈ [N_sh, N_sh+N_nk]`)
       * 을 앞·뒤에서 이어 붙인 폴리라인이고, rest 는 **같은 정점 쌍의 2D 패턴 거리 합**이다(별도 배열 0 · 함정 12). */
      '목선 링': (() => {
        let d3 = 0, d2 = 0;
        for (const pan of [front, back])
          for (let i = N_sh; i < N_sh + N_nk; i++) {
            const a = at(pan, i, nvB), b = at(pan, i + 1, nvB);
            d3 += Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
            const ka = (nvB * (pan.nu + 1) + i) * 2, kb = (nvB * (pan.nu + 1) + i + 1) * 2;
            d2 += Math.hypot(pan.uv[ka] - pan.uv[kb], pan.uv[ka + 1] - pan.uv[kb + 1]);
          }
        return { '3D mm': d3 * 1000, 'rest(패턴) mm': d2 * 1000, '비': d3 / Math.max(1e-12, d2) };
      })(),
      /* ★ v5-19 §1-① — 관통 분포 · 밴드 자(전부 인쇄 전용). */
      'S4 없음': S4NONE,
      '밴드 mm': BAND * 1000, 'h mm': hh * 1000, 'THICK mm': cfg.THICK * 1000, 'SEP mm': SEP * 1000,
      '관통': {
        '정점 수(signed < 0)': penAll.length,
        '최대 침투 mm': penP.length ? penP[0] * 1000 : 0,
        '중앙 침투 mm': penP.length ? penP[Math.floor(penP.length / 2)] * 1000 : 0,
        'p99 침투 mm': penP.length ? penP[Math.floor(penP.length * 0.01)] * 1000 : 0,
        '밴드 밖 정점 수': outBand.length,
        '밴드 밖 자리': outBand.slice(0, 12).map((r) => `${r.pan}(i${r.i},j${r.j}) ${(-r.signed * 1000).toFixed(4)}mm`),
        '최대 자리': penAll.length
          ? (() => { const w = penAll.reduce((a, b) => (a.signed <= b.signed ? a : b));
                     return `${w.pan}(i${w.i},j${w.j})`; })() : null,
        /* `pen = THICK − signed` 이고 `signed` 최소 = `−penP[0]` ⟹ `pen` 최대 = `THICK + penP[0]`(전개 0). */
        '게이트 식 pen 최대 mm': penP.length ? (cfg.THICK + penP[0]) * 1000 : null,
      },
    });
  }

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
    if (ASM2) redrapeAsm2(B, s.pos);      // ★ v5-12 — 2세대 배치(off 면 이 줄이 아무 일도 하지 않는다)

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
    /* ── v4-37 §1-③ **소매 축 방향 이동**(v3 동결 예외 3건째 «최종 형태 v2» · 전략 세션 v4-36 §4 승인) ──
     * 승인 문언 — 「전달 분기에서 소매 패널 배치 «후» 축 방향 평행이동: `p ← p + s·AX` ·
     *   `s = (어깨 이음 봉제쌍의 암홀 쪽 중심 − 소매 쪽 중심)·AX` · 좌우 각각 · 조립 자신에서 계산 ·
     *   수직 성분 적용 0(램프의 몫) · axDot·axPoint·fitSleeve·sgn 불변 · 미전달 분기 불변」.
     * ★ 근거(v4-35·36) — A포즈에서 두 링 «중심 거리»가 T포즈의 2.11배(109.12 → 230.08 mm)로 벌어졌고,
     *   축 성분만 되돌리면 65.36 mm(T보다 작다) · 봉제쌍 중앙 234.77 → 74.69 mm 로 닫힌다.
     * ★ **미전달 분기는 이 블록을 건너뛴다**(`AO` 가 null 이면 통째로 지나간다) ⟹ T포즈 비트 불변. */
    if (AO) {
      slv.forEach((sp, k) => {
        const lo = sp.base, hi = sp.base + (sp.nu + 1) * (sp.nv + 1), sg = k === 0 ? 1 : -1;
        let bx = 0, by = 0, bz = 0, sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const sm of seams)
          for (let q = 0; q < sm.a.length; q++) {
            const i2 = sm.a[q], j2 = sm.b[q];
            const iS = i2 >= lo && i2 < hi, jS = j2 >= lo && j2 < hi;
            if (iS === jS) continue;                       // 이 소매의 암홀 쌍만 고른다
            const sv = iS ? i2 : j2, bv = iS ? j2 : i2;
            bx += sg * s.pos[bv * 3]; by += s.pos[bv * 3 + 1]; bz += s.pos[bv * 3 + 2];
            sx += sg * s.pos[sv * 3]; sy += s.pos[sv * 3 + 1]; sz += s.pos[sv * 3 + 2];
            cnt++;
          }
        if (!cnt) return;
        const sAx = ((bx - sx) / cnt) * AX[0] + ((by - sy) / cnt) * AX[1] + ((bz - sz) / cnt) * AX[2];
        for (let v = lo; v < hi; v++) {
          s.pos[v * 3] += sg * sAx * AX[0];
          s.pos[v * 3 + 1] += sAx * AX[1];
          s.pos[v * 3 + 2] += sAx * AX[2];
        }
      });
    }

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
      /* v3-86 §1-③ — **인쇄 «전용» 계기**. 판정식(`m0 >= need`)도 스텝(`*= 1.5`)도 회수(8)도
       * 한 글자 안 바뀌었다. 전역 훅이 «있을 때만» 회차 값을 넘긴다(기본 경로 0줄 · 처방 0). */
      const probe = (globalThis as unknown as { __v3gapProbe?: (r: Record<string, unknown>) => void }).__v3gapProbe;
      /* v3-87 §1-①④ — 계기가 **그 회차의 씬 자체**를 받는다(정점·삼각형·패널 경계·몸 SDF).
       * 조립 로직은 한 글자도 바뀌지 않았다 — 넘기는 «값»만 늘렸다. */
      if (probe) probe({ 회차: i, GAP_SIDE, 측정_최소쌍거리_m: m0, 기준_need_m: need, DELTA,
        pos: sc0.s.pos, tris: sc0.tris,
        panels: sc0.panels.map((p) => ({ name: p.name, base: p.base })),
        n: sc0.n,
        /* v3-87 §1-③ — 소매 배치의 «유도값»도 함께 넘긴다(인쇄 전용). */
        SLV_X0, SLV_R, CAP_W, RMIN_소매: CAP_W / Math.PI, 감김호_rad: 2 * CAP_W / SLV_R,
        sdf: (x: number, y: number, z: number) => sampleSdf(bodyG, x, y, z) });
      /* ★ v5-16 §1-② — **`asm2` 경로의 «자의 대상» 정정**(전략 세션 v5-15 §4 판정문 · 문턱 이동 «아님»).
       * 근거 — 남은 f0 결함은 관통·교차가 아니라 **천끼리 `SEP` 미만 근접**(0.52~1.58 mm · v5-15 §1-②)이고
       *   그 대역은 **자기충돌 제약의 정의역 안**이다(`sep` 안의 쌍을 «전부» 처리한다 · v3-12) ⟹
       *   v4-37 규칙의 자기충돌판 = 「f0 자기 근접이 **교차 0** 이고 제약 작동 범위 안이면 **최종 판정은
       *   굽기(게이트)가 한다**」.
       * ⟹ 재는 «양»을 「거리 ≥ `SEP`」에서 **「면 교차 0 ∧ 최소쌍 > 0」**으로 바꾼다.
       *   `min > 0` 은 문턱이 아니라 **«같은 점이 아니다»**라는 뜻이다(부동소수에서 0 = 겹침).
       * ★ `asm2` 가 꺼져 있으면 이 분기를 **지나가지 않는다** ⟹ off 경로 바이트 불변(A29·T108 로 확인). */
      if (ASM2) {
        const mpA = minPairDist(sc0.s.pos, sc0.tris, SEP * 2);
        (globalThis as unknown as { __asm2SelfProbe?: (r: Record<string, unknown>) => void })
          .__asm2SelfProbe?.({ 회차: i, 교차: mpA.hits, '최소쌍 mm': mpA.min * 1000, GAP_SIDE, DELTA,
            '최소쌍 삼각형': mpA.worst });
        if (mpA.hits === 0 && mpA.min > 0) { ok = true; break; }
      } else if (m0 >= need) { ok = true; break; }
      GAP_SIDE *= 1.5;
    }
    if (!ok) {
      /* ★ v3-90 §1-① — **문언을 채널 이름으로**(v3-88 형식 · 함정 38). 판정 채널은 «옷 전체»
       * 자기 최소거리인데 옛 문언은 「옆 틈 G」였다 — 실패 20칸 중 «옆선»은 7칸뿐이었다.
       * **구매자 문언 불변** · **108 원본 사유 불변**. */
      const sc0 = assemble(D_FIXED);
      const w = minPairDist(sc0.s.pos, sc0.tris, SEP * 2);
      const bases = sc0.panels.map((p) => p.base).concat([sc0.n]);
      const nameOf = (v: number) => { for (let k = 0; k < sc0.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return sc0.panels[k].name; return '?'; };
      const pn = (t: number) => t < 0 ? '?' : [...new Set([0, 1, 2].map((k) => nameOf(sc0.tris[t * 3 + k])))].join('+');
      if (ASM2) throw new Error(`옷 자기 «교차» — 교차 ${w.hits}개 · 최소쌍 `
        + `${pn(w.worst[0])}↔${pn(w.worst[1])} ${(w.min * 1000).toPrecision(4)}mm — 갈래 D`);
      throw new Error(`옷 자기 간격 SEP 미달 — 최소쌍 ${pn(w.worst[0])}↔${pn(w.worst[1])}`
        + ` ${(w.min * 1000).toPrecision(4)}mm — 갈래 D`);
    }
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
  return {
    /* 제도 */
    Y_TOP, Y_NECK, NECK_RING, neckDiag, CAP_TUBE,
    NECK_A, NECK_G, CAP_H, CAP_W, NECK_B, ARM_A, ARM_D,
    Y_ARM, SH_LEN, SLEEVE_UNDER, LEN_ARM, LEN_NECK, LEN_CAP,
    armR, neckF, capF, arcLen, solveB, famArm, famCap, famNeck, resample,
    /* 메시·배치 */
    at, build, place, Y_HEM, AXIS_Z, NY, SLAB, yOf, HSUP_Y, SCALES, DELTA, GAP_SIDE,
    supportAt, boundaryOf, perimOf, panelHalfWidth, arcOn, bodyPoint, distToSurface,
    PROBE, ARM, SLV_X0, SLV_R, PLACE_SIG,
    /* 봉제·파라미터 */
    assemble, substepsOf, meshQuality,
  };
}

export type GarmentScene = ReturnType<typeof createScene>;
export type Scene = ReturnType<GarmentScene['assemble']>;
export type Panel = Scene['panels'][number];
