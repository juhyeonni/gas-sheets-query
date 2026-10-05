/**
 * Sync cost tests (#237).
 *
 * - Conflict resolution writes the table back once per push, not once per
 *   conflict (D1).
 * - A pull whose rows equal the local rows leaves the rows, the index and
 *   IndexedDB untouched (D2).
 * - Auto-sync ticks are skipped while the tab is hidden or offline (D3).
 * - `maxBatchSize` pushes a large queue in bounded slices (D4, D5).
 * - `createClientDB` initializes adapters concurrently (D6).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RowWithId, ColumnType } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import type { SyncEngineOptions } from '../../../src/local/sync-engine.js'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type {
  SyncEvent,
  SyncTransport,
  MergedMutation,
  SyncPushResult,
} from '../../../src/local/sync-transport.js'

interface Todo extends RowWithId {
  id: string
  title: string
  done: boolean
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

function createSetup(
  options: Omit<SyncEngineOptions, 'transport'> = {},
  transport: SyncTransport = new MockTransport()
) {
  const adapter = new LocalAdapter<Todo>({
    tableName: 'Todo',
    idMode: 'client',
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
  })
  const sync = new SyncEngine({ transport, ...options })
  sync.registerTable('Todo', adapter, adapter.queue)
  const events: SyncEvent[] = []
  sync.on(e => events.push(e))
  return { adapter, sync, events }
}

function todo(id: string, title = id, done = false): Todo {
  return { id, title, done }
}

// ── D1: one table write per push ─────────────────────────────────────

describe('conflict resolution writes the table once per push [#237]', () => {
  it('server-wins: several conflicts cause exactly one replaceAll, deleted row appended (AC1)', async () => {
    const transport = new MockTransport()
    const { adapter, sync } = createSetup({}, transport)
    adapter.replaceAll([todo('t1'), todo('t2'), todo('t3'), todo('t4'), todo('t5')])

    adapter.update('t1', { title: 'local 1' })
    adapter.update('t2', { title: 'local 2' })
    adapter.delete('t4')

    transport.conflictGenerator = <T extends RowWithId>(
      _table: string,
      mutations: MergedMutation<T>[]
    ) =>
      mutations.map(m => ({
        id: m.id,
        clientMutation: m,
        serverRow: { id: m.id, title: `server ${String(m.id)}`, done: true } as unknown as T,
      }))

    const replaceAll = vi.spyOn(adapter, 'replaceAll')
    await sync.push()

    expect(replaceAll).toHaveBeenCalledTimes(1)
    expect(adapter.findAll()).toEqual([
      { id: 't1', title: 'server t1', done: true },
      { id: 't2', title: 'server t2', done: true },
      todo('t3'),
      todo('t5'),
      { id: 't4', title: 'server t4', done: true },
    ])
    expect(adapter.findById('t4')).toEqual({ id: 't4', title: 'server t4', done: true })
  })

  it('a repeated conflict id keeps the last resolution', async () => {
    const transport = new MockTransport()
    const { adapter, sync } = createSetup({}, transport)
    adapter.replaceAll([todo('t1'), todo('t2')])
    adapter.update('t1', { title: 'local' })

    transport.conflictGenerator = <T extends RowWithId>(
      _table: string,
      mutations: MergedMutation<T>[]
    ) => [
      {
        id: 't1',
        clientMutation: mutations[0],
        serverRow: { id: 't1', title: 'first', done: false } as unknown as T,
      },
      {
        id: 't1',
        clientMutation: mutations[0],
        serverRow: { id: 't1', title: 'second', done: true } as unknown as T,
      },
    ]

    await sync.push()
    expect(adapter.findAll()).toEqual([{ id: 't1', title: 'second', done: true }, todo('t2')])
  })

  it('client-wins: does not call replaceAll and keeps the conflicting mutations queued (AC2)', async () => {
    const transport = new MockTransport()
    const { adapter, sync } = createSetup({ conflictStrategy: 'client-wins' }, transport)
    adapter.replaceAll([todo('t1'), todo('t2')])
    adapter.update('t1', { title: 'local 1' })
    adapter.update('t2', { title: 'local 2' })

    transport.conflictGenerator = <T extends RowWithId>(
      _table: string,
      mutations: MergedMutation<T>[]
    ) =>
      mutations.map(m => ({
        id: m.id,
        clientMutation: m,
        serverRow: { id: m.id, title: 'server', done: true } as unknown as T,
      }))

    const replaceAll = vi.spyOn(adapter, 'replaceAll')
    await sync.push()

    expect(replaceAll).not.toHaveBeenCalled()
    expect(adapter.queue.getMerged().map(m => m.id)).toEqual(['t1', 't2'])
    expect(adapter.findById('t1')?.title).toBe('local 1')
  })

  it('custom resolver: each resolved row is applied and queued as an update that survives the clear (AC3)', async () => {
    const transport = new MockTransport()
    const { adapter, sync } = createSetup(
      {
        conflictStrategy: conflict => ({
          ...conflict.serverRow,
          title: `merged ${String(conflict.id)}`,
        }),
      },
      transport
    )
    adapter.replaceAll([todo('t1'), todo('t2'), todo('t3')])
    adapter.update('t1', { title: 'local 1' })
    adapter.update('t3', { title: 'local 3' })

    transport.conflictGenerator = <T extends RowWithId>(
      _table: string,
      mutations: MergedMutation<T>[]
    ) =>
      mutations.map(m => ({
        id: m.id,
        clientMutation: m,
        serverRow: { id: m.id, title: 'server', done: true } as unknown as T,
      }))

    const replaceAll = vi.spyOn(adapter, 'replaceAll')
    await sync.push()

    expect(replaceAll).toHaveBeenCalledTimes(1)
    expect(adapter.findById('t1')).toEqual({ id: 't1', title: 'merged t1', done: true })
    expect(adapter.findById('t3')).toEqual({ id: 't3', title: 'merged t3', done: true })

    const merged = adapter.queue.getMerged()
    expect(merged.map(m => [m.type, m.id])).toEqual([
      ['update', 't1'],
      ['update', 't3'],
    ])
    expect(merged[0].data).toMatchObject({ title: 'merged t1', done: true })
    expect(merged[1].data).toMatchObject({ title: 'merged t3', done: true })
  })
})

// ── D2: unchanged pull writes nothing ────────────────────────────────

interface Event extends RowWithId {
  id: string
  at: Date | string
  tags: string[] | string
  n: number
}

function createCountingIDB() {
  let writes = 0
  const db = {
    objectStoreNames: { contains: () => true },
    transaction(_store: string, mode: 'readonly' | 'readwrite' = 'readonly') {
      const tx: {
        error: null
        objectStore?: () => unknown
        oncomplete?: () => void
      } = { error: null }
      if (mode === 'readonly') {
        tx.objectStore = () => ({
          getAll() {
            const request: { result: unknown[]; error: null; onsuccess?: () => void } = {
              result: [],
              error: null,
            }
            queueMicrotask(() => request.onsuccess?.())
            return request
          },
        })
        return tx
      }
      writes += 1
      tx.objectStore = () => ({ clear: () => {}, put: () => {} })
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    },
    close: () => {},
  }
  return { db: db as unknown as IDBDatabase, writes: () => writes }
}

describe('a pull equal to the local rows writes nothing [#237]', () => {
  const columnTypes: Record<string, ColumnType> = { at: 'date', tags: 'string[]', n: 'number' }
  const wire = (): Event[] => [
    { id: 'e1', at: '2026-01-01T00:00:00.000Z', tags: '["a","b"]', n: 1 },
    { id: 'e2', at: '2026-02-01T00:00:00.000Z', tags: '[]', n: 2 },
  ]

  let transport: MockTransport
  let adapter: LocalAdapter<Event>
  let sync: SyncEngine
  let idb: ReturnType<typeof createCountingIDB>
  let events: SyncEvent[]

  beforeEach(async () => {
    vi.stubGlobal('indexedDB', {})
    idb = createCountingIDB()
    transport = new MockTransport()
    adapter = new LocalAdapter<Event>({
      tableName: 'Event',
      idMode: 'client',
      columnTypes,
      idbDb: idb.db,
      mutationStorage: createMemoryStorage(),
    })
    await adapter.init()
    sync = new SyncEngine({ transport })
    sync.registerTable('Event', adapter, adapter.queue)
    events = []
    sync.on(e => events.push(e))

    transport.setServerData('Event', wire())
    await sync.pull()
    await adapter.flush()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves the rows and IndexedDB untouched; pull-complete still fires (AC4)', async () => {
    const writesBefore = idb.writes()
    expect(writesBefore).toBe(1)
    const before = adapter.findAll()
    expect(before[0].at).toBeInstanceOf(Date)

    await sync.pull()
    await adapter.flush()

    expect(idb.writes()).toBe(writesBefore)
    const after = adapter.findAll()
    expect(after).toHaveLength(2)
    // Same row objects: nothing was replaced
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(events.filter(e => e.type === 'pull-complete')).toHaveLength(2)
  })

  it('replaces and persists when one value differs (AC5)', async () => {
    const rows = wire()
    rows[1] = { ...rows[1], at: '2026-02-01T00:00:01.000Z' }
    transport.setServerData('Event', rows)

    await sync.pull()
    await adapter.flush()

    expect(idb.writes()).toBe(2)
    expect((adapter.findById('e2')?.at as Date).toISOString()).toBe('2026-02-01T00:00:01.000Z')
  })

  it('replaces and persists when a nested value differs (AC5)', async () => {
    const rows = wire()
    rows[0] = { ...rows[0], tags: '["a","c"]' }
    transport.setServerData('Event', rows)

    await sync.pull()
    await adapter.flush()

    expect(idb.writes()).toBe(2)
    expect(adapter.findById('e1')?.tags).toEqual(['a', 'c'])
  })

  it('replaces and persists when the row order differs (AC5)', async () => {
    transport.setServerData('Event', wire().reverse())

    await sync.pull()
    await adapter.flush()

    expect(idb.writes()).toBe(2)
    expect(adapter.findAll().map(r => r.id)).toEqual(['e2', 'e1'])
  })

  it('replaces and persists when the row count differs (AC5)', async () => {
    transport.setServerData('Event', wire().slice(0, 1))

    await sync.pull()
    await adapter.flush()

    expect(idb.writes()).toBe(2)
    expect(adapter.findAll().map(r => r.id)).toEqual(['e1'])
  })
})

// ── D3: auto-sync skips hidden / offline ticks ───────────────────────

describe('auto-sync skips ticks while hidden or offline [#237]', () => {
  let transport: MockTransport
  let pull: ReturnType<typeof vi.spyOn>
  let push: ReturnType<typeof vi.spyOn>
  let sync: SyncEngine
  let adapter: LocalAdapter<Todo>
  let events: SyncEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    transport = new MockTransport()
    pull = vi.spyOn(transport, 'pull')
    push = vi.spyOn(transport, 'push')
    const setup = createSetup({}, transport)
    sync = setup.sync
    adapter = setup.adapter
    events = setup.events
    adapter.insert(todo('t1'))
  })

  afterEach(() => {
    sync.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a tick while document.hidden calls neither pull nor push and emits nothing (AC6)', async () => {
    const doc = { hidden: true }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('navigator', { onLine: true })

    sync.startAutoSync(1000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(pull).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(events).toEqual([])

    doc.hidden = false
    await vi.advanceTimersByTimeAsync(1000)

    expect(push).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(1)
    expect(events.map(e => e.type)).toContain('sync-complete')
  })

  it('a tick while navigator.onLine is false is skipped until both clear (AC6)', async () => {
    const doc = { hidden: true }
    const nav = { onLine: false }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('navigator', nav)

    sync.startAutoSync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    doc.hidden = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(pull).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(events).toEqual([])

    nav.onLine = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(push).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('ticks sync as before when document and navigator are undefined (AC7)', async () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('navigator', undefined)

    sync.startAutoSync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(push).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('an explicit sync() runs while hidden and offline (AC7)', async () => {
    vi.stubGlobal('document', { hidden: true })
    vi.stubGlobal('navigator', { onLine: false })

    await sync.sync()

    expect(push).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(1)
  })
})

// ── D4 / D5: bounded push slices ─────────────────────────────────────

/** Records every push call; throws on the call numbers listed in `failOn`. */
class SlicingTransport extends MockTransport {
  readonly calls: Array<Array<string | number>> = []
  failOn = new Set<number>()
  onCall?: (callNumber: number) => void

