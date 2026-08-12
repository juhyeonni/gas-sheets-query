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
import { mixedBurst, mixedCheck, runAll } from './src/main'

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
    expect(result.total).toBeGreaterThanOrEqual(15)
    expect(result.ok).toBe(true)
  })

  /**
   * The mixed workload's *invariants* checked against fakes.
   *
   * Run sequentially here — Node has no second Apps Script execution to race
   * against, so this proves the workload's end state is what `mixedCheck`
   * expects (i.e. the check is not vacuous and not self-contradicting). Real
   * concurrency is what the parallel CI step adds on top.
   */
  it('mixedBurst pairs satisfy mixedCheck (sequential, against fakes)', () => {
    const handle = installGasFakes({
      spreadsheets: { [TEST_SPREADSHEET_ID]: new FakeSpreadsheet(TEST_SPREADSHEET_ID) },
      activeId: TEST_SPREADSHEET_ID
    })
    restore = () => handle.restore()

    const left = mixedBurst('left', 11, TEST_SPREADSHEET_ID)
    const right = mixedBurst('right', 29, TEST_SPREADSHEET_ID)

    for (const run of [left, right]) {
      expect(run.errors, JSON.stringify(run, null, 2)).toEqual([])
      expect(run.inserted).toBe(10)
      expect(run.updated).toBe(5)
      expect(run.deleted).toBe(3)
      expect(run.batchUpdated).toBe(5)
    }

    const check = mixedCheck(['left', 'right'], TEST_SPREADSHEET_ID)
    expect(check, JSON.stringify(check, null, 2)).toMatchObject({
      ok: true,
      rowCount: 14,
      expectedRowCount: 14,
      duplicateIds: [],
      duplicateKeys: [],
      contaminated: [],
      unknownTags: []
    })
    for (const report of check.tags) {
      expect(report.survivors).toBe(7)
      expect(report.missingSlots).toEqual([])
      expect(report.unexpectedSlots).toEqual([])
      expect(report.wrongStates).toEqual([])
    }
  })

  /** The check must actually fail on a broken end state, or it proves nothing. */
  it('mixedCheck rejects a run whose end state is incomplete', () => {
    const handle = installGasFakes({
      spreadsheets: { [TEST_SPREADSHEET_ID]: new FakeSpreadsheet(TEST_SPREADSHEET_ID) },
      activeId: TEST_SPREADSHEET_ID
    })
    restore = () => handle.restore()

    mixedBurst('left', 3, TEST_SPREADSHEET_ID)

    const check = mixedCheck(['left', 'right'], TEST_SPREADSHEET_ID)
    expect(check.ok).toBe(false)
    expect(check.rowCount).toBe(7)
    expect(check.expectedRowCount).toBe(14)
    expect(check.tags.find(report => report.tag === 'right')?.missingSlots).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})
