import { request } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './fixtures'

// A YouTube download that stops for want of a sign-in asks the browser extension for fresh
// cookies (the extension checks /v1/requests every half minute) and starts again when they come.

const EXTENSION = 'chrome-extension://abcdefghijklmnop'
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function call(
  port: number,
  method: string,
  path: string,
  key: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          Origin: EXTENSION,
          Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        }
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

/** A stand-in yt-dlp: it succeeds only with a cookies file holding FRESH, and otherwise fails the way
 * YouTube's bot check does. The app prefers a yt-dlp in its data folder over the bundled one. */
const FAKE_YT_DLP = `#!/bin/sh
for a in "$@"; do [ "$a" = "--version" ] && { echo 2026.11.23; exit 0; }; done
prev=""
for a in "$@"; do
  if [ "$prev" = "--cookies" ] && grep -q FRESH "$a" 2>/dev/null; then echo done; exit 0; fi
  prev="$a"
done
echo "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies" >&2
exit 1
`

const cookie = (domain: string, value: string): Record<string, unknown> => ({
  domain,
  path: '/',
  secure: true,
  httpOnly: true,
  expirationDate: 2_000_000_000,
  name: 'SID',
  value
})

test.describe('fresh YouTube sign-in from the browser extension', () => {
  test('a download stuck on a sign-in gets the browser’s cookies and starts again', async ({
    lightning
  }) => {
    await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
    const { port, key } = await lightning.api.getIntegration()
    const dataDir = await lightning.evaluateMain(({ app }) => app.getPath('userData'), null)
    await mkdir(join(dataDir, 'youtube', 'bin'), { recursive: true })
    const fake = join(dataDir, 'youtube', 'bin', 'yt-dlp')
    await writeFile(fake, FAKE_YT_DLP)
    await chmod(fake, 0o755)
    const folder = await mkdtemp(join(tmpdir(), 'lightning-signin-'))

    // The extension has checked in, with nothing asked of it yet.
    expect((await call(port!, 'GET', '/v1/requests', key)).json).toEqual({ youtubeCookies: false })

    await lightning.page.evaluate(
      async ({ url, dir }) => {
        await window.lightning.youtubeSetOptions({ folder: dir })
        await window.lightning.youtubeStart({
          url,
          title: 'A video',
          formatId: 'best',
          resolution: 'Best'
        })
      },
      { url: VIDEO, dir: folder }
    )
    // It fails on the sign-in, and Lightning asks the browser.
    await expect
      .poll(async () => (await call(port!, 'GET', '/v1/requests', key)).json.youtubeCookies)
      .toBe(true)
    const [stuck] = await lightning.page.evaluate(() => window.lightning.youtubeListJobs())
    expect(stuck.status).toBe('error')
    expect(stuck.askingBrowserUntil).toBeGreaterThan(Date.now())

    // While it waits, the YouTube screen says so instead of showing the sign-in choices.
    await lightning.page.getByRole('tab', { name: /^YouTube/ }).click()
    await expect(
      lightning.page.getByText('Asking your browser for a fresh YouTube sign-in…')
    ).toBeVisible()

    // The extension answers; a cookie of another site is not kept.
    const answer = await call(port!, 'POST', '/v1/cookies', key, {
      mode: 'save',
      cookies: [cookie('.youtube.com', 'FRESH'), cookie('.example.com', 'OTHER')]
    })
    expect(answer.json).toMatchObject({ ok: true, retried: 1 })
    await expect
      .poll(
        async () =>
          (await lightning.page.evaluate(() => window.lightning.youtubeListJobs()))[0].status
      )
      .toBe('completed')
    const saved = await readFile(join(dataDir, 'youtube', 'cookies.txt'), 'utf-8')
    expect(saved).toContain('FRESH')
    expect(saved).not.toContain('example.com')
    expect((await call(port!, 'GET', '/v1/requests', key)).json).toEqual({ youtubeCookies: false })
  })

  test('a sign-in that does not help is asked for only once', async ({ lightning }) => {
    await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
    const { port, key } = await lightning.api.getIntegration()
    const dataDir = await lightning.evaluateMain(({ app }) => app.getPath('userData'), null)
    await mkdir(join(dataDir, 'youtube', 'bin'), { recursive: true })
    const fake = join(dataDir, 'youtube', 'bin', 'yt-dlp')
    await writeFile(fake, FAKE_YT_DLP)
    await chmod(fake, 0o755)
    const folder = await mkdtemp(join(tmpdir(), 'lightning-signin-'))
    await call(port!, 'GET', '/v1/requests', key)

    await lightning.page.evaluate(
      async ({ url, dir }) => {
        await window.lightning.youtubeSetOptions({ folder: dir })
        await window.lightning.youtubeStart({
          url,
          title: 'A video',
          formatId: 'best',
          resolution: 'Best'
        })
      },
      { url: VIDEO, dir: folder }
    )
    await expect
      .poll(async () => (await call(port!, 'GET', '/v1/requests', key)).json.youtubeCookies)
      .toBe(true)
    // A stale sign-in: the retry fails again, and the browser is not asked a second time.
    await call(port!, 'POST', '/v1/cookies', key, {
      mode: 'send',
      cookies: [cookie('.youtube.com', 'STALE')]
    })
    await expect
      .poll(async () => {
        const [job] = await lightning.page.evaluate(() => window.lightning.youtubeListJobs())
        return `${job.status} ${job.browserSignInTried}`
      })
      .toBe('error true')
    expect((await call(port!, 'GET', '/v1/requests', key)).json).toEqual({ youtubeCookies: false })
    // The usual sign-in choices show now.
    await lightning.page.getByRole('tab', { name: /^YouTube/ }).click()
    await expect(lightning.page.getByText('Let Lightning use your YouTube sign-in')).toBeVisible()
  })
})
