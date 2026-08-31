/* v4-05 §1-①② — **정답지 1칸(구속계)의 층2 v3 정답**(물리 코어 diff 0 · `src/` 0줄).
 *
 * v4-04 가 값으로 배운 것: **자유 합성계는 평형이 유일하지 않다**(함정 40) ⟹ 층2 시험계를
 * **정답지 한 칸**으로 바꾼다. 이 계는 고정점이 **0개**이고 옷을 붙드는 것은
 * **몸 충돌 + 쿨롱 마찰**뿐이라, 「강체 모드를 구속하는가」를 정면으로 묻는다.
 *
 * 초기 상태 = `settled-<cell>.bin` 의 **위치·속도 전량**(v3 가 저장한 그대로).
 * 제약 부분집합 = `CONS=inplane|bend|both` — **봉제(`dist`)는 v4 에 아직 이식이 없어 뺀다.**
 *   v3 쪽도 «같은 부분집합»으로 돌린다(정의역을 맞춘다). 이 차이는 §0-7 에 등재돼 있다.
 * 충돌은 `prepare()` 가 만든 `P.params.collision` 을 **그대로** 쓴다(격자 SDF + THICK + MU).
 * 자기충돌은 **넣지 않는다** — v4 에 이식이 없다(정의역 일치).
 *
 * 수렴 판정은 v3 인용(새 수 0):
 *   `dressRun.ts:N_WIN` = round(1/(DAMP·DT)) = 10 · `s4Gate.ts:settleNetM` = `TOL_SELF` = 1e-4 m ·
 *   창 순변위 = `max_v |pos_v − ref_v|`(`runFrames` 의 식)
 *
 * 진입: `[CELL=…] [CONS=both] [CAP=2000] [PERTURB=1e-7] [EXTRA=400] [SNAPS=0,50,100,200,400] [FRAMES=n]
 *        npx tsx scripts/v4CellConverge.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT, DAMP, G } from '../src/v3/consts.ts';
import { step, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { N_WIN } from '../src/v3/dressRun.ts';
import { S4_THRESHOLD } from '../src/v3/s4Gate.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const KIND = (process.env.CONS ?? 'both') as 'inplane' | 'bend' | 'both' | 'all' | 'ipseam' | 'bendseam';
const CAP = Number(process.env.CAP ?? 2000);
const PERTURB = Number(process.env.PERTURB ?? 0);
const FORCE = process.env.FRAMES ? Number(process.env.FRAMES) : 0;   // 비용 측정용(수렴 무시)
const D = Number(process.env.D_MM ?? 9) / 1000;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc;

/* 정착 blob — 위치 3n + 속도 3n(`dressRun.stateBlob` 순서) */
const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const bh = JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl)));
if (bh.n !== sc.n) throw new Error(`정점 수가 다르다 — blob ${bh.n} ≠ 조립 ${sc.n}`);
const nb = sc.n * 3 * 8;
sc.s.pos.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb)));
sc.s.vel.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl + nb, raw.byteOffset + 4 + hl + 2 * nb)));

/* 섭동 — 자유 정점 «전량»의 x 에 +PERTURB(강체 병진 · v4-04 와 같은 정의 · §0-5 등재) */
let nFree = 0;
for (let v = 0; v < sc.n; v++) if (sc.s.invMass[v] !== 0) { nFree++; if (PERTURB !== 0) sc.s.pos[v * 3] += PERTURB; }

/* v4-06 §0-4 — 시험계 3종은 **몸 충돌·중력을 공통으로** 갖고, 여기서 고르는 것은 «옷 제약»뿐이다.
 *   ipseam   = 늘어남 + 봉제      bendseam = 굽힘 + 봉제      all = 늘어남 + 굽힘 + 봉제
 * (both = 봉제 «없는» v4-05 정의역 · inplane/bend = 단일 종류 · 대조용으로 남긴다) */
