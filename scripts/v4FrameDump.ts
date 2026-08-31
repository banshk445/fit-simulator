/* v4-12 §1-② — **발산 시작점 주사**의 v3 쪽. 같은 초기 상태에서 **프레임마다** 위치를 f64 로 덤프한다.
 *
 * 물리 경로는 `scripts/v4CellConverge.ts` 와 **같은 것**을 인용한다(새 수 0 · `src/` 0줄):
 *   `prepare()` · 제약 집합 `all`(= `sc.cons`) · `params = {dt: DT, substeps: P.SUB, gravity: G,
 *   damping: DAMP, collision: P.params.collision}` · 초기 상태 = `settled-<cell>.bin` 의 위치·속도 전량.
 *   자기충돌 «없다»(v4 이식 0 · 정의역 일치 — v4-05 §0 이후 같은 처분).
 * 이 파일이 «더» 하는 것은 하나뿐: **N_WIN 이 아니라 매 프레임** 위치를 남긴다
 * (v4-10 까지의 산출물은 10프레임 간격이라 f=1 을 볼 수 없었다 — 그 자리가 이 판의 물음이다).
 *
 * 산출 = `gpu/oracle/export/l3fd-v3-<CELL>.bin`  — [4B 헤더길이][헤더 JSON][(FRAMES+1) × n × 3 f64]
 * 진입: `[CELL=…] [FRAMES=10] npx tsx scripts/v4FrameDump.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS, DT, DAMP, G } from '../src/v3/consts.ts';
import { step, type Constraint } from '../src/v3/solver.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';

const SRC = 'public/v3diag/v3-77';
const OUT = 'gpu/oracle/export';
const CELL = process.env.CELL ?? 'c100-h170-s45_M';
const FRAMES = Number(process.env.FRAMES ?? 10);
const D = Number(process.env.D_MM ?? 9) / 1000;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const c = cells().find((x) => x.id === CELL);
if (!c) throw new Error(`칸 ${CELL} 이 본 그리드에 없다`);
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;
const bb = readFileSync(`${SRC}/body-${c.bodyId}.bin`);
const verts = new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength));
const P = prepare({ glb, fabric: FABRICS.gray, d: D, garment: garmentOf(c.size as Size),
                    bodyVerts: verts, minPairDistLite });
const sc = P.sc;

const raw = readFileSync(`${SRC}/settled-${CELL}.bin`);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const bh = JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset + 4, hl)));
if (bh.n !== sc.n) throw new Error(`정점 수가 다르다 — blob ${bh.n} ≠ 조립 ${sc.n}`);
const nb = sc.n * 3 * 8;
sc.s.pos.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl, raw.byteOffset + 4 + hl + nb)));
sc.s.vel.set(new Float64Array(raw.buffer.slice(raw.byteOffset + 4 + hl + nb, raw.byteOffset + 4 + hl + 2 * nb)));

const cons: Constraint[] = sc.cons;                       // KIND = 'all'
const params = { dt: DT, substeps: P.SUB, gravity: G, damping: DAMP, collision: P.params.collision };
const kinds: Record<string, number> = {};
for (const x of cons) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;

const dump = new Float64Array((FRAMES + 1) * sc.n * 3);
dump.set(sc.s.pos, 0);                                     // f=0 — 캐스팅 «전» 원본
const t0 = Date.now();
for (let f = 1; f <= FRAMES; f++) {
  step(sc.s, cons, params);
  if (!Number.isFinite(sc.s.pos[0])) throw new Error(`발산 — 프레임 ${f}`);
  dump.set(sc.s.pos, f * sc.n * 3);
  console.log(`  v3 f=${f} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
const ms = Date.now() - t0;
const hdr = {
  what: 'v4-12 §1-② — v3(f64·Node) 프레임별 위치 덤프', cell: CELL, n: sc.n, m: cons.length,
  kinds, substeps: P.SUB, d: D, G, DT, DAMP, k: FABRICS.gray.k, ke: FABRICS.gray.B,
  THICK: P.params.collision!.thickness, MU: P.params.collision!.mu,
  frames: FRAMES, blobFrame: bh.frame, ms, msPerFrame: ms / FRAMES,
};
const hbb = Buffer.from(JSON.stringify(hdr), 'utf8');
const hd = Buffer.alloc(4); hd.writeUInt32LE(hbb.length, 0);
writeFileSync(`${OUT}/l3fd-v3-${CELL}.bin`, Buffer.concat([hd, hbb, Buffer.from(dump.buffer)]));
writeFileSync(`${OUT}/l3fd-v3-${CELL}.json`, JSON.stringify(hdr, null, 1));
console.log(`v3 덤프 · n ${sc.n} · m ${cons.length} ${JSON.stringify(kinds)} · sub ${P.SUB} · ` +
            `${FRAMES}프레임 ${ms}ms (${(ms / FRAMES).toFixed(0)}ms/프레임)`);
console.log(`  → ${OUT}/l3fd-v3-${CELL}.bin`);
