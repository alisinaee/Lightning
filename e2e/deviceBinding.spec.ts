import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { expect, test } from '@playwright/test'
import { connectRoute, deviceBindingSupported } from '../src/main/network/deviceBinding'

/*
 * On macOS and Linux a connection is pinned to its network's interface, so a VPN's default route
 * can't take it. Connecting to the machine's own address over a real interface proves the pinned
 * socket works end to end.
 */
test('a socket pinned to an interface connects', async () => {
  test.skip(process.platform !== 'darwin' && process.platform !== 'linux')
  expect(await deviceBindingSupported()).toBe(true)

  const found = Object.entries(networkInterfaces())
    .flatMap(([device, list]) => (list ?? []).map((item) => ({ device, ...item })))
    .find((item) => item.family === 'IPv4' && !item.internal)
  test.skip(!found, 'no external IPv4 interface')

  const server = createServer((socket) => socket.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const socket = connectRoute(
        {
          device: found!.device,
          localAddress: found!.address,
          remoteAddress: found!.address,
          family: 4
        } as Parameters<typeof connectRoute>[0],
        port
      )
      let text = ''
      socket.on('data', (chunk) => (text += chunk))
      socket.on('end', () => resolve(text))
      socket.on('error', reject)
    })
    expect(data).toBe('ok')
  } finally {
    server.close()
  }
})
