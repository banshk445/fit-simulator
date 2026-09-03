import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';
const c = cells().find((x) => x.id === (process.env.CELL ?? 'c100-h170-s45_M'))!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN!);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const ax = armAxisFromEnv();
const P = prepare({ glb, fabric: FABRICS.gray, d: 0.009, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite, armAxis: ax });
type Pan = { base: number; nu: number; nv: number; name: string };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; panels: Pan[]; uv: Float64Array };
const pos = sc.s.pos;
const out: Record<string, unknown>[] = [];
for (const p of sc.panels) {
  const end = p.base + (p.nu + 1) * (p.nv + 1);
  let bad = 0, first = -1, firstIJ: [number, number] | null = null;
  for (let v = p.base; v < end; v++) {
    const nan = !Number.isFinite(pos[v * 3]) || !Number.isFinite(pos[v * 3 + 1]) || !Number.isFinite(pos[v * 3 + 2]);
    if (nan) { bad++; if (first < 0) { first = v; const k = v - p.base; firstIJ = [k % (p.nu + 1), Math.floor(k / (p.nu + 1))]; } }
  }
  let uvBad = 0;
  for (let v = p.base; v < end; v++)
    if (!Number.isFinite(sc.uv[v * 2]) || !Number.isFinite(sc.uv[v * 2 + 1])) uvBad++;
  out.push({ 패널: p.name, 정점: end - p.base, nu: p.nu, nv: p.nv, 'pos NaN': bad, 'uv NaN': uvBad,
             첫NaN정점: first, '첫NaN(i,j)': firstIJ,
             'uv 표본': [sc.uv[p.base * 2], sc.uv[p.base * 2 + 1]] });
}
console.log(JSON.stringify({ 축: ax ?? '(기본 +x)', PLACE_SIG: P.S.PLACE_SIG, n: sc.n,
  'NaN 총계': out.reduce((a, r) => a + (r.NaN as number), 0), 패널별: out }, null, 1));
