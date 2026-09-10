/* v3-43 §1 — 명명 «전방 폐색» 확인. **물리 0프레임 · blob 무변조 · raster.ts 무변경.**
 *
 * 확인 1  M 최대 성분 픽셀에서 z 시험을 이긴 «몸 삼각형»의 부위를 좌표로 특정한다.
 * 확인 2  근측 팔의 «소매 밖 원위» 정점을 **표시 사본에서만** 숨기고 M 을 다시 잰다.
 *
 * M 정의·픽셀 분류는 v3-42 계기(`scripts/v3Artifact.ts`)의 것을 그대로 쓴다.
 * 그 스크립트는 실행형이라 임포트가 안 되므로 필요한 최소분만 옮겨 적었다 —
 * **정의를 바꾸지 않았다**(같은 기저색 역산 · 같은 실루엣 마스크 · 같은 4-연결 성분).
 *
 * 진입: `IN=<blob> FAB=<원단> D_MM=<d> npx tsx scripts/v3Naming.ts`
 */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { render, VIEWS, type View } from '../src/v3/raster.ts';

const IN = process.env.IN!, FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

const P = prepare({ glb: ab('public/models/mannequin.glb'), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(IN) });
const clothPos = Float32Array.from(P.sc.s.pos);
const clothIdx = Uint32Array.from(P.sc.tris);
const bodyPos = Float32Array.from(P.prim0.pos);
const bodyIdx = P.bodyIdx;
const BODY_COL: [number, number, number] = [190, 185, 178];
const CLOTH_COL: [number, number, number] = [40, 90, 200];
const W = 300, H = 420;

const bounds = (() => {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const A of [bodyPos, clothPos]) for (let i = 0; i < A.length; i += 3)
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], A[i + c]); hi[c] = Math.max(hi[c], A[i + c]); }
  return { lo, hi };
})();

/* v3-42 §1 의 분류 — 기저색 최소제곱 역산. 임계값을 손으로 고르지 않는다. */
function classify(r: number, g: number, b: number): 'bg' | 'body' | 'cloth' {
  if (r === 255 && g === 255 && b === 255) return 'bg';
  const res = (C: number[]) => {
    const s = (r * C[0] + g * C[1] + b * C[2]) / (C[0] * C[0] + C[1] * C[1] + C[2] * C[2]);
    return (r - C[0] * s) ** 2 + (g - C[1] * s) ** 2 + (b - C[2] * s) ** 2;
  };
  return res(BODY_COL) <= res(CLOTH_COL) ? 'body' : 'cloth';
}

function maskOf(view: View, cloth: Float32Array, body: Float32Array, bidx: Uint32Array) {
  const full = render([{ pos: body, idx: bidx, color: BODY_COL },
                       { pos: cloth, idx: clothIdx, color: CLOTH_COL }], view, bounds, W, H);
  const only = render([{ pos: cloth, idx: clothIdx, color: CLOTH_COL }], view, bounds, W, H);
  const mask = new Uint8Array(W * H);
  let M = 0, sil = 0;
  for (let i = 0; i < W * H; i++) {
    if (classify(only[i * 3], only[i * 3 + 1], only[i * 3 + 2]) !== 'cloth') continue;
    sil++;
    if (classify(full[i * 3], full[i * 3 + 1], full[i * 3 + 2]) === 'body') { M++; mask[i] = 1; }
  }
  return { M, sil, mask };
}

/** 4-연결 최대 성분만 남긴 마스크 */
function largest(mask: Uint8Array) {
  const seen = new Uint8Array(W * H); let best: number[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || seen[i0]) continue;
    const st = [i0], cur: number[] = []; seen[i0] = 1;
    while (st.length) {
      const i = st.pop()!; cur.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; st.push(j); }
    }
    if (cur.length > best.length) best = cur;
  }
  return best;
}

