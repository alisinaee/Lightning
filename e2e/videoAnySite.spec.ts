import { execFileSync } from 'node:child_process'
import { createServer, request, type Server } from 'node:http'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { expect, test as base } from '@playwright/test'
import { expect as appExpect, test } from './fixtures'

const EXTENSION = 'chrome-extension://abcdefghijklmnop'

// The detector is plain JavaScript shared by the extension's background script and its tests.
const media = createRequire(__filename)('../extension/media.js') as {
  classify: (info: Record<string, unknown>) => Record<string, unknown> | null
  addEntry: (list: unknown[], entry: Record<string, unknown>, cap?: number) => unknown[]
  sortEntries: (list: Record<string, unknown>[]) => Record<string, unknown>[]
  isStreamLink: (link: string) => boolean
}

base.describe('video finder detector (extension/media.js)', () => {
  const info = (url: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    url,
    tabId: 7,
    statusCode: 200,
    ...extra
  })

  base('finds streams and files, ignores segments and small files', () => {
    expect(media.classify(info('https://cdn.test/a/index.m3u8'))).toMatchObject({
      format: 'HLS',
      stream: true
    })
    expect(
      media.classify(info('https://cdn.test/a/x', { contentType: 'application/dash+xml' }))
    ).toMatchObject({ format: 'DASH' })
    expect(
      media.classify(info('https://cdn.test/v.mp4', { contentLength: '5000000' }))
    ).toMatchObject({
      format: 'MP4',
      size: 5000000
    })
    expect(
      media.classify(info('https://cdn.test/v.mp4', { contentRange: 'bytes 0-99/4000000' }))
    ).toMatchObject({
      size: 4000000
    })
    // Segments and small files are not videos to offer.
    expect(
      media.classify(info('https://cdn.test/seg1.ts', { contentType: 'video/mp2t' }))
    ).toBeNull()
    expect(media.classify(info('https://cdn.test/part.m4s'))).toBeNull()
    expect(media.classify(info('https://cdn.test/icon.mp4', { contentLength: '1000' }))).toBeNull()
    // Audio only counts when it is big (over 1 MB) and its size is known.
    expect(media.classify(info('https://cdn.test/a.bin', { contentType: 'audio/mpeg' }))).toBeNull()
    expect(
      media.classify(
        info('https://cdn.test/a.bin', { contentType: 'audio/mpeg', contentLength: '3000000' })
      )
    ).toMatchObject({ format: 'AUDIO' })
    // Not on the list: YouTube, no tab, other schemes, failed responses.
    expect(media.classify(info('https://rr1.googlevideo.com/videoplayback.mp4'))).toBeNull()
    expect(media.classify(info('https://www.youtube.com/x.m3u8'))).toBeNull()
    expect(media.classify({ ...info('https://cdn.test/v.mp4'), tabId: -1 })).toBeNull()
    expect(media.classify(info('ftp://cdn.test/v.mp4'))).toBeNull()
    expect(media.classify(info('https://cdn.test/v.mp4', { statusCode: 404 }))).toBeNull()
  })

  base('keeps one entry per address without its query, master playlists first, cap 30', () => {
    const first = media.classify(info('https://cdn.test/a/index.m3u8?token=1'))!
    const again = media.classify(info('https://cdn.test/a/index.m3u8?token=2'))!
    let list = media.addEntry([], first)
    list = media.addEntry(list, again)
    expect(list).toHaveLength(1)
    const file = media.classify(info('https://cdn.test/b.mp4', { contentLength: '5000000' }))!
    const master = media.classify(info('https://cdn.test/master.m3u8'))!
    const sorted = media.sortEntries([file, first, master])
    expect(sorted[0]).toMatchObject({ name: 'master.m3u8' })
    expect(sorted[2]).toMatchObject({ format: 'MP4' })
    let many: unknown[] = []
    for (let index = 0; index < 40; index += 1) {
      many = media.addEntry(many, media.classify(info(`https://cdn.test/f${index}.mp4`))!)
    }
    expect(many).toHaveLength(30)
  })

  base('recognises stream links for the video dialog', () => {
    expect(media.isStreamLink('https://cdn.test/a.m3u8?x=1')).toBe(true)
    expect(media.isStreamLink('https://cdn.test/a.mpd')).toBe(true)
    expect(media.isStreamLink('https://cdn.test/a.mp4')).toBe(false)
  })
})

/** One request to the app's extension server (as localApi.spec does). */
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

