/* v5-9 §1-① — **어깨 봉제의 기하**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0 · 판정 0).
 *
 * 재는 것(§0-5ㄷㄹ 정의 그대로 · 새 식 0 · 새 문턱 0):
 *   ㉠ 어깨 봉제쌍의 **거리** 와 **간극** — `gap = |p_i − p_j| − rest(f)` ·
 *      `rest(f) = f >= RAMP_N ? SEP : r0 + (SEP − r0)·(f/RAMP_N)` (`dressRun.ts:111-116` 인용)
 *      ★ **λ 가 아니다** — 이 엔진에 엣지 단위 신장 제약이 없다(v5-8 §0-5 와 같은 대체).
 *   ㉡ 봉제쌍 **중점 y**
 *   ㉢ **그 사이에 있는 것** — 선분 11등분 표본에서
 *        · 몸 SDF **부호**(`sampleSdf < 0` = 몸 «안») 인 표본 수
 *        · **소매 패널 정점**이 표본에서 `SEP` 이내인 수(패널 범위는 `v4Armpit.ts:50` 식)
 *        · **최근접 몸 정점의 팔 축 투영** `s = (p − 피벗)·방향` · `r = |(p − 피벗) − s·방향|`
 *          (피벗·방향 = `ARM_ORIGIN_JSON` 의 뼈 값 · **손 문턱 0** ⟹ 「팔/몸통」은 `s` 부호로만 적는다)
 *   ㉣ **순번** — 어깨 봉제는 `row(front, nvB, 0, N_sh)` 로 만들어져 순번 0 이 **목 쪽**,
 *      마지막이 **어깨 끝 쪽**이다(`garmentScene.ts:834` · `col/row` 정의 `:831-832`).
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… DUMPS=<폴더> PREFIX=<칸> npx tsx scripts/v5ShoulderSeam.ts`
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
const FRAMES = (process.env.FRAMES ?? '0,10,20,30,40,70,100,200').split(',').map(Number);
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const AA = armAxisFromEnv();
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite, armAxis: AA });
const S = P.S as unknown as { Y_TOP: number; ARM_D: number };
type Pan = { base: number; nu: number; nv: number };
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; seams: { name: string; a: number[]; b: number[] }[];
                                slv: Pan[]; front: Pan; back: Pan };
const n = sc.n;
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const sgn = (x: number, y: number, z: number) => (sampleSdf(P.bodyG, x, y, z) < 0 ? -1 : 1);

/* 소매 패널 정점 목록(`v4Armpit.ts:50` 식 — `[base, base+(nu+1)*(nv+1))` 연속 구간) */
const slvV: number[] = [];
for (const p of sc.slv) for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++) slvV.push(v);

/* 피벗·방향 — 자산의 뼈 값(§0-2ㄹ). 없으면 그 채널을 «불가»로 적는다(추정 0). */
const piv = AA?.pivot, dir = AA ? { left: AA.left, right: AA.right } : undefined;

const rest0All: number[] = [];
const groups = sc.seams.map((sm) => ({ name: sm.name, a: sm.a, b: sm.b }));
const seg = (p: Float64Array, i: number, j: number) =>
  Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
for (const g of groups) for (let k = 0; k < g.a.length; k++) rest0All.push(seg(sc.s.pos, g.a[k], g.b[k]));
const RAMP_N = Math.ceil((Math.max(...rest0All) - SEP) / (9.81 * (1 / 60) * (1 / 60)));
const restAt = (r0: number, f: number) => (f >= RAMP_N ? SEP : r0 + (SEP - r0) * (f / RAMP_N));
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/* 그룹별 rest0 (같은 순서) */
let acc = 0;
const gRest0 = groups.map((g) => { const r = rest0All.slice(acc, acc + g.a.length); acc += g.a.length; return r; });

const shIdx = groups.map((g, k) => (g.name.startsWith('어깨') ? k : -1)).filter((k) => k >= 0);

