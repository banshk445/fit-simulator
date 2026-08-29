/* v3-66 §1 — **제품 «기본» 화면**(쿼리 플래그 «없음»). v3 정본 재생 + 제품 씬.
 *
 * **물리 0프레임** — 워커에 `frames: 0` 과 `injectStateUrl` 만 넘긴다(v3-41~43 검증 경로 그대로).
 * **표시 토글은 «신규 0»** — 핏 맵 색 · 프린트 둘 다 `productView` / `printUv` / `printComposite` 의
 * **같은 계약**을 그대로 소비한다(V3Panel 과 동일 모듈 · 동일 인자). 이 파일에 렌더 로직은 없다.
 * **v2 임포트 0**(G1) — `fabricPresets` 를 «경유하지 않는다»(§0-4 ② · R5/R8).
 *
 * 이관 1차(Q3 = 최종 «대체»)다. **v2 코드는 한 줄도 지우지 않는다** — `?v2=1` 로 보존한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { renderProduct, PRODUCT_VIEWS } from "../v3/productView.ts";
import { withBridge } from "../v3/seamBridge.ts";
import { buildPrintUv, type PrintUv } from "../v3/printUv.ts";
import { compositePrint, type CompositeResult } from "../v3/printComposite.ts";
import { FABRICS } from "../v3/consts.ts";
import type { FitReportResult } from "../v3/fitReport.ts";
/* v3-67 §1 — 표·범례는 **V3Panel 과 같은 컴포넌트**를 쓴다(계산 채널 0줄 · 배치만 신규). */
import { FitLegend, FitReportTable } from "./FitReportTable.tsx";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";

/** **정본 3종**. `d` · `frame` · 페이로드 `sha` · 정점 `n` 은 **등재값의 전사**다 —
 * 출처는 `docs/metrics-log.md` v3-49 ㉢ 표(파일·크기·프레임·d·정점·페이로드 sha256).
 * **여기서 새로 정하는 값은 하나도 없다.** 로드 후 sha·정점 수를 **대조**하는 것이 §2-㉠ 이다.
 * **denim 은 목록에 없다**(#78 · 프리셋 코드는 `consts.ts` 에 **무삭제**로 남는다). */
const CANON = [
  { fab: "gray",  d: 9, frame: 220, url: "/v3diag/settled-gray-d9.bin", n: 10402,
    sha: "faf4873fb33cfa371d5c105410aab479291f58602a7d0500ebf2347d9e2a91f9" },
  { fab: "swim",  d: 9, frame: 260, url: "/v3diag/settled-swim-d9-new.bin", n: 10402,
    sha: "557bc4469a0f1b57288111319b1f8126af3117492bfe9a2b5ddf1593609d96ca" },
  { fab: "sweat", d: 8, frame: 330, url: "/v3diag/settled-sweat-d8-new.bin", n: 13248,
    sha: "51d74c668fa570f464d4287ee092bddd733c2d6ee8614a5b9d8cc28cec68932e" },
] as const;

type Scene = { pos: Float32Array; idx: Uint32Array; bodyPos: Float32Array; bodyIdx: Uint32Array;
               bridgeIdx?: Uint32Array };

