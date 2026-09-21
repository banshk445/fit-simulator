/* v5-27 — **정착 상태의 「어깨 걸림」**(= 어깨선 `Y_TOP` 위 옷 정점 수 · 편입 규약 v4-52 § 문턱 172).
 *
 * 값의 정의·문턱은 `scripts/v4Provide.ts:25-52` 를 **그대로** 쓴다(새 식 0 · 새 수 0) —
 * 다른 것은 정착 위치를 **굽기 결과 폴더**에서 읽고 장면 인자를 **굽기 meta 의 `scene`** 에서 받는다는 점뿐이다
 * (v5-9 §0 사무 ㄱ 의 그 사상 · `asm1x` 장면을 세워야 정점 수가 맞는다).
 *
 * 진입: `JOB=gpu/bake/jobs/<이름>.json RESULTS=gpu/bake/results/<이름> [OUT=<json>] npx tsx scripts/v5Shoulder27.ts`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepare } from '../src/v3/dressRun.ts';
import { FABRICS } from '../src/v3/consts.ts';
import { minPairDistLite } from '../src/v3/instruments.ts';
import { garmentOf, cells, type Size } from '../src/v3/grid.ts';
import { patternOfSpecName } from '../src/v5/specToPattern.ts';

const SHOULDER_MIN = 172;                       // v4-52 §1-① 문턱(인용)
const JOBF = process.env.JOB!;
const RES = process.env.RESULTS!;
const OUT = process.env.OUT ?? 'gpu/oracle/export/v5-27-shoulder.json';
const D = Number(process.env.D_MM ?? 9) / 1000;
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

type JCell = { cell: string; reportCell?: string; spec?: string };
const job = JSON.parse(readFileSync(JOBF, 'utf8')) as { cells: (string | JCell)[] };
const rows: Record<string, unknown>[] = [];

for (const jc of job.cells) {
  const t = typeof jc === 'string' ? { cell: jc } : jc;
  const bin = `${RES}/${t.cell}.bin`, metaF = `${RES}/${t.cell}.json`;
  if (!existsSync(bin) || !existsSync(metaF)) { rows.push({ tag: t.cell, 상태: '산출 없음' }); continue; }
  const meta = JSON.parse(readFileSync(metaF, 'utf8')) as { scene?: Record<string, string>; n: number };
  const sceneEnv = meta.scene ?? {};
  const cellId = t.reportCell ?? t.cell;
  const c = cells().find((x) => x.id === cellId)!;
  const bb = readFileSync(sceneEnv.BODY_BIN ?? `public/v3diag/v3-77/body-${c.bodyId}.bin`);
  /* 팔 축·원점은 `armAxisFromEnv()` 가 env 에서 읽는다 ⟹ 이 자리에서 env 를 세워 준다(계기 0줄). */
  for (const k of ['ARM_AXIS_JSON', 'ARM_ORIGIN_JSON']) if (sceneEnv[k]) process.env[k] = sceneEnv[k];
  const { armAxisFromEnv } = await import('./armAxisEnv.ts');
  const P = prepare({ glb, fabric: FABRICS.gray, d: D,
    garment: t.spec ? patternOfSpecName(t.spec) : garmentOf(c.size as Size),
    armAxis: armAxisFromEnv(), bodyVerts: new Float32Array(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)),
    minPairDistLite, ...(sceneEnv.ASM1X === '1' ? { asm1x: true } : {}) } as never);
  const yTop = (P.S as unknown as { Y_TOP: number }).Y_TOP;
  const raw = readFileSync(bin);
  const pos = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const n = pos.length / 3;
  let above = 0;
  for (let v = 0; v < n; v++) if (pos[v * 3 + 1] >= yTop) above++;
  rows.push({ tag: t.cell, cell: cellId, n, 'Y_TOP mm': yTop * 1000, '어깨선 위 옷 정점': above,
              '문턱 172 이상': above >= SHOULDER_MIN });
}

const ok = rows.filter((r) => r['문턱 172 이상'] === true).length;
const out = { what: 'v5-27 정착 어깨 걸림(어깨선 위 옷 정점 · 문턱 172 = v4-52 인용)',
  _args: { JOB: JOBF, RESULTS: RES, D_MM: D * 1000 },
  칸: rows.length, '문턱 이상': ok, '문턱 미달': rows.filter((r) => r['문턱 172 이상'] === false).length, 전량: rows };
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
