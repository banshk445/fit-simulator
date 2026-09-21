/* v5-27 §1-① — **자기관통 채널 허용의 정본 재판정**(굽기 0 · 물리 0프레임 · 처방 0).
 *
 * 골격은 v5-24 의 `scripts/v5Rejudge.ts` 와 같다 — 정본 정착 blob 이 있는 칸마다 `prepare()`(off · 그 칸의 몸)로
 * 장면을 세우고 blob 을 얹어 **`runS4Gate` 를 그대로** 부른다(게이트 식은 한 글자도 다시 쓰지 않는다).
 * 한 번 돌려 **두 판정**을 낸다 — 새 자는 게이트가 돌려준 `fails` 그대로이고,
 * 옛 자는 거기서 「자기관통」 줄을 빼고 **옛 규칙(`crossings !== 0`)** 을 다시 끼워 재구성한다.
 *
 * 진입: `[ONLY=<칸 이름 쉼표 목록>] npx tsx scripts/v5Rejudge27.ts`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { runS4Gate } from '../src/v3/s4Gate.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { SEP, TOL_SELF, FABRICS } from '../src/v3/consts.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const D = Number(process.env.D_MM ?? 9) / 1000;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

/** 정본 blob — `[u32 헤더길이][헤더 JSON][float64 3n]`(`load.py:51`) 또는 생 float64. */
function loadPos(path: string, n: number): Float64Array {
  const raw = readFileSync(path);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  if (raw.byteLength === n * 24) return new Float64Array(ab);
  const ln = new DataView(ab).getUint32(0, true);
  const hdr = JSON.parse(Buffer.from(raw.subarray(4, 4 + ln)).toString('utf-8')) as { n?: number };
  if (hdr.n !== undefined && hdr.n !== n) throw new Error(`blob n ${hdr.n} ≠ 장면 n ${n}`);
  return new Float64Array(ab.slice(4 + ln, 4 + ln + n * 24));
}

type Row = { cell: string; n: number; 교차: number; '최소쌍 mm': number; viol: number;
  옛pass: boolean; 새pass: boolean; 옛fails: string[]; 새fails: string[]; 변동: string };
const rows: Row[] = [];
const skipped: { cell: string; 사유: string }[] = [];

for (const c of cells()) {
  if (ONLY && !ONLY.has(c.id)) continue;
  const blob = `public/v3diag/v3-77/settled-${c.id}.bin`;
  if (!existsSync(blob)) { skipped.push({ cell: c.id, 사유: '정본 정착 blob 없음(판정 대조 69칸)' }); continue; }
  const bp = `public/v3diag/v3-77/body-${c.bodyId}.bin`;
  if (!existsSync(bp)) { skipped.push({ cell: c.id, 사유: `몸 파일 없음 ${bp}` }); continue; }
  const bb = readFileSync(bp);
  try {
    const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
      bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
      minPairDistLite } as never);
    const sc = P.sc as unknown as { n: number; s: { pos: Float64Array } };
    sc.s.pos.set(loadPos(blob, sc.n));
    const g = runS4Gate(P);
    const other = g.fails.filter((f) => !f.startsWith('자기관통'));
    const 옛fails = [...other, ...(g.crossings !== 0 ? [`자기관통 교차 ${g.crossings} ≠ 0`] : [])];
    const 새fails = g.fails;
    const 옛pass = 옛fails.length === 0, 새pass = 새fails.length === 0;
    rows.push({ cell: c.id, n: sc.n, 교차: g.crossings, '최소쌍 mm': g.minPairM * 1000, viol: g.violPairs,
      옛pass, 새pass, 옛fails, 새fails,
      변동: 옛pass === 새pass ? '불변' : (새pass ? '★ fail → pass' : '★ pass → fail') });
  } catch (e) { skipped.push({ cell: c.id, 사유: `던짐: ${String((e as Error).message).replace(/\s+/g, ' ')}` }); }
}

const chg = rows.filter((r) => r.변동 !== '불변');
const 교차있음 = rows.filter((r) => r.교차 !== 0);
const out = {
  what: 'v5-27 §1-① 자기관통 채널 허용(SEP−TOL_SELF) 정본 재판정(굽기 0 · 게이트 식 재사용)',
  _args: { D_MM: D * 1000, ONLY: process.env.ONLY ?? null, 계기: 'v5Rejudge27.ts' },
  문턱: { 'SEP mm': SEP * 1000, 'TOL_SELF mm': TOL_SELF * 1000, '허용 거리 mm': (SEP - TOL_SELF) * 1000 },
  '재판정 칸': rows.length, '건너뛴 칸': skipped.length,
  '옛 pass': rows.filter((r) => r.옛pass).length, '새 pass': rows.filter((r) => r.새pass).length,
  '변동 칸 수': chg.length, 변동: chg,
  '교차 ≠ 0 인 칸': 교차있음.map((r) => ({ cell: r.cell, 교차: r.교차, '최소쌍 mm': r['최소쌍 mm'], viol: r.viol })),
  '최소쌍 분포 mm': (() => { const v = rows.map((r) => r['최소쌍 mm']).sort((a, b) => a - b);
    return v.length ? { 최소: v[0], p25: v[Math.floor(v.length * 0.25)], 중앙: v[Math.floor(v.length / 2)],
      p75: v[Math.floor(v.length * 0.75)], 최대: v[v.length - 1] } : null; })(),
  전량: rows, 건너뜀: skipped,
};
writeFileSync('gpu/oracle/export/v5-27-rejudge.json', JSON.stringify(out, null, 1));
const { 전량: _a, 건너뜀: _b, ...brief } = out;
console.log(JSON.stringify(brief, null, 1));
