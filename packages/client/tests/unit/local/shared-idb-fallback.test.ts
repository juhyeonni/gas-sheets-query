/**
 * createClientDB shared IndexedDB connection ownership (#139).
 *
 * createClientDB opens one shared connection and hands it to every table
 * adapter; close() closes exactly that one. When the shared open fails, no
 * adapter may open a connection of its own: such connections are untracked,
 * so close() could never close them and they would wedge later upgrades.
 *
 * The fake below models just enough of indexedDB.open to count connection
 * requests and observe close(): every open either fails (`fail: true`) or
 * succeeds against an in-memory database whose stores support the getAll /
 * clear / put calls LocalAdapter makes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { openSharedIDB } from '../../../src/local/local-adapter.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Counter {
  id: string
  value: number
}

interface Note {
  id: string
  text: string
}

type Tables = { Counter: Counter; Note: Note }

const schema = {
  tables: {
    Counter: { columns: ['id', 'value'] as const },
    Note: { columns: ['id', 'text'] as const },
  },
}

type StoredRow = { id: string | number }

interface FakeRequest {
  result?: unknown
  error?: Error
  onsuccess?: () => void
  onerror?: () => void
  onupgradeneeded?: () => void
}

function installFakeIndexedDB(options: { fail: boolean }) {
  const opens: Array<{ name: string; version?: number }> = []
  const closeSpies: Array<ReturnType<typeof vi.fn>> = []
  const stores = new Map<string, Map<string | number, StoredRow>>()
  let version = 0

  function connect() {
    const close = vi.fn()
    closeSpies.push(close)
    return {
      get version() {
        return version
      },
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => {
        stores.set(name, new Map())
      },
      transaction(storeName: string, mode: 'readonly' | 'readwrite' = 'readonly') {
        const rows = stores.get(storeName) ?? new Map<string | number, StoredRow>()
        const tx: { error: Error | null; oncomplete?: () => void; objectStore: () => unknown } = {
          error: null,
          objectStore: () => ({
            getAll() {
              const request: FakeRequest = { result: [...rows.values()] }
              queueMicrotask(() => request.onsuccess?.())
              return request
            },
            clear: () => rows.clear(),
            put: (row: StoredRow) => rows.set(row.id, row),
          }),
        }
        if (mode === 'readwrite') queueMicrotask(() => tx.oncomplete?.())
        return tx
      },
      close,
    }
  }

  ;(globalThis as { indexedDB?: unknown }).indexedDB = {
    open(name: string, requested?: number) {
      opens.push({ name, version: requested })
      const request: FakeRequest = {}
      queueMicrotask(() => {
        if (options.fail) {
          request.error = new Error('IndexedDB unavailable')
          request.onerror?.()
          return
        }
        const target = requested ?? Math.max(version, 1)
        request.result = connect()
        if (target > version) {
          version = target
          request.onupgradeneeded?.()
        }
        request.onsuccess?.()
      })
      return request
    },
  }

  return { opens, closeSpies, stores }
}

function uninstallFakeIndexedDB() {
  delete (globalThis as { indexedDB?: unknown }).indexedDB
}

function createMemoryStorage(): MutationStorage & { dump(): Map<string, string> } {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    dump: () => store,
  }
}

/** How many indexedDB.open calls one openSharedIDB() makes in this situation. */
async function sharedOpenCost(fail: boolean): Promise<number> {
  const { opens } = installFakeIndexedDB({ fail })
  await openSharedIDB(Object.keys(schema.tables)).catch(() => {})
  uninstallFakeIndexedDB()
  return opens.length
}

describe('createClientDB when the shared IndexedDB open fails [#139]', () => {
  afterEach(() => uninstallFakeIndexedDB())

  it('resolves without any table adapter opening its own connection', async () => {
    const baseline = await sharedOpenCost(true)
    const { opens } = installFakeIndexedDB({ fail: true })

    await expect(
      createClientDB<Tables>({
        schema,
        transport: new MockTransport(),
        mutationStorage: createMemoryStorage(),
      })
    ).resolves.toBeDefined()

    // Only the shared open itself touched indexedDB.open.
    expect(opens).toHaveLength(baseline)
  })

  it('runs every table in memory', async () => {
    installFakeIndexedDB({ fail: true })
    const { db, adapters } = await createClientDB<Tables>({
      schema,
      transport: new MockTransport(),
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').create({ id: 'c1', value: 1 })
    db.from('Note').create({ id: 'n1', text: 'hello' })
    db.from('Counter').update('c1', { value: 2 })

    expect(db.from('Counter').findById('c1')).toEqual({ id: 'c1', value: 2 })
    expect(db.from('Note').findById('n1')).toEqual({ id: 'n1', text: 'hello' })
    await expect(adapters.Counter.flush()).resolves.toBeUndefined()
    await expect(adapters.Note.flush()).resolves.toBeUndefined()
  })

  it('close() resolves and earlier writes stay in the mutation queue storage', async () => {
    installFakeIndexedDB({ fail: true })
    const storage = createMemoryStorage()
    const { db, close } = await createClientDB<Tables>({
      schema,
      transport: new MockTransport(),
      mutationStorage: storage,
    })

    db.from('Counter').create({ id: 'c1', value: 1 })
    db.from('Note').create({ id: 'n1', text: 'hello' })

    await expect(close()).resolves.toBeUndefined()

    const counterQueue = storage.getItem('gsquery:Counter:mutations')
    const noteQueue = storage.getItem('gsquery:Note:mutations')
    expect(counterQueue).not.toBeNull()
    expect(noteQueue).not.toBeNull()
    expect(JSON.parse(counterQueue ?? '[]')).toEqual([
      expect.objectContaining({ type: 'insert', id: 'c1', row: { id: 'c1', value: 1 } }),
    ])
    expect(JSON.parse(noteQueue ?? '[]')).toEqual([
      expect.objectContaining({ type: 'insert', id: 'n1', row: { id: 'n1', text: 'hello' } }),
    ])
  })
})

describe('createClientDB when the shared IndexedDB open succeeds [#139]', () => {
  afterEach(() => uninstallFakeIndexedDB())

  it('adapters open no connection of their own, and close() closes the shared one', async () => {
    const baseline = await sharedOpenCost(false)
    const { opens, closeSpies } = installFakeIndexedDB({ fail: false })

    const { db, adapters, close } = await createClientDB<Tables>({
      schema,
      transport: new MockTransport(),
      mutationStorage: createMemoryStorage(),
    })

    expect(opens).toHaveLength(baseline)

    db.from('Counter').create({ id: 'c1', value: 1 })
    await adapters.Counter.flush()

    await close()

    // Every connection ever opened is closed exactly once: the probe that
    // openSharedIDB discards, and the shared connection close() owns.
    expect(closeSpies.length).toBeGreaterThan(0)
    for (const spy of closeSpies) expect(spy).toHaveBeenCalledTimes(1)
  })
})
