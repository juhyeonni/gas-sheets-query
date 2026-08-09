/**
 * SyncEngine - Async pull/push/reconcile with event system and debounce
 */
import type { RowWithId } from '@gsquery/core'
import type {
  SyncTransport,
  SyncEvent,
  SyncEventListener,
  SyncPushResult,
  ConflictStrategy,
  ConflictItem,
  MergedMutation,
  PoisonedMutationAction,
  PoisonedMutationHandler,
  RejectedMutationIds,
} from './sync-transport.js'
import type { LocalAdapter } from './local-adapter.js'
import type { MutationQueue } from './mutation-queue.js'

/** Default number of consecutive push failures before a batch is dead-lettered */
const DEFAULT_MAX_RETRIES = 5
/** Default first backoff step for a failing table */
const DEFAULT_RETRY_BASE_DELAY_MS = 1000
/** Default ceiling for the exponential backoff */
const DEFAULT_MAX_RETRY_DELAY_MS = 60_000

export interface SyncEngineOptions {
  transport: SyncTransport
  conflictStrategy?: ConflictStrategy
  /** Debounce ms for auto-push after mutations (default: 0 = disabled) */
  pushDebounceMs?: number
  /**
   * Consecutive push failures for one table before its batch is treated as
   * poisoned and reported via `onPoisonedMutation` / the `mutation-dead` event
   * (default: 5). `0` disables dead-lettering.
   */
  maxRetries?: number
  /**
   * First step of the exponential backoff applied to a failing table's
   * *background* attempts (default: 1000ms). `0` disables backoff.
   */
  retryBaseDelayMs?: number
  /** Ceiling for the exponential backoff (default: 60000ms) */
  maxRetryDelayMs?: number
  /**
   * Called when a table's batch has failed `maxRetries` times in a row, with
   * the mutations still unapplied at that point (#176). Its return value picks
   * what leaves the queue: `'retain'`, `'discard'`, or an explicit list of ids
   * (#174) — see {@link PoisonedMutationAction}.
   */
  onPoisonedMutation?: PoisonedMutationHandler
}

/** A single table's failure inside an otherwise partial sync */
export interface TableSyncError {
  table: string
  error: Error
}

/**
 * Thrown by sync/push/pull when one or more tables failed.
 *
 * Every table is attempted regardless of what the others do (#132), so this is
 * raised only after the whole pass finishes and it carries one entry per failed
 * table. The individual errors were already emitted as per-table `error` events.
 */
export class SyncError extends Error {
  readonly tableErrors: readonly TableSyncError[]

  constructor(tableErrors: TableSyncError[]) {
    super(
      `Sync failed for ${tableErrors.length} table(s): ` +
        tableErrors.map(t => `${t.table}: ${t.error.message}`).join('; ')
    )
    this.name = 'SyncError'
    this.tableErrors = tableErrors
  }
}

/**
 * Internal marker for a failure raised by the push phase, carrying the batch
 * that failed so the dead-letter path can report and optionally discard it.
 * Never leaves the engine — callers see `inner` instead.
 */
class PushPhaseError extends Error {
  constructor(
    readonly inner: Error,
    /**
     * The mutations still unapplied when the push failed — the pushed batch
     * minus whatever the server confirmed via `appliedIds`. Reporting the raw
     * pre-push snapshot named rows that had already landed (#176).
     */
    readonly mutations: MergedMutation[],
    readonly boundary: number,
    /** Ids the transport named as refused, if it named any (#174) */
    readonly rejectedIds?: readonly (string | number)[]
  ) {
    super(inner.message)
    this.name = 'PushPhaseError'
  }
}

/**
 * Read the optional `rejectedIds` a transport may attach to the error it throws
 * (see {@link RejectedMutationIds}). Defensive: the value crosses an untyped
 * boundary, so anything that is not an array of ids is treated as absent.
 */
function readRejectedIds(source: unknown): readonly (string | number)[] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const { rejectedIds } = source as RejectedMutationIds
  if (!Array.isArray(rejectedIds)) return undefined
  const ids = rejectedIds.filter(
    (id): id is string | number => typeof id === 'string' || typeof id === 'number'
  )
  return ids.length > 0 ? ids : undefined
}

/**
 * Translate a poisoned-batch decision into the exact set of ids to drop.
 *
 * The whole point is granularity (#174): with an all-or-nothing backend a
 * single bad row used to cost the app every other mutation in the batch. Now
 * the smallest defensible set wins — the handler's explicit list first, then the
 * ids the transport named, and only as a last resort the whole batch, which is
 * all the engine can distinguish when nobody says which row is at fault.
 */
