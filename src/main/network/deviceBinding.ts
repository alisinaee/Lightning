import { connect, Socket, type SocketConstructorOpts } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { NetworkRoute } from './routes'

// A socket's outgoing interface is chosen by the routing table, not by the source address it is
// bound to (Node's `localAddress`). On Linux that sends the packets out the default route, where
// the network that doesn't own that IP drops them; on macOS a full-tunnel VPN (FortiClient, V2Box)
// puts its default route first and swallows the traffic of every network, so downloads crawl.
// SO_BINDTODEVICE (Linux, unprivileged since 5.7) and IP_BOUND_IF / IPV6_BOUND_IF (macOS) pin the
// socket to the interface itself. Node has no setsockopt, so the socket is made through libc and
// handed to Node as an fd. Windows still routes by source address.

const AF_INET = 2
const SOCK_STREAM = 1
const LINUX = {
  AF_INET6: 10,
  SOCK_CLOEXEC: 0o2000000,
  SOL_SOCKET: 1,
  SO_BINDTODEVICE: 25
}
const DARWIN = {
  AF_INET6: 30,
  IPPROTO_IP: 0,
  IP_BOUND_IF: 25,
  IPPROTO_IPV6: 41,
  IPV6_BOUND_IF: 125
}

interface Libc {
  socket: (domain: number, type: number, protocol: number) => number
  /** Pins the socket to the named device, returning 0 or a nonzero errno-bearing failure. */
  bind: (fd: number, device: string, family: 4 | 6) => number
  close: (fd: number) => number
  errno: () => number
}

/** Set once the support check below passes; until then everything falls back to localAddress. */
let libc: Libc | null = null
let support: Promise<boolean> | null = null

function openOnDevice(lib: Libc, device: string, family: 4 | 6): number {
  const platform = process.platform === 'darwin' ? DARWIN : LINUX
  const type = process.platform === 'darwin' ? SOCK_STREAM : SOCK_STREAM | LINUX.SOCK_CLOEXEC
  const fd = lib.socket(family === 6 ? platform.AF_INET6 : AF_INET, type, 0)
  if (fd < 0) throw new Error(`socket() failed (errno ${lib.errno()})`)
  if (lib.bind(fd, device, family) !== 0) {
    const errno = lib.errno()
    lib.close(fd)
    throw new Error(`Couldn't bind a socket to ${device} (errno ${errno})`)
  }
  return fd
}

async function loadLibc(): Promise<Libc> {
  const { default: koffi } = await import('koffi')
  if (process.platform === 'darwin') {
    const lib = koffi.load('/usr/lib/libSystem.B.dylib')
    const setsockopt = lib.func('int setsockopt(int, int, int, uint32_t *, uint32_t)')
    const ifIndex = lib.func('uint32_t if_nametoindex(const char *)')
    return {
      socket: lib.func('int socket(int, int, int)'),
      bind: (fd, device, family) => {
        const index = ifIndex(device)
        if (!index) return -1
        return family === 6
          ? setsockopt(fd, DARWIN.IPPROTO_IPV6, DARWIN.IPV6_BOUND_IF, [index], 4)
          : setsockopt(fd, DARWIN.IPPROTO_IP, DARWIN.IP_BOUND_IF, [index], 4)
      },
      close: lib.func('int close(int)'),
      errno: () => koffi.errno()
    }
  }
  const lib = koffi.load('libc.so.6')
  const setsockopt = lib.func('int setsockopt(int, int, int, const char *, uint32_t)')
  return {
    socket: lib.func('int socket(int, int, int)'),
    bind: (fd, device) =>
      setsockopt(
        fd,
        LINUX.SOL_SOCKET,
        LINUX.SO_BINDTODEVICE,
        device,
        Buffer.byteLength(device) + 1
      ),
    close: lib.func('int close(int)'),
    errno: () => koffi.errno()
  }
}

/** Whether each network can carry its own connections. Always true off Linux and macOS. */
export function deviceBindingSupported(): Promise<boolean> {
  support ??= (async () => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return true
    try {
      const candidate = await loadLibc()
      // Loopback always exists, so this only fails when the kernel refuses (EPERM before 5.7).
      candidate.close(openOnDevice(candidate, process.platform === 'darwin' ? 'lo0' : 'lo', 4))
      libc = candidate
      return true
    } catch (error) {
      console.warn('Per-network binding unavailable, using the default route:', error)
      return false
    }
  })()
  return support
}

/** A TCP connection through the already chosen device, to a numeric remote address. */
export function connectRoute(route: NetworkRoute, port: number): Socket {
  const { device, localAddress, remoteAddress, family } = route
  const loopback = remoteAddress === '::1' || remoteAddress.startsWith('127.')
  if (!libc || loopback) {
    return connect({ host: remoteAddress, port, localAddress, family })
  }

  let fd: number
  try {
    fd = openOnDevice(libc, device, family)
  } catch (error) {
    // The interface vanished since it was listed — surface it like any other connect error.
    const socket = new Socket()
    process.nextTick(() => socket.destroy(error as Error))
    return socket
  }
  // manualStart: a socket wrapped around an fd starts reading at once, before it's connected.
  // Bind both the device and source address: an interface may have several IPv6 addresses.
  return new Socket({ fd, manualStart: true } as SocketConstructorOpts).connect({
    host: remoteAddress,
    port,
    localAddress,
    family
  })
}

function deviceFor(localAddress: string, host: string): string | undefined {
  if (host === 'localhost' || host.startsWith('127.') || host === '::1') return undefined
  for (const [device, addresses] of Object.entries(networkInterfaces())) {
    if (addresses?.some((addr) => addr.address === localAddress)) return device
  }
  return undefined
}

/** A TCP connection to host:port that leaves through the interface owning `localAddress` or `device`. */
export function connectFrom(
  localAddress: string | undefined,
  host: string,
  port: number,
  deviceName?: string
): Socket {
  const isLoopback = host === 'localhost' || host.startsWith('127.') || host === '::1'
  if (isLoopback) {
    return connect({ host, port })
  }

  const device = deviceName ?? (libc && localAddress ? deviceFor(localAddress, host) : undefined)
  if (!libc || !device) {
    return connect({ host, port, localAddress: localAddress || undefined })
  }

  const isIpv6 = Boolean(localAddress?.includes(':') || host.includes(':'))
  const family = isIpv6 ? 6 : 4
  let fd: number
  try {
    fd = openOnDevice(libc, device, family)
  } catch (error) {
    // The interface vanished since it was listed — surface it like any other connect error.
    const socket = new Socket()
    process.nextTick(() => socket.destroy(error as Error))
    return socket
  }
  return new Socket({ fd, manualStart: true } as SocketConstructorOpts).connect({
    host,
    port,
    localAddress: localAddress || undefined,
    family
  })
}
