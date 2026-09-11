/* v5-12 §0-4ㅂ — **조립 sha 표**(측정만 · 조립을 «메모리에서» 해시한다 · 파일 0개).
 *
 * 왜 파일이 아니라 메모리인가 — `v4AsmExport.ts` 로 137칸을 내보내면 5파일 × 137 이 생긴다.
 * 해시 대상은 **조립 산출 배열 자체**이므로 `prepare()` 를 부르고 그 배열을 그대로 해시하면
 * **같은 것을 더 적은 비용으로** 잰다(새 식 0 · 조립 코드 0줄).
 *
 * 해시에 넣는 것(순서 고정) — `n` · `substeps` · `pos`(f64 3n) · `uv`(f64 2n) · `tris`(i32) ·
 *   `cons` 를 종류별로(`inplane` → `bend` → `dist`) 각 `i,j,…` 와 파라미터.
 *   ⟹ `v4AsmExport.ts:62-137` 이 파일에 쓰는 것과 **같은 집합**이다.
 *
 * 진입: `MODE=tpose|apose [ASM2=1] npx tsx scripts/v5AsmSha.ts > 표.tsv`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const MODE = process.env.MODE ?? 'tpose';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ASM2 = process.env.ASM2 === '1';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

const LIST: { cell: string; bodyBin: string; apose: boolean }[] = [];
if (MODE === 'tpose') {
  for (const c of cells()) LIST.push({ cell: c.id, bodyBin: `public/v3diag/v3-77/body-${c.bodyId}.bin`, apose: false });
} else {
  const pv = JSON.parse(readFileSync('public/v3diag/v4-a35/v1-provide.json', 'utf8')) as { provide: string[] };
  for (const id of pv.provide) {
    const bodyId = id.replace(/_[^_]+$/, '');
    LIST.push({ cell: id, bodyBin: `gpu/oracle/export/grid27/l3ap-body-${bodyId}-a35.bin`, apose: true });
  }
}

console.log(`# v5-12 조립 sha 표 · MODE=${MODE} · ASM2=${ASM2 ? 1 : 0} · 칸 ${LIST.length} · D_MM=${D * 1000}`);
for (const { cell, bodyBin, apose } of LIST) {
  const c = cells().find((x) => x.id === cell)!;
  const bb = readFileSync(bodyBin);
  /* ★ A포즈 칸은 **칸마다 몸이 다르므로 팔 축·원점도 그 몸의 것**이어야 한다.
   * 읽는 자리는 `armAxisFromEnv` 한 곳으로 유지하고(v4-25 §1-② 규약) env 를 칸마다 채운다. */
  if (apose) {
    const bodyId = cell.replace(/_[^_]+$/, '');
    process.env.ARM_AXIS_JSON = `gpu/oracle/export/grid27/l3ap-body-${bodyId}-a35.json`;
    process.env.ARM_ORIGIN_JSON = `gpu/oracle/export/grid27/l3ap-origin-${bodyId}-a35.json`;
  }
  const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, ...(apose ? { armAxis: armAxisFromEnv() } : {}),
    ...(ASM2 ? { asm2: true } : {}) } as never);
  const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float64Array; tris: number[];
    cons: Record<string, number | string>[] };
  const h = createHash('sha256');
  h.update(`n=${sc.n};sub=${(P as unknown as { SUB: number }).SUB};`);
  h.update(Buffer.from(Float64Array.from(sc.s.pos.subarray(0, sc.n * 3)).buffer));
  h.update(Buffer.from(Float64Array.from(sc.uv).buffer));
  h.update(Buffer.from(Int32Array.from(sc.tris).buffer));
  for (const kind of ['inplane', 'bend', 'dist']) {
    const rows = sc.cons.filter((x) => x.kind === kind);
    h.update(`${kind}=${rows.length};`);
    const nums: number[] = [];
    for (const r of rows) for (const k of Object.keys(r).sort()) {
      const v = r[k]; if (typeof v === 'number') nums.push(v);
    }
    h.update(Buffer.from(Float64Array.from(nums).buffer));
  }
  console.log(`${cell}\t${sc.n}\t${h.digest('hex')}`);
}
