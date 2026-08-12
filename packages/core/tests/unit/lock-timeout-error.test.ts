/**
 * #136 — `Lock.waitLock` "times out with an exception". Before this change the
 * exception escaped as a raw `Error`, indistinguishable from a bug, so callers
 * had no way to tell "someone else is writing, try later" from "your code is
 * broken". These tests pin the typed surface and that the #164 flush/release
 * contract is unaffected by the wrapping.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { withScriptLock, withScriptLockAsync } from '../../src/core/script-lock'
import { LockTimeoutError, QuotaExceededError } from '../../src'

type MutableGlobal = { LockService?: unknown; SpreadsheetApp?: unknown }
const g = globalThis as MutableGlobal

let restore: (() => void) | undefined

/** Installs a LockService whose waitLock throws `message`. */
function installFailingLock(message: string): { released: number } {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'LockService')
  const state = { released: 0 }

  g.LockService = {
    getScriptLock: () => ({
      waitLock: () => {
        throw new Error(message)
      },
      releaseLock: () => {
        state.released++
      },
      tryLock: () => true,
      hasLock: () => false
    })
  }

  restore = () => {
    if (previous) Object.defineProperty(globalThis, 'LockService', previous)
    else delete g.LockService
  }
  return state
}

describe('waitLock failures surface as LockTimeoutError (#136)', () => {
  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('wraps the platform lock-timeout exception', () => {
    installFailingLock('Lock timeout: another process was holding the lock for too long.')

    try {
      withScriptLock(() => 'never runs')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LockTimeoutError)
      expect((error as LockTimeoutError).code).toBe('LOCK_TIMEOUT')
      expect((error as LockTimeoutError).timeoutMs).toBe(10000)
      expect((error as LockTimeoutError).cause).toBeInstanceOf(Error)
    }
  })

  it('reports the timeout the caller actually asked for', () => {
    installFailingLock('Could not obtain lock.')

    expect(() => withScriptLock(() => 0, 2500)).toThrow(LockTimeoutError)
    try {
      withScriptLock(() => 0, 2500)
    } catch (error) {
      expect((error as LockTimeoutError).timeoutMs).toBe(2500)
      expect((error as LockTimeoutError).message).toContain('2500')
    }
  })

  it('wraps an unrecognized waitLock exception as a lock timeout', () => {
    // waitLock's documented failure mode is the timeout, so an unmatched
    // message from it is still a failed acquisition, not a mystery.
    installFailingLock('something the platform has not documented')
    expect(() => withScriptLock(() => 0)).toThrow(LockTimeoutError)
  })

  it('keeps a non-lock GAS failure classified as itself', () => {
    installFailingLock('Service invoked too many times for one day: spreadsheets.')
    expect(() => withScriptLock(() => 0)).toThrow(QuotaExceededError)
  })

  it('never runs the callback and never releases a lock it did not take', () => {
    const state = installFailingLock('Lock timeout: another process')
    let ran = false

    expect(() => withScriptLock(() => { ran = true })).toThrow(LockTimeoutError)
    expect(ran).toBe(false)
    expect(state.released).toBe(0)
  })

  it('applies to the async variant too', async () => {
    installFailingLock('Lock timeout: another process')
    await expect(withScriptLockAsync(async () => 'x')).rejects.toBeInstanceOf(LockTimeoutError)
  })

  it('leaves the re-entrancy depth clean, so the next acquisition is a real one', () => {
    installFailingLock('Lock timeout: another process')
    expect(() => withScriptLock(() => 0)).toThrow(LockTimeoutError)

    // A leaked depth would make this nested-looking call skip acquisition.
    let acquired = 0
    g.LockService = {
      getScriptLock: () => ({
        waitLock: () => { acquired++ },
        releaseLock: () => {},
        tryLock: () => true,
        hasLock: () => true
      })
    }
    expect(withScriptLock(() => 'ok')).toBe('ok')
    expect(acquired).toBe(1)
  })
})
