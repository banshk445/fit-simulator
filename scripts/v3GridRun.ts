/* v3-77 §1 — **무인 순회 오케스트레이터**(v3-69 **결손 ④ 해소**).
 *
 * 한 «칸» = 구운 몸 정점 배열 × 차트 한 행(옷) × gray. 정착까지 돌리고 **편입 기준**(v3-77 §0-6)으로
 * **편입 / 착용 불가 / 보류** 셋 중 «정확히 하나»로 분류한다. **문턱 변경 0 · 새 채널 0.**
 *
 * 결손 ④ 의 세 항목을 여기서 메운다:
 *   ㉠ **재개** — 칸별 체크포인트를 `index.json` 에 쓰고, 재시작하면 **완료 칸을 건너뛴다**.
 *   ㉡ **칸 실패가 순회를 죽이지 않는다** — throw 는 «착용 불가»로 분류하고 **계속 돈다**.
 *   ㉢ **순회 드라이버** — 목록·명명·인덱스를 `src/v3/grid.ts`(순수)가 준다.
 *
 * 진입: `[ONLY=<id,id>] [FRAMES=900] npx tsx scripts/v3GridRun.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare, runFrames, stateBlob } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { runS4Gate, N_WIN, S4_THRESHOLD } from '../src/v3/s4Gate.ts';
import { cells, garmentOf } from '../src/v3/grid.ts';
import { createHash } from 'node:crypto';

const DIR = 'public/v3diag/v3-77';
const IDX = `${DIR}/index.json`;
/* ★ v3-78 §0′ 개정 — **프레임 상한 규칙**(손 상수 0 · 「오케스트레이터 수정 금지」의 **유일 예외**).
 * 규칙: **「상한 = «기측정 v1 체제 정착 f» 최대 × 2」**
 * 현재 기측정 최대 = **200**(기준 칸 v3-74 f=180 · 스모크 `c100-h170-s45_M` 180 ·
 *   `c87.5-h155-s40_XL` **200**) ⟹ **상한 400**.
 * **자동 변경 0** — 정착 f 최대가 갱신돼도 **다음 «개정 커밋»에서만** 이 수를 고친다.
 * **소급 영향 0**(값으로 확인): 개정 시점 편입 칸 f = 200 / 190 / 180 ⟹ **전부 ≤ 200**. */
const SETTLED_F_MAX = 200;
const CAP = Number(process.env.FRAMES ?? SETTLED_F_MAX * 2);
/* ★ v3-78 §0″ 개정 — **칸 «시간» 상한**(「그 외 수리 0」의 **2차 예외** · 이 커밋 등재 변경 1건).
 * 규칙: **「시간 상한 = «그 머신의 기측정 정착 도달 칸» 최대 벽시계 × 2」**
 *   **정착 도달** = 프레임 상한 «안»에서 `settleNet` 성립 — **게이트 결과는 무관**하다.
 *   상한의 «목적» = **정착 가망이 없는 칸의 «조기 포기»** ⟹ 프레임 상한 규칙과 **동형**.
 *   **벽시계는 «머신 종속»**이라 머신별로 도출한다(프레임 수와 달리 이식되지 않는다).
 * 이 맥의 도출: 정착 도달 칸 최대 **59.3분**(`c87.5-h170-s45_S`) ⟹ **59.3 × 2 = 118.6분**.
 *   ★ **오염 칸 «제외» 근거**: 기계적 최대는 `c87.5-h155-s40_M` 690.1분이지만
 *     그 값은 **잠자기가 섞인 벽시계**다(§0′-4 등재 · 가동률 7.7% 실측) ⟹ **도출에서 뺀다**.
 * **자동 변경 0** — 갱신은 **다음 개정 커밋에서만**.
 * ★ **프레임 상한이 못 막는 것을 막는다** — 「교차 발생 ⟹ 프레임당 시간 폭증」은 **프레임 수를
 *   잘라도 안 잘린다**(§0′-4 가 값으로 등재한 그 성질). */
const TIME_CAP_MIN = 59.3 * 2;
const TIME_CAP_MS = TIME_CAP_MIN * 60_000;
const D = Number(process.env.D_MM ?? 9) / 1000;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

type Rec = { status: '편입' | '착용불가' | '보류'; f?: number; sec?: number; sha?: string;
             gate?: string; reason?: string; at: string };
const idx: Record<string, Rec> = existsSync(IDX) ? JSON.parse(readFileSync(IDX, 'utf8')) : {};
const save = () => { mkdirSync(DIR, { recursive: true }); writeFileSync(IDX, JSON.stringify(idx, null, 1)); };
const now = () => new Date().toISOString().slice(11, 19);

