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
/* v3-52 §1-4 — 핏 리포트 «표시»만 한다(계산은 워커의 `fitReport.ts`). */
import type { FitReportResult } from "../v3/fitReport.ts";
/* v3-67 §1 — 표·범례 마크업은 «공유»한다(제품 화면과 두 벌 쓰지 않는다). */
import { FitLegend, FitReportTable } from "./FitReportTable.tsx";
/* v3-59 §3 — 프린트 UV(정규화 층)와 패널 분리 렌더. **표시 전용 · 물리 0프레임.** */
import { buildPrintUv, type PrintUv } from "../v3/printUv.ts";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
/* v3-60 §1 — 프린트 «합성 층»(대표색 + 가슴 프린트). v2 계약 문언 준거 · 코드 임포트 0. */
import { compositePrint, type CompositeResult } from "../v3/printComposite.ts";
/* v3-70 §1-③ — **몸 주입 연결부**(계기). ★ **G1 경계 «명시»**: 이 임포트는 `src/lib/mannequinRef`
 * (v2 자산)를 «참조»한다. 살아있는 마네킹은 v2 씬에만 있고, 본 스케일 재구현은 §0-B ① 이 기각했다.
 * **V3Panel 자체가 «하네스·플래그 전용»**(v3-67 §0-3 분류)이므로 «제품 경로»는 오염되지 않는다 —
 * **제품 경로(`src/v3/**` · `V3Product` · `FitReportTable`)의 v2 임포트는 여전히 0건**이고,
 * 그 사실을 §2-㉱ 가 값으로 확인한다. **정의역을 조용히 넓히지 않는다 — 이 줄이 등재다.** */
import { mannequinRootRef } from "../lib/mannequinRef";
import { bakeBodyVerts, type BakePose } from "./bodyInjectBake.ts";
/* v3-71 §1 — 전용 «베이크 마운트»(하네스 층). v2 화면 수정 0줄 · 제품 화면 노출 0. */
import { BakeMount, bakeMountFrames, BAKE_MOUNT_PX, stepFrames } from "./BakeMount.tsx";
import { awaitMannequinSettled, mannequinPoseRef, poseStopped, POSE_SETTLE_EPS } from "../lib/mannequinRef";
import { useFitStore } from "../store/useFitStore";

