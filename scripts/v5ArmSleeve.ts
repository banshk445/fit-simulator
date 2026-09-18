/* v5-26 §1-② — **암홀 가장자리 ↔ 소매 관의 기하**(측정만 · `src/` 0줄 · 처방 0 · 단정 0).
 *
 * 봉제 대장 그대로의 암홀 쌍 `col(몸판, i0|nuB, N_side..nvB) ↔ row(소매, N_und, …)` 의 쌍별 거리와,
 * 두 쪽의 팔 관 좌표 `(s, ρ, φ)`(축 `AX` · 피벗 `AP` · `axDot` 식 그대로)를 낸다.
 * 앵커 on↔off 의 **암홀 중심 Δy** 와 **소매 축 이동 Δs**(소매 정점 `s` 중앙값 차로 «측정» · `sAx` 재계산 0).
 *
 * 진입: `[ASM1X=1|anchor|drop] CELL=… [SPEC=…] BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5ArmSleeve.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const A1 = process.env.ASM1X;
const ASM1X: boolean | 'anchor' | 'drop' | undefined =
  A1 === '1' ? true : A1 === 'anchor' ? 'anchor' : A1 === 'drop' ? 'drop' : undefined;
const TAG = process.env.TAG ?? `${A1 ?? 'off'}-${SPEC ?? CELL}`;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const AX0 = armAxisFromEnv();

let thrown: string | null = null;
let P: ReturnType<typeof prepare> | null = null;
try {
  P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: AX0, ...(ASM1X ? { asm1x: ASM1X } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }

const out: Record<string, unknown> = {
  what: 'v5-26 §1-② 암홀 가장자리 ↔ 소매 관 기하(측정만 · src 0줄 · 처방 0 · 단정 0)',
  _args: { TAG, CELL, SPEC: SPEC ?? null, ASM1X: A1 ?? null, D_MM: D * 1000, 계기: 'v5ArmSleeve.ts',
    BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  던짐: thrown,
};

if (P) {
  const sc = P.sc as unknown as { n: number; s: { pos: Float64Array };
    panels: { name: string; base: number; nu: number; nv: number }[];
    nuB: number; nvB: number; N_side: number; N_arm: number; N_und: number; nuS: number;
    seams: { name: string; a: number[]; b: number[] }[] };
  const S = P.S as unknown as { Y_TOP: number; Y_NECK: number };
  const pos = sc.s.pos;
  const at = (nm: string, i: number, j: number) => {
    const p = sc.panels.find((x) => x.name === nm)!; return p.base + j * (p.nu + 1) + i;
  };
  const pt = (v: number): [number, number, number] => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

  /* ── 팔 관 좌표 — `axDot`/`axPoint` 의 틀 그대로(AP 분기는 x 를 거울한다) ── */
  const AX = (AX0?.right ?? [1, 0, 0]) as [number, number, number];
  const APr = (AX0?.pivot?.right ?? null) as [number, number, number] | null;
  const frame = (p: [number, number, number]) => {
    const sgn = p[0] >= 0 ? 1 : -1;
    const m: [number, number, number] = APr ? [sgn * p[0], p[1], p[2]] : p;
    const O = APr ?? [0, 0, 0];
    const d0: [number, number, number] = [m[0] - O[0], m[1] - O[1], m[2] - O[2]];
    const s = d0[0] * AX[0] + d0[1] * AX[1] + d0[2] * AX[2];
    const r: [number, number, number] = [d0[0] - s * AX[0], d0[1] - s * AX[1], d0[2] - s * AX[2]];
    const rho = Math.hypot(r[0], r[1], r[2]);
    const phi = rho > 1e-12 ? (Math.atan2(r[1], r[2]) * 180) / Math.PI : null;
    return { s, rho, phi };
  };
  const st = (v: number[]) => v.length ? { n: v.length, 최소: Math.min(...v), 중앙: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)],
    최대: Math.max(...v) } : null;

  /* ── 암홀 봉제쌍 — 조립의 봉제 대장을 «직접» 쓴다(별도 배열 0 · 함정 12) ── */
  const arm = (sc.seams ?? []).filter((s0) => s0.name.startsWith('암홀'));
  const pairRows = arm.map((s0) => {
    const d: number[] = [];
    for (let k = 0; k < s0.a.length; k++) {
      const A = pt(s0.a[k]), B = pt(s0.b[k]);
      d.push(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 1000);
    }
    return { 이름: s0.name, 쌍: s0.a.length, 거리mm: st(d) };
  });

  /* ── 암홀 가장자리 열(i0 / i nuB) 의 기하 ── */
  const edgeCols = [0, sc.nuB];
  const edge: Record<string, unknown> = {};
  for (const nm of ['front', 'back']) for (const i of edgeCols) {
    const ys: number[] = [], ss: number[] = [], rr: number[] = [];
    for (let j = sc.N_side; j <= sc.nvB; j++) {
      const p = pt(at(nm, i, j)); const f = frame(p);
      ys.push(p[1] * 1000); ss.push(f.s * 1000); rr.push(f.rho * 1000);
    }
    edge[`${nm} i${i}`] = { 'y mm': st(ys), 's mm': st(ss), 'ρ mm': st(rr) };
  }
  /** 암홀 «중심» y — 가장자리 열 네 개의 y 평균(앵커 Δy 를 재는 자리). */
  const allY: number[] = [];
  for (const nm of ['front', 'back']) for (const i of edgeCols)
    for (let j = sc.N_side; j <= sc.nvB; j++) allY.push(pos[at(nm, i, j) * 3 + 1] * 1000);

  /* ── 소매 관 — 소매 정점 전체의 (s, ρ) ── */
  const slv = sc.panels.filter((p) => p.name.startsWith('sleeve'));
  const sS: number[] = [], sR: number[] = [];
  for (const p of slv) for (let v = p.base; v < p.base + (p.nu + 1) * (p.nv + 1); v++) {
    const f = frame(pt(v)); sS.push(f.s * 1000); sR.push(f.rho * 1000);
  }

  out['제도 분할'] = { nuB: sc.nuB, nvB: sc.nvB, N_side: sc.N_side, N_arm: sc.N_arm,
    N_und: sc.N_und, nuS: sc.nuS, n: sc.n };
  out['몸 높이 mm'] = { Y_TOP: S.Y_TOP * 1000, Y_NECK: S.Y_NECK * 1000,
    'Y_NECK − Y_TOP': (S.Y_NECK - S.Y_TOP) * 1000 };
  out['암홀 봉제쌍 거리 mm'] = pairRows;
  out['암홀 가장자리 열'] = edge;
  out['암홀 중심 y mm'] = allY.reduce((a, b) => a + b, 0) / allY.length;
  out['소매 관 좌표'] = { 's mm': st(sS), 'ρ mm': st(sR) };
}
writeFileSync(`gpu/oracle/export/v5-26-armslv-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
