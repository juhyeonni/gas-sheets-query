/**
 * GasApiTransport push payload over google.script.run (#245)
 *
 * google.script.run rejects any parameter holding a `Date`, nested or not. The
 * REST path is unaffected because JSON.stringify turns a Date into its ISO
 * string, so the GAS path must send the same JSON-encoded payload: identical to
 * the REST body, with no Date left anywhere, and without touching the batch the
 * engine passed in (it keeps that batch for retries and dead-lettering).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { GasApiTransport } from '../../../src/transports/gas-api-transport.js'
import type {
  MergedMutation,
  SyncPushResult,
} from '../../../src/local/sync-transport.js'
import { createClientDB } from '../../../src/local/create-client-db.js'
import type { ClientDBSchema } from '../../../src/local/create-client-db.js'
import type { MutationStorage } from '../../../src/local/mutation-queue.js'

interface Event extends RowWithId {
  id: string
  title: string
  startsAt: Date
  meta?: { at: Date; history: Date[] }
}

type Tables = { Event: Event }

/** One call the stubbed google.script.run received. */
interface GasCall {
  fn: string
  args: unknown[]
}

interface GasStub {
  calls: GasCall[]
  /** Server-side handlers, keyed by GAS function name. */
  handlers: Record<string, (...args: unknown[]) => unknown>
}

type GlobalWithGoogle = typeof globalThis & { google?: unknown }

/**
 * Installs a fake `google.script.run` on the global object. Each call is
 * recorded with its raw arguments (no cloning, so a Date would show up as a
 * Date) and answered by the matching handler.
 */
function installGoogleStub(): GasStub {
  const stub: GasStub = { calls: [], handlers: {} }
  const run = {
    withSuccessHandler: (onSuccess: (result: unknown) => void) => ({
      withFailureHandler: (onFailure: (error: Error) => void) =>
        new Proxy(
          {},
          {
            get: (_target, fn: string | symbol) => (...args: unknown[]) => {
              const name = String(fn)
              stub.calls.push({ fn: name, args })
              const handler = stub.handlers[name]
              if (!handler) {
                onFailure(new Error(`no handler for ${name}`))
                return
              }
              try {
                onSuccess(handler(...args))
              } catch (err) {
                onFailure(err as Error)
              }
            },
          }
        ),
    }),
  }
  ;(globalThis as GlobalWithGoogle).google = { script: { run } }
  return stub
}

function removeGoogleStub(): void {
  delete (globalThis as GlobalWithGoogle).google
}

/** Walks any value and reports the paths that hold a Date. */
function findDates(value: unknown, path = '$'): string[] {
  if (value instanceof Date) return [path]
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findDates(item, `${path}[${i}]`))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findDates(item, `${path}.${key}`)
    )
  }
  return []
}

const AT = new Date('2024-03-01T10:00:00.000Z')
const PATCHED = new Date('2024-04-02T08:30:00.000Z')
const NESTED = new Date('2024-05-03T12:00:00.000Z')
const IN_ARRAY = new Date('2024-06-04T16:45:00.000Z')

/** A batch with a Date in an insert row, an update patch, and nested values. */
function mutationsWithDates(): MergedMutation<Event>[] {
  return [
    {
      id: 'e1',
      type: 'insert',
      data: { id: 'e1', title: 'Launch', startsAt: AT },
    },
    {
      id: 'e2',
      type: 'update',
      data: { startsAt: PATCHED },
    },
    {
      id: 'e3',
      type: 'update',
      data: { meta: { at: NESTED, history: [IN_ARRAY, NESTED] } },
    },
    { id: 'e4', type: 'delete' },
  ]
}

const OK: SyncPushResult<Event> = { success: true }

