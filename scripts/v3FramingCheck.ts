/* v3-80 §3-3 — **프레이밍 실측**. three.js «투영»으로 픽셀 높이를 산출한다(캡처 눈대중 아님).
 * 카메라 파라미터·거리 식은 `productView.ts` 의 **정본을 그대로 임포트**해 쓴다 — 식을 베끼지 않는다. */
import { readFileSync, readdirSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { FRAMING, REF_BODY_HEIGHT_M, cameraDistanceM } from '../src/v3/framing.ts';
/** 뷰 방위는 `productView.PRODUCT_VIEWS` 와 «같은 값»이다(DOM 임포트를 피하려 여기 전사 · 값 동일). */
const PRODUCT_VIEWS = [{ name: 'front-p', dir: [0, 0, -1] },
  { name: 'side-p', dir: [-1, 0, 0] }, { name: 'back-p', dir: [0, 0, 1] }] as const;

const D = 'public/v3diag/v3-77';
const load = (id: string) => {
  const b = readFileSync(`${D}/body-${id}.bin`);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const bbox = (v: Float32Array) => {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
    if (v[i + k] < mn[k]) mn[k] = v[i + k]; if (v[i + k] > mx[k]) mx[k] = v[i + k];
  }
  return { mn, mx };
};

/** `productView.render` 와 «같은» 카메라를 세우고 정수리·발끝을 투영한다. */
function projectedPx(id: string, cssW: number, cssH: number, viewIx = 0) {
  const v = load(id); const { mn, mx } = bbox(v);
  const mid = new Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
  const view = PRODUCT_VIEWS[viewIx];
  const cam = new PerspectiveCamera(FRAMING.fovDeg, cssW / cssH, 0.01, 100);
  const dist = cameraDistanceM();
  cam.position.set(mid.x - view.dir[0] * dist, mid.y - view.dir[1] * dist, mid.z - view.dir[2] * dist);
  cam.lookAt(mid); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const toPx = (p: Vector3) => { const q = p.clone().project(cam); return { x: (q.x + 1) / 2 * cssW, y: (1 - q.y) / 2 * cssH }; };
  const top = toPx(new Vector3(mid.x, mx[1], mid.z));
  const bot = toPx(new Vector3(mid.x, mn[1], mid.z));
  const lft = toPx(new Vector3(mn[0], mid.y, mid.z));
  const rgt = toPx(new Vector3(mx[0], mid.y, mid.z));
  return { h: Math.abs(bot.y - top.y), w: Math.abs(rgt.x - lft.x), mesh: mx[1] - mn[1], span: mx[0] - mn[0], dist };
}

/* v3-81 §1-① — **정본 3종 화면(`?canon=1`) 잘림 검사**. 그 화면의 몸은 «주입 0»이라
 * `parseGlb` 가 낸 원본 메시 그대로다(`dressRun.prepare` 의 `bodyVerts` 미전달 경로). */
if (process.env.MODE === 'canon') {
  const { parseGlb } = await import('../src/v3/glb.ts');
  const glb = readFileSync('public/models/mannequin.glb');
  const pos = parseGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer).prims[0].pos;
  const v = Float32Array.from(pos);
  const { mn, mx } = bbox(v);
  const W2 = Number(process.env.CW ?? 840), H2 = Number(process.env.CH ?? 672);
  console.log(`── 정본 3종 화면 잘림 검사 (캔버스 ${W2}×${H2}) ──`);
  console.log(`  몸 bbox — 높이 ${(mx[1] - mn[1]).toFixed(4)}m · 가로 ${(mx[0] - mn[0]).toFixed(4)}m · 깊이 ${(mx[2] - mn[2]).toFixed(4)}m`);
  const mid = new Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
  let bad2 = 0;
  for (const view of PRODUCT_VIEWS) {
    const cam = new PerspectiveCamera(FRAMING.fovDeg, W2 / H2, 0.01, 100);
    const dist = cameraDistanceM();
    cam.position.set(mid.x - view.dir[0] * dist, mid.y - view.dir[1] * dist, mid.z - view.dir[2] * dist);
    cam.lookAt(mid); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
    for (let i = 0; i < v.length; i += 3) {
      const q = new Vector3(v[i], v[i + 1], v[i + 2]).project(cam);
      const px = (q.x + 1) / 2 * W2, py = (1 - q.y) / 2 * H2;
      if (px < xmin) xmin = px; if (px > xmax) xmax = px;
      if (py < ymin) ymin = py; if (py > ymax) ymax = py;
    }
    const cut = xmin < 0 || xmax > W2 || ymin < 0 || ymax > H2;
    if (cut) bad2++;
    console.log(`  ${view.name.padEnd(7)} x ${xmin.toFixed(1)}~${xmax.toFixed(1)} (0~${W2}) · y ${ymin.toFixed(1)}~${ymax.toFixed(1)} (0~${H2})  ${cut ? '잘림 ❌' : '잘림 없음 ✅'}`);
  }
  console.log(`\n[v3-81 §1-①] 잘린 뷰 ${bad2}/3`);
  process.exit(bad2 === 0 ? 0 : 1);
}

