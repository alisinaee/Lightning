import type { TdlChat, TdlItem, TdlRangeType, TgMediaKind } from '@shared/telegram'
import { cn } from 'cn'
import {
  Warning as AlertTriangle,
  FolderOpen,
  ListChecks,
  ListDashes as ListX,
  MagnifyingGlass as Search
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useTelegramStore } from '../../store/useTelegramStore'
import { describeError, formatBytes, toDisplayPath } from '../../utils/format'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { FormatBadge } from '../downloads/FileKindIcon'
import { fileKindOfMedia, MEDIA_KINDS } from './telegramRowInfo'

export function TelegramExportDialog(): React.JSX.Element {
  const open = useTelegramStore((store) => store.exportOpen)
  const close = useTelegramStore((store) => store.closeExport)
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[600px] max-h-[calc(100%-2rem)] min-h-[400px] w-[720px] max-w-[calc(100%-2rem)] min-w-[480px] flex-col gap-0 overflow-auto p-0 sm:max-w-[calc(100%-2rem)]">
        {open && <ExportForm onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

const RANGE_HELP: Record<TdlRangeType, string> = {
  time: 'Messages sent between two dates',
  id: 'Messages between two message numbers',
  last: 'The most recent messages'
}

/** A date input's value as Unix seconds (local midnight; the end date takes in the whole day). */
const unixOf = (date: string, endOfDay: boolean): number =>
  Math.floor(new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime() / 1000)

function ExportForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const homeDir = useAppStore((store) => store.homeDir)
  const [chats, setChats] = useState<TdlChat[] | null>(null)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [chat, setChat] = useState<TdlChat | null>(null)
  const [rangeType, setRangeType] = useState<TdlRangeType>('last')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [count, setCount] = useState('100')
  const [filter, setFilter] = useState('')
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ file: string; items: TdlItem[] } | null>(null)
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [hiddenKinds, setHiddenKinds] = useState<Set<TgMediaKind>>(new Set())

  useEffect(() => {
    let alive = true
    window.lightning
      .tdlListChats()
      .then((list) => alive && setChats(list))
      .catch((reason) => alive && setChatsError(describeError(reason)))
    return () => {
      alive = false
    }
  }, [])

  const shownChats = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (chats ?? []).filter(
      (entry) => !needle || entry.title.toLowerCase().includes(needle) || entry.id.includes(needle)
    )
  }, [chats, query])

  const range = ((): string | null => {
    if (rangeType === 'last') return Number(count) > 0 ? String(Math.floor(Number(count))) : null
    if (rangeType === 'id') {
      return Number(from) > 0 && Number(to) >= Number(from)
        ? `${Math.floor(Number(from))},${Math.floor(Number(to))}`
        : null
    }
    return from && to && unixOf(to, true) >= unixOf(from, false)
      ? `${unixOf(from, false)},${unixOf(to, true)}`
      : null
  })()

  const loadPreview = async (): Promise<void> => {
    if (!chat || !range || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.lightning.tdlExportPreview({
        chat: chat.id,
        rangeType,
        range,
        filter: filter.trim() || undefined
      })
      setPreview(result)
      setUnticked(new Set())
      setHiddenKinds(new Set())
    } catch (reason) {
      setError(describeError(reason))
    } finally {
      setBusy(false)
    }
  }

  const items = useMemo(() => preview?.items ?? [], [preview])
  const visible = items.filter((item) => !hiddenKinds.has(item.media))
  const chosen = visible.filter((item) => !unticked.has(item.key))
  const totalBytes = chosen.reduce((sum, item) => sum + item.total, 0)
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) counts[item.media] = (counts[item.media] ?? 0) + 1
    return counts
  }, [items])

  const start = async (): Promise<void> => {
    if (!preview || chosen.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.lightning.tdlStartJob({
        exportFile: preview.file,
        keys: chosen.map((item) => item.key),
        dir: dir ?? undefined
      })
      onDone()
    } catch (reason) {
      setError(describeError(reason))
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    const picked = await window.lightning.chooseDestinationFolder(dir ?? homeDir)
    if (picked) setDir(picked)
  }

  const iconButton = (
    label: string,
    Icon: typeof ListChecks,
    disabled: boolean,
    onClick: () => void
  ): React.JSX.Element => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  const field = 'h-9 rounded-[9px] text-[13px]'
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (preview) void start()
        else void loadPreview()
      }}
    >
      <div className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">
          {preview ? `Files in ${chat?.title}` : 'Export a chat'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Pick a chat and a range of messages, then choose which files to download.
        </DialogDescription>
        <span className="mr-9 text-[12px] text-muted-foreground">Step {preview ? 2 : 1} of 2</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
        {!preview ? (
          <>
            <div className="relative shrink-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a chat"
                aria-label="Find a chat"
                className={cn(field, 'pl-8')}
              />
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
              {chatsError ? (
                <div className="p-3 text-[12.5px] text-[var(--color-danger)]">{chatsError}</div>
              ) : chats === null ? (
                <div className="p-3 text-[12.5px] text-muted-foreground">Loading your chats…</div>
              ) : shownChats.length === 0 ? (
                <div className="p-3 text-[12.5px] text-muted-foreground">No chat matches.</div>
              ) : (
                shownChats.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={chat?.id === entry.id}
                    onClick={() => setChat(entry)}
                    className={cn(
                      'flex items-center gap-2 border-b-[0.5px] border-border px-3 py-2 text-left text-[12.5px] outline-none last:border-b-0 hover:bg-secondary focus-visible:bg-secondary',
                      chat?.id === entry.id && 'bg-primary/10 hover:bg-primary/15'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">
                      {entry.type}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-center gap-3">
                <ToggleGroup
                  value={[rangeType]}
                  variant="outline"
                  aria-label="Range"
                  onValueChange={(value) => value[0] && setRangeType(value[0] as TdlRangeType)}
                >
                  <ToggleGroupItem value="last">Last</ToggleGroupItem>
                  <ToggleGroupItem value="time">Dates</ToggleGroupItem>
                  <ToggleGroupItem value="id">Message numbers</ToggleGroupItem>
                </ToggleGroup>
                <span className="text-[12px] text-muted-foreground">{RANGE_HELP[rangeType]}</span>
              </div>
              <div className="flex items-center gap-2">
                {rangeType === 'last' ? (
                  <Input
                    type="number"
                    min={1}
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                    aria-label="Number of messages"
                    className={cn(field, 'w-32')}
                  />
                ) : (
                  <>
                    <Input
                      type={rangeType === 'time' ? 'date' : 'number'}
                      min={rangeType === 'id' ? 1 : undefined}
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                      aria-label="From"
                      className={cn(field, 'w-40')}
                    />
                    <span className="text-[12px] text-muted-foreground">to</span>
                    <Input
                      type={rangeType === 'time' ? 'date' : 'number'}
                      min={rangeType === 'id' ? 1 : undefined}
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                      aria-label="To"
                      className={cn(field, 'w-40')}
                    />
                  </>
                )}
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter (optional)"
                  spellCheck={false}
                  aria-label="Filter"
                  className={cn(field, 'min-w-0 flex-1 font-mono text-[12px]')}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {MEDIA_KINDS.filter((entry) => kindCounts[entry.kind]).map((entry) => {
                const on = !hiddenKinds.has(entry.kind)
                return (
                  <button
                    key={entry.kind}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHiddenKinds((prev) => {
                        const next = new Set(prev)
                        if (!next.delete(entry.kind)) next.add(entry.kind)
                        return next
                      })
                    }
                    className={cn(
                      'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    {entry.label}
                    <span className="font-mono text-[11px] tabular-nums">
                      {kindCounts[entry.kind]}
                    </span>
                  </button>
                )
              })}
              <span className="flex-1" />
              {iconButton(
                'Select all',
                ListChecks,
                visible.length === 0 || chosen.length === visible.length,
                () => setUnticked(new Set())
              )}
              {iconButton('Unselect all', ListX, chosen.length === 0, () =>
                setUnticked(new Set(visible.map((item) => item.key)))
              )}
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col overflow-y-auto rounded-[9px] border-[0.5px] border-border">
              {items.length === 0 ? (
                <div className="p-3 text-[12.5px] text-muted-foreground">
                  No files in that range.
                </div>
              ) : (
                visible.map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center gap-2.5 border-b-[0.5px] border-border px-3 py-2 text-[12.5px] last:border-b-0"
                  >
                    <Checkbox
                      checked={!unticked.has(item.key)}
                      onCheckedChange={(on) =>
                        setUnticked((prev) => {
                          const next = new Set(prev)
                          if (on) next.delete(item.key)
                          else next.add(item.key)
                          return next
                        })
                      }
                    />
                    <FormatBadge
                      name={item.fileName}
                      size="sm"
                      kind={fileKindOfMedia(item.media)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium" title={item.fileName}>
                      {item.fileName}
                    </span>
                    {item.total > 0 && (
                      <span className="w-20 shrink-0 text-right font-mono text-[11.5px] text-muted-foreground">
                        {formatBytes(item.total)}
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[12.5px]">
              <span className="w-20 shrink-0 text-[var(--text-secondary)]">Saved to</span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-[12px]"
                title={dir ?? undefined}
              >
                {dir ? toDisplayPath(dir, homeDir) : 'Lightning Telegram folder (see Settings)'}
              </span>
              <Button type="button" variant="secondary" onClick={() => void browse()}>
                <FolderOpen data-icon="inline-start" />
                Browse…
              </Button>
            </div>
          </>
        )}
        {error && (
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--color-danger)]">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        {preview && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            Back
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {preview ? (
          <Button type="submit" disabled={chosen.length === 0 || busy}>
            Download {chosen.length} {chosen.length === 1 ? 'file' : 'files'}
            {totalBytes > 0 && ` (${formatBytes(totalBytes)})`}
          </Button>
        ) : (
          <Button type="submit" disabled={!chat || !range || busy}>
            {busy ? 'Reading the chat…' : 'Continue'}
          </Button>
        )}
      </div>
    </form>
  )
}
