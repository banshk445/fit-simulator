/* v5-18 §1-①③ — **암홀 열 정의 표 · 후보 f0 시험**(측정만 · `src/` 거동 0줄 · 물리 0프레임 · 판정 0).
 *
 * v5-17 `v5CrossDist.ts` 의 격자·전수 열거를 **그대로** 쓰고 세 가지를 더한다:
 *   ㄱ **단계 가름** — `__asm2StageProbe('S3'|'S4', pos)` 로 «S3 직후»와 «S4 직후»를 **같은 `tris`** 로 각각 센다.
 *   ㄴ **봉제쌍 거리** — 어깨(front↔back 맨 윗행)·암홀(몸판 가장자리 열 ↔ 소매 캡 행). 분할 수는 `__asm2Probe.패턴 분할`.
 *   ㄷ **행/열 간격** — 몸판 3D 이웃 거리 통계(설계 행 간격 `L/nvB` 는 `__asm2Probe` 가 인쇄한다).
 * 진입: `[ASM2FIX=…] SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5ArmholeDist.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Gap = { 회차: number; pos: Float64Array; tris: number[]; panels: { name: string; base: number }[]; n: number };
let last: Gap | null = null;
(globalThis as unknown as { __v3gapProbe?: (r: Gap) => void }).__v3gapProbe = (r) => { last = r; };
let asm2: Record<string, unknown> | null = null;
(globalThis as unknown as { __asm2Probe?: (r: Record<string, unknown>) => void }).__asm2Probe = (r) => { asm2 = r; };
/** δ 맞춤 회차마다 장면이 다시 선다 ⟹ 단계 스냅숏을 **회차별로 짝지어** 모으고,
 * 마지막에 `__v3gapProbe` 가 준 `pos` 와 **비트 일치**하는 S4 짝만 쓴다(다른 회차의 값을 섞지 않는다). */
