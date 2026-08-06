/**
 * SyncEngine resilience tests - per-table isolation, bounded retries with
 * backoff, and dead-lettering of permanently-rejected mutations (#132).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine, SyncError } from '../../../src/local/sync-engine.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  SyncEvent,
  SyncPushResult,
  SyncTransport,
  PoisonedMutationInfo,
} from '../../../src/local/sync-transport.js'

interface Todo extends RowWithId {
  id: string
  title: string
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

/** Transport that rejects pushes for a configurable set of tables. */
class FlakyTransport implements SyncTransport {
  readonly failingTables = new Set<string>()
  readonly pushCalls: string[] = []
  readonly pullCalls: string[] = []
  private readonly server = new Map<string, RowWithId[]>()

  async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    this.pullCalls.push(tableName)
    return { rows: [...((this.server.get(tableName) ?? []) as T[])] }
  }

  async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.pushCalls.push(tableName)
    if (this.failingTables.has(tableName)) {
      throw new Error(`server rejected batch for ${tableName}`)
    }
    const rows = [...(this.server.get(tableName) ?? [])]
    const byId = new Map(rows.map(r => [r.id, r]))
    for (const m of mutations) {
      if (m.type === 'delete') byId.delete(m.id)
      else byId.set(m.id, { id: m.id, ...m.data } as RowWithId)
    }
    this.server.set(tableName, Array.from(byId.values()))
    return { success: true, appliedIds: mutations.map(m => m.id) }
  }

  pushCallsFor(tableName: string): number {
    return this.pushCalls.filter(t => t === tableName).length
  }
}

function createAdapter(tableName: string): LocalAdapter<Todo> {
  return new LocalAdapter<Todo>({
    tableName,
    idMode: 'client',
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
  })
}

