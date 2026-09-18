/* v5-26 §1-① — **임의 상태의 교차 전수 열거와 «자리»**(측정만 · `src/` 0줄 · 처방 0).
 *
 * `POS` 가 있으면 그 정착 blob 을, 없으면 f0 조립을 본다. 격자 폭은 **제도 분할에서 직접 읽는다**
 * (`sc.nuB`·`sc.nvB` · 역산 0). 교차 판정은 `instruments.ts` 의 `triTriHit` 이고 후보 생성은
 * `minPairDist` 의 격자 방식 그대로다(새 식 0).
 *
 * 진입: `[ASM1X=1|anchor|drop] [POS=<blob>] CELL=… [SPEC=…] BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…
 *        [TAG=…] npx tsx scripts/v5CrossAt.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { minPairDist, minPairDistLite, triTriHit, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const A1 = process.env.ASM1X;
const ASM1X: boolean | 'anchor' | 'drop' | undefined =
  A1 === '1' ? true : A1 === 'anchor' ? 'anchor' : A1 === 'drop' ? 'drop' : undefined;
const POS = process.env.POS;
const TAG = process.env.TAG ?? `${A1 ?? 'off'}-${SPEC ?? CELL}${POS ? '-정착' : '-f0'}`;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);

let thrown: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: armAxisFromEnv(), ...(ASM1X ? { asm1x: ASM1X } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }

const out: Record<string, unknown> = {
  what: 'v5-26 §1-① 교차 전수 열거와 자리(측정만 · src 0줄 · 처방 0)',
  _args: { TAG, CELL, SPEC: SPEC ?? null, ASM1X: A1 ?? null, POS: POS ?? null, D_MM: D * 1000,
    계기: 'v5CrossAt.ts', BODY_BIN: process.env.BODY_BIN ?? null,
    ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null, ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  던짐: thrown,
};

if (P) {
  const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; tris: number[];
    panels: { name: string; base: number; nu: number; nv: number }[];
    nuB: number; nvB: number; N_sh: number; N_nk: number; N_side: number; N_arm: number; N_und: number; nuS: number };
  let pos = sc.s.pos, 상태 = 'f0 조립';
  if (POS) {
    const raw = readFileSync(POS);
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    if (raw.byteLength !== sc.n * 24) throw new Error(`blob 길이 ${raw.byteLength} ≠ n*24 ${sc.n * 24}`);
    pos = new Float64Array(ab); 상태 = '정착 blob';
  }
  const tris = sc.tris, T = tris.length / 3;
  const bases = sc.panels.map((p) => p.base).concat([sc.n]);
  const locOf = (v: number) => {
    for (let k = 0; k < sc.panels.length; k++)
      if (v >= bases[k] && v < bases[k + 1]) {
        const p = sc.panels[k], q = v - bases[k];
        return { pan: p.name, i: q % (p.nu + 1), j: Math.floor(q / (p.nu + 1)) };
      }
    return { pan: '?', i: -1, j: -1 };
  };
  const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });

  /* ── 격자 후보 + 전수 열거(minPairDist 방식 그대로) ── */
  const cs = Math.max(SEP * 2 * 2, 0.01);
  const key = (a: number, b: number, cc: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (cc + 4096);
  const shares = (a: number, b: number) => {
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (tris[a * 3 + x] === tris[b * 3 + y]) return true;
    return false;
  };
  const box = new Float64Array(T * 6);
  for (let t = 0; t < T; t++) {
    const o = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
    for (let k = 0; k < 3; k++) {
      box[t * 6 + k] = Math.min(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
      box[t * 6 + 3 + k] = Math.max(pos[o[0] + k], pos[o[1] + k], pos[o[2] + k]);
    }
  }
  const grid = new Map<number, number[]>();
  for (let t = 0; t < T; t++) {
    const i0 = Math.floor(box[t * 6] / cs), i1 = Math.floor(box[t * 6 + 3] / cs);
    const j0 = Math.floor(box[t * 6 + 1] / cs), j1 = Math.floor(box[t * 6 + 4] / cs);
    const k0 = Math.floor(box[t * 6 + 2] / cs), k1 = Math.floor(box[t * 6 + 5] / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const kk = key(i, j, k); let arr = grid.get(kk); if (!arr) grid.set(kk, (arr = [])); arr.push(t);
    }
  }
  const seen = new Set<number>();
  const hits: Record<string, unknown>[] = [];
  for (const arr of grid.values())
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const s0 = arr[a], t1 = arr[b];
      const pk = s0 < t1 ? s0 * 1e7 + t1 : t1 * 1e7 + s0;
      if (seen.has(pk)) continue; seen.add(pk);
      if (shares(s0, t1)) continue;
      if (!triTriHit(pos, [tris[s0 * 3], tris[s0 * 3 + 1], tris[s0 * 3 + 2]],
                          [tris[t1 * 3], tris[t1 * 3 + 1], tris[t1 * 3 + 2]])) continue;
      const info = (t: number) => ({ 삼각형: t, 정점: [0, 1, 2].map((k) => {
        const v = tris[t * 3 + k]; const L = locOf(v);
        return { v, ...L, 'y mm': pos[v * 3 + 1] * 1000, 'x mm': pos[v * 3] * 1000, 'z mm': pos[v * 3 + 2] * 1000,
          '몸거리 mm': bd.exactBodyDist(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]) * 1000 };
      }) });
      hits.push({ A: info(s0), B: info(t1) });
    }
  const mp = minPairDist(pos, tris, SEP * 2);
  out['상태'] = 상태;
  out['제도 분할'] = { nuB: sc.nuB, nvB: sc.nvB, N_sh: sc.N_sh, N_nk: sc.N_nk, N_side: sc.N_side,
    N_arm: sc.N_arm, N_und: sc.N_und, nuS: sc.nuS, n: sc.n, 삼각형: T };
  out['minPairDist'] = { 'min mm': mp.min * 1000, hits: mp.hits, worst: mp.worst };
  out['교차 쌍 수(전수)'] = hits.length;
  out['교차 쌍'] = hits;
}
writeFileSync(`gpu/oracle/export/v5-26-cross-${TAG}.json`, JSON.stringify(out, null, 1));
const brief = { ...out }; if (Array.isArray(brief['교차 쌍']) && (brief['교차 쌍'] as unknown[]).length > 3)
  brief['교차 쌍'] = (brief['교차 쌍'] as unknown[]).slice(0, 3);
console.log(JSON.stringify(brief, null, 1));
