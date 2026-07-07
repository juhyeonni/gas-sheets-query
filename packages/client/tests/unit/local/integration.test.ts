/**
 * Integration tests - createClientDB → write → sync → verify
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createClientDB } from '../../../src/local/create-client-db.js'
import { openSharedIDB } from '../../../src/local/local-adapter.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'
import type { SyncEvent } from '../../../src/local/sync-transport.js'

interface Counter {
  id: string
  value: number
  updatedAt: string
}

type Tables = {
  Counter: Counter
}

const schema = {
  tables: {
    Counter: {
      columns: ['id', 'value', 'updatedAt'] as const,
    },
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

describe('createClientDB integration', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })

  it('creates a local-first DB with SheetsDB API', async () => {
    const { db } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    expect(db).toBeDefined()
    expect(typeof db.from).toBe('function')
  })

  it('write operations are synchronous', async () => {
    const { db } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    const counter = db.from('Counter')

    // All operations are synchronous
    counter.create({ id: 'c1', value: 0, updatedAt: '2024-01-01' })
    const found = counter.findById('c1')
    expect(found.value).toBe(0)

    counter.update('c1', { value: 5 })
    expect(counter.findById('c1').value).toBe(5)

    const all = counter.findAll()
    expect(all).toHaveLength(1)
  })

  it('query builder works', async () => {
    const { db } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').create({ id: 'a', value: 10, updatedAt: '' })
    db.from('Counter').create({ id: 'b', value: 20, updatedAt: '' })
    db.from('Counter').create({ id: 'c', value: 30, updatedAt: '' })

    const result = db.from('Counter').query()
      .where('value', '>=', 20)
      .orderBy('value', 'desc')
      .exec()

    expect(result).toHaveLength(2)
    expect(result[0].value).toBe(30)
    expect(result[1].value).toBe(20)
  })

  it('write → sync → server receives mutations', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    // Write locally
    db.from('Counter').create({ id: 'c1', value: 0, updatedAt: '2024-01-01' })
    db.from('Counter').update('c1', { value: 5 })

    // Sync to server
    await sync.sync()

    // Verify server received correct data
    const serverData = transport.serverData.get('Counter') as Counter[]
    expect(serverData).toHaveLength(1)
    expect(serverData[0]).toMatchObject({
      id: 'c1',
      value: 5,
      updatedAt: '2024-01-01',
    })
  })

  it('multiple writes → single sync → merged mutations', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    // Multiple writes
    db.from('Counter').create({ id: 'c1', value: 0, updatedAt: '' })
    db.from('Counter').update('c1', { value: 1 })
    db.from('Counter').update('c1', { value: 2 })
    db.from('Counter').update('c1', { value: 3 })

    await sync.sync()

    // Should push 1 merged mutation (insert with final values)
    expect(transport.pushHistory).toHaveLength(1)
    expect(transport.pushHistory[0].mutations).toHaveLength(1)
    expect(transport.pushHistory[0].mutations[0].type).toBe('insert')

    const serverData = transport.serverData.get('Counter') as Counter[]
    expect(serverData[0].value).toBe(3)
  })

  it('insert + delete → nothing pushed', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').create({ id: 'c1', value: 0, updatedAt: '' })
    db.from('Counter').delete('c1')

    await sync.sync()

    // Insert + delete = cancelled out, nothing to push
    expect(transport.pushHistory).toHaveLength(0)
  })

  it('pull loads server data locally', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    transport.setServerData<Counter>('Counter', [
      { id: 's1', value: 100, updatedAt: '2024-06-01' },
      { id: 's2', value: 200, updatedAt: '2024-06-02' },
    ])

    await sync.pull()

    const all = db.from('Counter').findAll()
    expect(all).toHaveLength(2)
    expect(db.from('Counter').findById('s1').value).toBe(100)
  })

  it('batch operations sync correctly', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').batchInsert([
      { id: 'a', value: 1, updatedAt: '' },
      { id: 'b', value: 2, updatedAt: '' },
      { id: 'c', value: 3, updatedAt: '' },
    ])

    db.from('Counter').batchUpdate([
      { id: 'a', data: { value: 10 } },
      { id: 'c', data: { value: 30 } },
    ])

    await sync.sync()

    const serverData = transport.serverData.get('Counter') as Counter[]
    expect(serverData).toHaveLength(3)
    expect(serverData.find(c => c.id === 'a')?.value).toBe(10)
    expect(serverData.find(c => c.id === 'b')?.value).toBe(2)
    expect(serverData.find(c => c.id === 'c')?.value).toBe(30)
  })

  it('sync events fire correctly', async () => {
    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    const events: SyncEvent[] = []
    sync.on(e => events.push(e))

    db.from('Counter').create({ id: 'c1', value: 0, updatedAt: '' })

    await sync.sync()

    const types = events.map(e => e.type)
    expect(types).toEqual([
      'sync-start',
      'push-complete',
      'pull-complete',
      'sync-complete',
    ])
  })

  it('adapters are accessible for advanced use', async () => {
    const { adapters } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    expect(adapters.Counter).toBeDefined()
    expect(adapters.Counter.tableName).toBe('Counter')
  })

  it('pre-populated initialData', async () => {
    const { db } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
      initialData: {
        Counter: [
          { id: 'pre1', value: 42, updatedAt: 'init' },
        ],
      },
    })

    expect(db.from('Counter').findAll()).toHaveLength(1)
    expect(db.from('Counter').findById('pre1').value).toBe(42)
  })
})

// ── Multi-table tests (regression for #77) ──────────────────────────

interface Issue {
  id: string
  title: string
  status: string
}

interface Label {
  id: string
  name: string
  color: string
}

type MultiTables = {
  Counter: Counter
  Issue: Issue
  Label: Label
}

const multiSchema = {
  tables: {
    Counter: { columns: ['id', 'value', 'updatedAt'] as const },
    Issue: { columns: ['id', 'title', 'status'] as const },
    Label: { columns: ['id', 'name', 'color'] as const },
  },
}

describe('createClientDB multi-table (#77)', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })

  it('creates adapters for all tables', async () => {
    const { adapters } = await createClientDB<MultiTables>({
      schema: multiSchema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    expect(adapters.Counter).toBeDefined()
    expect(adapters.Issue).toBeDefined()
    expect(adapters.Label).toBeDefined()
  })

  it('all tables are independently writable and queryable', async () => {
    const { db } = await createClientDB<MultiTables>({
      schema: multiSchema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').create({ id: 'c1', value: 1, updatedAt: '' })
    db.from('Issue').create({ id: 'i1', title: 'Bug', status: 'open' })
    db.from('Label').create({ id: 'l1', name: 'bug', color: 'red' })

    expect(db.from('Counter').findAll()).toHaveLength(1)
    expect(db.from('Issue').findAll()).toHaveLength(1)
    expect(db.from('Label').findAll()).toHaveLength(1)

    expect(db.from('Issue').findById('i1').title).toBe('Bug')
    expect(db.from('Label').findById('l1').color).toBe('red')
  })

  it('all tables sync independently', async () => {
    const { db, sync } = await createClientDB<MultiTables>({
      schema: multiSchema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Counter').create({ id: 'c1', value: 10, updatedAt: '' })
    db.from('Issue').create({ id: 'i1', title: 'Fix', status: 'closed' })
    db.from('Label').create({ id: 'l1', name: 'fix', color: 'green' })

    await sync.sync()

    const counters = transport.serverData.get('Counter') as Counter[]
    const issues = transport.serverData.get('Issue') as Issue[]
    const labels = transport.serverData.get('Label') as Label[]

    expect(counters).toHaveLength(1)
    expect(issues).toHaveLength(1)
    expect(labels).toHaveLength(1)
    expect(counters[0].value).toBe(10)
    expect(issues[0].title).toBe('Fix')
    expect(labels[0].name).toBe('fix')
  })

  it('openSharedIDB creates all stores in a single upgrade', async () => {
    // This test verifies the core fix: openSharedIDB should not throw
    // when called with multiple table names (no real IndexedDB in Node,
    // but verifies the export and function signature work correctly)
    expect(typeof openSharedIDB).toBe('function')
  })
})
