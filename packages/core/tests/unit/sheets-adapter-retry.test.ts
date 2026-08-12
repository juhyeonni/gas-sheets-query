/**
 * #136 — where SheetsAdapter applies the retry policy.
 *
 * The policy is not "retry everything": `setValues` over a fixed range and
 * every read are idempotent and safe to repeat, while `appendRow`/`deleteRow`
 * are not — a timed-out append may well have landed, and repeating it would
 * duplicate the row (in auto id mode, duplicate it under the same id). These
 * tests pin both halves of that distinction.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { SheetsApiError } from '../../src'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import type { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import type { GasFakesHandle } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'

interface Row {
  id: number
  name: string
  [key: string]: unknown
}

const SPREADSHEET_ID = 'sheets-adapter-retry'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name']
const TRANSIENT = 'Service Spreadsheets timed out while accessing document with id 1AbC.'

let handle: GasFakesHandle
let spreadsheet: FakeSpreadsheet
let sheet: FakeSheet

function seed(rows: unknown[][] = [[1, 'a'], [2, 'b']]): SheetsAdapter<Row> {
  spreadsheet = fromArrays({ [SHEET_NAME]: [COLUMNS, ...rows] })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })

  const found = spreadsheet.getSheetByName(SHEET_NAME)
  if (!found) throw new Error('seed: sheet missing')
  sheet = found

  return new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS
  })
}

/** Makes the first `times` calls of every `getValues` throw `message`. */
function failReads(times: number, message = TRANSIENT): { remaining: () => number } {
  let left = times
  const originalGetRange = sheet.getRange.bind(sheet)
  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    const range = originalGetRange(row, col, numRows, numCols)
    const getValues = range.getValues.bind(range)
    range.getValues = () => {
      if (left > 0) {
        left--
        throw new Error(message)
      }
      return getValues()
    }
    return range
  }
  return { remaining: () => left }
}

describe('SheetsAdapter retry placement (#136)', () => {
  afterEach(() => handle?.restore())

  it('retries a transient read failure and still returns the data', () => {
    const adapter = seed()
    failReads(2)

    expect(adapter.findAll()).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' }
    ])
  })

  it('surfaces a typed SheetsApiError once the attempts are spent', () => {
    const adapter = seed()
    failReads(Number.MAX_SAFE_INTEGER)

    expect(() => adapter.findAll()).toThrow(SheetsApiError)
  })

  it('retries a transient fixed-range write, which is idempotent', () => {
    const adapter = seed()

    let writeFailures = 1
    const originalGetRange = sheet.getRange.bind(sheet)
    sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
      const range = originalGetRange(row, col, numRows, numCols)
      const setValues = range.setValues.bind(range)
      range.setValues = (values: unknown[][]) => {
        if (writeFailures > 0) {
          writeFailures--
          throw new Error(TRANSIENT)
        }
        setValues(values)
      }
      return range
    }

    expect(adapter.update(1, { name: 'renamed' })?.name).toBe('renamed')
    expect(adapter.findById(1)?.name).toBe('renamed')
  })

  it('never retries appendRow, so a possibly-committed insert is not duplicated', () => {
    const adapter = seed([])

    let calls = 0
    const originalAppend = sheet.appendRow.bind(sheet)
    sheet.appendRow = (values: unknown[]) => {
      calls++
      // Model the dangerous case: the write lands, then the call reports a timeout.
      originalAppend(values)
      throw new Error(TRANSIENT)
    }

    expect(() => adapter.insert({ name: 'a' })).toThrow(SheetsApiError)
    expect(calls).toBe(1)
    expect(sheet.getLastRow()).toBe(2)
  })

  it('never retries deleteRow, which is not idempotent either', () => {
    const adapter = seed()

    let calls = 0
    sheet.deleteRow = () => {
      calls++
      throw new Error(TRANSIENT)
    }

    expect(() => adapter.delete(1)).toThrow(SheetsApiError)
    expect(calls).toBe(1)
  })

  it('does not retry a logical failure', () => {
    const adapter = seed()
    let calls = 0
    const originalGetRange = sheet.getRange.bind(sheet)
    sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
      const range = originalGetRange(row, col, numRows, numCols)
      range.getValues = () => {
        calls++
        throw new TypeError('not a function')
      }
      return range
    }

    expect(() => adapter.findAll()).toThrow(TypeError)
    expect(calls).toBe(1)
  })
})
