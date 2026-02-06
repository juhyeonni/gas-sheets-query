/**
 * SheetsDB - Main entry point for gas-sheets-query
 */
import type { Row, DataStore, SheetsDBConfig } from './types'
import { Repository } from './repository'
import { QueryBuilder, createQueryBuilder } from './query-builder'

/**
 * Table handle providing Repository and QueryBuilder access
 */
export interface TableHandle<T extends Row & { id: string | number }> {
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
}

/**
 * SheetsDB instance with typed table access
 */
export interface SheetsDB<Tables extends Record<string, Row & { id: string | number }>> {
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
function createTableHandle<T extends Row & { id: string | number }>(
  store: DataStore<T>
): TableHandle<T> {
  const repo = new Repository<T>(store)
  
  return {
    repo,
    query: () => createQueryBuilder(store),
    create: (data) => repo.create(data),
    findById: (id) => repo.findById(id),
    findAll: () => repo.findAll(),
    update: (id, data) => repo.update(id, data),
    delete: (id) => repo.delete(id)
  }
}

/**
 * Factory options for createSheetsDB
 */
export interface CreateSheetsDBOptions<Tables extends Record<string, Row & { id: string | number }>> {
  /** Database configuration */
  config: SheetsDBConfig
  
  /** Data stores for each table (for testing or custom implementations) */
  stores: { [K in keyof Tables]: DataStore<Tables[K]> }
}

/**
 * Create a SheetsDB instance
 * 
 * @example
 * ```ts
 * // With mock adapters for testing
 * const db = createSheetsDB({
 *   config: {
 *     tables: {
 *       users: { columns: ['id', 'name', 'email'] },
 *       posts: { columns: ['id', 'title', 'userId'] }
 *     }
 *   },
 *   stores: {
 *     users: new MockAdapter(),
 *     posts: new MockAdapter()
 *   }
 * })
 * 
 * // Use fluent API
 * const activeUsers = db.from('users')
 *   .query()
 *   .where('active', '=', true)
 *   .orderBy('name')
 *   .exec()
 * 
 * // Or use repository methods
 * const user = db.from('users').create({ name: 'John', email: 'john@test.com' })
 * ```
 */
export function createSheetsDB<Tables extends Record<string, Row & { id: string | number }>>(
  options: CreateSheetsDBOptions<Tables>
): SheetsDB<Tables> {
  const { config, stores } = options
  
  // Validate that all tables in config have stores
  for (const tableName of Object.keys(config.tables)) {
    if (!(tableName in stores)) {
      throw new Error(`Missing store for table "${tableName}"`)
    }
  }
  
  // Cache table handles - use unknown type for flexible caching
  const handles: Record<string, unknown> = {}
  
  return {
    config,
    
    from<K extends keyof Tables & string>(tableName: K): TableHandle<Tables[K]> {
      if (!(tableName in config.tables)) {
        throw new Error(
          `Table "${tableName}" not found. Available: ${Object.keys(config.tables).join(', ')}`
        )
      }
      
      // Return cached handle or create new one
      if (!(tableName in handles)) {
        handles[tableName] = createTableHandle(stores[tableName])
      }
      
      return handles[tableName] as TableHandle<Tables[K]>
    },
    
    getStore<K extends keyof Tables & string>(tableName: K): DataStore<Tables[K]> {
      if (!(tableName in stores)) {
        throw new Error(
          `Store for table "${tableName}" not found. Available: ${Object.keys(stores).join(', ')}`
        )
      }
      return stores[tableName]
    }
  }
}
