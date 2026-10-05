/**
 * Leading-apostrophe round trip (#201)
 *
 * Real Sheets parses a USER_ENTERED write and consumes one leading apostrophe
 * (the plain-text marker), while the testing fakes, a cell pre-formatted as
 * plain text and an imported CSV keep the written text verbatim. The old
 * escape scheme (one marker in front of an apostrophe) lost a character on
 * real Sheets for `'=note`: written `''=note`, stored `'=note`, read `=note`.
 *
 * The encoding now writes a string with k leading apostrophes behind 2k+1 of
 * them, so every stored form decodes to one value in both storage modes. Each
 * test here runs against both: the plain FakeSheet (verbatim) and a FakeSheet
 * that drops one leading apostrophe from every written string, as real Sheets
 * does.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import { FakeRange, FakeSheet } from '../../src/testing/fake-sheet'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { installGasFakes } from '../../src/testing/install'

const SPREADSHEET_ID = 'apostrophe-spreadsheet-id'
const SHEET_NAME = 'Notes'
const TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

/** Drops one leading apostrophe from a string cell, as Sheets' USER_ENTERED parser does. */
function parseLikeSheets(cell: unknown): unknown {
  return typeof cell === 'string' && cell.startsWith("'") ? cell.slice(1) : cell
}

/** A FakeSheet that stores written strings the way real Sheets parses them. */
class ParsingFakeSheet extends FakeSheet {
  override getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    const inner = super.getRange(row, col, numRows, numCols)
    return new FakeRange(
      () => inner.getValues(),
      values => inner.setValues(values.map(r => r.map(parseLikeSheets))),
      numRows,
      numCols
    )
  }

  override appendRow(values: unknown[]): void {
    super.appendRow(values.map(parseLikeSheets))
  }
}

type StorageMode = 'verbatim' | 'drops one apostrophe'

const MODES: StorageMode[] = ['verbatim', 'drops one apostrophe']

/**
 * Raw cells exactly as the adapter wrote them, before any storage parsing.
 * Filled by every write, in both modes, so AC3 can inspect what was sent.
 */
let written: unknown[] = []

function setup(mode: StorageMode, data: unknown[][]): FakeSheet {
  const sheet = mode === 'verbatim' ? new FakeSheet(SHEET_NAME) : new ParsingFakeSheet(SHEET_NAME)
  for (const row of data) sheet.appendRow(row)

  written = []
  const getRange = sheet.getRange.bind(sheet)
  sheet.getRange = (row: number, col: number, numRows = 1, numCols = 1): FakeRange => {
    const range = getRange(row, col, numRows, numCols)
    return new FakeRange(
      () => range.getValues(),
      values => {
        for (const r of values) written.push(...r)
        range.setValues(values)
      },
      numRows,
      numCols
    )
  }
  const appendRow = sheet.appendRow.bind(sheet)
  sheet.appendRow = (values: unknown[]): void => {
    written.push(...values)
    appendRow(values)
  }

  installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: new FakeSpreadsheet('ApostropheSpreadsheet', [sheet]) },
    activeId: SPREADSHEET_ID
  })
  return sheet
}

interface NoteRow extends Record<string, unknown> {
  id: number
  note: string
}

function createAdapter<T extends Record<string, unknown> & { id: string | number }>(
  extra: Partial<ConstructorParameters<typeof SheetsAdapter>[0]> = {}
): SheetsAdapter<T> {
  return new SheetsAdapter<T>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: ['id', 'note'],
    ...extra
  })
}

function rawCell(sheet: FakeSheet, row: number, col: number): unknown {
  return sheet.getRange(row, col).getValues()[0][0]
}

/** The AC1 inputs: apostrophe-led strings, with and without a trigger behind them. */
const APOSTROPHE_VALUES: string[] = ["'=note", "''", "'-5", "'@x", "'", "'quoted", "''=x"]

afterEach(() => {
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
  delete (globalThis as Record<string, unknown>).LockService
})

