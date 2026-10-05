/**
 * A blocked IndexedDB upgrade must not hang the client (#120).
 *
 * `openSharedIDB` bumps the database version when a table's store is missing.
 * IndexedDB blocks that upgrade while any other connection to the database is
 * still open and fires `blocked` instead of `success`/`error`, so without a
 * handler the open promise never settled and `createClientDB` hung silently.
 *
 * The hand-written IDB fakes used elsewhere cannot model `blocked` or
 * `versionchange`, so these tests run against `fake-indexeddb`, which follows
 * the spec's connection queue. Each test gets a fresh factory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { openSharedIDB, LocalAdapter } from '../../../src/local/local-adapter.js'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type { RowWithId } from '@gsquery/core'

interface Counter extends RowWithId {
  id: string
  value: number
}

interface Note extends RowWithId {
  id: string
  text: string
}

type Tables = {
  Counter: Counter
  Note: Note
}

const DB_NAME = 'gsquery'

type GlobalWithIDB = { indexedDB?: IDBFactory }

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

/** Open a raw connection that, like code without this fix, never yields on versionchange. */
function openRaw(
  version?: number,
  createStores: string[] = [],
  onblocked?: () => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      for (const name of createStores) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    if (onblocked) req.onblocked = onblocked
  })
}

function readAll(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Race a promise against a timeout so a regression fails instead of hanging. */
function settleWithin<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms)
    ),
  ])
}

function isClosed(db: IDBDatabase): boolean {
  try {
    db.transaction(db.objectStoreNames[0], 'readonly')
    return false
  } catch {
    return true
  }
}

let warn: MockInstance<(...args: unknown[]) => void>

beforeEach(() => {
  ;(globalThis as GlobalWithIDB).indexedDB = new FakeIDBFactory()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  delete (globalThis as GlobalWithIDB).indexedDB
})

describe('openSharedIDB with a blocked upgrade [#120]', () => {
  it('AC1: rejects instead of staying pending, naming the database', async () => {
    const blocker = await openRaw(1, ['Counter', '_meta'])

    const result = settleWithin(openSharedIDB(['Counter', 'Note'], DB_NAME))

    await expect(result).rejects.toThrow(/"gsquery"/)
    await expect(result).rejects.toThrow(/blocked/)
    blocker.close()
  })

  it('AC3: closes the late upgrade connection so it does not block the next upgrade', async () => {
    const blocker = await openRaw(1, ['Counter', '_meta'])
    await expect(settleWithin(openSharedIDB(['Counter', 'Note'], DB_NAME))).rejects.toThrow()

    // The blocked request was not cancelled: it completes once the blocker goes.
    blocker.close()

    // A versionless open queues behind the pending upgrade, so once it
    // succeeds the late upgrade has run (version 2, Note store created).
    const after = await settleWithin(openRaw())
    expect(after.version).toBe(2)
    expect(after.objectStoreNames.contains('Note')).toBe(true)
    after.close()

    // The late connection must not still be open, or this upgrade is blocked.
    const next = await settleWithin(openSharedIDB(['Counter', 'Note', 'Tag'], DB_NAME))
    expect(next.version).toBe(3)
    expect(next.objectStoreNames.contains('Tag')).toBe(true)
    next.close()
  })
})

describe('connections from openSharedIDB yield on versionchange [#120]', () => {
  it('AC4: closes so another connection can upgrade without blocked', async () => {
    const shared = await openSharedIDB(['Counter'], DB_NAME)
    const onblocked = vi.fn()

    const upgraded = await settleWithin(openRaw(shared.version + 1, ['Other'], onblocked))

    expect(onblocked).not.toHaveBeenCalled()
    expect(isClosed(shared)).toBe(true)
    upgraded.close()
  })

  it('AC5: a LocalAdapter keeps working in memory and warns once after its connection closed', async () => {
    const adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      mutationStorage: createMemoryStorage(),
    })
    await adapter.init()
    adapter.insert({ id: 'c1', value: 1 })
    await adapter.flush()

    // Another tab upgrades the database.
    const other = await settleWithin(openRaw(99, ['Other']))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/version ?change/i)
    expect(String(warn.mock.calls[0][0])).toContain(`"${DB_NAME}"`)

    adapter.insert({ id: 'c2', value: 2 })
    adapter.update('c1', { value: 10 })
    await expect(adapter.flush()).resolves.toBeUndefined()

    expect(adapter.findById('c1')?.value).toBe(10)
    expect(adapter.findAll().map(r => r.id)).toEqual(['c1', 'c2'])
    expect(adapter.queue.length).toBeGreaterThan(0)

    // Only the write made before the close reached IndexedDB.
    expect(await readAll(other, 'Counter')).toEqual([{ id: 'c1', value: 1 }])
    expect(warn).toHaveBeenCalledTimes(1)
    other.close()
  })

  it('AC5: every adapter sharing a createClientDB connection goes memory-only, with one warning', async () => {
    const { db, adapters, close } = await settleWithin(
      createClientDB<Tables>({
        schema: {
          tables: {
            Counter: { columns: ['id', 'value'] },
            Note: { columns: ['id', 'text'] },
          },
        },
        transport: new MockTransport(),
        mutationStorage: createMemoryStorage(),
      })
    )

    const other = await settleWithin(openRaw(99, ['Other']))
    expect(warn).toHaveBeenCalledTimes(1)

    db.from('Counter').create({ id: 'c1', value: 1 })
    db.from('Note').create({ id: 'n1', text: 'hi' })
    await expect(adapters.Counter.flush()).resolves.toBeUndefined()
    await expect(adapters.Note.flush()).resolves.toBeUndefined()

    expect(db.from('Counter').findAll()).toEqual([{ id: 'c1', value: 1 }])
    expect(db.from('Note').findAll()).toEqual([{ id: 'n1', text: 'hi' }])
    expect(await readAll(other, 'Counter')).toEqual([])

    await expect(close()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    other.close()
  })
})

