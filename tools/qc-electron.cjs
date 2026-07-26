const { app, BrowserWindow } = require('../desktop/node_modules/electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'qc-out')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function contactHtml(title, town) {
  return `<!doctype html>
    <html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; } body { margin: 0; background: #111827; color: #e5e7eb; font: 18px system-ui; }
      section { padding: 12px; } h1 { font-size: 16px; margin: 0 0 8px; color: #a7f3d0; letter-spacing: .04em; }
      img { display: block; width: 1280px; height: 720px; border: 1px solid #334155; }
    </style></head><body>
      <section><h1>START SCREEN</h1><img src="${title}"></section>
      <section><h1>TOWN AFTER START</h1><img src="${town}"></section>
    </body></html>`
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true })
    const game = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      webPreferences: { backgroundThrottling: false },
    })
    await game.loadFile(path.join(root, 'dist', 'index.html'))
    await delay(900)
    const title = await game.webContents.capturePage()

    await game.webContents.executeJavaScript(`document.querySelector('#startBtn')?.click()`)
    await delay(1200)
    const town = await game.webContents.capturePage()
    game.destroy()

    const sheet = new BrowserWindow({ width: 1304, height: 1528, show: false })
    await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(contactHtml(title.toDataURL(), town.toDataURL()))}`)
    await delay(250)
    const contact = await sheet.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, 'contact.png'), contact.toPNG())
    sheet.destroy()
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
