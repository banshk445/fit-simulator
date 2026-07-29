// 화면 판정용 캡처 — `npm run capture` 하나로 정면/후면/목/커프를 찍는다.
//
// 왜 필요했나: 화면 판정이 매번 "브라우저 띄워줘 → 다음 턴에 캡처"로
// 밀려서 한 번의 판정에 두세 턴이 갔다. 카메라 각도도 눈대중이라 전후
// 대조가 안 됐다. 시점은 FitCanvas.tsx의 CAPTURE_VIEWS에 고정돼 있고,
// 여기서는 URL만 그 시점으로 바꿔가며 찍는다.
//
// 함정 1(HMR이 워커를 안 갱신) 대책: 매 시점마다 URL을 새로 넣어 **전체
// 페이지 로드**를 강제한다. HMR 갱신분이 화면에 반영 안 된 상태로 판정하는
// 사고가 이 저장소에서 두 번 났다(원복 오진까지 갔다).
//
// screencapture나 osascript가 실패하면 메시지를 그대로 뱉고 비정상 종료한다
// — 조용히 넘어가면 "직전 캡처"를 새 결과로 착각한다.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.CAPTURE_URL ?? "http://localhost:5173/?autofit=1&newcore=1";
// 시뮬이 정착할 시간. fixture 계측상 Δ20<=5.6mm 도달이 104프레임(≈1.7s)
// 이지만 브라우저는 초기화·BVH 굽기가 앞에 붙는다.
const SETTLE_MS = Number(process.env.CAPTURE_SETTLE ?? 9000);
const OUT_DIR = resolve(process.env.CAPTURE_OUT ?? "/tmp/fit-capture");
const VIEWS = (process.argv[2] ?? process.env.CAPTURE_VIEWS ?? "front,back,neck,cuff").split(",");

function osa(script: string): string {
  try {
    return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message: string };
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    console.error(`[capture] osascript 실패: ${detail}`);
    console.error(
      "[capture] Chrome 제어 권한이 필요하다 — 시스템 설정 > 개인정보 보호 및 보안 > 자동화 에서 터미널의 Google Chrome 항목을 켤 것.",
    );
    process.exit(1);
  }
}

function chromeBounds(): { x: number; y: number; w: number; h: number } {
  const raw = osa('tell application "Google Chrome" to return bounds of front window');
  const [x1, y1, x2, y2] = raw.split(",").map((v) => Number(v.trim()));
  if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) {
    console.error(`[capture] Chrome 창 좌표를 못 읽었다: ${raw}`);
    process.exit(1);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function sleep(ms: number): void {
  // 동기 대기 — 이 스크립트는 순차 실행이고 중간에 할 일이 없다.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

mkdirSync(OUT_DIR, { recursive: true });
const url = (view: string) => `${BASE}&view=${view}&cb=${process.pid}${Date.now()}`;

const shots: string[] = [];
for (const view of VIEWS) {
  osa(`tell application "Google Chrome"
    activate
    set URL of active tab of front window to "${url(view)}"
  end tell`);
  sleep(SETTLE_MS);
  const b = chromeBounds();
  // 3D 뷰포트만 — 왼쪽 패널(272pt)과 탭·주소창·북마크바(120pt)를 뺀다.
  const region = `${b.x + 272},${b.y + 120},${b.w - 272},${b.h - 120}`;
  const out = `${OUT_DIR}/${view}.png`;
  try {
    execFileSync("screencapture", ["-x", "-R", region, out], { stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message: string };
    console.error(`[capture] screencapture 실패(${view}): ${err.stderr ? String(err.stderr).trim() : err.message}`);
    console.error("[capture] 화면 잠김/디스플레이 절전이면 실패한다. 화면 기록 권한도 확인할 것.");
    process.exit(1);
  }
  shots.push(out);
  console.log(`[capture] ${view} -> ${out}`);
}
console.log(`[capture] ${shots.length}장 완료. 정착 대기 ${SETTLE_MS}ms, base=${BASE}`);
