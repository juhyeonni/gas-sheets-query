/**
 * SheetsAdapter unit tests, running against @gsquery/core/testing fakes
 *
 * Since SheetsAdapter depends on Google Apps Script APIs (SpreadsheetApp,
 * LockService) which are unavailable in Node.js, we install FakeSheet/
 * FakeSpreadsheet via installGasFakes() to test all adapter logic against a
 * real (fake) grid instead of hand-rolled stubs — this is the suite's own
 * fidelity proof for the fake (#007-dogfood-adapter-tests).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'
import { FakeSheet, FakeRange } from '../../src/testing/fake-sheet'
import { FakeSpreadsheet } from '../../src/testing/fake-spreadsheet'
import { installGasFakes } from '../../src/testing/install'
import { fromArrays } from '../../src/testing/loaders'

// ---------------------------------------------------------------------------
// Fake-backed GAS globals setup
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-id'

/** Builds a FakeSheet with `data` written verbatim (data[0] = header row). */
function createFakeSheet(data: unknown[][] = [], name = 'TestSheet'): FakeSheet {
  return fromArrays({ [name]: data }).getSheetByName(name)!
}

/**
 * Installs the fake spreadsheet under both spreadsheetId literals this file
 * uses ('test-spreadsheet-id' and 'test') and as the active spreadsheet, then
 * spies the instance/global methods individual tests assert on. Mirrors the
 * old stub's setupGASGlobals(sheet, opts) signature and default (no lock).
 */
function setupGASGlobals(sheet: FakeSheet, opts: { withLock?: boolean } = {}): FakeSpreadsheet {
  const ss = new FakeSpreadsheet('TestSpreadsheet', [sheet])
  installGasFakes({
    spreadsheets: { [SPREADSHEET_ID]: ss, test: ss },
    activeId: SPREADSHEET_ID
  })

  vi.spyOn((globalThis as any).SpreadsheetApp, 'openById')
  vi.spyOn((globalThis as any).SpreadsheetApp, 'getActiveSpreadsheet')
  vi.spyOn(ss, 'getSheetByName')
  vi.spyOn(ss, 'insertSheet')
  vi.spyOn(sheet, 'getRange')
  vi.spyOn(sheet, 'appendRow')
  vi.spyOn(sheet, 'deleteRow')
  vi.spyOn(sheet, 'clear')
  vi.spyOn(sheet, 'getLastRow')

  if (opts.withLock) {
    vi.spyOn((globalThis as any).LockService, 'getScriptLock')
  } else {
    delete (globalThis as Record<string, unknown>).LockService
  }

  return ss
}

/** Builds+registers a 'Test'-named fixture for the serialization/schema-type blocks below. */
function setupSerializationTest(data: unknown[][]): FakeSheet {
  const sheet = createFakeSheet(data, 'Test')
  setupGASGlobals(sheet)
  return sheet
}

