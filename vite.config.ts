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
  plugins: [react(), tailwindcss()],
});
