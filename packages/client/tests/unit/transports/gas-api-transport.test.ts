/**
 * GasApiTransport tests - the google.script.run dispatch path (#144).
 *
 * `google.script.run` is faked on globalThis: the runner returned by
 * `withSuccessHandler(...).withFailureHandler(...)` exposes only the server
 * functions the test registers, the way the real runner exposes only the
 * script's published functions. Calling any other name is a TypeError, so a
 * transport that dispatched to the wrong name fails loudly here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { GasApiTransport } from '../../../src/transports/gas-api-transport.js'
import type { MergedMutation, SyncPushResult } from '../../../src/local/sync-transport.js'

interface Todo {
  id: string
  title: string
}

type ServerFn = (...args: unknown[]) => unknown

interface ServerCall {
  fn: string
  args: unknown[]
}

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

afterEach(() => {
  vi.unstubAllGlobals()
})

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