/** 한 봉제쌍의 «사이에 있는 것» — 선분 11등분 표본. */
function between(p: Float64Array, i: number, j: number) {
  let inBody = 0, minClr = Infinity, slvNear = 0;
  let nb = { d: Infinity, s: NaN, r: NaN, y: NaN, x: NaN };
  for (let t = 0; t <= 10; t++) {
    const u = t / 10;
    const x = p[i * 3] + (p[j * 3] - p[i * 3]) * u;
    const y = p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * u;
    const z = p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * u;
    const clr = sgn(x, y, z) * bd.exactBodyDist(x, y, z);
    if (clr < 0) inBody++;
    if (Math.abs(clr) < Math.abs(minClr)) minClr = clr;
    for (const v of slvV) {
      if (v === i || v === j) continue;
      const d = Math.hypot(p[v * 3] - x, p[v * 3 + 1] - y, p[v * 3 + 2] - z);
      if (d <= SEP) { slvNear++; break; }
    }
    /* 최근접 «몸» 정점 — 표본 전체에서 가장 가까운 하나를 남긴다 */
    const bp = P.prim0.pos;
    for (let v = 0; v < bp.length / 3; v++) {
      const d = Math.hypot(bp[v * 3] - x, bp[v * 3 + 1] - y, bp[v * 3 + 2] - z);
      if (d < nb.d) {
        const side = bp[v * 3] >= 0 ? 'left' : 'right';
        let s = NaN, r = NaN;
        if (piv && dir) {
          const q = piv[side], dd = dir[side];
          const wx = bp[v * 3] - q[0], wy = bp[v * 3 + 1] - q[1], wz = bp[v * 3 + 2] - q[2];
          s = wx * dd[0] + wy * dd[1] + wz * dd[2];
          r = Math.hypot(wx - s * dd[0], wy - s * dd[1], wz - s * dd[2]);
        }
        nb = { d, s, r, y: bp[v * 3 + 1], x: bp[v * 3] };
      }
    }
  }
  return { '몸안 표본': inBody, '최소 여유 mm': minClr * 1000, '소매 근접 표본': slvNear,
           '최근접 몸 거리 mm': nb.d * 1000, '팔축 s mm': nb.s * 1000, '팔축 r mm': nb.r * 1000,
           '최근접 몸 y m': nb.y, '최근접 몸 x m': nb.x };
}

const rows: Record<string, unknown>[] = [];
const perPair: Record<string, unknown>[] = [];
/* v5-9 §1-③ — **정착 상태 진입**(추가 인자 · 기본값 불변 ⟹ 덤프 경로는 종전 그대로).
 * `POS=<파일>` 이 있으면 그 상태를 프레임 **9999**(램프 «뒤» ⟹ `rest = SEP`)로 한 번 더 잰다.
 * 굽기 산출에는 덤프가 없고 최종 `.bin` 만 있다(램프 순서 진단 칸). 측정 로직은 0줄 바뀌지 않는다. */
const POSF = process.env.POS ?? null;
for (const f of POSF ? [...FRAMES, 9999] : FRAMES) {
  const path = `${DUMPS}/${PREFIX}-f${String(f).padStart(3, '0')}.bin`;
  const p = f === 0 ? sc.s.pos
    : f === 9999
      ? new Float64Array(readFileSync(POSF!).buffer.slice(0, n * 24))
      : (existsSync(path) ? new Float64Array(readFileSync(path).buffer.slice(0, n * 24)) : null);
  if (!p) continue;
  for (const k of shIdx) {
    const g = groups[k], r0 = gRest0[k];
    const dist: number[] = [], gap: number[] = [], midy: number[] = [];
    for (let q = 0; q < g.a.length; q++) {
      const d = seg(p, g.a[q], g.b[q]);
      dist.push(d * 1000);
      gap.push((d - restAt(r0[q], f)) * 1000);
      midy.push((p[g.a[q] * 3 + 1] + p[g.b[q] * 3 + 1]) / 2);
    }
    rows.push({ f, 그룹: g.name, 쌍: g.a.length, 'rest(f) mm': restAt(Math.max(...r0), f) * 1000,
                '거리 중앙 mm': med(dist), '거리 최대 mm': Math.max(...dist),
                '간극 중앙 mm': med(gap), '간극 최대 mm': Math.max(...gap),
                '간극 최대 순번': gap.indexOf(Math.max(...gap)), '중점 y 중앙 m': med(midy),
                '중점 y 최소 m': Math.min(...midy), '중점 y 최대 m': Math.max(...midy) });
    /* 순번별 — 요청된 프레임에서만(값 전량) */
    if (f === 0 || f === 30 || f === 100 || f === 200 || f === 9999) {
      for (let q = 0; q < g.a.length; q++) {
        const row: Record<string, unknown> = { f, 그룹: g.name, 순번: q, '거리 mm': dist[q], '간극 mm': gap[q],
          '중점 y m': midy[q], 'x_i m': p[g.a[q] * 3], 'rest0 mm': r0[q] * 1000 };
        if (f === 0 || f === 100 || f === 9999) Object.assign(row, between(p, g.a[q], g.b[q]));
        perPair.push(row);
      }
    }
  }
}
const _args = { BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
  ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null, SPEC: SPEC ?? null, CELL, DUMPS, PREFIX,
  D_MM: process.env.D_MM ?? null, FRAMES: FRAMES.join(','), POS: POSF,
  계기: import.meta.url.split('/').pop() };
const out = { what: 'v5-9 §1-① 어깨 봉제 기하(측정만 · 판정 0)', _args,
  'Y_TOP m': S.Y_TOP, 'ARM_D m': S.ARM_D, RAMP_N, SEP, n,
  '봉제 그룹': groups.map((g, k) => ({ name: g.name, 쌍: g.a.length,
    'rest0 최소 mm': Math.min(...gRest0[k]) * 1000, 'rest0 최대 mm': Math.max(...gRest0[k]) * 1000 })),
  '소매 정점 수': slvV.length, 피벗: piv ?? null, rows, perPair };
writeFileSync(`gpu/oracle/export/v5-9-shoulder-${process.env.OUTTAG ?? PREFIX}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, perPair: `${perPair.length}행(파일)`, rows }, null, 1));
