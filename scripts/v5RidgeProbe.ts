/* v5-10 §1-①② — **어깨 «능선» 정의와 f0 가상 배치**(측정만 · `src/` **0줄** · 굽기 0 · 물리 0프레임 · 판정 0).
 *
 * 부르는 것만 있다 — `createScene` 이 이미 내보내는 함수·값만 쓴다(`garmentScene.ts:951-963`):
 *   `Y_TOP`(= `shoulderTopY()`) · `Y_NECK` · `NECK_A` · `SH_LEN` · `LEN_NECK` · `SLAB` ·
 *   `DELTA` · `AXIS_Z` · `supportAt` · `boundaryOf` · `arcOn` · `bodyPoint` · `at`
 * 옷 치수(`SW` 등)는 `patternOfSpecName`/`garmentOf` 가 준 **그 객체**에서 읽는다(새 수 0).
 *
 * ① 능선 `ridge(x)` — §0-4ㄱ 규칙 + **형식화 보충 1건**:
 *     띠 B(x) = { 몸 정점 v : |x_v| ∈ [x−h, x+h] **그리고 y_v ≤ Y_NECK** } · h = sdfSpec.h
 *     ★ 상한 `y ≤ Y_NECK` 이 없으면 목 쪽(x = NECK_A)에서 «머리 꼭대기»를 집는다(머리가 그 x 띠에 있다).
 *       `Y_NECK` 은 `neckBaseY()` 도출값이고 `x = SW/2` 에서는 `Y_TOP < Y_NECK` 이라 **검산이 유지된다**.
 *     y(x) = max y · z(x) = 그 정점의 z · 옷의 자리 = (±x, y + SEP, z)
 * ② 가상 배치 — 상단 행(front·back 의 j = nvB)만 옮긴다(하위 행 **접촉 0**).
 *
 * 진입: `SPEC=… CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… npx tsx scripts/v5RidgeProbe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP, THICK } from '../src/v3/consts.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

const SPEC = process.env.SPEC;
const CELL = process.env.CELL ?? 'c100-h170-s45_XL';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL)!;
const GD = SPEC ? patternOfSpecName(SPEC) : garmentOf(c.size as Size);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
const AA = armAxisFromEnv();
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: GD,
                    bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                    minPairDistLite, armAxis: AA });
type Pan = { base: number; nu: number; nv: number; name: string };
const S = P.S as unknown as {
  Y_TOP: number; Y_NECK: number; NECK_A: number; SH_LEN: number; LEN_NECK: number; SLAB: number;
  DELTA: number; AXIS_Z: number;
  supportAt: (y: number, half: number) => Float64Array;
  boundaryOf: (h: Float64Array, delta: number, scale: number) => [number, number][];
  arcOn: (pts: [number, number][], rear?: boolean) => { total: number; at: (s: number) => [number, number] };
  bodyPoint: (px: number, py: number, front: boolean) => [number, number, number];
  at: (p: Pan, i: number, j: number) => number;
};
const sc = P.sc as unknown as { n: number; s: { pos: Float64Array }; uv: Float64Array;
  front: Pan; back: Pan; N_sh: number; N_nk: number; nuB: number; nvB: number;
  seams: { name: string; a: number[]; b: number[] }[] };
const h = P.sdfSpec.h;
const SW2 = GD.SW / 2;
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: P.bodyIdx, bodyG: P.bodyG, h, thick: THICK });
const clr = (x: number, y: number, z: number) => (sampleSdf(P.bodyG, x, y, z) < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z);
const bp = P.prim0.pos;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/* ── ① 능선 ───────────────────────────────────────────────────────────── */
/** §0-4ㄱ 규칙(V1) + **z 결정 변종(V2)**.
 * ★ V1 실측이 드러낸 사실 — 이 규칙은 `y` 는 잘 정하지만 **`z` 를 정하지 못한다**(어깨 위가 z 방향으로
 *   «평지»라 argmax y 의 z 가 임의다). 그래서 **`ZRULE=plateau`** 변종을 함께 낸다:
 *     고원 = { v ∈ B(x) : y_v ≥ y(x) − SEP } · z(x) = (min z + max z)/2
 *   `SEP` 는 v3 가 등재한 **유일한 간극 척도**이고(배치 주석 `garmentScene.ts:189`) 새 상수가 아니다.
 *   두 규칙 다 인쇄하고, ②는 **둘 다** 돌린다(어느 것도 «고르지» 않는다). */
