/**
 * #199 — `@default` / `@updatedAt` applied at runtime, once, in Repository.
 *
 * The runtime schema carries `defaults` (literal or `now`) and `updatedAt`
 * field lists. Repository fills absent fields on insert and stamps
 * `@updatedAt` on insert and update; a value the caller supplies always wins.
 * Without either field, Repository behaves exactly as before.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { Repository } from '../../src/core/repository'
import { createSheetsDB } from '../../src/core/sheets-db'
import { ValidationError } from '../../src/core/errors'
import type { ColumnDefault, DataStore, RowWithId } from '../../src/core/types'

interface Task extends RowWithId {
  id: string | number
  title: string
  status: string | null
  priority: number
  done: boolean
  note: string
  createdAt: Date
  updatedAt: Date
}

const defaults: Record<string, ColumnDefault> = {
  status: { kind: 'value', value: 'open' },
  priority: { kind: 'value', value: 3 },
  done: { kind: 'value', value: false },
  note: { kind: 'value', value: 'n/a' },
  createdAt: { kind: 'now' }
}
const updatedAt = ['updatedAt'] as const

const T0 = new Date('2026-01-01T00:00:00.000Z')
const T1 = new Date('2026-01-02T00:00:00.000Z')

function makeRepo(options: { idMode?: 'auto' | 'client'; initialData?: Task[] } = {}) {
  const store = new MockAdapter<Task>({ idMode: options.idMode ?? 'auto', initialData: options.initialData })
  const repo = new Repository<Task, Partial<Task> & { title: string }>(store, 'tasks', { defaults, updatedAt })
  return { store, repo }
}

function existingTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Existing',
    status: 'doing',
    priority: 1,
    done: false,
    note: 'keep me',
    createdAt: new Date('2025-06-01T00:00:00.000Z'),
    updatedAt: new Date('2025-06-01T00:00:00.000Z'),
    ...overrides
  }
}

/**
 * Replace the global Date with one whose argument-less construction moves one
 * second forward each time, so code that reads the clock per row is caught.
 */
function stubTickingDate(): void {
  const RealDate = Date
  let tick = 0
  class TickingDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(RealDate.UTC(2026, 0, 1) + (tick += 1000))
      } else {
        super(value)
      }
    }
  }
  vi.stubGlobal('Date', TickingDate)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Repository defaults on insert (#199)', () => {
  it('AC1: fills missing literal defaults and a `now` default taken at call time', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const { store, repo } = makeRepo()

    const created = repo.create({ title: 'Write spec' })

    expect(created.status).toBe('open')
    expect(created.priority).toBe(3)
    expect(created.done).toBe(false)
    expect(created.note).toBe('n/a')
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.createdAt.getTime()).toBe(T0.getTime())

    const stored = store.findById(created.id)!
    expect(stored.status).toBe('open')
    expect(stored.priority).toBe(3)
    expect(stored.createdAt).toBeInstanceOf(Date)
    expect(stored.createdAt.getTime()).toBe(T0.getTime())
  })

  it('AC1: an `undefined` value counts as missing', () => {
    const { repo } = makeRepo()
    const created = repo.create({ title: 'x', status: undefined, priority: undefined })
    expect(created.status).toBe('open')
    expect(created.priority).toBe(3)
  })

  it('AC2: keeps explicit null, false, 0 and empty string', () => {
    const { store, repo } = makeRepo()

    const created = repo.create({ title: 'x', status: null, priority: 0, done: false, note: '' })

    expect(created.status).toBeNull()
    expect(created.priority).toBe(0)
    expect(created.done).toBe(false)
    expect(created.note).toBe('')
    const stored = store.findById(created.id)!
    expect(stored.status).toBeNull()
    expect(stored.priority).toBe(0)
    expect(stored.note).toBe('')
  })

  it('AC2: keeps any other explicit value, including an explicit `now` field', () => {
    const { repo } = makeRepo()
    const createdAt = new Date('2020-05-05T00:00:00.000Z')

    const created = repo.create({ title: 'x', status: 'closed', priority: 9, done: true, createdAt })

    expect(created.status).toBe('closed')
    expect(created.priority).toBe(9)
    expect(created.done).toBe(true)
    expect(created.createdAt.getTime()).toBe(createdAt.getTime())
  })

  it('AC1: batchInsert fills defaults on every row', () => {
    const { repo } = makeRepo()
    const rows = repo.batchInsert([{ title: 'a' }, { title: 'b', status: 'closed' }])
    expect(rows.map(r => r.status)).toEqual(['open', 'closed'])
    expect(rows.every(r => r.priority === 3)).toBe(true)
  })
})

