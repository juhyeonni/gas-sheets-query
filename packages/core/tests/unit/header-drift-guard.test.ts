/**
 * Header-drift guard: a human-inserted column must fail loudly (#179).
 *
 * SheetsAdapter maps cells to fields by POSITION, so a column inserted (or
 * renamed, or reordered) by a collaborator shifts every value to its right.
 * Real-GAS run 31298563680 confirmed what that costs without a guard: reads
 * silently return the neighbouring column's values, and `update()` writes the
 * schema's columns over 1..N — destroying the human's column while leaving the
 * real trailing column stale.
 *
 * The guard reads the header row once per execution and throws
 * {@link SchemaMismatchError} on the first position where the physical header
 * contradicts the declared columns.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'
import { SchemaMismatchError } from '../../src/core/errors'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes } from '../../src/testing/install'
import type { GasFakesHandle } from '../../src/testing/install'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import type { RowWithId } from '../../src/core/types'

const SPREADSHEET_ID = 'test-spreadsheet-id'
const SHEET = 'Users'

let handle: GasFakesHandle | undefined

afterEach(() => {
  handle?.restore()
  handle = undefined
  vi.restoreAllMocks()
})

interface Harness {
  adapter: SheetsAdapter<RowWithId>
  sheet: FakeSheet
}

/** Install a fake spreadsheet holding `grid` and open a positional adapter over it. */
function open(
  columns: string[],
  grid: unknown[][],
  options: Partial<SheetsAdapterOptions> = {}
): Harness {
  const spreadsheet = fromArrays({ [SHEET]: grid })
  handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
  const adapter = new SheetsAdapter<RowWithId>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET,
    columns,
    idMode: 'client',
    ...options
  })
  return { adapter, sheet: spreadsheet.getSheetByName(SHEET)! }
}

/** The exact production scenario of #179: a human inserts `owner` at position 2. */
function drifted(options: Partial<SheetsAdapterOptions> = {}): Harness {
  return open(
    ['id', 'name', 'score'],
    [
      ['id', 'owner', 'name', 'score'],
      ['u1', 'alice', 'p0', 10],
      ['u2', 'bob', 'p1', 20],
      ['u3', 'carol', 'p2', 30]
    ],
    options
  )
}

/** Every public operation that reads or writes rows through the positional mapping. */
const DATA_OPERATIONS: { name: string; run: (adapter: SheetsAdapter<RowWithId>) => unknown }[] = [
  { name: 'findAll', run: adapter => adapter.findAll() },
  { name: 'find', run: adapter => adapter.find({ where: [], orderBy: [] }) },
  { name: 'findById', run: adapter => adapter.findById('u1') },
  { name: 'insert', run: adapter => adapter.insert({ id: 'u9', name: 'new' } as RowWithId) },
  { name: 'update', run: adapter => adapter.update('u1', { name: 'renamed' }) },
  { name: 'delete', run: adapter => adapter.delete('u1') },
  { name: 'batchInsert', run: adapter => adapter.batchInsert([{ id: 'u8', name: 'b' } as RowWithId]) },
  { name: 'batchUpdate', run: adapter => adapter.batchUpdate([{ id: 'u1', data: { name: 'b' } }]) },
  { name: 'reset', run: adapter => adapter.reset([]) }
]

