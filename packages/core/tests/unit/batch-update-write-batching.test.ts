/**
 * batchUpdate is documented as the efficient path, but it used to issue one
 * setValues call per updated row (#129) — 1,000 updated rows meant 1,000 write
 * round-trips, and a few thousand rows blew through the GAS 6-minute limit
 * mid-loop, leaving a silent partial update.
 *
 * These tests pin the write shape: dirty rows are coalesced into contiguous
 * ranges, and rows nobody asked to update are never rewritten (rewriting them
 * would widen the clobber window against concurrent writers and would destroy
 * formulas in untouched cells).
 */
import { describe, it, expect } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import type { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'

interface Row {
  id: number
  name: string
  score: number
}

const SPREADSHEET_ID = 'batch-update-write-batching'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name', 'score']

/** One recorded `Range.setValues` call, in sheet coordinates. */
interface WriteCall {
  startRow: number
  numRows: number
  numCols: number
}

interface Recorder {
  writes: WriteCall[]
  reads: number
}

/**
 * Wraps `sheet.getRange` so every range handed out records its reads/writes.
 * Counts calls, not cells — calls are what the GAS quota and the 6-minute
 * budget are actually spent on.
 */
function recordRangeCalls(sheet: FakeSheet): Recorder {
  const recorder: Recorder = { writes: [], reads: 0 }
  const original = sheet.getRange.bind(sheet)

  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    const range = original(row, col, numRows, numCols)
    const readValues = range.getValues.bind(range)
    const writeValues = range.setValues.bind(range)

    range.getValues = () => {
      recorder.reads++
      return readValues()
    }
    range.setValues = (values: unknown[][]) => {
      recorder.writes.push({ startRow: row, numRows, numCols })
      writeValues(values)
    }
    return range
  }

  return recorder
}

/** Sheet with `rowCount` data rows: id 1..n, name `user-<n>`, score `n * 10`. */
function seed(rowCount: number): { adapter: SheetsAdapter<Row>; recorder: Recorder } {
  const rows: unknown[][] = [COLUMNS]
  for (let i = 1; i <= rowCount; i++) {
    rows.push([i, `user-${i}`, i * 10])
  }

  const spreadsheet: FakeSpreadsheet = fromArrays({ [SHEET_NAME]: rows })
  installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })

  const sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw new Error('seed: sheet missing')

  const adapter = new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS
  })

  return { adapter, recorder: recordRangeCalls(sheet) }
}

/** Every sheet row index covered by a write range. */
function rowsTouched(writes: WriteCall[]): number[] {
  const touched: number[] = []
  for (const write of writes) {
    for (let r = write.startRow; r < write.startRow + write.numRows; r++) touched.push(r)
  }
  return touched.sort((a, b) => a - b)
}

describe('batchUpdate write batching [#129]', () => {
  it('writes a fully contiguous update block in a single setValues call', () => {
    const rowCount = 500
    const { adapter, recorder } = seed(rowCount)

    const items = Array.from({ length: rowCount }, (_, i) => ({
      id: i + 1,
      data: { name: `renamed-${i + 1}` }
    }))

    const results = adapter.batchUpdate(items)

    expect(results).toHaveLength(rowCount)
    // One read of the whole data block, one write of the whole data block.
    expect(recorder.reads).toBe(1)
    expect(recorder.writes).toEqual([{ startRow: 2, numRows: rowCount, numCols: COLUMNS.length }])
  })

  it('issues one write per contiguous run of updated rows', () => {
    const { adapter, recorder } = seed(10)

    // Rows 2-4 (ids 1-3) and rows 8-9 (ids 7-8): two runs.
    adapter.batchUpdate([
      { id: 1, data: { name: 'a' } },
      { id: 2, data: { name: 'b' } },
      { id: 3, data: { name: 'c' } },
      { id: 7, data: { name: 'g' } },
      { id: 8, data: { name: 'h' } }
    ])

    expect(recorder.writes).toEqual([
      { startRow: 2, numRows: 3, numCols: COLUMNS.length },
      { startRow: 8, numRows: 2, numCols: COLUMNS.length }
    ])
  })

  it('never rewrites a row that was not updated', () => {
    const rowCount = 20
    const { adapter, recorder } = seed(rowCount)

    // Every other row: worst case for coalescing, but clean rows still must
    // not be touched — an untouched row rewritten is a concurrent update lost.
    const targetIds = Array.from({ length: rowCount / 2 }, (_, i) => i * 2 + 1)
    adapter.batchUpdate(targetIds.map(id => ({ id, data: { score: 0 } })))

    const expectedRows = targetIds.map(id => id + 1) // +1 for the header row
    expect(rowsTouched(recorder.writes)).toEqual(expectedRows)
    expect(recorder.writes.every(w => w.numRows === 1)).toBe(true)
  })

  it('persists exactly the updated cells when runs are coalesced', () => {
    const { adapter } = seed(5)

    const results = adapter.batchUpdate([
      { id: 2, data: { name: 'two', score: 22 } },
      { id: 3, data: { score: 33 } },
      { id: 4, data: { name: 'four' } }
    ])

    // Return value is unchanged by batching: merged rows, in sheet order.
    expect(results).toEqual([
      { id: 2, name: 'two', score: 22 },
      { id: 3, name: 'user-3', score: 33 },
      { id: 4, name: 'four', score: 40 }
    ])

    adapter.clearCache()
    expect(adapter.getRawData()).toEqual([
      COLUMNS,
      [1, 'user-1', 10],
      [2, 'two', 22],
      [3, 'user-3', 33],
      [4, 'four', 40],
      [5, 'user-5', 50]
    ])
  })

  it('keeps write calls bounded on a large sheet (regression guard)', () => {
    const rowCount = 2000
    const { adapter, recorder } = seed(rowCount)

    // Two big contiguous blocks — pre-#129 this was 1,000 setValues calls.
    const items = [
      ...Array.from({ length: 500 }, (_, i) => ({ id: i + 1, data: { score: 1 } })),
      ...Array.from({ length: 500 }, (_, i) => ({ id: i + 1001, data: { score: 2 } }))
    ]

    adapter.batchUpdate(items)

    expect(recorder.writes).toEqual([
      { startRow: 2, numRows: 500, numCols: COLUMNS.length },
      { startRow: 1002, numRows: 500, numCols: COLUMNS.length }
    ])
  })
})
