/**
 * createClientDB - Factory that assembles LocalAdapter + MutationQueue + SyncEngine
 * into a SheetsDB-compatible local-first client.
 */
import type { RowWithId, DataStore, SheetsDBConfig } from '@gsquery/core'
import { createSheetsDB } from '@gsquery/core'
import type { SheetsDB } from '@gsquery/core'
import { LocalAdapter, openSharedIDB, IDBUpgradeBlockedError } from './local-adapter.js'
import type { LocalAdapterOptions } from './local-adapter.js'
import { SyncEngine } from './sync-engine.js'
import type { SyncEngineOptions } from './sync-engine.js'
import type {
  SyncTransport,
  ConflictStrategy,
  PoisonedMutationAction,
  PoisonedMutationHandler,
} from './sync-transport.js'
import type { MutationStorage } from './mutation-queue.js'
import type { RuntimeSchema, CreateInputMap } from '@gsquery/core'
import { composeName } from './naming.js'
import { toSheetsDBConfig } from '../schema-config.js'

/**
 * Schema definition for createClientDB.
 *
 * Alias of the shared {@link RuntimeSchema} — the same shape a generated
 * client exports, so `createClientDB({ schema })` accepts a generated schema
 * and honors its `columnTypes` instead of silently discarding them (#135).
 */
export type ClientDBSchema = RuntimeSchema

export interface CreateClientDBOptions<Tables extends Record<string, RowWithId>> {
  schema: ClientDBSchema
  transport: SyncTransport
  conflictStrategy?: ConflictStrategy
  pushDebounceMs?: number
  /** Consecutive push failures per table before a batch is dead-lettered (default 5, 0 = never) */
  maxRetries?: number
  /** First backoff step for a failing table's background attempts (default 1000ms, 0 = none) */
  retryBaseDelayMs?: number
  /** Ceiling for the exponential backoff (default 60000ms) */
  maxRetryDelayMs?: number
  /**
   * Called when a table's batch has failed `maxRetries` times in a row, with
   * the mutations still unapplied. Return `'retain'`, `'discard'`, or the exact
   * ids to drop — see {@link PoisonedMutationAction}.
   */
  onPoisonedMutation?: PoisonedMutationHandler
  /**
   * Most mutations per `transport.push` call (default unlimited). A larger
   * queue is pushed in slices of this size, in order; must be a positive
   * integer.
   */
  maxBatchSize?: number
  /** Custom mutation storage (defaults to localStorage) */
  mutationStorage?: MutationStorage
  /** Disable IndexedDB (for testing in non-browser environments) */
  disableIDB?: boolean
  /** Pre-populated data per table (for testing) */
  initialData?: { [K in keyof Tables]?: Tables[K][] }
  /**
   * Caller-supplied partition key isolating this instance's IndexedDB
   * database and mutation-queue storage from other instances on the same
   * origin (e.g. one per team). Omitted = identical naming to rc2.
   */
  namespace?: string
}

export interface ClientDBResult<
  Tables extends Record<string, RowWithId>,
  CreateInputs extends CreateInputMap<Tables> = Record<never, never>
> {
  db: SheetsDB<Tables, CreateInputs>
  sync: SyncEngine
  /** Access adapters directly (for testing/advanced use) */
  adapters: { [K in keyof Tables & string]: LocalAdapter<Tables[K]> }
  /**
   * Tear down this instance: cancels SyncEngine auto-sync/debounce timers and
   * closes the shared IndexedDB connection. Idempotent — safe to call more
   * than once. Pending mutations are left persisted in storage rather than
   * flushed, so no transport call fires after this resolves.
   */
  close: () => Promise<void>
}

/** Create a local-first client DB (async init for IndexedDB hydration) */
export async function createClientDB<
  Tables extends Record<string, RowWithId>,
  CreateInputs extends CreateInputMap<Tables> = Record<never, never>
