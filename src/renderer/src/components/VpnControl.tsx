import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { describeVpn, useVpnLayer } from '../hooks/useConnections'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'

/** The VPN, as its own control beside the networks menu: a tunnel is not a connection, only
 * something downloads go through or skip. Shown only while a VPN is detected. */
export function VpnControl(): React.JSX.Element | null {
  const { detected, on, tunnels, setOn } = useVpnLayer()
  const networkVisual = useNetworkVisuals()
  if (!detected) return null
  const names = tunnels.map(
    (tunnel) => networkVisual(tunnel.id, tunnel.kind, tunnel.displayName).name
  )
  const Icon = on ? ShieldCheck : ShieldOff
  return (
    <Popover>
      <PopoverTrigger
        title={`VPN is ${on ? 'on' : 'off'}`}
        aria-label={`VPN: ${on ? 'on' : 'off'}`}
        className="flex size-8 items-center justify-center rounded-lg border-[0.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          background: on ? 'var(--color-vpn-bg)' : 'transparent',
          borderColor: on ? 'var(--color-vpn-border)' : 'var(--border-strong)',
          color: on ? 'var(--color-vpn-text)' : 'var(--text-secondary)'
        }}
      >
        <Icon aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] gap-0 p-0">
        <div className="flex items-start gap-3 p-4">
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--color-vpn-bg)', color: 'var(--color-vpn-text)' }}
          >
            <Icon aria-hidden className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-[14px] font-semibold">VPN layer</div>
            <div className="text-[12.5px] leading-snug text-[var(--text-secondary)]">
              {describeVpn(on, names)}
            </div>
          </div>
          <Switch aria-label="Use VPN for downloads" checked={on} onCheckedChange={setOn} />
        </div>
        <div className="border-t-[0.5px] border-border px-4 py-3 text-[12px] leading-snug text-muted-foreground">
          A VPN is not a connection. When on, downloads may travel through the tunnel on top of the
          networks you have switched on. It is never listed with them.
        </div>
      </PopoverContent>
    </Popover>
  )
}
