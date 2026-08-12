/**
 * installGasFakes / GasFakesHandle unit + integration tests
 * Fidelity oracle: story 003-global-shim, plus bolt 001-fake-gas's success
 * criterion that SheetsAdapter runs end-to-end against the fake unmodified.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { installGasFakes } from '../../src/testing/install'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'

interface TestRow extends Record<string, unknown> {
  id: number
  name: string
  age: number
}

function teardownGlobals(): void {
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
  delete (globalThis as Record<string, unknown>).LockService
}

describe('installGasFakes', () => {
  afterEach(() => {
    teardownGlobals()
  })

  describe('SpreadsheetApp wiring', () => {
    it('openById resolves a registered spreadsheet', () => {
      const ss = new FakeSpreadsheet('MySheet')
      installGasFakes({ spreadsheets: { 'sheet-1': ss } })

      expect((globalThis as any).SpreadsheetApp.openById('sheet-1')).toBe(ss)
    })

    it('openById throws with a clear message for an unregistered id', () => {
      installGasFakes({ spreadsheets: {} })

      expect(() => (globalThis as any).SpreadsheetApp.openById('missing')).toThrow(
        /no fake spreadsheet registered for id "missing"/
      )
    })

    it('getActiveSpreadsheet returns the spreadsheet designated by activeId', () => {
      const ss = new FakeSpreadsheet('MySheet')
      installGasFakes({ spreadsheets: { active: ss }, activeId: 'active' })

      expect((globalThis as any).SpreadsheetApp.getActiveSpreadsheet()).toBe(ss)
    })

    it('getActiveSpreadsheet throws with an actionable message when activeId is missing', () => {
      installGasFakes({ spreadsheets: {} })

      expect(() => (globalThis as any).SpreadsheetApp.getActiveSpreadsheet()).toThrow(
        /no activeId registered/
      )
    })

    it('getActiveSpreadsheet throws when activeId does not resolve in spreadsheets', () => {
      installGasFakes({ spreadsheets: {}, activeId: 'ghost' })

      expect(() => (globalThis as any).SpreadsheetApp.getActiveSpreadsheet()).toThrow(
        /no activeId registered/
      )
    })
  })

  describe('LockService wiring', () => {
    it('getScriptLock returns an always-available no-op lock', () => {
      installGasFakes({ spreadsheets: {} })
      const lock = (globalThis as any).LockService.getScriptLock()

      expect(lock.tryLock()).toBe(true)
      expect(lock.hasLock()).toBe(true)
      expect(() => lock.waitLock(1000)).not.toThrow()
      expect(() => lock.releaseLock()).not.toThrow()
    })
  })

  describe('restore', () => {
    it('removes globals that did not exist before install', () => {
      const handle = installGasFakes({ spreadsheets: {} })
      expect((globalThis as any).SpreadsheetApp).toBeDefined()

      handle.restore()

      expect((globalThis as Record<string, unknown>).SpreadsheetApp).toBeUndefined()
      expect((globalThis as Record<string, unknown>).LockService).toBeUndefined()
    })

    it('restores a prior global exactly (including a non-fake value)', () => {
      const sentinel = { openById: () => 'sentinel' }
      ;(globalThis as Record<string, unknown>).SpreadsheetApp = sentinel

      const handle = installGasFakes({ spreadsheets: {} })
      expect((globalThis as any).SpreadsheetApp).not.toBe(sentinel)

      handle.restore()

      expect((globalThis as Record<string, unknown>).SpreadsheetApp).toBe(sentinel)
    })

    it('supports nested install/restore in LIFO order', () => {
      const outer = installGasFakes({ spreadsheets: { a: new FakeSpreadsheet('A') } })
      const outerApp = (globalThis as any).SpreadsheetApp

      const inner = installGasFakes({ spreadsheets: { b: new FakeSpreadsheet('B') } })
      const innerApp = (globalThis as any).SpreadsheetApp
      expect(innerApp).not.toBe(outerApp)

      inner.restore()
      expect((globalThis as any).SpreadsheetApp).toBe(outerApp)

      outer.restore()
      expect((globalThis as Record<string, unknown>).SpreadsheetApp).toBeUndefined()
    })

    it('leaves no state across repeated install/restore cycles', () => {
      for (let i = 0; i < 3; i++) {
        const handle = installGasFakes({ spreadsheets: { s: new FakeSpreadsheet(`S${i}`) } })
        expect((globalThis as any).SpreadsheetApp.openById('s').getName()).toBe(`S${i}`)
        handle.restore()
        expect((globalThis as Record<string, unknown>).SpreadsheetApp).toBeUndefined()
      }
    })
  })

  describe('SheetsAdapter end-to-end against the fake', () => {
    it('runs full CRUD via spreadsheetId with zero adapter changes', () => {
      const ss = new FakeSpreadsheet('MySheet')
      const gas = installGasFakes({ spreadsheets: { 'sheet-1': ss } })

      const adapter = new SheetsAdapter<TestRow>({
        spreadsheetId: 'sheet-1',
        sheetName: 'people',
        columns: ['id', 'name', 'age']
      })

      const alice = adapter.insert({ name: 'Alice', age: 30 })
      expect(alice.id).toBe(1)

      expect(adapter.findAll()).toEqual([{ id: 1, name: 'Alice', age: 30 }])
      expect(adapter.findById(1)).toEqual({ id: 1, name: 'Alice', age: 30 })

      const updated = adapter.update(1, { age: 31 })
      expect(updated?.age).toBe(31)

      expect(adapter.delete(1)).toBe(true)
      expect(adapter.findAll()).toEqual([])

      gas.restore()
    })

    it('runs via getActiveSpreadsheet when no spreadsheetId is given', () => {
      const ss = new FakeSpreadsheet('MySheet')
      installGasFakes({ spreadsheets: { active: ss }, activeId: 'active' })

      const adapter = new SheetsAdapter<TestRow>({
        sheetName: 'people',
        columns: ['id', 'name', 'age']
      })

      const bob = adapter.insert({ name: 'Bob', age: 25 })
      expect(bob.id).toBe(1)
      expect(ss.getSheetByName('people')?.getLastRow()).toBe(2) // header + 1 data row
    })

    it('withLock path (auto-mode insert) uses the no-op LockService without error', () => {
      const ss = new FakeSpreadsheet('MySheet')
      installGasFakes({ spreadsheets: { 'sheet-1': ss } })

      const adapter = new SheetsAdapter<TestRow>({
        spreadsheetId: 'sheet-1',
        sheetName: 'people',
        columns: ['id', 'name', 'age']
      })

      expect(() => adapter.insert({ name: 'Carol', age: 40 })).not.toThrow()
    })

    it('#86-class scenario: trailing-empty-column data survives adapter read unshifted', () => {
      const ss = new FakeSpreadsheet('MySheet')
      installGasFakes({ spreadsheets: { 'sheet-1': ss } })

      const adapter = new SheetsAdapter<TestRow>({
        spreadsheetId: 'sheet-1',
        sheetName: 'people',
        columns: ['id', 'name', 'age']
      })

      // Seed via the adapter first so it creates the sheet (with header row).
      adapter.insert({ name: 'Seed', age: 1 })
      const sheet = ss.getSheetByName('people')!

      // Write a row whose trailing (5th) column has content but whose first
      // three columns — the adapter's own column window — are blank.
      sheet.getRange(5, 1, 1, 5).setValues([['', '', '', '', 'y']])

      // getLastColumn must report the real last column (5), not shift back
      // to the header width (3), regardless of blanks in between (#86 class).
      expect(sheet.getLastColumn()).toBe(5)

      // The adapter reads only its own column window and correctly treats
      // the synthetic row as blank data, unaffected by the trailing column.
      adapter.insert({ name: 'Dana', age: 22 })
      const names = adapter.findAll().map(r => r.name)
      expect(names).toEqual(['Seed', 'Dana'])
    })
  })
})
