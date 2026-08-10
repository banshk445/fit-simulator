// P5 §1 — **살아있는 마네킹에서 몸 스냅샷을 뜬다.**
//
// 여기 새 물리는 0줄이다. `Garment.tsx`(v1) 안에 있던 조립 순서만 옮긴 것이고,
// 조각은 전부 이미 `src/lib/`에 있었다:
//   `boneUtils.findShoulderBones/findArmDirection/findShortSleeveDirection`
//   `shoulderPin.computeShoulderPin` · `torsoCapsule.buildTorsoProxyCapsules`
//   `meshCollision.MannequinCollisionMesh.bake`
//
// **왜 옮기나**: v2(`?patterncore=1`)에서는 `Garment.tsx`가 마운트되지 않아
// 몸 스냅샷을 뜰 방법이 없었다. 그래서 v2는 커밋된 fixture(가슴 슬라이더 100에서
// 구운 것) 하나를 고정으로 읽었고, 몸 슬라이더를 움직이면 **마네킹만 바뀌고
// 제도는 옛 몸을 봤다**(P1 §2 · P3 §2 · P4 §3 임시 배지). 이 모듈이 그 배지를 걷어낸다.
//
// **v1은 동작이 바뀌면 안 된다** — `Garment.tsx`는 아래 `computeArmShapes`를
// 그대로 부르고, 인자·순서·식이 전부 같다(항등 추출).
//
// `exportCollision`이 v1 워커의 `init`/`step` 뒤에야 동작하던 제약도 여기서 풀린다:
// 포즈(`pinLeft`/`pinRight`/`armLeft`/`armRight`)와 레이아웃(`topY`/`centerZ`)을
// **워커 메시지 이력이 아니라 씬에서 직접** 도출하기 때문이다.
import * as THREE from "three";
import { findArmDirection, findShortSleeveDirection } from "./boneUtils";
import { computeShoulderPin } from "./shoulderPin";
import { buildTorsoProxyCapsules } from "./torsoCapsule";
import { MannequinCollisionMesh } from "./meshCollision";
import type { PatternDressFixture } from "./patternDressCore";

export interface ArmShape {
  dir: { x: number; y: number; z: number };
  trueShoulder: { x: number; y: number; z: number };
  length: number;
}

export interface ShoulderBones {
  left: THREE.Object3D | null;
  right: THREE.Object3D | null;
}

const scratchL = new THREE.Vector3();
const scratchR = new THREE.Vector3();
const dirL = new THREE.Vector3();
const dirR = new THREE.Vector3();

const toMsg = (v: THREE.Vector3): { x: number; y: number; z: number } => ({ x: v.x, y: v.y, z: v.z });

// 어깨/팔 방향과 소매 길이에서 현재 팔 모양을 계산한다 — v1 `Garment.tsx`가 init(빌드)과
// step(매 프레임) 양쪽에서 쓰던 그 함수를 그대로 옮긴 것이다.
//
// 33번: 반팔은 위팔(어깨~팔꿈치) 방향을 따라야 한다 — 어깨~손 직선 방향(`findArmDirection`)은
// 팔꿈치가 굽은 포즈에서 위팔 구간과 어긋나 반팔 소매가 팔꿈치 쪽으로 삐져나갔다
// (`boneUtils.findShortSleeveDirection` 주석 참고). 긴팔은 손목까지 닿아야 하므로 기존 방향.
// 36번: 길이는 몸 치수가 아니라 **옷 실측**(소매길이 슬라이더) 그대로다 — 짧으면 손목에
// 못 미치고 길면 손을 덮는 것이 그대로 드러난다.
export function computeArmShapes(
  bones: ShoulderBones,
  sleeveType: "short" | "long",
  sleeveLengthM: number,
): { left: ArmShape; right: ArmShape } | null {
  const { left: leftBone, right: rightBone } = bones;
  if (!leftBone || !rightBone) return null;
  leftBone.updateWorldMatrix(true, false);
  rightBone.updateWorldMatrix(true, false);
  leftBone.getWorldPosition(scratchL);
  rightBone.getWorldPosition(scratchR);
  if (sleeveType === "long") {
    dirL.copy(findArmDirection(leftBone));
    dirR.copy(findArmDirection(rightBone));
  } else {
    dirL.copy(findShortSleeveDirection(leftBone));
    dirR.copy(findShortSleeveDirection(rightBone));
  }
  return {
    left: { dir: toMsg(dirL), trueShoulder: toMsg(scratchL), length: sleeveLengthM },
    right: { dir: toMsg(dirR), trueShoulder: toMsg(scratchR), length: sleeveLengthM },
  };
}

