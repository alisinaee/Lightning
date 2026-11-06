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

    await expect(page.getByRole('heading', { name: 'YouTube' })).toBeVisible()
    await expect(page.getByText(/yt-dlp 2026\.10\.26/)).toBeVisible()

    // Adding a video opens the dialog with the link box.
    await page.getByRole('button', { name: 'Add video' }).first().click()
    const link = page.getByRole('textbox', { name: 'Video link' })
    await expect(link).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(link).toBeHidden()
  })
})