const hist: { S3?: Float64Array; S4?: Float64Array }[] = [];
(globalThis as unknown as { __asm2StageProbe?: (s: string, p: Float64Array) => void })
  .__asm2StageProbe = (s, p) => {
    if (s === 'S3') hist.push({ S3: p });
    else if (hist.length) hist[hist.length - 1].S4 = p;
  };

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite, triTriHit } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const FIX = process.env.ASM2FIX || undefined;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
let thrown: string | null = null;
try {
  prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: armAxisFromEnv(), asm2: true,
    ...(FIX ? { asm2Fix: FIX } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }
if (!last) { console.error('gapProbe 미발화 — 조립이 그 자리에 못 갔다'); process.exit(1); }
const G = last as Gap;
const a2 = asm2 as Record<string, unknown> | null;
const DIV = (a2?.['패턴 분할'] ?? {}) as Record<string, number>;
const { N_sh, N_nk, N_side, N_arm, N_und, nuB, nvB, nuS } = DIV;

/* ── 정점 → (패널 · i · j) ── `at(p,i,j) = base + j*(nu+1) + i` 의 역. 분할 수는 훅이 준다(역산 0). */
const bases = G.panels.map((p) => p.base).concat([G.n]);
const idx = Object.fromEntries(G.panels.map((p, k) => [p.name, k])) as Record<string, number>;
const at = (name: string, i: number, j: number) =>
  G.panels[idx[name]].base + j * ((name === 'front' || name === 'back' ? nuB : nuS) + 1) + i;
const locOf = (v: number) => {
  for (let k = 0; k < G.panels.length; k++) {
    if (v < bases[k] || v >= bases[k + 1]) continue;
    const nm = G.panels[k].name, body = nm === 'front' || nm === 'back';
    const nu = body ? nuB : nuS, q = v - bases[k];
    if (!Number.isFinite(nu)) return { pan: nm, i: -1, j: -1 };
    return { pan: nm, i: q % (nu + 1), j: Math.floor(q / (nu + 1)) };
  }
  return { pan: '?', i: -1, j: -1 };
};

/* ── 격자 후보 생성 + 전수 열거(minPairDist 방식 그대로 · 새 식 0) ── */
const tris = G.tris, T = tris.length / 3;
const win = SEP * 2, cs = Math.max(win * 2, 0.01);
const key = (a: number, b: number, cc: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (cc + 4096);
const shares = (a: number, b: number) => {
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (tris[a * 3 + x] === tris[b * 3 + y]) return true;
  return false;
};
function crossings(pos: Float64Array) {
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
  const rows: { panPair: string; jA: number; jB: number; iA: number; iB: number }[] = [];
  for (const arr of grid.values())
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const s = arr[a], t2 = arr[b];
      const pk = s < t2 ? s * 1e7 + t2 : t2 * 1e7 + s;
      if (seen.has(pk)) continue; seen.add(pk);
      if (shares(s, t2)) continue;
      if (!triTriHit(pos, [tris[s * 3], tris[s * 3 + 1], tris[s * 3 + 2]],
                          [tris[t2 * 3], tris[t2 * 3 + 1], tris[t2 * 3 + 2]])) continue;
      const la = locOf(tris[s * 3]), lb = locOf(tris[t2 * 3]);
      rows.push({ panPair: [la.pan, lb.pan].sort().join('↔'), jA: la.j, jB: lb.j, iA: la.i, iB: lb.i });
    }
  return rows;
}
const rows = crossings(G.pos);
const tally = (rs: typeof rows, f: (r: typeof rows[number]) => string) => {
  const m = new Map<string, number>();
  for (const r of rs) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
/** ★ §0-5 정의 — 암홀 열 `I` = `dEdge(i) = min(i, nuB − i) ≤ N_sh`. 열은 한 쌍의 «작은 쪽»으로 센다. */
const inArmCol = (i: number) => i >= 0 && Math.min(i, nuB - i) <= N_sh;

/* ── 봉제쌍 거리(어깨 · 암홀) ── */
const dist = (a: number, b: number, pos = G.pos) => Math.hypot(
  pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
const stat = (v: number[]) => v.length ? { n: v.length, 최소: Math.min(...v) * 1000,
  중앙: [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] * 1000, 최대: Math.max(...v) * 1000 } : null;
const shoulderPairs: number[] = [];
for (const seg of [[0, N_sh], [N_sh + N_nk, nuB]])
  for (let i = seg[0]; i <= seg[1]; i++) shoulderPairs.push(dist(at('front', i, nvB), at('back', i, nvB)));
/** 암홀 = `col(몸판, 0|nuB, N_side..nvB)` ↔ `row(소매, N_und, …)` — `garmentScene.ts` 봉제 대장 그대로. */
const armPairs: Record<string, number[]> = {};
for (const [nm, i0, slv, i1dir] of [
  ['암홀앞R', nuB, 'sleeveR', 'down'], ['암홀뒤R', nuB, 'sleeveR', 'up'],
  ['암홀앞L', 0, 'sleeveL', 'down'], ['암홀뒤L', 0, 'sleeveL', 'up']] as const) {
  const pan = nm.includes('앞') ? 'front' : 'back';
  const v: number[] = [];
  for (let k = 0; k + N_side <= nvB; k++) {
    const a = at(pan, i0 as number, N_side + k);
    const si = i1dir === 'down' ? nuS - k : 0 + k;
    if (si < 0 || si > nuS) break;
    v.push(dist(a, at(slv, si, N_und)));
  }
  armPairs[nm] = v;
}

/* ── 행/열 간격(몸판 3D 이웃 거리) ── */
const gapRow: number[] = [], gapCol: number[] = [];
for (const pan of ['front', 'back'])
  for (let j = 0; j <= nvB; j++) for (let i = 0; i <= nuB; i++) {
    if (i < nuB) gapCol.push(dist(at(pan, i, j), at(pan, i + 1, j)));
    if (j < nvB) gapRow.push(dist(at(pan, i, j), at(pan, i, j + 1)));
  }

const same = (a: Float64Array, b: Float64Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
/* 마지막 조립 장면의 **한 짝**을 쓴다(S4 는 같은 호출 안에서 S3 바로 뒤다 ⟹ 같은 장면이 보장된다).
 * `gapProbe` 장면과 비트 일치하는지는 **따로 적는다** — 일치하지 않으면 S4 뒤에도 `pos` 가 움직인다는 사실이다. */
const done = hist.filter((h) => h.S3 && h.S4);
const pair = done.length ? done[done.length - 1] : null;
const matched = pair?.S4 ? same(pair.S4, G.pos) : false;
const stageRows: Record<string, ReturnType<typeof crossings>> = {};
if (pair?.S3) stageRows.S3 = crossings(pair.S3);
if (pair?.S4) stageRows.S4 = crossings(pair.S4);
const out = {
  what: 'v5-18 §1-①③ 암홀 열 정의 표 · 후보 f0 시험(측정만 · src 거동 0줄 · 판정 0)',
  /** ★ v5-18 — **진입 env 를 산출에 «적는다»**(CC 귀책 C3 재발 방지 · v5-7b §0-5ㄴ 확정분인지 눈으로 본다). */
  _args: { ASM2FIX: FIX ?? null, SPEC: SPEC ?? null, CELL, D_MM: D * 1000, 계기: 'v5ArmholeDist.ts',
    BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  던짐: thrown, 'gapProbe 회차': G.회차, '삼각형': T, n: G.n,
  '① 패턴 분할': DIV,
  '① 암홀 열 정의': {
    '식': 'dEdge(i) = min(i, nuB − i) ≤ N_sh',
    '왼쪽 어깨 토막 i': [0, N_sh], '오른쪽 어깨 토막 i': [N_sh + N_nk, nuB],
    '암홀 행 j': [N_side + 1, nvB], '암홀 행 수(= N_arm)': N_arm,
    'v5-17 잔여 열(i 1~9 · 47~60)이 이 집합 안인가':
      { 'i 1~9': [1, 9].map(inArmCol), 'i 47~60': [47, 60].map(inArmCol) },
  },
  '① 팔 관(v4-37 조립이 소매에 쓰는 값 그대로)': a2?.['팔 관'] ?? null,
  '③ 교차 쌍 수': rows.length,
  '③ 패널 조합': tally(rows, (r) => r.panPair),
  '③ 행 j 분포(nvB − j · 상위 12)': tally(rows, (r) => {
    const d = Math.min(...[r.jA, r.jB].filter((x) => x >= 0).map((x) => nvB - x));
    return Number.isFinite(d) ? `nvB−${d}` : '소매';
  }).slice(0, 12),
  '③ 열 i 분포(상위 12)': tally(rows, (r) => `i${Math.min(r.iA, r.iB)}`).slice(0, 12),
  '③ 암홀 열 안 교차 비율': rows.length
    ? rows.filter((r) => inArmCol(r.iA) || inArmCol(r.iB)).length / rows.length : null,
  '③ 단계 가름(같은 tris · gapProbe 장면과 비트 일치하는 짝만)': {
    '짝 찾음': pair !== null, '조립 장면 수': hist.length, 'gapProbe 회차': G.회차,
    '★ S4 스냅숏 = gapProbe 장면인가': matched,
    ...Object.fromEntries(Object.entries(stageRows).map(([k, rs]) => [k,
      { '교차': rs.length, '패널 조합': tally(rs, (r) => r.panPair).slice(0, 4) }])),
  },
  '③ 봉제쌍 거리 mm — 어깨': stat(shoulderPairs),
  '③ 봉제쌍 거리 mm — 소매 캡↔암홀': Object.fromEntries(
    Object.entries(armPairs).map(([k, v]) => [k, stat(v)])),
  '③ 행 간격 mm': stat(gapRow), '③ 열 간격 mm': stat(gapCol),
  '③ 설계 행 간격 mm': a2?.['행 간격(설계) mm'] ?? null,
  '③ 최근접 정점쌍 mm': a2?.['최근접 정점쌍 mm'] ?? null, '③ 최근접 자리': a2?.['최근접 자리'] ?? null,
  '③ S4': { 반복: a2?.['S4 반복'], 상한: a2?.['S4 상한'], 수렴: a2?.['S4 수렴'],
    '최대이동 궤적 mm': a2?.['S4 최대이동 궤적 mm'] },
  '③ u(i) > 0 인 열 수': a2?.['u(i) 표본'] ?? null,
  FIX: a2?.FIX ?? null,
};
writeFileSync(`gpu/oracle/export/v5-18-arm-${FIX ?? 'DEF'}-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
