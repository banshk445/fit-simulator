/* v5-7a §1-③ — **궤적 채널 계기**(측정만 · `src/` 물리 0줄 · 굽기 0 · 처방 0).
 *
 * v5-6 §1-③ 설계의 4채널 중 **셋을 이 계기가 «잰다»**(덤프에서) · **넷째는 «읽어 옮긴다»**(trail 에서):
 *   ㉠ **봉제 수축률** — 어깨 이음쌍 거리 ÷ 초기 거리(1 → 0 으로 줄면 램프가 당긴 것)
 *   ㉡ **봉제 간극**(λ 대체) — 쌍 거리 − 그 프레임의 rest(선형 램프 식 `dressRun.ts:111-116` 인용)
 *   ㉢ **어깨 대역 접촉 정점 수** — `Y_TOP` 아래 `ARM_D` 띠 안에서 **몸 거리 ≤ SEP** 인 옷 정점
 *   ㉣ **어깨 봉제 y중앙** — `slip_probe.py:56` 이 이미 `<칸>-trail.json` 에 프레임마다 적는다.
 *      **다시 계산하지 않고 그 파일에서 읽어 옮긴다**(함정 44 · 두 계기가 같은 양을 따로 세지 않는다).
 *
 * 덤프 형식 사실(v5-7a §1-③) — `slip_probe.py:112-113` `p.tofile(<칸>-f<프레임>.bin)` ⟹
 *   **헤더 없는 n×3 f64 원시 배열**이다(정착 blob 의 `[u32][JSON]` 포장이 «아니다»).
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… DUMPS=<폴더> PREFIX=<칸>
 *        [STEP=10] [FMAX=400] npx tsx scripts/v5TrajProbe.ts`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_L';
const DUMPS = process.env.DUMPS!;
const PREFIX = process.env.PREFIX!;
const STEP = Number(process.env.STEP ?? 10);
const FMAX = Number(process.env.FMAX ?? 400);
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite, armAxis: armAxisFromEnv() });
const S = P.S as unknown as { Y_TOP: number; ARM_D: number };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const clr = (x: number, y: number, z: number) => (sampleSdf(P.bodyG, x, y, z) < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z);

const pairs = sc.seamCons.map((s) => [s.i, s.j] as const);
const p0 = sc.s.pos;
const dist = (p: Float64Array, i: number, j: number) =>
  Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
const rest0 = pairs.map(([i, j]) => dist(p0, i, j));
const RAMP_N = Math.ceil((Math.max(...rest0) - SEP) / (9.81 * (1 / 60) * (1 / 60)));   // dressRun.ts:111-116 인용
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ㉣ — trail 에서 «읽어 옮긴다»(계산 0). 없으면 그 자리를 null 로 둔다(추정 0). */
const trailPath = process.env.TRAIL ?? `${DUMPS}/${PREFIX}-trail.json`;
const trail: Record<number, number> = {};
if (existsSync(trailPath)) {
  const t = JSON.parse(readFileSync(trailPath, 'utf8')) as { rows?: { f: number; 어깨봉제y중앙: number }[] };
  for (const r of t.rows ?? []) trail[r.f] = r.어깨봉제y중앙;
}

const rows: Record<string, number | null>[] = [];
const missing: number[] = [];
for (let f = 0; f <= FMAX; f += STEP) {
  const path = `${DUMPS}/${PREFIX}-f${String(f).padStart(3, '0')}.bin`;
  let p: Float64Array | null = null;
  if (f === 0) p = p0;
  else if (existsSync(path)) {
    const b = readFileSync(path);                       // 헤더 없는 n×3 f64
    if (b.length !== sc.n * 24) throw new Error(`덤프 길이가 다르다 — ${path} · ${b.length} ≠ ${sc.n * 24}`);
    p = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  } else { missing.push(f); continue; }
  const t = Math.min(1, (f + 1) / RAMP_N);
  const shrink: number[] = [], gap: number[] = [];
  pairs.forEach(([i, j], k) => {
    const d = dist(p!, i, j);
    shrink.push(rest0[k] > 1e-9 ? d / rest0[k] : 1);
    gap.push(d - (rest0[k] + (SEP - rest0[k]) * t));
  });
  let contact = 0, above = 0;
  for (let v = 0; v < sc.n; v++) {
    const y = p[v * 3 + 1];
    if (y > S.Y_TOP) above++;
    if (y <= S.Y_TOP && y >= S.Y_TOP - S.ARM_D && Math.abs(clr(p[v * 3], y, p[v * 3 + 2])) <= SEP) contact++;
  }
  rows.push({ f, '봉제 수축률 중앙': med(shrink), '봉제 수축률 최소': Math.min(...shrink),
              '봉제 간극 중앙 mm': med(gap) * 1000, '봉제 간극 최대 mm': Math.max(...gap) * 1000,
              '어깨 대역 접촉': contact, '어깨선 위 정점': above,
              '어깨 봉제 y중앙(trail)': f in trail ? trail[f] : null });
}
const out = { what: 'v5-7a §1-③ 궤적 채널(측정만 · ㉣ 는 trail 에서 읽어 옮김)', spec: SPEC ?? `차트 ${c.size}`,
              cell: CELL, dumps: DUMPS, prefix: PREFIX, step: STEP,
              'Y_TOP m': S.Y_TOP, 'ARM_D m': S.ARM_D, 'RAMP_N(인용식)': RAMP_N, 'SEP mm': SEP * 1000,
              'trail 파일': existsSync(trailPath) ? trailPath : null, '덤프 없는 프레임': missing, rows };
writeFileSync(`gpu/oracle/export/v5-7-traj-${PREFIX}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 0));
