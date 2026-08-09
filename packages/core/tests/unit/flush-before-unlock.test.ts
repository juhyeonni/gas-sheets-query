/**
 * #164 — SpreadsheetApp buffers writes, so a locked mutation must flush
 * before releasing the script lock or the next lock holder can read a stale
 * sheet and commit over the uncommitted row (silent data loss, reproduced on
 * the live platform by the E2E burst test: 2×25 locked inserts → 49 rows,
 * both callers reporting success).
 *
 * These tests pin the ordering contract: flush() is invoked inside the
 * critical section boundary, strictly before releaseLock().
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { withScriptLock, withScriptLockAsync } from '../../src/core/script-lock'
import { FakeSpreadsheet, installGasFakes } from '../../src/testing'

interface Row {
  id: number
  name: string
  [key: string]: unknown
}

type MutableGlobal = { SpreadsheetApp?: unknown; LockService?: unknown }
const g = globalThis as MutableGlobal

function installOrderRecorder(): { events: string[]; restore: () => void } {
  const events: string[] = []
  const handle = installGasFakes({
    spreadsheets: { S: new FakeSpreadsheet('S') },
    activeId: 'S'
  })

  // Wrap the installed fakes so every flush/lock transition is recorded.
  const spreadsheetApp = g.SpreadsheetApp as { flush: () => void }
  const originalFlush = spreadsheetApp.flush.bind(spreadsheetApp)
  spreadsheetApp.flush = () => {
    events.push('flush')
    originalFlush()
  }
  g.LockService = {
    getScriptLock: () => ({
      waitLock: () => {
        events.push('acquire')
      },
      releaseLock: () => {
        events.push('release')
      },
      tryLock: () => true,
      hasLock: () => true
    })
  }

  return { events, restore: () => handle.restore() }
}

describe('flush before unlock (#164)', () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('withScriptLock flushes after the callback and before releasing', () => {
    const recorder = installOrderRecorder()
    restore = recorder.restore

    withScriptLock(() => {
      recorder.events.push('work')
    })

    expect(recorder.events).toEqual(['acquire', 'work', 'flush', 'release'])
  })

  it('withScriptLock flushes even when the callback throws', () => {
    const recorder = installOrderRecorder()
    restore = recorder.restore

    expect(() =>
      withScriptLock(() => {
        recorder.events.push('work')
        throw new Error('boom')
      })
    ).toThrow('boom')

    expect(recorder.events).toEqual(['acquire', 'work', 'flush', 'release'])
  })

  it('withScriptLockAsync flushes before releasing', async () => {
    const recorder = installOrderRecorder()
    restore = recorder.restore

    await withScriptLockAsync(async () => {
      recorder.events.push('work')
    })

    expect(recorder.events).toEqual(['acquire', 'work', 'flush', 'release'])
  })

  it('nested locks flush once, at the outermost release', () => {
    const recorder = installOrderRecorder()
    restore = recorder.restore

    withScriptLock(() => {
      withScriptLock(() => {
        recorder.events.push('inner')
      })
      recorder.events.push('outer')
    })

    expect(recorder.events).toEqual(['acquire', 'inner', 'outer', 'flush', 'release'])
  })

  it('SheetsAdapter.insert commits its append before the lock is released', () => {
    const recorder = installOrderRecorder()
    restore = recorder.restore

    const adapter = new SheetsAdapter<Row>({
      spreadsheetId: 'S',
      sheetName: 'users',
      columns: ['id', 'name']
    })
    adapter.insert({ name: 'a' })

    const flushAt = recorder.events.indexOf('flush')
    const releaseAt = recorder.events.indexOf('release')
    expect(flushAt).toBeGreaterThan(-1)
    expect(releaseAt).toBeGreaterThan(flushAt)
  })
})
