/**
 * `patchCacheOnWrite` (#236): with the option on, SheetsAdapter patches its
 * warm read cache with its own writes instead of dropping it, so an insert +
 * find loop stops re-reading the whole table. Off by default.
 *
 * Every patched answer is compared with a fresh adapter that reads the same
 * sheet: a warm read and a fresh read must agree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { ColumnType, SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'
import { DuplicateIdError } from '../../src/core/errors'
import type { RowWithId } from '../../src/core/types'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import { fromArrays } from '../../src/testing/loaders'
import { installGasFakes, type GasFakesHandle } from '../../src/testing/install'

type Row = RowWithId & Record<string, unknown>

const SPREADSHEET_ID = 'patch-cache-on-write'
const SHEET_NAME = 'Users'
const COLUMNS = ['id', 'name', 'score']
const C = COLUMNS.length

interface ReadCall {
  startRow: number
  startCol: number
  numRows: number
  numCols: number
}

interface Recorder {
  reads: ReadCall[]
  clear(): void
  cellsRead(): number
}

function recordReads(sheet: FakeSheet): Recorder {
  const recorder: Recorder = {
    reads: [],
    clear() {
      recorder.reads.length = 0
    },
    cellsRead() {
      return recorder.reads.reduce((sum, r) => sum + r.numRows * r.numCols, 0)
    }
  }
  const original = sheet.getRange.bind(sheet)
  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1) => {
    const range = original(row, col, numRows, numCols)
    const readValues = range.getValues.bind(range)
    range.getValues = () => {
      recorder.reads.push({ startRow: row, startCol: col, numRows, numCols })
      return readValues()
    }
    return range
  }
  return recorder
}

const handles: GasFakesHandle[] = []

afterEach(() => {
  while (handles.length > 0) handles.pop()?.restore()
  vi.restoreAllMocks()
})

interface Setup {
  adapter: SheetsAdapter<Row>
  sheet: FakeSheet
  recorder: Recorder
  /** A second adapter on the same sheet, as a new execution would see it. */
  fresh(): SheetsAdapter<Row>
}

function setup(
  grid: unknown[][],
  options: Partial<SheetsAdapterOptions> = {},
  warm = true
): Setup {
  const columns = options.columns ?? COLUMNS
  const spreadsheet = fromArrays({ [SHEET_NAME]: [columns, ...grid] })
  handles.push(installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: spreadsheet }, activeId: SPREADSHEET_ID }))
  const sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw new Error('setup: sheet missing')

  const make = (): SheetsAdapter<Row> =>
    new SheetsAdapter<Row>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      columns,
      ...options
    })

  const adapter = make()
  const recorder = recordReads(sheet)
  if (warm) adapter.findAll()
  recorder.clear()
  return { adapter, sheet, recorder, fresh: make }
}

function rows(n: number): unknown[][] {
  return Array.from({ length: n }, (_, i) => [i + 1, `user-${letters(i + 1)}`, (i + 1) * 10])
}

/** Digit-free text, so a seeded name never counts as an uncertain cell. */
function letters(n: number): string {
  let out = ''
  let rest = n
  while (rest > 0) {
    out = String.fromCharCode(97 + ((rest - 1) % 26)) + out
    rest = Math.floor((rest - 1) / 26)
  }
  return out
}

/** Whether `findAll` had to read the sheet, i.e. the cache was cold. */
function findAllReads(s: Setup): boolean {
  s.recorder.clear()
  s.adapter.findAll()
  const read = s.recorder.reads.length > 0
  s.recorder.clear()
  return read
}

/** findAll (order included), findById of every id and count agree with a fresh adapter. */
function expectSameAsFresh(s: Setup, extraIds: (string | number)[] = []): void {
  const fresh = s.fresh()
  const warm = s.adapter.findAll()
  expect(warm).toEqual(fresh.findAll())

  const ids = new Set<string | number>([...warm.map(r => r.id), ...extraIds])
  for (const id of ids) {
    expect(s.adapter.findById(id)).toEqual(fresh.findById(id))
  }
  expect(s.adapter.count()).toBe(fresh.count())
}

