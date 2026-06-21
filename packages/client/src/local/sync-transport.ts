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
  ): Promise<{
    success: boolean
    conflicts?: ConflictItem<T>[]
  }>
}

/** Sync event types */
export type SyncEventType =
  | 'sync-start'
  | 'push-complete'
  | 'pull-complete'
  | 'sync-complete'
  | 'error'

export interface SyncEvent {
  type: SyncEventType
  table?: string
  error?: Error
  /** Number of mutations pushed */
  pushedCount?: number
  /** Number of rows pulled */
  pulledCount?: number
}

export type SyncEventListener = (event: SyncEvent) => void

/** Conflict resolution strategy */
export type ConflictStrategy<T extends RowWithId = RowWithId> =
  | 'server-wins'
  | 'client-wins'
  | ((conflict: ConflictItem<T>) => T)
