/* v3-57 §1 — **어깨 대역의 SDF 오차 ↔ 어깨 집힘 «상관 측정»**. **물리 0프레임 · 수정 0줄.**
 * 정의는 `docs/v3/38-어깨SDF상관.md` §0-3 이 «먼저» 확정했다. **기전 귀속 0 · 처방 0.**
 * v2 임포트 0 · `V2DIMS` 미사용. 진입: `FAB=gray D_MM=9 BLOB=<경로> npx tsx scripts/v3ShoulderSdf.ts`
 *
 * **CC 구현 판단 1건(집행 «전» 등재)**: 곡률 대리량을 「최근접 «삼각형»의 이면각 최대」가 아니라
 *   「최근접 «몸 정점»의 입사 엣지 이면각 최대」로 잰다. 사유 — 삼각형 id 를 내는 «등재 접근자»가
 *   없고(`makeBodyDistance` 는 점·거리만 낸다), 새로 만들면 **같은 양의 두 번째 구현**이 된다
 *   (함정 22). 최근접 정점은 **문턱 0**이고 대리량의 의미(그 자리 몸이 얼마나 꺾였나)는 같다.
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { FABRICS, THICK } from '../src/v3/consts.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';

const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const P = prepare({ glb: ab(readFileSync('public/models/mannequin.glb')), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(readFileSync(process.env.BLOB!)) });
const { sc, prim0, bodyIdx, bodyG, S } = P;
const pos = sc.s.pos;
const bd = makeBodyDistance({ pos: prim0.pos, idx: bodyIdx, bodyG, h: P.sdfSpec.h, thick: THICK });
const BAND = THICK + 2 * P.sdfSpec.h;
const mm = (v: number) => (v * 1000).toFixed(4);
const cm = (v: number) => (v * 100).toFixed(2);
const q = (a: number[], f: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);

/** 부호 있는 오차 e = 정확거리 − sampleSdf. 부호 규칙은 `fitReport` 와 «같다». */
const eOf = (v: number) => {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  const g = sampleSdf(bodyG, x, y, z), ex = bd.exactBodyDist(x, y, z);
  return (g < BAND && g < 0 ? -ex : ex) - g;
};
/** v3-44 계기 «그 줄» — 몸 법선 이격(근방은 정확 거리 · 먼 곳은 SDF). */
const signedGap = (v: number) => {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  const g = sampleSdf(bodyG, x, y, z);
  return g > bd.CELL ? g : (g < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z);
};

console.log(`[어깨SDF:${FAB} d${(D * 1000).toFixed(0)}] **물리 0프레임** · 정점 ${sc.n} · Y_TOP ${cm(S.Y_TOP)} · Y_NECK ${cm(S.Y_NECK)}cm`);

/* ── 채널 ① : 어깨 대역 y ∈ [Y_TOP, Y_NECK] 의 e 분포 · 대역 밖과 병기 ── */
const inBandIx: number[] = [], outIx: number[] = [];
for (let v = 0; v < sc.n; v++) {
  const y = pos[v * 3 + 1];
  (y >= S.Y_TOP && y <= S.Y_NECK ? inBandIx : outIx).push(v);
}
const stat = (ix: number[], tag: string) => {
  const e = ix.map(eOf);
  const a = e.map(Math.abs).sort((x, y) => x - y);
  const pos_ = e.filter((x) => x > 0).length;
  console.log(`  ${tag.padEnd(22)} n ${String(ix.length).padStart(5)} · |e| 중앙 ${mm(q(a, .5))} · p95 ${mm(q(a, .95))} · max ${mm(q(a, 1))} mm · e>0 ${((100 * pos_) / (e.length || 1)).toFixed(1)}%`);
  return e;
};
console.log(`  ── 채널 ① e = 정확거리 − sampleSdf ──`);
stat(inBandIx, '어깨 대역[Y_TOP,Y_NECK]');
stat(outIx, '대역 «밖»(그 외 전량)');

/* ── 채널 ② : v3-44 ㉡ 상승 상위 5% ∩ |e| 상위 5% — «같은 모집단»에서 뽑는다 ── */
const yLo = S.Y_TOP - S.CAP_H;                       // v3-44 ㉡1 정의 그대로
const band: number[] = [];
for (let v = 0; v < sc.n; v++) if (pos[v * 3 + 1] >= yLo) band.push(v);
const N = band.length, K = Math.max(1, Math.round(N * 0.05));
const topGap = new Set(band.map((v) => [signedGap(v), v] as [number, number]).sort((x, y) => y[0] - x[0]).slice(0, K).map((p) => p[1]));
const eb = band.map((v) => [Math.abs(eOf(v)), v] as [number, number]).sort((x, y) => y[0] - x[0]);
const topE = new Set(eb.slice(0, K).map((p) => p[1]));
let hit = 0; for (const v of topE) if (topGap.has(v)) hit++;
const expect = (K * K) / N;
console.log(`  ── 채널 ② 겹침(모집단 = v3-44 어깨 대역 y ≥ Y_TOP−CAP_H = ${cm(yLo)}cm · n ${N}) ──`);
console.log(`     상승 상위 5% ${K}개 ∩ |e| 상위 5% ${K}개 = **${hit}** · 우연 기대치 ${expect.toFixed(2)} ⟹ **배율 ${(hit / expect).toFixed(2)}배**`);
const hitE = [...topE].filter((v) => topGap.has(v)).map(eOf);
const posShare = hitE.length ? (100 * hitE.filter((x) => x > 0).length) / hitE.length : NaN;
console.log(`     교집합 자리의 e 부호 — e>0 **${posShare.toFixed(1)}%** (n ${hitE.length})`);

