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
 * ★★ **v3-71 §3 실측 — 이 설계에 «프레임 복원» 결손이 있다**(고치지 않고 사실을 박는다).
 *   기본 슬라이더(=항등 몸)에서 굽었더니 **`parseGlb` 배열과 max|Δ| = 1.7693e+5 mm** 였다.
 *   **1.7693e+5 mm = 176.93 m = 1.7693 m × «정확히 100»** ⟹ **배율 100 의 좌표계 어긋남**이다
 *   (1.7693 m 는 이 몸의 y 범위와 같은 자릿수 — 즉 «모양»은 맞고 «단위/프레임»이 틀렸다).
 *   그 배열로 조립하면 `garmentScene` 이 **「목 단면 국소 최소 둘레를 못 찾는다 — 갈래 D」**로 던진다.
 *   **v3-70 에서 안 걸린 이유**: 그때는 살아있는 마네킹이 **없어서** 이 경로가 **항등 통과**였다
 *   (`skinned:false` ⟹ `base` 를 그대로 반환) ⟹ **비트 동일이 «진짜 등가»가 아니었다**.
 *   **기전 가설은 적지 않는다**(단정 0). **다음 판의 첫 과제 = 프레임 복원식 도출.**
 *
 * ★★ **v3-72 §1 — 해소. 복원식을 «씬에서» 도출했다**(위 결손 문언은 **무삭제**).
 *   근거는 three 의 소스 두 줄이다(**스칼라 수기 입력 0**):
 *     `node_modules/three/src/objects/SkinnedMesh.js:319-345` — `applyBoneTransform` 은
 *        **`bindMatrixInverse · Σ(boneMatrix · bindMatrix · p)`** 를 돌려준다.
 *     같은 파일 `:230-240` — `bind(skeleton, bindMatrix)` 에서 `bindMatrix` 가 없으면
 *        **`this.matrixWorld`**(= **바인드 «시점»의 월드 행렬**)를 쓴다.
 *   ⟹ 렌더가 그리는 «월드» 위치는  `world = matrixWorld · applyBoneTransform(p)` 이고,
 *      `parseGlb` 의 POSITION 프레임 = **바인드 시점의 «국소» 프레임** = `bindMatrix` 가 월드로 보내는 그 공간.
 *   ⟹ **`p_glb = inverse(bindMatrix) · matrixWorld · applyBoneTransform(p)`**.
 *   **항등에서 항등**: 바인드 이후 조상 변환이 안 바뀌었으면 `matrixWorld === bindMatrix` 이므로
 *      복원 행렬이 **단위행렬**이 되어 `applyBoneTransform` 결과를 그대로 통과시킨다.
 *   **키(조상 균등 스케일)는 «살아남는다»**: 조상이 바뀌면 `matrixWorld ≠ bindMatrix` 라 그 비가 남는다.
 *   ★ 이 GLB 의 사실(참고 · 값은 코드에 쓰지 않는다): 루트 `Armature` 노드가
 *      **scale 0.01 · x축 −90° 회전**을 갖고 메시 `Ch36` 이 그 자식이다 ⟹ 조인트 세계와
 *      POSITION 세계가 **100배·회전만큼 어긋나 있다**. 그것이 v3-71 의 「정확히 100배」다.
 *
 * `applyBoneTransform(i, v)` 는 **바인드 포즈 «국소» 좌표**를 받아 **스킨 적용 국소 좌표**를 낸다.
 * 본 스케일은 `skeleton.boneMatrices` 를 타고 들어오고, 조상(루트)의 균등 스케일도
 * `bone.matrixWorld` 를 통해 반영된다 ⟹ **키·팔·다리·어깨·가슴둘레 5축이 모두 담긴다**.
 * 좌표계는 **GLB 프레임 그대로**다(메시 자신의 월드 행렬을 곱하지 않는다).
 */
import * as THREE from "three";
import { parseGlb } from "../v3/glb.ts";

/** v3-74 §2 — 굽기 «자세» 모드. **기본값 = T포즈**(판정 채널의 전제) · A포즈 경로는 **무삭제**. */
export type BakePose = "tpose" | "apose";

/** v3-74 §1 — 본별 «바인드 대비 회전» 실측(자세 출처 등재용). */
export type PoseDelta = { name: string; deg: number };

