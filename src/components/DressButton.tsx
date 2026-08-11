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
// P4 §2/§3 — 착용 게이트 **단계 구분**(BLOCK 차단 · WARN 실행)과 몸-옷 불일치 배지.
// 아래 본문 주석 참고.
//
// 결과는 `window` CustomEvent로 `PatternPreview`에 넘긴다. `?patternstate=1`의 옛
// dress-state fetch 경로는 **그대로 남는다**(회귀 대조용 — 제거 0).
import { useEffect, useMemo, useRef, useState } from "react";
import { useFitStore } from "../store/useFitStore";
import { checkGarmentFit } from "../lib/garmentFitLimits";
import { bakeBodySnapshot } from "../lib/bodySnapshot";
import { MannequinCollisionMesh } from "../lib/meshCollision";
import { mannequinPoseRef, mannequinBonesRef, mannequinRootRef, POSE_SETTLE_EPS, POSE_STOP_TIMEOUT_MS, poseStopped } from "../lib/mannequinRef";
import type { PatternDressMetrics } from "../lib/patternDressCore";
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
  const bodySize = useFitStore((s) => s.bodySize);
  // ── P4 §2 — **단계 구분**(BLOCK은 막고 WARN은 돌린다).
  // 상수가 이미 `WIDTH_RATIO_BLOCK`/`WIDTH_RATIO_WARN`으로 갈려 있고, 두 문언도
  // 이미 다르게 쓰여 있다: BLOCK은 「시뮬레이션을 실행하지 않습니다」라 «단정»하고
  // WARN은 「아주 타이트한 핏입니다」라 실행을 막는다고 말하지 않는다.
  // v1은 그 문언대로 동작했는데(`FitCanvas`의 `wearable`이 `Garment` 마운트를 막는다)
  // **v2 경로가 그 게이트를 안 읽어서** 「실행하지 않습니다」를 띄운 채 돌았다(P1 ⑤ · P3 캡처).
  // 문언을 고치는 대신 **동작을 문언에 맞춘다** — BLOCK이면 실행 자체를 막는다.
  const fit = checkGarmentFit(bodySize.chest, garmentSize.width);
  const blocked = fit.verdict === "impossible";
  const sleeveType = useFitStore((st) => st.sleeveType);
  const fabric = useFitStore((st) => st.fabric);
  // P5 — 굽기는 비싸다(§2 실측). 인스턴스를 유지해 `StaticGeometryGenerator`가
  // 내부 지오메트리를 재사용하게 한다(`meshCollision.ts` 주석).
  const collisionMesh = useMemo(() => new MannequinCollisionMesh(), []);
  const showFitMap = useFitStore((st) => st.showFitMap);
  const [busy, setBusy] = useState(false);
  // ── P17 §2 — **마네킹이 오기 전에는 돌리지 않는다.**
  // 그전에 누르면 조용히 커밋 fixture(P10 이전 판본)로 돌아 «몸 슬라이더가 반영 안 된» 결과가
  // 나오고, 그 사이 미리보기가 계속 다시 서면서 정착 좌표를 정적 배치로 덮는다
  // (배포에서 실측한 화면 실패의 뿌리 — P17 §1). 배포는 마네킹이 38MB라 이 창이 넓다.
  // `mannequinPoseRef`는 반응형이 아니므로 준비될 때까지만 짧게 폴링한다(준비되면 멈춘다).
  //
  // ── P23 §1 — **「굽어도 되는 시점」의 정의가 바뀐다.** 종전 조건(잔차 ≤ eps)은 실측에서
  // 0.75s에 통과하는데 스케일 lerp의 고정점은 3.3s다 — 그 사이에 구우면 몸 메시가 실행마다
  // 달라진다(P22 §2-4: 1.5s 프로토콜은 기준선 재현 1/3 · 15s는 3/3). 그래서 **멎었는가**
  // (`poseStopped`)를 함께 본다. 상한 `POSE_STOP_TIMEOUT_MS`에 걸리면 그 사실을 로그로
  // 남기고 준비 상태로 넘긴다 — 말없이 막아 두지 않는다(함정 25).
  const [bodyReady, setBodyReady] = useState(false);
  const [stopTimedOut, setStopTimedOut] = useState(false);
  useEffect(() => {
    if (bodyReady) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const b = mannequinBonesRef.current;
      const base = mannequinPoseRef.frames >= 1 && mannequinPoseRef.maxScaleResidual <= POSE_SETTLE_EPS
        && mannequinRootRef.current && b.left && b.right;
      if (!base) return;
      const waited = performance.now() - t0;
      if (poseStopped()) {
        console.log(
          `[dress·P23] 포즈 멈춤 — 대기 ${Math.round(waited)}ms · frames ${mannequinPoseRef.frames}` +
          ` · 스케일 잔차 ${mannequinPoseRef.maxScaleResidual.toExponential(2)}` +
          ` · 스케일 정지 ${mannequinPoseRef.scaleStillFrames}프레임` +
          ` · 팔 이동 ${mannequinPoseRef.maxArmDeltaM.toExponential(2)}m`,
        );
        mannequinPoseRef.stopWaitMs = waited;
        setBodyReady(true);
      } else if (waited > POSE_STOP_TIMEOUT_MS) {
        console.warn(
          `[dress·P23] 포즈 «미정지»로 상한 도달 — 대기 ${Math.round(waited)}ms > ${POSE_STOP_TIMEOUT_MS}ms` +
          ` · 스케일 정지 ${mannequinPoseRef.scaleStillFrames}프레임` +
          ` · 팔 이동 ${mannequinPoseRef.maxArmDeltaM.toExponential(2)}m — 그대로 굽는다(결과가 실행마다 다를 수 있다)`,
        );
        mannequinPoseRef.stopWaitMs = waited;
        setStopTimedOut(true);
        setBodyReady(true);
      }
    }, 100);
    return () => clearInterval(id);
  }, [bodyReady]);
  // P23 §1 — 포즈 정착 추이 계기(인쇄 전용). `window.__fitDebug.poseState()`.
  useEffect(() => {
    const win = window as unknown as { __fitDebug?: Record<string, unknown> };
    if (!win.__fitDebug) win.__fitDebug = {};
    win.__fitDebug.poseState = (): unknown => ({ ...mannequinPoseRef });
  }, []);
  const [note, setNote] = useState("");
  // ── P8 — 핏 리포트. **현재 슬라이더 상태의 결과만** 보여준다.
  // 치수를 바꾸면 지난 리포트는 그 옷의 것이 아니므로 즉시 감춘다(P2c 경쟁 처리와 같은 취지).
  const [report, setReport] = useState<{ sig: string; m: PatternDressMetrics } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const sig = JSON.stringify([garmentSize, bodySize, sleeveType]);
  // P17 §1 — **렌더용 서명은 원단까지 포함한다.** 렌더 지오메트리는 원단이 바뀌어도 다시 서고
  // (물성이 달라지면 정착 좌표도 달라진다), 그때 옛 결과를 다시 입히면 안 된다.
  // 리포트의 `sig`(P8)는 건드리지 않는다 — 그쪽 규칙은 그대로다.
  const renderSig = JSON.stringify([garmentSize, bodySize, sleeveType, fabric]);
  const fresh = report && report.sig === sig ? report.m : null;
  if (!on) return null;

  // ── P9 §2 — 상태 표시를 한 곳에서 만든다(대기 / 진행 / 완료 / 차단 / 실패).
  // 사유 «본문»은 좌측 패널이 진다 — 여기서는 짧은 상태만(중복 제거).
  const status = blocked
    ? { t: "이 치수로는 착용 불가 — 좌측 안내 참고", c: "text-amber-300" }
    : !bodyReady
      ? { t: "마네킹 불러오는 중 — 준비되면 «착장하기»가 켜집니다", c: "text-slate-300" }
    : busy
      ? { t: note || "착장 중…", c: "text-white" }
      : note
        ? { t: note, c: note.startsWith("착장 실패") || note.startsWith("오류") ? "text-rose-300" : "text-white" }
        : { t: "치수를 맞춘 뒤 «착장하기»를 누르세요 (약 15~40초)", c: "text-slate-300" };

  const run = (): void => {
    if (busy) { console.log("[dress] 이미 실행 중 — 이번 클릭은 무시한다(P3 §3①)"); return; }
    if (blocked) { console.warn(`[dress] 착용 불가 — 실행하지 않는다(P4 §2). ${fit.message ?? ""}`); return; }
    if (!bodyReady) { console.warn("[dress] 마네킹 미준비 — 실행하지 않는다(P17 §2). 준비되면 버튼이 켜진다."); return; }
    workerRef.current?.terminate();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setBusy(true);
    setNote("착장 중…");
    setReport(null);
    const t0 = performance.now();
    // ── P5 §1 — **살아있는 마네킹에서 몸을 뜬다.** 실패하면(루트·본 미준비)
    // 커밋된 fixture로 되돌아간다 — 그 경우 몸 슬라이더는 반영되지 않는다.
    const root = mannequinRootRef.current;
    const bones = mannequinBonesRef.current;
    // 클릭 시점이면 보통 이미 정착해 있다 — 잔차로 판정한다(프레임 수 고정 금지).
    const { frames, maxScaleResidual } = mannequinPoseRef;
    const settled = frames >= 1 && maxScaleResidual <= POSE_SETTLE_EPS;
    if (!settled) console.warn(`[dress] 마네킹 미정착(frames ${frames} · 잔차 ${maxScaleResidual.toExponential(2)} > ${POSE_SETTLE_EPS}) — 커밋 fixture로 돈다`);
    // P23 §2 — 굽기까지 실제로 기다린 시간과 「멎었는가」를 실행마다 남긴다.
    console.log(
      `[dress·P23] 굽기 — 대기 ${Math.round(mannequinPoseRef.stopWaitMs)}ms · 멎음 ${poseStopped() ? "예" : "아니오"}` +
      `${stopTimedOut ? " · **상한 도달 실행**" : ""} · 스케일 정지 ${mannequinPoseRef.scaleStillFrames}프레임` +
      ` · 팔 이동 ${mannequinPoseRef.maxArmDeltaM.toExponential(2)}m`,
    );
    const snap = settled && root && bones.left && bones.right
      ? bakeBodySnapshot({ root, bones, bodySize, garmentSize, sleeveType, fabric }, collisionMesh)
      : null;
    if (snap) {
      // P10 §1 — 팔 축 관절을 로그에 병기한다. 캡슐이 꺾이는 조건(소매길이 > 위팔)의
      // 판정 근거가 이 두 수치라, 매번 임시 로그를 넣지 않도록 상설로 둔다.
      const a = snap.fixture.pose.armLeft;
      const seg = (p?: { x: number; y: number; z: number }, q?: { x: number; y: number; z: number }): string =>
        p && q ? `${(100 * Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)).toFixed(1)}cm` : "—";
      console.log(
        `[dress] 몸 스냅샷 — 굽기 ${snap.bakeMs.toFixed(0)}ms · 캡슐 ${snap.capsuleMs.toFixed(1)}ms · 정점 ${snap.fixture.collision.position.length / 3}` +
        ` · 위팔 ${seg(a.trueShoulder, a.elbow)} / 전완 ${seg(a.elbow, a.hand)} · 소매길이 ${garmentSize.sleeveLength.toFixed(0)}cm`,
      );
    } else {
      console.warn("[dress] 마네킹 루트/어깨 본 미준비 — 커밋 fixture로 돈다(몸 슬라이더 미반영)");
    }
    // 옷 치수는 스냅샷 `layout`에 이미 들어 있다. 커밋 fixture로 되돌아가는 경우에만
    // override가 필요하므로 그때만 넘긴다(P3 §1의 4종 · 어깨너비는 포즈에서 나온다).
    const dims = snap ? undefined : {
      lengthM: garmentSize.length / 100,
      widthM: garmentSize.width / 100,
      sleeveLengthM: garmentSize.sleeveLength / 100,
      sleeveWidthM: garmentSize.sleeveWidth / 100,
    };
    // P19 §2 — 커프 밴드는 **fixture 폴백 여부와 무관하게** 항상 슬라이더에서 온다
    // (fixture `layout`에 그 항이 없다 — 새 옷 치수다).
    const cuffDims = { cuffBandM: garmentSize.cuffBand / 100 };
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
          `소맷부리 ${Number.isFinite(q.cuffCm) ? q.cuffCm.toFixed(2) : "—"}cm(제도 ${q.cuffDraftCm.toFixed(2)}cm · 여유 ${Number.isFinite(q.cuffEaseCm) ? q.cuffEaseCm.toFixed(2) : "—"}cm) · ` +
          `ringTotal=${ringTotal ? "on" : "off(=RINGTOTAL=0)"}`,
        );
        // 로그는 상위 bin만 낸다 — **전량은 훅으로** 낸다(임시 로그 금지 조항 · CLAUDE.md).
        // `window.__fitDebug.dressMetrics()` — 마지막 착장의 지표 객체 그대로.
        {
          const win = window as unknown as { __fitDebug?: Record<string, unknown> };
          if (!win.__fitDebug) win.__fitDebug = {};
          win.__fitDebug.dressMetrics = (): unknown => q;
        }
        // ── P14 §1·§2 상설 계기 — 관통 «자리». 총량 옆에 위치 분해를 한 줄 더 낸다.
        // ── P21 §2 — 비결정성 진단 한 줄. 「입력 / 초기 / 도달」 세 해시를 나란히 낸다.
        const G = q.diag;
        console.log(
          `[dress·P21 결정성] 몸메시 ${G.bodyDigest} · 몸인덱스 ${G.bodyIndexDigest} · 팔관절 ${G.armDigest} · 배치 ${G.placedDigest} · 정착 ${G.settledDigest}` +
          ` · 소맷부리 반폭 ${(G.cuffHalfWidthM * 100).toFixed(4)}cm(그 자리 팔 ${(G.cuffArmGirthM * 100).toFixed(4)}cm)` +
          ` · 정점 ${G.vertexCount} · 제약 ${G.constraintCount}쌍 · 시접 ${G.seamCount}쌍`,
        );
        // ── P22 §1 — 비트 해시 한 줄. P21 §0의 9단계를 **순서대로** 찍어
        // 「어디부터 갈리는가」를 눈으로 읽게 한다(반올림 0).
        const B = G.bits;
        console.log(
          `[dress·P22 비트] 입력[몸 ${B.bodyPos} 인덱스 ${B.bodyIdx} 팔 ${B.arms}(축 ${B.armsAxis} 방향 ${B.armsDir})]` +
          ` → 실측[팔단면 ${B.armProfile} 슬라이스 ${B.slices} 능선 ${B.ridge}]` +
          ` → 제도[치수 ${B.draftDims} 세그길이 ${B.segLens} 표본수 ${B.segCounts}]` +
          ` → 조립[2D ${B.pos2} 삼각 ${B.tris} 엣지 ${B.edges}]` +
          ` → 배치 ${B.placed} → 정착 ${B.settled}`,
        );
        const P = q.pen;
        const top = (r: Record<string, number>, n: number): string => {
          const e = Object.entries(r).sort((a, b) => b[1] - a[1]);
          const head = e.slice(0, n).map(([k, v]) => `${k}:${v}`).join(" ");
          return e.length > n ? `${head} …(bin ${e.length}개 중 상위 ${n} · 전량은 q.pen)` : head || "없음";
        };
        const X = P.sleeveCross;
        console.log(
          `[dress·P14 관통자리] 패널 앞 ${P.byPanel[0]} / 뒤 ${P.byPanel[1]} / 소매L ${P.byPanel[2]} / 소매R ${P.byPanel[3]}` +
          ` · 몸판 y대역(1cm) ${top(P.torsoByYCm, 8)}` +
          ` · 소매 호장대역(1cm) ${top(P.sleeveByArcCm, 8)}` +
          ` · **소매 교차표** 관통 ${X.pen} · 눌림 ${X.touch} · 둘다 ${X.both} · 관통만 ${X.penOnly} · 눌림만 ${X.touchOnly} · 부호거리 산출불가 ${X.dNull}`,
        );
      }
      // P17 §1·§2 — **서명과 핏 값을 함께 보낸다.**
      // ·`sig`: 렌더가 지오메트리를 다시 세울 때 이 결과가 아직 «그 옷»의 것인지 판정한다
      //   (레이스로 정착 좌표가 정적 배치에 덮이던 화면 실패의 처방 · P17 §1).
      // ·`fitPerVertex`: 핏 맵 색의 원자료. 문턱은 `marginMm`으로 함께 보낸다(새 문턱 0).
      window.dispatchEvent(new CustomEvent(DRESS_RESULT_EVENT, {
        detail: {
          positions: m.positions, panelStarts: m.panelStarts, panelCounts: m.panelCounts,
          sig: renderSig, fitPerVertex: m.fitPerVertex, marginMm: m.metrics ? m.metrics.fit.marginMm : NaN,
        },
      }));
      if (m.metrics) setReport({ sig, m: m.metrics });
      setNote(`${m.state} f=${m.frames} · ${s.toFixed(1)}s`);
      finish();
    };
    worker.postMessage({ ringTotal, garmentDims: { ...(dims ?? {}), ...cuffDims }, fixture: snap?.fixture } satisfies DressWorkerRequest);
  };

  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[42rem] flex-col gap-1 rounded bg-black/60 px-3 py-2 text-sm text-white">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || blocked || !bodyReady}
          onClick={run}
          className="rounded bg-white px-3 py-1 text-black disabled:opacity-50"
        >
          착장하기
        </button>
        <span className={status.c}>{status.t}</span>
      </div>
      {showFitMap && fresh && <FitReport m={fresh} />}
      {showFitMap && !fresh && <div className="text-slate-300">핏 리포트 — 이 치수로 «착장하기»를 누르면 표시됩니다.</div>}
    </div>
  );
}

