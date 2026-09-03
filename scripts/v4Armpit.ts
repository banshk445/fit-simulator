/* v4-24 §1-② — **겨드랑이 채널**(팔↔몸통 최소 간격 · 그 대역 자기관통 교차 · 관통 최대).
 *
 * 새 물리 0줄 — 계기는 전부 기존 것을 부른다:
 *   `src/v3/instruments.ts` `minPairDist`(교차·최소거리) · `makeBodyDistance().exactBodyDist`(관통)
 *   `src/v3/dressRun.ts` `prepare`(위상·패널·SDF · 물리 0프레임)
 *
 * ★ **대역은 손 상수가 아니라 «옷 자신»에서 뜬다**(원리 「몸에서 가져와라」의 옷 판):
 *   ㉠ 소매 정점 = `sc.slv[0..1]` 패널 범위 · 몸통 정점 = `sc.front` · `sc.back` 패널 범위
 *   ㉡ **겨드랑이 씨앗** = 소매↔몸통을 잇는 **봉제쌍**의 정점(= 소매가 몸통에 붙는 자리)
 *   ㉢ **대역** = 씨앗 정점을 포함하는 삼각형 전부(1-링) — 그 삼각형 집합에서 교차를 센다
 *   ㉣ **간격** = 소매 정점 ↔ 몸통 정점 최소 거리 · **봉제로 직접 이어진 쌍은 뺀다**(설계상 SEP 로 붙는다)
 *
 * 진입: `CELL=… BODY_BIN=… POS=… [TAG=…] npx tsx scripts/v4Armpit.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { minPairDist, minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'apose';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size), armAxis: armAxisFromEnv(),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc, n = sc.n;
let pos: Float64Array;
if (process.env.POS) {
  const pb = readFileSync(process.env.POS);
  pos = new Float64Array(pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength)).slice(0, n * 3);
  if (pos.length !== n * 3) throw new Error(`POS 정점 수가 다르다 — ${pos.length / 3} ≠ ${n}`);
} else pos = Float64Array.from(sc.s.pos);
sc.s.pos.set(pos);

/* ㉠ 패널 정점 범위 — `garmentScene.ts:349` `at(p,i,j) = p.base + j*(p.nu+1) + i` 이므로
 *   한 패널의 정점은 `[base, base + (nu+1)*(nv+1))` 연속 구간이다. */
type Pan = { base: number; nu: number; nv: number; name: string };
const range = (p: Pan): [number, number] => [p.base, p.base + (p.nu + 1) * (p.nv + 1)];
const inAny = (v: number, rs: [number, number][]) => rs.some(([a, b]) => v >= a && v < b);
const slvR = (sc.slv as Pan[]).map(range);
const bodyR = [range(sc.front as Pan), range(sc.back as Pan)];

/* ㉣ 소매 ↔ 몸통 최소 간격(봉제쌍 제외) */
const seamPair = new Set<number>();
for (const s of sc.seamCons) seamPair.add(s.i * n + s.j).add(s.j * n + s.i);
const slvV: number[] = [], bodyV: number[] = [];
for (let v = 0; v < n; v++) { if (inAny(v, slvR)) slvV.push(v); else if (inAny(v, bodyR)) bodyV.push(v); }
let gmin = Infinity, gi = -1, gj = -1, gminAll = Infinity;
for (const i of slvV) for (const j of bodyV) {
  const d = Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  if (d < gminAll) gminAll = d;
  if (seamPair.has(i * n + j)) continue;
  if (d < gmin) { gmin = d; gi = i; gj = j; }
}

/* ㉡㉢ 겨드랑이 대역 = 소매↔몸통 봉제쌍 정점의 1-링 삼각형 */
const seed = new Set<number>();
for (const s of sc.seamCons) {
  const a = inAny(s.i, slvR), b = inAny(s.j, slvR);
  const ab = inAny(s.i, bodyR), bb2 = inAny(s.j, bodyR);
  if ((a && bb2) || (b && ab)) { seed.add(s.i); seed.add(s.j); }
}
const bandTris: number[] = [];
for (let t = 0; t < sc.tris.length / 3; t++) {
  const A = [sc.tris[t * 3], sc.tris[t * 3 + 1], sc.tris[t * 3 + 2]];
  if (A.some((v) => seed.has(v))) bandTris.push(A[0], A[1], A[2]);
}
const bandV = new Set<number>(bandTris);
const mpBand = minPairDist(pos, bandTris, SEP * 3);
const mpAll = minPairDist(pos, sc.tris, SEP * 3);

/* 관통 — 대역 정점의 «정확» 몸 거리(부호는 `bodyClearance` 정의와 같다: 안쪽이 관통) */
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const bcAll = bd.bodyClearance(sc.s);
let penBand = 0, penV = -1, clrBand = Infinity;
for (const v of bandV) {
  const dist = bd.exactBodyDist(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
  const pen = THICK - dist;                        // 두께 안으로 들어온 깊이(= bodyClearance 규약)
  if (pen > penBand) { penBand = pen; penV = v; }
  if (dist < clrBand) clrBand = dist;
}
const out = {
  what: 'v4-24 §1-② 겨드랑이 채널(대역은 옷 구조에서 유도 · 손 상수 0)',
  cell: CELL, tag: TAG, bodyBin: bbPath, pos: process.env.POS ?? '(조립 직후)',
  정점: { 전체: n, 소매: slvV.length, 몸통: bodyV.length, 대역: bandV.size, 대역삼각형: bandTris.length / 3, 씨앗: seed.size },
  '팔↔몸통_최소간격mm': { '봉제쌍_제외': gmin * 1000, 정점쌍: [gi, gj], '전체(봉제 포함)': gminAll * 1000 },
  대역: { '자기관통_교차': mpBand.hits, '최소_쌍거리mm': mpBand.min * 1000,
         '관통_최대mm': penBand * 1000, 관통정점: penV, '몸거리_최소mm': clrBand * 1000 },
  전체: { '자기관통_교차': mpAll.hits, '최소_쌍거리mm': mpAll.min * 1000,
         '관통_최대mm': bcAll.maxPen * 1000, 관통정점수: bcAll.penCnt },
  SEPmm: SEP * 1000, THICKmm: THICK * 1000,
};
writeFileSync(`${OUT}/l3ap-armpit-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
