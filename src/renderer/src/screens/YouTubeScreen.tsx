import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, SlidersHorizontal, VideoCamera as Video, X } from '@phosphor-icons/react'
import { EmptyStatusIcon } from '../components/EmptyIcon'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { YoutubeAddDialog } from '../components/youtube/YoutubeAddDialog'
import { YoutubeOptionsSheet } from '../components/youtube/YoutubeOptionsSheet'
import { YoutubeJobRow } from '../components/youtube/YoutubeJobRow'
import { YoutubeGroupRow } from '../components/youtube/YoutubeGroupRow'
import { YoutubeColumnsContext, youtubeColumnsFor } from '../components/youtube/youtubeRowModel'
import { YoutubeFetchQueue } from '../components/youtube/YoutubeFetchQueue'
import { YoutubeSignInBanner } from '../components/youtube/YoutubeSignInFix'
import {
  isActiveYoutubeJob,
  isFailedYoutubeJob,
  isFinishedYoutubeJob,
  useYoutubeStore,
  type YoutubeJobFilter
} from '../store/useYoutubeStore'
import type { YoutubeJob } from '@shared/youtube'
import type { SettingsPage } from '../components/SettingsDialog'
import { NetworksMenu } from '../components/NetworksMenu'
import { VpnControl } from '../components/VpnControl'
import { NewMenu, PauseAllButton, SearchField, SettingsButton } from '../components/ListTopBar'
import { useLimitsDialog } from '../hooks/useLimitsDialog'

/** Adds or removes one job from the selection. */
const setJobSelected = (id: string, on: boolean): void => {
  const next = new Set(useYoutubeStore.getState().selected)
  if (on) next.add(id)
  else next.delete(id)
  useYoutubeStore.getState().setSelected(next)
}

const matchesFilter = (job: YoutubeJob, filter: YoutubeJobFilter): boolean => {
  if (filter === 'active') return isActiveYoutubeJob(job)
  if (filter === 'finished') return isFinishedYoutubeJob(job)
  if (filter === 'failed') return isFailedYoutubeJob(job)
  return true
}

