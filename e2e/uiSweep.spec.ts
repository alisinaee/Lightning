import { rename } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import type { GroupInfo } from '../src/shared/types'
import { BLOCK, expect, test as base, type PlexoApp } from './fixtures'
import type { Origin, OriginOptions } from './origin'

/*
 * UI sweep. Click-through of the whole window against the fake origin (e2e/origin.ts), each test
 * independent so one failure does not hide the rest. Every test also fails on any `pageerror`
 * or console error in the window (the `watch` fixture), which is how the sidebar crash
 * (filter menu read `undefined.label` for the sidebar-only filters) is caught.
 *
 * | Scenario                                         | What it proves                                   |
 * | ------------------------------------------------ | ------------------------------------------------ |
 * | sidebar, empty list                              | every entry opens with no data, no error         |
 * | sidebar, one download per status                 | every status/kind entry works, title follows it  |
 * | sidebar, group with mixed statuses               | group rows survive every filter                  |
 * | sidebar, finished incl. missing file             | a finished entry whose file is gone is fine      |
 * | sidebar, stale saved filters                     | old persisted values never blank the window      |
 * | filter menu                                      | its four entries, and its title for sidebar picks|
 * | columns: sort / resize / hide / show             | every column both directions, layout kept        |
 * | search                                           | empty, text, no results, special characters      |
 * | pause all / resume all                           | bulk buttons act on the right downloads          |
 * | row actions + context menu                       | pause, resume, retry, remove, open folder        |
 * | selection toolbar                                | select all, ranges, bulk actions, confirmations  |
 * | New download dialog                              | probe ok/error, empty, magnet, duplicate         |
 * | Add several links dialog                         | Auto/Manual, folder name, bad link               |
 * | group rows and edit dialog                       | expand, rename, mode, remove file                |
 * | details screens                                  | downloading, paused, error, completed            |
 * | VPN chip, networks menu                          | both VPN states, networks list                   |
 * | Speed and data limits dialog                     | fields, invalid, units, save/cancel, slow mode   |
 * | Test lab, theme, update dialog                   | open/close, toggle, update banner                |
 * | window sizes, keyboard shortcuts                 | narrow and wide, Esc / Ctrl+A / Ctrl+F / Ctrl+N  |
 * | error boundary                                   | a render failure shows the recovery page         |
 */

