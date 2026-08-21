/* v3-40 §2 — 목선 판정 «계기». **계기 전용 · 물리 로직 0줄 · 물리 실행 0프레임.**
 *
 * 공식은 `docs/v3/21-목선문턱도출.md` §1 이 **수치 대입 «전»에** 확정했다(커밋 03d89aa):
 *   C_allow = C_body + 2π·(THICK + TOL_SELF)          R = C_ring / C_allow ≤ 1
 * C_body = 목선 링 정점의 «몸 최근접점»을 링 순서로 이은 닫힌 폴리라인 길이
 *          (v3-23 §1-② 등재 계기와 «같은 양»)
 *
 * 진입: `IN=<상태blob> FAB=<원단> D_MM=<해상도> npx tsx scripts/v3Neck.ts`
 *       `PUSH=<mm>` 를 주면 링 정점을 그 거리만큼 «바깥으로» 밀어 실패 경로를 찍는다(㉣ · 합성).
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, THICK, TOL_SELF } from '../src/v3/consts.ts';

const GLB = process.env.GLB ?? 'public/models/mannequin.glb';
const IN = process.env.IN!;
const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 11) / 1000;
const PUSH = Number(process.env.PUSH ?? 0) / 1000;   // ㉣ 합성 전용
const TAG = process.env.TAG ?? `${FAB}-d${process.env.D_MM ?? 11}`;

const glbBuf = readFileSync(GLB);
const P = prepare({
  glb: glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer,
  fabric: FABRICS[FAB], d: D, garment: DEFAULT_GARMENT, minPairDistLite,
});
/* 상태 주입 — 물리는 «한 프레임도» 돌지 않는다 */
{
  const b = readFileSync(IN);
  const hl = b.readUInt32LE(0);
  const h = JSON.parse(b.subarray(4, 4 + hl).toString('utf8'));
  if (h.n !== P.sc.n) throw new Error(`정점 수 불일치 ${h.n} ≠ ${P.sc.n}`);
  const off = 4 + hl, nb = P.sc.n * 3 * 8;
  P.sc.s.pos.set(new Float64Array(b.buffer.slice(b.byteOffset + off, b.byteOffset + off + nb)));
}
const pos = P.sc.s.pos;
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });

/* 링 = 앞·뒤 목선을 하나의 닫힌 고리로 (v3-23 §1-② 와 같은 구성) */
const loop = [...P.neckF, ...[...P.neckB].reverse()];
const near = loop.map((v) => bd.nearestBodyPoint(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));

/* ㉣ 합성 — 링 정점을 몸 바깥 방향으로 PUSH 만큼 민다(계기 전용) */
if (PUSH > 0)
  loop.forEach((v, k) => {
    const o = v * 3, nb2 = near[k];
    const dx = pos[o] - nb2[0], dy = pos[o + 1] - nb2[1], dz = pos[o + 2] - nb2[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    pos[o] += (dx / L) * PUSH; pos[o + 1] += (dy / L) * PUSH; pos[o + 2] += (dz / L) * PUSH;
  });

const len = (pts: number[][]) =>
  pts.reduce((t, _, k) => {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    return t + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }, 0);

const ringPts = loop.map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
const C_ring = len(ringPts);
const C_body = len(near.map((p) => [p[0], p[1], p[2]]));
const delta = THICK + TOL_SELF;
const C_allow = C_body + 2 * Math.PI * delta;
const R = C_ring / C_allow;

/* 참고 채널 — 항등을 안 쓰는 «직접 오프셋» 둘레(§1-6 (1)) */
const C_direct = len(near.map((p, k) => {
  const o = loop[k] * 3;
  const dx = pos[o] - p[0], dy = pos[o + 1] - p[1], dz = pos[o + 2] - p[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  return [p[0] + (dx / L) * delta, p[1] + (dy / L) * delta, p[2] + (dz / L) * delta];
}));
/* 부호 확인 — 링이 몸 «밖»에 있는가(§1-6 (2)) */
let inside = 0;
for (const v of loop) if (bd.bodyClearance({ n: 1, pos: Float64Array.from([pos[v*3],pos[v*3+1],pos[v*3+2]]) } as never).minD < 0) inside++;

/* 구 채널 — 삭제하지 않고 병기(§0-4).
 * **주의**: `s4Gate` 의 `ringRatio` 는 앞·뒤 목선을 «열린 폴리라인 둘로» 재어 더한다.
 * 이 파일의 `C_ring` 은 «닫힌 고리»(양 끝 두 변이 더 들어간다) — **다른 양**이다.
 * 둘 다 찍어 정의 차이를 값으로 남긴다(함정 13 계열). */
const openLen = (ix: number[]) => ix.slice(1).reduce((t, v, k) =>
  t + Math.hypot(pos[v * 3] - pos[ix[k] * 3], pos[v * 3 + 1] - pos[ix[k] * 3 + 1],
                 pos[v * 3 + 2] - pos[ix[k] * 3 + 2]), 0);
const gateRing = openLen(P.neckF) + openLen(P.neckB);
const oldRatioGate = gateRing / P.ringRest;
const oldRatio = C_ring / P.ringRest;
const fails: string[] = [];
if (!(R <= 1)) fails.push(`목선 초과비 ${R.toFixed(4)} > 1 (C_ring ${(C_ring*100).toFixed(2)}cm > C_allow ${(C_allow*100).toFixed(2)}cm)`);

console.log(`[NECK:${TAG}]${PUSH > 0 ? ` **합성 PUSH=${(PUSH*1000).toFixed(2)}mm**` : ''}`);
console.log(`   C_ring  ${(C_ring * 100).toFixed(3)}cm   C_body ${(C_body * 100).toFixed(3)}cm   δ=THICK+TOL_SELF ${(delta*1000).toFixed(2)}mm`);
console.log(`   C_allow ${(C_allow * 100).toFixed(3)}cm  ⟹ **R = ${R.toFixed(4)}**  ${R <= 1 ? 'PASS' : '**FAIL**'}`);
console.log(`   참고: 직접 오프셋 둘레 ${(C_direct * 100).toFixed(3)}cm (항등 대비 차 ${((C_allow - C_direct) * 1000).toFixed(3)}mm) · 링이 몸 안쪽인 정점 ${inside}/${loop.length}`);
console.log(`   구 채널(참고 · 강등): **게이트 정의**(열린 합) ${oldRatioGate.toFixed(4)} ⟹ ${oldRatioGate <= 1.10 ? 'pass' : 'fail'}  ·  닫힌 고리 ${oldRatio.toFixed(4)} ⟹ ${oldRatio <= 1.10 ? 'pass' : 'fail'}  (휴지 ${(P.ringRest*100).toFixed(2)}cm)`);
console.log(`   fails ${JSON.stringify(fails)}`);
