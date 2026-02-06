/**
 * Repository - high-level CRUD operations over a DataStore
 */
import type { Row, DataStore, QueryOptions } from './types'

/**
 * Repository provides a clean CRUD interface over any DataStore implementation
 */
export class Repository<T extends Row & { id: string | number }> {
  constructor(private readonly store: DataStore<T>) {}

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
   * @throws Error if not found
   */
  findById(id: string | number): T {
    const row = this.store.findById(id)
    if (!row) {
      throw new Error(`Row with id "${id}" not found`)
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
   * @throws Error if not found
   */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T {
    const updated = this.store.update(id, data)
    if (!updated) {
      throw new Error(`Row with id "${id}" not found`)
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
   * @throws Error if not found
   */
  delete(id: string | number): void {
    const deleted = this.store.delete(id)
    if (!deleted) {
      throw new Error(`Row with id "${id}" not found`)
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
}
