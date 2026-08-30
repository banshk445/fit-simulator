/* v4-03 §1-③ㄱ — **합성 「두 삼각형 힌지」의 v3 정답**(물리 코어 diff 0 · `src/` 0줄).
 *
 * v3 의 `step()` 을 **그대로** 부른다 — 적분·λ·순회 순서를 다시 쓰지 않는다.
 * 「두 삼각형 힌지」의 정의(집행 «전» 고정):
 *   · 정점 4 · 삼각형 2 · **공유 엣지 하나** ⟹ `makeBend` 가 만드는 굽힘 제약은 **정확히 1개**
 *     (경계 엣지 4개는 날개가 하나뿐이라 힌지가 안 된다 — `solver.ts:makeBend` 의 `wings.length !== 2`)
 *   · 정지 UV = 간격 `d` 평면 배치 ⟹ **restAngle = 0**(평면 제도 · S2 완료 조건 ①)
 *   · **한쪽 삼각형을 고정**(정점 0·1·2 의 `invMass = 0`) ⟹ 자유 정점은 날개 **3** 하나
 *   · 초기 위치 = 날개 3 을 공유 엣지 둘레로 **90° 접은** 상태(나머지는 정지 UV 를 수평면에)
 *   · **중력 0** — 움직이는 힘은 **굽힘 제약 하나뿐**이다. 이면각이 `restAngle`(=0)로 이완하는
 *     과정을 M 스텝 잰다. 감쇠는 v3 의 `DAMP` 그대로.
 *   · 제약은 **`bend` 만** — 늘어남·봉제·충돌 **0개**
 *
 * ★ **왜 중력을 뺐는가(집행 «중» 등재)**: 처음엔 중력을 넣었는데, 늘어남 제약이 없으면 날개 정점을
 *   «자리에» 잡아 두는 것이 아무것도 없어 600 프레임에 **14.35 m 를 떠내려갔다**(실측). 그 상태의
 *   좌표 크기가 ULP 상한을 지배해 **굽힘을 재는 계기가 되지 못한다.** 중력을 빼면 남는 힘이
 *   굽힘 하나뿐이라 «굽힘만» 재는 정의가 된다. 90° 는 **접기 각의 정의**이지 물리 상수가 아니다.
 * 상수는 전부 v3 에서 읽는다(손 상수 0): G · DT · d · gray(ke = B) · 서브스텝 `substepsForBending`.
 *
 * 부수 측정 1건 — **`Math.hypot` ↔ `Math.sqrt(x²+y²+z²)` 의 차**. v3 는 법선 길이에 `hypot` 을
 * 쓰는데 Taichi 에는 `hypot` 이 없다 ⟹ 이식이 어느 함수를 쓰든 그 차이만큼은 «구조적»이다.
 * 크기를 **값으로** 남긴다(추정 0).
 *
 * 진입: `[FRAMES=600] npx tsx scripts/v4Hinge.ts`
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { makeBend, assignMassFromMesh, substepsForBending, dihedral, step,
         type Solver, type Constraint } from '../src/v3/solver.ts';
import { DT, DAMP, FABRICS } from '../src/v3/consts.ts';  // G 는 «쓰지 않는다» — 이 계기는 중력 0

const FRAMES = Number(process.env.FRAMES ?? 600);
const D = Number(process.env.D_MM ?? 9) / 1000;
const FAB = FABRICS.gray;
const OUT = 'gpu/oracle/export';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/* uv: 0=(0,0) 1=(d,0) 2=(0,d) 3=(0,−d) · tris = (0,1,2) · (1,0,3) ⟹ 공유 엣지 0–1 */
const n = 4;
const uv = Float64Array.from([0, 0, D, 0, 0, D, 0, -D]);
const pos = new Float64Array(n * 3);
for (let v = 0; v < n; v++) { pos[v * 3] = uv[v * 2]; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = uv[v * 2 + 1]; }
/* 날개 3 을 공유 엣지(x축) 둘레로 90° 접는다: (0,0,−d) → (0,+d,0). 좌표 하나가 축을 갈아탄다. */
pos[3 * 3 + 1] = D; pos[3 * 3 + 2] = 0;
const T = Uint32Array.from([0, 1, 2, 1, 0, 3]);

