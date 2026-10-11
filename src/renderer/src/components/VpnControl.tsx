import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { describeVpn, useVpnLayer } from '../hooks/useConnections'
import { Switch } from './ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** The VPN, as its own labelled switch beside the networks menu: a tunnel is not a connection,
 * only something downloads go through or skip. Shown only while a VPN is detected. */
export function VpnControl(): React.JSX.Element | null {
  const { detected, on, tunnels, setOn } = useVpnLayer()
  const networkVisual = useNetworkVisuals()
  if (!detected) return null
  const names = tunnels.map(
    (tunnel) => networkVisual(tunnel.id, tunnel.kind, tunnel.displayName).name
  )
  const Icon = on ? ShieldCheck : ShieldOff
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <label
            className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border-[0.5px] px-2.5 text-[12.5px] font-medium"
            style={{
              background: on ? 'var(--color-vpn-bg)' : 'transparent',
              borderColor: on ? 'var(--color-vpn-border)' : 'var(--border-strong)',
              color: on ? 'var(--color-vpn-text)' : 'var(--text-secondary)'
            }}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span>VPN</span>
            <Switch aria-label="Use VPN for downloads" checked={on} onCheckedChange={setOn} />
          </label>
        }
      />
      <TooltipContent className="max-w-[280px] text-balance">
        <div className="font-medium">Use VPN for downloads</div>
        <div className="mt-1 opacity-90">
          On: downloads may also go through your active VPN, on top of your real connections. Off:
          downloads skip VPN tunnels and use only your real connections.
        </div>
        <div className="mt-1 opacity-75">{describeVpn(on, names)}</div>
      </TooltipContent>
    </Tooltip>
  )
}
