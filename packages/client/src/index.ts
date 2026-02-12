/**
 * @gsquery/client
 * 
 * Typed client for gas-sheets-query.
 * 
 * Usage:
 * 1. Define your schema in schema.gsq.yaml
 * 2. Run `gsquery generate --client` to generate types
 * 3. Import and use:
 * 
 * ```ts
 * import { createClient } from '@gsquery/client'
 * 
 * const db = createClient({ spreadsheetId: 'your-id' })
 * 
 * // Type-safe API
 * const users = db.from('User').findAll()
 * const user = db.from('User').query().where('email', '=', 'test@example.com').first()
 * ```
 * 
 * Before `gsquery generate --client` is run, this module exports placeholder types.
 * After generation, the ./generated module provides full type safety.
 */

// Runtime exports (always available)
export {
  createClientFactory,
  createMockClient,
  createStore,
  isGASEnvironment,
  isNodeEnvironment,
  MockAdapter,
  SheetsAdapter,
  TableNotFoundError,
  RowNotFoundError,
  ValidationError,
} from './runtime.js'

export type {
  IdMode,
  ClientOptions,
  GeneratedSchema,
  Client,
  RowWithId,
  DataStore,
  SheetsDB,
  TableHandle,
} from './runtime.js'

// =============================================================================
// Placeholder exports (before generate)
// =============================================================================

/**
 * Placeholder type - replaced by generated types after `gsquery generate --client`
 */
export type Tables = Record<string, never>

/**
 * Placeholder schema - replaced by generated schema after `gsquery generate --client`
 */
export const schema = {
  tables: {}
} as const

/**
 * Placeholder createClient - replaced by generated version after `gsquery generate --client`
 *
 * This function returns a proxy that provides a clear error message when
 * any table operation is attempted, guiding users to run code generation.
 *
 * Run `gsquery generate --client` to generate proper types and client.
 */
export function createClient(_options?: { spreadsheetId?: string; mock?: boolean }): {
  from(tableName: string): {
    findAll(): never
    findById(id: string | number): never
    query(): never
    insert(data: Record<string, unknown>): never
    update(id: string | number, data: Record<string, unknown>): never
    delete(id: string | number): never
  }
} {
  const message =
    '@gsquery/client: No schema generated yet. ' +
    'Run `gsquery generate --client` to generate types and client from your schema.'

  const handler = (): never => { throw new Error(message) }

  return {
    from(_tableName: string) {
      return {
        findAll: handler,
        findById: handler,
        query: handler,
        insert: handler,
        update: handler,
        delete: handler,
      }
    }
  }
}
