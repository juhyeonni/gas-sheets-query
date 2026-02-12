/**
 * Mock adapter for testing - in-memory data storage
 */
import type { Row, DataStore, QueryOptions, WhereCondition, BatchUpdateItem, IdMode } from '../core/types'
import { IndexStore, IndexDefinition } from '../core/index-store'
import { evaluateCondition, compareRows } from '../core/query-utils'

/** MockAdapter configuration options */
export interface MockAdapterOptions<T extends Row = Row> {
  /** Initial data */
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
export class MockAdapter<T extends Row & { id: string | number }> implements DataStore<T> {
  private data: T[] = []
  private nextId = 1
  /** Index for O(1) lookups by ID - maps id to array index */
  private idIndex: Map<string | number, number> = new Map()
  /** Column indexes for query optimization */
  private indexStore: IndexStore<T>
  /** ID generation mode */
  private idMode: IdMode

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
    this.indexStore = new IndexStore<T>(indexes)
    this.data = [...data]
    this.rebuildIndex()
    
    // Update nextId based on existing data (for auto mode)
    if (data.length > 0) {
      const maxId = Math.max(...data.map(r => 
        typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
      ))
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
    this.indexStore.rebuild(this.data)
  }

  findAll(): T[] {
    return [...this.data]
  }

  find(options: QueryOptions<T>): T[] {
    let candidateIndices: Set<number> | undefined
    let remainingConditions = options.where
    
    // Try to use column indexes for equality conditions
    if (options.where.length > 0) {
      const { usedIndices, unusedConditions } = this.tryUseIndexes(options.where)
      if (usedIndices !== undefined) {
        candidateIndices = usedIndices
        remainingConditions = unusedConditions
      }
    }
    
    // Get candidate rows (from index or full scan)
    let result: T[]
    if (candidateIndices !== undefined) {
      // Index-based: only check rows in candidate set
      result = []
      for (const idx of candidateIndices) {
        if (idx < this.data.length) {
          result.push(this.data[idx])
        }
      }
    } else {
      // Full scan
      result = [...this.data]
    }

    // Apply remaining where conditions (non-indexed or non-equality)
    if (remainingConditions.length > 0) {
      result = result.filter(row => 
        remainingConditions.every(condition => evaluateCondition(row, condition))
      )
    }

    // Apply ordering
    if (options.orderBy.length > 0) {
      result.sort((a, b) => compareRows(a, b, options.orderBy))
    }

    // Apply offset
    if (options.offsetValue !== undefined && options.offsetValue > 0) {
      result = result.slice(options.offsetValue)
    }

    // Apply limit
    if (options.limitValue !== undefined && options.limitValue >= 0) {
      result = result.slice(0, options.limitValue)
    }

    return result
  }
  
  /**
   * Try to use indexes for the given where conditions
   * Returns candidate row indices and unused conditions
   */
  private tryUseIndexes(conditions: WhereCondition<T>[]): {
    usedIndices: Set<number> | undefined
    unusedConditions: WhereCondition<T>[]
  } {
    // Extract equality conditions that might use indexes
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
    
    // Try to find an index for the equality conditions
    // Strategy: try single-field indexes first, then compound
    let usedIndices: Set<number> | undefined
    const usedConditionIndices = new Set<number>()
    
    // Try each equality condition individually first
    for (const eq of eqConditions) {
      const indices = this.indexStore.lookup([eq.field], [eq.value])
      if (indices !== undefined) {
        if (usedIndices === undefined) {
          usedIndices = new Set(indices)
        } else {
          // Intersect with existing candidates (AND logic)
          const intersection = new Set<number>()
          for (const idx of usedIndices) {
            if (indices.has(idx)) {
              intersection.add(idx)
            }
          }
          usedIndices = intersection
        }
        usedConditionIndices.add(eq.index)
      }
    }
    
    // If we have 2+ equality conditions, try compound indexes
    if (eqConditions.length >= 2) {
      const fields = eqConditions.map(eq => eq.field)
      const values = eqConditions.map(eq => eq.value)
      const compoundIndices = this.indexStore.lookup(fields, values)
      
      if (compoundIndices !== undefined) {
        if (usedIndices === undefined) {
          usedIndices = new Set(compoundIndices)
        } else {
          // Intersect
          const intersection = new Set<number>()
          for (const idx of usedIndices) {
            if (compoundIndices.has(idx)) {
              intersection.add(idx)
            }
          }
          usedIndices = intersection
        }
        // All equality conditions are covered by compound index
        eqConditions.forEach(eq => usedConditionIndices.add(eq.index))
      }
    }
    
    // Build unused conditions list
    const unusedConditions = conditions.filter((_, i) => !usedConditionIndices.has(i))
    
    return { usedIndices, unusedConditions }
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

  insert(data: Omit<T, 'id'> | T): T {
    let newRow: T
    
    if (this.idMode === 'client') {
      // Client mode: use client-provided ID
      if (!('id' in data)) {
        throw new Error(`ID is required in client mode (idMode: 'client')`)
      }
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
    this.indexStore.addToIndex(index, newRow)
    return newRow
  }

  /**
   * Update a row by ID - O(1) using index
   */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined
    
    const oldRow = this.data[index]
    const newRow = { ...oldRow, ...data }
    this.data[index] = newRow
    
    // Update column indexes
    this.indexStore.updateIndex(index, oldRow, newRow)
    
    return newRow
  }

  delete(id: string | number): boolean {
    const index = this.idIndex.get(id)
    if (index === undefined) return false
    
    const deletedRow = this.data[index]
    
    // Remove from column indexes before splice
    this.indexStore.removeFromIndex(index, deletedRow)
    
    this.data.splice(index, 1)
    this.idIndex.delete(id)
    
    // Rebuild ID index since splice shifts all subsequent elements
    for (let i = index; i < this.data.length; i++) {
      this.idIndex.set(this.data[i].id, i)
    }
    
    // Reindex column indexes after delete (shift row indices)
    this.indexStore.reindexAfterDelete(index)
    
    return true
  }

  /**
   * Batch insert multiple rows at once
   * More efficient than calling insert() in a loop
   */
  batchInsert(items: (Omit<T, 'id'> | T)[]): T[] {
    const results: T[] = []
    const startIndex = this.data.length
    
    for (let i = 0; i < items.length; i++) {
      let newRow: T
      
      if (this.idMode === 'client') {
        // Client mode: use client-provided ID
        if (!('id' in items[i])) {
          throw new Error(`ID is required in client mode (idMode: 'client')`)
        }
        newRow = items[i] as T
      } else {
        // Auto mode: server generates numeric ID
        const id = this.nextId++
        newRow = { ...items[i], id } as T
      }
      
      const rowIndex = startIndex + i
      this.data.push(newRow)
      this.idIndex.set(newRow.id, rowIndex)
      // Update column indexes
      this.indexStore.addToIndex(rowIndex, newRow)
      results.push(newRow)
    }
    
    return results
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
      const newRow = { ...oldRow, ...data }
      this.data[index] = newRow
      
      // Update column indexes
      this.indexStore.updateIndex(index, oldRow, newRow)
      
      results.push(newRow)
    }
    
    return results
  }

  /** Test helper: reset all data */
  reset(data: T[] = []): void {
    this.data = [...data]
    this.rebuildIndex()
    if (data.length > 0) {
      const maxId = Math.max(...data.map(r => 
        typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
      ))
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
