/* v3-79 §1·§2 + v3-80 §1 — **제품 v1 화면**. 몸 입력 → 매칭 → 사이즈 넘겨보기.
 *
 * **물리 0프레임** — 워커에 `frames: 0` 과 `injectStateUrl` 만 넘긴다(v3-41~43 · v3-74 §5 경로 그대로).
 * **계산 채널 0줄** — 매칭은 `v3/match.ts`, 버튼 상태·착지는 `v3/provide.ts`, 표·색은 워커의 `fitReport`,
 *   프레이밍은 `v3/framing.ts`. 이 파일에는 **분류 로직도 물리도 프레이밍 식도 없다**(§3 grep 대상).
 * **v2 임포트 0**(G1).
 * **문구는 v3-80 §2 정본**이다 — 이 판에서 창작한 문장은 없다.
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
import { buttonState, landingSize, DEFAULT_SIZE, type Canon } from "../v3/provide.ts";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";

/** 굽기 조건 — **오케스트레이터와 같은 값**(`scripts/v3GridRun.ts`: gray · `D_MM` 기본 9). */
const BAKE = { fab: "gray" as const, dMm: 9 };
const DIR = "v3diag/v3-77";

/** v3-80 §1-① — 캔버스 크기. **가로는 «자산 실측»에서 나온다**: 프레이밍이 몸 높이 하나로 고정된 뒤
 * 27몸 중 최대 팔 스팬(`c122.5-h185-s50` · 2.4911m)의 투영 폭이 **834.5px** 이다(`v3FramingCheck`).
 * 840 은 그 값을 덮는 가장 가까운 크기다 — **눈대중이 아니라 측정에서 도출**했다. */
const CANVAS = { w: 840, h: 672 };

/** 뷰 «표시» 라벨(v3-80 §2-1). **프리셋 id(`front-p` 등)는 그대로다** — 바뀐 것은 문자열뿐이다. */
const VIEW_LABEL: Record<string, string> = { "front-p": "앞", "side-p": "옆", "back-p": "뒤" };

type Scene = { pos: Float32Array; idx: Uint32Array; bodyPos: Float32Array; bodyIdx: Uint32Array;
               bridgeIdx?: Uint32Array };

/** 국면 3종 — `FitReportTable` 과 **같은 분기점**(`fit.sepMm`)을 읽는다. 새 문턱 0. 문구는 §2-2 정본. */
function phaseOf(medMm: number, sepMm: number) {
  if (!Number.isFinite(medMm)) return { name: "산출 불가", cls: "text-white/40", say: "이 부위는 표본이 부족해 값을 내지 못했습니다" };
  if (medMm < 0) return { name: "눌림", cls: "text-rose-400", say: `옷이 몸을 ${(-medMm).toFixed(1)}mm 누릅니다` };
  if (medMm <= sepMm) return { name: "밀착", cls: "text-amber-400", say: `옷이 몸에 ${medMm.toFixed(1)}mm 로 붙습니다` };
  return { name: "여유", cls: "text-sky-400", say: `옷과 몸 사이가 ${medMm.toFixed(1)}mm 떠 있습니다` };
}

