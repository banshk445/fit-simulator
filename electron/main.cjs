// Electron 메인 프로세스. Safari(WebKit)에서만 재현되는, 애플리케이션
// 코드로는 끝내 못 잡은 소매 렌더링 버그(fit_simulator_project_status.md
// 23번 참고)를 우회하기 위해 추가했다 — Electron은 자체 Chromium을
// 번들하므로, 이 세션 내내 크로미움에서는 100% 정상 동작을 확인한 렌더링
// 경로를 그대로 쓸 수 있다. macOS의 Tauri 같은 대안은 시스템 웹뷰
// (WKWebView, 여전히 WebKit 기반)를 쓰므로 같은 버그를 그대로 물려받을
// 위험이 있어 제외했다.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// 개발 모드에서만 원격 디버깅 포트를 연다 — Chrome DevTools Protocol로
// 외부에서 붙어(Playwright의 chromium.connectOverCDP() 등) 렌더링 결과를
// 스크립트로 직접 검증할 수 있다(패키징된 프로덕션 빌드에는 절대 포함
// 안 됨, 보안과 무관). 24번에서 이 스위치를 프로덕션에도 잠깐 열어
// "검은 화면" 버그(마네킹 모델을 "/models/..." 절대 경로로 불러오다
// file:// 프로토콜에서 루트를 못 찾는 문제, Mannequin.tsx 참고)를
// 진단·확정한 뒤 다시 dev 전용으로 되돌렸다.
if (isDev) app.commandLine.appendSwitch("remote-debugging-port", "9222");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Fit Simulator",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 로드 실패/렌더러 크래시는 항상 남겨둔다 — 패키징 환경 특유의 문제
  // (파일 경로, 권한 등)는 콘솔에 아무것도 안 남으면 원인 추적이 거의
  // 불가능하다는 걸 이번에 직접 겪었다.
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[did-fail-load] code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[render-process-gone]", JSON.stringify(details));
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
