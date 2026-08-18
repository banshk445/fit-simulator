/* v3-13 §1 — 원본 마네킹의 «수밀성»을 값으로 확인한다.
 *
 * 진입: `npm run v3:body`
 *
 * **데이터 읽기이지 코드 임포트가 아니다.** v3는 v2 코드를 임포트하지 않는다(설계 R4-3).
 * 이 파일은 `public/models/mannequin.glb`를 **glTF 2.0 바이너리 규격대로 직접 파싱**한다 —
 * `src/lib/meshCollision.ts`(`excludeArms`·`splitFrontBack`)를 부르지 않는다. 그 둘은
 * 구멍을 «내는» 쪽이고, 이 판이 재려는 것은 그것을 «거치기 전»의 원본이다.
 *
 * v3-10 §1-2는 「원본 마네킹은 수밀(열린 엣지 0)」로 적었으나 그 근거가 CLAUDE.md
 * 인용이다. **직접 잰다.**
 *
 * 계기 정의역(함정 13 — 채택 시점에 식부터 재도출):
 *   열린 엣지     = 삼각형 «1개»에만 속한 무향 엣지 수
 *   비다양체 엣지 = 삼각형 «3개 이상»에 속한 무향 엣지 수
 *   와인딩 불일치 = 삼각형 2개가 공유하는 엣지를 «같은 방향»으로 도는 쌍의 수
 *                  (수밀·정상 배향이면 반대 방향이어야 한다 ⟹ 뒤집힌 면의 지표)
 *   연결 성분     = 삼각형을 엣지 공유로 이은 연결 성분 수
 *
 * **용접이 정의역을 가른다.** glTF는 UV·법선 이음매에서 «같은 위치의 정점»을 쪼개
 * 저장한다. 인덱스만 보면 그 이음매가 전부 「열린 엣지」로 세어진다 — 기하는 닫혀
 * 있는데 계기가 열렸다고 답하는 전형적인 정의역 어긋남이다. 그래서 **원시 인덱스
 * 기준과 위치 용접 기준을 «둘 다»** 낸다.
 */
import { readFileSync } from 'node:fs';
import { bakeSdf, deriveSpacing, sampleSdf, type GridSdf } from '../src/v3/bodySdf.ts';
import {
  makeSolver, makeInplane, makeBend, assignMassFromMesh,
  substepsForBending, substepsForCloth, step,
  type Constraint, type SolverParams,
} from '../src/v3/solver.ts';

const GLB = process.env.GLB ?? 'public/models/mannequin.glb';

type Prim = { name: string; pos: Float32Array; idx: Uint32Array };

/** glTF 2.0 바이너리를 규격대로 읽는다(압축 확장이 있으면 «불가»로 멈춘다). */
function readGlb(path: string): { prims: Prim[]; required: string[] } {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('glTF 매직이 아니다');
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  let off = 20 + jsonLen;
  let bin: Buffer | undefined;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    if (type === 0x004e4942) bin = b.subarray(off + 8, off + 8 + len);
    off += 8 + len + ((4 - ((8 + len) % 4)) % 4);
  }
  if (!bin) throw new Error('BIN 청크가 없다');
  const required: string[] = json.extensionsRequired ?? [];
  const compress = required.filter((e) => /draco|meshopt|quantiz/i.test(e));
  if (compress.length) throw new Error(`압축 확장 미지원: ${compress.join(',')}`);

  const CT: Record<number, { n: number; get: (dv: DataView, o: number) => number }> = {
    5120: { n: 1, get: (d, o) => d.getInt8(o) },
    5121: { n: 1, get: (d, o) => d.getUint8(o) },
    5122: { n: 2, get: (d, o) => d.getInt16(o, true) },
    5123: { n: 2, get: (d, o) => d.getUint16(o, true) },
    5125: { n: 4, get: (d, o) => d.getUint32(o, true) },
    5126: { n: 4, get: (d, o) => d.getFloat32(o, true) },
  };
  const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  const readAccessor = (ai: number): Float64Array => {
    const a = json.accessors[ai];
    const ct = CT[a.componentType];
    const nc = NCOMP[a.type];
    const out = new Float64Array(a.count * nc);
    if (a.bufferView === undefined) return out; // 규격상 전부 0
    const bv = json.bufferViews[a.bufferView];
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = bv.byteStride ?? ct.n * nc;
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < nc; c++) out[i * nc + c] = ct.get(dv, base + i * stride + c * ct.n);
    return out;
  };

  const prims: Prim[] = [];
  for (const [mi, m] of (
    json.meshes as { name?: string; primitives: Record<string, unknown>[] }[]
  ).entries())
    for (const [pi, p] of m.primitives.entries()) {
      if (((p.mode as number) ?? 4) !== 4) continue; // 삼각형만
      const pos = Float32Array.from(
        readAccessor((p.attributes as Record<string, number>).POSITION),
      );
      const idx =
        p.indices !== undefined
          ? Uint32Array.from(readAccessor(p.indices as number))
          : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      prims.push({ name: `${m.name ?? `mesh${mi}`}#${pi}`, pos, idx });
    }
  return { prims, required };
}

/** 위치 용접 — 같은 좌표의 정점을 하나로 본다. tol=0이면 «비트 동일». */
function weldMap(pos: Float32Array, tol: number): Int32Array {
  const n = pos.length / 3;
  const map = new Int32Array(n);
  const seen = new Map<string, number>();
  const q = (v: number) => (tol > 0 ? Math.round(v / tol) : v);
  for (let i = 0; i < n; i++) {
    const k = `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}`;
    const hit = seen.get(k);
    if (hit === undefined) {
      seen.set(k, i);
      map[i] = i;
    } else map[i] = hit;
  }
  return map;
}

const EKEY = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);

function makeFind(n: number) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  return {
    find,
    uni: (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    },
  };
}

type Topo = {
  verts: number;
  tris: number;
  openEdges: number;
  nonManifold: number;
  windingClash: number;
  components: number;
  degenerate: number;
  edges: number;
};

function topology(pos: Float32Array, idx: Uint32Array, map: Int32Array): Topo {
  const tris = idx.length / 3;
  const use = new Map<number, number>();
  const dir = new Map<number, number>();
  let degenerate = 0;
  const uf = makeFind(pos.length / 3);
  const vseen = new Set<number>();
  for (let t = 0; t < tris; t++) {
    const v = [map[idx[t * 3]], map[idx[t * 3 + 1]], map[idx[t * 3 + 2]]];
    for (const x of v) vseen.add(x);
    uf.uni(v[0], v[1]);
    uf.uni(v[1], v[2]);
    if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) {
      degenerate++;
      continue;
    }
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const k = EKEY(a, b);
      use.set(k, (use.get(k) ?? 0) + 1);
      dir.set(k, (dir.get(k) ?? 0) + (a < b ? 1 : -1));
    }
  }
  let openEdges = 0;
  let nonManifold = 0;
  let windingClash = 0;
  for (const [k, c] of use) {
    if (c === 1) openEdges++;
    else if (c > 2) nonManifold++;
    else if (dir.get(k) !== 0) windingClash++; // c===2 인데 같은 방향 ⟹ 배향 불일치
  }
  const roots = new Set<number>();
  for (const v of vseen) roots.add(uf.find(v));
  return {
    verts: vseen.size,
    tris,
    openEdges,
    nonManifold,
    windingClash,
    components: roots.size,
    degenerate,
    edges: use.size,
  };
}

/** 엣지 길이 분위 — §2-2가 격자 간격을 «도출»할 때 쓰는 측정 입력.
 * SDF는 메시가 «표현하지 못하는» 세부를 표현할 수 없으므로 엣지 길이가 상한이다. */
function edgeStats(pos: Float32Array, idx: Uint32Array, map: Int32Array) {
  const seen = new Set<number>();
  const len: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const v = [map[idx[t * 3]], map[idx[t * 3 + 1]], map[idx[t * 3 + 2]]];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (a === b) continue;
      const k = EKEY(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      len.push(
        Math.hypot(
          pos[a * 3] - pos[b * 3],
          pos[a * 3 + 1] - pos[b * 3 + 1],
          pos[a * 3 + 2] - pos[b * 3 + 2],
        ),
      );
    }
  }
  len.sort((x, y) => x - y);
  const q = (f: number) => len[Math.min(len.length - 1, Math.floor(f * len.length))];
  return { n: len.length, p05: q(0.05), p50: q(0.5), p95: q(0.95), min: len[0], max: len[len.length - 1] };
}

/** 성분별 크기 — 어느 성분이 «몸»인지 가르기 위해 삼각형 수·bbox·열린 엣지를 낸다. */
function componentBreakdown(pos: Float32Array, idx: Uint32Array, map: Int32Array) {
  const uf = makeFind(pos.length / 3);
  for (let t = 0; t < idx.length / 3; t++) {
    uf.uni(map[idx[t * 3]], map[idx[t * 3 + 1]]);
    uf.uni(map[idx[t * 3 + 1]], map[idx[t * 3 + 2]]);
  }
  const acc = new Map<number, { tris: number; lo: number[]; hi: number[]; open: number }>();
  const use = new Map<number, number>();
  const rootOf = new Map<number, number>();
  for (let t = 0; t < idx.length / 3; t++) {
    const v = [map[idx[t * 3]], map[idx[t * 3 + 1]], map[idx[t * 3 + 2]]];
    const r = uf.find(v[0]);
    let a = acc.get(r);
    if (!a) {
      a = {
        tris: 0,
        lo: [Infinity, Infinity, Infinity],
        hi: [-Infinity, -Infinity, -Infinity],
        open: 0,
      };
      acc.set(r, a);
    }
    a.tris++;
    for (const vi of v)
      for (let k = 0; k < 3; k++) {
        a.lo[k] = Math.min(a.lo[k], pos[vi * 3 + k]);
        a.hi[k] = Math.max(a.hi[k], pos[vi * 3 + k]);
      }
    if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) continue;
    for (let e = 0; e < 3; e++) {
      const k = EKEY(v[e], v[(e + 1) % 3]);
      use.set(k, (use.get(k) ?? 0) + 1);
      rootOf.set(k, r);
    }
  }
  for (const [k, c] of use) if (c === 1) acc.get(rootOf.get(k)!)!.open++;
  return [...acc.values()].sort((x, y) => y.tris - x.tris);
}