/** An HLS stream made with the bundled ffmpeg, and a page that plays it, on a local server. */
async function startSite(): Promise<{ server: Server; base: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'lightning-hls-'))
  execFileSync(
    ffmpegPath as unknown as string,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=3:size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=3',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(dir, 'seg%d.ts'),
      join(dir, 'index.m3u8')
    ],
    { stdio: 'ignore' }
  )
  const page =
    '<!doctype html><title>Clip page</title><video controls>' +
    '<source src="/hls/index.m3u8" type="application/vnd.apple.mpegurl"></video>'
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (path === '/watch.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page)
      return
    }
    const name = path.replace(/^\/hls\//, '')
    if (path.startsWith('/hls/') && (await readdir(dir)).includes(name)) {
      const type = name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
      res.writeHead(200, { 'Content-Type': type }).end(await readFile(join(dir, name)))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}` }
}

test.describe('video from any site', () => {
  test('a page sent to /v1/video waits in the queue and downloads an mp4', async ({
    lightning
  }) => {
    test.setTimeout(240_000)
    const site = await startSite()
    try {
      await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
      const folder = await mkdtemp(join(tmpdir(), 'lightning-video-'))
      await lightning.page.evaluate(
        (dir) => window.lightning.youtubeSetOptions({ folder: dir }),
        folder
      )
      const { port, key } = await lightning.api.getIntegration()
      const headers = { Origin: EXTENSION, Authorization: `Bearer ${key}` }

      const sent = await call(port!, 'POST', '/v1/video', headers, {
        url: `${site.base}/watch.html`,
        title: 'Clip page',
        pageUrl: `${site.base}/watch.html`,
        referer: `${site.base}/watch.html`,
        cookieMode: 'none'
      })
      expect(sent.status).toBe(200)

      const choose = lightning.page.getByRole('button', { name: 'Choose quality' })
      await appExpect(choose).toBeVisible({ timeout: 60_000 })
      await choose.click()
      const dialog = lightning.page.getByRole('dialog', { name: 'Add video' })
      await appExpect(dialog).toBeVisible()
      const download = dialog.getByRole('button', { name: /^Download/ })
      await appExpect(download).toBeEnabled({ timeout: 60_000 })
      await download.click()

      await expect
        .poll(
          async () => {
            const jobs = (await lightning.page.evaluate(() =>
              window.lightning.youtubeListJobs()
            )) as { status: string; fileName?: string }[]
            const failed = jobs.find((job) => job.status === 'error' || job.status === 'failed')
            if (failed) return JSON.stringify(failed)
            return jobs.find((job) => job.status === 'completed')?.fileName ?? ''
          },
          { timeout: 90_000 }
        )
        .toMatch(/\.mp4$/)
    } finally {
      await new Promise<void>((resolve) => site.server.close(() => resolve()))
    }
  })

  test('a .m3u8 link from the browser goes to the video queue, not the file downloader', async ({
    lightning
  }) => {
    const site = await startSite()
    try {
      await expect.poll(async () => (await lightning.api.getIntegration()).port).not.toBeNull()
      const { port, key } = await lightning.api.getIntegration()
      const headers = { Origin: EXTENSION, Authorization: `Bearer ${key}` }

      const sent = await call(port!, 'POST', '/v1/add', headers, {
        url: `${site.base}/hls/index.m3u8`
      })
      expect(sent.status).toBe(200)
      expect(sent.json.route).toBe('youtube')
      await appExpect(lightning.page.getByRole('button', { name: 'Choose quality' })).toBeVisible({
        timeout: 60_000
      })
      await appExpect(
        lightning.page.getByRole('textbox', { name: 'Link', exact: true })
      ).toHaveCount(0)
    } finally {
      await new Promise<void>((resolve) => site.server.close(() => resolve()))
    }
  })

  test('two streams with the same name are two files', async ({ lightning }) => {
    test.setTimeout(120_000)
    const site = await startSite()
    try {
      const folder = await mkdtemp(join(tmpdir(), 'lightning-video-'))
      await lightning.page.evaluate(
        async ({ base, dir }) => {
          await window.lightning.youtubeSetOptions({ folder: dir })
          for (const n of [1, 2]) {
            await window.lightning.youtubeStart({
              url: `${base}/hls/index.m3u8?video=${n}`,
              title: 'index',
              formatId: 'bestvideo+bestaudio/best',
              resolution: 'Best'
            })
          }
        },
        { base: site.base, dir: folder }
      )
      await expect
        .poll(
          async () => {
            const jobs = await lightning.page.evaluate(() => window.lightning.youtubeListJobs())
            return jobs.map((job) => `${job.status} ${job.fileName?.split('/').pop()}`).sort()
          },
          { timeout: 90_000 }
        )
        .toEqual(['completed index (2).mp4', 'completed index.mp4'])
      expect((await readdir(folder)).sort()).toEqual(['index (2).mp4', 'index.mp4'])
    } finally {
      await new Promise<void>((resolve) => site.server.close(() => resolve()))
    }
  })
})
