import { rmdir, stat, statfs } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { describeError } from '../../shared/errors'
import { IpcChannels } from '../../shared/ipc-channels'
import type { IpcContract } from '../../shared/ipc-contract'
import {
  DEFAULT_SLOW_MODE_SPEED,
  DOWNLOADS_AT_ONCE,
  type AppSettings,
  type CreateGroupInput,
  type GroupInfo,
  type GroupPatch,
  type InitialState,
  type SettingsPush,
  type StartDownloadRequest,
  type ThemeSource
} from '../../shared/types'
import { DownloadManager } from '../download/downloadManager'
import { getDefaultDownloadsDir, getHomeDir } from '../download/paths'
import { findInHistory, listHistory } from '../download/history'
import { probeUrl } from '../download/probe'
import { deviceBindingSupported } from '../network/deviceBinding'
import { takePendingLink } from '../openLinks'
import { measureLatencies } from '../network/latency'
import { NetworkMonitor } from '../network/interfaces'
import { Lab } from '../debug/lab'
import { AutoScheduler } from '../groups/autoScheduler'
import { GroupStore } from '../groups/groupStore'
import { clearLog, log, logFilePath, readLog } from '../logger'
import { redactUrl } from '../../shared/urlTools'
import { diagnosticReport } from '../diagnostics'
import { findDuplicates } from '../download/findDuplicates'
import { appVariant } from '../variant'
import { applyBehavior } from '../appBehavior'
import { loadSettings, prefsOf, saveSettings } from '../settings'
import { DnsService, SYSTEM_DNS } from '../network/dns'
import { testKnobs } from '../testKnobs'
import { checkForUpdate, UPDATE_PAGE_URL } from '../updateCheck'

async function openNetworkSettings(): Promise<void> {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:network-status')
  } else if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.network')
  } else if (process.platform === 'linux') {
    try {
      const { exec } = await import('node:child_process')
      exec('gnome-control-center network || nm-connection-editor || true')
    } catch {
      // Best-effort
    }
  }
}

/** Typed wrapper around ipcMain.handle — the channel name picks its args/result shape out of
 * IpcContract, so a handler here that doesn't match what lightningApi (preload) actually calls is a
 * compile error instead of a silent runtime mismatch. */
function handle<K extends keyof IpcContract>(
  channel: K,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: IpcContract[K]['args']
  ) => IpcContract[K]['result'] | Promise<IpcContract[K]['result']>
): void {
  ipcMain.handle(
    IpcChannels[channel],
    listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  )
}

const DESTINATION_CHECK_MS = 300

/** The window is trusted to send the right types, but not to be the only thing that could. */
function requireAbsolutePath(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '' || !isAbsolute(value)) {
    throw new Error(`${what} must be an absolute path.`)
  }
  return value
}

