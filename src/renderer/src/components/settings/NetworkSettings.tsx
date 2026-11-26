import { useState } from 'react'
import { CaretRight, Check } from '@phosphor-icons/react'
import { isProxyAddress } from '@shared/networks'
import { t } from '@shared/i18n/react'
import { describeVpn, useVpnLayer } from '../../hooks/useConnections'
import { useNetworkVisuals } from '../../hooks/useNetworkVisuals'
import { Switch } from '../ui/switch'
import type { SettingsSectionProps } from './SettingsControls'

function ProxyField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  // What is typed stays here until Enter or leaving the field: applying a proxy on every
  // keystroke would try half-typed addresses. Only an address that is valid (or empty) is saved.
  const [draft, setDraft] = useState(value)
  const text = draft.trim()
  const invalid = text !== '' && !isProxyAddress(text)
  const commit = (): void => {
    if (invalid) return
    if (text !== value) onChange(text)
  }
  return (
    <label className="ios-row" data-setting={label}>
      <span className="ios-label">{label}</span>
      <input
        value={draft}
        dir="ltr"
        placeholder="host:port"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        className="ios-input w-44 font-mono aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]"
      />
      {invalid && (
        <span className="text-[11.5px] text-[var(--color-danger)]">{t('Not an address')}</span>
      )}
    </label>
  )
}

function VpnSetting(): React.JSX.Element {
  const { detected, on, tunnels, setOn } = useVpnLayer()
  const visual = useNetworkVisuals()
  const names = tunnels.map((tunnel) => visual(tunnel.id, tunnel.kind, tunnel.displayName).name)
  return (
    <div className="ios-row">
      <div className="ios-label">
        <div>VPN</div>
        <div className="ios-hint">
          {detected ? describeVpn(on, names) : t('No VPN detected on this computer.')}
        </div>
      </div>
      <Switch
        aria-label={t('Use VPN for downloads')}
        checked={on}
        disabled={!detected}
        onCheckedChange={setOn}
      />
    </div>
  )
}

/** Settings → Network: VPN, speed/data limits shortcut, app proxy, and stall timeout. */
export function NetworkSettings({ prefs, save }: SettingsSectionProps): React.JSX.Element {
  return (
    <>
      <VpnSetting />
      <button
        type="button"
        className="ios-row text-start"
        onClick={() => {
          void window.lightning.runMainCommand('limits')
        }}
      >
        <span className="ios-label">{t('Speed and data limits')}</span>
        <CaretRight className="size-4 text-muted-foreground rtl:-scale-x-100" />
      </button>
      <div className="ios-title">{t('Proxy')}</div>
      <div className="ios-note">
        {t(
          'For the app’s own requests, such as checking for updates. Downloads connect through the networks you chose and don’t use it.'
        )}
      </div>
      {(
        [
          ['system', 'System proxy'],
          ['direct', 'No proxy'],
          ['manual', 'Configure manually']
        ] as const
      ).map(([mode, label]) => (
        <label key={mode} className="ios-row cursor-pointer">
          <input
            type="radio"
            name="proxy"
            className="sr-only"
            checked={prefs.proxyMode === mode}
            onChange={() => save({ proxyMode: mode })}
          />
          <span className="ios-label">{t(label)}</span>
          {prefs.proxyMode === mode && <Check weight="bold" className="size-4 text-primary" />}
        </label>
      ))}
      {prefs.proxyMode === 'manual' && (
        <div className="flex flex-col gap-3">
          <ProxyField
            label="HTTP"
            value={prefs.proxyHttp}
            onChange={(proxyHttp) => save({ proxyHttp })}
          />
          <ProxyField
            label="HTTPS"
            value={prefs.proxyHttps}
            onChange={(proxyHttps) => save({ proxyHttps })}
          />
          <ProxyField
            label="FTP"
            value={prefs.proxyFtp}
            onChange={(proxyFtp) => save({ proxyFtp })}
          />
          <ProxyField
            label="SOCKS5"
            value={prefs.proxySocks}
            onChange={(proxySocks) => save({ proxySocks })}
          />
        </div>
      )}
      <div className="ios-title">{t('Advanced')}</div>
      <label className="ios-row" data-setting="Stall timeout (seconds)">
        <span className="ios-label">{t('Stall timeout (seconds)')}</span>
        <input
          type="number"
          min={5}
          max={120}
          step={1}
          value={prefs.stallTimeoutSec}
          onChange={(event) => {
            const seconds = Math.floor(Number(event.target.value))
            if (seconds >= 5 && seconds <= 120) save({ stallTimeoutSec: seconds })
          }}
          className="ios-input w-16"
        />
      </label>
      <div className="ios-note">
        {t('How long a connection may go without data before it is retried.')}
      </div>
    </>
  )
}
