/* v5-1 §1-②③ — **왕복 항등 + 조립 비트 대조**(측정만 · 기존 경로 호출 · 굽기 0).
 *
 * ② 왕복 — `garmentOf(size)`(현행) → `patternToSpec` → `specToPattern` → 복원 상수.
 *          **오차 0** 이어야 한다(항등 사상이면 그렇다 · §0-4ㄷ).
 * ③ 재현 — 복원 상수로 `prepare()` 를 돌려 조립 정점·UV 의 sha 를 현행과 맞댄다.
 *          몸은 **T포즈 기본 몸**을 쓴다(v4 자산·A포즈와 무관 · 조립만 본다).
 *
 * 진입: `npx tsx scripts/v5SpecRoundtrip.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, SIZES, type Size } from '../src/v3/grid.ts';
import { specToPattern, patternToSpec, TEE_TEMPLATE } from '../src/v5/specToPattern.ts';

const D = Number(process.env.D_MM ?? 9) / 1000;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const sha = (a: Float64Array | Float32Array) =>
  createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

const rows = SIZES.map((size: Size) => {
  const g = garmentOf(size);
  const spec = patternToSpec(g);
  const back = specToPattern(spec);
  const keys = ['L', 'W', 'SW', 'SLEN', 'ARM_G'] as const;
  const diff = Object.fromEntries(keys.map((k) => [k, back[k] - g[k]]));
  const maxAbs = Math.max(...keys.map((k) => Math.abs(back[k] - g[k])));

  /* ③ — 같은 몸·같은 원단·같은 d 로 조립만 두 번(현행 상수 ↔ 복원 상수). */
  const cell = cells().find((c) => c.size === size && c.bodyId === 'c100-h170-s45')!;
  const bb = readFileSync(`public/v3diag/v3-77/body-${cell.bodyId}.bin`);
  const bodyVerts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
  const mk = (garment: typeof g) => {
    const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment, bodyVerts, minPairDistLite });
    const S = P.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float32Array };
    return { n: S.n, pos: sha(S.s.pos), uv: S.uv ? sha(S.uv) : '(uv 없음)' };
  };
  const A = mk(g), B = mk(back);
  return { size, spec, 왕복차: diff, 왕복최대: maxAbs,
           현행: A, 복원: B, posSha동일: A.pos === B.pos, uvSha동일: A.uv === B.uv, n동일: A.n === B.n };
});

const out = { what: 'v5-1 §1-②③ 실측표 왕복 + 조립 비트 대조', 템플릿상수: TEE_TEMPLATE,
              칸: rows.length, 왕복최대오차: Math.max(...rows.map((r) => r.왕복최대)),
              'posSha 동일': rows.filter((r) => r.posSha동일).length,
              'uvSha 동일': rows.filter((r) => r.uvSha동일).length, rows };
writeFileSync('gpu/oracle/export/v5-1-roundtrip.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: rows.map((r) => ({ size: r.size, spec: r.spec,
  왕복최대: r.왕복최대, pos: r.posSha동일, uv: r.uvSha동일, n: r.현행.n })) }, null, 1));
