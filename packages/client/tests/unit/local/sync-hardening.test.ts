/**
 * Sync hardening tests — the four offline-lifecycle defects found by scenario
 * S5: false sync-complete while offline (#173), batch-wide dead-letter discard
 * (#174), cancelled mutation pairs leaking (#175), and dead-letter payloads
 * naming already-applied rows (#176).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  PoisonedMutationAction,
  PoisonedMutationInfo,
  RejectedMutationIds,
  SyncEvent,
  SyncPushResult,
  SyncTransport,
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

function createAdapter(tableName: string): LocalAdapter<Todo> {
  return new LocalAdapter<Todo>({
    tableName,
    idMode: 'client',
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
  })
}

/**
 * A server whose refusals are configurable in the two dimensions that matter
 * here: whether it commits the rest of the batch, and whether it says which
 * rows it refused.
 */
class RefusingTransport implements SyncTransport {
  readonly refused = new Set<string | number>()
  /** Commit the acceptable rows and report them via appliedIds */
  partialCommit = true
  /** Report the refused rows via the `rejectedIds` contract */
  namesOffenders = false
  /** Throw instead of returning a result (the all-or-nothing style) */
  throwOnRefusal = false
  readonly pushed: MergedMutation[][] = []
  readonly applied: MergedMutation[] = []

  async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
    return { rows: [] }
  }

  async push<T extends RowWithId>(
    _tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.pushed.push([...mutations])
    const refused = mutations.filter(m => this.refused.has(m.id))
    if (refused.length === 0) {
      this.applied.push(...mutations)
      return { success: true, appliedIds: mutations.map(m => m.id) }
    }

    if (this.throwOnRefusal) {
      const error: Error & RejectedMutationIds = new Error('batch rejected')
      if (this.namesOffenders) error.rejectedIds = refused.map(m => m.id)
      throw error
    }

    const accepted = this.partialCommit
      ? mutations.filter(m => !this.refused.has(m.id))
      : []
    this.applied.push(...accepted)
    return {
      success: false,
      appliedIds: accepted.map(m => m.id),
      rejectedIds: this.namesOffenders ? refused.map(m => m.id) : undefined,
    }
  }
}

describe('sync-complete only for a pass that actually ran [#173]', () => {
  let transport: RefusingTransport
  let tableA: LocalAdapter<Todo>
  let tableB: LocalAdapter<Todo>

  beforeEach(() => {
    transport = new RefusingTransport()
    tableA = createAdapter('A')
    tableB = createAdapter('B')
  })

  function createEngine(retryBaseDelayMs: number): SyncEngine {
    const engine = new SyncEngine({ transport, maxRetries: 0, retryBaseDelayMs })
    engine.registerTable('A', tableA, tableA.queue)
    engine.registerTable('B', tableB, tableB.queue)
    return engine
  }

  it('emits sync-deferred, not sync-complete, when every table is backed off', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine(1000)
      const events: SyncEvent[] = []
      engine.on(e => events.push(e))

      transport.refused.add('a1')
      transport.refused.add('b1')
      tableA.insert({ id: 'a1', title: 'A1' })
      tableB.insert({ id: 'b1', title: 'B1' })

      engine.startAutoSync(200)
      // Ticks at 200/400/600/800/1000: the first attempts both tables and
      // fails, the other four find both windows still open.
      await vi.advanceTimersByTimeAsync(1000)
      engine.stopAutoSync()

      expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(0)
      const deferred = events.filter(e => e.type === 'sync-deferred')
      expect(deferred).toHaveLength(4)
      expect(deferred[0].deferredTables).toEqual(['A', 'B'])

      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers a pass in which only some tables were skipped', async () => {
    vi.useFakeTimers()
    try {
      const engine = createEngine(1000)
      const events: SyncEvent[] = []
      engine.on(e => events.push(e))

      // Only A is poisoned, so only A backs off; B keeps syncing cleanly.
      transport.refused.add('a1')
      tableA.insert({ id: 'a1', title: 'A1' })

      engine.startAutoSync(200)
      await vi.advanceTimersByTimeAsync(1000)
      engine.stopAutoSync()

      // B synced on every tick, but A's work is still outstanding — that is not
      // "all changes saved", so the pass reports itself as deferred.
      expect(events.filter(e => e.type === 'pull-complete').length).toBeGreaterThan(0)
      expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(0)
      const deferred = events.filter(e => e.type === 'sync-deferred')
      expect(deferred).toHaveLength(4)
      expect(deferred[0].deferredTables).toEqual(['A'])

      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still completes a pass in which every table was attempted', async () => {
    const engine = createEngine(1000)
    const events: SyncEvent[] = []
    engine.on(e => events.push(e))

    tableA.insert({ id: 'a1', title: 'A1' })
    await engine.sync()

    expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(1)
    expect(events.some(e => e.type === 'sync-deferred')).toBe(false)
    engine.dispose()
  })

  it('completes an explicit sync() even while a backoff window is open', async () => {
    const engine = createEngine(60_000)
    const events: SyncEvent[] = []
    engine.on(e => events.push(e))

    transport.refused.add('a1')
    tableA.insert({ id: 'a1', title: 'A1' })

    // Open the window with a failing pass...
    await expect(engine.sync()).rejects.toThrow()
    // ...then unblock the row: an explicit sync ignores backoff, so nothing is
    // deferred and the pass genuinely completes.
    transport.refused.clear()
    await expect(engine.sync()).resolves.toBeUndefined()

    expect(events.some(e => e.type === 'sync-deferred')).toBe(false)
    expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(1)
    engine.dispose()
  })
})

