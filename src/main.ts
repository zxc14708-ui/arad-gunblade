import './style.css'
import { Game } from './core/Game'

// Keep right mouse button available for game controls everywhere, including UI overlays.
window.addEventListener('contextmenu', (event) => event.preventDefault())

const app = document.getElementById('app')!
new Game(app)
