import {
  DeviceMobile,
  GlobeSimple,
  Network,
  Plugs,
  ShieldCheck,
  WifiHigh,
  type Icon
} from '@phosphor-icons/react'
import type { NetworkInterfaceKind } from '@shared/types'

const ICONS: Record<NetworkInterfaceKind, Icon> = {
  wifi: WifiHigh,
  ethernet: Plugs,
  // A phone or modem plugged in over USB (tethering) shows up as a USB network.
  usb: DeviceMobile,
  bridge: Network,
  vpn: ShieldCheck,
  other: GlobeSimple
}

/** The icon of a kind of network: Wi-Fi, a cable, a phone tethered over USB, and so on. */
export function NetworkKindIcon({
  kind,
  className,
  style
}: {
  kind: NetworkInterfaceKind
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const Glyph = ICONS[kind] ?? GlobeSimple
  return <Glyph aria-hidden weight="regular" className={className} style={style} />
}
