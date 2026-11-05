import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Search,
  Settings,
  Trash2,
  Video,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { YoutubeIcon } from '../components/youtube/YoutubeIcon'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useAppStore } from '../store/useAppStore'
import {
  isActiveYoutubeJob,
  isFailedYoutubeJob,
  isFinishedYoutubeJob,
  useYoutubeStore
} from '../store/useYoutubeStore'
import type { YoutubeFormatOption, YoutubeJob } from '@shared/youtube'
import { formatBytes, formatSeconds } from '../utils/format'

export function YouTubeScreen({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element {
  const setView = useAppStore((store) => store.setView)

  const jobs = useYoutubeStore((store) => store.jobs)
  const status = useYoutubeStore((store) => store.status)
  const inputUrl = useYoutubeStore((store) => store.inputUrl)
  const setInputUrl = useYoutubeStore((store) => store.setInputUrl)
  const probeState = useYoutubeStore((store) => store.probeState)
  const currentProbe = useYoutubeStore((store) => store.currentProbe)
  const probeError = useYoutubeStore((store) => store.probeError)
  const selectedFormat = useYoutubeStore((store) => store.selectedFormat)
  const setSelectedFormat = useYoutubeStore((store) => store.setSelectedFormat)

  const probeUrl = useYoutubeStore((store) => store.probeUrl)
  const startDownload = useYoutubeStore((store) => store.startDownload)
  const clearProbe = useYoutubeStore((store) => store.clearProbe)

  const pauseJob = useYoutubeStore((store) => store.pauseJob)
  const resumeJob = useYoutubeStore((store) => store.resumeJob)
  const cancelJob = useYoutubeStore((store) => store.cancelJob)
  const retryJob = useYoutubeStore((store) => store.retryJob)
  const removeJob = useYoutubeStore((store) => store.removeJob)
  const revealJob = useYoutubeStore((store) => store.revealJob)
  const openJob = useYoutubeStore((store) => store.openJob)

  const jobFilter = useYoutubeStore((store) => store.jobFilter)
  const setJobFilter = useYoutubeStore((store) => store.setJobFilter)
  const search = useYoutubeStore((store) => store.search)
  const setSearch = useYoutubeStore((store) => store.setSearch)

  const refreshStatus = useYoutubeStore((store) => store.refreshStatus)
  const loadJobs = useYoutubeStore((store) => store.loadJobs)

  useEffect(() => {
    void refreshStatus()
    void loadJobs()
  }, [refreshStatus, loadJobs])

  const [starting, setStarting] = useState(false)

  const handlePaste = useCallback(async () => {
    try {
      const text = await window.lightning.readClipboardText()
      if (text) {
        setInputUrl(text)
        void probeUrl(text)
      }
    } catch {
      // ignore
    }
  }, [probeUrl, setInputUrl])

  const handleStart = async (format?: YoutubeFormatOption): Promise<void> => {
    setStarting(true)
    try {
      await startDownload(format)
    } finally {
      setStarting(false)
    }
  }

  const jobList = Object.values(jobs)
    .filter((j) => {
      if (search.trim()) {
        const query = search.toLowerCase()
        if (!j.title.toLowerCase().includes(query) && !j.url.toLowerCase().includes(query)) {
          return false
        }
      }
      if (jobFilter === 'active') return isActiveYoutubeJob(j)
      if (jobFilter === 'finished') return isFinishedYoutubeJob(j)
      if (jobFilter === 'failed') return isFailedYoutubeJob(j)
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setView({ name: 'list' })}
            aria-label="Back to downloads"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <YoutubeIcon className="size-5 text-red-500" />
            <span className="font-semibold text-sm">YouTube Downloader</span>
          </div>
          {status && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground ml-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                yt-dlp {status.version ?? 'ready'}
              </span>
              {status.ffmpeg && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  ffmpeg active
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={onOpenSettings}
                >
                  <Settings className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-5xl mx-auto w-full">
        {/* Link input & probe box */}
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void probeUrl(inputUrl)
                }}
                placeholder="Paste YouTube video or shorts link (e.g. https://www.youtube.com/watch?v=...)"
                className="pr-20"
              />
              {inputUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setInputUrl('')
                    clearProbe()
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <Button type="button" variant="secondary" onClick={handlePaste} className="shrink-0">
              Paste Link
            </Button>

            <Button
              type="button"
              onClick={() => void probeUrl(inputUrl)}
              disabled={probeState === 'loading' || !inputUrl.trim()}
              className="shrink-0"
            >
              {probeState === 'loading' ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-1.5" />
                  Analyzing…
                </>
              ) : (
                'Fetch Formats'
              )}
            </Button>
          </div>

          {/* Error Message */}
          {probeError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{probeError}</span>
            </div>
          )}

          {/* Video Metadata Preview */}
          {currentProbe && (
            <div className="rounded-lg border bg-muted/40 p-4 space-y-4 animate-in fade-in-50 duration-200">
              <div className="flex gap-4">
                {currentProbe.thumbnail && (
                  <div className="relative aspect-video w-48 shrink-0 overflow-hidden rounded-md bg-black">
                    <img
                      src={currentProbe.thumbnail}
                      alt={currentProbe.title}
                      className="size-full object-cover"
                    />
                    {currentProbe.duration !== undefined && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] text-white">
                        {formatSeconds(currentProbe.duration)}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex-1 min-w-0 space-y-1">
                  <h3 className="font-semibold text-sm line-clamp-2 leading-snug">
                    {currentProbe.title}
                  </h3>
                  {currentProbe.channel && (
                    <p className="text-xs text-muted-foreground">{currentProbe.channel}</p>
                  )}
                  {currentProbe.description && (
                    <p className="text-xs text-muted-foreground/80 line-clamp-2 pt-1">
                      {currentProbe.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Format selection */}
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Select Format & Quality:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {currentProbe.formats.map((fmt) => {
                    const isSelected = selectedFormat?.formatId === fmt.formatId
                    return (
                      <button
                        key={fmt.formatId}
                        type="button"
                        onClick={() => setSelectedFormat(fmt)}
                        className={`flex flex-col items-start p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                            : 'border-border bg-card hover:bg-accent text-foreground'
                        }`}
                      >
                        <div className="font-semibold">{fmt.resolution}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center justify-between w-full mt-1">
                          <span>{fmt.ext.toUpperCase()}</span>
                          {fmt.filesize && <span>~{formatBytes(fmt.filesize)}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={clearProbe}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!selectedFormat || starting}
                    onClick={() => void handleStart()}
                  >
                    {starting ? (
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Download className="size-3.5 mr-1.5" />
                    )}
                    Download {selectedFormat?.resolution}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Downloads section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Downloads ({jobList.length})</h2>

            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                {(['all', 'active', 'finished', 'failed'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setJobFilter(tab)}
                    className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                      jobFilter === tab
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="relative w-48">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          {jobList.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center space-y-2">
              <Video className="size-8 mx-auto text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">No YouTube downloads in this view</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobList.map((job) => (
                <YoutubeJobRow
                  key={job.id}
                  job={job}
                  onPause={() => void pauseJob(job.id)}
                  onResume={() => void resumeJob(job.id)}
                  onCancel={() => void cancelJob(job.id)}
                  onRetry={() => void retryJob(job.id)}
                  onRemove={(deleteFile) => void removeJob(job.id, deleteFile)}
                  onReveal={() => revealJob(job.id)}
                  onOpen={() => openJob(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function YoutubeJobRow({
  job,
  onPause,
  onResume,
  onRetry,
  onRemove,
  onReveal,
  onOpen
}: {
  job: YoutubeJob
  onPause: () => void
  onResume: () => void
  onCancel?: () => void
  onRetry: () => void
  onRemove: (deleteFile?: boolean) => void
  onReveal: () => void
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-2xs hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {job.thumbnail ? (
          <img
            src={job.thumbnail}
            alt={job.title}
            className="size-12 rounded object-cover shrink-0 bg-muted"
          />
        ) : (
          <div className="size-12 rounded bg-muted flex items-center justify-center shrink-0">
            <Video className="size-5 text-muted-foreground" />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="font-medium text-xs truncate cursor-pointer hover:underline"
              onClick={job.status === 'completed' ? onOpen : undefined}
            >
              {job.title}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              {job.resolution}
            </span>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
            {job.status === 'downloading' && (
              <>
                <div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${job.percent}%` }}
                  />
                </div>
                <span>{job.percent.toFixed(1)}%</span>
                {job.speed > 0 && <span>{formatBytes(job.speed)}/s</span>}
                {job.eta !== undefined && <span>ETA {formatSeconds(job.eta)}</span>}
              </>
            )}

            {job.status === 'completed' && (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Completed
              </span>
            )}

            {job.status === 'paused' && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Clock className="size-3.5" />
                Paused ({job.percent.toFixed(1)}%)
              </span>
            )}

            {job.status === 'error' && (
              <span className="flex items-center gap-1 text-destructive truncate max-w-md">
                <AlertCircle className="size-3.5 shrink-0" />
                {job.error || 'Failed'}
              </span>
            )}

            {job.status === 'cancelled' && <span className="text-muted-foreground">Cancelled</span>}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
        {job.status === 'downloading' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onPause}
            title="Pause"
          >
            <Pause className="size-3.5" />
          </Button>
        )}

        {job.status === 'paused' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onResume}
            title="Resume"
          >
            <Play className="size-3.5" />
          </Button>
        )}

        {job.status === 'error' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onRetry}
            title="Retry"
          >
            <RotateCw className="size-3.5" />
          </Button>
        )}

        {job.status === 'completed' && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onOpen}
              title="Open Video"
            >
              <Play className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReveal}
              title="Show in Folder"
            >
              <FolderOpen className="size-3.5" />
            </Button>
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(job.status === 'completed')}
          title="Remove"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
