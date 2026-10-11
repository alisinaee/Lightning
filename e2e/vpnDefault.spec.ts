import { expect, test } from './fixtures'
import { vpnMigration } from '../src/shared/vpnDefault'

// "Use VPN for downloads": on by default for a new install, kept off for one that already had
// settings, shown as a labelled switch, and a saved choice (either way) survives a restart.

test.describe('the VPN default, migration @smoke', () => {
  test('a new install (no settings yet) starts with the VPN on', () => {
    expect(vpnMigration({})).toEqual({ vpnDefaultMigrated: true })
  })

  test('an install that already had settings keeps the VPN off, once', () => {
    expect(vpnMigration({ themeSource: 'dark' })).toEqual({
      vpnDefaultMigrated: true,
      useVpn: false
    })
  })

  test('a choice already made is never overwritten', () => {
    expect(vpnMigration({ themeSource: 'dark', useVpn: true })).toEqual({
      vpnDefaultMigrated: true
    })
    expect(vpnMigration({ themeSource: 'dark', useVpn: false })).toEqual({
      vpnDefaultMigrated: true
    })
  })

  test('once done it is not done again', () => {
    expect(vpnMigration({ vpnDefaultMigrated: true, themeSource: 'dark' })).toBeNull()
  })
})

test.describe('the VPN control in the top bar @smoke', () => {
  test.use({
    appEnv: { LIGHTNING_E2E_INTERFACES: 'a=127.0.0.1,v=127.0.0.2=255.0.0.0=vpn=Fake VPN' }
  })

  test('is a labelled switch with a hint, and its off and on are both remembered', async ({
    lightning
  }) => {
    const page = lightning.page
    const vpn = page.getByRole('switch', { name: 'Use VPN for downloads' })
    await expect(vpn).toBeVisible()
    await expect(page.getByText('VPN', { exact: true }).first()).toBeVisible()

    // The hint says what it does.
    await vpn.hover()
    await expect(page.getByText(/downloads skip VPN tunnels/).first()).toBeVisible()

    // This profile had settings before, so it keeps its off: switch it on, restart, still on.
    await expect(vpn).not.toBeChecked()
    await vpn.click()
    await expect(vpn).toBeChecked()
    await lightning.relaunch()
    await expect(
      lightning.page.getByRole('switch', { name: 'Use VPN for downloads' })
    ).toBeChecked()

    // And off again: with the default on, an off that was not saved would come back on.
    await lightning.page.getByRole('switch', { name: 'Use VPN for downloads' }).click()
    await lightning.relaunch()
    await expect(
      lightning.page.getByRole('switch', { name: 'Use VPN for downloads' })
    ).not.toBeChecked()
  })
})
