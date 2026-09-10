/* v3-88 §1-⑤ — **fb 7 · bb 6 조사**(사실만 · 처방 0 · 코드 변경 0).
 * 최소쌍 두 삼각형의 «부위»를 좌표로 낸다: y 높이(밑단 Y_HEM ~ 목선 Y_TOP 상대 위치) ·
 * |x|(중앙↔옆선) · z 부호(앞/뒤). 진입: `npx tsx scripts/v3FbBb.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
type Rec = { 회차: number; GAP_SIDE: number; 측정_최소쌍거리_m: number; pos: Float64Array; tris: number[];
             panels: { name: string; base: number }[]; n: number; DELTA: number };
const A = JSON.parse(readFileSync('public/v3diag/v3-77/index-merged-108.v3-85.json', 'utf8')) as Record<string, { reason?: string }>;
const gapCells = Object.keys(A).filter((k) => (A[k].reason ?? '').includes('옆 틈'));

console.log('| 칸 | 패널 쌍 | 최소쌍(mm) | δ(mm) | y 상대(0=밑단,1=목선) | |x|(cm) | z(cm) |');
console.log('|---|---|---|---|---|---|---|');
for (const id of gapCells) {
  const c = cells().find((x) => x.id === id)!;
  const b = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const log: Rec[] = [];
  (globalThis as unknown as { __v3gapProbe?: (r: unknown) => void }).__v3gapProbe = (r) => {
    const q = r as Rec; if (!log.length) log.push({ ...q, pos: Float64Array.from(q.pos), tris: [...q.tris] });
  };
  try { prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts, minPairDistLite }); }
  catch { /* 던지는 것이 정상 — 계기는 이미 받았다 */ }
  if (!log.length) { console.log(`| \`${id}\` | 계기 미발화 | | | | | |`); continue; }
  const r = log[0];
  const w = minPairDist(r.pos, r.tris, 0.004).worst;
  const bases = r.panels.map((p) => p.base).concat([r.n]);
  const nameOf = (v: number) => { for (let k = 0; k < r.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return r.panels[k].name; return '?'; };
  const pn = (t: number) => [...new Set([0, 1, 2].map((k) => nameOf(r.tris[t * 3 + k])))].join('+');
  const vs = [0, 1, 2].flatMap((k) => [r.tris[w[0] * 3 + k], r.tris[w[1] * 3 + k]]);
  const ys = vs.map((v) => r.pos[v * 3 + 1]), xs = vs.map((v) => Math.abs(r.pos[v * 3])), zs = vs.map((v) => r.pos[v * 3 + 2]);
  /* y 상대 위치 — 옷 전체 y 범위로 정규화(새 상수 0 · 그 조립에서 뜬다) */
  let yl = Infinity, yh = -Infinity;
  for (let i = 1; i < r.pos.length; i += 3) { if (r.pos[i] < yl) yl = r.pos[i]; if (r.pos[i] > yh) yh = r.pos[i]; }
  const rel = (y: number) => (y - yl) / (yh - yl);
  const m0 = minPairDist(r.pos, r.tris, 0.004).min;
  console.log(`| \`${id}\` | **${pn(w[0])}↔${pn(w[1])}** | ${(m0 * 1000).toPrecision(4)} | ${(r.DELTA * 1000).toFixed(3)}`
    + ` | ${rel(Math.min(...ys)).toFixed(3)}~${rel(Math.max(...ys)).toFixed(3)}`
    + ` | ${(Math.min(...xs) * 100).toFixed(2)}~${(Math.max(...xs) * 100).toFixed(2)}`
    + ` | ${(Math.min(...zs) * 100).toFixed(2)}~${(Math.max(...zs) * 100).toFixed(2)} |`);
}
