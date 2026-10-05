/**
 * One DataStore contract, run against every adapter core ships (#195).
 *
 * The clauses live in `runDataStoreConformance` (`@gsquery/core/testing`);
 * LocalAdapter runs the same suite from `@gsquery/client`'s tests. A
 * behavioral difference between adapters is therefore a failing test here,
 * not a convention someone has to remember.
 */
import { describe, it } from 'vitest'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { installGasFakes, fromArrays, runDataStoreConformance } from '../../src/testing'
import type { FakeSpreadsheet, ConformanceRow, DataStoreFactory } from '../../src/testing'

const createMock: DataStoreFactory = ({ idMode, seed, indexes }) => ({
  store: new MockAdapter<ConformanceRow>({ initialData: seed, indexes, idMode }),
})

/**
 * Every call gets a spreadsheet of its own, so two stores opened in one case
 * (an indexed one and an unindexed one) never share a sheet. SheetsAdapter has
 * no index support and ignores `indexes`.
 */
const spreadsheets: Record<string, FakeSpreadsheet> = {}
let spreadsheetCount = 0

const createSheets: DataStoreFactory = ({ idMode, seed, columns }) => {
  const spreadsheetId = `conformance-${++spreadsheetCount}`
  const grid: unknown[][] = [
    [...columns],
    ...seed.map((row: Record<string, unknown>) => columns.map(column => row[column] ?? '')),
  ]
  spreadsheets[spreadsheetId] = fromArrays({ Rows: grid })
  const fakes = installGasFakes({ spreadsheets })
  const store = new SheetsAdapter<ConformanceRow>({
    spreadsheetId,
    sheetName: 'Rows',
    columns: [...columns],
    idMode,
  })
  return {
    store,
    cleanup: () => {
      fakes.restore()
      delete spreadsheets[spreadsheetId]
    },
  }
}

runDataStoreConformance({ name: 'MockAdapter', create: createMock, describe, it })
runDataStoreConformance({ name: 'SheetsAdapter (GAS fakes)', create: createSheets, describe, it })
