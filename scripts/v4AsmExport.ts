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
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? `${CELL}-asm`;
const BODYTAG = TAG.replace(/_[^_]*$/, '');
const D = Number(process.env.D_MM ?? 9) / 1000;
const FAB = process.env.FAB ?? 'gray';
const c = cells().find((x) => x.id === CELL)!;
/* ★ v5-2 §1-② — **실측표 진입**(선택 인자 · 기본값 그대로 ⟹ 기존 호출은 바이트 불변).
 * `SPEC=<이름>` 이 있으면 옷 치수를 **등재된 실측표**에서 만든다(`src/v5/specToPattern.ts`).
 * 없으면 종전대로 `garmentOf(c.size)` 다(v4-24 의 `BODY_BIN` 처분과 같은 형태). */
const SPEC = process.env.SPEC;
const BODY_BIN = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;

const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(BODY_BIN);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const fab = (FABRICS as Record<string, { k: number; rho: number; B: number }>)[FAB];
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size), armAxis: armAxisFromEnv(),
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

/* ★ v5-8 §0-4 — **목선 링 «비신장» 진단 경로**(기본 off ⟹ 없으면 위 포장이 바이트 불변).
 *
 * 작용점은 코드에서 읽었다 — `gpu/engine/stretch.py:126` 「α̃ = α/h² · α = 1/(A·k)」 ⟹
 * 컴플라이언스는 `par[t][4]`(area) 와 전역 `k` 로만 정해지고, `par[t][4]` 를 읽는 자리는
 * `stretch.py:96` · `full.py:80` **둘뿐**이며 쓰임은 `at` 하나다(면적으로서의 다른 소비 0).
 * ⟹ `area = Infinity` 로 두면 `at = 1/(∞·k)/h² = 0` ⟹ **컴플라이언스 ×0**(비신장 극한) ·
 *    `dl = −C/denomW` 가 되어 하드 투영이 된다(`denomW ≥ 1e-20` 가드는 그대로).
 *
 * ★★ **대체를 명시한다** — 늘어남은 «삼각형 단위»(`garmentScene.ts:883`)라 「목선 링 엣지」라는
 *    제약이 **없다**. 그래서 «링 정점을 하나라도 포함하는 삼각형»을 대상으로 삼는다 —
 *    엣지보다 **넓은 집합**이고, 그 개수를 헤더·로그에 값으로 적는다. 「엣지만」이라 적지 않는다.
 * 진단 전용 — 정본 굽기에는 쓰지 않는다(`NECKRIGID` 미설정이 기본). */
const NECKRIGID = process.env.NECKRIGID === '1';
let nrTris = 0;
const ring = new Set<number>([...P.neckF, ...P.neckB]);
if (NECKRIGID) {
  for (let t = 0; t < m; t++) {
    if (ring.has(idx[t * 3]) || ring.has(idx[t * 3 + 1]) || ring.has(idx[t * 3 + 2])) {
      par[t * 5 + 4] = Infinity; nrTris++;
    }
  }
}

/* ★ v5-8 — `par` **유한성 가드 신설**. v4-26 검사는 `pos`·`uv` 만 보고 `par` 는 안 봤다(구멍).
 * 플래그 off 면 비유한 값이 하나라도 있으면 **던진다** · on 이면 센티넬 개수를 인쇄한다. */
{
  let bad = 0, inf = 0;
  for (let q = 0; q < par.length; q++) {
    if (Number.isFinite(par[q])) continue;
    if (NECKRIGID && q % 5 === 4 && par[q] === Infinity) inf++; else bad++;
  }
  if (bad) throw new Error(`조립 늘어남 par 에 비유한 값이 ${bad}개 있다 — ${TAG}`);
  if (NECKRIGID)
    console.log(JSON.stringify({ NECKRIGID: true, '링 정점': ring.size, '링 인접 삼각형': nrTris,
                                 '전체 삼각형': m, '센티넬(area=Inf)': inf,
                                 note: 'v5-8 §1-③ 진단 전용 — 컴플라이언스 ×0 · 정본 아님' }));
}