describe('Repository @updatedAt on insert (#199)', () => {
  it('AC3: create stamps an absent @updatedAt with a Date', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const { repo } = makeRepo()

    const created = repo.create({ title: 'x' })

    expect(created.updatedAt).toBeInstanceOf(Date)
    expect(created.updatedAt.getTime()).toBe(T0.getTime())
  })

  it('AC3: create keeps a caller-supplied @updatedAt', () => {
    const { repo } = makeRepo()
    const given = new Date('2019-01-01T00:00:00.000Z')
    const created = repo.create({ title: 'x', updatedAt: given })
    expect(created.updatedAt.getTime()).toBe(given.getTime())
  })

  it('AC3: all rows of one batchInsert share the same instant', () => {
    const { repo } = makeRepo()
    // Every `new Date()` reads a later instant: one shared stamp must not depend on it
    stubTickingDate()

    const rows = repo.batchInsert([{ title: 'a' }, { title: 'b' }, { title: 'c' }])

    const stamps = rows.map(r => r.updatedAt.getTime())
    const created = rows.map(r => r.createdAt.getTime())
    expect(new Set(stamps).size).toBe(1)
    expect(new Set(created).size).toBe(1)
    expect(stamps[0]).toBe(created[0])
  })

  it('AC3: batchInsert rows do not share one mutable Date object', () => {
    const { repo } = makeRepo()
    const rows = repo.batchInsert([{ title: 'a' }, { title: 'b' }])
    expect(rows[0].updatedAt).not.toBe(rows[1].updatedAt)
    expect(rows[0].createdAt).not.toBe(rows[0].updatedAt)
  })
})

