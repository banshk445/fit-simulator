/* v4-38 §1-① — **`deriveLevels` 사실 계기**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * `src/v3/bodyLevels.ts` 가 «내보내는» 조각(`sectionSegs`·`components`·`containsAxis`·`hullPerim`)을
 * 그대로 불러 **같은 단면·같은 둘레**를 1cm 격자로 인쇄한다 — 식은 이 파일에 0줄이다.
 * 채널 — 높이별 성분 수 · 몸통 고리 유무 · 볼록껍질 둘레 C · 비몸통 성분의 |x| 대역 ·
 *        `deriveLevels` 가 실제로 내는 레벨(또는 던진 문언).
 *
 * 진입: `CELL=… [BODY_BIN=…] TAG=… npx tsx scripts/v4Levels.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sectionSegs, components, containsAxis, hullPerim, deriveLevels, GRID_M } from '../src/v3/bodyLevels.ts';

const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite });
const pos = P.prim0.pos, idx = P.bodyIdx, AXIS_Z = P.S.AXIS_Z, Y_TOP = P.S.Y_TOP;

const at = (y: number) => {
  const comps = components(sectionSegs(pos, idx, y));
  const torso = comps.find((L) => containsAxis(L, AXIS_Z));
  const off = comps.filter((L) => !containsAxis(L, AXIS_Z)).map((L) => {
    let xMin = Infinity, xMax = -Infinity;
    for (const s of L) for (const p of [s.p0, s.p1]) { const ax = Math.abs(p[0]); xMin = Math.min(xMin, ax); xMax = Math.max(xMax, ax); }
    return { n: L.length, xMin: xMin * 1000, xMax: xMax * 1000 };
  }).sort((a, b) => a.xMin - b.xMin);
  return { y, nComp: comps.length, hasTorso: !!torso, C: torso ? hullPerim(torso) * 1000 : NaN, off };
};

/* 몸 전체를 1cm 로 훑는다(판정 0 · 인쇄만) */
const scan: ReturnType<typeof at>[] = [];
for (let y = Y_TOP; y > -1; y -= GRID_M) { const a = at(y); scan.push(a); if (a.y < 0.2) break; }

let levels: unknown = null, threw: string | null = null;
try { const L = deriveLevels(pos, idx, AXIS_Z, Y_TOP);
      levels = { Y_LOW: L.Y_LOW, Y_ARM: L.Y_ARM, chestY: L.chestY, waistY: L.waistY,
                 C_chest_mm: L.C_chest * 1000, C_waist_mm: L.C_waist * 1000,
                 waistGridIx: L.waistGridIx, grid길이: L.grid.length,
                 armFirst: L.armFirst.map((a) => ({ n: a.n, xMin_mm: a.xMin * 1000, xMax_mm: a.xMax * 1000 })) }; }
catch (e) { threw = (e as Error).message; }

/* 던진 자리를 재구성한다 — `deriveLevels` 와 «같은 절차»를 따라 값을 인쇄한다(식 복제 0 · 조각 호출) */
let yA = Y_TOP;
for (; yA > -1 && !at(yA).hasTorso; yA -= GRID_M);
let yB = yA;
for (; yB > -1 && at(yB).hasTorso; yB -= GRID_M);
const Y_LOW_grid = yB + GRID_M;
let yC = NaN, yPure = NaN;
for (let y = Y_LOW_grid; y <= Y_TOP; y += GRID_M) {
  const a = at(y);
  if (a.nComp === 1 && a.hasTorso) { yPure = y; continue; }
  if (a.nComp > 1) { yC = y; break; }
}
const waistWin: { y: number; nComp: number; C: number }[] = [];
for (let y = Y_LOW_grid; y < (Number.isFinite(yPure) ? yPure : Y_TOP); y += GRID_M) {
  const a = at(y);
  if (Number.isFinite(a.C)) waistWin.push({ y, nComp: a.nComp, C: a.C });
}
const jMin = waistWin.length ? waistWin.reduce((b, q, i) => (q.C < waistWin[b].C ? i : b), 0) : -1;

const out = {
  what: 'v4-38 §1-① deriveLevels 사실(측정만)', cell: CELL, tag: TAG, bodyBin: bbPath,
  'Y_TOP m': Y_TOP, 'AXIS_Z m': AXIS_Z, '몸 정점': pos.length / 3,
  levels, throw: threw,
  '재구성': { 'Y_LOW 격자 m': Y_LOW_grid, '첫 전이 yC m': yC, '전이 직전 yPure m': yPure,
             '허리 구간 격자점': waistWin.length, 'jMin': jMin,
             'jMin 이 끝인가': jMin === 0 || jMin === waistWin.length - 1,
             '허리 구간 C mm': waistWin.map((g) => ({ y: g.y, nComp: g.nComp, C: g.C })) },
  '1cm 훑기': scan.map((a) => ({ y: a.y, nComp: a.nComp, torso: a.hasTorso, C: a.C, off: a.off })),
};
writeFileSync(`${OUT}/l3-levels-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ cell: CELL, tag: TAG, levels, throw: threw, 재구성: out['재구성'] }, null, 1).slice(0, 4000));
