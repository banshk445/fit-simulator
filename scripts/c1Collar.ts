/* C1 §3① — **옷깃 채널 G3**(측정만 · `src/` 0줄 · 굽기 0 · 처방 0).
 *
 * 발주문 §1 G3 의 세 항을 «몸에서 유도한 자리»에 그대로 잰다(새 수 0 · 문턱은 부호뿐):
 *   (a) **링 중심 y − 몸 목 밑동 링 y ≤ 0** — 링 = 맨 윗행(`nvB`)의 목선 토막(`i ∈ [N_sh, N_sh+N_nk]`) ·
 *       몸 목 밑동 = `S.Y_NECK`(`neckBaseY()` 산출 · 몸에서 뜬 값).
 *   (b) **구간 자기 근접쌍(`SEP − TOL_SELF`) = 0** — 구간 = 「어깨선 `Y_TOP` 위 정점」 ∪ 「맨 윗행 전량」 ·
 *       쌍에서 **삼각형을 공유하는 이웃**과 **봉제쌍**(rest = `SEP`)은 뺀다.
 *   (c) **구간 정점의 어깨선 초과 높이 최대**(`max(y − Y_TOP)`) — off 같은 칸 값과 나란히 놓는다(비교는 회차가).
 * 함께 내는 것 — 구간 크기 · 링 최저 y · 몸 관통 밴드 밖 정점 수(G1 의 그 자).
 *
 * 진입: `[SPEC=…] CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… [ASM1X=1] [POS=<정착 bin>]
 *        [LABEL=…] [OUT=<json>] npx tsx scripts/c1Collar.ts`
 *   `POS` 가 없으면 **f0(조립 직후)** 를 잰다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, TOL_SELF } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const ASM1X = process.env.ASM1X === '1';
const C1VAR = process.env.C1VAR;   // ★ C1 계열
const LABEL = process.env.LABEL ?? (SPEC ?? CELL);
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite, armAxis: armAxisFromEnv(), ...(ASM1X ? { asm1x: true } : {}), ...(C1VAR ? { c1Var: C1VAR } : {}) } as never);
const S = P.S as unknown as { Y_TOP: number; Y_NECK: number };
const sc = P.sc as unknown as {
  n: number; s: { pos: Float64Array }; tris: number[]; seamCons: { i: number; j: number }[];
  N_sh: number; N_nk: number; nvB: number; front: { base: number; nu: number }; back: { base: number; nu: number };
  at: (p: unknown, i: number, j: number) => number };

/* 위치 — `POS` 가 있으면 정착 상태(f64 3n), 없으면 f0. */
let pos = sc.s.pos;
if (process.env.POS) {
  /* 두 포장을 다 받는다 — ㄱ 워커 산출(`p.tofile`)은 **헤더 없는 f64 3n** ·
   * ㄴ 정본 주입 blob 은 `[u32 헤더길이][JSON][pos f64 3n][vel f64 3n]`(v4-49 형식). */
  const pb = readFileSync(process.env.POS);
  let off = 0;
  if (pb.length % 8 !== 0 || pb.length < sc.n * 24) {
    const hl = pb.readUInt32LE(0);
    JSON.parse(pb.subarray(4, 4 + hl).toString('utf8'));     // 헤더가 아니면 여기서 던진다
    off = 4 + hl;
  }
  const raw = pb.subarray(off);
  if (raw.length < sc.n * 24) throw new Error(`POS 길이가 짧다 — ${raw.length} < ${sc.n * 24}(정점 ${sc.n})`);
  const cp = Buffer.from(raw.subarray(0, sc.n * 24));        // 정렬 보장(자체 버퍼로 복사)
  pos = new Float64Array(cp.buffer, cp.byteOffset, sc.n * 3);
}
const mm = (x: number) => x * 1000;
const at = (pan: { base: number; nu: number }, i: number, j: number) => pan.base + j * (pan.nu + 1) + i;