const P = (x: number, d = 3) => x.toFixed(d);

console.log(`[v3-13] §1 원본 마네킹 수밀성 — «직접» 잰다 (v3-10 §1-2는 인용이었다)`);
console.log(`[대상] ${GLB}  ·  v2 코드 임포트 0 (glTF 2.0 규격대로 데이터만 읽는다)`);

const { prims, required } = readGlb(GLB);
console.log(
  `[컨테이너] extensionsRequired=${JSON.stringify(required)} · 삼각형 프리미티브 ${prims.length}개`,
);

for (const p of prims) {
  console.log(`\n── ${p.name} · 정점 ${p.pos.length / 3} · 삼각형 ${p.idx.length / 3}`);
  const ident = Int32Array.from({ length: p.pos.length / 3 }, (_, i) => i);
  const rows: [string, Topo][] = [
    ['원시 인덱스', topology(p.pos, p.idx, ident)],
    ['위치 용접(비트 동일)', topology(p.pos, p.idx, weldMap(p.pos, 0))],
    ['위치 용접(1µm)', topology(p.pos, p.idx, weldMap(p.pos, 1e-6))],
  ];
  console.log(
    `   ${'기준'.padEnd(22)}${'정점'.padStart(9)}${'삼각형'.padStart(9)}${'열린엣지'.padStart(10)}${'비다양체'.padStart(10)}${'와인딩불일치'.padStart(14)}${'연결성분'.padStart(10)}${'퇴화삼각'.padStart(10)}`,
  );
  for (const [name, t] of rows)
    console.log(
      `   ${name.padEnd(22)}${String(t.verts).padStart(9)}${String(t.tris).padStart(9)}${String(t.openEdges).padStart(10)}` +
        `${String(t.nonManifold).padStart(10)}${String(t.windingClash).padStart(14)}${String(t.components).padStart(10)}${String(t.degenerate).padStart(10)}`,
    );

  // 오일러 지표 — 닫힌 «구» 위상이면 χ = V − E + F = 2, 종수 g = (2−χ)/2 = 0.
  // 열린 엣지 0과 «독립»인 확인이다(손잡이·터널이 있으면 열린 엣지 0이어도 χ < 2).
  const w = rows[1][1];
  const chi = w.verts - w.edges + w.tris;
  console.log(
    `   오일러 지표: V ${w.verts} − E ${w.edges} + F ${w.tris} = χ ${chi}  ⟹  종수 g = ${(2 - chi) / 2}` +
      `  (닫힌 구 위상이면 χ=2 · g=0)`,
  );
  const es = edgeStats(p.pos, p.idx, weldMap(p.pos, 0));
  console.log(
    `   엣지 길이[mm]: 최소 ${P(es.min * 1000, 2)} · p05 ${P(es.p05 * 1000, 2)} · 중앙 ${P(es.p50 * 1000, 2)} · p95 ${P(es.p95 * 1000, 2)} · 최대 ${P(es.max * 1000, 2)}  (엣지 ${es.n}개)`,
  );

  const comps = componentBreakdown(p.pos, p.idx, weldMap(p.pos, 0));
  console.log(`   성분별(위치 용접 기준 · 삼각형 많은 순 · 상위 12):`);
  console.log(
    `   ${'#'.padStart(4)}${'삼각형'.padStart(9)}${'열린엣지'.padStart(10)}   ${'bbox x[m]'.padEnd(18)}${'bbox y[m]'.padEnd(18)}${'bbox z[m]'.padEnd(18)}`,
  );
  for (const [i, c] of comps.slice(0, 12).entries())
    console.log(
      `   ${String(i).padStart(4)}${String(c.tris).padStart(9)}${String(c.open).padStart(10)}   ` +
        `${`${P(c.lo[0])}~${P(c.hi[0])}`.padEnd(18)}${`${P(c.lo[1])}~${P(c.hi[1])}`.padEnd(18)}${`${P(c.lo[2])}~${P(c.hi[2])}`.padEnd(18)}`,
    );
  if (comps.length > 12) console.log(`   … 그 외 ${comps.length - 12}개 성분`);
}


/* ══ §2 격자 도출 · §3-② 자기검사 · §3-③ 부호 교차검증 · §3-⑤ 비용 ══════ */

/** 옷 두께 [m] — S3·S3b와 «같은 값» */
const THICK = 1e-3;
/** 메모리 예산 — 이미 상주하는 GLB 자산(38.6 MB)보다 큰 SDF는 정당화되지 않는다.
 * 그 위의 2의 거듭제곱 = 64 MB를 상한으로 둔다(손 상수가 아니라 «측정된 자산»에 앵커). */
const BUDGET = 64 * 1024 * 1024;
/** ②의 문턱 — 격자 간격의 X%. **실행 «전»에 고정한다.**
 * 사유: 주 오차항은 삼선형 보간의 곡률항 h²/(4R)이고, h에 대한 «비»로 쓰면 h/(4R)다.
 * 시험 반지름 R≥50mm에서 h=3.75mm면 1.88%. 삼각화 새기타(sagitta)와 띠 가장자리
 * 효과에 2.6배 여유를 두어 5%로 잡는다. 결과를 보고 고치지 않는다. */
const X_PCT = 5;

const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** UV 구 — **수밀**. 극은 «한 점»으로 둔다 — 고리로 두면 퇴화 삼각형이 생겨
 * 용접 후에도 열린 엣지가 남는다(초판 실측: 열린 160 · χ=161 ⟹ 패리티가 보장되지 않는다). */
function sphereMesh(R: number, seg: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const rings = Math.max(2, Math.round(seg / 2));
  pos.push(0, R, 0); // 북극 = 정점 0
  for (let j = 1; j < rings; j++) {
    const th = (j / rings) * Math.PI;
    for (let i = 0; i < seg; i++) {
      const ph = (i / seg) * 2 * Math.PI;
      pos.push(R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph));
    }
  }
  const south = pos.length / 3;
  pos.push(0, -R, 0);
  const ring = (j: number, i: number) => 1 + (j - 1) * seg + (((i % seg) + seg) % seg);
  for (let i = 0; i < seg; i++) idx.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < rings - 1; j++)
    for (let i = 0; i < seg; i++)
      idx.push(ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j, i), ring(j + 1, i + 1), ring(j + 1, i));
  for (let i = 0; i < seg; i++) idx.push(south, ring(rings - 1, i), ring(rings - 1, i + 1));
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

/** 뚜껑 있는 원기둥(축 = y) — **수밀 · 배향 일치**.
 * 초판은 뚜껑 두 개가 «안쪽»으로 감겨 와인딩 불일치 256이 잡혔다. */
function cylMesh(R: number, halfLen: number, seg: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const y of [-halfLen, halfLen])
    for (let i = 0; i < seg; i++) {
      const ph = (i / seg) * 2 * Math.PI;
      pos.push(R * Math.cos(ph), y, R * Math.sin(ph));
    }
  const cBot = pos.length / 3; pos.push(0, -halfLen, 0);
  const cTop = pos.length / 3; pos.push(0, halfLen, 0);
  const bo = (i: number) => ((i % seg) + seg) % seg;
  const to = (i: number) => seg + bo(i);
  for (let i = 0; i < seg; i++) {
    idx.push(bo(i), to(i), to(i + 1), bo(i), to(i + 1), bo(i + 1)); // 옆면(바깥 = 지름 +)
    idx.push(cBot, bo(i), bo(i + 1)); // 아래 뚜껑(바깥 = −y)
    idx.push(cTop, to(i + 1), to(i)); // 위 뚜껑(바깥 = +y)
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

const sphereSdf = (R: number) => (x: number, y: number, z: number) => Math.hypot(x, y, z) - R;
/** 뚜껑 있는 원기둥의 해석 SDF(축 = y) */
const cylSdf = (R: number, hl: number) => (x: number, y: number, z: number) => {
  const dr = Math.hypot(x, z) - R;
  const dy = Math.abs(y) - hl;
  return Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0);
};

const prim0 = prims[0];
const weld = weldMap(prim0.pos, 0);
// 용접된 정점만 남긴 배열로 다시 만든다(패리티·거리 계산은 위치만 보므로 인덱스만 사상)
const bodyIdx = Uint32Array.from(prim0.idx, (v) => weld[v]);
const bext: [number, number, number] = [1.78, 1.765, 0.282];

console.log(`\n══ §2 격자 도출 (손 상수 0) ══`);
const spec = deriveSpacing(bext, BUDGET, THICK);
console.log(
  `   예산 ${(BUDGET / 1024 ** 2).toFixed(0)} MB (상주 GLB ${(38630440 / 1024 ** 2).toFixed(1)} MB 위의 2의 거듭제곱) · 두께 ${THICK * 1000}mm · bbox ${bext.map((v) => (v * 1000).toFixed(0)).join('×')}mm`,
);
console.log(
  `   ⟹ h = ${(spec.h * 1000).toFixed(3)} mm · band = ${(spec.band * 1000).toFixed(3)} mm · 복셀 ${spec.voxels.toExponential(3)} · ${(spec.bytes / 1024 ** 2).toFixed(1)} MB`,
);
console.log(
  `   h/두께 = ${(spec.h / THICK).toFixed(2)}배.  h ≤ 두께(1mm)는 ${((0.88596 / 1e-9) * 4 / 1024 ** 3).toFixed(2)} GB로 «원리적으로 불가능» ⟹ 오차를 정량화한다`,
);
console.log(
  `   보간 오차 h²/(4R): R=40mm ${((spec.h ** 2 / (4 * 0.04)) * 1000).toFixed(3)}mm (두께의 ${((spec.h ** 2 / (4 * 0.04)) / THICK * 100).toFixed(1)}%) · R=20mm ${((spec.h ** 2 / (4 * 0.02)) * 1000).toFixed(3)}mm`,
);

