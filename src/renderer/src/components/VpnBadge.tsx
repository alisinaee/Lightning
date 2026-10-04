import { KIND_PALETTE } from '../theme'
import { ColorBadge } from './ColorBadge'

/** Marks a VPN tunnel next to its network name. */
export function VpnBadge(): React.JSX.Element {
  const { bg, border, text } = KIND_PALETTE.vpn
  return (
    <ColorBadge
      bg={bg}
      border={border}
      text={text}
      className="h-4 shrink-0 rounded-[3.5px] px-[6px] py-0.5 text-[9px] font-semibold tracking-[0.08em]"
    >
      VPN
    </ColorBadge>
  )
}
