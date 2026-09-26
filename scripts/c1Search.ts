/* C1 §3② — **f0 탐색기**(조립만 · 굽기 0 · 물리 0프레임 · `src/` 거동 0줄 · 판정은 목표함수로만).
 *
 * 한 프로세스가 «벌 × 계열»을 돌며 **한 실험 1행**을 낸다(전량 기록 규약).
 *   G1 — 조립 자기검사 통과(던지면 그 문구) · 최소 쌍거리 · 몸 관통 밴드 밖 정점
 *   옷깃 f0 대리 — 링중심 − `Y_NECK` · 어깨선(`Y_TOP`) 초과 최대 · 구간 근접쌍(`SEP − TOL_SELF`)
 * 계열 문자열은 `src/v3/garmentScene.ts` 의 `c1Var` 가 읽는다(`A[:k]`·`B`·`C[:m]`·`D` · `+` 로 겹침).
 *
 * 진입: `VARS="|C:0.3|A:1+D" [SET=5] OUT=<json> npx tsx scripts/c1Search.ts`
 *   `VARS` 는 `|` 로 가른다(빈 칸 = 현행 asm1x) · `SET=5` 는 대표 5벌 · `SET=off` 는 옛 정본 대조.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, TOL_SELF } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';

const G = 'gpu/oracle/export/grid27';
type Bul = { label: string; cell: string; spec?: string; body: string };
const FIVE: Bul[] = [
  { label: '작은몸S', cell: 'c87.5-h155-s40_S', body: 'c87.5-h155-s40' },
  { label: '기본M', cell: 'c100-h170-s45_M', body: 'c100-h170-s45' },
  { label: '큰몸XL', cell: 'c122.5-h185-s50_XL', body: 'c122.5-h185-s50' },
  { label: '큰키L', cell: 'c100-h185-s45_L', body: 'c100-h185-s45' },
  { label: 'supima-L', cell: 'c100-h170-s45_L', spec: 'supima-L', body: 'c100-h170-s45' },
];
const VARS = (process.env.VARS ?? '').split('|');
const OFFMODE = process.env.SET === 'off';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const LOG = process.env.LOG ?? 'docs/v5/c1/실험표.md';
const mm = (x: number) => x * 1000;

let probe: Record<string, unknown> | null = null;
(globalThis as unknown as { __c1VarProbe?: (r: Record<string, unknown>) => void }).__c1VarProbe = (r) => { probe = r; };

function armAxisOf(body: string) {
  const ax = JSON.parse(readFileSync(`${G}/l3ap-body-${body}-a35.json`, 'utf8')) as { 팔축_후: { name: string; dir: number[] }[] };
  const or = JSON.parse(readFileSync(`${G}/l3ap-origin-${body}-a35.json`, 'utf8')) as
    { left: { 중심선투영: number[]; 피벗: number[] }; right: { 중심선투영: number[]; 피벗: number[] } };
  const pick = (w: string) => ax.팔축_후.find((x) => x.name.includes(w))!.dir as [number, number, number];
  return { left: pick('Left'), right: pick('Right'),
           origin: { left: or.left.중심선투영 as [number, number, number], right: or.right.중심선투영 as [number, number, number] },
           pivot: { left: or.left.피벗 as [number, number, number], right: or.right.피벗 as [number, number, number] } };
}

type Row = Record<string, unknown>;
const rows: Row[] = [];
let id = Number(process.env.ID0 ?? 1);

for (const v of VARS) for (const b of FIVE) {
  const t0 = Date.now();
  const c = cells().find((x) => x.id === b.cell)!;
  const bb = readFileSync(`${G}/l3ap-body-${b.body}-a35.bin`);
  const row: Row = { id: id++, 단계: '②탐색', 벌: b.label, 계열: v || '(현행 asm1x)' };
  try {
    const P = prepare({ glb, fabric: FABRICS.gray, d: 0.009,
      garment: b.spec ? patternOfSpecName(b.spec) : garmentOf(c.size as Size),
      bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
      minPairDistLite, armAxis: armAxisOf(b.body),
      ...(OFFMODE ? {} : { asm1x: true, ...(v ? { c1Var: v } : {}) }) } as never);
    const S = P.S as unknown as { Y_TOP: number; Y_NECK: number };
    const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; tris: number[];
      seamCons: { i: number; j: number }[]; N_sh: number; N_nk: number; nvB: number;
      front: { base: number; nu: number; uv: Float64Array }; back: { base: number; nu: number; uv: Float64Array } };
    const pos = sc.s.pos;
    const at = (pan: { base: number; nu: number }, i: number, j: number) => pan.base + j * (pan.nu + 1) + i;
    const ringY: number[] = [];
    for (const pan of [sc.front, sc.back])
      for (let i = sc.N_sh; i <= sc.N_sh + sc.N_nk; i++) ringY.push(pos[at(pan, i, sc.nvB) * 3 + 1]);
    const ringMid = ringY.reduce((a, x) => a + x, 0) / ringY.length;
    const zone = new Set<number>();
    for (let q = 0; q < sc.n; q++) if (pos[q * 3 + 1] > S.Y_TOP) zone.add(q);
    for (const pan of [sc.front, sc.back]) for (let i = 0; i <= pan.nu; i++) zone.add(at(pan, i, sc.nvB));
    const Z = [...zone];
    const key = (a: number, x: number) => (a < x ? a * 1e7 + x : x * 1e7 + a);
    const skip = new Set<number>();
    for (let t = 0; t + 2 < sc.tris.length; t += 3) {
      const [x, y, z] = [sc.tris[t], sc.tris[t + 1], sc.tris[t + 2]];
      skip.add(key(x, y)); skip.add(key(y, z)); skip.add(key(x, z));
    }
    for (const s2 of sc.seamCons) skip.add(key(s2.i, s2.j));
    const LIM = SEP - TOL_SELF;
    let near = 0;
    for (let a = 0; a < Z.length; a++) for (let x = a + 1; x < Z.length; x++) {
      if (skip.has(key(Z[a], Z[x]))) continue;
      const u = Z[a], w = Z[x];
      const dx = pos[u * 3] - pos[w * 3], dy = pos[u * 3 + 1] - pos[w * 3 + 1], dz = pos[u * 3 + 2] - pos[w * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < LIM * LIM) near++;
    }
    let over = -Infinity;
    for (const q of Z) over = Math.max(over, pos[q * 3 + 1] - S.Y_TOP);
    const band = (P.sdfSpec as { band: number }).band;
    let outBand = 0;
    for (let q = 0; q < sc.n; q++) if (Math.max(0, -sampleSdf(P.bodyG, pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2])) > band) outBand++;
    const mp = minPairDistLite(pos, sc.tris);
    Object.assign(row, { 조립: 'ok', n: sc.n, '최소쌍 mm': mm(mp),
      '밴드 밖': outBand, '링중심−Y_NECK mm': mm(ringMid - S.Y_NECK), '어깨선 초과 최대 mm': mm(over),
      '근접쌍': near, '구간': Z.length, 'SH_DROP mm': probe?.['SH_DROP mm'] ?? null,
      '몸 낙차 mm': probe?.['몸 낙차 mm'] ?? null, '앵커 하강 mm': probe?.['앵커 하강 mm'] ?? null });
  } catch (e) {
    Object.assign(row, { 조립: '던짐', 사유: String((e as Error).message).replace(/\s+/g, ' ').slice(0, 120) });
  }
  row['초 s'] = (Date.now() - t0) / 1000;
  rows.push(row);
  appendFileSync(LOG, `| ${row.id} | ${row.단계} | ${row.벌} | ${row.계열} | ${row.조립 === 'ok' ? '통과' : '던짐'} | ` +
    `${row['최소쌍 mm'] === undefined ? '—' : (row['최소쌍 mm'] as number).toFixed(4)} | ${row['밴드 밖'] ?? '—'} | ` +
    `${row['링중심−Y_NECK mm'] === undefined ? '—' : (row['링중심−Y_NECK mm'] as number).toFixed(3)} / ` +
    `${row['어깨선 초과 최대 mm'] === undefined ? '—' : (row['어깨선 초과 최대 mm'] as number).toFixed(3)} / ${row['근접쌍'] ?? '—'} | ` +
    `${row.조립 === 'ok' ? '—' : (row.사유 as string)} | ${(row['초 s'] as number).toFixed(1)}s |\n`);
  console.log(JSON.stringify(row));
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(rows, null, 1));
