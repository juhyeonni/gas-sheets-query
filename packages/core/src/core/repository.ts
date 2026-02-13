/**
 * Repository - high-level CRUD operations over a DataStore
 */
import type { RowWithId, DataStore, QueryOptions, BatchUpdateItem } from './types'
import { RowNotFoundError } from './errors'

/**
 * Repository provides a clean CRUD interface over any DataStore implementation
 */
export class Repository<T extends RowWithId> {
  constructor(
    private readonly store: DataStore<T>,
    private readonly tableName?: string
  ) {}

  /**
   * Get all rows from the repository
   */
  findAll(): T[] {
    return this.store.findAll()
  }

  /**
   * Find rows matching the query options
   */
  find(options: QueryOptions<T>): T[] {
    return this.store.find(options)
  }

  /**
   * Find a single row by ID
   * @throws RowNotFoundError if not found
   */
  findById(id: string | number): T {
    const row = this.store.findById(id)
    if (!row) {
      throw new RowNotFoundError(id, this.tableName)
    }
    return row
  }

  /**
   * Find a single row by ID, returns undefined if not found
   */
  findByIdOrNull(id: string | number): T | undefined {
    return this.store.findById(id)
  }

  /**
   * Insert a new row
   */
  create(data: Omit<T, 'id'>): T {
    return this.store.insert(data)
  }

  /**
   * Update a row by ID
   * @throws RowNotFoundError if not found
   */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T {
    const updated = this.store.update(id, data)
    if (!updated) {
      throw new RowNotFoundError(id, this.tableName)
    }
    return updated
  }

  /**
   * Update a row by ID, returns undefined if not found
   */
  updateOrNull(id: string | number, data: Partial<Omit<T, 'id'>>): T | undefined {
    return this.store.update(id, data)
  }

  /**
   * Delete a row by ID
   * @throws RowNotFoundError if not found
   */
  delete(id: string | number): void {
    const deleted = this.store.delete(id)
    if (!deleted) {
      throw new RowNotFoundError(id, this.tableName)
    }
  }

  /**
   * Delete a row by ID, returns false if not found
   */
  deleteIfExists(id: string | number): boolean {
    return this.store.delete(id)
  }

  /**
   * Count all rows
   */
  count(): number {
    return this.store.findAll().length
  }

  /**
   * Check if a row exists by ID
   */
  exists(id: string | number): boolean {
    return this.store.findById(id) !== undefined
  }

  /**
   * Batch insert multiple rows at once
   * More efficient than calling create() in a loop
   */
  batchInsert(data: Omit<T, 'id'>[]): T[] {
    if (this.store.batchInsert) {
      return this.store.batchInsert(data)
    }
    // Fallback: insert one by one
    return data.map(row => this.store.insert(row))
  }

  /**
   * Batch update multiple rows at once
   * Skips rows that don't exist (no error thrown)
   */
  batchUpdate(items: { id: string | number; data: Partial<Omit<T, 'id'>> }[]): T[] {
    if (this.store.batchUpdate) {
      return this.store.batchUpdate(items as BatchUpdateItem<T>[])
    }
    // Fallback: update one by one
    const results: T[] = []
    for (const { id, data } of items) {
      const updated = this.store.update(id, data)
      if (updated) {
        results.push(updated)
      }
    }
    return results
  }
}
