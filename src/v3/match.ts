/* v3-79 §1 — **입력 클램프 + 몸 매칭의 «순수» 정의**.
 *
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · three 0 · React 0 · **v2 임포트 0**(G1) ⟹
 * **화면과 자기검사 스크립트가 «같은 함수»를 쓴다**(#65 계열 — 두 벌이면 검사가 공허해진다).
 * **이 파일이 새로 «정하는» 수는 0이다** — 축 범위·격자점은 전부 `grid.ts` 등재분에서 뜬다.
 */
import { AXES, pointsOf, FIXED } from './grid.ts';

/** 5축 입력 범위 — **`src/components/Controls.tsx` 등재분**. 매칭 3축은 `grid.AXES` 를 그대로 쓴다.
 * ★ 팔·다리는 **매칭에 쓰지 않는다**(v3-76 §0-3 ③) — 범위와 기본값만 여기 있다. */
export const INPUT_AXES = {
  chest:     { ...AXES.chest,    label: '가슴둘레', unit: 'cm', matched: true },
  height:    { ...AXES.height,   label: '키',       unit: 'cm', matched: true },
  shoulder:  { ...AXES.shoulder, label: '어깨너비', unit: 'cm', matched: true },
  armLength: { min: 40, max: 80,  base: FIXED.armLength, label: '팔 길이',   unit: 'cm', matched: false },
  legLength: { min: 60, max: 110, base: FIXED.legLength, label: '다리 길이', unit: 'cm', matched: false },
} as const;
export type AxisKey = keyof typeof INPUT_AXES;
export const AXIS_KEYS = Object.keys(INPUT_AXES) as AxisKey[];

export type ClampResult = { value: number; clamped: boolean };

/** 범위 밖 숫자 → **최근접 경계로 클램프**하고 «그 사실»을 돌려준다(조용히 고치지 않는다 · #121 계열).
 * 숫자가 아니면(`NaN`) 기본값으로 되돌린다 — 빈 칸이 몸을 지우면 화면이 사라진다. */
export function clampAxis(k: AxisKey, v: number): ClampResult {
  const a = INPUT_AXES[k];
  if (!Number.isFinite(v)) return { value: a.base, clamped: true };
  if (v < a.min) return { value: a.min, clamped: true };
  if (v > a.max) return { value: a.max, clamped: true };
  return { value: v, clamped: false };
}

/** 한 축의 최근접 격자점. **동률은 «기본 몸» 쪽**(v3-79 §1 등재 규칙).
 * 기본 몸 = 축의 `base`(가슴 100 · 키 170 · 어깨 45) ⟹ 격자점 셋 중 «가운데»다. */
export function nearestPoint(k: 'chest' | 'height' | 'shoulder', v: number): number {
  const a = AXES[k];
  const ps = pointsOf(a);
  let best = ps[0], bd = Math.abs(v - ps[0]);
  for (const p of ps) {
    const d = Math.abs(v - p);
    /* `<` 가 아니라 `< || (=== && p가 기본)` — **동률에서만** 기본 몸이 이긴다. */
    if (d < bd || (d === bd && p === a.base)) { best = p; bd = d; }
  }
  return best;
}

export type Body3 = { chest: number; height: number; shoulder: number };
export type MatchAxis = { key: 'chest' | 'height' | 'shoulder'; input: number; matched: number; same: boolean };
export type MatchResult = { body: Body3; axes: MatchAxis[]; changed: MatchAxis[] };

/** 3축 «독립» 최근접 매칭. 팔·다리는 받지도 않는다 — **매칭 미사용**이 서명에 드러나야 한다. */
export function matchBody(input: Body3): MatchResult {
  const axes = (['chest', 'height', 'shoulder'] as const).map((key) => {
    const matched = nearestPoint(key, input[key]);
    return { key, input: input[key], matched, same: matched === input[key] };
  });
  return {
    body: { chest: axes[0].matched, height: axes[1].matched, shoulder: axes[2].matched },
    axes,
    /** 알림에 쓸 축 — **일치 축은 «생략»**한다(§1 등재). */
    changed: axes.filter((a) => !a.same),
  };
}
