import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { BLOCK, expect, interfacesEnv, NETWORKS, test, treeSha } from './fixtures'
import { seededBytes, type Origin } from './origin'
import { named, Swarm, torrentFileOnDisk } from './torrentSwarm'

// G. A handful of journeys through the real UI, to prove the screens are wired to the main
// process. Download correctness is covered far more thoroughly by the API-level specs; these
// only need to show that clicking the buttons drives it.

const SIZE = 24 * BLOCK

/** The destination picker and "Reveal in Finder" go through native OS UI — replace both. */
async function stubNativeUi(
  lightning: import('./fixtures').LightningApp,
  destination: string
): Promise<void> {
  await lightning.evaluateMain(({ dialog, shell }, dest) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dest] })) as never
    const revealed: string[] = []
    ;(globalThis as Record<string, unknown>).__revealed = revealed
    shell.showItemInFolder = (path: string) => void revealed.push(path)
  }, destination)
}

test.describe('a torrent through the UI', () => {
  test('choose its files, watch its peers, finish', async ({ lightning, dirs }) => {
    const swarm = await new Swarm().start()
    try {
      const files = ['a.bin', 'b.bin', 'c.bin'].map((name, index) =>
        named(seededBytes(1024 * 1024, 81 + index), name)
      )
      // Two seeders, slow enough to look at the download while it runs.
      const options = { folder: 'Trio', pieceLength: 64 * 1024, uploadLimit: 200 * 1024 }
      await swarm.seed(files, options)
      const torrent = await swarm.seed(files, options)
      await stubNativeUi(lightning, dirs.dest)
      const page = lightning.page

      const link = await lightning.newDownload()
      await page.getByRole('button', { name: 'Change…' }).click()
      await link.fill(await torrentFileOnDisk(torrent))
      await page.getByRole('checkbox', { name: /b\.bin/ }).click()
      await lightning.expectNextDownload(
        treeSha(
          [files[0], files[2]].map((data) => ({ path: (data as { name?: string }).name!, data }))
        )
      )
      await page.getByRole('button', { name: 'Download', exact: true }).click()

      // Running: its connections are peers, and its blocks pieces.
      const peers = page.getByRole('button', { name: /^\d+ peers?/ }).first()
      await expect(peers).toBeVisible()
      await peers.click()
      // Numbered by connection, so whichever peers are connected now.
      const peerRow = page
        .getByRole('row')
        .filter({ hasText: /Peer #\d+/ })
        .first()
      await expect(peerRow).toBeVisible()
      // Only what isn't the usual gets a word: no badge for a peer that's sending.
      await expect(peerRow).not.toContainText(/RECEIVING|CONNECTED|ACTIVE/)
      await expect(peerRow).not.toContainText('Peer connection')
      // Its share of what its network's peers have sent.
      await expect(peerRow).toContainText(/\d+%/)
      // Read out in words, not only shown as an arrow; upload only once something was sent.
      await expect(peerRow).toContainText('Receiving at')
      await expect(peerRow).not.toContainText('Sending at')
      await expect(peerRow.getByRole('cell')).toHaveCount(6)
      // What it runs. A peer has no progress of its own: a dash, not a bar.
      await expect(peerRow).toContainText('WebTorrent')
      await expect(peerRow.getByRole('progressbar')).toHaveCount(0)
      // Each peer's number is its own across the download: no two rows share one, whichever
      // networks they're on.
      for (const button of await page.getByRole('button', { name: /^\d+ peers?/ }).all()) {
        if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
      }
      const numbers = (await page.getByText(/^Peer #\d+$/).allTextContents()).map((text) =>
        text.trim()
      )
      expect(numbers.length).toBeGreaterThan(0)
      expect(new Set(numbers).size).toBe(numbers.length)
      const networks = page.getByRole('table', { name: 'Networks' })
      await expect(networks.getByRole('columnheader', { name: 'Verified' })).toHaveCount(0)
      await expect(
        networks.getByRole('columnheader', { name: 'Progress', exact: true })
      ).toBeVisible()
      await expect(networks.getByRole('progressbar').first()).toBeVisible()
      await expect(
        page.getByRole('progressbar', { name: 'Download progress', exact: true })
      ).toHaveCount(0)
      await expect(peerRow).not.toContainText(/Piece #/)
      await expect(page.getByText(/^\d+ pieces · /)).toBeVisible()
      // Each network's upload, even before anything is sent; nothing at the top. A peer that has
      // sent nothing carries no upload line, and no arrows: a lone download figure needs none.
      await expect(page.getByText(/^UP \d/)).toHaveCount(0)
      await expect(networks.getByText(/Uploading at/).first()).toBeAttached()
      await expect(peerRow).not.toContainText('↑')
      await expect(peerRow).not.toContainText('↓')

      // Done: two of its three files, with what fetched them.
      await expect(page.getByRole('button', { name: /Show in (Finder|folder)/ })).toBeVisible({
        timeout: 60_000
      })
      await expect(page.getByText(/^2 of 3 files · /)).toBeVisible()
      await expect(page.getByText('Peers', { exact: true })).toBeVisible()
      await expect(page.getByText(/^written in \d+ pieces · uploaded /)).toBeVisible()
    } finally {
      await swarm.stop()
    }
  })
})

test.describe('UI journeys @smoke', () => {
  test('paste a link, start, pause, resume, finish, reveal the file', async ({
    lightning,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(lightning, dirs.dest)
    const page = lightning.page

    const link = await lightning.newDownload()
    await page.getByRole('button', { name: 'Change…' }).click()
    await link.fill(origin.url())
    const start = page.getByRole('button', { name: 'Download', exact: true })
    await expect(start).toBeEnabled()
    await page.getByRole('group', { name: 'Streams' }).getByRole('button', { name: '8' }).click()

    const reached = origin.hold(6 * BLOCK)
    await lightning.expectNextDownload(origin.sha256)
    await start.click()
    await reached
    // The streams picked in the dialog reach the download.
    const { id } = (await lightning.current())!
    const manifestPath = join(dirs.userData, 'downloads', id, 'manifest.json')
    await expect
      .poll(async () => JSON.parse(await readFile(manifestPath, 'utf-8')).requestPayload)
      .toMatchObject({ streamsPerNetwork: 8 })
    // Started: its own screen opens.
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Progress', exact: true })).toBeVisible()
    // An HTTP download's connections are streams, and its blocks chunks.
    await expect(page.getByRole('button', { name: /^\d+ streams?/ }).first()).toBeVisible()
    await expect(page.getByText(/^\d+ chunks · /)).toBeVisible()
    origin.release()
    await page.getByRole('button', { name: 'Resume' }).click()

    const reveal = page.getByRole('button', { name: /Show in (Finder|folder)/ })
    await expect(reveal).toBeVisible()
    await expect(page.getByText('Streams', { exact: true })).toBeVisible()
    await expect(page.getByText(/^written in \d+ chunks/)).toBeVisible()
    await reveal.click()
    const { destinationPath } = (await lightning.current())!
    await expect
      .poll(() =>
        lightning.evaluateMain(() => (globalThis as Record<string, unknown>).__revealed, null)
      )
      .toEqual([destinationPath])
  })

  test('delete through the confirmation dialog, then download it again', async ({
    lightning,
    serve,
    dirs
  }) => {
    const origin = await serve({ size: SIZE })
    await stubNativeUi(lightning, dirs.dest)
    const page = lightning.page
    let link = await lightning.newDownload()
    await page.getByRole('button', { name: 'Change…' }).click()
    await link.fill(origin.url())

    const reached = origin.hold(6 * BLOCK)
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await reached
    await page.getByRole('button', { name: 'Cancel download…' }).click()
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click()
    origin.release()
    // Gone, with what it had downloaded.
    await expect(page.getByText('No downloads yet')).toBeVisible()

    link = await lightning.newDownload()
    await link.fill(origin.url())
    await lightning.expectNextDownload(origin.sha256)
    await page.getByRole('button', { name: 'Download', exact: true }).click({ timeout: 5000 })
    await lightning.waitForStatus('completed')
  })

  test('a link the server rejects shows the error and keeps Download disabled', async ({
    lightning,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    origin.setRule(() => ({ status: 404 }))
    const page = lightning.page
    await (await lightning.newDownload()).fill(origin.url())
    await expect(page.getByText(/couldn’t be found/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeDisabled()
  })

  test('a completed download is shown again after a restart', async ({ lightning, serve }) => {
    const origin = await serve({ size: SIZE })
    await lightning.start(origin.url(), origin.sha256)
    const { fileName } = await lightning.waitForStatus('completed')
    await lightning.relaunch()
    // Listed under Finished; opened, it shows as it did when it finished.
    await lightning.page.getByRole('button', { name: `Open ${fileName}` }).click()
    await expect(
      lightning.page.getByRole('button', { name: /Show in (Finder|folder)/ })
    ).toBeVisible()
  })
})

// What a user sets is still set after they reload or restart — checked only through what they see.
test.describe('settings @smoke', () => {
  test.describe('with an update available', () => {
    test.use({ appEnv: { LIGHTNING_FORCE_UPDATE_VERSION: '9.9.9' } })

    test('every choice survives a reload and a restart, even made right before', async ({
      lightning,
      dirs
    }) => {
      const page = (): Page => lightning.page
      await page().getByRole('button', { name: 'Not now' }).click()

      const themeToggle = page().getByRole('button', { name: /^Switch to (dark|light) theme$/ })
      // After switching, the toggle offers to switch back.
      const labelAfterSwitch = (await themeToggle.getAttribute('aria-label'))!.includes('dark')
        ? 'Switch to light theme'
        : 'Switch to dark theme'
      await themeToggle.click()

      await stubNativeUi(lightning, dirs.dest)
      await lightning.newDownload()
      await page().getByRole('button', { name: 'Change…' }).click()
      await page().keyboard.press('Escape')
      // A function: the window, and so the page, is a new one after a relaunch.
      const networksMenu = (): Locator =>
        page()
          .getByRole('button', { name: /network/ })
          .first()
          .first()
      await networksMenu().click()
      await page().getByRole('button', { name: 'Edit network' }).first().click()
      await page().getByRole('textbox', { name: 'Name' }).fill('Office fibre')
      await page().getByRole('button', { name: 'Violet' }).click()
      await page().getByRole('button', { name: 'Done' }).click()
      await page().keyboard.press('Escape')

      const expectAllKept = async (): Promise<void> => {
        // Waiting on the status bar's indicator first means the update check has answered, so
        // the dialog's absence below is a real "stayed dismissed", not "not checked yet".
        await expect(page().getByRole('link', { name: 'Update available: 9.9.9' })).toBeVisible()
        await expect(page().getByRole('alertdialog')).toBeHidden()
        await expect(page().getByRole('button', { name: labelAfterSwitch })).toBeVisible()
        await lightning.newDownload()
        await expect(page().getByText(dirs.dest)).toBeVisible()
        await page().keyboard.press('Escape')
        await networksMenu().click()
        await expect(page().getByText('Office fibre')).toBeVisible()
        await page().getByRole('button', { name: 'Edit network' }).first().click()
        await expect(page().getByRole('button', { name: 'Violet' })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
        await page().keyboard.press('Escape')
        await page().keyboard.press('Escape')
      }

      // No waiting for saves: a user doesn't either.
      await page().reload()
      await expectAllKept()
      await lightning.relaunch()
      await expectAllKept()
    })
  })

  test('a broken settings file falls back to what a fresh install shows', async ({
    lightning,
    dirs
  }) => {
    const settingsPath = join(dirs.userData, 'app-settings.json')
    // New download's "Save to" row, as the user sees it — compared whole, so no platform's idea
    // of the default folder is baked into the test.
    const choices = async (): Promise<string> => {
      await lightning.newDownload()
      const row = await lightning.page
        .getByText('Save to', { exact: true })
        .locator('..')
        .innerText()
      await lightning.page.keyboard.press('Escape')
      return row
    }
    const fresh = await choices()

    await lightning.quit()
    await writeFile(settingsPath, '{"destinationDir": "/')
    await lightning.launch()
    expect(await choices()).toEqual(fresh)

    await lightning.quit()
    await writeFile(settingsPath, JSON.stringify({ destinationDir: join(dirs.dest, 'unplugged') }))
    await lightning.launch()
    expect(await choices()).toEqual(fresh)
  })
})

test.describe('no networks', () => {
  test.use({ appEnv: { LIGHTNING_E2E_INTERFACES: '' } })

  test('a network appearing makes the list ready for downloads @smoke', async ({ lightning }) => {
    await expect(lightning.page.getByText('No networks connected')).toBeVisible()
    await lightning.evaluateMain(
      (_electron, value) => {
        process.env['LIGHTNING_E2E_INTERFACES'] = value
      },
      interfacesEnv({ a: NETWORKS['a'] })
    )
    await lightning.page.getByRole('button', { name: 'Scan again' }).click()
    await expect(lightning.page.getByText('No downloads yet')).toBeVisible()
  })
})

test('new download and limits dialogs stay open after outside clicks and close with their buttons', async ({
  lightning
}) => {
  const page = lightning.page
  await lightning.newDownload()
  const newDownload = page.getByRole('dialog', { name: 'New download', exact: true })
  await expect(newDownload.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(newDownload).toBeVisible()
  await newDownload.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(newDownload).toBeHidden()

  await page.getByRole('button', { name: /^\d+ of \d+ networks? on$/ }).click()
  await page.getByRole('button', { name: 'Speed & data limits…', exact: true }).click()
  const limits = page.getByRole('dialog', { name: 'Speed & data limits', exact: true })
  await expect(limits.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } })
  await expect(limits).toBeVisible()
  // Cancel leaves everything as it was.
  await limits.getByRole('switch').click()
  await expect(limits.getByRole('switch')).toBeChecked()
  await limits.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(limits).toBeHidden()
  await expect(page.getByRole('switch', { name: 'Slow mode' })).not.toBeChecked()
})

test('a link just started is not offered again from the clipboard', async ({
  lightning,
  serve,
  dirs
}) => {
  const origin = await serve({ size: BLOCK })
  await stubNativeUi(lightning, dirs.dest)
  const page = lightning.page
  // Stubbed rather than written, so the run leaves the real clipboard alone.
  await lightning.evaluateMain((electron, text) => {
    electron.clipboard.readText = (() => text) as never
  }, origin.url())
  const link = await lightning.newDownload()
  await expect(link).toHaveValue(origin.url())
  await page.getByRole('button', { name: 'Change…' }).click()
  await lightning.expectNextDownload(origin.sha256)
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(link).toBeHidden()

  // Started: its own screen is open, so back to the list for the next one.
  await page.getByRole('button', { name: 'Downloads', exact: true }).click()
  await lightning.newDownload()
  // Answered after the dialog's own read, so that one has been applied (or skipped) by now.
  await page.evaluate(() => window.lightning.readClipboardText())
  await expect(link).toHaveValue('')
  await lightning.waitForStatus('completed')
})

test('compact limits controls convert units without changing the limit and show monthly resets', async ({
  lightning,
  dirs
}) => {
  const page = lightning.page
  // Nothing saved yet means no file yet.
  const settings = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(dirs.userData, 'app-settings.json'), 'utf8').catch(() => '{}'))
  await page.getByRole('button', { name: /^\d+ of \d+ networks? on$/ }).click()
  await page.getByRole('button', { name: 'Speed & data limits…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Speed & data limits', exact: true })
  const total = dialog.getByRole('radiogroup', { name: 'Total speed', exact: true })
  await expect(total.getByRole('textbox')).toBeDisabled()
  await expect(total.getByRole('button', { name: 'KB/s', exact: true })).toBeDisabled()
  await total.getByRole('radio', { name: 'Limit to', exact: true }).check()
  await total.getByRole('button', { name: 'KB/s', exact: true }).click()
  await total.getByRole('textbox').fill('512')
  await total.getByRole('button', { name: 'MB/s', exact: true }).click()
  await expect(total.getByRole('textbox')).toHaveValue('0.5')
  await total.getByRole('radio', { name: 'No limit', exact: true }).check()
  await expect(total.getByRole('textbox')).toBeDisabled()
  await total.getByRole('radio', { name: 'Limit to', exact: true }).check()
  await expect(total.getByRole('textbox')).toHaveValue('512')
  expect((await settings()).speedLimit, 'nothing is saved before Save').toBeUndefined()
  await page.screenshot({ path: '/tmp/lightning-limits-general.png' })

  await dialog.locator('nav button').nth(1).click()
  const data = dialog.getByRole('radiogroup', { name: /data limit$/, exact: false })
  await expect(data.getByRole('textbox')).toBeDisabled()
  await data.getByRole('radio', { name: 'Limit to', exact: true }).check()
  await data.getByRole('textbox').fill('10')
  const reset = await page.evaluate(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long'
    })
  })
  await expect(dialog.getByText(`Resets on ${reset}.`, { exact: false })).toBeVisible()
  await expect(dialog.getByText('10.0 GB this month', { exact: false })).toBeVisible()
  await data.getByRole('button', { name: 'Day', exact: true }).click()
  await expect(dialog.getByText('Resets tomorrow at midnight.', { exact: false })).toBeVisible()
  await expect(dialog.getByText('10.0 GB today', { exact: false })).toBeVisible()
  await data.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(dialog.getByText('Weeks start Monday.', { exact: false })).toBeVisible()
  await expect(dialog.getByText('10.0 GB this week', { exact: false })).toBeVisible()
  await page.screenshot({ path: '/tmp/lightning-limits-network.png' })
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await settings()).speedLimit).toBe(512 * 1024)
  await expect
    .poll(async () => {
      const saved = (await settings()).networkPreferences as Record<
        string,
        { dataLimitPeriod?: string }
      >
      return Object.values(saved).some((entry) => entry.dataLimitPeriod === 'week')
    })
    .toBe(true)
})

test('network reset controls confirm scope, keep limits when resetting usage, and keep usage when removing limits', async ({
  lightning,
  serve
}) => {
  const origin = await serve({ size: BLOCK })
  await lightning.start(origin.url(), origin.sha256)
  await lightning.waitForStatus('completed')
  const usage = await lightning.api.networkUsage()
  const id = Object.keys(usage).find((key) => usage[key] > 0)!
  await lightning.api.updateSettings({
    networkPreferences: {
      [id]: { speedLimit: 1024 ** 2, dataLimit: 1024 ** 3, dataLimitPeriod: 'week' }
    }
  })
  await lightning.page.reload()
  const page = lightning.page
  await page.getByRole('button', { name: /^\d+ of \d+ networks? on$/ }).click()
  const iface = (await lightning.api.listInterfaces()).findIndex((entry) => entry.id === id)
  // A network's row in the menu opens the dialog on that network.
  await page
    .getByRole('button', { name: / limits$/ })
    .nth(iface)
    .click()
  const dialog = page.getByRole('dialog', { name: 'Speed & data limits' })
  await expect(dialog.locator('nav button').nth(iface + 1)).toHaveAttribute('aria-current', 'page')
  await dialog.getByRole('button', { name: 'Remove limits…', exact: true }).click()
  let confirmation = page.getByRole('alertdialog')
  await expect(confirmation.getByText(/recorded data usage stays unchanged/)).toBeVisible()
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Remove limits…', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Reset data usage…', exact: true }).click()
  confirmation = page.getByRole('alertdialog')
  await expect(confirmation.getByText(/usage this week to zero/)).toBeVisible()
  await confirmation.getByRole('button', { name: 'Reset data usage', exact: true }).click()
  await expect(confirmation).toBeHidden()
  await expect(
    dialog.getByRole('button', { name: 'Reset data usage…', exact: true })
  ).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Remove limits…', exact: true })).toBeEnabled()
  expect((await lightning.api.networkUsage())[id]).toBe(0)
  await dialog.getByRole('button', { name: 'Remove limits…', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove limits', exact: true })
    .click()
  await expect(dialog.getByRole('button', { name: 'Remove limits…', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await lightning.relaunch()
  expect((await lightning.api.networkUsage())[id]).toBe(0)
})

test('all downloads reset to defaults on Save, leaving each network’s limits', async ({
  lightning,
  dirs
}) => {
  const [{ id }] = await lightning.api.listInterfaces()
  await lightning.api.updateSettings({
    speedLimit: 1024 ** 2,
    slowMode: true,
    slowModeSpeed: 512 * 1024,
    downloadsAtOnce: 5,
    networkPreferences: { [id]: { speedLimit: 1024 ** 2 } }
  })
  await lightning.page.reload()
  const page = lightning.page
  await page.getByRole('button', { name: /^\d+ of \d+ networks? on$/ }).click()
  await page.getByRole('button', { name: 'Speed & data limits…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Speed & data limits', exact: true })
  const resetButton = dialog.getByRole('button', { name: 'Reset to defaults…', exact: true })
  await resetButton.click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation.getByText(/Network limits stay unchanged/)).toBeVisible()
  await confirmation.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
  await expect(resetButton).toBeDisabled()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  const settings = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(dirs.userData, 'app-settings.json'), 'utf8'))
  await expect.poll(settings).toMatchObject({ slowModeSpeed: 2 * 1024 ** 2, downloadsAtOnce: 2 })
  const saved = await settings()
  // Off and no limit are what a missing entry means.
  expect(saved.speedLimit).toBeUndefined()
  expect(saved.slowMode).toBeUndefined()
  expect(saved.networkPreferences).toMatchObject({ [id]: { speedLimit: 1024 ** 2 } })
})

test.describe('Check for updates in Settings @smoke', () => {
  test.use({ appEnv: { LIGHTNING_FORCE_UPDATE_VERSION: '9.9.9' } })

  test('says a newer version is available, with a link to it', async ({ lightning }) => {
    const page = lightning.page
    await page.getByRole('button', { name: 'Not now' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Check for updates' }).click()
    await expect(page.getByRole('status')).toContainText('Lightning 9.9.9 is available')
    await expect(page.getByRole('link', { name: 'Download it' })).toBeVisible()
  })
})

test.describe('title bar buttons @smoke', () => {
  test('Logs and Debug are switched on and off in Settings → Interface', async ({ lightning }) => {
    const page = lightning.page
    const logs = page.getByRole('button', { name: 'Open the logs' })
    const debug = page.getByRole('button', { name: /^Debug/ })
    // Settings is modal, so the title bar is only looked at with it closed.
    const toggle = async (name: RegExp | string): Promise<void> => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Interface' }).click()
      await page.getByRole('checkbox', { name }).click()
      await page.keyboard.press('Escape')
    }
    await expect(logs).toBeVisible()
    await expect(debug).toBeVisible()

    await toggle('Show the Logs button')
    await expect(logs).toBeHidden()
    await expect(debug).toBeVisible()

    await toggle(/Show the Debug button/)
    await expect(debug).toBeHidden()

    await toggle('Show the Logs button')
    await expect(logs).toBeVisible()
    await expect(debug).toBeHidden()
  })
})

test.describe('several links in three steps @smoke', () => {
  test('paste, confirm the list, then choose settings and start', async ({
    lightning,
    serve,
    dirs
  }) => {
    const names = ['one.bin', 'two.bin', 'three.bin']
    const origins: Origin[] = []
    for (const name of names)
      origins.push(
        await serve({ size: 4 * BLOCK, contentDisposition: `attachment; filename="${name}"` })
      )
    await stubNativeUi(lightning, dirs.dest)
    const page = lightning.page
    await page.getByRole('button', { name: 'New download' }).first().click()
    await page.getByRole('menuitem', { name: 'Several links' }).click()
    await page.getByRole('textbox', { name: 'Links' }).fill(origins.map((o) => o.url()).join('\n'))
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2: only the list. No settings yet.
    await expect(page.getByText('Choose what to download')).toBeVisible()
    await expect(page.getByText('3 of 3 selected')).toBeVisible()
    await expect(page.getByText('Files at once')).toBeHidden()
    await page.getByRole('button', { name: 'Unselect all', exact: true }).click()
    await expect(page.getByText('0 of 3 selected')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Continue with/ })).toBeDisabled()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-ali-Works-Lightning/30ad7528-e3b6-4612-ac34-c1b533e5f5d1/scratchpad/multi-step2.png'
    })
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await expect(page.getByText('3 of 3 selected')).toBeVisible()

    // Step 3: the settings, then start.
    await page.getByRole('button', { name: 'Continue with 3 files' }).click()
    await expect(page.getByText('Download settings')).toBeVisible()
    await expect(page.getByText('Files at once')).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-ali-Works-Lightning/30ad7528-e3b6-4612-ac34-c1b533e5f5d1/scratchpad/multi-step3.png'
    })
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('3 of 3 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Continue with 3 files' }).click()
    await page.getByRole('button', { name: 'Download 3 files' }).click()
    await expect(page.getByText('Download settings')).toBeHidden()
  })
})