/** 픽셀별 «z 시험을 이긴 몸 삼각형» — raster.ts 의 투영·z 식 그대로(색만 안 쓴다) */
function pickBody(view: View, body: Float32Array, bidx: Uint32Array, cloth: Float32Array) {
  const d = view.dir, up = [0, 1, 0];
  const ux = up[1] * d[2] - up[2] * d[1], uy = up[2] * d[0] - up[0] * d[2], uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const U = [ux / ul, uy / ul, uz / ul];
  const proj = (x: number, y: number, z: number) => [x * U[0] + y * U[1] + z * U[2], y, -(x * d[0] + y * d[1] + z * d[2])];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = proj(k & 1 ? bounds.hi[0] : bounds.lo[0], k & 2 ? bounds.hi[1] : bounds.lo[1], k & 4 ? bounds.hi[2] : bounds.lo[2]);
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }
  const s = Math.max((u1 - u0) / W, (v1 - v0) / H), cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const toPx = (p: number[]) => [W / 2 + (p[0] - cu) / s, H / 2 - (p[1] - cv) / s, p[2]];
  const zb = new Float64Array(W * H).fill(-Infinity);
  const pick = new Int32Array(W * H).fill(-1);   // ≥0 = 몸 삼각형 t · −2 = 옷
  const draw = (pos: Float32Array, idx: Uint32Array, tag: (t: number) => number) => {
    for (let t = 0; t < idx.length; t += 3) {
      const o = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const A = o.map((k) => toPx(proj(pos[k], pos[k + 1], pos[k + 2])));
      const den = (A[1][1] - A[2][1]) * (A[0][0] - A[2][0]) + (A[2][0] - A[1][0]) * (A[0][1] - A[2][1]);
      if (Math.abs(den) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0][0], A[1][0], A[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(A[0][0], A[1][0], A[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[0][1], A[1][1], A[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(A[0][1], A[1][1], A[2][1])));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const fx = px + 0.5, fy = py + 0.5;
        const l0 = ((A[1][1] - A[2][1]) * (fx - A[2][0]) + (A[2][0] - A[1][0]) * (fy - A[2][1])) / den;
        const l1 = ((A[2][1] - A[0][1]) * (fx - A[2][0]) + (A[0][0] - A[2][0]) * (fy - A[2][1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * A[0][2] + l1 * A[1][2] + l2 * A[2][2], i = py * W + px;
        if (z <= zb[i]) continue;
        zb[i] = z; pick[i] = tag(t);
      }
    }
  };
  draw(body, bidx, (t) => t);
  draw(cloth, clothIdx, () => -2);
  return pick;
}

const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
const fmt = (a: number[]) => a.length
  ? `최소 ${(q(a, 0) * 100).toFixed(1)} · p25 ${(q(a, .25) * 100).toFixed(1)} · 중앙 ${(q(a, .5) * 100).toFixed(1)} · p75 ${(q(a, .75) * 100).toFixed(1)} · 최대 ${(q(a, 1) * 100).toFixed(1)}` : '—';

console.log(`[NAMING:${FAB}-d${process.env.D_MM}] 상태 ${IN} · 정점 ${P.sc.n} · 물리 0프레임`);
{
  const bb = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (let i = 0; i < bodyPos.length; i += 3) {
    bb.x[0] = Math.min(bb.x[0], bodyPos[i]); bb.x[1] = Math.max(bb.x[1], bodyPos[i]);
    bb.y[0] = Math.min(bb.y[0], bodyPos[i + 1]); bb.y[1] = Math.max(bb.y[1], bodyPos[i + 1]);
    bb.z[0] = Math.min(bb.z[0], bodyPos[i + 2]); bb.z[1] = Math.max(bb.z[1], bodyPos[i + 2]);
  }
  console.log(`  몸 bbox[cm]  x ${(bb.x[0] * 100).toFixed(1)}~${(bb.x[1] * 100).toFixed(1)} · y ${(bb.y[0] * 100).toFixed(1)}~${(bb.y[1] * 100).toFixed(1)} · z ${(bb.z[0] * 100).toFixed(1)}~${(bb.z[1] * 100).toFixed(1)}`);
}
/* 소매 끝단 — 옷 메시의 |x| 최대(팔 축이 x 라는 것을 bbox 로 확인한 뒤 쓴다) */
let sleeveXp = -Infinity, sleeveXm = Infinity;
for (let i = 0; i < clothPos.length; i += 3) { sleeveXp = Math.max(sleeveXp, clothPos[i]); sleeveXm = Math.min(sleeveXm, clothPos[i]); }
console.log(`  소매 끝단 x  +${(sleeveXp * 100).toFixed(2)}cm / ${(sleeveXm * 100).toFixed(2)}cm  (옷 메시 x 최대·최소)`);

const sideView = VIEWS.find((v) => v.name === 'sideXplus')!;
const backView = VIEWS.find((v) => v.name === 'back')!;

/* ── 확인 1 ─────────────────────────────────────────────────────────────── */
for (const [nm, view] of [['sideXplus', sideView], ['back', backView]] as const) {
  const { M, mask } = maskOf(view, clothPos, bodyPos, bodyIdx);
  const comp = largest(mask);
  const pick = pickBody(view, bodyPos, bodyIdx, clothPos);
  const cx: number[] = [], cy: number[] = [], cz: number[] = [];
  const tris = new Set<number>();
  for (const i of comp) {
    const t = pick[i];
    if (t < 0) continue;
    tris.add(t);
    const o = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3];
    cx.push((bodyPos[o[0]] + bodyPos[o[1]] + bodyPos[o[2]]) / 3);
    cy.push((bodyPos[o[0] + 1] + bodyPos[o[1] + 1] + bodyPos[o[2] + 1]) / 3);
    cz.push((bodyPos[o[0] + 2] + bodyPos[o[1] + 2] + bodyPos[o[2] + 2]) / 3);
  }
  cx.sort((a, b) => a - b); cy.sort((a, b) => a - b); cz.sort((a, b) => a - b);
  const distal = cx.filter((v) => v > sleeveXp).length;
  console.log(`  ── 확인1 ${nm}: M ${M} · 최대 성분 ${comp.length}px · 이긴 몸 삼각형 ${tris.size}개 ──`);
  console.log(`     x[cm] ${fmt(cx)}`);
  console.log(`     y[cm] ${fmt(cy)}`);
  console.log(`     z[cm] ${fmt(cz)}`);
  console.log(`     x > 소매 끝단(+${(sleeveXp * 100).toFixed(2)}cm) 인 픽셀 ${distal}/${cx.length} = ${((distal / Math.max(1, cx.length)) * 100).toFixed(1)}%`);
}

/* ── 확인 2 — 근측 팔의 «소매 밖 원위» 삼각형을 표시 사본에서만 숨긴다 ────── */
{
  const keep: number[] = [];
  let hid = 0;
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const o = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3];
    const allDistal = o.every((k) => bodyPos[k] > sleeveXp);
    if (allDistal) { hid++; continue; }
    keep.push(bodyIdx[t], bodyIdx[t + 1], bodyIdx[t + 2]);
  }
  const bidx2 = Uint32Array.from(keep);
  const before = maskOf(sideView, clothPos, bodyPos, bodyIdx);
  const after = maskOf(sideView, clothPos, bodyPos, bidx2);
  console.log(`  ── 확인2 sideXplus: 근측(+x) 소매 밖 원위 삼각형 ${hid}개 숨김(표시 사본만) ──`);
  console.log(`     M ${before.M} → ${after.M}   잔존 ${((after.M / before.M) * 100).toFixed(1)}%  (v3-42 등재 점묘분 19~29%)`);
  console.log(`     실루엣 ${before.sil} → ${after.sil} (옷 무변경이므로 같아야 한다)`);
  /* 잔여의 정체 — 추측하지 않고 «잰다». 숨김 기준이 「3정점 «모두» 원위」라
   * 소매 끝단에 걸친 경계 삼각형은 남는다. 민감도로 그 몫을 분리한다.
   * **판정은 위의 등재 기준(모두-원위)으로 내린다** — 이 줄은 사실 보고다. */
  const comp2 = largest(after.mask);
  const pick2 = pickBody(sideView, bodyPos, bidx2, clothPos);
  const rx: number[] = [];
  for (const i of comp2) {
    const t = pick2[i];
    if (t < 0) continue;
    const o = [bidx2[t] * 3, bidx2[t + 1] * 3, bidx2[t + 2] * 3];
    rx.push((bodyPos[o[0]] + bodyPos[o[1]] + bodyPos[o[2]]) / 3);
  }
  rx.sort((a, b) => a - b);
  console.log(`     잔여 최대 성분 ${comp2.length}px · 그 몸 삼각형 x[cm] ${fmt(rx)}`);
  const keepAny: number[] = [];
  let hidAny = 0;
  for (let t = 0; t < bodyIdx.length; t += 3) {
    const o = [bodyIdx[t] * 3, bodyIdx[t + 1] * 3, bodyIdx[t + 2] * 3];
    if (o.some((k) => bodyPos[k] > sleeveXp)) { hidAny++; continue; }
    keepAny.push(bodyIdx[t], bodyIdx[t + 1], bodyIdx[t + 2]);
  }
  const anyM = maskOf(sideView, clothPos, bodyPos, Uint32Array.from(keepAny));
  console.log(`     민감도(「어느 한 정점이라도 원위」 = ${hidAny}개 숨김): M ${before.M} → ${anyM.M}  잔존 ${((anyM.M / before.M) * 100).toFixed(1)}%`);
}
