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
 *
 * Row versions (#138): the queue also keeps the known version of each row,
 * persisted next to the mutations. Every mutation is stamped with its row's
 * known version when it is enqueued, and a merged mutation carries the stamp of
 * its oldest unpushed mutation as `baseVersion`.
 */
import type { RowWithId } from '@gsquery/core'
import type {
  Mutation,
  MutationType,
  MergedMutation,
  RowVersion,
  RowVersions,
} from './sync-transport.js'
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

/** One mutation to enqueue via `pushMany` */
export interface MutationInput<T extends RowWithId = RowWithId> {
  type: MutationType
  id: string | number
  data?: Partial<T>
  row?: T
}

export class MutationQueue<T extends RowWithId = RowWithId> {
  private mutations: Mutation<T>[] = []
  private readonly storageKey: string
  private readonly storage: MutationStorage | null
  /** Monotonic counter for assigning mutation sequence numbers */
  private seqCounter = 0
  /** Last raw entry per row id, so update+update can compact in place (#234) */
  private lastById = new Map<string | number, Mutation<T>>()
  /**
   * Seq of the latest push snapshot. Entries at or below it may be in flight
   * and must never be mutated. Memory only: after a reload nothing is in flight.
   */
  private lastSnapshotSeq = 0
  /**
   * Known server version per row, keyed by `String(id)` (#138). Persisted so an
   * edit made after an offline cold start, before any pull, still carries a
   * base version.
   */
  private knownVersions = new Map<string, RowVersion>()
  private readonly versionsKey: string

  constructor(options: MutationQueueOptions) {
    const prefix = `${composeName('gsquery', options.namespace)}:${options.tableName}`
    this.storageKey = `${prefix}:mutations`
    this.versionsKey = `${prefix}:versions`
    this.storage = options.storage ?? this.detectStorage()
    this.loadFromStorage()
    this.loadVersionsFromStorage()
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
    this.pushMany([{ type, id, data, row }])
  }

  /** Push several mutations with a single storage write */
  pushMany(entries: readonly MutationInput<T>[]): void {
    if (entries.length === 0) return
    for (const { type, id, data, row } of entries) {
      const prev = this.lastById.get(id)
      if (type === 'update' && prev?.type === 'update' && prev.seq > this.lastSnapshotSeq) {
        // Compact update+update in place. The entry gets a fresh seq, so array
        // order may no longer match seq order. That is safe: groupById relies
        // only on order within an id, and clearForRows/purgeCancelled/
        // loadFromStorage go by seq value. No code may assume the array is
        // sorted by seq.
        prev.data = { ...prev.data, ...data } as Partial<T>
        prev.seq = ++this.seqCounter
        prev.timestamp = Date.now()
        continue
      }
      const entry: Mutation<T> = {
        id,
        type,
        data,
        row,
        timestamp: Date.now(),
        seq: ++this.seqCounter,
      }
      // Stamp the version this edit is built on. An update compacted into an
      // earlier entry above keeps that entry's (older) stamp, which is the one
      // the merged edit must carry.
      const base = this.knownVersions.get(String(id))
      if (base !== undefined) entry.baseVersion = base
      this.mutations.push(entry)
      this.lastById.set(id, entry)
    }
    this.persist()
  }

  /** Highest sequence number assigned so far. A pure read. */
  currentSeq(): number {
    return this.seqCounter
  }

  /**
   * Mark everything enqueued so far as part of a push snapshot and return the
   * boundary. Later updates to those rows append instead of compacting into
   * entries that may be in flight.
   */
  snapshotBoundary(): number {
    this.lastSnapshotSeq = this.seqCounter
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
    // The stamp of the oldest mutation in the current run: the merged edit was
    // built on that version (#138).
    let base: RowVersion | undefined
    for (const m of group) {
      if (acc === null) {
        // First mutation for this id, or a fresh start after a cancelling pair.
        acc = this.seed(m)
        base = m.baseVersion
      } else {
        acc = this.mergePair(acc, m)
      }
    }
    // Set only when known, so a versionless queue keeps the exact
    // {id, type, data} wire shape.
    if (acc !== null && base !== undefined) acc.baseVersion = base
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
    this.rebuildIndex()
    this.persist()
  }

  /** Recompute lastById from the raw array */
  private rebuildIndex(): void {
    this.lastById = new Map()
    for (const m of this.mutations) this.lastById.set(m.id, m)
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
    this.rebuildIndex()
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
    this.rebuildIndex()
    this.persist()
  }

  // ── Row versions (#138) ─────────────────────────────────────────────

  /** The known server version of a row, if any. A pure read. */
  knownVersion(id: string | number): RowVersion | undefined {
    return this.knownVersions.get(String(id))
  }

  /**
   * Replace every known version with the ones a pull reported.
   *
   * A pull carries the whole table, so a row it reports no version for is
   * forgotten. Queued mutations keep their stamps: they were built on the
   * version they were stamped with, not on the newer one.
   */
  replaceKnownVersions(versions: RowVersions): void {
    const next = new Map<string, RowVersion>()
    for (const [key, version] of Object.entries(versions)) {
      if (isRowVersion(version)) next.set(key, version)
    }
    if (sameVersions(this.knownVersions, next)) return
    this.knownVersions = next
    this.persistVersions()
  }

  /**
   * Move the base of the given rows to a new version, or forget it
   * (`undefined`).
   *
   * Sets each row's known version, and restamps that row's queued mutations
   * enqueued after `afterSeq` (all of them when it is omitted), so they are
   * pushed as edits of the new version. Used after a push, for the versions it
   * reported, and when a conflict is resolved.
   */
  rebaseRows(
    updates: ReadonlyMap<string | number, RowVersion | undefined>,
    afterSeq?: number
  ): void {
    if (updates.size === 0) return

    let versionsChanged = false
    for (const [id, version] of updates) {
      const key = String(id)
      if (version === undefined) {
        if (this.knownVersions.delete(key)) versionsChanged = true
      } else if (this.knownVersions.get(key) !== version) {
        this.knownVersions.set(key, version)
        versionsChanged = true
      }
    }

    let mutationsChanged = false
    for (const m of this.mutations) {
      if (!updates.has(m.id)) continue
      if (afterSeq !== undefined && m.seq <= afterSeq) continue
      const version = updates.get(m.id)
      if (version === undefined) {
        if (m.baseVersion !== undefined) {
          delete m.baseVersion
          mutationsChanged = true
        }
      } else if (m.baseVersion !== version) {
        m.baseVersion = version
        mutationsChanged = true
      }
    }

    if (mutationsChanged) this.persist()
    if (versionsChanged) this.persistVersions()
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
    // Errors (e.g. quota) propagate: the in-memory change stays applied, the
    // caller learns durability failed.
    if (this.mutations.length === 0) {
      this.storage.removeItem(this.storageKey)
    } else {
      this.storage.setItem(this.storageKey, JSON.stringify(this.mutations))
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
        this.rebuildIndex()
      }
    } catch {
      // Corrupted data - start fresh
      this.mutations = []
      this.rebuildIndex()
    }
  }

  /** Persist the known versions; same error policy as `persist()` */
  private persistVersions(): void {
    if (!this.storage) return
    if (this.knownVersions.size === 0) {
      this.storage.removeItem(this.versionsKey)
    } else {
      this.storage.setItem(
        this.versionsKey,
        JSON.stringify(Object.fromEntries(this.knownVersions))
      )
    }
  }

  /** Load the known versions persisted by a previous session */
  private loadVersionsFromStorage(): void {
    if (!this.storage) return
    try {
      const raw = this.storage.getItem(this.versionsKey)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      for (const [key, version] of Object.entries(parsed)) {
        if (isRowVersion(version)) this.knownVersions.set(key, version)
      }
    } catch {
      // Corrupted data: start without known versions. Edits then go out without
      // a base and are applied unconditionally, which is today's behavior.
      this.knownVersions = new Map()
    }
  }
}

function isRowVersion(value: unknown): value is RowVersion {
  return typeof value === 'string' || typeof value === 'number'
}

function sameVersions(
  a: ReadonlyMap<string, RowVersion>,
  b: ReadonlyMap<string, RowVersion>
): boolean {
  if (a.size !== b.size) return false
  for (const [key, version] of a) {
    if (b.get(key) !== version) return false
  }
  return true
}
