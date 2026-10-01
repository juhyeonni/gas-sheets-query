/**
 * Pins the SheetsAdapter costs that the docs describe (#240), so a later change
 * to the read/write path that makes the documentation stale breaks a test.
 *
 * Costs are counted in sheet reads (cells) and writes (calls) on the data sheet.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { DuplicateIdError } from '../../src/core/errors'
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
  deleteRows: number
  flushes: number
  clear(): void
  cellsRead(): number
}

function recordRangeCalls(sheet: FakeSheet): Recorder {
  const recorder: Recorder = {
    reads: [],
    writes: [],
    appendRows: 0,
    deleteRows: 0,
    flushes: 0,
    clear() {
      recorder.reads.length = 0
      recorder.writes.length = 0
      recorder.appendRows = 0
      recorder.deleteRows = 0
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
    recorder.deleteRows++
    return originalDeleteRow(row)
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
  flush: number
}

function cost(recorder: Recorder): Cost {
  return {
    reads: recorder.reads.length,
    cells: recorder.cellsRead(),
    setValues: recorder.writes.length,
    appendRow: recorder.appendRows,
    deleteRow: recorder.deleteRows,
    flush: recorder.flushes
  }
}

const ZERO: Cost = { reads: 0, cells: 0, setValues: 0, appendRow: 0, deleteRow: 0, flush: 0 }

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
  it('findById reads the whole id column plus the row even when the read cache is warm', () => {
    const { adapter, recorder } = seed(100)

    expect(adapter.findById(50)?.id).toBe(50)
    expect(recorder.reads).toEqual([
      { startRow: 2, startCol: 1, numRows: 100, numCols: 1 },
      { startRow: 51, startCol: 1, numRows: 1, numCols: C }
    ])
    expect(recorder.writes).toEqual([])
  })

  it('update and delete read the whole id column on every call', () => {
    const { adapter, recorder, sheet } = seed(50)

    let rowCount = sheet.getLastRow() - 1
    adapter.update(10, { name: 'x' })
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: rowCount, numCols: 1 })

    recorder.clear()
    rowCount = sheet.getLastRow() - 1
    adapter.delete(20)
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: rowCount, numCols: 1 })
  })

  it('a loop of M single updates reads O(M*N) cells while one batchUpdate reads N*C', () => {
    const N = 200
    const M = 200

    const loop = seed(N)
    for (let id = 1; id <= M; id++) loop.adapter.update(id, { score: 0 })
    const loopCells = loop.recorder.cellsRead()
    expect(loopCells).toBe(M * (N + C))
    expect(loop.recorder.writes).toHaveLength(M)
    expect(loop.recorder.flushes).toBe(2 * M)

    const batch = seed(N)
    batch.adapter.batchUpdate(Array.from({ length: M }, (_, i) => ({ id: i + 1, data: { score: 0 } })))
    const batchCells = batch.recorder.cellsRead()
    expect(batchCells).toBe(N * C)
    expect(batch.recorder.writes).toHaveLength(1)
    expect(batch.recorder.flushes).toBe(2)

    expect(loopCells / batchCells).toBeGreaterThan(50)
  })

  it('batchUpdate on scattered rows costs one full-table read and one write per row', () => {
    const { adapter, recorder } = seed(20)

    const ids = Array.from({ length: 10 }, (_, i) => i * 2 + 1)
    adapter.batchUpdate(ids.map(id => ({ id, data: { score: 0 } })))

    expect(recorder.reads).toEqual([{ startRow: 2, startCol: 1, numRows: 20, numCols: C }])
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

  it('every write drops the read cache, including an insert that throws', () => {
    const { adapter, recorder, sheet } = seed(10, 'client')

    // Control: the cache is warm, so a second findAll reads nothing.
    adapter.findAll()
    expect(recorder.reads).toEqual([])

    expect(() => adapter.insert({ id: 1, name: 'dup', score: 0 })).toThrow(DuplicateIdError)

    recorder.clear()
    adapter.findAll()
    expect(recorder.reads).toContainEqual({ startRow: 2, startCol: 1, numRows: 10, numCols: C })
    expect(sheet.getLastRow() - 1).toBe(10)
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
    expect(cost(recorder)).toEqual({ ...ZERO, reads: 2, cells: N + C })
  })

  it.each([100, 1000, 5000])('locked single-row writes at N=%i', N => {
    const auto = seed(N)
    auto.adapter.insert({ name: 'new', score: 1 })
    expect(cost(auto.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, appendRow: 1, flush: 2 })

    const client = seed(N, 'client')
    client.adapter.insert({ id: N + 1, name: 'new', score: 1 })
    expect(cost(client.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, appendRow: 1, flush: 2 })

    const upd = seed(N)
    upd.adapter.update(N / 2, { score: 0 })
    expect(cost(upd.recorder)).toEqual({ ...ZERO, reads: 2, cells: N + C, setValues: 1, flush: 2 })

    const del = seed(N)
    del.adapter.delete(N / 2)
    expect(cost(del.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, deleteRow: 1, flush: 2 })
  })

  it.each([100, 1000, 5000])('batch writes at N=%i', N => {
    const ins = seed(N)
    ins.adapter.batchInsert(Array.from({ length: 100 }, (_, i) => ({ name: `n-${i}`, score: i })))
    expect(cost(ins.recorder)).toEqual({ ...ZERO, reads: 1, cells: N, setValues: 1, flush: 2 })

    const contiguous = seed(N)
    contiguous.adapter.batchUpdate(Array.from({ length: 100 }, (_, i) => ({ id: i + 1, data: { score: 0 } })))
    expect(cost(contiguous.recorder)).toEqual({ ...ZERO, reads: 1, cells: N * C, setValues: 1, flush: 2 })

    const scattered = seed(N)
    scattered.adapter.batchUpdate(Array.from({ length: 10 }, (_, i) => ({ id: i * 2 + 1, data: { score: 0 } })))
    expect(cost(scattered.recorder)).toEqual({ ...ZERO, reads: 1, cells: N * C, setValues: 10, flush: 2 })

    const after = seed(N)
    after.adapter.update(1, { score: 0 })
    after.recorder.clear()
    after.adapter.findAll()
    expect(cost(after.recorder)).toEqual({ ...ZERO, reads: 1, cells: N * C })
  })
})
