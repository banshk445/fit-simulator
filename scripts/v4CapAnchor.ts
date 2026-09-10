/* v4-32 §1-①② — **캡↔암홀 중심 정합 사실 + 가상 실험**(판정만 · `src/` 0줄 · 굽기 0).
 *
 * ① Δ = (암홀 쪽 봉제 정점 «중심») − (소매 캡 쪽 «중심») — **좌·우 각각** · 조립 f0 좌표에서 계산(손 상수 0).
 *    축(AX)·수직 성분으로 분해해 v4-31 훑기의 최선 이동(≈200 mm)과 견준다.
 *    T포즈 기준선은 `asm-Tasm_M.bin` 에서 **같은 채널**로 뜬다(재굽기 0).
 * ② 소매 패널을 Δ 만큼 **강체 이동**한 가상 배치에서 봉제쌍 거리 분포 · 소매 y중앙 ·
 *    **몸SDF 위반 수(이동 전/후)** 를 잰다(`sampleSdf` · 위반 = `< SEP`).
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… [TBASE=asm-Tasm_M.bin] TAG=… npx tsx scripts/v4CapAnchor.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

type V3 = [number, number, number];
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const TAG = process.env.TAG ?? 'x';
const OUT = 'gpu/oracle/export';
const D = Number(process.env.D_MM ?? 9) / 1000;
const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bbPath = process.env.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`;
const bb = readFileSync(bbPath);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const ax = armAxisFromEnv();
const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: verts, minPairDistLite, armAxis: ax });
type Pan = { base: number; nu: number; nv: number; name: string };
const S = PR.sc as unknown as { n: number; slv: Pan[]; s: { pos: Float64Array };
                                seamCons: { i: number; j: number }[] };
const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
const RR = rng(S.slv[0]), LL = rng(S.slv[1]);
const inR = (v: number) => v >= RR[0] && v < RR[1];
const inL = (v: number) => v >= LL[0] && v < LL[1];
const isSlv = (v: number) => inR(v) || inL(v);
const pos = S.s.pos;
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const q = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const stat = (a: number[]) => ({ 최소: q(a, 0), p25: q(a, 0.25), 중앙: med(a), p75: q(a, 0.75), 최대: q(a, 0.999) });

/* 암홀 봉제쌍 = 한쪽이 소매·다른 쪽이 몸판(v4-24·31 과 같은 가름) */
const pairs = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
  .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
const side = (p: { slv: number }) => (inR(p.slv) ? 'R' : 'L');
const mean = (vs: number[]): V3 => {
  const m: V3 = [0, 0, 0];
  for (const v of vs) { m[0] += pos[v * 3]; m[1] += pos[v * 3 + 1]; m[2] += pos[v * 3 + 2]; }
  return [m[0] / vs.length, m[1] / vs.length, m[2] / vs.length];
};
const delta: Record<string, V3> = {};
const centers: Record<string, { 암홀: V3; 캡: V3; 쌍: number }> = {};
for (const s of ['R', 'L'] as const) {
  const ps = pairs.filter((p) => side(p) === s);
  const cb = mean(ps.map((p) => p.body)), cs = mean(ps.map((p) => p.slv));
  delta[s] = [cb[0] - cs[0], cb[1] - cs[1], cb[2] - cs[2]];
  centers[s] = { 암홀: cb, 캡: cs, 쌍: ps.length };
}
const AX: V3 = ax ? [Math.abs(ax.right[0]), ax.right[1], ax.right[2]] : [1, 0, 0];
const decomp = (d: V3, mir: boolean) => {                 // 왼쪽은 x 를 거울로 보고 분해한다
  const dd: V3 = [mir ? -d[0] : d[0], d[1], d[2]];
  const par = dd[0] * AX[0] + dd[1] * AX[1] + dd[2] * AX[2];
  const perp: V3 = [dd[0] - par * AX[0], dd[1] - par * AX[1], dd[2] - par * AX[2]];
  return { '축 성분 mm': par * 1000, '수직 크기 mm': Math.hypot(perp[0], perp[1], perp[2]) * 1000,
           '크기 mm': Math.hypot(dd[0], dd[1], dd[2]) * 1000 };
};

const dist = (a: number, b: number, sh: V3 = [0, 0, 0]) =>
  Math.hypot(pos[a * 3] + sh[0] - pos[b * 3], pos[a * 3 + 1] + sh[1] - pos[b * 3 + 1],
             pos[a * 3 + 2] + sh[2] - pos[b * 3 + 2]);
