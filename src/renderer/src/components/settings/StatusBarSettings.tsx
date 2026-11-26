import {
  DEFAULT_STATUS_BAR,
  TRAY_BUTTONS_MAX,
  type StatusBarPrefs,
  type TrayButton
} from '@shared/types'
import { t } from '@shared/i18n/react'
import { Button } from '../ui/button'
import { Row } from './SettingsControls'

const TRAY_BUTTON_LABELS: [TrayButton, string][] = [
  ['new-download', 'New download'],
  ['several-links', 'Several links'],
  ['pause-all', 'Pause all'],
  ['resume-all', 'Resume all'],
  ['show', 'Open Lightning'],
  ['settings', 'Settings'],
  ['vpn', 'VPN on/off'],
  ['slow-mode', 'Slow mode on/off'],
  ['open-folder', 'Open the downloads folder'],
  ['telegram', 'Open Telegram'],
  ['check-update', 'Check for updates'],
  ['logs', 'Show the logs']
]

/** Settings → Status bar: bottom bar items, click menu options, and menu bar tray panel. */
export function StatusBarSettings({
  bar,
  setBar
}: {
  bar: StatusBarPrefs
  setBar: (patch: Partial<StatusBarPrefs>) => void
}): React.JSX.Element {
  return (
    <>
      <div className="ios-note">
        {t(
          'Choose what the bar along the bottom shows, and what the menu holds when you click its count and speed.'
        )}
      </div>
      <div className="ios-title">{t('In the bar')}</div>
      <Row
        checked={bar.showCount}
        onChange={(showCount) => setBar({ showCount })}
        label="How many downloads there are"
      />
      <Row
        checked={bar.showSpeed}
        onChange={(showSpeed) => setBar({ showSpeed })}
        label="The total speed"
      />
      <Row
        checked={bar.showLimit}
        onChange={(showLimit) => setBar({ showLimit })}
        label="The speed limit, when one is set"
      />
      <Row
        checked={bar.showWaiting}
        onChange={(showWaiting) => setBar({ showWaiting })}
        label="How many are waiting"
      />
      <Row
        checked={bar.showNetworks}
        onChange={(showNetworks) => setBar({ showNetworks })}
        label="The speed of each network"
      />
      <Row
        checked={bar.showSlowMode}
        onChange={(showSlowMode) => setBar({ showSlowMode })}
        label="Slow mode"
      />
      <Row
        checked={bar.showClipboard}
        onChange={(showClipboard) => setBar({ showClipboard })}
        label="A switch to track the clipboard"
      />
      <Row
        checked={bar.showFree}
        onChange={(showFree) => setBar({ showFree })}
        label="Free disk space"
      />
      <div className="ios-title">{t('The menu')}</div>
      <Row
        checked={bar.menu}
        onChange={(menu) => setBar({ menu })}
        label="Open a menu of live details when the count and speed are clicked"
      />
      <fieldset disabled={!bar.menu} className={bar.menu ? '' : 'opacity-50'}>
        <Row
          checked={bar.menuGraph}
          onChange={(menuGraph) => setBar({ menuGraph })}
          label="A graph of the speed over the last minute"
          disabled={!bar.menu}
        />
        <Row
          checked={bar.menuTotals}
          onChange={(menuTotals) => setBar({ menuTotals })}
          label="Totals: speed, received, left and time left"
          disabled={!bar.menu}
        />
        <Row
          checked={bar.menuNetworks}
          onChange={(menuNetworks) => setBar({ menuNetworks })}
          label="The speed of each network"
          disabled={!bar.menu}
        />
        <Row
          checked={bar.menuConnections}
          onChange={(menuConnections) => setBar({ menuConnections })}
          label="Connections on each network"
          disabled={!bar.menu || !bar.menuNetworks}
        />
        <Row
          checked={bar.menuDownloads}
          onChange={(menuDownloads) => setBar({ menuDownloads })}
          label="The downloads running now"
          disabled={!bar.menu}
        />
        <Row
          checked={bar.menuQueue}
          onChange={(menuQueue) => setBar({ menuQueue })}
          label="Waiting, paused and failed counts"
          disabled={!bar.menu}
        />
        <Row
          checked={bar.menuDisk}
          onChange={(menuDisk) => setBar({ menuDisk })}
          label="Free disk space and the folder"
          disabled={!bar.menu}
        />
        <label className="ios-row">
          <span className="ios-label">{t('Running downloads listed')}</span>
          <input
            type="number"
            min={1}
            max={12}
            aria-label={t('Running downloads listed')}
            value={bar.menuRows}
            disabled={!bar.menu || !bar.menuDownloads}
            onChange={(event) => {
              const rows = Math.round(Number(event.target.value))
              if (rows >= 1 && rows <= 12) setBar({ menuRows: rows })
            }}
            className="ios-input w-16"
          />
        </label>
      </fieldset>
      <div className="ios-title">{t('Menu bar icon')}</div>
      <div className="ios-note">
        {t('The menu you get from the Lightning icon at the top of the screen.')}
      </div>
      <Row
        checked={bar.trayPanel}
        onChange={(trayPanel) => setBar({ trayPanel })}
        label="Clicking the icon opens a panel with bars and colours, instead of a menu (right-click always gives the menu)"
      />
      <Row
        checked={bar.trayGraph}
        onChange={(trayGraph) => setBar({ trayGraph })}
        label="A speed graph in the panel"
        disabled={!bar.trayPanel}
      />
      <Row
        checked={bar.trayActions}
        onChange={(trayActions) => setBar({ trayActions })}
        label="Quick buttons in the panel: new download, pause all and the rest"
        disabled={!bar.trayPanel}
      />
      <Row
        checked={bar.trayTotals}
        onChange={(trayTotals) => setBar({ trayTotals })}
        label="How many are downloading and the total speed"
      />
      <Row
        checked={bar.trayNetworks}
        onChange={(trayNetworks) => setBar({ trayNetworks })}
        label="The speed and connections of each network"
      />
      <Row
        checked={bar.trayDownloads}
        onChange={(trayDownloads) => setBar({ trayDownloads })}
        label="The downloads running now (click one to open it)"
      />
      <Row
        checked={bar.trayQueue}
        onChange={(trayQueue) => setBar({ trayQueue })}
        label="Waiting, paused and failed counts"
      />
      <div className="ios-title">{t('Panel buttons')}</div>
      <div className="ios-note">
        {t('Up to {max}. You can also drag them into order from the panel (Edit).', {
          max: TRAY_BUTTONS_MAX
        })}
      </div>
      {TRAY_BUTTON_LABELS.map(([id, label]) => {
        const chosen = bar.trayButtons.includes(id)
        return (
          <Row
            key={id}
            checked={chosen}
            onChange={(on) =>
              setBar({
                trayButtons: on
                  ? [...bar.trayButtons, id]
                  : bar.trayButtons.filter((entry) => entry !== id)
              })
            }
            label={label}
            disabled={
              !bar.trayPanel ||
              !bar.trayActions ||
              (!chosen && bar.trayButtons.length >= TRAY_BUTTONS_MAX)
            }
          />
        )
      })}
      <Row
        checked={bar.trayText}
        onChange={(trayText) => setBar({ trayText })}
        label="The total speed as text beside the icon"
      />
      <div className="ios-row">
        <span className="ios-label">{t('Speed unit')}</span>
        <span className="ios-seg">
          {(
            [
              ['auto', 'Auto'],
              ['kb', 'KB/s'],
              ['mb', 'MB/s']
            ] as const
          ).map(([unit, text]) => (
            <button
              key={unit}
              type="button"
              aria-pressed={bar.trayUnit === unit}
              onClick={() => setBar({ trayUnit: unit })}
            >
              {t(text)}
            </button>
          ))}
        </span>
      </div>
      <label className="ios-row">
        <span className="ios-label">{t('Running downloads listed')}</span>
        <input
          type="number"
          min={1}
          max={10}
          aria-label={t('Menu bar downloads listed')}
          value={bar.trayRows}
          disabled={!bar.trayDownloads}
          onChange={(event) => {
            const rows = Math.round(Number(event.target.value))
            if (rows >= 1 && rows <= 10) setBar({ trayRows: rows })
          }}
          className="ios-input w-16"
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2 self-start"
        onClick={() => setBar(DEFAULT_STATUS_BAR)}
      >
        {t('Reset to the defaults')}
      </Button>
    </>
  )
}
