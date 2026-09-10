/* v3-62 §2 — **자산 «적합» 스캔**. 판정 규칙은 `docs/v3/42-알파합성과자산.md` §0-3a 가
 * **스캔 «전»에** 확정했다(커밋 `7494661`). 이 계기는 **그 규칙을 «값으로» 적용**할 뿐이다.
 * **CC 는 자산을 제작·편집하지 않는다**(정의역 밖) — **읽고 판정만** 한다.
 *
 *   ㉠ 알파 보유        α < 250 화소 ≥ 1
 *   ㉡ 프레임 미충전     불투명(α ≥ 250) bbox 가 가로·세로 어느 쪽도 «프레임의 0.9 이상»이 아니다
 *                       (문턱 = v2 계약 등재값 `PRINT_MAX_FRAME_FRACTION` 그대로 · **새 수 0**)
 *   ㉢ 테두리 비어 있음  프레임 «테두리 1픽셀»의 불투명 비율 = **0**
 *   동점 규칙            불투명 bbox 면적비가 «가장 작은» 것 · 동률이면 파일명 사전순
 *
 * 진입: `npx tsx scripts/v3AssetScan.ts`  (PNG 만 · webp 는 «디코더 부재»를 사실로 적는다)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const DIRS = ['docs/test-assets'];
const MAX_FRAME_FRACTION = 0.9;      // v2 계약 등재값 인용 — 새 수 0

/** 최소 PNG 디코더 — 8비트 RGBA(colorType 6)만. 그 밖은 «판독 불가»로 적는다. */
function decodePng(buf: Buffer) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return { err: 'PNG 아님' as const };
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], ct = buf[25];
  if (depth !== 8 || ct !== 6) return { err: `colorType ${ct} · depth ${depth}(RGBA8 아님)` as const };
  const idat: Buffer[] = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  const bpp = 4, stride = w * bpp;
  let o = 0, prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[o++]; const line = raw.subarray(o, o + stride); o += stride;
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    px.set(cur, y * stride); prev = cur;
  }
  return { w, h, px };
}

type Row = { file: string; ok: boolean; note: string; areaFrac: number };
const rows: Row[] = [];
for (const d of DIRS) for (const f of readdirSync(d).sort()) {
  const path = `${d}/${f}`;
  if (!/\.(png|webp|jpg|jpeg)$/i.test(f)) continue;
  if (!/\.png$/i.test(f)) { rows.push({ file: path, ok: false, note: '**판독 불가** — Node 표준에 디코더 없음(PNG 만 읽는다)', areaFrac: NaN }); continue; }
  const r = decodePng(readFileSync(path));
  if ('err' in r) { rows.push({ file: path, ok: false, note: `**판독 불가** — ${r.err}`, areaFrac: NaN }); continue; }
  const { w, h, px } = r;
  let semi = 0, opX0 = w, opY0 = h, opX1 = -1, opY1 = -1, edgeOp = 0, edgeN = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = px[(y * w + x) * 4 + 3];
    if (a < 250) semi++;
    else { if (x < opX0) opX0 = x; if (x > opX1) opX1 = x; if (y < opY0) opY0 = y; if (y > opY1) opY1 = y; }
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { edgeN++; if (a >= 250) edgeOp++; }
  }
  const bw = opX1 < 0 ? 0 : opX1 - opX0 + 1, bh = opY1 < 0 ? 0 : opY1 - opY0 + 1;
  const fw = bw / w, fh = bh / h, edgeFrac = edgeOp / edgeN;
  const c1 = semi > 0, c2 = !(fw >= MAX_FRAME_FRACTION || fh >= MAX_FRAME_FRACTION), c3 = edgeFrac === 0;
  rows.push({ file: path, ok: c1 && c2 && c3, areaFrac: fw * fh,
    note: `${w}×${h} · α<250 **${((100 * semi) / (w * h)).toFixed(1)}%** · 불투명 bbox **${(100 * fw).toFixed(1)}%×${(100 * fh).toFixed(1)}%** · 테두리 불투명 **${(100 * edgeFrac).toFixed(1)}%**`
      + ` ⟹ ㉠${c1 ? '✓' : '✗'} ㉡${c2 ? '✓' : '✗'} ㉢${c3 ? '✓' : '✗'}` });
}
console.log('[자산 스캔] 규칙은 §0-3a 가 «스캔 전»에 확정 — 이 계기는 값으로 적용만 한다');
for (const r of rows) console.log(`  ${r.ok ? '**적합**' : '부적합'} ${r.file}\n      ${r.note}`);
const fit = rows.filter((r) => r.ok).sort((a, b) => (a.areaFrac - b.areaFrac) || a.file.localeCompare(b.file));
console.log(`  ── 판정 ── 적합 **${fit.length}건**` + (fit.length ? ` ⟹ 채택 **${fit[0].file}**(불투명 bbox 면적비 최소 ${(100 * fit[0].areaFrac).toFixed(2)}%)` : ' ⟹ **갈래 B — 정지 · 자산 요청**'));
