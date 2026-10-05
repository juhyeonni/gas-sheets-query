/**
 * #199 — one runtime schema drives `@default` / `@updatedAt` on both client
 * paths: `createClientFactory` (server) and `createClientDB` (local-first).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClientFactory, type GeneratedSchema } from '../../src/runtime.js'
import { createClientDB } from '../../src/local/create-client-db.js'
import { MockTransport } from '../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../src/local/mutation-queue.js'

interface Task {
  id: string | number
  title: string
  status: string
  done: boolean
  createdAt: Date
  updatedAt: Date
}

interface Note {
  id: string | number
  body: string
}

type Tables = { Task: Task; Note: Note }

interface TaskCreateInput {
  id?: string | number
  title: string
  status?: string
  done?: boolean
  createdAt?: Date
  updatedAt?: Date
}

type CreateInputs = { Task: TaskCreateInput }

const schema: GeneratedSchema = {
  tables: {
    Task: {
      columns: ['id', 'title', 'status', 'done', 'createdAt', 'updatedAt'] as const,
      columnTypes: { createdAt: 'date', updatedAt: 'date' },
      defaults: {
        status: { kind: 'value', value: 'open' },
        done: { kind: 'value', value: false },
        createdAt: { kind: 'now' }
      },
      updatedAt: ['updatedAt']
    },
    Note: {
      columns: ['id', 'body'] as const
    }
  }
}

const T0 = new Date('2026-03-01T00:00:00.000Z')
const T1 = new Date('2026-03-02T00:00:00.000Z')

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createClientFactory applies runtime defaults (#199)', () => {
  it('AC1: create fills literal and `now` defaults and stamps @updatedAt', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const db = createClientFactory<Tables, CreateInputs>(schema)({ mock: true })

    const task = db.from('Task').create({ title: 'Write docs' })

    expect(task.status).toBe('open')
    expect(task.done).toBe(false)
    expect(task.createdAt).toBeInstanceOf(Date)
    expect(task.createdAt.getTime()).toBe(T0.getTime())
    expect(task.updatedAt.getTime()).toBe(T0.getTime())
    expect(db.from('Task').findById(task.id).status).toBe('open')
  })

  it('AC2: an explicit value wins over the default', () => {
    const db = createClientFactory<Tables, CreateInputs>(schema)({ mock: true })
    const task = db.from('Task').create({ title: 'x', status: '', done: true })
    expect(task.status).toBe('')
    expect(task.done).toBe(true)
  })

  it('AC4: update stamps @updatedAt and applies no defaults', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const db = createClientFactory<Tables, CreateInputs>(schema)({ mock: true })
    const task = db.from('Task').create({ title: 'x', status: 'doing' })

    vi.setSystemTime(T1)
    const updated = db.from('Task').update(task.id, { title: 'y' })

    expect(updated.updatedAt.getTime()).toBe(T1.getTime())
    expect(updated.createdAt.getTime()).toBe(T0.getTime())
    expect(updated.status).toBe('doing')
  })

  it('AC8: a table without defaults is written as given', () => {
    const db = createClientFactory<Tables, CreateInputs>(schema)({ mock: true })
    const note = db.from('Note').create({ body: 'hi' })
    expect(note).toEqual({ id: note.id, body: 'hi' })
  })

  it('forwards defaults to custom stores too', async () => {
    const { MockAdapter } = await import('@gsquery/core')
    const db = createClientFactory<Tables, CreateInputs>(schema)({
      stores: { Task: new MockAdapter(), Note: new MockAdapter() }
    })
    expect(db.from('Task').create({ title: 'x' }).status).toBe('open')
  })
})

describe('createClientDB applies the same runtime defaults (#199)', () => {
  it('AC9: create fills defaults and stamps @updatedAt; update stamps without defaults', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const { db, close } = await createClientDB<Tables, CreateInputs>({
      schema,
      transport: new MockTransport(),
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    const task = db.from('Task').create({ id: 't1', title: 'Local' })

    expect(task.status).toBe('open')
    expect(task.done).toBe(false)
    expect(task.createdAt.getTime()).toBe(T0.getTime())
    expect(task.updatedAt.getTime()).toBe(T0.getTime())

    vi.setSystemTime(T1)
    const updated = db.from('Task').update('t1', { title: 'Local 2' })
    expect(updated.updatedAt.getTime()).toBe(T1.getTime())
    expect(updated.createdAt.getTime()).toBe(T0.getTime())
    expect(updated.status).toBe('open')

    const rows = db.from('Task').batchInsert([
      { id: 't2', title: 'a' },
      { id: 't3', title: 'b', status: 'closed' }
    ])
    expect(rows.map(r => r.status)).toEqual(['open', 'closed'])
    expect(rows[0].updatedAt.getTime()).toBe(rows[1].updatedAt.getTime())

    const note = db.from('Note').create({ id: 'n1', body: 'plain' })
    expect(note).toEqual({ id: 'n1', body: 'plain' })

    await close()
  })

  it('AC9: the queued insert carries the filled defaults', async () => {
    const { db, adapters, close } = await createClientDB<Tables, CreateInputs>({
      schema,
      transport: new MockTransport(),
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Task').create({ id: 't1', title: 'Queued' })

    const merged = adapters.Task.queue.getMerged()
    expect(merged).toHaveLength(1)
    const row = merged[0].data as Record<string, unknown>
    expect(merged[0].type).toBe('insert')
    expect(row.status).toBe('open')
    expect(row.updatedAt).toBeDefined()

    await close()
  })
})
