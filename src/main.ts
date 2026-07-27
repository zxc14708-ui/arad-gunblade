import './style.css'
import { Game } from './core/Game'

declare const __QC_DEBUG__: boolean

// Keep right mouse button available for game controls everywhere, including UI overlays.
window.addEventListener('contextmenu', (event) => event.preventDefault())

const app = document.getElementById('app')!
const game = new Game(app)

// QC 훅 — tools/qc.mjs 가 플레이어 화면 좌표와 진행 상태를 읽어
// 확대 캡처와 단계 판정에 쓴다. 게임 동작에는 영향이 없다.
;(window as unknown as { __game: Game }).__game = game

// QC 전용 디버그 스폰 훅(보스/엘리트) — vite.config.ts의 __QC_DEBUG__가
// false로 정적 치환되는 일반 빌드에서는 이 블록 전체가 죽은 코드로 빠져
// qcDebugHooks.ts가 번들에 실리지 않는다. tools/qc.mjs만 QC_DEBUG=1로 빌드한다.
if (__QC_DEBUG__) {
  import('./core/qcDebugHooks').then((m) => m.installQcDebugHooks(game))
}
