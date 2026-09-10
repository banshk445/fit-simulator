/* v5-6 §1-② — **경계 양쪽 궤적 채널**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * 프레임 덤프(slip_probe 산출 · 위치만)를 읽어 네 채널을 낸다.
 *   ㉠ **봉제 수축률** — 어깨 이음쌍 거리의 «초기 대비» 비(1 → 0 으로 줄어야 램프가 당긴 것이다)
 *   ㉡ **봉제 간극**(λ 대체 · §0-4ㄷ) — 쌍 거리 − 그 프레임의 rest(선형 램프 식 `dressRun.ts:111-116` 인용)
 *   ㉢ **어깨 대역 접촉 정점 수** — 어깨선 `Y_TOP` 에서 암홀 깊이 `ARM_D` 만큼 내려온 띠 안에서
 *      **몸 거리 ≤ SEP** 인 옷 정점(몸 거리 = `exactBodyDist` · 부호 SDF · v4-34 자)
 *   ㉣ **어깨 봉제 y중앙** — v4-30 채널(대조용)
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… DUMPS=<폴더> PREFIX=<칸> npx tsx scripts/v5BoundaryProbe.ts`
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
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const DUMPS = process.env.DUMPS!;
const PREFIX = process.env.PREFIX!;
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
const rest0 = pairs.map(([i, j]) => Math.hypot(p0[i * 3] - p0[j * 3], p0[i * 3 + 1] - p0[j * 3 + 1], p0[i * 3 + 2] - p0[j * 3 + 2]));
const rest0Max = Math.max(...rest0);
const RAMP_N = Math.ceil((rest0Max - SEP) / (9.81 * (1 / 60) * (1 / 60)));   // dressRun.ts:111-116 인용
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const rows: Record<string, number>[] = [];
for (let f = 0; f <= 400; f += 20) {
  const path = `${DUMPS}/${PREFIX}-f${String(f).padStart(3, '0')}.bin`;
  const p = f === 0 ? p0 : (existsSync(path)
    ? new Float64Array(readFileSync(path).buffer.slice(0, sc.n * 24)) : null);
  if (!p) continue;
  const t = Math.min(1, (f + 1) / RAMP_N);
  const shrink: number[] = [], gap: number[] = [];
  pairs.forEach(([i, j], k) => {
    const d = Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
    shrink.push(rest0[k] > 1e-9 ? d / rest0[k] : 1);
    gap.push(d - (rest0[k] + (SEP - rest0[k]) * t));
  });
  let contact = 0, above = 0;
  for (let v = 0; v < sc.n; v++) {
    const y = p[v * 3 + 1];
    if (y > S.Y_TOP) above++;
    if (y <= S.Y_TOP && y >= S.Y_TOP - S.ARM_D && Math.abs(clr(p[v * 3], y, p[v * 3 + 2])) <= SEP) contact++;
  }
  rows.push({ f, '봉제 수축률 중앙': med(shrink), '봉제 간극 중앙 mm': med(gap) * 1000,
              '봉제 간극 최대 mm': Math.max(...gap) * 1000, '어깨 대역 접촉': contact, '어깨선 위 정점': above });
}
const out = { what: 'v5-6 §1-② 경계 양쪽 궤적 채널(측정만)', spec: SPEC ?? `차트 ${c.size}`, cell: CELL,
              'Y_TOP m': S.Y_TOP, 'ARM_D m': S.ARM_D, 'RAMP_N(인용식)': RAMP_N, 'SEP mm': SEP * 1000, rows };
writeFileSync(`gpu/oracle/export/v5-6-${PREFIX}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 0));
