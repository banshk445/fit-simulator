/* v4-18 §1-③ 회귀 — **T포즈 108칸 조립 «드라이런»**(굽기 0 · 물리 0프레임).
 *
 * 칸마다 `prepare()` 로 조립만 하고 **정점 좌표와 패턴을 해시**한다. 팔 축 인자를 넣기 «전/후»의
 * 두 산출을 대조해 **비트 동일**을 본다(§0-5ㅂ). 몸 정점은 `body-<bodyId>.bin`(T포즈 정본)을 쓴다.
 *
 * 진입: `TAG=before npx tsx scripts/v4AssembleHash.ts`
 * 산출 = `gpu/oracle/export/l3asm-<TAG>.json` — 칸마다 {posSha, uvSha, n, m, sub}
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const TAG = process.env.TAG ?? 'x';
const D = Number(process.env.D_MM ?? 9) / 1000;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const sha = (b: ArrayBufferView) =>
  createHash('sha256').update(Buffer.from(b.buffer, b.byteOffset, b.byteLength)).digest('hex');

const rows: Array<Record<string, unknown>> = [];
const t0 = Date.now();
for (const c of cells()) {
  const bp = `${SRC}/body-${c.bodyId}.bin`;
  if (!existsSync(bp)) { rows.push({ cell: c.id, 상태: '몸 없음' }); continue; }
  const bb = readFileSync(bp);
  const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
  try {
    const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                        bodyVerts: verts, minPairDistLite });
    rows.push({ cell: c.id, 상태: 'ok', n: P.sc.n, m: P.sc.cons.length, sub: P.SUB,
                posSha: sha(P.sc.s.pos), uvSha: sha(P.sc.uv) });
  } catch (e) {
    rows.push({ cell: c.id, 상태: '던짐', err: String((e as Error).message).slice(0, 160) });
  }
  if (rows.length % 12 === 0) console.log(`  ${rows.length}/${cells().length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const ok = rows.filter((r) => r.상태 === 'ok').length;
const out = { what: 'v4-18 §1-③ T포즈 108칸 조립 해시', tag: TAG, 칸: rows.length, 조립성공: ok,
              ms: Date.now() - t0, rows };
writeFileSync(`${OUT}/l3asm-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(`[조립 해시 ${TAG}] 칸 ${rows.length} · 성공 ${ok} · ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}/l3asm-${TAG}.json`);
