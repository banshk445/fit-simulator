/* v3-78B §2 — **두 머신 index.json «합집합» 병합기**(2호기 분산 굽기).
 *
 * 이 판에서는 **작성·단위 확인까지**다. 실제 병합 «실행»은 양쪽 완주 후 **별도 지시**로 한다.
 * 기본 동작이 **드라이런**인 이유가 그것이다 — `OUT=` 을 주지 않으면 **파일을 하나도 쓰지 않는다**.
 *
 * 규약(v3-78B §0 사전 등재분 · 여기서 새로 «정하는» 것 0):
 *   ㉠ **중복 칸 = 맥(원 순회) 기록 «우선»** · 2호기 중복분은 **참고 등재**(폐기 «아님» ⟹ `dup[]` 에 원문 보존).
 *   ㉡ 칸의 유효성 = **그 칸의 blob 이 게이트를 통과했는가**(머신 무관) ⟹ 병합은 **판정을 다시 하지 않는다**.
 *   ㉢ **두 머신의 같은 칸 비트 동일은 «미보장»** ⟹ 중복 칸의 sha 가 달라도 **불일치로 세지 않는다**.
 *       다만 «같은지 다른지»는 **사실로 센다**(`shaSame` / `shaDiff`).
 *   ㉣ 출처 판별 = **어느 파일에서 왔는가**(1차) · `host` 필드 유무(2차 · 부재 = 맥).
 *       둘이 어긋나면 **불일치로 보고**한다(자동 교정 0).
 *
 * 계정 검증(전량):
 *   · 분류 합 = **108**(편입 + 착용불가 + 보류 + 미기록) — `src/v3/grid.ts` 정본 목록과 대조.
 *   · **sha 파일 대조** — `편입` 칸마다 `settled-<id>.bin` 이 있고 그 sha256 이 기록과 같은가.
 *     식은 오케스트레이터와 **같다**: 헤더 길이 `hl` 을 앞 4바이트에서 읽고 `blob[4+hl:]` 만 해싱한다.
 *
 * 진입:
 *   `IDX_MAC=<index.json> IDX_WIN=<index.json> [BLOB_MAC=<blob 디렉터리>] [BLOB_WIN=…] [OUT=<merged.json>] npx tsx scripts/v3GridMerge.ts`
 *   `BLOB_MAC`/`BLOB_WIN` 기본값 = 각 index.json 이 놓인 디렉터리.
 * ★ 인자명 주의: `WINDIR` 은 **Windows 시스템 환경변수**(`C:\WINDOWS`)라 쓸 수 없다 — 단위 확인에서 실제로 충돌했다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { cells } from '../src/v3/grid.ts';

type Rec = { status: '편입' | '착용불가' | '보류'; f?: number; sec?: number; sha?: string;
             gate?: string; reason?: string; at: string;
             host?: string; os?: string; node?: string };
type Idx = Record<string, Rec>;

const MAC = process.env.IDX_MAC ?? 'public/v3diag/v3-77/index.json';
const WIN = process.env.IDX_WIN ?? 'public/v3diag/v3-77/index.json';
const MACDIR = process.env.BLOB_MAC ?? dirname(MAC);
const WINDIR = process.env.BLOB_WIN ?? dirname(WIN);
const OUT = process.env.OUT ?? null;

const load = (p: string): Idx => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const mac = load(MAC), win = load(WIN);

/** 오케스트레이터와 **같은 식** — 헤더를 뺀 본문만 해싱한다(`v3GridRun.ts` 편입 분기). */
function blobSha(path: string): string | null {
  if (!existsSync(path)) return null;
  const b = readFileSync(path);
  const hl = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
  return createHash('sha256').update(b.subarray(4 + hl)).digest('hex');
}

const ALL = cells().map((c) => c.id);
const merged: Idx = {};
type Dup = { id: string; kept: '맥'; mac: Rec; win: Rec; sameStatus: boolean; shaSame: boolean | null };
const dups: Dup[] = [];
const originMismatch: string[] = [];

for (const id of ALL) {
  const m = mac[id], w = win[id];
  /* ㉣ 출처 판별 2차 — 파일이 말하는 출처와 `host` 필드가 어긋나는가. 자동 교정 0 · 보고만. */
  if (m && m.host) originMismatch.push(`${id}: 맥 파일 기록에 host=${m.host}`);
  if (w && !w.host) originMismatch.push(`${id}: 2호기 파일 기록에 host 부재`);
  if (m && w) {
    /* ㉠ 맥 «우선» · 2호기분은 폐기하지 않고 `dup[]` 로 남긴다. */
    merged[id] = m;
    dups.push({ id, kept: '맥', mac: m, win: w, sameStatus: m.status === w.status,
                shaSame: m.sha && w.sha ? m.sha === w.sha : null });
  } else if (m) merged[id] = m;
  else if (w) merged[id] = w;
}

