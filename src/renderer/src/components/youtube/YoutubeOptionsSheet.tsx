import { useState, type ReactNode } from 'react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'
import { useYoutubeStore } from '../../store/useYoutubeStore'
import { cn } from 'cn'
import type { YoutubeOptions, YoutubeQuality } from '@shared/youtube'

const QUALITIES: { value: YoutubeQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '2K (1440p)' },
  { value: '1080', label: 'Full HD (1080p)' },
  { value: '720', label: 'HD (720p)' },
  { value: '480', label: 'SD (480p)' },
  { value: '360', label: 'Low (360p)' },
  { value: 'audio', label: 'Audio only' }
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
      <Section title="Quality">
        <Row title="Default quality" hint="Picked first in the add dialog">
          <Choice
            label="Default quality"
            value={options.quality}
            choices={QUALITIES}
            onChange={(quality) => change({ quality })}
          />
        </Row>
        <Row
          title="Start with these defaults"
          hint="When a link is fetched, download it at the default quality without asking. Off: you choose each time."
        >
          <Toggle
            label="Start with these defaults"
            checked={options.autoStartDefault}
            onChange={(autoStartDefault) => change({ autoStartDefault })}
          />
        </Row>
        <Row title="Video container" hint="Format of merged video files">
          <Choice
            label="Video container"
            value={options.mergeFormat}
            choices={[
              { value: 'mp4', label: 'MP4' },
              { value: 'mkv', label: 'MKV' },
              { value: 'webm', label: 'WebM' }
            ]}
            onChange={(mergeFormat) => change({ mergeFormat })}
          />
        </Row>
        <Row title="Audio format" hint="Used for audio-only downloads">
          <Choice
            label="Audio format"
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

      <Section title="Saving">
        <Row title="Download folder" hint={options.folder || 'Your Downloads folder'}>
          <Button variant="secondary" size="sm" onClick={() => void chooseFolder()}>
            <FolderOpen />
            Choose
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Use the Downloads folder"
            disabled={!options.folder}
            onClick={() => change({ folder: '' })}
          >
            <RotateCcw />
          </Button>
        </Row>
        <Row title="Playlists" hint="A whole playlist goes into its own folder">
          <Choice
            label="Playlists"
            value={options.playlist}
            choices={[
              { value: 'single', label: 'Only the video' },
              { value: 'full', label: 'Whole playlist' }
            ]}
            onChange={(playlist) => change({ playlist })}
          />
        </Row>
      </Section>

      <Section title="Cookies">
        <Row title="Sign-in cookies" hint="Needed for age-restricted or members-only videos">
          <Choice
            label="Sign-in cookies"
            value={options.cookieMode}
            choices={[
              { value: 'none', label: "Don't use" },
              { value: 'saved', label: 'Saved in Lightning' },
              { value: 'manual', label: 'cookies.txt file' }
            ]}
            onChange={(cookieMode) => change({ cookieMode })}
          />
        </Row>
        <Row
          title="Browser cookies"
          hint="Read the sign-in from this browser. macOS may ask for Keychain access"
        >
          <Choice
            label="Browser cookies"
            value={options.cookiesBrowser}
            choices={[
              { value: '', label: 'Off' },
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
          <Row title="cookies.txt file" hint={options.manualCookiesFile || 'No file chosen'}>
            <Button variant="secondary" size="sm" onClick={() => void chooseCookies()}>
              Choose
            </Button>
          </Row>
        )}
      </Section>

      <Section title="Extras">
        <Row title="Subtitles" hint="Downloaded and embedded in the video">
          <Toggle
            label="Download subtitles"
            checked={options.subtitles}
            onChange={(subtitles) => change({ subtitles })}
          />
        </Row>
        {options.subtitles && (
          <Row title="Subtitle languages" hint="Comma-separated, e.g. en.*,fa">
            <Field
              label="Subtitle languages"
              value={options.subtitleLangs}
              placeholder="en.*"
              onSave={(subtitleLangs) => change({ subtitleLangs })}
            />
          </Row>
        )}
        <Row title="Metadata" hint="Title, channel and date inside the file">
          <Toggle
            label="Embed metadata"
            checked={options.metadata}
            onChange={(metadata) => change({ metadata })}
          />
        </Row>
        <Row title="Thumbnail" hint="Use the video picture as the file's cover">
          <Toggle
            label="Embed thumbnail"
            checked={options.embedThumbnail}
            onChange={(embedThumbnail) => change({ embedThumbnail })}
          />
        </Row>
        <Row title="Chapters" hint="Chapter markers inside the file">
          <Toggle
            label="Embed chapters"
            checked={options.embedChapters}
            onChange={(embedChapters) => change({ embedChapters })}
          />
        </Row>
        <Row title="SponsorBlock" hint="Sponsor and intro segments: marked as chapters, or cut out">
          <Choice
            label="SponsorBlock"
            value={options.sponsorBlock}
            choices={[
              { value: 'off', label: 'Off' },
              { value: 'mark', label: 'Mark as chapters' },
              { value: 'remove', label: 'Remove segments' }
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
      <Section title="Format">
        <Row
          title="Format selector"
          hint="Replaces the quality choice. Leave empty for normal use."
        >
          <Field
            label="Format selector"
            value={options.formatOverride}
            placeholder="bestvideo[ext=mp4]+bestaudio"
            width="w-56"
            onSave={(formatOverride) => change({ formatOverride })}
          />
        </Row>
        <Row title="Sort formats" hint="yt-dlp -S order, e.g. res:1080,fps">
          <Field
            label="Sort formats"
            value={options.formatSort}
            placeholder="res:1080,fps"
            onSave={(formatSort) => change({ formatSort })}
          />
        </Row>
        <Row title="Impersonate browser" hint="For sites that block plain clients">
          <Choice
            label="Impersonate browser"
            value={options.impersonate}
            choices={[
              { value: '', label: 'Off' },
              { value: 'chrome', label: 'Chrome' },
              { value: 'safari', label: 'Safari' },
              { value: 'firefox', label: 'Firefox' }
            ]}
            onChange={(impersonate) => change({ impersonate })}
          />
        </Row>
        <Row title="Live streams" hint="Download a live stream from its start, not from now">
          <Toggle
            label="Live from start"
            checked={options.liveFromStart}
            onChange={(liveFromStart) => change({ liveFromStart })}
          />
        </Row>
        <Row title="Auto-made subtitles" hint="Use YouTube's own captions when the video has none">
          <Toggle
            label="Auto-made subtitles"
            checked={options.writeAutoSubs}
            onChange={(writeAutoSubs) => change({ writeAutoSubs })}
          />
        </Row>
        <Row title="Split by chapter" hint="One file per chapter, for videos with chapters">
          <Toggle
            label="Split by chapter"
            checked={options.splitChapters}
            onChange={(splitChapters) => change({ splitChapters })}
          />
        </Row>
        <Row title="Match filter" hint="yt-dlp expression, e.g. duration < 900. Empty: every video">
          <Field
            label="Match filter"
            value={options.matchFilter}
            placeholder="duration < 900"
            onSave={(matchFilter) => change({ matchFilter })}
          />
        </Row>
      </Section>

      <Section title="File names">
        <Row title="File name template" hint="Relative to the folder. yt-dlp fields like %(title)s">
          <Field
            label="File name template"
            value={options.outputTemplate}
            width="w-56"
            onSave={(outputTemplate) => change({ outputTemplate })}
          />
        </Row>
        <Row title="ASCII names only" hint="Replace non-English characters">
          <Toggle
            label="ASCII names only"
            checked={options.restrictFilenames}
            onChange={(restrictFilenames) => change({ restrictFilenames })}
          />
        </Row>
        <Row title="Windows-safe names" hint="Remove characters Windows does not allow">
          <Toggle
            label="Windows-safe names"
            checked={options.windowsFilenames}
            onChange={(windowsFilenames) => change({ windowsFilenames })}
          />
        </Row>
        <Row title="Keep file date" hint="Set the file's date from the upload date">
          <Toggle
            label="Keep file date"
            checked={options.useRemoteTime}
            onChange={(useRemoteTime) => change({ useRemoteTime })}
          />
        </Row>
        <Row title="Don't overwrite" hint="Skip a file that is already there">
          <Toggle
            label="Don't overwrite"
            checked={options.noOverwrites}
            onChange={(noOverwrites) => change({ noOverwrites })}
          />
        </Row>
      </Section>

      <Section title="Extra files">
        <Row title="Info file (.info.json)" hint="Metadata next to each file">
          <Toggle
            label="Write info file"
            checked={options.writeInfoJson}
            onChange={(writeInfoJson) => change({ writeInfoJson })}
          />
        </Row>
        <Row title="Description file" hint="The video description as text">
          <Toggle
            label="Write description"
            checked={options.writeDescription}
            onChange={(writeDescription) => change({ writeDescription })}
          />
        </Row>
        <Row title="Thumbnail file" hint="The picture as its own image">
          <Toggle
            label="Write thumbnail"
            checked={options.writeThumbnail}
            onChange={(writeThumbnail) => change({ writeThumbnail })}
          />
        </Row>
      </Section>

      <Section title="Speed and reliability">
        <Row title="Speed limit" hint="e.g. 2M or 500K. Empty means no limit">
          <Field
            label="Speed limit"
            value={options.limitRate}
            placeholder="No limit"
            numeric={false}
            onSave={(limitRate) => change({ limitRate })}
          />
        </Row>
        <Row title="Parallel fragments" hint="For streams split into pieces (1-16)">
          <Field
            label="Parallel fragments"
            value={options.concurrentFragments}
            numeric
            width="w-24"
            onSave={(value) => change({ concurrentFragments: Number(value) })}
          />
        </Row>
        <Row title="Retries" hint="Attempts after a failed request (0-50)">
          <Field
            label="Retries"
            value={options.retries}
            numeric
            width="w-24"
            onSave={(value) => change({ retries: Number(value) })}
          />
        </Row>
        <Row title="Timeout (seconds)" hint="Give up on a silent connection after this long">
          <Field
            label="Timeout"
            value={options.socketTimeout}
            numeric
            width="w-24"
            onSave={(value) => change({ socketTimeout: Number(value) })}
          />
        </Row>
        <Row title="Pause between requests" hint="Seconds (0-60). Useful against rate limits">
          <Field
            label="Pause between requests"
            value={options.sleepInterval}
            numeric
            width="w-24"
            onSave={(value) => change({ sleepInterval: Number(value) })}
          />
        </Row>
      </Section>

      <Section title="Selection">
        <Row title="Uploaded after" hint="YYYYMMDD. Empty means no limit">
          <Field
            label="Uploaded after"
            value={options.dateAfter}
            placeholder="20240101"
            width="w-32"
            onSave={(dateAfter) => change({ dateAfter })}
          />
        </Row>
        <Row title="Uploaded before" hint="YYYYMMDD. Empty means no limit">
          <Field
            label="Uploaded before"
            value={options.dateBefore}
            placeholder="20251231"
            width="w-32"
            onSave={(dateBefore) => change({ dateBefore })}
          />
        </Row>
        <Row title="Playlist items" hint="e.g. 1-10,15. Empty means all">
          <Field
            label="Playlist items"
            value={options.playlistItems}
            placeholder="1-10,15"
            width="w-32"
            onSave={(playlistItems) => change({ playlistItems })}
          />
        </Row>
        <Row title="Stop after" hint="Videos per playlist. 0 means no limit">
          <Field
            label="Stop after"
            value={options.maxDownloads}
            numeric
            width="w-24"
            onSave={(value) => change({ maxDownloads: Number(value) })}
          />
        </Row>
        <Row title="Skip already downloaded" hint="Keeps a list of finished videos">
          <Toggle
            label="Skip already downloaded"
            checked={options.skipDownloaded}
            onChange={(skipDownloaded) => change({ skipDownloaded })}
          />
        </Row>
      </Section>
    </div>
  )
}

/** The YouTube downloader's settings, in two tabs: Common for everyday use, Advanced for yt-dlp's finer controls. */
export function YoutubeOptionsSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const options = useYoutubeStore((store) => store.options)
  const setOptions = useYoutubeStore((store) => store.setOptions)
  const [tab, setTab] = useState<'common' | 'advanced'>('common')
  const change: Change = (part) => void setOptions(part)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] max-w-full gap-0 overflow-y-auto">
        <SheetHeader className="border-b-[0.5px] border-border">
          <SheetTitle>YouTube options</SheetTitle>
          <SheetDescription>Used by every new YouTube download.</SheetDescription>
          <div
            role="tablist"
            aria-label="Option groups"
            className="mt-2 flex rounded-md bg-muted p-0.5"
          >
            {(['common', 'advanced'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'h-7 flex-1 rounded-[5px] text-[12px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === value
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </SheetHeader>
        <div className="px-4 py-4">
          {tab === 'common' ? (
            <CommonSettings options={options} change={change} />
          ) : (
            <AdvancedSettings options={options} change={change} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
