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
console.log(JSON.stringify({ 축: ax ?? '(기본 +x)', PLACE_SIG: P.S.PLACE_SIG, n: P.sc.n,
  제약: P.sc.cons.length, substeps: P.SUB, RAMP_N: P.RAMP_N,
  '옷↔몸 최소간격mm': null }, null, 1));