describe('Repository @updatedAt on update (#199)', () => {
  it('AC4: update stamps a new Date when the patch omits @updatedAt', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T1)
    const { store, repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })

    const updated = repo.update('t1', { title: 'Renamed' })

    expect(updated.updatedAt).toBeInstanceOf(Date)
    expect(updated.updatedAt.getTime()).toBe(T1.getTime())
    expect(store.findById('t1')!.updatedAt.getTime()).toBe(T1.getTime())
  })

  it('AC4: update keeps the caller value when the patch sets @updatedAt', () => {
    const { repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })
    const given = new Date('2024-02-02T00:00:00.000Z')

    const updated = repo.update('t1', { title: 'Renamed', updatedAt: given })

    expect(updated.updatedAt.getTime()).toBe(given.getTime())
  })

  it('AC4: update does not apply defaults', () => {
    const { repo } = makeRepo({
      idMode: 'client',
      initialData: [existingTask({ status: 'doing', priority: 1, note: 'keep me' })]
    })

    const updated = repo.update('t1', { title: 'Renamed' })

    expect(updated.status).toBe('doing')
    expect(updated.priority).toBe(1)
    expect(updated.note).toBe('keep me')
    expect(updated.createdAt.getTime()).toBe(new Date('2025-06-01T00:00:00.000Z').getTime())
  })

  it('AC4: updateOrNull stamps too', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T1)
    const { repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })
    expect(repo.updateOrNull('t1', { title: 'y' })!.updatedAt.getTime()).toBe(T1.getTime())
    expect(repo.updateOrNull('missing', { title: 'y' })).toBeUndefined()
  })

  it('AC4: batchUpdate stamps omitted @updatedAt, keeps a supplied one, applies no defaults', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T1)
    const given = new Date('2024-02-02T00:00:00.000Z')
    const { repo } = makeRepo({
      idMode: 'client',
      initialData: [existingTask({ id: 'a' }), existingTask({ id: 'b' })]
    })

    const rows = repo.batchUpdate([
      { id: 'a', data: { title: 'A' } },
      { id: 'b', data: { title: 'B', updatedAt: given } }
    ])

    const a = rows.find(r => r.id === 'a')!
    const b = rows.find(r => r.id === 'b')!
    expect(a.updatedAt.getTime()).toBe(T1.getTime())
    expect(b.updatedAt.getTime()).toBe(given.getTime())
    expect(a.status).toBe('doing')
    expect(a.note).toBe('keep me')
  })

  it('AC4: batchUpdate stamps every omitted row with one instant (fallback path too)', () => {
    const inner = new MockAdapter<Task>({
      idMode: 'client',
      initialData: [existingTask({ id: 'a' }), existingTask({ id: 'b' })]
    })
    // A store without batchUpdate exercises the one-by-one fallback
    const store: DataStore<Task> = {
      idMode: inner.idMode,
      findAll: () => inner.findAll(),
      find: o => inner.find(o),
      findById: id => inner.findById(id),
      insert: d => inner.insert(d),
      update: (id, d) => inner.update(id, d),
      delete: id => inner.delete(id)
    }
    const repo = new Repository<Task>(store, 'tasks', { defaults, updatedAt })
    stubTickingDate()

    const rows = repo.batchUpdate([
      { id: 'a', data: { title: 'A' } },
      { id: 'b', data: { title: 'B' } }
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0].updatedAt.getTime()).not.toBe(existingTask().updatedAt.getTime())
    expect(rows[0].updatedAt.getTime()).toBe(rows[1].updatedAt.getTime())
  })
})

describe('Repository.upsert with defaults (#199)', () => {
  it('AC5: upsert on an existing row stamps @updatedAt and leaves fields outside the patch unchanged', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T1)
    const { store, repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })

    const result = repo.upsert({ id: 't1', title: 'Patched' })

    expect(result.title).toBe('Patched')
    expect(result.updatedAt.getTime()).toBe(T1.getTime())
    expect(result.status).toBe('doing')
    expect(result.priority).toBe(1)
    expect(result.note).toBe('keep me')
    expect(result.createdAt.getTime()).toBe(new Date('2025-06-01T00:00:00.000Z').getTime())
    expect(store.findAll()).toHaveLength(1)
  })

  it('AC5: upsert that inserts (client id) applies defaults and the stamp', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const { store, repo } = makeRepo({ idMode: 'client' })

    const result = repo.upsert({ id: 'new', title: 'Fresh' })

    expect(result.id).toBe('new')
    expect(result.status).toBe('open')
    expect(result.priority).toBe(3)
    expect(result.createdAt.getTime()).toBe(T0.getTime())
    expect(result.updatedAt.getTime()).toBe(T0.getTime())
    expect(store.findById('new')!.status).toBe('open')
  })

  it('AC5: upsert without an id inserts with defaults and the stamp', () => {
    const { repo } = makeRepo()
    const result = repo.upsert({ title: 'No id' })
    expect(result.status).toBe('open')
    expect(result.updatedAt).toBeInstanceOf(Date)
  })

  it('AC5: upsert keeps a caller-supplied @updatedAt on update', () => {
    const { repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })
    const given = new Date('2024-03-03T00:00:00.000Z')
    expect(repo.upsert({ id: 't1', updatedAt: given }).updatedAt.getTime()).toBe(given.getTime())
  })

  it('AC5: upsert with an unknown id in an auto store still refuses', () => {
    const { repo } = makeRepo({ idMode: 'auto' })
    expect(() => repo.upsert({ id: 999, title: 'x' })).toThrow(ValidationError)
  })
})

