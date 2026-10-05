import { request } from 'node:http'
import { expect, test } from './fixtures'

const EXTENSION = 'chrome-extension://abcdefghijklmnop'

/** One request to the extension's server; `headers` may override Host and Origin, which fetch won't. */
function call(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : {} })
        })
      }
    )
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}

test.describe('browser extension server @smoke', () => {
  test('answers only the extension, with the pairing key', async ({ lightning }) => {
    await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
    const { port, key } = await lightning.api.getIntegration()
    const auth = { Authorization: `Bearer ${key}` }

    expect((await call(port!, 'GET', '/v1/ping')).json).toMatchObject({ app: 'Lightning' })
    // A web page (any Origin that is not an extension's) or a rebound Host is refused outright.
    expect((await call(port!, 'GET', '/v1/ping', { Origin: 'https://evil.test' })).status).toBe(403)
    expect((await call(port!, 'GET', '/v1/ping', { Host: 'evil.test' })).status).toBe(403)
    // The key is needed for everything else.
    expect((await call(port!, 'GET', '/v1/auth', { Origin: EXTENSION })).status).toBe(401)
    expect(
      (await call(port!, 'GET', '/v1/auth', { Origin: EXTENSION, Authorization: 'Bearer nope' }))
        .status
    ).toBe(401)
    expect((await call(port!, 'GET', '/v1/auth', { Origin: EXTENSION, ...auth })).status).toBe(200)
    expect((await call(port!, 'OPTIONS', '/v1/add', { Origin: EXTENSION })).status).toBe(204)
  })

  test('a link sent by the extension opens in the window with its page and cookies', async ({
    lightning
  }) => {
    await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
    const { port, key } = await lightning.api.getIntegration()
    const headers = { Origin: EXTENSION, Authorization: `Bearer ${key}` }

    const bad = await call(port!, 'POST', '/v1/add', headers, { url: 'javascript:alert(1)' })
    expect(bad.status).toBe(400)
    await expect(lightning.page.getByRole('textbox', { name: 'Link' })).toHaveCount(0)

    const sent = await call(port!, 'POST', '/v1/add', headers, {
      url: 'https://files.test/a.zip',
      referer: 'https://page.test/',
      cookie: 'sid=1',
      userAgent: 'UA/1'
    })
    expect(sent.status).toBe(200)
    // New download is open with the link, and the Advanced fields hold what the browser knew.
    await expect(lightning.page.getByRole('textbox', { name: 'Link' })).toHaveValue(
      'https://files.test/a.zip'
    )
    await expect(lightning.page.getByPlaceholder('name=value; other=value')).toHaveValue('sid=1')
    await expect(lightning.page.getByPlaceholder('https://page-the-link-came-from')).toHaveValue(
      'https://page.test/'
    )
  })

  test('a new key unpairs the old one, and switching it off closes the port', async ({
    lightning
  }) => {
    await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
    const { port, key } = await lightning.api.getIntegration()
    const fresh = await lightning.api.regenerateIntegrationKey()
    expect(fresh).not.toBe(key)
    const old = { Origin: EXTENSION, Authorization: `Bearer ${key}` }
    expect((await call(port!, 'GET', '/v1/auth', old)).status).toBe(401)
    expect(
      (
        await call(port!, 'GET', '/v1/auth', {
          Origin: EXTENSION,
          Authorization: `Bearer ${fresh}`
        })
      ).status
    ).toBe(200)

    await lightning.api.updateSettings({ prefs: { browserIntegration: false } })
    await expect.poll(async () => (await lightning.api.getIntegration()).port).toBeNull()
    await expect(call(port!, 'GET', '/v1/ping')).rejects.toThrow()
  })
})
