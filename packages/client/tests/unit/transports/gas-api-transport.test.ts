/**
 * GasApiTransport tests.
 *
 * - The google.script.run dispatch path (#144): `fakeGoogleScriptRun` fakes
 *   `google.script.run` on globalThis so the runner returned by
 *   `withSuccessHandler(...).withFailureHandler(...)` exposes only the server
 *   functions the test registers, the way the real runner exposes only the
 *   script's published functions. Calling any other name is a TypeError, so a
 *   transport that dispatched to the wrong name fails loudly here.
 * - Per-instance routing context and the subclass seam (#115).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { RowWithId } from '@gsquery/core'
import { GasApiTransport } from '../../../src/transports/gas-api-transport.js'
import type {
  MergedMutation,
  SyncPushResult,
} from '../../../src/local/sync-transport.js'

interface Todo {
  id: string
  title: string
}

const mutations: MergedMutation<Todo>[] = [
  { id: 't1', type: 'insert', data: { id: 't1', title: 'Buy milk' } },
]

// ── Fakes ────────────────────────────────────────────────────────────

interface GasCall {
  fn: string
  args: unknown[]
}

type ServerFn = (...args: unknown[]) => unknown

interface ServerCall {
  fn: string
  args: unknown[]
}

/** Installs a fake `google.script.run` that records every server call. */
function installFakeGas(result: unknown): GasCall[] {
  const calls: GasCall[] = []
  const run = {
    withSuccessHandler: (success: (value: unknown) => void) => ({
      withFailureHandler: (_failure: (error: Error) => void) =>
        new Proxy<Record<string, ServerFn>>(
          {},
          {
            get: (_target, fn) => (...args: unknown[]) => {
              calls.push({ fn: String(fn), args })
              success(result)
            },
          }
        ),
    }),
  }
  vi.stubGlobal('google', { script: { run } })
  return calls
}

interface FetchCall {
  url: string
  init?: RequestInit
}

/** Installs a fake `fetch` that records every request and answers `result`. */
function installFakeFetch(result: unknown): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init })
      return new Response(JSON.stringify(result), { status: 200 })
    }
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── GAS path ─────────────────────────────────────────────────────────

describe('GasApiTransport GAS path (google.script.run)', () => {
  it('appends the context as a trailing argument on pull and push', async () => {
    const calls = installFakeGas({ rows: [], success: true })
    const transport = new GasApiTransport({ context: { tenant: 'team-a' } })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(calls).toEqual([
      { fn: 'syncPull', args: ['Todo', { tenant: 'team-a' }] },
      { fn: 'syncPush', args: ['Todo', mutations, { tenant: 'team-a' }] },
    ])
  })

  it('uses the configured function names with the context', async () => {
    const calls = installFakeGas({ rows: [], success: true })
    const transport = new GasApiTransport({
      pullFn: 'routedPull',
      pushFn: 'routedPush',
      context: { tenant: 'team-a' },
    })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(calls.map((c) => c.fn)).toEqual(['routedPull', 'routedPush'])
  })

  it('calls the server functions with no trailing argument without a context', async () => {
    const calls = installFakeGas({ rows: [], success: true })
    const transport = new GasApiTransport()

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(calls).toEqual([
      { fn: 'syncPull', args: ['Todo'] },
      { fn: 'syncPush', args: ['Todo', mutations] },
    ])
    expect(calls[0].args).toHaveLength(1)
    expect(calls[1].args).toHaveLength(2)
  })

  it('captures the context at construction', async () => {
    const calls = installFakeGas({ rows: [] })
    const context: Record<string, string> = { tenant: 'team-a' }
    const transport = new GasApiTransport({ context })

    context.tenant = 'team-b'
    context.extra = 'x'
    await transport.pull<Todo>('Todo')

    expect(calls[0].args).toEqual(['Todo', { tenant: 'team-a' }])
  })
})

// ── REST path ────────────────────────────────────────────────────────