export interface BodySnapshotInput {
  root: THREE.Object3D;
  bones: ShoulderBones;
  /** cm 단위 슬라이더 값 — 마네킹을 변형시키는 그 값들. */
  bodySize: { height: number; chest: number };
  /** cm 단위 옷 슬라이더 — 어깨 핀 반폭과 소매길이·소매통이 여기서 나온다. */
  garmentSize: { shoulderWidth: number; sleeveLength: number; sleeveWidth: number; length: number; width: number };
  sleeveType: "short" | "long";
  fabric: PatternDressFixture["pose"]["fabric"];
}

export interface BodySnapshot {
  fixture: PatternDressFixture;
  /** 굽기 비용(ms) — 재굽기 정책의 근거(P5 §2). */
  bakeMs: number;
  capsuleMs: number;
}

/**
 * 살아있는 마네킹 → `PatternDressFixture`. v2 워커가 그대로 받아 쓴다.
 *
 * 굽기(`StaticGeometryGenerator`)는 **살아있는 Object3D 씬 그래프가 필요한 유일한 단계**라
 * 메인 스레드에서만 가능하다(meshCollision.ts 주석). 그래서 여기서 굽고 배열만 워커로 넘긴다.
 */
export function bakeBodySnapshot(
  input: BodySnapshotInput,
  collisionMesh: MannequinCollisionMesh,
): BodySnapshot | null {
  const { root, bones, bodySize, garmentSize, sleeveType, fabric } = input;
  const arms = computeArmShapes(bones, sleeveType, garmentSize.sleeveLength / 100);
  const { left: leftShoulder, right: rightShoulder } = bones;
  if (!arms || !leftShoulder || !rightShoulder) return null;

  const t0 = performance.now();
  const baked = collisionMesh.bake(root);
  const bakeMs = performance.now() - t0;

  const t1 = performance.now();
  leftShoulder.updateWorldMatrix(true, false);
  rightShoulder.updateWorldMatrix(true, false);
  leftShoulder.getWorldPosition(scratchL);
  rightShoulder.getWorldPosition(scratchR);
  // v1과 **같은 식**: 핀 반폭 = 옷 어깨너비/2, topY = 두 핀 y의 최대, centerZ = 두 핀 z의 중점.
  const pins = computeShoulderPin(scratchL, scratchR, garmentSize.shoulderWidth / 100 / 2);
  const topY = Math.max(pins.left.y, pins.right.y);
  const proxy = buildTorsoProxyCapsules(
    { x: scratchL.x, y: scratchL.y, z: scratchL.z },
    { x: scratchR.x, y: scratchR.y, z: scratchR.z },
    bodySize.height / 100,
    bodySize.chest / 100,
  );
  const capsuleMs = performance.now() - t1;

  return {
    bakeMs,
    capsuleMs,
    fixture: {
      layout: {
        widthM: garmentSize.width / 100,
        heightM: garmentSize.length / 100,
        topY,
        // **주의**: `centerZ`는 두 자리에서 나온다 — v1 `init` 레이아웃은 «핀» 중점 z를,
        // `collision`은 «캡슐» 중점 z를 쓴다(v1 `exportCollision`이 그렇게 내보냈고
        // 커밋된 fixture도 그 값이다). 여기서도 같은 구분을 유지한다.
        centerZ: (pins.left.z + pins.right.z) / 2,
        sleeveWidthM: garmentSize.sleeveWidth / 100,
      },
      pose: {
        pinLeft: toMsg(pins.left),
        pinRight: toMsg(pins.right),
        armLeft: arms.left,
        armRight: arms.right,
        fabric,
      },
      collision: {
        position: baked.position,
        frontIndex: baked.frontIndex ? Array.from(baked.frontIndex) : null,
        backIndex: baked.backIndex ? Array.from(baked.backIndex) : null,
        wholeBodyIndex: baked.wholeBodyIndex ? Array.from(baked.wholeBodyIndex) : null,
        capsules: proxy.capsules,
        centerZ: proxy.centerZ,
      },
    },
  };
}
