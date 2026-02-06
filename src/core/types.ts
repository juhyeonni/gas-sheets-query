/**
 * Core types for gas-sheets-query
 */

/** Generic row type - any object with string keys */
export type Row = Record<string, unknown>

/** Comparison operators for where clauses */
export type Operator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like' | 'in'

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
}

/** Table schema definition */
export interface TableSchema<T extends Row = Row> {
  /** Column names in order */
  columns: readonly (keyof T & string)[]
  /** ID column name (default: 'id') */
  idColumn?: string
}

/** Database configuration */
export interface SheetsDBConfig {
  /** Spreadsheet ID (optional, uses active spreadsheet if not provided) */
  spreadsheetId?: string
  /** Table definitions */
  tables: Record<string, TableSchema>
}
