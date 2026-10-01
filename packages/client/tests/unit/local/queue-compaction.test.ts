/**
 * Queue compaction and batching regressions (#234): batches write once,
 * repeated same-row updates stay constant-size, compaction never breaks the
 * in-flight push guarantees, and storage failures surface to the caller.
 */
import { describe, it, expect } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  SyncPushResult,
  SyncTransport,
} from '../../../src/local/sync-transport.js'

interface Todo extends RowWithId {
  id: string
  title: string
  done?: boolean
}

interface CountingStorage extends MutationStorage {
  setCalls: number
  bytes: number
  lastLength: number
  lastCallLength: number
  reset(): void
}

function createCountingStorage(): CountingStorage {
  const store = new Map<string, string>()
  const s: CountingStorage = {
    setCalls: 0,
    bytes: 0,
    lastLength: 0,
    lastCallLength: 0,
    reset() {
      s.setCalls = 0
      s.bytes = 0
    },
    getItem: k => store.get(k) ?? null,
    setItem(k, v) {
      s.setCalls++
      s.bytes += v.length
      s.lastLength = v.length
      s.lastCallLength = v.length
      store.set(k, v)
    },
    removeItem: k => {
      store.delete(k)
    },
  }
  return s
}

function createAdapter(storage: MutationStorage): LocalAdapter<Todo> {
  return new LocalAdapter<Todo>({
    tableName: 't',
    idMode: 'client',
    disableIDB: true,
    mutationStorage: storage,
  })
}

/** Transport whose first push runs a hook (e.g. a concurrent write) first. */
class HookTransport implements SyncTransport {
  readonly pushed: MergedMutation[][] = []
  constructor(
    private readonly hook: () => SyncPushResult | void = () => {},
    private readonly throwAfterHook?: Error
  ) {}
  async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
    return { rows: [] }
  }
  async push<T extends RowWithId>(
    _t: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.pushed.push([...mutations] as MergedMutation[])
    const custom = this.hook()
    if (this.throwAfterHook) throw this.throwAfterHook
    return (custom as SyncPushResult<T> | void) ?? { success: true }
  }
}

async function syncedTodo(
  storage: MutationStorage,
  transport: SyncTransport
): Promise<{ adapter: LocalAdapter<Todo>; sync: SyncEngine }> {
  const adapter = createAdapter(storage)
  const sync = new SyncEngine({ transport, maxRetries: 1, retryBaseDelayMs: 0 })
  sync.registerTable('t', adapter, adapter.queue)
  adapter.insert({ id: 't1', title: 'v', done: false })
  await sync.push()
  expect(adapter.queue.length).toBe(0)
  return { adapter, sync }
}