/* ── 채널 ③ : 시접 ±2열(v3-44 ㉡4 정의 그대로) 안/밖 ── */
const panelOf = (v: number) => {
  for (const p of sc.panels) { const c = (p.nu + 1) * (p.nv + 1); if (v >= p.base && v < p.base + c) { const k = v - p.base; return { p, i: k % (p.nu + 1), j: Math.floor(k / (p.nu + 1)) }; } }
  throw new Error(`패널 역산 실패 v${v}`);
};
const near = new Set<number>();
for (const sm of sc.seams) for (const v of [...sm.a, ...sm.b]) {
  const { p, i, j } = panelOf(v);
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
    const i2 = i + di, j2 = j + dj;
    if (i2 < 0 || j2 < 0 || i2 > p.nu || j2 > p.nv) continue;
    near.add(p.base + j2 * (p.nu + 1) + i2);
  }
}
console.log(`  ── 채널 ③ 시접 ±2열(v3-44 ㉡4 정의) ──`);
stat(band.filter((v) => near.has(v)), '  시접 대역 «안»');
stat(band.filter((v) => !near.has(v)), '  시접 대역 «밖»');

/* ── 몸 쪽 병기 : 최근접 «몸 정점»의 입사 엣지 이면각 최대 ↔ |e| 순위 상관 ── */
const nv = prim0.pos.length / 3;
const tri = (t: number) => {
  const a = bodyIdx[t * 3] * 3, b = bodyIdx[t * 3 + 1] * 3, c = bodyIdx[t * 3 + 2] * 3;
  const ux = prim0.pos[b] - prim0.pos[a], uy = prim0.pos[b + 1] - prim0.pos[a + 1], uz = prim0.pos[b + 2] - prim0.pos[a + 2];
  const vx = prim0.pos[c] - prim0.pos[a], vy = prim0.pos[c + 1] - prim0.pos[a + 1], vz = prim0.pos[c + 2] - prim0.pos[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1; return [nx / L, ny / L, nz / L];
};
const edgeTris = new Map<number, number[]>();
for (let t = 0; t < bodyIdx.length / 3; t++) for (let k = 0; k < 3; k++) {
  const a = bodyIdx[t * 3 + k], b = bodyIdx[t * 3 + ((k + 1) % 3)];
  if (a === b) continue;
  const key = a < b ? a * nv + b : b * nv + a;
  let ar = edgeTris.get(key); if (!ar) edgeTris.set(key, (ar = [])); ar.push(t);
}
const thAtVertex = new Float64Array(nv);
for (const [key, ar] of edgeTris) {
  if (ar.length !== 2) continue;
  const n1 = tri(ar[0]), n2 = tri(ar[1]);
  const th = Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2])));
  const b = key % nv, a = (key - b) / nv;
  if (th > thAtVertex[a]) thAtVertex[a] = th;
  if (th > thAtVertex[b]) thAtVertex[b] = th;
}
const nearestTh = (v: number) => {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  let best = Infinity, bi = 0;
  for (let w = 0; w < nv; w++) {
    const d2 = (prim0.pos[w * 3] - x) ** 2 + (prim0.pos[w * 3 + 1] - y) ** 2 + (prim0.pos[w * 3 + 2] - z) ** 2;
    if (d2 < best) { best = d2; bi = w; }
  }
  return thAtVertex[bi];
};
const rank = (a: number[]) => { const ix = a.map((_, i) => i).sort((p, r) => a[p] - a[r]); const rk = new Array(a.length); ix.forEach((v2, r) => { rk[v2] = r; }); return rk; };
const smp = band.filter((_, i) => i % 3 === 0);        // 3분의 1 표본 — 브루트포스 비용 절감(값 채널 아님)
const A = smp.map((v) => Math.abs(eOf(v))), B = smp.map(nearestTh);
const ra = rank(A), rb = rank(B), n2 = smp.length;
const mA = (n2 - 1) / 2;
let num = 0, da = 0, db = 0;
for (let i = 0; i < n2; i++) { num += (ra[i] - mA) * (rb[i] - mA); da += (ra[i] - mA) ** 2; db += (rb[i] - mA) ** 2; }
console.log(`  ── 몸 쪽 병기: 곡률 대리량(최근접 몸 정점의 입사 엣지 이면각 최대) ↔ |e| ──`);
console.log(`     순위 상관 ρ = **${(num / Math.sqrt(da * db)).toFixed(4)}** (표본 ${n2} · 어깨 대역 1/3 추출)`);
console.log(`     이면각[°] 중앙 ${((q(B.slice().sort((x, y) => x - y), .5) * 180) / Math.PI).toFixed(2)} · p95 ${((q(B.slice().sort((x, y) => x - y), .95) * 180) / Math.PI).toFixed(2)}`);
