/* v3 — Wang 2011 신장 강성 룩업(갈래 ⓐ용). ARCSim `src/dde.cpp` 직역.
 *
 * 원문 대조 사실(v3-02에서 소스 원문 확인 — v3-01 §1-1 정정 포함):
 *  · LUT은 **30³**이다(`static const int nsamples = 30`). 배열 선언은
 *    `Vec4 s[40][40][40]`이지만 채우고 읽는 범위가 30이다. v3-01이 적은
 *    「40×40×40」은 선언 크기를 본 것이다.
 *  · LUT 3축 = **그린 변형 G의 (G00, G11, G01)**. `evaluate_stretching_samples`가
 *    G(0,0)=-0.25+i/30 · G(1,1)=-0.25+j/30 · G(0,1)=G(1,0)=k/30 으로 이산화하고,
 *    `evaluate_stretching_sample`이 G를 2G+I(=우 코시-그린 C)로 되돌려 쓴다.
 *  · JSON 6×4 → `StretchingData d[2][5]` 사상은 `conf.cpp:573-577`:
 *    row0 → d[0][0]이고 d[0][1..4]에 «복제», row1~5 → d[1][0..4].
 *    ⟹ 6행 = {변형 0의 1행} + {주신장 w0=1+1/6(≈16.7%)의 5행},
 *       5열 = 주방향 바이어스 각 0/22.5/45/67.5/90°(|atan2(V)/π|*8의 구간).
 *  · Vec4 4성분의 의미는 `physics.cpp:76-77`의 에너지가 정한다:
 *       E = A/2 * (k[0]*G00² + k[2]*G11² + 2*k[1]*G00*G11 + k[3]*G01²)
 *    ⟹ k0 = warp 인장 · k2 = weft 인장 · k1 = 교차(포아송형) · k3 = 전단.
 *  · 단위 = **N/m**. `materials/aluminium.json` 주석이 1차 근거다
 *    (`E h = 70e9 * 25.4e-6 = 1.8e6 N/m`이고 JSON 값이 정확히 1.8e6).
 *    ※ `evaluate_stretching_sample` 말미의 ×2가 이 단위 위에 얹히는 규약인지는
 *      «미확정»이다 — S2 외팔보 역검증에서 닫는다(설계 §2-2).
 */

const NS = 30;

/** ARCSim `materials/gray-interlock.json`의 `stretching` 6×4 원문 인용.
 * t-shirt · 60% cotton 40% polyester · density 0.187 kg/m².
 * 출처: https://github.com/jiongchen/arcsim  [1차]
 * S1에서는 «물성 투입»이 아니라 ⓐ 기계를 돌리기 위한 표본이다(단위 배율 미확정). */
export const GRAY_INTERLOCK_STRETCHING: readonly (readonly number[])[] = [
  [16.593832, -14.69599, 34.477123, 36.860302],
  [46.364765, 53.694656, 261.013855, -29.691301],
  [49.28511, 87.5961, 206.373993, 22.768457],
  [123.98922, 105.18177, 365.966217, 44.217571],
  [139.686325, 73.59256, 413.553162, -174.43853],
  [127.44381, 85.848587, 405.872833, 32.238411],
];

/** JSON 6×4 → d[2][5][4] (conf.cpp:573-577) */
export function toStretchingData(rows: readonly (readonly number[])[]): number[][][] {
  if (rows.length !== 6) throw new Error(`stretching은 6행이어야 한다 (받음 ${rows.length})`);
  const d: number[][][] = [[], []];
  for (let i = 0; i < 5; i++) d[0].push([...rows[0]]);
  for (let i = 0; i < 5; i++) d[1].push([...rows[i + 1]]);
  return d;
}

/** dde.cpp `evaluate_stretching_sample` 직역. G는 그린 변형. */
function evaluateSample(g00: number, g11: number, g01: number, d: number[][][]): number[] {
  // G = 2G + I  (= F^T F)
  const a = 2 * g00 + 1;
  const b = 2 * g01;
  const dd = 2 * g11 + 1;
  // vectors.cpp eigen_decomposition<2> — l[0]이 큰 쪽, Q.col(0)이 그 고유벡터
  const amd = a - dd;
  const det = Math.sqrt(4 * b * b + amd * amd);
  const l1 = 0.5 * (a + dd + det);
  let v0: number;
  let v1: number;
  if (b !== 0) {
    const n = Math.hypot(l1 - dd, b);
    v0 = (l1 - dd) / n;
    v1 = b / n;
  } else if (a >= dd) {
    v0 = 1;
    v1 = 0;
  } else {
    v0 = 0;
    v1 = 1;
  }
  let aw = Math.abs(Math.atan2(v1, v0) / Math.PI) * 8;
  if (aw < 0) aw = 0;
  if (aw > 4 - 1e-6) aw = 4 - 1e-6;
  const aid = Math.floor(aw);
  aw -= aid;
  let sw = (Math.sqrt(l1) - 1) * 6;
  if (sw < 0) sw = 0;
  if (sw > 1 - 1e-6) sw = 1 - 1e-6;
  // strain_id는 원문에서 0으로 «강제»된다(dde.cpp:68) — d[0]과 d[1] 사이 보간.
  const out: number[] = [];
  for (let c = 0; c < 4; c++) {
    let v =
      d[0][aid][c] * (1 - sw) * (1 - aw) +
      d[1][aid][c] * sw * (1 - aw) +
      d[0][aid + 1][c] * (1 - sw) * aw +
      d[1][aid + 1][c] * sw * aw;
    if (v < 0) v = 0;
    out.push(v * 2);
  }
  return out;
}

/** dde.cpp `evaluate_stretching_samples` — 30³×4 평탄 배열. */
export function buildSamples(
  rows: readonly (readonly number[])[] = GRAY_INTERLOCK_STRETCHING,
  mult = 1,
): Float64Array {
  const d = toStretchingData(rows);
  const s = new Float64Array(NS * NS * NS * 4);
  for (let i = 0; i < NS; i++)
    for (let j = 0; j < NS; j++)
      for (let k = 0; k < NS; k++) {
        const v = evaluateSample(-0.25 + i / NS, -0.25 + j / NS, k / NS, d);
        const o = ((i * NS + j) * NS + k) * 4;
        for (let c = 0; c < 4; c++) s[o + c] = v[c] * mult;
      }
  return s;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** dde.cpp `stretching_stiffness` — 삼선형 보간. out에 [k0,k1,k2,k3]을 쓴다. */
export function stiffnessAt(
  s: Float64Array,
  g00: number,
  g11: number,
  g01: number,
  out: Float64Array,
): void {
  let a = clamp((g00 + 0.25) * NS, 0, NS - 1 - 1e-5);
  let b = clamp((g11 + 0.25) * NS, 0, NS - 1 - 1e-5);
  let c = clamp(Math.abs(g01) * NS, 0, NS - 1 - 1e-5);
  const ai = clamp(Math.floor(a), 0, NS - 2);
  const bi = clamp(Math.floor(b), 0, NS - 2);
  const ci = clamp(Math.floor(c), 0, NS - 2);
  a -= ai;
  b -= bi;
  c -= ci;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let k = 0; k < 2; k++) {
        const w = (i ? a : 1 - a) * (j ? b : 1 - b) * (k ? c : 1 - c);
        const o = (((ai + i) * NS + (bi + j)) * NS + (ci + k)) * 4;
        out[0] += s[o] * w;
        out[1] += s[o + 1] * w;
        out[2] += s[o + 2] * w;
        out[3] += s[o + 3] * w;
      }
}