console.log(`\n══ §3-② SDF 자기검사 — 해석 형상을 «같은 파이프라인»으로 굽는다 ══`);
console.log(`   [문턱] 오차 ≤ 격자 간격의 ${X_PCT}% = ${(spec.h * X_PCT / 100 * 1000).toFixed(3)} mm  (실행 «전» 고정)`);
console.log(
  `   ${'형상'.padEnd(22)}${'삼각형'.padStart(8)}${'표본'.padStart(8)}${'평균오차[mm]'.padStart(14)}${'p99[mm]'.padStart(11)}${'최대[mm]'.padStart(11)}${'최대/h'.padStart(9)}${'판정'.padStart(7)}`,
);
let ok2 = true;
// S3의 해석 충돌체는 **평면 · 구 · «무한» 원기둥**이다(`Collider` 정의 — 뚜껑이 없다).
// 그래서 원기둥은 «뚜껑에서 먼» 대역만 판정하고 «무한» 원기둥 SDF와 대조한다.
// 뚜껑 모서리는 S3의 정의역에 원래 없고, 사람 몸에도 그런 예리한 볼록 모서리가 없다.
// 그 대역은 아래에서 «참고»로 따로 찍는다(크레이스에서 삼선형은 O(h²)가 아니라 O(h)).
const CYL_HL = 0.1;
const cases: [
  string,
  { pos: Float32Array; idx: Uint32Array },
  (x: number, y: number, z: number) => number,
  ((x: number, y: number, z: number) => boolean) | null,
][] = [
  ['구 R=50mm', sphereMesh(0.05, 160), sphereSdf(0.05), null],
  [
    '원기둥 R=40mm(무한 대역)',
    cylMesh(0.04, CYL_HL, 128),
    (x, _y, z) => Math.hypot(x, z) - 0.04,
    (_x, y) => Math.abs(y) < CYL_HL - 0.02,
  ],
  ['원기둥 뚜껑 모서리(참고·게이트 밖)', cylMesh(0.04, CYL_HL, 128), cylSdf(0.04, CYL_HL), null],
];
for (const [name, mesh, exact, dom] of cases) {
  const gate = !name.includes('참고');
  const g = bakeSdf(mesh.pos, mesh.idx, spec.h, spec.band);
  const rnd = lcg(12345);
  let n = 0, sum = 0, max = 0;
  const errs: number[] = [];
  for (let s = 0; s < 200000 && n < 20000; s++) {
    const x = g.ox + rnd() * (g.nx - 1) * g.h;
    const y = g.oy + rnd() * (g.ny - 1) * g.h;
    const z = g.oz + rnd() * (g.nz - 1) * g.h;
    if (dom && !dom(x, y, z)) continue; // 정의역 밖(뚜껑 대역)
    const e = exact(x, y, z);
    if (Math.abs(e) > g.band - g.h) continue; // 띠 «안»에서만 판정한다(밖은 잘려 있다)
    const got = sampleSdf(g, x, y, z);
    const err = Math.abs(got - e);
    errs.push(err); sum += err; if (err > max) max = err; n++;
  }
  errs.sort((a, b) => a - b);
  const p99 = errs[Math.floor(errs.length * 0.99)] ?? 0;
  // 시험 형상 자체가 «수밀»인지 먼저 본다 — 패리티는 수밀에서만 정확하다.
  // 그리고 오차가 «부호 뒤집힘»인지 «크기 오차»인지 가른다: 부호가 뒤집히면
  // 오차 = 2|d| 라 겉보기 최대값이 커진다(구현 결함), 크레이스 평활은 그렇지 않다.
  {
    const ident = Int32Array.from({ length: mesh.pos.length / 3 }, (_, i) => i);
    const tw = topology(mesh.pos, mesh.idx, weldMap(mesh.pos, 0));
    const tr = topology(mesh.pos, mesh.idx, ident);
    const chi = tw.verts - tw.edges + tw.tris;
    const rnd2 = lcg(12345);
    let flip = 0, flipMax = 0, sameMax = 0, m = 0;
    for (let s2 = 0; s2 < 200000 && m < 20000; s2++) {
      const x = g.ox + rnd2() * (g.nx - 1) * g.h;
      const y = g.oy + rnd2() * (g.ny - 1) * g.h;
      const z = g.oz + rnd2() * (g.nz - 1) * g.h;
      if (dom && !dom(x, y, z)) continue;
      const e = exact(x, y, z);
      if (Math.abs(e) > g.band - g.h) continue;
      const got = sampleSdf(g, x, y, z);
      const err = Math.abs(got - e);
      if (got < 0 !== e < 0) { flip++; flipMax = Math.max(flipMax, err); }
      else sameMax = Math.max(sameMax, err);
      m++;
    }
    console.log(
      `      [진단] 시험메시 수밀: 열린 ${tw.openEdges} · 비다양체 ${tw.nonManifold} · 와인딩 ${tw.windingClash} · 성분 ${tw.components} · χ ${chi}` +
        `  (원시 인덱스 열린 ${tr.openEdges})`,
    );
    console.log(
      `      [진단] 부호 뒤집힘 ${flip}/${m} (${(flip / m * 100).toFixed(3)}%) · 뒤집힘 최대오차 ${(flipMax * 1000).toFixed(4)}mm · «부호 같은» 표본 최대오차 ${(sameMax * 1000).toFixed(4)}mm = ${(sameMax / spec.h * 100).toFixed(2)}% of h`,
    );
  }
  const pass = max <= (spec.h * X_PCT) / 100;
  if (gate) ok2 &&= pass;
  console.log(
    `   ${name.padEnd(22)}${String(mesh.idx.length / 3).padStart(8)}${String(n).padStart(8)}` +
      `${(sum / n * 1000).toFixed(4).padStart(14)}${(p99 * 1000).toFixed(4).padStart(11)}${(max * 1000).toFixed(4).padStart(11)}` +
      `${((max / spec.h) * 100).toFixed(2).padStart(8)}%${(gate ? (pass ? 'PASS' : 'FAIL') : '참고').padStart(7)}`,
  );
}
console.log(`   ⟹ ② ${ok2 ? 'PASS (도구를 믿을 수 있다)' : 'FAIL — 갈래 G · ③④를 판정하지 않는다'}`);

console.log(`\n══ §3-⑤ 몸 SDF 굽기 — 비용 ══`);
const t0 = performance.now();
const bodyG: GridSdf = bakeSdf(prim0.pos, bodyIdx, spec.h, spec.band);
const bakeMs = performance.now() - t0;
let inside = 0;
for (let i = 0; i < bodyG.data.length; i++) if (bodyG.data[i] < 0) inside++;
console.log(
  `   격자 ${bodyG.nx}×${bodyG.ny}×${bodyG.nz} = ${(bodyG.nx * bodyG.ny * bodyG.nz).toExponential(3)} 복셀 · ${(bodyG.data.byteLength / 1024 ** 2).toFixed(1)} MB`,
);
console.log(
  `   굽기 ${bakeMs.toFixed(0)} ms · 안쪽 복셀 ${inside} (${(inside / bodyG.data.length * 100).toFixed(2)}%) · 삼각형 ${bodyIdx.length / 3}`,
);
const rq = lcg(777);
const NQ = 2e6;
const t1 = performance.now();
let acc = 0;
for (let i = 0; i < NQ; i++)
  acc += sampleSdf(bodyG, bodyG.ox + rq() * (bodyG.nx - 1) * bodyG.h, bodyG.oy + rq() * (bodyG.ny - 1) * bodyG.h, bodyG.oz + rq() * (bodyG.nz - 1) * bodyG.h);
const qMs = performance.now() - t1;
console.log(`   질의 ${NQ.toExponential(0)}회 ${qMs.toFixed(0)} ms = ${(qMs * 1e6 / NQ).toFixed(1)} ns/질의  (acc=${acc.toFixed(3)} · 최적화 제거 방지)`);