const W = Number(process.env.CW ?? 840), H = Number(process.env.CH ?? 672);
console.log(`── 프레이밍 실측 (캔버스 ${W}×${H} · 뷰 ${PRODUCT_VIEWS[0].name}) ──`);
const ids = readdirSync(D).filter((f) => f.startsWith('body-')).map((f) => f.slice(5, -4)).sort();
const R = Object.fromEntries(ids.map((id) => [id, projectedPx(id, W, H)]));
console.log(`  거리 ${R[ids[0]].dist.toFixed(4)}m (몸 무관 · 기준 키 ${REF_BODY_HEIGHT_M}m)`);

/* ㉠ 같은 키 두 몸 */
const a = R['c100-h170-s45'], b = R['c122.5-h170-s50'];
const d1 = Math.abs(a.h - b.h) / ((a.h + b.h) / 2) * 100;
console.log(`\n㉠ 같은 키(170) — c100-h170-s45 ${a.h.toFixed(2)}px ↔ c122.5-h170-s50 ${b.h.toFixed(2)}px`);
console.log(`   상대차 ${d1.toFixed(3)}%  (기대 ≤ 1%)  ${d1 <= 1 ? '✅' : '❌'}`);
console.log(`   ※ 실제 몸 높이 ${a.mesh.toFixed(4)} ↔ ${b.mesh.toFixed(4)}m (0.11% 차 · §3-3 등재)`);

/* ㉡ 키 다른 몸 — 대조쌍은 §3-3 등재분 */
const c = R['c100-h155-s45'], e = R['c100-h170-s45'];
const ratio = c.h / e.h, want = 155 / 170, d2 = Math.abs(ratio - want) / want * 100;
console.log(`\n㉡ 키 대조 — c100-h155-s45 ${c.h.toFixed(2)}px / c100-h170-s45 ${e.h.toFixed(2)}px = ${ratio.toFixed(5)}`);
console.log(`   기대 155/170 = ${want.toFixed(5)} · 편차 ${d2.toFixed(3)}%  (기대 ≤ 1%)  ${d2 <= 1 ? '✅' : '❌'}`);

/* 잘림 — 세로·가로 */
const overH = ids.filter((id) => R[id].h > H), overW = ids.filter((id) => R[id].w > W);
console.log(`\n잘림 — 세로 초과 ${overH.length}/27 · 가로 초과 ${overW.length}/27`);
const wide = ids.reduce((p, id) => (R[id].w > R[p].w ? id : p), ids[0]);
console.log(`  최대 가로 ${R[wide].w.toFixed(1)}px (${wide} · 팔 스팬 ${R[wide].span.toFixed(4)}m) · 캔버스 ${W}px`);
console.log(`  최대 세로 ${Math.max(...ids.map((i) => R[i].h)).toFixed(1)}px · 캔버스 ${H}px`);

const pass = d1 <= 1 && d2 <= 1 && overH.length === 0 && overW.length === 0;
console.log(`\n[v3-80 §3-3] ${pass ? '통과' : '불통과'}`);
process.exit(pass ? 0 : 1);