function ridgeRaw(x: number, plateau: boolean): { y: number; z: number; hit: number; zspan: number } {
  let y = -Infinity, z = NaN, hit = 0;
  for (let v = 0; v < bp.length / 3; v++) {
    const px = Math.abs(bp[v * 3]);
    if (px < x - h || px > x + h) continue;
    if (bp[v * 3 + 1] > S.Y_NECK) continue;            // ★ 형식화 보충 — 머리를 뺀다
    hit++;
    if (bp[v * 3 + 1] > y) { y = bp[v * 3 + 1]; z = bp[v * 3 + 2]; }
  }
  let zlo = Infinity, zhi = -Infinity;
  for (let v = 0; v < bp.length / 3; v++) {
    const px = Math.abs(bp[v * 3]);
    if (px < x - h || px > x + h) continue;
    if (bp[v * 3 + 1] > S.Y_NECK || bp[v * 3 + 1] < y - SEP) continue;
    zlo = Math.min(zlo, bp[v * 3 + 2]); zhi = Math.max(zhi, bp[v * 3 + 2]);
  }
  const zspan = zhi - zlo;
  return { y, z: plateau ? (zlo + zhi) / 2 : z, hit, zspan };
}
const piv = AA?.pivot, dirA = AA ? { left: AA.left, right: AA.right } : undefined;
const axProj = (x: number, y: number, z: number) => {
  if (!piv || !dirA) return { s: NaN, r: NaN };
  const side = x >= 0 ? 'left' : 'right';
  const q = piv[side], dd = dirA[side];
  const wx = x - q[0], wy = y - q[1], wz = z - q[2];
  const s = wx * dd[0] + wy * dd[1] + wz * dd[2];
  return { s, r: Math.hypot(wx - s * dd[0], wy - s * dd[1], wz - s * dd[2]) };
};
const XS: number[] = [];
for (let x = S.NECK_A; x <= SW2 + 1e-12; x += h) XS.push(x);
if (XS[XS.length - 1] < SW2 - 1e-12) XS.push(SW2);
function buildRidge(plateau: boolean) {
  const rows = XS.map((x) => {
    const r = ridgeRaw(x, plateau);
    const yc = r.y + SEP;
    const a = axProj(x, r.y, r.z);
    return { 'x cm': x * 100, '몸 y m': r.y, 'z m': r.z, '표본 수': r.hit, '고원 z폭 mm': r.zspan * 1000,
             '옷 y m': yc, '여유 mm': clr(x, yc, r.z) * 1000, '여유(−x) mm': clr(-x, yc, r.z) * 1000,
             '팔축 s mm': a.s * 1000, '팔축 r mm': a.r * 1000 };
  });
  const acc = [0];
  for (let k = 1; k < rows.length; k++) acc.push(acc[k - 1] +
    Math.hypot((rows[k]['x cm'] - rows[k - 1]['x cm']) / 100,
               rows[k]['몸 y m'] - rows[k - 1]['몸 y m'], rows[k]['z m'] - rows[k - 1]['z m']));
  const at = (t: number): [number, number, number] => {          // t=0 → 어깨 끝 · t=1 → 목
    const sArc = (1 - t) * acc[acc.length - 1];
    let k = 1; while (k < acc.length - 1 && acc[k] < sArc) k++;
    const u = (sArc - acc[k - 1]) / Math.max(1e-12, acc[k] - acc[k - 1]);
    const A = rows[k - 1], B = rows[k];
    return [(A['x cm'] + (B['x cm'] - A['x cm']) * u) / 100,
            A['옷 y m'] + (B['옷 y m'] - A['옷 y m']) * u,
            A['z m'] + (B['z m'] - A['z m']) * u];
  };
  const dz: number[] = [];
  for (let k = 1; k < rows.length; k++) dz.push(Math.abs(rows[k]['z m'] - rows[k - 1]['z m']) * 1000);
  return { rows, len: acc[acc.length - 1], at,
           'z 폭 mm': (Math.max(...rows.map((r) => r['z m'])) - Math.min(...rows.map((r) => r['z m']))) * 1000,
           '인접 z차 중앙 mm': med(dz), '인접 z차 최대 mm': Math.max(...dz) };
}
const RV1 = buildRidge(false), RV2 = buildRidge(true);
const ridgeRows = RV1.rows;
const LEN_RIDGE = RV1.len;

