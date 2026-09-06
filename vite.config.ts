import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Electron이 프로덕션 빌드를 file:// 프로토콜로 직접 열기 때문에, 기본값인
  // 절대 경로('/assets/...')는 파일시스템 루트를 가리켜버려 리소스를 못
  // 찾는다 — 상대 경로('./assets/...')로 바꿔 file:// 로딩에서도 동작하게
  // 한다. 웹 배포(base='/')에는 영향 없다(개발 서버는 base 설정과 무관하게
  // 항상 정상 동작).
  base: "./",
  /* ★ v4-42 §1-② — **굽기 산출 폴더를 감시에서 뺀다**(개발 서버 «전용» 설정 · 빌드 영향 0).
   * 근거: v4-41 27칸 실행에서 수신기가 `gpu/oracle/export/grid27` 로 파일을 떨구자 vite 가
   * 그것을 «소스 변경»으로 보고 페이지를 리로드해 하네스가 중간에 죽었다(판정문 ㉢).
   * 이 경로들은 **소스가 아니라 산출물**이다 — HMR 대상이 아니다. */
  server: { watch: { ignored: ["**/gpu/oracle/export/**", "**/gpu/bake/results/**", "**/public/v3diag/**"] } },
  plugins: [react(), tailwindcss()],
});