function resolveDiscardIds(
  action: PoisonedMutationAction | void,
  batchIds: ReadonlySet<string | number>,
  rejectedIds: readonly (string | number)[] | undefined
): Set<string | number> {
  if (Array.isArray(action)) {
    return new Set(action.filter(id => batchIds.has(id)))
  }
  if (action !== 'discard') return new Set()
  if (rejectedIds && rejectedIds.length > 0) return new Set(rejectedIds)
  return new Set(batchIds)
}

/**
 * What one pass over the requested tables left undone, beyond the failures it
 * raises.
 *
 * This is what separates "everything asked for is in sync" from "nothing was
 * even tried": a backoff-skipped table moved no data in either direction, so a
 * pass that skipped one is not a completed sync (#173).
 */
interface SyncPassOutcome {
  /** Tables skipped because their backoff window is still open */
  deferred: string[]
}

/**
 * The slice of LocalAdapter the engine touches, widened to RowWithId.
 *
 * A registered `LocalAdapter<T>` cannot be stored as `LocalAdapter<RowWithId>`
 * (T appears in input positions), and `any` would erase the row shape for the
 * whole engine — so bind against the two methods actually used instead.
 */
interface SyncAdapter {
  getRawData(): RowWithId[]
  replaceAll(rows: RowWithId[]): void
}

/** The slice of MutationQueue the engine touches, widened to RowWithId. */
interface SyncQueue {
  getMerged(): MergedMutation[]
  currentSeq(): number
  clearForRows(ids: Set<string | number>, maxSeq?: number): void
  purgeCancelled(maxSeq?: number): void
  push(type: 'insert' | 'update' | 'delete', id: string | number, data?: Partial<RowWithId>): void
}

interface TableBinding {
  adapter: SyncAdapter
  queue: SyncQueue
}

/** Per-table failure bookkeeping for backoff and dead-lettering */
interface TableRetryState {
  /** Consecutive failures of any phase — drives the backoff window */
  failures: number
  /** Consecutive *push* failures — drives dead-lettering */
  pushFailures: number
  /** Epoch ms before which background attempts skip this table */
  nextAttemptAt: number
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

export class SyncEngine {
  private readonly transport: SyncTransport
  private readonly conflictStrategy: ConflictStrategy
  private readonly tables = new Map<string, TableBinding>()

  private readonly listeners: SyncEventListener[] = []
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private pushDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pushDebounceMs: number
  private syncing = false
  private opChain: Promise<unknown> = Promise.resolve()

  private readonly maxRetries: number
  private readonly retryBaseDelayMs: number
  private readonly maxRetryDelayMs: number
  private readonly onPoisonedMutation?: PoisonedMutationHandler
  private readonly retryStates = new Map<string, TableRetryState>()

  constructor(options: SyncEngineOptions) {
    this.transport = options.transport
    this.conflictStrategy = options.conflictStrategy ?? 'server-wins'
    this.pushDebounceMs = options.pushDebounceMs ?? 0
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
    this.onPoisonedMutation = options.onPoisonedMutation
  }

  /** Register a table for sync */
  registerTable<T extends RowWithId>(
    tableName: string,
    adapter: LocalAdapter<T>,
    queue: MutationQueue<T>
  ): void {
    this.tables.set(tableName, { adapter, queue })
  }