/* ── ② 가상 배치 — 상단 행만 ─────────────────────────────────────────── */
const neckRing = S.boundaryOf(S.supportAt(S.Y_NECK, S.SLAB), S.DELTA, 1);
const arcF = S.arcOn(neckRing, false), arcB = S.arcOn(neckRing, true);
const N_sh = sc.N_sh, N_nk = sc.N_nk, nuB = sc.nuB, nvB = sc.nvB;
const topIdx: { i: number; v: number; front: boolean; kind: string }[] = [];
for (const front of [true, false]) {
  const pan = front ? sc.front : sc.back;
  for (let i = 0; i <= nuB; i++) {
    const v = S.at(pan, i, nvB);
    topIdx.push({ i, v, front, kind: i <= N_sh ? '어깨L' : i >= N_sh + N_nk ? '어깨R' : '목선' });
  }
}
/** 가상 배치 — `ridgeAt` 과 「목선도 옮기는가」를 인자로 받는다(정의역 그대로 · 새 규칙 0). */
function placeTop(ridgeAt: (t: number) => [number, number, number], moveNeck: boolean) {
  const pos = Float64Array.from(sc.s.pos);
  for (const t of topIdx) {
    const pan = t.front ? sc.front : sc.back;
    const v = S.at(pan, t.i, nvB);
    let q: [number, number, number];
    if (t.kind === '어깨L') { const r = ridgeAt(t.i / N_sh); q = [-r[0], r[1], r[2]]; }
    else if (t.kind === '어깨R') { const r = ridgeAt((nuB - t.i) / N_sh); q = [r[0], r[1], r[2]]; }
    else {
      if (!moveNeck) continue;
      const px = sc.uv[v * 2];
      const rz = (t.front ? arcF : arcB).at(t.front ? px : -px);
      q = [rz[0], S.Y_NECK, S.AXIS_Z + rz[1]];
    }
    pos[v * 3] = q[0]; pos[v * 3 + 1] = q[1]; pos[v * 3 + 2] = q[2];
  }
  return pos;
}
/** 채널 넷 — 위치 배열 하나에서 */
function channels(pos: Float64Array, tag: string) {
  const ring = [...(P.neckF as number[]), ...[...(P.neckB as number[])].reverse()];
  let ringLen = 0;
  for (let q = 0; q < ring.length; q++) {
    const a = ring[q], b = ring[(q + 1) % ring.length];
    ringLen += Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  }
  const cl = topIdx.map((t) => clr(pos[t.v * 3], pos[t.v * 3 + 1], pos[t.v * 3 + 2]) * 1000);
  const neg = cl.filter((x) => x < 0);
  const shPairs: number[] = [];
  for (const sm of sc.seams) {
    if (!sm.name.startsWith('어깨')) continue;
    for (let k = 0; k < sm.a.length; k++) shPairs.push(Math.hypot(
      pos[sm.a[k] * 3] - pos[sm.b[k] * 3], pos[sm.a[k] * 3 + 1] - pos[sm.b[k] * 3 + 1],
      pos[sm.a[k] * 3 + 2] - pos[sm.b[k] * 3 + 2]) * 1000);
  }
  const str: { v: number; ratio: number; kind: string; i: number }[] = [];
  for (const t of topIdx) {
    const pan = t.front ? sc.front : sc.back;
    const w = S.at(pan, t.i, nvB - 1);
    const d3 = Math.hypot(pos[t.v * 3] - pos[w * 3], pos[t.v * 3 + 1] - pos[w * 3 + 1], pos[t.v * 3 + 2] - pos[w * 3 + 2]);
    const d2 = Math.hypot(sc.uv[t.v * 2] - sc.uv[w * 2], sc.uv[t.v * 2 + 1] - sc.uv[w * 2 + 1]);
    str.push({ v: t.v, ratio: d3 / d2, kind: t.kind, i: t.i });
  }
  const rr = str.map((x) => x.ratio);
  const worst = str.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  return { tag, '목선 링 cm': ringLen * 100, '링/rest': ringLen / P.ringRest,
    '상단 행 정점': topIdx.length, '여유 음수 개수': neg.length,
    '여유 최소 mm': Math.min(...cl), '여유 중앙 mm': med(cl),
    '관통 깊이 최대 mm': neg.length ? -Math.min(...neg) : 0,
    '어깨 봉제쌍 거리 최대 mm': Math.max(...shPairs), '어깨 봉제쌍 거리 중앙 mm': med(shPairs),
    '하위행 엣지 신장 중앙': med(rr), '하위행 엣지 신장 최대': Math.max(...rr),
    '최대 자리': { 그룹: worst.kind, i: worst.i, ratio: worst.ratio },
    '신장 > 2 개수': rr.filter((x) => x > 2).length };
}
/* ★ 캡처용 위치 덤프(선택 · `POSOUT=<접두>`) — 측정 0 · 렌더러가 읽는 float64 3n 그대로.
 * `v4AposeRender.ts` 의 `POS` 규약과 «같은 포장»이다(v4-24 §1-③). */
