/**
 * MutationQueue - Tracks local mutations with merge logic and localStorage persistence
 *
 * Merge rules:
 * | prev    | next    | result                     |
 * |---------|---------|----------------------------|
 * | insert  | update  | insert (data merged)       |
 * | insert  | delete  | noop (cancel out)          |
 * | update  | update  | update (last wins)         |
 * | update  | delete  | delete                     |
 * | delete  | insert  | update (re-creation)       |
 */
import type { RowWithId } from '@gsquery/core'
import type { Mutation, MutationType, MergedMutation } from './sync-transport.js'

/** Storage interface for testability (defaults to localStorage) */
export interface MutationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface MutationQueueOptions {
  /** Table name (used as storage key namespace) */
  tableName: string
  /** Custom storage (defaults to localStorage if available) */
  storage?: MutationStorage
}

export class MutationQueue<T extends RowWithId = RowWithId> {
  private mutations: Mutation<T>[] = []
  private readonly storageKey: string
  private readonly storage: MutationStorage | null

  constructor(options: MutationQueueOptions) {
    this.storageKey = `gsquery:${options.tableName}:mutations`
    this.storage = options.storage ?? this.detectStorage()
    this.loadFromStorage()
  }

  private detectStorage(): MutationStorage | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage
      }
    } catch {
      // localStorage not available (SSR, workers, etc.)
    }
    return null
  }

  /** Push a new mutation into the queue */
  push(type: MutationType, id: string | number, data?: Partial<T>, row?: T): void {
    this.mutations.push({
      id,
      type,
      data,
      row,
      timestamp: Date.now(),
    })
    this.persist()
  }

  /** Get all pending mutations after merge */
  getMerged(): MergedMutation<T>[] {
    // Group by ID, then merge sequentially
    const byId = new Map<string | number, MergedMutation<T> | null>()

    for (const m of this.mutations) {
      const existing = byId.get(m.id)

      if (existing === undefined) {
        // First mutation for this ID
        byId.set(m.id, {
          id: m.id,
          type: m.type,
          data: m.type === 'delete' ? undefined : { ...(m.row ?? m.data) } as Partial<T>,
        })
        continue
      }

      if (existing === null) {
        // Previously cancelled out, start fresh
        byId.set(m.id, {
          id: m.id,
          type: m.type,
          data: m.type === 'delete' ? undefined : { ...(m.row ?? m.data) } as Partial<T>,
        })
        continue
      }

      // Merge with existing
      const merged = this.mergePair(existing, m)
      byId.set(m.id, merged)
    }

    // Collect non-null results
    const result: MergedMutation<T>[] = []
    for (const entry of byId.values()) {
      if (entry !== null) {
        result.push(entry)
      }
    }
    return result
  }

  /** Merge two mutations for the same row */
  private mergePair(
    prev: MergedMutation<T>,
    next: Mutation<T>
  ): MergedMutation<T> | null {
    const prevType = prev.type
    const nextType = next.type

    // insert + update → insert (data merged)
    if (prevType === 'insert' && nextType === 'update') {
      return {
        id: prev.id,
        type: 'insert',
        data: { ...prev.data, ...next.data } as Partial<T>,
      }
    }

    // insert + delete → noop (cancel out)
    if (prevType === 'insert' && nextType === 'delete') {
      return null
    }

    // update + update → update (last wins, data merged)
    if (prevType === 'update' && nextType === 'update') {
      return {
        id: prev.id,
        type: 'update',
        data: { ...prev.data, ...next.data } as Partial<T>,
      }
    }

    // update + delete → delete
    if (prevType === 'update' && nextType === 'delete') {
      return {
        id: prev.id,
        type: 'delete',
      }
    }

    // delete + insert → update (re-creation)
    if (prevType === 'delete' && nextType === 'insert') {
      return {
        id: prev.id,
        type: 'update',
        data: { ...(next.row ?? next.data) } as Partial<T>,
      }
    }

    // Fallback: next overrides
    return {
      id: next.id,
      type: next.type,
      data: next.type === 'delete' ? undefined : { ...(next.row ?? next.data) } as Partial<T>,
    }
  }

  /** Clear all mutations */
  clear(): void {
    this.mutations = []
    this.persist()
  }

  /** Clear mutations for specific row IDs (after successful sync) */
  clearForRows(ids: Set<string | number>): void {
    this.mutations = this.mutations.filter(m => !ids.has(m.id))
    this.persist()
  }

  /** Get raw mutation count (before merge) */
  get length(): number {
    return this.mutations.length
  }

  /** Check if queue has pending mutations */
  get hasPending(): boolean {
    return this.mutations.length > 0
  }

  /** Persist to storage */
  private persist(): void {
    if (!this.storage) return
    try {
      if (this.mutations.length === 0) {
        this.storage.removeItem(this.storageKey)
      } else {
        this.storage.setItem(this.storageKey, JSON.stringify(this.mutations))
      }
    } catch {
      // Storage full or unavailable - continue in-memory only
    }
  }

  /** Load from storage */
  private loadFromStorage(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(this.storageKey)
      if (raw) {
        this.mutations = JSON.parse(raw) as Mutation<T>[]
      }
    } catch {
      // Corrupted data - start fresh
      this.mutations = []
    }
  }
}
