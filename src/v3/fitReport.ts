/* v3-52 §1-4 — **핏 리포트 5행 표**(v3 자립). 규칙은 `docs/v3/33-가슴재정의와5행표.md` §1-4 가
 * «먼저» 확정했다(커밋 `64abf32`). **물리 0프레임** — 주입된 정착 상태를 «읽기»만 한다.
 *
 * v3-53 §0-2 — 값 c = **정확 최근접점 거리 + 부호**로 교체했다(v3-52 §3-1 «밴드 포화» 처분 ㉯).
 *   거리: `exactBodyDist`(게이트 `bodyClearance` 가 ③a 를 판정할 때 쓰는 «그 함수» · §0-1a 판단)
 *   부호: **밴드 안은 SDF 부호** · **밴드 밖은 «+» 확정**(게이트가 관통 ≤ 0.5mm ≪ 밴드를 보장)
 * **v3-54 Q1 ㉮ — 국면 판정의 «정본»은 정확 거리다.** 근거는 «정의»다: 경계 `SEP` 는 **길이**이고
 *   길이 비교는 **거리의 정의**로 한다. 구 채널(`sampleSdf`)은 **근사**이며 그 오차(밴드 안 실측
 *   0.943~0.975mm · v3-53 §2)가 **2mm 경계 판정을 뒤집기 충분**하다 — 실제로 1~4정점이 갈렸고
 *   그 차이는 «오류»가 아니라 **교정**이다. **데이터가 근거가 아니라 «정의»가 근거다.**
 * 구 채널은 **삭제하지 않고 «자기검사 전용»으로 강등**한다(`sdfRows` · `self`) — 판정에 쓰지 않는다.
 * 국면(#110 Q1): 눌림 c<0 · 밀착 0≤c≤SEP · 여유 c>SEP. **새 문턱 0**(SEP = 2×THICK).
 * 대역 반폭 = 그 원단의 격자 간격 `d`(등재 사다리값) — **새 수 0**.
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · console 0 · **v2 임포트 0**(G1).
 */
import { SEP, THICK } from './consts.ts';
import { S4_THRESHOLD } from './s4Gate.ts';

/** 색 분기점의 «눌림 하한» — 게이트 ③a 문턱 그대로다(`s4Gate` 등재값 · 새 수 0). */
const PEN_FLOOR = -S4_THRESHOLD.penMaxM;
import { sampleSdf } from './bodySdf.ts';
import { makeBodyDistance } from './instruments.ts';
import type { Prepared } from './dressRun.ts';
import type { Levels } from './bodyLevels.ts';

export type FitRow = {
  name: string; domainSpec: string;
  /** 표본 수 / 정의역 수 — 「산출 불가」를 침묵으로 넘기지 않는다. */
  n: number; domain: number;
  p25Mm: number; medMm: number; p75Mm: number;
  pressN: number; snugN: number; looseN: number;
};
export type FitReportResult = {
  /** G5 — 화면이 스스로 밝히는 경계와 그 도출. */
  sepMm: number; sepDerivation: string;
  bandHalfMm: number; bandDerivation: string;
  levels: { chestYCm: number; waistYCm: number; yLowCm: number; yArmCm: number; cChestCm: number; cWaistCm: number };
  rows: FitRow[];
  /** G6 자기검사 — 같은 blob 에서 리포트 층 c ↔ 게이트 정확 거리 대조. */
  self: { n: number; maxDiffMm: number; signAgreePct: number; domain: string;
    /** 등재 문언(`instruments.ts`: 「SDF 오차 ≤ h의 5%」)을 넘는 표본 수와 그 문턱[mm]. */
    noiseMm: number; overNoise: number; hMm: number };
  /** 구 채널(`sampleSdf`)로 낸 같은 표. **v3-54 로 «자기검사 전용» 강등 — 판정에 쓰지 않는다.** */
  sdfRows: FitRow[];
  /** v3-54 ㉢ — 정점색(0~1 RGB · 표시 전용)과 그 분기점. **판정 채널 아님.** */
  color: { rgb: Float32Array; looseTopMm: number; penFloorMm: number; derivation: string };
  /** 밴드 상한[mm] — 구 채널이 포화하던 자리(`THICK + 2h`). 화면이 밝힌다. */
  bandMm: number;
};

const quant = (v: number[], f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] * 1000 : NaN);

