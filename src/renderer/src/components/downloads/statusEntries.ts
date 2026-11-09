import { Stack as Layers, type Icon } from '@phosphor-icons/react'
import { t } from '@shared/i18n/react'
import type { DownloadFilter } from '../../store/useAppStore'
import { statusStyle, type StatusKey } from '../../utils/status'

/** The status entries of the side panel, also listed by the filter menu when it is hidden. */
export const STATUSES: {
  value: DownloadFilter
  label: string
  icon: Icon
  color?: string
  status?: StatusKey
}[] = [
  {
    value: 'all',
    get label() {
      return t('All downloads')
    },
    icon: Layers
  },
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
    get label() {
      return t(label)
    },
    icon: statusStyle(status).icon,
    color: statusStyle(status).color,
    status
  }))
]
