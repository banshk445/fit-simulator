/* v4-10 §1-② — **제품 문턱**으로 두 핏 리포트를 재판정한다. 새 계산 0 · 새 수 0 · 손 상수 0.
 *
 * 규칙(전략 세션 v4-09 §4 판정문): 「같은 옷」 = **표시 리포트 5행이 반올림 후 일치** +
 * **대역 소속(v3-54) 일치** + **게이트 판정 일치**. 이 파일은 앞의 둘을 «코드에서 인용»해 건다.
 *
 * 인용 자리(값을 여기서 다시 적지 않는다):
 * ```
 *  표시 반올림 — `src/components/V3ProductV1.tsx:348`  `r.medMm.toFixed(1)` + "mm"   (제품 화면 v1)
 *               `src/components/FitReportTable.tsx:46-47` `toFixed(2)`               (진단 패널)
 *  대역 이름   — `src/components/V3ProductV1.tsx:52-59` `phaseOf(medMm, sepMm)`
 *               눌림 medMm < 0 · 밀착 0 ≤ medMm ≤ sepMm · 여유 medMm > sepMm
 *  대역 경계   — `src/v3/consts.ts:8` `SEP = 2 × THICK` (= 2mm · `fitReport` 가 `sepMm` 로 낸다)
 *  정점 대역   — `src/v3/fitReport.ts:98-100` pressN(q<0) · snugN(0≤q≤SEP) · looseN(q>SEP)
 *  대역 정의역 — `src/v3/fitReport.ts:80-86` bandOf(cy) = |y − cy| ≤ d (가슴·허리 행의 «표본»)
 * ```
 * 진입: `A=<fit json> B=<fit json> [TAG=…] npx tsx scripts/v4ProductCmp.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SEP } from '../src/v3/consts.ts';

type Row = { name: string; n: number; domain: number; p25Mm: number; medMm: number; p75Mm: number;
             pressN: number; snugN: number; looseN: number };
type Fit = { cell: string; tag: string; sepMm: number; rows: Row[] };

const A: Fit = JSON.parse(readFileSync(process.env.A!, 'utf8'));
const B: Fit = JSON.parse(readFileSync(process.env.B!, 'utf8'));

/** `V3ProductV1.tsx:52-59` 그대로 — 경계는 `fit.sepMm`(= consts.SEP) 이다. */
function phaseOf(medMm: number, sepMm: number): string {
  if (!Number.isFinite(medMm)) return '산출 불가';
  if (medMm < 0) return '눌림';
  if (medMm <= sepMm) return '밀착';
  return '여유';
}
/** `V3ProductV1.tsx:348` 그대로 */
const show1 = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}mm` : '—');
/** `FitReportTable.tsx:46-47` 그대로 */
const show2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

if (A.sepMm !== SEP * 1000 || B.sepMm !== SEP * 1000)
  throw new Error(`sepMm 이 consts.SEP 와 다르다 — ${A.sepMm}/${B.sepMm} vs ${SEP * 1000}`);

const rows = A.rows.map((a, i) => {
  const b = B.rows[i];
  if (a.name !== b.name) throw new Error(`행 이름이 어긋난다 — ${a.name} ≠ ${b.name}`);
  const pa = phaseOf(a.medMm, A.sepMm), pb = phaseOf(b.medMm, B.sepMm);
  return {
    행: a.name,
    표시값_1자리: { A: show1(a.medMm), B: show1(b.medMm), 같은가: show1(a.medMm) === show1(b.medMm) },
    대역이름: { A: pa, B: pb, 같은가: pa === pb },
    진단_2자리: {
      A: `${show2(a.medMm)} (${show2(a.p25Mm)}~${show2(a.p75Mm)})`,
      B: `${show2(b.medMm)} (${show2(b.p25Mm)}~${show2(b.p75Mm)})`,
      같은가: show2(a.medMm) === show2(b.medMm) && show2(a.p25Mm) === show2(b.p25Mm) &&
              show2(a.p75Mm) === show2(b.p75Mm),
    },
    정점대역소속: {
      A: [a.pressN, a.snugN, a.looseN], B: [b.pressN, b.snugN, b.looseN],
      같은가: a.pressN === b.pressN && a.snugN === b.snugN && a.looseN === b.looseN,
    },
    대역정의역_n: { A: a.n, B: b.n, 같은가: a.n === b.n },
    차_mm: { 중앙: b.medMm - a.medMm, p25: b.p25Mm - a.p25Mm, p75: b.p75Mm - a.p75Mm },
  };
});

const cnt = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
const out = {
  what: 'v4-10 §1-② — 제품 문턱 재판정(새 실행 0 · 새 수 0)',
  규칙출처: '전략 세션 v4-09 §4 판정문 · 인용 자리는 이 파일 머리 주석',
  A: { tag: A.tag, path: process.env.A }, B: { tag: B.tag, path: process.env.B },
  sepMm: A.sepMm,
  요약: {
    '표시값 1자리 일치': `${cnt((r) => r.표시값_1자리.같은가)}/5`,
    '대역 이름 일치': `${cnt((r) => r.대역이름.같은가)}/5`,
    '진단 2자리 일치': `${cnt((r) => r.진단_2자리.같은가)}/5`,
    '정점 대역 소속 일치': `${cnt((r) => r.정점대역소속.같은가)}/5`,
    '대역 정의역 n 일치': `${cnt((r) => r.대역정의역_n.같은가)}/5`,
  },
  rows,
};
const tag = process.env.TAG ?? `${A.tag}_vs_${B.tag}`;
writeFileSync(`gpu/oracle/export/l3-product-cmp-${tag}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
