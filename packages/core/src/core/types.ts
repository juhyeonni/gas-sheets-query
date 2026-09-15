/**
 * Core types for gas-sheets-query
 */
import type { ColumnType } from '../adapters/sheets-adapter.js'
import type { IndexDefinition } from './index-store.js'

/**
 * ID generation mode for insert operations
 * - 'auto': Server generates numeric IDs (1, 2, 3...) - Online-first
 * - 'client': Client provides IDs (UUIDs, etc.) - Offline-first
 */
export type IdMode = 'auto' | 'client'

/** Generic row type - any object with string keys */
export type Row = Record<string, unknown>

/** Row with required id field (no index signature required) */
export type RowWithId = { id: string | number }

/** Comparison operators for where clauses */
export type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in'

/** Operators that require a single (non-array) value */
export type SingleValueOperator = Exclude<Operator, 'in'>

/** Operators that require an array value */
export type ArrayValueOperator = Extract<Operator, 'in'>

/** Sort direction */
export type SortDirection = 'asc' | 'desc'

/** Where condition */
export interface WhereCondition<T = Row> {
  field: keyof T & string
  operator: Operator
  value: unknown
}

/** Order by condition */
export interface OrderByCondition<T = Row> {
  field: keyof T & string
  direction: SortDirection
}

/** Query options after building */
export interface QueryOptions<T = Row> {
  where: WhereCondition<T>[]
  orderBy: OrderByCondition<T>[]
  limitValue?: number
  offsetValue?: number
}

/**
 * Patch accepted by update operations. The `id` is the primary key and is
 * immutable, so it cannot be changed via update (#98).
 */
export type UpdateData<T extends RowWithId> = Partial<Omit<T, 'id'>>

/**
 * Payload accepted by {@link DataStore} upsert callers (#217): a row without an
 * id (create), or a patch that carries the id of the row to write. A complete
 * row satisfies the second arm, so both `create` and `update` shapes fit.
 */
export type UpsertData<T extends RowWithId> = Omit<T, 'id'> | (UpdateData<T> & Pick<T, 'id'>)

/** Options for the optional {@link DataStore.addColumn} schema operation */
export interface AddColumnOptions {
  /**
   * Value written into existing rows whose cell for this column is empty.
   * Omitted (or `undefined`) means "no backfill" — only the column itself is
   * added, so re-running the operation converges instead of rewriting rows.
   */
  default?: unknown
}

/** Batch update item - id and data to update */
export interface BatchUpdateItem<T extends RowWithId = RowWithId> {
  id: string | number
  data: UpdateData<T>
}

/**
 * DataStore interface - abstraction over data storage
 * Implemented by GasAdapter (real Sheets) and MockAdapter (testing)
 */
export interface DataStore<T extends RowWithId = RowWithId> {
  /**
   * How ids are produced by this store, when it knows (optional).
   *
   * Declared so callers above the store can tell "I may supply an id" from
   * "the store allocates ids and will overwrite mine" — an `auto` store
   * silently rewrites the id on insert, which would let `Repository.upsert`
   * write a row under an id nobody asked for (#217).
   */
  readonly idMode?: IdMode

  /** Get all rows from the table */
  findAll(): T[]
  
  /** Find rows matching the query options */
  find(options: QueryOptions<T>): T[]
  
  /** Find a single row by ID */
  findById(id: string | number): T | undefined
  
  /** Insert a new row, returns the inserted row with ID */
  insert(data: T | Omit<T, 'id'>): T

  /** Update a row by ID, returns updated row or undefined if not found */
  update(id: string | number, data: UpdateData<T>): T | undefined

  /** Delete a row by ID, returns true if deleted */
  delete(id: string | number): boolean

  /** Batch insert multiple rows at once (optional) */
  batchInsert?(data: (T | Omit<T, 'id'>)[]): T[]
  
  /** Batch update multiple rows at once (optional) */
  batchUpdate?(items: BatchUpdateItem<T>[]): T[]

  /**
   * Physically add a column to the underlying storage (optional).
   *
   * Implemented by stores whose column set is fixed and positional, such as
   * SheetsAdapter: there, a column that is not part of the physical layout
   * cannot hold a value at all, so a migration must add the column itself
   * rather than write values through `update()` (#127). Implementations must
   * be idempotent and must not cost more I/O as the row count grows: the
   * default backfill is a single ranged write.
   *
   * Name-keyed stores (MockAdapter, LocalAdapter) omit this — any key is
   * representable there, so MigrationRunner falls back to a value backfill.
   */
  addColumn?(column: string, options?: AddColumnOptions): void

  /**
   * Physically rename a column in the underlying storage (optional).
   *
   * Counterpart of {@link DataStore.addColumn} for positional stores: moving
   * values between fields cannot rename anything there, because the field a
   * cell belongs to is decided by its position — the migration left the sheet
   * header on the old name while the schema declared the new one (#180). The
   * declared column set is the POST-rename schema, so implementations receive
   * a `newName` they know and an `oldName` they do not.
   *
   * Implementations must be idempotent (a second run writes nothing) and must
   * not cost more I/O as the row count grows.
   *
   * Name-keyed stores (MockAdapter, LocalAdapter) omit this — a rename there is
   * exactly the value move MigrationRunner falls back to.
   */
  renameColumn?(oldName: string, newName: string): void