>(
  options: CreateClientDBOptions<Tables>
): Promise<ClientDBResult<Tables, CreateInputs>> {
  const {
    schema,
    transport,
    conflictStrategy,
    pushDebounceMs,
    maxRetries,
    retryBaseDelayMs,
    maxRetryDelayMs,
    onPoisonedMutation,
    maxBatchSize,
    mutationStorage,
    disableIDB,
    namespace,
  } = options

  const syncEngine = new SyncEngine({
    transport,
    conflictStrategy,
    pushDebounceMs,
    maxRetries,
    retryBaseDelayMs,
    maxRetryDelayMs,
    onPoisonedMutation,
    maxBatchSize,
  } satisfies SyncEngineOptions)

  // Keyed by runtime table name, so the per-table row type is erased to
  // RowWithId here and narrowed back to Tables[K] where the maps leave.
  const stores: Record<string, DataStore<RowWithId>> = {}
  const adapters: Record<string, LocalAdapter<RowWithId>> = {}

  // Open shared IDB with all table stores in a single upgrade transaction
  const idbEnabled = !(disableIDB ?? false) && typeof indexedDB !== 'undefined'
  let sharedDb: IDBDatabase | undefined
  if (idbEnabled) {
    try {
      const allTableNames = Object.keys(schema.tables)
      sharedDb = await openSharedIDB(allTableNames, composeName('gsquery', namespace))
    } catch (err) {
      // IndexedDB unavailable - adapters will run in-memory only
      if (err instanceof IDBUpgradeBlockedError) {
        // The blocked request stays queued, so a per-adapter open would queue
        // behind it and hang init again: skip IndexedDB for this session (#120).
        // Leaving sharedDb undefined already keeps every adapter memory-only.
        console.warn(`[gsquery] ${err.message}; continuing memory-only for this session`)
      }
    }
  }

  // Create LocalAdapter per table with shared IDB handle. Without one, the
  // adapters must not open connections of their own: close() only closes
  // sharedDb, so any other connection would leak and wedge later upgrades
  // (#139). The mutation queue keeps its own storage either way.
  // Each init() is one IndexedDB round trip, so they run concurrently (#237);
  // tables register with the engine only once every init() resolved, in schema
  // order, so no pull can land mid-init() and tables keep syncing in a stable
  // order.
  const created: Array<[string, LocalAdapter<RowWithId>]> = []
  for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
    const adapterOpts: LocalAdapterOptions = {
      tableName,
      indexes: tableSchema.indexes,
      columnTypes: tableSchema.columnTypes,
      idMode: 'client',
      mutationStorage,
      disableIDB: sharedDb === undefined,
      initialData: options.initialData?.[tableName as keyof Tables],
      idbDb: sharedDb,
      namespace,
    }

    created.push([tableName, new LocalAdapter(adapterOpts)])
  }

  await Promise.all(created.map(([, adapter]) => adapter.init()))

  for (const [tableName, adapter] of created) {
    stores[tableName] = adapter
    adapters[tableName] = adapter
    syncEngine.registerTable(tableName, adapter, adapter.queue)
  }

  // Build SheetsDBConfig from schema. Defaults and @updatedAt fields reach each
  // table's Repository through it, exactly as on the server path (#199).
  const config: SheetsDBConfig = toSheetsDBConfig(schema)

  const db = createSheetsDB<Tables, CreateInputs>({
    config,
    stores: stores as { [K in keyof Tables]: DataStore<Tables[K]> },
  })

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    syncEngine.dispose()
    // Let queued writes reach IDB before the connection goes away — closing
    // first makes their transaction throw, and the fire-and-forget catch in
    // schedulePersist() swallows it, losing the write silently (#105).
    await Promise.allSettled(Object.values(adapters).map(a => a.flush()))
    sharedDb?.close()
  }

  return {
    db,
    sync: syncEngine,
    // Each adapter was built for its own table (seeded from initialData[name]),
    // but TypeScript cannot tie a runtime key to its K, and LocalAdapter is
    // invariant in its row type, so the narrowing goes through unknown.
    adapters: adapters as unknown as { [K in keyof Tables & string]: LocalAdapter<Tables[K]> },
    close,
  }
}
