/* v3-36 — 상태 blob 헤더 변환기. **측정 코드 0줄** — 하네스가 그대로 읽게만 한다.
 * 브라우저(dressRun.stateBlob)는 {frame,n,d,place}, 하네스 loadCk는 {frame,n,d,sub,sig}를 본다.
 * 진입: `IN=<blob> OUT=<ckpt> SUB=<n> npx tsx scripts/v3Blob.ts`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const IN = process.env.IN!, OUT = process.env.OUT!;
const b = readFileSync(IN);
const hl = b.readUInt32LE(0);
const h = JSON.parse(b.subarray(4, 4 + hl).toString('utf8'));
const nh = Buffer.from(JSON.stringify({
  frame: h.frame, n: h.n, d: h.d, sub: Number(process.env.SUB ?? 0), sig: h.sig ?? h.place,
}), 'utf8');
const len = Buffer.alloc(4); len.writeUInt32LE(nh.length, 0);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([len, nh, b.subarray(4 + hl)]));
console.log(`${IN} → ${OUT}  헤더 {frame:${h.frame}, n:${h.n}, d:${h.d}, sig:${h.sig ?? h.place}}`);
