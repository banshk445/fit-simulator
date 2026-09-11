/* v5-12 §1-② — **조립 2세대 f0 채널**(측정만 · 조립 코드 0줄 · 물리 0프레임 · 판정 0).
 *
 * 재는 것(설계서 ⑤ §1-② 의 5종 + 이 판이 더한 사실 2종):
 *   ㉠ 목선 링 둘레와 `링/ringRest`      (닫힌 고리 · `s4Gate.ts:118-123` 정의 · v5-8·v5-10 과 같은 자)
 *   ㉡ 어깨 봉제쌍 거리(최대·중앙)        (「이미 닫힌 상태」 = 0 이어야 한다)
 *   ㉢ 몸 여유(최소·음수 개수·중앙)        (`sampleSdf` 부호 × `exactBodyDist` · 몸판 정점 전부)
 *   ㉣ 하위 행 엣지 신장률(중앙·최대)      (3D 거리 / 2D 패턴 거리 · 열 방향 엣지 전부)
 *   ㉤ 자기관통 교차 대체 = 최소 쌍거리    (`minPairDistLite` — 조립이 이미 쓰는 그 계기)
 *   ㉥ **S4 수렴**                        (`__asm2Probe` 인쇄 훅 수신 · 반복 수·최대이동 궤적)
 *   ㉦ **배치된 3D 어깨 반폭 ↔ `SW/2`**    (S2 가 「링 `|x|` 최대」를 쓰므로 SW 가 3D 폭을 정하지 않는다 —
 *                                          그 사실을 값으로 낸다 · v5-12 §0-2② 처분)
 *
 * 진입: `[ASM2=1] SPEC=… CELL=… [BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=…] npx tsx scripts/v5Asm2Probe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Probe = Record<string, unknown>;
let asm2Probe: Probe | null = null;
(globalThis as unknown as { __asm2Probe?: (r: Probe) => void }).__asm2Probe = (r) => { asm2Probe = r; };

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const ASM2 = process.env.ASM2 === '1';
const FIX = (process.env.ASM2FIX === 'A' || process.env.ASM2FIX === 'B') ? process.env.ASM2FIX : undefined;
const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
/* ★ 조립은 **기존 자기검사에서 던질 수 있다**(`옷 자기 간격 SEP 미달`). 그 경우에도
 * `redrapeAsm2` 의 인쇄 훅은 **이미 발화했다**(assemble 안에서 돈다) ⟹ 던짐 문언과 훅 값을
 * 함께 낸다(추정 0 · 배치를 고치지 않는다 — 사전 등재 갈래 B 의 자리다). */
let THROWN: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: armAxisFromEnv(), ...(ASM2 ? { asm2: true } : {}),
    ...(FIX ? { asm2Fix: FIX } : {}) } as never);
} catch (e) {
  THROWN = String((e as Error).message).replace(/\s+/g, ' ');
}
if (!P) {
  const out0 = { what: 'v5-12 §1-② 조립 2세대 f0 채널 — **조립이 던졌다**(측정만 · 판정 0)',
    _args: { ASM2: ASM2 ? 1 : 0, SPEC: SPEC ?? null, CELL, 계기: import.meta.url.split('/').pop() },
    치수: { 'SW cm': GD.SW * 100, 'W cm': GD.W * 100, 'L cm': GD.L * 100 },
    던짐: THROWN, S4: asm2Probe };
  writeFileSync(`gpu/oracle/export/v5-12-asm2-${ASM2 ? 'on' : 'off'}${FIX ?? ''}-${SPEC ?? CELL}.json`, JSON.stringify(out0, null, 1));
  console.log(JSON.stringify(out0, null, 1));
  process.exit(0);
}
type Pan = { base: number; nu: number; nv: number; uv: Float64Array };
const S = P!.S as unknown as { at: (p: Pan, i: number, j: number) => number; Y_TOP: number; Y_NECK: number };
const sc = P!.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float64Array; tris: number[];
  front: Pan; back: Pan; nuB: number; nvB: number; seams: { name: string; a: number[]; b: number[] }[] };
const pos = sc.s.pos;
const bd = makeBodyDistance({ pos: P!.prim0.pos, idx: P!.bodyIdx, bodyG: P!.bodyG, h: P!.sdfSpec.h, thick: THICK });
const clr = (x: number, y: number, z: number) => (sampleSdf(P!.bodyG, x, y, z) < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const seg = (i: number, j: number) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);

