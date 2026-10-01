/**
 * SheetsAdapter.count() counts rows with a non-empty id cell (#236). Warm and
 * cold answers must agree, so the warm one is recorded from raw cells.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'
import { SchemaMismatchError } from '../../src/core/errors'
import type { RowWithId } from '../../src/core/types'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'

const SPREADSHEET_ID = 'sheets-adapter-count'
const SHEET = 'Users'
const COLUMNS = ['id', 'name', 'score']

let handle: GasFakesHandle | undefined

afterEach(() => {
  handle?.restore()
  handle = undefined
})

function open(grid: unknown[][], options: Partial<SheetsAdapterOptions> = {}): SheetsAdapter<RowWithId> {
  const spreadsheet = fromArrays({ [SHEET]: grid })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
  return new SheetsAdapter<RowWithId>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET,
    columns: COLUMNS,
    idMode: 'client',
    ...options
  })
}

const ROWS: unknown[][] = [
  [1, 'a', 10],
  ['', 'human', 5],
  [2, 'b', 20],
  ['', '', ''],
  [2, 'dup', 30]
]

describe('SheetsAdapter.count [#236]', () => {
  it('counts rows with a non-empty id cell; findAll also returns blank-id rows', () => {
    const adapter = open([COLUMNS, ...ROWS])

    // Blank-id and all-blank rows are excluded; duplicate id 2 counts per row.
    expect(adapter.count()).toBe(3)
    expect(adapter.findAll()).toHaveLength(4)
    expect(adapter.count()).toBe(3)
  })

  it('warm and cold count agree when the id column is typed number (blank deserializes to 0)', () => {
    const adapter = open([COLUMNS, ...ROWS], { columnTypes: { id: 'number' } })

    expect(adapter.count()).toBe(3)
    expect(adapter.findAll().map(r => r.id)).toContain(0)
    expect(adapter.count()).toBe(3)
  })

  it('is 0 on an empty sheet and throws SchemaMismatchError on a drifted header', () => {
    expect(open([COLUMNS]).count()).toBe(0)
    handle?.restore()

    const drifted = open([['id', 'inserted', 'name', 'score'], [1, 'x', 'a', 10]])
    expect(() => drifted.count()).toThrow(SchemaMismatchError)
  })
})