/* (a) 목선 링 — 맨 윗행의 목선 토막(앞·뒤) */
const ring: number[] = [];
for (const pan of [sc.front, sc.back])
  for (let i = sc.N_sh; i <= sc.N_sh + sc.N_nk; i++) ring.push(at(pan, i, sc.nvB));
const ringY = ring.map((v) => pos[v * 3 + 1]);
const ringMid = ringY.reduce((a, b) => a + b, 0) / ringY.length;

/* 구간 — 「어깨선 위」 ∪ 「맨 윗행 전량」(몸에서 유도한 자리 · 손 상수 0) */
const zone = new Set<number>();
for (let v = 0; v < sc.n; v++) if (pos[v * 3 + 1] > S.Y_TOP) zone.add(v);
for (const pan of [sc.front, sc.back]) for (let i = 0; i <= pan.nu; i++) zone.add(at(pan, i, sc.nvB));
const Z = [...zone];

/* 이웃(삼각형 공유)·봉제쌍은 근접쌍에서 뺀다 */
const skip = new Set<number>();
const key = (a: number, b: number) => (a < b ? a * 1e7 + b : b * 1e7 + a);
for (let t = 0; t + 2 < sc.tris.length; t += 3) {
  const [x, y, z] = [sc.tris[t], sc.tris[t + 1], sc.tris[t + 2]];
  skip.add(key(x, y)); skip.add(key(y, z)); skip.add(key(x, z));
}
for (const s of sc.seamCons) skip.add(key(s.i, s.j));

const LIM = SEP - TOL_SELF;                       // 1.9 mm — v5-27 §1-① 이 등재한 그 자(새 수 0)
let near = 0, nearMin = Infinity, nearAt = '';
for (let a = 0; a < Z.length; a++)
  for (let b = a + 1; b < Z.length; b++) {
    const u = Z[a], v = Z[b];
    if (skip.has(key(u, v))) continue;
    const dx = pos[u * 3] - pos[v * 3], dy = pos[u * 3 + 1] - pos[v * 3 + 1], dz = pos[u * 3 + 2] - pos[v * 3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < LIM * LIM) { near++; if (d2 < nearMin) { nearMin = d2; nearAt = `${u}↔${v}`; } }
  }

/* (c) 어깨선 초과 높이 · 밴드 밖 정점(G1 의 자) */
let over = -Infinity, overAt = -1;
for (const v of Z) { const h = pos[v * 3 + 1] - S.Y_TOP; if (h > over) { over = h; overAt = v; } }
const band = (P.sdfSpec as { band: number }).band;
let outBand = 0, penMax = 0;
for (let v = 0; v < sc.n; v++) {
  const sd = sampleSdf(P.bodyG, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
  const pen = Math.max(0, -sd);
  if (pen > penMax) penMax = pen;
  if (pen > band) outBand++;
}

const out = { what: 'C1 G3 옷깃 채널(측정만 · 몸 유도 · 문턱 부호뿐)', label: LABEL, cell: CELL, spec: SPEC ?? null,
  asm1x: ASM1X, pos: process.env.POS ?? 'f0', n: sc.n,
  'Y_TOP mm': mm(S.Y_TOP), 'Y_NECK mm': mm(S.Y_NECK),
  'G3(a) 링 중심 y mm': mm(ringMid), 'G3(a) 링 최저 y mm': mm(Math.min(...ringY)),
  'G3(a) 링중심 − Y_NECK mm': mm(ringMid - S.Y_NECK), 'G3(a) 통과(≤0)': ringMid - S.Y_NECK <= 0,
  '구간 정점 수': Z.length, 'G3(b) 근접쌍 수': near, 'G3(b) 최소 쌍거리 mm': Number.isFinite(nearMin) ? mm(Math.sqrt(nearMin)) : null,
  'G3(b) 최소쌍 자리': nearAt || null, 'G3(b) 통과(=0)': near === 0,
  'G3(c) 어깨선 초과 최대 mm': mm(over), 'G3(c) 최대 자리 정점': overAt,
  '밴드 mm': mm(band), '밴드 밖 정점': outBand, '최대 침투 mm': mm(penMax) };
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