export type BakeResult = {
  verts: Float32Array;
  /** `parseGlb` 배열과 **비트 동일**인가(㉮ 의 판정 채널). */
  bitEqual: boolean;
  /** 비트 동일이 아닐 때의 최대 편차[m]. 동일이면 0. */
  maxDeltaM: number;
  /** 실제로 순회한 정점 수. */
  n: number;
  /** v3-74 — 이 굽기가 쓴 자세 모드. */
  pose: BakePose;
  /** v3-74 §1 — T포즈로 되돌리면서 «잰» 바인드 대비 회전각[°]. A포즈 모드에서는 빈 배열. */
  poseDelta: PoseDelta[];
  /** **항상 `true`**. v3-72 §0-5 이후 «항등 폴백»은 폐기됐고 부재 시 **던진다**(#121).
   * 필드는 **무삭제**로 남긴다 — 호출부가 이 값을 «확인»한 기록이 ㉮″ 의 등재 채널이다. */
  skinned: boolean;
};

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let hit: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if (!hit && (o as THREE.SkinnedMesh).isSkinnedMesh) hit = o as THREE.SkinnedMesh; });
  return hit;
}

/**
 * GLB 바이트 + 살아있는 마네킹 → **주입용 몸 정점**.
 *
 * ★ **v3-72 §0-5 · #121** — `root` 가 없거나 스킨드 메시가 없으면 **던진다**.
 * 종전에는 `parseGlb` 배열을 **조용히 항등 통과**시켰고, 그 때문에 v3-70 ㉮ 가 **공허하게 «통과»**했다
 * (「미집행」과 「통과」를 구별하지 못했다). **이제 구별한다.**
 */
export function bakeBodyVerts(glb: ArrayBuffer, root: THREE.Object3D | null,
                              pose: BakePose = "tpose"): BakeResult {
  const base = parseGlb(glb).prims[0].pos;
  const n = base.length / 3;
  if (!root) throw new Error("몸 굽기: 살아있는 마네킹이 없다(root null) — 항등 폴백은 폐기됐다(#121)");
  const sk = findSkinned(root);
  if (!sk) throw new Error("몸 굽기: 스킨드 메시를 못 찾는다 — 항등 폴백은 폐기됐다(#121)");

  /* ★ v3-74 §1·§2 — **T포즈 복원**. 바인드 회전의 «출처»는 씬이다:
   * `src/lib/boneUtils.ts:230-233` 이 A포즈를 걸기 «전»의 `bone.quaternion` 을
   * **`bone.userData.__p27Bind` 에 최초 1회 보관**한다(P27 §2 절대 구성판).
   * ⟹ **그 사본을 되돌리면 GLB 바인드 자세**다. **손 상수 0 · 각도 창작 0.**
   * **배율(`bone.scale`)은 손대지 않는다** — 슬라이더 target 이 그대로 남는다.
   * 되돌리면서 **바인드 대비 회전각을 «재서» 돌려준다**(§1 등재 채널). */
  const poseDelta: PoseDelta[] = [];
  if (pose === "tpose") {
    root.traverse((o) => {
      const b = (o as THREE.Object3D & { userData: { __p27Bind?: THREE.Quaternion } });
      const bind = b.userData.__p27Bind;
      if (!bind) return;
      const dot = Math.min(1, Math.abs(b.quaternion.dot(bind)));
      poseDelta.push({ name: o.name, deg: (2 * Math.acos(dot) * 180) / Math.PI });
      b.quaternion.copy(bind);
    });
  }
  root.updateMatrixWorld(true);
  sk.updateMatrixWorld(true);
  sk.skeleton.update();
  /* v3-72 §1 — **복원 행렬 = inverse(bindMatrix) · matrixWorld**. 두 행렬 모두 **씬에서 읽는다**
   * (three `SkinnedMesh` 의 필드 · **손 상수 0**). 머리주석의 유도 참고. */
  const restore = new THREE.Matrix4().copy(sk.bindMatrix).invert().multiply(sk.matrixWorld);
  const out = new Float32Array(base.length);
  const v = new THREE.Vector3();
  let bitEqual = true, maxDeltaM = 0;
  for (let i = 0; i < n; i++) {
    v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
    sk.applyBoneTransform(i, v);
    v.applyMatrix4(restore);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(out[i * 3 + c] - base[i * 3 + c]);
      if (d !== 0) { bitEqual = false; if (d > maxDeltaM) maxDeltaM = d; }
    }
  }
  return { verts: out, bitEqual, maxDeltaM, n, skinned: true, pose, poseDelta };
}
