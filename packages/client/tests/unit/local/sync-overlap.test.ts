/**
 * Overlapping sync() calls and isSyncing (#140).
 *
 * An explicit sync() that arrives while a pass is running used to resolve at
 * once without syncing anything, and push()/pull() never set isSyncing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine, SyncError } from '../../../src/local/sync-engine.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type {
  MergedMutation,
  SyncEvent,
  SyncPushResult,
} from '../../../src/local/sync-transport.js'

interface Todo {
  id: string
  title: string
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: key => {
      store.delete(key)
    },
  }
}

/**
 * MockTransport whose calls block until the test releases them, so a test can
 * hold one operation in flight while it makes the next call.
 */
class GatedTransport extends MockTransport {
  gated = false
  private readonly waiting: Array<() => void> = []
  readonly calls: Array<{ op: 'push' | 'pull'; table: string }> = []

  /** Number of calls currently held at the gate */
  get held(): number {
    return this.waiting.length
  }

  /** Let every held call proceed */
  releaseAll(): void {
    for (const release of this.waiting.splice(0)) release()
  }

  private async gate(): Promise<void> {
    if (!this.gated) return
    await new Promise<void>(resolve => this.waiting.push(resolve))
  }

  override async pull<T extends RowWithId>(tableName: string): Promise<{ rows: T[] }> {
    this.calls.push({ op: 'pull', table: tableName })
    await this.gate()
    return super.pull<T>(tableName)
  }

  override async push<T extends RowWithId>(
    tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.calls.push({ op: 'push', table: tableName })
    await this.gate()
    return super.push<T>(tableName, mutations)
  }
}

/** Let pending promise callbacks (and the engine's op chain) run */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Wait until the transport holds a call at its gate */
async function untilHeld(transport: GatedTransport, count = 1): Promise<void> {
  for (let i = 0; i < 100 && transport.held < count; i++) await flush()
  expect(transport.held).toBeGreaterThanOrEqual(count)
}

/** Wait for the next held call and let it through */
async function releaseNext(transport: GatedTransport): Promise<void> {
  await untilHeld(transport)
  transport.releaseAll()
}

function trackSettled(p: Promise<unknown>): { settled: boolean } {
  const state = { settled: false }
  p.then(
    () => {
      state.settled = true
    },
    () => {
      state.settled = true
    }
  )
  return state
}

describe('SyncEngine overlapping sync() [#140]', () => {
  let transport: GatedTransport
  let adapter: LocalAdapter<Todo>
  let sync: SyncEngine
  let events: SyncEvent[]

  beforeEach(() => {
    transport = new GatedTransport()
    adapter = new LocalAdapter<Todo>({
      tableName: 'Todo',
      idMode: 'client',
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })
    sync = new SyncEngine({ transport, retryBaseDelayMs: 0 })
    sync.registerTable('Todo', adapter, adapter.queue)
    events = []
    sync.on(e => events.push(e))
  })

  afterEach(() => {
    sync.dispose()
    vi.useRealTimers()
  })

  it('a sync() during a running pass waits for a pass that starts after it', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)

    // Written after the first pass snapshotted its batch.
    adapter.insert({ id: 't2', title: 'second' })
    const second = sync.sync()
    const secondState = trackSettled(second)

    await releaseNext(transport) // first pass: push
    await releaseNext(transport) // first pass: pull
    await first
    await untilHeld(transport)
    // The trailing pass is now running and held at its push.
    expect(secondState.settled).toBe(false)

    transport.gated = false
    transport.releaseAll()
    await second

    const pushedIds = transport.pushHistory.flatMap(p => p.mutations.map(m => m.id))
    expect(pushedIds).toEqual(['t1', 't2'])
    expect(adapter.queue.hasPending).toBe(false)
    expect(events.filter(e => e.type === 'sync-start')).toHaveLength(2)
    expect(events.filter(e => e.type === 'sync-complete')).toHaveLength(2)
  })

  it('several sync() calls during one pass share at most one extra pass', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)

    adapter.insert({ id: 't2', title: 'second' })
    const a = sync.sync()
    const b = sync.sync()
    const c = sync.sync()

    transport.gated = false
    transport.releaseAll()
    await Promise.all([first, a, b, c])

    expect(events.filter(e => e.type === 'sync-start')).toHaveLength(2)
    expect(transport.pushHistory).toHaveLength(2)
  })

  it('each queued caller rejects when the shared extra pass fails', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)

    adapter.insert({ id: 't2', title: 'second' })
    const a = sync.sync()
    const b = sync.sync()

    await releaseNext(transport) // first pass: push
    await releaseNext(transport) // first pass: pull
    await first

    // Only the trailing pass sees the failing transport.
    await untilHeld(transport)
    transport.pushShouldFail = true
    transport.gated = false
    transport.releaseAll()

    await expect(a).rejects.toBeInstanceOf(SyncError)
    await expect(b).rejects.toBeInstanceOf(SyncError)
  })

  it('a different scope gets its own extra pass', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)

    const all = sync.sync()
    const one = sync.sync('Todo')

    transport.gated = false
    transport.releaseAll()
    await Promise.all([first, all, one])

    const starts = events.filter(e => e.type === 'sync-start')
    expect(starts.map(e => e.table)).toEqual([undefined, undefined, 'Todo'])
  })

  it('a sync() after the extra pass started queues another one', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)
    const second = sync.sync()

    await releaseNext(transport) // first pass: push
    await releaseNext(transport) // first pass: pull
    await first
    await untilHeld(transport) // second pass is running now

    adapter.insert({ id: 't3', title: 'third' })
    const third = sync.sync()

    transport.gated = false
    transport.releaseAll()
    await Promise.all([second, third])

    const pushedIds = transport.pushHistory.flatMap(p => p.mutations.map(m => m.id))
    expect(pushedIds).toEqual(['t1', 't3'])
    expect(events.filter(e => e.type === 'sync-start')).toHaveLength(3)
  })

  it('auto-sync ticks still skip while a pass runs', async () => {
    vi.useFakeTimers()
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const first = sync.sync()
    await untilHeld(transport)

    sync.startAutoSync(10)
    await vi.advanceTimersByTimeAsync(100)
    sync.stopAutoSync()

    transport.gated = false
    transport.releaseAll()
    await first
    await flush()

    expect(events.filter(e => e.type === 'sync-start')).toHaveLength(1)
    expect(transport.calls.filter(c => c.op === 'pull')).toHaveLength(1)
  })
})

