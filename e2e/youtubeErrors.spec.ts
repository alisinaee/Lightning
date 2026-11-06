import { expect, test } from '@playwright/test'
import { explainYoutubeError } from '../src/renderer/src/components/youtube/youtubeErrors'

test('a timeout from the probe is explained in one plain sentence, with the raw text kept', () => {
  const raw = "Error invoking remote method 'youtube:probe': Error: yt-dlp timed out after 90000ms"
  const { summary, detail } = explainYoutubeError(raw)
  expect(summary).toBe(
    "YouTube didn't answer in time. Check your internet connection or VPN, then try again."
  )
  expect(detail).toBe(raw)
})

test('known yt-dlp failures get their own sentence; unknown ones say where to look', () => {
  expect(explainYoutubeError('ERROR: HTTP Error 429: Too Many Requests').summary).toMatch(
    /limiting requests/
  )
  expect(explainYoutubeError('ERROR: Private video. Sign in if you have access').summary).toMatch(
    /private/
  )
  expect(explainYoutubeError('ERROR: something nobody planned for').summary).toBe(
    "Couldn't read this video. Open Details for the reason."
  )
  expect(explainYoutubeError('').summary).toBe("Couldn't read this video. Try again.")
})
