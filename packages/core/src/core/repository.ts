/**
 * Repository - high-level CRUD operations over a DataStore
 */
import type { RowWithId, DataStore, QueryOptions, BatchUpdateItem, UpdateData, UpsertData } from './types.js'
import { RowNotFoundError, ValidationError } from './errors.js'
import { withScriptLock } from './script-lock.js'

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
  create(data: T | Omit<T, 'id'>): T {
    return this.store.insert(data)
  }

  /**
   * Update a row by ID
   * @throws RowNotFoundError if not found
   */
  update(id: string | number, data: UpdateData<T>): T {
    const updated = this.store.update(id, data)
    if (!updated) {
      throw new RowNotFoundError(id, this.tableName)
    }
    return updated
  }

  /**
   * Update a row by ID, returns undefined if not found
   */
  updateOrNull(id: string | number, data: UpdateData<T>): T | undefined {
    return this.store.update(id, data)
  }

  /**
   * Insert a row, or patch the row that already carries the same id (#217).
   *
   * The branch is decided by the *result of the update*, not by a preceding
   * read: attempting the update first is one Sheets round trip cheaper on the
   * common (row exists) path, and leaves no window between deciding and
   * writing.
   *
   * The whole sequence is held under one script lock so two concurrent
   * executions cannot both miss and both insert. `withScriptLock` is
   * re-entrant, so the store's own locking nests inside this one, and it is a
   * plain call outside GAS. The flip side is a longer critical section than a
   * single write: two store round trips on the create path.
   *
   * @throws ValidationError when an id is supplied, no row carries it, and the
   * store allocates its own ids (`auto` idMode) — inserting there would write
   * the row under a different id than the caller asked for, leaving every
   * reference to the requested id dangling with no error. Omit the id to
   * create a row in an `auto` store.
   */
  upsert(data: UpsertData<T>): T {
    return withScriptLock(() => {
      const id = (data as Partial<T>).id
      if (id !== undefined) {
        const patch = { ...(data as T) } as Record<string, unknown>
        delete patch.id
        const updated = this.store.update(id, patch as UpdateData<T>)
        if (updated) return updated

        if (this.store.idMode === 'auto') {
          throw new ValidationError(
            `upsert: no row with id ${String(id)}${this.tableName ? ` in "${this.tableName}"` : ''}, ` +
            'and this store allocates ids ("auto" idMode), so it cannot create one under that id. ' +
            'Omit the id to create a row, or use idMode "client".',
            'id'
          )
        }
      }
      return this.store.insert(data as T | Omit<T, 'id'>)
    })
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
  batchInsert(data: (T | Omit<T, 'id'>)[]): T[] {
    if (this.store.batchInsert) {
      return this.store.batchInsert(data)
    }
    // Fallback: insert one by one
    return data.map(row => this.store.insert(row))
  }

  /**
   * Batch update multiple rows at once
   * Skips rows that don't exist (no error thrown)
   *
   * `data` excludes `id` (via {@link UpdateData}) for the same reason
   * `update()` does — the primary key is immutable (#98/#113). A widened
   * `Partial<T>` here let an id through the ordinary public API with no cast.
   */
  batchUpdate(items: BatchUpdateItem<T>[]): T[] {
    if (this.store.batchUpdate) {
      return this.store.batchUpdate(items)
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