describe('Defaults never fill id (#199)', () => {
  it('AC6: an `id` default is ignored; auto idMode allocates as before', () => {
    const store = new MockAdapter<Task>({ idMode: 'auto' })
    const repo = new Repository<Task, Partial<Task>>(store, 'tasks', {
      defaults: { ...defaults, id: { kind: 'value', value: 'fixed' } },
      updatedAt: ['updatedAt', 'id']
    })

    const a = repo.create({ title: 'a' })
    const b = repo.create({ title: 'b' })

    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
  })

  it('AC6: client idMode keeps the caller id and rejects none', () => {
    const store = new MockAdapter<Task>({ idMode: 'client' })
    const repo = new Repository<Task, Partial<Task>>(store, 'tasks', {
      defaults: { id: { kind: 'now' } },
      updatedAt: ['id']
    })

    const row = repo.create({ id: 'abc', title: 'x' })
    expect(row.id).toBe('abc')

    // The default does not supply a missing client id: the store still refuses
    expect(() => repo.create({ title: 'y' })).toThrow(/ID is required in client mode/)
  })

  it('AC6: update never stamps id', () => {
    const { repo } = makeRepo({ idMode: 'client', initialData: [existingTask()] })
    const repoWithIdStamp = new Repository<Task>(
      new MockAdapter<Task>({ idMode: 'client', initialData: [existingTask()] }),
      'tasks',
      { updatedAt: ['id', 'updatedAt'] }
    )
    expect(repoWithIdStamp.update('t1', { title: 'z' }).id).toBe('t1')
    expect(repo.update('t1', { title: 'z' }).id).toBe('t1')
  })
})

describe('Caller inputs are never mutated (#199)', () => {
  it('AC7: create, update, upsert, batchInsert and batchUpdate leave their arguments unchanged', () => {
    const { repo } = makeRepo({
      idMode: 'client',
      initialData: [existingTask({ id: 'u1' }), existingTask({ id: 'u2' })]
    })

    const createInput = { id: 'c1', title: 'c' }
    const updateInput = { title: 'u' }
    const upsertUpdateInput = { id: 'u1', title: 'uu' }
    const upsertInsertInput = { id: 'n1', title: 'ui' }
    const batchInsertInput = [{ id: 'b1', title: 'b1' }, { id: 'b2', title: 'b2', status: undefined }]
    const batchUpdateInput = [{ id: 'u2', data: { title: 'bu' } }]

    const snapshot = JSON.stringify([
      createInput, updateInput, upsertUpdateInput, upsertInsertInput, batchInsertInput, batchUpdateInput
    ])
    const batchInsertKeys = batchInsertInput.map(r => Object.keys(r))

    repo.create(createInput)
    repo.update('u1', updateInput)
    repo.upsert(upsertUpdateInput)
    repo.upsert(upsertInsertInput)
    repo.batchInsert(batchInsertInput)
    repo.batchUpdate(batchUpdateInput)

    expect(JSON.stringify([
      createInput, updateInput, upsertUpdateInput, upsertInsertInput, batchInsertInput, batchUpdateInput
    ])).toBe(snapshot)
    expect(Object.keys(createInput)).toEqual(['id', 'title'])
    expect(Object.keys(updateInput)).toEqual(['title'])
    expect(Object.keys(upsertUpdateInput)).toEqual(['id', 'title'])
    expect(Object.keys(upsertInsertInput)).toEqual(['id', 'title'])
    expect(batchInsertInput.map(r => Object.keys(r))).toEqual(batchInsertKeys)
    expect(Object.keys(batchUpdateInput[0].data)).toEqual(['title'])
  })
})

