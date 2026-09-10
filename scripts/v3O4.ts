/* v3-48 §3 — **O4 계기(정적)**. 정착 blob 하나를 «주입»해 물리 **0프레임**으로 O4 만 낸다.
 * 식은 v3-26(S5) 하네스의 `bodyObs()` «그 줄»이다 — `sampleSdf(bodyG,·) ≤ SEP` 인 정점의 비율[%].
 * 새 문턱 0 · 물리 0줄 · 조립 0줄. 판정(인접 차 ≥ 0.25pp · 순서)은 바깥이 한다.
 * 진입: `FAB=sweat D_MM=8 BLOB=<경로> npx tsx scripts/v3O4.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
/* v3-54 ㉠ — S5 «교차 확인». 리포트 채널(정확 거리)로도 같은 O4 를 내어 순서·인접 차를 본다.
 * 검증 채널(SDF)은 그대로 두고 **병기**한다 — 어느 쪽도 상대를 대체하지 않는다(#115). */
import { makeBodyDistance } from '../src/v3/instruments.ts';
import { THICK } from '../src/v3/consts.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const BLOB = process.env.BLOB ?? '';
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const g = readFileSync('public/models/mannequin.glb');
const st = readFileSync(BLOB);
const hl = new DataView(ab(st)).getUint32(0, true);
const hdr = JSON.parse(new TextDecoder().decode(st.subarray(4, 4 + hl)));
const P = prepare({ glb: ab(g), fabric: FABRICS[FAB], d: D, garment: DEFAULT_GARMENT,
  minPairDistLite, injectState: ab(st) });
const { sc, bodyG } = P;
const d: number[] = [];
for (let v = 0; v < sc.n; v++) d.push(sampleSdf(bodyG, sc.s.pos[v * 3], sc.s.pos[v * 3 + 1], sc.s.pos[v * 3 + 2]));
d.sort((x, y) => x - y);
const touch = (d.filter((x) => x <= SEP).length / sc.n) * 100;
/* 정확 거리 판 — 부호 규칙은 `fitReport` 와 «같다»(밴드 안 SDF 부호 · 밴드 밖 «+» 확정). */
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG, h: P.sdfSpec.h, thick: THICK });
const BAND = THICK + 2 * P.sdfSpec.h;
const de: number[] = [];
for (let v = 0; v < sc.n; v++) {
  const x = sc.s.pos[v * 3], y = sc.s.pos[v * 3 + 1], z = sc.s.pos[v * 3 + 2];
  const g = sampleSdf(bodyG, x, y, z), e = bd.exactBodyDist(x, y, z);
  de.push(g < BAND && g < 0 ? -e : e);
}
de.sort((x, y) => x - y);
const touchE = (de.filter((x) => x <= SEP).length / sc.n) * 100;
console.log(`[O4:${FAB} d${(D * 1000).toFixed(0)}] **정확 ${touchE.toFixed(2)}%** · SDF ${touch.toFixed(2)}% · 간극중앙 ${(d[Math.floor(sc.n / 2)] * 1000).toFixed(3)}mm · 정점 ${sc.n} · blob 헤더 ${JSON.stringify(hdr)}`);
