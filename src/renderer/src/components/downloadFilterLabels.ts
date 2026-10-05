import type { DownloadFilter } from '../store/useAppStore'

export const DOWNLOAD_FILTERS: { value: DownloadFilter; label: string }[] = [
  { value: 'all', label: 'All downloads' },
  { value: 'progress', label: 'In progress' },
  { value: 'finished', label: 'Finished' },
  { value: 'failed', label: 'Needs attention' }
]

const FINER_LABELS: Partial<Record<DownloadFilter, string>> = {
  downloading: 'Downloading',
  queued: 'Queued',
  paused: 'Paused'
}

/** What a filter is called, whichever place set it. */
export function filterLabel(value: DownloadFilter): string {
  return (
    DOWNLOAD_FILTERS.find((filter) => filter.value === value)?.label ??
    FINER_LABELS[value] ??
    'All downloads'
  )
}
