/* v3-35 §1·§3 — v3 착장의 «별도 진입». `?v3=1` 일 때만 뜬다.
 *
 * 제품 기본 경로는 **여전히 v2**다(회차 프롬프트 금지 조항). 이 패널은 v3 코어를
 * 워커에서 돌려 결과를 그리고, §3 UX 4요건(진행률 · 취소 · 백그라운드 완주 · 실패 고지)을
 * 값으로 확인할 수 있게 한다. 물리·조립은 한 줄도 여기 없다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { render as rasterize, VIEWS, type Mesh } from "../v3/raster.ts";
import { renderProduct, PRODUCT_VIEWS } from "../v3/productView.ts";
import { withBridge } from "../v3/seamBridge.ts";

const FABRICS = ["gray", "denim", "sweat", "swim"] as const;
/** v3-41 §2 — C-브라우저 정착 상태(v3-38 산출). **표시 전용 · 물리 0프레임**. */
const SETTLED = [
  { label: "gray d9 (정착 220)", fab: "gray", d: 9, frame: 220, url: "/v3diag/settled-gray-d9.bin" },
  { label: "swim d10 (정착 180)", fab: "swim", d: 10, frame: 180, url: "/v3diag/settled-swim-d10.bin" },
  { label: "sweat d9 (정착 190)", fab: "sweat", d: 9, frame: 190, url: "/v3diag/settled-sweat-d9.bin" },
  /* v3-47 — 해상도 상향 «후보». 구 정본 3종은 위에 그대로 남는다(무삭제). */
  { label: "swim d9 신 (정착 260 · 후보)", fab: "swim", d: 9, frame: 260, url: "/v3diag/settled-swim-d9-new.bin" },
  /* v3-48 — sweat d8 «후보»(하드 게이트 전 채널 통과). 구 sweat d9 는 위에 그대로 남는다. */
  { label: "sweat d8 신 (정착 330 · 후보)", fab: "sweat", d: 8, frame: 330, url: "/v3diag/settled-sweat-d8-new.bin" },
] as const;

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
  const [dMm, setDMm] = useState<number>(11);
  const [hidden, setHidden] = useState<number>(0);        // 백그라운드에서 받은 진행 수
  const workerRef = useRef<Worker | null>(null);
  const blobRef = useRef<Uint8Array | null>(null);
  /* v3-41 §1 — 표시 전용. 물리에 관여하지 않는다. */
  const sceneRef = useRef<{ pos: Float32Array; idx: Uint32Array; bodyPos: Float32Array; bodyIdx: Uint32Array; bridgeIdx?: Uint32Array } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewIx, setViewIx] = useState(0);
  const [shaHex, setShaHex] = useState<string>("");
  const [capFrame, setCapFrame] = useState<number | null>(null);
  /* v3-43 §2 — 제품급 표시 층. 진단 래스터와 «별도»이고 그것을 대체하지 않는다. */
  const pCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pViewIx, setPViewIx] = useState(1);        // 기본 side-p (불합격 지목 구도)
  const [mode, setMode] = useState<"diag" | "prod">("prod");
  /* v3-45 — 시접 브리지. **표시 전용**(정점 0 추가 · 상태 무변조). 진단 래스터에서는 «벌»이고
   * **off 가 등재 기준**이다. 제품 씬은 기본 on(모델이 지고 있는 두께를 그린다). */
  const [bridge, setBridge] = useState(true);
  const [uxLog, setUxLog] = useState<string[]>([]);

  useEffect(() => () => workerRef.current?.terminate(), []);
  /* v3-41 ㉠ — 진행 로그를 «계기 채널»로 노출한다(판정 자동화용 · 물리 무관) */
  useEffect(() => { (window as unknown as Record<string, unknown>).__v3ux = uxLog; }, [uxLog]);
  /* v3-43 §3 — «무변조» 확인 채널. 표시 전후로 불러 sha 를 대조한다.
   * payload = 주입 blob 의 헤더 제외분 · pos = 화면이 실제로 읽는 옷 정점 배열. */
  useEffect(() => {
    const sha = async (b: ArrayBuffer) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
        .map((x) => x.toString(16).padStart(2, "0")).join("");
    (window as unknown as Record<string, unknown>).__v3state = async () => {
      const blob = blobRef.current, S = sceneRef.current;
      if (!blob || !S) return null;
      const hl = new DataView(blob.slice().buffer).getUint32(0, true);
      return { payload: await sha(blob.slice(4 + hl).buffer), pos: await sha(S.pos.slice().buffer) };
    };
  }, []);

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
        setUxLog((L) => [...L, `f=${m.frame}/${m.frames} net=${m.netMm.toFixed(4)}mm hidden=${document.hidden ? 1 : 0}`]);
        if (document.hidden) setHidden((h) => h + 1);      // ㉣③ 백그라운드 완주 확인용
        return;
      }
      /* v3-46 ㉣ — 워커가 내는 S4 게이트 결과를 계기 채널로 노출한다(표시·판정 자동화용). */
      if (m.kind === "s4") {
        (window as unknown as Record<string, unknown>).__v3s4 = m.s4;
        console.log(`[v3] s4 ${JSON.stringify(m.s4)}`);
        return;
      }
      if (m.kind === "done") {
        blobRef.current = m.blob;
        sceneRef.current = { pos: m.pos, idx: m.idx, bodyPos: m.bodyPos, bodyIdx: m.bodyIdx, bridgeIdx: m.bridgeIdx };
        // §2 자동 대조 채널 — CC가 콘솔·window로 읽는다. 바이트를 옮기지 않고 해시로 본다.
        void (async () => {
          const h = await crypto.subtle.digest("SHA-256", m.blob.slice().buffer);
          const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
          (window as unknown as Record<string, unknown>).__v3 = {
            frame: m.frame, diverged: m.diverged, stopped: m.stopped,
            elapsedMs: m.elapsedMs, bytes: m.blob.byteLength, sha256: hex,
            hiddenTicks: hidden, blob: m.blob,
          };
          setShaHex(hex);
          console.log(`[v3] sha256=${hex} bytes=${m.blob.byteLength} frame=${m.frame}`);
        })();
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
      fabric, d: dMm / 1000, frames,
    });
  }, [fabric, frames, hidden, dMm]);

  const cancel = useCallback(() => workerRef.current?.postMessage({ kind: "cancel" }), []);

  /** v3-41 §2 — 정착 상태를 «주입»해 표시만 한다(프레임 0 · 물리 0). */
  const [settledIx, setSettledIx] = useState(0);
  const showSettled = useCallback(() => {
    const S = SETTLED[settledIx];
    workerRef.current?.terminate();
    setReady(null); setProg(null); setMsg(""); blobRef.current = null; sceneRef.current = null;
    setPhase("prep"); setFabric(S.fab); setDMm(S.d); setCapFrame(null);
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.kind === "ready") { setReady(m); return; }
      if (m.kind === "error") { setPhase("error"); setMsg(m.message); return; }
      if (m.kind !== "done") return;
      blobRef.current = m.blob;
      sceneRef.current = { pos: m.pos, idx: m.idx, bodyPos: m.bodyPos, bodyIdx: m.bodyIdx, bridgeIdx: m.bridgeIdx };
      /* 파일명·표시에 쓰는 sha 는 «상태 페이로드»(헤더 제외)다 — 헤더의 frame 은 재발행으로 바뀐다 */
      const dv = new DataView(m.blob.slice().buffer);
      const hl = dv.getUint32(0, true);
      const h = await crypto.subtle.digest("SHA-256", m.blob.slice(4 + hl).buffer);
      const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setShaHex(hex); setCapFrame(S.frame);
      setPhase("done"); setMsg(`정착 상태 표시 — 정착 프레임 ${S.frame} · 물리 0프레임 · 상태 페이로드 sha`);
      console.log(`[v3] settled sha256=${hex}`);
    };
    w.postMessage({
      kind: "start", glbUrl: `${import.meta.env.BASE_URL}models/mannequin.glb`,
      fabric: S.fab, d: S.d / 1000, frames: 0, injectStateUrl: S.url,
    });
  }, [settledIx]);

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

  /* v3-41 §2 — **읽기 전용 표시**. 상태 배열을 «읽기»만 하고 한 바이트도 쓰지 않는다.
   * 구도는 `src/v3/raster.ts` 의 등재 3뷰 프리셋(front · sideXplus · back) 그대로다. */
  /* 표시용 인덱스 — 브리지가 켜져 있고 워커가 실어 보냈을 때만 이어 붙인다. 원본 불변. */
  const dIdx = useCallback((S: { idx: Uint32Array; bridgeIdx?: Uint32Array }) =>
    bridge && S.bridgeIdx && S.bridgeIdx.length ? withBridge(S.idx, S.bridgeIdx) : S.idx, [bridge]);
  const draw = useCallback((vi: number) => {
    const S = sceneRef.current, cv = canvasRef.current;
    if (!S || !cv) return;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const P of [S.bodyPos, S.pos])
      for (let i = 0; i < P.length; i += 3)
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i + c]); hi[c] = Math.max(hi[c], P[i + c]); }
    const meshes: Mesh[] = [
      { pos: S.bodyPos, idx: S.bodyIdx, color: [190, 185, 178] },
      { pos: S.pos, idx: dIdx(S), color: [40, 90, 200] },
    ];
    const W = cv.width, H = cv.height;
    const rgb = rasterize(meshes, VIEWS[vi], { lo, hi }, W, H);
    const g = cv.getContext("2d");
    if (!g) return;
    const img = g.createImageData(W, H);
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      img.data[i * 4] = rgb[j]; img.data[i * 4 + 1] = rgb[j + 1];
      img.data[i * 4 + 2] = rgb[j + 2]; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [dIdx]);

  useEffect(() => { if (sceneRef.current) draw(viewIx); }, [viewIx, draw, phase]);

  /* v3-43 §2 — 제품 씬. **상태 배열을 읽기만 한다**(productView 가 사본으로 지오메트리를 만든다). */
  const drawProd = useCallback((vi: number, scale?: number) => {
    const S = sceneRef.current, cv = pCanvasRef.current;
    if (!S || !cv) return;
    /* 화면은 devicePixelRatio, **캡처는 CAP_SCALE 배**로 그린다. 이 기계의 dPR 은 1 이라
     * 그대로 두면 캡처가 진단 래스터와 같은 300×420 이 되어 «제품급»이 성립하지 않는다.
     * 표시 층 파라미터이고 물리·문턱 채널이 아니다. */
    renderProduct(cv, { pos: S.bodyPos, idx: S.bodyIdx }, { pos: S.pos, idx: dIdx(S) },
                  PRODUCT_VIEWS[vi], 300, 420, scale);
  }, [dIdx]);
  const CAP_SCALE = 3;
  useEffect(() => { if (mode === "prod" && sceneRef.current) drawProd(pViewIx); }, [pViewIx, drawProd, phase, mode]);

  const nameOf = useCallback((v: string) =>
    `v3-45-${fabric}-d${Math.round(dMm)}-f${capFrame ?? prog?.frame ?? frames}-${shaHex.slice(0, 8)}-${v}.png`,
    [fabric, dMm, capFrame, prog, frames, shaHex]);
  const dl = useCallback((b: Blob | null, name: string) => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, []);

  /** 제품 캡처 3장 — front-p · side-p · back-p */
  const captureProd = useCallback(async () => {
    const cv = pCanvasRef.current;
    if (!cv || !sceneRef.current) return;
    /* **순차**로 돈다. `toBlob` 이 비동기라 forEach 로 돌리면 콜백이 뜰 때쯤
     * 캔버스가 이미 «다음 뷰»로 덮여 있고, 연속 다운로드도 막힌다(1차 실패 관측: 3장 중 1장). */
    for (let i = 0; i < PRODUCT_VIEWS.length; i++) {
      drawProd(i, CAP_SCALE);
      const b = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/png"));
      dl(b, nameOf(PRODUCT_VIEWS[i].name));
      await new Promise((r) => setTimeout(r, 700));
    }
    drawProd(pViewIx);
  }, [drawProd, dl, nameOf, pViewIx]);

  /** 대조 1장 — 왼쪽 제품 side-p · 오른쪽 «같은 상태»의 진단 래스터 sideXplus.
   *  **판정 자료가 아니라 편의**다(v3-43 §0-4). */
  const captureCompare = useCallback(async () => {
    const S = sceneRef.current, cv = pCanvasRef.current;
    if (!S || !cv) return;
    const si = VIEWS.findIndex((v) => v.name === "sideXplus");
    drawProd(PRODUCT_VIEWS.findIndex((v) => v.name === "side-p"), CAP_SCALE);
    const H = cv.height, Wp = cv.width, Wd = Math.round((300 / 420) * H);
    const out = document.createElement("canvas");
    out.width = Wp + Wd; out.height = H;
    const g = out.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(cv, 0, 0);
    /* 진단 래스터를 «같은 상태»로 다시 낸다 — 등재 프리셋·등재 해상도 그대로 확대만 한다 */
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const A of [S.bodyPos, S.pos])
      for (let i = 0; i < A.length; i += 3)
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], A[i + c]); hi[c] = Math.max(hi[c], A[i + c]); }
    const rgb = rasterize([{ pos: S.bodyPos, idx: S.bodyIdx, color: [190, 185, 178] },
                           { pos: S.pos, idx: dIdx(S), color: [40, 90, 200] }],
                          VIEWS[si], { lo, hi }, 300, 420);
    const tmp = document.createElement("canvas");
    tmp.width = 300; tmp.height = 420;
    const tg = tmp.getContext("2d");
    if (!tg) return;
    const img = tg.createImageData(300, 420);
    for (let i = 0, j = 0; i < 300 * 420; i++, j += 3) {
      img.data[i * 4] = rgb[j]; img.data[i * 4 + 1] = rgb[j + 1];
      img.data[i * 4 + 2] = rgb[j + 2]; img.data[i * 4 + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, Wp, 0, Wd, H);
    g.fillStyle = "#111"; g.font = `${Math.round(H / 30)}px sans-serif`;
    g.fillText("제품 표시 side-p", 8, H - 8);
    g.fillText("진단 래스터 sideXplus", Wp + 8, H - 8);
    const cb = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    dl(cb, nameOf("compare-side"));
    drawProd(pViewIx);
  }, [drawProd, dl, nameOf, pViewIx]);


  const capture = useCallback(() => {
    const cv = canvasRef.current, S = sceneRef.current;
    if (!cv || !S) return;
    VIEWS.forEach((v, i) => {
      draw(i);
      cv.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = `v3-41-${fabric}-d${Math.round(dMm)}-f${capFrame ?? prog?.frame ?? frames}-${shaHex.slice(0, 8)}-${v.name}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
    });
    setTimeout(() => draw(viewIx), 50);
  }, [draw, fabric, frames, prog, shaHex, viewIx, dMm, capFrame]);

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
        <label className="flex items-center gap-1">d
          <input className="w-14 rounded border px-1 py-0.5" type="number" value={dMm}
                 onChange={(e) => setDMm(Number(e.target.value))}
                 disabled={phase === "prep" || phase === "run"} />mm
        </label>
      </div>
      <div className="mb-2 flex gap-2">
        <button className="rounded bg-black px-2 py-1 text-white disabled:opacity-40"
                onClick={start} disabled={phase === "prep" || phase === "run"}>실행</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={cancel} disabled={phase !== "run"}>취소</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={save} disabled={!blobRef.current}>상태 저장</button>
      </div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <select className="rounded border px-1 py-0.5" value={settledIx}
                onChange={(e) => setSettledIx(Number(e.target.value))}
                disabled={phase === "prep" || phase === "run"}>
          {SETTLED.map((s2, i) => <option key={s2.url} value={i}>{s2.label}</option>)}
        </select>
        <button className="rounded bg-slate-700 px-2 py-1 text-white disabled:opacity-40"
                onClick={showSettled} disabled={phase === "prep" || phase === "run"}>정착 상태 표시</button>
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

      {/* v3-43 §2 — 제품급 표시 층(기본) ↔ v3-41 진단 래스터(등재 3뷰 프리셋 · 무변경) */}
      <div className="mt-2 flex gap-1 text-xs">
        <button onClick={() => setMode("prod")}
                className={`rounded border px-1.5 py-0.5 ${mode === "prod" ? "bg-black text-white" : ""}`}>제품 표시</button>
        <button onClick={() => setMode("diag")}
                className={`rounded border px-1.5 py-0.5 ${mode === "diag" ? "bg-black text-white" : ""}`}>진단 래스터</button>
        <label className="ml-1 flex items-center gap-1">
          <input type="checkbox" checked={bridge} onChange={(e) => setBridge(e.target.checked)} />
          시접 브리지
        </label>
      </div>

      <div className={mode === "prod" ? "mt-2" : "hidden"}>
        <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
          {PRODUCT_VIEWS.map((v, i) => (
            <button key={v.name} onClick={() => setPViewIx(i)}
                    className={`rounded border px-1.5 py-0.5 ${i === pViewIx ? "bg-black text-white" : ""}`}>
              {v.name}
            </button>
          ))}
          <button className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                  onClick={captureProd} disabled={!sceneRef.current}>캡처 3장</button>
          <button className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                  onClick={captureCompare} disabled={!sceneRef.current}>대조 1장</button>
        </div>
        <canvas ref={pCanvasRef} className="w-full rounded border" style={{ aspectRatio: "300 / 420" }} />
      </div>

      {/* v3-41 §2 — 읽기 전용 표시. 등재 3뷰 프리셋. */}
      <div className={mode === "diag" ? "mt-2" : "hidden"}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          {VIEWS.map((v, i) => (
            <button key={v.name} onClick={() => setViewIx(i)}
                    className={`rounded border px-1.5 py-0.5 ${i === viewIx ? "bg-black text-white" : ""}`}>
              {v.name}
            </button>
          ))}
          <button className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                  onClick={capture} disabled={!sceneRef.current}>캡처 3장</button>
        </div>
        <canvas ref={canvasRef} width={300} height={420}
                className="w-full rounded border bg-white" />
        {shaHex && <div className="mt-1 break-all text-[10px] text-gray-500">sha256 {shaHex}</div>}
      </div>
    </div>
  );
}

/** `?v3=1` 일 때만 그린다 */
export function V3PanelGate() {
  const on = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("v3") === "1";
  return on ? <V3Panel /> : null;
}
