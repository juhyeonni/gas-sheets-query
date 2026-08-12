/**
 * Namespace isolation + close() teardown tests (#gsquery-client-namespace).
 *
 * IndexedDB isn't available in the Node test environment (see other test
 * files, which all pass `disableIDB: true`). To verify `openSharedIDB` and
 * `createClientDB` request the correctly-composed database name, these tests
 * install a minimal fake `indexedDB` that always takes the "database not
 * found yet" branch (probe errors, fresh open succeeds) — enough to observe
 * which name/version each call site requests without emulating the full
 * IndexedDB upgrade state machine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openSharedIDB } from '../../../src/local/local-adapter.js'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface FakeIDBDatabase {
  version: number
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string) => void
  close: () => void
}

function installFakeIndexedDB() {
  const opens: Array<{ name: string; version?: number }> = []
  const closeSpies = new Map<string, ReturnType<typeof vi.fn>>()

  ;(globalThis as any).indexedDB = {
    open(name: string, version?: number) {
      opens.push({ name, version })
      const req: any = {}
      queueMicrotask(() => {
        if (version === undefined) {
          // Probe: pretend the database doesn't exist yet.
          req.onerror?.()
          return
        }
        const stores = new Set<string>()
        const closeSpy = closeSpies.get(name) ?? vi.fn()
        closeSpies.set(name, closeSpy)
        const db: FakeIDBDatabase = {
          version,
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string) => stores.add(n),
          close: closeSpy,
        }
        req.result = db
        req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }

  return { opens, closeSpies }
}

function uninstallFakeIndexedDB() {
  delete (globalThis as any).indexedDB
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

describe('openSharedIDB dbName', () => {
  afterEach(() => uninstallFakeIndexedDB())

  it('defaults to the rc2 database name "gsquery"', async () => {
    const { opens } = installFakeIndexedDB()
    await openSharedIDB(['Counter'])
    expect(opens.map(o => o.name)).toEqual(['gsquery', 'gsquery'])
  })

  it('uses the composed namespaced name when dbName is given', async () => {
    const { opens } = installFakeIndexedDB()
    await openSharedIDB(['Counter'], 'gsquery:team:t1')
    expect(opens.map(o => o.name)).toEqual(['gsquery:team:t1', 'gsquery:team:t1'])
  })

  it('creates the requested table stores plus _meta', async () => {
    installFakeIndexedDB()
    const db = (await openSharedIDB(['Counter', 'Issue'])) as unknown as FakeIDBDatabase
    expect(db.objectStoreNames.contains('Counter')).toBe(true)
    expect(db.objectStoreNames.contains('Issue')).toBe(true)
    expect(db.objectStoreNames.contains('_meta')).toBe(true)
  })
})

interface Counter {
  id: string
  value: number
  updatedAt: string
}

type Tables = { Counter: Counter }

const schema = {
  tables: {
    Counter: { columns: ['id', 'value', 'updatedAt'] as const },
  },
}

describe('createClientDB namespace isolation', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })
  afterEach(() => uninstallFakeIndexedDB())

  it('opens the namespaced IDB database when namespace is set', async () => {
    const { opens } = installFakeIndexedDB()
    await createClientDB<Tables>({ schema, transport, namespace: 'team:t1' })
    expect(opens[0].name).toBe('gsquery:team:t1')
  })

  it('two namespaces have fully disjoint mutation queues on shared storage', async () => {
    const sharedStorage = createMemoryStorage()

    const a = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: sharedStorage,
      namespace: 'team:a',
    })
    const b = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: sharedStorage,
      namespace: 'team:b',
    })

    a.db.from('Counter').create({ id: 'c1', value: 1, updatedAt: '' })
    b.db.from('Counter').create({ id: 'c2', value: 2, updatedAt: '' })

    expect(a.adapters.Counter.queue.length).toBe(1)
    expect(b.adapters.Counter.queue.length).toBe(1)

    // B's clear() must never touch A's persisted queue.
    b.adapters.Counter.queue.clear()
    expect(b.adapters.Counter.queue.length).toBe(0)
    expect(a.adapters.Counter.queue.length).toBe(1)
  })

  it('omitting namespace produces the same mutation-queue key as rc2', async () => {
    const storage = createMemoryStorage()
    const { db } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: storage,
    })

    db.from('Counter').create({ id: 'c1', value: 1, updatedAt: '' })

    // Pre-namespace consumers relied on this exact key; a rename would silently
    // orphan every existing user's persisted offline queue.
    const anyStorage = storage as unknown as { getItem(key: string): string | null }
    expect(anyStorage.getItem('gsquery:Counter:mutations')).not.toBeNull()
  })
})

describe('ClientDBResult.close()', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })
  afterEach(() => uninstallFakeIndexedDB())

  it('cancels a pending debounced push so no transport call fires after resolution', async () => {
    const { close, db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
      pushDebounceMs: 20,
    })

    db.from('Counter').create({ id: 'c1', value: 1, updatedAt: '' })
    sync.schedulePush()

    await close()

    await new Promise(r => setTimeout(r, 50))
    expect(transport.pushHistory).toHaveLength(0)
  })

  it('is idempotent', async () => {
    const { close } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    await expect(close()).resolves.toBeUndefined()
    await expect(close()).resolves.toBeUndefined()
  })

  it('closes the shared IDB connection', async () => {
    const { closeSpies } = installFakeIndexedDB()
    const { close } = await createClientDB<Tables>({
      schema,
      transport,
      namespace: 'team:t1',
    })

    await close()

    expect(closeSpies.get('gsquery:team:t1')).toHaveBeenCalledTimes(1)
  })
})
