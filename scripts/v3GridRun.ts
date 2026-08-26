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
const CAP = Number(process.env.FRAMES ?? 900);
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
    idx[c.id] = { status: '보류', f: frame, sec, gate,
                  reason: settled ? '게이트 미통과' : '정착 미도달', at: now() };
  }
  save();
  const R = idx[c.id];
  console.log(`  ${now()} ${c.id.padEnd(22)} **${R.status}** · f=${frame} · ${sec.toFixed(1)}s · ${gate}`
    + (R.sha ? ` · sha ${R.sha.slice(0, 16)}…` : '') + (R.reason ? ` · ${R.reason}` : ''));
}
const tally = Object.values(idx).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
console.log(`[그리드] 종료 — ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')} · 총 ${Object.keys(idx).length}칸`);
