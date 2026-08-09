/**
 * Local sanity check: runs the exact E2E suite against the in-repo GAS fakes.
 *
 * This does NOT prove real-GAS behavior (that is the point of the deployed
 * harness) — it proves the harness itself is sound, so a red run in real GAS
 * indicts the platform assumption under test, not the test code.
 */
import { FakeSpreadsheet } from '@gsquery/core/testing'
import { installGasFakes } from '@gsquery/core/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { runAll } from './src/main'

const TEST_SPREADSHEET_ID = 'fake-e2e-spreadsheet'

describe('gas e2e harness (against local fakes)', () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('runs the full golden suite green', () => {
    const handle = installGasFakes({
      spreadsheets: { [TEST_SPREADSHEET_ID]: new FakeSpreadsheet(TEST_SPREADSHEET_ID) },
      activeId: TEST_SPREADSHEET_ID
    })
    restore = () => handle.restore()

    const result = runAll(TEST_SPREADSHEET_ID, 'localcheck')

    const failures = result.results.filter(r => !r.ok)
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([])
    expect(result.total).toBeGreaterThanOrEqual(11)
    expect(result.ok).toBe(true)
  })
})
