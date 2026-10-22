// Liga as travas ("fuses") do Electron no executável empacotado: ele não vira um Node genérico,
// ignora NODE_OPTIONS e --inspect, e só carrega o app.asar conferindo a integridade dele.
// Fica aqui, e não em electronFuses no electron-builder.yml, porque a @electron/fuses que o
// electron-builder traz (1.8) confunde qualquer pasta com ".app" no caminho (como ".apps") com um
// pacote de macOS. A 2.x corrigiu isso.

import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses'
import { join } from 'node:path'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  await flipFuses(join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
}
