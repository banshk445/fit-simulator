/* v3-52 §1-4 — **핏 리포트 5행 표**(v3 자립). 규칙은 `docs/v3/33-가슴재정의와5행표.md` §1-4 가
 * «먼저» 확정했다(커밋 `64abf32`). **물리 0프레임** — 주입된 정착 상태를 «읽기»만 한다.
 *
 * 값 c = 몸 부호거리(`sampleSdf(bodyG,·)`) — `v3O4` 와 «같은 계기»다.
 * 국면(#110 Q1): 눌림 c<0 · 밀착 0≤c≤SEP · 여유 c>SEP. **새 문턱 0**(SEP = 2×THICK).
 * 대역 반폭 = 그 원단의 격자 간격 `d`(등재 사다리값) — **새 수 0**.
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · console 0 · **v2 임포트 0**(G1).
 */
import { SEP, THICK } from './consts.ts';
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
  self: { n: number; maxDiffMm: number; signAgreePct: number; domain: string };
};

const quant = (v: number[], f: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] * 1000 : NaN);

export function buildFitReport(P: Prepared, L: Levels): FitReportResult {
  const { sc, bodyG, d } = P;
  const pos = sc.s.pos;
  const c = (v: number) => sampleSdf(bodyG, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);

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

  const row = (name: string, domainSpec: string, idx: number[]): FitRow => {
    const raw = idx.map(c);
    const v = raw.filter((q) => Number.isFinite(q)).sort((a, b) => a - b);
    return {
      name, domainSpec, n: v.length, domain: raw.length,
      p25Mm: quant(v, 0.25), medMm: quant(v, 0.5), p75Mm: quant(v, 0.75),
      pressN: v.filter((q) => q < 0).length,
      snugN: v.filter((q) => q >= 0 && q <= SEP).length,
      looseN: v.filter((q) => q > SEP).length,
    };
  };

  const rows = [
    row('목선', '`s4Gate` 링(neckF ∪ neckB)', neck),
    row('가슴', `몸통 패널 · |y − chestY| ≤ d(${(d * 1000).toFixed(1)}mm)`, bandOf(L.chestY)),
    row('허리', `몸통 패널 · |y − waistY| ≤ d(${(d * 1000).toFixed(1)}mm)`, bandOf(L.waistY)),
    row('밑단', '밑단 사슬(앞판 j=0 ∪ 뒤판 j=0)', hem),
    row('소매', '소매 패널 전량', sleeve),
  ];

  /* ── G6 자기검사 — 리포트 층 c ↔ 게이트가 쓰는 «정확» 거리. 같은 blob · 근방만(게이트와 같은 정의역) ── */
  const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG, h: P.sdfSpec.h, thick: THICK });
  let n = 0, maxDiff = 0, same = 0;
  for (let v = 0; v < sc.n; v++) {
    const g = c(v);
    if (!(Math.abs(g) <= bd.CELL)) continue;          // 게이트와 같은 근방 정의역
    const e = bd.exactBodyDist(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const signed = g < 0 ? -e : e;
    n++;
    maxDiff = Math.max(maxDiff, Math.abs(signed - g));
    if ((signed < 0) === (g < 0)) same++;
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
    rows,
    self: { n, maxDiffMm: maxDiff * 1000, signAgreePct: n ? (100 * same) / n : NaN, domain: `|c| ≤ CELL(${(bd.CELL * 1000).toFixed(1)}mm) — 게이트와 같은 근방` },
  };
}