describe('SyncEngine isSyncing [#140]', () => {
  let transport: GatedTransport
  let adapter: LocalAdapter<Todo>
  let sync: SyncEngine

  beforeEach(() => {
    transport = new GatedTransport()
    adapter = new LocalAdapter<Todo>({
      tableName: 'Todo',
      idMode: 'client',
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })
    sync = new SyncEngine({ transport, retryBaseDelayMs: 0 })
    sync.registerTable('Todo', adapter, adapter.queue)
  })

  afterEach(() => {
    sync.dispose()
    vi.useRealTimers()
  })

  it('is true while an explicit push() awaits the transport', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const p = sync.push()
    expect(sync.isSyncing).toBe(true)
    await untilHeld(transport)
    expect(sync.isSyncing).toBe(true)

    transport.releaseAll()
    await p
    expect(sync.isSyncing).toBe(false)
  })

  it('is true while an explicit pull() awaits the transport', async () => {
    transport.gated = true

    const p = sync.pull()
    expect(sync.isSyncing).toBe(true)
    await untilHeld(transport)
    expect(sync.isSyncing).toBe(true)

    transport.releaseAll()
    await p
    expect(sync.isSyncing).toBe(false)
  })

  it('is false after a failed push() settles', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.pushShouldFail = true

    const p = sync.push()
    expect(sync.isSyncing).toBe(true)
    await expect(p).rejects.toBeInstanceOf(SyncError)
    expect(sync.isSyncing).toBe(false)
  })

  it('stays true until every started operation has settled', async () => {
    adapter.insert({ id: 't1', title: 'first' })
    transport.gated = true

    const s = sync.sync()
    const p = sync.pull()
    await untilHeld(transport)

    // Finish the sync pass's push and pull; the explicit pull is still queued.
    await releaseNext(transport)
    await releaseNext(transport)
    await s
    expect(sync.isSyncing).toBe(true)

    transport.gated = false
    transport.releaseAll()
    await p
    expect(sync.isSyncing).toBe(false)
  })

  it('is true during a background debounced push', async () => {
    vi.useFakeTimers()
    const debounced = new SyncEngine({ transport, pushDebounceMs: 10, retryBaseDelayMs: 0 })
    const local = new LocalAdapter<Todo>({
      tableName: 'Todo',
      idMode: 'client',
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })
    debounced.registerTable('Todo', local, local.queue)
    transport.gated = true

    local.insert({ id: 't1', title: 'first' })
    expect(debounced.isSyncing).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    await untilHeld(transport)
    expect(debounced.isSyncing).toBe(true)

    transport.releaseAll()
    await flush()
    expect(debounced.isSyncing).toBe(false)
    debounced.dispose()
  })
})
