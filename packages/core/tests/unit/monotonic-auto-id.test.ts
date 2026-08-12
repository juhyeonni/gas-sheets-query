/**
 * #177 — auto ids must never be reused, whatever was deleted.
 *
 * Allocation used to be `max(current ids) + 1`, so deleting the
 * highest-numbered row freed its id for the very next insert and any foreign
 * key still holding that id silently re-pointed at the new record. Ids are
 * now allocated from a persistent monotonic counter stored in the
 * spreadsheet's hidden `_gsquery_meta` sheet, as `max(stored, max + 1)` —
 * forward-only, and self-healing when the meta sheet or row is missing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { META_SHEET_NAME, SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { FakeSpreadsheet, installGasFakes, fromArrays } from '../../src/testing'

interface Row {
  id: number
  name: string
  [key: string]: unknown
}

interface ClientRow {
  id: string
  name: string
  [key: string]: unknown
}

let restore: (() => void) | undefined

function setup(spreadsheet?: FakeSpreadsheet): FakeSpreadsheet {
  const ss = spreadsheet ?? new FakeSpreadsheet('S')
  const handle = installGasFakes({ spreadsheets: { S: ss }, activeId: 'S' })
  restore = () => handle.restore()
  return ss
}

function makeAdapter(): SheetsAdapter<Row> {
  return new SheetsAdapter<Row>({ spreadsheetId: 'S', sheetName: 'users', columns: ['id', 'name'] })
}

afterEach(() => {
  restore?.()
  restore = undefined
})

describe('monotonic auto ids (#177)', () => {
  it('does not reuse the id of a deleted max row', () => {
    setup()
    const adapter = makeAdapter()

    adapter.insert({ name: 'a' })
    adapter.insert({ name: 'b' })
    const c = adapter.insert({ name: 'c' })
    expect(c.id).toBe(3)

    adapter.delete(3)
    const d = adapter.insert({ name: 'd' })

    // Pre-fix this was 3 again — the exact FK-rebinding hazard of #177.
    expect(d.id).toBe(4)
    expect(adapter.findAll().map(r => r.id)).toEqual([1, 2, 4])
  })

  it('survives delete-all: the counter outlives the data', () => {
    setup()
    const adapter = makeAdapter()

    adapter.batchInsert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    for (const id of [1, 2, 3]) adapter.delete(id)
    expect(adapter.findAll()).toEqual([])

    // An empty sheet used to reset allocation to 1.
    expect(adapter.insert({ name: 'fresh' }).id).toBe(4)
  })

  it('batchInsert reserves one contiguous run and advances the counter past it', () => {
    setup()
    const adapter = makeAdapter()

    const batch = adapter.batchInsert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    expect(batch.map(r => r.id)).toEqual([1, 2, 3])

    adapter.delete(3)
    expect(adapter.insert({ name: 'd' }).id).toBe(4)
  })

  it('bootstraps from existing data when no counter exists yet', () => {
    const spreadsheet = fromArrays(
      {
        users: [
          ['id', 'name'],
          [7, 'legacy']
        ]
      },
      'S'
    )
    setup(spreadsheet)
    const adapter = makeAdapter()

    // First allocation on a pre-counter sheet continues after the current max.
    expect(adapter.insert({ name: 'new' }).id).toBe(8)
    // ...and from here on the counter protects deletions.
    adapter.delete(8)
    expect(adapter.insert({ name: 'newer' }).id).toBe(9)
  })

  it('self-heals when a user deletes the meta sheet: moves forward, never back', () => {
    const spreadsheet = setup()
    const adapter = makeAdapter()

    adapter.batchInsert([{ name: 'a' }, { name: 'b' }])
    expect(spreadsheet.getSheetByName(META_SHEET_NAME)).not.toBeNull()

    spreadsheet.deleteSheet(spreadsheet.getSheetByName(META_SHEET_NAME)!)
    adapter.clearCache()

    // Degrades to max+1 (the pre-counter behavior) and recreates the sheet.
    expect(adapter.insert({ name: 'c' }).id).toBe(3)
    expect(spreadsheet.getSheetByName(META_SHEET_NAME)).not.toBeNull()
  })

  it('absorbs a manually entered id above the counter instead of colliding', () => {
    const spreadsheet = setup()
    const adapter = makeAdapter()

    adapter.insert({ name: 'a' })
    // A human types a row with id 100 straight into the sheet.
    spreadsheet.getSheetByName('users')!.appendRow([100, 'manual'])
    adapter.clearCache()

    expect(adapter.insert({ name: 'b' }).id).toBe(101)
  })

  it('keeps per-table counters independent on one spreadsheet', () => {
    setup()
    const users = makeAdapter()
    const orders = new SheetsAdapter<Row>({
      spreadsheetId: 'S',
      sheetName: 'orders',
      columns: ['id', 'name']
    })

    users.batchInsert([{ name: 'u1' }, { name: 'u2' }, { name: 'u3' }])
    expect(orders.insert({ name: 'o1' }).id).toBe(1)
    users.delete(3)
    expect(users.insert({ name: 'u4' }).id).toBe(4)
    expect(orders.insert({ name: 'o2' }).id).toBe(2)
  })

  it('a second adapter instance on the same table sees the same counter', () => {
    setup()
    const first = makeAdapter()

    first.insert({ name: 'a' })
    first.insert({ name: 'b' })
    first.delete(2)

    // A different execution (new adapter instance) must not re-issue id 2 —
    // this is why the counter lives in the spreadsheet, not in memory.
    const second = makeAdapter()
    expect(second.insert({ name: 'c' }).id).toBe(3)
  })

  it('client idMode never touches the counter or the meta sheet', () => {
    const spreadsheet = setup()
    const adapter = new SheetsAdapter<ClientRow>({
      spreadsheetId: 'S',
      sheetName: 'docs',
      columns: ['id', 'name'],
      idMode: 'client'
    })

    adapter.insert({ id: 'uuid-1', name: 'a' })
    adapter.batchInsert([{ id: 'uuid-2', name: 'b' }])

    expect(spreadsheet.getSheetByName(META_SHEET_NAME)).toBeNull()
  })
})
