/**
 * Mock adapter for testing - in-memory data storage
 */
import type { Row, DataStore, QueryOptions, WhereCondition, OrderByCondition, BatchUpdateItem } from '../core/types'

/**
 * Evaluate a single where condition against a row
 */
function evaluateCondition<T extends Row>(row: T, condition: WhereCondition<T>): boolean {
  const { field, operator, value } = condition
  const fieldValue = row[field]

  switch (operator) {
    case '=':
      return fieldValue === value
    case '!=':
      return fieldValue !== value
    case '>':
      return (fieldValue as number) > (value as number)
    case '>=':
      return (fieldValue as number) >= (value as number)
    case '<':
      return (fieldValue as number) < (value as number)
    case '<=':
      return (fieldValue as number) <= (value as number)
    case 'like':
      if (typeof fieldValue !== 'string' || typeof value !== 'string') return false
      const pattern = value.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(fieldValue)
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue)
    default:
      return false
  }
}

/**
 * Compare function for sorting
 */
function compareRows<T extends Row>(a: T, b: T, orderBy: OrderByCondition<T>[]): number {
  for (const { field, direction } of orderBy) {
    const aVal = a[field]
    const bVal = b[field]
    
    let comparison = 0
    if (aVal < bVal) comparison = -1
    else if (aVal > bVal) comparison = 1
    
    if (comparison !== 0) {
      return direction === 'asc' ? comparison : -comparison
    }
  }
  return 0
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

  constructor(initialData: T[] = []) {
    this.data = [...initialData]
    this.rebuildIndex()
    // Update nextId based on existing data
    if (initialData.length > 0) {
      const maxId = Math.max(...initialData.map(r => 
        typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
      ))
      this.nextId = maxId + 1
    }
  }

  /** Rebuild the ID index from scratch */
  private rebuildIndex(): void {
    this.idIndex.clear()
    for (let i = 0; i < this.data.length; i++) {
      this.idIndex.set(this.data[i].id, i)
    }
  }

  findAll(): T[] {
    return [...this.data]
  }

  find(options: QueryOptions<T>): T[] {
    let result = [...this.data]

    // Apply where conditions (AND logic)
    if (options.where.length > 0) {
      result = result.filter(row => 
        options.where.every(condition => evaluateCondition(row, condition))
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
    if (options.limitValue !== undefined && options.limitValue > 0) {
      result = result.slice(0, options.limitValue)
    }

    return result
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

  insert(data: Omit<T, 'id'>): T {
    const id = this.nextId++
    const newRow = { ...data, id } as T
    const index = this.data.length
    this.data.push(newRow)
    this.idIndex.set(id, index)
    return newRow
  }

  /**
   * Update a row by ID - O(1) using index
   */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T | undefined {
    const index = this.idIndex.get(id)
    if (index === undefined) return undefined
    
    this.data[index] = { ...this.data[index], ...data }
    return this.data[index]
  }

  delete(id: string | number): boolean {
    const index = this.idIndex.get(id)
    if (index === undefined) return false
    
    this.data.splice(index, 1)
    this.idIndex.delete(id)
    // Rebuild index since splice shifts all subsequent elements
    this.rebuildIndex()
    return true
  }

  /**
   * Batch insert multiple rows at once
   * More efficient than calling insert() in a loop
   */
  batchInsert(data: Omit<T, 'id'>[]): T[] {
    const results: T[] = []
    const startIndex = this.data.length
    
    for (let i = 0; i < data.length; i++) {
      const id = this.nextId++
      const newRow = { ...data[i], id } as T
      this.data.push(newRow)
      this.idIndex.set(id, startIndex + i)
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
      
      this.data[index] = { ...this.data[index], ...data }
      results.push(this.data[index])
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
