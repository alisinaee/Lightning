import { useState, type ReactNode } from 'react'
import { FolderOpen, ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { cn } from 'cn'
import { t } from '@shared/i18n/react'
import type { YoutubeOptions, YoutubeQuality } from '@shared/youtube'

const qualities = (): { value: YoutubeQuality; label: string }[] => [
  { value: 'best', label: t('Best available') },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '2K (1440p)' },
  { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' },
  { value: '480', label: 'SD (480p)' },
  { value: '360', label: 'Low (360p)' },
  { value: 'audio', label: t('Audio only') }
]

const SELECT =
  'h-8 min-w-44 rounded-md border-[0.5px] border-input bg-[var(--input-bg)] px-2 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

type Change = (part: Partial<YoutubeOptions>) => void

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col">
      <h3 className="pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y-[0.5px] divide-border">{children}</div>
    </section>
  )
}

/** One setting: its name and hint on the left, the control on the right. */
function Row({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {hint && <div className="text-[11.5px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Choice<T extends string>({
  label,
  value,
  choices,
  onChange
}: {
  label: string
  value: T
  choices: { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <select
      aria-label={label}
      className={SELECT}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
}

/** A text or number field that saves when you leave it or press Enter, so a half-typed value is never sent. */
function Field({
  label,
  value,
  placeholder,
  width = 'w-44',
  numeric = false,
  onSave
}: {
  label: string
  value: string | number
  placeholder?: string
  width?: string
  numeric?: boolean
  onSave: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  const commit = (): void => {
    if (draft !== String(value)) onSave(draft)
  }
  return (
    <Input
      aria-label={label}
      type={numeric ? 'number' : 'text'}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className={cn('h-8 text-[12.5px]', width)}
    />
  )
}

function CommonSettings({
  options,
  change
}: {
  options: YoutubeOptions
  change: Change
}): React.JSX.Element {
  const chooseFolder = async (): Promise<void> => {
    const folder = await window.lightning.youtubeChooseFolder(options.folder || undefined)
    if (folder) change({ folder })
  }
  const chooseCookies = async (): Promise<void> => {
    const file = await window.lightning.youtubeChooseCookies()
    if (file) change({ manualCookiesFile: file })
  }
  return (
    <div className="flex flex-col gap-5">
      <Section title={t('Quality')}>
        <Row title={t('Default quality')} hint={t('Picked first in the add dialog')}>
          <Choice
            label={t('Default quality')}
            value={options.quality}
            choices={qualities()}
            onChange={(quality) => change({ quality })}
          />
        </Row>
        <Row
          title={t('Start with these defaults')}
          hint={t(
            'When a link is fetched, download it at the default quality without asking. Off: you choose each time.'
          )}
        >
          <Toggle
            label={t('Start with these defaults')}
            checked={options.autoStartDefault}
            onChange={(autoStartDefault) => change({ autoStartDefault })}
          />
        </Row>
        <Row title={t('Video container')} hint={t('Format of merged video files')}>
          <Choice
            label={t('Video container')}
            value={options.mergeFormat}
            choices={[
              { value: 'mp4', label: 'MP4' },
              { value: 'mkv', label: 'MKV' },
              { value: 'webm', label: 'WebM' }
            ]}
            onChange={(mergeFormat) => change({ mergeFormat })}
          />
        </Row>
        <Row title={t('Audio format')} hint={t('Used for audio-only downloads')}>
          <Choice
            label={t('Audio format')}
            value={options.audioFormat}
            choices={[
              { value: 'm4a', label: 'M4A' },
              { value: 'mp3', label: 'MP3' },
              { value: 'opus', label: 'Opus' },
              { value: 'flac', label: 'FLAC' },
              { value: 'wav', label: 'WAV' }
            ]}
            onChange={(audioFormat) => change({ audioFormat })}
          />
        </Row>
      </Section>

      <Section title={t('Saving')}>
        <Row title={t('Download folder')} hint={options.folder || t('Your Downloads folder')}>
          <Button variant="secondary" size="sm" onClick={() => void chooseFolder()}>
            <FolderOpen />
            {t('Choose')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Use the Downloads folder')}
            disabled={!options.folder}
            onClick={() => change({ folder: '' })}
          >
            <RotateCcw />
          </Button>
        </Row>
        <Row title={t('Playlists')} hint={t('A whole playlist goes into its own folder')}>
          <Choice
            label={t('Playlists')}
            value={options.playlist}
            choices={[
              { value: 'single', label: t('Only the video') },
              { value: 'full', label: t('Whole playlist') }
            ]}
            onChange={(playlist) => change({ playlist })}
          />
        </Row>
      </Section>

      <Section title={t('Cookies')}>
        <Row
          title={t('Sign-in cookies')}
          hint={t('Needed for age-restricted or members-only videos')}
        >
          <Choice
            label={t('Sign-in cookies')}
            value={options.cookieMode}
            choices={[
              { value: 'none', label: t("Don't use") },
              { value: 'saved', label: t('Saved in Lightning') },
              { value: 'manual', label: 'cookies.txt file' }
            ]}
            onChange={(cookieMode) => change({ cookieMode })}
          />
        </Row>
        <Row
          title={t('Browser cookies')}
          hint={t('Read the sign-in from this browser. macOS may ask for Keychain access')}
        >
          <Choice
            label={t('Browser cookies')}
            value={options.cookiesBrowser}
            choices={[
              { value: '', label: t('Off') },
              { value: 'chrome', label: 'Chrome' },
              { value: 'safari', label: 'Safari' },
              { value: 'firefox', label: 'Firefox' },
              { value: 'edge', label: 'Edge' },
              { value: 'brave', label: 'Brave' }
            ]}
            onChange={(cookiesBrowser) => change({ cookiesBrowser })}
          />
        </Row>
        {options.cookieMode === 'manual' && (
          <Row title="cookies.txt file" hint={options.manualCookiesFile || t('No file chosen')}>
            <Button variant="secondary" size="sm" onClick={() => void chooseCookies()}>
              {t('Choose')}
            </Button>
          </Row>
        )}
      </Section>

      <Section title={t('Extras')}>
        <Row title={t('Subtitles')} hint={t('Downloaded and embedded in the video')}>
          <Toggle
            label={t('Download subtitles')}
            checked={options.subtitles}
            onChange={(subtitles) => change({ subtitles })}
          />
        </Row>
        {options.subtitles && (
          <Row title={t('Subtitle languages')} hint={t('Comma-separated, e.g. en.*,fa')}>
            <Field
              label={t('Subtitle languages')}
              value={options.subtitleLangs}
              placeholder="en.*"
              onSave={(subtitleLangs) => change({ subtitleLangs })}
            />
          </Row>
        )}
        <Row title={t('Metadata')} hint={t('Title, channel and date inside the file')}>
          <Toggle
            label={t('Embed metadata')}
            checked={options.metadata}
            onChange={(metadata) => change({ metadata })}
          />
        </Row>
        <Row title={t('Thumbnail')} hint={t("Use the video picture as the file's cover")}>
          <Toggle
            label={t('Embed thumbnail')}
            checked={options.embedThumbnail}
            onChange={(embedThumbnail) => change({ embedThumbnail })}
          />
        </Row>
        <Row title={t('Chapters')} hint={t('Chapter markers inside the file')}>
          <Toggle
            label={t('Embed chapters')}
            checked={options.embedChapters}
            onChange={(embedChapters) => change({ embedChapters })}
          />
        </Row>
        <Row
          title="SponsorBlock"
          hint={t('Sponsor and intro segments: marked as chapters, or cut out')}
        >
          <Choice
            label="SponsorBlock"
            value={options.sponsorBlock}
            choices={[
              { value: 'off', label: t('Off') },
              { value: 'mark', label: t('Mark as chapters') },
              { value: 'remove', label: t('Remove segments') }
            ]}
            onChange={(sponsorBlock) => change({ sponsorBlock })}
          />
        </Row>
      </Section>
    </div>
  )
}

function AdvancedSettings({
  options,
  change
}: {
  options: YoutubeOptions
  change: Change
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Section title={t('Format')}>
        <Row
          title={t('Format selector')}
          hint={t('Replaces the quality choice. Leave empty for normal use.')}
        >
          <Field
            label={t('Format selector')}
            value={options.formatOverride}
            placeholder="bestvideo[ext=mp4]+bestaudio"
            width="w-56"
            onSave={(formatOverride) => change({ formatOverride })}
          />
        </Row>
        <Row title={t('Sort formats')} hint={t('yt-dlp -S order, e.g. res:1080,fps')}>
          <Field
            label={t('Sort formats')}
            value={options.formatSort}
            placeholder="res:1080,fps"
            onSave={(formatSort) => change({ formatSort })}
          />
        </Row>
        <Row title={t('Impersonate browser')} hint={t('For sites that block plain clients')}>
          <Choice
            label={t('Impersonate browser')}
            value={options.impersonate}
            choices={[
              { value: '', label: t('Off') },
              { value: 'chrome', label: 'Chrome' },
              { value: 'safari', label: 'Safari' },
              { value: 'firefox', label: 'Firefox' }
            ]}
            onChange={(impersonate) => change({ impersonate })}
          />
        </Row>
        <Row
          title={t('Live streams')}
          hint={t('Download a live stream from its start, not from now')}
        >
          <Toggle
            label={t('Live from start')}
            checked={options.liveFromStart}
            onChange={(liveFromStart) => change({ liveFromStart })}
          />
        </Row>
        <Row
          title={t('Auto-made subtitles')}
          hint={t("Use YouTube's own captions when the video has none")}
        >
          <Toggle
            label={t('Auto-made subtitles')}
            checked={options.writeAutoSubs}
            onChange={(writeAutoSubs) => change({ writeAutoSubs })}
          />
        </Row>
        <Row
          title={t('Split by chapter')}
          hint={t('One file per chapter, for videos with chapters')}
        >
          <Toggle
            label={t('Split by chapter')}
            checked={options.splitChapters}
            onChange={(splitChapters) => change({ splitChapters })}
          />
        </Row>
        <Row
          title={t('Match filter')}
          hint={t('yt-dlp expression, e.g. duration < 900. Empty: every video')}
        >
          <Field
            label={t('Match filter')}
            value={options.matchFilter}
            placeholder="duration < 900"
            onSave={(matchFilter) => change({ matchFilter })}
          />
        </Row>
      </Section>

      <Section title={t('File names')}>
        <Row
          title={t('File name template')}
          hint={t('Relative to the folder. yt-dlp fields like %(title)s')}
        >
          <Field
            label={t('File name template')}
            value={options.outputTemplate}
            width="w-56"
            onSave={(outputTemplate) => change({ outputTemplate })}
          />
        </Row>
        <Row title={t('ASCII names only')} hint={t('Replace non-English characters')}>
          <Toggle
            label={t('ASCII names only')}
            checked={options.restrictFilenames}
            onChange={(restrictFilenames) => change({ restrictFilenames })}
          />
        </Row>
        <Row title={t('Windows-safe names')} hint={t('Remove characters Windows does not allow')}>
          <Toggle
            label={t('Windows-safe names')}
            checked={options.windowsFilenames}
            onChange={(windowsFilenames) => change({ windowsFilenames })}
          />
        </Row>
        <Row title={t('Keep file date')} hint={t("Set the file's date from the upload date")}>
          <Toggle
            label={t('Keep file date')}
            checked={options.useRemoteTime}
            onChange={(useRemoteTime) => change({ useRemoteTime })}
          />
        </Row>
        <Row title={t("Don't overwrite")} hint={t('Skip a file that is already there')}>
          <Toggle
            label={t("Don't overwrite")}
            checked={options.noOverwrites}
            onChange={(noOverwrites) => change({ noOverwrites })}
          />
        </Row>
      </Section>

      <Section title={t('Extra files')}>
        <Row title={t('Info file (.info.json)')} hint={t('Metadata next to each file')}>
          <Toggle
            label={t('Write info file')}
            checked={options.writeInfoJson}
            onChange={(writeInfoJson) => change({ writeInfoJson })}
          />
        </Row>
        <Row title={t('Description file')} hint={t('The video description as text')}>
          <Toggle
            label={t('Write description')}
            checked={options.writeDescription}
            onChange={(writeDescription) => change({ writeDescription })}
          />
        </Row>
        <Row title={t('Thumbnail file')} hint={t('The picture as its own image')}>
          <Toggle
            label={t('Write thumbnail')}
            checked={options.writeThumbnail}
            onChange={(writeThumbnail) => change({ writeThumbnail })}
          />
        </Row>
      </Section>

      <Section title={t('Speed and reliability')}>
        <Row title={t('Speed limit')} hint={t('e.g. 2M or 500K. Empty means no limit')}>
          <Field
            label={t('Speed limit')}
            value={options.limitRate}
            placeholder={t('No limit')}
            numeric={false}
            onSave={(limitRate) => change({ limitRate })}
          />
        </Row>
        <Row title={t('Parallel fragments')} hint={t('For streams split into pieces (1-16)')}>
          <Field
            label={t('Parallel fragments')}
            value={options.concurrentFragments}
            numeric
            width="w-24"
            onSave={(value) => change({ concurrentFragments: Number(value) })}
          />
        </Row>
        <Row title={t('Retries')} hint={t('Attempts after a failed request (0-50)')}>
          <Field
            label={t('Retries')}
            value={options.retries}
            numeric
            width="w-24"
            onSave={(value) => change({ retries: Number(value) })}
          />
        </Row>
        <Row
          title={t('Timeout (seconds)')}
          hint={t('Give up on a silent connection after this long')}
        >
          <Field
            label={t('Timeout')}
            value={options.socketTimeout}
            numeric
            width="w-24"
            onSave={(value) => change({ socketTimeout: Number(value) })}
          />
        </Row>
        <Row
          title={t('Pause between requests')}
          hint={t('Seconds (0-60). Useful against rate limits')}
        >
          <Field
            label={t('Pause between requests')}
            value={options.sleepInterval}
            numeric
            width="w-24"
            onSave={(value) => change({ sleepInterval: Number(value) })}
          />
        </Row>
      </Section>

      <Section title={t('Selection')}>
        <Row title={t('Uploaded after')} hint={t('YYYYMMDD. Empty means no limit')}>
          <Field
            label={t('Uploaded after')}
            value={options.dateAfter}
            placeholder="20240101"
            width="w-32"
            onSave={(dateAfter) => change({ dateAfter })}
          />
        </Row>
        <Row title={t('Uploaded before')} hint={t('YYYYMMDD. Empty means no limit')}>
          <Field
            label={t('Uploaded before')}
            value={options.dateBefore}
            placeholder="20251231"
            width="w-32"
            onSave={(dateBefore) => change({ dateBefore })}
          />
        </Row>
        <Row title={t('Playlist items')} hint={t('e.g. 1-10,15. Empty means all')}>
          <Field
            label={t('Playlist items')}
            value={options.playlistItems}
            placeholder="1-10,15"
            width="w-32"
            onSave={(playlistItems) => change({ playlistItems })}
          />
        </Row>
        <Row title={t('Stop after')} hint={t('Videos per playlist. 0 means no limit')}>
          <Field
            label={t('Stop after')}
            value={options.maxDownloads}
            numeric
            width="w-24"
            onSave={(value) => change({ maxDownloads: Number(value) })}
          />
        </Row>
        <Row title={t('Skip already downloaded')} hint={t('Keeps a list of finished videos')}>
          <Toggle
            label={t('Skip already downloaded')}
            checked={options.skipDownloaded}
            onChange={(skipDownloaded) => change({ skipDownloaded })}
          />
        </Row>
      </Section>
    </div>
  )
}

/** The YouTube downloader's settings, in two tabs: Common for everyday use, Advanced for yt-dlp's
 * finer controls. Shown in the YouTube options sheet and on the YouTube page of Settings. */
export function YoutubeOptionsPanel(): React.JSX.Element {
  const options = useYoutubeStore((store) => store.options)
  const setOptions = useYoutubeStore((store) => store.setOptions)
  const [tab, setTab] = useState<'common' | 'advanced'>('common')
  const change: Change = (part) => void setOptions(part)

  return (
    <>
      <div className="px-4 pt-3">
        <div
          role="tablist"
          aria-label={t('Option groups')}
          className="flex rounded-md bg-muted p-0.5"
        >
          {(['common', 'advanced'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                'h-7 flex-1 rounded-[5px] text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === value
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {value === 'common' ? t('Common') : t('Advanced')}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4">
        {tab === 'common' ? (
          <CommonSettings options={options} change={change} />
        ) : (
          <AdvancedSettings options={options} change={change} />
        )}
      </div>
    </>
  )
}

/** The YouTube options as a side sheet, opened from the YouTube section's settings button. */
export function YoutubeOptionsSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] max-w-full gap-0 overflow-y-auto">
        <SheetHeader className="border-b-[0.5px] border-border">
          <SheetTitle>{t('YouTube options')}</SheetTitle>
          <SheetDescription>{t('Used by every new YouTube download.')}</SheetDescription>
        </SheetHeader>
        <YoutubeOptionsPanel />
      </SheetContent>
    </Sheet>
  )
}
