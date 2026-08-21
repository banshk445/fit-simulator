/* v3-35 §1·§3 — v3 착장의 «별도 진입». `?v3=1` 일 때만 뜬다.
 *
 * 제품 기본 경로는 **여전히 v2**다(회차 프롬프트 금지 조항). 이 패널은 v3 코어를
 * 워커에서 돌려 결과를 그리고, §3 UX 4요건(진행률 · 취소 · 백그라운드 완주 · 실패 고지)을
 * 값으로 확인할 수 있게 한다. 물리·조립은 한 줄도 여기 없다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const FABRICS = ["gray", "denim", "sweat", "swim"] as const;

type Phase = "idle" | "prep" | "run" | "done" | "error" | "cancelled";

type Ready = {
  n: number; tris: number; sub: number; rampN: number; placeSig: string; prepMs: number;
  dims: { neckHalfWidthCm: number; necklineGirthCm: number; capHeightCm: number; armholeDepthCm: number };
};

export function V3Panel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState<Ready | null>(null);
  const [prog, setProg] = useState<{ frame: number; frames: number; netMm: number; elapsedMs: number } | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [fabric, setFabric] = useState<string>("gray");
  const [frames, setFrames] = useState<number>(86);
  const [hidden, setHidden] = useState<number>(0);        // 백그라운드에서 받은 진행 수
  const workerRef = useRef<Worker | null>(null);
  const blobRef = useRef<Uint8Array | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = useCallback(() => {
    workerRef.current?.terminate();
    setReady(null); setProg(null); setMsg(""); setHidden(0); blobRef.current = null;
    setPhase("prep");
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "ready") { setReady(m); setPhase("run"); return; }
      if (m.kind === "progress") {
        setProg(m);
        if (document.hidden) setHidden((h) => h + 1);      // ㉣③ 백그라운드 완주 확인용
        return;
      }
      if (m.kind === "done") {
        blobRef.current = m.blob;
        setPhase(m.stopped ? "cancelled" : "done");
        setMsg(`프레임 ${m.frame} · ${(m.elapsedMs / 1000).toFixed(1)}초 · 발산 ${m.diverged ? "있음" : "0"}`);
        // 콘솔에도 남긴다 — 자동 대조가 읽는 채널이다
        console.log(`[v3] done frame=${m.frame} diverged=${m.diverged} stopped=${m.stopped} ms=${Math.round(m.elapsedMs)} hiddenTicks=${hidden}`);
        return;
      }
      if (m.kind === "error") {
        setPhase("error");
        setMsg(m.message);                                  // 관측 사실만 · 원인 단정 0
        console.log(`[v3] error ${m.message}`);
      }
    };
    w.postMessage({
      kind: "start",
      glbUrl: `${import.meta.env.BASE_URL}models/mannequin.glb`,
      fabric, d: 0.011, frames,
    });
  }, [fabric, frames, hidden]);

  const cancel = useCallback(() => workerRef.current?.postMessage({ kind: "cancel" }), []);

  const save = useCallback(() => {
    const b = blobRef.current;
    if (!b) return;
    const url = URL.createObjectURL(new Blob([b as unknown as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `v3-browser-${fabric}-${frames}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fabric, frames]);

  const pct = prog ? Math.round((prog.frame / prog.frames) * 100) : 0;

  return (
    <div className="absolute right-3 top-3 z-50 w-[320px] rounded-lg bg-white/95 p-3 text-sm shadow-lg ring-1 ring-black/10">
      <div className="mb-2 font-semibold">v3 착장 (별도 진입 · 제품 기본은 v2)</div>
      <div className="mb-2 flex items-center gap-2">
        <select className="rounded border px-1 py-0.5" value={fabric} onChange={(e) => setFabric(e.target.value)}
                disabled={phase === "prep" || phase === "run"}>
          {FABRICS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <label className="flex items-center gap-1">프레임
          <input className="w-20 rounded border px-1 py-0.5" type="number" value={frames}
                 onChange={(e) => setFrames(Number(e.target.value))}
                 disabled={phase === "prep" || phase === "run"} />
        </label>
        <span className="text-xs text-gray-500">d 11.0mm</span>
      </div>
      <div className="mb-2 flex gap-2">
        <button className="rounded bg-black px-2 py-1 text-white disabled:opacity-40"
                onClick={start} disabled={phase === "prep" || phase === "run"}>실행</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={cancel} disabled={phase !== "run"}>취소</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={save} disabled={!blobRef.current}>상태 저장</button>
      </div>

      {phase === "prep" && <div className="text-gray-600">장면 조립·SDF 굽는 중…</div>}
      {ready && (
        <div className="mb-1 text-xs text-gray-700">
          정점 {ready.n} · 삼각형 {ready.tris} · 서브스텝 {ready.sub} · 램프 {ready.rampN}<br />
          목선 {ready.dims.neckHalfWidthCm.toFixed(2)}/{ready.dims.necklineGirthCm.toFixed(2)}cm ·
          소매산 {ready.dims.capHeightCm.toFixed(2)}cm · 암홀깊이 {ready.dims.armholeDepthCm.toFixed(3)}cm<br />
          조립 {(ready.prepMs / 1000).toFixed(1)}초
        </div>
      )}
      {prog && (
        <div className="mb-1">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div className="h-2 bg-black" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-700">
            {prog.frame} / {prog.frames} 프레임 ({pct}%) · 창 순변위 {prog.netMm.toFixed(3)}mm ·
            {(prog.elapsedMs / 1000).toFixed(0)}초 · 백그라운드 수신 {hidden}
          </div>
        </div>
      )}
      {msg && <div className={phase === "error" ? "text-red-700" : "text-gray-800"}>{msg}</div>}
    </div>
  );
}

/** `?v3=1` 일 때만 그린다 */
export function V3PanelGate() {
  const on = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("v3") === "1";
  return on ? <V3Panel /> : null;
}
