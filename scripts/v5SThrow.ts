/* v5-23 §1-③ — **S 던짐의 «쌍과 자리»**(측정만 · `src/` 0줄 · 물리 0프레임 · 처방 0).
 *
 * 던짐 문언은 패널 이름만 준다(`garmentScene.ts:1550-1557` — `minPairDist` 의 `worst` 는 «삼각형 쌍»이고
 * `pn()` 이 패널 이름으로 접는다). 여기서는 **같은 `minPairDist` 를 그대로 불러** 그 삼각형 쌍의
 * 정점을 `(패널 · i · j)` 로 풀어 적는다 — 새 식 0.
 * 재료 = `__v3gapProbe`(던져도 이미 발화했다 · `pos`·`tris`·`panels`·`n`) 또는 던지지 않으면 `prepare` 산출.
 *
 * 진입: `[ASM1X=1] CELL=… [SPEC=…] BODY_BIN=… [ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…] [TAG=…] npx tsx scripts/v5SThrow.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Gap = { pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };
let last: Gap | null = null;
(globalThis as unknown as { __v3gapProbe?: (r: Gap) => void }).__v3gapProbe = (r) => { last = r; };

import { prepare } from '../src/v3/dressRun.ts';
import { minPairDist, minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, SEP, THICK, TOL_SELF } from '../src/v3/consts.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c87.5-h155-s40_S';
/** ★ v5-25 — `ASM1X` 를 `1|anchor|drop` 으로 받는다(`1` = 둘 다 · v5-22~24 와 항등). */
const A1 = process.env.ASM1X;
const ASM1X: boolean | 'anchor' | 'drop' | undefined =
  A1 === '1' ? true : A1 === 'anchor' ? 'anchor' : A1 === 'drop' ? 'drop' : undefined;
const TAG = process.env.TAG ?? `${A1 ?? 'off'}-${SPEC ?? CELL}`;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

let thrown: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD, bodyVerts: verts,
    minPairDistLite, armAxis: armAxisFromEnv(), ...(ASM1X ? { asm1x: ASM1X } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }

const src = P
  ? (() => { const sc = P.sc as unknown as Gap & { s: { pos: Float64Array } };
             return { pos: sc.s.pos, tris: sc.tris, panels: sc.panels, n: sc.n, 출처: 'prepare 산출' }; })()
  : last ? { ...(last as Gap), 출처: 'gapProbe(던짐 직전 장면)' } : null;

const out: Record<string, unknown> = {
  what: 'v5-23 §1-③ S 던짐의 쌍과 자리(측정만 · src 0줄 · 처방 0)',
  _args: { TAG, CELL, SPEC: SPEC ?? null, ASM1X, D_MM: D * 1000, 계기: 'v5SThrow.ts',
    BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  '등재 자': { 'SEP mm': SEP * 1000, 'THICK mm': THICK * 1000, 'TOL_SELF mm': TOL_SELF * 1000,
    '창 = SEP*2 mm': SEP * 2 * 1000 },
  던짐: thrown,
};

if (!src) { out['오류'] = 'gapProbe 도 발화하지 않았다 — 조립이 그 자리에 못 갔다'; }
else {
  const { pos, tris, panels, n } = src;
  const bases = panels.map((p) => p.base).concat([n]);
  const dims = panels.map((p, k) => ({ name: p.name, base: p.base, size: bases[k + 1] - bases[k] }));
  /** (패널 · i · j) — `at(p,i,j) = base + j*(nu+1) + i`. `nu` 는 패널 정점 수와 «행 수»로 역산한다.
   * 행 수를 모르므로 **가로 폭 후보를 약수에서 고른다**: 정점 수 = (nu+1)(nv+1) 인 가장 «가로가 큰» 분해를
   * 고르지 않고, 대신 **선형 오프셋만** 적는다(자리 표기는 오프셋 + 패널로 충분하다 · 추측 0). */
  const locOf = (v: number) => {
    for (let k = 0; k < panels.length; k++)
      if (v >= bases[k] && v < bases[k + 1]) return { pan: panels[k].name, off: v - bases[k] };
    return { pan: '?', off: -1 };
  };
  const w = minPairDist(pos, tris, SEP * 2);
  const triInfo = (t: number) => {
    if (t < 0) return null;
    const vs = [0, 1, 2].map((k) => tris[t * 3 + k]);
    return { 삼각형: t, 정점: vs.map((v) => { const L = locOf(v); return { v, ...L, ...(ij(L.off) ?? {}),
      'y mm': pos[v * 3 + 1] * 1000, 'x mm': pos[v * 3] * 1000, 'z mm': pos[v * 3 + 2] * 1000 }; }) };
  };
  /** ★ v5-25 — **격자 해독**: 몸판 정점 수 = (nuB+1)(nvB+1) 의 «두 인수»를 30~140 대역에서 찾는다.
   * 둘 다 그 대역인 분해가 하나면 확정이고, 여러 개면 후보를 전부 적는다(추측 0). */
  const body = dims.find((d) => d.name === 'back') ?? dims[0];
  const pairs: [number, number][] = [];
  for (let a = 30; a <= 140; a++) if (body.size % a === 0) {
    const b = body.size / a; if (b >= 30 && b <= 140) pairs.push([a - 1, b - 1]);
  }
  const grid = pairs.length === 1 ? { nuB: pairs[0][0], nvB: pairs[0][1] } : null;
  const ij = (off: number) => grid ? { i: off % (grid.nuB + 1), j: Math.floor(off / (grid.nuB + 1)) } : null;
  /** 제도 분할 — 던지지 않은 판본에서는 장면이 직접 준다. */
  const scAny = P ? (P.sc as unknown as Record<string, number>) : null;
  out['제도 분할'] = scAny ? { N_sh: scAny.N_sh, N_nk: scAny.N_nk, N_side: scAny.N_side,
    N_arm: scAny.N_arm, nuB: scAny.nuB, nvB: scAny.nvB } : '던져서 못 읽음(격자 해독으로 대체)';
  out['격자 해독'] = { '몸판 정점': body.size, '후보 (nuB,nvB)': pairs, 확정: grid };
  out['장면'] = { n, 출처: src.출처, 삼각형: tris.length / 3, 패널: dims };
  out['최소쌍'] = { 'min mm': w.min * 1000, hits: w.hits,
    'worst 삼각형쌍': w.worst, A: triInfo(w.worst[0]), B: triInfo(w.worst[1]) };
  /** 대역 사실 — 어느 «높이»에서 붙는가. 두 삼각형 정점의 y 범위를 낸다. */
  const ys = [w.worst[0], w.worst[1]].filter((t) => t >= 0)
    .flatMap((t) => [0, 1, 2].map((k) => pos[tris[t * 3 + k] * 3 + 1] * 1000));
  out['붙는 높이 mm'] = ys.length ? { 최소: Math.min(...ys), 최대: Math.max(...ys) } : null;
}
writeFileSync(`gpu/oracle/export/v5-23-throw-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
