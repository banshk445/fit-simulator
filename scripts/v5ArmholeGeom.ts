/* v5-20 §1-①②③ — **암홀 구간 기하의 완전한 그림**(측정만 · **`src/` 0줄** · 물리 0프레임 · 처방 0 · 판단 0).
 *
 * 재료는 전부 이미 있는 인쇄 훅이다:
 *   `__v3gapProbe` … `pos` · `tris` · `panels` · `n` · **`sdf` 클로저(조립이 쓴 그 몸 SDF)** · `SLV_X0`·`SLV_R`
 *   `__asm2Probe`  … `패턴 분할` · `팔 관`(AX·AP·AO·SLV_R·SEP) · `밴드 mm` · `h mm` · `관통`
 * 자·축·상한은 §0-4 에 등재한 것만 쓴다(새 상수 0 · 새 축 0).
 *
 * 진입: `ASM2FIX=NOS4 [SPEC=…] CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5ArmholeGeom.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Gap = { 회차: number; pos: Float64Array; tris: number[]; panels: { name: string; base: number }[];
             n: number; sdf: (x: number, y: number, z: number) => number; SLV_X0: number; SLV_R: number };
let last: Gap | null = null;
(globalThis as unknown as { __v3gapProbe?: (r: Gap) => void }).__v3gapProbe = (r) => { last = r; };
let asm2: Record<string, unknown> | null = null;
(globalThis as unknown as { __asm2Probe?: (r: Record<string, unknown>) => void }).__asm2Probe = (r) => { asm2 = r; };

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, triTriHit } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const FIX = process.env.ASM2FIX || 'NOS4';
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
    minPairDistLite, armAxis: armAxisFromEnv(), asm2: true, asm2Fix: FIX } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }
if (!last) { console.error('gapProbe 미발화'); process.exit(1); }
const G = last as Gap;
const a2 = asm2 as unknown as Record<string, unknown>;
const DIV = a2['패턴 분할'] as Record<string, number>;
const TUBE = a2['팔 관'] as Record<string, unknown>;
const { N_sh, N_und, nuB, nvB, nuS } = DIV;
const H = (a2['h mm'] as number) / 1000;                 // sdfSpec.h — 훅이 인쇄한 값
const BAND = (a2['밴드 mm'] as number) / 1000;
const SEP = (TUBE['SEP mm'] as number) / 1000;
const SLV_R = (TUBE['SLV_R mm'] as number) / 1000;
const SLV_X0 = (TUBE['SLV_X0 mm'] as number) / 1000;
const AX = TUBE.AX as [number, number, number];
const AP = TUBE['AP(피벗)'] as [number, number, number] | null;
const AO = TUBE['AO(원점)'] as [number, number, number] | null;
const sdf = G.sdf;

/* ── 정점 ↔ (패널 · i · j) ── */
const nuOf = (nm: string) => (nm === 'front' || nm === 'back' ? nuB : nuS);
const at = (nm: string, i: number, j: number) =>
  G.panels[G.panels.findIndex((p) => p.name === nm)].base + j * (nuOf(nm) + 1) + i;
const P = (p: Float64Array, v: number): [number, number, number] => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
const nrm = (a: [number, number, number]) => {
  const L = Math.hypot(a[0], a[1], a[2]);
  return L > 1e-12 ? ([a[0] / L, a[1] / L, a[2] / L] as [number, number, number]) : null;
};

/* ── §0-4ㄷ 부위 분류자(등재된 양만) ── */
/** 오른팔 틀로 거울한 좌표(`axPoint` 의 AP 분기가 x 를 거울하는 그 방식). */
const mir = (p: [number, number, number]) => {
  const sgn = p[0] >= 0 ? 1 : -1;
  return { sgn, m: (AP ? [sgn * p[0], p[1], p[2]] : p) as [number, number, number] };
};
/** 축 좌표 `s` = `axDot` 의 식 그대로(원점 `AO`). */
const sAx = (p: [number, number, number]) =>
  AO ? AX[0] * (p[0] - AO[0]) + AX[1] * (p[1] - AO[1]) + AX[2] * (p[2] - AO[2])
     : AX[0] * p[0] + AX[1] * p[1] + AX[2] * p[2];
