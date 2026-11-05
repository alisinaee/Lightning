import { expect, test } from './fixtures'
import { extractYoutubeId, isYoutubeUrl } from '../src/shared/youtube'

test.describe('YouTube helpers', () => {
  test('validates standard, shorts and share YouTube links', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toBe(true)
  })

  test('extracts 11-char video ID', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  test('rejects non-YouTube or invalid URLs', () => {
    expect(isYoutubeUrl('https://example.com/video.mp4')).toBe(false)
    expect(isYoutubeUrl('https://vimeo.com/123456')).toBe(false)
    expect(isYoutubeUrl('')).toBe(false)
    expect(isYoutubeUrl('not a url')).toBe(false)
  })
})

test.describe('YouTube screen UI & yt-dlp', () => {
  test('navigates to YouTube screen and detects yt-dlp status', async ({ lightning }) => {
    const page = lightning.page

    const status = await page.evaluate(async () => {
      return await window.lightning.youtubeStatus()
    })
    expect(status.binary).toBe(true)
    expect(status.version).toBe('2026.10.26')
    expect(status.ffmpeg).toBe(true)

    const youtubeBtn = page.getByRole('button', { name: 'YouTube' })
    await expect(youtubeBtn).toBeVisible()
    await youtubeBtn.click()

    await expect(page.getByText('YouTube Downloader')).toBeVisible()
    await expect(page.getByText(/yt-dlp 2026\.10\.26/)).toBeVisible()
    await expect(page.getByText('ffmpeg active')).toBeVisible()
    await expect(page.getByPlaceholder(/Paste YouTube video or shorts link/)).toBeVisible()

    await page.screenshot({
      path: '/Users/ali/.gemini/antigravity/brain/e797b6ad-d8dd-40b7-8ef9-833104ae11a2/scratch/youtube_screen.png'
    })

    // Test back button
    await page.getByRole('button', { name: 'Back to downloads' }).click()
    await expect(page.getByText('No downloads yet')).toBeVisible()
  })
})
