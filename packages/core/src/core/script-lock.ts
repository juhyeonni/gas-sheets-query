/**
 * Script-lock helpers shared by every write path that must stay atomic across
 * concurrent GAS executions (#80, #128).
 *
 * Apps Script runs the same code concurrently for different users, so any
 * read-then-write sequence against a sheet (find a row index, then write to
 * that row number) is only safe while the script lock is held for the whole
 * sequence. LockService is absent outside GAS (Node tests, bundlers), in which
 * case these helpers degrade to running the callback unlocked.
 */
import { classifyGasError, LockTimeoutError } from './errors'

/** Default time (ms) to wait for the script lock before giving up. */
export const DEFAULT_LOCK_TIMEOUT_MS = 10000

/**
 * Re-entrancy depth for the current execution.
 *
 * A GAS execution is single-threaded and already owns the lock once acquired,
 * so nested calls (a MigrationRunner holding the lock while SheetsAdapter
 * updates rows through it) must reuse the outer acquisition instead of asking
 * LockService for a second one, which would deadlock against itself.
 */
let lockDepth = 0

/**
 * Acquires the script lock, or returns null when LockService is unavailable.
 *
 * `waitLock` is documented as "timing out with an exception", and that
 * exception used to escape as a raw `Error` — indistinguishable from a bug,
 * so callers could not tell "someone else is writing, come back later" from
 * "your code is broken" (#136). It is classified here instead: a recognized
 * non-lock platform failure keeps its own type, and anything else from
 * `waitLock` is a failed acquisition, because that is the method's only
 * documented failure mode.
 *
 * No lock is held when this throws, so the caller's operation was not
 * attempted at all.
 */
function acquireLock(timeoutMs: number): GoogleAppsScript.Lock.Lock | null {
  if (typeof LockService === 'undefined') return null
  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(timeoutMs)
  } catch (error) {
    const classified = classifyGasError(error)
    if (classified !== undefined && !(classified instanceof LockTimeoutError)) {
      throw classified
    }
    // Re-created rather than rethrown so the error reports the wait budget
    // the caller actually asked for, which is not in the platform message.
    throw new LockTimeoutError(timeoutMs, error)
  }
  return lock
}

/**
 * Commits buffered SpreadsheetApp writes before the lock is released.
 *
 * SpreadsheetApp buffers mutations: a write that is still buffered when the
 * lock is released is invisible to the next lock holder, which then reads a
 * stale sheet and can commit over the uncommitted row — silent data loss
 * reproduced on the live platform by the E2E burst test (#164; two parallel
 * runs of 25 locked inserts each produced 49 rows with both callers
 * reporting success). This is why LockService's own documentation flushes
 * before releasing. No-op outside GAS and under fakes without `flush`.
 */
function flushPendingWrites(): void {
  if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.flush === 'function') {
    SpreadsheetApp.flush()
  }
}

/**
 * Runs `fn` while holding the script lock, releasing it once `fn` returns or
 * throws. Re-entrant: a nested call runs under the lock already held.
 */
export function withScriptLock<R>(fn: () => R, timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): R {
  if (lockDepth > 0) {
    lockDepth++
    try {
      return fn()
    } finally {
      lockDepth--
    }
  }

  const lock = acquireLock(timeoutMs)
  lockDepth++
  try {
    return fn()
  } finally {
    lockDepth--
    flushPendingWrites()
    if (lock) {
      lock.releaseLock()
    }
  }
}

/**
 * Async counterpart of {@link withScriptLock}: the lock is held until the
 * returned promise settles. GAS resolves promises inside the one execution
 * that created them, so the re-entrancy depth stays accurate there.
 */
export async function withScriptLockAsync<R>(
  fn: () => Promise<R>,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS
): Promise<R> {
  if (lockDepth > 0) {
    lockDepth++
    try {
      return await fn()
    } finally {
      lockDepth--
    }
  }

  const lock = acquireLock(timeoutMs)
  lockDepth++
  try {
    return await fn()
  } finally {
    lockDepth--
    flushPendingWrites()
    if (lock) {
      lock.releaseLock()
    }
  }
}
