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
  /**
   * P23 §1 — **팔 포즈의 프레임 간 이동량(m).** 위 `maxScaleResidual`은 **스케일 lerp의
   * 목표 대비 편차**만 본다 — 몸 스냅샷이 실제로 읽는 값(어깨·팔꿈치·손의 «월드 좌표»)은
   * 판정에 들어 있지 않았다. 그래서 잔차가 문턱을 통과한 «뒤»에도 팔 포즈가 계속 움직였고,
   * P22 §2가 그것을 비트 해시로 잡았다(새 로드 6회에 팔 관절 6종).
   *
   * A포즈 루프(`pointBoneTowardWorldDirection`)는 매 프레임 현재 월드 행렬에서 방향을
   * 다시 떠서 회전을 «다시» 맞춘다 — 스케일 lerp가 멎은 뒤에도 이 되먹임이 남는다.
   */
  maxArmDeltaM: Infinity,
  /** 위 이동량이 **정확히 0**(비트 동일)인 연속 프레임 수. 문턱이 아니라 «멈춤» 자체다. */
  armStillFrames: 0,
  /**
   * P23 §1 — **스케일 값이 프레임 간 비트 동일**인 연속 프레임 수.
   * lerp는 고정점에 닿으면 `lerp(a, target, t) === a`가 되어 값이 «멎는다» —
   * 그때 잔차는 0이 아니라 1.33e-15에서 평탄해진다(실측). 그래서 잔차 문턱으로는
   * 「멎었는가」를 판정할 수 없고, 이 카운터가 그 자리를 맡는다. **문턱이 아니다.**
   */
  scaleStillFrames: 0,
  /** P23 §2 — 「준비 조건 충족」까지 실제로 기다린 ms. 실행마다 보고에 병기한다. */
  stopWaitMs: -1,
  /**
   * P24 §3 — 마지막 프레임의 팔 관절 월드 좌표 18값(양팔 × 어깨·팔꿈치·손 × xyz).
   * 몸 스냅샷이 읽는 바로 그 값이라, **슬라이더가 팔에 닿는지**를 착장 없이 확인할 수 있다.
   * 인쇄 전용.
   */
  armSample: [] as number[],
  /**
   * P26 §3 — **스케일 값 자체의 비트 해시**와 **목표 배율 서명**(인쇄 전용).
   * 「스케일이 유일해졌는가」와 「팔이 갈리는가」를 가르는 데 쓴다 —
   * 스케일 해시가 같은데 결과가 갈리면 원인은 스케일 밖(A포즈 누적 회전)이다.
   */
  scaleDigest: "",
  targetKey: "",
  /**
   * P27 §2 — `armSample` **18값 전량**의 원시 비트 해시(인쇄 전용).
   * P26 §3-3은 첫 3값만 봤고, 그것으로는 「팔이 같다」를 말할 수 없었다(§6-3 미실시분).
   */
  armDigest18: "",
};

/**
 * 잔차 문턱. 배율 1e-4는 키 1.7m에서 **0.17mm**다 —
 * 자기충돌 문턱 3.21mm·충돌 margin 15mm의 1/19 이하라 제도·물리 어느 채널에도 안 잡힌다.
 */
export const POSE_SETTLE_EPS = 1e-4;

/**
 * P23 §1 — **대기 상한**(무한 대기 금지). 값은 `awaitMannequinSettled`가 이미 쓰던
 * 5000ms 그대로다 — **새 값이 아니라 이름을 붙인 것**이다. 실측 고정점 도달은 3.3s라
 * 여유 1.7s. 상한에 걸리면 굽되 **그 사실을 로그로 남긴다**(말없는 실패 금지 · 함정 25).
 */
export const POSE_STOP_TIMEOUT_MS = 5000;

/** P23 §1 — 「멎었는가」. 스케일은 비트 동일 · 팔 포즈는 이동량 ≤ eps(위 주석의 이유). */
export function poseStopped(eps = POSE_SETTLE_EPS): boolean {
  return mannequinPoseRef.scaleStillFrames >= 1 && mannequinPoseRef.maxArmDeltaM <= eps;
}

/**
 * P23 §1 — **굽어도 되는 시점**의 정의.
 *
 * 종전: `frames ≥ 1` **그리고** 스케일 잔차 ≤ eps. 이 판정은 몸 스냅샷이 실제로 읽는 값
 * (팔 관절 월드 좌표)을 **보지 않았고**, 잔차가 eps를 통과한 뒤에도 스케일 lerp가
 * 2.5초쯤 더 움직였다(실측: eps 통과 0.75s · 고정점 도달 3.3s). 그 사이에 구우면
 * 몸 메시가 실행마다 달라진다 — P22 §2-4가 그것을 값으로 잡았다.
 *
 * 지금: 위 두 조건 **그리고** ① 스케일이 **멎었을 것**(프레임 간 비트 동일 · 문턱 없음)
 * ② 팔 포즈 이동량 ≤ 같은 `eps`(새 상수 0 — 판정 «대상»만 넓힌다).
 *
 * 팔 포즈는 **끝내 비트 동일이 되지 않는다**(A포즈 루프가 매 프레임 현재 월드 행렬에서
 * 방향을 다시 뜨는 되먹임이라 1 ULP로 영구 진동한다 — 실측 하한 1.1e-16~4.4e-16 m).
 * 그래서 팔에는 «멎음»이 아니라 eps를 쓴다. 이 한계는 P23 §5에 등재한다.
 */
export async function awaitMannequinSettled(
  eps = POSE_SETTLE_EPS,
  timeoutMs = POSE_STOP_TIMEOUT_MS,
): Promise<{ ok: boolean; frames: number; residual: number }> {
  const t0 = performance.now();
  for (;;) {
    const { frames, maxScaleResidual } = mannequinPoseRef;
    if (frames >= 1 && maxScaleResidual <= eps && poseStopped(eps)) return { ok: true, frames, residual: maxScaleResidual };
    if (performance.now() - t0 > timeoutMs) return { ok: false, frames, residual: maxScaleResidual };
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
