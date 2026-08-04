/**
 * loaders.ts unit tests — fromArrays / fromCsv / fromJson.
 * Fidelity oracle: story 004-snapshot-loaders.
 */
import { describe, it, expect } from 'vitest'
import { fromArrays, fromCsv, fromJson } from '../../src/testing/loaders'
import { toJson } from '../../src/testing/export'

describe('fromArrays', () => {
  it('builds one sheet per key with values used verbatim', () => {
    const ss = fromArrays({
      Issues: [
        ['id', 'title'],
        [1, 'Bug']
      ],
      Users: [['id', 'name']]
    })

    expect(ss.getSheets().map(s => s.getName())).toEqual(['Issues', 'Users'])
    expect(ss.getSheetByName('Issues')!.getRange(1, 1, 2, 2).getValues()).toEqual([
      ['id', 'title'],
      [1, 'Bug']
    ])
  })

  it('does not coerce string values (verbatim, unlike fromCsv)', () => {
    const ss = fromArrays({ Sheet1: [['42', 'TRUE']] })
    expect(ss.getSheetByName('Sheet1')!.getRange(1, 1, 1, 2).getValues()).toEqual([['42', 'TRUE']])
  })
})

describe('fromCsv', () => {
  it('parses an RFC 4180 CSV into a sheet named as given', () => {
    const sheet = fromCsv('People', 'name,age\nAlice,30')
    expect(sheet.getName()).toBe('People')
    expect(sheet.getRange(1, 1, 2, 2).getValues()).toEqual([
      ['name', 'age'],
      ['Alice', 30]
    ])
  })

  it('applies default coercion (numbers, booleans, dates)', () => {
    const sheet = fromCsv('T', 'n,b,d\n42,TRUE,2026-03-16T07:12:35.819Z')
    const [row] = sheet.getRange(2, 1, 1, 3).getValues()
    expect(row[0]).toBe(42)
    expect(row[1]).toBe(true)
    expect(row[2]).toBeInstanceOf(Date)
  })

  it('keeps raw strings when coerce: false', () => {
    const sheet = fromCsv('T', 'n,b\n42,TRUE', { coerce: false })
    expect(sheet.getRange(2, 1, 1, 2).getValues()).toEqual([['42', 'TRUE']])
  })

  it('throws a descriptive error for malformed CSV', () => {
    expect(() => fromCsv('T', 'a,"unterminated')).toThrow(/unterminated quoted field/)
  })

  it('produces an empty sheet for an empty CSV string', () => {
    const sheet = fromCsv('T', '')
    expect(sheet.getLastRow()).toBe(0)
  })
})

describe('fromJson', () => {
  it('reconstructs a spreadsheet equivalent to what toJson() exported', () => {
    const original = fromArrays({
      Sheet1: [
        ['a', 'created'],
        ['x', new Date('2024-01-15T10:30:00.000Z')]
      ]
    })
    const reloaded = fromJson(toJson(original))

    const originalGrid = original.getSheetByName('Sheet1')!.getRange(1, 1, 2, 2).getValues()
    const reloadedGrid = reloaded.getSheetByName('Sheet1')!.getRange(1, 1, 2, 2).getValues()

    expect(reloadedGrid[0]).toEqual(originalGrid[0])
    expect(reloadedGrid[1][0]).toBe(originalGrid[1][0])
    expect(reloadedGrid[1][1]).toBeInstanceOf(Date)
    expect((reloadedGrid[1][1] as Date).getTime()).toBe((originalGrid[1][1] as Date).getTime())
  })

  it('restores frozenRows from the envelope', () => {
    const original = fromArrays({ Sheet1: [['a']] })
    original.getSheetByName('Sheet1')!.setFrozenRows(1)

    const reloaded = fromJson(toJson(original))
    expect(reloaded.getSheetByName('Sheet1')!.getFrozenRows()).toBe(1)
  })
})
