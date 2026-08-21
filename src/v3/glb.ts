/* v3-35 — glTF 2.0 바이너리 판독의 «순수» 부분.
 *
 * `scripts/v3Glb.ts` 에서 옮겼다. **접근자 판독부(`CT` · `NCOMP` · `readAccessor` ·
 * 프리미티브 순회)와 `weldMap` 은 원문 그대로**이고, 바꾼 것은 «헤더를 읽는 방법»뿐이다 —
 * Node `Buffer`(`readUInt32LE` · `toString('utf8')`)를 표준 `DataView` · `TextDecoder` 로
 * 옮겼다. 두 경로가 «같은 배열»을 내는지는 v3-35 §1-1이 값으로 확인한다.
 *
 * 왜 필요한가: 브라우저가 `useGLTF`(three)로 몸을 읽으면 정점 순서·병합이 달라질 수 있고,
 * 그러면 Node ↔ 브라우저 대조가 «판독기 차이»에 오염된다. **같은 판독기**를 써야 한다.
 *
 * 순수성(§0 ㉡): `node:` 임포트 0 · 파일 접근 0. 바이트를 «인자로» 받는다.
 */
export type Prim = { name: string; pos: Float32Array; idx: Uint32Array };

/** glTF 2.0 바이너리를 규격대로 읽는다(압축 확장이 있으면 «불가»로 멈춘다). */
export function parseGlb(buf: ArrayBuffer): { prims: Prim[]; required: string[] } {
  const head = new DataView(buf);
  if (head.getUint32(0, true) !== 0x46546c67) throw new Error('glTF 매직이 아니다');
  const jsonLen = head.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  let off = 20 + jsonLen;
  let bin: Uint8Array | undefined;
  while (off + 8 <= buf.byteLength) {
    const len = head.getUint32(off, true);
    const type = head.getUint32(off + 4, true);
    if (type === 0x004e4942) bin = new Uint8Array(buf, off + 8, len);
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
