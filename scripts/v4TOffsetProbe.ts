/* v4-31 §1-①② — **소매 축 구간 오프셋 사실 + 가상 조립 실험**(판정만 · `src/` 0줄 · 굽기 0).
 *
 * ① `dAX = (P − C)·AX` 를 재고, 조립 f0 에서 **소매 정점의 t** 와 **암홀 봉제쌍의 몸판 쪽 t** 를 견준다
 *    (`t(p) = (p − P)·AX`). 어긋남 = 두 중앙값의 차.
 * ② `t` 를 dAX 만큼 되돌린 «가상 관» — 소매 패널 정점을 축 방향으로 **−dAX·AX** 평행이동한 상태에서
 *    같은 봉제쌍 거리를 다시 잰다(좌우는 x 부호만 뒤집는다 · 코드의 `sgn` 규약과 같은 쪽).
 *    ★ `SLV_R` «재탐색»은 코드 경로가 필요하므로 ③에서 본다 — 여기서는 **평행이동만**이다(값만).
 *
 * 진입: `CELL=… BODY_BIN=… ARM_AXIS_JSON=… ARM_ORIGIN_JSON=… TAG=… npx tsx scripts/v4TOffsetProbe.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, SEP } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
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
const S = PR.sc as unknown as { n: number; front: Pan; back: Pan; slv: Pan[];
                                s: { pos: Float64Array }; seamCons: { i: number; j: number }[] };
const rng = (p: Pan) => [p.base, p.base + (p.nu + 1) * (p.nv + 1)] as [number, number];
const slvR = rng(S.slv[0]), slvL = rng(S.slv[1]);
const inR = (v: number) => v >= slvR[0] && v < slvR[1];
const inL = (v: number) => v >= slvL[0] && v < slvL[1];
const isSlv = (v: number) => inR(v) || inL(v);

const AX: V3 = ax ? [Math.abs(ax.right[0]), ax.right[1], ax.right[2]] : [1, 0, 0];
const P: V3 = ax?.pivot ? [Math.abs(ax.pivot.right[0]), ax.pivot.right[1], ax.pivot.right[2]] : [0, 0, 0];
const C: V3 = ax?.origin ? [Math.abs(ax.origin.right[0]), ax.origin.right[1], ax.origin.right[2]] : [0, 0, 0];
const dAX = (P[0] - C[0]) * AX[0] + (P[1] - C[1]) * AX[1] + (P[2] - C[2]) * AX[2];

const pos = S.s.pos;
/* 왼쪽 정점은 x 를 거울로 본다 — 코드의 `sgn` 규약과 같은 쪽에서 재기 위해서다. */
const tOf = (v: number, mir: boolean) => {
  const x = (mir ? -1 : 1) * pos[v * 3];
  return (x - P[0]) * AX[0] + (pos[v * 3 + 1] - P[1]) * AX[1] + (pos[v * 3 + 2] - P[2]) * AX[2];
};
const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const q = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };

/* 암홀 봉제쌍 = 한쪽이 소매, 다른 쪽이 몸판인 쌍(= v4-24 겨드랑이 계기와 같은 가름). */
const arm = S.seamCons.filter((s) => isSlv(s.i) !== isSlv(s.j))
  .map((s) => (isSlv(s.i) ? { slv: s.i, body: s.j } : { slv: s.j, body: s.i }));
const dist = (a: number, b: number, sh: V3 = [0, 0, 0], mirA = false) => {
  const x = pos[a * 3] + (mirA ? -sh[0] : sh[0]), y = pos[a * 3 + 1] + sh[1], z = pos[a * 3 + 2] + sh[2];
  return Math.hypot(x - pos[b * 3], y - pos[b * 3 + 1], z - pos[b * 3 + 2]);
};
const shift: V3 = [-dAX * AX[0], -dAX * AX[1], -dAX * AX[2]];        // t 를 dAX 만큼 되돌린다
const cur = arm.map((p) => dist(p.slv, p.body) * 1000);
const vir = arm.map((p) => dist(p.slv, p.body, shift, inL(p.slv)) * 1000);
const slvVerts = [...Array(slvR[1] - slvR[0]).keys()].map((k) => slvR[0] + k)
  .concat([...Array(slvL[1] - slvL[0]).keys()].map((k) => slvL[0] + k));
const bodyOfArm = arm.map((p) => p.body);
const yMed = (vs: number[], dy = 0) => med(vs.map((v) => pos[v * 3 + 1] + dy));
const tSlv = slvVerts.map((v) => tOf(v, inL(v)));
const tBody = bodyOfArm.map((v) => tOf(v, false));

const out = {
  what: 'v4-31 §1-①② 소매 t 오프셋 · 가상 조립(평행이동)', cell: CELL, tag: TAG, bodyBin: bbPath,
  축: ax ? { AX, P, C } : '(기본 +x)', 'dAX_mm': dAX * 1000, SEPmm: SEP * 1000,
  '①': {
    '소매 t 중앙 mm': med(tSlv) * 1000,
    '암홀(몸판) t 중앙 mm': med(tBody) * 1000,
    '어긋남 mm': (med(tSlv) - med(tBody)) * 1000,
    '소매 t 범위 mm': [q(tSlv, 0) * 1000, q(tSlv, 0.999) * 1000],
    '암홀 t 범위 mm': [q(tBody, 0) * 1000, q(tBody, 0.999) * 1000],
  },
  '②': {
    '암홀 봉제쌍 수': arm.length,
    '현행 거리 mm': { 최소: q(cur, 0), p25: q(cur, 0.25), 중앙: med(cur), p75: q(cur, 0.75), 최대: q(cur, 0.999) },
    '가상(t 되돌림) 거리 mm': { 최소: q(vir, 0), p25: q(vir, 0.25), 중앙: med(vir), p75: q(vir, 0.75), 최대: q(vir, 0.999) },
    '중앙 비(가상/현행)': med(vir) / med(cur),
    '소매 y중앙 현행 m': yMed(slvVerts), '소매 y중앙 가상 m': yMed(slvVerts, shift[1]),
    '암홀(몸판) y중앙 m': yMed(bodyOfArm),
    'NaN 수': slvVerts.filter((v) => !Number.isFinite(pos[v * 3]) || !Number.isFinite(pos[v * 3 + 1])).length,
  },
  /* 참고(값만 · 이 판의 «선택» 0) — 축 방향 평행이동 s 를 훑어 봉제쌍 거리 중앙이 어디서 가장 작아지는지 본다. */
  '참고 — 이동량 훑기': [0, 100, 156.514, 200, 250, 300, 350.84, 400, 450].map((mm) => {
    const sh2: V3 = [-(mm / 1000) * AX[0], -(mm / 1000) * AX[1], -(mm / 1000) * AX[2]];
    const dd = arm.map((pr) => dist(pr.slv, pr.body, sh2, inL(pr.slv)) * 1000);
    return { '이동 mm': mm, 중앙: med(dd), 최소: q(dd, 0), 최대: q(dd, 0.999) };
  }),
};
writeFileSync(`${OUT}/l3ap-toffset-${TAG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
