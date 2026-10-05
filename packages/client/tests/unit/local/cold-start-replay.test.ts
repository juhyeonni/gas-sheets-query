/**
 * LocalAdapter.init() cold-start queue replay (#139).
 *
 * The IndexedDB snapshot is write-behind, so after a reload it can lag behind
 * the mutation queue, which is written synchronously. init() therefore
 * rebuilds the view from the snapshot plus the queue's net mutations:
 * - a queued insert sets the whole row,
 * - a queued update merges into an existing row (skipped when absent),
 * - a queued delete removes the row.
 *
 * A previous session is simulated by enqueuing through a MutationQueue that
 * shares the new adapter's storage, while the fake IndexedDB holds a snapshot
 * that never saw those writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ColumnType, RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { MutationQueue } from '../../../src/local/mutation-queue.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Row {
  id: string
  value: number
  label?: string
}

interface Event {
  id: string
  title: string
  startsAt: Date
}

type StoredRow = { id: string | number }

interface FakeRequest {
  result?: unknown
  error?: Error | null
  onsuccess?: () => void
  onerror?: () => void
}

const QUEUE_KEY = 'gsquery:Counter:mutations'

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

/**
 * A single-store IndexedDB handle. Readonly transactions capture their rows at
 * open time, as IndexedDB does; getAll() resolves when the test releases it,
 * or on the next microtask when `autoRelease` is set.
 */
function createFakeIDB<R extends StoredRow>(initialRows: R[], autoRelease = true) {
  const rows = new Map<string | number, R>(initialRows.map(r => [r.id, r]))
  const pendingReads: Array<() => void> = []

  const db = {
    objectStoreNames: { contains: () => true },
    transaction(_store: string, mode: 'readonly' | 'readwrite' = 'readonly') {
      const tx: { error: Error | null; oncomplete?: () => void; objectStore: () => unknown } = {
        error: null,
        objectStore: () => undefined,
      }

      if (mode === 'readonly') {
        const snapshot = [...rows.values()]
        tx.objectStore = () => ({
          getAll() {
            const request: FakeRequest = { result: snapshot, error: null }
            const fire = () => request.onsuccess?.()
            if (autoRelease) queueMicrotask(fire)
            else pendingReads.push(fire)
            return request
          },
        })
        return tx
      }

      tx.objectStore = () => ({
        clear: () => rows.clear(),
        put: (row: R) => rows.set(row.id, row),
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

function previousSession<T extends RowWithId>(storage: MutationStorage, tableName = 'Counter') {
  return new MutationQueue<T>({ tableName, storage })
}

function createAdapter(
  db: IDBDatabase,
  storage: MutationStorage,
  initialData?: Row[]
): LocalAdapter<Row> {
  return new LocalAdapter<Row>({
    tableName: 'Counter',
    idMode: 'client',
    mutationStorage: storage,
    idbDb: db,
    initialData,
  })
}

describe('LocalAdapter.init() replays the persisted queue [#139]', () => {
  let storage: MutationStorage

  beforeEach(() => {
    // Only presence is checked; the adapter uses the handle passed via idbDb.
    ;(globalThis as { indexedDB?: unknown }).indexedDB = {}
    storage = createMemoryStorage()
  })

  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
  })

  it('applies a queued update over the snapshot row', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1, label: 'a' }])
    previousSession<Row>(storage).push('update', 'c1', { value: 5 })

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findById('c1')).toEqual({ id: 'c1', value: 5, label: 'a' })
  })

  it('adds a queued insert the snapshot lacks', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1 }])
    previousSession<Row>(storage).push('insert', 'c2', undefined, { id: 'c2', value: 2 })

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findById('c1')).toEqual({ id: 'c1', value: 1 })
    expect(adapter.findById('c2')).toEqual({ id: 'c2', value: 2 })
  })

  it('adds a queued insert when the snapshot is empty', async () => {
    const { db } = createFakeIDB<Row>([])
    previousSession<Row>(storage).push('insert', 'c2', undefined, { id: 'c2', value: 2 })

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findAll()).toEqual([{ id: 'c2', value: 2 }])
  })

  it('a queued insert replaces the snapshot row as a whole', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1, label: 'stale' }])
    const queue = previousSession<Row>(storage)
    queue.push('delete', 'c1')
    queue.push('insert', 'c1', undefined, { id: 'c1', value: 9 })

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findById('c1')).toEqual({ id: 'c1', value: 9 })
  })

  it('removes a snapshot row whose delete is queued', async () => {
    const { db } = createFakeIDB<Row>([
      { id: 'c1', value: 1 },
      { id: 'c2', value: 2 },
    ])
    previousSession<Row>(storage).push('delete', 'c1')

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findById('c1')).toBeUndefined()
    expect(adapter.findAll()).toEqual([{ id: 'c2', value: 2 }])
  })

  it('skips a queued update to a row the snapshot lacks', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1 }])
    previousSession<Row>(storage).push('update', 'ghost', { value: 7 })

    const adapter = createAdapter(db, storage)
    await adapter.init()

    expect(adapter.findById('ghost')).toBeUndefined()
    expect(adapter.findAll()).toEqual([{ id: 'c1', value: 1 }])
  })

  it('keeps the queue untouched and does not fire the mutation listener', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1 }])
    const queue = previousSession<Row>(storage)
    queue.push('update', 'c1', { value: 5 })
    queue.push('insert', 'c2', undefined, { id: 'c2', value: 2 })
    const persistedBefore = storage.getItem(QUEUE_KEY)

    const adapter = createAdapter(db, storage)
    const listener = vi.fn()
    adapter.onLocalMutation(listener)
    const mergedBefore = adapter.queue.getMerged()
    await adapter.init()

    expect(storage.getItem(QUEUE_KEY)).toBe(persistedBefore)
    expect(adapter.queue.length).toBe(2)
    expect(adapter.queue.getMerged()).toEqual(mergedBefore)
    expect(listener).not.toHaveBeenCalled()
  })

  it('persists the rebuilt view back to IndexedDB', async () => {
    const { db, rows } = createFakeIDB<Row>([
      { id: 'c1', value: 1 },
      { id: 'c3', value: 3 },
    ])
    const queue = previousSession<Row>(storage)
    queue.push('update', 'c1', { value: 5 })
    queue.push('insert', 'c2', undefined, { id: 'c2', value: 2 })
    queue.push('delete', 'c3')

    const adapter = createAdapter(db, storage)
    await adapter.init()
    await adapter.flush()

    expect([...rows.values()]).toEqual(adapter.findAll())
    expect(new Map(rows)).toEqual(
      new Map([
        ['c1', { id: 'c1', value: 5 }],
        ['c2', { id: 'c2', value: 2 }],
      ])
    )
  })

  it('keeps constructor initialData over a queued update', async () => {
    const { db } = createFakeIDB<Row>([{ id: 'c1', value: 1 }])
    previousSession<Row>(storage).push('update', 'c1', { value: 5 })

    const adapter = createAdapter(db, storage, [{ id: 'c1', value: 42 }])
    await adapter.init()

    expect(adapter.findById('c1')).toEqual({ id: 'c1', value: 42 })
  })

  it('keeps a write made during the read on top of the replayed view', async () => {
    const { db, releaseRead } = createFakeIDB<Row>([{ id: 'c1', value: 1 }], false)
    previousSession<Row>(storage).push('update', 'c1', { value: 5 })

    const adapter = createAdapter(db, storage)
    const initPromise = adapter.init()
    adapter.insert({ id: 'c2', value: 2 })
    releaseRead()
    await initPromise

    expect(adapter.findById('c1')).toEqual({ id: 'c1', value: 5 })
    expect(adapter.findById('c2')).toEqual({ id: 'c2', value: 2 })
  })

  it('does not resurrect a row deleted during the read', async () => {
    const { db, releaseRead } = createFakeIDB<Row>([{ id: 'c1', value: 1 }], false)
    previousSession<Row>(storage).push('update', 'c1', { value: 5 })

    const adapter = createAdapter(db, storage, [{ id: 'c1', value: 1 }])
    const initPromise = adapter.init()
    adapter.delete('c1')
    releaseRead()
    await initPromise

    expect(adapter.findById('c1')).toBeUndefined()
  })
})

