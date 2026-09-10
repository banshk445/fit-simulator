/* v3-90 §0-3 ㉮ — **물림 집합 K 를 «규칙»으로 뽑는다**(집행 «전» · 코드 변경 0 · 조립만).
 * K = { 칸 | R/RMIN < 1 + SEP/(2·CAP_W) }.  진입: `npx tsx scripts/v3SetK.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
const cache = new Map<string, Float32Array>();
const bodyOf = (b: string) => {
  let v = cache.get(b);
  if (!v) { const x = readFileSync(`public/v3diag/v3-77/body-${b}.bin`);
            v = new Float32Array(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); cache.set(b, v); }
  return v;
};
type R = { SLV_R: number; CAP_W: number; RMIN_소매: number };
const rows: { id: string; r: number; th: number; inK: boolean; capw: number }[] = [];
for (const c of cells()) {
  let rec: R | null = null;
  (globalThis as unknown as { __v3gapProbe?: (x: unknown) => void }).__v3gapProbe = (x) => { if (!rec) rec = x as R; };
  try { prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: bodyOf(c.bodyId), minPairDistLite }); }
  catch { /* 던져도 계기는 받았다 */ }
  if (!rec) { rows.push({ id: c.id, r: NaN, th: NaN, inK: false, capw: NaN }); continue; }
  const q = rec as R;
  const r = q.SLV_R / q.RMIN_소매, th = 1 + SEP / (2 * q.CAP_W);
  rows.push({ id: c.id, r, th, inK: r < th, capw: q.CAP_W });
  process.stderr.write(`  ${c.id} r=${r.toFixed(6)} th=${th.toFixed(6)} ${r < th ? '★K' : ''}\n`);
}
const K = rows.filter((x) => x.inK);
console.log(`## ㉮ 물림 집합 K — 규칙 \`R/RMIN < 1 + SEP/(2·CAP_W)\`\n`);
console.log('| 칸 | R/RMIN | 문턱 1+SEP/(2·CAP_W) | CAP_W(cm) | K |');
console.log('|---|---|---|---|---|');
for (const x of rows.filter((y) => Number.isFinite(y.r)).sort((a, b) => a.r - b.r).slice(0, 14))
  console.log(`| \`${x.id}\` | ${x.r.toFixed(6)} | ${x.th.toFixed(6)} | ${(x.capw * 100).toFixed(2)} | ${x.inK ? '**★**' : ''} |`);
console.log(`\n**|K| = ${K.length}** · 계기 미발화 ${rows.filter((x) => !Number.isFinite(x.r)).length}칸`);
console.log('K = ' + K.map((x) => `\`${x.id}\``).join(' · '));
