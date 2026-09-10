/* v4-33 §1-①② — **캡↔암홀 «강체» 정합(회전 포함) + 가상 실험**(판정만 · `src/` 0줄 · 굽기 0).
 *
 * ① 어깨 이음 봉제쌍의 대응(소매 쪽 → 암홀 쪽)에서 **최소제곱 강체 변환**을 뽑는다 —
 *    교과서 절차(Kabsch)를 **사원수 형태**(Horn)로 쓴다: 상관행렬 → 4×4 대칭행렬 K → 최대 고유벡터 = 사원수.
 *    ⟹ 사원수에서 나온 회전은 **항상 det = +1**(반사 불가) · 매개변수 0 · 손 각도 0.
 * ② 소매 패널에 (R, Δ) 를 적용한 가상 배치에서 봉제쌍 거리 · 소매 y중앙 · 몸SDF 위반(전/후) ·
 *    소매↔몸판 비봉제 최소 쌍거리(전/후)를 잰다.
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… TAG=… npx tsx scripts/v4KabschProbe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { armAxisFromEnv } from './armAxisEnv.ts';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];
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
const PR = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                     bodyVerts: verts, minPairDistLite, armAxis: armAxisFromEnv() });
type Pan = { base: number; nu: number; nv: number; name: string };
const S = PR.sc as unknown as { n: number; front: Pan; back: Pan; slv: Pan[];
                                s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
const RR = rng(S.slv[0]), LL = rng(S.slv[1]), FR = rng(S.front), BK = rng(S.back);
const inR = (v: number) => v >= RR[0] && v < RR[1];
const inL = (v: number) => v >= LL[0] && v < LL[1];
const isSlv = (v: number) => inR(v) || inL(v);
const pos = S.s.pos;
const at = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const qt = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const stat = (a: number[]) => ({ 최소: qt(a, 0), p25: qt(a, 0.25), 중앙: med(a), p75: qt(a, 0.75), 최대: qt(a, 0.999) });

/* ── 대칭 4×4 야코비 고유분해(교과서 절차 · 매개변수 0) ───────────────────── */
function jacobi4(A0: number[][]) {
  const A = A0.map((r) => [...r]);
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 4; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = cs * akp - sn * akq; A[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = cs * apk - sn * aqk; A[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq; V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  return { eig: [A[0][0], A[1][1], A[2][2], A[3][3]], vec: V };
}

/** 대응 (src → dst) 의 최소제곱 강체 정합 — Horn 사원수 형태. */
function kabsch(src: V3[], dst: V3[]) {
  const n = src.length;
  const mean = (P: V3[]): V3 => P.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, a[2] + p[2] / n] as V3, [0, 0, 0] as V3);
  const cs = mean(src), cd = mean(dst);
  const S3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const p: V3 = [src[i][0] - cs[0], src[i][1] - cs[1], src[i][2] - cs[2]];
    const q: V3 = [dst[i][0] - cd[0], dst[i][1] - cd[1], dst[i][2] - cd[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S3[a][b] += p[a] * q[b];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S3;
  const K = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { eig, vec } = jacobi4(K);
  let bi = 0; for (let i = 1; i < 4; i++) if (eig[i] > eig[bi]) bi = i;
  const qv = [vec[0][bi], vec[1][bi], vec[2][bi], vec[3][bi]];
  const nq = Math.hypot(qv[0], qv[1], qv[2], qv[3]) || 1;
  const [w, x, y, z] = qv.map((v) => v / nq);
  const R: M3 = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
            - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
            + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  const ang = 2 * Math.acos(Math.min(1, Math.abs(w))) * 180 / Math.PI;
  const sa = Math.hypot(x, y, z) || 1;
  const axis: V3 = [x / sa, y / sa, z / sa];
  const apply = (p: V3): V3 => {
    const d: V3 = [p[0] - cs[0], p[1] - cs[1], p[2] - cs[2]];
    return [cd[0] + R[0][0] * d[0] + R[0][1] * d[1] + R[0][2] * d[2],
            cd[1] + R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2],
            cd[2] + R[2][0] * d[0] + R[2][1] * d[1] + R[2][2] * d[2]];
  };
  let rms = 0;
  for (let i = 0; i < n; i++) {
    const a = apply(src[i]);
    rms += (a[0] - dst[i][0]) ** 2 + (a[1] - dst[i][1]) ** 2 + (a[2] - dst[i][2]) ** 2;
  }
  const dl: V3 = [cd[0] - (R[0][0] * cs[0] + R[0][1] * cs[1] + R[0][2] * cs[2]),
                  cd[1] - (R[1][0] * cs[0] + R[1][1] * cs[1] + R[1][2] * cs[2]),
                  cd[2] - (R[2][0] * cs[0] + R[2][1] * cs[1] + R[2][2] * cs[2])];
  return { R, det, '회전각deg': ang, 축: axis, 'Δ_mm': dl.map((v) => v * 1000),
           apply, 'RMS_mm': Math.sqrt(rms / n) * 1000 };
}

/* 암홀 봉제쌍(v4-24·31·32 와 같은 가름) */
const pairs = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
  .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
const fit: Record<string, ReturnType<typeof kabsch>> = {};
for (const side of ['R', 'L'] as const) {
  const ps = pairs.filter((p) => (side === 'R' ? inR(p.slv) : inL(p.slv)));
  fit[side] = kabsch(ps.map((p) => at(p.slv)), ps.map((p) => at(p.body)));
}
const mapv = (v: number): V3 => fit[inR(v) ? 'R' : 'L'].apply(at(v));
const slvVerts = [...Array(RR[1] - RR[0]).keys()].map((k) => RR[0] + k)
  .concat([...Array(LL[1] - LL[0]).keys()].map((k) => LL[0] + k));
const bodyVerts = [...Array(FR[1] - FR[0]).keys()].map((k) => FR[0] + k)
  .concat([...Array(BK[1] - BK[0]).keys()].map((k) => BK[0] + k));
const dst2 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cur = pairs.map((p) => dst2(at(p.slv), at(p.body)) * 1000);
const vir = pairs.map((p) => dst2(mapv(p.slv), at(p.body)) * 1000);
const sdfOf = (v: number, m: boolean) => { const p = m ? mapv(v) : at(v); return sampleSdf(PR.bodyG, p[0], p[1], p[2]); };
const viol = (m: boolean) => slvVerts.filter((v) => sdfOf(v, m) < SEP).length;
const depth = (m: boolean) => slvVerts.map((v) => (SEP - sdfOf(v, m)) * 1000).filter((x) => x > 0);
const seamKey = new Set(pairs.map((p) => p.slv * S.n + p.body));
const minPair = (m: boolean) => {
  let mn = Infinity;
  for (const a of slvVerts) {
    const pa = m ? mapv(a) : at(a);
    for (const b of bodyVerts) {
      if (seamKey.has(a * S.n + b)) continue;
      const d = dst2(pa, at(b)); if (d < mn) mn = d;
    }
  }
  return mn * 1000;
};
const yMed = (m: boolean) => med(slvVerts.map((v) => (m ? mapv(v) : at(v))[1]));
const dB = depth(false), dA = depth(true);

const out = {
  what: 'v4-33 §1-①② 캡↔암홀 강체 정합(Kabsch) · 가상 실험', cell: CELL, tag: TAG, bodyBin: bbPath,
  SEPmm: SEP * 1000,
  '①': Object.fromEntries((['R', 'L'] as const).map((s) => [s, {
    '회전각deg': fit[s]['회전각deg'], 축: fit[s].축, det: fit[s].det,
    'Δ_mm': fit[s]['Δ_mm'], '잔차 RMS mm': fit[s]['RMS_mm'],
    '대응 쌍': pairs.filter((p) => (s === 'R' ? inR(p.slv) : inL(p.slv))).length,
  }])),
  '②': {
    '암홀 봉제쌍 수': pairs.length,
    '현행 거리 mm': stat(cur), '정합 후 거리 mm': stat(vir), '중앙 비(후/전)': med(vir) / med(cur),
    '문턱(v4-32 T포즈 f0 최대) mm': 217.0112, '중앙 ≤ 문턱': med(vir) <= 217.0112,
    '몸SDF 위반 정점(전/후)': [viol(false), viol(true)], '위반 후 ≤ 전': viol(true) <= viol(false),
    '위반 깊이 전 mm': dB.length ? stat(dB) : null, '위반 깊이 후 mm': dA.length ? stat(dA) : null,
    '비봉제 최소 쌍거리 mm(전/후)': [minPair(false), minPair(true)],
    '소매 y중앙 m(전/후)': [yMed(false), yMed(true)],
    'NaN 수': slvVerts.filter((v) => !Number.isFinite(mapv(v)[0])).length,
  },
};
writeFileSync(`${OUT}/l3ap-kabsch-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
