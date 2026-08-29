/* v3-79 §2 · v3-80 §1-③⑥ — **버튼 상태와 착지 사이즈의 «단일» 도출점**. 정본 2종(§6)을 «읽어» 낸다.
 *
 * ★ 이 파일이 존재하는 이유는 **화면에 분류 로직을 한 줄도 두지 않기 위해서**다(§3 grep 대상).
 *   화면은 여기가 돌려준 것을 **그리기만** 한다 — 상태를 «재계산»하지 않는다.
 * ★ **여기서 새로 분류하지 않는다**: 「활성인가」는 제공 목록이, 「왜 회색인가」는 분류 정본이 정한다.
 *   문턱·정본 0 · 두 파일 **읽기만**.
 */

/** 분류 정본 한 칸 — `index-merged-108.json` 의 값. **읽는 필드만** 적는다. */
export type CellRecord = {
  status: '편입' | '보류' | '착용불가';
  f?: number; sec?: number; gate?: string; reason?: string;
  sha?: string; host?: string;
};
export type Canon = { provide: string[]; index: Record<string, CellRecord> };

/** 사이즈 순서 — **착지 규칙의 «거리»가 이 순서에서 나온다**(S=0 M=1 L=2 XL=3). */
export const SIZE_ORDER = ['S', 'M', 'L', 'XL'] as const;
export type SizeName = (typeof SIZE_ORDER)[number];
/** 기본 사이즈 — 착지 거리의 «원점». */
export const DEFAULT_SIZE: SizeName = 'M';

export type ButtonState = {
  /** 활성 = 착장을 보여준다. 회색 = 못 보여준다. **이 둘뿐이다.** */
  active: boolean;
  /** 회색의 «성격» — 사유 열람이 붙는가(`착용불가`), 아닌가(`검증`). 활성이면 `null`. */
  gray: '착용불가' | '검증' | null;
  /** 버튼 밑 한 줄(v3-80 §2-3 정본 문구). */
  note: string;
  /** 사유 «본문» — 착용불가에만 있다(보류·경계는 열람 «없음»). v3-80 §2-4 정본 문구. */
  detail: string | null;
  /** 사유 박스 «접힘» 안의 원문 — 굽기가 남긴 그대로. **문언 창작 0.** */
  raw: string | null;
};

/** 착용불가 3종의 **자기 문언**(v3-80 §2-4 정본).
 * ★ ㉠(소매산)에만 암홀·제도 설명이 붙는다. ㉡·㉢ 에 새면 「혼입 금지」 위반이다. */
function detailOf(r: CellRecord): { detail: string; raw: string } {
  const raw = r.reason ?? '(사유 미기록)';
  if (raw.startsWith('소매산')) {
    return {
      /* ㉠ — v3-78 정본: 암홀은 **몸판의 진동**이고, 차트에 치수가 없어 **제도 기본값**으로 만들었다.
       * (v3-79 의 「몸의 암홀」은 사실 오류였다 — 암홀은 몸이 아니라 옷 몸판에 뚫린 구멍이다.) */
      detail: '소매가 몸판의 암홀보다 넓어 달 수 없습니다. 사이즈 차트에 암홀 치수가 없어'
        + ' 기본 제도값으로 만들었기 때문이며, 실측 암홀을 받으면 다시 판정합니다.',
      raw: `${raw} · 제도 기본값 ARM_G 0.4439`,
    };
  }
  /* ㉡ 옆 틈 G · ㉢ 목 밑동 — **같은 겉면 문언 · 원문은 각자 접힘 안**. */
  return { detail: '이 사이즈는 이 몸에 정상적으로 입혀지지 않아 제공하지 않습니다.', raw };
}

/** **버튼 하나의 상태**. 규칙은 §6 정본 지정 그대로다 —
 *   ① 제공 목록에 있으면 **활성**
 *   ② 없으면 분류 정본의 `status` 가 회색 문언을 가른다
 *   ③ **편입인데 목록에 없는 칸**(= 경계 칸)은 **보류와 같은 문언**을 쓴다(「편입 ≠ 제공」). */
export function buttonState(canon: Canon, id: string): ButtonState {
  if (canon.provide.includes(id))
    return { active: true, gray: null, note: '입어본 결과 있음', detail: null, raw: null };
  const r = canon.index[id];
  const 검증 = { active: false, gray: '검증' as const, note: '검증을 통과하지 못해 제공하지 않습니다', detail: null, raw: null };
  if (!r || r.status !== '착용불가') return 검증;
  const d = detailOf(r);
  return { active: false, gray: '착용불가', note: '이 사이즈는 만들 수 없습니다', detail: d.detail, raw: d.raw };
}

export type Landing = { size: SizeName | null; fallback: boolean };

/** v3-80 §1-⑥ — **회색 착지**. 매칭 몸에서 «어느 사이즈로 착지하는가».
 *
 * 규칙(사전 등재): 제공되는 사이즈 중 기본 `M` 과의 **순서 거리 |i − 1| 최소** · **동률 = 큰 쪽** ·
 * 제공 0칸이면 **`null`**(착장 없음).
 * `fallback` 은 「기본 M 이 제공되지 않아 다른 사이즈로 갔다」는 사실이고 **배너 조건**이다.
 * ★ 여기에도 분류 리터럴은 없다 — 읽는 것은 **제공 목록 하나**다. */
export function landingSize(canon: Canon, bodyId: string): Landing {
  const avail = SIZE_ORDER.filter((s) => canon.provide.includes(`${bodyId}_${s}`));
  if (avail.length === 0) return { size: null, fallback: false };
  const base = SIZE_ORDER.indexOf(DEFAULT_SIZE);
  let best = avail[0];
  for (const s of avail) {
    const d = Math.abs(SIZE_ORDER.indexOf(s) - base), bd = Math.abs(SIZE_ORDER.indexOf(best) - base);
    /* 「<」 가 아니라 「< || (=== && 더 큰 쪽)」 — **동률에서만** 큰 사이즈가 이긴다. */
    if (d < bd || (d === bd && SIZE_ORDER.indexOf(s) > SIZE_ORDER.indexOf(best))) best = s;
  }
  return { size: best, fallback: best !== DEFAULT_SIZE };
}
