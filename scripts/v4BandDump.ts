/* v4-16 §1-①ㄱㄷ — **리포트 5행의 «정의역 정점 집합»을 그대로 낸다**(물리 0프레임 · `src/` 0줄).
 *
 * 집합의 식은 `src/v3/fitReport.ts:77-92` 를 **그대로 인용**한다(새 수 0):
 * ```
 *  목선 = P.neckF ∪ P.neckB                           (`:78`)
 *  가슴 = 몸통 패널 중 |y − chestY| ≤ d               (`:80-86` bandOf · d = 9mm)
 *  허리 = 몸통 패널 중 |y − waistY| ≤ d
 *  밑단 = 앞판 j=0 ∪ 뒤판 j=0                          (`:88`)
 *  소매 = 소매 패널 전량                                (`:90-91`)
 * ```
 * ★ **밴드는 «현재 위치»로 정해진다**(`pos[v*3+1]`) ⟹ 상태가 바뀌면 «집합»이 바뀔 수 있다.
 *   그 자리를 재는 것이 이 계기다. 높이(chestY·waistY)는 `deriveLevels(P.prim0.pos, …)` 로
 *   **정지 기준 메시**에서 뜨므로 상태와 무관하다(`v4FitReport.ts` 와 같은 호출).
 *
 * 진입: `CELL=… [POS=…] TAG=… npx tsx scripts/v4BandDump.ts`   (POS 없으면 정본 blob)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { deriveLevels } from '../src/v3/bodyLevels.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const POS = process.env.POS ?? null;
const TAG = process.env.TAG ?? (POS ? 'pos' : 'v3정본');
const D = Number(process.env.D_MM ?? 9) / 1000;

const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc;
const n = sc.n;

let pos: Float64Array;
if (POS) {
  const b = readFileSync(POS);
  pos = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 0, n * 3);
} else {
  const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  pos = new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + n * 3 * 8));
}
sc.s.pos.set(pos);
const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);

const torsoPanels = [sc.front, sc.back];
const bandOf = (cy: number): number[] => {                       // fitReport.ts:80-86 그대로
  const out: number[] = [];
  for (const p of torsoPanels)
    for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++)
      if (Math.abs(pos[v * 3 + 1] - cy) <= D) out.push(v);
  return out;
};
const neck = [...P.neckF, ...P.neckB];
const hem = torsoPanels.flatMap((p) => Array.from({ length: sc.nuB + 1 }, (_, i) => P.S.at(p, i, 0)));
const sleeve: number[] = [];
for (const p of sc.slv) for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++) sleeve.push(v);

const rows = { 목선: neck, 가슴: bandOf(L.chestY), 허리: bandOf(L.waistY), 밑단: hem, 소매: sleeve };
const meta = { what: 'v4-16 §1-①ㄱㄷ 리포트 5행 정의역 정점 집합', cell: CELL, tag: TAG, n,
  dMm: D * 1000, chestYCm: L.chestY * 100, waistYCm: L.waistY * 100,
  크기: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])),
  정점: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v])) };
writeFileSync(`${OUT}/l3rp-band-${CELL}-${TAG}.json`, JSON.stringify(meta));
console.log(`[밴드 · ${CELL} · ${TAG}] ` + Object.entries(meta.크기).map(([k, v]) => `${k} ${v}`).join(' · ')
            + ` · chestY ${meta.chestYCm.toFixed(2)}cm · waistY ${meta.waistYCm.toFixed(2)}cm`);
