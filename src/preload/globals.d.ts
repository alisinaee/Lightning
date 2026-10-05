import type { LightningApi } from './index'

declare global {
  interface Window {
    lightning: LightningApi
  }
}
