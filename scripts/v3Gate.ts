/* v3-47 — **Node S4 게이트**. 워커(`v3DressWorker`)의 실행·게이트 «그 줄»을 그대로 옮긴 계기다.
 * 브라우저 탭 유실(v3-47 §3-2 관측)에 막혀 만든 «전달 경로»이고, 물리·게이트 로직은 0줄 변경이다.
 * 문턱은 `s4Gate.ts` 의 등재값을 그대로 쓴다(새 문턱 0).
 * 진입: `FRAMES=370 FAB=sweat D_MM=8 OUT=<경로> npx tsx scripts/v3Gate.ts`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { prepare, runFrames, stateBlob, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { runS4Gate, N_WIN } from '../src/v3/s4Gate.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const FRAMES = Number(process.env.FRAMES ?? 220);
const OUT = process.env.OUT ?? `/tmp/v3-47/gate-${FAB}.bin`;
const b = readFileSync('public/models/mannequin.glb');
const t0 = performance.now();
const P = prepare({ glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  fabric: FABRICS[FAB], d: D, garment: DEFAULT_GARMENT, minPairDistLite });
console.log(`[v3Gate:${FAB}] d ${(D*1000).toFixed(1)}mm · 정점 ${P.sc.n} · sub ${P.SUB} · 램프 ${P.RAMP_N} · 상한 ${FRAMES}`);
let before: Float64Array | undefined;
const r = await runFrames(P, FRAMES, (p) => {
  if (p.frame === FRAMES - N_WIN) before = Float64Array.from(P.sc.s.pos);
  if (p.frame % 20 === 0)
    console.log(`   f=${String(p.frame).padStart(4)} ${((performance.now()-t0)/60000).toFixed(1)}분 · 창 순변위 ${p.netMm.toFixed(4)}mm`);
});
const wall = (performance.now() - t0) / 60000;
const s4 = runS4Gate(P, before);
console.log(`   [게이트] 프레임 ${r.frame} · **${wall.toFixed(1)}분** · 발산 ${r.diverged ? '있음' : '0'} · 정지 ${r.stopped}`);
console.log(`   ${JSON.stringify(s4)}`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, stateBlob(P, r.frame, P.S.PLACE_SIG));
console.log(`   상태 blob → ${OUT}`);