const pick = (ks: string[]) => sc.cons.filter((x: Constraint) => ks.includes(x.kind));
const cons: Constraint[] =
    KIND === 'all' ? sc.cons
  : KIND === 'ipseam' ? pick(['inplane', 'dist'])
  : KIND === 'bendseam' ? pick(['bend', 'dist'])
  : KIND === 'both' ? pick(['inplane', 'bend'])
  : pick([KIND]);
/* 봉제 rest 확인(§0-6 램프 주의 · 가정 0) — 생성값 SEP 와 «값으로» 대조한다. */
const seam = sc.cons.filter((x: Constraint) => x.kind === 'dist') as Array<{ rest: number; k: number }>;
const restMin = Math.min(...seam.map((x) => x.rest)), restMax = Math.max(...seam.map((x) => x.rest));
console.log(`봉제 ${seam.length}개 · rest ${restMin.toExponential(6)}~${restMax.toExponential(6)} (SEP=${(2e-3).toExponential(6)}) · k ${seam[0].k} · RAMP_N ${P.RAMP_N}`);
const params = { dt: DT, substeps: P.SUB, gravity: G, damping: DAMP, collision: P.params.collision };

const netOf = (ref: Float64Array) => {
  let net = 0;
  for (let v = 0; v < sc.n; v++)
    net = Math.max(net, Math.hypot(sc.s.pos[v * 3] - ref[v * 3], sc.s.pos[v * 3 + 1] - ref[v * 3 + 1],
                                   sc.s.pos[v * 3 + 2] - ref[v * 3 + 2]));
  return net;
};

/* v4-07 §1 — 계기 «교정» 훑기. **물리 경로는 한 줄도 바뀌지 않았다**(step 호출 · 제약 집합 ·
 * 수렴 판정식 · N_WIN · settleNetM 전부 위와 동일). 바뀐 것은 «산출물의 자리와 시점»뿐이다:
 *   ① ε 를 파일명에 싣는다(덮어쓰기 방지 — v4-06 은 `-p` 하나뿐이라 ε 를 훑을 수 없었다)
 *   ② `EXTRA` — 수렴 선언 «후» 더 돌리고, `SNAPS` 오프셋마다 위치를 «스냅»한다
 *      ⟹ 한 실행이 0·50·100·200·400 을 «전부 지난다»(중복 실행 0)
 * 산출 접두는 **`cellconv7-`** 로 새로 판다 — v4-02~06 산출물을 바이트 한 개도 건드리지 않는다.
 */
/* v4-09 §1 — **산출물의 «자리와 해상도»만** 바꾼다(물리 경로 diff 0 · §0-3).
 *   ① `PREFIX` — 출력 접두를 env 로. 기본은 `cellconv7`(v4-07/08 산출물을 덮지 않는다).
 *   ② `trailAll` — 창 순변위 궤적을 **전량** 남긴다(기존 `trail` 필드는 «그대로» 둔다 —
 *      회차 간 대조가 끊기지 않게). v4-08 §1-② 가 v3·v4 를 10프레임 간격으로 나란히 못 놓은 이유가
 *      기존 `trail` 이 수렴 뒤 downsample 되기 때문이었다. */