const s: Solver = { pos, prev: new Float64Array(n * 3), vel: new Float64Array(n * 3),
                    invMass: new Float64Array(n), n };
const pinned = new Set<number>([0, 1, 2]);            // 한쪽 삼각형 고정
const mass = assignMassFromMesh(s, T, uv, FAB.rho, pinned);
const bends = makeBend(T, uv, FAB.B);
if (bends.length !== 1) throw new Error(`굽힘 제약이 ${bends.length}개 — 정의상 1개여야 한다`);
const cons: Constraint[] = [...bends];
const SUB = substepsForBending(DT, s, bends, 0.95);
const theta0 = dihedral(s, bends[0]);

/* 부수 측정 — hypot ↔ sqrt(합) 차이(무작위 아님: 이 장면이 실제로 만드는 법선 길이 대역) */
let hypDiff = 0;
for (let i = 0; i < 4096; i++) {
  const x = (i % 17 + 1) * 1e-5, y = (i % 13 + 1) * 1e-5, z = (i % 7 + 1) * 1e-5;
  const a = Math.hypot(x, y, z), b = Math.sqrt(x * x + y * y + z * z);
  const r = a === 0 ? 0 : Math.abs(a - b) / a;
  if (r > hypDiff) hypDiff = r;
}

const t0 = Date.now();
for (let f = 0; f < FRAMES; f++) step(s, cons, { dt: DT, substeps: SUB, gravity: 0, damping: DAMP });
const ms = Date.now() - t0;
const theta1 = dihedral(s, bends[0]);

const hdr = {
  what: 'v4-03 §1-③ㄱ 합성 두 삼각형 힌지 — v3 정답', n, tris: T.length / 3, mb: bends.length,
  frames: FRAMES, substeps: SUB, d: D, G: 0, DT, DAMP, ke: FAB.B, rho: FAB.rho,
  restAngle: bends[0].restAngle, shape: bends[0].shape,
  theta0, theta1, totalMass: mass.totalMass, totalArea: mass.totalArea, pinned: [...pinned],
  hypotVsSqrtRelMax: hypDiff, ms,
};
const hb = Buffer.from(JSON.stringify(hdr), 'utf8');
const head = Buffer.alloc(4); head.writeUInt32LE(hb.length, 0);
const im = new Float64Array(n); im.set(s.invMass);
const bidx = Int32Array.from([bends[0].p0, bends[0].p1, bends[0].p2, bends[0].p3]);
writeFileSync(`${OUT}/hinge-v3.bin`, Buffer.concat([
  head, hb, Buffer.from(uv.buffer), Buffer.from(new Int32Array(T).buffer), Buffer.from(bidx.buffer),
  Buffer.from(im.buffer), Buffer.from(s.pos.buffer), Buffer.from(s.vel.buffer)]));
let lo = Infinity, hi = -Infinity;
for (let i = 0; i < n * 3; i++) { if (s.pos[i] < lo) lo = s.pos[i]; if (s.pos[i] > hi) hi = s.pos[i]; }
console.log(`n=${n} tri=${T.length / 3} mb=${bends.length} sub=${SUB} frames=${FRAMES} ${ms}ms`);
console.log(`shape=${bends[0].shape.toExponential(12)} ke=${FAB.B} restAngle=${bends[0].restAngle}`);
console.log(`이면각 ${theta0.toExponential(6)} → ${theta1.toExponential(12)} rad`);
console.log(`좌표 범위 ${lo.toExponential(9)} ~ ${hi.toExponential(9)} · hypot↔sqrt 상대차 최대 ${hypDiff.toExponential(3)}`);
