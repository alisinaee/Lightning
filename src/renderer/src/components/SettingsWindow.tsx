import { useEffect } from 'react'
import { reloadSavedSettings } from '../utils/syncSettings'
import { SettingsView, type SettingsPage } from './SettingsDialog'
import { TooltipProvider } from './ui/tooltip'

/** What the Settings window shows: the page named in the address (#settings/Network). */
export function SettingsWindow(): React.JSX.Element {
  const requested = decodeURIComponent(window.location.hash.split('/')[1] ?? '')
  useEffect(() => {
    document.title = 'Settings'
    const { prefs } = window.lightning.initialState
    window.lightning.setZoom(prefs.uiScale)
    document.documentElement.dataset.accent = prefs.accent
    return window.lightning.onSettingsRefresh(reloadSavedSettings)
  }, [])
  return (
    <TooltipProvider>
      <SettingsView initialPage={(requested || undefined) as SettingsPage | undefined} />
    </TooltipProvider>
  )
}
