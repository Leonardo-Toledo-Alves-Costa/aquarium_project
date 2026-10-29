// Roda um bundle de teste numa janela escondida do Electron e grava o console num arquivo.
// Uso: electron main.cjs <pagina.html> <saida.txt> <limite em ms>
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [html, out, limit] = process.argv.slice(-3)
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  const lines = []
  const done = () => {
    fs.writeFileSync(out, lines.join('\n'))
    app.quit()
  }
  win.webContents.on('console-message', (e) => {
    lines.push(e.message)
    if (/^(RESULT|ERROR) /.test(e.message)) done()
  })
  setTimeout(done, Number(limit))
  win.loadFile(html)
})
