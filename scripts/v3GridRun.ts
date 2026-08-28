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
 * 진입: `[ONLY=<id,id>] [REV=1] [SLICE=a:b] [FRAMES=900] [SECS=15730] [SHARD=n PAR=4] [RECHECK=1] npx tsx scripts/v3GridRun.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { prepare, runFrames, stateBlob } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { runS4Gate, N_WIN, S4_THRESHOLD } from '../src/v3/s4Gate.ts';
import { cells, garmentOf } from '../src/v3/grid.ts';
import { createHash } from 'node:crypto';

const DIR = 'public/v3diag/v3-77';
/* ★ v3-78B §0‴ 개정 — **샤드별 인덱스**(4-way 병렬 굽기 · 전략 세션 승인분 · 근거 §1′ 워커 병렬).
 * `SHARD=<이름>` ⟹ 이 프로세스가 «쓰는» 파일이 `index-shard-<이름>.json` 으로 갈린다.
 *   목적은 **동시에 도는 프로세스가 서로의 체크포인트를 덮어쓰지 않게** 하는 것 하나다 —
 *   판정·문턱·순회 규칙·분류 기준은 **전부 불변**(값 채널 0줄).
 * **건너뜀 판정은 «합집합»으로** 본다: `index.json` + 그 시점에 존재하는 모든 `index-shard-*.json`.
 *   ⟹ 단독 순회로 이미 기록된 칸을 샤드가 다시 돌지 않는다(재개 규약 유지).
 * `PAR=<n>` ⟹ 기록에 **샤드 수 `par`** 를 남긴다(조건 ② — **sec 오염을 기록 자체가 말하게 한다**).
 *   2호기 시간 채널은 이 시점부터 **처리량 채널로 강등**된다(칸 간 절대 비교 불가).
 * `RECHECK=1` ⟹ 건너뜀 판정을 끄고 **강제 재실행**. 조건 ④(값 불변 현장 검증)의 재실행 전용이며,
 *   **이중 기록 0** 을 위해 반드시 별도 `SHARD=` 인덱스로 보낸다(본 계정에 안 들어간다). */
const SHARD = process.env.SHARD ?? null;
const PAR = process.env.PAR ? Number(process.env.PAR) : null;
const RECHECK = process.env.RECHECK === '1';
const IDX = SHARD ? `${DIR}/index-shard-${SHARD}.json` : `${DIR}/index.json`;
/* ★ v3-78 §0′ 개정 — **프레임 상한 규칙**(손 상수 0 · 「오케스트레이터 수정 금지」의 **유일 예외**).
 * 규칙: **「상한 = «기측정 v1 체제 정착 f» 최대 × 2」**
 * 현재 기측정 최대 = **200**(기준 칸 v3-74 f=180 · 스모크 `c100-h170-s45_M` 180 ·
 *   `c87.5-h155-s40_XL` **200**) ⟹ **상한 400**.
 * **자동 변경 0** — 정착 f 최대가 갱신돼도 **다음 «개정 커밋»에서만** 이 수를 고친다.
 * **소급 영향 0**(값으로 확인): 개정 시점 편입 칸 f = 200 / 190 / 180 ⟹ **전부 ≤ 200**. */
const SETTLED_F_MAX = 200;
const CAP = Number(process.env.FRAMES ?? SETTLED_F_MAX * 2);
/* ★ v3-78 §0″ 개정 — **칸 «시간» 상한**(맥 도출값 · **§0⁗ 이식에서 «보존» 우선** 조항).
 * 규칙: **「상한 = «그 머신의 기측정 정착 도달 칸» 최대 벽시계 × 2」**(2호기와 «같은 규칙»).
 *   **벽시계는 머신 종속**이라 **도출값은 머신마다 다르다** — 규칙만 공유하고 수는 각자 뜬다.
 * **이 맥의 도출**: 정착 도달 칸 최대 **59.3분**(`c87.5-h170-s45_S`) ⟹ **59.3 × 2 = 118.6분**.
 *   ★ 오염 칸 «제외» 근거: 기계적 최대 690.1분(`c87.5-h155-s40_M`)은 **잠자기가 섞인 벽시계**다
 *     (§0′-4 등재 · 가동률 7.7% 실측) ⟹ 도출에서 뺀다.
 * ★ **§0⁗ 이식 충돌 처분**: 2호기 파일은 `SETTLED_SEC_MAX = 7865.0`(2호기 도출 · 262.2분)을
 *   들고 온다. **개정 지시 「충돌은 맥의 시간 상한 로직 보존 우선」에 따라 이 블록으로 덮는다.**
 *   2호기 값은 **그 머신의 도출값이고 맥에 이식되지 않는다**(무삭제 — 이 주석이 그 기록이다).
 * **자동 변경 0** — 갱신은 다음 «개정 커밋»에서만. */
const SETTLED_SEC_MAX = 59.3 * 60;
const SEC_CAP = Number(process.env.SECS ?? SETTLED_SEC_MAX * 2);
const D = Number(process.env.D_MM ?? 9) / 1000;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

/* ★ v3-78B §0 개정 ① — **실행 구간 인자**(「오케스트레이터 수정 금지」 **2차 예외** · 2호기 분산 굽기).
 * `REV=1` = 칸 목록 **역순** · `SLICE=a:b` = 부분집합(**역순 적용 «후»** 인덱스 · 끝 배타 · `b` 생략 가능).
 * **목록 «내용»은 바뀌지 않는다** — `cells()` 정본 108칸의 순서·부분만 고른다(새 칸 0 · 명명 0).
 * 근거: 두 머신이 **양 끝에서** 같은 목록을 돌아 만나는 지점에서만 중복되게 한다(v3-78B 분담 규약). */
const REV = process.env.REV === '1';
const SLICE = process.env.SLICE ?? null;

/* ★ v3-78B §0 개정 ② — **칸 기록의 머신 출처**. 이 판 이전 기록(맥 순회)에는 **이 필드가 없다** ⟹
 * **부재 = 맥(원 순회)**로 읽는다(병합 규칙의 판별자). **판정·문턱에는 쓰이지 않는다** — 출처 표기 전용. */
const SRC = { host: hostname(), os: `${process.platform}-${process.arch}`, node: process.version };

type Rec = { status: '편입' | '착용불가' | '보류'; f?: number; sec?: number; sha?: string; par?: number;
             gate?: string; reason?: string; at: string;
             host?: string; os?: string; node?: string };
const loadIdx = (p: string): Record<string, Rec> => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
/** 이 프로세스가 «쓰는» 인덱스. 샤드면 자기 파일, 아니면 기존 `index.json`(동작 불변). */
const idx: Record<string, Rec> = loadIdx(IDX);
/** 건너뜀 판정용 **읽기 전용 합집합** — 단독분 + 모든 샤드분. 시작 시 1회 읽는다. */
const seen: Record<string, Rec> = (() => {
  const out: Record<string, Rec> = loadIdx(`${DIR}/index.json`);
  if (existsSync(DIR)) for (const f of readdirSync(DIR))
    if (/^index-shard-.+[.]json$/.test(f)) Object.assign(out, loadIdx(`${DIR}/${f}`));
  return out;
})();
const save = () => { mkdirSync(DIR, { recursive: true }); writeFileSync(IDX, JSON.stringify(idx, null, 1)); };
const now = () => new Date().toISOString().slice(11, 19);

const glbBuf = readFileSync('public/models/mannequin.glb');
const glb = () => glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer;

let list = cells().filter((c) => !ONLY || ONLY.has(c.id));
if (REV) list = list.slice().reverse();
if (SLICE) {
  const [a, b] = SLICE.split(':').map(Number);
  list = list.slice(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : undefined);
}
console.log(`[그리드] 대상 ${list.length}칸 · 완료분 ${Object.keys(seen).length}칸 · 상한 ${CAP}프레임`
  + ` · 순서 ${REV ? '역순' : '순방향'}${SLICE ? ` · 구간 ${SLICE}` : ''}`
  + ` · 시간 상한 ${(SEC_CAP / 60).toFixed(1)}분`
  + (SHARD ? ` · **샤드 ${SHARD}**(par ${PAR ?? '?'} · 기록 ${IDX})` : '')
  + (RECHECK ? ' · **RECHECK**(건너뜀 끔 · 검증 전용)' : '')
  + ` · 머신 ${SRC.host} (${SRC.os} · node ${SRC.node})`);
if (list.length) console.log(`[그리드] 첫 칸 ${list[0].id} · 끝 칸 ${list[list.length - 1].id}`);

type BodyCache = { id: string; verts: Float32Array };
let bodyCache: BodyCache | null = null;

for (const c of list) {
  if (!RECHECK && seen[c.id]) { console.log(`  ${now()} ${c.id.padEnd(22)} **건너뜀**(${seen[c.id].status})`); continue; }
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
    idx[c.id] = { status: '착용불가', reason: (e as Error).message, at: now(), ...SRC, ...(PAR ? { par: PAR } : {}) }; save();
    console.log(`  ${now()} ${c.id.padEnd(22)} **착용불가** — ${(e as Error).message} · @${SRC.host}`);
    continue;
  }
  let frame = 0, s4: ReturnType<typeof runS4Gate> | null = null, timeCapped = false;
  while (frame < CAP) {
    const before = Float64Array.from(P.sc.s.pos);
    const step = Math.min(N_WIN, CAP - frame);
    const r = await runFrames(P, step, undefined, undefined, frame);
    frame += step;
    if (r.diverged) break;
    s4 = runS4Gate(P, before);
    if (s4.pass || s4.settleNetM <= S4_THRESHOLD.settleNetM) break;
    /* §0″ — 시간 상한. **창 경계에서만** 본다(최대 한 창 초과 가능).
     * 정착·게이트 판정이 먼저다 — 위 break 를 지나온 칸만 여기 걸린다. */
    if ((performance.now() - t0) / 1000 >= SEC_CAP) { timeCapped = true; break; }
  }
  const sec = (performance.now() - t0) / 1000;
  const settled = !!s4 && s4.settleNetM <= S4_THRESHOLD.settleNetM;
  const gate = s4 ? (s4.pass ? 'pass' : `fail(${s4.fails.join(' / ')})`) : 'diverged';
  if (s4?.pass) {
    const blob = stateBlob(P, frame, P.S.PLACE_SIG);
    const hl = new DataView(blob.buffer, blob.byteOffset).getUint32(0, true);
    const sha = createHash('sha256').update(blob.subarray(4 + hl)).digest('hex');
    writeFileSync(`${DIR}/settled-${c.id}.bin`, blob);
    idx[c.id] = { status: '편입', f: frame, sec, sha, gate, at: now(), ...SRC, ...(PAR ? { par: PAR } : {}) };
  } else {
    /* v3-78 §0′ ④ — **「상한 도달 보류」를 「정착 실패 보류」와 «구분»** 표기한다.
     * 상한에 닿아 멈춘 것과, 상한 «안»에서 돌다 정착을 못 본 것은 다른 사실이다. */
    /* 우선순위: 정착을 봤으면 시간과 무관하게 **게이트 판정**이 확정이다. 그 다음이 시간 상한. */
    const reason = settled ? '게이트 미통과' : timeCapped ? '시간 상한 도달'
      : frame >= CAP ? '상한 도달' : '정착 미도달';
    idx[c.id] = { status: '보류', f: frame, sec, gate, reason, at: now(), ...SRC, ...(PAR ? { par: PAR } : {}) };
  }
  save();
  const R = idx[c.id];
  console.log(`  ${now()} ${c.id.padEnd(22)} **${R.status}** · f=${frame} · ${sec.toFixed(1)}s · ${gate}`
    + (R.sha ? ` · sha ${R.sha.slice(0, 16)}…` : '') + (R.reason ? ` · ${R.reason}` : '') + ` · @${SRC.host}`);
}
const tally = Object.values(idx).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log(`[그리드] 종료 — ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · 총 ${Object.keys(idx).length}칸`);
