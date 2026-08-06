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
 */
export interface SyncPushResult<T extends RowWithId = RowWithId> {
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

/** Sync event types */
export type SyncEventType =
  | 'sync-start'
  | 'push-complete'
  | 'pull-complete'
  | 'sync-complete'
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
}

export type SyncEventListener = (event: SyncEvent) => void

/** Describes a batch the server has rejected `maxRetries` times in a row. */
export interface PoisonedMutationInfo<T extends RowWithId = RowWithId> {
  table: string
  /** The merged batch that keeps failing */
  mutations: MergedMutation<T>[]
  /** The last error the transport reported */
  error: Error
  /** Number of consecutive failed push attempts */
  attempts: number
}

/**
 * What the engine should do with a poisoned batch.
 * - `'discard'`: drop those mutations from the queue so the table can sync again
 *   (the local rows are left untouched — a later pull reconciles them).
 * - `'retain'` (also the default when the handler returns nothing): keep them and
 *   keep retrying.
 */
export type PoisonedMutationAction = 'discard' | 'retain'

export type PoisonedMutationHandler = (
  info: PoisonedMutationInfo
) => PoisonedMutationAction | void

/** Conflict resolution strategy */
export type ConflictStrategy<T extends RowWithId = RowWithId> =
  | 'server-wins'
  | 'client-wins'
  | ((conflict: ConflictItem<T>) => T)
