// Gera THIRD-PARTY-NOTICES.txt: as licenças de tudo que vai dentro do instalador além do
// Electron e do Chromium (o electron-builder já inclui LICENSE.electron.txt e LICENSES.chromium.html).
//
//   - dependências de produção (electron-updater e o que ele puxa), que vão em app.asar;
//   - React, que vai embutido no código da interface;
//   - as fontes, cuja licença (SIL OFL 1.1) exige o texto junto com o programa.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const BUNDLED = ['react', 'react-dom', 'scheduler', '@fontsource-variable/bricolage-grotesque', '@fontsource-variable/figtree']

const names = new Set(BUNDLED)
for (const [path, info] of Object.entries(lock.packages)) {
  if (path.startsWith('node_modules/') && !info.dev && !info.optional) names.add(path.slice('node_modules/'.length))
}

// Texto padrão da MIT, para pacotes que declaram a licença mas não trazem o arquivo.
const MIT = (holder) => `Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

function licenseText(dir, pkg) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  if (file) return readFileSync(join(dir, file), 'utf8').trim()
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  return pkg.license === 'MIT' && author ? MIT(author) : null
}

const sections = [...names].sort().map((name) => {
  const dir = join(root, 'node_modules', name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const text = licenseText(dir, pkg)
  if (!text) throw new Error(`${name} não tem arquivo de licença`)
  return `${name} ${pkg.version} (${pkg.license})\n${'-'.repeat(60)}\n${text}`
})

writeFileSync(
  join(root, 'THIRD-PARTY-NOTICES.txt'),
  `Aquarium inclui os componentes abaixo, cada um sob a sua própria licença.\n` +
    `Electron e Chromium: veja LICENSE.electron.txt e LICENSES.chromium.html na pasta do programa.\n` +
    `Gerado por scripts/notices.mjs.\n\n` +
    sections.join('\n\n\n') +
    '\n'
)
console.log(`THIRD-PARTY-NOTICES.txt: ${sections.length} componentes.`)
