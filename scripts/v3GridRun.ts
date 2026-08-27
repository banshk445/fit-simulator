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
 * 진입: `[ONLY=<id,id>] [REV=1] [SLICE=a:b] [FRAMES=900] [SECS=15730] npx tsx scripts/v3GridRun.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
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
/* ★ v3-78B §0″ 개정 — **칸 «시간» 상한 규칙**. 맥의 프레임 상한 규칙과 **같은 형태**(손 상수 0).
 * 규칙: **「상한 = «그 머신의 기측정 정착 도달 칸» 최대 벽시계 × 2」**
 * 2호기 기측정 최대 = **7865.0s = 131.1분** — `c122.5-h185-s40_XL`(f=190 · **정착 도달** · 게이트 미통과)
 *   ⟹ **상한 15730s = 262.2분**.
 * **자동 변경 0** — 더 큰 값이 나와도 **다음 «개정 커밋»에서만** 이 수를 고친다.
 * **소급 0** — 이미 기록된 9칸을 다시 판정하지 않는다.
 * ★ 도출값의 **측정 조건 병기**: 7865.0s 는 **게임이 물리 6코어를 쓰는 구간에서 잰 값**이다
 *   (v3-78B §4 오염 등재분) ⟹ 이 상한은 무경합 조건에서 그만큼 **느슨하다**. 조이지 않는다 —
 *   문턱을 결과에 맞춰 움직이지 않는다(함정 14).
 * ★ 검사 granularity: 상한은 **`N_WIN` 프레임 창 경계에서만** 본다 ⟹ 실제 정지는 최대 **한 창**만큼 넘길 수 있다. */
const SETTLED_SEC_MAX = 7865.0;
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

type Rec = { status: '편입' | '착용불가' | '보류'; f?: number; sec?: number; sha?: string;
             gate?: string; reason?: string; at: string;
             host?: string; os?: string; node?: string };
const idx: Record<string, Rec> = existsSync(IDX) ? JSON.parse(readFileSync(IDX, 'utf8')) : {};
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
console.log(`[그리드] 대상 ${list.length}칸 · 완료분 ${Object.keys(idx).length}칸 · 상한 ${CAP}프레임`
  + ` · 순서 ${REV ? '역순' : '순방향'}${SLICE ? ` · 구간 ${SLICE}` : ''}`
  + ` · 시간 상한 ${(SEC_CAP / 60).toFixed(1)}분`
  + ` · 머신 ${SRC.host} (${SRC.os} · node ${SRC.node})`);
if (list.length) console.log(`[그리드] 첫 칸 ${list[0].id} · 끝 칸 ${list[list.length - 1].id}`);

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
    idx[c.id] = { status: '착용불가', reason: (e as Error).message, at: now(), ...SRC }; save();
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
    idx[c.id] = { status: '편입', f: frame, sec, sha, gate, at: now(), ...SRC };
  } else {
    /* v3-78 §0′ ④ — **「상한 도달 보류」를 「정착 실패 보류」와 «구분»** 표기한다.
     * 상한에 닿아 멈춘 것과, 상한 «안»에서 돌다 정착을 못 본 것은 다른 사실이다. */
    /* 우선순위: 정착을 봤으면 시간과 무관하게 **게이트 판정**이 확정이다. 그 다음이 시간 상한. */
    const reason = settled ? '게이트 미통과' : timeCapped ? '시간 상한 도달'
      : frame >= CAP ? '상한 도달' : '정착 미도달';
    idx[c.id] = { status: '보류', f: frame, sec, gate, reason, at: now(), ...SRC };
  }
  save();
  const R = idx[c.id];
  console.log(`  ${now()} ${c.id.padEnd(22)} **${R.status}** · f=${frame} · ${sec.toFixed(1)}s · ${gate}`
    + (R.sha ? ` · sha ${R.sha.slice(0, 16)}…` : '') + (R.reason ? ` · ${R.reason}` : '') + ` · @${SRC.host}`);
}
const tally = Object.values(idx).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log(`[그리드] 종료 — ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · 총 ${Object.keys(idx).length}칸`);
