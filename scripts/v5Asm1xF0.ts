/* v5-22 §1-②(f0 몫) — **`asm1x` off ↔ on 나란히**(측정만 · `src/` 0줄 · 물리 0프레임 · 판정 0).
 *
 * §0-3ㅁ 이행 — 「현행 나란히」의 대조군을 **이 판에서 다시 잰다**(과거 노트의 수를 옮겨 쓰지 않는다 · 함정 44).
 * f0 에서 잴 수 있는 채널만 낸다 — 옷 최고점·밑단 y · 앵커 세 값 · 제도 분할 · 목선 링/rest ·
 * 어깨선 위 옷 정점 수(걸림 «정도» · 편입 규약) · 최소쌍 · `RAMP_N` · `substeps`.
 * 게이트 5채널·층3 5행은 **굽기가 내는 값**이므로 여기서 재지 않는다.
 *
 * 진입: `CELL=… [SPEC=…] BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5Asm1xF0.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { ASM2_SH_DROP } from '../src/v3/garmentScene.ts';
import { FABRICS, SEP, THICK, TOL_SELF } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));

function one(asm1x: boolean) {
  let thrown: string | null = null;
  let r: ReturnType<typeof prepare> | null = null;
  try {
    r = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD, bodyVerts: verts,
      minPairDistLite, armAxis: armAxisFromEnv(), ...(asm1x ? { asm1x: true } : {}) } as never);
  } catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }
  if (!r) return { 던짐: thrown };
  const { S, sc, RAMP_N, sub, ringRest, neckF, neckB } = r;
  const pos = sc.s.pos;
  /** 옷 정점 y 극값 — 최고점(= 봉제선 높이) · 밑단(= 최저점). */
  let yhi = -Infinity, ylo = Infinity;
  for (let v = 0; v < sc.n; v++) { const y = pos[v * 3 + 1]; if (y > yhi) yhi = y; if (y < ylo) ylo = y; }
  /** 목선 링 3D 둘레 — `prepare` 가 내놓는 «그» 링 정점 목록에서 직접 뜬다(별도 배열 0 · 함정 12). */
  const ringOf = (ids: number[]) => { let s = 0;
    for (let k = 0; k + 1 < ids.length; k++) { const a = ids[k], b = ids[k + 1];
      s += Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]); }
    return s; };
  const ring3 = ringOf(neckF) + ringOf(neckB);
  /** 어깨 걸림 «정도» — 「어깨선(= 몸 어깨끝 높이 `Y_TOP`) 위 옷 정점 수」(편입 규약 · 판정선 아님). */
  const yTop = S.Y_TOP as number | undefined;
  let above = 0;
  if (typeof yTop === 'number') for (let v = 0; v < sc.n; v++) if (pos[v * 3 + 1] >= yTop) above++;
  const mp = minPairDistLite(pos, sc.tris);
  return {
    던짐: null, n: sc.n, substeps: sub, RAMP_N,
    'Y_TOP mm': typeof yTop === 'number' ? yTop * 1000 : null,
    'Y_NECK mm': (S.Y_NECK as number | undefined) !== undefined ? (S.Y_NECK as number) * 1000 : null,
    /* `Y_ANCHOR`·`SH_DROP` 은 `createScene` 이 밖으로 내놓지 않는다 ⟹ **등재식 그대로** 적는다
     * (`garmentScene.ts:296` `Y_ANCHOR = (ASM2 || ASM1X) ? Y_NECK : Y_TOP` · `:137` `SH_DROP = … ASM2_SH_DROP : 0`).
     * 값을 «고르는» 것이 아니라 코드의 식을 그대로 옮긴 것이다 — 새 상수 0. */
    'Y_ANCHOR mm(등재식)': asm1x ? (S.Y_NECK as number) * 1000 : (S.Y_TOP as number) * 1000,
    'SH_DROP mm(등재식)': asm1x ? ASM2_SH_DROP * 1000 : 0,
    '옷 최고점 y mm': yhi * 1000, '옷 밑단 y mm': ylo * 1000, '옷 세로 길이 mm': (yhi - ylo) * 1000,
    '제도 분할': { N_sh: sc.N_sh, N_nk: sc.N_nk, N_side: sc.N_side, N_arm: sc.N_arm,
      nuB: sc.nuB, nvB: sc.nvB },
    '목선 링 3D mm': ring3 * 1000, '목선 링 rest mm': ringRest * 1000,
    '링/rest': ring3 / Math.max(1e-12, ringRest),
    '어깨선 위 옷 정점': above,
    /* `minPairDistLite` 는 «최소쌍 거리»만 돌려준다(`instruments.ts:61-63`) — 교차 수는 굽기 게이트가 낸다. */
    '자기 최소쌍 mm': mp * 1000,
  };
}
const off = one(false), on = one(true);
const num = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'number' ? (o[k] as number) : null);
const dKeys = ['Y_ANCHOR mm(등재식)', '옷 최고점 y mm', '옷 밑단 y mm', '옷 세로 길이 mm', '목선 링 3D mm',
  '링/rest', '어깨선 위 옷 정점', '자기 최소쌍 mm', 'RAMP_N', 'n'];
const out = {
  what: 'v5-22 §1-② f0 몫 — asm1x off ↔ on 나란히(측정만 · src 0줄 · 판정 0)',
  _args: { CELL, SPEC: SPEC ?? null, D_MM: D * 1000, 계기: 'v5Asm1xF0.ts',
    BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
    ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null },
  '등재 자': { 'SEP mm': SEP * 1000, 'THICK mm': THICK * 1000, 'TOL_SELF mm': TOL_SELF * 1000 },
  off, on,
  'Δ(on − off)': Object.fromEntries(dKeys.map((k) => {
    const a = num(off as Record<string, unknown>, k), b = num(on as Record<string, unknown>, k);
    return [k, a !== null && b !== null ? b - a : null];
  })),
};
writeFileSync(`gpu/oracle/export/v5-22-f0-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
