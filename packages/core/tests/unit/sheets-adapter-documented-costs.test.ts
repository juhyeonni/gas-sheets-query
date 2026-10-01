/**
 * Pins the SheetsAdapter costs that the docs describe (#240), so a later change
 * to the read/write path that makes the documentation stale breaks a test.
 *
 * Costs are counted in sheet reads (cells) and writes (calls) on the data sheet.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { DuplicateIdError } from '../../src/core/errors'
import { Repository } from '../../src/core/repository'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes, type GasFakesHandle } from '../../src/testing/install'

interface Row {
  id: number
  name: string
  score: number
}

const SPREADSHEET_ID = 'documented-costs'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name', 'score']
const C = COLUMNS.length

interface ReadCall {
  startRow: number
  startCol: number
  numRows: number
  numCols: number
}

interface WriteCall {
  startRow: number
  numRows: number
  numCols: number
}

interface Recorder {
  reads: ReadCall[]
  writes: WriteCall[]
  appendRows: number
  deleteRowCalls: number
  deleteRowsCalls: { start: number; count: number }[]
  flushes: number
  clear(): void
  cellsRead(): number
}

function recordRangeCalls(sheet: FakeSheet): Recorder {
  const recorder: Recorder = {
    reads: [],
    writes: [],
    appendRows: 0,
    deleteRowCalls: 0,
    deleteRowsCalls: [],
    flushes: 0,
    clear() {
      recorder.reads.length = 0
      recorder.writes.length = 0
      recorder.appendRows = 0
      recorder.deleteRowCalls = 0
      recorder.deleteRowsCalls.length = 0
      recorder.flushes = 0
    },
    cellsRead() {
      return recorder.reads.reduce((sum, r) => sum + r.numRows * r.numCols, 0)
    }
  }
  const original = sheet.getRange.bind(sheet)
  const originalAppendRow = sheet.appendRow.bind(sheet)
  const originalDeleteRow = sheet.deleteRow.bind(sheet)

  sheet.appendRow = (values: unknown[]) => {
    recorder.appendRows++
    return originalAppendRow(values)
  }
  sheet.deleteRow = (row: number) => {
    recorder.deleteRowCalls++
    return originalDeleteRow(row)
  }
  const originalDeleteRows = sheet.deleteRows.bind(sheet)
  sheet.deleteRows = (start: number, count: number) => {
    recorder.deleteRowsCalls.push({ start, count })
    return originalDeleteRows(start, count)
  }
  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    const range = original(row, col, numRows, numCols)
    const readValues = range.getValues.bind(range)
    const writeValues = range.setValues.bind(range)

    range.getValues = () => {
      recorder.reads.push({ startRow: row, startCol: col, numRows, numCols })
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

const handles: GasFakesHandle[] = []

afterEach(() => {
  // Restore in reverse install order (see testing/install.ts).
  while (handles.length > 0) handles.pop()?.restore()
})

interface Cost {
  reads: number
  cells: number
  setValues: number
  appendRow: number
  deleteRow: number
  deleteRows: number
  flush: number
}

function cost(recorder: Recorder): Cost {
  return {
    reads: recorder.reads.length,
    cells: recorder.cellsRead(),
    setValues: recorder.writes.length,
    appendRow: recorder.appendRows,
    deleteRow: recorder.deleteRowCalls,
    deleteRows: recorder.deleteRowsCalls.length,
    flush: recorder.flushes
  }
}

const ZERO: Cost = { reads: 0, cells: 0, setValues: 0, appendRow: 0, deleteRow: 0, deleteRows: 0, flush: 0 }

/**
 * Sheet with ids 1..n. Warms up with findAll() (header check + cache fill),
 * then clears the recorder so assertions count only the operation under test.
 */
function seed(
  rowCount: number,
  idMode: 'auto' | 'client' = 'auto',
  warm = true
): { adapter: SheetsAdapter<Row>; recorder: Recorder; sheet: FakeSheet } {
  const rows: unknown[][] = [COLUMNS]
  for (let i = 1; i <= rowCount; i++) rows.push([i, `user-${i}`, i * 10])

  const spreadsheet = fromArrays({ [SHEET_NAME]: rows })
  handles.push(installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID }))

  const sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw new Error('seed: sheet missing')

  const adapter = new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS,
    idMode
  })
  const recorder = recordRangeCalls(sheet)

  const spreadsheetApp = (globalThis as unknown as { SpreadsheetApp: { flush: () => void } }).SpreadsheetApp
  const originalFlush = spreadsheetApp.flush.bind(spreadsheetApp)
  spreadsheetApp.flush = () => {
    recorder.flushes++
    originalFlush()
  }

  if (warm) adapter.findAll()
  recorder.clear()
  return { adapter, recorder, sheet }
}

