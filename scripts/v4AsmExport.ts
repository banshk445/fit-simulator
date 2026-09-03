/* v4-20 §1-① — **조립 산출을 워커 입력으로** 내보낸다(굽기 0 · 물리 0프레임).
 *
 * `scripts/v4Export.ts`(v4-02~06)의 **덤프 형식을 그대로** 쓴다 — 헤더 JSON + 페이로드 ·
 * 필드 순서·이름 전부 같다(그래야 `gpu/oracle/load.py` 가 손 안 대고 읽는다).
 * 다른 것은 둘뿐: ① 몸 정점을 **파일에서** 받는다(A포즈 몸도 됨) ② **조립 «상태»**를 같이 낸다.
 *
 * 산출(TAG 접두) — `scene-<TAG>.bin` · `scene-bend-<TAG>.bin` · `scene-seam-<TAG>.bin` ·
 *   `sdf-<BODYTAG>.bin`(TAG 의 `_` 앞부분) · **`asm-<TAG>.bin`**(= 정착 blob 과 «같은 포장»:
 *   [u32 헤더길이][헤더 JSON][pos f64 3n][vel f64 3n] · 워커가 같은 리더로 읽는다)
 *
 * 진입: `CELL=c100-h170-s45_M BODY_BIN=… TAG=… npx tsx scripts/v4AsmExport.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, THICK, G, DT, MU, DAMP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? `${CELL}-asm`;
const BODYTAG = TAG.replace(/_[^_]*$/, '');
const D = Number(process.env.D_MM ?? 9) / 1000;
const FAB = process.env.FAB ?? 'gray';
const c = cells().find((x) => x.id === CELL)!;
const BODY_BIN = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;

const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(BODY_BIN);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const fab = (FABRICS as Record<string, { k: number; rho: number; B: number }>)[FAB];
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), armAxis: armAxisFromEnv(),
                    bodyVerts: verts, minPairDistLite });

/* ★ v4-26 §1-② **유한성 검사**(전략 세션 v4-25 §4 승인 · 함정 후보 「배치 산출의 조용한 NaN 통과」).
 * v4-25 는 소매 1,020 정점이 NaN 인 조립 blob 을 **아무 말 없이** 내보냈다 — 굽기까지 가서야 드러난다.
 * ⟹ 여기서 **패널별 개수와 함께 던진다**(조용한 성공 0 · 물리 0줄 · 판정 0). */
{
  const sc0 = P.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float64Array;
                                   panels: { base: number; nu: number; nv: number; name: string }[] };
  const bad: string[] = [];
  for (const p of sc0.panels) {
    const end = p.base + (p.nu + 1) * (p.nv + 1);
    let bp = 0, bu = 0;
    for (let v = p.base; v < end; v++) {
      if (!Number.isFinite(sc0.s.pos[v * 3]) || !Number.isFinite(sc0.s.pos[v * 3 + 1])
          || !Number.isFinite(sc0.s.pos[v * 3 + 2])) bp++;
      if (!Number.isFinite(sc0.uv[v * 2]) || !Number.isFinite(sc0.uv[v * 2 + 1])) bu++;
    }
    if (bp || bu) bad.push(`${p.name}: pos ${bp} · uv ${bu} / ${end - p.base}`);
  }
  if (bad.length) throw new Error(`조립 산출에 NaN/Inf 가 있다 — ${bad.join(' | ')}`);
}

const sc = P.sc;
type Con = Record<string, number> & { kind: string };
const all = sc.cons as unknown as Con[];
const inplane = all.filter((x) => x.kind === 'inplane');
const bend = all.filter((x) => x.kind === 'bend');
const seam = all.filter((x) => x.kind === 'dist');
const pack = (hdr: object, ...bufs: Buffer[]) => {
  const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
  const h = Buffer.alloc(4); h.writeUInt32LE(hb.length, 0);
  return Buffer.concat([h, hb, ...bufs]);
};

const m = inplane.length;
const im = new Float64Array(sc.n); im.set(sc.s.invMass.subarray(0, sc.n));
const idx = new Int32Array(m * 3), par = new Float64Array(m * 5);
inplane.forEach((x, t) => { idx[t * 3] = x.i0; idx[t * 3 + 1] = x.i1; idx[t * 3 + 2] = x.i2;
  par[t * 5] = x.a; par[t * 5 + 1] = x.b; par[t * 5 + 2] = x.c; par[t * 5 + 3] = x.d; par[t * 5 + 4] = x.area; });
