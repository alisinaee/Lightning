import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BLOCK, expect, test } from './fixtures'
import type { PlexoApp } from './fixtures'

// Features of a download manager beyond fetching bytes: logs, files kept in step with the list,
// duplicate warnings, deleting, and retrying with the saved link.

const SIZE = 16 * BLOCK

async function stubTrash(plexo: PlexoApp, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  await plexo.evaluateMain(({ shell }, dest) => {
    shell.trashItem = async (path: string): Promise<void> => {
      const { rename } = process.getBuiltinModule('node:fs/promises')
      const { basename, join } = process.getBuiltinModule('node:path')
      await rename(path, join(dest, basename(path)))
    }
  }, destination)
}

test.describe('E. logs', () => {
  test('actions are logged with ids and links lose their query strings', async ({
    plexo,
    serve
  }) => {
    const origin = await serve({ size: SIZE })
    const id = await plexo.start(`${origin.url()}?token=SECRET123`, origin.sha256)
    await plexo.waitForStatus('completed')
    await plexo.api.removeDownload(id)
    const text = (await plexo.api.readLog(500)).join('\n')
    expect(text).toContain('new download')
    expect(text).toContain(`remove`)
    expect(text).toContain(id)
    expect(text).not.toContain('SECRET123')
    expect(text).toContain('window')
  })

  test('readLog limits lines, clearLog empties, the report has its sections', async ({ plexo }) => {
    expect((await plexo.api.readLog(2)).length).toBeLessThanOrEqual(2)
    const report = await plexo.api.diagnosticReport()
    for (const part of [
      '== Networks ==',
      'Use VPN setting',
      '== Settings ==',
      '== Downloads by status ==',
      '== Last 20 errors ==',
      '== Last 100 log lines =='
    ]) {
      expect(report).toContain(part)
    }
    await plexo.api.clearLog()
    const after = await plexo.api.readLog(50)
    expect(after.some((line) => line.includes('log cleared'))).toBe(true)
    expect(after.length).toBeLessThan(5)
  })

  test('an uncaught error in the window is logged with its stack', async ({ plexo }) => {
    await plexo.page.evaluate(() => {
      setTimeout(() => {
        throw new Error('boom-from-test')
      }, 0)
    })
    await expect
      .poll(async () => (await plexo.api.readLog(100)).join('\n'))
      .toMatch(/ERROR .*Uncaught error: .*boom-from-test[\s\S]*at /)
    await plexo.page.evaluate(() => {
      void Promise.reject(new Error('rejected-from-test'))
    })
    await expect
      .poll(async () => (await plexo.api.readLog(100)).join('\n'))
      .toContain('Unhandled promise rejection: rejected-from-test')
  })

  test('the Logs window filters, searches and clears', async ({ plexo }) => {
    await plexo.page.evaluate(() => console.error('visible-error-line'))
    await plexo.page.getByRole('button', { name: 'Open the logs' }).click()
    const log = plexo.page.getByRole('log', { name: 'Log lines' })
    await expect(log).toContainText('visible-error-line')
    await plexo.page.getByRole('button', { name: 'Info', exact: true }).click()
    await plexo.page.getByRole('button', { name: 'Warn', exact: true }).click()
    await expect(log).toContainText('visible-error-line')
    await expect(log).not.toContainText('Plexo ')
    await plexo.page.getByRole('searchbox', { name: 'Search the log' }).fill('no-such-text')
    await expect(log).toContainText('No lines to show.')
    await plexo.page.getByRole('button', { name: 'Clear', exact: true }).click()
    await plexo.page.getByRole('searchbox', { name: 'Search the log' }).fill('')
    await expect(log).not.toContainText('visible-error-line')
  })
})
void [existsSync, readFile, readdir, rename, writeFile, join, stubTrash]
