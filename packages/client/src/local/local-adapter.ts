/**
 * LocalAdapter - DataStore<T> implementation with in-memory data,
 * IndexedDB write-behind persistence, and MutationQueue integration.
 *
 * Mirrors MockAdapter's internal structure (data[] + idIndex Map + IndexStore)
 * but adds:
 * - IndexedDB async persistence (queueMicrotask after mutations)
 * - MutationQueue auto-push on every mutation
 * - replaceAll() for SyncEngine pull
 * - async init() for IndexedDB hydration
 */
import type {
  RowWithId,
  DataStore,
  QueryOptions,
  WhereCondition,
  BatchUpdateItem,
  IdMode,
  UpdateData,
} from '@gsquery/core'
import {
  IndexStore,
  evaluateCondition,
  compareRows,
  deserializeRow,
  DuplicateIdError,
} from '@gsquery/core'
import type { IndexDefinition, ColumnType } from '@gsquery/core'
import { MutationQueue } from './mutation-queue.js'
import type { MutationStorage } from './mutation-queue.js'
import { composeName } from './naming.js'

/**
 * Open the gsquery IndexedDB with all required object stores in a single
 * upgrade transaction. This avoids the race condition where multiple
 * adapters independently try to open/upgrade the same database.
 *
 * `dbName` defaults to `'gsquery'` (the rc2 name) so omitting it is
 * byte-identical to the pre-namespace behavior.
 */
export function openSharedIDB(tableNames: string[], dbName = 'gsquery'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // First, open without a version to discover the current version
    const probe = indexedDB.open(dbName)
    probe.onsuccess = () => {
      const existing = probe.result
      const currentVersion = existing.version

      // Check if all stores already exist
      const missing = tableNames.filter(
        name => !existing.objectStoreNames.contains(name)
      )
      const needsMeta = !existing.objectStoreNames.contains('_meta')

      if (missing.length === 0 && !needsMeta) {
        // All stores exist — reuse the connection
        resolve(existing)
        return
      }

      // Need an upgrade — close this connection and reopen with bumped version
      existing.close()
      const nextVersion = currentVersion + 1
      const upgrade = indexedDB.open(dbName, nextVersion)
      upgrade.onupgradeneeded = () => {
        const db = upgrade.result
        for (const name of tableNames) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' })
          }
        }
        if (!db.objectStoreNames.contains('_meta')) {
          db.createObjectStore('_meta', { keyPath: 'tableName' })
        }
      }
      upgrade.onsuccess = () => resolve(upgrade.result)
      upgrade.onerror = () => reject(upgrade.error)
    }
    probe.onerror = () => {
      // DB doesn't exist yet — create fresh with version 1
      const fresh = indexedDB.open(dbName, 1)
      fresh.onupgradeneeded = () => {
        const db = fresh.result
        for (const name of tableNames) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
        db.createObjectStore('_meta', { keyPath: 'tableName' })
      }
      fresh.onsuccess = () => resolve(fresh.result)
      fresh.onerror = () => reject(fresh.error)
    }
  })
}

export interface LocalAdapterOptions<T extends RowWithId = RowWithId> {
  tableName: string
  initialData?: T[]
  indexes?: IndexDefinition[]
  /**
   * Column types for schema-driven deserialization of rows arriving from the
   * server (see replaceAll). Without it, pulled values are stored verbatim.
   */
  columnTypes?: Record<string, ColumnType>
  idMode?: IdMode
  /** Custom storage for MutationQueue (defaults to localStorage) */
  mutationStorage?: MutationStorage
  /** Disable IndexedDB persistence (for testing) */
  disableIDB?: boolean
  /** Pre-opened shared IDBDatabase handle (from openSharedIDB) */
  idbDb?: IDBDatabase
  /** Caller-supplied partition key, threaded into the MutationQueue storage key */
  namespace?: string
}

export class LocalAdapter<T extends RowWithId> implements DataStore<T> {
  private data: T[] = []
  private nextId = 1
  private idIndex: Map<string | number, number> = new Map()
  private indexStore: IndexStore<T>
  private idMode: IdMode
  private readonly columnTypes: Record<string, ColumnType> | undefined

  readonly tableName: string
  readonly queue: MutationQueue<T>

  private idbEnabled: boolean
  private idbDb: IDBDatabase | null = null
  private persistScheduled = false
  private persistChain: Promise<void> = Promise.resolve()
  private readonly namespace: string | undefined