describe.each(MODES)('leading-apostrophe round trip, store %s (#201)', mode => {
  it.each(APOSTROPHE_VALUES)('insert, findById and findAll return %j unchanged', value => {
    setup(mode, [['id', 'note']])
    const adapter = createAdapter<NoteRow>()

    const inserted = adapter.insert({ note: value })
    expect(inserted.note).toBe(value)

    const reader = createAdapter<NoteRow>()
    expect(reader.findById(inserted.id)?.note).toBe(value)
    expect(reader.findAll().map(r => r.note)).toEqual([value])
  })

  it.each(APOSTROPHE_VALUES)('update returns and stores %j unchanged', value => {
    setup(mode, [['id', 'note'], [1, 'before']])
    const adapter = createAdapter<NoteRow>()

    expect(adapter.update(1, { note: value })?.note).toBe(value)
    expect(createAdapter<NoteRow>().findById(1)?.note).toBe(value)
  })

  it('batchInsert stores every input unchanged', () => {
    setup(mode, [['id', 'note']])
    const adapter = createAdapter<NoteRow>()

    adapter.batchInsert(APOSTROPHE_VALUES.map(note => ({ note })))

    expect(createAdapter<NoteRow>().findAll().map(r => r.note)).toEqual(APOSTROPHE_VALUES)
  })

  it('batchUpdate returns and stores every input unchanged', () => {
    setup(mode, [['id', 'note'], ...APOSTROPHE_VALUES.map((_, i) => [i + 1, 'before'])])
    const adapter = createAdapter<NoteRow>()

    const results = adapter.batchUpdate(
      APOSTROPHE_VALUES.map((note, i) => ({ id: i + 1, data: { note } }))
    )

    expect(results.map(r => r.note)).toEqual(APOSTROPHE_VALUES)
    expect(createAdapter<NoteRow>().findAll().map(r => r.note)).toEqual(APOSTROPHE_VALUES)
  })

  it('never writes a raw cell that starts with a formula trigger', () => {
    setup(mode, [['id', 'note']])
    const adapter = createAdapter<NoteRow>()
    const risky = [...APOSTROPHE_VALUES, '=1+1', '+1', '-1', '@x', '\t=1', '\r=1']

    for (const note of risky) adapter.insert({ note })
    adapter.batchInsert(risky.map(note => ({ note })))
    adapter.batchUpdate(risky.map((note, i) => ({ id: i + 1, data: { note } })))

    const strings = written.filter((cell): cell is string => typeof cell === 'string')
    expect(strings.length).toBeGreaterThan(0)
    for (const cell of strings) {
      for (const trigger of TRIGGERS) expect(cell.startsWith(trigger)).toBe(false)
    }
  })

  it("finds, updates and deletes a client-provided id `'=1` by that id", () => {
    setup(mode, [['id', 'note']])
    const adapter = createAdapter<{ id: string; note: string }>({ idMode: 'client' })

    adapter.insert({ id: "'=1", note: 'x' })

    const reader = createAdapter<{ id: string; note: string }>({ idMode: 'client' })
    expect(reader.findById("'=1")?.note).toBe('x')
    expect(reader.findAll()[0].id).toBe("'=1")
    expect(reader.update("'=1", { note: 'y' })?.note).toBe('y')
    expect(createAdapter<{ id: string; note: string }>({ idMode: 'client' }).findById("'=1")?.note).toBe('y')
    expect(reader.delete("'=1")).toBe(true)
    expect(createAdapter<{ id: string; note: string }>({ idMode: 'client' }).findAll()).toHaveLength(0)
  })

  it('still round-trips trigger strings and writes safe strings as is', () => {
    const sheet = setup(mode, [['id', 'note']])
    const adapter = createAdapter<NoteRow>()
    const values = ['=1+1', '+1', '-1', '@x', '\t=1', '\r=1', 'hello', "it's"]

    adapter.batchInsert(values.map(note => ({ note })))

    expect(createAdapter<NoteRow>().findAll().map(r => r.note)).toEqual(values)
    expect(rawCell(sheet, 8, 2)).toBe('hello')
    expect(rawCell(sheet, 9, 2)).toBe("it's")
  })

  it('reads a pre-existing `\'quoted word` cell unchanged', () => {
    const sheet = new FakeSheet(SHEET_NAME)
    sheet.appendRow(['id', 'note'])
    sheet.appendRow([1, "'quoted word"])
    installGasFakes({
      spreadsheets: { [SPREADSHEET_ID]: new FakeSpreadsheet('ApostropheSpreadsheet', [sheet]) },
      activeId: SPREADSHEET_ID
    })

    expect(createAdapter<NoteRow>().findById(1)?.note).toBe("'quoted word")
  })

  it('writes and reads verbatim with allowFormulas: true', () => {
    const sheet = setup(mode, [['id', 'note']])
    const adapter = createAdapter<NoteRow>({ allowFormulas: true })

    const row = adapter.insert({ note: '=SUM(A1:A2)' })

    expect(written).toContain('=SUM(A1:A2)')
    expect(rawCell(sheet, 2, 2)).toBe('=SUM(A1:A2)')
    expect(createAdapter<NoteRow>({ allowFormulas: true }).findById(row.id)?.note).toBe('=SUM(A1:A2)')
  })
})

describe('leading-apostrophe encoding on the raw cell (#201)', () => {
  it.each([
    ["'", "'''"],
    ["''", "'''''"],
    ["'=note", "'''=note"],
    ["'quoted", "'''quoted"],
    ['=note', "'=note"]
  ])('writes %j as %j', (value, cell) => {
    const sheet = setup('verbatim', [['id', 'note']])

    createAdapter<NoteRow>().insert({ note: value })

    expect(rawCell(sheet, 2, 2)).toBe(cell)
  })

  it('decodes legacy cells with 0 or 1 leading apostrophes as before', () => {
    const sheet = new FakeSheet(SHEET_NAME)
    sheet.appendRow(['id', 'note'])
    sheet.appendRow([1, "'=x"])
    sheet.appendRow([2, "'plain"])
    sheet.appendRow([3, 'plain'])
    installGasFakes({
      spreadsheets: { [SPREADSHEET_ID]: new FakeSpreadsheet('ApostropheSpreadsheet', [sheet]) },
      activeId: SPREADSHEET_ID
    })

    expect(createAdapter<NoteRow>().findAll().map(r => r.note)).toEqual(['=x', "'plain", 'plain'])
  })
})
