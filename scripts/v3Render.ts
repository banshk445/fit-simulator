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

export type Mesh = {
  pos: ArrayLike<number>;
  idx: ArrayLike<number>;
  /** 0~255 RGB */
  color: [number, number, number];
};

/** 카메라 — 정사영. `axis`가 «보는 방향»이고 화면 위는 항상 +y다. */
export type View = { name: string; dir: [number, number, number] };
export const VIEWS: View[] = [
  { name: 'front', dir: [0, 0, -1] },      // +z 에서 −z 를 본다
  { name: 'sideXplus', dir: [-1, 0, 0] },  // +x 에서 −x 를 본다
  { name: 'back', dir: [0, 0, 1] },        // −z 에서 +z 를 본다
];

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
export function render(
  meshes: readonly Mesh[],
  view: View,
  bounds: { lo: [number, number, number]; hi: [number, number, number] },
  W: number,
  H: number,
): Uint8Array {
  // 화면 축: u = 보는 방향과 +y 의 외적, v = +y (수직 뷰가 없으므로 안전하다)
  const d = view.dir;
  const up: [number, number, number] = [0, 1, 0];
  const ux = up[1] * d[2] - up[2] * d[1], uy = up[2] * d[0] - up[0] * d[2], uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const U: [number, number, number] = [ux / ul, uy / ul, uz / ul];
  const V = up;
  const proj = (x: number, y: number, z: number) => [
    x * U[0] + y * U[1] + z * U[2],
    x * V[0] + y * V[1] + z * V[2],
    -(x * d[0] + y * d[1] + z * d[2]),   // 클수록 «가깝다»
  ];
  // 화면 범위 — bbox 여덟 꼭짓점을 투영해 잡고 종횡비를 맞춘다
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = proj(k & 1 ? bounds.hi[0] : bounds.lo[0], k & 2 ? bounds.hi[1] : bounds.lo[1], k & 4 ? bounds.hi[2] : bounds.lo[2]);
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]);
    v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
  }
  const su = (u1 - u0) / W, sv = (v1 - v0) / H;
  const s = Math.max(su, sv);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const toPx = (p: number[]) => [W / 2 + (p[0] - cu) / s, H / 2 - (p[1] - cv) / s, p[2]];

  const rgb = new Uint8Array(W * H * 3).fill(255);
  const zb = new Float64Array(W * H).fill(-Infinity);
  const a = new Float64Array(3), b = new Float64Array(3), c = new Float64Array(3);
  for (const m of meshes)
    for (let t = 0; t < m.idx.length; t += 3) {
      const o = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3];
      const P = o.map((k) => toPx(proj(m.pos[k], m.pos[k + 1], m.pos[k + 2])));
      a.set(P[0]); b.set(P[1]); c.set(P[2]);
      // 면 법선(월드) → 음영
      const e1 = [m.pos[o[1]] - m.pos[o[0]], m.pos[o[1] + 1] - m.pos[o[0] + 1], m.pos[o[1] + 2] - m.pos[o[0] + 2]];
      const e2 = [m.pos[o[2]] - m.pos[o[0]], m.pos[o[2] + 1] - m.pos[o[0] + 1], m.pos[o[2] + 2] - m.pos[o[0] + 2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      const lam = Math.abs((nx * -d[0] + ny * -d[1] + nz * -d[2]) / nl);
      const sh = 0.35 + 0.65 * lam;
      const col = [m.color[0] * sh, m.color[1] * sh, m.color[2] * sh];
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(den) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const fx = px + 0.5, fy = py + 0.5;
          const l0 = ((b[1] - c[1]) * (fx - c[0]) + (c[0] - b[0]) * (fy - c[1])) / den;
          const l1 = ((c[1] - a[1]) * (fx - c[0]) + (a[0] - c[0]) * (fy - c[1])) / den;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const z = l0 * a[2] + l1 * b[2] + l2 * c[2];
          const i = py * W + px;
          if (z <= zb[i]) continue;
          zb[i] = z;
          rgb[i * 3] = col[0]; rgb[i * 3 + 1] = col[1]; rgb[i * 3 + 2] = col[2];
        }
    }
  return rgb;
}