/** The YouTube downloader: a list of its downloads, with the add dialog and the options sheet. */
export function YouTubeScreen({
  onOpenSettings
}: {
  onOpenSettings: (page?: SettingsPage) => void
}): React.JSX.Element {
  const jobs = useYoutubeStore((store) => store.jobs)
  const [width, setWidth] = useState(1000)
  const screenRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = screenRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const columns = useMemo(() => youtubeColumnsFor(width), [width])
  const status = useYoutubeStore((store) => store.status)
  const jobFilter = useYoutubeStore((store) => store.jobFilter)
  const search = useYoutubeStore((store) => store.search)
  const setSearch = useYoutubeStore((store) => store.setSearch)
  const selected = useYoutubeStore((store) => store.selected)
  const setSelected = useYoutubeStore((store) => store.setSelected)
  const refreshStatus = useYoutubeStore((store) => store.refreshStatus)
  const loadJobs = useYoutubeStore((store) => store.loadJobs)
  const loadOptions = useYoutubeStore((store) => store.loadOptions)
  const setAddOpen = useYoutubeStore((store) => store.setAddOpen)
  const pauseJob = useYoutubeStore((store) => store.pauseJob)
  const resumeJob = useYoutubeStore((store) => store.resumeJob)
  const cancelJob = useYoutubeStore((store) => store.cancelJob)
  const retryJob = useYoutubeStore((store) => store.retryJob)
  const removeJob = useYoutubeStore((store) => store.removeJob)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const { openLimits, limitsDialog } = useLimitsDialog()
  const [matchIndex, setMatchIndex] = useState(0)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    void loadJobs()
    void refreshStatus()
    void loadOptions()
  }, [loadJobs, refreshStatus, loadOptions])

  const all = useMemo(() => Object.values(jobs), [jobs])
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return all
      .filter((job) => matchesFilter(job, jobFilter))
      .filter((job) => !query || job.title.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [all, jobFilter, search])

  // Playlist videos are grouped under one row; everything else stands alone. Newest first.
  const entries = useMemo(() => {
    const groups = new Map<string, YoutubeJob[]>()
    const items: { at: number; node: React.ReactNode }[] = []
    const singles: YoutubeJob[] = []
    for (const job of visible) {
      if (!job.groupId) {
        singles.push(job)
        continue
      }
      const list = groups.get(job.groupId) ?? []
      list.push(job)
      groups.set(job.groupId, list)
    }
    for (const job of singles) {
      items.push({
        at: job.createdAt,
        node: (
          <YoutubeJobRow
            key={job.id}
            job={job}
            selected={selected.has(job.id)}
            onSelect={(on) => setJobSelected(job.id, on)}
          />
        )
      })
    }
    for (const [groupId, list] of groups) {
      // Videos keep the playlist's order (they were queued in it).
      list.sort((a, b) => a.createdAt - b.createdAt)
      const expanded = expandedGroups.has(groupId)
      const title = list[0].groupTitle ?? 'Playlist'
      items.push({
        at: Math.max(...list.map((job) => job.createdAt)),
        node: (
          <div key={`group-${groupId}`}>
            <YoutubeGroupRow
              title={title}
              jobs={list}
              expanded={expanded}
              onToggle={() =>
                setExpandedGroups((current) => {
                  const next = new Set(current)
                  if (next.has(groupId)) next.delete(groupId)
                  else next.add(groupId)
                  return next
                })
              }
            />
            {expanded &&
              list.map((job) => (
                <YoutubeJobRow
                  key={job.id}
                  job={job}
                  nested
                  selected={selected.has(job.id)}
                  onSelect={(on) => setJobSelected(job.id, on)}
                />
              ))}
          </div>
        )
      })
    }
    return items.sort((a, b) => b.at - a.at).map((item) => item.node)
  }, [visible, expandedGroups, selected])

  // What the person can see and pick: the top-level videos, and a playlist's videos once its
  // group is open (a closed group's videos are not on screen).
  const listed = useMemo(
    () => visible.filter((job) => !job.groupId || expandedGroups.has(job.groupId)),
    [visible, expandedGroups]
  )
  const chosen = listed.filter((job) => selected.has(job.id))
  const allListedChosen = listed.length > 0 && chosen.length === listed.length
  const pausable = chosen.filter((job) => job.status === 'downloading' || job.status === 'queued')
  const resumable = chosen.filter((job) => job.status === 'paused')
  const retryable = chosen.filter((job) => job.status === 'error' || job.status === 'cancelled')
  const cancellable = chosen.filter(
    (job) => job.status === 'downloading' || job.status === 'queued'
  )

  // Keyboard, as on Downloads: Esc lets go of the selection, ⌘/Ctrl+A takes everything listed.
  // Not while typing in a box or a dialog is open, so those keep their own keys.
  useEffect(() => {
    const mod = window.lightning.platform === 'darwin' ? 'metaKey' : 'ctrlKey'
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))
      if (typing || document.querySelector('[role="dialog"]')) return
      if (event.key === 'Escape') setSelected(new Set())
      else if (event[mod] && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(new Set(listed.map((job) => job.id)))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listed, setSelected])

  // Running, paused and failed videos among those chosen or listed: what the top bar acts on.
  const running = listed.filter((job) => job.status === 'downloading' || job.status === 'queued')
  const pausedAll = listed.filter((job) => job.status === 'paused')
  const failedAll = listed.filter((job) => job.status === 'error' || job.status === 'cancelled')
  // The rows a search finds, in order: Enter and the arrows step through them and scroll to each.
  const hitIds = useMemo(
    () => (search.trim() === '' ? [] : visible.map((job) => job.id)),
    [visible, search]
  )
  const stepMatch = (dir: 1 | -1): void => {
    if (hitIds.length === 0) return
    setMatchIndex((index) => (index + dir + hitIds.length) % hitIds.length)
  }
  useEffect(() => {
    const id = hitIds[matchIndex]
    if (id)
      document
        .querySelector(`[data-row-entry="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [matchIndex, hitIds])

  const toggleAll = (on: boolean): void =>
    setSelected(on ? new Set(listed.map((job) => job.id)) : new Set())

  return (
    <div className="flex h-full min-w-0 flex-1 bg-background">
      <div ref={screenRef} className="@container flex min-w-0 flex-1 flex-col">
        {limitsDialog}
        {chosen.length === 0 ? (
          <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3">
            <h1 className="sr-only">YouTube</h1>
            <PauseAllButton
              pausing={running.length > 0}
              resumeLabel={pausedAll.length > 0 ? 'Resume all' : 'Try again all'}
              resumeIcon={pausedAll.length > 0 ? 'play' : 'retry'}
              disabled={running.length === 0 && pausedAll.length + failedAll.length === 0}
              onPause={() => running.forEach((job) => void pauseJob(job.id))}
              onResume={() =>
                pausedAll.length > 0
                  ? pausedAll.forEach((job) => void resumeJob(job.id))
                  : failedAll.forEach((job) => void retryJob(job.id))
              }
            />
            <NetworksMenu onOpenLimits={openLimits} />
            <NewMenu
              label="New download"
              items={[{ label: 'Video link', icon: Plus, run: () => setAddOpen(true) }]}
            />
            {/* After the + button, so a VPN turning up doesn't move it. */}
            <VpnControl />
            <Badge variant="outline" className="shrink-0">
              {status?.binary ? `yt-dlp ${status.version ?? ''}`.trim() : 'yt-dlp missing'}
            </Badge>{' '}
            {status && !status.binary && (
              <Badge variant="destructive" className="shrink-0">
                yt-dlp missing
              </Badge>
            )}
            {status && !status.ffmpeg && (
              <Badge variant="destructive" className="shrink-0">
                ffmpeg missing
              </Badge>
            )}
            <div className="flex-1" />
            <SearchField
              label="Search YouTube downloads"
              value={search}
              onChange={(value) => {
                setSearch(value)
                setMatchIndex(0)
              }}
              matches={search.trim() === '' ? undefined : hitIds.length}
              matchIndex={matchIndex}
              onStep={stepMatch}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="YouTube options"
                    onClick={() => setOptionsOpen(true)}
                  >
                    <SlidersHorizontal />
                  </Button>
                }
              />
              <TooltipContent>YouTube options</TooltipContent>
            </Tooltip>
            <SettingsButton label="Settings" onClick={() => onOpenSettings('YouTube')} />
          </div>
        ) : (
          <div
            role="toolbar"
            aria-label="Selected YouTube downloads"
            className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3"
          >
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Deselect all"
              onClick={() => setSelected(new Set())}
            >
              <X />
            </Button>
            <span className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
              {chosen.length} selected
            </span>
            <div className="flex-1" />
            {pausable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => pausable.forEach((job) => void pauseJob(job.id))}
              >
                Pause ({pausable.length})
              </Button>
            )}
            {resumable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => resumable.forEach((job) => void resumeJob(job.id))}
              >
                Resume ({resumable.length})
              </Button>
            )}
            {retryable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => retryable.forEach((job) => void retryJob(job.id))}
              >
                Try again ({retryable.length})
              </Button>
            )}
            {cancellable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => cancellable.forEach((job) => void cancelJob(job.id))}
              >
                Cancel ({cancellable.length})
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title="Takes them off the list; the files stay on your computer"
              onClick={() => chosen.forEach((job) => void removeJob(job.id, false))}
            >
              Remove from list ({chosen.length})
            </Button>
          </div>
        )}

        <YoutubeFetchQueue onOpenSettings={onOpenSettings} />
        <YoutubeSignInBanner onOpenSettings={onOpenSettings} />

        {status && !status.binary && (
          <div
            role="alert"
            className="shrink-0 border-b-[0.5px] border-border bg-destructive/10 px-4 py-2 text-[12.5px] text-destructive"
          >
            yt-dlp was not found, so YouTube downloads cannot start. Reinstall Lightning or update
            yt-dlp.
          </div>
        )}

        {all.length > 0 && (
          <div
            role="row"
            className="sticky top-0 z-10 grid h-8 shrink-0 items-center border-b-[0.5px] border-border bg-background text-[11px] font-medium text-muted-foreground [grid-template-columns:var(--cols)]"
            style={{ '--cols': columns.template } as React.CSSProperties}
          >
            <div role="columnheader" className="flex items-center justify-center">
              <Checkbox
                aria-label="Select all YouTube downloads"
                checked={allListedChosen}
                indeterminate={chosen.length > 0 && !allListedChosen}
                disabled={listed.length === 0}
                onCheckedChange={toggleAll}
              />
            </div>
            <div role="columnheader" className="px-2">
              Name
            </div>
            <div role="columnheader" className="px-2 text-right">
              Size
            </div>
            <div role="columnheader" className="px-2">
              Status
            </div>
            <div role="columnheader" className="px-2 text-right">
              Speed
            </div>
            {columns.eta && (
              <div role="columnheader" className="px-2 text-right">
                Time left
              </div>
            )}
            {columns.added && (
              <div role="columnheader" className="px-2">
                Added
              </div>
            )}
            <div role="columnheader" />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length > 0 ? (
            <YoutubeColumnsContext.Provider value={columns}>
              {entries}
            </YoutubeColumnsContext.Provider>
          ) : all.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Video className="size-5 text-muted-foreground" />
              </div>
              <div className="text-[14px] font-medium">No YouTube downloads yet</div>
              <div className="max-w-sm text-[12.5px] text-muted-foreground">
                Paste a link to a video, or right-click a video in your browser and choose “Download
                video with Lightning”.
              </div>
              <Button type="button" variant="secondary" onClick={() => setAddOpen(true)}>
                <Plus />
                Add video
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
              <EmptyStatusIcon
                searching={search.trim() !== ''}
                status={
                  jobFilter === 'active'
                    ? 'downloading'
                    : jobFilter === 'finished'
                      ? 'completed'
                      : jobFilter === 'failed'
                        ? 'failed'
                        : 'all'
                }
              />
              Nothing matches this filter.
            </div>
          )}
        </div>

        <YoutubeAddDialog />
        <YoutubeOptionsSheet open={optionsOpen} onOpenChange={setOptionsOpen} />
      </div>
    </div>
  )
}
