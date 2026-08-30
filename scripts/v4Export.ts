/* v4-02 §1-② — **v3 → v4 덤프**(읽기 전용 · 물리 코어 diff 0 · 착장 굽기 0).
 *
 * 왜 필요한가: 정착 blob(`settled-*.bin`)은 **위치·속도만** 담는다(헤더 = frame·n·d·place).
 * **삼각형·제약 목록·질량은 blob 에 «없다»** — `garmentScene.assemble` 이 만드는 값이다.
 * ⟹ v4 가 대조하려면 v3 의 **조립 산출물**을 한 번 꺼내야 한다. 이 스크립트는 그 «창»이고
 *   `src/` 를 **한 줄도 고치지 않는다**(prepare 를 부르기만 한다).
 *
 * ★ 여기서 도는 것은 **조립 + 몸 SDF 굽기**뿐이다 — `runFrames`(착장 굽기)는 **0회**.
 *   산출물은 `public/v3diag` 정본에 **쓰지 않는다**(별도 디렉터리).
 *
 * 진입:
 *   npx tsx scripts/v4Export.ts                      # 39칸 요약표
 *   DUMP=c100-h170-s45_M npx tsx scripts/v4Export.ts # 그 칸의 장면을 바이너리로
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, THICK, G, DT, MU, DAMP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const FAB = process.env.FAB ?? 'gray';               // v3GridRun.ts:120 — 본 그리드는 gray 로 구웠다
const DUMP = process.env.DUMP ?? null;

const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/** blob 이 있는 칸 = 정답지 실효 목록(v4-01 §4-1 ㉣). 디렉터리에서 «뜬다»(손 목록 0). */
const have = new Set(
  readdirSync(SRC).filter((f) => f.startsWith('settled-') && f.endsWith('.bin'))
    .map((f) => f.slice('settled-'.length, -'.bin'.length)),
);
const list = cells().filter((c) => have.has(c.id));
const targets = DUMP ? list.filter((c) => c.id === DUMP) : list;
if (DUMP && targets.length === 0) throw new Error(`DUMP=${DUMP} 은 blob 이 있는 칸이 아니다`);