describe('No defaults declared behaves as before (#199)', () => {
  it('AC8: Repository without options passes inputs through untouched', () => {
    const inserted: unknown[] = []
    const updated: unknown[] = []
    const batched: unknown[] = []
    const batchUpdated: unknown[] = []
    const inner = new MockAdapter<Task>({ idMode: 'auto', initialData: [existingTask()] })
    const store: DataStore<Task> = {
      idMode: 'auto',
      findAll: () => inner.findAll(),
      find: o => inner.find(o),
      findById: id => inner.findById(id),
      insert: d => { inserted.push(d); return inner.insert(d) },
      update: (id, d) => { updated.push(d); return inner.update(id, d) },
      delete: id => inner.delete(id),
      batchInsert: d => { batched.push(d); return inner.batchInsert(d) },
      batchUpdate: items => { batchUpdated.push(items); return inner.batchUpdate(items) }
    }
    const repo = new Repository<Task>(store, 'tasks')

    const createInput = { title: 'x' } as unknown as Omit<Task, 'id'>
    const updateInput = { title: 'y' }
    const batchInput = [{ title: 'z' }] as unknown as Omit<Task, 'id'>[]
    const batchUpdateInput = [{ id: 't1', data: { title: 'w' } }]

    const created = repo.create(createInput)
    repo.update('t1', updateInput)
    repo.batchInsert(batchInput)
    repo.batchUpdate(batchUpdateInput)

    expect(inserted[0]).toBe(createInput)
    expect(updated[0]).toBe(updateInput)
    expect(batched[0]).toBe(batchInput)
    expect(batchUpdated[0]).toBe(batchUpdateInput)
    expect(created).toEqual({ id: created.id, title: 'x' })
  })

  it('AC8: empty defaults and updatedAt also pass inputs through untouched', () => {
    const store = new MockAdapter<Task>()
    const spy = vi.spyOn(store, 'insert')
    const repo = new Repository<Task>(store, 'tasks', { defaults: {}, updatedAt: [] })
    const input = { title: 'x' } as unknown as Omit<Task, 'id'>
    const created = repo.create(input)
    expect(spy.mock.calls[0][0]).toBe(input)
    expect(created).toEqual({ id: 1, title: 'x' })
  })

  it('AC8: createSheetsDB table without defaults/updatedAt writes exactly what it is given', () => {
    const db = createSheetsDB<{ tasks: Task }>({
      config: { tables: { tasks: { columns: ['id', 'title'] } } },
      stores: { tasks: new MockAdapter<Task>() }
    })
    const created = db.from('tasks').create({ title: 'x' } as unknown as Omit<Task, 'id'>)
    expect(created).toEqual({ id: 1, title: 'x' })
    const updated = db.from('tasks').update(1, { title: 'y' })
    expect(updated).toEqual({ id: 1, title: 'y' })
  })
})

describe('createSheetsDB forwards defaults and updatedAt (#199)', () => {
  it('hands each table its own defaults and @updatedAt fields', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    interface Tag extends RowWithId { id: number; label: string; color: string }
    const db = createSheetsDB<{ tasks: Task; tags: Tag }>({
      config: {
        tables: {
          tasks: {
            columns: ['id', 'title', 'status', 'priority', 'done', 'note', 'createdAt', 'updatedAt'],
            defaults,
            updatedAt
          },
          tags: { columns: ['id', 'label', 'color'], defaults: { color: { kind: 'value', value: 'grey' } } }
        }
      },
      stores: { tasks: new MockAdapter<Task>(), tags: new MockAdapter<Tag>() }
    })

    const task = db.from('tasks').create({ title: 'x' } as unknown as Omit<Task, 'id'>)
    const tag = db.from('tags').create({ label: 'red' } as unknown as Omit<Tag, 'id'>)

    expect(task.status).toBe('open')
    expect(task.updatedAt.getTime()).toBe(T0.getTime())
    expect(tag.color).toBe('grey')
    expect(tag).not.toHaveProperty('updatedAt')

    vi.setSystemTime(T1)
    expect(db.from('tasks').update(task.id, { title: 'y' }).updatedAt.getTime()).toBe(T1.getTime())
    expect(db.from('tasks').repo.batchInsert([{ title: 'b' } as unknown as Omit<Task, 'id'>])[0].status).toBe('open')
  })
})
