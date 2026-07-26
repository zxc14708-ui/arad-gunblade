const { app, BrowserWindow, Menu, shell } = require('electron')

// 데스크톱 앱은 게임 파일을 내장하지 않고 Cloudflare Pages의 최신 웹 버전을 연다.
// 배포 후 앱을 다시 실행하면 새 게임 파일을 받아오므로 EXE 재배포가 필요 없다.
const GAME_URL = process.env.ARAD_GUNBLADE_URL || 'https://arad-gunblade.pages.dev/'
const GAME_ORIGIN = new URL(GAME_URL).origin

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'ARAD Gunblade',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  Menu.setApplicationMenu(null)
  window.removeMenu()
  window.webContents.on('context-menu', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === GAME_ORIGIN) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  // 이전 배포의 index.html이 남지 않도록 앱 시작 시 웹 캐시를 비운다.
  void window.webContents.session.clearCache().finally(() => {
    void window.loadURL(GAME_URL)
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.zxc14708.aradgunblade')
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
