/* v4-28 §1-②③ — **`fitSleeve` 사실 계기**(로직 0줄 · 굽기 0 · 판정 0).
 *
 * ② R 탐색 «전 궤적» — 회차마다 (x0, R, min) 과 **항별 최솟값**(몸 SDF / 몸판 기둥 / 소매 자기쌍),
 *   그리고 각 항의 **최솟값 표본점 좌표**를 담는다. 부위 분류는 **옷 치수에서** 뜬다(§0-4ㄷ · 손 상수 0):
 *     팔 = |x| > W/2 · 겨드랑이 = |x| ≤ W/2 이고 |y − Y_ARM(세계)| ≤ ARM_D · 몸통 = 나머지
 * ③ 가상 관 — R 을 인자로 «강제»해 같은 검사를 판정만 돌리고, 위반 항·부위·깊이를 낸다.
 *
 * 진입: `CELL=… BODY_BIN=… [ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…] [RFORCE=0.061510] [TAG=…] npx tsx scripts/v4SleeveTrace.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sleeveTrace } from '../src/v3/garmentScene.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const RFORCE = process.env.RFORCE ? Number(process.env.RFORCE) : null;
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

sleeveTrace.on = true;                                   // ← 계기 켜기(값 불변 · §0-4ㄴ)
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite, armAxis: armAxisFromEnv() });
const dims = sleeveTrace.dims!;
const yArmWorld = dims.Y_TOP - (dims.L - dims.Y_ARM);
/** §0-4ㄷ — 옷 치수에서 뜬 부위 분류(손 상수 0). */
const part = (x: number, y: number) =>
  Math.abs(x) > dims.W / 2 ? '팔'
  : Math.abs(y - yArmWorld) <= dims.ARM_D ? '겨드랑이' : '몸통';

const calls = sleeveTrace.calls.map((r) => ({
  x0: r.x0, R: r.R, min: r.min, minBody: r.minBody, minCol: r.minCol, minSelf: r.minSelf,
  '실패항': r.min === r.minBody ? '몸SDF' : r.min === r.minCol ? '몸판기둥' : r.min === r.minSelf ? '소매자기쌍' : '?',
  '몸SDF 최소점': { xyz: r.argBody.slice(0, 3), 부위: part(r.argBody[0], r.argBody[1]) },
  '몸판기둥 최소점': Number.isFinite(r.minCol)
    ? { xyz: r.argCol.slice(0, 3), 부위: part(r.argCol[0], r.argCol[1]) } : null,
}));
const tally = (key: '몸SDF 최소점' | '몸판기둥 최소점') => {
  const t: Record<string, number> = {};
  for (const r of calls) { const p = (r[key] as { 부위: string } | null)?.부위; if (p) t[p] = (t[p] ?? 0) + 1; }
  return t;
};
const failTally: Record<string, number> = {};
for (const r of calls) failTally[r['실패항']] = (failTally[r['실패항']] ?? 0) + 1;

/* ③ 가상 관 — R 을 강제해 «판정만» 돌린다(조립·굽기 0). */
let forced: unknown = null;
if (RFORCE && sleeveTrace.probe) {
  sleeveTrace.all = true; sleeveTrace.samples.length = 0;
  const x0 = calls.length ? calls[calls.length - 1].x0 : dims.SW / 2;
  const min = sleeveTrace.probe(x0, RFORCE);
  const s = sleeveTrace.samples;
  const viol = s.filter((p) => p.body < SEP || p.col < SEP).map((p) => ({
    ...p, 부위: part(p.x, p.y),
    '위반항': Math.min(p.body, p.col) === p.body ? '몸SDF' : '몸판기둥',
    '깊이mm': (SEP - Math.min(p.body, p.col)) * 1000,
  }));
  const byPart: Record<string, number> = {}, byTerm: Record<string, number> = {};
  for (const v of viol) { byPart[v.부위] = (byPart[v.부위] ?? 0) + 1; byTerm[v['위반항']] = (byTerm[v['위반항']] ?? 0) + 1; }
  const dep = viol.map((v) => v['깊이mm']).sort((a, b) => a - b);
  const q = (f: number) => (dep.length ? dep[Math.min(dep.length - 1, Math.floor(f * dep.length))] : NaN);
  forced = { R: RFORCE, x0, min, 표본: s.length, 위반: viol.length, 부위별: byPart, 항별: byTerm,
             '깊이mm': { 최소: dep[0], p25: q(0.25), 중앙: q(0.5), p75: q(0.75), 최대: dep[dep.length - 1] },
             '위반 표본 앞5': viol.slice(0, 5) };
}

const out = { what: 'v4-28 §1-②③ fitSleeve 계기(로직 0줄 · 굽기 0)', cell: CELL, tag: TAG, bodyBin: bbPath,
  축: armAxisFromEnv() ?? '(기본 +x)', PLACE_SIG: P.S.PLACE_SIG, SEPmm: SEP * 1000,
  치수: { ...dims, 'Y_ARM(세계)': yArmWorld }, '탐색 회차': calls.length,
  '실패항 분포': failTally, '몸SDF 최소점 부위 분포': tally('몸SDF 최소점'),
  '몸판기둥 최소점 부위 분포': tally('몸판기둥 최소점'), 궤적: calls, 가상관: forced };
writeFileSync(`${OUT}/l3ap-sleeve-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, 궤적: `${calls.length}회차(파일에)`,
  가상관: forced ? { ...(forced as Record<string, unknown>), '위반 표본 앞5': '(파일에)' } : null }, null, 1));
