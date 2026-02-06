/**
 * Mock adapter for testing - in-memory data storage
 */
import type { Row, DataStore, QueryOptions, WhereCondition, OrderByCondition } from '../core/types'

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
 */
export class MockAdapter<T extends Row & { id: string | number }> implements DataStore<T> {
  private data: T[] = []
  private nextId = 1

  constructor(initialData: T[] = []) {
    this.data = [...initialData]
    // Update nextId based on existing data
    if (initialData.length > 0) {
      const maxId = Math.max(...initialData.map(r => 
        typeof r.id === 'number' ? r.id : parseInt(r.id as string, 10) || 0
      ))
      this.nextId = maxId + 1
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

  findById(id: string | number): T | undefined {
    return this.data.find(row => row.id === id)
  }

  insert(data: Omit<T, 'id'>): T {
    const id = this.nextId++
    const newRow = { ...data, id } as T
    this.data.push(newRow)
    return newRow
  }

  update(id: string | number, data: Partial<Omit<T, 'id'>>): T | undefined {
    const index = this.data.findIndex(row => row.id === id)
    if (index === -1) return undefined
    
    this.data[index] = { ...this.data[index], ...data }
    return this.data[index]
  }

  delete(id: string | number): boolean {
    const index = this.data.findIndex(row => row.id === id)
    if (index === -1) return false
    
    this.data.splice(index, 1)
    return true
  }

  /** Test helper: reset all data */
  reset(data: T[] = []): void {
    this.data = [...data]
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
