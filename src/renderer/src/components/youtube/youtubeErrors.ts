import { t } from '@shared/i18n'

/** Turns a raw yt-dlp or IPC error into one plain sentence for the person, and keeps the raw text
 * for the Details disclosure. The raw text stays the source of truth; only the wording changes. */

export interface ExplainedError {
  /** What went wrong and what to do, in plain words. */
  summary: string
  /** The original message, as the app got it. */
  detail: string
}

// Electron prefixes an IPC error with the channel name, and yt-dlp adds its own "ERROR:" prefix.
const cleanRaw = (raw: string): string =>
  raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error|ERROR):\s*/, '')
    .trim()

/** The errors a sign-in can fix: YouTube asking for one, or the sign-in that was set up not being
 * readable (a locked or protected browser store). */
const SIGN_IN =
  /sign in to confirm|confirm your age|age-restricted|members[- ]only|login required|cookies? (database|file)|could not (find|copy|decrypt)[^\n]*cookie|failed to (decrypt|read)[^\n]*cookie|operation not permitted[^\n]*cookie/i

export const needsSignIn = (raw: string | null | undefined): boolean =>
  SIGN_IN.test(cleanRaw((raw ?? '').trim()))

const RULES: { match: RegExp; summary: () => string }[] = [
  {
    match: /timed out/i,
    summary: () =>
      t("YouTube didn't answer in time. Check your internet connection or VPN, then try again.")
  },
  {
    match: /HTTP Error 429|too many requests|rate[- ]?limit/i,
    summary: () => t('YouTube is limiting requests right now. Wait a few minutes and try again.')
  },
  {
    match:
      /cookies? (database|file)|could not (find|copy|decrypt)[^\n]*cookie|failed to (decrypt|read)[^\n]*cookie|operation not permitted[^\n]*cookie/i,
    summary: () => t("Lightning couldn't read the browser sign-in. Choose how to sign in below.")
  },
  {
    match: /sign in to confirm|confirm your age|age-restricted|members[- ]only|login required/i,
    summary: () => t('YouTube wants you to sign in for this video. Pick a way to sign in below.')
  },
  {
    match: /private video|video is private/i,
    summary: () => t('This video is private, so it cannot be downloaded.')
  },
  {
    match: /video (is )?unavailable|removed|no longer available|has been terminated/i,
    summary: () => t('This video is unavailable. It may have been removed.')
  },
  {
    match: /unsupported url/i,
    summary: () => t("This link isn't a YouTube video link that Lightning can download.")
  },
  {
    match: /no such file|not found|ENOENT/i,
    summary: () =>
      t('The YouTube downloader (yt-dlp) is missing. Reinstall Lightning or update yt-dlp.')
  },
  {
    match:
      /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|network is unreachable|Unable to download webpage/i,
    summary: () => t("Lightning couldn't reach YouTube. Check your internet connection or VPN.")
  }
]

export function explainYoutubeError(raw: string | null | undefined): ExplainedError {
  const detail = (raw ?? '').trim()
  if (!detail) {
    return { summary: t("Couldn't read this video. Try again."), detail: '' }
  }
  const text = cleanRaw(detail)
  const rule = RULES.find((entry) => entry.match.test(text))
  return {
    summary: rule ? rule.summary() : t("Couldn't read this video. Open Details for the reason."),
    detail
  }
}
