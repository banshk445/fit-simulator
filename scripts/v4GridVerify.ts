/* v4-40 §1-②ㄹ — **A포즈 그리드 몸 27칸 검증기**(판정만 · `src/` 0줄 · 굽기 0 · 몸 생성 0).
 *
 * 승혁이 브라우저 하네스(`src/components/V4AposeGrid.tsx`)로 반출한 뒤 **이 스크립트가 받는다**.
 * 채널(전부 파일에서 «직접» 잰다 · 손 상수 0):
 *   ㉠ 파일 셋 존재 — `l3ap-body-<id>-a<deg>.bin` · `…-a<deg>.json` · `l3ap-origin-<id>-a<deg>.json`
 *   ㉡ bin 모양 — 바이트 길이가 `4 × 3n` 이고 `n` 이 **27칸 전부 같은가**(같은 GLB · 같은 위상)
 *   ㉢ 유한성 — NaN·Inf **0개**
 *   ㉣ 높이 — `ymax − ymin` 과 목표 키(`grid.ts` 의 `height/100`)의 차
 *   ㉤ 층3 성립 — `deriveLevels` 가 `Y_LOW`·`chestY`·`waistY` 를 내는가(v4-38·39 규칙 · 던지면 사유)
 *   ㉥ 축 파일 — `팔축_후` 좌우 존재 · 단위벡터인가 · `sin(deg)` 기대와의 차
 *   ㉦ 원점 파일 — `피벗`·`중심선투영` 유한 · 좌우 |x| 대칭 차
 *   ㉧ **기본 몸 교차 확인** — `c100-h170-s45` 칸을 Node 산출(`l3ap-body-c100-h170-s45-a35.bin`)과
 *      맞대어 정점 수·최대 좌표 차·sha 를 낸다(같은 규칙이면 «같은 몸»이어야 한다).
 *
 * 진입: `[DIR=gpu/oracle/export] [DEG=35] npx tsx scripts/v4GridVerify.ts`
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, bodies, bodyIdOf, type Size } from '../src/v3/grid.ts';
import { deriveLevels } from '../src/v3/bodyLevels.ts';

const DIR = process.env.DIR ?? 'gpu/oracle/export/grid27';      // 브라우저 하네스 산출이 떨어지는 자리
const BASEDIR = process.env.BASEDIR ?? 'gpu/oracle/export';      // Node 산출(기준 몸)이 있는 자리
const DEG = Number(process.env.DEG ?? 35);
const D = Number(process.env.D_MM ?? 9) / 1000;
const BASE = 'c100-h170-s45';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const rows = bodies().map((b) => {
  const id = bodyIdOf(b);
  const pb = `${DIR}/l3ap-body-${id}-a${DEG}.bin`;
  const pj = `${DIR}/l3ap-body-${id}-a${DEG}.json`;
  const po = `${DIR}/l3ap-origin-${id}-a${DEG}.json`;
  const row: Record<string, unknown> = { id, 목표: { chest: b.chest, height: b.height, shoulder: b.shoulder } };
  row['㉠ 파일 셋'] = [existsSync(pb), existsSync(pj), existsSync(po)];
  if (!existsSync(pb)) { row.결과 = '없음'; return row; }
  const raw = readFileSync(pb);
  row['㉡ 바이트'] = raw.byteLength;
  row['㉡ n'] = raw.byteLength / 12;
  row['bin sha256'] = sha(raw);
  const v = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  let bad = 0, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < v.length; i++) { if (!Number.isFinite(v[i])) bad++; }
  for (let i = 1; i < v.length; i += 3) { if (v[i] < ymin) ymin = v[i]; if (v[i] > ymax) ymax = v[i]; }
  row['㉢ 비유한'] = bad;
  row['㉣ 높이 m'] = ymax - ymin;
  row['㉣ 목표 차 mm'] = ((ymax - ymin) - b.height / 100) * 1000;
  /* ㉤ — 이 몸으로 옷 칸 하나를 세워 층3 레벨이 서는지 본다(그 몸의 «M» 사이즈 칸을 쓴다). */
  const cell = cells().find((c) => c.bodyId === id && c.size === 'M') ?? cells().find((c) => c.bodyId === id);
  if (cell) {
    try {
      const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(cell.size as Size),
                          bodyVerts: v, minPairDistLite });
      const L = deriveLevels(P.prim0.pos, P.bodyIdx, P.S.AXIS_Z, P.S.Y_TOP);
      row['㉤ 레벨'] = { Y_LOW: L.Y_LOW, chestY: L.chestY, waistY: L.waistY, Y_ARM: L.Y_ARM,
                        C_chest_mm: L.C_chest * 1000, C_waist_mm: L.C_waist * 1000,
                        'chestY > waistY': L.chestY > L.waistY };
    } catch (e) { row['㉤ 레벨'] = null; row['㉤ 던짐'] = (e as Error).message; }
  }
  if (existsSync(pj)) {
    const j = JSON.parse(readFileSync(pj, 'utf8')) as { 팔축_후?: { name: string; dir: number[] }[] };
    const ax = (j.팔축_후 ?? []).map((r) => ({ name: r.name, len: Math.hypot(r.dir[0], r.dir[1], r.dir[2]),
                                              dir: r.dir }));
    row['㉥ 팔축'] = ax;
    const R = ax.find((x) => x.name.includes('Right'))?.dir;
    if (R) row['㉥ sin 기대차'] = Math.abs(Math.abs(R[1]) - Math.sin((DEG * Math.PI) / 180));
  }
  if (existsSync(po)) {
    const o = JSON.parse(readFileSync(po, 'utf8')) as
      { left?: { 피벗?: number[]; 중심선투영?: number[] }; right?: { 피벗?: number[]; 중심선투영?: number[] } };
    const L2 = o.left?.피벗, R2 = o.right?.피벗;
    row['㉦ 피벗'] = { left: L2, right: R2,
                     '|x| 차 mm': L2 && R2 ? Math.abs(Math.abs(L2[0]) - Math.abs(R2[0])) * 1000 : null,
                     'y 차 mm': L2 && R2 ? Math.abs(L2[1] - R2[1]) * 1000 : null,
                     유한: [L2, R2].every((p) => !!p && p.every((x) => Number.isFinite(x))) };
  }
  row.결과 = bad === 0 && row['㉤ 레벨'] ? '통과' : '확인 필요';
  return row;
});

