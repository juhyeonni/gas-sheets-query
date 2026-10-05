/**
 * Mock adapter for testing - in-memory data storage
 */
import type { RowWithId, DataStore, QueryOptions, BatchUpdateItem, IdMode, UpdateData } from '../core/types.js'
import { IndexStore } from '../core/index-store.js'
import type { IndexDefinition } from '../core/index-store.js'
import { findWithIndexes } from '../core/indexed-find.js'
import { assertClientIdsAvailable } from '../core/client-ids.js'

/** MockAdapter configuration options */
export interface MockAdapterOptions<T extends RowWithId = RowWithId> {
  /**
   * Initial data.
   *
   * Seeded verbatim: unlike insert()/batchInsert() it is not checked for
   * duplicate ids, so a caller can still seed a store with colliding ids
   * (same for `reset()`). That mirrors SheetsAdapter, which likewise cannot
   * vouch for rows that were already on the sheet (#154). Of rows sharing an
   * id only the last is visible to findById/update/delete, the client id
   * check and indexed `=` find, and that stays true after deletes; an
   * unindexed scan still sees all of them.
   */
  initialData?: T[]
  /** Index definitions (schema-based) */
  indexes?: IndexDefinition[]
  /** 
   * ID generation mode (default: 'auto')
   * - 'auto': server generates numeric IDs (default, backward compatible)
   * - 'client': client provides IDs (UUID, string, etc.)
   */
  idMode?: IdMode
}

/**
 * In-memory DataStore implementation for testing
 * Uses an index (Map) for O(1) ID lookups instead of O(N) array scan
 */
export class MockAdapter<T extends RowWithId> implements DataStore<T> {
  private data: T[] = []
  private nextId = 1
  /** Index for O(1) lookups by ID - maps id to array index */
  private idIndex: Map<string | number, number> = new Map()
  /** Column indexes for query optimization */
  private indexStore: IndexStore<T, string | number>
  /** ID generation mode */
  readonly idMode: IdMode

  constructor(initialData?: T[] | MockAdapterOptions<T>) {
    // Support both array and options object for backward compatibility
    let data: T[] = []
    let indexes: IndexDefinition[] = []
    let idMode: IdMode = 'auto'
    
    if (Array.isArray(initialData)) {
      data = initialData
    } else if (initialData) {
      data = initialData.initialData || []
      indexes = initialData.indexes || []
      idMode = initialData.idMode ?? 'auto'
    }
    
    this.idMode = idMode
    this.indexStore = new IndexStore<T, string | number>(indexes)
    this.data = [...data]
    this.rebuildIndex()
    
    // Update nextId based on existing data (for auto mode)
    if (data.length > 0) {
      const maxId = data.reduce(
        (m, r) => Math.max(m, typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0),
        -Infinity
      )
      this.nextId = maxId + 1
    }
  }

  /** Rebuild the ID index and column indexes from scratch */
  private rebuildIndex(): void {
    this.idIndex.clear()
    for (let i = 0; i < this.data.length; i++) {
      this.idIndex.set(this.data[i].id, i)
    }
    // Rebuild column indexes
    // Column indexes hold exactly the rows findById can see (last row per id wins)
    this.indexStore.clear()
    for (const [id, pos] of this.idIndex) {
      this.indexStore.addToIndex(id, this.data[pos])
    }
  }

  findAll(): T[] {
    return [...this.data]
  }

  find(options: QueryOptions<T>): T[] {
    return findWithIndexes(this.data, this.idIndex, this.indexStore, options)
  }
  
