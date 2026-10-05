import type { Checksum, RequestExtras } from '@shared/types'
import { parseChecksum } from '@shared/checksum'
import { parseHeaderLines, sanitizeExtras, splitUrlCredentials } from '@shared/requestHeaders'

/** The Advanced fields of a download dialog, as typed. */
export interface RequestDraft {
  referer: string
  cookie: string
  userAgent: string
  /** One `Name: value` per line. */
  headersText: string
  user: string
  pass: string
  /** A hash the finished file is checked against, as pasted. */
  checksum: string
}

export const EMPTY_DRAFT: RequestDraft = {
  referer: '',
  cookie: '',
  userAgent: '',
  headersText: '',
  user: '',
  pass: '',
  checksum: ''
}

export const draftIsEmpty = (draft: RequestDraft): boolean =>
  Object.values(draft).every((value) => value.trim() === '')

/** What the typed fields ask the requests to carry. Sign-in details written into `link`
 * (user:pass@host) are used unless the fields give others. */
export function extrasFromDraft(draft: RequestDraft, link = ''): RequestExtras {
  const typed = sanitizeExtras({
    headers: parseHeaderLines(draft.headersText),
    referer: draft.referer.trim(),
    cookie: draft.cookie.trim(),
    userAgent: draft.userAgent.trim(),
    auth: draft.user || draft.pass ? { user: draft.user, pass: draft.pass } : undefined
  })
  const fromLink = splitUrlCredentials(link).auth
  return fromLink && !typed.auth ? { ...typed, auth: fromLink } : typed
}

/** The hash typed in the Checksum field; undefined when it is empty or not one. */
export const checksumFromDraft = (draft: RequestDraft): Checksum | undefined =>
  parseChecksum(draft.checksum) ?? undefined

/** The Advanced fields filled in from what the browser sent along with a link. */
export function draftFromExtras(extras: RequestExtras | null): RequestDraft {
  if (!extras) return EMPTY_DRAFT
  return {
    ...EMPTY_DRAFT,
    referer: extras.referer ?? '',
    cookie: extras.cookie ?? '',
    userAgent: extras.userAgent ?? '',
    headersText: Object.entries(extras.headers ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n'),
    user: extras.auth?.user ?? '',
    pass: extras.auth?.pass ?? ''
  }
}
