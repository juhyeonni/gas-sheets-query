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

/** Server communication interface */
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
