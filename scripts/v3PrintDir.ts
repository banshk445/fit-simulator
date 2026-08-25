/* v3-65 §3 — **프린트 «방향» 자기검사**(픽셀 수준 · **사전 등재** · 손 상수 0).
 *
 * 절차(먼저 적고 그대로 집행한다):
 *   ① **자산 원본**의 «불투명» 영역(α ≥ 250 — v3-62 규칙 「α<250 = 투명」의 여집합) bbox 를 잡고,
 *      **상/하 절반**으로 갈라 각 절반의 **평균 RGB 2값**을 등재한다.
 *   ② **렌더 캡처**에서 같은 두 색을 «분류자»로 쓴다 — 화소마다 두 색과의 RGB 거리를 재고,
 *      **`PRINT_COLOR_DIST_THRESHOLD`**(v2 계약 상수 · **소스에서 «뜬다»** · 새 수 0) 이내이면
 *      그 색의 무리에 넣는다. 두 무리의 **화면 y 중앙값**을 낸다.
 *   ③ **대응 일치 판정** — 「자산 상반부」 무리가 「자산 하반부」 무리보다 **화면에서 위**면 **정립**,
 *      아래면 **교차 = 반전**. 옷 색·대표색·회색 대역 같은 **다른 채널을 일절 쓰지 않는다**
 *      (자산 자신의 두 색만으로 판정하므로 순환이 없다 · #118).
 *
 * **물리 0프레임 · 제품 코드 0줄** · v2 임포트 0(계약 상수는 «문자열로» 읽는다 · G1).
 * 진입: `ASSET=<png> SHOT=<png> npx tsx scripts/v3PrintDir.ts`
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 최소 PNG 디코더 — 8비트 RGBA(6)·RGB(2). 그 밖은 «판독 불가»로 적는다. */
function decodePng(buf: Buffer) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], ct = buf[25];
  if (depth !== 8 || (ct !== 6 && ct !== 2)) return { err: `colorType ${ct} · depth ${depth}(RGBA8/RGB8 아님)` as const };
  let idat = Buffer.alloc(0), q = 8;
  while (q < buf.length) {
    const L = buf.readUInt32BE(q), t = buf.toString('ascii', q + 4, q + 8);
    if (t === 'IDAT') idat = Buffer.concat([idat, buf.subarray(q + 8, q + 8 + L)]);
    q += 12 + L;
  }
  const raw = inflateSync(idat), bpp = ct === 6 ? 4 : 3, st = w * bpp;
  const px = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(st), o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++], line = raw.subarray(o, o + st); o += st;
    const cur = Buffer.alloc(st);
    for (let i = 0; i < st; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    cur.copy(px, y * st); prev = cur;
  }
  return { w, h, bpp, px };
}

/** v2 계약 상수를 **소스에서 뜬다** — 손으로 옮겨 적지 않는다(함정 13 계열). */
const SRC = readFileSync('src/v3/printComposite.ts', 'utf8');
const m = SRC.match(/const PRINT_COLOR_DIST_THRESHOLD = ([\d.]+);/);
if (!m) throw new Error('PRINT_COLOR_DIST_THRESHOLD 를 소스에서 못 떴다 — 계기 정지');
const DIST = Number(m[1]);
/** v3-62 규칙의 «투명» 기준도 소스에서 뜬다. */
const A = readFileSync('scripts/v3AssetScan.ts', 'utf8').match(/a < (\d+)/);
const OPAQUE = A ? Number(A[1]) : 250;

const asset = decodePng(readFileSync(process.env.ASSET!));
if ('err' in asset) throw new Error(`자산 ${asset.err}`);
if (asset.bpp !== 4) throw new Error('자산에 알파가 없다 — 계기 정지');

/* ① 자산 불투명 bbox → 상/하 절반 평균색 */
let x0 = asset.w, x1 = -1, y0 = asset.h, y1 = -1;
for (let y = 0; y < asset.h; y++) for (let x = 0; x < asset.w; x++) {
  if (asset.px[(y * asset.w + x) * 4 + 3] < OPAQUE) continue;
  if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
const mid = (y0 + y1) / 2;
const half = (lo: number, hi: number) => {
  let n = 0, r = 0, g = 0, b = 0;
  for (let y = lo; y <= hi; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * asset.w + x) * 4;
    if (asset.px[i + 3] < OPAQUE) continue;
    n++; r += asset.px[i]; g += asset.px[i + 1]; b += asset.px[i + 2];
  }
  return { n, r: r / n, g: g / n, b: b / n };
};
const up = half(y0, Math.floor(mid)), dn = half(Math.ceil(mid), y1);
const fc = (c: { r: number; g: number; b: number }) => `rgb(${c.r.toFixed(1)}, ${c.g.toFixed(1)}, ${c.b.toFixed(1)})`;
console.log(`[방향] 계약 문턱 **${DIST}**(소스에서 뜸) · 불투명 기준 α ≥ **${OPAQUE}**`);
console.log(`  ① 자산 ${asset.w}×${asset.h} · 불투명 bbox (${x0},${y0})~(${x1},${y1})`);
console.log(`     **상반부** ${fc(up)} · n=${up.n}     **하반부** ${fc(dn)} · n=${dn.n}`
  + `     두 색 사이 거리 **${Math.hypot(up.r - dn.r, up.g - dn.g, up.b - dn.b).toFixed(2)}**`);

/* ② 캡처에서 두 색으로 분류 → 화면 y 중앙값 */
const shot = decodePng(readFileSync(process.env.SHOT!));
if ('err' in shot) throw new Error(`캡처 ${shot.err}`);
const bin: number[][] = [[], []];
for (let y = 0; y < shot.h; y++) for (let x = 0; x < shot.w; x++) {
  const i = (y * shot.w + x) * shot.bpp;
  if (shot.bpp === 4 && shot.px[i + 3] < OPAQUE) continue;
  const R = shot.px[i], G = shot.px[i + 1], B = shot.px[i + 2];
  const du = Math.hypot(R - up.r, G - up.g, B - up.b), dd = Math.hypot(R - dn.r, G - dn.g, B - dn.b);
  if (Math.min(du, dd) > DIST) continue;
  bin[du <= dd ? 0 : 1].push(y);
}
const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
const mu = med(bin[0]), md = med(bin[1]);
console.log(`  ② 캡처 ${shot.w}×${shot.h} · **상반부색 무리** n=${bin[0].length} · y 중앙 **${mu}**`
  + `   **하반부색 무리** n=${bin[1].length} · y 중앙 **${md}**`);
if (!bin[0].length || !bin[1].length) { console.log(`  ③ **판정 불가** — 한쪽 무리가 비었다(표본 0)`); process.exit(0); }
const ok = mu < md;                                   // 화면 y 는 «아래»로 증가 ⟹ 상반부색이 작아야 정립
console.log(`  ③ 상반부색이 화면에서 ${ok ? '**위**' : '**아래**'} ⟹ ${ok ? '**대응 일치 = 정립**' : '**교차 = 반전**'}`);
