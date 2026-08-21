/* v3-42 — 측면 반점 «귀속» 계기. **수정 0 · 물리 0프레임 · raster.ts 무변경.**
 *
 * M = sideXplus 렌더에서 «옷 실루엣 내부»에 찍힌 «몸색» 픽셀 수(v3-42 §0-5 정의).
 *   옷 실루엣 = 옷만 단독 래스터한 커버리지 마스크 ⟹ 개구부(소맷부리·밑단·목선)로
 *   «정당하게» 보이는 몸은 실루엣 밖이므로 M 에서 빠진다.
 * **M 은 계기값이고 화면 판정이 아니다.**
 *
 * 브라우저 캡처와 «같은 입력»을 만든다: 워커가 보내는 것과 같은 Float32 사본 ·
 * V3Panel 과 같은 bounds · 같은 300×420 · 같은 raster.ts.
 *
 * 진입: `IN=<blob> FAB=<원단> D_MM=<d> [BASE=<v3-41 png>] npx tsx scripts/v3Artifact.ts`
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite, makeBodyDistance } from '../src/v3/instruments.ts';
import { sampleSdf } from '../src/v3/bodySdf.ts';
import { FABRICS, THICK } from '../src/v3/consts.ts';
import { render, VIEWS, type View } from '../src/v3/raster.ts';
import { writePng } from './v3Render.ts';

const IN = process.env.IN!, FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const TAG = process.env.TAG ?? `${FAB}-d${process.env.D_MM ?? 9}`;
const OUT = process.env.OUT ?? `/tmp/v3-42/${TAG}`;
const BASE = process.env.BASE ?? '';

const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/* ── 상태 주입 — prepare 의 등재 경로(injectState) 그대로. 물리 0프레임 ── */
const P = prepare({ glb: ab('public/models/mannequin.glb'), fabric: FABRICS[FAB], d: D,
  garment: DEFAULT_GARMENT, minPairDistLite, injectState: ab(IN) });

/* 워커가 `done` 에 싣는 것과 «같은» 사본이다(v3DressWorker: Float32Array.from) */
const clothPos = Float32Array.from(P.sc.s.pos);
const clothIdx = Uint32Array.from(P.sc.tris);
const bodyPos = Float32Array.from(P.prim0.pos);
const bodyIdx = P.bodyIdx;
const BODY_COL: [number, number, number] = [190, 185, 178];
const CLOTH_COL: [number, number, number] = [40, 90, 200];

/* V3Panel.draw 와 «같은» bounds 산정 */
const bounds = (() => {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const A of [bodyPos, clothPos]) for (let i = 0; i < A.length; i += 3)
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], A[i + c]); hi[c] = Math.max(hi[c], A[i + c]); }
  return { lo, hi };
})();

/** 픽셀을 «기저색 역산»으로 분류한다 — 임계값을 손으로 고르지 않는다.
 *  배경은 흰색이고 셰이딩은 `sh = 0.35 + 0.65λ` 의 기저색 «곱»이므로,
 *  두 기저색에 각각 최적 배율을 맞춘 뒤 잔차가 작은 쪽이 그 픽셀의 정체다. */
function classify(r: number, g: number, b: number): 'bg' | 'body' | 'cloth' {
  if (r === 255 && g === 255 && b === 255) return 'bg';
  const res = (C: number[]) => {
    const s = (r * C[0] + g * C[1] + b * C[2]) / (C[0] * C[0] + C[1] * C[1] + C[2] * C[2]);
    return (r - C[0] * s) ** 2 + (g - C[1] * s) ** 2 + (b - C[2] * s) ** 2;
  };
  return res(BODY_COL) <= res(CLOTH_COL) ? 'body' : 'cloth';
}

/** 옷 정점을 «표시 직전에» 정점 노멀로 밀어낸 사본(시험 2 · blob 무변조).
 *  천은 양면 시트라 노멀 부호가 정의되지 않는다 ⟹ «몸 바깥» 쪽으로 부호를 맞춘다. */