writeFileSync(`${OUT}/scene-${TAG}.bin`, pack({ cell: TAG, n: sc.n, tris: sc.tris.length / 3, m, d: D,
  fabric: FAB, k: fab.k, rho: fab.rho, B: fab.B, THICK, G, DT, MU, DAMP,
  substeps: P.SUB, memb: P.sub.memb, bendSub: P.sub.bend, kU: fab.k, kV: fab.k, kS: fab.k,
  ...(NECKRIGID ? { neckRigid: { vertices: ring.size, tris: nrTris } } : {}),
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
/* v5-9 §0-4㉠ — **봉제 «그룹 구간»을 헤더에 적는다**(데이터만 · payload 0바이트 변경).
 * 근거(§0-2ㄴ) — `garmentScene.ts:833-844` 가 그룹을 순서대로 만들고 `:878-881` 이 그 순서대로
 * `seamCons` 에 밀어 넣으며, 위 `all.filter(kind==='dist')` 도 그 순서를 보존한다 ⟹ 누적 길이가 구간이다.
 * 읽는 쪽은 오프셋을 헤더 «길이»에서 계산하므로(`gpu/engine/seam.py:43-44`) 기존 로더는 그대로 돈다. */
const seamGroups: { name: string; from: number; to: number }[] = [];
{ let acc = 0;
  for (const sm of (sc as unknown as { seams: { name: string; a: number[] }[] }).seams) {
    seamGroups.push({ name: sm.name, from: acc, to: acc + sm.a.length }); acc += sm.a.length; }
  if (acc !== ms) throw new Error(`봉제 그룹 누적 ${acc} ≠ 봉제 수 ${ms} — ${TAG}`); }
writeFileSync(`${OUT}/scene-seam-${TAG}.bin`, pack({ cell: TAG, n: sc.n, ms, d: D, fabric: FAB,
  k: fab.k, SEP: 2 * THICK, THICK, G, DT, MU, DAMP, substeps: P.SUB, rampN: P.RAMP_N, seamGroups,
  note: 'v4-20 §1-① 조립 입력 덤프(봉제)' }, Buffer.from(sidx.buffer), Buffer.from(spar.buffer)));

const g = P.bodyG;
writeFileSync(`${OUT}/sdf-${BODYTAG}.bin`, pack({ cell: TAG, body: BODYTAG, ox: g.ox, oy: g.oy,
  oz: g.oz, h: g.h, nx: g.nx, ny: g.ny, nz: g.nz, band: g.band, THICK, MU, G, DT,
  substeps: P.SUB, bext: P.bext, note: 'v4-20 §1-① 조립 입력 덤프(몸 SDF)' },
  Buffer.from(g.data.buffer, g.data.byteOffset, g.data.byteLength)));

/* ★ 조립 «상태» — 정착 blob 과 «같은 포장»이라 워커가 같은 리더로 읽는다. 속도는 조립 직후 = 0. */
const pos = Float64Array.from(sc.s.pos.subarray(0, sc.n * 3));
const vel = new Float64Array(sc.n * 3);
/* v5-9 §0 사무 ㄱ — **장면 인자를 조립 산출이 «스스로» 적는다**(데이터만 · 물리 0).
 * 근거 = v5-8 사고 5: 워커 `layer3` 이 `BODY_BIN`·`ARM_AXIS_JSON`·`ARM_ORIGIN_JSON` 을 복원하지 못해
 * 계기가 **T포즈 기본 몸**으로 장면을 세우고 정점 수가 갈렸다(12,042 ≠ 12,144). 조립이 쓴 그 값을 여기 남기면
 * 뒤에 오는 계기가 **같은 장면**을 세울 수 있다. 없는 키는 **넣지 않는다** ⟹ 기존 헤더와 키 집합이 같다. */
const SCENEARGS = { body: BODY_BIN,
  ...(process.env.ARM_AXIS_JSON ? { armAxisJson: process.env.ARM_AXIS_JSON } : {}),
  ...(process.env.ARM_ORIGIN_JSON ? { armOriginJson: process.env.ARM_ORIGIN_JSON } : {}),
  ...(SPEC ? { spec: SPEC } : {}) };
writeFileSync(`${OUT}/asm-${TAG}.bin`, pack({ what: 'v4-20 조립 «직후» 상태(속도 0)', cell: TAG,
  n: sc.n, frame: 0, d: D, ...SCENEARGS, substeps: P.SUB },
  Buffer.from(pos.buffer), Buffer.from(vel.buffer)));

console.log(JSON.stringify({ what: 'v4-20 §1-① 조립 입력 내보내기', cell: CELL, tag: TAG,
  bodyBin: BODY_BIN, n: sc.n, m, mb, ms, substeps: P.SUB,
  sdf: `${g.nx}×${g.ny}×${g.nz}`, 산출: [`scene-${TAG}.bin`, `scene-bend-${TAG}.bin`,
    `scene-seam-${TAG}.bin`, `sdf-${BODYTAG}.bin`, `asm-${TAG}.bin`] }, null, 1));
