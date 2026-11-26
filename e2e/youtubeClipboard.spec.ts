import { expect, test } from './fixtures'

test('adding a video with its link copied goes straight to the confirmation', async ({
  lightning
}) => {
  const page = lightning.page
  const copied = async (text: string): Promise<void> =>
    lightning.evaluateMain((electron, value) => {
      // Stubbed rather than written, so the run leaves the real clipboard alone.
      electron.clipboard.readText = (() => value) as never
    }, text)
  await lightning.evaluateMain(({ ipcMain }) => {
    ipcMain.removeHandler('youtube:probe')
    ipcMain.handle('youtube:probe', (_event, url: string) => ({
      id: 'dQw4w9WgXcQ',
      url,
      title: 'Copied video',
      channel: 'Channel',
      duration: 10,
      thumbnail: '',
      formats: [{ formatId: 'best', resolution: '1080p', ext: 'mp4' }]
    }))
  }, null)
  await lightning.evaluateMain(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('app:command', 'open-youtube')
    )
  }, null)

  await copied('Look: https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'New download' }).click()
  const dialog = page.getByRole('dialog', { name: /^Add (YouTube )?video/ })
  await expect(dialog.getByText('Copied video')).toBeVisible()
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^Download/ })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Use another link' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Video link' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Nothing to scan: the link field.
  await copied('just words')
  await page.getByRole('button', { name: 'New download' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Video link' })).toBeVisible()
})

test('Download does not wait for the fetch', async ({ lightning }) => {
  const page = lightning.page
  await lightning.evaluateMain((electron) => {
    electron.clipboard.readText = (() => 'https://youtu.be/dQw4w9WgXcQ') as never
    const { ipcMain, BrowserWindow } = electron
    ipcMain.removeHandler('youtube:probe')
    ipcMain.handle(
      'youtube:probe',
      (_event, url: string) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                id: 'dQw4w9WgXcQ',
                url,
                title: 'Slow video',
                formats: ['1080', '720'].map((height) => ({
                  formatId: `f${height}`,
                  resolution: `${height}p`,
                  qualityLabel: `${height}p`,
                  ext: 'mp4',
                  hasVideo: true,
                  hasAudio: true
                }))
              }),
            4000
          )
        )
    )
    ipcMain.removeHandler('youtube:start')
    ipcMain.handle('youtube:start', (_event, request: Record<string, unknown>) => ({
      id: 'job-1',
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      ...request,
      title: `${request.title} ${request.formatId}`
    }))
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send('app:command', 'open-youtube')
    )
  }, null)
  await page.getByRole('button', { name: 'New download' }).click()
  const dialog = page.getByRole('dialog', { name: /^Add (YouTube )?video/ })
  await dialog.getByRole('radio', { name: /720p/ }).click()
  await dialog.getByRole('button', { name: /^Download/ }).click()
  await expect(dialog).toBeHidden({ timeout: 2000 })
  await expect(page.getByText(/^Fetching/)).toBeVisible()
  // It starts by itself, at the chosen quality.
  await expect(page.getByText('Slow video f720').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/^Fetching/)).toBeHidden()
})
