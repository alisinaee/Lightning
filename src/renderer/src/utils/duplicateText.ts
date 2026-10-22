import type { DuplicateMatch } from '@shared/duplicates'

/** A folder written as ~ when it is inside a home folder (macOS, Linux or Windows). */
function shortFolder(folder: string): string {
  return folder.replace(/^(\/Users|\/home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The one-line notice for an existing copy of a link, shown next to its file name. */
export function describeDuplicate(match: DuplicateMatch): string {
  switch (match.kind) {
    case 'downloading':
      return match.percent === undefined
        ? 'Already downloading'
        : `Already downloading (${Math.round(match.percent)}%)`
    case 'queued':
      return 'Already in the queue'
    case 'paused':
      return 'Paused download of this file exists'
    case 'group-waiting':
      return 'Already waiting in a group download'
    case 'history': {
      const when =
        match.completedAt === undefined ? 'Finished' : `Finished on ${shortDate(match.completedAt)}`
      if (match.missing) return `${when} — the file was moved or deleted`
      const folder = match.folder ? ` — the file is still in ${shortFolder(match.folder)}` : ''
      return `${when}${folder}`
    }
    case 'file-on-disk':
      return 'A file with this name is already in the folder'
  }
}
