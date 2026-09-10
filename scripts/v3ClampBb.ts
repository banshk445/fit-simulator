/* v3-89 §1-④⑤ — ㉰ fb 클램프 발화 · ㉱ bb 자리(사실만 · 처방 0). */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
const D = 9 / 1000;
const g = readFileSync('public/models/mannequin.glb');
const glb = g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer;
const FB = ['c122.5-h170-s45_S','c122.5-h155-s50_L','c122.5-h155-s50_M','c122.5-h155-s45_M',
            'c122.5-h155-s40_XL','c100-h155-s40_M','c100-h155-s40_XL'];
const CTRL = ['c100-h170-s45_S','c100-h170-s45_M','c100-h170-s45_XL','c122.5-h170-s50_L','c122.5-h170-s50_XL'];
const BB = ['c122.5-h170-s50_M','c122.5-h155-s50_S','c122.5-h155-s45_S','c122.5-h185-s45_XL',
            'c87.5-h185-s40_S','c87.5-h185-s40_XL','c87.5-h155-s40_S','c87.5-h170-s40_S','c87.5-h170-s40_L'];
type CR = { k: number; need: number; base: number; ratio: number; GAP_SIDE: number; delta: number };
type Rec = { pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };

function run(id: string) {
  const c = cells().find((x) => x.id === id)!;
  const b = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  let batch: CR[] = [];
  (globalThis as unknown as { __v3clampProbe?: (r: CR) => void }).__v3clampProbe = (r) => {
    if (r.k === 0) batch = [];                       // 새 순회 시작
    batch.push(r);
  };
  const glog: Rec[] = [];
  (globalThis as unknown as { __v3gapProbe?: (r: unknown) => void }).__v3gapProbe = (r) => {
    const q = r as Rec; glog.push({ pos: Float64Array.from(q.pos), tris: [...q.tris], panels: q.panels, n: q.n });
  };
  let threw = '';
  try { prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts, minPairDistLite }); }
  catch (e) { threw = (e as Error).message; }
  return { id, threw, batch, glog };
}
console.log('## ㉰ fb 클램프 발화 — `Math.max(1, need/base)`\n');
console.log('| 칸 | 군 | 높이 표본 | 클램프 «발화»(ratio<1) | 비율 | ratio 범위 | need 범위(cm) | base 범위(cm) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [grp, list] of [['fb', FB], ['편입', CTRL]] as [string, string[]][])
  for (const id of list) {
    const { batch } = run(id);
    if (!batch.length) { console.log(`| \`${id}\` | ${grp} | 계기 미발화 | | | | | |`); continue; }
    const fire = batch.filter((r) => r.ratio < 1).length;
    const rs = batch.map((r) => r.ratio), ns = batch.map((r) => r.need * 100), bs = batch.map((r) => r.base * 100);
    console.log(`| \`${id}\` | ${grp} | ${batch.length} | **${fire}** | ${(fire / batch.length * 100).toFixed(1)}% |`
      + ` ${Math.min(...rs).toFixed(4)}~${Math.max(...rs).toFixed(4)} |`
      + ` ${Math.min(...ns).toFixed(2)}~${Math.max(...ns).toFixed(2)} | ${Math.min(...bs).toFixed(2)}~${Math.max(...bs).toFixed(2)} |`);
  }
console.log('\n## ㉱ bb 9칸 — 최소쌍 두 삼각형 자리\n');
console.log('| 칸 | 최소쌍(mm) | 패널 쌍 | y 상대 | \\|x\\|(cm) | z(cm) | 그 높이 need(cm) | base(cm) | ratio |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const id of BB) {
  const { batch, glog } = run(id);
  if (!glog.length) { console.log(`| \`${id}\` | 계기 미발화 | | | | | | | |`); continue; }
  const r = glog[0];
  const w = minPairDist(r.pos, r.tris, 0.004);
  const bases = r.panels.map((p) => p.base).concat([r.n]);
  const nameOf = (v: number) => { for (let k = 0; k < r.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return r.panels[k].name; return '?'; };
  const pn = (t: number) => [...new Set([0, 1, 2].map((k) => nameOf(r.tris[t * 3 + k])))].join('+');
  const vs = [0, 1, 2].flatMap((k) => [r.tris[w.worst[0] * 3 + k], r.tris[w.worst[1] * 3 + k]]);
  const ys = vs.map((v) => r.pos[v * 3 + 1]), xs = vs.map((v) => Math.abs(r.pos[v * 3])), zs = vs.map((v) => r.pos[v * 3 + 2]);
  let yl = Infinity, yh = -Infinity;
  for (let i = 1; i < r.pos.length; i += 3) { if (r.pos[i] < yl) yl = r.pos[i]; if (r.pos[i] > yh) yh = r.pos[i]; }
  const relLo = (Math.min(...ys) - yl) / (yh - yl), relHi = (Math.max(...ys) - yl) / (yh - yl);
  /* 그 높이대의 need/base — 클램프 표본 중 상대 높이가 가장 가까운 것 */
  const kk = Math.round(relLo * (batch.length - 1));
  const cr = batch[Math.max(0, Math.min(batch.length - 1, kk))];
  console.log(`| \`${id}\` | ${(w.min * 1000).toPrecision(4)} | **${pn(w.worst[0])}↔${pn(w.worst[1])}** |`
    + ` ${relLo.toFixed(3)}~${relHi.toFixed(3)} | ${(Math.min(...xs) * 100).toFixed(2)}~${(Math.max(...xs) * 100).toFixed(2)}`
    + ` | ${(Math.min(...zs) * 100).toFixed(2)}~${(Math.max(...zs) * 100).toFixed(2)}`
    + ` | ${cr ? (cr.need * 100).toFixed(2) : '—'} | ${cr ? (cr.base * 100).toFixed(2) : '—'} | ${cr ? cr.ratio.toFixed(4) : '—'} |`);
}