  /**
   * Find a single row by ID - O(1) using index
   * Optimized: uses Map lookup instead of array scan
   */
  findById(id: string | number): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined
    return this.data[index]
  }

  /**
   * Read the id of a client-mode row, throwing when the caller omitted it.
   */
  private requireClientId(data: Omit<T, 'id'> | T): string | number {
    if (!('id' in data)) {
      throw new Error(`ID is required in client mode (idMode: 'client')`)
    }
    return (data as T).id
  }

  insert(data: Omit<T, 'id'> | T): T {
    let newRow: T

    if (this.idMode === 'client') {
      // Client mode: use client-provided ID, rejecting one that is taken
      // before anything is written.
      const id = this.requireClientId(data)
      assertClientIdsAvailable(this.idIndex, [id])
      newRow = data as T
    } else {
      // Auto mode: server generates numeric ID (default, backward compatible)
      const id = this.nextId++
      newRow = { ...data, id } as T
    }

    const index = this.data.length
    this.data.push(newRow)
    this.idIndex.set(newRow.id, index)
    // Update column indexes
    this.indexStore.addToIndex(newRow.id, newRow)
    return newRow
  }

  /**
   * Update a row by ID - O(1) using index
   */
  update(id: string | number, data: UpdateData<T>): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined
    
    const oldRow = this.data[index]
    // id is immutable via update; ignore any attempt to change it so the
    // idIndex stays consistent and behavior matches SheetsAdapter (#98).
    const newRow = { ...oldRow, ...data, id: oldRow.id }
    this.data[index] = newRow

    // Update column indexes
    this.indexStore.updateIndex(oldRow.id, oldRow, newRow)
    
    return newRow
  }

  delete(id: string | number): boolean {
    const index = this.idIndex.get(id)
    if (index === undefined) return false
    
    const deletedRow = this.data[index]
    
    // Remove from column indexes before splice
    this.indexStore.removeFromIndex(id, deletedRow)
    
    this.data.splice(index, 1)
    this.idIndex.delete(id)
    
    // Renumber only the row idIndex points to: shadowed rows sharing an id
    // stay invisible (#154/#235).
    for (let i = index; i < this.data.length; i++) {
      const rowId = this.data[i].id
      if (this.idIndex.get(rowId) === i + 1) this.idIndex.set(rowId, i)
    }
    
    return true
  }

  /**
   * Batch insert multiple rows at once
   * More efficient than calling insert() in a loop
   */
  batchInsert(items: (Omit<T, 'id'> | T)[]): T[] {
    // Resolve and validate every row before touching the store: a rejected
    // batch must mutate nothing, matching SheetsAdapter (#128/#154).
    const newRows: T[] = []

    if (this.idMode === 'client') {
      // Client mode: use client-provided IDs
      const ids: (string | number)[] = []
      for (const item of items) {
        ids.push(this.requireClientId(item))
        newRows.push(item as T)
      }
      assertClientIdsAvailable(this.idIndex, ids)
    } else {
      // Auto mode: server generates numeric IDs
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
      // Update column indexes
      this.indexStore.addToIndex(newRow.id, newRow)
    }

    return newRows
  }

  /**
   * Batch update multiple rows at once
   * Returns array of updated rows (skips rows that don't exist)
   */
  batchUpdate(items: BatchUpdateItem<T>[]): T[] {
    const results: T[] = []
    
    for (const { id, data } of items) {
      const index = this.idIndex.get(id)
      if (index === undefined) continue
      
      const oldRow = this.data[index]
      // Same immutability guard update() has (#98/#113) — without it the row
      // keeps its old idIndex entry and becomes a ghost: findById(oldId)
      // returns it, findById(newId) does not.
      const newRow = { ...oldRow, ...data, id: oldRow.id }
      this.data[index] = newRow

      // Update column indexes
      this.indexStore.updateIndex(oldRow.id, oldRow, newRow)

      results.push(newRow)
    }
    
    return results
  }

  /**
   * Batch delete multiple rows by id
   * Returns how many rows were deleted (skips ids that don't exist)
   */
  batchDelete(ids: (string | number)[]): number {
    let deleted = 0
    for (const id of new Set(ids)) {
      if (this.delete(id)) deleted++
    }
    return deleted
  }

  /** Test helper: reset all data (seeded verbatim, see {@link MockAdapterOptions.initialData}) */
  reset(data: T[] = []): void {
    this.data = [...data]
    this.rebuildIndex()
    if (data.length > 0) {
      const maxId = data.reduce(
        (m, r) => Math.max(m, typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0),
        -Infinity
      )
      this.nextId = maxId + 1
    } else {
      this.nextId = 1
    }
  }

  /** Test helper: get raw data */
  getRawData(): T[] {
    return [...this.data]
  }
}
