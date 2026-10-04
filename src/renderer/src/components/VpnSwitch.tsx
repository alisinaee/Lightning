import { useAppStore } from '../store/useAppStore'
import { Switch } from './ui/switch'

/** The one setting for VPN tunnels: they are not a connection to pick, only something every
 * download uses or skips. Only shown while a VPN is detected. */
export function VpnSwitch(): React.JSX.Element | null {
  const detected = useAppStore((store) => store.allInterfaces.some((iface) => iface.kind === 'vpn'))
  const useVpn = useAppStore((store) => store.useVpn)
  const setUseVpn = useAppStore((store) => store.setUseVpn)
  if (!detected) return null
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">Use VPN for downloads</span>
        <span className="text-[12px] leading-snug text-muted-foreground">
          Off: downloads skip VPN tunnels and use your real connections.
        </span>
      </span>
      <Switch aria-label="Use VPN for downloads" checked={useVpn} onCheckedChange={setUseVpn} />
    </label>
  )
}
