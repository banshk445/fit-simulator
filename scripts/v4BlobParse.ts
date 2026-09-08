/* v4-49 §1-② — **로더와 «같은 식»으로 파싱해 본다**(로더 코드 수정 0 · 브라우저 전 단계).
 * 재현하는 식: `src/v3/dressRun.ts:143-150`. */
import { readFileSync } from 'node:fs';
const p = process.argv[2] ?? 'public/v3diag/v4-a35/settled-c100-h170-s45_M.bin';
const b = readFileSync(p);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const total = ab.byteLength;
const dv = new DataView(ab);
const hl = dv.getUint32(0, true);
const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl))) as { n: number; frame?: number };
const need = 4 + hl + hdr.n * 3 * 8 * 2;
const nb = hdr.n * 3 * 8;
const pos = new Float64Array(ab.slice(4 + hl, 4 + hl + nb));
const vel = new Float64Array(ab.slice(4 + hl + nb, 4 + hl + 2 * nb));
let mnY = Infinity, mxY = -Infinity, nonFinite = 0, velMax = 0;
for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) nonFinite++;
for (let i = 1; i < pos.length; i += 3) { if (pos[i] < mnY) mnY = pos[i]; if (pos[i] > mxY) mxY = pos[i]; }
for (let i = 0; i < vel.length; i++) velMax = Math.max(velMax, Math.abs(vel[i]));
console.log(JSON.stringify({ file: p, total, need, '길이 일치': need === total, n: hdr.n, frame: hdr.frame,
  'pos 비유한': nonFinite, 'y 범위 m': [mnY, mxY], 'vel 최대': velMax }, null, 0));
