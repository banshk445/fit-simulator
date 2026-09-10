/* v4-44 §1-① — **두 몸 bin 의 정점별 차이를 «부위»로 가른다**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * 대상 — A: 브라우저 하네스 산출(`gpu/oracle/export/grid27/l3ap-body-<칸>-a35.bin`)
 *        B: Node 산출 기준 몸(`gpu/oracle/export/l3ap-body-<칸>-a35.bin`)
 * 채널 — 좌표차 분포 · **전역 y 중앙 오프셋** · 오프셋 제거 후 잔차(중앙/p95/최대) ·
 *        잔차 상위 정점의 **부위**(팔/손/몸통/머리) · **옷 영역**(몸통 + 위팔) 한정 잔차.
 * 부위 경계는 **그 몸에서** 뜬다(손 상수 0) — 어깨 높이는 `deriveLevels` 의 `chestY`(= 팔 흡수 높이 · v4-39),
 * 몸통 반폭은 그 높이 단면의 |x| 최대, 밑단 아래는 `Y_LOW` 로 자른다.
 *
 * 진입: `[CELL=c100-h170-s45] [DEG=35] [GRID=gpu/oracle/export/grid27] npx tsx scripts/v4BodyDiff.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { deriveLevels, sectionSegs, components, containsAxis } from '../src/v3/bodyLevels.ts';

const BODY = process.env.CELL ?? 'c100-h170-s45';
const DEG = Number(process.env.DEG ?? 35);
const GRID = process.env.GRID ?? 'gpu/oracle/export/grid27';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const load = (p: string) => {
  const b = readFileSync(p);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const A = load(`${GRID}/l3ap-body-${BODY}-a${DEG}.bin`);        // 브라우저
const B = load(`${OUT}/l3ap-body-${BODY}-a${DEG}.bin`);          // Node 기준
if (A.length !== B.length) throw new Error(`정점 수가 다르다 — ${A.length / 3} ≠ ${B.length / 3}`);
const n = A.length / 3;

const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const stat = (a: number[]) => ({ 최소: q(a, 0), 중앙: q(a, 0.5), p95: q(a, 0.95), p99: q(a, 0.99), 최대: q(a, 1) });

/* 부위 경계를 «그 몸(Node 기준)» 에서 뜬다 */
const c = cells().find((x) => x.bodyId === BODY && x.size === 'M') ?? cells().find((x) => x.bodyId === BODY)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: B, minPairDistLite });
const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);
/* 몸통 반폭 — 어깨(=`chestY`) 단면의 몸통 고리 |x| 최대 */
const ringAt = (y: number) => {
  const comps = components(sectionSegs(P.prim0.pos, P.bodyIdx, y));
  const torso = comps.find((Lp) => containsAxis(Lp, P.S.AXIS_Z));
  let mx = 0;
  if (torso) for (const s of torso) for (const p of [s.p0, s.p1]) mx = Math.max(mx, Math.abs(p[0]));
  return mx;
};
const halfW = ringAt(L.waistY);                       // 허리 높이의 몸통 반폭(팔이 없는 높이)
const shoulderY = L.chestY;                            // 팔이 몸통에 붙는 높이(v4-39 규칙)

const dy: number[] = [], dAll: number[] = [];
for (let i = 0; i < n; i++) dy.push(A[i * 3 + 1] - B[i * 3 + 1]);
const offset = q(dy, 0.5);                             // 전역 y 중앙 오프셋(§0-4ㄷ)
type Part = '몸통' | '팔' | '손' | '머리' | '다리';
const partOf = (x: number, y: number): Part => {
  if (y < L.Y_LOW) return '다리';                       // 밑단 아래는 다리·발이다(부위 판정 «먼저»)
  if (y > shoulderY + (P.S.Y_TOP - shoulderY) * 0.5) return '머리';
  if (Math.abs(x) > halfW) return y < L.waistY ? '손' : '팔';
  return '몸통';
};
const byPart: Record<string, number[]> = {};
const res: number[] = [];
for (let i = 0; i < n; i++) {
  const ax = A[i * 3], ay = A[i * 3 + 1] - offset, az = A[i * 3 + 2];
  const d = Math.hypot(ax - B[i * 3], ay - B[i * 3 + 1], az - B[i * 3 + 2]) * 1000;
  res.push(d);
  dAll.push(Math.hypot(A[i * 3] - B[i * 3], A[i * 3 + 1] - B[i * 3 + 1], A[i * 3 + 2] - B[i * 3 + 2]) * 1000);
  const p = partOf(B[i * 3], B[i * 3 + 1]);
  (byPart[p] ??= []).push(d);
}
/* 옷 영역 = 몸통 + 팔(위팔) · 밑단 아래(다리)와 머리·손은 뺀다(§0-4ㄴ) */
const garmentIdx: number[] = [];
for (let i = 0; i < n; i++) {
  const p = partOf(B[i * 3], B[i * 3 + 1]);
  if ((p === '몸통' || p === '팔') && B[i * 3 + 1] >= L.Y_LOW) garmentIdx.push(i);
}
/* ★ 상사(相似) 정합 — 「전역 y 오프셋」 하나로 설명되는지 보려면 **배율**도 함께 재야 한다.
 * `A ≈ s·B + t`(축별 최소제곱 · 회전 0)를 풀고, 그 뒤 잔차를 다시 낸다. 손 상수 0. */
