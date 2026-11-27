import { t } from '@shared/i18n/react'
import type { NetworkInterfaceInfo } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

/** The VPN layer: whether a tunnel is detected, whether downloads may use it, and its names. */
export function useVpnLayer(): {
  detected: boolean
  on: boolean
  tunnels: NetworkInterfaceInfo[]
  setOn: (on: boolean) => void
} {
  const tunnels = useAppStore((store) => store.vpnInterfaces)
  const on = useAppStore((store) => store.useVpn)
  const setOn = useAppStore((store) => store.setUseVpn)
  return { detected: tunnels.length > 0, on, tunnels, setOn }
}

/** What the VPN layer is doing, in a sentence. */
export function describeVpn(on: boolean, tunnels: string[]): string {
  return on
    ? t('On — via {tunnels}', { tunnels: tunnels.join(', ') })
    : t('Off — downloads use your real connections')
}
