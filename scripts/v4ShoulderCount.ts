/* v4-51 §1-② — **「어깨선 위 옷 정점 수」**를 편입 칸 전부에 낸다(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * 정의는 **v4-30 계기 그대로**다 — `gpu/bake/slip_probe.py:58` 「`(p[:,1] > Y_TOP).sum()`」 ·
 * `Y_TOP` 은 그 칸 장면의 어깨선 높이(세계 m · `scripts/v4SlipIdx.ts:45` 와 같은 출처 `P.S.Y_TOP`).
 * 위치는 제품이 읽는 **주입 blob**(`public/v3diag/v4-a35/settled-<칸>.bin` · 헤더 뒤 위치 블록)에서 읽는다
 * ⟹ 「화면이 보는 그 상태」와 같은 바이트다. **새 정의·새 문턱 0.**
 *
 * 진입: `[ASSET=public/v3diag/v4-a35] npx tsx scripts/v4ShoulderCount.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const ASSET = process.env.ASSET ?? 'public/v3diag/v4-a35';
const D = Number(process.env.D_MM ?? 9) / 1000;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const prov = JSON.parse(readFileSync(`${ASSET}/v1-provide.json`, 'utf8')) as { provide: string[] };

const rows = prov.provide.map((cell) => {
  const bodyId = cell.replace(/_[^_]+$/, '');
  const size = cell.slice(bodyId.length + 1) as Size;
  const c = cells().find((x) => x.id === cell);
  const bb = readFileSync(`${ASSET}/body-${bodyId}.bin`);
  const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(size),
                      bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                      minPairDistLite });
  const S = P.S as unknown as { Y_TOP: number; Y_HEM: number };
  const raw = readFileSync(`${ASSET}/settled-${cell}.bin`);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  const n = (JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl))) as { n: number }).n;
  const pos = new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + n * 24));
  let above = 0, ymax = -Infinity, ymin = Infinity;
  for (let i = 1; i < pos.length; i += 3) {
    if (pos[i] > S.Y_TOP) above++;
    if (pos[i] > ymax) ymax = pos[i];
    if (pos[i] < ymin) ymin = pos[i];
  }
  return { cell, size, n, 'Y_TOP m': S.Y_TOP, 어깨선위정점: above, 비: above / n,
           '옷 y최대 m': ymax, '옷 y최소 m': ymin, '옷 최고점 − 어깨선 mm': (ymax - S.Y_TOP) * 1000,
           bodyOk: !!c };
});
rows.sort((a, b) => a.어깨선위정점 - b.어깨선위정점);
const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const A = rows.map((r) => r.어깨선위정점);
const out = { what: 'v4-51 §1-② 어깨선 위 옷 정점 수(v4-30 정의 그대로 · 측정만)', asset: ASSET,
              칸: rows.length, 분포: { 최소: q(A, 0), p25: q(A, 0.25), 중앙: q(A, 0.5), p75: q(A, 0.75), 최대: q(A, 1) },
              '0인 칸': A.filter((x) => x === 0).length, rows };
writeFileSync('gpu/oracle/export/l3ap-shoulder-v4-51.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: rows.slice(0, 8).map((r) => ({ cell: r.cell, 위: r.어깨선위정점, n: r.n })) }, null, 0));