describe('GasApiTransport push over google.script.run (#245)', () => {
  let stub: GasStub

  beforeEach(() => {
    stub = installGoogleStub()
    stub.handlers.syncPush = () => OK
  })

  afterEach(() => {
    removeGoogleStub()
    vi.unstubAllGlobals()
  })

  it('passes no Date anywhere in the push arguments (AC1)', async () => {
    const transport = new GasApiTransport()

    const result = await transport.push('Event', mutationsWithDates())

    expect(result).toEqual(OK)
    expect(stub.calls).toHaveLength(1)
    const [call] = stub.calls
    expect(call.fn).toBe('syncPush')
    expect(call.args[0]).toBe('Event')
    expect(findDates(call.args)).toEqual([])
  })

  it('sends Dates as their ISO strings, top-level and nested (AC1)', async () => {
    const transport = new GasApiTransport()

    await transport.push('Event', mutationsWithDates())

    expect(stub.calls[0].args[1]).toEqual([
      {
        id: 'e1',
        type: 'insert',
        data: { id: 'e1', title: 'Launch', startsAt: AT.toISOString() },
      },
      { id: 'e2', type: 'update', data: { startsAt: PATCHED.toISOString() } },
      {
        id: 'e3',
        type: 'update',
        data: {
          meta: {
            at: NESTED.toISOString(),
            history: [IN_ARRAY.toISOString(), NESTED.toISOString()],
          },
        },
      },
      { id: 'e4', type: 'delete' },
    ])
  })

  it('sends the same mutations payload as the REST body (AC2)', async () => {
    const gasTransport = new GasApiTransport()
    await gasTransport.push('Event', mutationsWithDates())
    const gasPayload = stub.calls[0].args[1]

    // Same mutations over REST: no google.script.run, fetch stubbed.
    removeGoogleStub()
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(OK), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const restTransport = new GasApiTransport({ baseUrl: 'https://example.test' })
    await restTransport.push('Event', mutationsWithDates())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(String(init?.body)) as {
      table: string
      mutations: unknown
    }
    expect(body.table).toBe('Event')
    expect(gasPayload).toEqual(body.mutations)
  })

  it('drops undefined keys the same way the REST body does (AC2)', async () => {
    const transport = new GasApiTransport()
    const mutations: MergedMutation<Event>[] = [
      { id: 'e1', type: 'update', data: { title: undefined, startsAt: AT } },
    ]

    await transport.push('Event', mutations)

    const [sent] = stub.calls[0].args[1] as MergedMutation[]
    expect(sent.data).toEqual({ startsAt: AT.toISOString() })
    expect(Object.keys(sent.data ?? {})).toEqual(['startsAt'])
  })

  it('leaves the caller’s mutations holding their original Dates (AC3)', async () => {
    const transport = new GasApiTransport()
    const mutations = mutationsWithDates()
    const insertRow = mutations[0].data
    const nestedMeta = mutations[2].data?.meta

    await transport.push('Event', mutations)

    expect(mutations[0].data).toBe(insertRow)
    expect(mutations[0].data?.startsAt).toBe(AT)
    expect(mutations[1].data?.startsAt).toBe(PATCHED)
    expect(mutations[2].data?.meta).toBe(nestedMeta)
    expect(nestedMeta?.at).toBe(NESTED)
    expect(nestedMeta?.history[0]).toBe(IN_ARRAY)
    expect(nestedMeta?.history[1]).toBe(NESTED)
    // The payload is a separate copy, not the caller's objects.
    expect(stub.calls[0].args[1]).not.toBe(mutations)
  })
})

function createMemoryStorage(): MutationStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
}

const schema = {
  tables: {
    Event: {
      columns: ['id', 'title', 'startsAt'] as const,
      columnTypes: { startsAt: 'date' },
      indexes: [],
    },
  },
} satisfies ClientDBSchema

describe('pulled datetime rows pushed over google.script.run (#245, AC4)', () => {
  afterEach(() => {
    removeGoogleStub()
  })

  it('sends a pulled-then-edited datetime as ISO and pulls it back as an equal Date', async () => {
    const stub = installGoogleStub()
    // A tiny server: the sheet stores what syncPush sends, syncPull returns it.
    const sheet = new Map<string, Record<string, unknown>>([
      ['e1', { id: 'e1', title: 'Launch', startsAt: AT.toISOString() }],
    ])
    stub.handlers.syncPull = () => ({ rows: [...sheet.values()] })
    stub.handlers.syncPush = (_table: unknown, mutations: unknown) => {
      for (const m of mutations as MergedMutation[]) {
        if (m.type === 'delete') {
          sheet.delete(String(m.id))
          continue
        }
        const prev = sheet.get(String(m.id)) ?? {}
        sheet.set(String(m.id), { ...prev, ...m.data, id: m.id })
      }
      return { success: true }
    }

    const { db, sync } = await createClientDB<Tables>({
      schema,
      transport: new GasApiTransport(),
      disableIDB: true,
      mutationStorage: createMemoryStorage(),
      pushDebounceMs: 0,
    })

    await sync.pull()
    const pulled = db.from('Event').findById('e1')
    expect(pulled.startsAt).toBeInstanceOf(Date)
    expect(pulled.startsAt.getTime()).toBe(AT.getTime())

    // Edit another field the way an edit form does: the whole row goes back
    // as the patch, so the hydrated Date rides along with it.
    const { id: _id, ...fields } = pulled
    db.from('Event').update('e1', { ...fields, title: 'Launch (moved)' })
    await sync.push()

    const pushCall = stub.calls.find(c => c.fn === 'syncPush')
    expect(pushCall).toBeDefined()
    expect(findDates(pushCall?.args)).toEqual([])
    const [sent] = pushCall?.args[1] as MergedMutation[]
    expect(sent).toEqual({
      id: 'e1',
      type: 'update',
      data: { title: 'Launch (moved)', startsAt: AT.toISOString() },
    })

    // Replay the pushed row through a pull: it hydrates back to an equal Date.
    await sync.pull()
    const replayed = db.from('Event').findById('e1')
    expect(replayed.title).toBe('Launch (moved)')
    expect(replayed.startsAt).toBeInstanceOf(Date)
    expect(replayed.startsAt.getTime()).toBe(AT.getTime())
  })
})
