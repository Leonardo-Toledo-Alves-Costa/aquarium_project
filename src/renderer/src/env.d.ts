/// <reference types="vite/client" />
import type { AquarioApi } from '../../shared/ipc'

declare global {
  interface Window {
    aquario: AquarioApi
  }
}

export {}
