/**
 * Time-budgeted chunked execution for jobs larger than one GAS run (#136).
 *
 * Apps Script kills an execution at 6 minutes, wherever it is. A job that
 * writes a few thousand rows in one call either finishes or dies mid-write,
 * and the caller cannot tell how far it got. {@link runChunked} splits the job
 * into chunks, stops cleanly before the deadline, and hands back a cursor the
 * next execution (usually a time-driven trigger) resumes from.
 *
 * It is deliberately generic: `write` is any function, so the same runner
 * covers `batchInsert`, `batchUpdate`, `batchDelete` or a caller's own work,
 * on any store, without widening the `DataStore` contract. The batch methods
 * themselves stay all-or-nothing; chunking is opt-in.
 *
 * What it deliberately does *not* do:
 *
 * - It does not hold the script lock across chunks. Each `write` takes its
 *   own lock (the batch methods already do). Holding it for minutes would
 *   make every other execution time out with `LockTimeoutError`.
 * - It does not catch, wrap or retry errors from `write`. Whatever `write`
 *   throws escapes unchanged, so callers keep handling `QuotaExceededError` /
 *   `LockTimeoutError` as documented. Retrying transient failures is already
 *   done inside the adapter.
 * - It is not exactly-once across hard kills. The cursor reported through
 *   `onChunk` is at-least-once: if the runtime kills the execution after a
 *   chunk landed but before its cursor was saved, that chunk is written again
 *   on resume.
 */
import { ValidationError } from './errors.js'

/** Default time budget: 5.5 minutes, leaving headroom under the 6-minute ceiling. */
export const DEFAULT_CHUNK_BUDGET_MS = 330_000

/** Default number of items handed to each `write` call. */
export const DEFAULT_CHUNK_SIZE = 500

/** What {@link RunChunkedOptions.onChunk} receives after each completed chunk. */
export interface ChunkProgress<R> {
  /** Index in `items` to resume from if the job stops after this chunk. */
  next: number
  /** The value `write` returned for this chunk. */
  result: R
}

/** Options for {@link runChunked}. */
export interface RunChunkedOptions<R> {
  /**
   * When the current execution started, in epoch ms. The library cannot see
   * this, so capture `Date.now()` at the very top of the trigger handler and
   * pass it here.
   */
  startedAt: number
  /**
   * Time budget measured from `startedAt`, in ms. Defaults to
   * {@link DEFAULT_CHUNK_BUDGET_MS} (5.5 minutes).
   */
  budgetMs?: number
  /** Items per `write` call. A positive integer; defaults to {@link DEFAULT_CHUNK_SIZE}. */
  chunkSize?: number
  /**
   * Index in `items` to start from, `0..items.length`. Pass the `next` of a
   * stopped run (or the last cursor saved from `onChunk`) to resume it.
   */
  startAt?: number
  /**
   * Called after each completed chunk, never for a chunk whose `write` threw.
   * Persist `next` here (e.g. in `PropertiesService`) so that even a hard
   * kill loses at most the chunk in flight. Time spent here counts toward the
   * chunk's measured duration.
   */
  onChunk?: (progress: ChunkProgress<R>) => void
}

/** Result of {@link runChunked}. */
export interface RunChunkedResult<R> {
  /** `true` once every item has been written. */
  done: boolean
  /**
   * Index in `items` of the first item not written. Equals `items.length`
   * once `done` is `true`.
   */
  next: number
  /** Each chunk's `write` return value from this call, in order. */
  results: R[]
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Write `items` in chunks until done or until the time budget runs out.
 *
 * `write(chunk, offset)` is called once per chunk, in input order; `offset`
 * is the index of the chunk's first item in `items`.
 *
 * Stopping rule: no chunk starts once `startedAt + budgetMs` has been
 * reached. After the first chunk of this call, no chunk starts either if the
 * current time plus the slowest chunk measured so far in this call would pass
 * that deadline. The measured time adapts to table width and quota pressure,
 * where a fixed safety margin would either waste the budget or be too small.
 *
 * If `write` throws, the error propagates unchanged and no further chunk
 * runs. Chunks completed before it stay written; the cursor last reported
 * through `onChunk` is the resume point.
 *
 * @throws {ValidationError} when an option is out of range, before `write` is
 *   ever called.
 *
 * @example
 * ```ts
 * function importRows() {
 *   const startedAt = Date.now()
 *   const props = PropertiesService.getScriptProperties()
 *   const startAt = Number(props.getProperty('importCursor') ?? 0)
 *
 *   const { done } = runChunked(rows, chunk => db.from('users').batchInsert(chunk), {
 *     startedAt,
 *     startAt,
 *     onChunk: ({ next }) => props.setProperty('importCursor', String(next))
 *   })
 *   if (done) props.deleteProperty('importCursor')
 * }
 * ```
 */
export function runChunked<T, R>(
  items: readonly T[],
  write: (chunk: T[], offset: number) => R,
  options: RunChunkedOptions<R>
): RunChunkedResult<R> {
  const { startedAt, onChunk } = options
  const budgetMs = options.budgetMs ?? DEFAULT_CHUNK_BUDGET_MS
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const startAt = options.startAt ?? 0

  if (!Number.isFinite(startedAt)) {
    throw new ValidationError(`startedAt must be a finite epoch time in ms, got ${startedAt}`, 'startedAt')
  }
  if (!isNonNegativeFinite(budgetMs)) {
    throw new ValidationError(`budgetMs must be a non-negative finite number, got ${budgetMs}`, 'budgetMs')
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new ValidationError(`chunkSize must be a positive integer, got ${chunkSize}`, 'chunkSize')
  }
  if (!Number.isInteger(startAt) || startAt < 0 || startAt > items.length) {
    throw new ValidationError(
      `startAt must be an integer in 0..${items.length}, got ${startAt}`,
      'startAt'
    )
  }

  const deadline = startedAt + budgetMs
  const results: R[] = []
  let next = startAt
  let slowestChunkMs: number | undefined

  while (next < items.length) {
    const chunkStart = Date.now()
    if (chunkStart >= deadline) break
    if (slowestChunkMs !== undefined && chunkStart + slowestChunkMs > deadline) break

    const offset = next
    const result = write(items.slice(offset, offset + chunkSize), offset)
    next = Math.min(offset + chunkSize, items.length)
    results.push(result)
    onChunk?.({ next, result })

    const elapsed = Date.now() - chunkStart
    slowestChunkMs = slowestChunkMs === undefined ? elapsed : Math.max(slowestChunkMs, elapsed)
  }

  return { done: next >= items.length, next, results }
}
