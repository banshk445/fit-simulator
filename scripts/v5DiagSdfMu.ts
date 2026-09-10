/* v5-7a §1-① — **진단용 MU 오버라이드**(코드 0줄 · 정본 상수 불변 · 정본 자산 불변).
 *
 * 사실(v5-7a §1-①) — `MU` 는 하드코딩이 아니라 **몸 SDF 자산의 헤더 JSON 필드**다:
 *   `src/v3/consts.ts:10` → `scripts/v4AsmExport.ts:101-102`(`sdf-<BODYTAG>.bin` 헤더에 기록)
 *   → `gpu/bake/worker.py:89,105` `sh["MU"]` → `gpu/engine/collide.py:47,55,114,119`
 *   `gpu/bake/slip_probe.py:81` 도 **같은 헤더**를 읽는다 ⟹ 굽기·궤적 양쪽이 이 한 파일로 덮인다.
 * ⟹ 진단 굽기는 **그 헤더의 `MU` 값만** 바꿔 다시 포장하면 된다. 본문(격자 f64)은 **바이트 그대로** 옮긴다.
 *
 * 진입: `SRC=<sdf-….bin> MU=0.6 OUT=<sdf-…diag….bin> npx tsx scripts/v5DiagSdfMu.ts`
 * ★ 안전장치 — `OUT` 파일명에 **`diag`** 가 없으면 **던진다**(정본 자산 덮어쓰기 방지 · v4-46 사고 계열).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const SRC = process.env.SRC!, OUT = process.env.OUT!, MU = Number(process.env.MU);
if (!SRC || !OUT || !Number.isFinite(MU)) throw new Error('SRC · OUT · MU 를 모두 준다');
if (!/diag/i.test(basename(OUT))) throw new Error(`OUT 이름에 «diag» 가 없다 — 정본 자산 보호 · ${OUT}`);
if (existsSync(OUT)) throw new Error(`OUT 이 이미 있다 — 덮어쓰지 않는다 · ${OUT}`);

const raw = readFileSync(SRC);
const hl = raw.readUInt32LE(0);
const head = JSON.parse(raw.subarray(4, 4 + hl).toString('utf8')) as Record<string, unknown>;
const before = head.MU;
if (typeof before !== 'number') throw new Error(`헤더에 수 «MU» 가 없다 — ${SRC}`);
head.MU = MU;
head.note = `${String(head.note ?? '')} · v5-7a 진단 MU 오버라이드 ${before} → ${MU}(정본 상수 불변 · 본문 바이트 동일)`;

const hb = Buffer.from(JSON.stringify(head), 'utf8');
const len = Buffer.alloc(4); len.writeUInt32LE(hb.length, 0);
const body = raw.subarray(4 + hl);
writeFileSync(OUT, Buffer.concat([len, hb, body]));

/* 검산 — 다시 읽어 본문 길이·MU 를 확인한다(조용한 실패 0). */
const chk = readFileSync(OUT);
const chl = chk.readUInt32LE(0);
const ch = JSON.parse(chk.subarray(4, 4 + chl).toString('utf8')) as { MU: number };
if (ch.MU !== MU) throw new Error('재포장 후 MU 가 다르다');
if (chk.length - 4 - chl !== body.length) throw new Error('재포장 후 본문 길이가 다르다');
console.log(JSON.stringify({ SRC, OUT, 'MU 전': before, 'MU 후': ch.MU,
  '본문 바이트': body.length, '헤더 바이트 전': hl, '헤더 바이트 후': chl,
  '본문 동일': body.equals(chk.subarray(4 + chl)) }));
