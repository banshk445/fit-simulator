/* v3-59 §2 — **G7 자기검사**(UV 계약 «성질» 3건). **판정 «전» 등재 · 물리 0프레임**(blob 주입만).
 * 정의는 `docs/v3/40-프린트UV.md` §0-3 이 «먼저» 확정했다. v2 임포트 0 · `V2DIMS` 미사용(G1).
 *
 *   **①** u·v ∈ [0,1] — 패널별 **위반 수 = 0**
 *   **②** **축척 보존** — «등재 가능한 결정적 표본»에서 **패턴 거리 / uv 거리 = scale**.
 *         표본 = **각 패널의 네 «모서리 쌍»**(i·j 격자 끝점 · 무작위 0 · 뽑는 규칙이 문서에 적힌다).
 *         문턱 = **`TOL_SELF`(0.1mm)를 `scale` 로 나눈 상대량**(**새 수 0** — 등재 상수의 «단위 환산»).
 *   **③** **v 방향** — **v3-65 §2 정정**(#120 · **구 문언 무삭제**):
 *         구: 「어깨측 정점의 v **<** 밑단측 정점의 v」 — **v2 계약 «유도»와 정반대로 등록됐다**
 *             (귀책 = 전략 세션 · v3-65 §0-2 ①). 함정 14 아님: 정정 방향이 **「통과 → 실패」**이고
 *             근거가 결과가 아니라 **계약 문언 유도 + 방향 자명 자산의 픽셀**이다.
 *         신: **어깨측 정점의 v > 밑단측 정점의 v**  ← 텍스처 «위»(v=1) = 어깨 · flipY=true 가
 *             캔버스 «위»를 v=1 로 올린다 ⟹ 어깨가 v 큰 쪽이어야 프린트가 정립한다.
 *         **어깨측/밑단측은 «패턴 y» 로 가르지 않는다**(그것이 정정 대상이라 순환이다 · #118):
 *             **정착 세계 y**(독립 채널)가 큰 쪽이 어깨다.
 *
 * 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3PrintUvCheck.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, TOL_SELF } from '../src/v3/consts.ts';
import { buildPrintUv, type PanelSpan } from '../src/v3/printUv.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const sc = P.sc;
const spans: PanelSpan[] = sc.panels.map((p) => ({ name: p.name, base: p.base, count: (p.nu + 1) * (p.nv + 1) }));
const R = buildPrintUv(sc.uv, spans);
console.log(`[G7:${FAB} d${(D * 1000).toFixed(0)}] **물리 0프레임** · 정점 ${sc.n} · 패널 ${spans.length} · **공통 scale ${(R.scaleM * 100).toFixed(3)}cm**`);
for (const p of R.panels)
  console.log(`  ${p.name.padEnd(8)} bbox ${(p.wM * 100).toFixed(2)}×${(p.hM * 100).toFixed(2)}cm → uMax ${p.uMax.toFixed(4)} · vMax ${p.vMax.toFixed(4)}`);

/* ① 범위 */
let bad = 0;
for (const p of R.panels) {
  let b = 0;
  for (let k = 0; k < p.count; k++) {
    const u = R.uv[(p.base + k) * 2], v = R.uv[(p.base + k) * 2 + 1];
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) b++;
  }
  bad += b;
  console.log(`  ① ${p.name.padEnd(8)} [0,1] 위반 **${b}** / ${p.count}`);
}
console.log(`  **① 판정** 위반 총 **${bad}** ⟹ ${bad === 0 ? '**통과**' : '**실패 — 갈래 B**'}`);

/* ② 축척 보존 — 각 패널의 «모서리 쌍»(결정적) */
const REL = TOL_SELF / R.scaleM;                       // 등재 상수의 단위 환산 · 새 수 0
let maxRel = 0;
for (const pn of sc.panels) {
  const at = (i: number, j: number) => pn.base + j * (pn.nu + 1) + i;
  const corners: [number, number][] = [[at(0, 0), at(pn.nu, 0)], [at(0, pn.nv), at(pn.nu, pn.nv)],
                                       [at(0, 0), at(0, pn.nv)], [at(pn.nu, 0), at(pn.nu, pn.nv)]];
  for (const [a, b] of corners) {
    const dM = Math.hypot(sc.uv[a * 2] - sc.uv[b * 2], sc.uv[a * 2 + 1] - sc.uv[b * 2 + 1]);
    const dU = Math.hypot(R.uv[a * 2] - R.uv[b * 2], R.uv[a * 2 + 1] - R.uv[b * 2 + 1]);
    const rel = Math.abs(dM / R.scaleM - dU);          // 「패턴 거리 / scale」 = 「uv 거리」 여야 한다
    if (rel > maxRel) maxRel = rel;
  }
}
console.log(`  **② 판정** 축척 편차 max **${maxRel.toExponential(3)}** ≤ 문턱 ${REL.toExponential(3)}(= TOL_SELF/scale) ⟹ ${maxRel <= REL ? '**통과**' : '**실패 — 갈래 B**'}`);

/* ③ v 방향 — **어깨측 v > 밑단측 v**(v3-65 §2 정정 · 구 문언은 머리주석에 무삭제).
 * 어깨측/밑단측은 **패턴 y 로 가르지 않는다**(그것이 정정 대상 ⟹ 순환 · #118).
 * **독립 채널 = 정착 세계 y** — 두 끝 행의 세계 y 평균이 «위»인 쪽이 어깨다. */
let dirBad = 0;
for (const p of R.panels) {
  let yLo = Infinity, yHi = -Infinity;
  for (let k = 0; k < p.count; k++) { const y = sc.uv[(p.base + k) * 2 + 1]; if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
  const eps = (yHi - yLo) * 1e-6;
  const row = (target: number) => {
    let n = 0, wy = 0, vv = 0;
    for (let k = 0; k < p.count; k++) {
      const i = (p.base + k) * 2;
      if (Math.abs(sc.uv[i + 1] - target) > eps) continue;
      n++; wy += sc.s.pos[(p.base + k) * 3 + 1]; vv += R.uv[i + 1];
    }
    return { n, wy: wy / n, v: vv / n };
  };
  const a = row(yHi), b = row(yLo);
  const sh = a.wy > b.wy ? a : b, hm = a.wy > b.wy ? b : a;
  const ok = sh.v > hm.v;
  if (!ok) dirBad++;
  console.log(`  ③ ${p.name.padEnd(8)} 어깨측(세계 y ${(sh.wy * 100).toFixed(2)}cm · v ${sh.v.toFixed(4)})`
    + ` > 밑단측(세계 y ${(hm.wy * 100).toFixed(2)}cm · v ${hm.v.toFixed(4)}) ⟹ ${ok ? '성립' : '**불성립**'}`);
}
console.log(`  **③ 판정** 불성립 패널 **${dirBad}** ⟹ ${dirBad === 0 ? '**통과**' : '**실패 — 갈래 B**'}`);
console.log(`  **G7 종합** ${bad === 0 && maxRel <= REL && dirBad === 0 ? '**3/3 통과**' : '**실패 — 갈래 B 정지**'}`);
