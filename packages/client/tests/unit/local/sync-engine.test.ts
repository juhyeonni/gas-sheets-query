/**
 * SyncEngine tests - pull/push/reconcile with MockTransport
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalAdapter } from '../../../src/local/local-adapter.js'
import { SyncEngine } from '../../../src/local/sync-engine.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type { SyncEvent } from '../../../src/local/sync-transport.js'

interface Todo {
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

function createSetup() {
  const transport = new MockTransport()
  const adapter = new LocalAdapter<Todo>({
    tableName: 'Todo',
    idMode: 'client',
    disableIDB: true,
    mutationStorage: createMemoryStorage(),
  })
  const sync = new SyncEngine({ transport })
  sync.registerTable('Todo', adapter, adapter.queue)
  return { transport, adapter, sync }
}

describe('SyncEngine', () => {
  let transport: MockTransport
  let adapter: LocalAdapter<Todo>
  let sync: SyncEngine

  beforeEach(() => {
    const setup = createSetup()
    transport = setup.transport
    adapter = setup.adapter
    sync = setup.sync
  })

  // ── Push ───────────────────────────────────────────────────────────

  describe('push', () => {
    it('pushes local mutations to server', async () => {
      adapter.insert({ id: 't1', title: 'Buy milk', done: false })
      adapter.update('t1', { done: true })

      await sync.push()

      expect(transport.pushHistory).toHaveLength(1)
      const pushed = transport.pushHistory[0]
      expect(pushed.tableName).toBe('Todo')
      expect(pushed.mutations).toHaveLength(1)
      expect(pushed.mutations[0].type).toBe('insert') // insert + update → insert
      expect(pushed.mutations[0].data).toMatchObject({ title: 'Buy milk', done: true })
    })

    it('clears queue after successful push', async () => {
      adapter.insert({ id: 't1', title: 'Test', done: false })
      await sync.push()
      expect(adapter.queue.hasPending).toBe(false)
    })

    it('does nothing when no pending mutations', async () => {
      await sync.push()
      expect(transport.pushHistory).toHaveLength(0)
    })

    it('server receives correct data after push', async () => {
      adapter.insert({ id: 't1', title: 'Task 1', done: false })
      adapter.insert({ id: 't2', title: 'Task 2', done: true })

      await sync.push()

      const serverData = transport.serverData.get('Todo') as Todo[]
      expect(serverData).toHaveLength(2)
      expect(serverData.find(t => t.id === 't1')?.title).toBe('Task 1')
      expect(serverData.find(t => t.id === 't2')?.done).toBe(true)
    })
  })

  // ── Pull ───────────────────────────────────────────────────────────

  describe('pull', () => {
    it('replaces local data with server data', async () => {
      transport.setServerData<Todo>('Todo', [
        { id: 's1', title: 'Server Task', done: false },
        { id: 's2', title: 'Server Task 2', done: true },
      ])

      await sync.pull()

      const local = adapter.findAll()
      expect(local).toHaveLength(2)
      expect(local.find(t => t.id === 's1')?.title).toBe('Server Task')
    })

    it('preserves pending local mutations during pull', async () => {
      // Local insert not yet pushed
      adapter.insert({ id: 'local1', title: 'Local only', done: false })

      // Server has different data
      transport.setServerData<Todo>('Todo', [
        { id: 's1', title: 'Server', done: true },
      ])

      await sync.pull()

      const local = adapter.findAll()
      // Should have both server data AND pending local insert
      expect(local).toHaveLength(2)
      expect(local.find(t => t.id === 'local1')?.title).toBe('Local only')
      expect(local.find(t => t.id === 's1')?.title).toBe('Server')
    })

    it('applies pending local updates on top of server data', async () => {
      // Setup: row exists on server
      transport.setServerData<Todo>('Todo', [
        { id: 't1', title: 'Original', done: false },
      ])
      await sync.pull()

      // Local update (not yet pushed)
      adapter.update('t1', { title: 'Modified locally' })

      // Pull again
      transport.setServerData<Todo>('Todo', [
        { id: 't1', title: 'Updated on server', done: false },
      ])
      await sync.pull()

      // Local update should be preserved on top of server data
      const t1 = adapter.findById('t1')
      expect(t1?.title).toBe('Modified locally')
    })
  })

  // ── Full sync ──────────────────────────────────────────────────────

  describe('sync (push + pull)', () => {
    it('push first, then pull', async () => {
      adapter.insert({ id: 't1', title: 'Local', done: false })

      transport.setServerData<Todo>('Todo', [
        { id: 's1', title: 'Server', done: true },
      ])

      await sync.sync()

      // Local data pushed
      expect(transport.pushHistory).toHaveLength(1)

      // Server data now includes our pushed mutation + existing
      const server = transport.serverData.get('Todo') as Todo[]
      expect(server.find(t => t.id === 't1')).toBeDefined()
    })

    it('prevents concurrent syncs', async () => {
      adapter.insert({ id: 't1', title: 'Test', done: false })

      // Start two syncs simultaneously
      const p1 = sync.sync()
      const p2 = sync.sync()

      await Promise.all([p1, p2])

      // Only one push should have happened
      expect(transport.pushHistory.length).toBeLessThanOrEqual(1)
    })
  })

  // ── Events ─────────────────────────────────────────────────────────

  describe('events', () => {
    it('emits sync events in order', async () => {
      const events: SyncEvent[] = []
      sync.on(e => events.push(e))

      adapter.insert({ id: 't1', title: 'Test', done: false })
      transport.setServerData<Todo>('Todo', [])

      await sync.sync()

      const types = events.map(e => e.type)
      expect(types).toContain('sync-start')
      expect(types).toContain('push-complete')
      expect(types).toContain('pull-complete')
      expect(types).toContain('sync-complete')
    })

    it('emits error event on failure', async () => {
      const events: SyncEvent[] = []
      sync.on(e => events.push(e))

      adapter.insert({ id: 't1', title: 'Test', done: false })
      transport.pushShouldFail = true

      await expect(sync.sync()).rejects.toThrow()

      const errorEvent = events.find(e => e.type === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent?.error).toBeInstanceOf(Error)
    })

    it('unsubscribe works', async () => {
      const events: SyncEvent[] = []
      const unsub = sync.on(e => events.push(e))

      adapter.insert({ id: 't1', title: 'Test', done: false })
      await sync.push()

      unsub()
      adapter.insert({ id: 't2', title: 'Test2', done: false })
      await sync.push()

      // Only events from first push
      const pushEvents = events.filter(e => e.type === 'push-complete')
      expect(pushEvents).toHaveLength(1)
    })

    it('push-complete includes pushedCount', async () => {
      const events: SyncEvent[] = []
      sync.on(e => events.push(e))

      adapter.insert({ id: 't1', title: 'A', done: false })
      adapter.insert({ id: 't2', title: 'B', done: false })
      await sync.push()

      const pushEvent = events.find(e => e.type === 'push-complete')
      expect(pushEvent?.pushedCount).toBe(2)
    })

    it('pull-complete includes pulledCount', async () => {
      const events: SyncEvent[] = []
      sync.on(e => events.push(e))

      transport.setServerData<Todo>('Todo', [
        { id: 's1', title: 'A', done: false },
        { id: 's2', title: 'B', done: true },
      ])
      await sync.pull()

      const pullEvent = events.find(e => e.type === 'pull-complete')
      expect(pullEvent?.pulledCount).toBe(2)
    })
  })

  // ── Conflict resolution ────────────────────────────────────────────

  describe('conflict resolution', () => {
    it('server-wins by default', async () => {
      adapter.insert({ id: 't1', title: 'Local version', done: false })

      transport.conflictGenerator = (() => [
        {
          id: 't1',
          serverRow: { id: 't1', title: 'Server version', done: true },
          clientMutation: { id: 't1', type: 'insert' as const, data: { id: 't1', title: 'Local version', done: false } },
        },
      ]) as any

      await sync.push()

      // Server wins: local data should be replaced with server version
      const t1 = adapter.findById('t1')
      expect(t1?.title).toBe('Server version')
    })

    it('client-wins strategy', async () => {
      const clientWinsSync = new SyncEngine({
        transport,
        conflictStrategy: 'client-wins',
      })
      clientWinsSync.registerTable('Todo', adapter, adapter.queue)

      adapter.insert({ id: 't1', title: 'Local version', done: false })

      transport.conflictGenerator = (() => [
        {
          id: 't1',
          serverRow: { id: 't1', title: 'Server version', done: true },
          clientMutation: { id: 't1', type: 'insert' as const, data: { id: 't1', title: 'Local version', done: false } },
        },
      ]) as any

      await clientWinsSync.push()

      // Client wins: local data should remain
      const t1 = adapter.findById('t1')
      expect(t1?.title).toBe('Local version')
    })

    it('custom conflict resolver', async () => {
      const customSync = new SyncEngine({
        transport,
        conflictStrategy: ((conflict: any) => ({
          ...conflict.serverRow,
          title: `Merged: ${conflict.serverRow.title}`,
        })) as any,
      })
      customSync.registerTable('Todo', adapter, adapter.queue)

      adapter.insert({ id: 't1', title: 'Local', done: false })

      transport.conflictGenerator = (() => [
        {
          id: 't1',
          serverRow: { id: 't1', title: 'Server', done: true },
          clientMutation: { id: 't1', type: 'insert' as const, data: { id: 't1', title: 'Local', done: false } },
        },
      ]) as any

      await customSync.push()

      const t1 = adapter.findById('t1')
      expect(t1?.title).toBe('Merged: Server')
    })
  })

  // ── Auto-sync ──────────────────────────────────────────────────────

  describe('auto-sync', () => {
    it('starts and stops auto-sync', () => {
      sync.startAutoSync(1000)
      sync.stopAutoSync()
      // No error = success
    })

    it('dispose cleans up', () => {
      sync.startAutoSync(1000)
      sync.dispose()
      // No error = success
    })
  })

  // ── Debounce ───────────────────────────────────────────────────────

  describe('push debounce', () => {
    it('schedulePush debounces', async () => {
      const debouncedSync = new SyncEngine({
        transport,
        pushDebounceMs: 50,
      })
      debouncedSync.registerTable('Todo', adapter, adapter.queue)

      adapter.insert({ id: 't1', title: 'Test', done: false })
      debouncedSync.schedulePush()
      debouncedSync.schedulePush() // Should cancel previous

      // Wait for debounce
      await new Promise(r => setTimeout(r, 100))

      expect(transport.pushHistory).toHaveLength(1)
      debouncedSync.dispose()
    })

    it('schedulePush does nothing when debounceMs is 0', () => {
      sync.schedulePush()
      // No timer set, no push
      expect(transport.pushHistory).toHaveLength(0)
    })
  })
})
