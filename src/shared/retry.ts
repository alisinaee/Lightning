/** Failures that a later try can fix: the network, a busy or failing server. The ones that
 * need the user (a refused link, a full disk, a missing partial file) are not. */
const NEEDS_USER =
  /status (401|403|404|410)|ENOSPC|EDQUOT|EACCES|EPERM|EROFS|partial download file|different file|changed on the server|Invalid|CERT|SSL|TLS/i
const TRANSIENT =
  /status (408|425|429|5\d\d)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|No network could reach|stalled|timed out|interrupted/i

export function isTransientFailure(message: string | undefined): boolean {
  if (!message || NEEDS_USER.test(message)) return false
  return TRANSIENT.test(message)
}

/** Seconds before automatic try number `attempt` (1-based): 15, 30, 60, 120, 300. */
export function autoRetryDelaySeconds(attempt: number): number {
  return [15, 30, 60, 120, 300][Math.min(Math.max(attempt, 1), 5) - 1]
}

export const AUTO_RETRY_ATTEMPTS = 5
