/** DNS servers worth offering by name, until the user saves them. The Iranian ones were tried
 * from inside Iran (Wi-Fi, one ISP); the notes say what was seen. */
export interface DnsPreset {
  name: string
  servers: string[]
  group: 'iran' | 'world'
  /** Shown beside it: where it works, or what was seen. */
  note?: string
}

export const DNS_PRESETS: DnsPreset[] = [
  { name: 'Electro', servers: ['78.157.42.100', '78.157.42.101'], group: 'iran' },
  { name: 'Shecan', servers: ['178.22.122.100', '185.51.200.2'], group: 'iran' },
  {
    name: 'Begzar',
    // Its second address (185.55.225.25) never answered when tried.
    servers: ['185.55.226.26'],
    group: 'iran'
  },
  {
    name: '403 online',
    servers: ['10.202.10.202', '10.202.10.102'],
    group: 'iran',
    note: 'Works only inside Iran’s network'
  },
  {
    name: 'Radar',
    servers: ['10.202.10.10', '10.202.10.11'],
    group: 'iran',
    note: 'Works only inside Iran’s network'
  },
  { name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'], group: 'world' },
  { name: 'Google', servers: ['8.8.8.8', '8.8.4.4'], group: 'world' },
  { name: 'Quad9', servers: ['9.9.9.9', '149.112.112.112'], group: 'world' },
  { name: 'AdGuard', servers: ['94.140.14.14', '94.140.15.15'], group: 'world' },
  { name: 'OpenDNS', servers: ['208.67.222.222', '208.67.220.220'], group: 'world' }
]
