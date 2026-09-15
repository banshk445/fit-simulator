/* v5-21 §1-② — **바깥 펼침 전용 채널**(측정만 · `src/` 거동 0줄 · 굽기 0 · 판정 0).
 *
 * `scripts/v5NoS4.ts`(v5-19)가 뜨는 채널 밖의 두 가지만 낸다 — 둘 다 `__asm2Probe` 가 «인쇄»한 값이다:
 *   ㄱ **이음 엣지 신장**(`j = N_side ↔ N_side+1` · 3D ÷ 2D 패턴 · 배율) — 펼침 구간과 튜브 구간의 경계
 *   ㄴ **펼침 떨어뜨린 열 수**(`n̂` 소실로 전역 `−y` 를 쓴 열 · §0-3ㄱ)
 * 조립이 자기검사에서 던져도 훅은 이미 발화했으므로 «던짐 문구»와 함께 그대로 적는다.
 *
 * 진입: `ASM2FIX=OUT [SPEC=…] CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5OutHang.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
type Gap = { pos: Float64Array; panels: { name: string; base: number }[]; n: number;
             sdf: (x: number, y: number, z: number) => number };
let last: Gap | null = null;
(globalThis as unknown as { __v3gapProbe?: (r: Gap) => void }).__v3gapProbe = (r) => { last = r; };
let asm2: Record<string, unknown> | null = null;
(globalThis as unknown as { __asm2Probe?: (r: Record<string, unknown>) => void }).__asm2Probe = (r) => { asm2 = r; };

import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const FIX = process.env.ASM2FIX || undefined;
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
let thrown: string | null = null;
try {
  prepare({ glb, fabric: FABRICS.gray, d: D, garment: SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size),
    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, armAxis: armAxisFromEnv(), asm2: true,
    ...(FIX ? { asm2Fix: FIX } : {}) } as never);
} catch (e) { thrown = String((e as Error).message).replace(/\s+/g, ' '); }
const a2 = asm2 as Record<string, unknown> | null;
if (!a2) { console.error('__asm2Probe 미발화 — 조립이 그 자리에 못 갔다'); process.exit(1); }
/* ★ 왜 «떨어뜨렸나» — 꼭대기 행(`nvB`)의 정점마다 몸 SDF 값과 기울기 크기를 «훅이 준 자»로 잰다
 * (`__v3gapProbe.sdf` = `sampleSdf(bodyG, …)` 그대로 · `src/` 0줄 · 중앙차분 폭 `h` 는 훅이 인쇄한 값). */
const DIV = (a2['패턴 분할'] ?? {}) as Record<string, number>;
const HH = Number(a2['h mm'] ?? 0) / 1000;
let top: Record<string, unknown> | null = null;
if (last && HH > 0 && DIV.nvB !== undefined) {
  const G = last as Gap;
  const idx = Object.fromEntries(G.panels.map((p, k) => [p.name, k])) as Record<string, number>;
  const rows: { pan: string; i: number; sdf: number; gn: number }[] = [];
  for (const name of ['front', 'back']) {
    const base = G.panels[idx[name]].base;
    for (let i = 0; i <= DIV.nuB; i++) {
      const v = base + DIV.nvB * (DIV.nuB + 1) + i;
      const x = G.pos[v * 3], y = G.pos[v * 3 + 1], z = G.pos[v * 3 + 2];
      const gx = G.sdf(x + HH, y, z) - G.sdf(x - HH, y, z);
      const gy = G.sdf(x, y + HH, z) - G.sdf(x, y - HH, z);
      const gz = G.sdf(x, y, z + HH) - G.sdf(x, y, z - HH);
      rows.push({ pan: name, i, sdf: G.sdf(x, y, z) * 1000, gn: Math.hypot(gx, gy, gz) * 1000 });
    }
  }
  const dead = rows.filter((r) => !(r.gn > 1e-12 * 1000));
  const sd = rows.map((r) => r.sdf).sort((a, b) => a - b);
  top = { '꼭대기 행 정점 수': rows.length, '기울기 0 인 정점 수': dead.length,
          '기울기 0 패널별': { front: dead.filter((r) => r.pan === 'front').length,
                               back: dead.filter((r) => r.pan === 'back').length },
          '기울기 0 열 i(앞 12)': dead.slice(0, 12).map((r) => `${r.pan}(i${r.i})`),
          '꼭대기 sdf mm': { 최소: sd[0], 중앙: sd[sd.length >> 1], 최대: sd[sd.length - 1] },
          '기울기 0 인 곳 sdf mm': dead.length ? { 최소: Math.min(...dead.map((r) => r.sdf)),
                                                   최대: Math.max(...dead.map((r) => r.sdf)) } : null,
          '밴드 mm': a2['밴드 mm'] ?? null, 'h mm': a2['h mm'] ?? null };
}
const out = { what: 'v5-21 §1-② 바깥 펼침 전용 채널(측정만)', spec: SPEC ?? `차트 ${c.size}`, cell: CELL, FIX: FIX ?? null,
              던짐: thrown, '패턴 분할': a2['패턴 분할'],
              '이음 엣지': a2['이음 엣지(j=N_side↔N_side+1)'], '펼침 떨어뜨린 열': a2['펼침 떨어뜨린 열'],
              '설계 행 간격 mm': a2['설계 행 간격 mm'] ?? null, '목선 링': a2['목선 링'], '꼭대기 행 기울기': top };
writeFileSync(`gpu/oracle/export/v5-21-outhang-${FIX ?? 'DEF'}-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
