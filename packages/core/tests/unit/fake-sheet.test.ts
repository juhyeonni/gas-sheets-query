/**
 * FakeSheet / FakeRange unit tests
 * Fidelity oracle: GAS Sheet/Range behavior as documented in story 001-fake-sheet-grid.
 */
import { describe, it, expect } from 'vitest'
import { FakeSheet } from '../../src/testing/fake-sheet'

describe('FakeSheet', () => {
  describe('empty sheet', () => {
    it('getLastRow/getLastColumn return 0', () => {
      const sheet = new FakeSheet('Sheet1')
      expect(sheet.getLastRow()).toBe(0)
      expect(sheet.getLastColumn()).toBe(0)
    })

    it('getDataRange is a 1x1 range on an empty sheet', () => {
      const sheet = new FakeSheet('Sheet1')
      expect(sheet.getDataRange().getValues()).toEqual([['']])
    })
  })

  describe('getRange / getValues padding', () => {
    it('pads a range beyond content with empty strings', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a', 'b'])
      sheet.appendRow(['c', 'd'])
      sheet.appendRow(['e', 'f'])

      const values = sheet.getRange(1, 1, 5, 4).getValues()
      expect(values).toHaveLength(5)
      expect(values[0]).toEqual(['a', 'b', '', ''])
      expect(values[3]).toEqual(['', '', '', ''])
      expect(values[4]).toEqual(['', '', '', ''])
    })

    it('never returns null/undefined for an empty cell', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      const values = sheet.getRange(1, 1, 1, 3).getValues()
      expect(values[0]).toEqual(['a', '', ''])
    })

    it('pads jagged appendRow rows to rectangular on read', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.appendRow(['b', 'c', 'd'])

      expect(sheet.getRange(1, 1, 2, 3).getValues()).toEqual([
        ['a', '', ''],
        ['b', 'c', 'd']
      ])
    })

    it('getRange defaults numRows/numCols to 1', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['x', 'y'])
      expect(sheet.getRange(1, 2).getValues()).toEqual([['y']])
    })
  })

  describe('getRange invalid coordinates', () => {
    it.each([
      [0, 1, 1, 1],
      [1, 0, 1, 1],
      [1, 1, 0, 1],
      [1, 1, 1, 0],
      [-1, 1, 1, 1]
    ])('throws for row=%s col=%s numRows=%s numCols=%s', (row, col, numRows, numCols) => {
      const sheet = new FakeSheet('Sheet1')
      expect(() => sheet.getRange(row, col, numRows, numCols)).toThrow()
    })
  })

  describe('setValues', () => {
    it('throws when values row count does not match the range', () => {
      const sheet = new FakeSheet('Sheet1')
      expect(() => sheet.getRange(1, 1, 2, 2).setValues([['a', 'b']])).toThrow(/dimension mismatch/)
    })

    it('throws when values column count does not match the range', () => {
      const sheet = new FakeSheet('Sheet1')
      expect(() =>
        sheet.getRange(1, 1, 2, 2).setValues([
          ['a', 'b', 'c'],
          ['d', 'e', 'f']
        ])
      ).toThrow(/dimension mismatch/)
    })

    it('grows the grid when writing beyond current bounds', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.getRange(5, 5, 1, 1).setValues([['z']])

      expect(sheet.getLastRow()).toBe(5)
      expect(sheet.getLastColumn()).toBe(5)
      expect(sheet.getRange(5, 5, 1, 1).getValues()).toEqual([['z']])
    })

    it('writes in place without disturbing untouched cells', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a', 'b', 'c'])
      sheet.getRange(1, 2, 1, 1).setValues([['B']])
      expect(sheet.getRange(1, 1, 1, 3).getValues()).toEqual([['a', 'B', 'c']])
    })
  })

  describe('getLastColumn (#86-class fidelity)', () => {
    it('is not shifted by trailing empty columns in other rows', () => {
      const sheet = new FakeSheet('Sheet1')
      // Row 1 has trailing blanks; row 2 has real content in the last column.
      sheet.getRange(1, 1, 1, 5).setValues([['a', 'b', '', '', '']])
      sheet.getRange(2, 1, 1, 5).setValues([['x', '', '', '', 'y']])

      expect(sheet.getLastColumn()).toBe(5)
    })
  })

  describe('getLastRow', () => {
    it('a blank row in the middle only counts if a later row has content', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.appendRow(['', ''])
      expect(sheet.getLastRow()).toBe(1)

      sheet.appendRow(['b'])
      expect(sheet.getLastRow()).toBe(3)
    })
  })

  describe('appendRow', () => {
    it('lands the row at getLastRow() + 1', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.appendRow(['b'])
      expect(sheet.getLastRow()).toBe(2)
      expect(sheet.getRange(2, 1, 1, 1).getValues()).toEqual([['b']])
    })
  })

  describe('deleteRow', () => {
    it('shifts subsequent rows up', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.appendRow(['b'])
      sheet.appendRow(['c'])

      sheet.deleteRow(2)

      expect(sheet.getLastRow()).toBe(2)
      expect(sheet.getRange(2, 1, 1, 1).getValues()).toEqual([['c']])
    })

    it('throws when deleting beyond the last row', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      expect(() => sheet.deleteRow(2)).toThrow(/out of bounds/)
    })

    it('throws for row indexes below 1', () => {
      const sheet = new FakeSheet('Sheet1')
      expect(() => sheet.deleteRow(0)).toThrow(/out of bounds/)
    })
  })

  describe('clear / clearContents', () => {
    it('clear empties the grid and resets frozen rows', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.setFrozenRows(1)

      sheet.clear()

      expect(sheet.getLastRow()).toBe(0)
      expect(sheet.getFrozenRows()).toBe(0)
    })

    it('clearContents empties the grid but preserves frozen rows', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.setFrozenRows(1)

      sheet.clearContents()

      expect(sheet.getLastRow()).toBe(0)
      expect(sheet.getFrozenRows()).toBe(1)
    })
  })

  describe('frozen rows', () => {
    it('setFrozenRows/getFrozenRows round-trip with no behavioral effect', () => {
      const sheet = new FakeSheet('Sheet1')
      sheet.appendRow(['a'])
      sheet.setFrozenRows(1)
      expect(sheet.getFrozenRows()).toBe(1)
      expect(sheet.getLastRow()).toBe(1)
    })
  })

  describe('getName', () => {
    it('returns the configured name', () => {
      expect(new FakeSheet('MySheet').getName()).toBe('MySheet')
    })
  })
})
