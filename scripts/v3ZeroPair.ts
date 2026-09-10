/* v3-87 §1-①②④ — **최소쌍거리 0 의 «정체»**. 조립까지만(물리 0 · 저장 0).
 * 회차 0 의 최소쌍 두 삼각형을 찾아 **패널 id · 삼각형 index · 여섯 정점 좌표 · 관계 · 몸 SDF** 를 낸다.
 * 판정·문턱·처방 0 — 값만 낸다.  진입: `npx tsx scripts/v3ZeroPair.ts [CELLS=a,b,...]`
 */
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist, triTriHit } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const D = Number(process.env.D_MM ?? 9) / 1000;
const glbBuf = readFileSync('public/models/mannequin.glb');
const glb = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer;
const bodyCache = new Map<string, Float32Array>();
const bodyOf = (bid: string) => {
  let v = bodyCache.get(bid);
  if (!v) { const b = readFileSync(`public/v3diag/v3-77/body-${bid}.bin`);
            v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); bodyCache.set(bid, v); }
  return v;
};

type Rec = { 회차: number; GAP_SIDE: number; 측정_최소쌍거리_m: number; pos: Float64Array; tris: number[];
             panels: { name: string; base: number }[]; n: number; SLV_R: number; CAP_W: number;
             RMIN_소매: number; 감김호_rad: number; sdf: (x: number, y: number, z: number) => number };

const ROWS: string[] = [];
function run(id: string) {
  const c = cells().find((x) => x.id === id)!;
  const log: Rec[] = [];
  (globalThis as unknown as { __v3gapProbe?: (r: unknown) => void }).__v3gapProbe = (r) => {
    const q = r as Rec;
    /* v3-87 §1-① — **8회 «전량»** 을 받는다(같은 쌍이 유지되는지 보려면 회차 0 만으론 부족하다). */
    log.push({ ...q, pos: Float64Array.from(q.pos), tris: [...q.tris] });
  };
  let threw = '';
  try {
    prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
              bodyVerts: bodyOf(c.bodyId), minPairDistLite });
  } catch (e) { threw = (e as Error).message; }
  if (!log.length) { ROWS.push(`| ${id} | — | 계기 미발화 | | | | |`); return; }
  const r = log[0];
  /* 8회 각 회차의 최소쌍 — 같은 쌍이 유지되는가 */
  const wsAll = log.map((q) => { const w2 = minPairDist(q.pos, q.tris, 0.004).worst; return `${w2[0]}/${w2[1]}`; });
  const persist = new Set(wsAll).size === 1 ? `동일(${wsAll.length}회)` : `${new Set(wsAll).size}종`;
  const mAll = log.map((q) => (q.측정_최소쌍거리_m * 1000));
  const w = minPairDist(r.pos, r.tris, 0.004).worst;      // window = SEP*2 (minPairDistLite 와 같은 값)
  const [i, j] = w;
  if (i < 0) { ROWS.push(`| ${id} | — | 최소쌍 없음 | | | | |`); return; }
  /* 정점 → 패널: base 오름차순 구간 */
  const bases = r.panels.map((p) => p.base).concat([r.n]);
  const panelOf = (v: number) => { for (let k = 0; k < r.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return r.panels[k].name; return '?'; };
  const A = [r.tris[i * 3], r.tris[i * 3 + 1], r.tris[i * 3 + 2]];
  const B = [r.tris[j * 3], r.tris[j * 3 + 1], r.tris[j * 3 + 2]];
  const pA = [...new Set(A.map(panelOf))].join('+'), pB = [...new Set(B.map(panelOf))].join('+');
  /* 관계 ㄱ~ㄹ */
  const P = (v: number) => [r.pos[v * 3], r.pos[v * 3 + 1], r.pos[v * 3 + 2]];
  const coordSame = A.every((a) => B.some((b) => { const u = P(a), v2 = P(b);
    return Math.abs(u[0] - v2[0]) < 1e-12 && Math.abs(u[1] - v2[1]) < 1e-12 && Math.abs(u[2] - v2[2]) < 1e-12; }));
  const hit = triTriHit(r.pos, A, B);
  const rel = coordSame ? 'ㄱ 정점 좌표 동일' : hit ? 'ㄴ 교차' : r.측정_최소쌍거리_m === 0 ? 'ㄷ 접촉' : 'ㄹ 그 외';
  /* 몸 SDF — 여섯 정점 */
  const sd = [...A, ...B].map((v) => { const q = P(v); return r.sdf(q[0], q[1], q[2]); });
  const inside = sd.filter((x) => x < 0).length;
  ROWS.push(`| \`${id}\` | ${(r.측정_최소쌍거리_m * 1000).toExponential(3)} | ${mAll[mAll.length - 1].toExponential(3)} | **${pA}** ↔ **${pB}** | ${rel} | ${persist} | ${inside}/6 | ${(Math.min(...sd) * 1000).toFixed(2)} | ${(r.SLV_R / r.RMIN_소매).toFixed(4)} | ${(r.감김호_rad / Math.PI).toFixed(4)}π |`);
  console.error(`  ${id} ${threw ? '던짐' : '성립'} · ${pA}↔${pB} · ${rel} · 몸안 ${inside}/6`);
}

const A=JSON.parse(readFileSync('public/v3diag/v3-77/index-merged-108.v3-85.json','utf8')) as Record<string,{reason?:string}>;
const gapCells = Object.keys(A).filter((k) => (A[k].reason ?? '').includes('옆 틈'));
const ctrl = ['c100-h170-s45_S','c100-h170-s45_M','c100-h170-s45_XL','c122.5-h170-s50_L','c122.5-h170-s50_XL'];
const LIST = process.env.CELLS ? process.env.CELLS.split(',') : [...gapCells, ...ctrl];
console.error(`── 대상 ${LIST.length}칸(옆 틈 ${gapCells.length} + 대조 ${ctrl.length}) ──`);
for (const id of LIST) run(id);
console.log('| 칸 | 회차0 최소쌍(mm) | 마지막(mm) | 패널 쌍 | 관계 | 8회 쌍 | 몸 안 | 몸 SDF(mm) | R/RMIN | 감김 호 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of ROWS) console.log(r);