export function buildFitReport(P: Prepared, L: Levels): FitReportResult {
  const { sc, bodyG, d } = P;
  const pos = sc.s.pos;
  const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG, h: P.sdfSpec.h, thick: THICK });
  /** 구 채널 — 밴드 안에서만 실거리이고 그 밖은 «밴드 상한»으로 포화한다(v3-52 §3-1). */
  const cSdf = (v: number) => sampleSdf(bodyG, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
  /** 밴드 상한 — `deriveSpacing` 의 `band = THICK + 2h`(`bodySdf.ts`). 포화 자리이자 부호 규칙의 경계다. */
  const BAND = THICK + 2 * P.sdfSpec.h;
  /**
   * v3-53 신 채널 — **정확 거리 + 부호**.
   * **부호 논증**: 게이트가 ③a 관통 ≤ 0.5mm 를 «통과 조건»으로 잠갔고(`s4Gate.S4_THRESHOLD.penMaxM`),
   * 관통 정점은 몸 표면에서 최대 0.5mm 안쪽이다. 밴드(= THICK + 2h ≫ 0.5mm) «밖»의 정점은
   * 따라서 **몸 안일 수 없다** ⟹ 부호는 «+» 로 확정된다. 밴드 «안»에서는 SDF 부호를 그대로 쓴다.
   */
  const c = (v: number) => {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const e = bd.exactBodyDist(x, y, z);
    const g = sampleSdf(bodyG, x, y, z);
    return g < BAND && g < 0 ? -e : e;
  };

  /* ── 정의역 5개. 집합은 «이미 쓰는 것»에서 직접 뜬다(함정 12 규범) ── */
  const neck = [...P.neckF, ...P.neckB];
  const torsoPanels = [sc.front, sc.back];
  const bandOf = (cy: number): number[] => {
    const out: number[] = [];
    for (const p of torsoPanels)
      for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++)
        if (Math.abs(pos[v * 3 + 1] - cy) <= d) out.push(v);
    return out;
  };
  /* 밑단 사슬 — 하네스 `hemIx` 와 «같은 정의»(앞판 j=0 행 ∪ 뒤판 j=0 행). */
  const hem = torsoPanels.flatMap((p) => Array.from({ length: sc.nuB + 1 }, (_, i) => P.S.at(p, i, 0)));
  const sleeve: number[] = [];
  for (const p of sc.slv) for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++) sleeve.push(v);

  const rowWith = (f: (v: number) => number) => (name: string, domainSpec: string, idx: number[]): FitRow => {
    const raw = idx.map(f);
    const v = raw.filter((q) => Number.isFinite(q)).sort((a, b) => a - b);
    return {
      name, domainSpec, n: v.length, domain: raw.length,
      p25Mm: quant(v, 0.25), medMm: quant(v, 0.5), p75Mm: quant(v, 0.75),
      pressN: v.filter((q) => q < 0).length,
      snugN: v.filter((q) => q >= 0 && q <= SEP).length,
      looseN: v.filter((q) => q > SEP).length,
    };
  };

  const row = rowWith(c), rowSdf = rowWith(cSdf);
  const mk = (r: (n: string, d: string, i: number[]) => FitRow) => [
    r('목선', '`s4Gate` 링(neckF ∪ neckB)', neck),
    r('가슴', `몸통 패널 · |y − chestY| ≤ d(${(d * 1000).toFixed(1)}mm)`, bandOf(L.chestY)),
    r('허리', `몸통 패널 · |y − waistY| ≤ d(${(d * 1000).toFixed(1)}mm)`, bandOf(L.waistY)),
    r('밑단', '밑단 사슬(앞판 j=0 ∪ 뒤판 j=0)', hem),
    r('소매', '소매 패널 전량', sleeve),
  ];
  const rows = mk(row), sdfRows = mk(rowSdf);

  /* ── G6 자기검사(v3-53 확장) — **밴드 «안»** 표본에서 신 채널(정확 거리) ↔ 구 채널(SDF) 대조.
   * 정의역을 밴드 안으로 좁힌 것이 v3-52 와의 차이다 — 밴드 밖은 구 채널이 «포화»라 대조가 무의미하고,
   * 그 사실 자체는 v3-52 §3-1 이 이미 값으로 등재했다. 여기서 묻는 것은 「**둘이 같은 곳을 같게 보는가**」다. */
  /** 등재 잡음 문언 — `instruments.ts` 의 「SDF 오차 ≤ h의 5%」. **이 판이 정한 수가 아니다.** */
  const NOISE = 0.05 * P.sdfSpec.h;
  let n = 0, maxDiff = 0, same = 0, over = 0;
  for (let v = 0; v < sc.n; v++) {
    const g = cSdf(v);
    /* 「밴드 안」의 판별은 **정확 거리**로 한다 — 구 채널(g)로 판별하면 포화값이 밴드 «안»으로
     * 읽혀 정의역이 전량이 되고, 대조가 순환한다(1차 구현의 결함 · 값으로 드러났다). */
    const signed = c(v);
    if (!(Math.abs(signed) < BAND)) continue;         // 밴드 «안» 표본만
    n++;
    const dif = Math.abs(signed - g);
    maxDiff = Math.max(maxDiff, dif);
    if (dif > NOISE) over++;
    if ((signed < 0) === (g < 0)) same++;
  }

  /* ── v3-54 ㉢ — **핏 맵 색**. 표시 층이고 물리 채널이 아니다. 값 c 는 위와 «같은 것»을 쓴다. ──
   * 분기점 4개는 전부 «등재량 또는 그 상태»에서 온다(손 상수 0):
   *   −0.5mm = 게이트 하한(`S4_THRESHOLD.penMaxM`) · 0 = 눌림/밀착 경계 ·
   *   SEP(2mm) = 밀착/여유 경계(#110 Q1) · 여유 상한 = **그 상태 c 의 p95**.
   * **p95 의 근거**: 상한을 p100 으로 두면 «가장 멀리 뜬 몇 정점»(밑단 자락)이 그라데이션 전체를
   *   눌러 대부분이 한 색으로 뭉친다. p95 는 그 꼬리만 잘라내는 **표시 층 절단**이고,
   *   값은 «그 상태»에서 뜨므로 원단·해상도마다 다르다. **판정 채널이 아니며 범례가 mm 를 밝힌다.** */
  function colorOf() {
    const all: number[] = [];
    for (let v = 0; v < sc.n; v++) all.push(c(v));
    const sorted = [...all].sort((a, b) => a - b);
    const looseTop = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
    const rgb = new Float32Array(sc.n * 3);
    /* 색상은 표시 재량 — 눌림 진홍 → 밀착 호박 → 여유 하늘. 세 국면이 «색상»으로 갈리고
     * 국면 «안»에서만 밝기가 움직인다(경계가 색으로 읽히게). */
    for (let v = 0; v < sc.n; v++) {
      const q = all[v];
      let r = 0, g2 = 0, b = 0;
      if (q < 0) {                                   // 눌림 — 게이트 하한에서 0 까지
        const t = Math.min(1, q / -PEN_FLOOR);       // 0(경계) → 1(하한)
        r = 0.55 + 0.45 * t; g2 = 0.16 * (1 - t); b = 0.26 * (1 - t);
      } else if (q <= SEP) {                         // 밀착
        const t = q / SEP;
        r = 0.98; g2 = 0.62 + 0.20 * t; b = 0.15 + 0.15 * t;
      } else {                                       // 여유 — SEP 에서 p95 까지
        const t = Math.min(1, (q - SEP) / Math.max(1e-9, looseTop - SEP));
        r = 0.42 - 0.30 * t; g2 = 0.66 - 0.18 * t; b = 0.90;
      }
      rgb[v * 3] = r; rgb[v * 3 + 1] = g2; rgb[v * 3 + 2] = b;
    }
    return { rgb, looseTopMm: looseTop * 1000, penFloorMm: PEN_FLOOR * 1000,
      derivation: '분기점 −0.5mm(게이트 하한) · 0 · SEP 2mm · 여유 상한 = 그 상태 c 의 p95(표시 층 절단 · 판정 아님)' };
  }

  return {
    sepMm: SEP * 1000,
    sepDerivation: 'SEP = 2 × THICK(옷 두께 1mm) — v3-13 등재 · 자기충돌 분리 거리와 «같은 수»',
    bandHalfMm: d * 1000,
    bandDerivation: '대역 반폭 = 그 원단의 격자 간격 d(등재 사다리값) — 표본 한 칸',
    levels: {
      chestYCm: L.chestY * 100, waistYCm: L.waistY * 100, yLowCm: L.Y_LOW * 100,
      yArmCm: L.Y_ARM * 100, cChestCm: L.C_chest * 100, cWaistCm: L.C_waist * 100,
    },
    rows, sdfRows, bandMm: BAND * 1000, color: colorOf(),
    self: { n, maxDiffMm: maxDiff * 1000, signAgreePct: n ? (100 * same) / n : NaN, domain: `SDF 밴드 안(< ${(BAND * 1000).toFixed(3)}mm)`, noiseMm: NOISE * 1000, overNoise: over, hMm: P.sdfSpec.h * 1000 },
  };
}