  override async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.calls.push(mutations.map(m => m.id))
    const callNumber = this.calls.length
    this.onCall?.(callNumber)
    if (this.failOn.has(callNumber)) {
      throw new Error(`slice ${callNumber} failed`)
    }
    return super.push(tableName, mutations)
  }
}

describe('maxBatchSize pushes bounded slices [#237]', () => {
  it('sends 5 mutations as slices of 2, 2 and 1 in queue order (AC8)', async () => {
    const transport = new SlicingTransport()
    const { adapter, sync, events } = createSetup({ maxBatchSize: 2 }, transport)
    for (const id of ['a', 'b', 'c', 'd', 'e']) adapter.insert(todo(id))

    await sync.push()

    expect(transport.calls).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(adapter.queue.hasPending).toBe(false)
    const completes = events.filter(e => e.type === 'push-complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].pushedCount).toBe(5)
  })

  it('a failing 2nd slice settles the 1st and leaves the 2nd and 3rd queued (AC9)', async () => {
    const transport = new SlicingTransport()
    transport.failOn.add(2)
    const { adapter, sync, events } = createSetup({ maxBatchSize: 2 }, transport)
    for (const id of ['a', 'b', 'c', 'd', 'e']) adapter.insert(todo(id))
    transport.onCall = n => {
      if (n === 2) adapter.insert(todo('late'))
    }

    await expect(sync.push()).rejects.toThrow('slice 2 failed')

    expect(transport.calls).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(adapter.queue.getMerged().map(m => m.id)).toEqual(['c', 'd', 'e', 'late'])
    expect(events.filter(e => e.type === 'push-complete')).toHaveLength(0)
  })

  it("dead-lettering with 'discard' drops only the failing slice (AC9)", async () => {
    const transport = new SlicingTransport()
    transport.failOn.add(2)
    const dead: Array<Array<string | number>> = []
    const { adapter, sync, events } = createSetup(
      {
        maxBatchSize: 2,
        maxRetries: 1,
        retryBaseDelayMs: 0,
        onPoisonedMutation: info => {
          dead.push(info.mutations.map(m => m.id))
          return 'discard'
        },
      },
      transport
    )
    for (const id of ['a', 'b', 'c', 'd', 'e']) adapter.insert(todo(id))
    transport.onCall = n => {
      if (n === 2) adapter.insert(todo('late'))
    }

    await expect(sync.push()).rejects.toThrow('slice 2 failed')

    expect(dead).toEqual([['c', 'd']])
    const deadEvent = events.find(e => e.type === 'mutation-dead')
    expect(deadEvent?.mutations?.map(m => m.id)).toEqual(['c', 'd'])
    expect(adapter.queue.getMerged().map(m => m.id)).toEqual(['e', 'late'])
  })

  it('a slice failing with success:false reports only its unapplied mutations', async () => {
    const transport = new SlicingTransport()
    transport.rejectedIds.add('d')
    const { adapter, sync, events } = createSetup(
      { maxBatchSize: 2, maxRetries: 1, retryBaseDelayMs: 0 },
      transport
    )
    for (const id of ['a', 'b', 'c', 'd', 'e']) adapter.insert(todo(id))

    await expect(sync.push()).rejects.toThrow()

    expect(transport.calls).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    const deadEvent = events.find(e => e.type === 'mutation-dead')
    expect(deadEvent?.mutations?.map(m => m.id)).toEqual(['d'])
    expect(adapter.queue.getMerged().map(m => m.id)).toEqual(['d', 'e'])
  })

  it('the push-failure counter resets only after every slice succeeded', async () => {
    const transport = new SlicingTransport()
    const dead: Array<Array<string | number>> = []
    const { adapter, sync } = createSetup(
      {
        maxBatchSize: 2,
        maxRetries: 2,
        retryBaseDelayMs: 0,
        onPoisonedMutation: info => {
          dead.push(info.mutations.map(m => m.id))
          return 'retain'
        },
      },
      transport
    )
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) adapter.insert(todo(id))

    // Attempt 1: [a, b] lands, [c, d] fails -> 1 consecutive push failure
    transport.failOn = new Set([2])
    await expect(sync.push()).rejects.toThrow()
    expect(dead).toEqual([])
    // Attempt 2: [c, d] lands, [e, f] fails. A successful slice is not a
    // successful push, so this is the 2nd consecutive failure.
    transport.failOn = new Set([4])
    await expect(sync.push()).rejects.toThrow()

    expect(transport.calls).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['c', 'd'],
      ['e', 'f'],
    ])
    expect(dead).toEqual([['e', 'f']])
    expect(adapter.queue.getMerged().map(m => m.id)).toEqual(['e', 'f'])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'maxBatchSize %s makes new SyncEngine and createClientDB throw (AC10)',
    async value => {
      expect(() => new SyncEngine({ transport: new MockTransport(), maxBatchSize: value })).toThrow(
        /maxBatchSize/
      )
      await expect(
        createClientDB<{ Todo: Todo }>({
          schema: { tables: { Todo: { columns: ['id', 'title', 'done'] } } },
          transport: new MockTransport(),
          disableIDB: true,
          mutationStorage: createMemoryStorage(),
          maxBatchSize: value,
        })
      ).rejects.toThrow(/maxBatchSize/)
    }
  )

  it('without maxBatchSize the whole merged queue goes out in one call (AC10)', async () => {
    const transport = new SlicingTransport()
    const { adapter, sync } = createSetup({}, transport)
    for (const id of ['a', 'b', 'c', 'd', 'e']) adapter.insert(todo(id))

    await sync.push()

    expect(transport.calls).toEqual([['a', 'b', 'c', 'd', 'e']])
  })

  it('createClientDB passes maxBatchSize to the engine', async () => {
    const transport = new SlicingTransport()
    const { db, sync } = await createClientDB<{ Todo: Todo }>({
      schema: { tables: { Todo: { columns: ['id', 'title', 'done'] } } },
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
      maxBatchSize: 2,
    })
    for (const id of ['a', 'b', 'c']) db.from('Todo').create(todo(id))

    await sync.push()

    expect(transport.calls).toEqual([['a', 'b'], ['c']])
  })
})

