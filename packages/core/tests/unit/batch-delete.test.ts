/**
 * batchDelete (#137): one lock, one id-column read, one deleteRows per
 * contiguous run of rows, highest run first.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { MockAdapter } from '../../src/adapters/mock-adapter'
import { Repository } from '../../src/core/repository'
import { createSheetsDB } from '../../src/core/sheets-db'
import type { DataStore } from '../../src/core/types'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes, type GasFakesHandle } from '../../src/testing/install'

interface Row {
  id: number | string
  name: string
}

const SPREADSHEET_ID = 'batch-delete'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name']
// A transient-looking message: batchDelete must still not retry deleteRows.
const TRANSIENT = 'Service Spreadsheets timed out while accessing document with id 1AbC.'

let handle: GasFakesHandle | undefined

afterEach(() => {
  handle?.restore()
  handle = undefined
  vi.restoreAllMocks()
})

function setup(
  rows: unknown[][],
  options: { idMode?: 'auto' | 'client'; allowFormulas?: boolean } = {}
): { adapter: SheetsAdapter<Row>; sheet: FakeSheet } {
  const spreadsheet = fromArrays({ [SHEET_NAME]: [COLUMNS, ...rows] })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
  const sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw new Error('setup: sheet missing')
  const adapter = new SheetsAdapter<Row>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: COLUMNS,
    ...options
  })
  return { adapter, sheet }
}

function ids(n: number): unknown[][] {
  return Array.from({ length: n }, (_, i) => [i + 1, `user-${i + 1}`])
}

function idsOnSheet(sheet: FakeSheet): unknown[] {
  const last = sheet.getLastRow()
  return last <= 1 ? [] : sheet.getRange(2, 1, last - 1, 1).getValues().flat()
}

describe('SheetsAdapter.batchDelete', () => {
  it('deletes scattered and contiguous ids with one id read and one deleteRows per run, highest run first', () => {
    const { adapter, sheet } = setup(ids(10))
    adapter.findAll()

    const deleteRows: [number, number][] = []
    const originalDeleteRows = sheet.deleteRows.bind(sheet)
    sheet.deleteRows = (start: number, count: number) => {
      deleteRows.push([start, count])
      originalDeleteRows(start, count)
    }
    const deleteRow = vi.spyOn(sheet, 'deleteRow')
    let idReads = 0
    const originalGetRange = sheet.getRange.bind(sheet)
    sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
      const range = originalGetRange(row, col, numRows, numCols)
      if (row === 2 && col === 1 && numCols === 1) {
        const getValues = range.getValues.bind(range)
        range.getValues = () => {
          idReads++
          return getValues()
        }
      }
      return range
    }

    expect(adapter.batchDelete([2, 3, 4, 7, 9])).toBe(5)

    expect(idReads).toBe(1)
    expect(idsOnSheet(sheet)).toEqual([1, 5, 6, 8, 10])
    // ids 2-4 are rows 3-5, id 7 is row 8, id 9 is row 10.
    expect(deleteRows).toEqual([[10, 1], [8, 1], [3, 3]])
    expect(deleteRow).not.toHaveBeenCalled()
  })

  it('skips missing and duplicate ids and matches string/number and escaped ids', () => {
    const { adapter, sheet } = setup(ids(5))
    expect(adapter.batchDelete([3, '3', 99])).toBe(1)
    expect(idsOnSheet(sheet)).toEqual([1, 2, 4, 5])

    const client = setup([['=x', 'formula-like'], ['y', 'plain']], { idMode: 'client', allowFormulas: false })
    expect(client.adapter.batchDelete(['=x'])).toBe(1)
    expect(client.adapter.findAll().map(r => r.id)).toEqual(['y'])
  })

  it('empty input does no I/O and takes no lock', () => {
    const { adapter, sheet } = setup(ids(3))
    const getRange = vi.spyOn(sheet, 'getRange')
    const deleteRows = vi.spyOn(sheet, 'deleteRows')
    const flush = vi.spyOn(
      (globalThis as unknown as { SpreadsheetApp: { flush: () => void } }).SpreadsheetApp,
      'flush'
    )

    expect(adapter.batchDelete([])).toBe(0)

    expect(getRange).not.toHaveBeenCalled()
    expect(deleteRows).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('uses physical rows when the sheet has a blank row in the middle', () => {
    const { adapter, sheet } = setup([[1, 'a'], [], [2, 'b'], [3, 'c']])

    expect(adapter.batchDelete([2])).toBe(1)

    expect(idsOnSheet(sheet)).toEqual([1, '', 3])
    expect(adapter.findAll().map(r => r.id)).toEqual([1, 3])
  })

  it('a failing run is not retried, earlier runs stay deleted, and later single ops re-resolve', () => {
    const { adapter, sheet } = setup(ids(10))
    adapter.delete(1)

    const originalDeleteRows = sheet.deleteRows.bind(sheet)
    let calls = 0
    sheet.deleteRows = (start: number, count: number) => {
      calls++
      if (calls === 2) throw new Error(TRANSIENT)
      originalDeleteRows(start, count)
    }

    // ids 3 and 6-7 and 9: rows are three runs; highest (9) goes first.
    expect(() => adapter.batchDelete([3, 6, 7, 9])).toThrow(TRANSIENT)
    expect(calls).toBe(2)
    expect(idsOnSheet(sheet)).toEqual([2, 3, 4, 5, 6, 7, 8, 10])

    expect(adapter.delete(8)).toBe(true)
    expect(idsOnSheet(sheet)).toEqual([2, 3, 4, 5, 6, 7, 10])
  })
})

describe('Repository / TableHandle / MockAdapter batchDelete', () => {
  it('MockAdapter.batchDelete deletes present ids once and keeps indexes consistent', () => {
    const adapter = new MockAdapter<{ id: number; name: string }>({
      indexes: [{ fields: ['name'] }]
    })
    adapter.batchInsert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])

    expect(adapter.batchDelete([1, 1, 3, 99])).toBe(2)

    expect(adapter.findById(1)).toBeUndefined()
    expect(adapter.findById(2)?.name).toBe('b')
    expect(adapter.find({ where: [{ field: 'name', operator: '=', value: 'c' }], orderBy: [] })).toEqual([])
    expect(adapter.find({ where: [{ field: 'name', operator: '=', value: 'b' }], orderBy: [] })).toHaveLength(1)
  })

  it('Repository loops delete when the store has no batchDelete', () => {
    const mock = new MockAdapter<{ id: number; name: string }>()
    mock.batchInsert([{ name: 'a' }, { name: 'b' }])
    const store: DataStore<{ id: number; name: string }> = {
      findAll: () => mock.findAll(),
      find: o => mock.find(o),
      findById: id => mock.findById(id),
      insert: d => mock.insert(d),
      update: (id, d) => mock.update(id, d),
      delete: id => mock.delete(id)
    }

    const repo = new Repository(store, 'users')
    expect(repo.batchDelete([1, 5])).toBe(1)
    expect(mock.findAll().map(r => r.id)).toEqual([2])
  })

  it('Repository delegates when the store has batchDelete', () => {
    const mock = new MockAdapter<{ id: number; name: string }>()
    mock.batchInsert([{ name: 'a' }, { name: 'b' }])
    const spy = vi.spyOn(mock, 'batchDelete')

    expect(new Repository(mock, 'users').batchDelete([1, 2])).toBe(2)
    expect(spy).toHaveBeenCalledWith([1, 2])
  })

  it('TableHandle.batchDelete returns the count', () => {
    const users = new MockAdapter<{ id: number; name: string }>()
    users.batchInsert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    const db = createSheetsDB({
      config: { tables: { users: { columns: ['id', 'name'] } } },
      stores: { users }
    })

    expect(db.from('users').batchDelete([1, 3, 42])).toBe(2)
    expect(users.findAll().map(r => r.id)).toEqual([2])
  })
})