/* ㉧ 기본 몸 교차 확인 — Node 산출(v4-17/26 경로)과 브라우저 산출을 맞댄다. */
const nodeBin = `${BASEDIR}/l3ap-body-${BASE}-a${DEG}.bin`;
let cross: Record<string, unknown> = { 상태: '기준 파일 없음' };
const gridBase = rows.find((r) => r.id === BASE);
if (existsSync(nodeBin) && gridBase && gridBase['bin sha256']) {
  const a = readFileSync(nodeBin);
  cross = { 기준: nodeBin, 기준sha: sha(a), 그리드sha: gridBase['bin sha256'],
            'sha 동일': sha(a) === gridBase['bin sha256'], 기준바이트: a.byteLength };
  if (a.byteLength === (gridBase['㉡ 바이트'] as number)) {
    const x = new Float32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
    const g = readFileSync(`${DIR}/l3ap-body-${BASE}-a${DEG}.bin`);
    const y = new Float32Array(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength));
    let mx = 0;
    for (let i = 0; i < x.length; i++) mx = Math.max(mx, Math.abs(x[i] - y[i]));
    cross['최대 좌표차 mm'] = mx * 1000;
  } else cross['바이트 차'] = a.byteLength - (gridBase['㉡ 바이트'] as number);
}

const out = { what: 'v4-40 §1-②ㄹ A포즈 그리드 몸 검증기', dir: DIR, baseDir: BASEDIR, deg: DEG,
              칸: rows.length, 통과: rows.filter((r) => r.결과 === '통과').length,
              교차확인: cross, 행: rows };
writeFileSync(`${BASEDIR}/l3ap-grid-verify-a${DEG}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, 행: rows.map((r) => ({ id: r.id, 결과: r.결과, n: r['㉡ n'],
  '높이 목표차 mm': r['㉣ 목표 차 mm'], 레벨: r['㉤ 레벨'] ? '성립' : (r['㉤ 던짐'] ?? '—') })) }, null, 1));
