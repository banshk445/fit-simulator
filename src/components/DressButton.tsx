// P2c(f) — **임시 착장 실행 버튼**(DEV · `?patterncore=1`에서만).
//
// A안(명시적 실행): 누르면 워커가 풀 시뮬을 돌린다(스크립트 실측 ~20s). 시뮬은
// 워커에서 도니 UI는 얼지 않는다. 완료·실패는 콘솔로 확인한다.
// 진행률 UI·취소·에러 복구·재실행 경쟁 처리는 **다음 판**이다 — 여기서는
// 실행 중 버튼을 비활성화하는 것으로만 재진입을 막는다.
//
// 결과는 `window` CustomEvent로 `PatternPreview`에 넘긴다. store 스키마를
// 늘리지 않으려는 선택이고, `?patternstate=1`의 옛 dress-state fetch 경로는
// **그대로 남는다**(회귀 대조용 — 제거 0).
import { useState } from "react";
import type { DressWorkerMessage, DressWorkerRequest } from "../workers/patternDressWorker";

export const DRESS_RESULT_EVENT = "v2-dress-result";

export function DressButton(): React.JSX.Element | null {
  const params = new URLSearchParams(window.location.search);
  const on = params.get("patterncore") === "1";
  // 기준선 A는 `RINGTOTAL=0`이다 — 대조 실행에서 같은 값을 쓰려면 `?ringtotal=0`.
  const ringTotal = params.get("ringtotal") !== "0";
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!on) return null;

  const run = (): void => {
    setBusy(true);
    setNote("착장 중…");
    const t0 = performance.now();
    const worker = new Worker(new URL("../workers/patternDressWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<DressWorkerMessage>) => {
      const m = ev.data;
      if (m.type === "progress") { setNote(`${m.state} f=${m.frame}`); return; }
      if (m.type === "error") {
        console.error("[dress] 워커 오류", m.error);
        setNote("오류 — 콘솔 참고");
        setBusy(false); worker.terminate(); return;
      }
      const s = Math.round(performance.now() - t0) / 1000;
      console.log(
        `[dress] 완료 ${m.state} f=${m.frames} retry=${m.retry} · 벽시계 ${s.toFixed(1)}s (워커 내부 ${Math.round(m.elapsedMs)}ms)` +
        (m.error ? ` · 실패: ${m.error}` : ""),
      );
      if (m.metrics) {
        const q = m.metrics;
        console.log(
          `[dress·정합] cov ${q.covPct.toFixed(1)}% (${q.covExposed}/${q.covTotal}) · maxStrain ${q.maxStrain.toFixed(3)}(정점 ${q.maxStrainAt}) · ` +
          `maxSeamGap ${q.maxSeamGapMm.toFixed(2)}mm · Δ20 ${q.delta20Mm.toFixed(2)}mm · 자기교차 ${q.selfIntersections} · ` +
          `관통 ${q.insideCount}/${q.insideTotal} · 목선 링 ${q.ringLenCm.toFixed(2)}cm · ` +
          `밑단 앞 ${q.hemFrontCm.toFixed(2)} / 뒤 ${q.hemBackCm.toFixed(2)} / 합 ${(q.hemFrontCm + q.hemBackCm).toFixed(2)}cm · ` +
          `ringTotal=${ringTotal ? "on" : "off(=RINGTOTAL=0)"}`,
        );
      }
      window.dispatchEvent(new CustomEvent(DRESS_RESULT_EVENT, {
        detail: { positions: m.positions, panelStarts: m.panelStarts, panelCounts: m.panelCounts },
      }));
      setNote(`${m.state} f=${m.frames} · ${s.toFixed(1)}s`);
      setBusy(false);
      worker.terminate();
    };
    worker.postMessage({ ringTotal } satisfies DressWorkerRequest);
  };

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded bg-black/60 px-3 py-2 text-sm text-white">
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="rounded bg-white px-3 py-1 text-black disabled:opacity-50"
      >
        착장하기
      </button>
      <span>{note}</span>
    </div>
  );
}
