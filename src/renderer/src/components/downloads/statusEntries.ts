import { Layers, type LucideIcon } from 'lucide-react'
import type { DownloadFilter } from '../../store/useAppStore'
import { statusStyle, type StatusKey } from '../../utils/status'

/** The status entries of the side panel, also listed by the filter menu when it is hidden. */
export const STATUSES: {
  value: DownloadFilter
  label: string
  icon: LucideIcon
  color?: string
  status?: StatusKey
}[] = [
  { value: 'all', label: 'All downloads', icon: Layers },
  ...(
    [
      ['downloading', 'Downloading', 'downloading'],
      ['queued', 'Queued', 'queued'],
      ['paused', 'Paused', 'paused'],
      ['finished', 'Completed', 'completed'],
      ['failed', 'Failed', 'failed']
    ] as [DownloadFilter, string, StatusKey][]
  ).map(([value, label, status]) => ({
    value,
    label,
    icon: statusStyle(status).icon,
    color: statusStyle(status).color,
    status
  }))
]
