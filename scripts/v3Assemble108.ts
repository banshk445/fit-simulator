/* v3-88 §1-④ — **108칸 «조립» 드라이런**(물리 0프레임 · 저장 0).
 * 칸마다: 조립 성립 여부 · 최소쌍 패널·값·회차 · R/RMIN · 감김 호 · **패턴해시**(조립 정점 전량).
 * 판정·문턱·처방 0 — 값만 낸다.  진입: `OUT=<파일> npx tsx scripts/v3Assemble108.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite, minPairDist } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const D = Number(process.env.D_MM ?? 9) / 1000;
const OUT = process.env.OUT ?? '/tmp/v3-88-assemble.json';
const glbBuf = readFileSync('public/models/mannequin.glb');
const glb = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer;
const bodyCache = new Map<string, Float32Array>();
const bodyOf = (bid: string) => {
  let v = bodyCache.get(bid);
  if (!v) { const b = readFileSync(`public/v3diag/v3-77/body-${bid}.bin`);
            v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); bodyCache.set(bid, v); }
  return v;
};
type Rec = { 회차: number; GAP_SIDE: number; 측정_최소쌍거리_m: number; pos: Float64Array; tris: number[];
             panels: { name: string; base: number }[]; n: number; SLV_R: number; CAP_W: number;
             RMIN_소매: number; 감김호_rad: number };

const rows: Record<string, unknown>[] = [];
for (const c of cells()) {
  const log: Rec[] = [];
  (globalThis as unknown as { __v3gapProbe?: (r: unknown) => void }).__v3gapProbe = (r) => {
    const q = r as Rec; log.push({ ...q, pos: Float64Array.from(q.pos), tris: [...q.tris] });
  };
  let threw = ''; let hash = ''; let n = 0;
  try {
    const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                        bodyVerts: bodyOf(c.bodyId), minPairDistLite });
    const pos = (P as unknown as { sc: { s: { pos: Float64Array }; n: number } }).sc;
    /* 패턴해시 = 조립 정점 «전량»의 바이트 해시(비트 동일 대조용) */
    hash = createHash('sha256').update(Buffer.from(pos.s.pos.buffer, pos.s.pos.byteOffset, pos.s.pos.byteLength)).digest('hex');
    n = pos.n;
  } catch (e) { threw = (e as Error).message; }
  const last = log[log.length - 1];
  let pair = '', m0 = NaN, rounds = log.length, rr = NaN, arc = NaN;
  if (last) {
    m0 = last.측정_최소쌍거리_m; rr = last.SLV_R / last.RMIN_소매; arc = last.감김호_rad / Math.PI;
    const w = minPairDist(last.pos, last.tris, 0.004).worst;
    if (w[0] >= 0) {
      const bases = last.panels.map((p) => p.base).concat([last.n]);
      const panelOf = (v: number) => { for (let k = 0; k < last.panels.length; k++) if (v >= bases[k] && v < bases[k + 1]) return last.panels[k].name; return '?'; };
      const A = [last.tris[w[0] * 3], last.tris[w[0] * 3 + 1], last.tris[w[0] * 3 + 2]];
      const B = [last.tris[w[1] * 3], last.tris[w[1] * 3 + 1], last.tris[w[1] * 3 + 2]];
      pair = `${[...new Set(A.map(panelOf))].join('+')}↔${[...new Set(B.map(panelOf))].join('+')}`;
    }
  }
  rows.push({ id: c.id, 결과: threw ? '던짐' : '조립', 사유: threw || null, 패턴해시: hash, 정점: n,
              최소쌍패널: pair, 최소쌍_mm: Number.isFinite(m0) ? +(m0 * 1000).toPrecision(6) : null,
              회차: rounds, R비: Number.isFinite(rr) ? +rr.toFixed(4) : null,
              호_pi: Number.isFinite(arc) ? +arc.toFixed(4) : null });
  process.stderr.write(`  ${c.id} ${threw ? '던짐' : '조립'}${pair ? ' · ' + pair : ''}\n`);
}
writeFileSync(OUT, JSON.stringify(rows, null, 1) + '\n');
const ok = rows.filter((r) => r.결과 === '조립').length;
console.log(`조립 ${ok}/108 · 던짐 ${108 - ok} → ${OUT}`);
