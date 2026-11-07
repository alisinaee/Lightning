import type { DownloadState, FinishedDownload, RequestExtras } from '@shared/types'
import { useEffect, useState } from 'react'
import { AppSidebar } from './components/AppSidebar'
import { FirstRunIntro } from './components/FirstRunIntro'
import { OnboardingTour } from './components/OnboardingTour'
import { SimBanner } from './components/lab/SimBanner'
import { TestLab } from './components/lab/TestLab'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { GroupDialog } from './components/GroupDialog'
import { MultiLinkDialog } from './components/MultiLinkDialog'
import { NewDownloadDialog } from './components/NewDownloadDialog'
import { SettingsDialog, type SettingsPage } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import { TelegramAddDialog } from './components/telegram/TelegramAddDialog'
import { TelegramExportDialog } from './components/telegram/TelegramExportDialog'
import { TelegramLoginDialog } from './components/telegram/TelegramLoginDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useLabEvents } from './hooks/useLabEvents'
import { useTelegramEvents } from './hooks/useTelegramEvents'
import { useYoutubeEvents } from './hooks/useYoutubeEvents'
import { useNetworkEvents } from './hooks/useNetworks'
import { useNewDownloadShortcuts, useOpenedLinks } from './hooks/useOpenedLinks'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { TelegramScreen } from './screens/TelegramScreen'
import { YouTubeScreen } from './screens/YouTubeScreen'
import { useYoutubeStore } from './store/useYoutubeStore'
import { useTelegramStore } from './store/useTelegramStore'
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

/** The download shown, or the list. Only this re-renders on a progress update: App, the title
 * bar, the status bar and the dialogs around it don't. */
function CurrentScreen({
  onOpenSettings
}: {
  onOpenSettings: (page?: SettingsPage) => void
}): React.JSX.Element {
  // Just the one shown: an update to any other download leaves this selector's result alone.
  // A download that's gone (removed, deleted) leaves the list showing.
  const shown = useAppStore((store) => {
    const { view } = store
    if (view.name !== 'download') return null
    return store.downloads[view.id] ?? store.history.find((entry) => entry.id === view.id) ?? null
  })
  const viewName = useAppStore((store) => store.view.name)

  if (viewName === 'telegram') return <TelegramScreen onOpenSettings={onOpenSettings} />
  if (viewName === 'youtube') return <YouTubeScreen onOpenSettings={onOpenSettings} />

  const cancelled = shown && !('unitsWritten' in shown) && shown.status === 'cancelled'
  return shown && !cancelled ? (
    renderDownload(shown)
  ) : (
    <DownloadsScreen onOpenSettings={onOpenSettings} />
  )
}

function App(): React.JSX.Element {
  useDownloadEvents()
  useOpenedLinks()
  useNewDownloadShortcuts()
  useNetworkEvents()
  useLabEvents()
  useTelegramEvents()
  useYoutubeEvents()

  const checkForUpdate = useAppStore((store) => store.checkForUpdate)
  const sidebarHidden = useAppStore((store) => store.sidebarHidden)
  const sectionName = useAppStore((store) => store.view.name)
  // Telegram and YouTube each take their own brand accent inside their tab. It is set on the
  // root so dialogs, which render outside this tree, pick it up too.
  const sectionAccent =
    sectionName === 'telegram' ? '#229ed9' : sectionName === 'youtube' ? '#e53935' : undefined
  useEffect(() => {
    const root = document.documentElement.style
    if (!sectionAccent) return
    root.setProperty('--color-accent', sectionAccent)
    root.setProperty('--color-accent-onsolid', '#ffffff')
    return () => {
      root.removeProperty('--color-accent')
      root.removeProperty('--color-accent-onsolid')
    }
  }, [sectionAccent])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Each open gets a new key, so the dialog starts on the page asked for (General by default).
  const [settingsRequest, setSettingsRequest] = useState<{ id: number; page?: SettingsPage }>({
    id: 0
  })
  const openSettings = (page?: SettingsPage): void => {
    setSettingsRequest((previous) => ({ id: previous.id + 1, page }))
    setSettingsOpen(true)
  }

  useEffect(() => {
    window.lightning.setZoom(window.lightning.initialState.prefs.uiScale)
    document.documentElement.dataset.accent = window.lightning.initialState.prefs.accent
    checkForUpdate()
  }, [checkForUpdate])

  useEffect(() => {
    return window.lightning.onAppCommand((command, argument) => {
      const store = useAppStore.getState()
      if (command === 'new-download') store.openNewDownload()
      else if (command === 'youtube-link') {
        // From the clipboard: a YouTube link to choose a quality for in the add dialog.
        store.setView({ name: 'youtube' })
        if (argument) useYoutubeStore.getState().openLink(argument)
      } else if (command === 'youtube-offer') {
        // From the browser extension: a video to confirm in the YouTube add dialog before it downloads.
        store.setView({ name: 'youtube' })
        try {
          const parsed = JSON.parse(argument ?? '') as {
            id?: unknown
            url?: unknown
            title?: unknown
          }
          if (typeof parsed.id === 'string' && typeof parsed.url === 'string') {
            useYoutubeStore.getState().openOffer({
              id: parsed.id,
              url: parsed.url,
              title: typeof parsed.title === 'string' ? parsed.title : parsed.url
            })
          }
        } catch {
          // A malformed offer is ignored; the person can still paste the link.
        }
      } else if (command === 'several-links') {
        // From the browser extension: the links it found on the page, with its cookies.
        let seed: { links: string[]; extras?: RequestExtras } | undefined
        try {
          const parsed: unknown = argument ? JSON.parse(argument) : null
          if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { links?: unknown }).links)
          ) {
            seed = parsed as { links: string[]; extras?: RequestExtras }
          }
        } catch {
          seed = undefined
        }
        store.openMultiLinks(seed)
      } else if (command === 'telegram-links') {
        // From the clipboard offer: the Telegram message links that were copied.
        let links: string[] = []
        try {
          const parsed: unknown = argument ? JSON.parse(argument) : null
          const found = (parsed as { links?: unknown } | null)?.links
          if (Array.isArray(found)) links = found.filter((link) => typeof link === 'string')
        } catch {
          links = []
        }
        store.setView({ name: 'telegram', kind: null })
        useTelegramStore.getState().openAdd(links)
      } else if (command === 'open-telegram') store.setView({ name: 'telegram', kind: null })
      else if (command === 'settings') openSettings()
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

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <FirstRunIntro />
        <OnboardingTour />
        <SimBanner />
        <div className="flex min-h-0 flex-1">
          {!sidebarHidden && <AppSidebar />}
          <div
            key={
              sectionName === 'telegram' || sectionName === 'youtube' ? sectionName : 'downloads'
            }
            className="lightning-screen min-h-0 min-w-0 flex-1"
          >
            <CurrentScreen onOpenSettings={openSettings} />
          </div>
        </div>
        <StatusBar />
        <NewDownloadDialog />
        <MultiLinkDialog />
        <GroupDialog />
        <TelegramAddDialog />
        <TelegramExportDialog />
        <TelegramLoginDialog />
        <UpdateDialog />
        <SettingsDialog
          key={settingsRequest.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialPage={settingsRequest.page}
        />
        <NetworkBindingDialog />
        {window.lightning.initialState.labEnabled && <TestLab />}
      </div>
    </TooltipProvider>
  )
}

export default App
