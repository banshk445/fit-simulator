/* v3-66 §1 — **제품 «기본» 화면 = v3 정본 재생**(이관 1차 · Q3 = 최종 «대체»).
 *
 * **v2 코드는 한 줄도 지우지 않았다.** 구 화면은 아래 `V2Screen` 에 **원문 그대로** 남고
 * **`?v2=1`** 로 뜬다. 플래그 신설은 **「이관 중」 상태의 «명시»**이고 기본값이 아니다.
 * **G1 경계 등재**: 이 파일은 v2(`Controls`·`FitCanvas`·`DressButton`)와 v3(`V3Product`)를
 * **둘 다 임포트한다**. §0-5 ㉣ 대로 **«플래그 분기»는 «경계»로 등재**하며 **분기문 자체는 위반이 아니다** —
 * 금지되는 것은 **v3 코드가 v2 를 «소비»하는 것**이고, 여기서는 두 화면이 **서로를 소비하지 않는다**.
 */
import { Controls } from "./components/Controls";
import { FitCanvas } from "./components/FitCanvas";
import { DressButton } from "./components/DressButton";
import { V3PanelGate } from "./components/V3Panel";
import { V3Product } from "./components/V3Product";
import { V3ProductV1 } from "./components/V3ProductV1";

/** 구 v2 화면 — **원문 무삭제**. `?v2=1` 에서만 뜬다. */
function V2Screen() {
  return (
    <div className="flex h-screen w-full">
      <div className="w-[30%] min-w-[280px]">
        <Controls />
      </div>
      <div className="w-[70%] relative">
        <FitCanvas />
        <DressButton />
        <V3PanelGate />
      </div>
    </div>
  );
}

/* v3-79 §2 — **제품 «기본» 화면 = v1**(몸 입력 · 매칭 · 사이즈 넘겨보기).
 * v3-66~67 의 **정본 3종 재생 화면은 «무삭제»**로 남고 **`?canon=1`** 로 뜬다 —
 * `V3Product.tsx` 는 이 판에서 **한 글자도 바뀌지 않았다**(회귀 대조용).
 * ★ 기본을 v1 으로 옮긴 것은 «판정 대상»이다 — §5 A 로 상신하고 사용자가 최종 판정한다. */
function App() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  if (q?.get("v2") === "1") return <V2Screen />;
  return (
    <div className="relative h-screen w-full">
      {q?.get("canon") === "1" ? <V3Product /> : <V3ProductV1 />}
      <V3PanelGate />
    </div>
  );
}

export default App;
