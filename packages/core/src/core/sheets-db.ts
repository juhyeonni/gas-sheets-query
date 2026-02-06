/**
 * SheetsDB - Main entry point for gas-sheets-query
 */
import type { 
  RowWithId,
  DataStore, 
  SheetsDBConfig,
  TableSchemaTyped,
  InferRowFromSchema,
  InferTablesFromConfig
} from './types'
import { Repository } from './repository'
import { QueryBuilder, createQueryBuilder } from './query-builder'
import { TableNotFoundError, MissingStoreError } from './errors'

/**
 * Table handle providing Repository and QueryBuilder access
 */
export interface TableHandle<T extends RowWithId> {
  /** Repository for CRUD operations */
  readonly repo: Repository<T>
  
  /** Create a new query builder for this table */
  query(): QueryBuilder<T>
  
  /** Shorthand: create a row */
  create(data: Omit<T, 'id'>): T
  
  /** Shorthand: find by id */
  findById(id: string | number): T
  
  /** Shorthand: find all */
  findAll(): T[]
  
  /** Shorthand: update by id */
  update(id: string | number, data: Partial<Omit<T, 'id'>>): T
  
  /** Shorthand: delete by id */
  delete(id: string | number): void
  
  /** Batch insert multiple rows at once */
  batchInsert(data: Omit<T, 'id'>[]): T[]
  
  /** Batch update multiple rows at once */
  batchUpdate(items: { id: string | number; data: Partial<Omit<T, 'id'>> }[]): T[]
}

/**
 * SheetsDB instance with typed table access
 */
export interface SheetsDB<Tables extends Record<string, RowWithId>> {
  /** Get a table handle by name */
  from<K extends keyof Tables & string>(tableName: K): TableHandle<Tables[K]>
  
  /** Get raw access to the underlying data store */
  getStore<K extends keyof Tables & string>(tableName: K): DataStore<Tables[K]>
  
  /** Configuration */
  readonly config: SheetsDBConfig
}

/**
 * Create a TableHandle for a given store
 */
function createTableHandle<T extends RowWithId>(
  store: DataStore<T>,
  tableName: string
): TableHandle<T> {
  const repo = new Repository<T>(store, tableName)
  
  return {
    repo,
    query: () => createQueryBuilder(store),
    create: (data) => repo.create(data),
    findById: (id) => repo.findById(id),
    findAll: () => repo.findAll(),
    update: (id, data) => repo.update(id, data),
    delete: (id) => repo.delete(id),
    batchInsert: (data) => repo.batchInsert(data),
    batchUpdate: (items) => repo.batchUpdate(items)
  }
}

// ============================================================================
// Legacy API (explicit types)
// ============================================================================

/**
 * Factory options for createSheetsDB (legacy - explicit types)
 */
export interface CreateSheetsDBOptions<Tables extends Record<string, RowWithId>> {
  /** Database configuration */
  config: SheetsDBConfig
  
  /** Data stores for each table (for testing or custom implementations) */
  stores: { [K in keyof Tables]: DataStore<Tables[K]> }
}

/**
 * Create a SheetsDB instance with explicit type parameters
 * 
 * @example
 * ```ts
 * interface User { id: number; name: string; email: string }
 * 
 * const db = createSheetsDB<{ users: User }>({
 *   config: { tables: { users: { columns: ['id', 'name', 'email'] } } },
 *   stores: { users: new MockAdapter() }
 * })
 * ```
 */
export function createSheetsDB<Tables extends Record<string, RowWithId>>(
  options: CreateSheetsDBOptions<Tables>
): SheetsDB<Tables> {
  const { config, stores } = options
  
  // Validate that all tables in config have stores
  for (const tableName of Object.keys(config.tables)) {
    if (!(tableName in stores)) {
      throw new MissingStoreError(tableName)
    }
  }
  
  // Cache table handles
  const handles: Record<string, unknown> = {}
  
  return {
    config,
    
    from<K extends keyof Tables & string>(tableName: K): TableHandle<Tables[K]> {
      if (!(tableName in config.tables)) {
        throw new TableNotFoundError(tableName, Object.keys(config.tables))
      }
      
      if (!(tableName in handles)) {
        handles[tableName] = createTableHandle(stores[tableName], tableName)
      }
      
      return handles[tableName] as TableHandle<Tables[K]>
    },
    
    getStore<K extends keyof Tables & string>(tableName: K): DataStore<Tables[K]> {
      if (!(tableName in stores)) {
        throw new TableNotFoundError(tableName, Object.keys(stores))
      }
      return stores[tableName]
    }
  }
}

