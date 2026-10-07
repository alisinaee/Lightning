/** DNS servers worth offering by name, until the user saves them. The Iranian ones were tried
 * from inside Iran (Wi-Fi, one ISP); the notes say what was seen. */
export interface DnsPreset {
  name: string
  servers: string[]
  group: 'iran' | 'world'
  /** Shown beside it: where it works, or what was seen. */
  note?: string
  /** What it is, in a sentence or two, for someone choosing between them. */
  description: string
}

export const SYSTEM_DESCRIPTION =
  'The DNS your computer or internet provider already uses. Needs no setup, and in Iran it usually leads to Iranian servers for Iranian sites.'

export const AUTO_DESCRIPTION =
  'Tests a site the first time, then uses the DNS whose server sent the sample fastest. Re-tests every two weeks. When every DNS leads to the same server, your system DNS stays.'

/** The description of a DNS by its name or its server addresses, if it is a well-known one. */
export function describeDns(nameOrServers: string | string[]): string | undefined {
  if (nameOrServers === 'System DNS') return SYSTEM_DESCRIPTION
  const key = Array.isArray(nameOrServers) ? nameOrServers.join() : nameOrServers
  return DNS_PRESETS.find((preset) => preset.name === key || preset.servers.join() === key)
    ?.description
}

export const DNS_PRESETS: DnsPreset[] = [
  {
    name: 'Electro',
    servers: ['78.157.42.100', '78.157.42.101'],
    group: 'iran',
    description:
      'Iranian anti-sanction DNS, well known with gamers. Opens services blocked for Iran and often gives fast routes for game downloads. Your name lookups go through its servers.'
  },
  {
    name: 'Shecan',
    servers: ['178.22.122.100', '185.51.200.2'],
    group: 'iran',
    description:
      'Iranian anti-sanction DNS for general use, such as sites and downloads blocked for Iran. Not built for games. Lookups go through its servers.'
  },
  {
    name: 'Begzar',
    // Its second address (185.55.225.25) never answered when tried.
    servers: ['185.55.226.26'],
    group: 'iran',
    description:
      'Iranian anti-sanction DNS. In one test it sent GitHub to a server with the wrong certificate, which Lightning rejects, so check the test before relying on it. Lookups go through its servers.'
  },
  {
    name: '403 online',
    servers: ['10.202.10.202', '10.202.10.102'],
    group: 'iran',
    description:
      'Anti-sanction DNS from 403.online. Only reachable from inside Iran’s network, not over a VPN or abroad.',
    note: 'Works only inside Iran’s network'
  },
  {
    name: 'Radar',
    servers: ['10.202.10.10', '10.202.10.11'],
    group: 'iran',
    description:
      'Radar Game’s DNS, aimed at game services and consoles. Only reachable from inside Iran’s network.',
    note: 'Works only inside Iran’s network'
  },
  {
    name: 'Cloudflare',
    servers: ['1.1.1.1', '1.0.0.1'],
    group: 'world',
    description:
      'Fast public DNS from Cloudflare that does not log your address for long. It does not unblock sanctioned sites. In Iran it is often slow to answer.'
  },
  {
    name: 'Google',
    servers: ['8.8.8.8', '8.8.4.4'],
    group: 'world',
    description:
      'Google’s public DNS: reliable and well known. Google keeps lookup logs. It does not unblock sanctioned sites.'
  },
  {
    name: 'Quad9',
    servers: ['9.9.9.9', '149.112.112.112'],
    group: 'world',
    description:
      'Public DNS that blocks sites known to spread malware. It does not unblock sanctioned sites.'
  },
  {
    name: 'AdGuard',
    servers: ['94.140.14.14', '94.140.15.15'],
    group: 'world',
    description:
      'Public DNS that blocks many ads and trackers. It does not unblock sanctioned sites.'
  },
  {
    name: 'OpenDNS',
    servers: ['208.67.222.222', '208.67.220.220'],
    group: 'world',
    description:
      'Cisco’s public DNS, with optional content filtering. It does not unblock sanctioned sites.'
  }
]
