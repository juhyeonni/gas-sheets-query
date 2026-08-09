/**
 * #136 — GAS surfaces every platform failure as a bare `Error` whose only
 * distinguishing feature is its message. These tests pin the classification
 * table that turns those messages into typed errors, and pin which of them
 * are transient (worth retrying) versus terminal (retrying only burns the
 * remaining execution budget).
 */
import { describe, expect, it } from 'vitest'
import {
  LockTimeoutError,
  QuotaExceededError,
  SheetsApiError,
  SheetsQueryError,
  DuplicateIdError,
  classifyGasError,
  isTransientGasError
} from '../../src'

describe('classifyGasError (#136)', () => {
  describe('lock failures', () => {
    const messages = [
      'Lock timeout: another process was holding the lock for too long.',
      'Could not obtain lock.',
      'Action not allowed: could not obtain lock'
    ]

    for (const message of messages) {
      it(`classifies "${message}" as LockTimeoutError`, () => {
        const error = classifyGasError(new Error(message))
        expect(error).toBeInstanceOf(LockTimeoutError)
        expect(error?.code).toBe('LOCK_TIMEOUT')
      })
    }

    it('never treats a lock timeout as transient', () => {
      // The caller already waited the full timeout; an immediate retry would
      // just wait it again while holding nothing.
      expect(isTransientGasError(new Error('Lock timeout: another process'))).toBe(false)
    })
  })

  describe('quota failures', () => {
    it('classifies short-term rate limits as transient', () => {
      const error = classifyGasError(
        new Error('Service invoked too many times in a short time: spreadsheets. Try Utilities.sleep(1000) between calls.')
      )
      expect(error).toBeInstanceOf(QuotaExceededError)
      expect(error?.code).toBe('QUOTA_EXCEEDED')
      expect((error as QuotaExceededError).transient).toBe(true)
    })

    it('classifies daily quota exhaustion as terminal', () => {
      const error = classifyGasError(new Error('Service invoked too many times for one day: spreadsheets.'))
      expect(error).toBeInstanceOf(QuotaExceededError)
      expect((error as QuotaExceededError).transient).toBe(false)
      expect(isTransientGasError(error)).toBe(false)
    })

    it('classifies the execution-time limit as a terminal quota error', () => {
      const error = classifyGasError(new Error('Exceeded maximum execution time'))
      expect(error).toBeInstanceOf(QuotaExceededError)
      expect((error as QuotaExceededError).transient).toBe(false)
    })

    it('classifies the daily compute-time limit as terminal', () => {
      const error = classifyGasError(new Error('Service using too much computer time for one day'))
      expect((error as QuotaExceededError).transient).toBe(false)
    })

    it('preserves the original message', () => {
      const raw = 'Service invoked too many times in a short time: spreadsheets.'
      const error = classifyGasError(new Error(raw)) as QuotaExceededError
      expect(error.originalMessage).toBe(raw)
      expect(error.message).toContain(raw)
    })
  })

  describe('transient Sheets API failures', () => {
    const messages = [
      'Service Spreadsheets timed out while accessing document with id 1AbC.',
      'Service timed out: Spreadsheets',
      'Internal error while accessing spreadsheet.',
      "We're sorry, a server error occurred. Please wait a bit and try again.",
      'We’re sorry, a server error occurred. Please wait a bit and try again.',
      'Service error: Spreadsheets',
      'Service unavailable: Spreadsheets',
      'Unexpected error while getting the method or property getRange on object SpreadsheetApp.Spreadsheet.',
      'Too many simultaneous invocations: Spreadsheets'
    ]

    for (const message of messages) {
      it(`classifies "${message.slice(0, 40)}..." as a transient SheetsApiError`, () => {
        const error = classifyGasError(new Error(message))
        expect(error).toBeInstanceOf(SheetsApiError)
        expect(error?.code).toBe('SHEETS_API_ERROR')
        expect((error as SheetsApiError).transient).toBe(true)
        expect((error as SheetsApiError).originalMessage).toBe(message)
        expect(isTransientGasError(error)).toBe(true)
      })
    }

    it('matches case-insensitively', () => {
      expect(classifyGasError(new Error('SERVICE SPREADSHEETS TIMED OUT'))).toBeInstanceOf(SheetsApiError)
    })
  })

  describe('non-GAS failures', () => {
    it('returns undefined for an unrecognized message', () => {
      expect(classifyGasError(new Error('Cannot read property foo of undefined'))).toBeUndefined()
      expect(isTransientGasError(new Error('boom'))).toBe(false)
    })

    it('returns undefined for a non-Error value', () => {
      expect(classifyGasError('Service Spreadsheets timed out')).toBeUndefined()
      expect(classifyGasError(undefined)).toBeUndefined()
    })

    it('passes an already-typed library error through untouched', () => {
      const original = new DuplicateIdError(7, 'Users')
      expect(classifyGasError(original)).toBe(original)
      expect(isTransientGasError(original)).toBe(false)
    })
  })

  describe('error shape', () => {
    it('extends the SheetsQueryError hierarchy', () => {
      const lock = new LockTimeoutError(10000)
      const quota = new QuotaExceededError('raw', true)
      const api = new SheetsApiError('raw')

      for (const error of [lock, quota, api]) {
        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(SheetsQueryError)
      }
      expect(lock.name).toBe('LockTimeoutError')
      expect(quota.name).toBe('QuotaExceededError')
      expect(api.name).toBe('SheetsApiError')
      expect(lock.timeoutMs).toBe(10000)
      expect(api.transient).toBe(true)
    })
  })
})
