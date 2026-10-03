import type { DownloadState, FinishedDownload } from '@shared/types'
import { ChevronLeft } from 'lucide-react'
import { useEffect } from 'react'
import { TitleBar, type TitleBarStatus } from './components/TitleBar'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useNetworkEvents } from './hooks/useNetworks'
import { useOpenedLinks } from './hooks/useOpenedLinks'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { IdleScreen } from './screens/IdleScreen'
import { NoConnectionsScreen } from './screens/NoConnectionsScreen'
import { useAppStore } from './store/useAppStore'

function assertNever(status: never): never {
  throw new Error(`Unhandled download status: ${String(status)}`)
}

/** One screen per download.status — a switch with an assertNever default so a new
 * DownloadStatus value is a compile error here instead of silently falling into whichever branch
 * happened to be last. */
function renderDownload(
  download: DownloadState | FinishedDownload,
  handlers: { onNewDownload: () => void; onDownloadAgain: () => void }
): React.JSX.Element {
  if ('unitsWritten' in download) {
    return <CompleteScreen download={download} onNewDownload={handlers.onNewDownload} />
  }
  switch (download.status) {
    case 'queued':
    case 'downloading':
    case 'paused':
      return <DownloadingScreen download={download} />
    case 'completed':
      return <CompleteScreen download={download} onNewDownload={handlers.onNewDownload} />
    case 'error':
    case 'cancelled':
      return (
        <ErrorScreen
          download={download}
          onNewDownload={handlers.onNewDownload}
          onDownloadAgain={handlers.onDownloadAgain}
        />
      )
    default:
      return assertNever(download.status)
  }
}

/** Above a download's own screen: the way back to the list. */
function BackBar({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center border-b-[0.5px] border-border bg-background px-3 py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-[var(--text-secondary)] hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All downloads
      </button>
    </div>
  )
}

function App(): React.JSX.Element {
  useDownloadEvents()
  useOpenedLinks()
  useNetworkEvents()

  const interfaces = useAppStore((store) => store.interfaces)
  const interfacesStatus = useAppStore((store) => store.interfacesStatus)
  const downloads = useAppStore((store) => store.downloads)
  const history = useAppStore((store) => store.history)
  const view = useAppStore((store) => store.view)
  const setView = useAppStore((store) => store.setView)
  const removeDownload = useAppStore((store) => store.removeDownload)
  const checkForUpdate = useAppStore((store) => store.checkForUpdate)

  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

  const listed = Object.values(downloads).filter((download) => download.status !== 'cancelled')
  const hasList = listed.length > 0 || history.length > 0
  const shown =
    view.name === 'download'
      ? (downloads[view.id] ?? history.find((entry) => entry.id === view.id) ?? null)
      : null

  // Leaving a cancelled download behind removes it: there's nothing left of it to list.
  const leave = (next: Parameters<typeof setView>[0]): void => {
    if (shown && !('unitsWritten' in shown) && shown.status === 'cancelled') {
      removeDownload(shown.id)
    }
    setView(next)
  }

  const handleDownloadAgain = (): void => {
    if (!shown) return
    useAppStore.getState().setDraftUrl(shown.url)
    removeDownload(shown.id)
    setView({ name: 'new' })
  }

  const noConnections = interfacesStatus === 'ready' && interfaces.length === 0
  const running = listed.filter((download) => download.status === 'downloading')

  let screen: React.JSX.Element
  if (shown) {
    screen = (
      <div className="flex h-full flex-col">
        <BackBar onBack={() => leave({ name: 'list' })} />
        <div className="min-h-0 flex-1">
          {renderDownload(shown, {
            onNewDownload: () => leave({ name: 'new' }),
            onDownloadAgain: handleDownloadAgain
          })}
        </div>
      </div>
    )
  } else if (view.name === 'list' && hasList) {
    screen = <DownloadsScreen />
  } else if (noConnections) {
    screen = <NoConnectionsScreen />
  } else {
    screen = (
      <div className="flex h-full flex-col">
        {hasList && <BackBar onBack={() => setView({ name: 'list' })} />}
        <div className="min-h-0 flex-1">
          <IdleScreen />
        </div>
      </div>
    )
  }

  const titleBarStatus: TitleBarStatus = noConnections
    ? { kind: 'offline' }
    : running.length > 0
      ? {
          kind: 'combined',
          networkCount: new Set(
            running.flatMap((download) =>
              download.networks
                .filter((network) => network.status === 'on')
                .map((network) => network.id)
            )
          ).size
        }
      : { kind: 'none' }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar status={titleBarStatus} />
        <div className="min-h-0 flex-1">{screen}</div>
        <UpdateDialog />
        <NetworkBindingDialog />
      </div>
    </TooltipProvider>
  )
}

export default App