  constructor(options: LocalAdapterOptions<T>) {
    this.tableName = options.tableName
    this.idMode = options.idMode ?? 'client'
    this.idbEnabled = !options.disableIDB && typeof indexedDB !== 'undefined'
    this.indexStore = new IndexStore<T>(options.indexes ?? [])
    this.columnTypes = options.columnTypes
    this.namespace = options.namespace

    // Accept pre-opened shared IDB handle
    if (options.idbDb) {
      this.idbDb = options.idbDb
    }

    this.queue = new MutationQueue<T>({
      tableName: options.tableName,
      storage: options.mutationStorage,
      namespace: options.namespace,
    })

    if (options.initialData) {
      this.data = [...options.initialData]
      this.rebuildIndex()
    }
  }

  /** Initialize from IndexedDB (call once before use) */
  async init(): Promise<void> {
    if (!this.idbEnabled) return

    try {
      // If a shared DB handle was provided, just hydrate from it
      if (!this.idbDb) {
        this.idbDb = await openSharedIDB([this.tableName], composeName('gsquery', this.namespace))
      }

      const seqBefore = this.queue.currentSeq()
      const rows = await this.readAllFromIDB()
      if (rows.length === 0) return

      const wroteDuringRead = this.queue.currentSeq() > seqBefore
      if (!wroteDuringRead && this.data.length === 0) {
        this.data = rows
        this.rebuildIndex()
        return
      }

      // Anything already in memory — initialData, or a write that landed while
      // the read was in flight — is newer than this snapshot, so hydrate
      // underneath it rather than over it (#106). Note replaceAll() bypasses
      // the queue, so a pull landing mid-init() would not trip wroteDuringRead;
      // unreachable today since registerTable runs after init().
      const merged = new Map<string | number, T>(rows.map(r => [r.id, r]))
      for (const row of this.data) merged.set(row.id, row)
      if (wroteDuringRead) {
        for (const m of this.queue.getMerged()) {
          if (m.type === 'delete') merged.delete(m.id)
        }
      }
      this.data = [...merged.values()]
      this.rebuildIndex()
      this.schedulePersist()
    } catch {
      // IndexedDB unavailable - continue in-memory only
      this.idbEnabled = false
    }
  }

  private rebuildIndex(): void {
    this.idIndex.clear()
    for (let i = 0; i < this.data.length; i++) {
      this.idIndex.set(this.data[i].id, i)
    }
    this.indexStore.rebuild(this.data)

    // Update nextId for auto mode
    if (this.data.length > 0) {
      const maxId = Math.max(
        ...this.data.map(r =>
          typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
        )
      )
      this.nextId = maxId + 1
    }
  }

  // ── DataStore<T> implementation ────────────────────────────────────

  findAll(): T[] {
    return [...this.data]
  }

  find(options: QueryOptions<T>): T[] {
    let candidateIndices: Set<number> | undefined
    let remainingConditions = options.where

    if (options.where.length > 0) {
      const { usedIndices, unusedConditions } = this.tryUseIndexes(options.where)
      if (usedIndices !== undefined) {
        candidateIndices = usedIndices
        remainingConditions = unusedConditions
      }
    }

    let result: T[]
    if (candidateIndices !== undefined) {
      result = []
      for (const idx of candidateIndices) {
        if (idx < this.data.length) {
          result.push(this.data[idx])
        }
      }
    } else {
      result = [...this.data]
    }

    if (remainingConditions.length > 0) {
      result = result.filter(row =>
        remainingConditions.every(c => evaluateCondition(row, c))
      )
    }

    if (options.orderBy.length > 0) {
      result.sort((a, b) => compareRows(a, b, options.orderBy))
    }

    if (options.offsetValue !== undefined && options.offsetValue > 0) {
      result = result.slice(options.offsetValue)
    }

    if (options.limitValue !== undefined && options.limitValue >= 0) {
      result = result.slice(0, options.limitValue)
    }

    return result
  }