console.log(`\n══ §3-③ 부호 일관성 — 독립 방법(임의 방향 레이 패리티)과 교차검증 ══`);
console.log(`   기준: v1 Stage 1a가 «최근접 면 법선» 계열에서 등재한 부호 모순 2.95%`);
{
  const P0 = prim0.pos;
  // 독립 구현: 임의 방향 광선 3개의 «다수결» — 격자도, x축도, 버킷도 쓰지 않는다
  const insideByRay = (x: number, y: number, z: number, rnd: () => number) => {
    let vote = 0;
    for (let r = 0; r < 3; r++) {
      let dx = rnd() * 2 - 1, dy = rnd() * 2 - 1, dz = rnd() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      let cnt = 0;
      for (let t = 0; t < bodyIdx.length; t += 3) {
        const a = bodyIdx[t] * 3, b = bodyIdx[t + 1] * 3, c = bodyIdx[t + 2] * 3;
        const e1x = P0[b] - P0[a], e1y = P0[b + 1] - P0[a + 1], e1z = P0[b + 2] - P0[a + 2];
        const e2x = P0[c] - P0[a], e2y = P0[c + 1] - P0[a + 1], e2z = P0[c + 2] - P0[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-16) continue;
        const inv = 1 / det;
        const tx = x - P0[a], ty = y - P0[a + 1], tz = z - P0[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) cnt++;
      }
      if (cnt & 1) vote++;
    }
    return vote >= 2;
  };
  const rs = lcg(2024);
  const N = Number(process.env.SIGN_N ?? 3000);
  let checked = 0, mismatch = 0, nearSurf = 0, nearMismatch = 0;
  const ts = performance.now();
  for (let s = 0; s < N; s++) {
    const x = bodyG.ox + rs() * (bodyG.nx - 1) * bodyG.h;
    const y = bodyG.oy + rs() * (bodyG.ny - 1) * bodyG.h;
    const z = bodyG.oz + rs() * (bodyG.nz - 1) * bodyG.h;
    const d = sampleSdf(bodyG, x, y, z);
    const truth = insideByRay(x, y, z, rs);
    checked++;
    const near = Math.abs(d) < bodyG.h; // 표면 «한 칸» 안 — 부호가 원래 모호한 대역
    if (near) nearSurf++;
    if (d < 0 !== truth) { mismatch++; if (near) nearMismatch++; }
  }
  console.log(
    `   표본 ${checked} · 불일치 ${mismatch} (${(mismatch / checked * 100).toFixed(3)}%) · 그중 표면 ±h 대역 ${nearMismatch} · 대역 표본 ${nearSurf} · ${((performance.now() - ts) / 1000).toFixed(1)}s`,
  );
  const far = mismatch - nearMismatch;
  console.log(
    `   표면 ±h를 «뺀» 불일치 = ${far} (${(far / Math.max(1, checked - nearSurf) * 100).toFixed(3)}%)  ← v1 2.95%와 대조할 값`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * v3-14 — §1 문턱 재도출 · §2 실제 몸 정량화 · §3 재판정
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── §1 문턱 재도출 — 유도에서 나온다. v3-13 실측을 «보지 않고» 정한다 ────────
 *
 * 유도(1차원): [0,h]에서 f의 선형 보간 L은
 *     L(t) − f(th) = (f''·h²/2)·t(1−t),   t = 0..1
 * 이고 t=½에서 최대 **f''·h²/8**이다. f''>0(볼록)이면 보간이 «과대평가»한다.
 * 삼선형은 축 3개의 1차 오차 합이므로 셀 위상이 최악(t_k=½)일 때
 *     d̃ − d = (h²/8)·Σ_k ∂²d/∂x_k² = (h²/8)·∇²d.
 * 표면에서 ∇²d = κ₁ + κ₂ 이므로
 *
 *     **P_pred = (h²/8)·(κ₁+κ₂)**      구 h²/(4R) · 원기둥 h²/(8R) · 평면 0
 *
 * 천 정점은 d̃ = thickness 인 자리에 앉는다. 거기서 «참» 거리는 d = d̃ − (d̃−d)
 * 이므로 **관통 = 보간 오차 그 자체**다. P_pred는 이 표현의 «원리적 하한»이고,
 * 1µm 문턱은 해석 SDF(오차 0)에서 나온 값이라 이 표현에 요구할 수 없는 정확도였다.
 *
 * **문턱은 고정 상수가 아니라 예측값의 함수다**: 관통 ≤ P_pred × (1 + MARGIN).
 * MARGIN 근거: 버린 다음 항이 O(h³·∇³d)이고 P_pred 대비 상대 크기가 **O(h·κ) = h/R**.
 * h=3.951mm에서 h/R ≤ 0.20 이려면 **R ≥ 19.8mm** ⟹ MARGIN = 0.25 · 유효 범위 R ≥ 20mm.
 *
 * **일치 조건**(「작다」가 아니라 「설명된다」): 실측 / P_pred ∈ [0.5, 1.25].
 * 상한은 문턱과 같다. 하한 0.5의 근거: 접촉 정점이 수백 개면 셀 위상 t_k가 조밀히
 * 표집되므로 최댓값이 최악 위상값의 절반에는 도달해야 한다 — 훨씬 작으면 곡률 기전이
 * 지배적이지 않다는 뜻이고 「설명된다」를 주장할 근거가 없다(작다고 통과시키지 않는다).
 * 평면은 P_pred = 0이라 비가 정의되지 않는다 ⟹ **관통 = 0을 «정확히» 요구**한다.
 */
const ONLY14 = (process.env.ONLY ?? '').split(',').filter(Boolean);
const run14 = (k: string) => ONLY14.length === 0 || ONLY14.includes(k);
/* v3-15 §1 — 크레이스 항(형태·계수는 §2 실측 «전»에 고정 · 유도는 §1 블록 주석) */
const CREASE_C = 0.283;
const creaseF = (th: number) => Math.min(1, th / (Math.PI / 2));
const MARGIN = 0.25;
const MATCH_LO = 0.5;
const MATCH_HI = 1.25;
const R_VALID = 0.02;

/** 격자에서 잰 예측 관통 = (1/8)·Σ_k [d(x+h e_k) − 2d(x) + d(x−h e_k)].
 * h²∇²d/8 을 «격자 스케일 2차 차분»으로 그대로 쓴다 — 곡률을 따로 추정하지 않는다
 * (보간 오차를 만드는 것이 바로 그 스케일의 2차 차분이므로 근사가 아니라 정의다). */
function predPen(g: GridSdf, x: number, y: number, z: number): number {
  const c = sampleSdf(g, x, y, z);
  return (
    (sampleSdf(g, x + g.h, y, z) + sampleSdf(g, x - g.h, y, z) +
      sampleSdf(g, x, y + g.h, z) + sampleSdf(g, x, y - g.h, z) +
      sampleSdf(g, x, y, z + g.h) + sampleSdf(g, x, y, z - g.h) - 6 * c) / 8
  );
}

/** 점–삼각형 제곱 거리(하네스 사본 — 솔버 모듈과 «독립») */
function pointTriSq2(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const d3 = abx * (px - bx) + aby * (py - by) + abz * (pz - bz);
    const d4 = acx * (px - bx) + acy * (py - by) + acz * (pz - bz);
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
      } else {
        const d5 = abx * (px - cx) + aby * (py - cy) + abz * (pz - cz);
        const d6 = acx * (px - cx) + acy * (py - cy) + acz * (pz - cz);
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const ddx = px - qx, ddy = py - qy, ddz = pz - qz;
  return ddx * ddx + ddy * ddy + ddz * ddz;
}

/** 브루트포스 «정확» 무부호 거리 (전 삼각형). 격자와 공유 코드 0. */
function exactDist(pos: Float32Array, idx: Uint32Array, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const d2 = pointTriSq2(x, y, z,
      pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** 브루트포스 «정확» 부호 — 임의 방향 광선 3개 다수결(격자·x축·버킷 미사용). */
function exactInside(
  pos: Float32Array, idx: Uint32Array, x: number, y: number, z: number, rnd: () => number,
): boolean {
  let vote = 0;
  for (let r = 0; r < 3; r++) {
    let dx = rnd() * 2 - 1, dy = rnd() * 2 - 1, dz = rnd() * 2 - 1;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let cnt = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-16) continue;
      const inv = 1 / det;
      const tx = x - pos[a], ty = y - pos[a + 1], tz = z - pos[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) cnt++;
    }
    if (cnt & 1) vote++;
  }
  return vote >= 2;
}

console.log(`\n╔══ v3-14 §1 문턱 재도출 (유도에서 · v3-13 실측을 «보지 않고» 고정) ══╗`);
console.log(`   P_pred = (h²/8)·∇²d = (h²/8)·(κ₁+κ₂)   [구 h²/4R · 원기둥 h²/8R · 평면 0]`);
console.log(`   유도: 1D 선형보간 오차 (f''h²/2)·t(1−t) → t=½에서 f''h²/8 ⟹ 삼선형은 축 3개 합`);
console.log(`   천은 d̃ = 두께 인 자리에 앉으므로 **관통 = 보간 오차 그 자체**다`);
console.log(`   [문턱]     관통 ≤ P_pred × (1 + ${MARGIN})   — 고정 상수 아님`);
console.log(`   [여유근거] 버린 다음 항이 P_pred 대비 O(h·κ)=h/R. h=${(spec.h * 1000).toFixed(3)}mm에서 h/R ≤ 0.20 ⟺ R ≥ ${((spec.h / 0.2) * 1000).toFixed(1)}mm`);
console.log(`   [유효범위] R ≥ ${R_VALID * 1000}mm (더 뾰족한 특징은 §2-③ 소관)`);
console.log(`   [일치조건] 실측 / P_pred ∈ [${MATCH_LO}, ${MATCH_HI}] — 「작다」가 아니라 「설명된다」`);
console.log(`   [평면]     P_pred = 0 ⟹ 비가 정의되지 않는다 ⟹ 관통 = 0 을 «정확히» 요구`);

/* ── §2 실제 몸에서의 정량화 ─────────────────────────────────────────────── */
const rndG = lcg(4242);
const NV = prim0.pos.length / 3;

/** 부위 분류 — **T포즈에서는 팔이 수평이라 «높이»만으로는 몸통과 팔이 섞인다.**
 * 실측이 그것을 드러냈다: 높이만으로 가른 「가슴·등」의 최소 R_eff가 4.5mm였는데
 * 그것은 가슴이 아니라 «손가락»이다(팔이 어깨 높이로 수평으로 뻗어 있다).
 * ⟹ 높이 × |x| 로 «두 축» 모두 가른다. 계기 정의역을 대상에 맞춘다. */
const TORSO_X = 0.2;
const SLEEVE_X = 0.35;
function region(x: number, y: number): string {
  const f = (y - 0.004) / (1.769 - 0.004);
  const ax = Math.abs(x);
  // 높이가 낮으면 |x|가 커도 «다리»다 — T포즈에서 두 다리가 벌어져 있어
  // |x| 조건만으로는 발목이 「상완」으로 들어온다(실측: 상완 최악이 y=0.007이었다).
  if (f < 0.5) return '다리·발';
  if (ax > SLEEVE_X) return '전완·손';
  if (ax > TORSO_X) return '상완';
  if (f >= 0.88) return '머리·목';
  if (f >= 0.8) return '어깨';
  if (f >= 0.7) return '가슴·등';
  if (f >= 0.6) return '허리·배';
  if (f >= 0.5) return '엉덩이';
  return '다리·발';
}
/** 티셔츠(반팔) 접촉 대역 — 세로 엉덩이~목, 가로 소매 끝까지.
 * **정의를 먼저 적고 표는 부위별로 전량 낸다**(전략 세션이 다시 자를 수 있게). */
const inShirt = (x: number, y: number) => {
  const f = (y - 0.004) / (1.769 - 0.004);
  return Math.abs(x) <= SLEEVE_X && f >= 0.55 && f <= 0.92;
};

if (run14('2a')) {
  console.log(`\n╔══ §2-① 접촉 대역 곡률 분포 (격자에서 직접) ══╗`);
  console.log(`   P_pred = (h²/8)·∇²d 를 메시 정점마다 격자 2차 차분으로 잰다 · R_eff = h²/(4·P_pred)`);
  console.log(`   **부위는 높이 × |x| 로 가른다** — T포즈는 팔이 수평이라 높이만으로는 섞인다`);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < NV; i++) {
    const x = prim0.pos[i * 3], y = prim0.pos[i * 3 + 1], z = prim0.pos[i * 3 + 2];
    const p = predPen(bodyG, x, y, z);
    if (!(p > 0)) continue;
    const r = region(x, y);
    let a = groups.get(r);
    if (!a) groups.set(r, (a = []));
    a.push(p);
  }
  console.log(
    `   ${'부위'.padEnd(12)}${'정점'.padStart(7)}${'P_pred 중앙[mm]'.padStart(16)}${'p95[mm]'.padStart(10)}${'최대[mm]'.padStart(10)}${'최소 R_eff[mm]'.padStart(15)}`,
  );
  for (const nm of ['머리·목', '어깨', '가슴·등', '상완', '허리·배', '엉덩이', '전완·손', '다리·발']) {
    const v = groups.get(nm);
    if (!v || !v.length) continue;
    v.sort((a, b) => a - b);
    const mx = v[v.length - 1];
    console.log(
      `   ${nm.padEnd(12)}${String(v.length).padStart(7)}${(v[Math.floor(v.length * 0.5)] * 1000).toFixed(4).padStart(16)}` +
        `${(v[Math.floor(v.length * 0.95)] * 1000).toFixed(4).padStart(10)}${(mx * 1000).toFixed(4).padStart(10)}${((spec.h ** 2 / (4 * mx)) * 1000).toFixed(1).padStart(15)}`,
    );
  }
  const sh: number[] = [];
  for (let i = 0; i < NV; i++) {
    const x = prim0.pos[i * 3], y = prim0.pos[i * 3 + 1];
    if (!inShirt(x, y)) continue;
    const p = predPen(bodyG, x, y, prim0.pos[i * 3 + 2]);
    if (p > 0) sh.push(p);
  }
  sh.sort((a, b) => a - b);
  const q = (f: number) => sh[Math.floor(sh.length * f)];
  console.log(
    `   ⟹ **티셔츠 대역**(|x| ≤ ${SLEEVE_X * 1000}mm · 0.55~0.92 H · ${sh.length}정점):` +
      ` P_pred 중앙 ${(q(0.5) * 1000).toFixed(4)} · p95 ${(q(0.95) * 1000).toFixed(4)} · 최대 ${(sh[sh.length - 1] * 1000).toFixed(4)} mm` +
      ` · 최소 R_eff ${((spec.h ** 2 / (4 * sh[sh.length - 1])) * 1000).toFixed(1)}mm`,
  );
}

if (run14('2b')) {
  console.log(`\n╔══ §2-② 오목 크레비스 검사 — «표적» 표본(균일 표본이 놓쳤을 수 있다) ══╗`);
  console.log(`   메시 정점에서 무작위 방향으로 U(0, 2h) 떨어진 점을 뽑는다 ⟹ 표면 근방을`);
  console.log(`   «빠짐없이» 덮는다(크레비스는 정점 밀도가 높아 오히려 더 촘촘히 표집된다)`);
  console.log(`   **판정 기준**: 「메움」 = 참은 «밖»인데 격자가 «안»이라 하고, 그 «참 거리»가`);
  console.log(`   보간 오차 규모를 넘는 경우. 표면에 붙은 점(참 거리 ~0)의 부호 불일치는`);
  console.log(`   크레비스가 아니라 «표면 위 부호 모호»다 — 둘을 섞으면 판정이 무의미해진다.`);
  const N = Number(process.env.CREV_N ?? 2500);
  const bins = [0.25, 0.5, 1, 2];
  const binTot = new Array(bins.length).fill(0);
  const binBad = new Array(bins.length).fill(0);
  let signBad = 0, maxMagErr = 0;
  const filled: { x: number; y: number; z: number; ed: number; grid: number }[] = [];
  const t0 = performance.now();
  for (let s2 = 0; s2 < N; s2++) {
    const vi = Math.floor(rndG() * NV);
    let dx = rndG() * 2 - 1, dy = rndG() * 2 - 1, dz = rndG() * 2 - 1;
    const l = Math.hypot(dx, dy, dz) || 1;
    const r = rndG() * 2 * spec.h;
    const x = prim0.pos[vi * 3] + (dx / l) * r;
    const y = prim0.pos[vi * 3 + 1] + (dy / l) * r;
    const z = prim0.pos[vi * 3 + 2] + (dz / l) * r;
    const eD = exactDist(prim0.pos, bodyIdx, x, y, z);
    const eIn = exactInside(prim0.pos, bodyIdx, x, y, z, rndG);
    const gD = sampleSdf(bodyG, x, y, z);
    const bi = bins.findIndex((b) => eD <= b * spec.h);
    if (bi >= 0) binTot[bi]++;
    const bad = gD < 0 !== (eIn ? -eD : eD) < 0;
    if (bad) {
      signBad++;
      if (bi >= 0) binBad[bi]++;
      if (!eIn && gD < 0) filled.push({ x, y, z, ed: eD, grid: gD });
    }
    const magErr = Math.abs(Math.abs(gD) - eD);
    if (eD < bodyG.band - bodyG.h && magErr > maxMagErr) maxMagErr = magErr;
  }
  console.log(
    `   표본 ${N} · 부호 불일치 ${signBad} (${((signBad / N) * 100).toFixed(3)}%) · 띠 안 크기오차 최대 ${(maxMagErr * 1000).toFixed(4)}mm · ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`   부호 불일치를 «참 거리»로 가르면 (표면에서 멀수록 실제 결함):`);
  let prev = 0;
  for (let b = 0; b < bins.length; b++) {
    console.log(
      `      참거리 ${(prev * spec.h * 1000).toFixed(2)}~${(bins[b] * spec.h * 1000).toFixed(2)}mm : ${String(binBad[b]).padStart(4)} / ${String(binTot[b]).padStart(4)}  (${binTot[b] ? ((binBad[b] / binTot[b]) * 100).toFixed(2) : '—'}%)`,
    );
    prev = bins[b];
  }
  filled.sort((a, b) => b.ed - a.ed);
  const worstEd = filled.length ? filled[0].ed : 0;
  console.log(
    `   「참=밖 · 격자=안」 ${filled.length}건 · **참 거리 최대 ${(worstEd * 1000).toFixed(4)}mm** (h/2 = ${((spec.h / 2) * 1000).toFixed(3)}mm)`,
  );
  for (const f of filled.slice(0, 5))
    console.log(
      `      x ${f.x.toFixed(4)} y ${f.y.toFixed(4)} z ${f.z.toFixed(4)} · 참 거리 ${(f.ed * 1000).toFixed(4)}mm · 격자 ${(f.grid * 1000).toFixed(4)}mm`,
    );
  const genuine = worstEd > spec.h / 2;
  console.log(
    `   ⟹ ${genuine ? `**메워진 크레비스 있음** — 참 거리 ${(worstEd * 1000).toFixed(3)}mm > h/2 ⟹ 갈래 C` : `**메워진 크레비스 0건.** 「참=밖·격자=안」의 참 거리가 전부 h/2 미만이라 크레비스 메움이 아니라 «표면 위 부호 모호»다`}`,
  );
  console.log(`   ⟹ 이 몸에서 격자가 못 담은 «틈»의 하한: 관측된 최소 특징이 h=${(spec.h * 1000).toFixed(3)}mm보다 좁은 자리가 위 목록이다`);
}

if (run14('2c')) {
  console.log(`\n╔══ §2-③ 뾰족 볼록 특징 (R_eff < ${R_VALID * 1000}mm = 문턱 유효 범위 밖) ══╗`);
  const per = new Map<string, { n: number; worst: number; wx: number; wy: number }>();
  let cnt = 0;
  let inShirtCnt = 0;
  let shirtWorst = { p: 0, x: 0, y: 0 };
  for (let i = 0; i < NV; i++) {
    const x = prim0.pos[i * 3], y = prim0.pos[i * 3 + 1], z = prim0.pos[i * 3 + 2];
    const p = predPen(bodyG, x, y, z);
    if (!(p > 0)) continue;
    if (spec.h ** 2 / (4 * p) >= R_VALID) continue;
    cnt++;
    const r = region(x, y);
    let a = per.get(r);
    if (!a) per.set(r, (a = { n: 0, worst: 0, wx: 0, wy: 0 }));
    a.n++;
    if (p > a.worst) { a.worst = p; a.wx = x; a.wy = y; }
    if (inShirt(x, y)) {
      inShirtCnt++;
      if (p > shirtWorst.p) shirtWorst = { p, x, y };
    }
  }
  console.log(`   R_eff < ${R_VALID * 1000}mm 정점 ${cnt} / ${NV} (${((cnt / NV) * 100).toFixed(2)}%) — 부위별:`);
  console.log(`   ${'부위'.padEnd(12)}${'정점'.padStart(7)}${'최악 P_pred[mm]'.padStart(16)}${'R_eff[mm]'.padStart(11)}   위치(x, y)`);
  for (const [nm, a] of [...per.entries()].sort((u, v) => v[1].n - u[1].n))
    console.log(
      `   ${nm.padEnd(12)}${String(a.n).padStart(7)}${(a.worst * 1000).toFixed(4).padStart(16)}` +
        `${((spec.h ** 2 / (4 * a.worst)) * 1000).toFixed(1).padStart(11)}   ${a.wx.toFixed(3)}, ${a.wy.toFixed(3)}`,
    );
  console.log(
    `   ⟹ **티셔츠 대역 안의 뾰족 정점 ${inShirtCnt}개**` +
      (inShirtCnt
        ? ` · 최악 P_pred ${(shirtWorst.p * 1000).toFixed(4)}mm (R_eff ${((spec.h ** 2 / (4 * shirtWorst.p)) * 1000).toFixed(1)}mm) @ x ${shirtWorst.x.toFixed(3)} y ${shirtWorst.y.toFixed(3)}`
        : ''),
  );
  console.log(`   ⟹ 티셔츠 대역 안에 뾰족 정점이 있으면 **갈래 F 성립**(정지 아님 · 한계 등재)`);
}

/* ── §3-2 실제 몸 SDF 위에 천을 떨어뜨린다 ──────────────────────────────────
 *
 * **장면 정의를 «먼저» 적는다**(계기 규범): 반팔 티셔츠 접촉 대역인 «어깨»에 140mm
 * 정사각 천을 수평으로 띄워 떨어뜨린다. 어깨는 §2-①에서 P_pred 최대 0.4720mm ·
 * 최소 R_eff 8.3mm으로 **티셔츠 대역에서 가장 굽은 축**에 속한다 — 가장 불리한 자리를 고른다.
 * 머리(|x| ≲ 0.09)를 피하려고 x를 0.10~0.24로 잡는다.
 * **초기 적법성**(정확한 메시 거리 > 두께)을 실행 «전»에 값으로 확인한다.
 */
if (run14('3')) {
  console.log(`\n╔══ §3-2 실제 몸 SDF 낙하 — 어깨(티셔츠 대역) ══╗`);
  const NU2 = Number(process.env.CLOTH_NU ?? 15);
  // **어깨 «위»에 얹는 판은 미끄러져 떨어졌다**(접촉 정점 0 · |v| 1765mm/s) — 어깨는
  // 경사면이고 μ=0.3의 임계각(16.7°)보다 가파르다. 그래서 «상완에 걸친다»: 수평으로
  // 뻗은 상완(반지름 ~40mm · T포즈에서 x축)에 천을 가로질러 덮으면 양쪽으로 늘어져
  // 미끄러져 나갈 수 없다. 상완은 반팔 소매의 접촉 대역이고, 원기둥형이라 S3 ①의
  // 원기둥 시험을 «실제 몸»에서 그대로 반복하는 셈이다.
  // 팔의 «실제» 위치를 메시에서 확인하고 맞췄다: x 0.30~0.40 구간에서 상완은
  // y 1.373~1.457 · z −0.087~0.012 (반지름 ≈45mm · 중심 y≈1.415 z≈−0.038).
  // 초판은 z 중심을 +0.02로 잡아 «팔 옆»으로 흘러내렸다(접촉 0 · |v| 1635mm/s).
  const CL = { x0: 0.3, x1: 0.4, z0: -0.158, z1: 0.082, y0: 1.52 };
  const du = (CL.x1 - CL.x0) / (NU2 - 1);
  const dv2 = (CL.z1 - CL.z0) / (NU2 - 1);
  const n = NU2 * NU2;
  const uv = new Float64Array(n * 2);
  const tris: number[] = [];
  for (let j = 0; j < NU2; j++)
    for (let i = 0; i < NU2; i++) {
      const v = j * NU2 + i;
      uv[v * 2] = i * du;
      uv[v * 2 + 1] = j * dv2;
    }
  for (let j = 0; j < NU2 - 1; j++)
    for (let i = 0; i < NU2 - 1; i++) {
      const a = j * NU2 + i;
      tris.push(a, a + 1, a + NU2, a + 1, a + NU2 + 1, a + NU2);
    }
  const sv = makeSolver(n);
  for (let v = 0; v < n; v++) {
    sv.pos[v * 3] = CL.x0 + uv[v * 2];
    sv.pos[v * 3 + 1] = CL.y0;
    sv.pos[v * 3 + 2] = CL.z0 + uv[v * 2 + 1];
  }
  // 초기 적법성 — 정확한 메시 거리가 두께보다 커야 한다
  let initMin = Infinity;
  for (let v = 0; v < n; v++)
    initMin = Math.min(initMin, exactDist(prim0.pos, bodyIdx, sv.pos[v * 3], sv.pos[v * 3 + 1], sv.pos[v * 3 + 2]));
  console.log(
    `   장면: ${NU2}×${NU2} 천 ${((CL.x1 - CL.x0) * 1000).toFixed(0)}×${((CL.z1 - CL.z0) * 1000).toFixed(0)}mm @ x ${CL.x0}~${CL.x1} · y ${CL.y0} · z ${CL.z0}~${CL.z1}`,
  );
  console.log(
    `   [초기] 정확한 메시 거리 최소 ${(initMin * 1000).toFixed(2)}mm (두께 ${THICK * 1000}mm) ⟹ ${initMin > THICK ? '적법' : '위법 — 장면 무효'}`,
  );
  if (initMin <= THICK) {
    console.log(`   ⟹ §3-2 판정 불가 — 초기 상태가 몸과 겹친다`);
  } else {
    const MATG = { rho: 0.187, B: 23.191698e-6 };
    assignMassFromMesh(sv, tris, uv, MATG.rho, new Set());
    const bends = makeBend(tris, uv, MATG.B);
    const con: Constraint[] = [...makeInplane(tris, uv, 100, 100, 100), ...bends];
    const sub = Math.max(
      substepsForCloth(1 / 60, 100, MATG.rho, Math.min(du, dv2), 0.95),
      substepsForBending(1 / 60, sv, bends, 0.95),
    );
    const secs = Number(process.env.CLOTH_T ?? 2);
    const t0 = performance.now();
    const p: SolverParams = {
      dt: 1 / 60, substeps: sub, gravity: 9.81, damping: 6,
      collision: { colliders: [{ kind: 'grid', g: bodyG }], thickness: THICK, mu: 0.3 },
    };
    for (let f = 0; f < Math.round(secs / (1 / 60)); f++) step(sv, con, p);
    const ms = performance.now() - t0;
    // 관통은 «정확한 메시»로 잰다(격자로 재면 자기 자신을 재는 것이다)
    const rr = lcg(99);
    let pen = 0, penCnt = 0, predMax = 0, vmax = 0, contact = 0;
    for (let v = 0; v < n; v++) {
      const x = sv.pos[v * 3], y = sv.pos[v * 3 + 1], z = sv.pos[v * 3 + 2];
      vmax = Math.max(vmax, Math.hypot(sv.vel[v * 3], sv.vel[v * 3 + 1], sv.vel[v * 3 + 2]));
      const eD = exactDist(prim0.pos, bodyIdx, x, y, z);
      const inside = exactInside(prim0.pos, bodyIdx, x, y, z, rr);
      const signed = inside ? -eD : eD;
      const pn = THICK - signed;
      if (signed < 2 * THICK) {
        contact++;
        predMax = Math.max(predMax, predPen(bodyG, x, y, z));
      }
      if (pn > 1e-6) { penCnt++; pen = Math.max(pen, pn); }
    }
    // v3-15 §3 — 접촉점의 «국소 이면각 결손»을 메시에서 뽑아 확장 문턱을 만든다.
    // 문턱·일치 구간은 v3-14 §1에 «이미 등록된» 값을 그대로 쓴다(§2를 보고 고치지 않는다).
    const eMap = new Map<number, number[]>();
    const wB = weldMap(prim0.pos, 0);
    for (let t = 0; t < bodyIdx.length / 3; t++)
      for (let k = 0; k < 3; k++) {
        const a = wB[bodyIdx[t * 3 + k]], b2 = wB[bodyIdx[t * 3 + ((k + 1) % 3)]];
        if (a === b2) continue;
        const key = EKEY(a, b2);
        let ar = eMap.get(key);
        if (!ar) eMap.set(key, (ar = []));
        ar.push(t);
      }
    const triN = (t: number) => {
      const a = bodyIdx[t * 3] * 3, b2 = bodyIdx[t * 3 + 1] * 3, c2 = bodyIdx[t * 3 + 2] * 3;
      const ux = prim0.pos[b2] - prim0.pos[a], uy = prim0.pos[b2 + 1] - prim0.pos[a + 1], uz = prim0.pos[b2 + 2] - prim0.pos[a + 2];
      const vx = prim0.pos[c2] - prim0.pos[a], vy = prim0.pos[c2 + 1] - prim0.pos[a + 1], vz = prim0.pos[c2 + 2] - prim0.pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L2 = Math.hypot(nx, ny, nz) || 1;
      return [nx / L2, ny / L2, nz / L2];
    };
    const triTheta = (t: number) => {
      const out: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = wB[bodyIdx[t * 3 + k]], b2 = wB[bodyIdx[t * 3 + ((k + 1) % 3)]];
        const ar = eMap.get(EKEY(a, b2));
        if (!ar || ar.length !== 2) continue;
        const o = ar[0] === t ? ar[1] : ar[0];
        const n1 = triN(t), n2 = triN(o);
        out.push(Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))));
      }
      out.sort((x, y2) => x - y2);
      return [out[Math.floor(out.length / 2)] ?? 0, out[out.length - 1] ?? 0] as [number, number];
    };
    const thetas: number[] = [];
    const thetasMax: number[] = [];
    for (let v = 0; v < n; v++) {
      const x = sv.pos[v * 3], y = sv.pos[v * 3 + 1], z = sv.pos[v * 3 + 2];
      let bestT = -1, bestD = Infinity;
      for (let t = 0; t < bodyIdx.length / 3; t++) {
        const a = bodyIdx[t * 3] * 3, b2 = bodyIdx[t * 3 + 1] * 3, c2 = bodyIdx[t * 3 + 2] * 3;
        const d2 = pointTriSq2(x, y, z, prim0.pos[a], prim0.pos[a + 1], prim0.pos[a + 2],
          prim0.pos[b2], prim0.pos[b2 + 1], prim0.pos[b2 + 2], prim0.pos[c2], prim0.pos[c2 + 1], prim0.pos[c2 + 2]);
        if (d2 < bestD) { bestD = d2; bestT = t; }
      }
      if (bestT >= 0 && Math.sqrt(bestD) < 2 * THICK) { const tt = triTheta(bestT); thetas.push(tt[0]); thetasMax.push(tt[1]); }
    }
    thetas.sort((a, b2) => a - b2);
    const thMedB = thetas[Math.floor(thetas.length / 2)] ?? 0;
    thetasMax.sort((a, b2) => a - b2);
    const qq = (arr: number[], f: number) => arr[Math.floor(arr.length * f)] ?? 0;
    console.log(
      `   [v3-15] 접촉점 θ 분포[°] — 삼각형 3엣지 «중앙»: 중앙 ${((thMedB * 180) / Math.PI).toFixed(2)} · p95 ${((qq(thetas, 0.95) * 180) / Math.PI).toFixed(2)} · 최대 ${((qq(thetas, 0.999) * 180) / Math.PI).toFixed(2)}` +
        `  /  «최대»: 중앙 ${((qq(thetasMax, 0.5) * 180) / Math.PI).toFixed(2)} · p95 ${((qq(thetasMax, 0.95) * 180) / Math.PI).toFixed(2)} · 최대 ${((qq(thetasMax, 0.999) * 180) / Math.PI).toFixed(2)}`,
    );
    {
      const alt = CREASE_C * creaseF(qq(thetasMax, 0.5)) * spec.h + predMax;
      console.log(
        `   [v3-15·감도] θ 통계를 «삼각형 최대»로 잡으면 P_ext ${(alt * 1000).toFixed(4)}mm · 실측/P_ext ${(pen / alt).toFixed(3)}` +
          `  ← **이 통계는 사전 등록되지 않았다.** 주 판정은 등록·구현된 «중앙»으로 낸다`,
      );
    }
    const pCre = CREASE_C * creaseF(thMedB) * spec.h;
    const predExt = predMax + pCre;
    console.log(
      `   [v3-15] 접촉점 국소 이면각 결손 중앙 ${((thMedB * 180) / Math.PI).toFixed(2)}° (표본 ${thetas.length}) ⟹ P_crease ${(pCre * 1000).toFixed(4)}mm · P_pred_ext ${(predExt * 1000).toFixed(4)}mm`,
    );
    // v3-16 §1 통계 — 점별 P_ext 의 최댓값 (매끈한 항과 «같은» 통계로 맞춘다)
    {
      const edB = edgeDihedrals(prim0.pos, bodyIdx);
      let pMax = 0, thAtWorst = 0, worstPen = 0;
      const pts: number[] = [];
      const rr2 = lcg(77);
      for (let v = 0; v < n; v++) {
        const x = sv.pos[v * 3], y = sv.pos[v * 3 + 1], z = sv.pos[v * 3 + 2];
        const eD = exactDist(prim0.pos, bodyIdx, x, y, z);
        const signed = exactInside(prim0.pos, bodyIdx, x, y, z, rr2) ? -eD : eD;
        if (signed >= 2 * THICK) continue;
        const th_i = thetaAt(edB, x, y, z, spec.h);
        const pe = predPen(bodyG, x, y, z) + CREASE_C * creaseF(th_i) * spec.h;
        pts.push(pe);
        if (pe > pMax) pMax = pe;
        if (THICK - signed > worstPen) { worstPen = THICK - signed; thAtWorst = th_i; }
      }
      pts.sort((a, b2) => a - b2);
      const pq = (f: number) => pts[Math.floor(pts.length * f)] ?? 0;
      const rp = pMax > 0 ? pen / pMax : Infinity;
      console.log(
        `   [v3-16] 점별 P_ext[mm] 중앙 ${(pq(0.5) * 1000).toFixed(4)} · p95 ${(pq(0.95) * 1000).toFixed(4)} · 최대 ${(pMax * 1000).toFixed(4)} (표본 ${pts.length})`,
      );
      console.log(
        `   [v3-16] 최대 관통이 난 점의 θ_i = ${((thAtWorst * 180) / Math.PI).toFixed(2)}° · 문턱 ${(pMax * (1 + MARGIN) * 1000).toFixed(4)}mm ⟹ ${pen <= pMax * (1 + MARGIN) ? 'PASS' : 'FAIL'}`,
      );
      console.log(
        `   [v3-16] 실측/P_ext = ${rp.toFixed(3)} ∈ [${MATCH_LO}, ${MATCH_HI}] ⟹ ${rp >= MATCH_LO && rp <= MATCH_HI ? 'PASS(설명된다)' : 'FAIL'}  ⟹ **§3 ${pen <= pMax * (1 + MARGIN) && rp >= MATCH_LO && rp <= MATCH_HI ? 'PASS' : 'FAIL'}**`,
      );
    }
    const thrE = predExt * (1 + MARGIN);
    const ratE = predExt > 0 ? pen / predExt : Infinity;
    console.log(
      `   [v3-15] 확장 문턱 ${(thrE * 1000).toFixed(4)}mm ⟹ ${pen <= thrE ? 'PASS' : 'FAIL'} · 실측/P_ext = ${ratE.toFixed(3)} ∈ [${MATCH_LO}, ${MATCH_HI}] ⟹ ${ratE >= MATCH_LO && ratE <= MATCH_HI ? 'PASS(설명된다)' : 'FAIL'}`,
    );
    console.log(`   [v3-15] ⟹ §3 ${pen <= thrE && ratE >= MATCH_LO && ratE <= MATCH_HI ? 'PASS' : 'FAIL'}  (문턱·구간은 v3-14 §1 등록값 그대로)`);
    const thr = predMax * (1 + MARGIN);
    const ratio = predMax > 0 ? pen / predMax : Infinity;
    console.log(
      `   정점 ${n} · sub ${sub} · T ${secs}s · ${ms.toFixed(0)}ms · |v|max ${(vmax * 1000).toFixed(2)}mm/s · 접촉 정점 ${contact}`,
    );
    console.log(
      `   관통 정점 ${penCnt} · 최대 관통 ${(pen * 1000).toFixed(4)}mm · P_pred(접촉점 최대) ${(predMax * 1000).toFixed(4)}mm`,
    );
    const okThr = pen <= thr;
    const okMatch = ratio >= MATCH_LO && ratio <= MATCH_HI;
    console.log(
      `   문턱 ${(thr * 1000).toFixed(4)}mm ⟹ ${okThr ? 'PASS' : 'FAIL'} · 실측/예측 = ${ratio.toFixed(3)} ∈ [${MATCH_LO}, ${MATCH_HI}] ⟹ ${okMatch ? 'PASS(설명된다)' : 'FAIL(설명되지 않는다)'}`,
    );
    console.log(`   ⟹ §3-2 ${okThr && okMatch ? 'PASS' : 'FAIL'}`);
  }
}

/* ══ v3-15 §1 크레이스 항 «형태 등록» + §2 면분할 대조 + §3 몸 재판정 ══════
 *
 * 유도: 볼록 크레이스의 «부채꼴»(결손각 θ) 안에서 참 거리는 모서리까지 반경 r이고
 * ∇²r = 1/r 이다. 삼선형 오차 (h²/8)·∇²d 는 r ~ h/2 에서 ≈ h/4 로 «포화»하며 θ와
 * 무관하다. 다만 반경 r에서 부채꼴 폭이 r·θ 이므로 θ가 작으면 셀의 «일부»만 부채꼴에
 * 들어가고 오차가 그 분율만큼 준다 ⟹ **θ에 선형 · 1 rad 부근 포화**.
 *   P_crease = c·f(θ)·h,  f(θ) = min(1, θ/(π/2)),  c = 0.283   (v3-13 뚜껑 90° 실측)
 *   P_pred_ext = P_smooth + P_crease
 * **e ≳ h에서 유효** — e < h면 크레이스가 셀 밑으로 들어가 평균화된다(§2의 대조점).
 * **§2 결과를 보고 고치지 않는다.** */

if (run14('4')) {
  console.log(`\n╔══ v3-15 §1 크레이스 항 등록 (실측 «전») ══╗`);
  console.log(`   P_pred_ext = P_smooth + ${CREASE_C}·min(1, θ/(π/2))·h   [θ = 이면각 결손]`);
  console.log(`   유도: 부채꼴 안 ∇²r=1/r ⟹ r~h/2에서 h/4 포화 · 부채꼴 폭 r·θ ⟹ θ에 선형`);
  console.log(`   c는 v3-13 뚜껑 원기둥 90° 실측(28.30% of h)에서. e ≳ h에서 유효`);

  console.log(`\n╔══ §2 면분할 대조 — 같은 구(R=50mm) · 엣지 길이«만» 바꾼다 ══╗`);
  const R = 0.05;
  const targets = [0.002, 0.006, 0.012, 0.02];
  const P_smooth = spec.h ** 2 / (4 * R);
  console.log(`   P_smooth = h²/(4R) = ${(P_smooth * 1000).toFixed(4)}mm · h = ${(spec.h * 1000).toFixed(3)}mm`);
  console.log(`   대조군(면분할 0 · 해석 함수로 채운 격자) = v3-13 §3-④ 실측/예측 **0.982**`);
  console.log(
    `   ${'목표e[mm]'.padStart(9)}${'실제중앙e[mm]'.padStart(13)}${'삼각형'.padStart(8)}${'θ중앙[°]'.padStart(9)}${'수밀'.padStart(6)}${'관통[mm]'.padStart(10)}${'/P_smooth'.padStart(10)}${'/P_ext'.padStart(9)}`,
  );
  const MATG = { rho: 0.187, B: 23.191698e-6 };
  const rows: { e: number; ratS: number; ratE: number; th: number }[] = [];
  const ratPt: number[] = [];
  for (const te of targets) {
    const seg = Math.max(8, Math.round((2 * Math.PI * R) / te));
    const m = sphereMesh(R, seg);
    const w = weldMap(m.pos, 0);
    const topo = topology(m.pos, m.idx, w);
    const chi = topo.verts - topo.edges + topo.tris;
    const ok = topo.openEdges === 0 && topo.nonManifold === 0 && topo.windingClash === 0 && chi === 2;
    const es = edgeStats(m.pos, m.idx, w);
    // 이면각 결손 — 인접 두 면 법선 사이 각
    const nrm = (t: number) => {
      const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
      const ux = m.pos[b] - m.pos[a], uy = m.pos[b + 1] - m.pos[a + 1], uz = m.pos[b + 2] - m.pos[a + 2];
      const vx = m.pos[c] - m.pos[a], vy = m.pos[c + 1] - m.pos[a + 1], vz = m.pos[c + 2] - m.pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };
    const emap = new Map<number, number[]>();
    for (let t = 0; t < m.idx.length / 3; t++)
      for (let k = 0; k < 3; k++) {
        const a = w[m.idx[t * 3 + k]], b = w[m.idx[t * 3 + ((k + 1) % 3)]];
        if (a === b) continue;
        const key = EKEY(a, b);
        let ar = emap.get(key);
        if (!ar) emap.set(key, (ar = []));
        ar.push(t);
      }
    const ths: number[] = [];
    for (const ar of emap.values()) {
      if (ar.length !== 2) continue;
      const n1 = nrm(ar[0]), n2 = nrm(ar[1]);
      ths.push(Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))));
    }
    ths.sort((a, b) => a - b);
    const thMed = ths[Math.floor(ths.length / 2)] ?? 0;
    const g = bakeSdf(m.pos, m.idx, spec.h, spec.band);
    // 낙하 장면 — 네 경우에 «같은» 장면
    const NU3 = 15, L3 = 0.08;
    const du3 = L3 / (NU3 - 1), n3 = NU3 * NU3;
    const uv3 = new Float64Array(n3 * 2);
    const tri3: number[] = [];
    for (let j = 0; j < NU3; j++) for (let i = 0; i < NU3; i++) { const v = j * NU3 + i; uv3[v * 2] = i * du3; uv3[v * 2 + 1] = j * du3; }
    for (let j = 0; j < NU3 - 1; j++) for (let i = 0; i < NU3 - 1; i++) { const a = j * NU3 + i; tri3.push(a, a + 1, a + NU3, a + 1, a + NU3 + 1, a + NU3); }
    const s3 = makeSolver(n3);
    for (let v = 0; v < n3; v++) { s3.pos[v * 3] = uv3[v * 2] - L3 / 2; s3.pos[v * 3 + 1] = R + 0.02; s3.pos[v * 3 + 2] = uv3[v * 2 + 1] - L3 / 2; }
    let initMin = Infinity;
    for (let v = 0; v < n3; v++) initMin = Math.min(initMin, exactDist(m.pos, m.idx, s3.pos[v * 3], s3.pos[v * 3 + 1], s3.pos[v * 3 + 2]));
    assignMassFromMesh(s3, tri3, uv3, MATG.rho, new Set());
    const bd3 = makeBend(tri3, uv3, MATG.B);
    const con3: Constraint[] = [...makeInplane(tri3, uv3, 100, 100, 100), ...bd3];
    const sub3 = Math.max(substepsForCloth(1 / 60, 100, MATG.rho, du3, 0.95), substepsForBending(1 / 60, s3, bd3, 0.95));
    const pp: SolverParams = { dt: 1 / 60, substeps: sub3, gravity: 9.81, damping: 6, collision: { colliders: [{ kind: 'grid', g }], thickness: THICK, mu: 0.3 } };
    for (let f = 0; f < 120; f++) step(s3, con3, pp);
    const rr = lcg(31);
    let pen = 0;
    const edD = edgeDihedrals(m.pos, m.idx);
    let pExtPt = 0; // v3-16 §1 통계: 점별 P_ext 의 최댓값
    for (let v = 0; v < n3; v++) {
      const x = s3.pos[v * 3], y = s3.pos[v * 3 + 1], z = s3.pos[v * 3 + 2];
      const eD = exactDist(m.pos, m.idx, x, y, z);
      const signed = exactInside(m.pos, m.idx, x, y, z, rr) ? -eD : eD;
      pen = Math.max(pen, THICK - signed);
      if (signed < 2 * THICK)
        pExtPt = Math.max(pExtPt, predPen(g, x, y, z) + CREASE_C * creaseF(thetaAt(edD, x, y, z, spec.h)) * spec.h);
    }
    const pExt = P_smooth + CREASE_C * creaseF(thMed) * spec.h;
    ratPt.push(pExtPt > 0 ? pen / pExtPt : Infinity);
    rows.push({ e: es.p50, ratS: pen / P_smooth, ratE: pen / pExt, th: thMed });
    console.log(
      `   ${(te * 1000).toFixed(0).padStart(9)}${(es.p50 * 1000).toFixed(2).padStart(13)}${String(m.idx.length / 3).padStart(8)}` +
        `${((thMed * 180) / Math.PI).toFixed(2).padStart(9)}${(ok ? 'OK' : `χ${chi}`).padStart(6)}${(pen * 1000).toFixed(4).padStart(10)}` +
        `${(pen / P_smooth).toFixed(3).padStart(10)}${(pen / pExt).toFixed(3).padStart(9)}` +
        (initMin > THICK ? '' : '  [초기 위법]'),
    );
  }
  const grow = rows[rows.length - 1].ratS > rows[0].ratS;
  console.log(
    `   ⟹ 비가 엣지 길이와 함께 ${grow ? '**커진다**(크레이스가 지배 기전)' : '**커지지 않는다**(크레이스 가설 반증 · 갈래 C)'}` +
      ` · e=2mm에서 /P_smooth = ${rows[0].ratS.toFixed(3)} (대조군 0.982)`,
  );
  console.log(
    `\n   [v3-16 §2 안전장치] 새 «점별 최대» 통계로 재계산한 실측/P_ext: ` +
      ratPt.map((r, i) => `e=${(targets[i] * 1000).toFixed(0)}mm ${r.toFixed(3)}`).join(' · '),
  );
  const mono = ratPt.every((r, i) => i === 0 || r >= ratPt[i - 1] * 0.7);
  console.log(
    `   구 계열 보존: e=2mm가 대조군 0.982 근방인가 ${Math.abs(ratPt[0] - 0.982) < 0.35 ? 'YES' : 'NO'} · ` +
      `전 대역이 일치 구간 [${MATCH_LO}, ${MATCH_HI}] 안인가 ${ratPt.every((r) => r >= MATCH_LO && r <= MATCH_HI) ? 'YES' : 'NO'} · 단조성 유지 ${mono ? 'YES' : 'NO'}`,
  );
}


/* ══ v3-16 §1 — θ의 «통계»를 구조에서 도출해 등록한다 ═══════════════════════
 * 문턱이 비교하는 것은 «최대 관통»이고 매끈한 항 P_smooth는 이미 «점별 → 최대»다.
 * 크레이스 항만 «전역 중앙»이어서 두 항의 통계가 어긋나 있었다 ⟹ 점별로 맞춘다.
 *   근방: 점에서 h 이내의 메시 엣지 — 삼선형 스텐실이 한 변 h이므로 그 안의
 *        기울기 불연속만 재구성에 관여한다.
 *   축약: **최대**. 여러 크레이스가 겹쳐도 셀의 선형 재구성 편차는 h/4로 «포화»하므로
 *        합이 아니라 «가장 가파른 하나»가 지배한다.
 * c·f·문턱·일치 구간은 v3-15 등록분을 «그대로» 쓴다. */
function edgeDihedrals(pos: Float32Array, idx: Uint32Array) {
  const w = weldMap(pos, 0);
  const em = new Map<number, number[]>();
  for (let t = 0; t < idx.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const a = w[idx[t * 3 + k]], b = w[idx[t * 3 + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = EKEY(a, b);
      let ar = em.get(key); if (!ar) em.set(key, (ar = [])); ar.push(t);
    }
  const N = (t: number) => {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; return [nx / L, ny / L, nz / L];
  };
  const out: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; th: number }[] = [];
  for (const [key, ar] of em) {
    if (ar.length !== 2) continue;
    const n1 = N(ar[0]), n2 = N(ar[1]);
    const th = Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2])));
    const b = key % 4194304, a = (key - b) / 4194304;
    out.push({ ax: pos[a * 3], ay: pos[a * 3 + 1], az: pos[a * 3 + 2], bx: pos[b * 3], by: pos[b * 3 + 1], bz: pos[b * 3 + 2], th });
  }
  return out;
}
/** 점에서 h 이내 엣지의 «최대» 이면각 결손 */
function thetaAt(ed: ReturnType<typeof edgeDihedrals>, x: number, y: number, z: number, h: number) {
  let best = 0;
  const h2 = h * h;
  for (const e of ed) {
    if (e.th <= best) continue;
    const ex = e.bx - e.ax, ey = e.by - e.ay, ez = e.bz - e.az;
    const ll = ex * ex + ey * ey + ez * ez;
    let t = ll > 0 ? ((x - e.ax) * ex + (y - e.ay) * ey + (z - e.az) * ez) / ll : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = e.ax + t * ex - x, dy = e.ay + t * ey - y, dz = e.az + t * ez - z;
    if (dx * dx + dy * dy + dz * dz <= h2) best = e.th;
  }
  return best;
}