/**
 * P8 — 부위별 핏 리포트(수치).
 *
 * **문턱은 새로 만들지 않았다.** 판정 경계는 물리가 흡착 목표로 쓰는 껍질 거리
 * (`COLLISION_MARGIN`, 워커가 `fit.marginMm`으로 실어 보낸다)이고, 하네스 53계기b의
 * 국면 3분할과 **같은 경계**다. v1 히트맵의 0/1/3cm는 코드가 스스로
 * 「실측 아님, 눈대중 초기값」이라 적어 둔 값이라 재사용하지 않았다(Garment.tsx:204).
 *
 * 값은 `signedClearance` = 옷 정점에서 몸 표면까지의 부호거리다(+가 뜬 것).
 */
function FitReport({ m }: { m: PatternDressMetrics }): React.JSX.Element {
  const mm = m.fit.marginMm;
  const label = (med: number): { t: string; c: string } =>
    !Number.isFinite(med) ? { t: "산출 불가", c: "text-slate-400" }
      : med <= 0 ? { t: "눌림", c: "text-rose-300" }
      : med <= mm ? { t: "밀착", c: "text-amber-300" }
      : { t: "여유", c: "text-sky-300" };
  return (
    <div className="mt-1 border-t border-white/20 pt-1">
      <div className="text-slate-300">
        핏 리포트 — 옷↔몸 간극(mm) · 경계 <b>{mm.toFixed(1)}mm</b>(흡착 margin)
      </div>
      {/* P11 §4 — 소매 행이 생겼다. **기준면이 다르다**는 사실과 부호 신뢰율을 함께 밝힌다. */}
      <div className="text-slate-400">
        몸통 4행 = 앞/뒤판 메시 · <b>소매 = 전신 메시</b>(팔 포함) · 소매 부호 일치율{" "}
        <b>{Number.isFinite(m.fit.sleeveSignAgreePct) ? `${m.fit.sleeveSignAgreePct.toFixed(1)}%` : "—"}</b>
        (레이 패리티 대조 · 낮으면 소매 판정 신뢰 불가)
      </div>
      <table className="mt-1 text-xs">
        <thead className="text-slate-400">
          <tr><th className="pr-3 text-left">부위</th><th className="pr-3 text-right">중앙</th><th className="pr-3 text-right">p25~p75</th><th className="pr-3 text-left">판정</th><th className="text-left">눌림/밀착/여유</th></tr>
        </thead>
        <tbody>
          {m.fit.bands.map((b) => {
            const l = label(b.medianMm);
            return (
              <tr key={b.name}>
                <td className="pr-3">{b.name}</td>
                <td className="pr-3 text-right">{Number.isFinite(b.medianMm) ? b.medianMm.toFixed(1) : "—"}</td>
                <td className="pr-3 text-right text-slate-400">
                  {Number.isFinite(b.p25Mm) ? `${b.p25Mm.toFixed(1)}~${b.p75Mm.toFixed(1)}` : "—"}
                </td>
                <td className={`pr-3 ${l.c}`}>{l.t}</td>
                <td className="text-slate-400">{b.touchN} / {b.snugN} / {b.looseN} <span className="opacity-60">(표본 {b.n}/{b.domain})</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