describe('SheetsAdapter documented costs [#240]', () => {
  it('findById is served from the warm read cache', () => {
    const { adapter, recorder } = seed(100)

    expect(adapter.findById(50)?.id).toBe(50)
    expect(adapter.findById('50')?.id).toBe(50)
    expect(adapter.findById(999)).toBeUndefined()
    expect(recorder.reads).toEqual([])
    expect(recorder.writes).toEqual([])
  })

  it('cold-cache findById reads only the row once the id map is known', () => {
    const { adapter, recorder } = seed(100)

    adapter.update(1, { score: 0 })
    recorder.clear()

    expect(adapter.findById(50)?.id).toBe(50)
    expect(recorder.reads).toEqual([{ startRow: 51, startCol: 1, numRows: 1, numCols: C }])
  })

  it('update and delete read the id column once per instance, then only the row or the id cell', () => {
    const { adapter, recorder, sheet } = seed(50)

    adapter.update(10, { name: 'x' })
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: 50, numCols: 1 })

    recorder.clear()
    adapter.update(20, { name: 'x' })
    expect(recorder.reads).toEqual([{ startRow: 21, startCol: 1, numRows: 1, numCols: C }])

    // The map is warm, so delete verifies the hinted id cell only.
    recorder.clear()
    adapter.delete(30)
    expect(recorder.reads).toEqual([{ startRow: 31, startCol: 1, numRows: 1, numCols: 1 }])
    expect(recorder.deleteRowCalls).toBe(1)

    // Id 40 moved from row 41 to row 40; the map was patched after the delete.
    recorder.clear()
    adapter.delete(40)
    expect(recorder.reads).toEqual([{ startRow: 40, startCol: 1, numRows: 1, numCols: 1 }])

    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => i + 1).filter(id => id !== 30 && id !== 40))
  })

  it('a loop of M single updates reads N + M*C cells; batchUpdate still saves M-1 writes and 2M-2 flushes', () => {
    const N = 200
    const M = 200

    const loop = seed(N)
    for (let id = 1; id <= M; id++) loop.adapter.update(id, { score: 0 })
    expect(loop.recorder.cellsRead()).toBe(N + M * C)
    expect(loop.recorder.writes).toHaveLength(M)
    expect(loop.recorder.flushes).toBe(2 * M)

    const batch = seed(N)
    batch.adapter.batchUpdate(Array.from({ length: M }, (_, i) => ({ id: i + 1, data: { score: 0 } })))
    // Worst case: every row is dirty, so the span is the whole table and the
    // id-column read adds N cells on top (the pre-#236 read was N*C = 600).
    expect(batch.recorder.cellsRead()).toBe(N + M * C)
    expect(batch.recorder.writes).toHaveLength(1)
    expect(batch.recorder.flushes).toBe(2)
  })

  it('batchUpdate on scattered rows reads the id column and the matched span, then writes one row per run', () => {
    const { adapter, recorder } = seed(20)

    const ids = Array.from({ length: 10 }, (_, i) => i * 2 + 1)
    adapter.batchUpdate(ids.map(id => ({ id, data: { score: 0 } })))

    expect(recorder.reads).toEqual([
      { startRow: 2, startCol: 1, numRows: 20, numCols: 1 },
      { startRow: 2, startCol: 1, numRows: 19, numCols: C }
    ])
    expect(recorder.writes).toHaveLength(10)
    expect(recorder.writes.every(w => w.numRows === 1)).toBe(true)
  })

  it('batchInsert reads the id column once per batch, not once per row (auto mode)', () => {
    const { adapter, recorder } = seed(30, 'auto')

    const created = adapter.batchInsert(
      Array.from({ length: 50 }, (_, i) => ({ name: `new-${i}`, score: i }))
    )

    expect(created.map(r => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => 31 + i))
    expect(recorder.reads.filter(r => r.numCols === 1 && r.startCol === 1)).toEqual([
      { startRow: 2, startCol: 1, numRows: 30, numCols: 1 }
    ])
    expect(recorder.writes).toEqual([{ startRow: 32, numRows: 50, numCols: C }])
  })

  it('every write drops the read cache, including an insert that throws and batchDelete', () => {
    const { adapter, recorder, sheet } = seed(10, 'client')

    // Control: the cache is warm, so a second findAll reads nothing.
    adapter.findAll()
    expect(recorder.reads).toEqual([])

    expect(() => adapter.insert({ id: 1, name: 'dup', score: 0 })).toThrow(DuplicateIdError)

    recorder.clear()
    adapter.findAll()
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: 10, numCols: C })
    expect(sheet.getLastRow() - 1).toBe(10)

    adapter.batchDelete([1])
    recorder.clear()
    adapter.findAll()
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: 9, numCols: C })
  })

  it('unique: true is declarative — MockAdapter accepts duplicate values', () => {
    const adapter = new MockAdapter<{ id: number; email: string }>({
      indexes: [{ fields: ['email'], unique: true }]
    })

    adapter.insert({ email: 'a@x' })
    adapter.insert({ email: 'a@x' })

    const found = adapter.find({ where: [{ field: 'email', operator: '=', value: 'a@x' }], orderBy: [] })
    expect(found).toHaveLength(2)
  })
})

