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
import { composeName } from './naming.js'

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
  /** Caller-supplied partition key; omitted = rc2-identical storage key */
  namespace?: string
}

export class MutationQueue<T extends RowWithId = RowWithId> {
  private mutations: Mutation<T>[] = []
  private readonly storageKey: string
  private readonly storage: MutationStorage | null
  /** Monotonic counter for assigning mutation sequence numbers */
  private seqCounter = 0

  constructor(options: MutationQueueOptions) {
    this.storageKey = `${composeName('gsquery', options.namespace)}:${options.tableName}:mutations`
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
      seq: ++this.seqCounter,
    })
    this.persist()
  }

  /** Highest sequence number assigned so far — the current push boundary. */
  currentSeq(): number {
    return this.seqCounter
  }

  /** Get all pending mutations after merge */
  getMerged(): MergedMutation<T>[] {
    const result: MergedMutation<T>[] = []
    for (const group of this.groupById().values()) {
      const merged = this.foldGroup(group)
      if (merged !== null) {
        result.push(merged)
      }
    }
    return result
  }

  /**
   * Raw mutations per row id, in first-seen id order (which `getMerged()`
   * preserves) and enqueue order within each id.
   */
  private groupById(): Map<string | number, Mutation<T>[]> {
    const byId = new Map<string | number, Mutation<T>[]>()
    for (const m of this.mutations) {
      const group = byId.get(m.id)
      if (group) group.push(m)
      else byId.set(m.id, [m])
    }
    return byId
  }

  /**
   * Fold one row's raw mutations into its net effect, or `null` when they
   * cancel out entirely (insert followed by delete).
   */
  private foldGroup(group: Mutation<T>[]): MergedMutation<T> | null {
    let acc: MergedMutation<T> | null = null
    for (const m of group) {
      // First mutation for this id, or a fresh start after a cancelling pair.
      acc = acc === null ? this.seed(m) : this.mergePair(acc, m)
    }
    return acc
  }

  /** The merged form of a single mutation, with no history behind it. */
  private seed(m: Mutation<T>): MergedMutation<T> {
    return {
      id: m.id,
      type: m.type,
      data: m.type === 'delete' ? undefined : ({ ...(m.row ?? m.data) } as Partial<T>),
    }
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

    // delete + insert → insert (re-creation as an upsert).
    // Emitting 'insert' (not 'update') keeps re-creation safe against servers
    // that treat update strictly — i.e. throw or no-op when the row is missing.
    // The net effect (row exists with the new data) is identical, and insert is
    // the upsert operation in the sync contract. See mutation-queue tests.
    if (prevType === 'delete' && nextType === 'insert') {
      return {
        id: prev.id,
        type: 'insert',
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

  /**
   * Clear mutations for specific row IDs after a successful sync.
   *
   * When `maxSeq` is given, only mutations enqueued up to that boundary are
   * removed; mutations for the same id added afterwards (e.g. during the push
   * await) are kept so they are not silently dropped. See SyncEngine.pushTable
   * (#109).
   */
  clearForRows(ids: Set<string | number>, maxSeq?: number): void {
    this.mutations = this.mutations.filter(m => {
      if (!ids.has(m.id)) return true
      // Keep mutations enqueued after the push snapshot boundary.
      if (maxSeq !== undefined && m.seq > maxSeq) return true
      return false
    })
    this.persist()
  }

  /**
   * Drop the raw mutations of every row whose net effect is nothing.
   *
   * A row that was created and then deleted offline merges to `null`, so it has
   * no id in `getMerged()` and a push-driven `clearForRows` can never collect
   * it: the pair sat in the queue (and in localStorage) forever, growing without
   * bound under create-then-delete churn (#175).
   *
   * `maxSeq` is the push boundary and is what makes this provable: a row is only
   * collected when *all* of its raw mutations were enqueued at or below the
   * boundary. If a later mutation exists (e.g. a delete that landed while the
   * matching insert was in flight), the pair is not settled yet and is kept, so
   * the delete still reaches the server on the next push (#109).
   */
  purgeCancelled(maxSeq?: number): void {
    const doomed = new Set<string | number>()
    for (const [id, group] of this.groupById()) {
      if (maxSeq !== undefined && group.some(m => m.seq > maxSeq)) continue
      if (this.foldGroup(group) === null) doomed.add(id)
    }
    if (doomed.size === 0) return

    this.mutations = this.mutations.filter(m => !doomed.has(m.id))
    this.persist()
  }

  /** Get raw mutation count (before merge) */
  get length(): number {
    return this.mutations.length
  }

  /**
   * Whether the queue holds work that still has to reach the server.
   *
   * Derived from the *merged* view, not the raw count: rows whose mutations
   * cancel out carry no work, and reporting them made `hasPending` unusable as
   * a "safe to close this tab?" gate (#175).
   */
  get hasPending(): boolean {
    if (this.mutations.length === 0) return false
    return this.getMerged().length > 0
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
        // Restore the sequence counter from the highest persisted seq so push
        // boundaries stay monotonic across reloads, then backfill any legacy
        // entries that predate the seq field.
        for (const m of this.mutations) {
          if (typeof m.seq === 'number' && m.seq > this.seqCounter) {
            this.seqCounter = m.seq
          }
        }
        for (const m of this.mutations) {
          if (typeof m.seq !== 'number') {
            m.seq = ++this.seqCounter
          }
        }
      }
    } catch {
      // Corrupted data - start fresh
      this.mutations = []
    }
  }
}
