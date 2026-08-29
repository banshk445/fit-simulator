/* v3-79 §2 — **버튼 상태의 «단일» 도출점**. 정본 2종(§6)을 «읽어» 상태를 낸다.
 *
 * ★ 이 파일이 존재하는 이유는 **화면에 분류 로직을 한 줄도 두지 않기 위해서**다(§3 grep 대상).
 *   화면은 `buttonState()` 가 돌려준 것을 **그리기만** 한다 — 상태를 «재계산»하지 않는다.
 * ★ **여기서 새로 분류하지 않는다**: 「활성인가」는 제공 목록이, 「왜 회색인가」는 분류 정본이 정한다.
 *   문턱·정본 0 · 두 파일 **읽기만**(§0-7).
 */

/** 분류 정본 한 칸 — `index-merged-108.json` 의 값. **읽는 필드만** 적는다. */
export type CellRecord = {
  status: '편입' | '보류' | '착용불가';
  f?: number; sec?: number; gate?: string; reason?: string;
  sha?: string; host?: string;
};
export type Canon = { provide: string[]; index: Record<string, CellRecord> };

export type ButtonState = {
  /** 활성 = 착장을 보여준다. 회색 = 못 보여준다. **이 둘뿐이다.** */
  active: boolean;
  /** 회색의 «성격» — 사유 열람이 붙는가(`착용불가`), 아닌가(`검증`). 활성이면 `null`. */
  gray: '착용불가' | '검증' | null;
  /** 버튼 밑 한 줄. */
  note: string;
  /** 사유 열람 본문 — **착용불가에만** 있다(보류·경계는 열람 «없음» · §0-5). */
  detail: string | null;
};

/** 착용불가 3종의 **자기 문언**. 원문 `reason` 을 그대로 싣고, ㉠ 에만 **ARM_G 조건부 문언**을 붙인다.
 * ★ ㉡·㉢ 에 ARM_G 문언이 새면 §0-5 「혼입 금지」 위반이다. */
function detailOf(r: CellRecord): string {
  const reason = r.reason ?? '(사유 미기록)';
  if (reason.startsWith('소매산')) {
    return `${reason}\n\n` +
      '이 사이즈의 소매산이 몸의 암홀보다 넓어 소매를 달 수 없습니다.\n' +
      '※ 사이즈 차트가 «암홀 둘레»를 제공하지 않아, 암홀은 전 사이즈 공통 제도 기본값' +
      '(ARM_G 0.4439)으로 두고 굽었습니다. 실측 암홀을 받으면 이 판정은 다시 냅니다.';
  }
  return reason;
}

/** **버튼 하나의 상태**. 규칙은 §6 정본 지정 그대로다 —
 *   ① 제공 목록에 있으면 **활성**
 *   ② 없으면 분류 정본의 `status` 가 회색 문언을 가른다
 *   ③ **편입인데 목록에 없는 칸**(= 경계 칸)은 **보류와 같은 문언**을 쓴다(「편입 ≠ 제공」). */
export function buttonState(canon: Canon, id: string): ButtonState {
  if (canon.provide.includes(id))
    return { active: true, gray: null, note: '입어본 결과 있음', detail: null };
  const r = canon.index[id];
  if (!r) return { active: false, gray: '검증', note: '검증 미통과로 제공되지 않음', detail: null };
  if (r.status === '착용불가')
    return { active: false, gray: '착용불가', note: '이 사이즈는 입힐 수 없습니다', detail: detailOf(r) };
  return { active: false, gray: '검증', note: '검증 미통과로 제공되지 않음', detail: null };
}