  /** Subscribe to sync events */
  on(listener: SyncEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Don't let listener errors break sync
      }
    }
  }

  /**
   * Run an operation after every previously started one has settled, so
   * sync/push/pull never interleave.
   *
   * pullTable reads the mutation queue *after* awaiting the server snapshot.
   * A push landing in that window clears the queue, and the now-stale snapshot
   * overwrites the local edit with nothing left to re-apply it (#104).
   * Serializing also stops two pushes from snapshotting the same mutations
   * (#111).
   */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn)
    this.opChain = run.then(
      () => {},
      () => {}
    )
    return run
  }

  /** Full sync: push first (preserve local changes), then pull */
  async sync(tableName?: string): Promise<void> {
    return this.runSync(tableName, false)
  }

  /** Push local mutations to server */
  async push(tableName?: string): Promise<void> {
    return this.runPush(tableName, false)
  }

  /** Pull server data to local */
  async pull(tableName?: string): Promise<void> {
    await this.serialize(() =>
      this.runTables(tableName, false, name => this.pullTable(name))
    )
  }

  private async runSync(tableName: string | undefined, background: boolean): Promise<void> {
    // Flag is set synchronously so overlapping sync() calls still drop rather
    // than queue up — auto-sync ticks must not pile up behind a slow transport.
    if (this.syncing) return
    this.syncing = true

    return this.serialize(async () => {
      try {
        this.emit({ type: 'sync-start', table: tableName })

        const outcome = await this.runTables(tableName, background, async name => {
          await this.pushTable(name)
          await this.pullTable(name)
        })

        // Failures never reach this point — they were reported as per-table
        // 'error' events and raised as a SyncError. What is left is a pass in
        // which nothing failed, which is only *complete* if nothing was left
        // out either: a table skipped by backoff synced no data, and reporting
        // that as a completed sync turned "all changes saved" green while the
        // network was down (#173).
        if (outcome.deferred.length > 0) {
          this.emit({
            type: 'sync-deferred',
            table: tableName,
            deferredTables: outcome.deferred,
          })
        } else {
          this.emit({ type: 'sync-complete', table: tableName })
        }
      } finally {
        this.syncing = false
      }
    })
  }

  private async runPush(tableName: string | undefined, background: boolean): Promise<void> {
    await this.serialize(() =>
      this.runTables(tableName, background, name => this.pushTable(name))
    )
  }

  /**
   * Run `op` for each requested table, isolating failures.
   *
   * A table that throws no longer aborts the pass: its error is emitted and
   * recorded, and the remaining tables still sync. Previously one permanently
   * rejected mutation stalled every table forever (#132). Failures are raised
   * together as a SyncError once the pass is done, so awaiting callers still
   * see them.
   *
   * Returns what the pass touched, so the caller can tell an idle pass from one
   * that was entirely skipped by backoff (#173).
   */
  private async runTables(
    tableName: string | undefined,
    background: boolean,
    op: (name: string) => Promise<void>
  ): Promise<SyncPassOutcome> {
    const tableNames = tableName ? [tableName] : Array.from(this.tables.keys())
    const errors: TableSyncError[] = []
    const outcome: SyncPassOutcome = { deferred: [] }

    for (const name of tableNames) {
      if (background && this.isBackedOff(name)) {
        outcome.deferred.push(name)
        continue
      }

      try {
        await op(name)
        this.recordSuccess(name)
      } catch (err) {
        const error = err instanceof PushPhaseError ? err.inner : toError(err)
        this.recordFailure(name)
        if (err instanceof PushPhaseError) {
          this.handlePushFailure(name, err)
        }
        this.emit({ type: 'error', table: name, error })
        errors.push({ table: name, error })
      }
    }

    if (errors.length > 0) throw new SyncError(errors)
    return outcome
  }

  // ── Retry / backoff / dead-letter ───────────────────────────────────

  private retryState(tableName: string): TableRetryState {
    let state = this.retryStates.get(tableName)
    if (!state) {
      state = { failures: 0, pushFailures: 0, nextAttemptAt: 0 }
      this.retryStates.set(tableName, state)
    }
    return state
  }

  /**
   * Whether a background attempt should skip this table for now.
   *
   * Only background attempts (auto-sync ticks, debounced pushes) back off —
   * an explicit sync()/push()/pull() is the caller saying "retry now", and
   * silently doing nothing there would be surprising.
   */
  private isBackedOff(tableName: string): boolean {
    if (this.retryBaseDelayMs <= 0) return false
    const state = this.retryStates.get(tableName)
    return state !== undefined && state.nextAttemptAt > Date.now()
  }

  private recordSuccess(tableName: string): void {
    const state = this.retryStates.get(tableName)
    if (!state) return
    state.failures = 0
    state.nextAttemptAt = 0
  }

  private recordFailure(tableName: string): void {
    const state = this.retryState(tableName)
    state.failures += 1
    if (this.retryBaseDelayMs > 0) {
      const delay = Math.min(
        this.retryBaseDelayMs * 2 ** (state.failures - 1),
        this.maxRetryDelayMs
      )
      state.nextAttemptAt = Date.now() + delay
    }
  }

  /** Reset the backoff window (and failure counters) for a table, or all tables. */
  resetRetryState(tableName?: string): void {
    if (tableName === undefined) {
      this.retryStates.clear()
      return
    }
    this.retryStates.delete(tableName)
  }

  /**
   * Count a push failure and, once a batch has been rejected `maxRetries` times
   * in a row, dead-letter it so the app can surface or drop it instead of the
   * table retrying forever (#132).
   *
   * Only push failures count: a pull failure is a transport problem, not a
   * poisoned mutation, and must never cost the app its pending writes.
   */
  private handlePushFailure(tableName: string, failure: PushPhaseError): void {
    const state = this.retryState(tableName)
    state.pushFailures += 1

    if (this.maxRetries <= 0 || state.pushFailures < this.maxRetries) return

    const binding = this.tables.get(tableName)
    if (!binding) return

    const attempts = state.pushFailures
    // Restart the window either way, so a retained batch notifies the app again
    // after another maxRetries attempts rather than going quiet forever.
    state.pushFailures = 0

    const batchIds = new Set(failure.mutations.map(m => m.id))
    // Only ids that are actually in the reported batch may be acted on; a
    // transport naming something else must not cost the app unrelated writes.
    const rejectedIds = failure.rejectedIds?.filter(id => batchIds.has(id))
    const named = rejectedIds !== undefined && rejectedIds.length > 0

    this.emit({
      type: 'mutation-dead',
      table: tableName,
      error: failure.inner,
      mutations: failure.mutations,
      attempts,
      rejectedIds: named ? rejectedIds : undefined,
    })

    let action: PoisonedMutationAction | void
    try {
      action = this.onPoisonedMutation?.({
        table: tableName,
        mutations: failure.mutations,
        error: failure.inner,
        attempts,
        rejectedIds: named ? rejectedIds : undefined,
      })
    } catch {
      // A throwing handler must not break sync — treat it as 'retain'.
      action = undefined
    }

    const discardIds = resolveDiscardIds(action, batchIds, named ? rejectedIds : undefined)
    if (discardIds.size === 0) return

    // Respect the push boundary: writes enqueued after the batch was
    // snapshotted were never rejected and must survive (#109).
    binding.queue.clearForRows(discardIds, failure.boundary)
    // The blockage is gone, so let the table resume on the very next attempt.
    this.resetRetryState(tableName)
  }

  // ── Push / pull ─────────────────────────────────────────────────────

  private async pushTable(tableName: string): Promise<void> {
    const binding = this.tables.get(tableName)
    if (!binding) return

    const merged = binding.queue.getMerged()
    if (merged.length === 0) {
      // Nothing to send — but rows whose mutations cancelled out have no id in
      // the merged batch, so no push will ever clear them. Collect them here
      // too, or a queue holding only cancelled pairs would never shrink (#175).
      binding.queue.purgeCancelled(binding.queue.currentSeq())
      return
    }

    // Boundary: only mutations enqueued up to this point are part of this push.
    // Anything enqueued during the await below (higher seq) must survive the
    // clear, otherwise concurrent local writes are silently lost (#109).
    const boundary = binding.queue.currentSeq()

    let result: SyncPushResult
    try {
      result = await this.transport.push(tableName, merged)
    } catch (err) {
      // The batch never reached the server, so nothing was applied.
      throw new PushPhaseError(toError(err), merged, boundary, readRejectedIds(err))
    }

    // Ids that may leave the queue. A transport that reports appliedIds is
    // authoritative; otherwise infer: everything on success, nothing on failure.
    // Clearing the non-conflicting rows of a rejected batch would drop writes
    // the server never took (#131).
    const settledIds: Set<string | number> = result.appliedIds
      ? new Set(result.appliedIds)
      : result.success
        ? new Set(merged.map(m => m.id))
        : new Set()

    const conflicts = result.conflicts ?? []
    if (conflicts.length > 0) {
      this.resolveConflicts(binding, conflicts, settledIds)
    }

    binding.queue.clearForRows(settledIds, boundary)
    // Rows that cancelled each other out are settled by construction: they were
    // never part of any batch and never will be. Their deadness does not depend
    // on how this push went, only on the boundary (#175).
    binding.queue.purgeCancelled(boundary)

    if (!result.success && conflicts.length === 0) {
      // success:false with no conflicts is a real push failure. Surface it so
      // sync() skips pullTable for this table, rather than letting a stale
      // snapshot clobber the unpushed local state (#110).
      throw new PushPhaseError(
        new Error(
          `Push failed for table "${tableName}": server reported failure without conflicts`
        ),
        // Only what is still unapplied: a partial commit reported via
        // appliedIds has already landed, and naming those rows in the
        // dead-letter payload invited apps to re-apply them (#176).
        merged.filter(m => !settledIds.has(m.id)),
        boundary,
        readRejectedIds(result)
      )
    }

    const state = this.retryStates.get(tableName)
    if (state) state.pushFailures = 0
    this.emit({ type: 'push-complete', table: tableName, pushedCount: merged.length })
  }

  /**
   * Apply each conflict's resolution locally and decide what happens to the
   * pending mutation behind it, by adding to / removing from `settledIds`.
   */
  private resolveConflicts(
    binding: TableBinding,
    conflicts: ConflictItem[],
    settledIds: Set<string | number>
  ): void {
    for (const conflict of conflicts) {
      if (this.conflictStrategy === 'client-wins') {
        // Keep the local row *and* its mutation, so the next push re-sends it;
        // clearing it would let the next pull overwrite the local edit with the
        // server version (#110).
        settledIds.delete(conflict.id)
        continue
      }

      const resolved =
        typeof this.conflictStrategy === 'function'
          ? this.conflictStrategy(conflict)
          : conflict.serverRow
      // id is immutable across a resolution, mirroring update() (#98).
      const resolvedRow: RowWithId = { ...resolved, id: conflict.id }

      this.applyResolvedRow(binding, resolvedRow)

      // The pending mutation was superseded by the resolution, so it must not
      // be re-pushed as it stands.
      settledIds.add(conflict.id)

      if (typeof this.conflictStrategy === 'function') {
        // A custom resolver invents a row that exists nowhere else: without a
        // mutation of its own it would never reach the server and the next pull
        // would erase it (#131). Its seq is above the push boundary, so the
        // clearForRows() in pushTable keeps it — the same mechanism that
        // protects concurrent writes (#109).
        const { id: _id, ...fields } = resolvedRow
        binding.queue.push('update', conflict.id, fields)
      }
    }
  }

  private applyResolvedRow(binding: TableBinding, row: RowWithId): void {
    const rows = binding.adapter.getRawData()
    const idx = rows.findIndex(r => r.id === row.id)
    if (idx >= 0) {
      rows[idx] = row
    } else {
      // The row was deleted locally. Dropping the resolution here would leave
      // the strategy's decision unapplied (#131); the resolution wins, so
      // re-materialize the row.
      rows.push(row)
    }
    binding.adapter.replaceAll(rows)
  }

  private async pullTable(tableName: string): Promise<void> {
    const binding = this.tables.get(tableName)
    if (!binding) return

    const { rows } = await this.transport.pull<RowWithId>(tableName)

    // If there are pending local mutations, apply them on top of server data
    const merged = binding.queue.getMerged()
    if (merged.length > 0) {
      const serverMap = new Map(rows.map(r => [r.id, r]))

      // Apply pending mutations on top of server data
      for (const m of merged) {
        if (m.type === 'insert') {
          if (!serverMap.has(m.id)) {
            serverMap.set(m.id, { id: m.id, ...m.data })
          }
        } else if (m.type === 'update') {
          const existing = serverMap.get(m.id)
          if (existing) {
            serverMap.set(m.id, { ...existing, ...m.data })
          }
        } else if (m.type === 'delete') {
          serverMap.delete(m.id)
        }
      }

      binding.adapter.replaceAll(Array.from(serverMap.values()))
    } else {
      binding.adapter.replaceAll(rows)
    }

    this.emit({ type: 'pull-complete', table: tableName, pulledCount: rows.length })
  }

  // ── Background paths ────────────────────────────────────────────────

  /**
   * Report a failed background attempt. Nobody is awaiting these, so swallowing
   * the rejection would leave the app with no signal at all (#132). The
   * per-table 'error' events already fired; this one has no `table` and marks
   * the whole attempt as failed.
   */
  private emitBackgroundError(err: unknown): void {
    this.emit({ type: 'error', error: toError(err) })
  }

  /** Schedule a debounced push (called after local mutations) */
  schedulePush(): void {
    if (this.pushDebounceMs <= 0) return
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer)
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = null
      this.runPush(undefined, true).catch(err => this.emitBackgroundError(err))
    }, this.pushDebounceMs)
  }

  /** Start auto-sync at interval */
  startAutoSync(intervalMs: number): void {
    this.stopAutoSync()
    this.autoSyncTimer = setInterval(() => {
      this.runSync(undefined, true).catch(err => this.emitBackgroundError(err))
    }, intervalMs)
  }

  /** Stop auto-sync */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /** Check if currently syncing */
  get isSyncing(): boolean {
    return this.syncing
  }

  /** Cleanup */
  dispose(): void {
    this.stopAutoSync()
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer)
      this.pushDebounceTimer = null
    }
    this.listeners.length = 0
    this.retryStates.clear()
  }
}
