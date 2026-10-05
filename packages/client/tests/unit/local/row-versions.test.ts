/**
 * Row versions on the sync protocol (#138).
 *
 * Each pushed edit carries the base version of the row it was built on, and the
 * server can return row versions on pull and push. The client only stores and
 * echoes versions; the server decides what they are.
 */
import { describe, it, expect } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { MutationQueue } from '../../../src/local/mutation-queue.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import type {
  ConflictStrategy,
  MergedMutation,
  RowVersions,
  SyncPullResult,
  SyncPushResult,
  SyncTransport,
} from '../../../src/local/sync-transport.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'

interface Todo extends RowWithId {
  id: string
  title: string
  done?: boolean
}

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

/** A transport whose pull and push answers are set by the test. */
class StubTransport implements SyncTransport {
  rows: Todo[] = []
  /** Versions returned on pull; undefined → the pull carries none */
  pullVersions?: RowVersions
  /** Versions returned on push; undefined → the push result carries none */
  pushVersions?: RowVersions
  readonly pushed: MergedMutation[][] = []

  async pull<T extends RowWithId>(_tableName: string): Promise<SyncPullResult<T>> {
    const rows = this.rows.map(r => ({ ...r })) as RowWithId[] as T[]
    return this.pullVersions ? { rows, versions: { ...this.pullVersions } } : { rows }
  }

  async push<T extends RowWithId>(
    _tableName: string,
    mutations: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.pushed.push(mutations.map(m => ({ ...m })) as MergedMutation[])
    const result: SyncPushResult<T> = {
      success: true,
      appliedIds: mutations.map(m => m.id),
    }
    if (this.pushVersions) result.versions = { ...this.pushVersions }
    return result
  }

  lastPush(): MergedMutation[] {
    const last = this.pushed[this.pushed.length - 1]
    if (!last) throw new Error('nothing pushed')
    return last
  }
}

function setup(
  transport: SyncTransport,
  options: { storage?: MutationStorage; conflictStrategy?: ConflictStrategy } = {}
): { adapter: LocalAdapter<Todo>; sync: SyncEngine; storage: MutationStorage } {
  const storage = options.storage ?? createMemoryStorage()
  const adapter = new LocalAdapter<Todo>({
    tableName: 'Todo',
    idMode: 'client',
    disableIDB: true,
    mutationStorage: storage,
  })
  const sync = new SyncEngine({
    transport,
    conflictStrategy: options.conflictStrategy,
    retryBaseDelayMs: 0,
  })
  sync.registerTable('Todo', adapter, adapter.queue)
  return { adapter, sync, storage }
}

function byId(mutations: readonly MergedMutation[], id: string): MergedMutation {
  const found = mutations.find(m => m.id === id)
  if (!found) throw new Error(`no mutation for ${id}`)
  return found
}

