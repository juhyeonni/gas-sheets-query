/**
 * #136 — a Sheets cell holds at most 50,000 characters. Oversized values used
 * to be discovered by the platform *during* the write, so a batch aborted
 * halfway and left a partial update behind. These tests pin that the guard
 * rejects before anything is written, and that a batch is validated as a whole.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CELL_LENGTH, SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { CellSizeLimitError } from '../../src'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import type { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'

interface Row {
  id: number
  name: string
  notes: string
  [key: string]: unknown
}

const SPREADSHEET_ID = 'cell-size-guard'
const SHEET_NAME = 'Docs'
const COLUMNS = ['id', 'name', 'notes']

/** A string that fits, and one that does not. */
const OK_VALUE = 'x'.repeat(MAX_CELL_LENGTH)
const OVERSIZED = 'x'.repeat(MAX_CELL_LENGTH + 1)

let handle: GasFakesHandle
let spreadsheet: FakeSpreadsheet
let sheet: FakeSheet
let writes: number

function seed(rows: unknown[][] = []): SheetsAdapter<Row> {
  spreadsheet = fromArrays({ [SHEET_NAME]: [COLUMNS, ...rows] })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })

  const found = spreadsheet.getSheetByName(SHEET_NAME)
  if (!found) throw new Error('seed: sheet missing')
  sheet = found

  // Count every mutation the adapter attempts, whatever shape it takes.
  writes = 0
  const originalGetRange = sheet.getRange.bind(sheet)
  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    const range = originalGetRange(row, col, numRows, numCols)
    const setValues = range.setValues.bind(range)
    range.setValues = (values: unknown[][]) => {
      writes++
      setValues(values)
    }
    return range
  }
  const originalAppend = sheet.appendRow.bind(sheet)
  sheet.appendRow = (values: unknown[]) => {
    writes++
    originalAppend(values)
  }

  return new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS
  })
}

describe('cell size guard (#136)', () => {
  afterEach(() => handle?.restore())

  it('exposes the documented Sheets ceiling', () => {
    expect(MAX_CELL_LENGTH).toBe(50000)
  })

  it('accepts a value exactly at the limit', () => {
    const adapter = seed()
    expect(() => adapter.insert({ name: 'ok', notes: OK_VALUE })).not.toThrow()
    expect(sheet.getLastRow()).toBe(2)
  })

  it('rejects an oversized value on insert without writing', () => {
    const adapter = seed()

    try {
      adapter.insert({ name: 'too big', notes: OVERSIZED })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CellSizeLimitError)
      const typed = error as CellSizeLimitError
      expect(typed.code).toBe('CELL_SIZE_LIMIT')
      expect(typed.column).toBe('notes')
      expect(typed.tableName).toBe(SHEET_NAME)
      expect(typed.length).toBe(MAX_CELL_LENGTH + 1)
      expect(typed.limit).toBe(MAX_CELL_LENGTH)
      expect(typed.message).toContain('notes')
      expect(typed.message).toContain(SHEET_NAME)
      expect(typed.message).toContain(String(MAX_CELL_LENGTH + 1))
    }

    expect(writes).toBe(0)
    expect(sheet.getLastRow()).toBe(1)
  })

  it('measures the serialized JSON, not the source object', () => {
    // A modest-looking object can serialize past the limit; the guard has to
    // run on what actually reaches the cell.
    seed()
    const adapter = new SheetsAdapter<Row>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS,
      columnTypes: { notes: 'json' }
    })
    const big = { blob: 'y'.repeat(MAX_CELL_LENGTH) }

    expect(() => adapter.insert({ name: 'json', notes: big as unknown as string }))
      .toThrow(CellSizeLimitError)
    expect(writes).toBe(0)
  })

  it('rejects the whole batch before writing any row', () => {
    const adapter = seed()
    const items = [
      { name: 'a', notes: 'fine' },
      { name: 'b', notes: 'fine' },
      { name: 'c', notes: OVERSIZED },
      { name: 'd', notes: 'fine' }
    ]

    expect(() => adapter.batchInsert(items)).toThrow(CellSizeLimitError)
    expect(writes).toBe(0)
    expect(sheet.getLastRow()).toBe(1)
  })

  it('rejects the whole batchUpdate before writing any row', () => {
    const adapter = seed([
      [1, 'a', 'fine'],
      [2, 'b', 'fine'],
      [3, 'c', 'fine']
    ])

    expect(() => adapter.batchUpdate([
      { id: 1, data: { notes: 'still fine' } },
      { id: 3, data: { notes: OVERSIZED } }
    ])).toThrow(CellSizeLimitError)

    expect(writes).toBe(0)
    expect(adapter.findById(1)?.notes).toBe('fine')
  })

  it('rejects an oversized update without touching the row', () => {
    const adapter = seed([[1, 'a', 'fine']])

    expect(() => adapter.update(1, { notes: OVERSIZED })).toThrow(CellSizeLimitError)
    expect(writes).toBe(0)
    expect(adapter.findById(1)?.notes).toBe('fine')
  })

  it('rejects an oversized addColumn default before clearing or writing data', () => {
    const adapter = new SheetsAdapter<Row>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS
    })
    seed([[1, 'a', '']])

    expect(() => adapter.addColumn('notes', { default: OVERSIZED })).toThrow(CellSizeLimitError)
  })

  it('rejects an oversized reset row before clearing the sheet', () => {
    const adapter = seed([[1, 'a', 'existing']])

    expect(() => adapter.reset([
      { id: 1, name: 'a', notes: 'fine' },
      { id: 2, name: 'b', notes: OVERSIZED }
    ])).toThrow(CellSizeLimitError)

    // The old data must survive: a guard that fires after clear() is a data-loss bug.
    expect(sheet.getLastRow()).toBe(2)
    expect(adapter.findById(1)?.notes).toBe('existing')
  })

  it('accounts for the formula-escape prefix', () => {
    // '=' + 50,000 chars becomes "'=..." — 50,002 characters in the cell.
    const adapter = seed()
    expect(() => adapter.insert({ name: 'formulaish', notes: '=' + 'z'.repeat(MAX_CELL_LENGTH - 1) }))
      .toThrow(CellSizeLimitError)
  })
})