// ============================================================================
// New API (schema-based type inference)
// ============================================================================

/**
 * Options for defineSheetsDB with schema-based type inference
 */
export interface DefineSheetsDBOptions<
  TableSchemas extends Record<string, TableSchemaTyped>
> {
  /** Spreadsheet ID (optional) */
  spreadsheetId?: string
  /** Table schemas with optional type hints */
  tables: TableSchemas
  /** Data stores (for testing or custom implementations) */
  stores: { [K in keyof TableSchemas]: DataStore<InferRowFromSchema<TableSchemas[K]>> }
}

/**
 * Create a SheetsDB instance with automatic type inference from schema
 * 
 * @example
 * ```ts
 * // Types are automatically inferred from the schema!
 * const db = defineSheetsDB({
 *   tables: {
 *     users: {
 *       columns: ['id', 'name', 'email', 'age', 'active'] as const,
 *       types: {
 *         id: 0,          // → number
 *         name: '',       // → string
 *         email: '',      // → string
 *         age: 0,         // → number
 *         active: true    // → boolean
 *       }
 *     },
 *     posts: {
 *       columns: ['id', 'title', 'userId', 'published'] as const,
 *       types: {
 *         id: 0,
 *         title: '',
 *         userId: 0,
 *         published: false
 *       }
 *     }
 *   },
 *   stores: {
 *     users: new MockAdapter(),
 *     posts: new MockAdapter()
 *   }
 * })
 * 
 * // Full autocomplete! ✨
 * db.from('users').query()
 *   .where('name', '=', 'John')      // ✅ 'name' autocomplete
 *   .where('age', '>', 18)           // ✅ 'age' autocomplete
 *   .where('active', '=', true)      // ✅ boolean type
 *   .exec()
 * 
 * // Type error on invalid columns
 * db.from('users').query()
 *   .where('foo', '=', 'bar')        // ❌ Error: 'foo' is not a valid column
 * ```
 */
export function defineSheetsDB<
  const TableSchemas extends Record<string, TableSchemaTyped>
>(
  options: DefineSheetsDBOptions<TableSchemas>
): SheetsDB<InferTablesFromConfig<TableSchemas>> {
  const { spreadsheetId, tables, stores } = options
  
  // Build legacy config
  const config: SheetsDBConfig = {
    spreadsheetId,
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, schema]) => [
        name,
        { columns: schema.columns, idColumn: schema.idColumn }
      ])
    )
  }
  
  // Validate stores
  for (const tableName of Object.keys(tables)) {
    if (!(tableName in stores)) {
      throw new MissingStoreError(tableName)
    }
  }
  
  // Cache table handles
  const handles: Record<string, unknown> = {}
  
  type InferredTables = InferTablesFromConfig<TableSchemas>
  
  return {
    config,
    
    from<K extends keyof InferredTables & string>(tableName: K): TableHandle<InferredTables[K]> {
      if (!(tableName in tables)) {
        throw new TableNotFoundError(tableName, Object.keys(tables))
      }
      
      if (!(tableName in handles)) {
        const store = stores[tableName as keyof typeof stores]
        handles[tableName] = createTableHandle(store as DataStore<InferredTables[K]>, tableName)
      }
      
      return handles[tableName] as TableHandle<InferredTables[K]>
    },
    
    getStore<K extends keyof InferredTables & string>(tableName: K): DataStore<InferredTables[K]> {
      if (!(tableName in stores)) {
        throw new TableNotFoundError(tableName, Object.keys(stores))
      }
      return stores[tableName as keyof typeof stores] as DataStore<InferredTables[K]>
    }
  }
}
