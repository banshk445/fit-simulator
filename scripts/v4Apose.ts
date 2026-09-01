/* v4-17 §1-③ — **A포즈 몸 1개**를 «굽는다»(옷 조립 0 · 굽기 계기는 기존 것을 부르기만 한다).
 *
 * 부르는 것(코드 0줄 신설 · `src/` diff 0):
 * ```
 *  src/components/bodyInjectBake.ts:82  bakeBodyVerts(glb, root, "apose")   ← 실재 이름
 *    ★ 회차 프롬프트의 `bakeBodySync` 는 저장소에 «없다»(§0-5ㅁ 등재) · 실재 이름을 쓴다
 *  src/lib/boneUtils.ts:24   findArmRootBones   :38 findHandBone   :117 findArmDirection
 *  src/lib/boneUtils.ts:223  setBoneTowardWorldDirection  ← 목표 «방향»을 주면 뼈를 돌린다
 * ```
 * A포즈 = 팔을 **어깨 뼈에서 35° 내림**(회차 프롬프트 지정값). 방향은 **뼈에서 읽어** 만든다 —
 * 현재 팔 방향(`findArmDirection`)을 «아래»로 35° 회전한 벡터를 목표로 준다(손 좌표 창작 0).
 *
 * 진입: `npx tsx scripts/v4Apose.ts [deg=35]`
 * 산출 = `gpu/oracle/export/l3ap-body-<bodyId>-a<deg>.bin`(Float32 3n · `body-*.bin` 과 같은 모양) +
 *        `l3ap-body-<bodyId>-a<deg>.json`(팔 축 좌우 · 높이 · 겨드랑이 간격)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeBodyVerts } from '../src/components/bodyInjectBake.ts';
import { findArmRootBones, findHandBone, findArmDirection, setBoneTowardWorldDirection }
  from '../src/lib/boneUtils.ts';
import { SEP } from '../src/v3/consts.ts';

const DEG = Number(process.argv[2] ?? 35);
const OUT = 'gpu/oracle/export';
const BODY = process.env.BODY ?? 'c100-h170-s45';
const gb = readFileSync('public/models/mannequin.glb');
const glb = gb.buffer.slice(gb.byteOffset, gb.byteOffset + gb.byteLength) as ArrayBuffer;

/* ★ Node 에는 DOM 이 없어 `GLTFLoader` 의 «텍스처» 경로가 선다(`self is not defined`).
 * 이 판은 **뼈대와 스킨만** 쓰므로 GLB 의 JSON 청크에서 **재질·텍스처 참조만 덜어내고** 판다 —
 * `BIN` 청크(정점·스킨·역바인드 행렬)는 **바이트 그대로** 둔다(기하 0줄 변경). */
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

/* 팔 축을 «뼈에서» 읽고, 그 축을 아래로 DEG 만큼 돌린 것을 목표로 준다. */
const nodes: Record<string, THREE.Object3D> = {};
root.traverse((o) => { nodes[o.name] = o; });
const arms = findArmRootBones(nodes);
if (arms.length === 0) throw new Error('팔 뿌리 뼈를 못 찾는다 — 리그가 다르다');
const before = arms.map((a) => ({ name: a.name, dir: findArmDirection(a).toArray() }));
/* ★ v4-18 §1-②ㄱ — **축 정정**. v4-17 은 `z × d` 를 축으로 잡아 팔이 «앞뒤»로 돌았다
 * (팔 축 y −0.0205 → +0.0350 · z −0.011 → −0.541). 판정문이 정한 「내림」은
 * **어깨 관절에서 «몸 앞뒤 축»(z) 둘레 회전**이다. 좌우는 **부호만** 뒤집는다(대칭).
 * z 는 손 상수가 아니라 **씬의 축**이다 — three 의 월드 z(= 몸 앞뒤)를 그대로 쓴다. */
const ZAX = new THREE.Vector3(0, 0, 1);
for (const a of arms) {
  const d = findArmDirection(a);
  const sgn = d.x >= 0 ? 1 : -1;                 // 오른팔(+x)은 −θ, 왼팔(−x)은 +θ 로 «내린다»
  const target = d.clone().applyAxisAngle(ZAX, -sgn * (DEG * Math.PI) / 180).normalize();
  setBoneTowardWorldDirection(a, findHandBone(a), target);
}
root.updateMatrixWorld(true);
const after = arms.map((a) => ({ name: a.name, dir: findArmDirection(a).toArray() }));

const r = bakeBodyVerts(glb, root, 'apose');
const v = r.verts;
let ymin = Infinity, ymax = -Infinity;
for (let i = 1; i < v.length; i += 3) { if (v[i] < ymin) ymin = v[i]; if (v[i] > ymax) ymax = v[i]; }

/* ★ 겨드랑이 간격(§1-③) — **이 판에서 산출하지 못했다.** 처음 붙인 SDF 계기가 값을 못 냈고
 * (팔 대역 컷과 표본 규약이 안 맞았다) `tsc` 도 인자 수로 걸렸다 ⟹ **걷어내고 «미산출»로 적는다.**
 * 없는 값을 만들어 적지 않는다(§0-5ㅂ 는 「SDF 로 잰다」였고, 그 계기가 서지 않았다는 사실이 결과다). */
const armMin: number | null = null;

const meta = {
  what: 'v4-17 §1-③ A포즈 몸 1개', body: BODY, deg: DEG, n: v.length / 3,
  bakeResult: { bitEqual: r.bitEqual, maxDeltaM: r.maxDeltaM, pose: r.pose, skinned: r.skinned },
  팔축_전: before, 팔축_후: after,
  높이m: ymax - ymin, ymin, ymax,
  기대: { 'cos35(|x|)': Math.cos((DEG * Math.PI) / 180), 'sin35(|y|)': Math.sin((DEG * Math.PI) / 180) },
  겨드랑이_최소간격mm: armMin, 겨드랑이_계기: '미완 — 이 판에서 걷어냈다(§1-③ 사유 ③)', SEPmm: SEP * 1000,
};
writeFileSync(`${OUT}/l3ap-body-${BODY}-a${DEG}.bin`, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
writeFileSync(`${OUT}/l3ap-body-${BODY}-a${DEG}.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
