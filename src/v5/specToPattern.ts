/* v5-1 §1-② — **실측표 → 패턴 상수**(신설 모듈 · 기존 조립 경로 **호출 0줄 변경**).
 *
 * 이 파일은 «사상» 하나만 담는다. 조립·물리·게이트는 한 줄도 없다.
 *
 * ── 실측표(쇼핑몰 형식 · cm) ────────────────────────────────────────────────
 *   총장 `totalLength`      옷을 눕혀 뒷목 중심에서 밑단까지
 *   가슴단면 `chestFlat`    겨드랑이 아래 가로 폭(«단면» = 둘레의 절반)
 *   어깨너비 `shoulder`     어깨 끝 ↔ 어깨 끝
 *   소매길이 `sleeveLength` 어깨 끝에서 소매 끝까지
 *   밑단단면 `hemFlat`      밑단 가로 폭
 * ── 현행 티셔츠 패턴이 «조립에서 받는» 자유도(v5-1 §1-① 전수) ────────────────
 *   `L`(총장 m) · `W`(몸판 폭 m) · `SW`(어깨너비 m) · `SLEN`(소매길이 m) · `ARM_G`(암홀 둘레 m)
 * ── 사상 ────────────────────────────────────────────────────────────────
 *   L    = totalLength / 100
 *   W    = chestFlat  / 100      ← 몸판 폭 = 가슴«단면»(코드에서 패널이 ±W/2 로 그려진다 · `garmentScene.ts:422`)
 *   SW   = shoulder   / 100
 *   SLEN = sleeveLength / 100    ← 현행 차트는 «화장(hwa)»을 주고 `grid.ts:33` 이 `hwa − SW/2` 로 바꾼다.
 *                                  실측표의 「소매길이」는 **그 값 자체**다(어깨 끝 기준).
 *   ARM_G = 템플릿 상수(아래)
 * ── 실측표가 «정하지 못하는 것» = 템플릿 상수(숨은 상수 0 · 판정문 조항) ─────────
 *   `ARM_G` **0.4439 m** — 암홀 둘레. 차트에 없다(`grid.ts:27-28` 「차트가 암홀 둘레를 주지 않는다」).
 *   ※ 목선 폭·목선 둘레·소매산 반폭/높이·암홀 깊이는 **상수가 아니라 «몸에서 도출»**된다
 *     (`garmentScene.ts:237·239·263·305·311`) ⟹ 실측표의 몫이 아니다(§1-① 표 참고).
 * ── 「밑단단면」의 처분 ──────────────────────────────────────────────────
 *   현행 패턴의 옆선은 **직선**이라 밑단 폭 = 몸판 폭이다(`garmentScene.ts:422` `line([W/2, 0], [W/2, Y_ARM])`).
 *   ⟹ 실측표의 `hemFlat` 은 **종속값**이고, `chestFlat` 과 다르면 현행 패턴으로 표현할 수 없다.
 *   그 경우 이 모듈은 **던진다**(조용한 무시 0). 「A라인 밑단」은 패턴 자유도 신설이 필요하다(다음 판의 재료).
 */

/** 쇼핑몰 실측표 5항 [cm]. */
export type TeeSpec = {
  totalLength: number; chestFlat: number; shoulder: number; sleeveLength: number; hemFlat: number;
};

/** 조립(`prepare`/`createScene`)이 받는 옷 치수 [m]. `grid.ts:31 garmentOf` 와 **같은 모양**이다. */
export type Pattern = { L: number; W: number; SW: number; SLEN: number; ARM_G: number };

/** 템플릿 상수 — 실측표가 못 정하는 값. **이름과 값을 드러낸다.** */
export const TEE_TEMPLATE = {
  /** 암홀 둘레 [m] · 출처 `src/v3/grid.ts:28`(v3-73 §0 처분 · 전 사이즈 공통 제도 기본값). */
  ARM_G: 0.4439,
} as const;

/** 실측표 → 패턴 상수. **새 수 0** — 나누기 100(cm→m)과 템플릿 상수뿐이다. */
export function specToPattern(s: TeeSpec): Pattern {
  if (!(s.hemFlat === s.chestFlat))
    throw new Error(`밑단단면 ${s.hemFlat}cm ≠ 가슴단면 ${s.chestFlat}cm — 현행 티셔츠 패턴은 옆선이 직선이라 `
      + `두 값이 같아야 표현된다(패턴 자유도 신설 필요 · v5-1 §1-②)`);
  return { L: s.totalLength / 100, W: s.chestFlat / 100, SW: s.shoulder / 100,
           SLEN: s.sleeveLength / 100, ARM_G: TEE_TEMPLATE.ARM_G };
}

/** 패턴 상수 → 실측표(역방향 · 표현). 조립 상수를 «쇼핑몰 말»로 옮긴다. */
export function patternToSpec(p: Pattern): TeeSpec {
  return { totalLength: p.L * 100, chestFlat: p.W * 100, shoulder: p.SW * 100,
           sleeveLength: p.SLEN * 100, hemFlat: p.W * 100 };
}
