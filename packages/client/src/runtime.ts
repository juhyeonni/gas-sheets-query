/**
 * @gsquery/client Runtime
 * 
 * Provides createClient API for type-safe database access.
 * This module is environment-aware and works in both GAS and Node.js.
 */

import type {
  RowWithId,
  DataStore,
  SheetsDBConfig,
  TypedSheetsDBConfig,
  IdMode,
  RuntimeSchema,
  RuntimeTableSchema
} from '@gsquery/core'
import { 
  createSheetsDB, 
  MockAdapter, 
  SheetsAdapter,
  TableNotFoundError,
  RowNotFoundError,
  ValidationError
} from '@gsquery/core'
import type { SheetsDB, TableHandle } from '@gsquery/core'

// =============================================================================
// Types
// =============================================================================

/**
 * Client options
 */
export interface ClientOptions {
  /** Spreadsheet ID (required for production, optional for testing) */
  spreadsheetId?: string
  /** Use mock adapter for testing */
  mock?: boolean
  /** Custom stores (for TSV adapters, etc.) - takes precedence over mock/spreadsheetId */
  stores?: Record<string, DataStore<RowWithId>>
  /** ID mode: 'auto' (server generates) or 'client' (client provides UUID) */
  idMode?: IdMode
}

/**
 * Generated schema interface (provided by generate command)
 *
 * Alias of the shared {@link RuntimeSchema}: the exact shape `createClientDB`
 * consumes, so a generated schema drives both the server and the local-first
 * path with the same `columnTypes` and `indexes` (#135).
 */
export type GeneratedSchema = RuntimeSchema

/**
 * Client factory result type
 */
export type Client<Tables extends Record<string, RowWithId>> = SheetsDB<Tables>

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Detect if running in Google Apps Script environment
 */
export function isGASEnvironment(): boolean {
  return typeof globalThis !== 'undefined' && 
    'SpreadsheetApp' in globalThis
}

/**
 * Detect if running in Node.js environment
 */
export function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && process.versions?.node !== undefined
}

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create appropriate data store based on environment and options
 */
export function createStore<T extends RowWithId>(
  tableName: string,
  tableSchema: RuntimeTableSchema,
  options: ClientOptions
): DataStore<T> {
  const idMode = options.idMode || 'auto'

  // Mock mode always uses MockAdapter
  if (options.mock) {
    return new MockAdapter<T>({ idMode, indexes: tableSchema.indexes })
  }

  // If spreadsheetId is provided, use SheetsAdapter
  // This works even if isGASEnvironment() returns false in bundled code
  if (options.spreadsheetId || isGASEnvironment()) {
    // Warn when using active spreadsheet without explicit spreadsheetId
    if (!options.spreadsheetId && isGASEnvironment()) {
      console.warn(
        `[gsquery] Using active spreadsheet for table '${tableName}' (no spreadsheetId provided). ` +
        `This may write to unintended spreadsheet. Consider passing explicit spreadsheetId.`
      )
    }

    const sheetName = tableSchema.sheetName || tableName
    // Built untyped, then handed out as T: the runtime schema's columns are
    // plain strings, and nothing at this point ties them to T's keys, so a
    // SheetsAdapter<T> would reject them (#246). The generated schema and the
    // generated row types come from the same source, which is what keeps the
    // two in step.
    return new SheetsAdapter({
      spreadsheetId: options.spreadsheetId,
      sheetName,
      columns: [...tableSchema.columns],
      columnTypes: tableSchema.columnTypes,
      idMode
    }) as DataStore<RowWithId> as DataStore<T>
  }

  // No spreadsheetId, not in GAS, and mock not requested. Refuse to silently
  // use an in-memory MockAdapter — production writes would vanish. Require an
  // explicit opt-in (#84).
  throw new Error(
    `Cannot create a store for table '${tableName}': no spreadsheetId provided and not running in Google Apps Script. ` +
    `Pass a spreadsheetId, or set mock: true to use the in-memory adapter for development/testing.`
  )
}

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Create a typed client from generated schema
 * 
 * This is the base function that generated code will use.
 * 
 * @example
 * ```ts
 * // In generated client.ts:
 * import { createClientFactory } from '@gsquery/client'
 * import { schema, Tables } from './types.js'
 * 
 * export const createClient = createClientFactory<Tables>(schema)
 * 
 * // Usage:
 * const db = createClient({ spreadsheetId: 'xxx' })
 * const users = db.from('User').findAll()
 * ```
 */
export function createClientFactory<Tables extends Record<string, RowWithId>>(
  schema: GeneratedSchema
): (options?: ClientOptions) => Client<Tables> {
  return (options: ClientOptions = {}) => {
    // Build stores for each table
    // If custom stores provided, use them; otherwise create based on options
    const stores: Record<string, DataStore<RowWithId>> = {}
    
    if (options.stores) {
      // Use custom stores (e.g., TSV adapters)
      for (const tableName of Object.keys(schema.tables)) {
        if (options.stores[tableName]) {
          stores[tableName] = options.stores[tableName]
        } else {
          // Throw error instead of silent fallback to prevent data loss
          throw new Error(
            `Store for table '${tableName}' not provided in options.stores. ` +
            `Available tables: ${Object.keys(schema.tables).join(', ')}`
          )
        }
      }
    } else {
      // Create stores based on environment/options
      for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
        stores[tableName] = createStore(tableName, tableSchema, options)
      }
    }

    // Build config
    const config: SheetsDBConfig = {
      spreadsheetId: options.spreadsheetId,
      tables: Object.fromEntries(
        Object.entries(schema.tables).map(([name, s]) => [
          name,
          {
            columns: [...s.columns],
            sheetName: s.sheetName
          }
        ])
      )
    }

    return createSheetsDB<Tables>({
      // Built from the runtime schema, so its columns are plain strings that
      // the compiler cannot tie to Tables' keys (#246).
      config: config as TypedSheetsDBConfig<Tables>,
      stores: stores as { [K in keyof Tables]: DataStore<Tables[K]> }
    })
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock client for testing
 * 
 * @example
 * ```ts
 * const db = createMockClient<Tables>(schema)
 * // All operations use in-memory MockAdapter
 * ```
 */
export function createMockClient<Tables extends Record<string, RowWithId>>(
  schema: GeneratedSchema
): Client<Tables> {
  const factory = createClientFactory<Tables>(schema)
  return factory({ mock: true })
}

// =============================================================================
// Re-exports from core (for convenience)
// =============================================================================

export { 
  MockAdapter, 
  SheetsAdapter,
  TableNotFoundError,
  RowNotFoundError,
  ValidationError 
}

export type {
  IdMode,
  RowWithId,
  DataStore,
  SheetsDB,
  TableHandle,
  RuntimeSchema,
  RuntimeTableSchema,
}

export type { ColumnType, IndexDefinition } from '@gsquery/core'
