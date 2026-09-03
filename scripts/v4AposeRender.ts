/* v4-24 §1-③ — **A포즈 산출 오프스크린 렌더**(앞·옆 2장). 물리 0줄 · 판정 0.
 *
 * 부르는 것만 있다(새 계산 0):
 *   `src/v3/raster.ts` render/VIEWS  ← v3 하네스 렌더러(정사영 · z버퍼 · 평면 음영)
 *   `scripts/v3Render.ts` writePng
 *   `src/v3/dressRun.ts` prepare      ← 몸 위상·옷 삼각형을 얻는 자리(물리 0프레임 · 읽기만)
 * 위치는 `POS`(float64 3n) 로 갈아 끼운다 — `v4FitReport.ts` 와 같은 규약이다.
 *
 * 진입: `CELL=… BODY_BIN=… POS=… OUT=docs/v4/캡처/24 npx tsx scripts/v4AposeRender.ts`
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { render, VIEWS } from '../src/v3/raster.ts';
import { writePng } from './v3Render.ts';

const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const OUT = process.env.OUT ?? 'docs/v4/캡처/24';
const D = Number(process.env.D_MM ?? 9) / 1000;
const W = Number(process.env.W ?? 900), H = Number(process.env.H ?? 1200);
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const n = P.sc.n;
let pos: Float64Array;
if (process.env.POS) {
  const pb = readFileSync(process.env.POS);
  pos = new Float64Array(pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength)).slice(0, n * 3);
  if (pos.length !== n * 3) throw new Error(`POS 정점 수가 다르다 — ${pos.length / 3} ≠ ${n}`);
} else pos = Float64Array.from(P.sc.s.pos);

const BODY_COL: [number, number, number] = [176, 176, 184];
const CLOTH_COL: [number, number, number] = [70, 120, 200];
const meshes = [{ pos: P.prim0.pos, idx: P.bodyIdx, color: BODY_COL },
                { pos, idx: P.sc.tris, color: CLOTH_COL }];
/* 경계 = 두 메시 전체(옷이 잘리지 않게) */
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const m of meshes)
  for (let i = 0; i < m.pos.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
const bounds = { lo: lo as [number, number, number], hi: hi as [number, number, number] };
mkdirSync(dirname(`${OUT}-x.png`), { recursive: true });
for (const [file, name] of [['1-front', 'front'], ['2-side', 'sideXplus']] as const) {
  const view = VIEWS.find((v) => v.name === name)!;
  writePng(`${OUT}-${file}.png`, W, H, render(meshes as never, view, bounds, W, H));
  console.log(`  → ${OUT}-${file}.png (${name})`);
}
console.log(JSON.stringify({ cell: CELL, bodyBin: bbPath, pos: process.env.POS ?? '(조립 직후)', n,
  경계: bounds }, null, 1));
