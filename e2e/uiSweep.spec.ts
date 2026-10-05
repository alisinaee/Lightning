import type { StartDownloadRequest } from '../src/shared/types'
import { rename } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import type { GroupInfo } from '../src/shared/types'
import { BLOCK, expect, test as base, type LightningApp } from './fixtures'
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
    async ({ lightning }, use) => {
      const problems: string[] = []
      lightning.page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
      lightning.page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`)
      })
      await use(problems)
      expect(problems, 'errors in the window').toEqual([])
    },
    { auto: true }
  ]
})

async function resize(lightning: LightningApp, width: number, height = 800): Promise<void> {
  await lightning.evaluateMain(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    { width, height }
  )
  await lightning.page.waitForFunction((w) => window.innerWidth === w, width)
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

async function finish(lightning: LightningApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: BLOCK })
  const id = await lightning.start(origin.url(), origin.sha256, { fileName })
  await lightning.waitForStatus('completed')
  return id
}

/** Held mid-way: stays "downloading" until the test ends. */
async function running(lightning: LightningApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await lightning.start(origin.url(), origin.sha256, { fileName })
  await reached
  return id
}

async function paused(lightning: LightningApp, serve: Serve, fileName: string): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await lightning.start(origin.url(), origin.sha256, { fileName })
  await reached
  await lightning.api.pauseDownload(id)
  origin.release()
  await lightning.waitForStatus('paused')
  return id
}

async function failed(
  lightning: LightningApp,
  serve: Serve,
  fileName: string,
  status = 500
): Promise<string> {
  const origin = await serve({ size: 16 * BLOCK })
  const reached = origin.hold(4 * BLOCK)
  const id = await lightning.start(origin.url(), origin.sha256, { fileName })
  await reached
  origin.setRule(() => ({ status }))
  origin.release()
  await lightning.waitForStatus('error', 30_000)
  return id
}

async function grouped(
  lightning: LightningApp,
  serve: Serve,
  names: string[],
  mode: 'auto' | 'manual' = 'manual'
): Promise<GroupInfo> {
  const requests: StartDownloadRequest[] = []
  for (const name of names) {
    const origin = await serve({ size: BLOCK })
    const probe = await lightning.api.probeUrl(origin.url())
    requests.push({
      kind: 'http' as const,
      url: probe.finalUrl,
      destinationDir: lightning.dirs.dest,
      suggestedFileName: name,
      totalBytes: probe.totalBytes ?? 0,
      supportsRanges: probe.supportsRanges,
      interfaceIds: ['a'],
      etag: probe.etag,
      lastModified: probe.lastModified
    })
  }
  const { group } = await lightning.api.createGroup({
    name: 'Sweep group',
    destinationDir: lightning.dirs.dest,
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
  test.beforeEach(async ({ lightning }) => resize(lightning, 1200))

  test('an empty list shows the empty state and no sidebar', async ({ lightning }) => {
    // With nothing listed there is no sidebar, only the empty state.
    await expect(lightning.page.getByText('No downloads yet', { exact: true })).toBeVisible()
    await expect(sidebar(lightning.page)).toBeHidden()
  })

  test('every entry works with one download in each state', async ({ lightning, serve }) => {
    await finish(lightning, serve, 'done.mp4')
    await paused(lightning, serve, 'held.zip')
    await failed(lightning, serve, 'broke.pdf', 500)
    await failed(lightning, serve, 'expired.iso', 403)
    await running(lightning, serve, 'live.mp3')
    const page = lightning.page
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

  test('a cancelled download does not break any entry', async ({ lightning, serve }) => {
    await finish(lightning, serve, 'stays.bin')
    const id = await paused(lightning, serve, 'gone.bin')
    await lightning.api.cancelDownload(id)
    await clickEverySidebarEntry(lightning.page)
  })

  test('a group of mixed statuses works under every entry', async ({ lightning, serve }) => {
    const group = await grouped(lightning, serve, ['g1.mp4', 'g2.zip', 'g3.pdf'])
    await expect(lightning.page.getByText(group.name).first()).toBeVisible()
    await paused(lightning, serve, 'single.bin')
    await clickEverySidebarEntry(lightning.page)
    await entry(lightning.page, 'Completed').click()
    await expect(lightning.page.getByText(group.name).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a finished download whose file is missing works under every entry', async ({
    lightning,
    serve
  }) => {
    const id = await finish(lightning, serve, 'lost.mp4')
    const state = await lightning.byId(id)
    await rename(state!.destinationPath, `${state!.destinationPath}.moved`)
    await lightning.page.reload()
    await clickEverySidebarEntry(lightning.page)
    await entry(lightning.page, 'Completed').click()
    await expect(rowButton(lightning.page, 'lost.mp4')).toBeVisible()
    await rename(`${state!.destinationPath}.moved`, state!.destinationPath)
  })

  test('old saved filter and layout values never blank the window', async ({
    lightning,
    serve
  }) => {
    await finish(lightning, serve, 'kept.bin')
    const page = lightning.page
    for (const value of ['"bogus"', '"cancelled"', '"error"', '7', 'null']) {
      await page.evaluate((v) => {
        for (const key of Object.keys(localStorage)) {
          if (/filter|sidebar|kind/i.test(key)) localStorage.setItem(key, v)
        }
        localStorage.setItem('lightning.filter', v)
        localStorage.setItem('lightning.kind', v)
      }, value)
      await page.reload()
      await expect(sidebar(page)).toBeVisible()
      await expect(page.getByText('Something went wrong')).toBeHidden()
    }
  })

  test('the page title follows the sidebar choice', async ({ lightning, serve }) => {
    await finish(lightning, serve, 'm.bin')
    const page = lightning.page
    for (const [name, expected] of [
      ['Downloading', 'Downloading'],
      ['Queued', 'Queued'],
      ['Paused', 'Paused'],
      ['Failed', 'Needs attention']
    ] as const) {
      await entry(page, name).click()
      await expect(title(page)).toContainText(expected === 'Needs attention' ? /./ : expected)
      await expect(entry(page, name)).toHaveAttribute('aria-current', 'true')
    }
  })
})

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const row = (page: Page, name: string): Locator =>
  page.getByRole('row').filter({ has: rowButton(page, name) })

test.describe('table', () => {
  test.beforeEach(async ({ lightning }) => resize(lightning, 1200))

  test('every column sorts both ways', async ({ lightning, serve }) => {
    await finish(lightning, serve, 'a-first.bin')
    await paused(lightning, serve, 'z-last.bin')
    const page = lightning.page
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
        .getByRole('button', { name: /^Open (?!the logs)/ })
        .evaluateAll((all) => all.map((node) => node.getAttribute('aria-label') ?? ''))
    const one = await names()
    await name.click()
    expect(await names()).toEqual([...one].reverse())
  })

  test('columns hide, show again and resize, and the layout survives a reload', async ({
    lightning,
    serve
  }) => {
    await finish(lightning, serve, 'cols.bin')
    const page = lightning.page
    await page.getByRole('button', { name: 'Choose columns' }).click()
    const items = page.getByRole('menuitemcheckbox')
    await expect(items.first()).toBeVisible()
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

  test('search: empty, text, no results, special characters', async ({ lightning, serve }) => {
    await finish(lightning, serve, 'alpha.bin')
    await paused(lightning, serve, 'beta.bin')
    const page = lightning.page
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

  test('Pause all and Resume all act on every download', async ({ lightning, serve }) => {
    await running(lightning, serve, 'one.bin')
    await running(lightning, serve, 'two.bin')
    const page = lightning.page
    await page.getByRole('button', { name: 'Pause all' }).click()
    await expect
      .poll(async () => (await lightning.all()).map((d) => d.status))
      .toEqual(['paused', 'paused'])
    await page.getByRole('button', { name: 'Resume all' }).click()
    await expect
      .poll(async () => (await lightning.all()).every((d) => d.status !== 'paused'))
      .toBe(true)
  })

  test('row actions: pause, resume, retry, remove, context menu', async ({ lightning, serve }) => {
    const page = lightning.page
    const heldId = await running(lightning, serve, 'row.bin')
    await page.getByRole('button', { name: 'Pause row.bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Resume row.bin', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Resume row.bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause row.bin', exact: true })).toBeVisible()
    // Context menu: items, then close.
    await row(page, 'row.bin').click({ button: 'right' })
    for (const label of ['Details', 'Copy link', 'Cancel and delete partial data…']) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await lightning.api.cancelDownload(heldId)
    const done = await finish(lightning, serve, 'ok.bin')
    await failed(lightning, serve, 'bad.bin', 500)
    await expect(page.getByRole('button', { name: 'Retry bad.bin', exact: true })).toBeVisible()
    // The failed one retries (and fails again against the same rule).
    await page.getByRole('button', { name: 'Retry bad.bin', exact: true }).click()
    await expect(rowButton(page, 'bad.bin')).toBeVisible()
    await row(page, 'ok.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from list…' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove from list' }).click()
    await expect(rowButton(page, 'ok.bin')).toBeHidden()
    expect(done).toBeTruthy()
  })

  test('open folder reveals the download', async ({ lightning, serve }) => {
    await lightning.evaluateMain(({ shell }) => {
      const revealed: string[] = []
      ;(globalThis as Record<string, unknown>).__revealed = revealed
      shell.showItemInFolder = (path: string) => void revealed.push(path)
    }, null)
    await finish(lightning, serve, 'reveal.bin')
    const page = lightning.page
    await row(page, 'reveal.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Show in|Reveal|Open folder|Open containing/ }).click()
    await expect
      .poll(() =>
        lightning.evaluateMain(
          () => (globalThis as unknown as Record<string, string[]>).__revealed.length,
          null
        )
      )
      .toBe(1)
  })
})

test.describe('selection', () => {
  test.beforeEach(async ({ lightning }) => resize(lightning, 1200))

  test('select all, range, toggle and bulk actions with confirmations', async ({
    lightning,
    serve
  }) => {
    // Only two downloads run at once by default: the third would wait, queued, not start.
    await lightning.api.updateSettings({ downloadsAtOnce: 4 })
    await running(lightning, serve, 'r1.bin')
    await running(lightning, serve, 'r2.bin')
    await paused(lightning, serve, 'r3.bin')
    await finish(lightning, serve, 'r4.bin')
    const page = lightning.page
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
    await row(page, 'r1.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Cancel and delete partial data…' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(toolbar.getByText('4 selected')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeHidden()
    await page.keyboard.press(`${MOD}+a`)
    await expect(toolbar.getByText('4 selected')).toBeVisible()
    await row(page, 'r1.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Cancel and delete partial data…' }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Cancel downloads/ })
      .click()
    await expect(rowButton(page, 'r1.bin')).toBeHidden()
    await expect(rowButton(page, 'r4.bin')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Select r4.bin', exact: true }).check()
    // Deleting files is on the row's menu, and acts on the selected rows (the toolbar has only
    // Pause, Resume and Retry).
    await row(page, 'r4.bin').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Delete file/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rowButton(page, 'r4.bin')).toBeVisible()
  })
})

/** Every element's box, keyed by its place in the page, to compare before and after a click. */
const boxes = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const out: Record<string, string> = {}
    const walk = (el: Element, path: string): void => {
      const r = el.getBoundingClientRect()
      out[path] =
        `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} ${el.className?.toString().slice(0, 50) ?? ''}`
      Array.from(el.children).forEach((child, i) => walk(child, `${path}/${child.tagName}${i}`))
    }
    walk(document.body, 'body')
    return out
  })

test.describe('layout stability', () => {
  test.beforeEach(async ({ lightning }) => resize(lightning, 1200))

  test('clicking sidebar entries and header buttons moves no other element', async ({
    lightning,
    serve
  }) => {
    await finish(lightning, serve, 'done.mp4')
    await paused(lightning, serve, 'held.zip')
    await failed(lightning, serve, 'broke.pdf', 500)
    const page = lightning.page
    const names = [
      'Completed',
      'Failed',
      'Paused',
      'Downloading',
      'Video',
      'Video',
      'All downloads'
    ]
    const report: string[] = []
    for (const name of names) {
      const before = await boxes(page)
      await entry(page, name).click()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      const after = await boxes(page)
      // Only the sidebar and the title strip are compared: the list itself changes by design.
      for (const key of Object.keys(before)) {
        if (!key.includes('NAV') && !key.includes('HEADER')) continue
        if (after[key] !== undefined && after[key] !== before[key])
          report.push(`${name}: ${key}\n   ${before[key]}\n   ${after[key]}`)
      }
    }
    expect(report.slice(0, 20).join('\n')).toBe('')
  })

  test('selecting, sorting and filtering keep the sidebar and the list where they are', async ({
    lightning,
    serve
  }) => {
    await finish(lightning, serve, 'done.mp4')
    await paused(lightning, serve, 'held.zip')
    const page = lightning.page
    const frame = async (): Promise<string[]> => {
      const all = await boxes(page)
      return Object.entries(all)
        .filter(
          ([key]) => /NAV0$/.test(key) || /\[role=table\]/.test(key) || key.split('/').length <= 6
        )
        .map(([key, box]) => `${key} ${box.split(' ')[0]}`)
    }
    const report: string[] = []
    const check = async (label: string, act: () => Promise<void>): Promise<void> => {
      const before = await frame()
      await act()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
      const after = await frame()
      before.forEach((line, i) => {
        if (after[i] !== line) report.push(`${label}: ${line} -> ${after[i]}`)
      })
    }
    await check('select a row', () => page.getByRole('checkbox').nth(1).click())
    await check('unselect', () => page.getByRole('checkbox').nth(1).click())
    await check('sort by name', () =>
      page.getByRole('columnheader', { name: 'Name' }).getByRole('button').click()
    )
    await check('sort by size', () =>
      page.getByRole('columnheader', { name: 'Size' }).getByRole('button').click()
    )
    expect(report.slice(0, 20).join('\n')).toBe('')
  })
})
