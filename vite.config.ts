import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  define: {
    // QC 하네스 전용 디버그 훅 포함 여부 — tools/qc.mjs가 빌드할 때만
    // QC_DEBUG=1 을 세팅한다. false로 정적 치환되면 main.ts의 동적 import가
    // 죽은 코드로 제거되어, 배포용 빌드(npm run build)에는 훅이 아예 안 실린다.
    __QC_DEBUG__: JSON.stringify(process.env.QC_DEBUG === '1'),
  },
})