describe('header drift guard (#179)', () => {
  describe('detection', () => {
    it('findAll throws SchemaMismatchError instead of silently misreading', () => {
      const { adapter } = drifted()

      expect(() => adapter.findAll()).toThrow(SchemaMismatchError)
    })

    it('names the drifted position, what it expected and what it found', () => {
      const { adapter } = drifted()

      let caught: SchemaMismatchError | undefined
      try {
        adapter.findAll()
      } catch (error) {
        caught = error as SchemaMismatchError
      }

      expect(caught).toBeInstanceOf(SchemaMismatchError)
      expect(caught?.code).toBe('SCHEMA_MISMATCH')
      expect(caught?.tableName).toBe(SHEET)
      expect(caught?.actualHeader).toEqual(['id', 'owner', 'name'])
      expect(caught?.declaredColumns).toEqual(['id', 'name', 'score'])
      // Position of the first divergence, in both index and A1 terms.
      expect(caught?.message).toContain('column 2 (B)')
      expect(caught?.message).toContain('expected "name"')
      expect(caught?.message).toContain('found "owner"')
      // Actionable hint.
      expect(caught?.message).toContain('inserted/renamed/reordered')
      expect(caught?.message).toContain('skipHeaderCheck')
      expect(caught?.message).toContain('#180')
    })

    it('guards every read and write entry point, not just findAll', () => {
      for (const { name, run } of DATA_OPERATIONS) {
        const { adapter } = drifted()
        expect(() => run(adapter), `${name} must be guarded`).toThrow(SchemaMismatchError)
        handle?.restore()
        handle = undefined
      }
    })

    it('leaves a drifted sheet completely untouched when a write is rejected', () => {
      const { adapter, sheet } = drifted()
      const before = JSON.stringify(sheet.getRange(1, 1, 4, 4).getValues())

      expect(() => adapter.update('u1', { name: 'renamed' })).toThrow(SchemaMismatchError)
      expect(() => adapter.delete('u1')).toThrow(SchemaMismatchError)
      expect(() => adapter.insert({ id: 'u9', name: 'x' } as RowWithId)).toThrow(SchemaMismatchError)
      expect(() => adapter.reset([])).toThrow(SchemaMismatchError)

      expect(JSON.stringify(sheet.getRange(1, 1, 4, 4).getValues())).toBe(before)
    })

    it('catches a renamed column (the stale header left by a value-level migration)', () => {
      const { adapter } = open(
        ['id', 'displayName', 'status'],
        [
          ['id', 'name', 'status'],
          ['u1', 'ann', 'active']
        ]
      )

      expect(() => adapter.findAll()).toThrow(/column 2 \(B\).*expected "displayName".*found "name"/s)
    })

    it('catches a reordered header even when the same names are present', () => {
      const { adapter } = open(
        ['id', 'name', 'score'],
        [
          ['id', 'score', 'name'],
          ['u1', 10, 'p0']
        ]
      )

      expect(() => adapter.findAll()).toThrow(SchemaMismatchError)
    })

    it('reports A1 letters past Z on a wide schema', () => {
      // 27 columns: id, c1..c26. The drift is at index 26, i.e. column AA.
      const columns = ['id', ...Array.from({ length: 26 }, (_, i) => `c${i + 1}`)]
      const header = columns.slice(0, 26).concat(['intruder'])
      const { adapter } = open(columns, [header])

      expect(() => adapter.findAll()).toThrow(/column 27 \(AA\)/)
    })

    it('re-checks (and keeps failing) rather than caching a failed verification', () => {
      const { adapter } = drifted()

      expect(() => adapter.findAll()).toThrow(SchemaMismatchError)
      expect(() => adapter.findAll()).toThrow(SchemaMismatchError)
      expect(() => adapter.findById('u1')).toThrow(SchemaMismatchError)
    })
  })

  describe('what must NOT fire', () => {
    it('accepts a header that matches the schema', () => {
      const { adapter } = open(
        ['id', 'name', 'score'],
        [
          ['id', 'name', 'score'],
          ['u1', 'p0', 10]
        ]
      )

      expect(adapter.findAll()).toEqual([{ id: 'u1', name: 'p0', score: 10 }])
    })

    it('accepts a sheet that is behind the schema (header is a prefix — pre-addColumn)', () => {
      const { adapter } = open(
        ['id', 'name', 'status'],
        [
          ['id', 'name'],
          ['u1', 'p0']
        ]
      )

      expect(() => adapter.findAll()).not.toThrow()
    })

    it('accepts extra physical columns to the RIGHT of the schema (non-corrupting)', () => {
      const { adapter } = open(
        ['id', 'name'],
        [
          ['id', 'name', 'human notes'],
          ['u1', 'p0', 'call back']
        ]
      )

      expect(adapter.findAll()).toEqual([{ id: 'u1', name: 'p0' }])
    })

    it('accepts an empty sheet with no header at all', () => {
      const { adapter } = open(['id', 'name'], [])

      expect(adapter.findAll()).toEqual([])
      expect(() => adapter.insert({ id: 'u1', name: 'p0' } as RowWithId)).not.toThrow()
    })

    it('accepts a sheet the adapter itself just created', () => {
      const spreadsheet = fromArrays({ Other: [['id']] })
      handle = installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID })
      const adapter = new SheetsAdapter<RowWithId>({
        spreadsheetId: SPREADSHEET_ID,
        sheetName: 'Fresh',
        columns: ['id', 'name'],
        idMode: 'client'
      })

      expect(() => adapter.insert({ id: 'u1', name: 'p0' } as RowWithId)).not.toThrow()
      expect(adapter.findAll()).toEqual([{ id: 'u1', name: 'p0' }])
    })

    it('does not guard getRawData — the escape hatch for inspecting a drifted sheet', () => {
      const { adapter } = drifted()

      expect(adapter.getRawData()[0]).toEqual(['id', 'owner', 'name', 'score'])
    })
  })

  describe('cost', () => {
    it('costs exactly one extra header read per execution, whatever the op mix', () => {
      const { adapter, sheet } = open(
        ['id', 'name', 'score'],
        [
          ['id', 'name', 'score'],
          ['u1', 'p0', 10],
          ['u2', 'p1', 20]
        ]
      )
      const getRange = vi.spyOn(sheet, 'getRange')

      adapter.findAll()
      adapter.findById('u1')
      adapter.update('u1', { name: 'p0b' })
      adapter.findAll()
      adapter.batchUpdate([{ id: 'u2', data: { name: 'p1b' } }])
      adapter.delete('u2')

      const headerReads = getRange.mock.calls.filter(
        ([row, col, numRows]) => row === 1 && col === 1 && numRows === 1
      )
      expect(headerReads).toHaveLength(1)
    })

    it('re-arms after clearCache(), so drift introduced later is still caught', () => {
      const { adapter, sheet } = open(
        ['id', 'name', 'score'],
        [
          ['id', 'name', 'score'],
          ['u1', 'p0', 10]
        ]
      )
      expect(adapter.findAll()).toHaveLength(1)

      // The human edit lands between two executions.
      sheet.insertColumnBefore(2)
      sheet.getRange(1, 2, 1, 1).setValues([['owner']])
      sheet.getRange(2, 2, 1, 1).setValues([['alice']])

      adapter.clearCache()
      expect(() => adapter.findAll()).toThrow(SchemaMismatchError)
    })
  })

  describe('skipHeaderCheck escape hatch', () => {
    it('restores the old (documented-dangerous) silent behavior on reads', () => {
      const { adapter } = drifted({ skipHeaderCheck: true })

      const rows = adapter.findAll()
      expect(rows).toHaveLength(3)
      // Exactly the #179 corruption: every field right of `id` is off by one.
      expect(rows[0]).toEqual({ id: 'u1', name: 'alice', score: 'p0' })
    })

    it('restores the old silent behavior on writes too', () => {
      const { adapter, sheet } = drifted({ skipHeaderCheck: true })

      adapter.update('u1', { name: 'renamed' })

      expect(sheet.getRange(2, 1, 1, 4).getValues()[0]).toEqual(['u1', 'renamed', 'p0', 10])
    })

    it('never reads the header row at all when enabled', () => {
      const { adapter, sheet } = drifted({ skipHeaderCheck: true })
      const getRange = vi.spyOn(sheet, 'getRange')

      adapter.findAll()

      const headerReads = getRange.mock.calls.filter(([row]) => row === 1)
      expect(headerReads).toHaveLength(0)
    })
  })

  describe('schema operations keep their own, more precise validation', () => {
    it('addColumn still extends a sheet that is behind the schema', () => {
      const { adapter, sheet } = open(
        ['id', 'name', 'status'],
        [
          ['id', 'name'],
          ['u1', 'p0']
        ]
      )

      adapter.addColumn('status', { default: 'active' })

      expect(sheet.getRange(1, 1, 1, 3).getValues()[0]).toEqual(['id', 'name', 'status'])
      expect(adapter.findAll()).toEqual([{ id: 'u1', name: 'p0', status: 'active' }])
    })

    it('addColumn still performs a mid-schema physical insert the guard would flag', () => {
      const { adapter, sheet } = open(
        ['id', 'status', 'name'],
        [
          ['id', 'name'],
          ['u1', 'p0']
        ]
      )

      adapter.addColumn('status', { default: 'active' })

      expect(sheet.getRange(1, 1, 1, 3).getValues()[0]).toEqual(['id', 'status', 'name'])
      expect(adapter.findAll()).toEqual([{ id: 'u1', status: 'active', name: 'p0' }])
    })
  })
})