/** 거울 틀에서의 축 좌표(양쪽 팔이 같은 부호가 되게) · 팔 반경 · 반경 방향(세계 좌표). */
const armFrame = (p: [number, number, number]) => {
  const { sgn, m } = mir(p);
  const O = AP ?? [0, 0, 0];
  const d: [number, number, number] = [m[0] - O[0], m[1] - O[1], m[2] - O[2]];
  const t = d[0] * AX[0] + d[1] * AX[1] + d[2] * AX[2];
  const r: [number, number, number] = [d[0] - t * AX[0], d[1] - t * AX[1], d[2] - t * AX[2]];
  const rho = Math.hypot(r[0], r[1], r[2]);
  const rh = nrm(r);
  const rw = rh ? ([AP ? sgn * rh[0] : rh[0], rh[1], rh[2]] as [number, number, number]) : null;
  /** 팔 둘레 위상각 — `ẑ`(0°)에서 재고 `+y` 를 90° 로 둔다(팔 앞/위/뒤를 가른다). */
  const phi = rho > 1e-12 ? (Math.atan2(r[1], r[2]) * 180) / Math.PI : null;
  return { sgn, sArm: t, rho, rHat: rw, phi };
};
const partOf = (rho: number, sArm: number) =>
  rho <= SLV_R ? '팔' : sArm > 0 ? '겨드랑이' : '몸통';

/** 몸 SDF 기울기(`nHat` 의 중앙차분 그대로 · 밴드 밖은 0 이라 null). */
const gradAt = (p: [number, number, number]) => {
  const gx = sdf(p[0] + H, p[1], p[2]) - sdf(p[0] - H, p[1], p[2]);
  const gy = sdf(p[0], p[1] + H, p[2]) - sdf(p[0], p[1] - H, p[2]);
  const gz = sdf(p[0], p[1], p[2] + H) - sdf(p[0], p[1], p[2] - H);
  return nrm([gx, gy, gz]);
};

/* ── 전수 교차 열거(v5-17 이후 같은 격자·같은 식) ── */
const tris = G.tris, T = tris.length / 3;
const cs = Math.max(SEP * 2 * 2, 0.01);
const key = (a: number, b: number, cc: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (cc + 4096);
const shares = (a: number, b: number) => {
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (tris[a * 3 + x] === tris[b * 3 + y]) return true;
  return false;
};
function crossPairs(pos: Float64Array) {
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
  const seen = new Set<number>(); const out: [number, number][] = [];
  for (const arr of grid.values())
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      const s = arr[a], t2 = arr[b];
      const pk = s < t2 ? s * 1e7 + t2 : t2 * 1e7 + s;
      if (seen.has(pk)) continue; seen.add(pk);
      if (shares(s, t2)) continue;
      if (!triTriHit(pos, [tris[s * 3], tris[s * 3 + 1], tris[s * 3 + 2]],
                          [tris[t2 * 3], tris[t2 * 3 + 1], tris[t2 * 3 + 2]])) continue;
      out.push([s, t2]);
    }
  return out;
}
const pairs0 = crossPairs(G.pos);
/** 교차에 «든» 정점 = 그 두 삼각형의 정점 전부. */
const crossV = new Set<number>();
for (const [s, t2] of pairs0)
  for (let k = 0; k < 3; k++) { crossV.add(tris[s * 3 + k]); crossV.add(tris[t2 * 3 + k]); }

/* ── §1-① 정점별 완전 열거 ── */
type Row = { v: number; pan: string; i: number; j: number; 'nvB−j': number; 'y mm': number;
  's(axDot) mm': number; 's(팔틀) mm': number; 'ρ mm': number; 'sdf mm': number; 부위: string;
  '밴드 밖': boolean; '교차에 든다': boolean; 방향: string; 'φ deg': number | null;
  '표면점 부위': string | null; '탈출 방향': string | null; '탈출 거리 mm': number | null; 갇힘: boolean };
