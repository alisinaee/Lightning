import { BLOCK, expect, test } from './fixtures'
import type { OriginRequest } from './origin'

const SIZE = 6 * BLOCK
const BASIC = `Basic ${Buffer.from('me:secret').toString('base64')}`

/** A server that wants a sign-in, a Referer and a cookie on every request, as a hotlink-protected,
 * login-gated host does. */
const gate = ({ headers }: OriginRequest): 'ok' | { status: number } =>
  headers.authorization === BASIC &&
  headers.referer === 'https://page.test/' &&
  headers.cookie === 'sid=1' &&
  headers['x-token'] === 'abc'
    ? 'ok'
    : { status: 401 }

test.describe('sign-in, cookies and headers @smoke', () => {
  test('every request of a gated download carries them, and the file completes', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(gate)
    await lightning.start(origin.url(), origin.sha256, {
      connections: 2,
      extras: {
        auth: { user: 'me', pass: 'secret' },
        referer: 'https://page.test/',
        cookie: 'sid=1',
        headers: { 'X-Token': 'abc' }
      }
    })
    await lightning.waitForStatus('completed')
    expect(origin.log.length).toBeGreaterThan(1)
    expect(origin.log.every((entry) => entry.status !== 401)).toBe(true)
  })

  test('without them the probe is refused', async ({ lightning, serve }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(gate)
    await expect(lightning.api.probeUrl(origin.url())).rejects.toThrow(/401/)
  })

  test('user:password in the link becomes a Basic header, not part of the stored link', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(({ headers }) => (headers.authorization === BASIC ? 'ok' : { status: 401 }))
    const withCredentials = origin.url().replace('http://', 'http://me:secret@')
    await lightning.start(withCredentials, origin.sha256, { connections: 2 })
    const state = await lightning.waitForStatus('completed')
    expect(state.url).not.toContain('secret')
  })

  test('sign-in details are not sent on to another host after a redirect', async ({
    lightning,
    serve
  }) => {
    const target = await serve({ size: SIZE })
    const seen: string[] = []
    target.setRule(({ headers }) => {
      seen.push(`${headers.authorization ?? ''}|${headers.cookie ?? ''}`)
      return 'ok'
    })
    const front = await serve({ size: SIZE })
    // localhost vs 127.0.0.1 are different hosts to the redirect rule.
    front.setRule(() => ({ redirect: target.url().replace('127.0.0.1', 'localhost') }))
    await lightning.api.probeUrl(front.url(), {
      auth: { user: 'me', pass: 'secret' },
      cookie: 'sid=1'
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((entry) => entry === '|')).toBe(true)
  })
})