export function V3ProductV1() {
  const [canon, setCanon] = useState<Canon | null>(null);
  const [canonErr, setCanonErr] = useState("");
  const [input, setInput] = useState<Record<AxisKey, number>>(() =>
    Object.fromEntries(AXIS_KEYS.map((k) => [k, INPUT_AXES[k].base])) as Record<AxisKey, number>);
  const [clampMsg, setClampMsg] = useState("");
  const [size, setSize] = useState<Size | null>(DEFAULT_SIZE);
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
  /** v3-80 §1-⑥ — **씬이 있는가**. `sceneRef` 는 ref 라 화면을 다시 그리지 않는다 ⟹ 상태로 따로 든다.
   * ★ 이것이 없으면 **캔버스가 «직전 몸»의 그림을 그대로 들고 있는다** — 제공 0칸 몸에서
   *   「제공되는 사이즈가 없습니다」라고 적어 놓고 옆에는 남의 착장이 보였다(§1-⑥ 「착장 없음」 위반). */
  const [scened, setScened] = useState(false);
  const sceneRef = useRef<Scene | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  /* 정본 2종 수령 — **실패하면 화면을 세운다**(조용한 폴백 0 · #121). */
  useEffect(() => {
    const B = import.meta.env.BASE_URL;
    Promise.all([
      /* v3-81 §1-② — **제공 목록 정본은 35 다**(37 은 무삭제·대조 전용).
       * 35 파일은 제외 사유를 «메타 한 줄»로 담으므로 배열이 아니라 객체다 — 둘 다 받는다. */
      fetch(`${B}${DIR}/v1-provide-35.v3-91.json`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`제공 목록 응답 ${r.status}`)))
        .then((j) => (Array.isArray(j) ? j : j.provide)),
      fetch(`${B}${DIR}/index-merged-108.v3-91.json`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`분류 정본 응답 ${r.status}`))),
    ]).then(([provide, index]) => setCanon({ provide, index }))
      .catch((e) => setCanonErr(`정본을 못 읽었다 — ${e.message}. **화면을 세운다**(폴백 0).`));
  }, []);

  const match = useMemo(() => matchBody(input), [input]);
  const bodyId = bodyIdOf(match.body);
  /* v3-80 §1-⑥ — **착지**. 규칙은 `provide.landingSize` 가 정본이고 화면은 결과만 쓴다. */
  const landing = canon ? landingSize(canon, bodyId) : null;
  const cellId = size ? `${bodyId}_${size}` : null;
  const st = canon && cellId ? buttonState(canon, cellId) : null;
  const rec = cellId ? canon?.index[cellId] : undefined;

  /* 몸이 바뀌면 **착지 사이즈로 옮긴다**(회색에 착지해 화면이 비는 일이 없게 · v3-79 ㉢ 처분 ⓐ). */
  useEffect(() => { if (landing) { setSize(landing.size); setOpenDetail(null); } },
    [bodyId, landing?.size]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    sceneRef.current = null; setScened(false); setFit(null); setPrintUv(null); setChecked(null); setErr("");
    if (!canon || !cellId || !size) { setMsg(""); return; }
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
        if (rec?.sha && hex !== rec.sha) {
          setErr(`정본 대조 실패 — sha ${hex.slice(0, 8)}…(등재 ${rec.sha.slice(0, 8)}…). **표시하지 않는다**(폴백 0).`);
          setMsg(""); return;
        }
        sceneRef.current = { pos: m.pos, idx: m.idx, bodyPos: m.bodyPos, bodyIdx: m.bodyIdx, bridgeIdx: m.bridgeIdx };
        setScened(true); setMsg("");
      };
      w.postMessage({ kind: "start", glbUrl: `${B}models/mannequin.glb`, fabric: BAKE.fab,
        d: BAKE.dMm / 1000, frames: 0, injectStateUrl: `${B}${DIR}/settled-${cellId}.bin`,
        bodyVerts: new Float32Array(vb), garment: garmentOf(size) });
    })().catch((e) => { if (!dead) { setErr(e.message); setMsg(""); } });
    return () => { dead = true; workerRef.current?.terminate(); };
  }, [canon, cellId, bodyId, size, st?.active, rec?.sha]);

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
      PRODUCT_VIEWS[viewIx], CANVAS.w, CANVAS.h);
  }, [viewIx, fitColor, fit, printOn, printUv, tex, comp]);
  useEffect(() => { draw(); }, [draw, msg, fit]);

  const F = FABRICS[BAKE.fab];
  return (
    <div className="flex h-full w-full bg-[#0b1020]">
      <div className="w-[440px] shrink-0 overflow-auto border-r border-white/10 bg-[#141a2e] p-4 text-[12px] text-white/90">
        <div className="text-[15px] font-semibold">내 몸에 입어보기</div>
        <div className="mb-3 text-white/50">치수를 넣으면 그 몸이 이 옷을 입은 모습을 보여줍니다</div>

        {canonErr && <div className="mb-3 whitespace-pre-wrap rounded bg-rose-950/60 p-2 text-rose-300">{canonErr}</div>}

        {/* ① 5축 입력 — 슬라이더 + 숫자 «병행» */}
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

        {/* ② 매칭 배너 — 일치 축은 생략 · 자동 전환은 «아래» 별도 줄(v3-80 §2-5) */}
        <div className="mb-1 rounded bg-sky-950/50 px-2 py-1.5 text-sky-200">
          {match.changed.length === 0
            ? "입력하신 치수와 같은 몸으로 표시 중입니다"
            : match.changed.map((a) => `${INPUT_AXES[a.key].label} ${a.input} → ${a.matched}`).join(" · ") + " 몸으로 표시 중"}
          <div className="mt-0.5 text-[11px] text-sky-200/60">
            팔·다리 길이는 표시 몸을 고르는 데 쓰지 않습니다(가슴·키·어깨 3축으로만 고릅니다)
          </div>
        </div>
        {landing?.fallback && landing.size && size === landing.size && (
          <div className="mb-3 rounded bg-indigo-950/50 px-2 py-1 text-indigo-200">
            {DEFAULT_SIZE} 은 제공되지 않아 {landing.size} 로 표시 중
          </div>
        )}
        {landing && landing.size === null && (
          <div className="mb-3 rounded bg-white/5 px-2 py-1 text-white/60">이 몸에는 제공되는 사이즈가 없습니다</div>
        )}
        {!landing?.fallback && landing?.size && <div className="mb-3" />}

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
                      {openDetail === s && (
                        <div className="mt-1 text-white/60">
                          {b.detail}
                          {/* 원문 수치는 «접힘» 안으로(v3-80 §1-③) — 문언 창작 0 */}
                          {b.raw && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-white/40">측정 원문</summary>
                              <div className="mt-0.5 whitespace-pre-wrap text-white/40">{b.raw}</div>
                            </details>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ④ 범례 «겉면» 한 줄 — 핏 맵 색이 켜져 있을 때만. 값은 v3-54 규칙대로 «자기 공개»(색 계산 0줄) */}
        {fit && fitColor && !printOn && (
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-rose-400">눌림</span>
            <span className="text-amber-400">밀착 0~{fit.sepMm.toFixed(1)}mm</span>
            <span className="text-sky-400">여유</span>
          </div>
        )}

        {/* ⑤ 부위 카드 5 — 5행 표의 «겉면». 값은 `fit.rows` 를 읽기만 한다 */}
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
              className={`rounded px-3 py-1 ${i === viewIx ? "bg-white text-black" : "bg-white/10"}`}>
              {VIEW_LABEL[v.name] ?? v.name}
            </button>
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

        {msg && <div className="mt-2 whitespace-pre-wrap text-white/50">{msg}</div>}
        {err && <div className="mt-2 whitespace-pre-wrap text-rose-400">{err}</div>}

        {/* ⑥ 검증 정보 — **기본 접힘**. 겉면은 「검증됨 ✓」 한 줄뿐이고 칸 id·프레임은 «안»에 있다(§2-1) */}
        {fit && checked && cellId && (
          <details className="mt-3 rounded bg-white/5 p-2 text-[11px]">
            <summary className="cursor-pointer text-emerald-300">검증됨 ✓</summary>
            <div className="mt-2 text-white/50">
              칸 <b>{cellId}</b> · 정착 프레임 {rec?.f ?? "—"} · <b>물리 0프레임</b>
              <div>원단 {BAKE.fab}(k {F.k} · ρ {F.rho}) · d {BAKE.dMm}mm</div>
              <div>상태 sha {checked.sha.slice(0, 16)}… · 정점 {checked.n} · 등재 sha {rec?.sha?.slice(0, 16) ?? "—"}…</div>
              <div>게이트 {rec?.gate ?? "—"} · 소요 {rec?.sec ? `${(rec.sec / 60).toFixed(1)}분` : "—"}</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><FitLegend fit={fit} /></div>
            <FitReportTable fit={fit} />
          </details>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center">
        {/* 씬이 없으면 «감춘다» — 낡은 그림을 남기지 않는다(§1-⑥). 요소는 DOM 에 남아 ref 가 유지된다. */}
        <canvas ref={cvRef} hidden={!scened} className="max-h-full max-w-full" />
      </div>
    </div>
  );
}