function offsetCopy(delta: number, bd: ReturnType<typeof makeBodyDistance>): Float32Array {
  const n = clothPos.length / 3;
  const nrm = new Float64Array(n * 3);
  for (let t = 0; t < clothIdx.length; t += 3) {
    const o = [clothIdx[t] * 3, clothIdx[t + 1] * 3, clothIdx[t + 2] * 3];
    const e1 = [clothPos[o[1]] - clothPos[o[0]], clothPos[o[1] + 1] - clothPos[o[0] + 1], clothPos[o[1] + 2] - clothPos[o[0] + 2]];
    const e2 = [clothPos[o[2]] - clothPos[o[0]], clothPos[o[2] + 1] - clothPos[o[0] + 1], clothPos[o[2] + 2] - clothPos[o[0] + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const k of o) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
  }
  const out = Float32Array.from(clothPos);
  for (let v = 0; v < n; v++) {
    let x = nrm[v * 3], y = nrm[v * 3 + 1], z = nrm[v * 3 + 2];
    const L = Math.hypot(x, y, z);
    if (L < 1e-12) continue;
    x /= L; y /= L; z /= L;
    const px = clothPos[v * 3], py = clothPos[v * 3 + 1], pz = clothPos[v * 3 + 2];
    const nb = bd.nearestBodyPoint(px, py, pz);
    const sgn = x * (px - nb[0]) + y * (py - nb[1]) + z * (pz - nb[2]) >= 0 ? 1 : -1;
    out[v * 3] = px + sgn * x * delta; out[v * 3 + 1] = py + sgn * y * delta; out[v * 3 + 2] = pz + sgn * z * delta;
  }
  return out;
}

/** 방위각 회전 뷰 — **등재 3뷰는 무변경**, 이 시험에만 쓰는 «추가» 진단 뷰다 */
const rotY = (v: View, deg: number): View => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { name: `${v.name}${deg >= 0 ? '+' : ''}${deg}`, dir: [c * v.dir[0] + s * v.dir[2], v.dir[1], -s * v.dir[0] + c * v.dir[2]] };
};

