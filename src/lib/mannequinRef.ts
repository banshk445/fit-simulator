import type { Object3D } from "three";

// Mannequin.tsx가 마운트되면 자신의 최상위 렌더 그룹(전체 키 스케일 + 접지
// 오프셋까지 적용된 실제 루트)을 여기에 채워 넣는다. GarmentCloth는 이
// 레퍼런스를 읽어서, 화면에 실제로 렌더되는 것과 동일한 좌표계 기준으로
// 충돌용 정적 메시를 굽는다(별도로 마네킹을 다시 로드/래핑하면 스케일·
// 오프셋이 어긋나기 때문).
export const mannequinRootRef: { current: Object3D | null } = { current: null };

// P5 §1 — v2(`?patterncore=1`)는 `Garment.tsx`가 마운트되지 않아 어깨 본에 닿을 길이
// 없었다. `Mannequin`이 이미 `nodes`를 갖고 있으므로 여기에 함께 등록한다
// (`findShoulderBones`를 두 번 돌리지 않는다 — 같은 결과의 두 번째 출처를 만들지 않기 위해).
export const mannequinBonesRef: { current: { left: Object3D | null; right: Object3D | null } } = {
  current: { left: null, right: null },
};

// P5 §1 — **굽기 시점 신호.** 마네킹의 A포즈(팔 방향)는 `useFrame`에서, 단위 정규화
// (`scene.scale`)는 effect에서 적용된다. 그래서 «마운트 직후»에 구우면 GLTF 원본
// T포즈·미정규화 몸이 잡힌다 — 실측: y 0.004~1.769 · x ±0.890(정상은 y 0~1.700 · x ±0.545).
// 프레임이 한 번이라도 돈 뒤에 구워야 한다. Mannequin이 매 프레임 올린다.
export const mannequinFramesRef = { current: 0 };

/** 마네킹 포즈가 적용된 뒤까지 기다린다(최대 `timeoutMs`). */
export async function awaitMannequinSettled(minFrames = 2, timeoutMs = 3000): Promise<boolean> {
  const t0 = performance.now();
  while (mannequinFramesRef.current < minFrames) {
    if (performance.now() - t0 > timeoutMs) return false;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  return true;
}
