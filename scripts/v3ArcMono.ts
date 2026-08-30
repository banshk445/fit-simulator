/* v3-91 §1-②③ — bb 호 사상 «단조성» · fb δ 자유도(사실만 · 처방 0).
 * ② 최소쌍 «행»을 3D 로 걸으며 걸음 길이·꺾임각·비인접 최소거리를 낸다(코드 변경 0).
 * ③ 클램프 계기가 실은 `base(δ+1·2·5mm)` 를 δ 반응으로 낸다(인쇄 전용).
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
type Rec = { pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };
type CR = { k: number; need: number; base: number; ratio: number; delta: number;
            base_d1: number; base_d2: number; base_d5: number };
const BB = ['c122.5-h170-s50_M','c122.5-h155-s50_S','c122.5-h155-s45_S','c122.5-h185-s45_XL',
            'c87.5-h185-s40_S','c87.5-h185-s40_XL','c87.5-h170-s40_S'];
const FB = ['c122.5-h170-s45_S','c122.5-h155-s50_L'];
const CTRL = ['c100-h170-s45_M','c122.5-h170-s50_L'];

function run(id: string) {
  const c = cells().find((x) => x.id === id)!;
  const b = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  let rec: Rec | null = null; let batch: CR[] = [];
  (globalThis as unknown as { __v3gapProbe?: (x: unknown) => void }).__v3gapProbe = (x) => {
    if (!rec) { const q = x as Rec; rec = { pos: Float64Array.from(q.pos), tris: [...q.tris], panels: q.panels, n: q.n }; }
  };
  (globalThis as unknown as { __v3clampProbe?: (r: CR) => void }).__v3clampProbe = (r) => { if (r.k === 0) batch = []; batch.push(r); };
  try { prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts, minPairDistLite }); } catch { /* 던짐 정상 */ }
  return { rec: rec as Rec | null, batch };
}
console.log('## ② bb 7칸 — 최소쌍 «행»을 3D 로 걷는다\n');
console.log('| 칸 | 행 j | 걸음 수 | 걸음 길이(mm) 최소~최대 | **꺾임각 최대(°)** | 비인접 최소(mm) | 그 자리 i | 부호 반전 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const id of BB) {
  const { rec } = run(id);
  if (!rec) { console.log(`| \`${id}\` | 계기 미발화 | | | | | | |`); continue; }
  const r = rec;
  const w = minPairDist(r.pos, r.tris, 0.004);
  const bases = r.panels.map((p) => p.base).concat([r.n]);
  const pi = (() => { const v = r.tris[w.worst[0] * 3]; for (let k = 0; k < r.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return k; return -1; })();
  const lo = bases[pi], hi = bases[pi + 1];
  const diffs = new Set<number>();
  for (let t = 0; t < r.tris.length; t += 3) {
    const v = [r.tris[t], r.tris[t + 1], r.tris[t + 2]];
    if (v.some((x) => x < lo || x >= hi)) continue;
    for (let a = 0; a < 3; a++) for (let b2 = a + 1; b2 < 3; b2++) { const d2 = Math.abs(v[a] - v[b2]); if (d2 > 1) diffs.add(d2); }
  }
  const stride = [...diffs].sort((a, b2) => a - b2)[0];
  const j = Math.floor((r.tris[w.worst[0] * 3] - lo) / stride);
  const P = (i: number) => { const v = lo + j * stride + i; return [r.pos[v * 3], r.pos[v * 3 + 1], r.pos[v * 3 + 2]]; };
  const nu = stride - 1;
  const step: number[] = [], ang: number[] = [];
  for (let i = 0; i + 1 <= nu; i++) {
    const a = P(i), b2 = P(i + 1);
    step.push(Math.hypot(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]));
  }
  for (let i = 1; i + 1 <= nu; i++) {
    const a = P(i - 1), b2 = P(i), c2 = P(i + 1);
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], v2 = [c2[0] - b2[0], c2[1] - b2[1], c2[2] - b2[2]];
    const nu2 = Math.hypot(...u as [number, number, number]), nv = Math.hypot(...v2 as [number, number, number]);
    const cs = (u[0] * v2[0] + u[1] * v2[1] + u[2] * v2[2]) / (nu2 * nv || 1);
    ang.push(Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI);
  }
  let mn = Infinity, at = -1;
  for (let i = 0; i <= nu; i++) for (let i2 = i + 2; i2 <= nu; i2++) {
    const a = P(i), b2 = P(i2);
    const d2 = Math.hypot(b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]);
    if (d2 < mn) { mn = d2; at = i; }
  }
  const rev = ang.filter((x) => x > 90).length;
  console.log(`| \`${id}\` | ${j} | ${nu} | ${(Math.min(...step) * 1000).toFixed(2)}~${(Math.max(...step) * 1000).toFixed(2)}`
    + ` | **${Math.max(...ang).toFixed(1)}** | ${(mn * 1000).toPrecision(4)} | ${at} | ${rev > 0 ? `**${rev}회(>90°)**` : '0'} |`);
}
console.log('\n## ③ δ 자유도 — 호 길이의 δ 반응(인쇄 계기)\n');
console.log('| 칸 | 군 | 그 자리 δ(mm) | need(cm) | base(cm) | ratio | base(δ+1) | base(δ+2) | base(δ+5) | dPerim/dδ | ratio<1 까지 필요한 δ(mm) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [grp, list] of [['fb', FB], ['편입', CTRL]] as [string, string[]][])
  for (const id of list) {
    const { batch } = run(id);
    if (!batch.length) { console.log(`| \`${id}\` | ${grp} | 계기 미발화 | | | | | | | | |`); continue; }
    const worst = batch.reduce((a, b2) => (b2.ratio > a.ratio ? b2 : a), batch[0]);   // ratio 가장 큰 높이
    const dP = (worst.base_d5 - worst.base) / 0.005;
    const needDelta = (worst.need - worst.base) / dP;
    console.log(`| \`${id}\` | ${grp} | ${(worst.delta * 1000).toFixed(3)} | ${(worst.need * 100).toFixed(2)} | ${(worst.base * 100).toFixed(2)}`
      + ` | **${worst.ratio.toFixed(4)}** | ${(worst.base_d1 * 100).toFixed(2)} | ${(worst.base_d2 * 100).toFixed(2)} | ${(worst.base_d5 * 100).toFixed(2)}`
      + ` | ${dP.toFixed(3)} | **${(needDelta * 1000).toFixed(1)}** |`);
  }
console.log(`\n(SEP = ${(SEP * 1000).toFixed(1)}mm)`);
