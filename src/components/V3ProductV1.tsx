/* v3-79 §1·§2 — **제품 v1 화면**. 몸 입력 → 매칭 → 사이즈 넘겨보기.
 *
 * **물리 0프레임** — 워커에 `frames: 0` 과 `injectStateUrl` 만 넘긴다(v3-41~43 · v3-74 §5 경로 그대로).
 * **계산 채널 0줄** — 매칭은 `v3/match.ts`, 버튼 상태는 `v3/provide.ts`, 표·색은 워커의 `fitReport`.
 *   이 파일에는 **분류 로직도 물리도 없다**(§3 grep 대상).
 * **v2 임포트 0**(G1).
 * ★ 문구는 **자리 표시**다 — §0-6 대로 «사용자 최종 판정 대상»이고 값은 하나도 여기서 정하지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderProduct, PRODUCT_VIEWS } from "../v3/productView.ts";
import { withBridge } from "../v3/seamBridge.ts";
import { buildPrintUv, type PrintUv } from "../v3/printUv.ts";
import { compositePrint, type CompositeResult } from "../v3/printComposite.ts";
import { FABRICS } from "../v3/consts.ts";
import type { FitReportResult } from "../v3/fitReport.ts";
import { FitLegend, FitReportTable } from "./FitReportTable.tsx";
import { SIZES, garmentOf, bodyIdOf, type Size } from "../v3/grid.ts";
import { INPUT_AXES, AXIS_KEYS, clampAxis, matchBody, type AxisKey } from "../v3/match.ts";
import { buttonState, type Canon } from "../v3/provide.ts";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";

/** 굽기 조건 — **오케스트레이터와 같은 값**(`scripts/v3GridRun.ts`: gray · `D_MM` 기본 9).
 * 다른 값을 쓰면 주입한 정착 상태와 조립이 어긋난다. **여기서 새로 정하지 않는다.** */
const BAKE = { fab: "gray" as const, dMm: 9 };
const DIR = "v3diag/v3-77";

type Scene = { pos: Float32Array; idx: Uint32Array; bodyPos: Float32Array; bodyIdx: Uint32Array;
               bridgeIdx?: Uint32Array };

/** 국면 3종 — `FitReportTable` 과 **같은 분기점**(`fit.sepMm`)을 읽는다. 새 문턱 0. */
function phaseOf(medMm: number, sepMm: number) {
  if (!Number.isFinite(medMm)) return { name: "산출 불가", cls: "text-white/40", say: "이 부위는 표본이 부족해 값을 내지 못했습니다" };
  if (medMm < 0) return { name: "눌림", cls: "text-rose-400", say: `옷이 몸을 ${(-medMm).toFixed(1)}mm 파고듭니다` };
  if (medMm <= sepMm) return { name: "밀착", cls: "text-amber-400", say: `옷이 몸에 ${medMm.toFixed(1)}mm 로 붙습니다` };
  return { name: "여유", cls: "text-sky-400", say: `옷과 몸 사이가 ${medMm.toFixed(1)}mm 떠 있습니다` };
}

