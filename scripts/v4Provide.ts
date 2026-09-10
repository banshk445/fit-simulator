/* v4-52 §1-① ② — **편입 산출**(제공 목록 · 분류 색인). 게이트 5채널은 **읽기만** 하고 고치지 않는다.
 *
 * 편입 조건(= 「제공한다」의 정의) — **둘 다** 서야 한다:
 *   ㉠ 게이트 `pass`(굽기 품질의 자 · `src/v3/s4Gate.ts` 문턱 그대로 · 이 파일이 정하는 수 0)
 *   ㉡ **어깨 걸림** — 「어깨선 위 옷 정점 수」 **≥ N**(화면 채널의 자 · v4-52 신설)
 *
 * ㉡의 정의는 v4-30 계기 그대로다 — `gpu/bake/slip_probe.py:58` 「`(p[:,1] > Y_TOP).sum()`」 ·
 * `Y_TOP` = 그 칸 장면의 어깨선 높이(`P.S.Y_TOP`) · **좌우 «합»**(v4-30 이 좌우를 가르지 않는다) ·
 * 위치는 **제품이 읽는 주입 blob**의 위치 블록에서 읽는다(화면이 보는 바이트와 같다).
 *
 * ★ N = **172** — v4-51 §1-② 의 **이봉 분포**에서 «빈 구간의 중점»으로 유도했다:
 *   관측된 미달 최대 **1**(c87.5-h155-s40_L) ↔ 성립 최소 **343**(c122.5-h185-s40_S) ⟹ (1 + 343) / 2 = 172.
 *   **어느 칸의 값도 아니다**(결과에 맞춘 수가 아니라 두 무리 «사이»에서 가장 먼 자리다).
 *
 * 진입: `[ASSET=public/v3diag/v4-a35] [RESULTS=gpu/bake/results/v4-46-A108] npx tsx scripts/v4Provide.ts`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, type Size } from '../src/v3/grid.ts';

const ASSET = process.env.ASSET ?? 'public/v3diag/v4-a35';
const D = Number(process.env.D_MM ?? 9) / 1000;
/** v4-52 §1-① — 어깨 걸림 문턱(정점 개수 · 좌우 합). 유도는 머리주석 참고. */
const SHOULDER_MIN = 172;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

type Rec = { status: string; f?: number; sec?: number; sha?: string; gate?: string; reason?: string;
             shoulderAbove?: number; [k: string]: unknown };
const idx = JSON.parse(readFileSync(`${ASSET}/index-merged-108.json`, 'utf8')) as Record<string, Rec>;

const shoulderOf = (cell: string): { above: number; n: number; yTop: number } | null => {
  const bodyId = cell.replace(/_[^_]+$/, '');
  const size = cell.slice(bodyId.length + 1) as Size;
  const bp = `${ASSET}/body-${bodyId}.bin`, sp = `${ASSET}/settled-${cell}.bin`;
  if (!existsSync(bp) || !existsSync(sp)) return null;
  const bb = readFileSync(bp);
  const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(size),
                      bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
                      minPairDistLite });
  const yTop = (P.S as unknown as { Y_TOP: number }).Y_TOP;
  const raw = readFileSync(sp);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  const n = (JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl))) as { n: number }).n;
  const pos = new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + n * 24));
  let above = 0;
  for (let i = 1; i < pos.length; i += 3) if (pos[i] > yTop) above++;
  return { above, n, yTop };
};

const 강등: { cell: string; above: number }[] = [];
for (const [cell, r] of Object.entries(idx)) {
  if (r.status !== '편입') continue;                       // 보류·착용불가는 손대지 않는다
  const s = shoulderOf(cell);
  if (!s) continue;
  r.shoulderAbove = s.above;                               // 값은 **모든 편입 후보**에 기록한다(사실 병기)
  if (s.above < SHOULDER_MIN) {
    r.status = '보류';
    r.reason = `어깨 걸림 미달 — 어깨선 위 옷 정점 ${s.above}개 < ${SHOULDER_MIN}(v4-52 §1-① · v4-30 계기 정의)`;
    delete r.sha;                                          // 보류 칸에는 sha 를 두지 않는다(T포즈 규약 동형)
    강등.push({ cell, above: s.above });
  }
}
const provide = Object.entries(idx).filter(([, r]) => r.status === '편입').map(([c]) => c).sort();
writeFileSync(`${ASSET}/index-merged-108.json`, JSON.stringify(idx, null, 1));
writeFileSync(`${ASSET}/v1-provide.json`, JSON.stringify({
  메타: `v4-52 §1-② A포즈 제공 목록 — 편입 = 게이트 pass **그리고** 어깨선 위 옷 정점 ≥ ${SHOULDER_MIN}`
    + '(어깨 걸림 채널 · v4-30 계기 정의 · 좌우 합) · 게이트 5채널·문턱 불변 · 몸 = 그리드 정본(커밋 80944b2)',
  provide }, null, 1));
const cnt = Object.values(idx).reduce((a: Record<string, number>, r) => (a[r.status] = (a[r.status] ?? 0) + 1, a), {});
console.log(JSON.stringify({ N: SHOULDER_MIN, 제공: provide.length, 집계: cnt, 강등 }, null, 0));
