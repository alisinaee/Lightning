import { formatDate, t } from '@shared/i18n/react'
import type { DuplicateMatch } from '@shared/duplicates'

/** A folder written as ~ when it is inside a home folder (macOS, Linux or Windows). */
function shortFolder(folder: string): string {
  return folder.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

function shortDate(time: number): string {
  return formatDate(time, { month: 'short', day: 'numeric' })
}

/** The one-line notice for an existing copy of a link, shown next to its file name. */
export function describeDuplicate(match: DuplicateMatch): string {
  switch (match.kind) {
    case 'downloading':
      return match.percent === undefined
        ? t('Already downloading')
        : t('Already downloading ({percent}%)', { percent: Math.round(match.percent) })
    case 'queued':
      return t('Already in the queue')
    case 'paused':
      return t('Paused download of this file exists')
    case 'group-waiting':
      return t('Already waiting in a group download')
    case 'history': {
      const when =
        match.completedAt === undefined
          ? t('Finished')
          : t('Finished on {date}', { date: shortDate(match.completedAt) })
      if (match.missing) return t('{when} — the file was moved or deleted', { when })
      return match.folder
        ? t('{when} — the file is still in {folder}', {
            when,
            folder: shortFolder(match.folder)
          })
        : when
    }
    case 'file-on-disk':
      return t('A file with this name is already in the folder')
  }
}