writeFileSync(`${OUT}/scene-${TAG}.bin`, pack({ cell: TAG, n: sc.n, tris: sc.tris.length / 3, m, d: D,
  fabric: FAB, k: fab.k, rho: fab.rho, B: fab.B, THICK, G, DT, MU, DAMP,
  substeps: P.SUB, memb: P.sub.memb, bendSub: P.sub.bend, kU: fab.k, kV: fab.k, kS: fab.k,
  note: 'v4-20 §1-① 조립 입력 덤프 · v4Export 와 같은 형식' },
  Buffer.from(im.buffer), Buffer.from(idx.buffer), Buffer.from(par.buffer)));

const mb = bend.length;
const bidx = new Int32Array(mb * 4), bpar = new Float64Array(mb * 2);
bend.forEach((x, t) => { bidx[t * 4] = x.p0; bidx[t * 4 + 1] = x.p1; bidx[t * 4 + 2] = x.p2;
  bidx[t * 4 + 3] = x.p3; bpar[t * 2] = x.restAngle; bpar[t * 2 + 1] = x.shape; });
writeFileSync(`${OUT}/scene-bend-${TAG}.bin`, pack({ cell: TAG, n: sc.n, mb, d: D, fabric: FAB,
  ke: fab.B, k: fab.k, rho: fab.rho, THICK, G, DT, MU, DAMP, substeps: P.SUB,
  note: 'v4-20 §1-① 조립 입력 덤프(굽힘)' }, Buffer.from(bidx.buffer), Buffer.from(bpar.buffer)));

const ms = seam.length;
const sidx = new Int32Array(ms * 2), spar = new Float64Array(ms);
seam.forEach((x, t) => { sidx[t * 2] = x.i; sidx[t * 2 + 1] = x.j; spar[t] = x.rest; });
writeFileSync(`${OUT}/scene-seam-${TAG}.bin`, pack({ cell: TAG, n: sc.n, ms, d: D, fabric: FAB,
  k: fab.k, SEP: 2 * THICK, THICK, G, DT, MU, DAMP, substeps: P.SUB, rampN: P.RAMP_N,
  note: 'v4-20 §1-① 조립 입력 덤프(봉제)' }, Buffer.from(sidx.buffer), Buffer.from(spar.buffer)));

const g = P.bodyG;
writeFileSync(`${OUT}/sdf-${BODYTAG}.bin`, pack({ cell: TAG, body: BODYTAG, ox: g.ox, oy: g.oy,
  oz: g.oz, h: g.h, nx: g.nx, ny: g.ny, nz: g.nz, band: g.band, THICK, MU, G, DT,
  substeps: P.SUB, bext: P.bext, note: 'v4-20 §1-① 조립 입력 덤프(몸 SDF)' },
  Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength)));

/* ★ 조립 «상태» — 정착 blob 과 «같은 포장»이라 워커가 같은 리더로 읽는다. 속도는 조립 직후 = 0. */
const pos = Float64Array.from(sc.s.pos.subarray(0, sc.n * 3));
const vel = new Float64Array(sc.n * 3);
writeFileSync(`${OUT}/asm-${TAG}.bin`, pack({ what: 'v4-20 조립 «직후» 상태(속도 0)', cell: TAG,
  n: sc.n, frame: 0, d: D, body: BODY_BIN, substeps: P.SUB },
  Buffer.from(pos.buffer), Buffer.from(vel.buffer)));

console.log(JSON.stringify({ what: 'v4-20 §1-① 조립 입력 내보내기', cell: CELL, tag: TAG,
  bodyBin: BODY_BIN, n: sc.n, m, mb, ms, substeps: P.SUB,
  sdf: `${g.nx}×${g.ny}×${g.nz}`, 산출: [`scene-${TAG}.bin`, `scene-bend-${TAG}.bin`,
    `scene-seam-${TAG}.bin`, `sdf-${BODYTAG}.bin`, `asm-${TAG}.bin`] }, null, 1));
