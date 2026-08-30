/* v3-79 §3 — **자기검사**. 기대는 §3-1/§3-2 등재분이고 **여기서 새로 정하지 않는다**.
 * 버튼 상태 기대는 `provide.ts` 를 «부르지 않고» raw JSON 에서 독립으로 도출한다(§3-2 조항). */
import { readFileSync } from 'node:fs';
import { matchBody, clampAxis } from '../src/v3/match.ts';
import { buttonState, landingSize, type Canon } from '../src/v3/provide.ts';
import { cells, bodyIdOf } from '../src/v3/grid.ts';

const D = 'public/v3diag/v3-77';
/* v3-81 §1-② — 제공 정본은 **35**(37 은 대조 전용 · 무삭제). */
const provideRaw = JSON.parse(readFileSync(`${D}/v1-provide-35.v3-85.json`, 'utf8'));
const provide: string[] = Array.isArray(provideRaw) ? provideRaw : provideRaw.provide;
const index: Record<string, { status: string; reason?: string }> = JSON.parse(readFileSync(`${D}/index-merged-108.v3-85.json`, 'utf8'));
const canon = { provide, index } as unknown as Canon;

/* ── §3-1 매칭 표 12건 (등재분 전사) ── */
const T: [string, number, number, number, string][] = [
  ['격자점',        87.5, 155, 40,  'c87.5-h155-s40'],
  ['격자점(기본)',  100,  170, 45,  'c100-h170-s45'],
  ['격자점',        122.5,185, 50,  'c122.5-h185-s50'],
  ['중간점',        90,   160, 41,  'c87.5-h155-s40'],
  ['중간점',        115,  180, 48,  'c122.5-h185-s50'],
  ['중간점(예시)',  105,  173, 46,  'c100-h170-s45'],
  ['중간점(끝)',    70,   140, 35,  'c87.5-h155-s40'],
  ['동률 3축',      93.75,162.5,42.5,'c100-h170-s45'],
  ['동률 3축(위)',  111.25,177.5,47.5,'c100-h170-s45'],
  ['동률 1축',      93.75,155, 50,  'c100-h155-s50'],
  ['범위 밖(위)',   200,  300, 99,  'c122.5-h185-s50'],
  ['범위 밖(아래)', 10,   0,  -5,   'c87.5-h155-s40'],
];
let mOk = 0;
console.log('── §3-1 매칭 12건 ──');
for (const [tag, c, h, s, want] of T) {
  const b = { chest: clampAxis('chest', c).value, height: clampAxis('height', h).value,
              shoulder: clampAxis('shoulder', s).value };
  const got = bodyIdOf(matchBody(b).body);
  const ok = got === want; if (ok) mOk++;
  console.log(`  ${ok ? '✅' : '❌'} ${tag} (${c}·${h}·${s}) → ${got}${ok ? '' : `  기대 ${want}`}`);
}
console.log(`  매칭 ${mOk}/${T.length}`);

/* ── §3-2 버튼 상태 108칸 — 기대를 «독립»으로 도출 ── */
let bOk = 0, armgLeak = 0, armgHit = 0;
const bad: string[] = [];
for (const c of cells()) {
  const r = index[c.id];
  const wantActive = provide.includes(c.id);
  const wantGray = wantActive ? null : (r?.status === '착용불가' ? '착용불가' : '검증');
  const g = buttonState(canon, c.id);
  const ok = g.active === wantActive && g.gray === wantGray
    && (g.detail !== null) === (wantGray === '착용불가');
  if (ok) bOk++; else bad.push(`${c.id} 기대(${wantActive}·${wantGray}) 실제(${g.active}·${g.gray})`);
  /* v3-80 — 탐침을 «본문 + 접힘»으로 넓힌다: §1-③ 이 ARM_G 수치를 «접힘 안»으로 옮기라고
   * 이 판에서 «미리» 지시했기 때문이다. **기대값 9/0 은 그대로**이고 읽는 자리만 따라간다. */
  if (`${g.detail ?? ''}${g.raw ?? ''}`.includes('ARM_G')) {
    if (r?.reason?.startsWith('소매산')) armgHit++; else { armgLeak++; bad.push(`${c.id} ARM_G 문언 혼입 — ${r?.reason}`); }
  }
}
console.log('── §3-2 버튼 상태 108칸 ──');
console.log(`  일치 ${bOk}/108 · ARM_G 문언 ${armgHit}건(기대 9) · 혼입 ${armgLeak}건(기대 0)`);
bad.slice(0, 10).forEach((b) => console.log('  ❌ ' + b));

/* ── §3-1 문언 «혼입» 역검사: ㉡·㉢ 본문에 암홀/소매/제도 문자열이 있으면 실패 ── */
let leakWords = 0;
for (const c of cells()) {
  const r = index[c.id]; const g = buttonState(canon, c.id);
  if (!g.detail || r?.reason?.startsWith('소매산')) continue;
  if (/암홀|소매|제도/.test(g.detail)) { leakWords++; bad.push(`${c.id} ㉡㉢ 본문 금지어 — ${g.detail}`); }
}
console.log(`  ㉡·㉢ 본문 금지어(암홀·소매·제도) ${leakWords}건(기대 0)`);

/* ── §3-2 착지 규칙 27몸 — 기대를 raw JSON 에서 «독립» 도출 ── */
const SZ = ['S', 'M', 'L', 'XL'];
const bodyIds = [...new Set(cells().map((c) => c.bodyId))];
let lOk = 0; const noneList: string[] = [];
console.log('── §3-2 착지 규칙 27몸 ──');
for (const b of bodyIds) {
  const av = SZ.filter((s) => provide.includes(`${b}_${s}`));
  /* 독립 기대: |i−1| 최소 · 동률이면 큰 쪽 */
  let want: string | null = null;
  for (const s of av) {
    if (want === null) { want = s; continue; }
    const d = Math.abs(SZ.indexOf(s) - 1), wd = Math.abs(SZ.indexOf(want) - 1);
    if (d < wd || (d === wd && SZ.indexOf(s) > SZ.indexOf(want))) want = s;
  }
  if (want === null) noneList.push(b);
  const got = landingSize(canon, b);
  const ok = got.size === want && got.fallback === (want !== null && want !== 'M');
  if (ok) lOk++; else bad.push(`${b} 착지 기대 ${want} 실제 ${got.size}`);
}
console.log(`  일치 ${lOk}/27 · 제공 0칸 몸 ${noneList.length}개(기대 8 — v3-81 §2-3 등재분 · v3-85 재도출)`);
console.log('  제공 0칸: ' + noneList.join(' '));

const pass = mOk === 12 && bOk === 108 && armgHit === 9 && armgLeak === 0
  && leakWords === 0 && lOk === 27 && noneList.length === 8;
console.log(`\n[v3-81 §2] ${pass ? '전량 통과' : '불일치 — 갈래 D'}`);
process.exit(pass ? 0 : 1);