/* ㉠ 목선 링 */
const ring = [...(P!.neckF as number[]), ...[...(P!.neckB as number[])].reverse()];
let ringLen = 0;
for (let q = 0; q < ring.length; q++) ringLen += seg(ring[q], ring[(q + 1) % ring.length]);

/* ㉡ 어깨 봉제쌍 */
const shD: number[] = [];
for (const sm of sc.seams) if (sm.name.startsWith('어깨'))
  for (let k = 0; k < sm.a.length; k++) shD.push(seg(sm.a[k], sm.b[k]) * 1000);

/* ㉢ 몸 여유 — 몸판(front·back) 정점 전부 */
const bodyV: number[] = [];
for (const pan of [sc.front, sc.back])
  for (let j = 0; j <= pan.nv; j++) for (let i = 0; i <= pan.nu; i++) bodyV.push(S.at(pan, i, j));
const cl = bodyV.map((v) => clr(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]) * 1000);

/* ㉣ 하위 행 엣지 신장 — 열 방향 엣지 전부 */
const str: { r: number; i: number; j: number; pan: string }[] = [];
for (const [nm, pan] of [['front', sc.front], ['back', sc.back]] as const)
  for (let i = 0; i <= pan.nu; i++) for (let j = 0; j < pan.nv; j++) {
    const a = S.at(pan, i, j + 1), b = S.at(pan, i, j);
    const ka = (j + 1) * (pan.nu + 1) + i, kb = j * (pan.nu + 1) + i;
    const d2 = Math.hypot(pan.uv[ka * 2] - pan.uv[kb * 2], pan.uv[ka * 2 + 1] - pan.uv[kb * 2 + 1]);
    if (d2 > 1e-12) str.push({ r: seg(a, b) / d2, i, j, pan: nm });
  }
const rr = str.map((x) => x.r);
const worst = str.reduce((a, b) => (b.r > a.r ? b : a));

/* ㉦ 배치된 3D 어깨 반폭 — 상단 행 어깨 토막의 |x| 최대 */
let shHalf = 0;
for (const pan of [sc.front, sc.back])
  for (let i = 0; i <= sc.nuB; i++) {
    const v = S.at(pan, i, sc.nvB);
    shHalf = Math.max(shHalf, Math.abs(pos[v * 3]));
  }

const out = { what: 'v5-12 §1-② 조립 2세대 f0 채널(측정만 · 판정 0)',
  _args: { ASM2: ASM2 ? 1 : 0, SPEC: SPEC ?? null, CELL, BODY_BIN: process.env.BODY_BIN ?? null,
    ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null, ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null,
    D_MM: process.env.D_MM ?? null, 계기: import.meta.url.split('/').pop() },
  치수: { 'SW cm': GD.SW * 100, 'W cm': GD.W * 100, 'L cm': GD.L * 100 },
  n: sc.n, 'Y_TOP m': S.Y_TOP, 'Y_NECK m': S.Y_NECK,
  '목선 링 cm': ringLen * 100, 'ringRest cm': P!.ringRest * 100, '링/rest': ringLen / P!.ringRest,
  '어깨 봉제쌍': { 수: shD.length, '거리 최대 mm': Math.max(...shD), '거리 중앙 mm': med(shD) },
  '몸 여유 mm': { 정점: cl.length, 최소: Math.min(...cl), 중앙: med(cl),
    '음수 개수': cl.filter((x) => x < 0).length, 'SEP 미만 개수': cl.filter((x) => x < SEP * 1000).length,
    '관통 깊이 최대': cl.some((x) => x < 0) ? -Math.min(...cl) : 0 },
  '하위행 엣지 신장': { 엣지: rr.length, 중앙: med(rr), 최대: Math.max(...rr),
    '최대 자리': { 패널: worst.pan, i: worst.i, j: worst.j }, '2 초과': rr.filter((x) => x > 2).length },
  '최소 쌍거리 mm': minPairDistLite(pos, sc.tris) * 1000,
  '배치 어깨 반폭 cm': shHalf * 100, 'SW/2 cm': (GD.SW / 2) * 100, '반폭 − SW/2 mm': (shHalf - GD.SW / 2) * 1000,
  RAMP_N: (P as unknown as { RAMP_N: number }).RAMP_N, S4: asm2Probe, 던짐: THROWN };
writeFileSync(`gpu/oracle/export/v5-12-asm2-${ASM2 ? 'on' : 'off'}${FIX ?? ''}-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