describe('SheetsAdapter cost budget [#218]', () => {
  it.each([100, 1000, 5000])('read paths at N=%i', N => {
    const cold = seed(N, 'auto', false)
    cold.adapter.findAll()
    expect(cost(cold.recorder)).toEqual({ ...ZERO, reads: 2, cells: N * C + C })
    expect(cold.recorder.reads).toEqual([
      { startRow: 1, startCol: 1, numRows: 1, numCols: C },
      { startRow: 2, startCol: 1, numRows: N, numCols: C }
    ])

    const { adapter, recorder } = seed(N)
    adapter.findAll()
    expect(cost(recorder)).toEqual(ZERO)

    adapter.find({ where: [{ field: 'score', operator: '>', value: 5 }], orderBy: [] })
    expect(cost(recorder)).toEqual(ZERO)

    adapter.findById(N / 2)
    expect(cost(recorder)).toEqual(ZERO)

    expect(adapter.count()).toBe(N)
    expect(cost(recorder)).toEqual(ZERO)
  })

  it.each([100, 1000, 5000])('count after a write and after clearCache at N=%i', N => {
    const afterWrite = seed(N)
    afterWrite.adapter.update(1, { score: 0 })
    afterWrite.recorder.clear()
    expect(afterWrite.adapter.count()).toBe(N)
    expect(cost(afterWrite.recorder)).toEqual({ ...ZERO, reads: 1, cells: N })

    const afterClear = seed(N)
    afterClear.adapter.clearCache()
    afterClear.recorder.clear()
    expect(afterClear.adapter.count()).toBe(N)
    expect(cost(afterClear.recorder)).toEqual({ ...ZERO, reads: 2, cells: C + N })
  })

  it.each([100, 1000, 5000])('locked single-row writes at N=%i', N => {
    const auto = seed(N)
    auto.adapter.insert({ name: 'new', score: 1 })
    expect(cost(auto.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, appendRow: 1, flush: 2 })
    auto.recorder.clear()
    auto.adapter.insert({ name: 'new', score: 1 })
    expect(cost(auto.recorder)).toEqual({ ...ZERO, appendRow: 1, flush: 2 })

    const client = seed(N, 'client')
    client.adapter.insert({ id: N + 1, name: 'new', score: 1 })
    expect(cost(client.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, appendRow: 1, flush: 2 })
    client.recorder.clear()
    client.adapter.insert({ id: N + 2, name: 'new', score: 1 })
    expect(cost(client.recorder)).toEqual({ ...ZERO, reads: 1, cells: N + 1, appendRow: 1, flush: 2 })

    const upd = seed(N)
    upd.adapter.update(N / 2, { score: 0 })
    expect(cost(upd.recorder)).toEqual({ ...ZERO, reads: 2, cells: N + C, setValues: 1, flush: 2 })
    upd.recorder.clear()
    upd.adapter.update(N / 2 + 1, { score: 0 })
    expect(cost(upd.recorder)).toEqual({ ...ZERO, reads: 1, cells: C, setValues: 1, flush: 2 })

    const del = seed(N)
    del.adapter.delete(N / 2)
    expect(cost(del.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, deleteRow: 1, flush: 2 })
    del.recorder.clear()
    del.adapter.delete(N / 2 - 1)
    expect(cost(del.recorder)).toEqual({ ...ZERO, reads: 1, cells: 1, deleteRow: 1, flush: 2 })
  })

  it.each([100, 1000, 5000])('batch writes at N=%i', N => {
    const ins = seed(N)
    ins.adapter.batchInsert(Array.from({ length: 100 }, (_, i) => ({ name: `n-${i}`, score: i })))
    expect(cost(ins.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, setValues: 1, flush: 2 })

    const contiguous = seed(N)
    contiguous.adapter.batchUpdate(Array.from({ length: 100 }, (_, i) => ({ id: i + 1, data: { score: 0 } })))
    expect(cost(contiguous.recorder)).toEqual({ ...ZERO, reads: 2, cells: N + 100 * C, setValues: 1, flush: 2 })

    const scattered = seed(N)
    scattered.adapter.batchUpdate(Array.from({ length: 10 }, (_, i) => ({ id: i * 2 + 1, data: { score: 0 } })))
    expect(cost(scattered.recorder)).toEqual({ ...ZERO, reads: 2, cells: N + 19 * C, setValues: 10, flush: 2 })

    const delContiguous = seed(N)
    delContiguous.adapter.batchDelete(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(cost(delContiguous.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, deleteRows: 1, flush: 2 })

    const delScattered = seed(N)
    delScattered.adapter.batchDelete(Array.from({ length: 10 }, (_, i) => i * 2 + 1))
    expect(cost(delScattered.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, deleteRows: 10, flush: 2 })

    const after = seed(N)
    after.adapter.update(1, { score: 0 })
    after.recorder.clear()
    after.adapter.findAll()
    expect(cost(after.recorder)).toEqual({ ...ZERO, reads: 1, cells: N * C })
  })
})

describe('SheetsAdapter id memo [#137]', () => {
  it('a loop of M auto inserts reads the id column once, not once per insert (N=1000, M=1000)', () => {
    const N = 1000
    const M = 1000
    const { adapter, recorder } = seed(N)

    const ids: number[] = []
    for (let i = 0; i < M; i++) ids.push(adapter.insert({ name: `n-${i}`, score: i }).id)

    // Before #137 this read M*N + M(M-1)/2 = 1,499,500 cells.
    expect(cost(recorder)).toEqual({ ...ZERO, reads: 1, cells: N, appendRow: M, flush: 2 * M })
    expect(ids).toEqual(Array.from({ length: M }, (_, i) => N + 1 + i))
  })

  it('4000 auto inserts into an empty table read 0 data cells (umbrella #232 probe)', () => {
    const { adapter, recorder } = seed(0)

    const ids: number[] = []
    for (let i = 0; i < 4000; i++) ids.push(adapter.insert({ name: 'n', score: i }).id)

    // Before #137 this read M(M-1)/2 = 7,998,000 cells.
    expect(recorder.cellsRead()).toBe(0)
    expect(recorder.appendRows).toBe(4000)
    expect(ids).toEqual(Array.from({ length: 4000 }, (_, i) => i + 1))
  })

  it('a loop of M deletes reads N cells then 1 cell per delete', () => {
    const N = 500
    const { adapter, recorder, sheet } = seed(N)

    for (let id = 1; id <= 100; id++) adapter.delete(id)

    expect(cost(recorder)).toEqual({
      ...ZERO,
      reads: 100,
      cells: N + 99,
      deleteRow: 100,
      flush: 200
    })
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    expect(ids).toEqual(Array.from({ length: 400 }, (_, i) => i + 101))
  })

  it('findById after clearCache() re-checks the header, reads the id column and the row (C + N + C)', () => {
    const N = 100
    const { adapter, recorder } = seed(N)
    adapter.clearCache()
    recorder.clear()

    expect(adapter.findById(50)?.id).toBe(50)

    expect(cost(recorder)).toEqual({ ...ZERO, reads: 3, cells: COLUMNS.length + N + COLUMNS.length })
  })

  it('update with a stale hint re-reads the id column: C + N + C', () => {
    const N = 100
    const { adapter, recorder, sheet } = seed(N)
    adapter.update(10, { score: 0 }) // builds the map
    const other = new SheetsAdapter<Row>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS
    })
    other.delete(1) // another execution moves every row up by one
    recorder.clear()

    expect(adapter.update(50, { score: 1 })?.id).toBe(50)

    expect(cost(recorder)).toEqual({
      ...ZERO,
      reads: 3,
      cells: COLUMNS.length + (N - 1) + COLUMNS.length,
      setValues: 1,
      flush: 2
    })
    expect(sheet.getRange(50, 1, 1, 1).getValues()[0][0]).toBe(50)
  })

  it('delete with a stale hint re-reads the id column: 1 + N', () => {
    const N = 100
    const { adapter, recorder, sheet } = seed(N)
    adapter.update(10, { score: 0 }) // builds the map
    const other = new SheetsAdapter<Row>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns: COLUMNS
    })
    other.delete(1)
    recorder.clear()

    expect(adapter.delete(50)).toBe(true)

    expect(cost(recorder)).toEqual({ ...ZERO, reads: 2, cells: 1 + (N - 1), deleteRow: 1, flush: 2 })
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    expect(ids).not.toContain(50)
    expect(ids).toHaveLength(N - 2)
  })
})

