// 착용 가능성 사전 검증 — 물리적으로 불가능한 치수 조합을 시뮬 전에 막는다.
//
// **판정식은 하드코딩이 아니라 실측에서 도출했다**(지표 함정 ①과 같은 원칙:
// 사실을 적어넣지 말고 데이터에서 뽑을 것). 근거 두 가지:
//
// (1) 마네킹 가슴 단면 둘레 — fixture 메시를 어깨선 아래 10~25cm 구간에서
//     1cm 간격으로 잘라 XZ convex hull 둘레를 재고 최댓값을 취했다.
//     bodySize.chest 슬라이더가 100cm일 때 실측 **119.4cm**.
//     즉 슬라이더 값 대비 실제 단면 둘레 비율 = 119.4/100 = **1.194**.
//     (2026-07-29 정정: 처음엔 113.4cm였는데, 그 측정이 대역을 옷 기준
//      좌표에 걸고 팔 제외를 |x|>0.22m로 하드코딩한 상태였다 — 함정 6.
//      대역을 몸 bbox 기준으로, 팔 제외를 슬랩 내 최대 빈틈 기준으로
//      고치니 119.4cm가 됐다. **물리적 경계는 그대로 두고** 비율 문턱만
//      새 계기에 맞춰 환산했다: 차단 45.4cm → 0.760, 경고 51.0cm → 0.855.)
//     (슬라이더는 "가슴둘레"지만 마네킹 스케일이 그 값에 정확히 비례하지
//      않으므로 이 환산이 필요하다.)
//
// (2) 품(garment width) 하한 — 같은 fixture에서 품만 55→35cm로 낮추며
//     coverage(몸 노출률)를 실측:
//       품 55cm(비율 0.970) → 7.8%
//       품 50cm(비율 0.882) → 16.2%
//       품 45cm(비율 0.794) → 23.1%
//       품 40cm(비율 0.706) → **44.3%**
//       품 35cm(비율 0.617) → **54.5%**
//     (비율 = 품 ÷ (단면둘레/2). 앞판 하나가 몸통 절반을 감싸야 하므로
//      이 비율이 1이면 "딱 맞게 감김"이다.)
//     **maxStrain은 3.33~3.53으로 전 구간 거의 불변** — 즉 실패 모드는
//     발산이 아니라 **커버리지 붕괴**다. 천이 늘어나 터지는 게 아니라
//     애초에 몸을 못 덮고 벌어진다. 0.794와 0.706 사이에서 coverage가
//     23%→44%로 급변하므로 그 사이를 경계로 잡는다.
//
// 문턱: 0.76 미만 = 착용 불가(차단), 0.76~0.855 = 경고(끼는 핏).
// 이 값들은 위 5점 실측의 급변 구간(물리 폭 40~45cm 사이)에서 온 것이며,
// 마네킹 모델이나 물리 상수가 바뀌면 같은 방식으로 재측정할 것.
//
// **미검증 구간**: 가슴 100 이외의 체형에서는 아직 확증되지 않았다.
// 가슴을 110 이상으로 올리면 마네킹 충돌 메시의 팔 부분(정점의 38.9%)이
// Float32 포화 값으로 손상돼 측정 자체가 불가능하다(metrics-log 참고).
// 그 결함을 고친 뒤 가슴 110/120에서 스윕해 이 비율식을 확증할 것.

/** bodySize.chest 슬라이더(cm) → 마네킹 실제 가슴 단면 둘레(cm) 환산 계수. */
export const CHEST_PERIMETER_RATIO = 1.194;

/** 품 ÷ (단면둘레/2) 문턱 — 미만이면 착용 불가. */
export const WIDTH_RATIO_BLOCK = 0.76;
/** 이 미만이면 경고(끼는 핏). */
export const WIDTH_RATIO_WARN = 0.855;

export type FitVerdict = "ok" | "tight" | "impossible";

export interface FitCheck {
  verdict: FitVerdict;
  /** 현재 품 ÷ (단면둘레/2). */
  ratio: number;
  /** 착용 가능한 최소 품(cm) — 차단 문턱 기준. */
  minWidthCm: number;
  /** 여유 있는 권장 최소 품(cm) — 경고 문턱 기준. */
  comfortWidthCm: number;
  message: string | null;
}

/** 가슴둘레(cm)에 대해 착용 가능한 최소 품(cm). */
export function minGarmentWidthCm(chestCm: number): number {
  return (chestCm * CHEST_PERIMETER_RATIO * WIDTH_RATIO_BLOCK) / 2;
}

export function checkGarmentFit(chestCm: number, widthCm: number): FitCheck {
  const halfPerimeter = (chestCm * CHEST_PERIMETER_RATIO) / 2;
  const ratio = halfPerimeter > 0 ? widthCm / halfPerimeter : 1;
  const minWidthCm = Math.round(halfPerimeter * WIDTH_RATIO_BLOCK * 10) / 10;
  const comfortWidthCm = Math.round(halfPerimeter * WIDTH_RATIO_WARN * 10) / 10;
  if (ratio < WIDTH_RATIO_BLOCK) {
    return {
      verdict: "impossible",
      ratio,
      minWidthCm,
      comfortWidthCm,
      message: `가슴둘레 ${chestCm}cm에는 품 ${minWidthCm}cm 이상이 필요합니다(현재 ${widthCm}cm). 이 조합은 천이 몸을 감쌀 수 없어 시뮬레이션을 실행하지 않습니다.`,
    };
  }
  if (ratio < WIDTH_RATIO_WARN) {
    return {
      verdict: "tight",
      ratio,
      minWidthCm,
      comfortWidthCm,
      message: `아주 타이트한 핏입니다. 여유 있게 입으려면 품 ${comfortWidthCm}cm 이상을 권합니다.`,
    };
  }
  return { verdict: "ok", ratio, minWidthCm, comfortWidthCm, message: null };
}
