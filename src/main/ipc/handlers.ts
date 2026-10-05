import { stat, statfs } from 'node:fs/promises'
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
import { log, logFilePath } from '../logger'
import { loadSettings, saveSettings } from '../settings'
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
 * IpcContract, so a handler here that doesn't match what plexoApi (preload) actually calls is a
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
    await saveSettings(patch)
    // Read back rather than taken from the patch: what was saved is what passed the checks.
    const saved = await loadSettings()
    networks.useVpn = saved.useVpn ?? false
    manager.applySettings(saved)
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
        homeDir: getHomeDir(),
        downloadsDir: getDefaultDownloadsDir(),
        themeSource: currentThemeSource(),
        networkPreferences: settings.networkPreferences ?? {},
        downloadsAtOnce: settings.downloadsAtOnce ?? DOWNLOADS_AT_ONCE.default,
        speedLimit: settings.speedLimit,
        slowMode: settings.slowMode ?? false,
        slowModeSpeed: settings.slowModeSpeed ?? DEFAULT_SLOW_MODE_SPEED,
        useVpn: settings.useVpn ?? false,
        destinationDir: destinationExists ? destinationDir : undefined
      } satisfies InitialState
    } catch (error) {
      console.error('[plexo] failed to read initial state', error)
      // No getPath() here — it may be what threw. An empty destination just keeps Start disabled.
      event.returnValue = {
        homeDir: '',
        downloadsDir: '',
        themeSource: currentThemeSource(),
        networkPreferences: {},
        downloadsAtOnce: DOWNLOADS_AT_ONCE.default,
        slowMode: false,
        slowModeSpeed: DEFAULT_SLOW_MODE_SPEED,
        useVpn: false
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

  handle('openLogs', async () => {
    const path = logFilePath()
    if (path) shell.showItemInFolder(path)
  })

  handle('revealDownload', async (_event, id) => manager.reveal(id))

  // Only a download Plexo knows can be opened: the window sends an id, never a path to run.
  handle('openDownloadedFile', async (_event, id) => {
    const path =
      (await findInHistory(id))?.destinationPath ??
      (await manager.listDownloads()).find((entry) => entry.state.id === id)?.state.destinationPath
    if (!path) throw new Error('That download is no longer listed.')
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  })

  handle('startDownload', async (_event, request) => manager.start(request))

  handle('listDownloads', async () => manager.listDownloads())

  handle('listHistory', async () => listHistory())

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
    const failed = await addToGroup(created.id, input.requests)
    const group = groups.get(created.id)
    if (!group) throw new Error('The group could not be created.')
    return { group, failed }
  }

  const updateGroup = async (id: string, patch: GroupPatch): Promise<void> => {
    groups.update(id, patch)
    const group = groups.get(id)
    if (!group) return
    if (patch.mode === 'manual') await autoScheduler.startPending(group)
    else if (patch.mode === 'auto') autoScheduler.activate(id)
  }

  const removeGroup = async (id: string, options?: { trashFiles?: boolean }): Promise<void> => {
    autoScheduler.forget(id)
    groups.remove(id)
    await manager.removeGroupDownloads(id, options?.trashFiles === true)
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

  handle('freeSpace', async (_event, dir) => freeSpace(dir))

  handle('torrentFiles', async (_event, id) => manager.torrentFiles(id))
  handle('chooseTorrentFiles', async (_event, id, selected) =>
    manager.chooseTorrentFiles(id, selected)
  )

  handle('pauseDownload', async (_event, id) => {
    await manager.pause(id)
  })

  handle('resumeDownload', async (_event, id) => {
    manager.resume(id)
  })

  handle('relinkDownload', async (_event, id, url) => manager.relink(id, url))

  handle('setDownloadNetwork', async (_event, id, networkId, enabled) => {
    await manager.setNetworkEnabled(id, networkId, enabled)
  })

  handle('cancelDownload', async (_event, id) => manager.cancel(id))

  handle('removeDownload', async (_event, id, options) =>
    manager.remove(id, options?.trashFile === true)
  )

  // Kicked off once at startup, not per-call — later renderer calls (e.g. a remount) just await
  // the same in-flight/settled check instead of re-hitting the GitHub API.
  const updateCheckPromise = (async () => {
    const info = testKnobs.forceUpdateVersion
      ? { version: testKnobs.forceUpdateVersion, url: UPDATE_PAGE_URL }
      : await checkForUpdate(app.getVersion())
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

  return manager
}
