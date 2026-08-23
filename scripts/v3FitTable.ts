/* v3-52 §3 — **5행 표 인쇄**(Node 대조용). 화면(v3 패널)과 «같은 모듈»을 쓴다 — 함정 22 예방.
 * **물리 0프레임**(정착 blob 주입만) · v2 임포트 0 · `V2DIMS` 미사용(G1).
 * 진입: `FAB=sweat D_MM=8 BLOB=<경로> npx tsx scripts/v3FitTable.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { deriveLevels } from '../src/v3/bodyLevels.ts';
import { buildFitReport } from '../src/v3/fitReport.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);
const R = buildFitReport(P, L);
const f = (v: number, w = 8) => (Number.isFinite(v) ? v.toFixed(2) : '—').padStart(w);
console.log(`[핏 리포트:${FAB} d${(D * 1000).toFixed(0)}] 정점 ${P.sc.n} · **물리 0프레임**`);
console.log(`  경계 **${R.sepMm.toFixed(1)}mm** — ${R.sepDerivation}`);
console.log(`  대역 반폭 **${R.bandHalfMm.toFixed(1)}mm** — ${R.bandDerivation}`);
console.log(`  높이  chestY ${R.levels.chestYCm.toFixed(2)}cm(C ${R.levels.cChestCm.toFixed(2)}) · waistY ${R.levels.waistYCm.toFixed(2)}cm(C ${R.levels.cWaistCm.toFixed(2)})`);
console.log(`  ${'부위'.padEnd(6)}${'중앙'.padStart(8)}${'p25'.padStart(8)}${'p75'.padStart(8)}${'눌림'.padStart(7)}${'밀착'.padStart(7)}${'여유'.padStart(7)}${'표본/정의역'.padStart(13)}`);
for (const r of R.rows)
  console.log(`  ${r.name.padEnd(6)}${f(r.medMm)}${f(r.p25Mm)}${f(r.p75Mm)}${String(r.pressN).padStart(7)}${String(r.snugN).padStart(7)}${String(r.looseN).padStart(7)}${`${r.n}/${r.domain}`.padStart(13)}`);
console.log(`  **자기검사(G6)** 표본 ${R.self.n} · 최대차 **${R.self.maxDiffMm.toFixed(4)}mm** · 부호 일치율 **${R.self.signAgreePct.toFixed(2)}%** · 정의역 ${R.self.domain}`);
const bad = R.rows.filter((r) => r.n === 0 || !Number.isFinite(r.medMm));
console.log(`  **G4** NaN·산출 불가 행 ${bad.length} ⟹ ${bad.length === 0 ? '**통과**' : `**실패** (${bad.map((r) => r.name).join(',')})`}`);
