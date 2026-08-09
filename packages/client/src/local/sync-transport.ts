/**
 * SyncTransport - Server communication interface for SyncEngine
 */
import type { RowWithId } from '@gsquery/core'

/** Mutation types that can be queued */
export type MutationType = 'insert' | 'update' | 'delete'

/** A single mutation record */
export interface Mutation<T extends RowWithId = RowWithId> {
  id: string | number
  type: MutationType
  data?: Partial<T>
  /** Full row for insert mutations */
  row?: T
  timestamp: number
  /**
   * Monotonic sequence number assigned when the mutation is enqueued. Used as a
   * push boundary so a successful push only clears the mutations it actually
   * snapshotted — mutations enqueued during the push await (higher seq) survive
   * instead of being silently dropped. See SyncEngine.pushTable (#109).
   */
  seq: number
}

/** A merged mutation ready for transport */
export interface MergedMutation<T extends RowWithId = RowWithId> {
  id: string | number
  type: MutationType
  /** Merged data for insert/update */
  data?: Partial<T>
}

/** Conflict item returned from push */
export interface ConflictItem<T extends RowWithId = RowWithId> {
  id: string | number
  serverRow: T
  clientMutation: MergedMutation<T>
}

/**
 * Names the individual mutations a server actively refused.
 *
 * A transport may report them two ways, and the engine reads both:
 * - on a returned {@link SyncPushResult}, alongside `success: false`,
 * - as a `rejectedIds` property on the `Error` a failing `push()` throws
 *   (the all-or-nothing style, where the batch never reaches the sheet).
 *
 * Naming the offenders is what lets the dead-letter path drop *only* the
 * poisoned rows instead of the whole batch (#174). Ids that were not part of
 * the pushed batch are ignored.
 */
export interface RejectedMutationIds {
  /** Ids the server refused. Absent → the engine cannot tell them apart. */
  rejectedIds?: readonly (string | number)[]
}

/**
 * Result of a transport push.
 *
 * `appliedIds` is the authoritative list of rows the server actually committed.
 * It is optional for backward compatibility: when a transport omits it the
 * engine infers the applied set from `success` —
 * - `success: true`  → every pushed mutation was applied,
 * - `success: false` → none of them were, so nothing may be cleared from the
 *   local queue (including the non-conflicting rows of a conflicted batch, which
 *   used to be dropped as if the server had taken them — #131).
 *
 * A server that commits part of a batch should report `appliedIds` explicitly;
 * otherwise the client conservatively re-pushes the whole batch, which is safe
 * because every mutation is idempotent (see the `push` contract below).
 *
 * `rejectedIds` is the mirror image: the rows the server *refused*. It never
 * affects what is cleared after a push — only what a dead-lettered batch
 * discards (#174).
 */
export interface SyncPushResult<T extends RowWithId = RowWithId>
  extends RejectedMutationIds {
  success: boolean
  conflicts?: ConflictItem<T>[]
  /** Ids the server confirms it applied. Absent → inferred from `success`. */
  appliedIds?: (string | number)[]
}

/**
 * Server communication interface.
 *
 * Server contract for `push`: apply each mutation idempotently —
 * - `insert`: upsert (create the row, or replace it if the id already exists),
 * - `update`: patch an existing row,
 * - `delete`: no-op if the row is already gone.
 *
 * The client guarantees it never emits an `update` for a row the server has not
 * seen: a delete-then-recreate is coalesced to a single `insert` (upsert), so a
 * strict-update server still applies it correctly. Inserts must therefore be upserts.
 */
export interface SyncTransport {
  pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }>
  push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>>
}

/**
 * Sync event types.
 *
 * `sync-complete` is the "everything requested is now in sync" signal, and is
 * safe to wire an "all changes saved" indicator to: it fires only when every
 * table the pass asked for was actually attempted and none of them failed.
 * A pass in which any table was skipped because its backoff window is still
 * open ends in `sync-deferred` instead — no data moved for those tables, so
 * calling that "complete" turned a saved indicator green mid-outage (#173).
 * A pass with failures ends in per-table `error` events and a rejected promise,
 * and emits neither.
 */
export type SyncEventType =
  | 'sync-start'
  | 'push-complete'
  | 'pull-complete'
  | 'sync-complete'
  | 'sync-deferred'
  | 'error'
  | 'mutation-dead'

export interface SyncEvent {
  type: SyncEventType
  /**
   * Table the event belongs to. An `error` without a table is a whole-attempt
   * failure reported from a background path (auto-sync tick, debounced push);
   * the per-table `error` events were already emitted separately.
   */
  table?: string
  error?: Error
  /** Number of mutations pushed */
  pushedCount?: number
  /** Number of rows pulled */
  pulledCount?: number
  /** The batch the server keeps rejecting ('mutation-dead') */
  mutations?: MergedMutation[]
  /** Consecutive failed push attempts for the batch ('mutation-dead') */
  attempts?: number
  /**
   * Tables the pass left untouched because their backoff window is still open
   * ('sync-deferred'). Always non-empty for that event; they will be retried on
   * a later tick, or immediately by an explicit sync()/push()/pull().
   */
  deferredTables?: string[]
  /**
   * Ids the transport named as refused, when it did ('mutation-dead'). Absent
   * means the server rejected the batch without saying which rows are at fault.
   */
  rejectedIds?: readonly (string | number)[]
}

export type SyncEventListener = (event: SyncEvent) => void

/** Describes a batch the server has rejected `maxRetries` times in a row. */
export interface PoisonedMutationInfo<T extends RowWithId = RowWithId>
  extends RejectedMutationIds {
  table: string
  /**
   * The mutations that are still unapplied after the failing attempt.
   *
   * Rows the server confirmed via `appliedIds` are excluded: reporting them
   * would invite an app to re-queue or alert on writes that already landed
   * (#176).
   */
  mutations: MergedMutation<T>[]
  /** The last error the transport reported */
  error: Error
  /** Number of consecutive failed push attempts */
  attempts: number
  /**
   * The subset of `mutations` the transport named as refused, if it named any
   * (via `SyncPushResult.rejectedIds` or a `rejectedIds` property on the thrown
   * error). When present, a plain `'discard'` drops exactly these and leaves
   * the rest of the batch queued.
   */
  rejectedIds?: readonly (string | number)[]
}

/**
 * What the engine should do with a poisoned batch.
 *
 * - `'discard'`: drop the poisoned work so the table can sync again. When the
 *   transport named the offenders (`rejectedIds`), only those are dropped and
 *   the rest of the batch stays queued; when it named none, the engine cannot
 *   tell innocent from poisoned and drops the whole reported batch — so against
 *   an all-or-nothing backend that stays silent, prefer returning an explicit
 *   id list (#174).
 * - `'retain'` (also the default when the handler returns nothing): keep
 *   everything and keep retrying.
 * - An array of ids: drop exactly those mutations and keep the rest. Ids
 *   outside the reported batch are ignored, and an empty array means `'retain'`.
 *
 * Discarding never touches local rows — a later pull reconciles them — and
 * always respects the push boundary, so writes made after the failed batch was
 * snapshotted survive (#109).
 */
export type PoisonedMutationAction =
  | 'discard'
  | 'retain'
  | readonly (string | number)[]

export type PoisonedMutationHandler = (
  info: PoisonedMutationInfo
) => PoisonedMutationAction | void

/** Conflict resolution strategy */
export type ConflictStrategy<T extends RowWithId = RowWithId> =
  | 'server-wins'
  | 'client-wins'
  | ((conflict: ConflictItem<T>) => T)
