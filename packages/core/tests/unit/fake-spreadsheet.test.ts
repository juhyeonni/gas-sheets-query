/**
 * FakeSpreadsheet unit tests
 * Fidelity oracle: GAS Spreadsheet behavior as documented in story 002-fake-spreadsheet-container.
 */
import { describe, it, expect } from 'vitest'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { FakeSheet } from '../../src/testing/fake-sheet'

describe('FakeSpreadsheet', () => {
  it('getSheetByName returns null (not throw) when the sheet does not exist', () => {
    const ss = new FakeSpreadsheet('MySheet')
    expect(ss.getSheetByName('X')).toBeNull()
  })

  it('getSheetByName(\'\') returns null', () => {
    const ss = new FakeSpreadsheet('MySheet')
    expect(ss.getSheetByName('')).toBeNull()
  })

  it('insertSheet creates and returns an empty sheet', () => {
    const ss = new FakeSpreadsheet('MySheet')
    const sheet = ss.insertSheet('X')

    expect(sheet.getName()).toBe('X')
    expect(sheet.getLastRow()).toBe(0)
    expect(ss.getSheetByName('X')).toBe(sheet)
  })

  it('insertSheet throws when the name is already taken', () => {
    const ss = new FakeSpreadsheet('MySheet')
    ss.insertSheet('X')
    expect(() => ss.insertSheet('X')).toThrow(/already exists/)
  })

  it('getSheets returns sheets in insertion order', () => {
    const ss = new FakeSpreadsheet('MySheet')
    ss.insertSheet('C')
    ss.insertSheet('A')
    ss.insertSheet('B')

    expect(ss.getSheets().map(s => s.getName())).toEqual(['C', 'A', 'B'])
  })

  it('getName returns the configured name', () => {
    expect(new FakeSpreadsheet('Orders DB').getName()).toBe('Orders DB')
  })

  it('supports sheet names with spaces and unicode', () => {
    const ss = new FakeSpreadsheet('MySheet')
    const sheet = ss.insertSheet('売上 Report 2024')
    expect(ss.getSheetByName('売上 Report 2024')).toBe(sheet)
  })

  it('accepts initial sheets in the constructor (for loaders)', () => {
    const preloaded = new FakeSheet('Preloaded')
    const ss = new FakeSpreadsheet('MySheet', [preloaded])

    expect(ss.getSheetByName('Preloaded')).toBe(preloaded)
    expect(ss.getSheets()).toEqual([preloaded])
  })
})
