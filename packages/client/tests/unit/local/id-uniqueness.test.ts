/**
 * LocalAdapter-only obligations of client-mode id uniqueness (#154).
 *
 * The contract every adapter shares (a taken id throws DuplicateIdError, 7 and
 * '7' collide, a rejected batch writes nothing, ...) is a clause of the
 * conformance suite in `datastore-conformance.test.ts` (#195). LocalAdapter
 * adds obligations of its own: the error names the table, and a rejected
 * insert must not enqueue a mutation (it would be pushed to the server and
 * bounce into the dead-letter flow) or write to IndexedDB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import { DuplicateIdError } from '@gsquery/core'
import type { RowWithId } from '@gsquery/core'

interface Counter extends RowWithId {
  id: string | number
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

function createAdapter(seed: Counter[] = []): LocalAdapter<Counter> {
  return new LocalAdapter<Counter>({
    tableName: 'Counter',
    idMode: 'client',
    initialData: seed,
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
  })
}

describe('LocalAdapter client-mode id uniqueness [#154]', () => {
  it('carries the offending id, the table name and a stable error code', () => {
    const adapter = createAdapter([{ id: 'a', value: 1 }])

    try {
      adapter.insert({ id: 'a', value: 2 })
      expect.unreachable('insert should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateIdError)
      expect((error as DuplicateIdError).id).toBe('a')
      expect((error as DuplicateIdError).code).toBe('DUPLICATE_ID')
      expect((error as DuplicateIdError).tableName).toBe('Counter')
    }
  })

  // ── MutationQueue ───────────────────────────────────────────────────

  it('does not enqueue a mutation for a rejected insert', () => {
    const adapter = createAdapter([{ id: 'a', value: 1 }])
    const before = adapter.queue.length

    expect(() => adapter.insert({ id: 'a', value: 2 })).toThrow(DuplicateIdError)
    expect(adapter.queue.length).toBe(before)
  })

  it('does not enqueue any mutation for a rejected batch', () => {
    const adapter = createAdapter([{ id: 'a', value: 1 }])
    const before = adapter.queue.length

    expect(() =>
      adapter.batchInsert([
        { id: 'b', value: 2 },
        { id: 'a', value: 3 },
      ])
    ).toThrow(DuplicateIdError)
    expect(adapter.queue.length).toBe(before)
    expect(adapter.queue.getMerged()).toEqual([])
  })
})

// ── IndexedDB persistence ─────────────────────────────────────────────

/** Minimal IndexedDB stand-in that counts the readwrite transactions it serves. */
function installFakeIndexedDB(storeNames: string[]) {
  const rows = new Map<string, Map<string, unknown>>()
  for (const name of storeNames) rows.set(name, new Map())
  const stats = { readwriteTransactions: 0 }

  const db = {
    version: 1,
    objectStoreNames: { contains: (name: string) => rows.has(name) },
    createObjectStore: () => {},
    close: () => {},
    transaction(storeName: string, mode: 'readonly' | 'readwrite' = 'readonly') {
      const store = rows.get(storeName)!
      const tx: Record<string, unknown> = { error: null }

      if (mode === 'readonly') {
        const snapshot = [...store.values()]
        tx.objectStore = () => ({
          getAll: () => {
            const request: Record<string, unknown> = { result: snapshot, error: null }
            queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.())
            return request
          },
        })
        return tx
      }

      stats.readwriteTransactions++
      tx.objectStore = () => ({
        clear: () => store.clear(),
        put: (row: { id: string | number }) => store.set(String(row.id), row),
      })
      queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.())
      return tx
    },
  }

  ;(globalThis as Record<string, unknown>).indexedDB = {
    open() {
      const request: Record<string, unknown> = { result: db }
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.())
      return request
    },
  }

  return { rows, stats }
}

describe('LocalAdapter rejected insert leaves IndexedDB untouched [#154]', () => {
  let fake: ReturnType<typeof installFakeIndexedDB>

  beforeEach(() => {
    fake = installFakeIndexedDB(['Counter', '_meta'])
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).indexedDB
  })

  async function createPersistedAdapter(): Promise<LocalAdapter<Counter>> {
    const adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      mutationStorage: createMemoryStorage(),
    })
    await adapter.init()
    adapter.insert({ id: 'a', value: 1 })
    await adapter.flush()
    return adapter
  }

  it('schedules no persist when the id is a duplicate', async () => {
    const adapter = await createPersistedAdapter()
    const writesBefore = fake.stats.readwriteTransactions

    expect(() => adapter.insert({ id: 'a', value: 2 })).toThrow(DuplicateIdError)
    await adapter.flush()

    expect(fake.stats.readwriteTransactions).toBe(writesBefore)
    expect([...fake.rows.get('Counter')!.values()]).toEqual([{ id: 'a', value: 1 }])
  })

  it('schedules no persist when a batch is rejected', async () => {
    const adapter = await createPersistedAdapter()
    const writesBefore = fake.stats.readwriteTransactions

    expect(() =>
      adapter.batchInsert([
        { id: 'b', value: 2 },
        { id: 'a', value: 3 },
      ])
    ).toThrow(DuplicateIdError)
    await adapter.flush()

    expect(fake.stats.readwriteTransactions).toBe(writesBefore)
    expect([...fake.rows.get('Counter')!.values()]).toEqual([{ id: 'a', value: 1 }])
  })
})