describe('per-mutation dead-letter discard [#174]', () => {
  let transport: RefusingTransport
  let table: LocalAdapter<Todo>

  beforeEach(() => {
    transport = new RefusingTransport()
    table = createAdapter('A')
  })

  function createEngine(
    onPoisonedMutation: (info: PoisonedMutationInfo) => PoisonedMutationAction | void
  ): SyncEngine {
    const engine = new SyncEngine({
      transport,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation,
    })
    engine.registerTable('A', table, table.queue)
    return engine
  }

  function seedThreeRows(): void {
    table.insert({ id: 'a1', title: 'A1' })
    table.insert({ id: 'bad', title: 'Bad' })
    table.insert({ id: 'a2', title: 'A2' })
    transport.refused.add('bad')
    transport.partialCommit = false
    transport.throwOnRefusal = true
  }

  it('drops exactly the ids the handler returns', async () => {
    const engine = createEngine(() => ['bad'])
    seedThreeRows()

    await expect(engine.sync()).rejects.toThrow()

    expect(table.queue.getMerged().map(m => m.id)).toEqual(['a1', 'a2'])
    engine.dispose()
  })

  it('treats an empty id list as retain', async () => {
    const engine = createEngine(() => [])
    seedThreeRows()

    await expect(engine.sync()).rejects.toThrow()

    expect(table.queue.getMerged()).toHaveLength(3)
    engine.dispose()
  })

  it('ignores ids the handler names outside the reported batch', async () => {
    // 'later' is enqueued while the push is in flight, so it was never part of
    // the rejected batch — naming it must not cost the app that write (#109).
    const gated: SyncTransport = {
      async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
        return { rows: [] }
      },
      async push<T extends RowWithId>(): Promise<SyncPushResult<T>> {
        table.insert({ id: 'later', title: 'Later' })
        throw new Error('batch rejected')
      },
    }
    const engine = new SyncEngine({
      transport: gated,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: () => ['bad', 'later', 'never-existed'],
    })
    engine.registerTable('A', table, table.queue)
    seedThreeRows()

    await expect(engine.sync()).rejects.toThrow()

    expect(table.queue.getMerged().map(m => m.id)).toEqual(['a1', 'a2', 'later'])
    engine.dispose()
  })

  it("drops the whole batch on 'discard' when nobody names the offender", async () => {
    const engine = createEngine(() => 'discard')
    seedThreeRows()

    await expect(engine.sync()).rejects.toThrow()

    // Unchanged, documented fallback: with an all-or-nothing backend that says
    // nothing, the engine cannot tell innocent from poisoned.
    expect(table.queue.getMerged()).toHaveLength(0)
    engine.dispose()
  })

  it("drops only the ids a thrown error names on 'discard'", async () => {
    const seen: PoisonedMutationInfo[] = []
    const engine = createEngine(info => {
      seen.push(info)
      return 'discard'
    })
    seedThreeRows()
    transport.namesOffenders = true

    await expect(engine.sync()).rejects.toThrow()

    expect(seen[0].rejectedIds).toEqual(['bad'])
    expect(table.queue.getMerged().map(m => m.id)).toEqual(['a1', 'a2'])
    engine.dispose()
  })

  it("drops only the ids a push result names on 'discard'", async () => {
    const events: SyncEvent[] = []
    const engine = createEngine(() => 'discard')
    engine.on(e => events.push(e))
    seedThreeRows()
    transport.throwOnRefusal = false
    transport.namesOffenders = true

    await expect(engine.sync()).rejects.toThrow()

    const dead = events.filter(e => e.type === 'mutation-dead')
    expect(dead).toHaveLength(1)
    expect(dead[0].rejectedIds).toEqual(['bad'])
    expect(table.queue.getMerged().map(m => m.id)).toEqual(['a1', 'a2'])
    engine.dispose()
  })

  it('unblocks the table after a partial discard, so the innocent rows land', async () => {
    const engine = createEngine(() => ['bad'])
    seedThreeRows()

    await expect(engine.sync()).rejects.toThrow()
    // 'bad' is gone, so the retried batch is acceptable.
    await expect(engine.sync()).resolves.toBeUndefined()

    expect(transport.applied.map(m => m.id)).toEqual(['a1', 'a2'])
    expect(table.queue.hasPending).toBe(false)
    engine.dispose()
  })
})

