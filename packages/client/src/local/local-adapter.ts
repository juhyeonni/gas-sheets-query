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
} from '@gsquery/core'
import { IndexStore, evaluateCondition, compareRows } from '@gsquery/core'
import type { IndexDefinition } from '@gsquery/core'
import { MutationQueue } from './mutation-queue.js'
import type { MutationStorage } from './mutation-queue.js'

/** IDB helper - open the gsquery database */
function openIDB(tableName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gsquery', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(tableName)) {
        db.createObjectStore(tableName, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('_meta')) {
        db.createObjectStore('_meta', { keyPath: 'tableName' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Ensure object store exists (for tables added after initial DB creation) */
function ensureStore(db: IDBDatabase, storeName: string): Promise<IDBDatabase> {
  if (db.objectStoreNames.contains(storeName)) {
    return Promise.resolve(db)
  }
  // Need to upgrade DB version to add store
  const version = db.version + 1
  db.close()
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gsquery', version)
    request.onupgradeneeded = () => {
      const upgraded = request.result
      if (!upgraded.objectStoreNames.contains(storeName)) {
        upgraded.createObjectStore(storeName, { keyPath: 'id' })
      }
      if (!upgraded.objectStoreNames.contains('_meta')) {
        upgraded.createObjectStore('_meta', { keyPath: 'tableName' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export interface LocalAdapterOptions<T extends RowWithId = RowWithId> {
  tableName: string
  initialData?: T[]
  indexes?: IndexDefinition[]
  idMode?: IdMode
  /** Custom storage for MutationQueue (defaults to localStorage) */
  mutationStorage?: MutationStorage
  /** Disable IndexedDB persistence (for testing) */
  disableIDB?: boolean
}

export class LocalAdapter<T extends RowWithId> implements DataStore<T> {
  private data: T[] = []
  private nextId = 1
  private idIndex: Map<string | number, number> = new Map()
  private indexStore: IndexStore<T>
  private idMode: IdMode

  readonly tableName: string
  readonly queue: MutationQueue<T>

  private idbEnabled: boolean
  private idbDb: IDBDatabase | null = null
  private persistScheduled = false

  constructor(options: LocalAdapterOptions<T>) {
    this.tableName = options.tableName
    this.idMode = options.idMode ?? 'client'
    this.idbEnabled = !options.disableIDB && typeof indexedDB !== 'undefined'
    this.indexStore = new IndexStore<T>(options.indexes ?? [])

    this.queue = new MutationQueue<T>({
      tableName: options.tableName,
      storage: options.mutationStorage,
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
      const db = await openIDB(this.tableName)
      this.idbDb = await ensureStore(db, this.tableName)

      const rows = await this.readAllFromIDB()
      if (rows.length > 0) {
        this.data = rows
        this.rebuildIndex()
      }
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

  insert(data: Omit<T, 'id'> | T): T {
    let newRow: T

    if (this.idMode === 'client') {
      if (!('id' in data)) {
        throw new Error(`ID is required in client mode (idMode: 'client')`)
      }
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

  update(id: string | number, data: Partial<T>): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined

    const oldRow = this.data[index]
    const newRow = { ...oldRow, ...data }
    this.data[index] = newRow
    this.indexStore.updateIndex(index, oldRow, newRow)

    // Record mutation and persist
    this.queue.push('update', id, data)
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
    const results: T[] = []
    const startIndex = this.data.length

    for (let i = 0; i < items.length; i++) {
      let newRow: T

      if (this.idMode === 'client') {
        if (!('id' in items[i])) {
          throw new Error(`ID is required in client mode (idMode: 'client')`)
        }
        newRow = items[i] as T
      } else {
        const id = this.nextId++
        newRow = { ...items[i], id } as T
      }

      const rowIndex = startIndex + i
      this.data.push(newRow)
      this.idIndex.set(newRow.id, rowIndex)
      this.indexStore.addToIndex(rowIndex, newRow)

      this.queue.push('insert', newRow.id, undefined, newRow)
      results.push(newRow)
    }

    this.schedulePersist()
    return results
  }

  batchUpdate(items: BatchUpdateItem<T>[]): T[] {
    const results: T[] = []

    for (const { id, data } of items) {
      const index = this.idIndex.get(id)
      if (index === undefined) continue

      const oldRow = this.data[index]
      const newRow = { ...oldRow, ...data }
      this.data[index] = newRow
      this.indexStore.updateIndex(index, oldRow, newRow)

      this.queue.push('update', id, data)
      results.push(newRow)
    }

    this.schedulePersist()
    return results
  }

  // ── Additional methods for SyncEngine ──────────────────────────────

  /** Replace all data (called by SyncEngine after pull) */
  replaceAll(rows: T[]): void {
    this.data = [...rows]
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

  private schedulePersist(): void {
    if (!this.idbEnabled || this.persistScheduled) return
    this.persistScheduled = true
    queueMicrotask(() => {
      this.persistScheduled = false
      this.persistToIDB().catch(() => {
        // Silently fail - data is still in memory
      })
    })
  }

  private async persistToIDB(): Promise<void> {
    if (!this.idbDb) return

    const db = this.idbDb

    // Ensure the object store exists
    if (!db.objectStoreNames.contains(this.tableName)) {
      this.idbDb = await ensureStore(db, this.tableName)
    }

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
