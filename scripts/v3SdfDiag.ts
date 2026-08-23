/* v3-53 §3 — **사실 수집 전용**. 갈래 B·C 가 발화한 «뒤»에 그 정체를 값으로 남긴다.
 * **판정 0 · 규칙 변경 0 · 색 착수 0.** 정확 거리 ↔ SDF 의 차가 «어디»에 사는지만 인쇄한다.
 * 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3SdfDiag.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, THICK, SEP } from '../src/v3/consts.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const BAND = THICK + 2 * P.sdfSpec.h, NOISE = 0.05 * P.sdfSpec.h;
const pos = P.sc.s.pos;
const bins: { lo: number; hi: number; n: number; max: number; over: number }[] = [
  { lo: 0, hi: 0.001, n: 0, max: 0, over: 0 },
  { lo: 0.001, hi: SEP, n: 0, max: 0, over: 0 },
  { lo: SEP, hi: 0.004, n: 0, max: 0, over: 0 },
  { lo: 0.004, hi: 0.006, n: 0, max: 0, over: 0 },
  { lo: 0.006, hi: 0.008, n: 0, max: 0, over: 0 },
  { lo: 0.008, hi: BAND, n: 0, max: 0, over: 0 },
];
for (let v = 0; v < P.sc.n; v++) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  const g = sampleSdf(P.bodyG, x, y, z), e = bd.exactBodyDist(x, y, z);
  const signed = g < BAND && g < 0 ? -e : e;
  const a = Math.abs(signed);
  if (!(a < BAND)) continue;
  const dif = Math.abs(signed - g);
  for (const b2 of bins) if (a >= b2.lo && a < b2.hi) { b2.n++; b2.max = Math.max(b2.max, dif); if (dif > NOISE) b2.over++; break; }
}
const mm = (v: number) => (v * 1000).toFixed(3);
console.log(`[SDF 진단:${FAB} d${(D * 1000).toFixed(0)}] h ${mm(P.sdfSpec.h)}mm · 밴드 ${mm(BAND)}mm · 등재 잡음(h의 5%) ${mm(NOISE)}mm`);
console.log(`  ${'|c| 구간[mm]'.padStart(16)}${'표본'.padStart(7)}${'최대차[mm]'.padStart(12)}${'잡음 초과'.padStart(11)}`);
for (const b2 of bins)
  console.log(`  ${`${mm(b2.lo)}~${mm(b2.hi)}`.padStart(16)}${String(b2.n).padStart(7)}${(b2.n ? (b2.max * 1000).toFixed(4) : '—').padStart(12)}${`${b2.over}(${b2.n ? ((100 * b2.over) / b2.n).toFixed(1) : '0'}%)`.padStart(11)}`);
