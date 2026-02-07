/**
 * @gsquery/client Runtime
 * 
 * Provides createClient API for Type-safe database access.
 * This module is environment-aware and works in both GAS and Node.js.
 */

import type { 
  RowWithId, 
  DataStore, 
  SheetsDBConfig 
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
 * ID mode for insert operations
 * - 'auto': Server generates numeric IDs (1, 2, 3...) - Online-first
 * - 'client': Client provides IDs (UUIDs, etc.) - Offline-first
 */
export type IdMode = 'auto' | 'client'

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
 */
export interface GeneratedSchema {
  tables: Record<string, {
    columns: readonly string[]
    sheetName?: string
  }>
}

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
  tableSchema: { columns: readonly string[]; sheetName?: string },
  options: ClientOptions
): DataStore<T> {
  const idMode = options.idMode || 'auto'

  // Mock mode always uses MockAdapter
  if (options.mock) {
    return new MockAdapter<T>({ idMode })
  }

  // GAS environment with SheetsAdapter
  if (isGASEnvironment()) {
    const sheetName = tableSchema.sheetName || tableName
    // Use type assertion since SheetsAdapter requires { id: number }
    // but runtime will handle both number and string IDs
    return new SheetsAdapter({
      spreadsheetId: options.spreadsheetId,
      sheetName,
      columns: [...tableSchema.columns],
      idMode
    }) as unknown as DataStore<T>
  }

  // Fallback to MockAdapter for Node.js
  return new MockAdapter<T>({ idMode })
}

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Create a Typed client from generated schema
 * 
 * This is the base function that generated code will use.
 * 
 * @example
 * ```ts
 * // In generated client.ts:
 * import { createClientFactory } from '@gsquery/client'
 * import { schema, Tables } from './types'
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
          // Fallback to mock if store not provided for a table
          stores[tableName] = new MockAdapter()
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
          { columns: [...s.columns] }
        ])
      )
    }

    return createSheetsDB<Tables>({
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
  RowWithId,
  DataStore,
  SheetsDB,
  TableHandle,
}