export function V3ProductV1() {
  const [canon, setCanon] = useState<Canon | null>(null);
  const [canonErr, setCanonErr] = useState("");
  const [input, setInput] = useState<Record<AxisKey, number>>(() =>
    Object.fromEntries(AXIS_KEYS.map((k) => [k, INPUT_AXES[k].base])) as Record<AxisKey, number>);
  const [clampMsg, setClampMsg] = useState("");
  const [size, setSize] = useState<Size>("M");
  const [openDetail, setOpenDetail] = useState<Size | null>(null);
  const [viewIx, setViewIx] = useState(0);
  const [fit, setFit] = useState<FitReportResult | null>(null);
  const [fitColor, setFitColor] = useState(true);
  const [printOn, setPrintOn] = useState(false);
  const [printUv, setPrintUv] = useState<PrintUv | null>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  const [comp, setComp] = useState<CompositeResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState<{ sha: string; n: number } | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  /* 정본 2종 수령 — **실패하면 화면을 세운다**(조용한 폴백 0 · #121). */
  useEffect(() => {
    const B = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${B}${DIR}/v1-provide-37.json`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`제공 목록 응답 ${r.status}`))),
      fetch(`${B}${DIR}/index-merged-108.json`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`분류 정본 응답 ${r.status}`))),
    ]).then(([provide, index]) => setCanon({ provide, index }))
      .catch((e) => setCanonErr(`정본을 못 읽었다 — ${e.message}. **화면을 세운다**(폴백 0).`));
  }, []);

  const match = useMemo(() => matchBody(input), [input]);
  const bodyId = bodyIdOf(match.body);
  const cellId = `${bodyId}_${size}`;
  const st = canon ? buttonState(canon, cellId) : null;
  const rec = canon?.index[cellId];

  const setAxis = useCallback((k: AxisKey, raw: number) => {
    const c = clampAxis(k, raw);
    setClampMsg(c.clamped ? `${INPUT_AXES[k].label}은(는) ${INPUT_AXES[k].min}~${INPUT_AXES[k].max}${INPUT_AXES[k].unit} 범위입니다 — ${c.value}${INPUT_AXES[k].unit} 로 맞췄습니다` : "");
    setInput((p) => ({ ...p, [k]: c.value }));
  }, []);

  const uMax = printUv?.panels.find((p) => p.name === "front")?.uMax ?? 1;
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const r = compositePrint(im, im.naturalWidth, im.naturalHeight, uMax);
      const t = new CanvasTexture(r.canvas); t.colorSpace = SRGBColorSpace;
      setComp(r); setTex(t);
    };
    im.src = `${import.meta.env.BASE_URL}v3print/print-graphic.png`;
  }, [uMax]);

  /* 착장 재생 — **활성 칸에서만**. `frames: 0` · 주입만 · 몸 정점과 옷 치수를 함께 싣는다(v3-74 §5). */
  useEffect(() => {
    workerRef.current?.terminate(); workerRef.current = null;
    sceneRef.current = null; setFit(null); setPrintUv(null); setChecked(null); setErr("");
    if (!canon) return;
    if (!st?.active) { setMsg(""); return; }
    setMsg("불러오는 중…");
    let dead = false;
    const B = import.meta.env.BASE_URL;
    (async () => {
      const vb = await fetch(`${B}${DIR}/body-${bodyId}.bin`).then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`몸 정점 응답 ${r.status}`)));
      if (dead) return;
      const w = new Worker(new URL("../workers/v3DressWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = w;
      w.onmessage = async (e) => {
        const m = e.data;
        if (m.kind === "error") { setErr(m.message); setMsg(""); return; }
        if (m.kind === "uv") { setPrintUv(buildPrintUv(m.uv, m.panels)); return; }
        if (m.kind === "fit") { if (m.fit) setFit(m.fit); return; }
        if (m.kind !== "done") return;
        const dv = new DataView(m.blob.slice().buffer);
        const h = await crypto.subtle.digest("SHA-256", m.blob.slice(4 + dv.getUint32(0, true)).buffer);
        const hex = [...new Uint8Array(h)].map((b: number) => b.toString(16).padStart(2, "0")).join("");
        const n = m.pos.length / 3;
        setChecked({ sha: hex, n });
        /* 분류 정본의 `sha` 와 **대조**한다. 어긋나면 표시하지 않는다(폴백 0 · v3-66 §2-㉠ 규칙 그대로). */
        if (rec?.sha && hex !== rec.sha) {
          setErr(`정본 대조 실패 — sha ${hex.slice(0, 8)}…(등재 ${rec.sha.slice(0, 8)}…). **표시하지 않는다**(폴백 0).`);
          setMsg(""); return;
        }
        sceneRef.current = { pos: m.pos, idx: m.idx, bodyPos: m.bodyPos, bodyIdx: m.bodyIdx, bridgeIdx: m.bridgeIdx };
        setMsg(`${cellId} · 정착 프레임 ${rec?.f ?? "?"} · 물리 0프레임`);
      };
      w.postMessage({ kind: "start", glbUrl: `${B}models/mannequin.glb`, fabric: BAKE.fab,
        d: BAKE.dMm / 1000, frames: 0, injectStateUrl: `${B}${DIR}/settled-${cellId}.bin`,
        bodyVerts: new Float32Array(vb), garment: garmentOf(size) });
    })().catch((e) => { if (!dead) { setErr(e.message); setMsg(""); } });
    return () => { dead = true; workerRef.current?.terminate(); };
  }, [canon, cellId, bodyId, size, st?.active, rec?.sha, rec?.f]);

  const draw = useCallback(() => {
    const S = sceneRef.current, cv = cvRef.current;
    if (!S || !cv) return;
    const idx = S.bridgeIdx && S.bridgeIdx.length ? withBridge(S.idx, S.bridgeIdx) : S.idx;
    renderProduct(cv, { pos: S.bodyPos, idx: S.bodyIdx },
      { pos: S.pos, idx,
        vcol: !printOn && fitColor && fit ? fit.color.rgb : undefined,
        print: printOn && printUv ? { uv: printUv.uv, panels: printUv.panels, tex, printPanel: "front",
          solid: comp ? ((Math.round(comp.color.r) << 16) | (Math.round(comp.color.g) << 8) | Math.round(comp.color.b)) : undefined,
          bridgeIdx: S.bridgeIdx && S.bridgeIdx.length ? S.bridgeIdx : null } : null },
      PRODUCT_VIEWS[viewIx], 480, 672);
  }, [viewIx, fitColor, fit, printOn, printUv, tex, comp]);
  useEffect(() => { draw(); }, [draw, msg]);

  const F = FABRICS[BAKE.fab];
  return (
    <div className="flex h-full w-full bg-[#0b1020]">
      <div className="w-[440px] shrink-0 overflow-auto border-r border-white/10 bg-[#141a2e] p-4 text-[12px] text-white/90">
        {/* 문구 = 자리 표시(§0-6) */}
        <div className="text-[15px] font-semibold">내 몸에 입어보기</div>
        <div className="mb-3 text-white/50">치수를 넣으면 그 몸이 이 옷을 입은 모습을 보여줍니다</div>

        {canonErr && <div className="mb-3 whitespace-pre-wrap rounded bg-rose-950/60 p-2 text-rose-300">{canonErr}</div>}

        {/* ① 5축 입력 — 슬라이더 + 숫자 «병행»(§0-4 ②) */}
        {AXIS_KEYS.map((k) => {
          const a = INPUT_AXES[k];
          return (
            <div key={k} className="mb-2">
              <div className="mb-0.5 flex items-center justify-between">
                <span>{a.label} <span className="text-white/40">{a.matched ? "" : "· 표시 몸에는 반영되지 않습니다"}</span></span>
                <span className="flex items-center gap-1">
                  <input type="number" value={input[k]} step={0.5} min={a.min} max={a.max}
                    onChange={(e) => setAxis(k, Number(e.target.value))}
                    className="w-16 rounded bg-white/10 px-1 py-0.5 text-right" />
                  <span className="text-white/50">{a.unit}</span>
                </span>
              </div>
              <input type="range" value={input[k]} min={a.min} max={a.max} step={0.5}
                onChange={(e) => setAxis(k, Number(e.target.value))} className="w-full" />
            </div>
          );
        })}
        {clampMsg && <div className="mb-2 rounded bg-amber-950/50 px-2 py-1 text-amber-300">{clampMsg}</div>}

        {/* ② 매칭 배너(§0-4 ③ · §0-6) — 일치 축은 생략한다 */}
        <div className="mb-3 rounded bg-sky-950/50 px-2 py-1.5 text-sky-200">
          {match.changed.length === 0
            ? "입력하신 치수와 «같은» 몸으로 표시 중입니다"
            : match.changed.map((a) => `${INPUT_AXES[a.key].label} ${a.input} → ${a.matched}`).join(" · ") + " 몸으로 표시 중"}
          <div className="mt-0.5 text-[11px] text-sky-200/60">
            팔·다리 길이는 표시 몸을 고르는 데 쓰지 않습니다(가슴·키·어깨 3축으로만 고릅니다)
          </div>
        </div>

        {/* ③ 사이즈 넘겨보기 — 상태는 «정본 2종»에서 온다(재계산 0) */}
        <div className="mb-1 text-white/60">사이즈</div>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {SIZES.map((s) => {
            const b = canon ? buttonState(canon, `${bodyId}_${s}`) : null;
            const on = s === size;
            return (
              <button key={s} disabled={!b?.active}
                onClick={() => { setSize(s); setOpenDetail(null); }}
                title={b?.note ?? ""}
                className={`rounded py-1 ${!b?.active ? "cursor-not-allowed bg-white/5 text-white/30"
                  : on ? "bg-white text-black" : "bg-white/10"}`}>
                {s}
              </button>
            );
          })}
        </div>
        {canon && (
          <div className="mb-3 space-y-1">
            {SIZES.map((s) => {
              const b = buttonState(canon, `${bodyId}_${s}`);
              if (b.active) return null;
              return (
                <div key={s} className="rounded bg-white/5 px-2 py-1 text-[11px] text-white/50">
                  <b className="text-white/70">{s}</b> — {b.note}
                  {b.detail && (
                    <>
                      {" "}
                      <button className="underline" onClick={() => setOpenDetail(openDetail === s ? null : s)}>
                        {openDetail === s ? "닫기" : "사유 보기"}
                      </button>
                      {openDetail === s && <div className="mt-1 whitespace-pre-wrap text-white/60">{b.detail}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ④ 부위 카드 5 — 5행 표의 «겉면»(§0-6). 값은 `fit.rows` 를 읽기만 한다 */}
        {fit && (
          <div className="mb-3 grid grid-cols-1 gap-1">
            {fit.rows.map((r) => {
              const p = phaseOf(r.medMm, fit.sepMm);
              return (
                <div key={r.name} className="rounded bg-white/5 px-2 py-1.5">
                  <div className="flex items-baseline justify-between">
                    <b>{r.name}</b>
                    <span className={p.cls}>{p.name} <span className="text-white/40">
                      {Number.isFinite(r.medMm) ? `${r.medMm.toFixed(1)}mm` : "—"}</span></span>
                  </div>
                  <div className="text-[11px] text-white/50">{p.say}</div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-1 text-white/60">보기</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {PRODUCT_VIEWS.map((v, i) => (
            <button key={v.name} onClick={() => setViewIx(i)}
              className={`rounded px-2 py-1 ${i === viewIx ? "bg-white text-black" : "bg-white/10"}`}>{v.name}</button>
          ))}
        </div>
        <label className="mr-3 inline-flex items-center gap-1">
          <input type="checkbox" checked={fitColor} disabled={printOn} onChange={(e) => setFitColor(e.target.checked)} />
          <span className={printOn ? "opacity-50" : ""}>핏 맵 색</span>
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={printOn} onChange={(e) => setPrintOn(e.target.checked)} />
          <span>프린트</span>
        </label>

        <div className="mt-2 whitespace-pre-wrap text-white/50">{msg}</div>
        {err && <div className="mt-2 whitespace-pre-wrap text-rose-400">{err}</div>}

        {/* ⑤ 검증 정보 — **기본 접힘**(§0-6). 표 원문·범례·sha 는 전부 여기 안 */}
        {fit && checked && (
          <details className="mt-3 rounded bg-white/5 p-2 text-[11px]">
            <summary className="cursor-pointer text-emerald-300">검증됨 ✓</summary>
            <div className="mt-2 text-white/50">
              칸 <b>{cellId}</b> · 원단 {BAKE.fab}(k {F.k} · ρ {F.rho}) · d {BAKE.dMm}mm · 물리 0프레임
              <div>상태 sha {checked.sha.slice(0, 16)}… · 정점 {checked.n} · 등재 sha {rec?.sha?.slice(0, 16) ?? "—"}…</div>
              <div>게이트 {rec?.gate ?? "—"} · 정착 프레임 {rec?.f ?? "—"} · 소요 {rec?.sec ? `${(rec.sec / 60).toFixed(1)}분` : "—"}</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><FitLegend fit={fit} /></div>
            <FitReportTable fit={fit} />
          </details>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <canvas ref={cvRef} className="max-h-full max-w-full" />
      </div>
    </div>
  );
}
