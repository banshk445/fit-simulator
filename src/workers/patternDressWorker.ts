// P2c(e) — **v2 패턴 착장 워커**.
//
// v1 `garmentWorker.ts`의 M0 구조를 그대로 따른다: 물리는 `src/lib/`의 공유
// 모듈이 하고 **워커는 살아있는 상태 객체와 메시지만 관리**한다. 여기 물리 코드는
// 0줄이다 — `runPatternDressing` 한 번 부르고 결과를 넘긴다.
// v1 워커는 **건드리지 않는다**(구 경로 비트 동일성 하드 게이트).
//
// 계기 훅은 넘기지 않는다(P2b §2 「계기 6」). 물리 훅 3종은 코어가 배선한다.
// `placementRestGate`는 물리다 — 코어에서 throw하고 여기서는 `ok:false + error`로
// 돌려준다(브라우저에는 프로세스 종료가 없으므로 실패 «상태»가 전달 형식이다).
import { runPatternDressing, type PatternDressFixture, type PatternDressOptions, type PatternDressResult } from "../lib/patternDressCore";

// P5 — `fixture`가 오면 **살아있는 마네킹에서 뜬 몸**을 쓰고, 없으면 커밋된 fixture로
// 되돌아간다(회귀 대조용 경로 유지 · 제거 0).
export type DressWorkerRequest = Omit<PatternDressOptions, "onProgress"> & {
  fixture?: PatternDressFixture;
};

export type DressWorkerMessage =
  | { type: "progress"; frame: number; state: string }
  | ({ type: "done" } & Omit<PatternDressResult, "positions" | "tris" | "uv" | "fitPerVertex"> & {
      positions: Float32Array; tris: Uint32Array; uv: Float32Array; fitPerVertex: Float32Array;
    })
  | { type: "error"; error: string };

// 진행 메시지 주기. 매 프레임 보내면 postMessage가 시뮬보다 비싸진다.
const PROGRESS_EVERY = 30;

self.onmessage = async (ev: MessageEvent<DressWorkerRequest>): Promise<void> => {
  try {
    // 살아있는 몸이 오면 그것을 쓴다. 없을 때만 커밋된 fixture를 동적 import한다
    // (1.7MB — 안 쓰면 로드도 안 한다).
    const { fixture, ...opts } = ev.data;
    const body: PatternDressFixture = fixture
      ?? ((await import("../../scripts/fixtures/collision-fixture.json")).default as never);
    const t = performance.now();
    const r = runPatternDressing(body, {
      ...opts,
      onProgress: (frame, state) => {
        if (frame % PROGRESS_EVERY === 0) self.postMessage({ type: "progress", frame, state } satisfies DressWorkerMessage);
      },
    });
    console.log(`[dressWorker] ${r.state} f=${r.frames} retry=${r.retry} · ${Math.round(performance.now() - t)}ms · 몸=${fixture ? "라이브(마네킹 스냅샷)" : "커밋 fixture"} · ${r.error ?? "실패 없음"}`);
    self.postMessage(
      { type: "done", ...r } as DressWorkerMessage,
      // P17 §2 — 핏 맵 원자료도 함께 넘긴다(복사 아님 · transfer).
      { transfer: [r.positions.buffer, r.tris.buffer, r.uv.buffer, r.fitPerVertex.buffer] },
    );
  } catch (e) {
    self.postMessage({ type: "error", error: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) } satisfies DressWorkerMessage);
  }
};
