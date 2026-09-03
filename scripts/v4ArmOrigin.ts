/* v4-26 §1-① — **어깨 피벗(대역 원점 C)을 «뼈에서» 읽는다**. 몸 blob 은 다시 굽지 않는다(굽기 0 · 손 상수 0).
 *
 * 왜 새 파일인가 — A포즈 몸 json(`l3ap-body-…json`)에는 **축(`팔축_후`)만** 있고 **관절 좌표가 없다**
 * (v4-26 §0-4ㄴ 등재). 그래서 v4-17/18 과 **같은 뼈 경로**로 팔 뿌리 뼈의 월드 좌표만 뜬다.
 *
 * 부르는 것(코드 0줄 신설): `src/lib/boneUtils.ts` `findArmRootBones`·`findHandBone`·`findArmDirection`·
 *   `setBoneTowardWorldDirection` — 회전 규칙은 `scripts/v4Apose.ts:79-85` 와 **같은 줄**이다(월드 z 둘레 · DEG 내림).
 *
 * 진입: `[BODY=c100-h170-s45] npx tsx scripts/v4ArmOrigin.ts [deg=35]`
 * 산출 = `gpu/oracle/export/l3ap-origin-<BODY>-a<deg>.json`
 *   `피벗` = 팔 뿌리 뼈 월드 좌표 · `중심선투영` = 그 점의 x 를 0 으로 둔 것(= 넘기는 C · §0-4ㄱ)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findArmRootBones, findHandBone, findArmDirection, setBoneTowardWorldDirection }
  from '../src/lib/boneUtils.ts';

const DEG = Number(process.argv[2] ?? 35);
const BODY = process.env.BODY ?? 'c100-h170-s45';
const OUT = 'gpu/oracle/export';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

/* GLB 텍스처 청크만 덜어낸다 — `scripts/v4Apose.ts:33-63` 과 «같은 함수»다(기하 0줄 변경). */
function stripTextures(buf: ArrayBuffer): ArrayBuffer {
  const dv = new DataView(buf);
  const total = dv.getUint32(8, true);
  let off = 12;
  let jsonStr = '', binChunk: Uint8Array | null = null;
  while (off < total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(buf, off + 8, len);
    if (type === 0x4e4f534a) jsonStr = new TextDecoder().decode(body);
    else if (type === 0x004e4942) binChunk = body;
    off += 8 + len;
  }
  const j = JSON.parse(jsonStr);
  delete j.images; delete j.textures; delete j.samplers;
  j.materials = (j.materials ?? []).map((m: Record<string, unknown>) => ({ name: m.name }));
  const je = new TextEncoder().encode(JSON.stringify(j));
  const jpad = (4 - (je.length % 4)) % 4;
  const bpad = binChunk ? (4 - (binChunk.length % 4)) % 4 : 0;
  const size = 12 + 8 + je.length + jpad + (binChunk ? 8 + binChunk.length + bpad : 0);
  const out = new ArrayBuffer(size);
  const o = new DataView(out), u = new Uint8Array(out);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, size, true);
  o.setUint32(12, je.length + jpad, true); o.setUint32(16, 0x4e4f534a, true);
  u.set(je, 20); u.fill(0x20, 20 + je.length, 20 + je.length + jpad);
  if (binChunk) {
    const b = 20 + je.length + jpad;
    o.setUint32(b, binChunk.length + bpad, true); o.setUint32(b + 4, 0x004e4942, true);
    u.set(binChunk, b + 8);
  }
  return out;
}

const root: THREE.Object3D = await new Promise((res, rej) =>
  new GLTFLoader().parse(stripTextures(glb), '', (g) => res(g.scene), rej));
root.updateMatrixWorld(true);

const nodes: Record<string, THREE.Object3D> = {};
root.traverse((o) => { nodes[o.name] = o; });
const arms = findArmRootBones(nodes);
if (arms.length === 0) throw new Error('팔 뿌리 뼈를 못 찾는다 — 리그가 다르다');
const ZAX = new THREE.Vector3(0, 0, 1);
for (const a of arms) {                                  // v4Apose.ts:79-85 와 같은 줄
  const d = findArmDirection(a);
  const sgn = d.x >= 0 ? 1 : -1;
  const target = d.clone().applyAxisAngle(ZAX, -sgn * (DEG * Math.PI) / 180).normalize();
  setBoneTowardWorldDirection(a, findHandBone(a), target);
}
root.updateMatrixWorld(true);

const rows = arms.map((a) => {
  const p = new THREE.Vector3();
  a.getWorldPosition(p);
  return { name: a.name, 피벗: [p.x, p.y, p.z] as [number, number, number],
           중심선투영: [0, p.y, p.z] as [number, number, number],
           방향: findArmDirection(a).toArray() };
});
const pick = (want: 'Left' | 'Right') => rows.find((r) => r.name.includes(want))!;
const meta = { what: 'v4-26 §1-① 어깨 피벗(대역 원점 C) — 뼈에서 읽는다 · 굽기 0', body: BODY, deg: DEG,
               'C 규약': '넘기는 값 = 중심선투영(x=0) — 대역 경계가 «몸 중심선에서 잰 길이»라서다(§0-4ㄱ)',
               left: pick('Left'), right: pick('Right') };
writeFileSync(`${OUT}/l3ap-origin-${BODY}-a${DEG}.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