const DIRS = (n: [number, number, number] | null,
              r: [number, number, number] | null) => {
  const L: { name: string; d: [number, number, number] }[] = [];
  if (n) L.push({ name: 'n̂', d: n });
  if (r) L.push({ name: 'r̂(팔 반경)', d: r });
  L.push({ name: '+ẑ', d: [0, 0, 1] }, { name: '−ẑ', d: [0, 0, -1] }, { name: '−ŷ', d: [0, -1, 0] });
  return L;
};
/** 등재 방향·상한(`SLV_R`)·걸음(`h`)으로 `sdf ≥ SEP` 인 첫 점을 찾는다. */
const escape = (p: [number, number, number]) => {
  const { rHat } = armFrame(p);
  const n = gradAt(p);
  let best: { name: string; t: number; q: [number, number, number] } | null = null;
  for (const { name, d } of DIRS(n, rHat))
    for (let k = 1; k * H <= SLV_R; k++) {
      const t = k * H;
      const q: [number, number, number] = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
      if (sdf(q[0], q[1], q[2]) >= SEP) { if (!best || t < best.t) best = { name, t, q }; break; }
    }
  return best;
};
const rows: Row[] = [];
const penOut = new Set<number>();
for (const pan of G.panels) {
  const nu = nuOf(pan.name), nv = pan.name === 'front' || pan.name === 'back' ? nvB : N_und;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = at(pan.name, i, j), p = P(G.pos, v);
    const sg = sdf(p[0], p[1], p[2]);
    const outB = -sg > BAND;
    const inX = crossV.has(v);
    if (!outB && !inX) continue;                       // ①의 대상 = 밴드 밖 «또는» 교차에 든 정점
    if (outB) penOut.add(v);
    const af = armFrame(p), n = gradAt(p);
    const esc = escape(p);
    let sPart: string | null = null;
    if (n) {
      const q: [number, number, number] = [p[0] - sg * n[0], p[1] - sg * n[1], p[2] - sg * n[2]];
      const qf = armFrame(q); sPart = partOf(qf.rho, qf.sArm);
    }
    rows.push({ v, pan: pan.name, i, j, 'nvB−j': nvB - j, 'y mm': p[1] * 1000,
      's(axDot) mm': sAx(p) * 1000, 's(팔틀) mm': af.sArm * 1000, 'ρ mm': af.rho * 1000,
      'sdf mm': sg * 1000, 부위: partOf(af.rho, af.sArm), '밴드 밖': outB, '교차에 든다': inX,
      방향: n ? '있음' : '없음(기울기 0)', 'φ deg': af.phi,
      '표면점 부위': sPart, '탈출 방향': esc ? esc.name : null,
      '탈출 거리 mm': esc ? esc.t * 1000 : null, 갇힘: !esc });
  }
}

/* ── §1-② 실물 경로의 존재 — 찾은 점으로 «전부» 옮기고 교차를 다시 센다 ── */
const moved = Float64Array.from(G.pos);
let movedN = 0, blockedN = 0;
const blocked: Row[] = [];
for (const r of rows) {
  const p = P(G.pos, r.v), esc = escape(p);
  if (!esc) { blockedN++; blocked.push(r); continue; }
  moved[r.v * 3] = esc.q[0]; moved[r.v * 3 + 1] = esc.q[1]; moved[r.v * 3 + 2] = esc.q[2]; movedN++;
}
const pairs1 = crossPairs(moved);
/** 이웃 거리 변화 — 판정 «아님»(§0-4ㄹ). 몸판 격자의 행·열 이웃만 본다. */
const neigh = (pos: Float64Array) => {
  const row: number[] = [], col: number[] = [];
  const dd = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3],
    pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (const nm of ['front', 'back'])
    for (let j = 0; j <= nvB; j++) for (let i = 0; i <= nuB; i++) {
      if (i < nuB) col.push(dd(at(nm, i, j), at(nm, i + 1, j)));
      if (j < nvB) row.push(dd(at(nm, i, j), at(nm, i, j + 1)));
    }
  return { row, col };
};
const st = (v: number[]) => ({ 중앙: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] * 1000,
  최대: Math.max(...v) * 1000, 최소: Math.min(...v) * 1000 });
const nb0 = neigh(G.pos), nb1 = neigh(moved);

/* ── 2D 지도(행 × 열) ── */
const mapOf = () => {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.pan !== 'front' && r.pan !== 'back') continue;
    const k = `${r.pan}|${r.j}|${r.i}`;
    m.set(k, r['밴드 밖'] && r['교차에 든다'] ? '+' : r['밴드 밖'] ? '#' : 'x');
  }
  const out: Record<string, string[]> = {};
  for (const nm of ['front', 'back']) {
    const lines: string[] = [];
    for (let d = 1; d <= 20; d++) {
      const j = nvB - d; if (j < 0) break;
      let s = '';
      for (let i = 0; i <= nuB; i++) s += m.get(`${nm}|${j}|${i}`) ?? '.';
      lines.push(`nvB−${String(d).padStart(2)} ${s}`);
    }
    out[nm] = lines;
  }
  return out;
};