describe('LocalAdapter.init() replay column conversion [#139]', () => {
  const columnTypes: Record<string, ColumnType> = { startsAt: 'date' }
  let storage: MutationStorage

  beforeEach(() => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = {}
    storage = createMemoryStorage()
  })

  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
  })

  function createEventAdapter(db: IDBDatabase): LocalAdapter<Event> {
    return new LocalAdapter<Event>({
      tableName: 'Event',
      idMode: 'client',
      mutationStorage: storage,
      idbDb: db,
      columnTypes,
    })
  }

  it('reads a replayed inserted datetime as a Date', async () => {
    const { db } = createFakeIDB<Event>([])
    const startsAt = new Date('2024-03-01T10:00:00.000Z')
    // The queue round-trips through JSON, so the Date is stored as ISO text.
    previousSession<Event>(storage, 'Event').push('insert', 'e1', undefined, {
      id: 'e1',
      title: 'Launch',
      startsAt,
    })

    const adapter = createEventAdapter(db)
    await adapter.init()

    const event = adapter.findById('e1')
    expect(event?.startsAt).toBeInstanceOf(Date)
    expect(event?.startsAt.toISOString()).toBe(startsAt.toISOString())
  })

  it('reads a replayed updated datetime as a Date', async () => {
    const { db } = createFakeIDB<Event>([
      { id: 'e1', title: 'Launch', startsAt: new Date('2024-03-01T10:00:00.000Z') },
    ])
    const moved = new Date('2024-04-02T12:30:00.000Z')
    previousSession<Event>(storage, 'Event').push('update', 'e1', { startsAt: moved })

    const adapter = createEventAdapter(db)
    await adapter.init()

    const event = adapter.findById('e1')
    expect(event?.startsAt).toBeInstanceOf(Date)
    expect(event?.startsAt.toISOString()).toBe(moved.toISOString())
    expect(event?.title).toBe('Launch')
  })
})
