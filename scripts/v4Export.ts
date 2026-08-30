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
  }
}
if (!DUMP) {
  writeFileSync(`${OUT}/cells.json`, JSON.stringify(rows, null, 1));
  console.log(`\n칸 ${rows.length} → ${OUT}/cells.json`);
}
