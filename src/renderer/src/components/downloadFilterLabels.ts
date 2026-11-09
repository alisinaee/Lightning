import { t } from '@shared/i18n/react'
import type { DownloadFilter } from '../store/useAppStore'

export const DOWNLOAD_FILTERS: { value: DownloadFilter; readonly label: string }[] = [
  {
    value: 'all',
    get label() {
      return t('All downloads')
    }
  },
  {
    value: 'progress',
    get label() {
      return t('In progress')
    }
  },
  {
    value: 'finished',
    get label() {
      return t('Finished')
    }
  },
  {
    value: 'failed',
    get label() {
      return t('Needs attention')
    }
  }
]

const finerLabel = (value: DownloadFilter): string | undefined =>
  value === 'downloading'
    ? t('Downloading')
    : value === 'queued'
      ? t('Queued')
      : value === 'paused'
        ? t('Paused')
        : undefined

/** What a filter is called, whichever place set it. */
export function filterLabel(value: DownloadFilter): string {
  return (
    DOWNLOAD_FILTERS.find((filter) => filter.value === value)?.label ??
    finerLabel(value) ??
    t('All downloads')
  )
}
