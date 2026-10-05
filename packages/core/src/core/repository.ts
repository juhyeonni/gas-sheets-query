/**
 * Repository - high-level CRUD operations over a DataStore
 */
import type {
  RowWithId,
  DataStore,
  QueryOptions,
  BatchUpdateItem,
  UpdateData,
  UpsertData,
  DefaultCreateInput
} from './types.js'
import { RowNotFoundError, ValidationError } from './errors.js'
import { withScriptLock } from './script-lock.js'
import {
  compileWriteDefaults,
  applyInsertDefaults,
  applyUpdateStamp,
  type CompiledWriteDefaults,
  type WriteDefaults
} from './column-defaults.js'

/**
 * Options for {@link Repository} (#199).
 *
 * `defaults` are filled on insert when a field is missing or `undefined`;
 * `updatedAt` fields are stamped with the write's `Date` on insert and update
 * unless the caller supplies a value. Neither ever touches `id`. Writes made
 * directly through a `DataStore` get neither.
 */
export type RepositoryOptions = WriteDefaults

/**
 * Repository provides a clean CRUD interface over any DataStore implementation
 *
 * @typeParam T - Row type
 * @typeParam C - Input accepted by `create`, `batchInsert` and insert-shaped
 *   `upsert`. Defaults to `T | Omit<T, 'id'>`; generated clients pass a type in
 *   which fields with a runtime default are optional (#199).
 */
export class Repository<T extends RowWithId, C = DefaultCreateInput<T>> {
  private readonly writeDefaults: CompiledWriteDefaults | undefined

  constructor(
    private readonly store: DataStore<T>,
    private readonly tableName?: string,
    options?: RepositoryOptions
  ) {
    this.writeDefaults = compileWriteDefaults(options)
  }

  /** The create input with defaults and stamps applied, as the store takes it */
  private prepareInsert(data: C | UpsertData<T>, now: Date): DefaultCreateInput<T> {
    return applyInsertDefaults(data as DefaultCreateInput<T>, this.writeDefaults, now)
  }

  /** The update patch with `@updatedAt` stamped, as the store takes it */
  private prepareUpdate(data: UpdateData<T>, now: Date): UpdateData<T> {
    return applyUpdateStamp(data, this.writeDefaults, now)
  }

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
  create(data: C): T {
    return this.store.insert(this.prepareInsert(data, new Date()))
  }

  /**
   * Update a row by ID
   * @throws RowNotFoundError if not found
   */
  update(id: string | number, data: UpdateData<T>): T {
    const updated = this.store.update(id, this.prepareUpdate(data, new Date()))
    if (!updated) {
      throw new RowNotFoundError(id, this.tableName)
    }
    return updated
  }

  /**
   * Update a row by ID, returns undefined if not found
   */
  updateOrNull(id: string | number, data: UpdateData<T>): T | undefined {
    return this.store.update(id, this.prepareUpdate(data, new Date()))
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
   *
   * With runtime defaults (#199), the update attempt stamps `@updatedAt` only;
   * defaults are applied only when the call falls through to insert, since in
   * the patch they would overwrite the existing row's values.
   */
  upsert(data: UpsertData<T> | C): T {
    const now = new Date()
    return withScriptLock(() => {
      const id = (data as Partial<RowWithId>).id
      if (id !== undefined) {
        const patch = { ...(data as Record<string, unknown>) }
        delete patch.id
        const updated = this.store.update(id, this.prepareUpdate(patch as UpdateData<T>, now))
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
      return this.store.insert(this.prepareInsert(data, now))
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
    return this.store.count ? this.store.count() : this.store.findAll().length
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
   *
   * Every row of one call gets the same `now` for defaults and stamps (#199).
   */
  batchInsert(data: C[]): T[] {
    const now = new Date()
    const rows: DefaultCreateInput<T>[] = this.writeDefaults
      ? data.map(row => this.prepareInsert(row, now))
      : (data as unknown as DefaultCreateInput<T>[])
    if (this.store.batchInsert) {
      return this.store.batchInsert(rows)
    }
    // Fallback: insert one by one
    return rows.map(row => this.store.insert(row))
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
    const now = new Date()
    const stamped: BatchUpdateItem<T>[] = this.writeDefaults?.updatedAt.length
      ? items.map(({ id, data }) => ({ id, data: this.prepareUpdate(data, now) }))
      : items
    if (this.store.batchUpdate) {
      return this.store.batchUpdate(stamped)
    }
    // Fallback: update one by one
    const results: T[] = []
    for (const { id, data } of stamped) {
      const updated = this.store.update(id, data)
      if (updated) {
        results.push(updated)
      }
    }
    return results
  }

  /**
   * Batch delete multiple rows by ID
   * Skips ids that don't exist (no error thrown); returns how many rows were deleted
   */
  batchDelete(ids: (string | number)[]): number {
    if (this.store.batchDelete) {
      return this.store.batchDelete(ids)
    }
    // Fallback: delete one by one
    let deleted = 0
    for (const id of ids) {
      if (this.store.delete(id)) deleted++
    }
    return deleted
  }
}
