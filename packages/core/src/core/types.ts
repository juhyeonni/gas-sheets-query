/**
 * Core types for gas-sheets-query
 */

/** Generic row type - any object with string keys */
export type Row = Record<string, unknown>

/** Row with required id field */
export type RowWithId = Row & { id: string | number }

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

/** Batch update item - id and data to update */
export interface BatchUpdateItem<T extends Row = Row> {
  id: string | number
  data: Partial<Omit<T, 'id'>>
}

/**
 * DataStore interface - abstraction over data storage
 * Implemented by GasAdapter (real Sheets) and MockAdapter (testing)
 */
export interface DataStore<T extends Row = Row> {
  /** Get all rows from the table */
  findAll(): T[]
  
  /** Find rows matching the query options */
  find(options: QueryOptions<T>): T[]
  
  /** Find a single row by ID */
  findById(id: string | number): T | undefined
  
  /** Insert a new row, returns the inserted row with ID */
  insert(data: Omit<T, 'id'>): T
  
  /** Update a row by ID, returns updated row or undefined if not found */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T | undefined
  
  /** Delete a row by ID, returns true if deleted */
  delete(id: string | number): boolean
  
  /** Batch insert multiple rows at once (optional) */
  batchInsert?(data: Omit<T, 'id'>[]): T[]
  
  /** Batch update multiple rows at once (optional) */
  batchUpdate?(items: BatchUpdateItem<T>[]): T[]
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
  /** ID column name (default: 'id') */
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
// Legacy types (backward compatible)
// ============================================================================

/** Table schema definition (legacy) */
export interface TableSchema<T extends Row = Row> {
  /** Column names in order */
  columns: readonly (keyof T & string)[]
  /** ID column name (default: 'id') */
  idColumn?: string
}

/** Database configuration (legacy) */
export interface SheetsDBConfig {
  /** Spreadsheet ID (optional, uses active spreadsheet if not provided) */
  spreadsheetId?: string
  /** Table definitions */
  tables: Record<string, TableSchema>
}