const glbBuf = readFileSync('public/models/mannequin.glb');
const glb = () => glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer;

const list = cells().filter((c) => !ONLY || ONLY.has(c.id));
console.log(`[그리드] 대상 ${list.length}칸 · 완료분 ${Object.keys(idx).length}칸 · 상한 ${CAP}프레임`);

type BodyCache = { id: string; verts: Float32Array };
let bodyCache: BodyCache | null = null;

for (const c of list) {
  if (idx[c.id]) { console.log(`  ${now()} ${c.id.padEnd(22)} **건너뜀**(${idx[c.id].status})`); continue; }
  /* 몸 «우선» 순회 — 같은 몸이 이어지면 배열을 다시 읽지 않는다. */
  if (bodyCache?.id !== c.bodyId) {
    const bp: string = `${DIR}/body-${c.bodyId}.bin`;
    if (!existsSync(bp)) { console.log(`  ${now()} ${c.id.padEnd(22)} **몸 파일 없음** — ${bp}`); continue; }
    const bb = readFileSync(bp);
    const nb: BodyCache = { id: c.bodyId, verts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)) };
    bodyCache = nb;
  }
  const t0 = performance.now();
  let P: ReturnType<typeof prepare>;
  try {
    P = prepare({ glb: glb(), fabric: FABRICS.gray, d: D, garment: garmentOf(c.size),
                  bodyVerts: bodyCache.verts, minPairDistLite });
  } catch (e) {
    /* ㉡ 조립 불능 = **착용 불가**(제품의 정당한 상태 · v3-76 §0-2). 순회는 «계속»한다. */
    idx[c.id] = { status: '착용불가', reason: (e as Error).message, at: now() }; save();
    console.log(`  ${now()} ${c.id.padEnd(22)} **착용불가** — ${(e as Error).message}`);
    continue;
  }
  let frame = 0, s4: ReturnType<typeof runS4Gate> | null = null;
  while (frame < CAP) {
    const before = Float64Array.from(P.sc.s.pos);
    const step = Math.min(N_WIN, CAP - frame);
    const r = await runFrames(P, step, undefined, undefined, frame);
    frame += step;
    if (r.diverged) break;
    s4 = runS4Gate(P, before);
    if (s4.pass || s4.settleNetM <= S4_THRESHOLD.settleNetM) break;
    /* v3-78 §0″ — **시간 상한 도달 ⟹ 조기 포기**. 청크 경계에서만 본다(프레임 중간 절단 0). */
    if (performance.now() - t0 >= TIME_CAP_MS) break;
  }
  const sec = (performance.now() - t0) / 1000;
  const settled = !!s4 && s4.settleNetM <= S4_THRESHOLD.settleNetM;
  const gate = s4 ? (s4.pass ? 'pass' : `fail(${s4.fails.join(' / ')})`) : 'diverged';
  if (s4?.pass) {
    const blob = stateBlob(P, frame, P.S.PLACE_SIG);
    const hl = new DataView(blob.buffer, blob.byteOffset).getUint32(0, true);
    const sha = createHash('sha256').update(blob.subarray(4 + hl)).digest('hex');
    writeFileSync(`${DIR}/settled-${c.id}.bin`, blob);
    idx[c.id] = { status: '편입', f: frame, sec, sha, gate, at: now() };
  } else {
    /* v3-78 §0′ ④ — **「상한 도달 보류」를 「정착 실패 보류」와 «구분»** 표기한다.
     * 상한에 닿아 멈춘 것과, 상한 «안»에서 돌다 정착을 못 본 것은 다른 사실이다. */
    const reason = settled ? '게이트 미통과'
                 : sec * 1000 >= TIME_CAP_MS ? '시간 상한 도달'
                 : frame >= CAP ? '프레임 상한 도달' : '정착 미도달';
    idx[c.id] = { status: '보류', f: frame, sec, gate, reason, at: now() };
  }
  save();
  const R = idx[c.id];
  console.log(`  ${now()} ${c.id.padEnd(22)} **${R.status}** · f=${frame} · ${sec.toFixed(1)}s · ${gate}`
    + (R.sha ? ` · sha ${R.sha.slice(0, 16)}…` : '') + (R.reason ? ` · ${R.reason}` : ''));
}
const tally = Object.values(idx).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log(`[그리드] 종료 — ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · 총 ${Object.keys(idx).length}칸`);