  /**
   * Physically remove a column from the underlying storage (optional).
   *
   * **Destructive**: the column's values are deleted with it and no rollback
   * can restore them.
   *
   * Counterpart of {@link DataStore.addColumn} for positional stores: clearing
   * the values leaves the column in place, and the next deploy — whose schema
   * no longer declares it — reads and writes every column to its right one
   * position off (#180). The declared column set is the POST-removal schema, so
   * implementations receive a column they no longer know.
   *
   * Implementations must be idempotent (removing an absent column is a no-op)
   * and must not cost more I/O as the row count grows.
   *
   * Name-keyed stores (MockAdapter, LocalAdapter) omit this — there is no
   * physical column to drop, so MigrationRunner falls back to clearing values.
   */
  removeColumn?(column: string): void
}

// ============================================================================
// Schema-based Type Inference
// ============================================================================

/**
 * Primitive type samples for inference
 * Use sample values to hint the type:
 * - 0 or 1 → number
 * - '' or 'sample' → string
 * - true or false → boolean
 * - null → null
 * - new Date() → Date
 */
export type TypeSample = string | number | boolean | null | Date

/**
 * Infer TypeScript type from a sample value
 */
export type InferType<T> = 
  T extends string ? string :
  T extends number ? number :
  T extends boolean ? boolean :
  T extends Date ? Date :
  T extends null ? null :
  unknown

/**
 * Table schema with optional type hints
 * 
 * @example
 * ```ts
 * const schema = {
 *   columns: ['id', 'name', 'email', 'age', 'active'] as const,
 *   types: {
 *     id: 0,          // number
 *     name: '',       // string
 *     email: '',      // string
 *     age: 0,         // number
 *     active: true    // boolean
 *   }
 * } satisfies TableSchemaTyped
 * ```
 */
export interface TableSchemaTyped<
  C extends readonly string[] = readonly string[],
  T extends Partial<Record<C[number], TypeSample>> = Partial<Record<C[number], TypeSample>>
> {
  /** Column names in order (use `as const` for literal types) */
  columns: C
  /** Type hints using sample values */
  types?: T
  /**
   * ID column name (default: 'id')
   *
   * @deprecated 1.0 fixes the primary key at `'id'` (#101). This value is
   * stored on the config but never read — `defineSheetsDB` ignores it, and
   * `InferRowFromSchema` always types the row as `& { id }`. Custom primary-key
   * names are planned for a later release.
   */
  idColumn?: string
}

/**
 * Infer row type from a typed schema
 * - If types provided: use inferred types from samples
 * - If no types: fallback to { [column]: unknown }
 */
export type InferRowFromSchema<S extends TableSchemaTyped> = 
  S extends TableSchemaTyped<infer C, infer T>
    ? T extends Record<string, TypeSample>
      ? { [K in C[number]]: K extends keyof T ? InferType<T[K]> : unknown } & { id: string | number }
      : { [K in C[number]]: unknown } & { id: string | number }
    : RowWithId

/**
 * Infer all table types from a tables config
 */
export type InferTablesFromConfig<
  Tables extends Record<string, TableSchemaTyped>
> = {
  [K in keyof Tables]: InferRowFromSchema<Tables[K]>
}

// ============================================================================
// Runtime schema (shared by generated clients and the local-first client)
// ============================================================================

/**
 * Table description consumed at runtime by every client entry point:
 * `createClientFactory` (server path) and `createClientDB` (local-first path).
 *
 * Both used to declare their own near-identical shape — one with
 * `columnTypes`, the other with `indexes` — which made them silently
 * cross-assignable and dropped date deserialization on the local-first path
 * (#135). One type carries both, and every consumer honors both.
 */
export interface RuntimeTableSchema {
  /** Column names in order (first column should be 'id') */
  columns: readonly string[]
  /** Sheet name (defaults to the table name if not specified) */
  sheetName?: string
  /**
   * Column types for schema-driven (de)serialization (e.g. datetime -> 'date').
   * Optional: without it, values are passed through as stored.
   */
  columnTypes?: Record<string, ColumnType>
  /** Index definitions used to accelerate equality lookups */
  indexes?: IndexDefinition[]
}

/** Runtime schema: the table map a generated client exports. */
export interface RuntimeSchema {
  tables: Record<string, RuntimeTableSchema>
}

// ============================================================================
// Legacy types (backward compatible)
// ============================================================================

/** Table schema definition (legacy) */
export interface TableSchema<T extends RowWithId = RowWithId> {
  /** Column names in order */
  columns: readonly (keyof T & string)[]
  /**
   * ID column name (default: 'id')
   *
   * @deprecated 1.0 fixes the primary key at `'id'` (#101). Stored but never
   * read. Custom primary-key names are planned for a later release.
   */
  idColumn?: string
  /** Sheet name (defaults to table name if not specified) */
  sheetName?: string
}

/** Database configuration (legacy) */
export interface SheetsDBConfig {
  /** Spreadsheet ID (optional, uses active spreadsheet if not provided) */
  spreadsheetId?: string
  /** Table definitions */
  tables: Record<string, TableSchema<any>>
}
