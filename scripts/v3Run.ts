/* v3-35 §2 — 공유 실행부(`src/v3/dressRun.ts`)의 **Node 드라이버**.
 *
 * 목적은 «귀속»이다. Node ↔ 브라우저가 갈릴 때 원인이 「엔진」인지 「내 루프가 하네스와
 * 다른 것」인지 가르려면 세 점이 필요하다:
 *   ㉠ 하네스(v3S4)          — v3-33·v3-34가 커밋한 정본
 *   ㉡ Node + 공유 실행부     — 이 파일
 *   ㉢ 브라우저 + 공유 실행부  — 워커
 * ㉠↔㉡ 이 같으면 공유 실행부가 하네스와 같은 것이고, ㉡↔㉢ 이 갈리면 «엔진»이다.
 *
 * 진입: `FRAMES=86 FAB=gray D_MM=11 OUT=<경로> npx tsx scripts/v3Run.ts`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { prepare, runFrames, stateBlob, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';

const GLB = process.env.GLB ?? 'public/models/mannequin.glb';
const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 11) / 1000;
const FRAMES = Number(process.env.FRAMES ?? 86);
const OUT = process.env.OUT ?? '.v3cache/v3-35-node.bin';
const fabric = FABRICS[FAB];
if (!fabric) throw new Error(`모르는 원단: ${FAB}`);

const b = readFileSync(GLB);
const t0 = performance.now();
const P = prepare({
  glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  fabric, d: D, garment: DEFAULT_GARMENT, minPairDistLite,
});
console.log(`╔══ v3Run [${FAB}] d ${(D * 1000).toFixed(1)}mm · 정점 ${P.sc.n} · 삼각형 ${P.sc.tris.length / 3} · 서브스텝 ${P.SUB}(멤 ${P.sub.memb}/굽 ${P.sub.bend}) · 램프 ${P.RAMP_N} · 상한 ${FRAMES} ══╗`);
console.log(`   파생 치수: 목선반폭 ${(P.S.NECK_A * 100).toFixed(2)}cm · 목선둘레 ${(P.S.NECK_G * 100).toFixed(2)}cm · 소매산 ${(P.S.CAP_H * 100).toFixed(2)}cm · 암홀깊이 ${(P.S.ARM_D * 100).toFixed(3)}cm`);
console.log(`   배치: δ ${(P.S.DELTA * 1000).toFixed(2)}mm · 소매 x0 ${(P.S.SLV_X0 * 100).toFixed(1)}cm · R ${(P.S.SLV_R * 1000).toFixed(1)}mm · 서명 ${P.S.PLACE_SIG}`);

const r = runFrames(P, FRAMES, (p) => {
  if (p.frame % 25 === 0)
    console.log(`   f=${String(p.frame).padStart(4)} ${((performance.now() - t0) / 1000).toFixed(0).padStart(6)}s · 창 순변위 ${p.netMm.toFixed(4)}mm`);
});
const wall = (performance.now() - t0) / 1000;
console.log(`   [v3Run:${FAB}] 프레임 ${r.frame} · ${wall.toFixed(0)}초 · ${(wall / Math.max(1, r.frame)).toFixed(2)} s/f · 발산 ${r.diverged ? '있음' : '0'}`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, stateBlob(P, r.frame, P.S.PLACE_SIG));
console.log(`   상태 blob → ${OUT}`);
