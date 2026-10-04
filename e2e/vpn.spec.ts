import { expect, test } from '@playwright/test'
import { isVpnInterface } from '../src/main/network/vpn'
import { defaultNetworkIds, isNetworkOff, selectableNetworks } from '../src/shared/networks'

// Which network names are VPN tunnels. Pure, so the names are the inputs.

test('tunnels from VPN apps are VPNs', () => {
  for (const device of [
    'utun4',
    'ipsec0',
    'ppp0',
    'tun0',
    'tap1',
    'wg0',
    'tailscale0',
    'ztabcdef12',
    'nordlynx',
    'proton0',
    'mullvad-wg',
    'wgcf',
    'Clash',
    'v2ray0',
    'xray0',
    'sing-box',
    'singbox',
    'hiddify',
    'warp0'
  ]) {
    expect(isVpnInterface({ device }), device).toBe(true)
  }
})

test('Windows adapters and macOS ports are told by description', () => {
  expect(isVpnInterface({ device: 'Ethernet 2', description: 'WireGuard Tunnel' })).toBe(true)
  expect(
    isVpnInterface({ device: 'Local Area Connection', description: 'TAP-Windows Adapter V9' })
  ).toBe(true)
  expect(isVpnInterface({ device: 'Happ' })).toBe(true)
  expect(isVpnInterface({ device: 'en7', hardwareName: 'Cisco AnyConnect VPN' })).toBe(true)
})

test('ordinary networks are not VPNs', () => {
  for (const device of [
    'en0',
    'en6',
    'eth0',
    'wlan0',
    'bridge0',
    'Wi-Fi',
    'Ethernet',
    'iPhone USB'
  ]) {
    expect(isVpnInterface({ device }), device).toBe(false)
  }
  expect(isVpnInterface({ device: 'en0', hardwareName: 'Wi-Fi' })).toBe(false)
  expect(isVpnInterface({ device: 'en6', hardwareName: 'iPhone USB' })).toBe(false)
  expect(isVpnInterface({ device: 'Ethernet', description: 'Intel(R) Ethernet Connection' })).toBe(
    false
  )
  expect(isVpnInterface({ device: 'gif0' })).toBe(false)
  expect(isVpnInterface({ device: 'stf0' })).toBe(false)
})

test('a VPN is not a connection unless "Use VPN for downloads" is on', () => {
  const vpn = { id: 'utun4', kind: 'vpn' as const }
  const wifi = { id: 'en0', kind: 'wifi' as const }
  expect(selectableNetworks([wifi, vpn], false)).toEqual([wifi])
  expect(selectableNetworks([wifi, vpn], true)).toEqual([wifi, vpn])
  // Only a VPN connected: kept, so a download can still start.
  expect(selectableNetworks([vpn], false)).toEqual([vpn])
  expect(defaultNetworkIds([wifi, vpn], {}, false)).toEqual(['en0'])
  expect(defaultNetworkIds([wifi, vpn], {}, true)).toEqual(['en0', 'utun4'])
  expect(defaultNetworkIds([vpn], {}, false)).toEqual(['utun4'])
})

test("an old per-network choice for a VPN no longer matters; the user's off still does", () => {
  const vpn = { id: 'utun4', kind: 'vpn' as const }
  const wifi = { id: 'en0', kind: 'wifi' as const }
  expect(isNetworkOff(vpn, { utun4: { off: false } })).toBe(false)
  expect(isNetworkOff(vpn, {})).toBe(false)
  expect(isNetworkOff(wifi, { en0: { off: true } })).toBe(true)
  expect(defaultNetworkIds([wifi, vpn], { utun4: { off: false } }, false)).toEqual(['en0'])
  expect(defaultNetworkIds([wifi, vpn], { en0: { off: true } }, true)).toEqual(['utun4'])
})
