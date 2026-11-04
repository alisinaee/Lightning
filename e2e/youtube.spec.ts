import { expect, test } from '@playwright/test'
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