export function V3Product() {
  const [ix, setIx] = useState(0);
  const [viewIx, setViewIx] = useState(0);
  const [fit, setFit] = useState<FitReportResult | null>(null);
  const [fitColor, setFitColor] = useState(true);
  const [printOn, setPrintOn] = useState(false);
  const [printUv, setPrintUv] = useState<PrintUv | null>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  const [comp, setComp] = useState<CompositeResult | null>(null);
  const [msg, setMsg] = useState("불러오는 중…");
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState<{ sha: string; n: number } | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const uMax = printUv?.panels.find((p) => p.name === "front")?.uMax ?? 1;
  /* 프린트 합성 — V3Panel 과 **같은 자산 · 같은 계약**(신규 0). */
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const r = compositePrint(im, im.naturalWidth, im.naturalHeight, uMax);
      const t = new CanvasTexture(r.canvas);
      t.colorSpace = SRGBColorSpace;
      setComp(r); setTex(t);
    };
    im.src = `${import.meta.env.BASE_URL}v3print/print-graphic.png`;
  }, [uMax]);

  /* 정본 재생 — **frames 0 · 주입만**. sha 와 정점 수를 **대조하고**, 어긋나면 **표시하지 않는다**(폴백 0). */
  useEffect(() => {
    const C = CANON[ix];
    workerRef.current?.terminate();
    sceneRef.current = null;
    setFit(null); setPrintUv(null); setChecked(null); setErr(""); setMsg("불러오는 중…");
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.kind === "error") { setErr(m.message); setMsg(""); return; }
      if (m.kind === "uv") { setPrintUv(buildPrintUv(m.uv, m.panels)); return; }
      if (m.kind === "fit") { if (m.fit) setFit(m.fit); return; }
      if (m.kind !== "done") return;
      /* 페이로드 sha — 헤더를 뺀 나머지. 헤더의 frame 은 재발행으로 바뀌므로 정본 셀에 못 쓴다. */
      const dv = new DataView(m.blob.slice().buffer);
      const hl = dv.getUint32(0, true);
      const h = await crypto.subtle.digest("SHA-256", m.blob.slice(4 + hl).buffer);
      const hex = [...new Uint8Array(h)].map((b: number) => b.toString(16).padStart(2, "0")).join("");
      const n = m.pos.length / 3;
      setChecked({ sha: hex, n });
      if (hex !== C.sha || n !== C.n) {
        setErr(`정본 대조 실패 — sha ${hex.slice(0, 8)}…(기대 ${C.sha.slice(0, 8)}…)`
             + ` · 정점 ${n}(기대 ${C.n}). **표시하지 않는다**(폴백 0).`);
        setMsg("");
        return;
      }
      sceneRef.current = { pos: m.pos, idx: m.idx, bodyPos: m.bodyPos, bodyIdx: m.bodyIdx,
                          bridgeIdx: m.bridgeIdx };
      setMsg(`${C.fab} d${C.d} 정본 · 정착 프레임 ${C.frame} · 물리 0프레임 · sha ${hex.slice(0, 8)}… · 정점 ${n}`);
    };
    w.postMessage({ kind: "start", glbUrl: `${import.meta.env.BASE_URL}models/mannequin.glb`,
                    fabric: C.fab, d: C.d / 1000, frames: 0, injectStateUrl: C.url });
    return () => w.terminate();
  }, [ix]);

  const draw = useCallback(() => {
    const S = sceneRef.current, cv = cvRef.current;
    if (!S || !cv) return;
    const idx = S.bridgeIdx && S.bridgeIdx.length ? withBridge(S.idx, S.bridgeIdx) : S.idx;
    renderProduct(cv, { pos: S.bodyPos, idx: S.bodyIdx },
      { pos: S.pos, idx,
        vcol: !printOn && fitColor && fit ? fit.color.rgb : undefined,
        print: printOn && printUv ? { uv: printUv.uv, panels: printUv.panels, tex, printPanel: "front",
          solid: comp ? ((Math.round(comp.color.r) << 16) | (Math.round(comp.color.g) << 8)
                        | Math.round(comp.color.b)) : undefined,
          bridgeIdx: S.bridgeIdx && S.bridgeIdx.length ? S.bridgeIdx : null } : null },
      /* v3-81 §1-① — 캔버스 폭 **480 → 840**. v3-80 이 프레이밍을 «기준 키 하나»로 바꾼 뒤
       * 이 폭에서는 T포즈 손이 잘렸다. 840 의 출처는 v3-80 `v3FramingCheck` 실측 **834.5px** 이고
       * v1 화면(`V3ProductV1.CANVAS`)과 **같은 값**이다. **이 파일에서 바뀐 것은 이 한 줄뿐이다.** */
      PRODUCT_VIEWS[viewIx], 840, 672);
  }, [viewIx, fitColor, fit, printOn, printUv, tex, comp]);
  useEffect(() => { draw(); }, [draw, msg]);

  const F = FABRICS[CANON[ix].fab];
  return (
    <div className="flex h-full w-full bg-[#0b1020]">
      <div className="w-[420px] shrink-0 overflow-auto border-r border-white/10 bg-[#141a2e] p-4 text-[12px] text-white/90">
        <div className="mb-3 text-[14px] font-semibold">Fit Simulator</div>
        <div className="mb-1 text-white/60">원단</div>
        <div className="mb-3 flex gap-1">
          {CANON.map((C, i) => (
            <button key={C.fab} onClick={() => setIx(i)}
              className={`rounded px-2 py-1 ${i === ix ? "bg-white text-black" : "bg-white/10"}`}>
              {C.fab}
            </button>
          ))}
        </div>
        {/* 라벨은 **등재 물성**에서 뜬다 — v2 `fabricPresets` 를 경유하지 않는다(R5/R8). */}
        <div className="mb-3 text-white/60">
          k {F.k} · ρ {F.rho} · B {F.B.toExponential(3)}
        </div>
        <div className="mb-1 text-white/60">보기</div>
        <div className="mb-3 flex gap-1">
          {PRODUCT_VIEWS.map((v, i) => (
            <button key={v.name} onClick={() => setViewIx(i)}
              className={`rounded px-2 py-1 ${i === viewIx ? "bg-white text-black" : "bg-white/10"}`}>
              {v.name}
            </button>
          ))}
        </div>
        <label className="mr-3 inline-flex items-center gap-1">
          <input type="checkbox" checked={fitColor} disabled={printOn}
                 onChange={(e) => setFitColor(e.target.checked)} />
          <span className={printOn ? "opacity-50" : ""}>핏 맵 색</span>
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={printOn} onChange={(e) => setPrintOn(e.target.checked)} />
          <span>프린트</span>
        </label>
        {fit && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <FitLegend fit={fit} />
          </div>
        )}
        {fit && <FitReportTable fit={fit} />}
        <div className="mt-3 whitespace-pre-wrap text-white/60">{msg}</div>
        {err && <div className="mt-2 whitespace-pre-wrap text-red-400">{err}</div>}
        {checked && (
          <div className="mt-2 text-[11px] text-white/40">
            대조: sha {checked.sha.slice(0, 16)}… · 정점 {checked.n}
          </div>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <canvas ref={cvRef} className="max-h-full max-w-full" />
      </div>
    </div>
  );
}