const PREFIX = process.env.PREFIX ?? 'cellconv7';
const EXTRA = Number(process.env.EXTRA ?? 0);
const SNAPS = (process.env.SNAPS ?? '0').split(',').map(Number).sort((a, b) => a - b);
const etag = PERTURB === 0 ? '0' : PERTURB.toExponential(0).replace('e-', 'e-').replace('+', '');
const snapDone = new Map<number, { frame: number; net: number }>();
const writeSnap = (off: number, fr: number, nt: number) => {
  const hdr = {
    what: `v4-07 §1 계기교정 — v3 (${CELL} · ${KIND} · eps ${PERTURB} · 연장 +${off})`,
    cell: CELL, kind: KIND, n: sc.n, m: cons.length, nFree, substeps: P.SUB, d: D, G, DT, DAMP,
    k: FABRICS.gray.k, ke: FABRICS.gray.B, rho: FABRICS.gray.rho,
    THICK: P.params.collision!.thickness, MU: P.params.collision!.mu,
    N_WIN, tol: S4_THRESHOLD.settleNetM, perturb: PERTURB, blobFrame: bh.frame,
    convFrame, convNet, ext: off, frame: fr, net: nt, cap: CAP, extra: EXTRA,
    ms: Date.now() - t0,
  };
  const hbb = Buffer.from(JSON.stringify(hdr), 'utf8');
  const hd = Buffer.alloc(4); hd.writeUInt32LE(hbb.length, 0);
  const name = `${PREFIX}-${CELL}-${KIND}-e${etag}-x${off}`;
  writeFileSync(`${OUT}/${name}.bin`,
    Buffer.concat([hd, hbb, Buffer.from(sc.s.pos.buffer), Buffer.from(sc.s.vel.buffer)]));
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(hdr, null, 1));
  snapDone.set(off, { frame: fr, net: nt });
  console.log(`  스냅 +${off} · 프레임 ${fr} · net ${nt.toExponential(6)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
};

const t0 = Date.now();
let ref = Float64Array.from(sc.s.pos);
let frame = 0, net = Infinity, converged = false;
let convFrame = -1, convNet = NaN;
const trail: Array<[number, number]> = [];
const LIMIT = FORCE || CAP;
while (frame < LIMIT) {
  step(sc.s, cons, params);
  frame++;
  if (!Number.isFinite(sc.s.pos[0])) throw new Error(`발산 — 프레임 ${frame}`);
  if (frame % N_WIN === 0) {
    net = netOf(ref);
    trail.push([frame, net]);
    if (!FORCE && !converged && net <= S4_THRESHOLD.settleNetM) {
      converged = true; convFrame = frame; convNet = net;
      console.log(`수렴 선언 · 프레임 ${frame} · 창 순변위 ${net.toExponential(6)} m`);
      if (SNAPS.includes(0)) writeSnap(0, frame, net);
      if (EXTRA <= 0) break;
    } else if (converged) {
      const off = frame - convFrame;
      if (SNAPS.includes(off)) writeSnap(off, frame, net);
      if (off >= EXTRA) break;
    }
    ref = Float64Array.from(sc.s.pos);
  }
}
const ms = Date.now() - t0;
if (!converged && SNAPS.includes(0)) {           // 미수렴 — 상한 자리를 «사실»로 남긴다
  convFrame = frame; convNet = net; writeSnap(0, frame, net);
}

const sum = {
  what: `v4-07 §1 요약`, cell: CELL, kind: KIND, perturb: PERTURB, nFree, n: sc.n, m: cons.length,
  converged, convFrame, convNet, lastFrame: frame, lastNet: net, cap: LIMIT, extra: EXTRA,
  snaps: Object.fromEntries([...snapDone].map(([k, v]) => [k, v])),
  ms, msPerFrame: ms / frame,
  trail: trail.filter((_, i) => i < 8 || i % 10 === 0 || i === trail.length - 1),
  trailAll: trail,                                 // v4-09 — 전량(기존 trail 필드는 그대로)
};
writeFileSync(`${OUT}/${PREFIX}-${CELL}-${KIND}-e${etag}-sum.json`, JSON.stringify(sum, null, 1));
console.log(`${CELL} ${KIND} eps=${PERTURB} n=${sc.n} 자유 ${nFree} m=${cons.length} sub=${P.SUB}`);
console.log(`수렴 ${converged ? '**도달**' : '**미도달**'} · 수렴프레임 **${convFrame}** · 수렴시점 순변위 ${Number.isNaN(convNet) ? '-' : convNet.toExponential(6)} m · 최종프레임 ${frame} · ${ms}ms (${(ms / frame).toFixed(0)}ms/프레임)`);
