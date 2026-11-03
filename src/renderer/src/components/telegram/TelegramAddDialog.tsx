import { parseTelegramLinks } from '@shared/telegram'
import { AlertTriangle, FolderOpen, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useTelegramStore } from '../../store/useTelegramStore'
import { describeError, toDisplayPath } from '../../utils/format'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'

/** `https://t.me/name/12` -> `name · 12`, for the list of what was found. */
const describeLink = (link: string): string => {
  const parts = link.replace(/^https:\/\/t\.me\//, '').split('/')
  const message = parts[parts.length - 1]
  const chat = parts.slice(0, -1).join('/')
  return `${chat.replace(/^c\//, 'private chat ')} · message ${message}`
}

const TME_WORD = /(?:^|[/.])(?:t|telegram)\.me\//i

export function TelegramAddDialog(): React.JSX.Element {
  const open = useTelegramStore((store) => store.addOpen)
  const close = useTelegramStore((store) => store.closeAdd)
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[560px] max-h-[calc(100%-2rem)] min-h-[360px] w-[640px] max-w-[calc(100%-2rem)] min-w-[420px] flex-col gap-0 overflow-auto p-0 sm:max-w-[calc(100%-2rem)]">
        {open && <AddForm onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

function AddForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const seed = useTelegramStore((store) => store.addSeed)
  const jobs = useTelegramStore((store) => store.jobs)
  const homeDir = useAppStore((store) => store.homeDir)
  const [text, setText] = useState(() => seed.join('\n'))
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [dir, setDir] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseTelegramLinks(text), [text])
  const links = parsed.filter((link) => !removed.has(link))
  const ignored = useMemo(
    () =>
      Math.max(0, text.split(/\s+/).filter((word) => TME_WORD.test(word)).length - parsed.length),
    [text, parsed]
  )
  const known = useMemo(() => {
    const set = new Set<string>()
    for (const job of Object.values(jobs)) {
      if (job.source.type === 'links') job.source.links.forEach((link) => set.add(link))
      for (const item of job.items) if (item.link) set.add(item.link)
    }
    return set
  }, [jobs])

  const browse = async (): Promise<void> => {
    const picked = await window.lightning.chooseDestinationFolder(dir ?? homeDir)
    if (picked) setDir(picked)
  }

  const start = async (): Promise<void> => {
    if (links.length === 0 || starting) return
    setStarting(true)
    setError(null)
    try {
      await window.lightning.tdlStartJob({ links, dir: dir ?? undefined })
      onDone()
    } catch (reason) {
      setError(describeError(reason))
      setStarting(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void start()
      }}
    >
      <div className="border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">Add Telegram links</DialogTitle>
        <DialogDescription className="sr-only">
          Paste Telegram message links to download the files in them.
        </DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        <textarea
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste message links, one or many. Any text works: the links are picked out of it."
          spellCheck={false}
          aria-label="Telegram links"
          className="h-24 min-h-[72px] shrink-0 resize-y rounded-[9px] border border-input bg-[var(--input-bg)] p-3 font-mono text-[12px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="text-[12.5px] font-medium">
          {links.length} valid
          {ignored > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">{ignored} ignored</span>
          )}
        </div>
        {links.length > 0 && (
          <div className="flex min-h-[96px] flex-1 flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
            {links.map((link) => (
              <div
                key={link}
                className="flex items-center gap-2 border-b-[0.5px] border-border px-3 py-1.5 text-[12.5px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={link}>
                  {describeLink(link)}
                </span>
                {known.has(link) && (
                  <Badge variant="secondary" className="shrink-0">
                    Already added
                  </Badge>
                )}
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${describeLink(link)}`}
                  onClick={() => setRemoved((prev) => new Set(prev).add(link))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="w-20 shrink-0 text-[var(--text-secondary)]">Saved to</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={dir ?? undefined}>
            {dir ? toDisplayPath(dir, homeDir) : 'Lightning Telegram folder (see Settings)'}
          </span>
          <Button type="button" variant="secondary" onClick={() => void browse()}>
            <FolderOpen data-icon="inline-start" />
            Browse…
          </Button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--color-danger)]">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        <span className="mr-auto text-[11.5px] text-muted-foreground">
          Telegram downloads use the default connection.
        </span>
        <Button type="button" variant="secondary" onClick={onDone} disabled={starting}>
          Cancel
        </Button>
        <Button type="submit" disabled={links.length === 0 || starting}>
          {links.length > 1 ? `Download ${links.length} messages` : 'Download'}
        </Button>
      </div>
    </form>
  )
}
