import type { BrowserInfo, IntegrationInfo } from '@shared/types'
import { useEffect, useState } from 'react'
import { describeError } from '../utils/format'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'

/** The Browser page of Settings: the extension's switch, its pairing key, and where its files are. */
export function BrowserPage({
  enabled,
  onEnabledChange,
  features,
  onFeatureChange
}: {
  enabled: boolean
  onEnabledChange: (on: boolean) => void
  features: { capture: boolean; menuDownload: boolean; menuScan: boolean }
  onFeatureChange: (
    patch: Partial<{
      browserCapture: boolean
      browserMenuDownload: boolean
      browserMenuScan: boolean
    }>
  ) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<IntegrationInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browsers, setBrowsers] = useState<BrowserInfo[] | null>(null)
  // The browser whose extensions page was just opened: its steps show below the buttons.
  const [opened, setOpened] = useState<BrowserInfo | null>(null)

  useEffect(() => {
    void window.lightning
      .listBrowsers()
      .then(setBrowsers)
      .catch(() => setBrowsers([]))
  }, [])

  const addTo = (browser: BrowserInfo): void => {
    setError(null)
    void window.lightning
      .addExtensionToBrowser(browser.id)
      .then(() => setOpened(browser))
      .catch((cause) => setError(describeError(cause)))
  }

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
        with the key below. The extension Lightning sets up already has the key: nothing to paste.
      </p>
      <div className="mt-1 flex flex-col gap-2.5 rounded-xl border-[0.5px] border-border p-3">
        <div className="text-[12px] font-medium text-muted-foreground">Add the extension</div>
        <div className="flex flex-wrap items-center gap-2">
          {browsers?.map((browser) => (
            <Button key={browser.id} type="button" variant="outline" onClick={() => addTo(browser)}>
              {browser.icon && (
                <img src={browser.icon} alt="" className="size-4" draggable={false} />
              )}
              Add to {browser.name}
            </Button>
          ))}
          <Button
            type="button"
            className="bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            onClick={() =>
              void window.lightning
                .openExtensionFolder()
                .then(() => setOpened(null))
                .catch((cause) => setError(describeError(cause)))
            }
          >
            Show the extension folder
          </Button>
        </div>
        {opened && <BrowserSteps guide={guideFor(opened.id)} />}
        <div className="text-[12px] text-muted-foreground">
          The extension is kept in Documents → Lightning Extension, updated with the app, and pairs
          by itself.
        </div>
        <details className="group text-[12px]">
          <summary className="cursor-default list-none text-muted-foreground select-none hover:text-foreground">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Steps
            for every browser
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {GUIDES.map((guide) => (
              <BrowserSteps key={guide.id} guide={guide} titled />
            ))}
          </div>
        </details>
      </div>
      <div className="mt-1 text-[12px] font-medium text-muted-foreground">
        What the extension may do
      </div>
      {(
        [
          [
            'browserCapture',
            features.capture,
            'Take over the browser’s own downloads (the browser downloads normally when off)'
          ],
          [
            'browserMenuDownload',
            features.menuDownload,
            'Right-click a link → Download with Lightning (also several selected links)'
          ],
          [
            'browserMenuScan',
            features.menuScan,
            'Right-click a page → Scan this page with Lightning'
          ]
        ] as const
      ).map(([key, on, label]) => (
        <label key={key} className="flex items-start gap-3 py-1 leading-5">
          <Checkbox
            checked={on}
            disabled={!enabled}
            onCheckedChange={(next) => onFeatureChange({ [key]: next === true })}
          />
          <span className={enabled ? undefined : 'text-muted-foreground'}>{label}</span>
        </label>
      ))}
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
      {error && <div className="text-[12px] text-destructive">{error}</div>}
    </div>
  )
}

interface BrowserGuide {
  id: string
  name: string
  steps: string[]
  note?: string
}

const CHROMIUM_STEPS = (page: string): string[] => [
  `Open ${page} (the Add button does this for you).`,
  'Turn on Developer mode (a switch on that page).',
  'Drag the “Lightning Extension” folder from Finder onto the page, or click Load unpacked and choose it.'
]

/** How to add the extension in each widely used browser. */
const GUIDES: BrowserGuide[] = [
  { id: 'chrome', name: 'Chrome', steps: CHROMIUM_STEPS('chrome://extensions') },
  { id: 'edge', name: 'Edge', steps: CHROMIUM_STEPS('edge://extensions') },
  { id: 'brave', name: 'Brave', steps: CHROMIUM_STEPS('brave://extensions') },
  { id: 'arc', name: 'Arc', steps: CHROMIUM_STEPS('arc://extensions') },
  { id: 'opera', name: 'Opera', steps: CHROMIUM_STEPS('opera://extensions') },
  { id: 'vivaldi', name: 'Vivaldi', steps: CHROMIUM_STEPS('vivaldi://extensions') },
  {
    id: 'firefox',
    name: 'Firefox',
    steps: [
      'Open about:debugging (the Add button does this for you) and click “This Firefox”.',
      'Click “Load Temporary Add-on…” and choose manifest.json inside “Lightning Extension”.'
    ],
    note: 'Firefox removes it when it quits: add it again after a restart.'
  },
  {
    id: 'safari',
    name: 'Safari',
    steps: [
      'Safari → Settings → Advanced: turn on “Show features for web developers”.',
      'Safari → Settings → Developer: turn on “Allow unsigned extensions”.',
      'On the same tab, click “Add Temporary Extension…” and choose the “Lightning Extension” folder.',
      'Safari → Settings → Extensions: switch Lightning on and allow it on all websites.'
    ],
    note: 'Needs Safari 18 or later. Safari removes it when it quits.'
  }
]

function guideFor(id: string): BrowserGuide {
  return GUIDES.find((guide) => guide.id === id) ?? GUIDES[0]
}

function BrowserSteps({
  guide,
  titled = false
}: {
  guide: BrowserGuide
  titled?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {titled && <div className="font-medium text-foreground">{guide.name}</div>}
      <ol className="list-decimal pl-5 leading-relaxed text-muted-foreground">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.note && <div className="pl-5 text-muted-foreground">{guide.note}</div>}
    </div>
  )
}
