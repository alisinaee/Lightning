import type { IntegrationInfo } from '@shared/types'
import { useEffect, useState } from 'react'
import { describeError } from '../utils/format'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'

/** The Browser page of Settings: the extension's switch, its pairing key, and where its files are. */
export function BrowserPage({
  enabled,
  onEnabledChange
}: {
  enabled: boolean
  onEnabledChange: (on: boolean) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<IntegrationInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The server starts a moment after it is switched on: asked again once it has had it.
    const timer = setTimeout(
      () =>
        void window.lightning
          .getIntegration()
          .then(setInfo)
          .catch((cause) => setError(describeError(cause))),
      enabled ? 300 : 0
    )
    return () => clearTimeout(timer)
  }, [enabled])

  const copy = async (): Promise<void> => {
    if (!info) return
    await navigator.clipboard.writeText(info.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <label className="flex items-start gap-3 py-1.5 leading-5">
        <Checkbox checked={enabled} onCheckedChange={(on) => onEnabledChange(on === true)} />
        <span>Let the browser extension send links to Lightning</span>
      </label>
      <p className="text-[12px] leading-snug text-muted-foreground">
        Lightning listens on this computer only (127.0.0.1) and answers only the extension, and only
        with the key below. Install the extension from the folder, then paste the key into it once.
      </p>
      <div className="text-[12.5px]">
        {info?.port ? (
          <span>
            Listening on <span className="font-mono">127.0.0.1:{info.port}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{enabled ? 'Starting…' : 'Off'}</span>
        )}
      </div>
      {info && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] text-muted-foreground">Pairing key</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-input px-2.5 py-1.5 font-mono text-[11.5px]">
              {info.key}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void window.lightning
                  .regenerateIntegrationKey()
                  .then((key) => setInfo({ ...info, key }))
                  .catch((cause) => setError(describeError(cause)))
              }
            >
              New key
            </Button>
          </div>
          <div className="text-[12px] text-muted-foreground">
            A new key unpairs any extension that has the old one.
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void window.lightning
              .openExtensionFolder()
              .catch((cause) => setError(describeError(cause)))
          }
        >
          Open the extension folder
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Chrome, Edge, Brave: Extensions → Developer mode → Load unpacked. Firefox: about:debugging
          → Load Temporary Add-on → manifest.json.
        </span>
      </div>
      {error && <div className="text-[12px] text-destructive">{error}</div>}
    </div>
  )
}
