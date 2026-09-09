import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync('gpu/oracle/export/grid27/l3ap-body-c100-h170-s45-a35.bin');
const P = prepare({ glb, fabric: FABRICS.gray, d: 0.009, garment: patternOfSpecName(process.env.SPEC ?? 'supima-L'),
  bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)), minPairDistLite });
const yTop = (P.S as unknown as { Y_TOP: number }).Y_TOP;
const raw = readFileSync(process.env.POS ?? 'gpu/bake/results/v5-2-supima/supimaL_L.bin');
const pos = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
let above = 0, ymax = -Infinity;
for (let i = 1; i < pos.length; i += 3) { if (pos[i] > yTop) above++; if (pos[i] > ymax) ymax = pos[i]; }
console.log(JSON.stringify({ n: pos.length / 3, Y_TOP: yTop, 어깨선위정점: above, 문턱: 172,
  통과: above >= 172, '옷 최고점−어깨선 mm': (ymax - yTop) * 1000 }));
