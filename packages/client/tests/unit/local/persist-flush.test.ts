/**
 * close() must let queued IndexedDB writes land before dropping the connection
 * (#105).
 *
 * The persist is debounced onto a microtask and its promise was never held, so
 * a close() in the same tick as a mutation closed the connection first, the
 * queued transaction threw InvalidStateError, and the fire-and-forget catch
 * swallowed it — the write vanished and close() still resolved successfully.
 *
 * The fake models the two real semantics that matter: transaction() throws once
 * close() has been called, and a readwrite transaction applies its queued
 * operations before firing oncomplete.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type { RowWithId } from '@gsquery/core'

interface Counter extends RowWithId {
  id: string
  value: number
}

interface Tables {
  Counter: Counter
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

function installFakeIndexedDB(storeNames: string[]) {
  const rows = new Map<string, Map<string, unknown>>()
  for (const name of storeNames) rows.set(name, new Map())
  let isClosed = false

  const db = {
    version: 1,
    objectStoreNames: { contains: (name: string) => rows.has(name) },
    createObjectStore: () => {},
    close: () => {
      isClosed = true
    },
    transaction(storeName: string, mode: 'readonly' | 'readwrite' = 'readonly') {
      if (isClosed) {
        throw new DOMException?.('closed', 'InvalidStateError') ?? new Error('InvalidStateError')
      }
      const store = rows.get(storeName)!
      const tx: any = { error: null }

      if (mode === 'readonly') {
        const snapshot = [...store.values()]
        tx.objectStore = () => ({
          getAll: () => {
            const request: any = { result: snapshot, error: null }
            queueMicrotask(() => request.onsuccess?.())
            return request
          },
        })
        return tx
      }

      tx.objectStore = () => ({
        clear: () => store.clear(),
        put: (row: any) => store.set(String(row.id), row),
      })
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    },
  }

  ;(globalThis as any).indexedDB = {
    open(_name: string, _version?: number) {
      const request: any = { result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }

  return { rows, isClosedNow: () => isClosed }
}

describe('close() flushes pending IndexedDB writes [#105]', () => {
  let fake: ReturnType<typeof installFakeIndexedDB>

  beforeEach(() => {
    fake = installFakeIndexedDB(['Counter', '_meta'])
  })

  afterEach(() => {
    delete (globalThis as any).indexedDB
  })

  async function openDb() {
    return createClientDB<Tables>({
      schema: { tables: { Counter: { columns: ['id', 'value'] } } },
      transport: new MockTransport(),
      mutationStorage: createMemoryStorage(),
    })
  }

  it('persists a write made in the same tick as close()', async () => {
    const { db, close } = await openDb()

    db.from('Counter').create({ id: 'c1', value: 1 })
    await close()

    expect([...fake.rows.get('Counter')!.values()]).toHaveLength(1)
  })

  it('persists a write made one tick before close()', async () => {
    const { db, close } = await openDb()

    db.from('Counter').create({ id: 'c1', value: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    await close()

    expect([...fake.rows.get('Counter')!.values()]).toHaveLength(1)
  })

  it('keeps overlapping persists in order', async () => {
    const { db, close } = await openDb()

    for (let i = 1; i <= 5; i++) {
      db.from('Counter').create({ id: `c${i}`, value: i })
      await Promise.resolve()
    }
    await close()

    expect([...fake.rows.get('Counter')!.keys()].sort()).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
    ])
  })

  it('still closes the shared connection', async () => {
    const { close } = await openDb()
    await close()
    expect(fake.isClosedNow()).toBe(true)
  })
})
