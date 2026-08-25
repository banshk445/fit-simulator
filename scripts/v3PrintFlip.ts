/* v3-65 §1 — **반전 «지점» 측정**. 고치기 «전»에 값으로만 답한다(추정 0 · 수정 0줄).
 * 세 층의 부호를 각각 등재하고 **곱**이 화면 반전을 설명하는지 확인한다 —
 * 한 층만 고쳐 우연히 맞는 **«이중 반전»** 을 남기지 않기 위함이다(§0-5).
 *
 *   ㉮ `printUv` 의 v 부호 — **v3 제도 y 축 방향을 «좌표값»으로** 실측.
 *      **어깨/밑단은 패턴 y 로 «가르지 않는다»**(그러면 순환이다 · #118).
 *      **독립 채널 = 정착 3D 세계 y**(blob 주입분). 세계에서 «위»에 있는 쪽이 어깨다.
 *   ㉯ 텍스처 **flipY** 규약 — three 기본값 + 제품 코드의 설정 유무.
 *   ㉰ 캔버스 합성의 **y 방향** — 상수와 그리기 호출.
 *
 * **물리 0프레임**(주입만) · v2 임포트 0 · `V2DIMS` 미사용(G1) · 손 상수 0.
 * 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3PrintFlip.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { buildPrintUv, type PanelSpan } from '../src/v3/printUv.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const sc = P.sc;
const spans: PanelSpan[] = sc.panels.map((p) => ({ name: p.name, base: p.base, count: (p.nu + 1) * (p.nv + 1) }));
const R = buildPrintUv(sc.uv, spans);

console.log(`[반전:${FAB} d${(D * 1000).toFixed(0)}] **물리 0프레임** · 정점 ${sc.n} · 공통 scale **${(R.scaleM * 100).toFixed(3)}cm**`);

/* ㉮ — 패널별로 «패턴 y 최대 행»과 «최소 행»을 각각 모아, 두 무리의 «세계 y» 평균을 잰다.
 *     세계 y 가 큰 쪽이 어깨. 그 무리의 uv v 평균을 함께 낸다. */
console.log(`  ㉮ printUv v 부호 — 어깨/밑단은 **세계 y(독립 채널)** 로 가른다`);
for (const p of R.panels) {
  let yLo = Infinity, yHi = -Infinity;
  for (let k = 0; k < p.count; k++) { const y = sc.uv[(p.base + k) * 2 + 1]; if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
  const eps = (yHi - yLo) * 1e-6;
  const grab = (target: number) => {
    let n = 0, wy = 0, vv = 0;
    for (let k = 0; k < p.count; k++) {
      const i = (p.base + k) * 2;
      if (Math.abs(sc.uv[i + 1] - target) > eps) continue;
      n++; wy += sc.s.pos[(p.base + k) * 3 + 1]; vv += R.uv[i + 1];
    }
    return { n, wy: wy / n, v: vv / n };
  };
  const hi = grab(yHi), lo = grab(yLo);
  const sh = hi.wy > lo.wy ? { tag: '패턴 y **최대**', ...hi } : { tag: '패턴 y **최소**', ...lo };
  const hm = hi.wy > lo.wy ? { tag: '패턴 y **최소**', ...lo } : { tag: '패턴 y **최대**', ...hi };
  console.log(`     ${p.name.padEnd(8)} 패턴 y ${(yLo * 100).toFixed(2)}~${(yHi * 100).toFixed(2)}cm`
    + ` · **어깨측** = ${sh.tag}(세계 y ${(sh.wy * 100).toFixed(2)}cm · n=${sh.n}) → **v ${sh.v.toFixed(4)}**`
    + ` · **밑단측** = ${hm.tag}(세계 y ${(hm.wy * 100).toFixed(2)}cm · n=${hm.n}) → **v ${hm.v.toFixed(4)}**`
    + ` ⟹ 어깨 v ${sh.v > hm.v ? '>' : '<'} 밑단 v`);
}

/* ㉯·㉰ — 부호가 «소스에 문언으로» 있는 층이다. 계기가 파일을 읽어 그 줄을 그대로 뜬다
 *        (손으로 옮겨 적지 않는다 · 함정 13 계열 예방). */
const pick = (path: string, re: RegExp) => {
  const ls = readFileSync(path, 'utf8').split('\n');
  const out: string[] = [];
  ls.forEach((l, i) => { if (re.test(l)) out.push(`${path}:${i + 1}  ${l.trim()}`); });
  return out;
};
console.log(`  ㉯ 텍스처 flipY 규약`);
for (const l of pick('node_modules/three/src/textures/Texture.js', /^\t\tthis\.flipY = /)) console.log(`     ${l}`);
const setFlip = pick('src/components/V3Panel.tsx', /flipY/).concat(pick('src/v3/productView.ts', /flipY/));
console.log(`     제품 코드의 flipY 설정: **${setFlip.length === 0 ? '0건 ⟹ 기본값 그대로' : setFlip.join(' | ')}**`);
console.log(`  ㉰ 캔버스 합성 y 방향`);
for (const l of pick('src/v3/printComposite.ts', /PRINT_TOP_FRACTION|const destY|ctx\.drawImage\(img, box/)) console.log(`     ${l}`);
