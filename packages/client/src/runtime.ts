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
  IdMode,
  RuntimeSchema,
  RuntimeTableSchema,
  CreateInputMap
} from '@gsquery/core'
import { toSheetsDBConfig } from './schema-config.js'
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
 *
 * `CreateInputs` optionally narrows each table's create input (#199): a
 * generated client passes one type per table in which fields with a runtime
 * default or `@updatedAt` are optional.
 */
export type Client<
  Tables extends Record<string, RowWithId>,
  CreateInputs extends CreateInputMap<Tables> = Record<never, never>
> = SheetsDB<Tables, CreateInputs>

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
    // Type assertion needed: While T extends RowWithId (which has id: string | number),
    // TypeScript can't verify at compile time that T's id field exactly matches
    // SheetsAdapter's requirement. This is safe because RowWithId guarantees id exists
    // with the correct type at runtime.
    return new SheetsAdapter<T>({
      spreadsheetId: options.spreadsheetId,
      sheetName,
      columns: [...tableSchema.columns],
      columnTypes: tableSchema.columnTypes,
      idMode
    }) as DataStore<T>
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
export function createClientFactory<
  Tables extends Record<string, RowWithId>,
  CreateInputs extends CreateInputMap<Tables> = Record<never, never>
>(
  schema: GeneratedSchema
): (options?: ClientOptions) => Client<Tables, CreateInputs> {
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

    // Build config. Each table's defaults and @updatedAt fields reach its
    // Repository through it (#199).
    const config: SheetsDBConfig = {
      spreadsheetId: options.spreadsheetId,
      tables: toSheetsDBConfig(schema).tables
    }

    return createSheetsDB<Tables, CreateInputs>({
      config,
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
export function createMockClient<
  Tables extends Record<string, RowWithId>,
  CreateInputs extends CreateInputMap<Tables> = Record<never, never>
>(
  schema: GeneratedSchema
): Client<Tables, CreateInputs> {
  const factory = createClientFactory<Tables, CreateInputs>(schema)
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

export type { ColumnType, IndexDefinition, ColumnDefault, CreateInputMap } from '@gsquery/core'