describe('cancelled mutation pairs are collected [#175]', () => {
  let transport: RefusingTransport
  let table: LocalAdapter<Todo>
  let engine: SyncEngine

  beforeEach(() => {
    transport = new RefusingTransport()
    table = createAdapter('A')
    engine = new SyncEngine({ transport })
    engine.registerTable('A', table, table.queue)
  })

  it('purges a pair whose merged result is nothing, with no push at all', async () => {
    table.insert({ id: 'gone', title: 'Gone' })
    table.delete('gone')
    expect(table.queue.length).toBe(2)

    await engine.push()

    // Nothing was worth sending, and nothing is left behind.
    expect(transport.pushed).toHaveLength(0)
    expect(table.queue.length).toBe(0)
    engine.dispose()
  })

  it('purges the pair alongside a real push', async () => {
    table.insert({ id: 'keep', title: 'Keep' })
    table.insert({ id: 'gone', title: 'Gone' })
    table.delete('gone')

    await engine.push()

    expect(transport.pushed[0].map(m => m.id)).toEqual(['keep'])
    expect(table.queue.length).toBe(0)
    engine.dispose()
  })

  it('keeps a pair that is not fully below the push boundary', async () => {
    let releasePush!: () => void
    const gate = new Promise<void>(r => {
      releasePush = r
    })
    const gated: SyncTransport = {
      async pull<T extends RowWithId>(): Promise<{ rows: T[] }> {
        return { rows: [] }
      },
      async push<T extends RowWithId>(
        _table: string,
        mutations: MergedMutation<T>[]
      ): Promise<SyncPushResult<T>> {
        // Both halves of this pair are enqueued after the snapshot, so the
        // boundary cannot prove them settled yet.
        table.insert({ id: 'mid', title: 'Mid' })
        table.delete('mid')
        await gate
        return { success: true, appliedIds: mutations.map(m => m.id) }
      },
    }
    const gatedEngine = new SyncEngine({ transport: gated })
    gatedEngine.registerTable('A', table, table.queue)

    table.insert({ id: 'keep', title: 'Keep' })
    const p = gatedEngine.push()
    releasePush()
    await p

    expect(table.queue.length).toBe(2)

    // The next boundary covers them, so they are collected then.
    await gatedEngine.push()
    expect(table.queue.length).toBe(0)
    gatedEngine.dispose()
  })

  it('a failed push does not resurrect a cancelled pair', async () => {
    transport.refused.add('bad')
    transport.partialCommit = false
    table.insert({ id: 'bad', title: 'Bad' })
    table.insert({ id: 'gone', title: 'Gone' })
    table.delete('gone')

    await expect(engine.push()).rejects.toThrow()

    // The failing row is preserved for a retry; the pair that means nothing is
    // not (it was never part of any batch and never will be).
    expect(table.queue.getMerged().map(m => m.id)).toEqual(['bad'])
    expect(table.queue.length).toBe(1)
    engine.dispose()
  })
})

describe('dead-letter reports only unapplied mutations [#176]', () => {
  it('subtracts the ids the server confirmed via appliedIds', async () => {
    const transport = new RefusingTransport()
    transport.refused.add('bad')
    transport.partialCommit = true

    const table = createAdapter('A')
    const seen: PoisonedMutationInfo[] = []
    const events: SyncEvent[] = []
    const engine = new SyncEngine({
      transport,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: info => {
        seen.push(info)
        return 'retain'
      },
    })
    engine.on(e => events.push(e))
    engine.registerTable('A', table, table.queue)

    table.insert({ id: 'a1', title: 'A1' })
    table.insert({ id: 'bad', title: 'Bad' })
    table.insert({ id: 'a2', title: 'A2' })

    await expect(engine.sync()).rejects.toThrow()

    // a1/a2 landed and left the queue; the report must agree with the queue.
    expect(transport.applied.map(m => m.id)).toEqual(['a1', 'a2'])
    expect(table.queue.getMerged().map(m => m.id)).toEqual(['bad'])
    expect(seen[0].mutations.map(m => m.id)).toEqual(['bad'])
    expect(events.find(e => e.type === 'mutation-dead')?.mutations?.map(m => m.id)).toEqual([
      'bad',
    ])
    engine.dispose()
  })

  it('reports the whole batch when the transport applied nothing', async () => {
    const transport = new RefusingTransport()
    transport.refused.add('bad')
    transport.partialCommit = false
    transport.throwOnRefusal = true

    const table = createAdapter('A')
    const seen: PoisonedMutationInfo[] = []
    const engine = new SyncEngine({
      transport,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      onPoisonedMutation: info => {
        seen.push(info)
        return 'retain'
      },
    })
    engine.registerTable('A', table, table.queue)

    table.insert({ id: 'a1', title: 'A1' })
    table.insert({ id: 'bad', title: 'Bad' })

    await expect(engine.sync()).rejects.toThrow()

    expect(seen[0].mutations.map(m => m.id)).toEqual(['a1', 'bad'])
    engine.dispose()
  })
})