/** v3-41 기준 PNG 디코더 — 8비트 RGBA · 무인터레이스(canvas.toBlob 산출물) */
function decodePng(buf: Buffer): { W: number; H: number; rgb: Uint8Array } {
  let o = 8, W = 0, H = 0; const idat: Buffer[] = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o), typ = buf.subarray(o + 4, o + 8).toString('latin1');
    if (typ === 'IHDR') { W = buf.readUInt32BE(o + 8); H = buf.readUInt32BE(o + 12); }
    if (typ === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const data = inflateSync(Buffer.concat(idat));
  const rgb = new Uint8Array(W * H * 3), bpp = 4, stride = W * bpp;
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const f = data[p++];
    for (let i = 0; i < stride; i++) {
      const x = data[p + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
             v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    p += stride;
    for (let x = 0; x < W; x++) {
      rgb[(y * W + x) * 3] = cur[x * 4]; rgb[(y * W + x) * 3 + 1] = cur[x * 4 + 1]; rgb[(y * W + x) * 3 + 2] = cur[x * 4 + 2];
    }
    prev.set(cur);
  }
  return { W, H, rgb };
}

/* ── 시험 ────────────────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true });
const sideView = VIEWS.find((v) => v.name === 'sideXplus')!;
const backView = VIEWS.find((v) => v.name === 'back')!;

function run(label: string, view: View, W: number, H: number, cloth: Float32Array) {
  const full = render([{ pos: bodyPos, idx: bodyIdx, color: BODY_COL },
                       { pos: cloth, idx: clothIdx, color: CLOTH_COL }], view, bounds, W, H);
  const only = render([{ pos: cloth, idx: clothIdx, color: CLOTH_COL }], view, bounds, W, H);
  let M = 0, sil = 0;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (classify(only[i * 3], only[i * 3 + 1], only[i * 3 + 2]) !== 'cloth') continue;
    sil++;
    if (classify(full[i * 3], full[i * 3 + 1], full[i * 3 + 2]) === 'body') { M++; mask[i] = 1; }
  }
  writePng(`${OUT}/${label}.png`, W, H, full);
  const mk = new Uint8Array(W * H * 3).fill(255);
  for (let i = 0; i < W * H; i++) {
    if (classify(only[i * 3], only[i * 3 + 1], only[i * 3 + 2]) === 'cloth') { mk[i * 3] = 205; mk[i * 3 + 1] = 205; mk[i * 3 + 2] = 245; }
    if (mask[i]) { mk[i * 3] = 220; mk[i * 3 + 1] = 0; mk[i * 3 + 2] = 0; }
  }
  writePng(`${OUT}/${label}-mask.png`, W, H, mk);
  const per1k = (M / sil) * 1000;
  const cc = components(mask, W, H);
  /* v3-42 §1 «추가» 보조 분해 — 등재 M 을 바꾸지 않는다.
   * 계기를 처음 돌린 뒤, M 안에 «가까운 팔이 옷을 가린» 큰 덩어리가 섞여 있음이
   * 드러났다(부호 간극 p75 = 33mm · 관통 0%). 덩어리 폐색과 «점묘»는 연결 성분
   * 크기로 갈린다 — 반점은 작은 성분 다수, 폐색은 큰 성분 소수다.
   * SPECK 는 «판정 문턱이 아니라» 분해축이며, 성분 크기 분포를 함께 낸다. */
  const SPECK = 8;
  const spk = cc.areas.filter((a) => a <= SPECK).reduce((x, y) => x + y, 0);
  const big = M - spk;
  /* 성분의 «자리»를 옷 실루엣 세로 범위로 정규화한다 — 0 = 실루엣 최상단(어깨),
   * 1 = 최하단(밑단). 사용자가 지목한 대역은 «어깨~소매 캡» = 상단이다. */
  let sy0 = H, sy1 = -1;
  for (let i = 0; i < W * H; i++)
    if (classify(only[i * 3], only[i * 3 + 1], only[i * 3 + 2]) === 'cloth') {
      const y = (i / W) | 0; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
    }
  const fy = (y: number) => ((y - sy0) / Math.max(1, sy1 - sy0)).toFixed(2);
  const ord = cc.areas.map((_, i) => i).sort((a, b) => cc.areas[b] - cc.areas[a]).slice(0, 3);
  const where = ord.map((i) => `${cc.areas[i]}px@세로${fy(cc.boxes[i][1])}~${fy(cc.boxes[i][3])}`).join(' ');
  /* 상단 1/3(어깨~소매 캡) 안의 M — 사용자가 지목한 대역 */
  const yCut = sy0 + (sy1 - sy0) / 3;
  let mTop = 0;
  for (let y = sy0; y <= Math.floor(yCut); y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) mTop++;
  console.log(`  ${label.padEnd(20)} ${String(W).padStart(4)}×${H}  실루엣 ${String(sil).padStart(7)}  M ${String(M).padStart(6)} (${per1k.toFixed(2)}‰)  성분 ${String(cc.areas.length).padStart(4)}  점묘≤${SPECK}px ${String(spk).padStart(5)}  덩어리 ${String(big).padStart(6)}  상단⅓ ${String(mTop).padStart(5)}`);
  console.log(`  ${' '.repeat(20)}   큰3: ${where}`);
  return { M, sil, per1k, mask, W, H, spk, big, mTop, nc: cc.areas.length,
           spkPer1k: (spk / sil) * 1000, bigPer1k: (big / sil) * 1000, topPer1k: (mTop / sil) * 1000 };
}

/** 4-연결 성분의 면적 목록 — 반복 스택(재귀 없음) */
function components(mask: Uint8Array, W: number, H: number) {
  const seen = new Uint8Array(W * H), areas: number[] = [], boxes: number[][] = [], st: number[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || seen[i0]) continue;
    let a = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    st.push(i0); seen[i0] = 1;
    while (st.length) {
      const i = st.pop()!; a++;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st.push(i - 1); }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st.push(i + 1); }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; st.push(i - W); }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; st.push(i + W); }
    }
    areas.push(a);
    boxes.push([x0, y0, x1, y1]);
  }
  return { areas, boxes };
}

console.log(`[ARTIFACT:${TAG}] 상태 ${IN} · 정점 ${P.sc.n} · d ${(D * 1000).toFixed(0)}mm · 물리 0프레임`);
const bd = makeBodyDistance({ pos: P.prim0.pos, idx: bodyIdx, bodyG: P.bodyG, h: P.sdfSpec.h, thick: THICK });
const off = offsetCopy(THICK / 2, bd);

