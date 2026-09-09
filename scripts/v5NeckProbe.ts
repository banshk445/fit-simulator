/* v5-4 §1-① — **목선의 «패턴 값 ↔ 정착 후 값»과 링이 앉은 자리**(측정만 · `src/` 0줄 · 굽기 0).
 *
 * 재는 것 — 패턴: `NECK_A`·`NECK_G`(`garmentScene.ts:237·239` · 몸의 목 밑동 링에서 온다) ·
 *          정착 후: 목선 링 정점(`prepare` 가 돌려주는 `neckF`·`neckB`)의 **둘레·중심 y·최저 y** ·
 *          어깨선 `Y_TOP` 과의 차 · 몸 어깨너비 대비 옷 어깨너비.
 * 진입: `SPEC=<이름>|SIZE=<S|M|L|XL> POS=<정착 bin> BODY_BIN=<몸> npx tsx scripts/v5NeckProbe.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';

const SPEC = process.env.SPEC;
const SIZE = (process.env.SIZE ?? 'M') as Size;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? 'public/v3diag/v3-77/body-c100-h170-s45.bin');
const garment = SPEC ? patternOfSpecName(SPEC) : garmentOf(SIZE);
const P = prepare({ glb, fabric: FABRICS.gray, d: 0.009, garment,
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite });
const S = P.S as unknown as { NECK_A: number; NECK_G: number; Y_TOP: number; SW: number };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array } };
const ring = [...(P.neckF as number[]), ...[...(P.neckB as number[])].reverse()];

const posOf = (): Float64Array => {
  if (!process.env.POS) return sc.s.pos;                    // 조립 직후
  const b = readFileSync(process.env.POS);
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 0, sc.n * 3);
};
const p = posOf();
let peri = 0, ysum = 0, ymin = Infinity;
for (let k = 0; k < ring.length; k++) {
  const i = ring[k], j = ring[(k + 1) % ring.length];
  peri += Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  ysum += p[i * 3 + 1]; ymin = Math.min(ymin, p[i * 3 + 1]);
}
console.log(JSON.stringify({
  옷: SPEC ?? `차트 ${SIZE}`, 정점: sc.n, 상태: process.env.POS ? '정착' : '조립 직후',
  '패턴 NECK_A cm': S.NECK_A * 100, '패턴 NECK_G cm': S.NECK_G * 100,
  '링 정점': ring.length, '링 둘레 cm': peri * 100,
  '링 중심 y m': ysum / ring.length, '링 최저 y m': ymin,
  'Y_TOP m': S.Y_TOP, '링 중심 − 어깨선 mm': (ysum / ring.length - S.Y_TOP) * 1000,
  '옷 어깨너비 cm': garment.SW * 100,
}, null, 0));
