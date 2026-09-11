/* v5-8 §1-①② — **목선 링 둘레 궤적 · 봉제 수직 당김 대체 채널**(측정만 · 물리 0줄 · 새 식 0).
 *
 * ① 링 둘레 — `s4Gate.ts:118-123` 의 **닫힌 고리**(`[...neckF, ...neckB.reverse()]`)를 그대로 쓴다.
 *    최대 엣지 신장률 = 링 엣지의 `|현재| / |f0|`(f0 = 조립 직후) 의 최대.
 * ② 봉제 수직 당김 — λ 는 덤프에 **없다**(v5-7a §1-③) ⟹ §0-5 정의:
 *    gap = |d| − r_f(램프 rest · `dressRun.ts:111-116` 인용) · **수직 성분 = gap × |d_y|/|d|** [mm]
 *    그룹은 `garmentScene.ts:833-841` 의 이름 그대로(어깨L/R · 암홀앞/뒤 L/R · 옆선 · 소매밑).
 *    ★ 「λ 의 수직 성분」이라 적지 않는다 — **대체 채널**이다.
 * ③ 목선 엣지 신장 λ 대신 — 링 엣지 신장률(①의 채널)로 적는다.
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… DUMPS=<폴더> PREFIX=<칸>
 *        [STEP=10] [FMAX=200] npx tsx scripts/v5NeckStrain.ts`
 * 산출 = `gpu/oracle/export/v5-8-neck-<PREFIX>.json`(`_args` 포함 · v5-7b 규약)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_L';
const DUMPS = process.env.DUMPS!;
const PREFIX = process.env.PREFIX!;
const STEP = Number(process.env.STEP ?? 10);
const FMAX = Number(process.env.FMAX ?? 200);
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const P = prepare({ glb, fabric: FABRICS.gray, d: D,
  garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
  bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
  minPairDistLite, armAxis: armAxisFromEnv() });
const S = P.S as unknown as { Y_TOP: number };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array };
  seams: { name: string; a: number[]; b: number[] }[] };

/* 링 고리 — 게이트와 «같은 식» */
const loop = [...P.neckF, ...[...P.neckB].reverse()];
const girth = (p: Float64Array) => {
  let s = 0;
  for (let k = 0; k < loop.length; k++) {
    const i = loop[k], j = loop[(k + 1) % loop.length];
    s += Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  }
  return s;
};
const edgeLens = (p: Float64Array) => loop.map((_, k) => {
  const i = loop[k], j = loop[(k + 1) % loop.length];
  return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
});
const shoulderY = (p: Float64Array) => {
  const ys: number[] = [];
  for (const sm of sc.seams) if (sm.name.startsWith('어깨'))
    for (let k = 0; k < sm.a.length; k++) { ys.push(p[sm.a[k] * 3 + 1]); ys.push(p[sm.b[k] * 3 + 1]); }
  ys.sort((x, y) => x - y);
  return ys[Math.floor(ys.length / 2)];
};

/* ② 봉제 수직 당김 — 그룹별 · rest 는 램프 식(인용) */
const p0 = sc.s.pos;
const dist = (p: Float64Array, i: number, j: number) =>
  Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
const groups = sc.seams.map((sm) => ({
  name: sm.name,
  pairs: sm.a.map((i, k) => [i, sm.b[k]] as const),
  rest0: sm.a.map((i, k) => dist(p0, i, sm.b[k])),
}));
const RAMP_N = P.RAMP_N as unknown as number;
const restAt = (r0: number, f: number) =>                 // dressRun.ts:111-116 선형 램프 인용
  f >= RAMP_N ? SEP : r0 + (SEP - r0) * (f / RAMP_N);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const g0 = girth(p0), e0 = edgeLens(p0);
const rows: Record<string, unknown>[] = [];
const missing: number[] = [];
for (let f = 0; f <= FMAX; f += STEP) {
  let p: Float64Array;
  if (f === 0) p = p0;
  else {
    const path = `${DUMPS}/${PREFIX}-f${String(f).padStart(3, '0')}.bin`;
    if (!existsSync(path)) { missing.push(f); continue; }
    const raw = readFileSync(path);
    if (raw.byteLength !== sc.n * 24) throw new Error(`덤프 길이가 다르다 — ${path} · ${raw.byteLength} ≠ ${sc.n * 24}`);
    p = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }
  const el = edgeLens(p);
  const seam: Record<string, number> = {};
  for (const g of groups) {
    const vs = g.pairs.map(([i, j], k) => {
      const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
      const L = Math.hypot(dx, dy, dz);
      const gap = L - restAt(g.rest0[k], f);
      return L > 0 ? gap * (Math.abs(dy) / L) * 1000 : 0;      // mm
    });
    seam[`${g.name}_수직당김중앙mm`] = med(vs);
    seam[`${g.name}_수직당김최대mm`] = Math.max(...vs);
  }
  rows.push({ f,
    '링 둘레 cm': girth(p) * 100,
    '링 둘레 / f0': girth(p) / g0,
    '링 엣지 최대 신장률': Math.max(...el.map((v, k) => v / e0[k])),
    '링 엣지 중앙 신장률': med(el.map((v, k) => v / e0[k])),
    '어깨 봉제 y중앙 m': shoulderY(p),
    ...seam });
}

const _args = {
  BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
  ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null, SPEC: SPEC ?? null,
  TAG: PREFIX, CELL, D_MM: process.env.D_MM ?? null, DUMPS, STEP, FMAX,
  계기: 'v5NeckStrain.ts',
};
const out = { what: 'v5-8 §1-①② 링 둘레 궤적 + 봉제 수직 당김 대체 채널(측정만 · λ 아님)', _args,
  'Y_TOP m': S.Y_TOP, 'RAMP_N': RAMP_N, 'SEP mm': SEP * 1000, 'n': sc.n,
  '링 정점': loop.length, '링 f0 둘레 cm': g0 * 100, 'ringRest cm': (P.ringRest as number) * 100,
  '덤프 없는 프레임': missing, rows };
writeFileSync(`gpu/oracle/export/v5-8-neck-${PREFIX}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 0));