type Row = {
  id: string; n: number; tris: number; inplane: number; bend: number; seam: number; cons: number;
  sub: number; memb: number; bendSub: number; fabric: string; k: number; rho: number; B: number; d: number;
};
const rows: Row[] = [];
let bodyId = '', verts: Float32Array | null = null;
for (const c of targets) {
  if (c.bodyId !== bodyId) {                          // 몸 하나로 사이즈 넷 — v3GridRun 과 같은 순회
    const b = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
    verts = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    bodyId = c.bodyId;
  }
  const fab = FABRICS[FAB];
  const P = prepare({ glb, fabric: fab, d: D, garment: garmentOf(c.size as Size), bodyVerts: verts!, minPairDistLite });
  const sc = P.sc;
  const inplane = sc.cons.filter((x) => x.kind === 'inplane');
  const bend = sc.cons.filter((x) => x.kind === 'bend');
  const seam = sc.cons.filter((x) => x.kind === 'dist');
  rows.push({ id: c.id, n: sc.n, tris: sc.tris.length / 3, inplane: inplane.length, bend: bend.length,
              seam: seam.length, cons: sc.cons.length, sub: P.SUB, memb: P.sub.memb, bendSub: P.sub.bend,
              fabric: FAB, k: fab.k, rho: fab.rho, B: fab.B, d: D });
  console.log(`${c.id}\tn=${sc.n}\ttri=${sc.tris.length / 3}\tin=${inplane.length}\tbend=${bend.length}\tseam=${seam.length}\tsub=${P.SUB}`);

  if (DUMP === c.id) {
    /* 장면 바이너리 — 헤더 JSON + [invMass f64 n] + [i0i1i2 int32 3m] + [a,b,c,d,area f64 5m] */
    const m = inplane.length;
    const hdr = {
      cell: c.id, n: sc.n, tris: sc.tris.length / 3, m, d: D, fabric: FAB,
      k: fab.k, rho: fab.rho, B: fab.B, THICK, G, DT, MU, DAMP,
      substeps: P.SUB, memb: P.sub.memb, bendSub: P.sub.bend,
      kU: fab.k, kV: fab.k, kS: fab.k,                 // garmentScene.ts:734 — makeInplane(tris, uv, KMEM, KMEM, KMEM)
      note: 'v4-02 §1-② 덤프 · inplane(늘어남) 제약만. 순서 = makeInplane 순서 = 삼각형 순서',
    };
    const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
    const im = new Float64Array(sc.n); im.set(sc.s.invMass.subarray(0, sc.n));
    const idx = new Int32Array(m * 3);
    const par = new Float64Array(m * 5);
    inplane.forEach((x: any, t: number) => {
      idx[t * 3] = x.i0; idx[t * 3 + 1] = x.i1; idx[t * 3 + 2] = x.i2;
      par[t * 5] = x.a; par[t * 5 + 1] = x.b; par[t * 5 + 2] = x.c; par[t * 5 + 3] = x.d; par[t * 5 + 4] = x.area;
    });
    const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
    writeFileSync(`${OUT}/scene-${c.id}.bin`,
      Buffer.concat([head, hb, Buffer.from(im.buffer), Buffer.from(idx.buffer), Buffer.from(par.buffer)]));
    console.log(`  → ${OUT}/scene-${c.id}.bin (m=${m})`);

    /* v4-03 §1-③ — **굽힘 장면**을 «따로» 쓴다(v4-02 산출물은 바이트 그대로 둔다).
     * 헤더 JSON + [p0p1p2p3 int32 4mb] + [restAngle, shape f64 2mb] */
    const mb = bend.length;
    const bhdr = {
      cell: c.id, n: sc.n, mb, d: D, fabric: FAB, ke: fab.B, k: fab.k, rho: fab.rho,
      THICK, G, DT, MU, DAMP, substeps: P.SUB,
      note: 'v4-03 §1-③ 덤프 · bend(굽힘) 제약만. 순서 = makeBend 순서 = 엣지 맵 순서. ke = MAT.B(garmentScene.ts:733)',
    };
    const bhb = Buffer.from(JSON.stringify(bhdr), 'utf8');
    const bidx = new Int32Array(mb * 4);
    const bpar = new Float64Array(mb * 2);
    bend.forEach((x: any, t: number) => {
      bidx[t * 4] = x.p0; bidx[t * 4 + 1] = x.p1; bidx[t * 4 + 2] = x.p2; bidx[t * 4 + 3] = x.p3;
      bpar[t * 2] = x.restAngle; bpar[t * 2 + 1] = x.shape;
    });
    const bhead = Buffer.alloc(4); bhead.writeUInt32LE(bhb.length, 0);
    writeFileSync(`${OUT}/scene-bend-${c.id}.bin`,
      Buffer.concat([bhead, bhb, Buffer.from(bidx.buffer), Buffer.from(bpar.buffer)]));

    /* v4-06 §1-① — **봉제 장면**. 헤더 JSON + [i,j int32 2ms] + [rest f64 ms] */
    const ms = seam.length;
    const shdr = {
      cell: c.id, n: sc.n, ms, d: D, fabric: FAB, k: fab.k, SEP: 2 * THICK, THICK,
      G, DT, MU, DAMP, substeps: P.SUB, rampN: P.RAMP_N,
      note: 'v4-06 §1-① 덤프 · dist(봉제) 제약만. 순서 = garmentScene.ts:728 seams 순회 순서. k = KMEM = 원단 k',
    };
    const shb = Buffer.from(JSON.stringify(shdr), 'utf8');
    const sidx = new Int32Array(ms * 2);
    const spar = new Float64Array(ms);
    seam.forEach((x: any, t: number) => { sidx[t * 2] = x.i; sidx[t * 2 + 1] = x.j; spar[t] = x.rest; });
    const shead = Buffer.alloc(4); shead.writeUInt32LE(shb.length, 0);
    writeFileSync(`${OUT}/scene-seam-${c.id}.bin`,
      Buffer.concat([shead, shb, Buffer.from(sidx.buffer), Buffer.from(spar.buffer)]));
    console.log(`  → ${OUT}/scene-seam-${c.id}.bin (ms=${ms} · rest ${Math.min(...spar).toExponential(6)}~${Math.max(...spar).toExponential(6)} · SEP ${(2 * THICK).toExponential(6)} · RAMP_N ${P.RAMP_N})`);

    /* v4-05 §1-③ — **몸 SDF 격자**. 충돌 커널의 유일한 충돌체다(`dressRun.prepare` 가 굽는다).
     * 헤더 JSON + [data float32 nx·ny·nz]. `GridSdf` 필드는 `bodySdf.ts` 정의 그대로. */
    const g = P.bodyG;
    const ghdr = {
      cell: c.id, body: c.bodyId,
      ox: g.ox, oy: g.oy, oz: g.oz, h: g.h, nx: g.nx, ny: g.ny, nz: g.nz, band: g.band,
      THICK, MU, G, DT, substeps: P.SUB, bext: P.bext,
      note: 'v4-05 §1-③ 덤프 · 몸 SDF 격자(bakeSdf 산출). 충돌 = sampleSdf 삼선형 + 중심차분 법선',
    };
    const ghb = Buffer.from(JSON.stringify(ghdr), 'utf8');
    const ghead = Buffer.alloc(4); ghead.writeUInt32LE(ghb.length, 0);
    writeFileSync(`${OUT}/sdf-${c.bodyId}.bin`, Buffer.concat([
      ghead, ghb, Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength)]));
    console.log(`  → ${OUT}/sdf-${c.bodyId}.bin (${g.nx}×${g.ny}×${g.nz} · h=${(g.h * 1000).toFixed(4)}mm · band=${g.band} · ${(g.data.length * 4 / 1048576).toFixed(1)}MB)`);
    console.log(`  → ${OUT}/scene-bend-${c.id}.bin (mb=${mb} · restAngle 최대 ${Math.max(...bpar.filter((_, i) => i % 2 === 0).length ? bend.map((x: any) => Math.abs(x.restAngle)) : [0])})`);
  }
}
if (!DUMP) {
  writeFileSync(`${OUT}/cells.json`, JSON.stringify(rows, null, 1));
  console.log(`\n칸 ${rows.length} → ${OUT}/cells.json`);
}
