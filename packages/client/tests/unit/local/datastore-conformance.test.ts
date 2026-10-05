/**
 * LocalAdapter against the shared DataStore conformance suite (#195).
 *
 * The same clauses run against MockAdapter and SheetsAdapter in core's
 * `datastore-conformance.test.ts`. IndexedDB is disabled: persistence is
 * LocalAdapter's own concern, not part of the DataStore contract.
 */
import { describe, it } from 'vitest'
import { runDataStoreConformance } from '@gsquery/core/testing'
import type { ConformanceRow, DataStoreFactory } from '@gsquery/core/testing'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

function memoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key),
  }
}

const createLocal: DataStoreFactory = ({ idMode, seed, indexes }) => ({
  store: new LocalAdapter<ConformanceRow>({
    tableName: 'Rows',
    initialData: seed,
    indexes,
    idMode,
    disableIDB: true,
    mutationStorage: memoryStorage(),
  }),
})

runDataStoreConformance({ name: 'LocalAdapter', create: createLocal, describe, it })
