/* v3-46 ㉡ — 조립 결정성 확인 + 시접 굽힘 계수. **스텝 0회.** */
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
  const sc = P.sc as unknown as { n: number; tris: number[]; bends: unknown[];
    seamBends: { shape: number }[]; seamBendSkipped: number; seamCons: unknown[] };
  const sh = sc.seamBends.map((c) => c.shape).sort((a, b) => a - b);
  const ib = (P.sc.bends.length - sc.seamBends.length);
  const ish = P.sc.bends.slice(0, ib).map((c) => c.shape).sort((a, b) => a - b);
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  return { n: sc.n, tris: sc.tris.length / 3, sub: P.SUB, memb: P.sub.memb, bend: P.sub.bend,
    ramp: P.RAMP_N, seamCons: sc.seamCons.length, bendsAll: P.sc.bends.length,
    bendsInner: ib, seamBends: sc.seamBends.length, skipped: sc.seamBendSkipped,
    seamShape: [q(sh,0), q(sh,.5), q(sh,1)].map((v) => v.toFixed(6)).join(' / '),
    innerShape: [q(ish,0), q(ish,.5), q(ish,1)].map((v) => v.toFixed(6)).join(' / ') };
};
const a = run(), b = run();
const same = JSON.stringify(a) === JSON.stringify(b);
console.log(`[ASM:${FAB}-d${process.env.D_MM}] 조립 2회 동일: ${same ? '예' : '**아니오**'}`);
console.log(`  정점 ${a.n} · 삼각형 ${a.tris} · 램프 ${a.ramp} · 시접 쌍 ${a.seamCons}`);
console.log(`  서브스텝 sub ${a.sub} (멤브레인 ${a.memb} · 굽힘 ${a.bend})`);
console.log(`  굽힘 전체 ${a.bendsAll} = 내부 ${a.bendsInner} + **시접 ${a.seamBends}** (건너뜀 ${a.skipped})`);
console.log(`  shape 4a/l² [최소/중앙/최대]  내부 ${a.innerShape}  ·  시접 ${a.seamShape}`);