const tally = <T>(xs: T[], f: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
};
const out = {
  what: 'v5-20 §1-①②③ 암홀 구간 기하 완전 열거 + SEP 등위면 존재 탐색(측정만 · src 0줄 · 처방 0 · 판단 0)',
  _args: { ASM2FIX: FIX, SPEC: SPEC ?? null, CELL, D_MM: D * 1000, 계기: 'v5ArmholeGeom.ts',
    BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  던짐: thrown, 'gapProbe 회차': G.회차, n: G.n, 삼각형: T,
  '패턴 분할': DIV, '팔 관': TUBE, '밴드 mm': BAND * 1000, 'h mm': H * 1000, 'SEP mm': SEP * 1000,
  '① 교차 쌍 수': pairs0.length, '① 교차에 든 정점': crossV.size, '① 밴드 밖 정점': penOut.size,
  '① 대상 정점(밴드 밖 ∪ 교차)': rows.length,
  '① 부위 분포': tally(rows, (r) => r.부위),
  '① 부위 분포(밴드 밖만)': tally(rows.filter((r) => r['밴드 밖']), (r) => r.부위),
  '① 표면점 부위 분포': tally(rows, (r) => r['표면점 부위'] ?? '방향 없음'),
  '① 방향 유무': tally(rows, (r) => r.방향),
  '① 패널 분포': tally(rows, (r) => r.pan),
  '① 행 분포(nvB−j)': tally(rows, (r) => `nvB−${r['nvB−j']}`),
  '① 암홀 열 비율': rows.length
    ? rows.filter((r) => Math.min(r.i, nuOf(r.pan) - r.i) <= N_sh).length / rows.length : null,
  '① ρ mm': rows.length ? { 최소: Math.min(...rows.map((r) => r['ρ mm'])),
    최대: Math.max(...rows.map((r) => r['ρ mm'])), 'SLV_R mm': SLV_R * 1000 } : null,
  '① s(팔틀) mm': rows.length ? { 최소: Math.min(...rows.map((r) => r['s(팔틀) mm'])),
    최대: Math.max(...rows.map((r) => r['s(팔틀) mm'])), 'SLV_X0 mm': SLV_X0 * 1000 } : null,
  '① 2D 지도(# 밴드 밖 · x 교차 · + 둘 다 · . 정상)': mapOf(),
  '② 존재': { '대상 정점': rows.length, '존재(옮김)': movedN, '막힘': blockedN,
    '막힘 자리': blocked.slice(0, 40).map((r) => `${r.pan}(i${r.i},j${r.j}) sdf ${r['sdf mm'].toFixed(3)}mm ρ ${r['ρ mm'].toFixed(2)} s ${r['s(팔틀) mm'].toFixed(2)}`),
    '탈출 방향 분포': tally(rows.filter((r) => !r.갇힘), (r) => r['탈출 방향']!),
    '탈출 거리 mm': (() => { const v = rows.filter((r) => !r.갇힘).map((r) => r['탈출 거리 mm']!);
      return v.length ? { 최소: Math.min(...v), 중앙: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)],
        최대: Math.max(...v) } : null; })(),
    'φ deg 분포(30° 칸)': tally(rows.filter((r) => r['φ deg'] !== null),
      (r) => `${Math.floor(r['φ deg']! / 30) * 30}~${Math.floor(r['φ deg']! / 30) * 30 + 30}`),
    '옮긴 뒤 교차 쌍': pairs1.length, '옮기기 전 교차 쌍': pairs0.length },
  '② 이웃 거리(판정 아님 · 값만)': { 전: { 행: st(nb0.row), 열: st(nb0.col) },
    후: { 행: st(nb1.row), 열: st(nb1.col) },
    '등재 자 병기': { '2π(THICK+TOL_SELF) mm': 2 * Math.PI * (1 + 0.1), 'TOL_SELF mm': 0.1 } },
  '① 정점 전량': rows,
};
writeFileSync(`gpu/oracle/export/v5-20-geom-${FIX}-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
const { '① 정점 전량': _drop, ...brief } = out;
console.log(JSON.stringify(brief, null, 1));
