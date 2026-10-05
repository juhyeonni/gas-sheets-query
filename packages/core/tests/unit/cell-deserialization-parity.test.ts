/**
 * Cell deserialization parity (#156)
 *
 * Schema-based cell conversion has two consumers: core's
 * `deserializeColumnValue` (used directly by the local-first client) and
 * `SheetsAdapter`'s row reader. One table of (column type, raw cell, expected
 * value) cases runs against both, so the two paths cannot drift apart again.
 *
 * The adapter-only steps layered around the conversion (formula-marker
 * unescape, GAS Date normalization for non-date columns, JSON auto-detect for
 * untyped columns) are pinned separately below.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { deserializeColumnValue } from '../../src/core/column-conversion'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { ColumnType } from '../../src/adapters/sheets-adapter'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { installGasFakes } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'

interface ConversionCase {
  name: string
  type: ColumnType
  raw: unknown
  expected: unknown
}

const DATE_ISO = '2024-03-01T10:00:00.000Z'

/** Every ColumnType, so a new type without cases fails the coverage check below. */
const ALL_TYPES: readonly ColumnType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'string[]',
  'number[]',
  'object',
  'json'
]

const CONVERSION_TABLE: readonly ConversionCase[] = [
  // string
  { name: 'plain text', type: 'string', raw: 'hello', expected: 'hello' },
  { name: 'empty cell', type: 'string', raw: '', expected: '' },
  { name: 'numeric cell kept as stored', type: 'string', raw: 42, expected: 42 },

  // number
  { name: 'numeric string', type: 'number', raw: '42', expected: 42 },
  { name: 'decimal numeric string', type: 'number', raw: '3.5', expected: 3.5 },
  { name: 'negative numeric string', type: 'number', raw: '-5', expected: -5 },
  { name: 'number cell', type: 'number', raw: 7, expected: 7 },
  { name: 'non-numeric string', type: 'number', raw: 'abc', expected: NaN },
  { name: 'empty cell', type: 'number', raw: '', expected: 0 },

  // boolean
  { name: "'TRUE'", type: 'boolean', raw: 'TRUE', expected: true },
  { name: "'false'", type: 'boolean', raw: 'false', expected: false },
  { name: 'non-boolean string', type: 'boolean', raw: 'yes', expected: false },
  { name: 'boolean cell', type: 'boolean', raw: true, expected: true },
  { name: 'number cell', type: 'boolean', raw: 1, expected: true },
  { name: 'empty cell', type: 'boolean', raw: '', expected: false },

  // date
  { name: 'valid date string', type: 'date', raw: DATE_ISO, expected: new Date(DATE_ISO) },
  { name: 'invalid date string', type: 'date', raw: 'not-a-date', expected: 'not-a-date' },
  { name: 'Date cell', type: 'date', raw: new Date(DATE_ISO), expected: new Date(DATE_ISO) },
  { name: 'empty cell', type: 'date', raw: '', expected: '' },

  // string[]
  { name: 'JSON array', type: 'string[]', raw: '["a","b"]', expected: ['a', 'b'] },
  { name: 'invalid JSON', type: 'string[]', raw: '[a, b', expected: [] },
  { name: 'empty cell', type: 'string[]', raw: '', expected: [] },

  // number[]
  { name: 'JSON array', type: 'number[]', raw: '[1,2,3]', expected: [1, 2, 3] },
  { name: 'invalid JSON', type: 'number[]', raw: 'not json', expected: [] },
  { name: 'empty cell', type: 'number[]', raw: '', expected: [] },

  // object
  { name: 'JSON object', type: 'object', raw: '{"k":1}', expected: { k: 1 } },
  { name: 'invalid JSON', type: 'object', raw: '{k:1}', expected: null },
  { name: 'empty cell', type: 'object', raw: '', expected: null },

  // json
  { name: 'JSON object', type: 'json', raw: '{"nested":{"a":[1]}}', expected: { nested: { a: [1] } } },
  { name: 'JSON scalar', type: 'json', raw: '5', expected: 5 },
  { name: 'invalid JSON', type: 'json', raw: '{oops', expected: null },
  { name: 'empty cell', type: 'json', raw: '', expected: null }
]

const SPREADSHEET_ID = 'parity-spreadsheet-id'
const SHEET_NAME = 'Cells'

interface CellRow extends Record<string, unknown> {
  id: number
  value: unknown
}

/**
 * Read one raw cell through a real `SheetsAdapter` backed by the testing
 * fakes: the cell sits in the `value` column of a single data row.
 */
function readThroughAdapter(raw: unknown, type: ColumnType | undefined): unknown {
  const sheet = fromArrays({ [SHEET_NAME]: [['id', 'value'], [1, raw]] }).getSheetByName(SHEET_NAME)!
  installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: new FakeSpreadsheet('Parity', [sheet]) },
    activeId: SPREADSHEET_ID
  })
  const adapter = new SheetsAdapter<CellRow>({
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    columns: ['id', 'value'],
    columnTypes: type ? { value: type } : undefined
  })
  const rows = adapter.findAll()
  expect(rows).toHaveLength(1)
  return rows[0].value
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
})

describe('cell conversion table', () => {
  it('covers every ColumnType', () => {
    const covered = new Set(CONVERSION_TABLE.map(c => c.type))
    expect([...covered].sort()).toEqual([...ALL_TYPES].sort())
  })

  it('covers an empty cell for every ColumnType', () => {
    const withEmpty = new Set(CONVERSION_TABLE.filter(c => c.raw === '').map(c => c.type))
    expect([...withEmpty].sort()).toEqual([...ALL_TYPES].sort())
  })
})

describe.each(CONVERSION_TABLE)('$type column, $name', ({ type, raw, expected }) => {
  it('deserializeColumnValue converts it', () => {
    expect(deserializeColumnValue(raw, type)).toEqual(expected)
  })

  it('SheetsAdapter reads it back the same way', () => {
    expect(readThroughAdapter(raw, type)).toEqual(expected)
  })
})

describe('SheetsAdapter steps around the typed conversion', () => {
  it('unescapes the formula marker before converting a number column', () => {
    expect(readThroughAdapter("'-5", 'number')).toBe(-5)
    expect(readThroughAdapter("'+7", 'number')).toBe(7)
  })

  it('normalizes a GAS Date in an untyped column to an ISO string', () => {
    expect(readThroughAdapter(new Date(DATE_ISO), undefined)).toBe(DATE_ISO)
  })

  it('normalizes a GAS Date in a non-date typed column to an ISO string', () => {
    expect(readThroughAdapter(new Date(DATE_ISO), 'string')).toBe(DATE_ISO)
  })

  it('auto-parses JSON-looking strings in an untyped column', () => {
    expect(readThroughAdapter('{"a":1}', undefined)).toEqual({ a: 1 })
    expect(readThroughAdapter(' [1,2] ', undefined)).toEqual([1, 2])
  })

  it('keeps an untyped string that only looks like JSON as text', () => {
    expect(readThroughAdapter('{not json}', undefined)).toBe('{not json}')
  })
})
