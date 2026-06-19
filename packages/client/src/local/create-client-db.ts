/**
 * createClientDB - Factory that assembles LocalAdapter + MutationQueue + SyncEngine
 * into a SheetsDB-compatible local-first client.
 */
import type { RowWithId, DataStore, SheetsDBConfig } from '@gsquery/core'
import { createSheetsDB } from '@gsquery/core'
import type { SheetsDB } from '@gsquery/core'
import { LocalAdapter, openSharedIDB } from './local-adapter.js'
import type { LocalAdapterOptions } from './local-adapter.js'
import { SyncEngine } from './sync-engine.js'
import type { SyncEngineOptions } from './sync-engine.js'
import type { SyncTransport, ConflictStrategy } from './sync-transport.js'
import type { MutationStorage } from './mutation-queue.js'
import type { IndexDefinition } from '@gsquery/core'

/** Schema definition for createClientDB */
export interface ClientDBSchema {
  tables: Record<string, {
    columns: readonly string[]
    sheetName?: string
    indexes?: IndexDefinition[]
  }>
}

export interface CreateClientDBOptions<Tables extends Record<string, RowWithId>> {
  schema: ClientDBSchema
  transport: SyncTransport
  conflictStrategy?: ConflictStrategy
  pushDebounceMs?: number
  /** Custom mutation storage (defaults to localStorage) */
  mutationStorage?: MutationStorage
  /** Disable IndexedDB (for testing in non-browser environments) */
  disableIDB?: boolean
  /** Pre-populated data per table (for testing) */
  initialData?: { [K in keyof Tables]?: Tables[K][] }
}

export interface ClientDBResult<Tables extends Record<string, RowWithId>> {
  db: SheetsDB<Tables>
  sync: SyncEngine
  /** Access adapters directly (for testing/advanced use) */
  adapters: { [K in keyof Tables & string]: LocalAdapter<Tables[K]> }
}

/** Create a local-first client DB (async init for IndexedDB hydration) */
export async function createClientDB<Tables extends Record<string, RowWithId>>(
  options: CreateClientDBOptions<Tables>
): Promise<ClientDBResult<Tables>> {
  const { schema, transport, conflictStrategy, pushDebounceMs, mutationStorage, disableIDB } = options

  const syncEngine = new SyncEngine({
    transport,
    conflictStrategy,
    pushDebounceMs,
  } satisfies SyncEngineOptions)

  const stores: Record<string, DataStore<any>> = {}
  const adapters: Record<string, LocalAdapter<any>> = {}

  // Open shared IDB with all table stores in a single upgrade transaction
  const idbEnabled = !(disableIDB ?? false) && typeof indexedDB !== 'undefined'
  let sharedDb: IDBDatabase | undefined
  if (idbEnabled) {
    try {
      const allTableNames = Object.keys(schema.tables)
      sharedDb = await openSharedIDB(allTableNames)
    } catch {
      // IndexedDB unavailable - adapters will run in-memory only
    }
  }

  // Create LocalAdapter per table with shared IDB handle
  for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
    const adapterOpts: LocalAdapterOptions = {
      tableName,
      indexes: tableSchema.indexes,
      idMode: 'client',
      mutationStorage,
      disableIDB: disableIDB ?? false,
      initialData: options.initialData?.[tableName as keyof Tables] as any[],
      idbDb: sharedDb,
    }

    const adapter = new LocalAdapter(adapterOpts)
    await adapter.init()

    stores[tableName] = adapter
    adapters[tableName] = adapter

    // Register with SyncEngine
    syncEngine.registerTable(tableName, adapter, adapter.queue)
  }

  // Build SheetsDBConfig from schema
  const config: SheetsDBConfig = {
    tables: Object.fromEntries(
      Object.entries(schema.tables).map(([name, s]) => [
        name,
        { columns: [...s.columns], sheetName: s.sheetName },
      ])
    ),
  }

  const db = createSheetsDB<Tables>({
    config,
    stores: stores as { [K in keyof Tables]: DataStore<Tables[K]> },
  })

  return {
    db,
    sync: syncEngine,
    adapters: adapters as { [K in keyof Tables & string]: LocalAdapter<Tables[K]> },
  }
}
