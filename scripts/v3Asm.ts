/* v3-47 ㉠ — 조립 결정성 2회 + 계수. **물리 스텝 0회.** 계기 경로(물리·조립 코드 0줄). */
import { readFileSync } from 'node:fs';
import { prepare, DEFAULT_GARMENT } from '../src/v3/dressRun.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { FABRICS } from '../src/v3/consts.ts';
const FAB = process.env.FAB ?? 'gray';
const D = Number(process.env.D_MM ?? 9) / 1000;
const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const run = () => {
  const P = prepare({ glb: ab('public/models/mannequin.glb'), fabric: FABRICS[FAB], d: D,
    garment: DEFAULT_GARMENT, minPairDistLite });
  return { n: P.sc.n, tris: P.sc.tris.length / 3, sub: P.SUB, memb: P.sub.memb, bend: P.sub.bend,
    ramp: P.RAMP_N, seamCons: P.sc.seamCons.length, bends: P.sc.bends.length,
    cons: P.sc.cons.length, sig: P.S.PLACE_SIG,
    dims: [P.S.NECK_A, P.S.NECK_G, P.S.CAP_H, P.S.ARM_D].map((v) => (v * 100).toFixed(3)).join('/') };
};
const a = run(), b = run();
console.log(`[ASM:${FAB}-d${process.env.D_MM}] 조립 2회 동일: ${JSON.stringify(a) === JSON.stringify(b) ? '예' : '**아니오**'}`);
console.log(`  정점 ${a.n} · 삼각형 ${a.tris} · sub ${a.sub}(멤 ${a.memb}/굽 ${a.bend}) · 램프 ${a.ramp}`);
console.log(`  시접 쌍 ${a.seamCons} · 굽힘 ${a.bends} · 제약 총 ${a.cons}`);
console.log(`  파생치수[cm] 목선반폭/목선둘레/소매산/암홀깊이 ${a.dims} · 배치서명 ${a.sig}`);
