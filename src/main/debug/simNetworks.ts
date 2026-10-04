import { app } from 'electron'
import type { NetworkInterfaceInfo, NetworkInterfaceKind } from '../../shared/types'
import { log } from '../logger'

// Simulated networks for the Test lab. While enabled they replace the computer's real networks in
// listActiveInterfaces (network/interfaces.ts), so the whole app (the lists, the pickers, the Auto
// scheduler, the VPN filter) sees them. All of them are 127.0.0.1; their requests name the network
// in the X-Plexo-Network header (see routes.ts), which is how the lab's server tells them apart.
// Unlike PLEXO_E2E_INTERFACES this works in a packaged build, and a network can be added or
// removed at any moment to make a connection drop and come back.

export interface SimNetworkSpec {
  id: string
  displayName: string
  kind: NetworkInterfaceKind
}

export const SIM_CATALOG: SimNetworkSpec[] = [
  { id: 'Wi-Fi', displayName: 'Wi-Fi', kind: 'wifi' },
  { id: 'Ethernet', displayName: 'Ethernet', kind: 'ethernet' },
  { id: 'Phone', displayName: 'Phone (USB)', kind: 'usb' },
  { id: 'Fake VPN', displayName: 'Fake VPN', kind: 'vpn' }
]

function asInterface(spec: SimNetworkSpec): NetworkInterfaceInfo {
  return {
    id: spec.id,
    device: spec.id,
    displayName: spec.displayName,
    addresses: [{ address: '127.0.0.1', family: 4 }],
    kind: spec.kind
  }
}

class SimNetworks {
  private active = false
  private specs: SimNetworkSpec[] = []
  private listeners = new Set<(active: boolean) => void>()
  private quitHook = false

  isActive(): boolean {
    return this.active
  }

  /** The simulated networks, or null when the real ones are in use. */
  interfaces(): NetworkInterfaceInfo[] | null {
    return this.active ? this.specs.map(asInterface) : null
  }

  list(): SimNetworkSpec[] {
    return [...this.specs]
  }

  has(id: string): boolean {
    return this.specs.some((spec) => spec.id === id)
  }

  /** Switches the simulation on with every catalogue network present. */
  enable(): void {
    if (!this.quitHook) {
      this.quitHook = true
      app.once('before-quit', () => this.disable())
    }
    this.specs = [...SIM_CATALOG]
    this.setActive(true)
  }

  /** The real networks are back. */
  disable(): void {
    this.specs = []
    this.setActive(false)
  }

  /** A network (re)appears. A known name needs no more; another is added as an Ethernet one. */
  add(id: string, spec?: Partial<SimNetworkSpec>): void {
    if (this.has(id)) return
    const known = SIM_CATALOG.find((entry) => entry.id === id)
    const next: SimNetworkSpec = {
      id,
      displayName: spec?.displayName ?? known?.displayName ?? id,
      kind: spec?.kind ?? known?.kind ?? 'ethernet'
    }
    // Back in its usual place, so the list doesn't reshuffle when a network returns.
    const order = SIM_CATALOG.map((entry) => entry.id)
    this.specs = [...this.specs, next].sort(
      (a, b) =>
        (order.includes(a.id) ? order.indexOf(a.id) : 99) -
        (order.includes(b.id) ? order.indexOf(b.id) : 99)
    )
    log.info('lab', `simulated network added: ${id}`)
  }

  remove(id: string): void {
    if (!this.has(id)) return
    this.specs = this.specs.filter((spec) => spec.id !== id)
    log.info('lab', `simulated network removed: ${id}`)
  }

  onActiveChange(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setActive(active: boolean): void {
    if (active !== this.active) log.info('lab', `simulated networks ${active ? 'on' : 'off'}`)
    this.active = active
    for (const listener of this.listeners) listener(active)
  }
}

export const simNetworks = new SimNetworks()
