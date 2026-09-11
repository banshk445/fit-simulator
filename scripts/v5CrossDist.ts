/* v5-17 §1-① — **교차 쌍 «전수 열거»와 자리 분포**(측정만 · `src/` **0줄** · 물리 0프레임 · 판정 0).
 *
 * 재료는 **이미 있는 인쇄 훅**이다 — `garmentScene.ts:1238` 의 `__v3gapProbe` 가 매 δ 회차에
 * `pos` · `tris` · `panels[{name, base}]` · `n` 을 넘긴다(v3-87 형식). 조립이 «던져도» 그 훅은
 * 이미 발화했다 ⟹ 던짐을 잡고 **마지막 회차의 씬**으로 센다.
 * 교차 판정기는 `instruments.ts:135 triTriHit`(내보내져 있다) · 후보 생성은 `minPairDist`(`:66-116`)의
 * **격자 방식 그대로**(셀 = `max(window*2, 0.01)` · `window = SEP*2`) ⟹ 새 식 0.
 *
 * 진입: `[ASM2FIX=…] SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5CrossDist.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Gap = { 회차: number; pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };
let last: Gap | null = null;
(globalThis as unknown as { __v3gapProbe?: (r: Gap) => void }).__v3gapProbe = (r) => { last = r; };
let asm2: Record<string, unknown> | null = null;
(globalThis as unknown as { __asm2Probe?: (r: Record<string, unknown>) => void }).__asm2Probe = (r) => { asm2 = r; };

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite, triTriHit } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const FIX = process.env.ASM2FIX || undefined;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
let thrown: string | null = null;
try {
  prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: armAxisFromEnv(), asm2: true,
    ...(FIX ? { asm2Fix: FIX } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }
if (!last) { console.error('gapProbe 미발화 — 조립이 그 자리에 못 갔다'); process.exit(1); }
const G = last as Gap;

/* ── 정점 → (패널 · i · j) ── `at(p,i,j) = base + j*(nu+1) + i`(garmentScene.ts:349) 의 역이다.
 * `nu`·`nv` 는 훅에 없으므로 **패널 정점 수와 `nvB`(asm2 훅)에서 역산**한다(새 수 0). */
const a2 = asm2 as Record<string, unknown> | null;
const trace = a2?.['행별 추적'] as { nvB: number }[] | undefined;
const nvB = trace && trace.length ? trace[0].nvB : NaN;
const bases = G.panels.map((p) => p.base).concat([G.n]);
const sizes = G.panels.map((_, k) => bases[k + 1] - bases[k]);
const dims = G.panels.map((p, k) => {
  if (p.name === 'front' || p.name === 'back') {
    const nv = nvB, nu = sizes[k] / (nv + 1) - 1;
    return { nu, nv };
  }
  return { nu: NaN, nv: NaN };                       // 소매는 이 판의 분류에서 «소매»로만 센다
});
const locOf = (v: number) => {
  for (let k = 0; k < G.panels.length; k++) {
    if (v < bases[k] || v >= bases[k + 1]) continue;
    const { nu, nv } = dims[k];
    if (!Number.isFinite(nu)) return { pan: G.panels[k].name, i: -1, j: -1 };
    const q = v - bases[k];
    return { pan: G.panels[k].name, i: q % (nu + 1), j: Math.floor(q / (nu + 1)), nv };
  }
  return { pan: '?', i: -1, j: -1 };
};

/* ── 격자 후보 생성(minPairDist 방식 그대로) ── */
const pos = G.pos, tris = G.tris, T = tris.length / 3;
const win = SEP * 2, cs = Math.max(win * 2, 0.01);
const box = new Float64Array(T * 6);
for (let t = 0; t < T; t++) {
  const o = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
  for (let k = 0; k < 3; k++) {
    box[t * 6 + k] = Math.min(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
    box[t * 6 + 3 + k] = Math.max(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
  }
}
const grid = new Map<number, number[]>();
const key = (a: number, b: number, cc: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (cc + 4096);
for (let t = 0; t < T; t++) {
  const i0 = Math.floor(box[t * 6] / cs), i1 = Math.floor(box[t * 6 + 3] / cs);
  const j0 = Math.floor(box[t * 6 + 1] / cs), j1 = Math.floor(box[t * 6 + 4] / cs);
  const k0 = Math.floor(box[t * 6 + 2] / cs), k1 = Math.floor(box[t * 6 + 5] / cs);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
    const kk = key(i, j, k); let arr = grid.get(kk); if (!arr) grid.set(kk, (arr = [])); arr.push(t);
  }
}
/* ── 전수 열거 ── */
const seen = new Set<number>();
const rows: { panPair: string; jA: number; jB: number; iA: number; iB: number }[] = [];
const shares = (a: number, b: number) => {
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (tris[a * 3 + x] === tris[b * 3 + y]) return true;
  return false;
};
for (const arr of grid.values())
  for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
    const s = arr[a], t2 = arr[b];
    const pk = s < t2 ? s * 1e7 + t2 : t2 * 1e7 + s;
    if (seen.has(pk)) continue; seen.add(pk);
    if (shares(s, t2)) continue;                     // 인접(정점 공유) 삼각형은 교차로 세지 않는다
    if (!triTriHit(pos, [tris[s * 3], tris[s * 3 + 1], tris[s * 3 + 2]],
                        [tris[t2 * 3], tris[t2 * 3 + 1], tris[t2 * 3 + 2]])) continue;
    const la = locOf(tris[s * 3]), lb = locOf(tris[t2 * 3]);
    const pp = [la.pan, lb.pan].sort().join('↔');
    rows.push({ panPair: pp, jA: la.j, jB: lb.j, iA: la.i, iB: lb.i });
  }
const tally = (f: (r: typeof rows[number]) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const js = rows.flatMap((r) => [r.jA, r.jB]).filter((x) => x >= 0);
const out = {
  what: 'v5-17 §1-① 교차 쌍 전수 열거와 자리 분포(측정만 · src 0줄 · 판정 0)',
  _args: { ASM2FIX: FIX ?? null, SPEC: SPEC ?? null, CELL, 계기: import.meta.url.split('/').pop() },
  던짐: thrown, 'gapProbe 회차': G.회차, nvB, '삼각형': T, n: G.n,
  '교차 쌍 수': rows.length,
  '패널 조합': tally((r) => r.panPair),
  '행 j 분포(nvB − j)': tally((r) => {
    const d = Math.min(...[r.jA, r.jB].filter((x) => x >= 0).map((x) => nvB - x));
    return Number.isFinite(d) ? `nvB−${d}` : '소매';
  }).slice(0, 12),
  'j 통계': js.length ? { 최소: Math.min(...js), 최대: Math.max(...js), nvB,
    '상단 5행 안': rows.filter((r) => [r.jA, r.jB].some((x) => x >= 0 && nvB - x <= 5)).length,
    '상단 12행 안': rows.filter((r) => [r.jA, r.jB].some((x) => x >= 0 && nvB - x <= 12)).length } : null,
  '열 i 분포(상위 12)': tally((r) => `i${Math.min(r.iA, r.iB)}`).slice(0, 12),
  asm2: a2 ? { 'S4 반복': a2['S4 반복'], '최근접 정점쌍 mm': a2['최근접 정점쌍 mm'], FIX: a2.FIX } : null,
};
writeFileSync(`gpu/oracle/export/v5-17-cross-${FIX ?? 'A'}-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
