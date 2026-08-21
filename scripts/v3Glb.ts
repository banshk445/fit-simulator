/* v3 — glTF 2.0 판독의 «Node 껍데기». 판독 자체는 `src/v3/glb.ts`(순수)에 있다.
 *
 * v3-35에서 순수부를 분리했다. 이 파일에 남은 것은 «파일에서 바이트를 읽는 것»뿐이다.
 * `weldMap` 은 순수부의 것을 그대로 다시 내보낸다 — 정의가 둘로 갈리지 않게 한다(#65).
 */
import { readFileSync } from 'node:fs';
import { parseGlb, weldMap, type Prim } from '../src/v3/glb.ts';

export type { Prim };
export { weldMap };

/** 파일에서 읽어 순수 판독기에 넘긴다. */
export function readGlb(path: string): { prims: Prim[]; required: string[] } {
  const b = readFileSync(path);
  return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}
