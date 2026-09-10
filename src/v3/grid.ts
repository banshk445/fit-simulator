/* v3-77 §0-2·§0-5 — **본 그리드의 «순수» 정의**. 차트·축 점·칸 목록을 한 곳에 둔다.
 *
 * 순수성: `node:` 0 · 파일 0 · `process` 0 · three 0 · **v2 임포트 0**(G1) ⟹
 * 브라우저(몸 굽기 계기)와 Node(오케스트레이터)가 **같은 목록**을 만든다(#65 계열).
 * **이 파일이 새로 «정하는» 수는 0이다** — 전부 등재분이다:
 *   차트 = v3-77 §0-2(사용자 실측표) · 축 범위 = `src/components/Controls.tsx:128-137` ·
 *   점 규칙 = v3-77 §0-5 「min + ¼R · 기본값 · max − ¼R」 · ARM_G = v3-73 §0 처분.
 */

/** 사이즈 차트 8행[cm] — **정본**(v3-77 §0-2). 굽기 대상은 예산 안 B 로 **S·M·L·XL** 넷뿐이다. */
export const CHART = {
  XS:  { L: 63,   SW: 40,   W: 45.5, hwa: 39 },
  S:   { L: 65,   SW: 41.5, W: 48.5, hwa: 40 },
  M:   { L: 68,   SW: 43,   W: 51.5, hwa: 42 },
  L:   { L: 71,   SW: 44.5, W: 54.5, hwa: 44 },
  XL:  { L: 74,   SW: 46.5, W: 58.5, hwa: 46 },
  XXL: { L: 76,   SW: 48.5, W: 62.5, hwa: 47 },
  '3XL': { L: 76, SW: 50.5, W: 66.5, hwa: 48 },
  '4XL': { L: 76.5, SW: 52.5, W: 70.5, hwa: 49.5 },
} as const;

/** 예산 안 B(v3-77 §0-4)가 고른 굽기 대상 4종. 차트의 나머지 4행은 **정본으로 남되 굽지 않는다**. */
export const SIZES = ['S', 'M', 'L', 'XL'] as const;
export type Size = (typeof SIZES)[number];

/** `ARM_G` — **제도 기본값 · 전 사이즈 «공통»**(v3-73 §0 처분 유지).
 * ★ 한계: **차트가 암홀 둘레를 주지 않는다**(v3-69 결손 3 ㉡) ⟹ 차트에서 «도출한» 값이 아니다. */
export const ARM_G = 0.4439;

/** 차트 한 행 → v3 조립이 받는 옷 치수[m]. **`SLEN = 화장 − SW/2`**(v3-73 §0-3 도출식). */
export function garmentOf(size: Size) {
  const c = CHART[size];
  return { L: c.L / 100, W: c.W / 100, SW: c.SW / 100, SLEN: (c.hwa - c.SW / 2) / 100, ARM_G };
}

/** 축 범위 — `src/components/Controls.tsx:128-137` 등재분. **여기서 새로 정하지 않는다.** */
export const AXES = {
  chest:    { min: 70,  max: 140, base: 100 },
  height:   { min: 140, max: 200, base: 170 },
  shoulder: { min: 35,  max: 55,  base: 45 },
} as const;

/** 점 규칙 — **{ min + ¼R · 기본값 · max − ¼R }**(v3-77 §0-5 · 끝값 회피). */
export function pointsOf(a: { min: number; max: number; base: number }): [number, number, number] {
  const q = (a.max - a.min) / 4;
  return [a.min + q, a.base, a.max - q];
}

/** 매칭에 쓰지 않는 축 — **기본값 고정**(v3-76 §0-3 ③). */
export const FIXED = { armLength: 60, legLength: 85 } as const;

export type Body = { chest: number; height: number; shoulder: number };
export type Cell = { id: string; bodyId: string; body: Body; size: Size };

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(v));

/** 몸 27칸 — 축 순서는 **가슴 → 키 → 어깨**(로그·목록의 정렬 기준). */
export function bodies(): Body[] {
  const out: Body[] = [];
  for (const chest of pointsOf(AXES.chest))
    for (const height of pointsOf(AXES.height))
      for (const shoulder of pointsOf(AXES.shoulder)) out.push({ chest, height, shoulder });
  return out;
}

export const bodyIdOf = (b: Body) => `c${n(b.chest)}-h${n(b.height)}-s${n(b.shoulder)}`;

/** 108칸 — **몸 «우선» 순회**(몸 하나를 굽고 사이즈 4를 연달아 쓴다 ⟹ 굽기 1회 재사용). */
export function cells(): Cell[] {
  const out: Cell[] = [];
  for (const b of bodies()) {
    const bodyId = bodyIdOf(b);
    for (const size of SIZES) out.push({ id: `${bodyId}_${size}`, bodyId, body: b, size });
  }
  return out;
}