const FABRICS = ["gray", "denim", "sweat", "swim"] as const;
/** v3-41 §2 — C-브라우저 정착 상태(v3-38 산출). **표시 전용 · 물리 0프레임**. */
const SETTLED = [
  { label: "gray d9 정본 (정착 220)", fab: "gray", d: 9, frame: 220, url: "/v3diag/settled-gray-d9.bin" },
  { label: "swim d10 (전 정본 · 정착 180)", fab: "swim", d: 10, frame: 180, url: "/v3diag/settled-swim-d10.bin" },
  { label: "sweat d9 (전 정본 · 정착 190)", fab: "sweat", d: 9, frame: 190, url: "/v3diag/settled-sweat-d9.bin" },
  /* v3-49 — 사용자 화면 합격 + 전략 세션 3/5 종결 선언으로 «정본» 승격. 전 정본 2종은 위에 무삭제. */
  { label: "swim d9 정본 (정착 260)", fab: "swim", d: 9, frame: 260, url: "/v3diag/settled-swim-d9-new.bin" },
  { label: "sweat d8 정본 (정착 330)", fab: "sweat", d: 8, frame: 330, url: "/v3diag/settled-sweat-d8-new.bin" },
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
      /* v3-52 §1-4 — 5행 핏 리포트. **표시 전용 · 물리 0프레임.** */
      if (m.kind === "uv") { setPrintUv(buildPrintUv(m.uv, m.panels)); return; }
      if (m.kind === "fit") {
        if (m.fit) { setFit(m.fit); setFitErr(""); (window as unknown as Record<string, unknown>).__v3fit = m.fit; }
        else { setFit(null); setFitErr(m.fitError ?? "산출 불가"); }
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
  const [fit, setFit] = useState<FitReportResult | null>(null);
  /* v3-54 ㉢ — 핏 맵 색 on/off. **표시 전용**(물리·상태 무관). */
  const [fitColor, setFitColor] = useState(true);
  /* v3-59 — **프린트 모드**. 핏 색과 «동시 적용하지 않는다»(둘 중 하나만 렌더에 넘긴다). */
  const [printOn, setPrintOn] = useState(false);
  const [printUv, setPrintUv] = useState<PrintUv | null>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  const [comp, setComp] = useState<CompositeResult | null>(null);
  const uMax = printUv?.panels.find((p) => p.name === "front")?.uMax ?? 1;
  useEffect(() => {
    /* 프린트 원본 = **v2 경로가 쓰는 기존 자산 파일**(데이터 읽기이지 코드 임포트가 아니다 · v3-13).
     * v3-60 — 원본을 «그대로» 붙이지 않고 **합성 층**을 거친다(대표색 + 가슴 프린트). */
    const im = new Image();
    im.onload = () => {
      const r = compositePrint(im, im.naturalWidth, im.naturalHeight, uMax);
      const t = new CanvasTexture(r.canvas);
      t.colorSpace = SRGBColorSpace;
      setComp(r); setTex(t);
      console.log(`[v3-60 합성] 대표색 rgb(${r.color.r.toFixed(0)}, ${r.color.g.toFixed(0)}, ${r.color.b.toFixed(0)})`
        + ` · 프린트 bbox ${r.printBox ? `${r.printBox.w.toFixed(0)}×${r.printBox.h.toFixed(0)}@(${r.printBox.x.toFixed(0)},${r.printBox.y.toFixed(0)})` : "없음"}`
        + ` · 프레임 문턱 ${r.maxFrameFired ? "**발동**(프린트 버림)" : "미발동"}`
        + ` · 재스캔 ${r.rescan ? `성분 ${r.rescan.components}개 중 경계접촉 ${r.rescan.excluded}개 제외` : "미실행(1패스 통과)"}`
        + ` · 하단 축소 ${r.shrunk ? r.shrunk.toFixed(4) : "없음"} · uMax ${uMax.toFixed(4)}`);
    };
    /* v3-60 — 자산 선택은 «값으로» 했다(§2-1 실측):
     `print-tee.png`      → 프레임 문턱 **발동**(bbox 100% · 재스캔 경계접촉 0 제외) ⟹ 프린트 버림
     `print-tee-white.webp` → bbox **40%×43%** · **미발동**(재스캔 경계접촉 1 제외) ⟹ **계약 전제 충족**
   ⟹ (v3-60 당시) 후자를 썼다. 전자는 «검정 옷의 하이라이트»가 대표색과 거리 55 를 넘어 프레임 전역에
   퍼지는 자산이고, 그것은 **v2 계약이 이미 등재한 한계**다(색으로는 못 가른다 · v2 :203-206).
   **v3-64 갱신(위 이력 무삭제)**: 사용자가 **그래픽 전용 자산**을 제공했다 —
     `print-graphic.png` 1200×1200 RGBA · α<250 **74.1%** · 불투명 bbox **61.8%×68.0%** ·
     테두리 불투명 **0.0%** ⟹ **v3-62 §0-3a 규칙 ㉠㉡㉢ 전부 통과**(적합 1건 · 면적비 최소).
   ⟹ **이 자산을 쓴다.** 앞의 둘은 **「옷 사진」**이라 규칙 ㉡ 에 걸렸다(대조용으로 저장소에 남는다). */
    im.src = `${import.meta.env.BASE_URL}v3print/print-graphic.png`;
  }, [uMax]);
  const [fitErr, setFitErr] = useState<string>("");
  const [settledIx, setSettledIx] = useState(0);
  const showSettled = useCallback(() => {
    const S = SETTLED[settledIx];
    workerRef.current?.terminate();
    setReady(null); setProg(null); setMsg(""); blobRef.current = null; sceneRef.current = null;
    setPhase("prep"); setFabric(S.fab); setDMm(S.d); setCapFrame(null); setFit(null); setFitErr("");
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.kind === "ready") { setReady(m); return; }
      if (m.kind === "error") { setPhase("error"); setMsg(m.message); return; }
      if (m.kind === "uv") { setPrintUv(buildPrintUv(m.uv, m.panels)); return; }
      if (m.kind === "fit") {
        if (m.fit) { setFit(m.fit); setFitErr(""); (window as unknown as Record<string, unknown>).__v3fit = m.fit; }
        else { setFit(null); setFitErr(m.fitError ?? "산출 불가"); }
        return;
      }
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

  /* v3-70 §2 — **주입 경로 스모크**. `frames: 0` 이라 **물리 0프레임**이고, 워커가 돌려주는
   * `derived` 를 그대로 찍는다. `useLive=false` 면 «기본 몸»(마네킹 없이 `parseGlb` 항등)을 주입해
   * ㉮(경로 등가)를, `true` 면 «현 슬라이더 몸»을 구워 ㉯(도출 스모크)를 낸다. */
  /* v3-71 §2-㉠ — **백화 «판별»**. 3값만 찍는다(원인 단정 0 · 위치만 좁힌다). */
  const bakeProbe = useCallback(() => {
    const cv = document.querySelector<HTMLCanvasElement>("[data-bakemount] canvas");
    console.log(`[v3-71 판별] 마네킹 ref **${mannequinRootRef.current ? "생존" : "사망(null)"}**`
      + ` · 캔버스 실측 ${cv ? `${cv.width}×${cv.height}(css ${cv.clientWidth}×${cv.clientHeight})` : "**없음**"}`
      + ` · 지정값 ${BAKE_MOUNT_PX.w}×${BAKE_MOUNT_PX.h}`
      + ` · useFrame 프레임 **${bakeMountFrames.current}**`
      + ` · 스케일 잔차 ${mannequinPoseRef.maxScaleResidual.toExponential(2)}`);
  }, []);

  /* v3-71 §3 — **정착 «후»에만 굽는다**(§0-5 · 조용한 조기 굽기 0).
   * 정착 판정은 `awaitMannequinSettled`(P23 §1 조항)를 **그대로 재사용**한다 — 새 문턱 0. */
  const bakeAndRun = useCallback(async (chestCm: number | null, sync = false,
                                      pose: BakePose = "tpose") => {
    if (chestCm !== null) useFitStore.getState().setBodyChest(chestCm);
    let tag: string;
    if (sync) {
      /* v3-72 §2 — **동기 정착**. rAF 를 기다리지 않고 `advance` 로 프레임을 «민다».
       * 판정은 기존 채널 그대로(`poseStopped` ∧ 잔차 ≤ `POSE_SETTLE_EPS`) — **새 문턱 0**.
       * 상한 600프레임(=10초 상당)에 걸리면 **굽되 그 사실을 남긴다**(말없는 실패 금지 · 함정 25). */
      /* ★ 조기 종료 «정정»(같은 판 안에서 값으로 잡았다):
       *   ① 스토어를 바꿔도 React 재렌더가 «비동기»라, 바로 `advance` 하면 `useFrame` 이
       *      **옛 `bodySize` 클로저**를 본다 ⟹ 새 target 이 반영되지 않는다. **한 번 양보한다.**
       *   ② `maxScaleResidual` 은 «직전 프레임» 값이라 변경 직후엔 **낡은 0**이다 ⟹
       *      **연속 2프레임** 충족을 요구한다(P26 의 「target 이 직전 프레임과 같을 것」과 같은 성질). */
      await new Promise((r) => setTimeout(r, 0));
      let k = 0, hit = 0;
      const CAP = 600;
      while (k < CAP) {
        stepFrames(1); k += 1;
        if (poseStopped() && mannequinPoseRef.maxScaleResidual <= POSE_SETTLE_EPS) {
          hit += 1; if (hit >= 2) break;
        } else hit = 0;
      }
      const ok = k < CAP;
      tag = `**동기** · 정착 **${ok ? "성립" : "**상한 초과**(굽되 사실 남김)"}** · 전진 ${k}프레임`
          + ` · 잔차 ${mannequinPoseRef.maxScaleResidual.toExponential(3)}`;
    } else {
      const st = await awaitMannequinSettled();
      tag = `**rAF** · 정착 **${st.ok ? "성립" : "**상한 초과**(굽되 사실 남김)"}** · 프레임 ${st.frames}`
          + ` · 잔차 ${st.residual.toExponential(3)}`;
    }
    console.log(`[v3-72 굽기] 가슴 ${chestCm ?? useFitStore.getState().bodySize.chest}cm · ${tag}`);
    const url = `${import.meta.env.BASE_URL}models/mannequin.glb`;
    const glb = await (await fetch(url)).arrayBuffer();
    let b;
    try { b = bakeBodyVerts(glb, mannequinRootRef.current, pose); }
    catch (e) { console.log(`[v3-72 굽기] **던짐** — ${(e as Error).message}`); return; }
    if (b.poseDelta.length) {
      const top = [...b.poseDelta].sort((x, y) => y.deg - x.deg).slice(0, 6);
      console.log(`[v3-74 자세] 모드 **${b.pose}** · 바인드 대비 회전 잰 본 **${b.poseDelta.length}개**`
        + ` · 최대 **${Math.max(...b.poseDelta.map((d) => d.deg)).toFixed(4)}°**`
        + ` · 상위 ${top.map((d) => `${d.name} ${d.deg.toFixed(3)}°`).join(" / ")}`);
    } else console.log(`[v3-74 자세] 모드 **${b.pose}** — 되돌린 본 0개(A포즈 경로)`);
    console.log(`[v3-72 굽기] **skinned:${b.skinned}**(실통과 확인) · 정점 ${b.n}`
      + ` · parseGlb 배열과 **비트 ${b.bitEqual ? "동일" : "상이"}**`
      + ` · **max|Δ| ${(b.maxDeltaM * 1000).toExponential(4)}mm**`);
    /* 산출 배열을 파일로 내린다 — Node 계기가 «둘레 배율»을 정밀하게 재기 위함. */
    const blob = new Blob([b.verts.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const bu = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = bu; a.download = `v3-72-body-${sync ? "sync" : "raf"}-chest${Math.round(chestCm ?? useFitStore.getState().bodySize.chest)}.bin`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(bu);
    workerRef.current?.terminate();
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "error") { console.log(`[v3-72 굽기] **조립 오류** — ${m.message}`); return; }
      if (m.kind !== "ready") return;
      const D = m.derived;
      console.log(`[v3-72 도출] 가슴 ${chestCm ?? "기본"}(${sync ? "동기" : "rAF"}) —`
        + ` BEXT [${D.bextM.map((v: number) => v.toFixed(6)).join(", ")}]m`
        + ` · h **${D.hMm.toFixed(6)}mm** · band **${D.bandMm.toFixed(6)}mm**`
        + ` · ③b 문턱 **${D.gate3bThMm.toFixed(6)}mm**`
        + ` · Y_TOP **${D.yTopCm.toFixed(4)}cm** · Y_NECK **${D.yNeckCm.toFixed(4)}cm**`
        + ` · AXIS_Z **${D.axisZCm.toFixed(4)}cm** · 목선둘레 ${m.dims.necklineGirthCm.toFixed(4)}cm`
        + ` · 조립 정점 ${m.n}`);
      w.terminate();
    };
    w.postMessage({ kind: "start", glbUrl: url, fabric, d: dMm / 1000, frames: 0, bodyVerts: b.verts });
  }, [fabric, dMm]);

  const injectSmoke = useCallback(async (useLive: boolean) => {
    const url = `${import.meta.env.BASE_URL}models/mannequin.glb`;
    const glb = await (await fetch(url)).arrayBuffer();
    const root = useLive ? mannequinRootRef.current : null;
    const b = bakeBodyVerts(glb, root);
    console.log(`[v3-70] 굽기 — 살아있는 마네킹 ${root ? "**있다**" : "**없다**"}`
      + ` · 스킨드 메시 ${b.skinned ? "찾음" : "**못 찾음**"} · 정점 ${b.n}`
      + ` · parseGlb 배열과 **비트 ${b.bitEqual ? "동일" : "상이"}**`
      + (b.bitEqual ? "" : ` · 최대 편차 ${(b.maxDeltaM * 1000).toExponential(3)}mm`));
    workerRef.current?.terminate();
    const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "error") { console.log(`[v3-70] 오류 — ${m.message}`); return; }
      if (m.kind !== "ready") return;
      const D = m.derived;
      console.log(`[v3-70] 도출(주입 ${D.injected ? "**예**" : "아니오"}) —`
        + ` BEXT [${D.bextM.map((v: number) => v.toFixed(4)).join(", ")}]m`
        + ` · h **${D.hMm.toFixed(4)}mm** · band **${D.bandMm.toFixed(4)}mm**`
        + ` · ③b 문턱 **${D.gate3bThMm.toFixed(4)}mm**`
        + ` · Y_TOP **${D.yTopCm.toFixed(3)}cm** · Y_NECK **${D.yNeckCm.toFixed(3)}cm**`
        + ` · AXIS_Z **${D.axisZCm.toFixed(4)}cm** · 목선둘레 ${m.dims.necklineGirthCm.toFixed(3)}cm`
        + ` · 정점 ${m.n}`);
      w.terminate();
    };
    w.postMessage({ kind: "start", glbUrl: url, fabric, d: dMm / 1000, frames: 0,
                    bodyVerts: b.verts });
  }, [fabric, dMm]);

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
    renderProduct(cv, { pos: S.bodyPos, idx: S.bodyIdx },
                  { pos: S.pos, idx: dIdx(S),
                    vcol: !printOn && fitColor && fit ? fit.color.rgb : undefined,
                    print: printOn && printUv ? { uv: printUv.uv, panels: printUv.panels, tex, printPanel: "front",
                      solid: comp ? ((Math.round(comp.color.r) << 16) | (Math.round(comp.color.g) << 8) | Math.round(comp.color.b)) : undefined,
                      bridgeIdx: bridge && S.bridgeIdx && S.bridgeIdx.length ? S.bridgeIdx : null } : null },
                  PRODUCT_VIEWS[vi], 300, 420, scale);
  }, [dIdx, fitColor, fit, printOn, printUv, tex, comp, bridge]);
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

      {/* v3-71 §1 — **베이크 마운트**(하네스). 크기를 픽셀로 못박은 전용 캔버스다. */}
      <div data-bakemount className="mb-1 inline-block border border-white/20">
        <BakeMount />
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <button className="rounded border px-2 py-1" onClick={bakeProbe}>㉠ 판별(3값)</button>
        <button className="rounded border px-2 py-1" onClick={() => bakeAndRun(null)}>㉮″ rAF 기본</button>
        <button className="rounded border px-2 py-1" onClick={() => bakeAndRun(null, true, "apose")}>A포즈 기본</button>
        <button className="rounded border px-2 py-1" onClick={() => bakeAndRun(null, true, "tpose")}>T포즈 기본</button>
        <button className="rounded border px-2 py-1" onClick={() => bakeAndRun(110, true, "tpose")}>T포즈 가슴110</button>
        <span className="opacity-60">결과는 콘솔 `[v3-71]`</span>
      </div>

      {/* v3-70 §2 — **몸 주입 스모크**(계기 · 물리 0프레임). 살아있는 마네킹이 있어야 하므로
        `?v2=1&v3=1` 에서만 의미가 있다(v2 씬이 마네킹을 마운트한다). */}
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={() => injectSmoke(false)} disabled={phase === "prep" || phase === "run"}>
          몸 주입 스모크(기본 몸)</button>
        <button className="rounded border px-2 py-1 disabled:opacity-40"
                onClick={() => injectSmoke(true)} disabled={phase === "prep" || phase === "run"}>
          몸 주입 스모크(현 슬라이더)</button>
        <span className="opacity-60">결과는 콘솔 `[v3-70]`</span>
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
        {/* v3-52 §1-4 — **핏 리포트 5행**. G5(경계 자기 공개) · G6(자기검사 표시)를 화면이 진다. */}
        {fitErr && <div className="mt-2 text-rose-600">핏 리포트 산출 불가 — {fitErr}</div>}
        {fit && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={fitColor} disabled={printOn}
                     onChange={(e) => setFitColor(e.target.checked)} />
              <span className={printOn ? "opacity-50" : ""}>핏 맵 색</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={printOn} onChange={(e) => setPrintOn(e.target.checked)} />
              <span>프린트</span>
            </label>
            {printUv && (
              <span className="opacity-70">
                UV 축척 <b>{(printUv.scaleM * 100).toFixed(2)}cm</b> = uv 1.0 · 앞판 uMax{" "}
                <b>{printUv.panels.find((p) => p.name === "front")?.uMax.toFixed(4)}</b>
                {comp && <> · 대표색 <b>rgb({comp.color.r.toFixed(0)},{comp.color.g.toFixed(0)},{comp.color.b.toFixed(0)})</b>
                  {comp.printBox ? <> · 프린트 <b>{comp.printBox.w.toFixed(0)}×{comp.printBox.h.toFixed(0)}px</b></> : <> · <b>무지</b></>}
                  {comp.shrunk && <b className="text-amber-600"> · 하단 축소 {comp.shrunk.toFixed(3)}</b>}</>}
                {!tex && <b className="text-rose-600"> · 텍스처 미로드</b>}
              </span>
            )}
            {/* G5 — 범례가 «분기점 값»을 스스로 밝힌다. **v3-67 §1: 마크업을 `FitReportTable.tsx` 로
              «옮겨» 제품 화면과 공유한다 — 렌더 결과 동일 · 계산 채널 0줄.** */}
            <FitLegend fit={fit} />
          </div>
        )}
        {fit && <FitReportTable fit={fit} />}
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