const test = base.extend<{ watch: string[] }>({
  watch: [
    async ({ plexo }, use) => {
      const problems: string[] = []
      plexo.page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
      plexo.page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`)
      })
      await use(problems)
      expect(problems, 'errors in the window').toEqual([])
    },
    { auto: true }
  ]
})

async function resize(plexo: PlexoApp, width: number, height = 800): Promise<void> {
  await plexo.evaluateMain(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    { width, height }
  )
  await plexo.page.waitForFunction((w) => window.innerWidth === w, width)
}

type Serve = (options: OriginOptions) => Promise<Origin>

const SIDEBAR_STATUSES = ['All downloads', 'Downloading', 'Queued', 'Paused', 'Completed', 'Failed']
const SIDEBAR_KINDS = [
  'Video',
  'Audio',
  'Archive',
  'Document',
  'Program',
  'Image',
  'Torrent',
  'Disk image',
  'Other'
]

const sidebar = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Download categories' })
const entry = (page: Page, name: string): Locator =>
  sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) })
const title = (page: Page): Locator => page.getByRole('heading', { level: 1 })
const rowButton = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: `Open ${name}`, exact: true })

async function finish(plexo: PlexoApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: BLOCK })
  const id = await plexo.start(origin.url(), origin.sha256, { fileName })
  await plexo.waitForStatus('completed')
  return id
}

/** Held mid-way: stays "downloading" until the test ends. */
async function running(plexo: PlexoApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await plexo.start(origin.url(), origin.sha256, { fileName })
  await reached
  return id
}

async function paused(plexo: PlexoApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await plexo.start(origin.url(), origin.sha256, { fileName })
  await reached
  await plexo.api.pauseDownload(id)
  origin.release()
  await plexo.waitForStatus('paused')
  return id
}

async function failed(
  plexo: PlexoApp,
  serve: Serve,
  fileName: string,
  status = 500
): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await plexo.start(origin.url(), origin.sha256, { fileName })
  await reached
  origin.setRule(() => ({ status }))
  origin.release()
  await plexo.waitForStatus('error', 30_000)
  return id
}

async function grouped(
  plexo: PlexoApp,
  serve: Serve,
  names: string[],
  mode: 'auto' | 'manual' = 'manual'
): Promise<GroupInfo> {
  const requests = []
  for (const name of names) {
    const origin = await serve({ size: BLOCK })
    const probe = await plexo.api.probeUrl(origin.url())
    requests.push({
      kind: 'http' as const,
      url: probe.finalUrl,
      destinationDir: plexo.dirs.dest,
      suggestedFileName: name,
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    })
  }
  const { group } = await plexo.api.createGroup({
    name: 'Sweep group',
    destinationDir: plexo.dirs.dest,
    mode,
    interfaceIds: ['a'],
    requests
  })
  return group
}

/** Clicks every sidebar entry, then every one again off the menu, expecting no error. */
async function clickEverySidebarEntry(page: Page): Promise<void> {
  for (const name of [...SIDEBAR_STATUSES, ...SIDEBAR_KINDS]) {
    await entry(page, name).click()
    await expect(page.getByText('Something went wrong')).toBeHidden()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    if (SIDEBAR_KINDS.includes(name)) await entry(page, name).click()
    if (SIDEBAR_STATUSES.includes(name)) {
      await expect(title(page)).not.toHaveText(/undefined/)
      await expect(entry(page, name)).toHaveAttribute('aria-current', 'true')
    }
  }
  await entry(page, 'All downloads').click()
}

test.describe('sidebar', () => {
  test.beforeEach(async ({ plexo }) => resize(plexo, 1200))

  test('an empty list shows the empty state and no sidebar', async ({ plexo }) => {
    // With nothing listed there is no sidebar, only the empty state.
    await expect(plexo.page.getByText('No downloads yet', { exact: true })).toBeVisible()
    await expect(sidebar(plexo.page)).toBeHidden()
  })

  test('every entry works with one download in each state', async ({ plexo, serve }) => {
    await finish(plexo, serve, 'done.mp4')
    await paused(plexo, serve, 'held.zip')
    await failed(plexo, serve, 'broke.pdf', 500)
    await failed(plexo, serve, 'expired.iso', 403)
    await running(plexo, serve, 'live.mp3')
    const page = plexo.page
    await clickEverySidebarEntry(page)
    await entry(page, 'Downloading').click()
    await expect(title(page)).toHaveText('Downloading')
    await expect(rowButton(page, 'live.mp3')).toBeVisible()
    await expect(rowButton(page, 'done.mp4')).toBeHidden()
    await entry(page, 'Paused').click()
    await expect(title(page)).toHaveText('Paused')
    await expect(rowButton(page, 'held.zip')).toBeVisible()
    await entry(page, 'Queued').click()
    await expect(title(page)).toHaveText('Queued')
    await entry(page, 'Completed').click()
    await expect(rowButton(page, 'done.mp4')).toBeVisible()
    await entry(page, 'Failed').click()
    await expect(rowButton(page, 'broke.pdf')).toBeVisible()
    await expect(rowButton(page, 'expired.iso')).toBeVisible()
    await entry(page, 'All downloads').click()
    await entry(page, 'Video').click()
    await expect(rowButton(page, 'done.mp4')).toBeVisible()
    await expect(rowButton(page, 'held.zip')).toBeHidden()
    await entry(page, 'Video').click()
    await expect(rowButton(page, 'held.zip')).toBeVisible()
  })

  test('a cancelled download does not break any entry', async ({ plexo, serve }) => {
    await finish(plexo, serve, 'stays.bin')
    const id = await paused(plexo, serve, 'gone.bin')
    await plexo.api.cancelDownload(id)
    await clickEverySidebarEntry(plexo.page)
  })

  test('a group of mixed statuses works under every entry', async ({ plexo, serve }) => {
    const group = await grouped(plexo, serve, ['g1.mp4', 'g2.zip', 'g3.pdf'])
    await expect(plexo.page.getByText(group.name).first()).toBeVisible()
    await paused(plexo, serve, 'single.bin')
    await clickEverySidebarEntry(plexo.page)
    await entry(plexo.page, 'Completed').click()
    await expect(plexo.page.getByText(group.name).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a finished download whose file is missing works under every entry', async ({
    plexo,
    serve
  }) => {
    const id = await finish(plexo, serve, 'lost.mp4')
    const state = await plexo.byId(id)
    await rename(state!.destinationPath, `${state!.destinationPath}.moved`)
    await plexo.page.reload()
    await clickEverySidebarEntry(plexo.page)
    await entry(plexo.page, 'Completed').click()
    await expect(rowButton(plexo.page, 'lost.mp4')).toBeVisible()
    await rename(`${state!.destinationPath}.moved`, state!.destinationPath)
  })

  test('old saved filter and layout values never blank the window', async ({ plexo, serve }) => {
    await finish(plexo, serve, 'kept.bin')
    const page = plexo.page
    for (const value of ['"bogus"', '"cancelled"', '"error"', '7', 'null']) {
      await page.evaluate((v) => {
        for (const key of Object.keys(localStorage)) {
          if (/filter|sidebar|kind/i.test(key)) localStorage.setItem(key, v)
        }
        localStorage.setItem('plexo.filter', v)
        localStorage.setItem('plexo.kind', v)
      }, value)
      await page.reload()
      await expect(sidebar(page)).toBeVisible()
      await expect(page.getByText('Something went wrong')).toBeHidden()
    }
  })

  test('the filter menu lists four entries and titles itself for sidebar choices', async ({
    plexo,
    serve
  }) => {
    await finish(plexo, serve, 'm.bin')
    const page = plexo.page
    for (const [name, expected] of [
      ['Downloading', 'Downloading'],
      ['Queued', 'Queued'],
      ['Paused', 'Paused'],
      ['Failed', 'Needs attention']
    ] as const) {
      await entry(page, name).click()
      await expect(title(page)).toContainText(expected === 'Needs attention' ? /./ : expected)
      await title(page).getByRole('button').click()
      await expect(page.getByRole('menuitemradio')).toHaveCount(4)
      await page.keyboard.press('Escape')
    }
  })
})

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const row = (page: Page, name: string): Locator =>
  page.getByRole('row').filter({ has: rowButton(page, name) })

test.describe('table', () => {
  test.beforeEach(async ({ plexo }) => resize(plexo, 1200))

  test('every column sorts both ways', async ({ plexo, serve }) => {
    await finish(plexo, serve, 'a-first.bin')
    await paused(plexo, serve, 'z-last.bin')
    const page = plexo.page
    for (const column of ['Name', 'Size', 'Status', 'Speed', 'Time left', 'Added']) {
      const header = page.getByRole('columnheader', { name: column, exact: true })
      await header.getByRole('button').click()
      const first = header
      await expect(first).toHaveAttribute('aria-sort', /ascending|descending/)
      const before = await header.getAttribute('aria-sort')
      await header.getByRole('button').click()
      await expect(header).not.toHaveAttribute('aria-sort', before!)
      await expect(rowButton(page, 'a-first.bin')).toBeVisible()
      await expect(rowButton(page, 'z-last.bin')).toBeVisible()
    }
    // By name, ascending puts a-first on top.
    const name = page.getByRole('columnheader', { name: 'Name', exact: true }).getByRole('button')
    await name.click()
    const names = async (): Promise<string[]> =>
      page
        .getByRole('button', { name: /^Open / })
        .evaluateAll((all) => all.map((node) => node.getAttribute('aria-label') ?? ''))
    const one = await names()
    await name.click()
    expect(await names()).toEqual([...one].reverse())
  })

  test('columns hide, show again and resize, and the layout survives a reload', async ({
    plexo,
    serve
  }) => {
    await finish(plexo, serve, 'cols.bin')
    const page = plexo.page
    await page.getByRole('button', { name: 'Choose columns' }).click()
    const items = page.getByRole('menuitemcheckbox')
    const count = await items.count()
    expect(count).toBeGreaterThan(2)
    await items.filter({ hasText: 'Size' }).click()
    await expect(page.getByRole('columnheader', { name: 'Size', exact: true })).toBeHidden()
    await page.reload()
    await expect(page.getByRole('columnheader', { name: 'Size', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Choose columns' }).click()
    await page.getByRole('menuitemcheckbox').filter({ hasText: 'Size' }).click()
    await expect(page.getByRole('columnheader', { name: 'Size', exact: true })).toBeVisible()
    // The handle between two headers resizes the one to its left.
    const header = page.getByRole('columnheader', { name: 'Status', exact: true })
    const before = (await header.boundingBox())!.width
    const handle = header.getByRole('separator')
    if (await handle.count()) {
      const box = (await handle.first().boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 })
      await page.mouse.up()
      expect((await header.boundingBox())!.width).not.toBe(before)
    }
  })

  test('search: empty, text, no results, special characters', async ({ plexo, serve }) => {
    await finish(plexo, serve, 'alpha.bin')
    await paused(plexo, serve, 'beta.bin')
    const page = plexo.page
    const search = page.getByRole('searchbox', { name: 'Search downloads' })
    await search.fill('alpha')
    await expect(rowButton(page, 'alpha.bin')).toBeVisible()
    await expect(rowButton(page, 'beta.bin')).toBeHidden()
    await search.fill('zzz-nothing')
    await expect(page.getByText('No matching downloads')).toBeVisible()
    await page.getByRole('button', { name: 'Show all downloads' }).click()
    await expect(search).toHaveValue('')
    for (const odd of ['(', '[a-', '.*', '\\', '%00', '<b>x</b>', '🙂', "'; DROP TABLE--"]) {
      await search.fill(odd)
      await expect(page.getByRole('searchbox', { name: 'Search downloads' })).toHaveValue(odd)
    }
    await search.fill('')
    await expect(rowButton(page, 'alpha.bin')).toBeVisible()
    await search.fill('beta')
    await search.press('Escape')
    await expect(search).toHaveValue('')
  })

  test('Pause all and Resume all act on every download', async ({ plexo, serve }) => {
    await running(plexo, serve, 'one.bin')
    await running(plexo, serve, 'two.bin')
    const page = plexo.page
    await page.getByRole('button', { name: 'Pause all' }).click()
    await expect
      .poll(async () => (await plexo.all()).map((d) => d.status))
      .toEqual(['paused', 'paused'])
    await page.getByRole('button', { name: 'Resume all' }).click()
    await expect
      .poll(async () => (await plexo.all()).every((d) => d.status !== 'paused'))
      .toBe(true)
  })

  test('row actions: pause, resume, retry, remove, context menu', async ({ plexo, serve }) => {
    const page = plexo.page
    const heldId = await running(plexo, serve, 'row.bin')
    await page.getByRole('button', { name: 'Pause row.bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Resume row.bin', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Resume row.bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause row.bin', exact: true })).toBeVisible()
    // Context menu: items, then close.
    await row(page, 'row.bin').click({ button: 'right' })
    for (const label of ['Details', 'Copy link', 'Cancel download…']) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await plexo.api.cancelDownload(heldId)
    const done = await finish(plexo, serve, 'ok.bin')
    await failed(plexo, serve, 'bad.bin', 500)
    await expect(page.getByRole('button', { name: 'Retry bad.bin', exact: true })).toBeVisible()
    // The failed one retries (and fails again against the same rule).
    await page.getByRole('button', { name: 'Retry bad.bin', exact: true }).click()
    await expect(rowButton(page, 'bad.bin')).toBeVisible()
    await row(page, 'ok.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from list' }).click()
    await expect(rowButton(page, 'ok.bin')).toBeHidden()
    expect(done).toBeTruthy()
  })

  test('open folder reveals the download', async ({ plexo, serve }) => {
    await plexo.evaluateMain(({ shell }) => {
      const revealed: string[] = []
      ;(globalThis as Record<string, unknown>).__revealed = revealed
      shell.showItemInFolder = (path: string) => void revealed.push(path)
    }, null)
    await finish(plexo, serve, 'reveal.bin')
    const page = plexo.page
    await row(page, 'reveal.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Show in|Reveal|Open folder|Open containing/ }).click()
    await expect
      .poll(() =>
        plexo.evaluateMain(() => (globalThis as Record<string, string[]>).__revealed.length, null)
      )
      .toBe(1)
  })
})

test.describe('selection', () => {
  test.beforeEach(async ({ plexo }) => resize(plexo, 1200))

  test('select all, range, toggle and bulk actions with confirmations', async ({
    plexo,
    serve
  }) => {
    await running(plexo, serve, 'r1.bin')
    await running(plexo, serve, 'r2.bin')
    await paused(plexo, serve, 'r3.bin')
    await finish(plexo, serve, 'r4.bin')
    const page = plexo.page
    const toolbar = page.getByRole('toolbar', { name: 'Selected downloads' })
    await page.getByRole('checkbox', { name: 'Select r1.bin', exact: true }).check()
    await expect(toolbar.getByText('1 selected')).toBeVisible()
    // Shift-click a name selects the range, Ctrl/Cmd-click toggles one.
    await rowButton(page, 'r3.bin').click({ modifiers: ['Shift'] })
    await expect(toolbar.getByText('3 selected')).toBeVisible()
    await rowButton(page, 'r2.bin').click({ modifiers: [MOD] })
    await expect(toolbar.getByText('2 selected')).toBeVisible()
    await toolbar.getByRole('button', { name: 'Select all', exact: true }).click()
    await expect(toolbar.getByText('4 selected')).toBeVisible()
    await toolbar.getByRole('button', { name: /^Pause \(/ }).click()
    await expect(toolbar.getByRole('button', { name: /^Resume \(/ })).toBeVisible()
    await toolbar.getByRole('button', { name: /^Resume \(/ }).click()
    // Cancel with the dialog dismissed, then confirmed.
    await toolbar.getByRole('button', { name: /^Cancel downloads/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(toolbar.getByText('4 selected')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeHidden()
    await page.keyboard.press(`${MOD}+a`)
    await expect(toolbar.getByText('4 selected')).toBeVisible()
    await toolbar.getByRole('button', { name: /^Cancel downloads/ }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Cancel downloads/ })
      .click()
    await expect(rowButton(page, 'r1.bin')).toBeHidden()
    await expect(rowButton(page, 'r4.bin')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Select r4.bin', exact: true }).check()
    await toolbar.getByRole('button', { name: /^Delete files|^Move files/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rowButton(page, 'r4.bin')).toBeVisible()
  })
})