describe('row versions: base version on pushed mutations', () => {
  it('pushes an update or delete of a pulled row with its pulled version (AC1)', async () => {
    const transport = new StubTransport()
    transport.rows = [
      { id: 't1', title: 'one' },
      { id: 't2', title: 'two' },
      { id: 't3', title: 'three' },
    ]
    transport.pullVersions = { t1: 'v7', t2: 42, t3: 'v3' }
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.update('t1', { title: 'ONE' })
    adapter.delete('t2')
    adapter.update('t3', { title: 'THREE' })
    adapter.delete('t3')
    await sync.push()

    const pushed = transport.lastPush()
    expect(byId(pushed, 't1')).toMatchObject({ type: 'update', baseVersion: 'v7' })
    expect(byId(pushed, 't2')).toMatchObject({ type: 'delete', baseVersion: 42 })
    expect(byId(pushed, 't3')).toMatchObject({ type: 'delete', baseVersion: 'v3' })
  })

  it('pushes a row created locally and never pulled without a base version (AC2)', async () => {
    const transport = new StubTransport()
    transport.pullVersions = {}
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.insert({ id: 'n1', title: 'new' })
    adapter.update('n1', { done: true })
    await sync.push()

    const pushed = byId(transport.lastPush(), 'n1')
    expect(pushed.type).toBe('insert')
    expect('baseVersion' in pushed).toBe(false)
  })

  it('merges several edits into one mutation carrying the version before the first edit (AC3)', async () => {
    const transport = new StubTransport()
    transport.rows = [{ id: 't1', title: 'one' }]
    transport.pullVersions = { t1: 1 }
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.update('t1', { title: 'edited' })
    // Someone else wrote the row in between: the pull reports a newer version.
    transport.pullVersions = { t1: 2 }
    await sync.pull()
    adapter.update('t1', { done: true })
    await sync.push()

    const pushed = transport.lastPush()
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({
      id: 't1',
      type: 'update',
      baseVersion: 1,
      data: { title: 'edited', done: true },
    })
  })

  it('sends exactly {id, type, data} to a transport that reports no versions (AC4)', async () => {
    const transport = new MockTransport()
    transport.setServerData('Todo', [
      { id: 't1', title: 'one' },
      { id: 't2', title: 'two' },
    ])
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.update('t1', { title: 'ONE' })
    adapter.delete('t2')
    adapter.insert({ id: 't3', title: 'three' })
    await sync.push()
    adapter.update('t3', { done: true })
    await sync.sync()

    const pushed = transport.pushHistory.flatMap(entry => entry.mutations)
    expect(pushed).toHaveLength(4)
    for (const mutation of pushed) {
      expect(Object.keys(mutation).sort()).toEqual(['data', 'id', 'type'])
    }
  })

  it('keeps base versions across a reload with no pull (AC5)', async () => {
    const transport = new StubTransport()
    transport.rows = [
      { id: 't1', title: 'one' },
      { id: 't2', title: 'two' },
    ]
    transport.pullVersions = { t1: 'v1', t2: 'v2' }
    const storage = createMemoryStorage()
    const { adapter, sync } = setup(transport, { storage })

    await sync.pull()
    adapter.update('t1', { title: 'ONE' })
    sync.dispose()

    // Cold start: a new queue on the same storage, no pull.
    const reloaded = new MutationQueue<Todo>({ tableName: 'Todo', storage })
    reloaded.push('update', 't2', { title: 'TWO' })

    const merged = reloaded.getMerged()
    expect(byId(merged, 't1').baseVersion).toBe('v1')
    expect(byId(merged, 't2').baseVersion).toBe('v2')
  })

  it('carries the version a push reported, also for an edit queued during that push (AC6)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let entered: () => void = () => {}
    const pushEntered = new Promise<void>(resolve => {
      entered = resolve
    })
    let gated = true
    class GatedMock extends MockTransport {
      override async push<T extends RowWithId>(
        tableName: string,
        mutations: MergedMutation<T>[]
      ): Promise<SyncPushResult<T>> {
        if (gated) {
          entered()
          await gate
        }
        return super.push(tableName, mutations)
      }
    }
    const transport = new GatedMock({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.update('t1', { title: 'first' })
    const inFlight = sync.push()
    // The push has snapshotted the queue: edit the row while it is in flight.
    await pushEntered
    adapter.update('t1', { done: true })
    release()
    await inFlight
    gated = false

    expect(transport.pushHistory[0].mutations[0].baseVersion).toBe(1)
    expect(transport.getServerVersion('Todo', 't1')).toBe(2)

    await sync.push()
    const second = transport.pushHistory[1].mutations
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ id: 't1', baseVersion: 2, data: { done: true } })
    // The base matched, so the versioned mock applied the in-flight edit.
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'first', done: true }])
    expect(adapter.queue.hasPending).toBe(false)

    // And the edit after that carries the version the second push reported.
    adapter.update('t1', { title: 'third' })
    await sync.push()
    expect(transport.pushHistory[2].mutations[0].baseVersion).toBe(3)
  })

  it('forgets the version of a settled row the push reports no version for', async () => {
    const transport = new StubTransport()
    transport.rows = [{ id: 't1', title: 'one' }]
    transport.pullVersions = { t1: 'v1' }
    const { adapter, sync } = setup(transport)

    await sync.pull()
    adapter.update('t1', { title: 'ONE' })
    await sync.push()
    expect(transport.lastPush()[0].baseVersion).toBe('v1')

    // The push result carried no versions: the client's own write must not
    // raise a false conflict on the next edit.
    adapter.update('t1', { done: true })
    await sync.push()
    expect('baseVersion' in transport.lastPush()[0]).toBe(false)
  })
})

