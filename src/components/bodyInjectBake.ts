/* v3-70 §1-③ — **메인 스레드 «몸 굽기» 연결부**(계기 성격 · 제품 화면 노출 0).
 *
 * v3-69 §1-1 이 값으로 밝힌 사실 둘이 이 파일의 설계를 고정한다:
 *   ㉠ v2 의 몸 변형은 **본 축별 스케일**이고(`Mannequin.tsx:310-385`),
 *   ㉡ 그 결과 정점은 **살아있는 씬 그래프에서만** 나온다(`bodySnapshot.ts:114-116`).
 * ⟹ v3 안에 본 스케일을 **재구현하지 않는다**(v3-70 §0-B ① — 이중 구현 발산 회피).
 *
 * **판독기는 «하나»여야 한다**(`src/v3/glb.ts` 머리주석): three 의 `useGLTF` 로 위치를 읽으면
 * 정점 순서·병합이 갈릴 수 있다. 그래서 **기준 위치는 `parseGlb` 에서 뜨고**, three 에서는
 * **«스킨 변환»만** 가져온다. 그래야 주입 배열이 `RunInput.bodyVerts` 규약 ①②(길이·순서)를
 * 구조적으로 만족한다.
 *
 * `applyBoneTransform(i, v)` 는 **바인드 포즈 «국소» 좌표**를 받아 **스킨 적용 국소 좌표**를 낸다.
 * 본 스케일은 `skeleton.boneMatrices` 를 타고 들어오고, 조상(루트)의 균등 스케일도
 * `bone.matrixWorld` 를 통해 반영된다 ⟹ **키·팔·다리·어깨·가슴둘레 5축이 모두 담긴다**.
 * 좌표계는 **GLB 프레임 그대로**다(메시 자신의 월드 행렬을 곱하지 않는다).
 */
import * as THREE from "three";
import { parseGlb } from "../v3/glb.ts";

export type BakeResult = {
  verts: Float32Array;
  /** `parseGlb` 배열과 **비트 동일**인가(㉮ 의 판정 채널). */
  bitEqual: boolean;
  /** 비트 동일이 아닐 때의 최대 편차[m]. 동일이면 0. */
  maxDeltaM: number;
  /** 실제로 순회한 정점 수. */
  n: number;
  /** 스킨드 메시를 못 찾으면 그대로 통과시킨다(그 사실을 남긴다). */
  skinned: boolean;
};

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let hit: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if (!hit && (o as THREE.SkinnedMesh).isSkinnedMesh) hit = o as THREE.SkinnedMesh; });
  return hit;
}

/**
 * GLB 바이트 + 살아있는 마네킹 → **주입용 몸 정점**.
 * `root` 가 없거나 스킨드 메시가 없으면 **`parseGlb` 배열을 그대로** 돌려준다(항등).
 */
export function bakeBodyVerts(glb: ArrayBuffer, root: THREE.Object3D | null): BakeResult {
  const base = parseGlb(glb).prims[0].pos;
  const n = base.length / 3;
  const sk = root ? findSkinned(root) : null;
  if (!sk) return { verts: base, bitEqual: true, maxDeltaM: 0, n, skinned: false };

  sk.updateMatrixWorld(true);
  sk.skeleton.update();
  const out = new Float32Array(base.length);
  const v = new THREE.Vector3();
  let bitEqual = true, maxDeltaM = 0;
  for (let i = 0; i < n; i++) {
    v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
    sk.applyBoneTransform(i, v);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(out[i * 3 + c] - base[i * 3 + c]);
      if (d !== 0) { bitEqual = false; if (d > maxDeltaM) maxDeltaM = d; }
    }
  }
  return { verts: out, bitEqual, maxDeltaM, n, skinned: true };
}
