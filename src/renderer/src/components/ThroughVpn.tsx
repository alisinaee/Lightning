import { ShieldCheck } from 'lucide-react'
import { formatBytes, formatSpeed } from '../utils/format'

/** What travelled through the VPN tunnel, as one line below a download's connections. Rendered
 * only when the tunnel actually carried data; it is not a connection and has no switch. */
export function ThroughVpn({
  bytesDownloaded,
  speedBytesPerSec,
  className = ''
}: {
  bytesDownloaded: number
  speedBytesPerSec: number
  className?: string
}): React.JSX.Element {
  return (
    <section aria-label="Through VPN" className={`flex flex-col gap-1.5 ${className}`}>
      <h2 className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-muted-foreground uppercase">
        VPN layer
      </h2>
      <div
        className="flex items-center gap-2.5 rounded-lg border-[0.5px] px-3 py-2 text-[12.5px]"
        style={{ background: 'var(--color-vpn-bg)', borderColor: 'var(--color-vpn-border)' }}
      >
        <ShieldCheck aria-hidden className="size-4" style={{ color: 'var(--color-vpn-text)' }} />
        <span className="font-medium" style={{ color: 'var(--color-vpn-text)' }}>
          Through VPN
        </span>
        <span className="flex-1" />
        {speedBytesPerSec > 0 && (
          <span className="font-mono text-[11.5px] tabular-nums">
            {formatSpeed(speedBytesPerSec)}
          </span>
        )}
        <span className="font-mono text-[11.5px] text-[var(--text-secondary)] tabular-nums">
          {formatBytes(bytesDownloaded)}
        </span>
      </div>
    </section>
  )
}
