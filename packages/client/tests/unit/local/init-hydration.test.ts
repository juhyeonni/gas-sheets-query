/**
 * LocalAdapter.init() hydration tests (#106).
 *
 * init() reads IndexedDB asynchronously, so anything already in memory —
 * constructor initialData, or a write that lands while the read is in flight —
 * is newer than the snapshot coming back. The fake below mirrors the one real
 * IDB semantic that matters here: a readonly transaction captures its rows at
 * open time, and its getAll() resolves only when the test releases it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Row {
  id: string
  value: number
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

function createFakeIDB(initialRows: Row[] = []) {
  const rows = new Map<string, Row>(initialRows.map(r => [r.id, r]))
  const pendingReads: Array<() => void> = []

  const db = {
    objectStoreNames: { contains: () => true },
    transaction(_store: string, mode: 'readonly' | 'readwrite' = 'readonly') {
      const tx: any = { error: null }

      if (mode === 'readonly') {
        const snapshot = [...rows.values()] // captured at open time, as IDB does
        tx.objectStore = () => ({
          getAll() {
            const request: any = { result: snapshot, error: null }
            pendingReads.push(() => request.onsuccess?.())
            return request
          },
        })
        return tx
      }

      tx.objectStore = () => ({
        clear: () => rows.clear(),
        put: (row: Row) => rows.set(row.id, row),
      })
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    },
    close: () => {},
  }

  return {
    db: db as unknown as IDBDatabase,
    rows,
    releaseRead: () => {
      for (const fire of pendingReads.splice(0)) fire()
    },
  }
}

function createAdapter(db: IDBDatabase, initialData?: Row[]) {
  return new LocalAdapter<Row>({
    tableName: 'Counter',
    idMode: 'client',
    mutationStorage: createMemoryStorage(),
    idbDb: db,
    initialData,
  })
}

describe('LocalAdapter.init() hydration [#106]', () => {
  beforeEach(() => {
    // Only presence is checked (`typeof indexedDB !== 'undefined'`); the
    // adapter uses the handle passed via idbDb.
    ;(globalThis as any).indexedDB = {}
  })

  afterEach(() => {
    delete (globalThis as any).indexedDB
  })

  it('keeps a write that lands while the IDB read is in flight', async () => {
    const { db, releaseRead } = createFakeIDB([{ id: 'c1', value: 1 }])
    const adapter = createAdapter(db)

    const initPromise = adapter.init()
    adapter.insert({ id: 'c2', value: 2 })
    releaseRead()
    await initPromise

    expect(adapter.findById('c2')).toBeDefined()
    expect(adapter.findById('c1')).toBeDefined()
  })

  it('does not resurrect a row deleted while the IDB read is in flight', async () => {
    const { db, releaseRead } = createFakeIDB([{ id: 'c1', value: 1 }])
    const adapter = createAdapter(db, [{ id: 'c1', value: 1 }])

    const initPromise = adapter.init()
    adapter.delete('c1')
    releaseRead()
    await initPromise

    expect(adapter.findById('c1')).toBeUndefined()
  })

  it('does not silently drop constructor initialData', async () => {
    const { db, releaseRead } = createFakeIDB([{ id: 'c1', value: 1 }])
    const adapter = createAdapter(db, [{ id: 'c2', value: 2 }])

    const initPromise = adapter.init()
    releaseRead()
    await initPromise

    expect(adapter.findById('c2')).toBeDefined()
    expect(adapter.findById('c1')).toBeDefined()
  })

  it('still hydrates straight from IDB on a cold start', async () => {
    const { db, releaseRead } = createFakeIDB([
      { id: 'c1', value: 1 },
      { id: 'c2', value: 2 },
    ])
    const adapter = createAdapter(db)

    const initPromise = adapter.init()
    releaseRead()
    await initPromise

    expect(adapter.findAll()).toHaveLength(2)
    // Hydration must not look like local mutations.
    expect(adapter.queue.hasPending).toBe(false)
  })
})