const POSOUT = process.env.POSOUT ?? null;
const now = channels(sc.s.pos, '현행 배치(f0)');
const chans = [now,
  channels(placeTop(RV1.at, true), '능선 배치 V1(argmax z) · 상단 행 전부'),
  channels(placeTop(RV2.at, true), '능선 배치 V2(고원 z중앙) · 상단 행 전부'),
  /* ★ 보조 사실 — «어깨 토막만» 옮긴 변주. **갈래 판정에 쓰지 않는다**(사전 등재 ②는 「상단 행만」 =
   * 어깨+목선 전부다). 다음 판 설계용으로 비용을 가른다. */
  channels(placeTop(RV2.at, false), '[보조] 능선 배치 V2 · **어깨 토막만**(목선 불변)')];
if (POSOUT) {
  writeFileSync(`${POSOUT}-now.bin`, Buffer.from(Float64Array.from(sc.s.pos).buffer));
  writeFileSync(`${POSOUT}-ridge.bin`, Buffer.from(placeTop(RV2.at, true).buffer));
  console.error(`  → ${POSOUT}-{now,ridge}.bin (${sc.n} 정점 · float64 3n)`);
}
const _args = { BODY_BIN: process.env.BODY_BIN ?? null, ARM_AXIS_JSON: process.env.ARM_AXIS_JSON ?? null,
  ARM_ORIGIN_JSON: process.env.ARM_ORIGIN_JSON ?? null, SPEC: SPEC ?? null, CELL,
  D_MM: process.env.D_MM ?? null, 계기: import.meta.url.split('/').pop() };
const out = { what: 'v5-10 §1-①② 어깨 능선 정의와 f0 가상 배치(측정만 · 판정 0)', _args,
  치수: { 'SW cm': GD.SW * 100, 'W cm': GD.W * 100, 'L cm': GD.L * 100 },
  'Y_TOP m': S.Y_TOP, 'Y_NECK m': S.Y_NECK, 'NECK_A cm': S.NECK_A * 100, 'h mm': h * 1000,
  'DELTA mm': S.DELTA * 1000, 'SEP mm': SEP * 1000, 'ringRest cm': P.ringRest * 100,
  '검산 ridge(SW/2) y m': ridgeRows[ridgeRows.length - 1]['몸 y m'],
  '검산 차 mm': (ridgeRows[ridgeRows.length - 1]['몸 y m'] - S.Y_TOP) * 1000,
  'LEN_RIDGE cm': LEN_RIDGE * 100, 'SH_LEN cm': S.SH_LEN * 100, '능선/봉제선': LEN_RIDGE / S.SH_LEN,
  '목링 호길이 cm': { front: arcF.total * 100, back: arcB.total * 100 },
  'LEN_NECK cm': S.LEN_NECK * 100,
  능선규칙: { V1: { len_cm: RV1.len * 100, 'z 폭 mm': RV1['z 폭 mm'],
                   '인접 z차 중앙 mm': RV1['인접 z차 중앙 mm'], '인접 z차 최대 mm': RV1['인접 z차 최대 mm'],
                   '능선/봉제선': RV1.len / S.SH_LEN },
             V2: { len_cm: RV2.len * 100, 'z 폭 mm': RV2['z 폭 mm'],
                   '인접 z차 중앙 mm': RV2['인접 z차 중앙 mm'], '인접 z차 최대 mm': RV2['인접 z차 최대 mm'],
                   '능선/봉제선': RV2.len / S.SH_LEN } },
  분할: { N_sh, N_nk, nuB, nvB }, 채널: chans, 능선표본: ridgeRows, 능선표본V2: RV2.rows };
writeFileSync(`gpu/oracle/export/v5-10-ridge-${SPEC ?? CELL}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, 능선표본: `${ridgeRows.length}행(파일)` }, null, 1));
