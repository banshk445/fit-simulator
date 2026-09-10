/* v3 — 하네스 «오프라인» 렌더러. 브라우저·v2 코드 임포트 0.
 *
 * 왜 자체 렌더인가: v3 물리는 node 하네스에서만 돈다. v2의 캡처 경로
 * (`FitCanvas.tsx` CAPTURE_VIEWS)는 v2 씬을 그리므로 이 축에서 쓸 수 없고,
 * 부르면 R4-3 위반이다. 그래서 «정사영 + z버퍼 + 평면 음영»만 직접 쓴다.
 *
 * 판정에 쓰지 «않는다» — CC는 화면을 판정하지 않는다(상시 규약). 이 파일은
 * 전략 세션이 볼 픽셀을 «결정적으로» 만드는 것이 전부다(난수 0 · 시간 0).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { render, VIEWS, type Mesh, type View } from '../src/v3/raster.ts';
export { render, VIEWS };
export type { Mesh, View };

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** 8비트 RGB PNG. 필터는 전부 0(None) — 결정성이 우선이고 크기는 부차적이다. */
export function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 6 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  writeFileSync(path, out);
}

/** 정사영 래스터라이저. 광원은 «카메라 방향» 고정(양면 |n·l|) — 뒤집힌 면도 보인다. */