describe('GasApiTransport REST path (fetch)', () => {
  const baseUrl = 'https://example.test/api'

  it('adds one URL-encoded query parameter per context entry on pull', async () => {
    const calls = installFakeFetch({ rows: [] })
    const transport = new GasApiTransport({
      baseUrl,
      context: { tenant: 'team a', 'x&y': 'a=b&c' },
    })

    await transport.pull<Todo>('Todo')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      `${baseUrl}/sync/pull?table=Todo&tenant=team%20a&x%26y=a%3Db%26c`
    )
    const params = new URL(calls[0].url).searchParams
    expect(params.get('table')).toBe('Todo')
    expect(params.get('tenant')).toBe('team a')
    expect(params.get('x&y')).toBe('a=b&c')
  })

  it('adds the context as query parameters on push and keeps the body', async () => {
    const calls = installFakeFetch({ success: true })
    const transport = new GasApiTransport({
      baseUrl,
      context: { tenant: 'team a', region: '' },
    })

    await transport.push<Todo>('Todo', mutations)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${baseUrl}/sync/push?tenant=team%20a&region=`)
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      table: 'Todo',
      mutations,
    })
  })

  it('uses the relative default endpoints with the context', async () => {
    const calls = installFakeFetch({ rows: [], success: true })
    const transport = new GasApiTransport({ context: { tenant: 't1' } })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(calls.map((c) => c.url)).toEqual([
      '/api/sync/pull?table=Todo&tenant=t1',
      '/api/sync/push?tenant=t1',
    ])
  })

  it('leaves URLs and bodies unchanged without a context', async () => {
    const calls = installFakeFetch({ rows: [], success: true })
    const withBase = new GasApiTransport({ baseUrl })
    const relative = new GasApiTransport()

    await withBase.pull<Todo>('My Todo')
    await withBase.push<Todo>('Todo', mutations)
    await relative.pull<Todo>('Todo')
    await relative.push<Todo>('Todo', mutations)

    expect(calls.map((c) => c.url)).toEqual([
      `${baseUrl}/sync/pull?table=My%20Todo`,
      `${baseUrl}/sync/push`,
      '/api/sync/pull?table=Todo',
      '/api/sync/push',
    ])
    expect(calls[0].init).toBeUndefined()
    expect(calls[1].init?.body).toBe(
      JSON.stringify({ table: 'Todo', mutations })
    )
  })

  it('treats an empty context like no context', async () => {
    const calls = installFakeFetch({ rows: [], success: true })
    const transport = new GasApiTransport({ baseUrl, context: {} })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(calls.map((c) => c.url)).toEqual([
      `${baseUrl}/sync/pull?table=Todo`,
      `${baseUrl}/sync/push`,
    ])
  })
})

// ── Validation ───────────────────────────────────────────────────────

describe('GasApiTransport context validation', () => {
  it('throws when the context has a table key, naming the key', () => {
    expect(
      () => new GasApiTransport({ context: { table: 'x', tenant: 't1' } })
    ).toThrow(/'table'/)
  })

  it('accepts empty-string values', () => {
    expect(() => new GasApiTransport({ context: { tenant: '' } })).not.toThrow()
  })
})

// ── Subclass seam ────────────────────────────────────────────────────

class RecordingTransport extends GasApiTransport {
  readonly seen: string[] = []

  protected override gasPull<T extends RowWithId>(
    tableName: string
  ): Promise<{ rows: T[] }> {
    this.seen.push(`gasPull:${tableName}:${GasApiTransport.isGas()}`)
    return super.gasPull<T>(tableName)
  }

  protected override gasPush<T extends RowWithId>(
    tableName: string,
    pushed: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.seen.push(`gasPush:${tableName}:${pushed.length}`)
    return super.gasPush<T>(tableName, pushed)
  }

  protected override fetchPull<T extends RowWithId>(
    tableName: string
  ): Promise<{ rows: T[] }> {
    this.seen.push(`fetchPull:${tableName}:${RecordingTransport.isGas()}`)
    return super.fetchPull<T>(tableName)
  }

  protected override fetchPush<T extends RowWithId>(
    tableName: string,
    pushed: MergedMutation<T>[]
  ): Promise<SyncPushResult<T>> {
    this.seen.push(`fetchPush:${tableName}:${pushed.length}`)
    return super.fetchPush<T>(tableName, pushed)
  }
}

describe('GasApiTransport subclass seam', () => {
  it('routes pull and push through overridden GAS methods', async () => {
    const calls = installFakeGas({ rows: [], success: true })
    const transport = new RecordingTransport({ context: { tenant: 't1' } })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(transport.seen).toEqual(['gasPull:Todo:true', 'gasPush:Todo:1'])
    expect(calls.map((c) => c.fn)).toEqual(['syncPull', 'syncPush'])
  })

  it('routes pull and push through overridden fetch methods', async () => {
    const calls = installFakeFetch({ rows: [], success: true })
    const transport = new RecordingTransport({ baseUrl: 'https://example.test' })

    await transport.pull<Todo>('Todo')
    await transport.push<Todo>('Todo', mutations)

    expect(transport.seen).toEqual(['fetchPull:Todo:false', 'fetchPush:Todo:1'])
    expect(calls).toHaveLength(2)
  })
})

// ── google.script.run dispatch (#144) ───────────────────────────────

/**
 * Install a fake `google.script.run` whose runner exposes `functions`.
 * A server function that throws drives the failure handler with that error;
 * otherwise its return value goes to the success handler, asynchronously, as
 * the real runner does.
 */
function fakeGoogleScriptRun(functions: Record<string, ServerFn>): ServerCall[] {
  const calls: ServerCall[] = []
  const run = {
    withSuccessHandler(onSuccess: (result: unknown) => void) {
      return {
        withFailureHandler(onFailure: (error: Error) => void) {
          const runner: Record<string, (...args: unknown[]) => void> = {}
          for (const [name, impl] of Object.entries(functions)) {
            runner[name] = (...args: unknown[]) => {
              calls.push({ fn: name, args })
              setTimeout(() => {
                let result: unknown
                try {
                  result = impl(...args)
                } catch (error) {
                  onFailure(error as Error)
                  return
                }
                onSuccess(result)
              }, 0)
            }
          }
          return runner
        },
      }
    },
  }
  vi.stubGlobal('google', { script: { run } })
  return calls
}

describe('GasApiTransport via google.script.run', () => {
  it('pull calls the default syncPull with the table name and resolves with its result', async () => {
    const rows: Todo[] = [{ id: 'a', title: 'one' }]
    const calls = fakeGoogleScriptRun({ syncPull: () => ({ rows }) })

    const result = await new GasApiTransport().pull<Todo>('Todo')

    expect(calls).toEqual([{ fn: 'syncPull', args: ['Todo'] }])
    expect(result).toEqual({ rows })
  })

  it('pull calls the server function named by pullFn', async () => {
    const calls = fakeGoogleScriptRun({ customPull: () => ({ rows: [] }) })

    const result = await new GasApiTransport({ pullFn: 'customPull' }).pull<Todo>('Todo')

    expect(calls).toEqual([{ fn: 'customPull', args: ['Todo'] }])
    expect(result).toEqual({ rows: [] })
  })

  it('pull rejects when the failure handler fires', async () => {
    fakeGoogleScriptRun({
      syncPull: () => {
        throw new Error('server down')
      },
    })

    await expect(new GasApiTransport().pull<Todo>('Todo')).rejects.toThrow('server down')
  })

  it('push calls the default syncPush with the table name and mutations and resolves with its result', async () => {
    const mutations: MergedMutation<Todo>[] = [
      { id: 'a', type: 'insert', data: { id: 'a', title: 'one' } },
      { id: 'b', type: 'delete' },
    ]
    const pushResult: SyncPushResult<Todo> = { success: true, conflicts: [] }
    const calls = fakeGoogleScriptRun({ syncPush: () => pushResult })

    const result = await new GasApiTransport().push<Todo>('Todo', mutations)

    expect(calls).toEqual([{ fn: 'syncPush', args: ['Todo', mutations] }])
    expect(result).toEqual(pushResult)
  })

  it('push calls the server function named by pushFn', async () => {
    const mutations: MergedMutation<Todo>[] = [{ id: 'a', type: 'update', data: { title: 'two' } }]
    const pushResult: SyncPushResult<Todo> = { success: true, conflicts: [] }
    const calls = fakeGoogleScriptRun({ customPush: () => pushResult })

    const result = await new GasApiTransport({ pushFn: 'customPush' }).push<Todo>('Todo', mutations)

    expect(calls).toEqual([{ fn: 'customPush', args: ['Todo', mutations] }])
    expect(result).toEqual(pushResult)
  })

  it('push rejects when the failure handler fires', async () => {
    fakeGoogleScriptRun({
      syncPush: () => {
        throw new Error('write refused')
      },
    })

    await expect(
      new GasApiTransport().push<Todo>('Todo', [{ id: 'a', type: 'delete' }])
    ).rejects.toThrow('write refused')
  })
})
