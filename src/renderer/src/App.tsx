import type { DownloadState, FinishedDownload } from '@shared/types'
import { useEffect, useState } from 'react'
import { SimBanner } from './components/lab/SimBanner'
import { TestLab } from './components/lab/TestLab'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { GroupDialog } from './components/GroupDialog'
import { MultiLinkDialog } from './components/MultiLinkDialog'
import { NewDownloadDialog } from './components/NewDownloadDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useLabEvents } from './hooks/useLabEvents'
import { useNetworkEvents } from './hooks/useNetworks'
import { useNewDownloadShortcuts, useOpenedLinks } from './hooks/useOpenedLinks'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { useLogsStore } from './store/useLogsStore'
import { useAppStore } from './store/useAppStore'

function assertNever(status: never): never {
  throw new Error(`Unhandled download status: ${String(status)}`)
}

/** One screen per download.status — a switch with an assertNever default so a new
 * DownloadStatus value is a compile error here instead of silently falling into whichever branch
 * happened to be last. */
function renderDownload(download: DownloadState | FinishedDownload): React.JSX.Element {
  if ('unitsWritten' in download) return <CompleteScreen download={download} />
  switch (download.status) {
    case 'queued':
    case 'downloading':
    case 'paused':
      return <DownloadingScreen download={download} />
    case 'completed':
      return <CompleteScreen download={download} />
    case 'error':
    case 'cancelled':
      return <ErrorScreen download={download} />
    default:
      return assertNever(download.status)
  }
}

function App(): React.JSX.Element {
  useDownloadEvents()
  useOpenedLinks()
  useNewDownloadShortcuts()
  useNetworkEvents()
  useLabEvents()

  const downloads = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const view = useAppStore((store) => store.view)
  const checkForUpdate = useAppStore((store) => store.checkForUpdate)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.lightning.setZoom(window.lightning.initialState.prefs.uiScale)
    document.documentElement.dataset.accent = window.lightning.initialState.prefs.accent
    checkForUpdate()
  }, [checkForUpdate])

  useEffect(() => {
    return window.lightning.onAppCommand((command, argument) => {
      const store = useAppStore.getState()
      if (command === 'new-download') store.openNewDownload()
      else if (command === 'several-links') store.openMultiLinks()
      else if (command === 'settings') setSettingsOpen(true)
      else if (command === 'open-download' && argument)
        store.setView({ name: 'download', id: argument })
      else if (command === 'check-update') {
        // A check the person asked for from the menu: it says what it found.
        void store.checkForUpdateNow().then((result) => {
          if (result === 'available') {
            useAppStore.setState((state) => ({
              availableUpdate: state.availableUpdate && {
                ...state.availableUpdate,
                dismissed: false
              }
            }))
          } else {
            window.alert(
              result === 'current'
                ? `You have the latest version (${window.lightning.initialState.version}).`
                : 'Couldn’t reach GitHub. Check your connection and try again.'
            )
          }
        })
      } else if (command === 'logs') useLogsStore.getState().setOpen(true)
      else if (command === 'pause-all' || command === 'resume-all') {
        for (const download of Object.values(store.downloads)) {
          if (
            command === 'pause-all' &&
            (download.status === 'downloading' || download.status === 'queued')
          ) {
            void window.lightning.pauseDownload(download.id)
          }
          if (command === 'resume-all' && download.status === 'paused') {
            void window.lightning.resumeDownload(download.id)
          }
        }
      }
    })
  }, [])

  // A download that's gone (removed, deleted) leaves the list showing.
  const shown =
    view.name === 'download'
      ? (downloads[view.id] ?? history.find((entry) => entry.id === view.id) ?? null)
      : null
  const cancelled = shown && !('unitsWritten' in shown) && shown.status === 'cancelled'

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <SimBanner />
        <div className="min-h-0 flex-1">
          {shown && !cancelled ? (
            renderDownload(shown)
          ) : (
            <DownloadsScreen onOpenSettings={() => setSettingsOpen(true)} />
          )}
        </div>
        <StatusBar />
        <NewDownloadDialog />
        <MultiLinkDialog />
        <GroupDialog />
        <UpdateDialog />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <NetworkBindingDialog />
        {window.lightning.initialState.labEnabled && <TestLab />}
      </div>
    </TooltipProvider>
  )
}

export default App