type WriteName = 'insert' | 'batchInsert' | 'update' | 'batchUpdate' | 'delete' | 'batchDelete'

const WRITES: Record<WriteName, (adapter: SheetsAdapter<Row>) => void> = {
  insert: a => { a.insert({ name: 'new', score: 1 }) },
  batchInsert: a => { a.batchInsert([{ name: 'new', score: 1 }, { name: 'other', score: 2 }]) },
  update: a => { a.update(3, { name: 'changed' }) },
  batchUpdate: a => { a.batchUpdate([{ id: 2, data: { name: 'two' } }, { id: 4, data: { score: 0 } }]) },
  delete: a => { a.delete(3) },
  batchDelete: a => { a.batchDelete([2, 4, 999]) }
}

const WRITE_NAMES = Object.keys(WRITES) as WriteName[]

describe('patchCacheOnWrite off (default) [#236]', () => {
  it.each(WRITE_NAMES)('%s followed by findAll re-reads the data range, as before', name => {
    const s = setup(rows(5))
    WRITES[name](s.adapter)

    s.recorder.clear()
    s.adapter.findAll()
    expect(s.recorder.reads).toContainEqual({
      startRow: 2,
      startCol: 1,
      numRows: s.sheet.getLastRow() - 1,
      numCols: C
    })
  })
})

