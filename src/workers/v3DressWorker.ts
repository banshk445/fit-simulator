/* v3-35 §1 — v3 착장을 «워커»에서 돌린다. 메인 스레드를 막지 않는다.
 *
 * v2 워커(`patternDressWorker.ts`)의 구조를 «참고»만 했고 코드 임포트는 0이다.
 * 물리·조립은 전부 `src/v3/*` 순수 모듈이다 — 이 파일에는 물리가 한 줄도 없다.
 *
 * 프로토콜
 *   ← { kind:'start', glbUrl, fabric, d, frames, garment?, bodyScale? }
 *   ← { kind:'cancel' }
 *   → { kind:'ready',    n, tris, sub, rampN, dims, placeSig }
 *   → { kind:'progress', frame, frames, netMm, elapsedMs }
 *   → { kind:'done',     frame, diverged, stopped, elapsedMs, pos, blob }
 *   → { kind:'error',    message }        ← 관측 사실만. 원인 단정 0(P30 §2 형식)
 */
import { prepare, runFrames, stateBlob, DEFAULT_GARMENT, type Prepared } from '../v3/dressRun.ts';
import { minPairDistLite } from '../v3/instruments.ts';
import { FABRICS } from '../v3/consts.ts';
import { runS4Gate, N_WIN } from '../v3/s4Gate.ts';

/** 워커 전역 — 타입 정의가 Window로 잡혀 있어 최소 형태로 좁힌다(동작 변경 0) */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: ArrayBufferLike[]) => void;
};

let cancelled = false;

type StartMsg = {
  kind: 'start'; glbUrl: string; fabric: string; d: number; frames: number;
  garment?: typeof DEFAULT_GARMENT; bodyScale?: [number, number, number];
  injectStateUrl?: string;   // v3-36 §2 진단 — 주입할 상태 blob 의 URL
};

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data as StartMsg | { kind: 'cancel' };
  if (m.kind === 'cancel') { cancelled = true; return; }
  if (m.kind !== 'start') return;
  cancelled = false;
  try {
    const fabric = FABRICS[m.fabric];
    if (!fabric) throw new Error(`모르는 원단: ${m.fabric}`);
    const res = await fetch(m.glbUrl);
    if (!res.ok) throw new Error(`GLB 응답 ${res.status} — ${m.glbUrl}`);
    const glb = await res.arrayBuffer();
    const t0 = performance.now();
    let injectState: ArrayBuffer | undefined;
    if (m.injectStateUrl) {
      const ir = await fetch(m.injectStateUrl);
      if (!ir.ok) throw new Error(`주입 상태 응답 ${ir.status} — ${m.injectStateUrl}`);
      injectState = await ir.arrayBuffer();
    }
    const P: Prepared = prepare({
      glb, fabric, d: m.d, garment: m.garment ?? DEFAULT_GARMENT,
      bodyScale: m.bodyScale, minPairDistLite, injectState,
    });
    ctx.postMessage({
      kind: 'ready', n: P.sc.n, tris: P.sc.tris.length / 3, sub: P.SUB, rampN: P.RAMP_N,
      placeSig: P.S.PLACE_SIG,
      dims: {
        neckHalfWidthCm: P.S.NECK_A * 100, necklineGirthCm: P.S.NECK_G * 100,
        capHeightCm: P.S.CAP_H * 100, armholeDepthCm: P.S.ARM_D * 100,
      },
      prepMs: performance.now() - t0,
    });
    /* 정착 창의 «시작 상태» — 마지막 N_WIN 프레임 전 상태를 붙잡아 둔다(v3-22 채널). */
    let before: Float64Array | undefined;
    const r = runFrames(
      P, m.frames,
      (p) => {
        if (p.frame === m.frames - N_WIN) before = Float64Array.from(P.sc.s.pos);
        ctx.postMessage({ kind: 'progress', ...p, elapsedMs: performance.now() - t0 });
      },
      () => cancelled,
    );
    if (m.frames >= N_WIN && !before) before = undefined;
    /* v3-37 §3 — **브라우저용 S4 게이트**. 문턱은 Node 게이트와 같은 값이다(새 문턱 0). */
    const s4 = runS4Gate(P, before);
    ctx.postMessage({ kind: 's4', s4 });
    const blob = stateBlob(P, r.frame, P.S.PLACE_SIG);
    const pos = Float32Array.from(P.sc.s.pos);
    const idx = Uint32Array.from(P.sc.tris);
    ctx.postMessage(
      { kind: 'done', ...r, elapsedMs: performance.now() - t0, pos, idx, blob },
      [pos.buffer, idx.buffer, blob.buffer],
    );
  } catch (err) {
    // 관측 가능한 사실만 말한다 — 원인 단정 0
    ctx.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
