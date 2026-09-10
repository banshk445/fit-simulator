/* v3-55 §2 — **게이트 ③b**(양(+)방향 유계 보증). 정의는 `src/v3/s4Gate.ts` 주석이 정본이다.
 * **물리 0프레임**(정착 blob 주입만) · **`solver.ts` 무변경** · 판정 로직을 `s4Gate` 에 넣지 않는다
 * (게이트 실행 경로를 건드리면 하네스 비트 동일성이 흔들린다 — 계기로 분리한다).
 *
 *   정의역  min(정확거리, sampleSdf) ≤ SEP 인 정점 전량
 *   측정    Δ = |정확거리 − sampleSdf| 의 max · p95 · 표본수
 *   문턱    **일반형 `h × 25%`**(= `instruments.ts` 정정 **정본 문언**의 게이트 승격).
 *           **v3-70 §3 한정 재등재**: 구 문언의 「v3-56 «고정 승격» ⟹ 0.9877mm」에서 그 수는
 *           **«기본 몸 전용» 예시**다(`h` 는 몸에서 온 `BEXT` 의 함수 · v3-69 §1-5). **구 문언 무삭제.**
 *           **아래 `:51` 이 이미 도출식**이라 **코드 변경은 0줄**이다(완화 0).
 *           **구 문턱**(v3-53 §2-1 «밴드 안 최대차» 원단별 인용)은 **무삭제**로 병기한다(대조 전용).
 *   판정    max Δ ≤ 문턱 ⟹ 통과
 *
 * 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3Gate3b.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, THICK, SEP } from '../src/v3/consts.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';

/** **구 문턱**(v3-55) — v3-53 §2-1 등재 「밴드 안 최대차」[mm]. **무삭제 · 대조 전용 · 판정 미사용.**
 * 이 문턱은 **판정 정의역과 «같은 표본»에서 나와** 구조적 항등이었다(v3-55 §2-1 · **#117**). */
const BAND_MAX_MM: Record<string, number> = { gray: 0.9429, swim: 0.9610, sweat: 0.9752 };

/** **문턱 배수**(v3-56 고정 승격) — `instruments.ts` 정정 정본 문언 「격자 SDF 오차는 **최대 h의 약 25%**」
 * 를 **게이트로 승격**한 것이다. **이 파일이 정하는 수는 0**이고 **스펙 «문장»을 인용**한다.
 * 판별력: 문턱이 **h(굽기 스펙)** 에서 오므로 **판정 정의역과 서로소**다 ⟹ **떨어질 수 있다**(#117 해소). */
const TH_FRAC = 0.25;

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const BAND = THICK + 2 * P.sdfSpec.h;
const pos = P.sc.s.pos;

const dif: number[] = [];
let maxD = 0, worst = -1;
for (let v = 0; v < P.sc.n; v++) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  const g = sampleSdf(P.bodyG, x, y, z);
  const e = bd.exactBodyDist(x, y, z);
  const signed = g < BAND && g < 0 ? -e : e;                 // 부호 규칙은 `fitReport` 와 «같다»
  if (!(Math.min(Math.abs(signed), g) <= SEP)) continue;     // 정의역 — 접촉 근방
  const d2 = Math.abs(signed - g);
  dif.push(d2);
  if (d2 > maxD) { maxD = d2; worst = v; }
}
dif.sort((a, b) => a - b);
const p95 = dif.length ? dif[Math.min(dif.length - 1, Math.floor(0.95 * dif.length))] : NaN;
const TH = TH_FRAC * P.sdfSpec.h * 1000;            // 고정 문턱[mm] — h 에서 «도출»된다
const TH_OLD = BAND_MAX_MM[FAB];                   // 구 문턱 — 대조 전용
const mm = (v: number) => (v * 1000).toFixed(4);
console.log(`[③b:${FAB} d${(D * 1000).toFixed(0)}] **물리 0프레임** · 정점 ${P.sc.n} · SEP ${(SEP * 1000).toFixed(1)}mm · 밴드 ${(BAND * 1000).toFixed(3)}mm`);
console.log(`  정의역(접촉 근방) 표본 **${dif.length}** / ${P.sc.n} (${((100 * dif.length) / P.sc.n).toFixed(1)}%)`);
console.log(`  Δ = |정확거리 − sampleSdf|  **max ${mm(maxD)}mm** · p95 ${mm(p95)}mm · 중앙 ${mm(dif[Math.floor(dif.length / 2)] ?? NaN)}mm`);
if (worst >= 0)
  console.log(`  최악 정점 v${worst} @ (${(pos[worst * 3] * 100).toFixed(2)}, ${(pos[worst * 3 + 1] * 100).toFixed(2)}, ${(pos[worst * 3 + 2] * 100).toFixed(2)})cm`);
console.log(`  **문턱(v3-56 고정)** h ${(P.sdfSpec.h * 1000).toFixed(3)}mm × ${(TH_FRAC * 100).toFixed(0)}% = **${TH.toFixed(4)}mm** — 출처 instruments.ts 정정 정본 문언`);
console.log(`  (구 문턱 · 대조 전용 · 판정 미사용) ${TH_OLD.toFixed(4)}mm — 정의역과 «같은 표본»이라 항등이었다(#117)`);
console.log(`  **③b 판정** max ${mm(maxD)} ≤ ${TH.toFixed(4)} ⟹ ${maxD * 1000 <= TH ? '**통과**' : '**초과 — 정지**'} · 여유 ${(TH - maxD * 1000).toFixed(4)}mm (${((100 * (TH - maxD * 1000)) / TH).toFixed(1)}%)`);
