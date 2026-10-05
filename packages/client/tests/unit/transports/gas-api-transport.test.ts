/**
 * GasApiTransport tests.
 *
 * - The fetch path against a GAS web app (`/exec`) and the google.script.run
 *   path (#140): push content type, HTML responses, response shape, timeout,
 *   no retry.
 * - The google.script.run dispatch path (#144): `fakeGoogleScriptRun` fakes
 *   `google.script.run` on globalThis so the runner returned by
 *   `withSuccessHandler(...).withFailureHandler(...)` exposes only the server
 *   functions the test registers, the way the real runner exposes only the
 *   script's published functions. Calling any other name is a TypeError, so a
 *   transport that dispatched to the wrong name fails loudly here.
 * - Per-instance routing context and the subclass seam (#115).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

const GAS_URL = 'https://script.google.com/macros/s/abc123/exec'
const DEV_URL = 'http://localhost:3000/api'

type FetchArgs = [input: string, init?: RequestInit]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function htmlResponse(status = 200): Response {
  return new Response('<!DOCTYPE html><html><body>Sign in</body></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/** Install a fetch stub; returns the mock so tests can inspect its calls. */
function stubFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

/** A fetch that never settles on its own but rejects once its signal aborts. */
function hangingFetch(...[, init]: FetchArgs): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('GasApiTransport (fetch)', () => {
  describe('push content type', () => {
    it('sends text/plain with a JSON body to a script.google.com baseUrl', async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ success: true }))
      const transport = new GasApiTransport({ baseUrl: GAS_URL })

      await transport.push('Todo', mutations)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${GAS_URL}/sync/push`)
      expect(init?.method).toBe('POST')
      expect(headerOf(init, 'Content-Type')).toBe('text/plain')
      expect(JSON.parse(String(init?.body))).toEqual({ table: 'Todo', mutations })
    })

    it('keeps application/json for any other baseUrl', async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ success: true }))
      const transport = new GasApiTransport({ baseUrl: DEV_URL })

      await transport.push('Todo', mutations)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${DEV_URL}/sync/push`)
      expect(headerOf(init, 'Content-Type')).toBe('application/json')
      expect(JSON.parse(String(init?.body))).toEqual({ table: 'Todo', mutations })
    })

    it('keeps application/json without a baseUrl', async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ success: true }))
      await new GasApiTransport().push('Todo', mutations)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/sync/push')
      expect(headerOf(init, 'Content-Type')).toBe('application/json')
    })

    it('does not treat a lookalike host as GAS', async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ success: true }))
      await new GasApiTransport({
        baseUrl: 'https://script.google.com.example.org/exec',
      }).push('Todo', mutations)

      expect(headerOf(fetchMock.mock.calls[0][1], 'Content-Type')).toBe('application/json')
    })

    it('pushContentType overrides the choice in both directions', async () => {
      const fetchMock = stubFetch(async () => jsonResponse({ success: true }))

      await new GasApiTransport({ baseUrl: GAS_URL, pushContentType: 'application/json' })
        .push('Todo', mutations)
      await new GasApiTransport({ baseUrl: DEV_URL, pushContentType: 'text/plain' })
        .push('Todo', mutations)

      expect(headerOf(fetchMock.mock.calls[0][1], 'Content-Type')).toBe('application/json')
      expect(headerOf(fetchMock.mock.calls[1][1], 'Content-Type')).toBe('text/plain')
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
        table: 'Todo',
        mutations,
      })
    })
  })

  describe('pull', () => {
    it('GETs the table and returns the rows', async () => {
      const rows: Todo[] = [{ id: 't1', title: 'Server' }]
      const fetchMock = stubFetch(async () => jsonResponse({ rows }))

      const result = await new GasApiTransport({ baseUrl: GAS_URL }).pull<Todo>('My Todo')

      expect(result.rows).toEqual(rows)
      expect(fetchMock.mock.calls[0][0]).toBe(`${GAS_URL}/sync/pull?table=My%20Todo`)
    })
  })

  describe('HTML responses', () => {
    it('rejects a 200 HTML pull with an actionable error', async () => {
      stubFetch(async () => htmlResponse())
      const transport = new GasApiTransport({ baseUrl: GAS_URL })

      const error = await transport.pull('Todo').catch((e: unknown) => e)

      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toMatch(/pull/i)
      expect(message).toContain('Todo')
      expect(message).toContain('200')
      expect(message).toMatch(/HTML/)
      expect(message).toMatch(/deployment/i)
      expect(message).toMatch(/access settings/i)
    })

    it('rejects a 200 HTML push with an actionable error', async () => {
      stubFetch(async () => htmlResponse())
      const transport = new GasApiTransport({ baseUrl: GAS_URL })

      const error = await transport.push('Todo', mutations).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toMatch(/push/i)
      expect(message).toContain('Todo')
      expect(message).toContain('200')
      expect(message).toMatch(/HTML/)
      expect(message).toMatch(/access settings/i)
    })
  })

  describe('response shape', () => {
    it('rejects a pull response without a rows array', async () => {
      stubFetch(async () => jsonResponse({ data: [] }))
      await expect(new GasApiTransport({ baseUrl: GAS_URL }).pull('Todo')).rejects.toThrow(
        /pull.*Todo/i
      )
    })

    it('rejects a pull response whose rows is not an array', async () => {
      stubFetch(async () => jsonResponse({ rows: 'nope' }))
      await expect(new GasApiTransport({ baseUrl: GAS_URL }).pull('Todo')).rejects.toThrow(
        /pull.*Todo/i
      )
    })

    it('rejects a push response without a boolean success', async () => {
      stubFetch(async () => jsonResponse({ ok: true }))
      await expect(
        new GasApiTransport({ baseUrl: GAS_URL }).push('Todo', mutations)
      ).rejects.toThrow(/push.*Todo/i)
    })

    it('rejects a push response that is JSON null', async () => {
      stubFetch(async () => jsonResponse(null))
      await expect(
        new GasApiTransport({ baseUrl: GAS_URL }).push('Todo', mutations)
      ).rejects.toThrow(/push.*Todo/i)
    })

    it('passes a well-formed push result through', async () => {
      const body = { success: false, appliedIds: ['t1'], rejectedIds: ['t2'] }
      stubFetch(async () => jsonResponse(body))
      await expect(
        new GasApiTransport({ baseUrl: GAS_URL }).push('Todo', mutations)
      ).resolves.toEqual(body)
    })

    it('rejects a non-JSON body with the table name', async () => {
      stubFetch(async () => new Response('not json', { status: 200 }))
      await expect(new GasApiTransport({ baseUrl: GAS_URL }).pull('Todo')).rejects.toThrow(
        /invalid JSON.*Todo/
      )
    })
  })

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('aborts a pull that does not settle within timeoutMs', async () => {
      const fetchMock = stubFetch(hangingFetch)
      const transport = new GasApiTransport({ baseUrl: GAS_URL, timeoutMs: 5000 })

      const result = transport.pull('Todo').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(5000)
      const error = await result

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/timed out after 5000ms/)
      expect((error as Error).message).toContain('Todo')
      const signal = fetchMock.mock.calls[0][1]?.signal
      expect(signal?.aborted).toBe(true)
    })

    it('aborts a push that does not settle within timeoutMs', async () => {
      stubFetch(hangingFetch)
      const transport = new GasApiTransport({ baseUrl: GAS_URL, timeoutMs: 100 })

      const result = transport.push('Todo', mutations).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(100)

      expect(((await result) as Error).message).toMatch(/timed out after 100ms/)
    })

    it('defaults to a 60000ms timeout', async () => {
      stubFetch(hangingFetch)
      const transport = new GasApiTransport({ baseUrl: GAS_URL })

      let settled = false
      const result = transport.pull('Todo').catch((e: unknown) => {
        settled = true
        return e
      })
      await vi.advanceTimersByTimeAsync(59_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      expect(((await result) as Error).message).toMatch(/timed out after 60000ms/)
    })

    it('timeoutMs: 0 disables the timeout', async () => {
      const fetchMock = stubFetch(hangingFetch)
      const transport = new GasApiTransport({ baseUrl: GAS_URL, timeoutMs: 0 })

      let settled = false
      void transport.pull('Todo').finally(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(10 * 60_000)

      expect(settled).toBe(false)
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted ?? false).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('clears its timer once the response arrives', async () => {
      stubFetch(async () => jsonResponse({ rows: [] }))
      await new GasApiTransport({ baseUrl: GAS_URL, timeoutMs: 5000 }).pull('Todo')
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('no retry', () => {
    const failures: Array<[string, (...args: FetchArgs) => Promise<Response>]> = [
      ['network error', async () => { throw new TypeError('Failed to fetch') }],
      ['non-2xx', async () => jsonResponse({ error: 'boom' }, 500)],
      ['HTML', async () => htmlResponse()],
    ]

    for (const [label, impl] of failures) {
      it(`calls fetch exactly once on a ${label} (pull and push)`, async () => {
        const fetchMock = stubFetch(impl)
        const transport = new GasApiTransport({ baseUrl: GAS_URL })

        await expect(transport.pull('Todo')).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(1)

        await expect(transport.push('Todo', mutations)).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
    }

    it('calls fetch exactly once on a timeout', async () => {
      vi.useFakeTimers()
      const fetchMock = stubFetch(hangingFetch)
      const transport = new GasApiTransport({ baseUrl: GAS_URL, timeoutMs: 50 })

      const result = transport.push('Todo', mutations).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10_000)
      await result

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('includes the status and table in a non-2xx error', async () => {
      stubFetch(async () => new Response('err', { status: 503, statusText: 'Service Unavailable' }))
      await expect(new GasApiTransport({ baseUrl: GAS_URL }).pull('Todo')).rejects.toThrow(
        /Pull failed.*503.*Todo|Pull failed.*Todo.*503/
      )
    })
  })
})

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
    expect(calls[0].init?.method).toBeUndefined()
    expect(calls[0].init?.body).toBeUndefined()
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

// ── google.script.run ─────────────────────────────────────────────────

interface RunCall {
  fn: string
  args: unknown[]
}

/**
 * Minimal google.script.run stub: each server function either resolves via the
 * success handler or rejects via the failure handler, asynchronously, the way
 * the real client does.
 */
function stubGoogleScriptRun(behaviour: (fn: string, args: unknown[]) => { ok: unknown } | { err: Error }) {
  const calls: RunCall[] = []
  const run = {
    withSuccessHandler(onSuccess: (result: unknown) => void) {
      return {
        withFailureHandler(onFailure: (error: Error) => void) {
          return new Proxy({} as Record<string, (...args: unknown[]) => void>, {
            get(_target, fn: string) {
              return (...args: unknown[]) => {
                calls.push({ fn, args })
                const outcome = behaviour(fn, args)
                setTimeout(() => {
                  if ('err' in outcome) onFailure(outcome.err)
                  else onSuccess(outcome.ok)
                }, 0)
              }
            },
          })
        },
      }
    },
  }
  vi.stubGlobal('google', { script: { run } })
  return calls
}

describe('GasApiTransport (google.script.run)', () => {
  it('calls the default pull/push functions with the same arguments as before', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}))
    const rows: Todo[] = [{ id: 't1', title: 'Server' }]
    const pushResult = { success: true, appliedIds: ['t1'] }
    const calls = stubGoogleScriptRun(fn =>
      fn === 'syncPull' ? { ok: { rows } } : { ok: pushResult }
    )
    // baseUrl is ignored inside GAS, as before.
    const transport = new GasApiTransport({ baseUrl: GAS_URL })

    await expect(transport.pull<Todo>('Todo')).resolves.toEqual({ rows })
    await expect(transport.push('Todo', mutations)).resolves.toEqual(pushResult)

    expect(calls).toEqual([
      { fn: 'syncPull', args: ['Todo'] },
      { fn: 'syncPush', args: ['Todo', mutations] },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls the configured pullFn/pushFn', async () => {
    const calls = stubGoogleScriptRun(fn =>
      fn === 'myPull' ? { ok: { rows: [] } } : { ok: { success: true } }
    )
    const transport = new GasApiTransport({ pullFn: 'myPull', pushFn: 'myPush' })

    await transport.pull('Todo')
    await transport.push('Todo', mutations)

    expect(calls.map(c => c.fn)).toEqual(['myPull', 'myPush'])
  })

  it("rejects with the handler's error", async () => {
    const failure = new Error('Exception: sheet not found')
    stubGoogleScriptRun(() => ({ err: failure }))
    const transport = new GasApiTransport()

    await expect(transport.pull('Todo')).rejects.toBe(failure)
    await expect(transport.push('Todo', mutations)).rejects.toBe(failure)
  })

  it('applies no timeout', async () => {
    vi.useFakeTimers()
    const calls: RunCall[] = []
    const run = {
      withSuccessHandler() {
        return {
          withFailureHandler() {
            return new Proxy({} as Record<string, (...args: unknown[]) => void>, {
              get(_target, fn: string) {
                return (...args: unknown[]) => {
                  calls.push({ fn, args })
                }
              },
            })
          },
        }
      },
    }
    vi.stubGlobal('google', { script: { run } })

    let settled = false
    void new GasApiTransport({ timeoutMs: 10 }).pull('Todo').finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(calls).toHaveLength(1)
    expect(settled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
