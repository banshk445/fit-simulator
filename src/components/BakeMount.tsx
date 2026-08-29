/* v3-71 §1 — **전용 «베이크 마운트»**(하네스 층 · **제품 화면 노출 0**).
 *
 * 목적 둘: (i) **굽기 파이프라인 «앞단» 부품** — 살아있는 몸을 만들어 주입 배열을 낸다.
 *          (ii) **백화 «판별 실험»** — v2 씬을 고치지 않고 「살아있는 몸이 «어디서» 죽는가」를 좁힌다.
 *               ★ v3-79 §0-3 **종결**: 사용자 가시 탭에서 재현되지 않는다(v2 마네킹 정상 렌더 확인)
 *               ⟹ **「비가시 탭 환경 조건」으로 확정**. 이 마운트는 «동기 굽기» 용도로만 남는다.
 *
 * ★ **캔버스 크기를 «픽셀»로 못박는다.** 근거는 v3-70 §2-㉯′ 관측:
 *   「r3f 캔버스가 **300×150 기본값에 고착** — 부모 상자는 972×853 인데 **캔버스 CSS 크기 지정이 없다**」.
 *   ⟹ 부모 상자에 «기대는» 크기 결정을 쓰지 않는다. **320 × 440 px**는 «표시 층 값»이고
 *   물리·문턱 채널이 아니다(캡처 프리셋 300×420 과 같은 계열의 표시 상수).
 *   `<Canvas>` 에 인라인 `style` 로 폭·높이를 직접 준다 — 부모 레이아웃·ResizeObserver 에 의존하지 않는다.
 *
 * **v2 화면은 한 줄도 고치지 않는다**(§0-3). 여기서 `Mannequin` 을 «따로» 마운트할 뿐이다.
 * `Mannequin` 은 마운트되면 `mannequinRootRef` 를 채우고 `bodySize` 슬라이더(스토어)를 따라간다.
 */
import { Canvas, useFrame, advance } from "@react-three/fiber";
import { Suspense } from "react";
import { Mannequin } from "./Mannequin";

/** §2-㉠ ⓒ — **`useFrame` 이 실제로 도는가**. 판별 전용 카운터(물리·판정 채널 아님). */
export const bakeMountFrames = { current: 0 };

function FrameTick() {
  useFrame(() => { bakeMountFrames.current += 1; });
  return null;
}

export const BAKE_MOUNT_PX = { w: 320, h: 440 } as const;

/* ★ v3-71 §2 — **수동 프레임 «펌프» 시도와 «기각»**(구현은 되돌렸다 · 사실만 남긴다).
 *
 * 실측 사슬(전부 이 판에서 잰 값):
 *   ① 이 탭은 `document.visibilityState = **"hidden"**` 이다(Chrome 확장 구동 · 사용자 조작 아님).
 *   ② 그 상태에서 **`requestAnimationFrame` = 0회/초** · **`MessageChannel` = 949회/초**(같은 1초 창).
 *   ③ **`ResizeObserver` 가 발화하지 않는다**(2초 관찰 · 발화 0건).
 *   ④ R3F `<Canvas>` 는 크기가 측정돼야 루트를 만든다 ⟹ **`_roots` 가 비어 있다**.
 *   ⑤ 그래서 `frameloop="never"` + `advance()` 펌프는 **`advance` 1,620,000회에 `useFrame` 0회**였다
 *      (예외 0건 · 조용히 아무 것도 안 한다).
 *   ⑥ **스크린샷 1장**을 찍으면 페인트가 유발돼 **RO 가 발화하고 루트가 생긴다** —
 *      그 뒤 ref 생존 · 캔버스 320×440(css) 로 정상화된다.
 * ⟹ **펌프는 원인을 못 고친다**(루트 부재가 앞선다). 구동원 교체를 **되돌리고** 기본 루프를 쓴다.
 *    **남는 사실**: 「**비가시 탭에서는 R3F 가 초기화조차 되지 않는다**」 —
 *    v3-70 이 남긴 백화 관측 4건이 **이 한 위치로 좁혀진다**.
 */

/* ★ v3-72 §2 — **동기 프레임 «전진»**. `advance(t)` 는 R3F 의 **공개 API**이고,
 * 루트가 «있으면» rAF 없이도 한 프레임을 돌린다(v3-71 §2-㉢ 이 확인한 것은 「루트가 «없으면»
 * 아무 것도 안 한다」였다 — 루트 유무가 앞선다).
 * ⟹ **가시성·rAF 에 의존하지 않는 «굽기 전 정착»**을 만든다. **`Mannequin` 로직 0줄**(호출만) ·
 *   **새 문턱 0**(정착 판정은 기존 `poseStopped` / `POSE_SETTLE_EPS` 그대로).
 * `dtMs` 기본 1/60초는 **R3F 기본 루프와 같은 자릿수**의 표시 층 값이다(물리 채널 아님 —
 * v3 물리의 `DT` 와 무관하고, 여기서 도는 것은 «몸 스케일 lerp» 뿐이다).
 * 남는 환경 의존 1건: **루트 생성 자체는 «가시화 계기» 1회를 요구한다**(v3-71 §2 ⑥). */
export function stepFrames(n: number, dtMs = 1000 / 60): void {
  let t = performance.now();
  for (let i = 0; i < n; i++) { t += dtMs; advance(t); }
}

export function BakeMount() {
  return (
    <>
    <Canvas
      style={{ width: `${BAKE_MOUNT_PX.w}px`, height: `${BAKE_MOUNT_PX.h}px`, display: "block" }}
      camera={{ position: [0, 1.3, 3], fov: 45 }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 2]} intensity={1} />
      <FrameTick />
      <Suspense fallback={null}>
        <Mannequin />
      </Suspense>
    </Canvas>
    </>
  );
}