describe('SyncEngine resilience [#132]', () => {
  let transport: FlakyTransport
  let tableA: LocalAdapter<Todo>
  let tableB: LocalAdapter<Todo>

  beforeEach(() => {
    transport = new FlakyTransport()
    tableA = createAdapter('A')
    tableB = createAdapter('B')
  })

  function createEngine(
    options: Partial<{
      maxRetries: number
      retryBaseDelayMs: number
      onPoisonedMutation: (info: PoisonedMutationInfo) => 'discard' | 'retain' | void
      pushDebounceMs: number
    }> = {}
  ): SyncEngine {
    const engine = new SyncEngine({ transport, ...options })
    engine.registerTable('A', tableA, tableA.queue)
    engine.registerTable('B', tableB, tableB.queue)
    return engine
  }

  // ── Per-table isolation ─────────────────────────────────────────────

  it('a poisoned table does not stop later tables from syncing', async () => {
    const engine = createEngine()
    transport.failingTables.add('A')

    tableA.insert({ id: 'a1', title: 'A1' })
    tableB.insert({ id: 'b1', title: 'B1' })

    await expect(engine.sync()).rejects.toThrow(SyncError)

    // Table B pushed and pulled despite A's permanent failure.
    expect(transport.pushCallsFor('B')).toBe(1)
    expect(transport.pullCalls).toContain('B')
    expect(tableB.queue.hasPending).toBe(false)

    // A's mutation is preserved, and A never pulled (its push failed).
    expect(tableA.queue.hasPending).toBe(true)
    expect(transport.pullCalls).not.toContain('A')
  })

  it('emits a per-table error event and aggregates the failures', async () => {
    const engine = createEngine()
    const events: SyncEvent[] = []
    engine.on(e => events.push(e))

    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })
    tableB.insert({ id: 'b1', title: 'B1' })

    const error = await engine.sync().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SyncError)
    expect((error as SyncError).tableErrors.map(t => t.table)).toEqual(['A'])

    const errorEvents = events.filter(e => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].table).toBe('A')

    // A partial sync is not a complete sync.
    expect(events.some(e => e.type === 'sync-complete')).toBe(false)
  })

  it('isolates per table in push() and pull() too', async () => {
    const engine = createEngine()
    transport.failingTables.add('A')

    tableA.insert({ id: 'a1', title: 'A1' })
    tableB.insert({ id: 'b1', title: 'B1' })

    await expect(engine.push()).rejects.toThrow(SyncError)
    expect(transport.pushCallsFor('B')).toBe(1)
  })

  // ── Dead-letter ─────────────────────────────────────────────────────

  it('dead-letters a batch after maxRetries consecutive push failures', async () => {
    const poisoned: PoisonedMutationInfo[] = []
    const engine = createEngine({
      maxRetries: 2,
      retryBaseDelayMs: 0,
      onPoisonedMutation: info => {
        poisoned.push(info)
      },
    })
    const events: SyncEvent[] = []
    engine.on(e => events.push(e))

    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })

    await expect(engine.sync()).rejects.toThrow()
    expect(poisoned).toHaveLength(0) // one failure is not poison yet

    await expect(engine.sync()).rejects.toThrow()

    expect(poisoned).toHaveLength(1)
    expect(poisoned[0].table).toBe('A')
    expect(poisoned[0].attempts).toBe(2)
    expect(poisoned[0].mutations.map(m => m.id)).toEqual(['a1'])

    const dead = events.filter(e => e.type === 'mutation-dead')
    expect(dead).toHaveLength(1)
    expect(dead[0].table).toBe('A')
    expect(dead[0].mutations?.map(m => m.id)).toEqual(['a1'])
  })

  it('retains the batch when the handler does not discard it', async () => {
    const engine = createEngine({ maxRetries: 1, retryBaseDelayMs: 0 })

    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })

    await expect(engine.sync()).rejects.toThrow()
    expect(tableA.queue.hasPending).toBe(true)
  })

  it("discards the batch and unblocks the table when the handler returns 'discard'", async () => {
    const engine = createEngine({
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: () => 'discard',
    })

    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })

    await expect(engine.sync()).rejects.toThrow()
    expect(tableA.queue.hasPending).toBe(false)

    // With the poison gone the table syncs cleanly again, even though the
    // transport would still reject a push (there is nothing left to push).
    await expect(engine.sync()).resolves.toBeUndefined()
    expect(transport.pullCalls).toContain('A')
  })

  it('keeps mutations enqueued after the failed batch when discarding', async () => {
    let releasePush!: () => void
    const gate = new Promise<void>(r => {
      releasePush = r
    })
    const gatedTransport: SyncTransport = {
      async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
        return { rows: [] }
      },
      async push<T extends RowWithId>(): Promise<SyncPushResult<T>> {
        tableA.update('a1', { title: 'written during push' })
        await gate
        throw new Error('permanent rejection')
      },
    }
    const engine = new SyncEngine({
      transport: gatedTransport,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: () => 'discard',
    })
    engine.registerTable('A', tableA, tableA.queue)

    tableA.insert({ id: 'a1', title: 'A1' })
    const p = engine.sync()
    releasePush()
    await expect(p).rejects.toThrow()

    // The discard must respect the push boundary (#109): the write that landed
    // mid-push was never part of the poisoned batch.
    expect(tableA.queue.getMerged()).toHaveLength(1)
    expect(tableA.queue.getMerged()[0].data).toMatchObject({ title: 'written during push' })
  })

  it('a pull failure never dead-letters pending mutations', async () => {
    const poisoned: PoisonedMutationInfo[] = []
    const pullFails: SyncTransport = {
      async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
        throw new Error('network down')
      },
      async push<T extends RowWithId>(
        _table: string,
        mutations: MergedMutation<T>[]
      ): Promise<SyncPushResult<T>> {
        return { success: true, appliedIds: mutations.map(m => m.id) }
      },
    }
    const engine = new SyncEngine({
      transport: pullFails,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: info => {
        poisoned.push(info)
      },
    })
    engine.registerTable('A', tableA, tableA.queue)

    tableA.insert({ id: 'a1', title: 'A1' })
    await expect(engine.sync()).rejects.toThrow()
    await expect(engine.sync()).rejects.toThrow()

    expect(poisoned).toHaveLength(0)
  })

  // ── Backoff on background attempts ──────────────────────────────────

  it('backs off a failing table between auto-sync ticks', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine({ maxRetries: 0, retryBaseDelayMs: 1000 })
      transport.failingTables.add('A')
      tableA.insert({ id: 'a1', title: 'A1' })

      engine.startAutoSync(100)

      // Ticks at 100/200/300 — only the first attempt gets through, the rest
      // fall inside the 1000ms backoff window.
      await vi.advanceTimersByTimeAsync(350)
      expect(transport.pushCallsFor('A')).toBe(1)

      // The tick at 1100 is past the backoff deadline.
      await vi.advanceTimersByTimeAsync(1000)
      expect(transport.pushCallsFor('A')).toBe(2)

      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a backed-off table does not hold back a healthy one', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine({ maxRetries: 0, retryBaseDelayMs: 1000 })
      transport.failingTables.add('A')
      tableA.insert({ id: 'a1', title: 'A1' })

      engine.startAutoSync(100)
      await vi.advanceTimersByTimeAsync(350)

      expect(transport.pushCallsFor('A')).toBe(1)
      expect(transport.pullCalls.filter(t => t === 'B').length).toBeGreaterThanOrEqual(3)

      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resetRetryState clears the backoff window', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine({ maxRetries: 0, retryBaseDelayMs: 1000 })
      transport.failingTables.add('A')
      tableA.insert({ id: 'a1', title: 'A1' })

      engine.startAutoSync(100)
      await vi.advanceTimersByTimeAsync(150)
      expect(transport.pushCallsFor('A')).toBe(1)

      engine.resetRetryState('A')
      await vi.advanceTimersByTimeAsync(100)
      expect(transport.pushCallsFor('A')).toBe(2)

      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('an explicit sync() ignores the backoff window', async () => {
    const engine = createEngine({ maxRetries: 0, retryBaseDelayMs: 60_000 })
    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })

    await expect(engine.sync()).rejects.toThrow()
    await expect(engine.sync()).rejects.toThrow()

    expect(transport.pushCallsFor('A')).toBe(2)
  })

  // ── Background paths surface errors ─────────────────────────────────

  it('a failing debounced push emits error events instead of swallowing them', async () => {
    const engine = createEngine({ pushDebounceMs: 20, retryBaseDelayMs: 0 })
    const events: SyncEvent[] = []
    engine.on(e => events.push(e))

    transport.failingTables.add('A')
    tableA.insert({ id: 'a1', title: 'A1' })
    engine.schedulePush()

    await new Promise(r => setTimeout(r, 60))

    expect(events.some(e => e.type === 'error' && e.table === 'A')).toBe(true)
    // ...plus a table-less event marking the whole background attempt failed.
    expect(events.some(e => e.type === 'error' && e.table === undefined)).toBe(true)

    engine.dispose()
  })

  it('a failing auto-sync tick emits error events instead of swallowing them', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine({ retryBaseDelayMs: 0 })
      const events: SyncEvent[] = []
      engine.on(e => events.push(e))

      transport.failingTables.add('A')
      tableA.insert({ id: 'a1', title: 'A1' })

      engine.startAutoSync(50)
      await vi.advanceTimersByTimeAsync(60)

      expect(events.some(e => e.type === 'error' && e.table === 'A')).toBe(true)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