function teardownGASGlobals(): void {
  delete (globalThis as Record<string, unknown>).SpreadsheetApp
  delete (globalThis as Record<string, unknown>).LockService
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestRow extends Record<string, unknown> {
  id: number
  name: string
  age: number
  active: boolean
}

const DEFAULT_OPTIONS: SheetsAdapterOptions = {
  spreadsheetId: 'test-spreadsheet-id',
  sheetName: 'TestSheet',
  columns: ['id', 'name', 'age', 'active']
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SheetsAdapter', () => {
  beforeEach(() => {
    // Shared across every test: lets assertions inspect a specific FakeRange's
    // setValues() the way the old stub's per-range vi.fn() let them.
    vi.spyOn(FakeRange.prototype, 'setValues')
  })

  afterEach(() => {
    teardownGASGlobals()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create adapter with valid options', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      expect(adapter).toBeDefined()
    })

    it('should throw when id column is not in columns', () => {
      expect(() => {
        new SheetsAdapter<TestRow>({
          sheetName: 'Test',
          columns: ['name', 'age'],
          idColumn: 'id'
        })
      }).toThrow("ID column 'id' must be included in columns")
    })

    it('should use default idColumn and idMode', () => {
      const sheet = createFakeSheet([['id', 'name']])
      setupGASGlobals(sheet)

      // id is default idColumn, auto is default idMode — should not throw
      const adapter = new SheetsAdapter<{ id: number; name: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name']
      })
      expect(adapter).toBeDefined()
    })

    it('should accept custom idColumn', () => {
      const sheet = createFakeSheet([['uid', 'name']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ uid: number; name: string } & { id: number }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['uid', 'name'],
        idColumn: 'uid'
      })
      expect(adapter).toBeDefined()
    })
  })

  describe('getSheet (via findAll)', () => {
    it('should use SpreadsheetApp.openById when spreadsheetId is provided', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.findAll()

      expect((globalThis as any).SpreadsheetApp.openById).toHaveBeenCalledWith('test-spreadsheet-id')
    })

    it('should use getActiveSpreadsheet when no spreadsheetId', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        sheetName: 'Test',
        columns: ['id', 'name', 'age', 'active']
      })
      adapter.findAll()

      expect((globalThis as any).SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled()
    })

    it('should create sheet if createIfNotExists and sheet not found', () => {
      const ss = new FakeSpreadsheet('TestSpreadsheet')
      installGasFakes({ spreadsheets: { 'test-spreadsheet-id': ss } })
      const insertSheetSpy = vi.spyOn(ss, 'insertSheet')

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        createIfNotExists: true
      })
      adapter.findAll()

      expect(insertSheetSpy).toHaveBeenCalledWith('TestSheet')
      // Should write header row
      const newSheet = ss.getSheetByName('TestSheet')!
      expect(newSheet.getRange(1, 1, 1, 4).getValues()).toEqual([DEFAULT_OPTIONS.columns])
    })

    it('should throw when sheet not found and createIfNotExists is false', () => {
      const ss = new FakeSpreadsheet('TestSpreadsheet')
      installGasFakes({ spreadsheets: { 'test-spreadsheet-id': ss } })

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        createIfNotExists: false
      })

      expect(() => adapter.findAll()).toThrow("Sheet 'TestSheet' not found")
    })

    it('should cache sheet reference on subsequent calls', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.findAll()
      adapter.findAll()

      // openById should only be called once (cached)
      expect((globalThis as any).SpreadsheetApp.openById).toHaveBeenCalledTimes(1)
    })
  })

  describe('findAll', () => {
    it('should return empty array when sheet has only header', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findAll()

      expect(result).toEqual([])
    })

    it('should return all data rows as objects', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findAll()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: 1, name: 'Alice', age: 30, active: true })
      expect(result[1]).toEqual({ id: 2, name: 'Bob', age: 25, active: false })
    })

    it('should filter out empty rows', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        ['', '', '', ''],
        [3, 'Charlie', 28, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findAll()

      expect(result).toHaveLength(2)
    })

    it('should use data cache on second call', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.findAll()
      adapter.findAll()

      // getRange for data should be called only once (first call fetches, second uses cache)
      const getRangeCalls = (sheet.getRange as any).mock.calls
      const dataFetchCalls = getRangeCalls.filter(
        (args: unknown[]) => args[0] === 2 // row 2 = data start
      )
      expect(dataFetchCalls).toHaveLength(1)
    })

    it('should return copy of cached data (not reference)', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result1 = adapter.findAll()
      const result2 = adapter.findAll()

      expect(result1).not.toBe(result2)
      expect(result1).toEqual(result2)
    })
  })

  describe('findById', () => {
    it('should find row by numeric id', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById(1)

      expect(result).toEqual({ id: 1, name: 'Alice', age: 30, active: true })
    })

    it('should find row by string id', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        ['abc-1', 'Alice', 30, true],
        ['abc-2', 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: string; name: string; age: number; active: boolean }>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })
      const result = adapter.findById('abc-1')

      expect(result?.name).toBe('Alice')
    })

    it('should return undefined for non-existent id', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById(999)

      expect(result).toBeUndefined()
    })

    it('should return undefined when sheet is empty', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById(1)

      expect(result).toBeUndefined()
    })

    it('should support string-number cross-comparison', () => {
      // Sheet stores number 1, we query with string "1"
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById('1' as unknown as number)

      expect(result?.name).toBe('Alice')
    })
  })

  describe('find (query)', () => {
    it('should apply where conditions', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false],
        [3, 'Charlie', 35, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.find({
        where: [{ field: 'active', operator: '=', value: true }],
        orderBy: []
      })

      expect(result).toHaveLength(2)
    })

    it('should apply ordering', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false],
        [3, 'Charlie', 35, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'age', direction: 'desc' }]
      })

      expect(result[0].name).toBe('Charlie')
      expect(result[2].name).toBe('Bob')
    })

    it('should apply offset and limit', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false],
        [3, 'Charlie', 35, true],
        [4, 'Diana', 28, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.find({
        where: [],
        orderBy: [{ field: 'id', direction: 'asc' }],
        offsetValue: 1,
        limitValue: 2
      })

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Bob')
      expect(result[1].name).toBe('Charlie')
    })

    it('should return empty for limit(0)', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.find({
        where: [],
        orderBy: [],
        limitValue: 0
      })

      expect(result).toEqual([])
    })
  })

  describe('insert', () => {
    it('should auto-generate id in auto mode', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.insert({ name: 'Alice', age: 30, active: true })

      expect(result.id).toBe(1)
      expect(result.name).toBe('Alice')
      expect(sheet.appendRow).toHaveBeenCalled()
    })

    it('should increment id based on existing data', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [5, 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.insert({ name: 'Charlie', age: 28, active: true })

      expect(result.id).toBe(6) // max(1,5) + 1
    })

    it('should use client-provided id in client mode', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })
      const result = adapter.insert({ id: 42, name: 'Alice', age: 30, active: true } as TestRow)

      expect(result.id).toBe(42)
    })

    it('should throw in client mode when no id provided', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })

      expect(() => {
        adapter.insert({ name: 'Alice', age: 30, active: true })
      }).toThrow("ID is required in client mode")
    })

    it('should use LockService when available', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet, { withLock: true })

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.insert({ name: 'Alice', age: 30, active: true })

      expect((globalThis as any).LockService.getScriptLock).toHaveBeenCalled()
    })

    it('should invalidate data cache after insert', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)

      // Populate cache
      adapter.findAll()

      // Insert should invalidate cache
      adapter.insert({ name: 'Bob', age: 25, active: false })

      // Next findAll should re-read from sheet (getLastRow called again)
      adapter.findAll()

      // getLastRow called 3 times: first findAll, insert's getSheet, second findAll
      expect((sheet.getLastRow as any).mock.calls.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('concurrency: lock spans ID allocation and write (#80)', () => {
    function setupWithCapturedLock(sheet: FakeSheet) {
      const ss = new FakeSpreadsheet('TestSpreadsheet', [sheet])
      installGasFakes({ spreadsheets: { [SPREADSHEET_ID]: ss }, activeId: SPREADSHEET_ID })

      vi.spyOn(sheet, 'appendRow')
      vi.spyOn(sheet, 'getRange')

      const lock = (globalThis as any).LockService.getScriptLock()
      vi.spyOn(lock, 'waitLock')
      vi.spyOn(lock, 'releaseLock')
      vi.spyOn((globalThis as any).LockService, 'getScriptLock').mockReturnValue(lock)

      return lock
    }

    it('insert (auto mode) releases the lock only AFTER the row is written', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      const lock = setupWithCapturedLock(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.insert({ name: 'Alice', age: 30, active: true })

      expect(lock.waitLock).toHaveBeenCalled()
      expect(lock.releaseLock).toHaveBeenCalled()
      expect(sheet.appendRow).toHaveBeenCalled()

      const acquireOrder = (lock.waitLock as any).mock.invocationCallOrder[0]
      const writeOrder = (sheet.appendRow as any).mock.invocationCallOrder[0]
      const releaseOrder = (lock.releaseLock as any).mock.invocationCallOrder[0]

      // Lock must be held across the write: acquire < write < release
      expect(acquireOrder).toBeLessThan(writeOrder)
      expect(releaseOrder).toBeGreaterThan(writeOrder)
    })

    it('batchInsert (auto mode) releases the lock only AFTER the batch write', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      const lock = setupWithCapturedLock(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.batchInsert([
        { name: 'A', age: 1, active: true },
        { name: 'B', age: 2, active: false }
      ])

      expect(lock.releaseLock).toHaveBeenCalled()

      // The final getRange(...).setValues(...) is the batch write.
      const results = (sheet.getRange as any).mock.results
      const writeRange = results[results.length - 1].value as FakeRange
      expect(writeRange.setValues).toHaveBeenCalled()

      const writeOrder = (writeRange.setValues as any).mock.invocationCallOrder[0]
      const releaseOrder = (lock.releaseLock as any).mock.invocationCallOrder[0]

      // Write must happen before the lock is released.
      expect(releaseOrder).toBeGreaterThan(writeOrder)
    })
  })

  describe('update', () => {
    it('should update existing row', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.update(1, { name: 'Alice Updated', age: 31 })

      expect(result?.name).toBe('Alice Updated')
      expect(result?.age).toBe(31)
      expect(result?.active).toBe(true) // unchanged
    })

    it('should return undefined for non-existent id', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.update(999, { name: 'Ghost' })

      expect(result).toBeUndefined()
    })

    it('should write updated values back to sheet', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.update(1, { name: 'Alice Updated' })

      // Verify setValues was called
      const setValuesCalls = (sheet.getRange as any).mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThan(0)
    })
  })

  describe('delete', () => {
    it('should delete existing row', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.delete(1)

      expect(result).toBe(true)
      expect(sheet.deleteRow).toHaveBeenCalledWith(2) // row 2 (1-indexed, after header)
    })

    it('should return false for non-existent id', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.delete(999)

      expect(result).toBe(false)
    })
  })

  describe('batchInsert', () => {
    it('should return empty array for empty input', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchInsert([])

      expect(result).toEqual([])
    })

    it('should batch insert multiple rows with auto IDs', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchInsert([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false }
      ])

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(1)
      expect(result[1].id).toBe(2)
    })

    it('should batch insert with client-provided IDs', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })
      const result = adapter.batchInsert([
        { id: 10, name: 'Alice', age: 30, active: true } as TestRow,
        { id: 20, name: 'Bob', age: 25, active: false } as TestRow
      ])

      expect(result[0].id).toBe(10)
      expect(result[1].id).toBe(20)
    })

    it('should throw in client mode when id missing', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })

      expect(() => {
        adapter.batchInsert([{ name: 'Alice', age: 30, active: true }])
      }).toThrow("ID is required in client mode")
    })

    it('should write all rows in a single batch setValues call', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.batchInsert([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false }
      ])

      // Should use setValues (batch) rather than appendRow for each
      const setValuesCalls = (sheet.getRange as any).mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThan(0)
    })
  })

  describe('batchUpdate', () => {
    it('should return empty array for empty input', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchUpdate([])

      expect(result).toEqual([])
    })

    it('should update multiple rows', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true],
        [2, 'Bob', 25, false],
        [3, 'Charlie', 35, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchUpdate([
        { id: 1, data: { name: 'Alice Updated' } },
        { id: 3, data: { active: false } }
      ])

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Alice Updated')
      expect(result[1].active).toBe(false)
    })

    it('should handle string ID matching', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        ['abc', 'Alice', 30, true],
        ['def', 'Bob', 25, false]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: string; name: string; age: number; active: boolean }>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })
      const result = adapter.batchUpdate([
        { id: 'abc', data: { name: 'Alice Updated' } }
      ])

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Alice Updated')
    })

    it('should skip non-existent IDs', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchUpdate([
        { id: 1, data: { name: 'Alice Updated' } },
        { id: 999, data: { name: 'Ghost' } }
      ])

      expect(result).toHaveLength(1)
    })

    it('should return empty when sheet has only header', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchUpdate([
        { id: 1, data: { name: 'test' } }
      ])

      expect(result).toEqual([])
    })
  })

  describe('reset', () => {
    it('should clear all data and rewrite header', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.reset()

      expect(sheet.clear).toHaveBeenCalled()
    })

    it('should reset with provided data', () => {
      const sheet = createFakeSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.reset([
        { id: 1, name: 'Alice', age: 30, active: true },
        { id: 2, name: 'Bob', age: 25, active: false }
      ])

      expect(sheet.clear).toHaveBeenCalled()
      // Should write header + data
      const setValuesCalls = (sheet.getRange as any).mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThanOrEqual(2) // header + data
    })
  })

  describe('clearCache', () => {
    it('should clear sheet reference and data cache', () => {
      const sheet = createFakeSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)

      // Populate caches
      adapter.findAll()

      // Clear
      adapter.clearCache()

      // Next call should re-fetch sheet
      adapter.findAll()

      expect((globalThis as any).SpreadsheetApp.openById).toHaveBeenCalledTimes(2)
    })
  })

  describe('getRawData', () => {
    it('should return raw sheet values', () => {
      const rawData = [
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ]
      const sheet = createFakeSheet(rawData)
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.getRawData()

      expect(result).toEqual(rawData)
    })
  })

  describe('rowToObject / objectToRow serialization', () => {
    it('should auto-detect and parse JSON array strings', () => {
      setupSerializationTest([
        ['id', 'tags'],
        [1, '["a","b","c"]']
      ])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags']
      })
      const result = adapter.findAll()

      expect(result[0].tags).toEqual(['a', 'b', 'c'])
    })

    it('should auto-detect and parse JSON object strings', () => {
      setupSerializationTest([
        ['id', 'meta'],
        [1, '{"key":"value"}']
      ])

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta']
      })
      const result = adapter.findAll()

      expect(result[0].meta).toEqual({ key: 'value' })
    })

    it('should keep invalid JSON strings as-is', () => {
      setupSerializationTest([
        ['id', 'data'],
        [1, '[invalid json']
      ])

      const adapter = new SheetsAdapter<{ id: number; data: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'data']
      })
      const result = adapter.findAll()

      expect(result[0].data).toBe('[invalid json')
    })

    it('should convert Date objects to ISO strings', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      setupSerializationTest([
        ['id', 'created'],
        [1, date]
      ])

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created']
      })
      const result = adapter.findAll()

      expect(result[0].created).toBe(date.toISOString())
    })

    it('should serialize arrays to JSON when writing', () => {
      const sheet = setupSerializationTest([['id', 'tags']])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags']
      })
      adapter.insert({ tags: ['a', 'b'] })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('["a","b"]')
    })

    it('should serialize objects to JSON when writing', () => {
      const sheet = setupSerializationTest([['id', 'meta']])

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta']
      })
      adapter.insert({ meta: { key: 'value' } })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('{"key":"value"}')
    })

    it('should convert undefined/null to empty string when writing', () => {
      const sheet = setupSerializationTest([['id', 'name']])

      const adapter = new SheetsAdapter<{ id: number; name: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name']
      })
      adapter.insert({ name: undefined as unknown as string })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('')
    })
  })

  describe('schema-based column types', () => {
    it('should deserialize string[] type', () => {
      setupSerializationTest([
        ['id', 'tags'],
        [1, '["a","b"]']
      ])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      const result = adapter.findAll()
      expect(result[0].tags).toEqual(['a', 'b'])
    })

    it('should return empty array for empty string[] value', () => {
      setupSerializationTest([
        ['id', 'tags'],
        [1, '']
      ])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      const result = adapter.findAll()
      expect(result[0].tags).toEqual([])
    })

    it('should return empty array for invalid JSON in string[] column', () => {
      setupSerializationTest([
        ['id', 'tags'],
        [1, 'not json']
      ])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      const result = adapter.findAll()
      expect(result[0].tags).toEqual([])
    })

    it('should deserialize number[] type', () => {
      setupSerializationTest([
        ['id', 'scores'],
        [1, '[10,20,30]']
      ])

      const adapter = new SheetsAdapter<{ id: number; scores: number[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'scores'],
        columnTypes: { scores: 'number[]' }
      })
      const result = adapter.findAll()
      expect(result[0].scores).toEqual([10, 20, 30])
    })

    it('should deserialize object type', () => {
      setupSerializationTest([
        ['id', 'meta'],
        [1, '{"key":"val"}']
      ])

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'object' }
      })
      const result = adapter.findAll()
      expect(result[0].meta).toEqual({ key: 'val' })
    })

    it('should return null for empty object value', () => {
      setupSerializationTest([
        ['id', 'meta'],
        [1, '']
      ])

      const adapter = new SheetsAdapter<{ id: number; meta: object | null }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'object' }
      })
      const result = adapter.findAll()
      expect(result[0].meta).toBeNull()
    })

    it('should return null for invalid JSON in object column', () => {
      setupSerializationTest([
        ['id', 'meta'],
        [1, 'not json']
      ])

      const adapter = new SheetsAdapter<{ id: number; meta: object | null }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'json' }
      })
      const result = adapter.findAll()
      expect(result[0].meta).toBeNull()
    })

    it('should deserialize boolean type from string', () => {
      setupSerializationTest([
        ['id', 'active'],
        [1, 'TRUE'],
        [2, 'false'],
        [3, '']
      ])

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      const result = adapter.findAll()
      expect(result[0].active).toBe(true)
      expect(result[1].active).toBe(false)
      expect(result[2].active).toBe(false) // empty → false
    })

    it('should deserialize boolean type from non-string', () => {
      setupSerializationTest([
        ['id', 'active'],
        [1, 1],
        [2, 0]
      ])

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      const result = adapter.findAll()
      expect(result[0].active).toBe(true)
      expect(result[1].active).toBe(false)
    })

    it('should deserialize number type', () => {
      setupSerializationTest([
        ['id', 'count'],
        [1, '42'],
        [2, '']
      ])

      const adapter = new SheetsAdapter<{ id: number; count: number }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'count'],
        columnTypes: { count: 'number' }
      })
      const result = adapter.findAll()
      expect(result[0].count).toBe(42)
      expect(result[1].count).toBe(0) // empty → 0
    })

    it('should deserialize date type to a real Date (#97)', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      setupSerializationTest([
        ['id', 'created'],
        [1, date]
      ])

      const adapter = new SheetsAdapter<{ id: number; created: Date }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      const result = adapter.findAll()
      expect(result[0].created).toBeInstanceOf(Date)
      expect((result[0].created as Date).getTime()).toBe(date.getTime())
    })

    it('should parse date-string values for date type into a Date (#97)', () => {
      setupSerializationTest([
        ['id', 'created'],
        [1, '2024-01-15']
      ])

      const adapter = new SheetsAdapter<{ id: number; created: Date }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      const result = adapter.findAll()
      expect(result[0].created).toBeInstanceOf(Date)
      expect((result[0].created as Date).getTime()).toBe(new Date('2024-01-15').getTime())
    })

    it('should pass through already-parsed values for array/object types', () => {
      setupSerializationTest([
        ['id', 'tags'],
        [1, ['a', 'b']] // already an array, not a string
      ])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      const result = adapter.findAll()
      expect(result[0].tags).toEqual(['a', 'b'])
    })

    it('should serialize boolean as TRUE/FALSE', () => {
      const sheet = setupSerializationTest([['id', 'active']])

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      adapter.insert({ active: true })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('TRUE')
    })

    it('should serialize FALSE for falsy boolean', () => {
      const sheet = setupSerializationTest([['id', 'active']])

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      adapter.insert({ active: false })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('FALSE')
    })

    it('should serialize string[] to JSON', () => {
      const sheet = setupSerializationTest([['id', 'tags']])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      adapter.insert({ tags: ['x', 'y'] })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('["x","y"]')
    })

    it('should serialize non-array as empty array string for string[]', () => {
      const sheet = setupSerializationTest([['id', 'tags']])

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      adapter.insert({ tags: 'not-array' as unknown as string[] })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('[]')
    })

    it('should serialize object to JSON', () => {
      const sheet = setupSerializationTest([['id', 'meta']])

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'json' }
      })
      adapter.insert({ meta: { key: 'val' } })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('{"key":"val"}')
    })

    it('should serialize non-object as empty string for object type', () => {
      const sheet = setupSerializationTest([['id', 'meta']])

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'object' }
      })
      adapter.insert({ meta: 'not-object' as unknown as object })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('')
    })

    it('should serialize Date for date type', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      const sheet = setupSerializationTest([['id', 'created']])

      const adapter = new SheetsAdapter<{ id: number; created: Date }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      adapter.insert({ created: date })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe(date.toISOString())
    })

    it('should pass through string value for date type', () => {
      const sheet = setupSerializationTest([['id', 'created']])

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      adapter.insert({ created: '2024-01-15' })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('2024-01-15')
    })

    it('should pass through default type values', () => {
      const sheet = setupSerializationTest([['id', 'name']])

      const adapter = new SheetsAdapter<{ id: number; name: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name'],
        columnTypes: { name: 'string' }
      })
      adapter.insert({ name: 'hello' })

      const appendCall = (sheet.appendRow as any).mock.calls[0][0]
      expect(appendCall[1]).toBe('hello')
    })

    it('should return empty value for an empty cell with string type', () => {
      // A real Sheets cell (and FakeSheet.getValues()) can never hold JS
      // `null` — only `''` for empty. The original stub-based test injected
      // raw `null` directly, bypassing objectToRow's own null→'' coercion,
      // to exercise deserializeByType's defensive `value === null` branch;
      // that scenario is unreachable through the fake (or real GAS), so this
      // asserts the actually-reachable empty-cell path instead.
      setupSerializationTest([
        ['id', 'name'],
        [1, '']
      ])

      const adapter = new SheetsAdapter<{ id: number; name: string | null }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name'],
        columnTypes: { name: 'string' }
      })
      const result = adapter.findAll()
      expect(result[0].name).toBe('')
    })
  })
})
