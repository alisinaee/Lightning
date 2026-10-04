export interface VpnCandidate {
  device: string
  /** Windows adapter description. */
  description?: string
  /** macOS hardware port name from `networksetup`. */
  hardwareName?: string
}

// Device names: macOS (utun, ipsec, ppp) and Linux tunnels. Anchored so en0, eth0, wlan0 and
// bridge0 never match. gif/stf are IPv6 transition tunnels, not VPNs.
const DEVICE_NAME =
  /^(utun\d+|ipsec\d*|ppp\d+|tun\d+|tap\d+|wg\d+|vti\d*|tailscale\d*|zt[a-z0-9]+|nordlynx|proton\d*|mullvad.*|wgcf.*|clash.*|v2ray.*|xray.*|sing-?box.*|hiddify.*|warp.*)$/i

const WINDOWS_TEXT =
  /wireguard|openvpn|tap-windows|wintun|tun adapter|vpn|tailscale|zerotier|nordlynx|proton|mullvad|cisco anyconnect|globalprotect|forticlient|pulse secure|ivanti|sstp|l2tp|pptp|ikev2|clash|v2ray|xray|sing-?box|hiddify|happ|warp/i

const MAC_PORT = /vpn|l2tp|ipsec|ikev2|cisco|wireguard|tailscale|openvpn/i

/** True for a tunnel made by a VPN or proxy app rather than a real network. */
export function isVpnInterface({ device, description, hardwareName }: VpnCandidate): boolean {
  if (DEVICE_NAME.test(device.trim())) return true
  if (hardwareName && MAC_PORT.test(hardwareName)) return true
  if (description && WINDOWS_TEXT.test(description)) return true
  // On Windows the adapter's name is its alias ("OpenVPN Data Channel", "Wi-Fi").
  return WINDOWS_TEXT.test(device)
}