describe('createClientDB with a blocked upgrade [#120]', () => {
  it('AC2: resolves, works in memory, and warns once about the blocked upgrade', async () => {
    const blocker = await openRaw(1, ['Counter', '_meta'])

    const { db, adapters, close } = await settleWithin(
      createClientDB<Tables>({
        schema: {
          tables: {
            Counter: { columns: ['id', 'value'] },
            Note: { columns: ['id', 'text'] },
          },
        },
        transport: new MockTransport(),
        mutationStorage: createMemoryStorage(),
      })
    )

    db.from('Counter').create({ id: 'c1', value: 1 })
    db.from('Note').create({ id: 'n1', text: 'hi' })
    await expect(adapters.Counter.flush()).resolves.toBeUndefined()
    await expect(adapters.Note.flush()).resolves.toBeUndefined()
    expect(db.from('Counter').findAll()).toEqual([{ id: 'c1', value: 1 }])
    expect(db.from('Note').findById('n1')).toEqual({ id: 'n1', text: 'hi' })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/blocked/)
    expect(String(warn.mock.calls[0][0])).toContain(`"${DB_NAME}"`)

    await close()
    blocker.close()
  })

  it('a standalone LocalAdapter init also falls back to memory-only with one warning', async () => {
    const blocker = await openRaw(1, ['_meta'])
    const adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      mutationStorage: createMemoryStorage(),
    })

    await settleWithin(adapter.init())
    adapter.insert({ id: 'c1', value: 1 })
    await expect(adapter.flush()).resolves.toBeUndefined()

    expect(adapter.findAll()).toEqual([{ id: 'c1', value: 1 }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/blocked/)
    blocker.close()
  })
})

describe('openSharedIDB unchanged paths [#120]', () => {
  it('AC6: first run creates every store on one returned connection', async () => {
    const open = vi.spyOn(indexedDB, 'open')

    const db = await settleWithin(openSharedIDB(['Counter', 'Note'], DB_NAME))

    expect(db.objectStoreNames.contains('Counter')).toBe(true)
    expect(db.objectStoreNames.contains('Note')).toBe(true)
    expect(db.objectStoreNames.contains('_meta')).toBe(true)
    // Probe, then one upgrade; the probe connection is closed, not leaked.
    expect(open).toHaveBeenCalledTimes(2)
    expect(isClosed(db)).toBe(false)
    db.close()
  })

  it('AC6: steady state reuses the probe connection without an upgrade', async () => {
    const first = await openSharedIDB(['Counter', 'Note'], DB_NAME)
    const version = first.version
    first.close()

    const open = vi.spyOn(indexedDB, 'open')
    const db = await settleWithin(openSharedIDB(['Counter', 'Note'], DB_NAME))

    expect(open).toHaveBeenCalledTimes(1)
    expect(db.version).toBe(version)
    expect(db.objectStoreNames.contains('Counter')).toBe(true)
    expect(db.objectStoreNames.contains('_meta')).toBe(true)
    db.close()
  })

  it('AC6: steady state hands out a working connection that persists adapter writes', async () => {
    const seed = await openSharedIDB(['Counter'], DB_NAME)
    seed.close()

    const adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      mutationStorage: createMemoryStorage(),
    })
    await adapter.init()
    adapter.insert({ id: 'c1', value: 1 })
    await adapter.flush()

    const reader = await openSharedIDB(['Counter'], DB_NAME)
    expect(await readAll(reader, 'Counter')).toEqual([{ id: 'c1', value: 1 }])
    expect(warn).not.toHaveBeenCalled()
    reader.close()
  })
})