/* ── 계정 검증 ────────────────────────────────────────────────────────── */
const tally = { 편입: 0, 착용불가: 0, 보류: 0 } as Record<Rec['status'], number>;
for (const id of ALL) if (merged[id]) tally[merged[id].status]++;
const missing = ALL.filter((id) => !merged[id]);
const total = tally.편입 + tally.착용불가 + tally.보류 + missing.length;

/* sha 파일 대조 — 편입 칸만. blob 은 **그 기록을 낸 머신의 디렉터리**에서 찾는다. */
type ShaRow = { id: string; from: '맥' | '2호기'; ok: boolean; note: string };
const shaRows: ShaRow[] = [];
for (const id of ALL) {
  const r = merged[id];
  if (!r || r.status !== '편입') continue;
  const from: '맥' | '2호기' = mac[id] && merged[id] === mac[id] ? '맥' : '2호기';
  const dir = from === '맥' ? MACDIR : WINDIR;
  const path = `${dir}/settled-${id}.bin`;
  const got = blobSha(path);
  if (got === null) shaRows.push({ id, from, ok: false, note: `blob 부재 — ${path}` });
  else if (!r.sha) shaRows.push({ id, from, ok: false, note: '기록에 sha 없음' });
  else if (got === r.sha) shaRows.push({ id, from, ok: true, note: got.slice(0, 16) + '…' });
  else shaRows.push({ id, from, ok: false, note: `불일치 파일 ${got.slice(0, 16)}… ↔ 기록 ${r.sha.slice(0, 16)}…` });
}

/* ── 보고 ────────────────────────────────────────────────────────────── */
const macOnly = ALL.filter((id) => mac[id] && !win[id]).length;
const winOnly = ALL.filter((id) => win[id] && !mac[id]).length;
console.log(`[병합] 맥 ${Object.keys(mac).length}칸(${MAC}) · 2호기 ${Object.keys(win).length}칸(${WIN})`);
console.log(`[병합] 맥 단독 ${macOnly} · 2호기 단독 ${winOnly} · 중복 ${dups.length} · 미기록 ${missing.length}`);
console.log(`[계정] 편입 ${tally.편입} · 착용불가 ${tally.착용불가} · 보류 ${tally.보류} · 미기록 ${missing.length}`
  + ` ⟹ 합 ${total} / ${ALL.length} — ${total === ALL.length ? '**일치**' : '**불일치**'}`);
if (missing.length) console.log(`[계정] 미기록 칸: ${missing.join(' ')}`);

for (const d of dups) {
  console.log(`  중복 ${d.id.padEnd(22)} 채택=**맥**(${d.mac.status}) · 2호기=${d.win.status}`
    + ` · 분류 ${d.sameStatus ? '같음' : '**다름**'}`
    + ` · sha ${d.shaSame === null ? '대조 불가' : d.shaSame ? '같음' : '다름(미보장 · 불일치로 세지 않음)'}`
    + ` · 2호기분 참고 등재`);
}
const shaBad = shaRows.filter((r) => !r.ok);
console.log(`[sha] 편입 ${shaRows.length}칸 대조 — 일치 ${shaRows.length - shaBad.length} · 불일치/부재 ${shaBad.length}`);
for (const r of shaBad) console.log(`  ✗ ${r.id.padEnd(22)} (${r.from}) ${r.note}`);
if (originMismatch.length) {
  console.log(`[출처] 파일↔host 어긋남 ${originMismatch.length}건(자동 교정 0):`);
  for (const s of originMismatch) console.log(`  ! ${s}`);
}
const dupStatusDiff = dups.filter((d) => !d.sameStatus).length;
const dupShaDiff = dups.filter((d) => d.shaSame === false).length;
console.log(`[요약] 중복 분류 다름 ${dupStatusDiff} · 중복 sha 다름 ${dupShaDiff}(미보장 · 사실 등재)`);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ merged, dup: dups, missing, tally, sha: shaRows }, null, 1));
  console.log(`[병합] 기록 ${OUT}`);
} else {
  console.log('[병합] **드라이런** — `OUT=<경로>` 를 주지 않아 아무 파일도 쓰지 않았다.');
}
const ok = total === ALL.length && shaBad.length === 0 && missing.length === 0;
console.log(`[병합] 종료 — 전량 계정 ${ok ? '**성립**' : '**미성립**'}`);