describe('row versions: conflict resolution moves the base', () => {
  /** Server row t1 at version 2 while the client last saw version 1. */
  async function conflictedSetup(
    conflictStrategy: ConflictStrategy
  ): Promise<{ transport: MockTransport; adapter: LocalAdapter<Todo>; sync: SyncEngine }> {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one', done: false }])
    const { adapter, sync } = setup(transport, { conflictStrategy })
    await sync.pull()
    // Another client writes the row: no base → applied unconditionally.
    await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'other' } }])
    expect(transport.getServerVersion('Todo', 't1')).toBe(2)
    transport.pushHistory.length = 0
    return { transport, adapter, sync }
  }

  it('client-wins re-pushes with the conflict serverVersion and the versioned mock applies it (AC7)', async () => {
    const { transport, adapter, sync } = await conflictedSetup('client-wins')

    adapter.update('t1', { title: 'mine' })
    await sync.push()
    expect(transport.pushHistory[0].mutations[0].baseVersion).toBe(1)
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'other', done: false }])

    await sync.push()
    expect(transport.pushHistory[1].mutations[0]).toMatchObject({
      id: 't1',
      baseVersion: 2,
      data: { title: 'mine' },
    })
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'mine', done: false }])
    expect(transport.getServerVersion('Todo', 't1')).toBe(3)
    expect(adapter.queue.hasPending).toBe(false)
  })

  it('server-wins: the next edit after the resolution carries the serverVersion (AC8)', async () => {
    const { transport, adapter, sync } = await conflictedSetup('server-wins')

    adapter.update('t1', { done: true })
    await sync.push()
    expect(adapter.findById('t1')).toEqual({ id: 't1', title: 'other', done: false })
    expect(adapter.queue.hasPending).toBe(false)

    adapter.update('t1', { done: true })
    await sync.push()
    expect(transport.pushHistory[1].mutations[0]).toMatchObject({ id: 't1', baseVersion: 2 })
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'other', done: true }])
  })

  it('custom resolver: the next edit after the resolution carries the serverVersion (AC8)', async () => {
    const { transport, adapter, sync } = await conflictedSetup(conflict => ({
      ...conflict.serverRow,
      title: `${(conflict.serverRow as Todo).title}+merged`,
    }))

    adapter.update('t1', { title: 'mine' })
    await sync.push()
    expect(adapter.findById('t1')).toMatchObject({ title: 'other+merged' })

    adapter.update('t1', { done: true })
    await sync.push()
    expect(transport.pushHistory[1].mutations[0]).toMatchObject({
      id: 't1',
      baseVersion: 2,
      data: { title: 'other+merged', done: true },
    })
    expect(transport.serverData.get('Todo')).toEqual([
      { id: 't1', title: 'other+merged', done: true },
    ])
  })
})

describe('MockTransport versioned mode (AC9)', () => {
  it('returns no versions unless versioned mode is on', async () => {
    const transport = new MockTransport()
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])
    expect(await transport.pull('Todo')).toEqual({ rows: [{ id: 't1', title: 'one' }] })
    const result = await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'x' } }])
    expect(result.versions).toBeUndefined()
  })

  it('returns a version for every row on pull', async () => {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [
      { id: 't1', title: 'one' },
      { id: 2, title: 'two' },
    ])
    const pulled = await transport.pull('Todo')
    expect(pulled.versions).toEqual({ t1: 1, '2': 1 })
  })

  it('bumps the version on every applied write and returns it on push', async () => {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])

    const r1 = await transport.push<Todo>('Todo', [
      { id: 't1', type: 'update', data: { title: 'a' }, baseVersion: 1 },
      { id: 't2', type: 'insert', data: { id: 't2', title: 'new' } },
    ])
    expect(r1).toMatchObject({ success: true, versions: { t1: 2, t2: 1 } })

    const r2 = await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'b' } }])
    expect(r2.versions).toEqual({ t1: 3 })

    const r3 = await transport.push<Todo>('Todo', [{ id: 't2', type: 'delete', baseVersion: 1 }])
    expect(r3.success).toBe(true)
    expect(r3.versions).toEqual({})
    expect(transport.getServerVersion('Todo', 't2')).toBeUndefined()
    expect((await transport.pull('Todo')).versions).toEqual({ t1: 3 })
  })

  it('never reuses a version when a deleted row is re-created', async () => {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])
    await transport.push<Todo>('Todo', [{ id: 't1', type: 'delete' }])
    const created = await transport.push<Todo>('Todo', [
      { id: 't1', type: 'insert', data: { id: 't1', title: 'again' } },
    ])
    expect(created.versions).toEqual({ t1: 2 })

    // A base taken before the delete no longer matches.
    const stale = await transport.push<Todo>('Todo', [
      { id: 't1', type: 'update', data: { title: 'old' }, baseVersion: 1 },
    ])
    expect(stale.success).toBe(false)
    expect(stale.conflicts?.[0]).toMatchObject({ id: 't1', serverVersion: 2 })
  })

  it('applies a mutation without baseVersion unconditionally', async () => {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])
    await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'a' } }])
    const result = await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'b' } }])
    expect(result.success).toBe(true)
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'b' }])
  })

  it('reports a conflict instead of applying a mutation with a stale baseVersion', async () => {
    const transport = new MockTransport({ versioned: true })
    transport.setServerData('Todo', [{ id: 't1', title: 'one' }])
    await transport.push<Todo>('Todo', [{ id: 't1', type: 'update', data: { title: 'other' } }])

    const stale: MergedMutation<Todo> = { id: 't1', type: 'update', data: { title: 'mine' }, baseVersion: 1 }
    const result = await transport.push<Todo>('Todo', [stale])

    expect(result.success).toBe(false)
    expect(result.conflicts).toEqual([
      {
        id: 't1',
        serverRow: { id: 't1', title: 'other' },
        serverVersion: 2,
        clientMutation: stale,
      },
    ])
    expect(transport.serverData.get('Todo')).toEqual([{ id: 't1', title: 'other' }])
    expect(transport.getServerVersion('Todo', 't1')).toBe(2)
  })
})