describe('patchCacheOnWrite on [#236]', () => {
  const ON = { patchCacheOnWrite: true }

  it('200 inserts + findAll on a 1,000-row table read the data range once, for the first findAll', () => {
    const perIteration = (N: number): { dataReads: number; cellsAfterFirst: number } => {
      const s = setup(rows(N), ON, false)
      const dataReads = (): number =>
        s.recorder.reads.filter(r => r.startRow === 2 && r.startCol === 1 && r.numCols === C).length

      s.adapter.insert({ name: 'first', score: 0 })
      s.adapter.findAll()
      const cellsBefore = s.recorder.cellsRead()
      for (let i = 1; i < 200; i++) {
        s.adapter.insert({ name: 'loop', score: i })
        expect(s.adapter.findAll()).toHaveLength(N + i + 1)
      }
      const result = { dataReads: dataReads(), cellsAfterFirst: s.recorder.cellsRead() - cellsBefore }
      const fresh = s.fresh()
      expect(s.adapter.findAll()).toEqual(fresh.findAll())
      expect(s.adapter.count()).toBe(fresh.count())
      expect(s.adapter.findById(N + 200)).toEqual(fresh.findById(N + 200))
      return result
    }

    const small = perIteration(1000)
    expect(small.dataReads).toBe(1)
    // Cells read per iteration do not grow with the table: none at all.
    expect(small.cellsAfterFirst).toBe(0)
    expect(perIteration(4000)).toEqual(small)
  })

  it.each(WRITE_NAMES)('%s on a warm cache patches it, and the warm reads match a fresh adapter', name => {
    const s = setup(rows(6), ON)
    WRITES[name](s.adapter)

    expect(findAllReads(s)).toBe(false)
    expectSameAsFresh(s, [999])
  })

  it.each(WRITE_NAMES)('%s in client mode patches a warm cache too', name => {
    const s = setup(rows(6), { ...ON, idMode: 'client' })
    if (name === 'insert') s.adapter.insert({ id: 100, name: 'new', score: 1 })
    else if (name === 'batchInsert') s.adapter.batchInsert([{ id: 100, name: 'new', score: 1 }, { id: 101, name: 'x', score: 2 }])
    else WRITES[name](s.adapter)

    expect(findAllReads(s)).toBe(false)
    expectSameAsFresh(s)
  })

  it('patches the written value round-tripped through serialization, not the caller object', () => {
    const columnTypes: Record<string, ColumnType> = {
      tags: 'string[]',
      active: 'boolean',
      meta: 'object',
      score: 'number'
    }
    const columns = ['id', 'name', 'score', 'tags', 'active', 'meta', 'note']
    const s = setup(
      [[1, 'alpha', 10, '["a"]', 'TRUE', '{"k":"v"}', '']],
      { ...ON, columns, columnTypes }
    )

    const input: Record<string, unknown> = {
      name: '=HYPERLINK("x")',
      score: 5,
      tags: ['b', 'c'],
      active: false,
      meta: { nested: { deep: true } },
      note: null
    }
    const returned = s.adapter.insert(input)
    s.adapter.update(1, { name: '-minus', tags: [], active: true, meta: null })
    s.adapter.batchUpdate([{ id: 1, data: { note: { inline: 'json' } } }])

    expect(findAllReads(s)).toBe(false)
    const patched = s.adapter.findById(returned.id)
    expect(patched).not.toBe(returned)
    expect(patched?.note).toBe('')
    expectSameAsFresh(s)

    // Mutating the caller's object afterwards does not reach the cache.
    ;(input.meta as Record<string, unknown>).nested = 'changed'
    expect(s.adapter.findById(returned.id)?.meta).toEqual({ nested: { deep: true } })
  })

  it('a string the platform may coerce leaves the cache cold', () => {
    for (const value of ['123', '007', 'true', 'FALSE', '2024-01-01', '10:30', ' padded', '#N/A']) {
      const s = setup(rows(3), ON)
      s.adapter.insert({ name: value, score: 1 })
      expect(findAllReads(s), `insert ${JSON.stringify(value)}`).toBe(true)
      handles.pop()?.restore()

      const u = setup(rows(3), ON)
      u.adapter.update(2, { name: value })
      expect(findAllReads(u), `update ${JSON.stringify(value)}`).toBe(true)
      handles.pop()?.restore()
    }
  })

  it('a date-typed value leaves the cache cold, even a Date', () => {
    const columns = ['id', 'name', 'when']
    const s = setup([[1, 'alpha', '']], { ...ON, columns, columnTypes: { when: 'date' } })

    s.adapter.insert({ name: 'beta', when: new Date('2024-01-01T00:00:00Z') })

    expect(findAllReads(s)).toBe(true)
  })

  it('plain text, a number, a boolean and a Date are patched', () => {
    const columns = ['id', 'name', 'score', 'flag', 'at']
    const s = setup([[1, 'alpha', 10, false, '']], { ...ON, columns })

    s.adapter.insert({ name: 'hello', score: 42.5, flag: true, at: new Date('2024-01-01T00:00:00Z') })
    s.adapter.update(1, { name: 'world', score: -3, flag: true })

    expect(findAllReads(s)).toBe(false)
    expectSameAsFresh(s)
  })

  it('with allowFormulas, a formula string leaves the cache cold', () => {
    for (const formula of ['=1+2', '+A1', '-B2', '@SUM']) {
      const s = setup(rows(3), { ...ON, allowFormulas: true })
      s.adapter.insert({ name: formula, score: 1 })
      expect(findAllReads(s), formula).toBe(true)
      handles.pop()?.restore()
    }

    // The same strings are escaped as text without allowFormulas, so they are patched.
    const s = setup(rows(3), ON)
    s.adapter.insert({ name: '=1+2', score: 1 })
    expect(findAllReads(s)).toBe(false)
    expectSameAsFresh(s)
  })

  it.each(['update', 'batchUpdate', 'delete', 'batchDelete'] as const)(
    '%s of an id another execution inserted after the snapshot leaves the cache cold',
    name => {
      const s = setup(rows(4), ON)
      s.fresh().insert({ name: 'elsewhere', score: 7 }) // id 5, not in the cache

      if (name === 'update') s.adapter.update(5, { name: 'seen' })
      if (name === 'batchUpdate') s.adapter.batchUpdate([{ id: 5, data: { name: 'seen' } }])
      if (name === 'delete') s.adapter.delete(5)
      if (name === 'batchDelete') s.adapter.batchDelete([5])

      expect(findAllReads(s)).toBe(true)
      expectSameAsFresh(s)
    }
  )

  it.each(['update', 'batchUpdate', 'delete', 'batchDelete'] as const)(
    '%s of a duplicated id leaves the cache cold',
    name => {
      const s = setup([[1, 'alpha', 1], [2, 'beta', 2], [2, 'typed', 3], [3, 'gamma', 4]], ON)

      if (name === 'update') s.adapter.update(2, { name: 'seen' })
      if (name === 'batchUpdate') s.adapter.batchUpdate([{ id: 2, data: { name: 'seen' } }])
      if (name === 'delete') s.adapter.delete(2)
      if (name === 'batchDelete') s.adapter.batchDelete([2])

      expect(findAllReads(s)).toBe(true)
      expectSameAsFresh(s)
    }
  )

  it('batchDelete of an id the cache holds but another execution removed leaves the cache cold', () => {
    const s = setup(rows(4), ON)
    s.fresh().delete(2)

    s.adapter.batchDelete([2, 3])

    expect(findAllReads(s)).toBe(true)
    expectSameAsFresh(s)
  })

  it('a write that matches nothing on the sheet or in the cache keeps the cache warm', () => {
    const s = setup(rows(4), ON)

    expect(s.adapter.update(999, { name: 'none' })).toBeUndefined()
    expect(s.adapter.delete(999)).toBe(false)
    expect(s.adapter.batchUpdate([{ id: 999, data: { name: 'none' } }])).toEqual([])
    expect(s.adapter.batchDelete([999])).toBe(0)

    expect(findAllReads(s)).toBe(false)
    expectSameAsFresh(s)
  })

  it('insert raising DuplicateIdError leaves the cache cold', () => {
    const s = setup(rows(4), { ...ON, idMode: 'client' })

    expect(() => s.adapter.insert({ id: 1, name: 'dup', score: 0 })).toThrow(DuplicateIdError)

    expect(findAllReads(s)).toBe(true)
  })

  it('a failing deleteRows in batchDelete leaves the cache cold', () => {
    const s = setup(rows(6), ON)
    vi.spyOn(s.sheet, 'deleteRows').mockImplementationOnce(() => {
      throw new Error('deleteRows failed')
    })

    expect(() => s.adapter.batchDelete([2, 5])).toThrow('deleteRows failed')

    expect(findAllReads(s)).toBe(true)
    expectSameAsFresh(s)
  })

  it('a failing deleteRow in delete and a failing appendRow in insert leave the cache cold', () => {
    const d = setup(rows(4), ON)
    vi.spyOn(d.sheet, 'deleteRow').mockImplementationOnce(() => {
      throw new Error('deleteRow failed')
    })
    expect(() => d.adapter.delete(2)).toThrow('deleteRow failed')
    expect(findAllReads(d)).toBe(true)
    handles.pop()?.restore()

    const u = setup(rows(4), ON)
    vi.spyOn(u.sheet, 'appendRow').mockImplementationOnce(() => {
      throw new Error('appendRow failed')
    })
    expect(() => u.adapter.insert({ name: 'lost', score: 0 })).toThrow('appendRow failed')
    expect(findAllReads(u)).toBe(true)
  })

  it.each(WRITE_NAMES)('%s on a cold cache makes the same reads as with the option off', name => {
    const reads = (patchCacheOnWrite: boolean): ReadCall[] => {
      const s = setup(rows(8), { patchCacheOnWrite }, false)
      WRITES[name](s.adapter)
      const made = [...s.recorder.reads]
      // A cold cache stays cold.
      expect(findAllReads(s)).toBe(true)
      handles.pop()?.restore()
      return made
    }

    expect(reads(true)).toEqual(reads(false))
  })

  it('reset and the schema operations still drop the cache', () => {
    const columns = ['id', 'name', 'score', 'extra', 'spare']
    const grid = [[1, 'alpha', 1, 'x', 'y'], [2, 'beta', 2, '', 'z']]
    const ops: [string, (a: SheetsAdapter<Row>) => void][] = [
      ['reset', a => a.reset([{ id: 9, name: 'only', score: 1 }])],
      ['removeColumn (declared)', a => a.removeColumn('spare')],
      ['renameColumn (both declared)', a => a.renameColumn('spare', 'extra')],
      ['addColumn (backfill)', a => a.addColumn('extra', { default: 'filled' })]
    ]

    for (const [label, op] of ops) {
      const s = setup(grid, { ...ON, columns })
      op(s.adapter)
      expect(findAllReads(s), label).toBe(true)
      handles.pop()?.restore()
    }
  })
})
