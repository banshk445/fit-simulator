/* v3-88 §0-4 B — 해시 변동의 «규모»를 재기 위한 임시 덤프(판정 0 · 저장은 /tmp). */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
const OUT = process.env.OUT!;
const LIST = (process.env.CELLS ?? 'c87.5-h155-s45_M,c100-h170-s45_M,c122.5-h185-s50_XL').split(',');
const out: Record<string, number[]> = {};
for (const id of LIST) {
  const c = cells().find((x) => x.id === id)!;
  const b = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  try {
    const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts, minPairDistLite });
    out[id] = Array.from((P as unknown as { sc: { s: { pos: Float64Array } } }).sc.s.pos);
  } catch { out[id] = []; }
}
writeFileSync(OUT, JSON.stringify(out));
console.log('덤프', Object.entries(out).map(([k, v]) => `${k}:${v.length / 3}`).join(' '));
