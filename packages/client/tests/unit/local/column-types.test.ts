/**
 * Local-first columnTypes deserialization (#135)
 *
 * The generated schema declares `datetime` columns as ColumnType 'date'. The
 * server path (SheetsAdapter) turns those into real Dates; the local-first path
 * must do the same for rows arriving from a pull, otherwise the model types
 * claim `Date` while the runtime value is an ISO string.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createClientDB } from '../../../src/local/create-client-db.js'
import type { ClientDBSchema } from '../../../src/local/create-client-db.js'
import type { GeneratedSchema } from '../../../src/runtime.js'
import { MockTransport } from '../../../src/transports/mock-transport.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Event {
  id: string
  title: string
  startsAt: Date
  tags: string[]
}

type Tables = {
  Event: Event
}

const schema = {
  tables: {
    Event: {
      columns: ['id', 'title', 'startsAt', 'tags'] as const,
      columnTypes: { startsAt: 'date', tags: 'string[]' },
      indexes: [{ fields: ['title'] }],
    },
  },
} satisfies ClientDBSchema

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

describe('createClientDB columnTypes', () => {
  let transport: MockTransport

  beforeEach(() => {
    transport = new MockTransport()
  })

  it('deserializes pulled date columns into Date instances', async () => {
    transport.setServerData('Event', [
      { id: 'e1', title: 'Launch', startsAt: '2024-03-01T10:00:00.000Z', tags: '["a","b"]' },
    ])

    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    await sync.pull()

    const event = db.from('Event').findById('e1')
    expect(event.startsAt).toBeInstanceOf(Date)
    expect((event.startsAt as Date).toISOString()).toBe('2024-03-01T10:00:00.000Z')
    expect(event.tags).toEqual(['a', 'b'])
  })

  it('keeps pending local mutations typed after a pull merge', async () => {
    transport.setServerData('Event', [
      { id: 'e1', title: 'Launch', startsAt: '2024-03-01T10:00:00.000Z', tags: '[]' },
    ])

    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    db.from('Event').create({
      id: 'e2',
      title: 'Local',
      startsAt: new Date('2024-05-05T00:00:00.000Z'),
      tags: [],
    })

    await sync.pull()

    expect(db.from('Event').findById('e1').startsAt).toBeInstanceOf(Date)
    // Locally created rows already hold a Date and must not be mangled
    expect(db.from('Event').findById('e2').startsAt).toBeInstanceOf(Date)
  })

  it('accepts a schema without columnTypes (backward compatible)', async () => {
    const plainSchema: ClientDBSchema = {
      tables: {
        Event: { columns: ['id', 'title', 'startsAt', 'tags'] },
      },
    }

    transport.setServerData('Event', [
      { id: 'e1', title: 'Launch', startsAt: '2024-03-01T10:00:00.000Z', tags: '[]' },
    ])

    const { db, sync } = await createClientDB<Tables>({
      schema: plainSchema,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    await sync.pull()

    // No columnTypes -> untouched raw values, exactly as before
    expect(db.from('Event').findById('e1').startsAt).toBe('2024-03-01T10:00:00.000Z')
  })

  it('accepts a generated schema (GeneratedSchema is the same shape)', async () => {
    const generated: GeneratedSchema = {
      tables: {
        Event: {
          columns: ['id', 'title', 'startsAt', 'tags'],
          columnTypes: { startsAt: 'date' },
          indexes: [{ fields: ['title'] }],
        },
      },
    }

    transport.setServerData('Event', [
      { id: 'e1', title: 'Launch', startsAt: '2024-03-01T10:00:00.000Z', tags: '[]' },
    ])

    const { db, sync } = await createClientDB<Tables>({
      schema: generated,
      transport,
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
    })

    await sync.pull()

    expect(db.from('Event').findById('e1').startsAt).toBeInstanceOf(Date)
  })
})
