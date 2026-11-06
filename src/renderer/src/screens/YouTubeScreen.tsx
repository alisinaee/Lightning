import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, SlidersHorizontal, Video } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { YoutubeIcon } from '../components/youtube/YoutubeIcon'
import { YoutubeAddDialog } from '../components/youtube/YoutubeAddDialog'
import { YoutubeOptionsSheet } from '../components/youtube/YoutubeOptionsSheet'
import { YoutubeJobRow } from '../components/youtube/YoutubeJobRow'
import { YoutubeGroupRow } from '../components/youtube/YoutubeGroupRow'
import { YOUTUBE_COLUMNS } from '../components/youtube/youtubeRowModel'
import { YoutubeFetchQueue } from '../components/youtube/YoutubeFetchQueue'
import {
  isActiveYoutubeJob,
  isFailedYoutubeJob,
  isFinishedYoutubeJob,
  useYoutubeStore,
  type YoutubeJobFilter
} from '../store/useYoutubeStore'
import type { YoutubeJob } from '@shared/youtube'

const matchesFilter = (job: YoutubeJob, filter: YoutubeJobFilter): boolean => {
  if (filter === 'active') return isActiveYoutubeJob(job)
  if (filter === 'finished') return isFinishedYoutubeJob(job)
  if (filter === 'failed') return isFailedYoutubeJob(job)
  return true
}

/** The YouTube downloader: a list of its downloads, with the add dialog and the options sheet. */
export function YouTubeScreen(): React.JSX.Element {
  const jobs = useYoutubeStore((store) => store.jobs)
  const status = useYoutubeStore((store) => store.status)
  const jobFilter = useYoutubeStore((store) => store.jobFilter)
  const search = useYoutubeStore((store) => store.search)
  const setSearch = useYoutubeStore((store) => store.setSearch)
  const refreshStatus = useYoutubeStore((store) => store.refreshStatus)
  const loadJobs = useYoutubeStore((store) => store.loadJobs)
  const loadOptions = useYoutubeStore((store) => store.loadOptions)
  const setAddOpen = useYoutubeStore((store) => store.setAddOpen)
  const [optionsOpen, setOptionsOpen] = useState(false)
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
      items.push({ at: job.createdAt, node: <YoutubeJobRow key={job.id} job={job} /> })
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
            {expanded && list.map((job) => <YoutubeJobRow key={job.id} job={job} nested />)}
          </div>
        )
      })
    }
    return items.sort((a, b) => b.at - a.at).map((item) => item.node)
  }, [visible, expandedGroups])

  return (
    <div className="flex h-full min-w-0 flex-1 bg-background">
      <div className="@container flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b-[0.5px] border-border px-3">
          <h1 className="flex shrink-0 items-center gap-2 text-[14px] font-semibold">
            <YoutubeIcon className="size-4 text-[#ff0033]" />
            YouTube
          </h1>
          <Badge variant="outline" className="shrink-0">
            {status?.binary ? `yt-dlp ${status.version ?? ''}`.trim() : 'yt-dlp missing'}
          </Badge>
          {status && !status.ffmpeg && (
            <Badge variant="destructive" className="shrink-0">
              ffmpeg missing
            </Badge>
          )}

          <div className="flex-1" />

          <div className="relative w-[260px] min-w-[140px] shrink">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Search YouTube downloads"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('')
              }}
              className="h-8 pl-7 text-[12.5px] [&::-webkit-search-cancel-button]:hidden"
            />
          </div>

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
            <TooltipContent>Options</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  aria-label="Add video"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus />
                </Button>
              }
            />
            <TooltipContent>Add video</TooltipContent>
          </Tooltip>
        </div>

        <YoutubeFetchQueue />

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
            style={{ '--cols': YOUTUBE_COLUMNS } as React.CSSProperties}
          >
            <div role="columnheader" />
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
            <div role="columnheader" className="px-2 text-right">
              Time left
            </div>
            <div role="columnheader" className="px-2">
              Added
            </div>
            <div role="columnheader" />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length > 0 ? (
            entries
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
            <div className="flex h-full items-center justify-center text-[12.5px] text-muted-foreground">
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
