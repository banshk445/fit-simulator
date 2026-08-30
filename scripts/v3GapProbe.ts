/* v3-86 §1-③ — **옆 틈 G 탐색 계측**(조립까지만 · **물리 0프레임 · 저장 0**).
 * 8회 각 회차의 `GAP_SIDE`·측정 최소쌍거리·기준값을 찍고, 실패 시 «같은 자리»의
 * 실제 몸↔옷 거리를 **SDF 로 독립 계측**한다. 판정·문턱·처방 0 — 값만 낸다.
 * 진입: `CELL=c87.5-h155-s40_XL npx tsx scripts/v3GapProbe.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const CELL = process.env.CELL ?? 'c87.5-h155-s40_XL';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`모르는 칸: ${CELL}`);
const glbBuf = readFileSync('public/models/mannequin.glb');
const glb = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer;
const bb = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

const log: Record<string, number>[] = [];
(globalThis as unknown as { __v3gapProbe?: (r: Record<string, number>) => void }).__v3gapProbe =
  (r) => log.push(r);

console.log(`── 옆 틈 G 계측 — ${CELL} (몸 ${c.bodyId} · ${c.size}) ──`);
let err: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                bodyVerts: verts, minPairDistLite });
} catch (e) { err = (e as Error).message; }

console.log(`  결과: ${err ? `**던짐** — ${err}` : '조립 성립'}`);
console.log(`  회차 ${log.length}회`);
console.log('| 회차 | GAP_SIDE(mm) | 측정 최소쌍거리(mm) | 기준(mm) | 부족분(mm) | DELTA(mm) |');
console.log('|---|---|---|---|---|---|');
for (const r of log)
  console.log(`| ${r.회차} | ${(r.GAP_SIDE * 1000).toFixed(3)} | ${(r.측정_최소쌍거리_m * 1000).toFixed(4)}`
    + ` | ${(r.기준_need_m * 1000).toFixed(3)} | ${((r.기준_need_m - r.측정_최소쌍거리_m) * 1000).toFixed(4)}`
    + ` | ${(r.DELTA * 1000).toFixed(3)} |`);

if (log.length) {
  const first = log[0], last = log[log.length - 1];
  console.log(`\n  GAP_SIDE ${(first.GAP_SIDE * 1000).toFixed(3)} → ${(last.GAP_SIDE * 1000).toFixed(3)}mm`
    + ` (×${(last.GAP_SIDE / first.GAP_SIDE).toFixed(2)})`);
  console.log(`  최소쌍거리 ${(first.측정_최소쌍거리_m * 1000).toFixed(4)} → ${(last.측정_최소쌍거리_m * 1000).toFixed(4)}mm`
    + ` (변화 ${((last.측정_최소쌍거리_m - first.측정_최소쌍거리_m) * 1000).toFixed(4)}mm)`);
}
/* 성립한 칸이면 몸↔옷 실제 거리도 독립 계측(대조군용) */
if (P) {
  const p = P as unknown as { sc: { s: { pos: Float64Array }; n: number }; bext: number[] };
  console.log(`\n  조립 성립 — 정점 ${p.sc.n} · BEXT [${p.bext.map((v) => v.toFixed(4)).join(', ')}]m`);
}
