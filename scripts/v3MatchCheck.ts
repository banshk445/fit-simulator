/* v3-79 §3 — **자기검사**. 기대는 §3-1/§3-2 등재분이고 **여기서 새로 정하지 않는다**.
 * 버튼 상태 기대는 `provide.ts` 를 «부르지 않고» raw JSON 에서 독립으로 도출한다(§3-2 조항). */
import { readFileSync } from 'node:fs';
import { matchBody, clampAxis } from '../src/v3/match.ts';
import { buttonState, type Canon } from '../src/v3/provide.ts';
import { cells, bodyIdOf } from '../src/v3/grid.ts';

const D = 'public/v3diag/v3-77';
const provide: string[] = JSON.parse(readFileSync(`${D}/v1-provide-37.json`, 'utf8'));
const index: Record<string, { status: string; reason?: string }> = JSON.parse(readFileSync(`${D}/index-merged-108.json`, 'utf8'));
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
  if (g.detail?.includes('ARM_G')) {
    if (r?.reason?.startsWith('소매산')) armgHit++; else { armgLeak++; bad.push(`${c.id} ARM_G 문언 혼입 — ${r?.reason}`); }
  }
}
console.log('── §3-2 버튼 상태 108칸 ──');
console.log(`  일치 ${bOk}/108 · ARM_G 문언 ${armgHit}건(기대 9) · 혼입 ${armgLeak}건(기대 0)`);
bad.slice(0, 10).forEach((b) => console.log('  ❌ ' + b));

const pass = mOk === 12 && bOk === 108 && armgHit === 9 && armgLeak === 0;
console.log(`\n[v3-79 §3] ${pass ? '전량 통과' : '불일치 — 갈래 B'}`);
process.exit(pass ? 0 : 1);