const cur = pairs.map((p) => dist(p.slv, p.body) * 1000);
const vir = pairs.map((p) => dist(p.slv, p.body, delta[side(p)]) * 1000);
const slvVerts = [...Array(RR[1] - RR[0]).keys()].map((k) => RR[0] + k)
  .concat([...Array(LL[1] - LL[0]).keys()].map((k) => LL[0] + k));
const sdfAt = (v: number, sh: V3) =>
  sampleSdf(PR.bodyG, pos[v * 3] + sh[0], pos[v * 3 + 1] + sh[1], pos[v * 3 + 2] + sh[2]);
const violBefore = slvVerts.filter((v) => sdfAt(v, [0, 0, 0]) < SEP).length;
const violAfter = slvVerts.filter((v) => sdfAt(v, delta[inR(v) ? 'R' : 'L']) < SEP).length;
const yMedSlv = (sh: boolean) => med(slvVerts.map((v) => pos[v * 3 + 1] + (sh ? delta[inR(v) ? 'R' : 'L'][1] : 0)));

/* T포즈 f0 기준선 — 조립 blob 에서 «같은 채널»(재굽기 0) */
const tb = readFileSync(`${OUT}/${process.env.TBASE ?? 'asm-Tasm_M.bin'}`);
const hl = tb.readUInt32LE(0);
const th = JSON.parse(tb.subarray(4, 4 + hl).toString('utf8')) as { n: number };
const tp = new Float64Array(tb.buffer.slice(tb.byteOffset + 4 + hl, tb.byteOffset + 4 + hl + th.n * 3 * 8));
const tbb = readFileSync(`public/v3diag/v3-77/body-${c.bodyId}.bin`);
const TP = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: new Float32Array(tbb.buffer.slice(tbb.byteOffset, tbb.byteOffset + tbb.byteLength)),
                     minPairDistLite });
const TS = TP.sc as unknown as { slv: Pan[]; seamCons: { i: number; j: number }[] };
const TRR = rng(TS.slv[0]), TLL = rng(TS.slv[1]);
const tIsSlv = (v: number) => (v >= TRR[0] && v < TRR[1]) || (v >= TLL[0] && v < TLL[1]);
const tPairs = TS.seamCons.filter((s) => tIsSlv(s.i) !== tIsSlv(s.j));
const tDist = tPairs.map((s) => Math.hypot(tp[s.i * 3] - tp[s.j * 3], tp[s.i * 3 + 1] - tp[s.j * 3 + 1],
                                           tp[s.i * 3 + 2] - tp[s.j * 3 + 2]) * 1000);

const out = {
  what: 'v4-32 §1-①② 캡↔암홀 중심 정합 · 가상 실험(강체 평행이동)', cell: CELL, tag: TAG, bodyBin: bbPath,
  SEPmm: SEP * 1000, AX,
  '①': {
    'Δ_mm': { R: delta.R.map((v) => v * 1000), L: delta.L.map((v) => v * 1000) },
    'Δ 분해 R': decomp(delta.R, false), 'Δ 분해 L': decomp(delta.L, true),
    중심: centers,
    'T포즈 f0 기준선 mm': stat(tDist), 'T포즈 봉제쌍 수': tPairs.length,
  },
  '②': {
    '암홀 봉제쌍 수': pairs.length,
    '현행 거리 mm': stat(cur), '이동 후 거리 mm': stat(vir),
    '중앙 비(후/전)': med(vir) / med(cur),
    '문턱 = T포즈 f0 최대 mm': q(tDist, 0.999),
    '중앙 ≤ 문턱': med(vir) <= q(tDist, 0.999),
    '몸SDF 위반 정점(전/후)': [violBefore, violAfter], '새 위반 0': violAfter <= violBefore,
    '이동 후 위반 깊이 mm': (() => {
      const d2 = slvVerts.map((v) => (SEP - sdfAt(v, delta[inR(v) ? 'R' : 'L'])) * 1000).filter((x) => x > 0);
      return d2.length ? stat(d2) : null;
    })(),
    '이동 후 몸SDF 최소 mm': Math.min(...slvVerts.map((v) => sdfAt(v, delta[inR(v) ? 'R' : 'L']))) * 1000,
    '소매 y중앙 전 m': yMedSlv(false), '소매 y중앙 후 m': yMedSlv(true),
    'NaN 수': slvVerts.filter((v) => !Number.isFinite(pos[v * 3])).length,
  },
};
writeFileSync(`${OUT}/l3ap-cap-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
