// P2c(f) → P3 §3 — **착장 실행 버튼**(DEV · `?patterncore=1`에서만).
//
// A안(명시적 실행): 누르면 워커가 풀 시뮬을 돌린다. 시뮬은 워커에서 도니 UI는 얼지 않는다.
//
// P3 §3 — 실행 안정화 3종:
//  ① **경쟁 처리**: 실행 중 재클릭은 «무시»한다(버튼 비활성 + 로그). 그리고 실행마다
//     `runId`를 찍어 **뒤늦게 도착한 결과가 새 결과를 덮지 못하게** 한다. 이전 워커는
//     새 실행 전에 반드시 terminate한다. P2c에서 워커 2개가 겹쳐 돈 관측의 처방이다.
//  ② **진행률**: `f/260` — DONE f=260이 기준선의 정착 프레임이라 그것을 분모로 쓴다
//     (목표치일 뿐 상한이 아니다 · 넘어가면 그대로 넘겨 표시한다).
//  ③ **실패 표시**: `placementRestGate` throw(104가 e=3cm에서 맞은 것)는 슬라이더를
//     극단으로 밀면 실제로 난다. 크래시가 아니라 «이 치수로는 착장 실패»로 보여야 한다.
//
// 옷 치수는 슬라이더에서 온다(P3 §1). **`shoulderWidth`는 넘기지 않는다** — 그 값은
// fixture 포즈의 핀 간격(44.9995cm)에서 나오고 슬라이더 기본값 45cm와 달라서, 넘기면
// 기본 슬라이더에서 기준선 A가 깨진다(= 배선이 값을 오염시킨 경우).
//
// 결과는 `window` CustomEvent로 `PatternPreview`에 넘긴다. `?patternstate=1`의 옛
// dress-state fetch 경로는 **그대로 남는다**(회귀 대조용 — 제거 0).
import { useRef, useState } from "react";
import { useFitStore } from "../store/useFitStore";
import type { DressWorkerMessage, DressWorkerRequest } from "../workers/patternDressWorker";

export const DRESS_RESULT_EVENT = "v2-dress-result";

/** 진행률 분모 — 기준선 A의 정착 프레임. 상한이 아니라 «목표치»다. */
const SETTLE_TARGET_FRAMES = 260;

export function DressButton(): React.JSX.Element | null {
  const params = new URLSearchParams(window.location.search);
  const on = params.get("patterncore") === "1";
  // 기준선 A는 `RINGTOTAL=0`이다 — 대조 실행에서 같은 값을 쓰려면 `?ringtotal=0`.
  const ringTotal = params.get("ringtotal") !== "0";
  const garmentSize = useFitStore((s) => s.garmentSize);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  if (!on) return null;

  const run = (): void => {
    if (busy) { console.log("[dress] 이미 실행 중 — 이번 클릭은 무시한다(P3 §3①)"); return; }
    workerRef.current?.terminate();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setBusy(true);
    setNote("착장 중…");
    const t0 = performance.now();
    const dims = {
      lengthM: garmentSize.length / 100,
      widthM: garmentSize.width / 100,
      sleeveLengthM: garmentSize.sleeveLength / 100,
      sleeveWidthM: garmentSize.sleeveWidth / 100,
    };
    const worker = new Worker(new URL("../workers/patternDressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<DressWorkerMessage>) => {
      // 뒤늦게 도착한 이전 실행의 메시지는 버린다.
      if (runId !== runIdRef.current) { console.log(`[dress] 낡은 실행(run ${runId})의 메시지 — 버린다`); return; }
      const m = ev.data;
      if (m.type === "progress") { setNote(`${m.state} f=${m.frame}/${SETTLE_TARGET_FRAMES}`); return; }
      const finish = (): void => { setBusy(false); worker.terminate(); if (workerRef.current === worker) workerRef.current = null; };
      if (m.type === "error") {
        console.error("[dress] 워커 오류", m.error);
        setNote("오류 — 콘솔 참고");
        finish(); return;
      }
      const s = Math.round(performance.now() - t0) / 1000;
      // 착장 «실패»(34게이트 throw 등)는 크래시가 아니다 — 좌표를 반영하지 않고 사유를 보인다.
      if (!m.ok) {
        console.warn(`[dress] 착장 실패 — ${m.error ?? "사유 미상"} (${s.toFixed(1)}s)`);
        setNote(`착장 실패 — ${(m.error ?? "사유 미상").slice(0, 60)}`);
        finish(); return;
      }
      console.log(
        `[dress] 완료 ${m.state} f=${m.frames} retry=${m.retry} · 벽시계 ${s.toFixed(1)}s (워커 내부 ${Math.round(m.elapsedMs)}ms)` +
        ` · 옷 치수(cm) 총장 ${garmentSize.length} · 품 ${garmentSize.width}(완성 폐둘레 ${garmentSize.width * 2}) · 소매길이 ${garmentSize.sleeveLength} · 소매통 ${garmentSize.sleeveWidth}`,
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
      finish();
    };
    worker.postMessage({ ringTotal, garmentDims: dims } satisfies DressWorkerRequest);
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