describe('queue compaction [#234]', () => {
  it('batchInsert performs one storage write [#234]', () => {
    const storage = createCountingStorage()
    const adapter = createAdapter(storage)
    storage.reset()
    adapter.batchInsert(Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, title: 'x' })))
    expect(storage.setCalls).toBe(1)
    expect(storage.bytes).toBe(storage.lastLength)
    expect(adapter.queue.length).toBe(2000)
  })

  it('batchUpdate performs one storage write [#234]', () => {
    const storage = createCountingStorage()
    const adapter = createAdapter(storage)
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, title: 'x' }))
    adapter.batchInsert(items)
    storage.reset()
    adapter.batchUpdate(items.map(i => ({ id: i.id, data: { title: 'y' } })))
    expect(storage.setCalls).toBe(1)
  })

  it('repeated updates of one row stay constant-size [#234]', async () => {
    const storage = createCountingStorage()
    const { adapter } = await syncedTodo(storage, new HookTransport())
    let lengthAfterSecond = 0
    for (let i = 0; i < 5000; i++) {
      adapter.update('t1', { title: 'v' + i })
      if (i === 1) lengthAfterSecond = storage.lastLength
    }
    expect(adapter.queue.length).toBe(1)
    expect(storage.lastLength).toBeLessThanOrEqual(lengthAfterSecond + 16)
    expect(adapter.queue.getMerged()).toEqual([
      { id: 't1', type: 'update', data: { title: 'v4999' } },
    ])
  })

  it('update cost does not grow with same-row history [#234]', async () => {
    const storage = createCountingStorage()
    const { adapter } = await syncedTodo(storage, new HookTransport())
    for (let i = 0; i < 10; i++) adapter.update('t1', { title: 'v' })
    const early = storage.lastCallLength
    for (let i = 0; i < 2000; i++) adapter.update('t1', { title: 'v' })
    expect(Math.abs(storage.lastCallLength - early)).toBeLessThanOrEqual(16)
  })

  it('an update during an in-flight push survives the clear [#109]', async () => {
    const storage = createCountingStorage()
    let armed = false
    let adapterRef!: LocalAdapter<Todo>
    const guarded = new HookTransport(() => {
      if (!armed) return
      armed = false
      adapterRef.update('t1', { done: true })
    })
    const { adapter, sync } = await syncedTodo(storage, guarded)
    adapterRef = adapter
    armed = true
    adapter.update('t1', { title: 'a' })
    await sync.push()
    expect(adapter.queue.getMerged()).toEqual([{ id: 't1', type: 'update', data: { done: true } }])
  })

  it('server-wins conflict during an in-flight push re-sends only post-boundary fields [#234]', async () => {
    const storage = createCountingStorage()
    let armed = false
    let adapterRef!: LocalAdapter<Todo>
    const transport = new HookTransport(() => {
      if (!armed) return
      armed = false
      adapterRef.update('t1', { title: 'v2' })
      return {
        success: true,
        conflicts: [
          {
            id: 't1',
            serverRow: { id: 't1', title: 'server', done: false },
            clientMutation: { id: 't1', type: 'update', data: { done: true } },
          },
        ],
      } as SyncPushResult
    })
    const { adapter, sync } = await syncedTodo(storage, transport)
    adapterRef = adapter
    adapter.update('t1', { done: true })
    armed = true
    await sync.push()
    expect(adapter.queue.getMerged()).toEqual([{ id: 't1', type: 'update', data: { title: 'v2' } }])
    await sync.push()
    expect(transport.pushed.at(-1)).toEqual([{ id: 't1', type: 'update', data: { title: 'v2' } }])
  })

  it('poisoned discard still drops the rejected fields when a write lands mid-push [#234]', async () => {
    const storage = createCountingStorage()
    let armed = false
    let adapterRef!: LocalAdapter<Todo>
    const err = Object.assign(new Error('rejected'), { rejectedIds: ['t1'] })
    const transport = new (class extends HookTransport {
      async push<T extends RowWithId>(
        t: string,
        m: MergedMutation<T>[]
      ): Promise<SyncPushResult<T>> {
        if (armed) {
          adapterRef.update('t1', { done: true })
          throw err
        }
        return super.push(t, m)
      }
    })()
    const adapter = createAdapter(storage)
    const sync = new SyncEngine({
      transport,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: () => 'discard',
    })
    sync.registerTable('t', adapter, adapter.queue)
    adapterRef = adapter
    adapter.insert({ id: 't1', title: 'v', done: false })
    await sync.push()
    adapter.update('t1', { title: 'poison' })
    armed = true
    await expect(sync.sync()).rejects.toThrow()
    expect(adapter.queue.getMerged()).toEqual([{ id: 't1', type: 'update', data: { done: true } }])
    sync.dispose()
  })

  it('a storage failure surfaces from LocalAdapter writes [#234]', () => {
    const storage: MutationStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    const adapter = createAdapter(storage)
    expect(() => adapter.insert({ id: 't1', title: 'x' })).toThrow('QuotaExceededError')
    expect(adapter.findById('t1')).toBeDefined()
    expect(adapter.queue.length).toBe(1)
  })
})
