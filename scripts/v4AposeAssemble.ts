/* v4-19 §1-② — **A포즈 몸으로 «조립만»**(물리 0프레임 · 굽기 0).
 *
 * 몸 = 저장소에 있는 **기본 마네킹 A포즈**(`l3ap-body-<id>-a<deg>.bin` · v4-17/18 산출).
 * ★ **몸 «정체»가 `c100-h170-s45` 가 아니다**(본 스케일은 살아있는 씬에서만 · v4-17 §1-③).
 *   그래서 이 스크립트는 **게이트·높이 판정을 하지 않는다** — 조립이 서는지/무엇이 나오는지만 낸다.
 * ★ 팔 축 인자(`SceneConfig.armAxis`)는 **넘기지 못한다** — `dressRun.prepare` 가 그 인자를 아직
 *   받지 않고, `dressRun.ts` 는 v3 동결 «예외 대장» 범위 «밖»이다(자리만 등재 · 이 판은 안 고친다).
 *   ⟹ 이 탐침은 **기본 축 ±x** 로 A포즈 몸을 조립한다(그 사실이 결과의 일부다).
 *
 * 진입: `[CELL=c100-h170-s45_M] [APOSE=…bin] npx tsx scripts/v4AposeAssemble.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';

const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const APOSE = process.env.APOSE ?? `${OUT}/l3ap-body-c100-h170-s45-a35.bin`;
const D = Number(process.env.D_MM ?? 9) / 1000;

const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const ab = readFileSync(APOSE);
const verts = new Float32Array(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
let ymin = Infinity, ymax = -Infinity;
for (let i = 1; i < verts.length; i += 3) { if (verts[i] < ymin) ymin = verts[i]; if (verts[i] > ymax) ymax = verts[i]; }

const meta: Record<string, unknown> = {
  what: 'v4-19 §1-② A포즈 몸으로 조립만(물리 0)', cell: CELL, apose: APOSE,
  몸_정점: verts.length / 3, 몸_높이m: ymax - ymin,
  '★ 몸 정체': '기본 마네킹 A포즈 — c100-h170-s45 «아님»(본 스케일 미적용 · v4-17 §1-③)',
  '★ 팔 축 인자': '넘기지 못함 — dressRun.prepare 가 armAxis 를 아직 받지 않는다(예외 범위 밖)',
};
try {
  const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                      bodyVerts: verts, minPairDistLite });
  const sc = P.sc as unknown as { n: number; cons: unknown[]; SLV_R?: number; SLV_X0?: number;
                                  s: { pos: Float64Array }; tris: number[] };
  let gap = Infinity, gapAt = -1;
  const col = P.params.collision!.colliders[0] as { kind: 'grid'; g: Parameters<typeof sampleSdf>[0] };
  const g = col.g;
  for (let v = 0; v < sc.n; v++) {
    const d0 = sampleSdf(g, sc.s.pos[v * 3], sc.s.pos[v * 3 + 1], sc.s.pos[v * 3 + 2]);
    if (d0 < gap) { gap = d0; gapAt = v; }
  }
  meta.조립 = '통과';
  meta.n = sc.n;
  meta.제약 = sc.cons.length;
  meta.substeps = P.SUB;
  meta.소매_R = sc.SLV_R ?? null;
  meta.소매_X0 = sc.SLV_X0 ?? null;
  meta['옷↔몸 최소 간격mm'] = gap * 1000;
  meta.최소간격_정점 = gapAt;
  meta.SEPmm = SEP * 1000;
  meta.최소쌍거리mm = minPairDistLite(sc.s.pos, sc.tris) * 1000;
} catch (e) {
  meta.조립 = '실패';
  meta.사유원문 = String((e as Error).message);
  meta.스택첫줄 = String((e as Error).stack ?? '').split('\n')[1]?.trim() ?? '';
}
writeFileSync(`${OUT}/l3ap-assemble-${CELL}.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