// ── D6: concurrent adapter init ──────────────────────────────────────

describe('createClientDB initializes adapters concurrently [#237]', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts every init() before any resolves and syncs in schema order (AC11)', async () => {
    const started: string[] = []
    const releases: Array<() => void> = []
    vi.spyOn(LocalAdapter.prototype, 'init').mockImplementation(function (
      this: LocalAdapter<RowWithId>
    ) {
      started.push(this.tableName)
      return new Promise<void>(resolve => releases.push(resolve))
    })

    const transport = new MockTransport()
    const pulled: string[] = []
    const realPull = transport.pull.bind(transport)
    vi.spyOn(transport, 'pull').mockImplementation(<T extends RowWithId>(table: string) => {
      pulled.push(table)
      return realPull<T>(table)
    })

    const pending = createClientDB<{ A: Todo; B: Todo; C: Todo }>({
      schema: {
        tables: {
          A: { columns: ['id', 'title', 'done'] },
          B: { columns: ['id', 'title', 'done'] },
          C: { columns: ['id', 'title', 'done'] },
        },
      },
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual(['A', 'B', 'C'])

    // Resolve out of order: registration must still follow schema order
    for (const release of [...releases].reverse()) release()
    const { sync } = await pending

    await sync.sync()
    expect(pulled).toEqual(['A', 'B', 'C'])
  })

  it('a rejecting init() rejects createClientDB', async () => {
    vi.spyOn(LocalAdapter.prototype, 'init').mockRejectedValue(new Error('init failed'))

    await expect(
      createClientDB<{ A: Todo }>({
        schema: { tables: { A: { columns: ['id', 'title', 'done'] } } },
        transport: new MockTransport(),
        disableIDB: true,
        mutationStorage: createMemoryStorage(),
      })
    ).rejects.toThrow('init failed')
  })
})
