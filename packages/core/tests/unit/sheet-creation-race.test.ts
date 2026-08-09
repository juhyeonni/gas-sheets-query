/**
 * #178 — sheet auto-creation must be a locked critical section.
 *
 * Two executions touching a not-yet-created table both used to see
 * `getSheetByName() === null` and both called `insertSheet`: the loser threw
 * "a sheet named X already exists", and its already-acknowledged early rows
 * could be clobbered by the winner's header write (observed on the live
 * platform by the mixed-workload scenario).
 *
 * These tests model the race at the lock boundary: the "intruder" wins the
 * creation while our adapter is blocked in `waitLock`. The fix re-checks
 * inside the lock, so the loser adopts the existing sheet instead of racing
 * a second creation.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { FakeSpreadsheet, installGasFakes } from '../../src/testing'

interface Row {
  id: number
  name: string
  [key: string]: unknown
}

function makeAdapter(): SheetsAdapter<Row> {
  return new SheetsAdapter<Row>({ spreadsheetId: 'S', sheetName: 'users', columns: ['id', 'name'] })
}

describe('sheet auto-creation race (#178)', () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    restore?.()
    restore = undefined
  })

  it('adopts a sheet created by a concurrent execution inside the race window', () => {
    const spreadsheet = new FakeSpreadsheet('S')
    const handle = installGasFakes({ spreadsheets: { S: spreadsheet }, activeId: 'S' })
    restore = () => handle.restore()

    // Model the exact race window: the loser's first existence check reads a
    // stale "no such sheet" view, while the winner's creation lands in the
    // same instant. The first getSheetByName('users') spawns the winner's
    // full insert (sheet + header + one row) and still reports null — every
    // later check sees the truth. Pre-fix, the loser then called insertSheet
    // on the taken name and threw; the fixed path re-checks under the lock
    // and adopts the winner's sheet.
    const realGetSheetByName = spreadsheet.getSheetByName.bind(spreadsheet)
    let staleReads = 0
    spreadsheet.getSheetByName = (name: string) => {
      const found = realGetSheetByName(name)
      if (name === 'users' && !found && staleReads === 0) {
        staleReads++
        const winner = makeAdapter()
        winner.insert({ name: 'winner-row' })
        return null // the loser's read was already in flight — stale view
      }
      return found
    }

    const loser = makeAdapter()
    // Pre-fix this threw `insertSheet: a sheet named "users" already exists`.
    const inserted = loser.insert({ name: 'loser-row' })

    const rows = loser.findAll()
    expect(rows.length).toBe(2)
    expect(rows.map(r => r.name).sort()).toEqual(['loser-row', 'winner-row'])
    expect(rows.find(r => r.id === inserted.id)?.name).toBe('loser-row')

    // Exactly one physical sheet was created.
    expect(spreadsheet.getSheets().length).toBe(1)
    // The winner's header row survived intact (no clobber by a second creation).
    expect(spreadsheet.getSheetByName('users')?.getRange(1, 1, 1, 2).getValues()[0]).toEqual(['id', 'name'])
  })

  it('adopts the winner even when the in-lock re-check also reads stale (live repro of run 31298880115)', () => {
    const spreadsheet = new FakeSpreadsheet('S')
    const handle = installGasFakes({ spreadsheets: { S: spreadsheet }, activeId: 'S' })
    restore = () => handle.restore()

    // Model the harsher live failure: BOTH the unlocked check and the
    // in-lock re-check read a stale "no such sheet" view (a Spreadsheet
    // handle's sheet list can lag another execution's creation even under
    // the lock). insertSheet then throws on the taken name, and only the
    // adopt-on-failure path can recover.
    const realGetSheetByName = spreadsheet.getSheetByName.bind(spreadsheet)
    let staleReads = 0
    spreadsheet.getSheetByName = (name: string) => {
      const found = realGetSheetByName(name)
      if (name === 'users' && found && staleReads < 2) {
        staleReads++
        return null // stale handle: the winner's sheet is not visible yet
      }
      if (name === 'users' && !found && staleReads === 0) {
        staleReads++
        const winner = makeAdapter()
        winner.insert({ name: 'winner-row' })
        return null
      }
      return found
    }

    const loser = makeAdapter()
    const inserted = loser.insert({ name: 'loser-row' })

    const rows = loser.findAll()
    expect(rows.length).toBe(2)
    expect(rows.map(r => r.name).sort()).toEqual(['loser-row', 'winner-row'])
    expect(rows.find(r => r.id === inserted.id)?.name).toBe('loser-row')
    expect(spreadsheet.getSheets().length).toBe(1)
  })

  it('creates the sheet exactly once when it truly does not exist', () => {
    const spreadsheet = new FakeSpreadsheet('S')
    const handle = installGasFakes({ spreadsheets: { S: spreadsheet }, activeId: 'S' })
    restore = () => handle.restore()

    const adapter = makeAdapter()
    adapter.insert({ name: 'first' })

    expect(spreadsheet.getSheets().length).toBe(1)
    expect(adapter.findAll().length).toBe(1)
  })
})
