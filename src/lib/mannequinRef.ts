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

// P5 §1 / P5b §1 — **굽기 시점 신호.** 마네킹의 A포즈(팔 방향)는 `useFrame`에서,
// 단위 정규화(`scene.scale`)는 effect에서, 몸 치수 스케일은 `useFrame`의 **lerp**로 적용된다.
// 그래서 «마운트 직후»에 구우면 GLTF 원본 T포즈·미정규화 몸이 잡힌다 —
// 실측(P5 §3): y 0.004~1.769 · x ±0.890(정상은 y 0~1.700 · x ±0.545).
//
// **프레임 수를 세지 않는다.** 프레임 고정값은 취약하다 — lerp는 `t = 1 − 0.001^delta`라
// 수렴에 걸리는 프레임 수가 프레임률과 슬라이더 이동량에 따라 달라진다.
// 대신 **잔차를 재서** 판정한다: 스케일 lerp의 목표 대비 최대 |현재 − 목표|.
export const mannequinPoseRef = {
  /** A포즈·스케일 루프가 한 프레임을 마칠 때마다 오른다(0이면 아직 T포즈다). */
  frames: 0,
  /** 스케일 lerp의 목표 대비 최대 잔차(무차원 배율). 0으로 수렴한다. */
  maxScaleResidual: Infinity,
};

/**
 * 잔차 문턱. 배율 1e-4는 키 1.7m에서 **0.17mm**다 —
 * 자기충돌 문턱 3.21mm·충돌 margin 15mm의 1/19 이하라 제도·물리 어느 채널에도 안 잡힌다.
 */
export const POSE_SETTLE_EPS = 1e-4;

/**
 * 마네킹 포즈·스케일이 정착할 때까지 기다린다.
 * `frames ≥ 1`(A포즈가 최소 한 번 적용됨) **그리고** 잔차 ≤ eps.
 */
export async function awaitMannequinSettled(
  eps = POSE_SETTLE_EPS,
  timeoutMs = 5000,
): Promise<{ ok: boolean; frames: number; residual: number }> {
  const t0 = performance.now();
  for (;;) {
    const { frames, maxScaleResidual } = mannequinPoseRef;
    if (frames >= 1 && maxScaleResidual <= eps) return { ok: true, frames, residual: maxScaleResidual };
    if (performance.now() - t0 > timeoutMs) return { ok: false, frames, residual: maxScaleResidual };
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