const base = run('t0-base-side', sideView, 300, 420, clothPos);
const t1 = run('t1-4x-side', sideView, 1200, 1680, clothPos);
const t2a = run('t2-off-side', sideView, 300, 420, off);
const t2b = run('t2-off-4x-side', sideView, 1200, 1680, off);
const t3p = run('t3-side+15', rotY(sideView, 15), 300, 420, clothPos);
const t3m = run('t3-side-15', rotY(sideView, -15), 300, 420, clothPos);
const bk = run('t0-base-back', backView, 300, 420, clothPos);
const bk4 = run('t1-4x-back', backView, 1200, 1680, clothPos);

const r = (a: number, b: number) => (b === 0 ? 'n/a' : (a / b).toFixed(3));
console.log(`  ── 비율(‰ 기준 · 해상도 스케일 보정됨) ──`);
console.log(`  시험1 4배        M ${r(t1.per1k, base.per1k)}   점묘 ${r(t1.spkPer1k, base.spkPer1k)}   덩어리 ${r(t1.bigPer1k, base.bigPer1k)}`);
console.log(`  시험2 오프셋      M ${r(t2a.per1k, base.per1k)}   점묘 ${r(t2a.spkPer1k, base.spkPer1k)}   덩어리 ${r(t2a.bigPer1k, base.bigPer1k)}`);
console.log(`  시험2 오프셋(4배) M ${r(t2b.per1k, t1.per1k)}   점묘 ${r(t2b.spkPer1k, t1.spkPer1k)}   덩어리 ${r(t2b.bigPer1k, t1.bigPer1k)}`);
console.log(`  시험3 +15° / −15° M ${r(t3p.per1k, base.per1k)} / ${r(t3m.per1k, base.per1k)}   점묘 ${r(t3p.spkPer1k, base.spkPer1k)} / ${r(t3m.spkPer1k, base.spkPer1k)}`);
console.log(`  상단⅓(어깨~소매캡) 기준 M ${base.mTop} (${base.topPer1k.toFixed(2)}‰) → 4배 ${t1.mTop} (${t1.topPer1k.toFixed(2)}‰ · 비 ${r(t1.topPer1k, base.topPer1k)}) → 오프셋 ${t2a.mTop} (비 ${r(t2a.topPer1k, base.topPer1k)})`);
console.log(`  back 대조         기준 ${bk.per1k.toFixed(2)}‰ (M ${bk.M}) · 4배 ${bk4.per1k.toFixed(2)}‰ (M ${bk4.M})`);

/* ── (부) 구김 «각짐» 분리 — §0-6 「판정 아님 · 다음 판 입력용 기록」 ────────────
 * back 뷰 4배에서 «평면 셰이딩» ↔ «정점 노멀 보간(Gouraud)» 두 벌을 낸다.
 * raster.ts 는 평면 셰이딩 고정이고 **한 줄도 고치지 않는다** ⟹ 보간 벌은
 * 여기 «진단 전용» 래스터로 낸다(투영·z버퍼는 raster.ts 의 그 식 그대로).
 * 채널: 인접 옷 픽셀 밝기의 평균 |Δ| — 패싯 경계의 «계단»이 각짐의 크기다. */
