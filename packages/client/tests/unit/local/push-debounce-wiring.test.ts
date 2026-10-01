import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

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

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

const row = (id: string): Counter => ({ id, value: 1, updatedAt: '' })

async function setup(pushDebounceMs?: number) {
  const transport = new MockTransport()
  const result = await createClientDB<Tables>({
    schema,
    transport,
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
    pushDebounceMs,
  })
  return { transport, ...result }
}

afterEach(() => vi.useRealTimers())

describe('pushDebounceMs wiring (#239)', () => {
  it('a local mutation triggers a push after pushDebounceMs', async () => {
    vi.useFakeTimers()
    const { transport, db } = await setup(100)
    db.from('Counter').create(row('c1'))

    await vi.advanceTimersByTimeAsync(99)
    expect(transport.pushHistory).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.pushHistory).toHaveLength(1)
  })

  it('rapid mutations collapse into one push', async () => {
    vi.useFakeTimers()
    const { transport, db } = await setup(100)
    const c = db.from('Counter')
    c.create(row('c1'))
    await vi.advanceTimersByTimeAsync(10)
    c.update('c1', { value: 2 })
    await vi.advanceTimersByTimeAsync(10)
    c.create(row('c2'))
    await vi.advanceTimersByTimeAsync(10)
    c.delete('c2')
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.pushHistory).toHaveLength(1)
  })

  it('batchInsert/batchUpdate schedule exactly one push; no-op mutations schedule none', () => {
    const adapter = new LocalAdapter<Counter>({
      tableName: 'Counter',
      idMode: 'client',
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })
    const engine = new SyncEngine({ transport: new MockTransport(), pushDebounceMs: 50 })
    engine.registerTable('Counter', adapter, adapter.queue)
    const spy = vi.spyOn(engine, 'schedulePush')

    adapter.batchInsert([row('a'), row('b'), row('c')])
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockClear()

    adapter.batchUpdate([
      { id: 'a', data: { value: 2 } },
      { id: 'b', data: { value: 3 } },
    ])
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockClear()

    adapter.update('nope', { value: 9 })
    adapter.delete('nope')
    adapter.replaceAll([row('z')])
    expect(spy).not.toHaveBeenCalled()
    engine.dispose()
  })

  it('a mutation after close() never reaches the transport', async () => {
    vi.useFakeTimers()
    const { transport, db, close } = await setup(20)
    await close()
    db.from('Counter').create(row('c1'))
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.pushHistory).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pushDebounceMs 0 (default) never auto-pushes', async () => {
    vi.useFakeTimers()
    const { transport, db } = await setup()
    db.from('Counter').create(row('c1'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.pushHistory).toHaveLength(0)
  })
})
