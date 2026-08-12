/**
 * csv.ts unit tests — RFC 4180 parsing/serialization and Sheets-style
 * auto-typing coercion. Fidelity oracle: story 004-snapshot-loaders.
 */
import { describe, it, expect } from 'vitest'
import { parseCsv, serializeCsvCell, coerceCell } from '../../src/testing/csv'

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ])
  })

  it('handles quoted fields with embedded commas, newlines, and escaped quotes', () => {
    const csv = 'a,b,c\n"hello, world","line1\nline2","she said ""hi"""'
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['hello, world', 'line1\nline2', 'she said "hi"']
    ])
  })

  it('accepts both CRLF and LF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('strips a leading BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('preserves trailing empty cells within a row (#86-class fidelity)', () => {
    const csv = 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o\n1,2,,,,,,,,,,,,,\n'
    const rows = parseCsv(csv)
    expect(rows[0]).toHaveLength(15)
    expect(rows[1]).toHaveLength(15)
    expect(rows[1]).toEqual(['1', '2', '', '', '', '', '', '', '', '', '', '', '', '', ''])
  })

  it('does not produce a phantom trailing row for a final trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('throws a descriptive error for an unterminated quoted field', () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(/unterminated quoted field/)
  })
})

describe('coerceCell', () => {
  it('coerces integer and decimal strings to numbers', () => {
    expect(coerceCell('42')).toBe(42)
    expect(coerceCell('-3.14')).toBe(-3.14)
  })

  it('coerces true/false (any case) to booleans', () => {
    expect(coerceCell('TRUE')).toBe(true)
    expect(coerceCell('false')).toBe(false)
    expect(coerceCell('True')).toBe(true)
  })

  it('coerces a valid ISO datetime string to a Date', () => {
    const result = coerceCell('2026-03-16T07:12:35.819Z')
    expect(result).toBeInstanceOf(Date)
    expect((result as Date).toISOString()).toBe('2026-03-16T07:12:35.819Z')
  })

  it('coerces a valid ISO date-only string to a Date', () => {
    const result = coerceCell('2024-01-15')
    expect(result).toBeInstanceOf(Date)
  })

  it('leaves a numeric-looking-but-invalid string as a string', () => {
    expect(coerceCell('123abc')).toBe('123abc')
  })

  it('leaves an out-of-range date string as a string', () => {
    expect(coerceCell('2026-13-99')).toBe('2026-13-99')
  })

  it('leaves an empty string as an empty string', () => {
    expect(coerceCell('')).toBe('')
  })

  it('leaves an ordinary string untouched', () => {
    expect(coerceCell('hello world')).toBe('hello world')
  })
})

describe('serializeCsvCell', () => {
  it('serializes a Date as an ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(serializeCsvCell(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  it('serializes booleans as TRUE/FALSE', () => {
    expect(serializeCsvCell(true)).toBe('TRUE')
    expect(serializeCsvCell(false)).toBe('FALSE')
  })

  it('serializes null/undefined as an empty string', () => {
    expect(serializeCsvCell(null)).toBe('')
    expect(serializeCsvCell(undefined)).toBe('')
  })

  it('quotes a field containing a comma', () => {
    expect(serializeCsvCell('hello, world')).toBe('"hello, world"')
  })

  it('quotes and escapes a field containing double quotes', () => {
    expect(serializeCsvCell('she said "hi"')).toBe('"she said ""hi"""')
  })

  it('quotes a field containing a newline', () => {
    expect(serializeCsvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it('leaves a plain string unquoted', () => {
    expect(serializeCsvCell('hello')).toBe('hello')
    expect(serializeCsvCell(42)).toBe('42')
  })
})
