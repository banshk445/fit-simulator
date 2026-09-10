/* v3-73 — **몸 축 민감도 «칸» 드라이버**(Node · **측정 전용 · 정본 아님** · v3-70 §0-C).
 *
 * 한 «칸» = 구운 몸 정점 배열 하나 × `GARMENT_V1` × `gray`. 정착까지 돌리고
 * **게이트(③a · crossings · settleNet)** 와 **5행 핏 표**를 낸다. **문턱 변경 0 · 새 채널 0.**
 * ③b 는 별도 계기(`scripts/v3Gate3b.ts`)가 같은 도출식(`h × 25%`)으로 판정한다 —
 * 여기서는 **그 칸의 h 와 문턱을 인쇄**해 대조 가능하게만 둔다.
 *
 * 진입: `VERTS=<bin> FRAMES=<상한> [TAG=<이름>] npx tsx scripts/v3Sensitivity.ts`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { prepare, runFrames, stateBlob, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { runS4Gate, N_WIN, S4_THRESHOLD } from '../src/v3/s4Gate.ts';
import { deriveLevels } from '../src/v3/bodyLevels.ts';
import { buildFitReport } from '../src/v3/fitReport.ts';

/** v3-73 §0-3 — 사용자 확정 치수. **SLEN = 화장 42 − SW/2 = 0.20 m**(도출식 등재) ·
 * **ARM_G 는 제도 기본값**(차트가 암홀을 주지 않는다 — 한계 등재). */
const GARMENT_V1 = { L: 0.71, W: 0.51, SW: 0.44, SLEN: 0.20, ARM_G: DEFAULT_GARMENT.ARM_G };

const TAG = process.env.TAG ?? 'cell';
const CAP = Number(process.env.FRAMES ?? 600);
const D = Number(process.env.D_MM ?? 9) / 1000;
const vb = readFileSync(process.env.VERTS!);
const verts = new Float32Array(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength));
const g = readFileSync('public/models/mannequin.glb');
const t0 = performance.now();
const P = prepare({ glb: g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer,
  fabric: FABRICS.gray, d: D, garment: GARMENT_V1, bodyVerts: verts, minPairDistLite });
const prepMs = performance.now() - t0;
console.log(`[민감도:${TAG}] 조립 정점 ${P.sc.n} · 삼각형 ${P.sc.tris.length / 3} · 준비 ${(prepMs / 1000).toFixed(1)}s`);
console.log(`  도출 — BEXT [${P.bext.map((v) => v.toFixed(6)).join(', ')}]m · h **${(P.sdfSpec.h * 1000).toFixed(6)}mm**`
  + ` · band ${(P.sdfSpec.band * 1000).toFixed(6)}mm · **③b 문턱 ${(0.25 * P.sdfSpec.h * 1000).toFixed(6)}mm**`
  + ` · Y_TOP ${(P.S.Y_TOP * 100).toFixed(4)}cm · AXIS_Z ${(P.S.AXIS_Z * 100).toFixed(4)}cm`
  + ` · 목선둘레 ${(P.S.NECK_G * 100).toFixed(4)}cm`);

/* 정착까지 «청크»로 돈다. 게이트의 `before` 는 마지막 N_WIN 프레임 «전» 상태다(v3-22 채널). */
let frame = 0, before: Float64Array | undefined, s4: ReturnType<typeof runS4Gate> | null = null;
const CH = N_WIN;
const tRun = performance.now();
while (frame < CAP) {
  before = Float64Array.from(P.sc.s.pos);
  /* ★ v3-73 정정 — `runFrames` 의 반환 `frame` 은 **그 호출이 돈 «개수»**이지 누적 절대 프레임이
   * 아니다(`frames` 인자가 개수다 · `startFrame` 은 램프 전용). 1차 구현은 `frame = r.frame` 이라
   * **청크마다 10 에 고정**됐다 — 물리는 돌았지만 **프레임 번호가 안 늘었다**. 여기서 «누적»한다. */
  const step = Math.min(CH, CAP - frame);
  const r = await runFrames(P, step, undefined, undefined, frame);
  frame += step;
  void r.stopped;
  if (r.diverged) { console.log(`  **발산** f=${frame}`); break; }
  s4 = runS4Gate(P, before);
  const el = (performance.now() - tRun) / 1000;
  console.log(`  f=${frame} · ${el.toFixed(1)}s · 관통 ${(s4.penMaxM * 1000).toFixed(4)}mm`
    + ` · 교차 ${s4.crossings} · 순변위 ${(s4.settleNetM * 1000).toFixed(4)}mm · ringExcess ${s4.ringExcess.toFixed(4)}`
    + ` · pass ${s4.pass}${s4.fails.length ? ` · fails ${s4.fails.join(',')}` : ''}`);
  /* ★ v3-75 정정 — 종전에는 `s4.pass` 로만 멈췄다. 그러면 **③a·목선이 «실패로 고정»된 칸**은
   * 정착이 끝난 뒤에도 상한(900)까지 돈다(칸당 약 3시간 ⟹ 예산 초과). **목적은 «정착»이고
   * 게이트 실패는 §0-5 대로 «그 칸의 데이터»**다 ⟹ **정착 도달로 멈추고 게이트는 «그때 값»을 적는다**.
   * **문턱은 등재값 그대로**(`S4_THRESHOLD.settleNetM`) — **새 문턱 0**. */
  if (s4.pass || s4.settleNetM <= S4_THRESHOLD.settleNetM) break;
}
const runS = (performance.now() - tRun) / 1000;
console.log(`  **정착 ${s4 && s4.settleNetM <= S4_THRESHOLD.settleNetM ? '도달' : '**미도달**'}** · **게이트 ${s4?.pass ? 'pass' : `fail(${s4?.fails.join(' / ')})`}** · f=${frame} · 실행 **${runS.toFixed(1)}s** · 총 **${((performance.now() - t0) / 1000).toFixed(1)}s**`);

try {
  const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);
  const R = buildFitReport(P, L);
  const f = (v: number, w = 9) => (Number.isFinite(v) ? v.toFixed(2) : '—').padStart(w);
  console.log(`  핏 — 경계 ${R.sepMm.toFixed(1)}mm · 대역 반폭 ${R.bandHalfMm.toFixed(1)}mm`
    + ` · 가슴 y${R.levels.chestYCm.toFixed(2)}(C ${R.levels.cChestCm.toFixed(2)}) · 허리 y${R.levels.waistYCm.toFixed(2)}(C ${R.levels.cWaistCm.toFixed(2)})`);
  for (const r of R.rows) {
    const ph = !Number.isFinite(r.medMm) ? '산출불가' : r.medMm < 0 ? '눌림' : r.medMm <= R.sepMm ? '밀착' : '여유';
    console.log(`  · ${r.name.padEnd(4)} ${f(r.medMm)} ${f(r.p25Mm)}~${f(r.p75Mm)}  **${ph}**  ${r.pressN}/${r.snugN}/${r.looseN}  ${r.n}/${r.domain}`);
  }
} catch (e) { console.log(`  핏 표 **산출 불가** — ${(e as Error).message}`); }

if (process.env.OUT) {
  mkdirSync(dirname(process.env.OUT), { recursive: true });
  writeFileSync(process.env.OUT, stateBlob(P, frame, P.S.PLACE_SIG));
}