describe('SheetsAdapter batchUpdate and count [#236]', () => {
  it('a 1-row batchUpdate at N=5,000 reads the id column plus one row, not the table', () => {
    const N = 5000
    const { adapter, recorder } = seed(N)

    expect(adapter.batchUpdate([{ id: 2500, data: { score: 0 } }])).toEqual([
      { id: 2500, name: 'user-2500', score: 0 }
    ])

    // Before #236 this was one read of N*C = 15,000 cells (50,000 at C = 10).
    expect(recorder.reads).toEqual([
      { startRow: 2, startCol: 1, numRows: N, numCols: 1 },
      { startRow: 2501, startCol: 1, numRows: 1, numCols: C }
    ])
    expect(cost(recorder)).toEqual({ ...ZERO, reads: 2, cells: N + C, setValues: 1, flush: 2 })
  })

  it('batchUpdate with no matching id reads only the id column and writes nothing', () => {
    const { adapter, recorder } = seed(100)

    expect(adapter.batchUpdate([{ id: 999, data: { score: 0 } }])).toEqual([])

    expect(recorder.reads).toEqual([{ startRow: 2, startCol: 1, numRows: 100, numCols: 1 }])
    expect(recorder.writes).toEqual([])
    expect(recorder.flushes).toBe(2)
  })

  it('batchUpdate updates every row with a matching id, in sheet order, reading only the min..max span', () => {
    const rows: unknown[][] = [COLUMNS, [1, 'a', 10], [7, 'b', 20], [3, 'c', 30], [7, 'd', 40], [5, 'e', 50]]
    const spreadsheet = fromArrays({ [SHEET_NAME]: rows })
    handles.push(installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID }))
    const sheet = spreadsheet.getSheetByName(SHEET_NAME)
    if (!sheet) throw new Error('sheet missing')
    const adapter = new SheetsAdapter<Row>({ spreadsheetId: SPREADSHEET_ID, sheetName: SHEET_NAME, columns: COLUMNS })
    adapter.findAll()
    const recorder = recordRangeCalls(sheet)

    const results = adapter.batchUpdate([
      { id: '7' as unknown as number, data: { score: 99 } },
      { id: 3, data: { score: 33 } }
    ])

    expect(results).toEqual([
      { id: 7, name: 'b', score: 99 },
      { id: 3, name: 'c', score: 33 },
      { id: 7, name: 'd', score: 99 }
    ])
    expect(recorder.reads).toEqual([
      { startRow: 2, startCol: 1, numRows: 5, numCols: 1 },
      { startRow: 3, startCol: 1, numRows: 3, numCols: C }
    ])
    expect(recorder.writes).toEqual([{ startRow: 3, numRows: 3, numCols: C }])
    expect(sheet.getRange(2, 1, 5, C).getValues()).toEqual([
      [1, 'a', 10],
      [7, 'b', 99],
      [3, 'c', 33],
      [7, 'd', 99],
      [5, 'e', 50]
    ])
  })

  it('cold count() at N=5,000 reads the id column once; warm count() reads nothing', () => {
    const N = 5000
    const { adapter, recorder } = seed(N)
    adapter.update(1, { score: 0 })
    recorder.clear()

    expect(adapter.count()).toBe(N)
    expect(cost(recorder)).toEqual({ ...ZERO, reads: 1, cells: N })
    expect(recorder.reads).toEqual([{ startRow: 2, startCol: 1, numRows: N, numCols: 1 }])

    adapter.findAll()
    recorder.clear()
    expect(adapter.count()).toBe(N)
    expect(cost(recorder)).toEqual(ZERO)

    const fresh = seed(N, 'auto', false)
    expect(fresh.adapter.count()).toBe(N)
    expect(cost(fresh.recorder)).toEqual({ ...ZERO, reads: 2, cells: C + N })

    // count did not fill the read cache.
    fresh.recorder.clear()
    fresh.adapter.findAll()
    expect(fresh.recorder.reads).toEqual([{ startRow: 2, startCol: 1, numRows: N, numCols: C }])
  })

  it('Repository.count() over SheetsAdapter no longer reads every cell (umbrella #232 probe)', () => {
    const N = 5000
    const { adapter, recorder } = seed(N, 'auto', false)
    const findAll = vi.spyOn(adapter, 'findAll')
    const repo = new Repository(adapter, 'Users')

    expect(repo.count()).toBe(N)

    // Before #236 this read N*C + C = 15,003 cells.
    expect(recorder.cellsRead()).toBe(C + N)
    expect(findAll).not.toHaveBeenCalled()
  })
})
