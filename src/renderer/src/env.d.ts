/// <reference types="vite/client" />
import type { AquariumApi } from '../../shared/ipc'

declare global {
  interface Window {
    aquarium: AquariumApi
  }
  const __APP_VERSION__: string
}

export {}
