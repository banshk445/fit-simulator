/* v4-30 §1-① — **정점 집합을 씬에서 «내보낸다»**(계기 · 물리 0줄 · 굽기 0 · 손 상수 0).
 *
 * 파이썬 계기(`gpu/bake/slip_probe.py`)가 프레임마다 잴 채널의 «대상»을 여기서 정한다:
 *   목선 링   = `dressRun.ts:153-154` 의 `neckF` · `neckB`(그 줄 그대로)
 *   어깨 봉제 = `garmentScene.ts:834-835` 의 이음선 「어깨L」·「어깨R」 정점(a ∪ b)
 *   소매 좌·우 = 패널 `slv[0]`(R) · `slv[1]`(L) 의 연속 인덱스 구간
 *   몸통      = `front`·`back` 패널 구간
 * 진입: `CELL=… [BODY_BIN=…] [ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…] TAG=… npx tsx scripts/v4SlipIdx.ts`
 * 산출 = `gpu/oracle/export/l3slip-idx-<TAG>.json`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite, armAxis: armAxisFromEnv() });

type Pan = { base: number; nu: number; nv: number; name: string };
const sc = P.sc as unknown as { n: number; front: Pan; back: Pan; slv: Pan[];
                                seams: { name: string; a: number[]; b: number[] }[] };
const range = (p: Pan) => ({ from: p.base, to: p.base + (p.nu + 1) * (p.nv + 1) });
const seam = (nm: string) => {
  const s = sc.seams.find((x) => x.name === nm);
  if (!s) throw new Error(`이음선 ${nm} 이 없다 — ${sc.seams.map((x) => x.name).join(',')}`);
  return [...s.a, ...s.b];
};
const S = P.S as unknown as { Y_TOP: number; Y_HEM: number; PLACE_SIG: string };
const out = {
  what: 'v4-30 §1-① 계기 대상 정점 집합(씬에서 내보냄 · 손 상수 0)',
  cell: CELL, tag: TAG, bodyBin: bbPath, n: sc.n, PLACE_SIG: S.PLACE_SIG,
  'Y_TOP(어깨선 높이 · 세계 m)': S.Y_TOP, 'Y_HEM(밑단 · 세계 m)': S.Y_HEM,
  목선링: [...P.neckF, ...P.neckB],
  어깨봉제: { 어깨L: seam('어깨L'), 어깨R: seam('어깨R') },
  패널: { front: range(sc.front), back: range(sc.back),
         sleeveR: range(sc.slv[0]), sleeveL: range(sc.slv[1]) },
};
writeFileSync(`${OUT}/l3slip-idx-${TAG}.json`, JSON.stringify(out));
console.log(JSON.stringify({ ...out, 목선링: `${out.목선링.length}개`,
  어깨봉제: { 어깨L: `${out.어깨봉제.어깨L.length}개`, 어깨R: `${out.어깨봉제.어깨R.length}개` } }, null, 1));
