/**
 * Bounded retry with backoff for transient Apps Script failures (#136).
 *
 * The Sheets backend fails spuriously: "Service Spreadsheets timed out",
 * "Internal error", short-term rate limits. Google's own guidance for these
 * is truncated exponential backoff. Nothing in this library retried anything,
 * so a single blip failed the whole user-facing operation.
 *
 * What this helper deliberately does *not* do:
 *
 * - It never retries an unrecognized error. A logical bug retried three times
 *   is a bug with three times the side effects.
 * - It never retries a {@link LockTimeoutError}. `waitLock` already spent the
 *   caller's full wait budget; asking again immediately just spends it twice.
 * - It never retries a daily quota or the 6-minute execution ceiling. Those
 *   cannot clear inside this execution, so sleeping on them only burns what
 *   is left of it.
 *
 * Backoff is deterministic (no jitter) on purpose: the total is two short
 * sleeps, so the thundering-herd problem jitter solves does not apply at this
 * scale, and determinism keeps the policy testable.
 */
import { classifyGasError, isTransientGasError } from './errors.js'

/** Total number of calls (not extra retries) a guarded operation may make. */
export const DEFAULT_RETRY_ATTEMPTS = 3

/** Delay before the first retry; each further retry doubles it. */
export const DEFAULT_RETRY_BASE_DELAY_MS = 500

/** Options for {@link withRetries}. */
export interface RetryOptions {
  /**
   * Total attempts, including the first. `1` disables retrying but keeps the
   * error classification, which is how non-idempotent calls are guarded.
   */
  attempts?: number
  /** Delay before the first retry, in ms. Doubles on each subsequent retry. */
  baseDelayMs?: number
  /**
   * Sleep implementation. Defaults to `Utilities.sleep` on GAS and to a no-op
   * everywhere else — Node has no synchronous sleep, and blocking a test run
   * for seconds to reproduce a platform delay buys nothing.
   */
  sleep?: (ms: number) => void
}

/** `Utilities.sleep` when running on the platform; a no-op otherwise. */
function platformSleep(ms: number): void {
  if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
    Utilities.sleep(ms)
  }
}

/**
 * Run `fn`, retrying transient GAS failures with exponential backoff.
 *
 * Whatever finally escapes is the typed error from
 * {@link classifyGasError} when the platform message is recognized, and the
 * original value untouched when it is not. So even with `attempts: 1` this is
 * worth wrapping around a Sheets call: it is what turns raw platform strings
 * into `QuotaExceededError` / `SheetsApiError` at the API boundary.
 *
 * Worst-case added latency with the defaults is `500 + 1000 = 1500ms` per
 * guarded call. Callers that hold the script lock across several guarded
 * calls should keep that multiplication in mind — see the note on
 * `SheetsAdapter.sheetsCall`.
 */
export function withRetries<R>(fn: () => R, options: RetryOptions = {}): R {
  const attempts = options.attempts ?? DEFAULT_RETRY_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const sleep = options.sleep ?? platformSleep

  let attempt = 0
  for (;;) {
    attempt++
    try {
      return fn()
    } catch (error) {
      const isLastAttempt = attempt >= attempts
      if (isLastAttempt || !isTransientGasError(error)) {
        throw classifyGasError(error) ?? error
      }
      sleep(baseDelayMs * Math.pow(2, attempt - 1))
    }
  }
}
