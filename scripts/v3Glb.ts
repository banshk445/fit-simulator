/* v3 — glTF 2.0 바이너리를 «규격대로» 직접 읽는다. v2 코드 임포트 0.
 *
 * v3-13(`scripts/v3Body.ts`)이 쓰던 판독기를 «그대로» 옮긴 것이다 — 문자 단위로
 * 같은 코드이고 동작이 바뀌지 않는다. S4가 같은 몸 메시를 읽어야 해서 모듈로 뺐다.
 * (`exactDist`·`exactInside`는 옮기지 «않는다» — 그 둘은 격자 SDF와 «독립»한
 *  하네스 사본이라는 것이 v3-13의 설계이고, 하네스마다 사본을 두는 편이 맞다.)
 */
import { readFileSync } from 'node:fs';

export type Prim = { name: string; pos: Float32Array; idx: Uint32Array };

/** glTF 2.0 바이너리를 규격대로 읽는다(압축 확장이 있으면 «불가»로 멈춘다). */
export function readGlb(path: string): { prims: Prim[]; required: string[] } {
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
export function weldMap(pos: Float32Array, tol: number): Int32Array {
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
