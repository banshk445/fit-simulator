/* v3-52 §2 — **몸 높이 도출 계기**. 기계·규칙은 `src/v3/bodyLevels.ts` 하나에 있고
 * 이 파일은 «인쇄»만 한다(브라우저 워커와 «같은 규칙»을 쓰게 하기 위함 — 함정 22 계열 예방).
 * v3-51 판본은 옛 규칙(내부 최대)이었고 v3-52 §1 이 정의를 교체했다 — **기계 그대로 · 규칙 절만 교체.**
 * v2 임포트 0 · v2 데이터 읽기 0 · `V2DIMS` 미사용(G1). **물리 0프레임.**
 * 진입: `npx tsx scripts/v3BodyLevels.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS, TOL_SELF } from '../src/v3/consts.ts';
import { deriveLevels, GRID_M } from '../src/v3/bodyLevels.ts';

const b = readFileSync('public/models/mannequin.glb');
const P = prepare({ glb: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer,
  fabric: FABRICS.gray, d: 0.009, garment: DEFAULT_GARMENT, minPairDistLite });
const { Y_TOP, Y_NECK, AXIS_Z } = P.S;
const cm = (v: number) => (v * 100).toFixed(3);
console.log(`[v3BodyLevels] 몸 정점 ${P.prim0.pos.length / 3} · 삼각형 ${P.bodyIdx.length / 3} · 축 z ${cm(AXIS_Z)}cm`);
console.log(`  등재량: Y_TOP ${cm(Y_TOP)} · Y_NECK ${cm(Y_NECK)}cm · TOL_SELF ${(TOL_SELF * 1000).toFixed(1)}mm · 격자 ${(GRID_M * 100).toFixed(1)}cm(진단 전용)`);
const L = deriveLevels(P.prim0.pos, P.bodyIdx, AXIS_Z, Y_TOP);
console.log(`  **Y_LOW**(가랑이 · 성분 1→2)   **${cm(L.Y_LOW)}cm**`);
console.log(`  **Y_ARM**(팔 첫 출현 · 성분 1→>1) **${cm(L.Y_ARM)}cm**`);
console.log(`  **chestY**(= Y_ARM 직하 순수 몸통 상단 · 규격 「겨드랑이 밑」) **${cm(L.chestY)}cm** · C **${cm(L.C_chest)}cm**`);
console.log(`  **waistY**(= (Y_LOW, chestY) 내 C 내부 최소)              **${cm(L.waistY)}cm** · C **${cm(L.C_waist)}cm**`);
console.log(`  §1-3 한계 확인 — Y_ARM 에서 «새로 생긴» 성분 ${L.armFirst.length}개의 |x| 대역:`);
for (const a of L.armFirst) console.log(`     선분 ${String(a.n).padStart(4)} · |x| ${cm(a.xMin)}~${cm(a.xMax)}cm`);
const ord = Y_NECK > L.chestY && L.chestY > L.waistY && L.waistY > L.Y_LOW;
console.log(`  순서 정합 Y_NECK ${cm(Y_NECK)} > chestY ${cm(L.chestY)} > waistY ${cm(L.waistY)} > Y_LOW ${cm(L.Y_LOW)} ⟹ ${ord ? '**성립**' : '**불성립 — 갈래 B**'}`);
console.log(`  물리 정합 C(chestY) > C(waistY) : ${cm(L.C_chest)} > ${cm(L.C_waist)} ⟹ ${L.C_chest > L.C_waist ? '**성립**' : '**불성립 — 갈래 B**'}`);
console.log(`  허리 격자 색인 ${L.waistGridIx}/${L.grid.length - 1}(끝이 아니어야 한다)`);
console.log(`  서명(결정성) ${[L.Y_LOW, L.Y_ARM, L.chestY, L.waistY, L.C_chest, L.C_waist].map((v) => v.toFixed(9)).join('/')}`);
