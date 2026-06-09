/**
 * Regression tests for physical schema operations on SheetsAdapter.
 *
 * The adapter maps columns by POSITION (not by header name), so a migration
 * that adds a column in the middle of the schema must physically insert the
 * column and update the header — otherwise existing rows get misaligned.
 * These tests use a grid-backed stub that models insertColumnBefore /
 * deleteColumn / setValue faithfully.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'

type Grid = unknown[][]

function createGridSheet(grid: Grid) {
  const cell = (r: number, c: number) => {
    return {
      getValue: () => grid[r]?.[c] ?? '',
      setValue: (v: unknown) => {
        ;(grid[r] ??= [])[c] = v
      },
      getValues: () => [[grid[r]?.[c] ?? '']],
      setValues: (vals: unknown[][]) => {
        ;(grid[r] ??= [])[c] = vals[0][0]
      },
    }
  }
  const block = (r0: number, c0: number, numRows: number, numCols: number) => ({
    getValues: () =>
      Array.from({ length: numRows }, (_, i) => {
        const row = grid[r0 + i] ?? []
        return Array.from({ length: numCols }, (_, j) => row[c0 + j] ?? '')
      }),
    setValues: (vals: unknown[][]) => {
      for (let i = 0; i < numRows; i++) {
        const row = (grid[r0 + i] ??= [])
        for (let j = 0; j < numCols; j++) row[c0 + j] = vals[i][j]
      }
    },
  })
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (row: number, col: number, numRows?: number, numCols?: number) =>
      numRows === undefined
        ? cell(row - 1, col - 1)
        : block(row - 1, col - 1, numRows, numCols ?? (grid[row - 1]?.length ?? 0)),
    insertColumnBefore: (pos: number) => {
      for (const r of grid) r.splice(pos - 1, 0, '')
    },
    deleteColumn: (pos: number) => {
      for (const r of grid) r.splice(pos - 1, 1)
    },
    appendRow: (vals: unknown[]) => grid.push([...vals]),
    getDataRange: () => ({ getValues: () => grid }),
    clear: () => {
      grid.length = 0
    },
  }
}

function setup(grid: Grid) {
  const sheet = createGridSheet(grid)
  const ss = { getSheetByName: () => sheet, insertSheet: () => sheet }
  ;(globalThis as Record<string, unknown>).SpreadsheetApp = {
    openById: () => ss,
    getActiveSpreadsheet: () => ss,
  }
  return sheet
}

describe('SheetsAdapter physical schema ops', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).SpreadsheetApp
  })

  it('addColumn in the middle shifts data and updates the header (no corruption)', () => {
    // Old layout: [id, name, active]
    const grid: Grid = [
      ['id', 'name', 'active'],
      ['e1', '田中', true],
      ['e2', '佐藤', false],
    ]
    setup(grid)
    // New schema inserts `status` between name and active.
    const adapter = new SheetsAdapter<{ id: string; name: string; status: string; active: boolean }>({
      spreadsheetId: 't',
      sheetName: 'Employee',
      columns: ['id', 'name', 'status', 'active'],
      idMode: 'client',
    })

    adapter.addColumn('status', 'pending')

    expect(grid[0]).toEqual(['id', 'name', 'status', 'active'])
    expect(grid[1]).toEqual(['e1', '田中', 'pending', true])
    expect(grid[2]).toEqual(['e2', '佐藤', 'pending', false])

    const rows = adapter.findAll()
    expect(rows[0]).toMatchObject({ id: 'e1', name: '田中', status: 'pending', active: true })
  })

  it('addColumn is idempotent (no double insert)', () => {
    const grid: Grid = [
      ['id', 'name', 'status', 'active'],
      ['e1', '田中', 'x', true],
    ]
    setup(grid)
    const adapter = new SheetsAdapter({
      spreadsheetId: 't',
      sheetName: 'Employee',
      columns: ['id', 'name', 'status', 'active'],
      idMode: 'client',
    })
    adapter.addColumn('status', 'pending')
    expect(grid[0]).toEqual(['id', 'name', 'status', 'active'])
    expect(grid[1]).toEqual(['e1', '田中', 'x', true]) // unchanged
  })

  it('removeColumn deletes the physical column', () => {
    const grid: Grid = [
      ['id', 'name', 'status', 'active'],
      ['e1', '田中', 'x', true],
    ]
    setup(grid)
    const adapter = new SheetsAdapter({
      spreadsheetId: 't',
      sheetName: 'Employee',
      columns: ['id', 'name', 'active'], // status removed from schema
      idMode: 'client',
    })
    adapter.removeColumn('status')
    expect(grid[0]).toEqual(['id', 'name', 'active'])
    expect(grid[1]).toEqual(['e1', '田中', true])
  })

  it('renameColumn updates only the header', () => {
    const grid: Grid = [
      ['id', 'name', 'old', 'active'],
      ['e1', '田中', 'v', true],
    ]
    setup(grid)
    const adapter = new SheetsAdapter({
      spreadsheetId: 't',
      sheetName: 'Employee',
      columns: ['id', 'name', 'new', 'active'],
      idMode: 'client',
    })
    adapter.renameColumn('old', 'new')
    expect(grid[0]).toEqual(['id', 'name', 'new', 'active'])
    expect(grid[1]).toEqual(['e1', '田中', 'v', true])
  })
})