async function freeSpace(dir: string): Promise<number | null> {
  try {
    const stats = await statfs(dir)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): DownloadManager {
  // The main process keeps the network list, for downloads and the window alike.
  let known: string[] = []
  const networks = new NetworkMonitor((list) => {
    const now = list.map(
      (n) => `${n.id} (${n.kind}, ${n.addresses.map((a) => a.address).join('/')})`
    )
    for (const n of now.filter((n) => !known.includes(n))) log.info('network', `appeared: ${n}`)
    for (const n of known.filter((n) => !now.includes(n))) log.info('network', `gone: ${n}`)
    known = now
    manager.networksChanged()
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannels.networksChanged, list)
  })
  const manager = new DownloadManager(getWindow, networks)
  // Waking from sleep, the networks may have changed without a poll in between to see it.
  powerMonitor.on('resume', () => {
    manager.systemResumed()
    void networks.refresh()
  })

  const groups = new GroupStore(() => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannels.groupsChanged)
  })
  void loadSettings().then((saved) => {
    networks.useVpn = saved.useVpn ?? false
  })
  const dns = new DnsService((config) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IpcChannels.dnsChanged, config)
  })
  manager.dnsFor = (dnsId, groupId) =>
    dns.resolverFor(dnsId, groupId ? groups.dnsOf(groupId) : undefined)
  handle('getDns', async () => {
    await dns.loaded
    return dns.get()
  })
  handle('saveDns', async (_event, input) => dns.save(input))
  handle('removeDns', async (_event, id) => dns.remove(id))
  handle('setDefaultDns', async (_event, id) => dns.setDefault(id))
  handle('setDownloadDns', async (_event, id, dnsId) => {
    if (dnsId !== null && typeof dnsId !== 'string') throw new Error('Not a DNS server id.')
    if (dnsId && dnsId !== SYSTEM_DNS) void dns.touch(dnsId)
    manager.setDnsFor(id, dnsId)
  })
  // A group may run fewer files at once than the general limit lets it.
  manager.groupLimitOf = (id) => groups.limitOf(id)
  const autoScheduler = new AutoScheduler(manager, groups, networks)
  void groups.loaded.then(() => autoScheduler.run())

  /** Adds files to a group: a manual group's start at once, an auto group's wait for a network. */
  const addToGroup = async (id: string, requests: StartDownloadRequest[]): Promise<string[]> => {
    const group = groups.get(id)
    if (!group) throw new Error('This group no longer exists.')
    if (group.mode === 'auto') {
      groups.addPending(id, requests)
      autoScheduler.activate(id)
      return []
    }
    const failed: string[] = []
    for (const request of requests) {
      try {
        await manager.start({
          ...request,
          // A general rule gives every file the group's networks.
          ...(group.rule === 'general' ? { interfaceIds: group.interfaceIds } : {}),
          destinationDir: group.destinationDir,
          groupId: id,
          groupLane: false
        })
      } catch (error) {
        failed.push(`${request.suggestedFileName}: ${describeError(error)}`)
      }
    }
    return failed
  }

  handle('listInterfaces', () => networks.refresh())

  handle('pingInterfaces', async () => measureLatencies(networks.selectable()))

  // Started now so it has settled before the first ping or download needs it.
  const bindingSupport = deviceBindingSupported()
  handle('deviceBindingSupported', async () => bindingSupport)

  // The app only ever assigns 'light'/'dark' to nativeTheme.themeSource (main/index.ts's startup
  // call to loadThemeSource() never resolves to 'system') — narrow Electron's wider type here
  // rather than widening our own ThemeSource just to match it.
  const currentThemeSource = (): ThemeSource =>
    nativeTheme.themeSource === 'dark' ? 'dark' : 'light'

  const applySettings = async (patch: AppSettings): Promise<void> => {
    // The one setting main also applies — before saving, so a failed write still switches the
    // window to the theme the toggle now shows.
    if (patch?.themeSource === 'light' || patch?.themeSource === 'dark') {
      nativeTheme.themeSource = patch.themeSource
    }
    log.info('settings', 'changed', { keys: Object.keys(patch ?? {}) })
    if (patch && 'useVpn' in patch) log.info('action', `use VPN ${patch.useVpn ? 'on' : 'off'}`)
    await saveSettings(patch)
    // Read back rather than taken from the patch: what was saved is what passed the checks.
    const saved = await loadSettings()
    networks.useVpn = saved.useVpn ?? false
    manager.applySettings(saved)
    await applyBehavior(saved)
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IpcChannels.settingsChanged, {
        downloadsAtOnce: saved.downloadsAtOnce ?? DOWNLOADS_AT_ONCE.default,
        speedLimit: saved.speedLimit,
        slowMode: saved.slowMode ?? false,
        slowModeSpeed: saved.slowModeSpeed ?? DEFAULT_SLOW_MODE_SPEED,
        useVpn: saved.useVpn ?? false
      } satisfies SettingsPush)
    }
  }
  handle('updateSettings', async (_event, patch) => applySettings(patch))

  // Answered via sendSync from the preload, which blocks the page until returnValue is set — so a
  // throw here must still reply (with no saved values) rather than leave the window never showing.
  ipcMain.on(IpcChannels.getInitialState, async (event) => {
    try {
      const settings = await loadSettings()
      const { destinationDir } = settings
      // Capped: a folder on a dropped network share can take many seconds to answer, and launch
      // waits on this reply — past the cap it's treated as gone and Downloads is used instead.
      const destinationExists =
        destinationDir !== undefined &&
        (await Promise.race([
          stat(destinationDir).then(
            (stats) => stats.isDirectory(),
            () => false
          ),
          new Promise<boolean>((resolve) => setTimeout(resolve, DESTINATION_CHECK_MS, false))
        ]))
      event.returnValue = {
        appName: appVariant().name,
        homeDir: getHomeDir(),
        downloadsDir: getDefaultDownloadsDir(),
        themeSource: currentThemeSource(),
        networkPreferences: settings.networkPreferences ?? {},
        downloadsAtOnce: settings.downloadsAtOnce ?? DOWNLOADS_AT_ONCE.default,
        speedLimit: settings.speedLimit,
        slowMode: settings.slowMode ?? false,
        slowModeSpeed: settings.slowModeSpeed ?? DEFAULT_SLOW_MODE_SPEED,
        useVpn: settings.useVpn ?? false,
        destinationDir: destinationExists ? destinationDir : undefined,
        version: app.getVersion(),
        prefs: prefsOf(settings),
        labEnabled: !app.isPackaged
      } satisfies InitialState
    } catch (error) {
      console.error('[lightning] failed to read initial state', error)
      // No getPath() here — it may be what threw. An empty destination just keeps Start disabled.
      event.returnValue = {
        homeDir: '',
        downloadsDir: '',
        themeSource: currentThemeSource(),
        networkPreferences: {},
        downloadsAtOnce: DOWNLOADS_AT_ONCE.default,
        slowMode: false,
        slowModeSpeed: DEFAULT_SLOW_MODE_SPEED,
        useVpn: false,
        version: app.getVersion(),
        prefs: prefsOf({}),
        labEnabled: !app.isPackaged
      } satisfies InitialState
    }
  })

  handle('openNetworkSettings', async () => {
    await openNetworkSettings()
  })

  handle('probeUrl', async (_event, url) => probeUrl(url))

  handle('chooseDestinationFolder', async (_event, defaultPath) => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handle('chooseTorrentFile', async () => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handle('takePendingLink', async () => takePendingLink())

  handle('readClipboardText', async () => clipboard.readText())

  handle('readLog', async (_event, limit) => {
    const count = Number.isFinite(limit) ? Math.trunc(limit) : 0
    return readLog(Math.min(Math.max(count, 1), 10_000))
  })
  handle('openLogFolder', async () => {
    const path = logFilePath()
    if (path) shell.showItemInFolder(path)
  })
  handle('clearLog', async () => {
    clearLog()
    log.info('app', 'log cleared by the user')
  })
  handle('diagnosticReport', async () =>
    diagnosticReport({
      networks: (await networks.refresh()).slice(),
      statuses: manager.liveStates().map((state) => state.status),
      history: await listHistory()
    })
  )
  handle('findDuplicates', async (_event, urls, destinationDir, options) =>
    findDuplicates(
      await manager.knownDownloads(),
      await groups.loaded.then(() => groups.list()),
      urls,
      destinationDir,
      options
    )
  )

  handle('openLogs', async () => {
    const path = logFilePath()
    if (path) shell.showItemInFolder(path)
  })

  handle('revealDownload', async (_event, id) => manager.reveal(id))

  // Only a download Lightning knows can be opened: the window sends an id, never a path to run.
  handle('openDownloadedFile', async (_event, id) => {
    const path =
      (await findInHistory(id))?.destinationPath ??
      (await manager.listDownloads()).find((entry) => entry.state.id === id)?.state.destinationPath
    if (!path) throw new Error('That download is no longer listed.')
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  })

  handle('startDownload', async (_event, request) => {
    requireAbsolutePath(request?.destinationDir, 'The destination folder')
    if (
      !Array.isArray(request.interfaceIds) ||
      !request.interfaceIds.every((id) => typeof id === 'string')
    ) {
      throw new Error('The networks must be a list of ids.')
    }
    log.info('action', 'new download', {
      url: redactUrl(request.url),
      kind: request.kind,
      group: request.groupId
    })
    return manager.start(request)
  })

  handle('listDownloads', async () => manager.listDownloads())

  handle('listHistory', async () => listHistory())

  handle('updateHistory', async (_event, id, fileName) => manager.updateHistory(id, fileName))

  handle('listGroups', async () => {
    await groups.loaded
    groups.prune(await manager.groupIdsInUse())
    return groups.list()
  })

  const createGroup = async (
    input: CreateGroupInput
  ): Promise<{ group: GroupInfo; failed: string[] }> => {
    await groups.loaded
    const created = groups.create({ ...input, fileCount: input.requests.length })
    log.info('action', `group created ${created.name}`, {
      id: created.id,
      files: input.requests.length,
      mode: input.mode
    })
    const failed = await addToGroup(created.id, input.requests)
    const group = groups.get(created.id)
    if (!group) throw new Error('The group could not be created.')
    return { group, failed }
  }

  /** Every unfinished file of a manual group with a general rule runs on exactly the group's
   * networks: the new ones are switched on first, so a file is never left with none. */
  const applyGroupNetworks = async (group: GroupInfo): Promise<void> => {
    const wanted = new Set(group.interfaceIds)
    for (const state of manager.groupDownloads(group.id)) {
      if (state.status !== 'downloading' && state.status !== 'queued' && state.status !== 'paused')
        continue
      const enabled = state.networks.filter((network) => network.enabled).map((n) => n.id)
      for (const networkId of wanted) {
        if (!enabled.includes(networkId)) {
          await manager.setNetworkEnabled(state.id, networkId, true).catch(() => {})
        }
      }
      for (const networkId of enabled) {
        if (!wanted.has(networkId)) {
          await manager.setNetworkEnabled(state.id, networkId, false).catch(() => {})
        }
      }
    }
    groups.setPendingNetworks(group.id, group.interfaceIds)
  }

  const updateGroup = async (id: string, patch: GroupPatch): Promise<void> => {
    log.info('action', 'group edited', { id, ...patch })
    const before = groups.get(id)
    // Going to Auto without saying which networks: it may use every one there is now, not the
    // few the group was made with.
    if (patch.mode === 'auto' && before?.mode !== 'auto' && !patch.interfaceIds) {
      const ids = networks.selectable().map((iface) => iface.id)
      if (ids.length > 0) patch = { ...patch, interfaceIds: ids }
    }
    groups.update(id, patch)
    const group = groups.get(id)
    if (!group) return
    if (group.mode === 'manual' && group.rule === 'general') {
      if (patch.mode || patch.rule || patch.interfaceIds) await applyGroupNetworks(group)
    }
    if (patch.mode === 'manual') await autoScheduler.startPending(group)
    else if (patch.mode === 'auto') autoScheduler.activate(id)
    if (patch.maxAtOnce !== undefined) manager.rebalance()
  }

  const removeGroup = async (
    id: string,
    options?: IpcContract['removeGroup']['args'][1]
  ): Promise<void> => {
    log.info('action', 'group removed', { id, ...options })
    const group = groups.get(id)
    autoScheduler.forget(id)
    groups.remove(id)
    await manager.removeGroupDownloads(id, options)
    // The folder Lightning made for the group goes too, once nothing is left in it (rmdir refuses
    // a folder that still holds anything).
    if (options?.removeFolder && group?.ownsFolder)
      await rmdir(group.destinationDir).catch(() => {})
  }

  handle('createGroup', async (_event, input) => createGroup(input))
  handle('updateGroup', async (_event, id, patch) => updateGroup(id, patch))
  handle('removeGroup', async (_event, id, options) => removeGroup(id, options))

  handle('addGroupItems', async (_event, id, requests) => ({
    failed: await addToGroup(id, requests)
  }))

  handle('setGroupFileChoice', async (_event, id, fileId, networks) =>
    groups.choose(id, fileId, networks)
  )

  handle('removeGroupItem', async (_event, id, itemId) => groups.removePending(id, itemId))

  handle('clearHistory', async () => manager.clearHistory())

  handle('networkUsage', async () => manager.limits.usedByPeriod())
  handle('resetNetworkUsage', async (_event, id) => manager.resetNetworkUsage(id))

  handle('freeSpace', async (_event, dir) =>
    typeof dir === 'string' && isAbsolute(dir) ? freeSpace(dir) : null
  )

  handle('torrentFiles', async (_event, id) => manager.torrentFiles(id))
  handle('chooseTorrentFiles', async (_event, id, selected) =>
    manager.chooseTorrentFiles(id, selected)
  )

  handle('pauseDownload', async (_event, id) => {
    log.info('action', 'pause', { id })
    await manager.pause(id)
  })

  handle('resumeDownload', async (_event, id) => {
    log.info('action', 'resume / retry', { id })
    manager.resume(id)
  })

  handle('relinkDownload', async (_event, id, url) => {
    log.info('action', 'fix link', { id, url: redactUrl(url) })
    return manager.relink(id, url)
  })

  handle('setDownloadNetwork', async (_event, id, networkId, enabled) => {
    await manager.setNetworkEnabled(id, networkId, enabled)
  })

  handle('cancelDownload', async (_event, id) => {
    log.info('action', 'cancel', { id })
    return manager.cancel(id)
  })

  handle('removeDownload', async (_event, id, options) => {
    log.info('action', 'remove', { id, ...options })
    return manager.remove(id, options?.trashFile === true, options?.keepEntry === true)
  })

  // Kicked off once at startup, not per-call — later renderer calls (e.g. a remount) just await
  // the same in-flight/settled check instead of re-hitting the GitHub API.
  const updateCheckPromise = (async () => {
    log.info('update', 'checking for a newer version')
    const info = testKnobs.forceUpdateVersion
      ? { version: testKnobs.forceUpdateVersion, url: UPDATE_PAGE_URL }
      : await checkForUpdate(app.getVersion())
    log.info('update', info ? `newer version ${info.version} found` : 'up to date')
    return info
  })()

  // Dismissal is read per call, not cached with the check — a reload after "Not now" must not
  // bring the dialog back.
  handle('checkForUpdate', async () => {
    const info = await updateCheckPromise
    if (!info) return null
    const { dismissedUpdateVersion } = await loadSettings()
    return { ...info, dismissed: info.version === dismissedUpdateVersion }
  })

  handle('checkForUpdateNow', async () => {
    log.info('update', 'checking for a newer version (asked for)')
    try {
      const info = testKnobs.forceUpdateVersion
        ? { version: testKnobs.forceUpdateVersion, url: UPDATE_PAGE_URL }
        : await checkForUpdate(app.getVersion(), true)
      log.info('update', info ? `newer version ${info.version} found` : 'up to date')
      return { ok: true, update: info ? { ...info, dismissed: false } : null }
    } catch (error) {
      log.warn('update', 'check failed', { error: String(error) })
      return { ok: false, update: null }
    }
  })

  // Not in a packaged build: the lab can rewrite settings and the network list.
  if (!app.isPackaged) {
    // The Test lab (title bar's Debug button) drives the app through the same operations as above.
    const lab = new Lab({
      manager,
      groups,
      networks,
      readSettings: loadSettings,
      resetPlanner: () => autoScheduler.forgetBaselines(),
      ops: {
        applySettings,
        createGroup,
        updateGroup,
        removeGroup: (id) => removeGroup(id),
        addGroupItems: async (id, requests) => ({ failed: await addToGroup(id, requests) }),
        setGroupFileChoice: async (id, fileId, chosen) => groups.choose(id, fileId, chosen),
        // What the window's Resume does for a group: its paused files go on, and an auto group's
        // planner is let loose on the files still waiting.
        resumeGroup: async (id) => {
          autoScheduler.activate(id)
          for (const state of manager.groupDownloads(id)) {
            if (state.status === 'paused') manager.resume(state.id)
          }
        }
      },
      push: () => {
        const window = getWindow()
        if (window && !window.isDestroyed()) {
          window.webContents.send(IpcChannels.labEvent, { kind: 'state', state: lab.getState() })
        }
      }
    })
    handle('labList', async () => lab.list())
    handle('labGetState', async () => lab.getState())
    handle('labRun', async (_event, planId) => lab.run(planId))
    handle('labRunAll', async () => lab.runAll())
    handle('labVerify', async (_event, planId) => lab.verify(planId))
    handle('labStop', async () => lab.stop())
  }

  return manager
}
