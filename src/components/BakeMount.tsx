/* v3-71 §1 — **전용 «베이크 마운트»**(하네스 층 · **제품 화면 노출 0**).
 *
 * 목적 둘: (i) **굽기 파이프라인 «앞단» 부품** — 살아있는 몸을 만들어 주입 배열을 낸다.
 *          (ii) **백화 «판별 실험»** — v2 씬을 고치지 않고 「살아있는 몸이 «어디서» 죽는가」를 좁힌다.
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
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense } from "react";
import { Mannequin } from "./Mannequin";

/** §2-㉠ ⓒ — **`useFrame` 이 실제로 도는가**. 판별 전용 카운터(물리·판정 채널 아님). */
export const bakeMountFrames = { current: 0 };

function FrameTick() {
  useFrame(() => { bakeMountFrames.current += 1; });
  return null;
}

export const BAKE_MOUNT_PX = { w: 320, h: 440 } as const;

export function BakeMount() {
  return (
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
  );
}
