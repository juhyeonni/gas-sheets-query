/**
 * #136 — bounded retry with backoff for transient GAS failures.
 *
 * Failures are injected rather than provoked: the point is the retry policy
 * (what is retried, how many times, how long it sleeps, what finally escapes)
 * and that a logical error is never retried.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  withRetries
} from '../../src/core/gas-retry'
import { DuplicateIdError, LockTimeoutError, QuotaExceededError, SheetsApiError } from '../../src'

/** Collects the sleep durations a run would have spent on the platform. */
function recorder(): { slept: number[]; sleep: (ms: number) => void } {
  const slept: number[] = []
  return { slept, sleep: (ms: number) => void slept.push(ms) }
}

const TRANSIENT = 'Service Spreadsheets timed out while accessing document with id 1AbC.'

describe('withRetries (#136)', () => {
  it('returns the value without sleeping when the call succeeds', () => {
    const { slept, sleep } = recorder()
    const fn = vi.fn(() => 'ok')

    expect(withRetries(fn, { sleep })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(slept).toEqual([])
  })

  it('retries a transient failure and returns the eventual success', () => {
    const { slept, sleep } = recorder()
    let calls = 0
    const fn = () => {
      calls++
      if (calls < 3) throw new Error(TRANSIENT)
      return 'ok'
    }

    expect(withRetries(fn, { sleep })).toBe('ok')
    expect(calls).toBe(3)
    expect(slept).toEqual([500, 1000])
  })

  it('backs off exponentially from baseDelayMs', () => {
    const { slept, sleep } = recorder()
    expect(() => withRetries(() => { throw new Error(TRANSIENT) }, { attempts: 4, baseDelayMs: 100, sleep }))
      .toThrow(SheetsApiError)
    expect(slept).toEqual([100, 200, 400])
  })

  it('gives up after `attempts` calls and throws the classified error', () => {
    const { slept, sleep } = recorder()
    let calls = 0

    try {
      withRetries(() => { calls++; throw new Error(TRANSIENT) }, { sleep })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SheetsApiError)
      expect((error as SheetsApiError).originalMessage).toBe(TRANSIENT)
      expect((error as SheetsApiError).cause).toBeInstanceOf(Error)
    }

    expect(calls).toBe(DEFAULT_RETRY_ATTEMPTS)
    expect(slept).toEqual([DEFAULT_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS * 2])
  })

  it('does not retry a logical error, and rethrows it unchanged', () => {
    const { slept, sleep } = recorder()
    const original = new DuplicateIdError(1, 'Users')
    let calls = 0

    expect(() => withRetries(() => { calls++; throw original }, { sleep })).toThrow(original)
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('does not retry an unrecognized error, and rethrows it unchanged', () => {
    const { slept, sleep } = recorder()
    const original = new TypeError('x is not a function')
    let calls = 0

    expect(() => withRetries(() => { calls++; throw original }, { sleep })).toThrow(original)
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('does not retry a lock timeout', () => {
    // Waiting again immediately cannot help: waitLock already waited its full
    // budget, and this call holds no lock to make progress with.
    const { slept, sleep } = recorder()
    let calls = 0

    expect(() => withRetries(() => { calls++; throw new LockTimeoutError(10000) }, { sleep }))
      .toThrow(LockTimeoutError)
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('does not retry a terminal quota error', () => {
    const { slept, sleep } = recorder()
    let calls = 0

    expect(() => withRetries(
      () => { calls++; throw new Error('Service invoked too many times for one day: spreadsheets.') },
      { sleep }
    )).toThrow(QuotaExceededError)
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('retries a short-term quota error', () => {
    const { slept, sleep } = recorder()
    let calls = 0
    const fn = () => {
      calls++
      if (calls < 2) throw new Error('Service invoked too many times in a short time: spreadsheets.')
      return calls
    }

    expect(withRetries(fn, { sleep })).toBe(2)
    expect(slept).toEqual([500])
  })

  it('classifies without retrying when attempts is 1', () => {
    const { slept, sleep } = recorder()
    let calls = 0

    expect(() => withRetries(() => { calls++; throw new Error(TRANSIENT) }, { attempts: 1, sleep }))
      .toThrow(SheetsApiError)
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('sleeps via Utilities.sleep when the platform provides it', () => {
    const g = globalThis as { Utilities?: unknown }
    const had = 'Utilities' in g
    const previous = g.Utilities
    const sleep = vi.fn()
    g.Utilities = { sleep }

    try {
      let calls = 0
      withRetries(() => {
        calls++
        if (calls < 2) throw new Error(TRANSIENT)
        return calls
      })
      expect(sleep).toHaveBeenCalledTimes(1)
      expect(sleep).toHaveBeenCalledWith(500)
    } finally {
      if (had) g.Utilities = previous
      else delete g.Utilities
    }
  })

  it('is a no-op sleeper outside GAS, so Node callers never block', () => {
    const started = Date.now()
    let calls = 0

    expect(() => withRetries(() => { calls++; throw new Error(TRANSIENT) })).toThrow(SheetsApiError)
    expect(calls).toBe(DEFAULT_RETRY_ATTEMPTS)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
