/* v4-02 §1-③ㄱ — **합성 「한 줄 천」의 v3 정답**(물리 코어 diff 0 · `src/` 0줄).
 *
 * 이 스크립트는 **v3 의 `step()` 을 그대로 부른다** — 적분·λ·순회 순서를 다시 쓰지 않는다.
 * 「한 줄 천」의 정의(이 회차에서 «집행 전»에 고정한다):
 *   · **2행 × NCOL열 격자** — 늘어남(`inplane`)은 «삼각형» 제약이므로 1행으로는 만들 수 없다.
 *     ⟹ 삼각형을 담는 «가장 작은» 천 = 띠 한 줄. 정점 N = 2·NCOL · 삼각형 2·(NCOL−1)
 *   · **0열의 정점 2개 고정**(`invMass = 0`) — 「한쪽 고정」
 *   · 정지 UV = 간격 `d` 정격자 · 초기 위치 = 그 UV 를 **수평면(y=0)** 에 놓은 것
 *   · 제약은 **`inplane` 만** — 굽힘·봉제·충돌 **0개**(이 판의 표적이 늘어남이다)
 * 상수는 전부 **v3 에서 읽는다**(손 상수 0): G · DT · d · gray(k, rho) · 서브스텝은 `substepsForCloth`.
 *
 * 진입: `[NCOL=32] [FRAMES=600] npx tsx scripts/v4Strip.ts`
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { makeInplane, assignMassFromMesh, substepsForCloth, step,
         type Solver, type Constraint } from '../src/v3/solver.ts';
import { G, DT, DAMP, FABRICS } from '../src/v3/consts.ts';

const NCOL = Number(process.env.NCOL ?? 32);
const FRAMES = Number(process.env.FRAMES ?? 600);
const D = Number(process.env.D_MM ?? 9) / 1000;          // v3GridRun 기본 격자 9mm
const FAB = FABRICS.gray;                                // 본 그리드가 구운 원단(v3GridRun.ts:120)
const OUT = 'gpu/oracle/export';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const n = 2 * NCOL;
const uv = new Float64Array(n * 2);
const pos = new Float64Array(n * 3);
for (let r = 0; r < 2; r++)
  for (let cIdx = 0; cIdx < NCOL; cIdx++) {
    const v = r * NCOL + cIdx;
    uv[v * 2] = cIdx * D; uv[v * 2 + 1] = r * D;
    pos[v * 3] = cIdx * D; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = r * D;
  }
const tris: number[] = [];
for (let cIdx = 0; cIdx < NCOL - 1; cIdx++) {
  const a = cIdx, b = cIdx + 1, c2 = NCOL + cIdx, d2 = NCOL + cIdx + 1;
  tris.push(a, b, d2, a, d2, c2);
}
const T = Uint32Array.from(tris);

const s: Solver = { pos, prev: new Float64Array(n * 3), vel: new Float64Array(n * 3),
                    invMass: new Float64Array(n), n };
const pinned = new Set<number>([0, NCOL]);               // 0열 두 정점 = 「한쪽 고정」
const mass = assignMassFromMesh(s, T, uv, FAB.rho, pinned);
const cons: Constraint[] = makeInplane(T, uv, FAB.k, FAB.k, FAB.k);
const SUB = substepsForCloth(DT, FAB.k, FAB.rho, D, 0.95);
const params = { dt: DT, substeps: SUB, gravity: G, damping: DAMP };

const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) step(s, cons, params);
const ms = Date.now() - t0;

const hdr = {
  what: 'v4-02 §1-③ㄱ 합성 한 줄 천 — v3 정답', ncol: NCOL, n, tris: T.length / 3, m: cons.length,
  frames: FRAMES, substeps: SUB, d: D, G, DT, DAMP, k: FAB.k, rho: FAB.rho,
  totalMass: mass.totalMass, totalArea: mass.totalArea, pinned: [...pinned], ms,
};
const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
const im = new Float64Array(n); im.set(s.invMass);
writeFileSync(`${OUT}/strip-v3.bin`, Buffer.concat([
  head, hb, Buffer.from(uv.buffer), Buffer.from(new Int32Array(T).buffer),
  Buffer.from(im.buffer), Buffer.from(s.pos.buffer), Buffer.from(s.vel.buffer)]));
let lo = Infinity, hi = -Infinity;
for (let i = 0; i < n * 3; i++) { if (s.pos[i] < lo) lo = s.pos[i]; if (s.pos[i] > hi) hi = s.pos[i]; }
console.log(`n=${n} tri=${T.length / 3} m=${cons.length} sub=${SUB} frames=${FRAMES} ${ms}ms`);
console.log(`좌표 범위 ${lo.toExponential(9)} ~ ${hi.toExponential(9)} · y_end=${s.pos[(NCOL - 1) * 3 + 1].toExponential(12)}`);
