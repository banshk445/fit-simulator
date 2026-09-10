/* v3-80 §1-① — **카메라 프레이밍의 «순수» 정의**. DOM 0 · three 0 · node 0 ⟹
 * 화면(`productView.ts`)과 검사 스크립트(`scripts/v3FramingCheck.ts`)가 **같은 식**을 쓴다.
 * 식을 두 벌 적으면 검사가 공허해진다(#65 계열).
 */
import { AXES } from './grid.ts';

/** 프레이밍 파라미터 — **값은 v3-59 `DISPLAY` 에서 «그대로» 옮겼다**(새 값 0). */
export const FRAMING = { fovDeg: 32, fitMargin: 1.18 } as const;

/** **프레이밍 기준 키[m]** — 카메라 거리를 정하는 «유일한» 길이다.
 * 출처는 등재 축 기본값 `AXES.height.base`(= `Controls.tsx` 몸 키 슬라이더 기본 170cm) ⟹ **손 상수 0**. */
export const REF_BODY_HEIGHT_M = AXES.height.base / 100;

/** 카메라 거리[m] — **몸에도 옷에도 의존하지 않는다.**
 * ⟹ 화면 픽셀 높이는 몸의 «실제» 높이에 **정비례**한다(같은 키 = 같은 크기 · 키 비 = 픽셀 비). */
export function cameraDistanceM(): number {
  return (FRAMING.fitMargin * (REF_BODY_HEIGHT_M / 2)) / Math.tan((FRAMING.fovDeg * Math.PI) / 360);
}