  findById(id: string | number): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined
    return this.data[index]
  }

  /** Read the id of a client-mode row, throwing when the caller omitted it. */
  private requireClientId(data: Omit<T, 'id'> | T): string | number {
    if (!('id' in data)) {
      throw new Error(`ID is required in client mode (idMode: 'client')`)
    }
    return (data as T).id
  }

  /** Every id currently held, keyed as strings so 1 and '1' collide. */
  private readExistingIdKeys(): Set<string> {
    const keys = new Set<string>()
    for (const row of this.data) {
      keys.add(String(row.id))
    }
    return keys
  }

  /**
   * Reject client-supplied ids that already exist locally, or that repeat
   * within the same batch — the same contract SheetsAdapter enforces on the
   * server (#128/#154). Called before any mutation, so a rejected write leaves
   * the rows, the MutationQueue and IndexedDB untouched: the duplicate fails
   * at the call site instead of being pushed and dead-lettered (#132).
   *
   * Rows arriving through replaceAll()/reset() are seeded verbatim and are not
   * checked, mirroring rows that were already on the sheet.
   */
  private assertClientIdsAvailable(ids: (string | number)[]): void {
    const existing = this.readExistingIdKeys()
    for (const id of ids) {
      const key = String(id)
      if (existing.has(key)) {
        throw new DuplicateIdError(id, this.tableName)
      }
      existing.add(key)
    }
  }

  insert(data: Omit<T, 'id'> | T): T {
    let newRow: T

    if (this.idMode === 'client') {
      const id = this.requireClientId(data)
      this.assertClientIdsAvailable([id])
      newRow = data as T
    } else {
      const id = this.nextId++
      newRow = { ...data, id } as T
    }

    const index = this.data.length
    this.data.push(newRow)
    this.idIndex.set(newRow.id, index)
    this.indexStore.addToIndex(index, newRow)

    // Record mutation and persist
    this.queue.push('insert', newRow.id, undefined, newRow)
    this.schedulePersist()

    return newRow
  }

  update(id: string | number, data: UpdateData<T>): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined

    const oldRow = this.data[index]
    // id is immutable via update; preserve it so the idIndex stays consistent
    // and behavior matches the other adapters (#98).
    const newRow = { ...oldRow, ...data, id: oldRow.id }
    this.data[index] = newRow
    this.indexStore.updateIndex(index, oldRow, newRow)

    // Record mutation and persist
    this.queue.push('update', id, data as Partial<T>)
    this.schedulePersist()

    return newRow
  }

  delete(id: string | number): boolean {
    const index = this.idIndex.get(id)
    if (index === undefined) return false

    const deletedRow = this.data[index]
    this.indexStore.removeFromIndex(index, deletedRow)

    this.data.splice(index, 1)
    this.idIndex.delete(id)

    for (let i = index; i < this.data.length; i++) {
      this.idIndex.set(this.data[i].id, i)
    }
    this.indexStore.reindexAfterDelete(index)

    // Record mutation and persist
    this.queue.push('delete', id)
    this.schedulePersist()

    return true
  }

  batchInsert(items: (Omit<T, 'id'> | T)[]): T[] {
    // Resolve and validate every row up front: a rejected batch must leave the
    // rows, the queue and IndexedDB untouched, matching SheetsAdapter (#154).
    const newRows: T[] = []

    if (this.idMode === 'client') {
      const ids: (string | number)[] = []
      for (const item of items) {
        ids.push(this.requireClientId(item))
        newRows.push(item as T)
      }
      this.assertClientIdsAvailable(ids)
    } else {
      for (const item of items) {
        newRows.push({ ...item, id: this.nextId++ } as T)
      }
    }

    const startIndex = this.data.length
    for (let i = 0; i < newRows.length; i++) {
      const newRow = newRows[i]
      const rowIndex = startIndex + i
      this.data.push(newRow)
      this.idIndex.set(newRow.id, rowIndex)
      this.indexStore.addToIndex(rowIndex, newRow)

      this.queue.push('insert', newRow.id, undefined, newRow)
    }

    this.schedulePersist()
    return newRows
  }

  batchUpdate(items: BatchUpdateItem<T>[]): T[] {
    const results: T[] = []

    for (const { id, data } of items) {
      const index = this.idIndex.get(id)
      if (index === undefined) continue

      const oldRow = this.data[index]
      const newRow = { ...oldRow, ...data, id: oldRow.id } // id immutable (#98)
      this.data[index] = newRow
      this.indexStore.updateIndex(index, oldRow, newRow)

      this.queue.push('update', id, data as Partial<T>)
      results.push(newRow)
    }

    this.schedulePersist()
    return results
  }

  // ── Additional methods for SyncEngine ──────────────────────────────

  /**
   * Replace all data (called by SyncEngine after pull).
   *
   * Rows coming off the wire carry transport representations (a datetime is an
   * ISO string, a string[] is JSON text), so they are run through the same
   * schema-driven conversion the server path applies — otherwise the local
   * values contradict the generated model types (#135). The conversion is
   * idempotent, so already-typed rows (locally created, or replayed from a
   * conflict resolution) pass through untouched.
   */
  replaceAll(rows: T[]): void {
    this.data = this.columnTypes
      ? rows.map(row => deserializeRow(row, this.columnTypes))
      : [...rows]
    this.rebuildIndex()
    this.schedulePersist()
  }

  /** Get raw data (for testing / debugging) */
  getRawData(): T[] {
    return [...this.data]
  }

  /** Reset (test helper) */
  reset(data: T[] = []): void {
    this.data = [...data]
    this.rebuildIndex()
    this.queue.clear()
    if (data.length > 0) {
      const maxId = Math.max(
        ...data.map(r =>
          typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
        )
      )
      this.nextId = maxId + 1
    } else {
      this.nextId = 1
    }
  }

  // ── Index optimization (mirrors MockAdapter) ──────────────────────

  private tryUseIndexes(conditions: WhereCondition<T>[]): {
    usedIndices: Set<number> | undefined
    unusedConditions: WhereCondition<T>[]
  } {
    const eqConditions: Array<{ field: string; value: unknown; index: number }> = []
    const nonEqConditions: WhereCondition<T>[] = []

    conditions.forEach((cond, i) => {
      if (cond.operator === '=') {
        eqConditions.push({ field: cond.field, value: cond.value, index: i })
      } else {
        nonEqConditions.push(cond)
      }
    })

    if (eqConditions.length === 0) {
      return { usedIndices: undefined, unusedConditions: conditions }
    }

    let usedIndices: Set<number> | undefined
    const usedConditionIndices = new Set<number>()

    for (const eq of eqConditions) {
      const indices = this.indexStore.lookup([eq.field], [eq.value])
      if (indices !== undefined) {
        if (usedIndices === undefined) {
          usedIndices = new Set(indices)
        } else {
          const intersection = new Set<number>()
          for (const idx of usedIndices) {
            if (indices.has(idx)) intersection.add(idx)
          }
          usedIndices = intersection
        }
        usedConditionIndices.add(eq.index)
      }
    }

    if (eqConditions.length >= 2) {
      const fields = eqConditions.map(eq => eq.field)
      const values = eqConditions.map(eq => eq.value)
      const compoundIndices = this.indexStore.lookup(fields, values)

      if (compoundIndices !== undefined) {
        if (usedIndices === undefined) {
          usedIndices = new Set(compoundIndices)
        } else {
          const intersection = new Set<number>()
          for (const idx of usedIndices) {
            if (compoundIndices.has(idx)) intersection.add(idx)
          }
          usedIndices = intersection
        }
        eqConditions.forEach(eq => usedConditionIndices.add(eq.index))
      }
    }

    const unusedConditions = conditions.filter((_, i) => !usedConditionIndices.has(i))
    return { usedIndices, unusedConditions }
  }

  // ── IndexedDB persistence ──────────────────────────────────────────

  /**
   * Await the pending and in-flight persist, if any. Rejects if the last
   * persist failed — the fire-and-forget path swallows that error, so this is
   * the only way a caller can see it. Teardown must await this before closing
   * the IDB connection, or a queued write is destroyed (#105).
   */
  flush(): Promise<void> {
    return this.persistChain
  }

  private schedulePersist(): void {
    if (!this.idbEnabled || this.persistScheduled) return
    this.persistScheduled = true
    // Assigned synchronously (the chained .then() *is* the debounce microtask)
    // so close() can see a persist that has been scheduled but not yet started.
    const next = this.persistChain.catch(() => {}).then(() => {
      this.persistScheduled = false
      return this.persistToIDB()
    })
    this.persistChain = next
    next.catch(() => {
      // Silently fail - data is still in memory. Callers wanting the error
      // await flush().
    })
  }

  private async persistToIDB(): Promise<void> {
    if (!this.idbDb) return

    return new Promise((resolve, reject) => {
      const tx = this.idbDb!.transaction(this.tableName, 'readwrite')
      const store = tx.objectStore(this.tableName)

      // Clear and rewrite all (simpler than diffing, fast for typical dataset sizes)
      store.clear()
      for (const row of this.data) {
        store.put(row)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  private readAllFromIDB(): Promise<T[]> {
    if (!this.idbDb) return Promise.resolve([])

    const db = this.idbDb
    if (!db.objectStoreNames.contains(this.tableName)) {
      return Promise.resolve([])
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.tableName, 'readonly')
      const store = tx.objectStore(this.tableName)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error)
    })
  }
}