const fitAxis = (k: number) => {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const b = B[i * 3 + k], a = A[i * 3 + k]; sx += b; sy += a; sxx += b * b; sxy += b * a; }
  const den = n * sxx - sx * sx;
  const s2 = den !== 0 ? (n * sxy - sx * sy) / den : 1;
  return { scale: s2, shift: (sy - s2 * sx) / n };
};
const fit = { x: fitAxis(0), y: fitAxis(1), z: fitAxis(2) };
const res2: number[] = [];
for (let i = 0; i < n; i++) {
  const ex = fit.x.scale * B[i * 3] + fit.x.shift, ey = fit.y.scale * B[i * 3 + 1] + fit.y.shift,
        ez = fit.z.scale * B[i * 3 + 2] + fit.z.shift;
  res2.push(Math.hypot(A[i * 3] - ex, A[i * 3 + 1] - ey, A[i * 3 + 2] - ez) * 1000);
}
const byPart2: Record<string, number[]> = {};
for (let i = 0; i < n; i++) (byPart2[partOf(B[i * 3], B[i * 3 + 1])] ??= []).push(res2[i]);

const top = res.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d).slice(0, 10)
  .map((t) => ({ 정점: t.i, 잔차mm: t.d, 부위: partOf(B[t.i * 3], B[t.i * 3 + 1]),
                 y: B[t.i * 3 + 1], x: B[t.i * 3] }));

const out = {
  what: 'v4-44 §1-① 브라우저↔Node 몸 좌표차의 부위 사실', cell: BODY, deg: DEG, n,
  경계: { 'shoulderY(chestY) m': shoulderY, 'waistY m': L.waistY, 'Y_LOW m': L.Y_LOW,
         'Y_TOP m': P.S.Y_TOP, '몸통 반폭 mm': halfW * 1000 },
  '오프셋 «전» 좌표차 mm': stat(dAll),
  '전역 y 중앙 오프셋 mm': offset * 1000,
  'y 차 분포 mm': stat(dy.map((v) => v * 1000)),
  '오프셋 «후» 잔차 mm': stat(res),
  '부위별 잔차 mm': Object.fromEntries(Object.entries(byPart).map(([k, v]) => [k, { 정점: v.length, ...stat(v) }])),
  '옷 영역(몸통+팔) 잔차 mm': { 정점: garmentIdx.length, ...stat(garmentIdx.map((i) => res[i])) },
  '잔차 상위 10': top,
  '상사 정합(A ≈ s·B + t · 축별 최소제곱)': {
    x: { scale: fit.x.scale, shift_mm: fit.x.shift * 1000 },
    y: { scale: fit.y.scale, shift_mm: fit.y.shift * 1000 },
    z: { scale: fit.z.scale, shift_mm: fit.z.shift * 1000 } },
  '정합 «후» 잔차 mm': stat(res2),
  '정합 후 부위별 잔차 mm': Object.fromEntries(Object.entries(byPart2).map(([k, v]) => [k, { 정점: v.length, ...stat(v) }])),
  '정합 후 옷 영역 잔차 mm': { 정점: garmentIdx.length, ...stat(garmentIdx.map((i) => res2[i])) },
};
writeFileSync(`${OUT}/l3ap-bodydiff-${BODY}-a${DEG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