function shadeRaster(meshes: { pos: Float32Array; idx: Uint32Array; color: [number, number, number] }[],
                     view: View, W: number, H: number, smooth: boolean): Uint8Array {
  const d = view.dir, up: [number, number, number] = [0, 1, 0];
  const ux = up[1] * d[2] - up[2] * d[1], uy = up[2] * d[0] - up[0] * d[2], uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const U: [number, number, number] = [ux / ul, uy / ul, uz / ul];
  const proj = (x: number, y: number, z: number) => [x * U[0] + y * U[1] + z * U[2], y, -(x * d[0] + y * d[1] + z * d[2])];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = proj(k & 1 ? bounds.hi[0] : bounds.lo[0], k & 2 ? bounds.hi[1] : bounds.lo[1], k & 4 ? bounds.hi[2] : bounds.lo[2]);
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }
  const s = Math.max((u1 - u0) / W, (v1 - v0) / H), cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const toPx = (p: number[]) => [W / 2 + (p[0] - cu) / s, H / 2 - (p[1] - cv) / s, p[2]];
  const rgb = new Uint8Array(W * H * 3).fill(255);
  const zb = new Float64Array(W * H).fill(-Infinity);
  for (const m of meshes) {
    /* 정점 노멀 — 면적 가중 누적(보간 벌에서만 쓴다) */
    const vn = new Float64Array(m.pos.length);
    if (smooth) for (let t = 0; t < m.idx.length; t += 3) {
      const o = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3];
      const e1 = [m.pos[o[1]] - m.pos[o[0]], m.pos[o[1] + 1] - m.pos[o[0] + 1], m.pos[o[1] + 2] - m.pos[o[0] + 2]];
      const e2 = [m.pos[o[2]] - m.pos[o[0]], m.pos[o[2] + 1] - m.pos[o[0] + 1], m.pos[o[2] + 2] - m.pos[o[0] + 2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      /* 양면 시트라 와인딩이 일정하지 않다 ⟹ 첫 삼각형 부호에 맞춰 누적 */
      const ref = vn[o[0]] * nx + vn[o[0] + 1] * ny + vn[o[0] + 2] * nz;
      if (ref < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const k of o) { vn[k] += nx; vn[k + 1] += ny; vn[k + 2] += nz; }
    }
    for (let t = 0; t < m.idx.length; t += 3) {
      const o = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3];
      const P = o.map((k) => toPx(proj(m.pos[k], m.pos[k + 1], m.pos[k + 2])));
      const e1 = [m.pos[o[1]] - m.pos[o[0]], m.pos[o[1] + 1] - m.pos[o[0] + 1], m.pos[o[1] + 2] - m.pos[o[0] + 2]];
      const e2 = [m.pos[o[2]] - m.pos[o[0]], m.pos[o[2] + 1] - m.pos[o[0] + 1], m.pos[o[2] + 2] - m.pos[o[0] + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const lamOf = (n: number[]) => {
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        return Math.abs((n[0] * -d[0] + n[1] * -d[1] + n[2] * -d[2]) / nl);
      };
      const lamF = lamOf(fn);
      const lamV = smooth ? o.map((k) => lamOf([vn[k], vn[k + 1], vn[k + 2]])) : [lamF, lamF, lamF];
      const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
      if (Math.abs(den) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const fx = px + 0.5, fy = py + 0.5;
        const l0 = ((P[1][1] - P[2][1]) * (fx - P[2][0]) + (P[2][0] - P[1][0]) * (fy - P[2][1])) / den;
        const l1 = ((P[2][1] - P[0][1]) * (fx - P[2][0]) + (P[0][0] - P[2][0]) * (fy - P[2][1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * P[0][2] + l1 * P[1][2] + l2 * P[2][2], i = py * W + px;
        if (z <= zb[i]) continue;
        zb[i] = z;
        const sh = 0.35 + 0.65 * (l0 * lamV[0] + l1 * lamV[1] + l2 * lamV[2]);
        rgb[i * 3] = m.color[0] * sh; rgb[i * 3 + 1] = m.color[1] * sh; rgb[i * 3 + 2] = m.color[2] * sh;
      }
    }
  }
  return rgb;
}

{
  const W = 1200, H = 1680;
  const meshes = [{ pos: bodyPos, idx: bodyIdx, color: BODY_COL },
                  { pos: clothPos, idx: clothIdx, color: CLOTH_COL }] as const;
  const step = (rgb: Uint8Array) => {
    let sum = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
      const i = (y * W + x) * 3, j = i + 3;
      if (classify(rgb[i], rgb[i + 1], rgb[i + 2]) !== 'cloth') continue;
      if (classify(rgb[j], rgb[j + 1], rgb[j + 2]) !== 'cloth') continue;
      sum += Math.abs((rgb[i] + rgb[i + 1] + rgb[i + 2]) - (rgb[j] + rgb[j + 1] + rgb[j + 2])) / 3; n++;
    }
    return { mean: sum / Math.max(1, n), n };
  };
  const flat = shadeRaster(meshes as never, backView, W, H, false);
  const smooth = shadeRaster(meshes as never, backView, W, H, true);
  writePng(`${OUT}/x-back-4x-flat.png`, W, H, flat);
  writePng(`${OUT}/x-back-4x-smooth.png`, W, H, smooth);
  const a = step(flat), b = step(smooth);
  /* 진단 래스터가 raster.ts 평면 셰이딩을 재현하는지 — 대조 */
  const ref = render(meshes as never, backView, bounds, W, H);
  let dd = 0; for (let i = 0; i < ref.length; i++) if (ref[i] !== flat[i]) dd++;
  console.log(`  ── (부) 구김 각짐 분리 · back 4배 · **판정 아님 · 기록** ──`);
  console.log(`     인접 옷 픽셀 평균 밝기 계단  평면 ${a.mean.toFixed(3)} (n ${a.n}) → 보간 ${b.mean.toFixed(3)} (n ${b.n})  비 ${(b.mean / a.mean).toFixed(3)}`);
  console.log(`     진단 래스터 ↔ raster.ts 평면 벌 대조: 다른 채널값 ${dd}/${ref.length}`);
}

/* 보조 채널 — 반점 픽셀에 투영되는 «옷 정점»의 부호 간극(등재 계기 · raster 와 같은 투영식) */
{
  const d = sideView.dir, up = [0, 1, 0];
  const U = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  const ul = Math.hypot(U[0], U[1], U[2]) || 1; U[0] /= ul; U[1] /= ul; U[2] /= ul;
  const uOf = (x: number, y: number, z: number) => x * U[0] + y * U[1] + z * U[2];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const A of [bodyPos, clothPos]) for (let i = 0; i < A.length; i += 3) {
    const u = uOf(A[i], A[i + 1], A[i + 2]);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, A[i + 1]); v1 = Math.max(v1, A[i + 1]);
  }
  const W = base.W, H = base.H, s = Math.max((u1 - u0) / W, (v1 - v0) / H);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const gaps: number[] = [];
  for (let v = 0; v < P.sc.n; v++) {
    const x = clothPos[v * 3], y = clothPos[v * 3 + 1], z = clothPos[v * 3 + 2];
    const px = Math.floor(W / 2 + (uOf(x, y, z) - cu) / s), py = Math.floor(H / 2 - (y - cv) / s);
    if (px < 0 || py < 0 || px >= W || py >= H || !base.mask[py * W + px]) continue;
    const g = sampleSdf(P.bodyG, x, y, z);
    gaps.push(g > bd.CELL ? g : (g < 0 ? -1 : 1) * bd.exactBodyDist(x, y, z));
  }
  gaps.sort((a, b) => a - b);
  const neg = gaps.filter((g) => g < 0).length;
  console.log(`  ── 보조: 반점 픽셀에 투영되는 옷 정점 ${gaps.length}개의 부호 간극[mm] ──`);
  if (gaps.length) {
    const q = (f: number) => (gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))] * 1000).toFixed(3);
    console.log(`     최소 ${q(0)} · p25 ${q(0.25)} · 중앙 ${q(0.5)} · p75 ${q(0.75)} · 최대 ${q(1)}`);
    console.log(`     간극<0(관통) ${neg}/${gaps.length} = ${((neg / gaps.length) * 100).toFixed(1)}%`);
  }
}

/* v3-41 기준 캡처와의 대조 — 같은 상태·같은 래스터인지 */
if (BASE) {
  const b = decodePng(readFileSync(BASE));
  const full = render([{ pos: bodyPos, idx: bodyIdx, color: BODY_COL },
                       { pos: clothPos, idx: clothIdx, color: CLOTH_COL }], sideView, bounds, b.W, b.H);
  let diff = 0;
  for (let i = 0; i < b.rgb.length; i++) if (b.rgb[i] !== full[i]) diff++;
  console.log(`  ── v3-41 기준 캡처 대조 ${b.W}×${b.H}: 다른 채널값 ${diff}/${b.rgb.length} (${((diff / b.rgb.length) * 100).toFixed(4)}%)`);
}
console.log(`  산출 → ${OUT}`);
