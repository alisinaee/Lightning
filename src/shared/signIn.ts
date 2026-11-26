// Electron prefixes an IPC error with the channel name, and yt-dlp adds its own "ERROR:" prefix.
const cleanRaw = (raw: string): string =>
  raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error|ERROR):\s*/, '')
    .trim()

/** The errors a sign-in can fix: YouTube asking for one, or the sign-in that was set up not being
 * readable (a locked or protected browser store). */
const SIGN_IN =
  /sign in to confirm|cookies are no longer valid|confirm your age|age-restricted|members[- ]only|login required|cookies? (database|file)|could not (find|copy|decrypt)[^\n]*cookie|failed to (decrypt|read)[^\n]*cookie|operation not permitted[^\n]*cookie/i

export const needsSignIn = (raw: string | null | undefined): boolean =>
  SIGN_IN.test(cleanRaw((raw ?? '').trim()))
