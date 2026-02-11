/**
 * SheetsAdapter unit tests with GAS API stubs
 *
 * Since SheetsAdapter depends on Google Apps Script APIs (SpreadsheetApp,
 * LockService) which are unavailable in Node.js, we stub them to test
 * all adapter logic in isolation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SheetsAdapter } from '../../src/adapters/sheets-adapter'
import type { SheetsAdapterOptions } from '../../src/adapters/sheets-adapter'

// ---------------------------------------------------------------------------
// GAS API Stubs
// ---------------------------------------------------------------------------

interface StubRange {
  getValues: ReturnType<typeof vi.fn>
  setValues: ReturnType<typeof vi.fn>
}

interface StubSheet {
  getLastRow: ReturnType<typeof vi.fn>
  getRange: ReturnType<typeof vi.fn>
  appendRow: ReturnType<typeof vi.fn>
  deleteRow: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  getDataRange: ReturnType<typeof vi.fn>
}

function createStubRange(values: unknown[][] = [[]]): StubRange {
  return {
    getValues: vi.fn(() => values),
    setValues: vi.fn()
  }
}

function createStubSheet(data: unknown[][] = []): StubSheet {
  // data[0] = header row, data[1..] = data rows
  const allData = data
  let lastRow = allData.length

  const sheet: StubSheet = {
    getLastRow: vi.fn(() => lastRow),
    getRange: vi.fn((row: number, col: number, numRows?: number, numCols?: number) => {
      if (numRows !== undefined) {
        const sliced = allData.slice(row - 1, row - 1 + numRows)
        // If requesting a subset of columns, extract only those columns
        const cols = numCols ?? sliced[0]?.length ?? 0
        const result = sliced.map(r => r.slice(col - 1, col - 1 + cols))
        return createStubRange(result)
      }
      return createStubRange([allData[row - 1] || []])
    }),
    appendRow: vi.fn((values: unknown[]) => {
      allData.push(values)
      lastRow = allData.length
    }),
    deleteRow: vi.fn((rowIndex: number) => {
      allData.splice(rowIndex - 1, 1)
      lastRow = allData.length
    }),
    clear: vi.fn(() => {
      allData.length = 0
      lastRow = 0
    }),
    getDataRange: vi.fn(() => createStubRange(allData))
  }

  return sheet
}

function setupGASGlobals(sheet: StubSheet, opts: { withLock?: boolean } = {}) {
  const ss = {
    getSheetByName: vi.fn(() => sheet),
    insertSheet: vi.fn(() => sheet)
  }

  ;(globalThis as Record<string, unknown>).SpreadsheetApp = {
    openById: vi.fn(() => ss),
    getActiveSpreadsheet: vi.fn(() => ss)
  }

  if (opts.withLock) {
    const lock = {
      waitLock: vi.fn(),
      releaseLock: vi.fn()
    }
    ;(globalThis as Record<string, unknown>).LockService = {
      getScriptLock: vi.fn(() => lock)
    }
  } else {
    delete (globalThis as Record<string, unknown>).LockService
  }
}

function teardownGASGlobals() {
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
  afterEach(() => {
    teardownGASGlobals()
  })

  describe('constructor', () => {
    it('should create adapter with valid options', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name']])
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
      const sheet = createStubSheet([['uid', 'name']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.findAll()

      expect((globalThis as any).SpreadsheetApp.openById).toHaveBeenCalledWith('test-spreadsheet-id')
    })

    it('should use getActiveSpreadsheet when no spreadsheetId', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        sheetName: 'Test',
        columns: ['id', 'name', 'age', 'active']
      })
      adapter.findAll()

      expect((globalThis as any).SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled()
    })

    it('should create sheet if createIfNotExists and sheet not found', () => {
      const newSheet = createStubSheet([])
      const ss = {
        getSheetByName: vi.fn(() => null),
        insertSheet: vi.fn(() => newSheet)
      }
      ;(globalThis as any).SpreadsheetApp = {
        openById: vi.fn(() => ss)
      }

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        createIfNotExists: true
      })
      adapter.findAll()

      expect(ss.insertSheet).toHaveBeenCalledWith('TestSheet')
      // Should write header row
      expect(newSheet.getRange).toHaveBeenCalledWith(1, 1, 1, 4)
    })

    it('should throw when sheet not found and createIfNotExists is false', () => {
      const ss = {
        getSheetByName: vi.fn(() => null),
        insertSheet: vi.fn()
      }
      ;(globalThis as any).SpreadsheetApp = {
        openById: vi.fn(() => ss)
      }

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        createIfNotExists: false
      })

      expect(() => adapter.findAll()).toThrow("Sheet 'TestSheet' not found")
    })

    it('should cache sheet reference on subsequent calls', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findAll()

      expect(result).toEqual([])
    })

    it('should return all data rows as objects', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.findAll()
      adapter.findAll()

      // getRange for data should be called only once (first call fetches, second uses cache)
      // getLastRow is called for both the getSheet check and findAll check
      // but data range fetch should only happen once
      const getRangeCalls = sheet.getRange.mock.calls
      const dataFetchCalls = getRangeCalls.filter(
        (args: unknown[]) => args[0] === 2 // row 2 = data start
      )
      expect(dataFetchCalls).toHaveLength(1)
    })

    it('should return copy of cached data (not reference)', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById(999)

      expect(result).toBeUndefined()
    })

    it('should return undefined when sheet is empty', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.findById(1)

      expect(result).toBeUndefined()
    })

    it('should support string-number cross-comparison', () => {
      // Sheet stores number 1, we query with string "1"
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.insert({ name: 'Alice', age: 30, active: true })

      expect(result.id).toBe(1)
      expect(result.name).toBe('Alice')
      expect(sheet.appendRow).toHaveBeenCalled()
    })

    it('should increment id based on existing data', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>({
        ...DEFAULT_OPTIONS,
        idMode: 'client'
      })
      const result = adapter.insert({ id: 42, name: 'Alice', age: 30, active: true } as TestRow)

      expect(result.id).toBe(42)
    })

    it('should throw in client mode when no id provided', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet, { withLock: true })

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.insert({ name: 'Alice', age: 30, active: true })

      expect((globalThis as any).LockService.getScriptLock).toHaveBeenCalled()
    })

    it('should invalidate data cache after insert', () => {
      const sheet = createStubSheet([
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
      expect(sheet.getLastRow.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('update', () => {
    it('should update existing row', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.update(999, { name: 'Ghost' })

      expect(result).toBeUndefined()
    })

    it('should write updated values back to sheet', () => {
      const sheet = createStubSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.update(1, { name: 'Alice Updated' })

      // Verify setValues was called
      const setValuesCalls = sheet.getRange.mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThan(0)
    })
  })

  describe('delete', () => {
    it('should delete existing row', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchInsert([])

      expect(result).toEqual([])
    })

    it('should batch insert multiple rows with auto IDs', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.batchInsert([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false }
      ])

      // Should use setValues (batch) rather than appendRow for each
      const setValuesCalls = sheet.getRange.mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThan(0)
    })
  })

  describe('batchUpdate', () => {
    it('should return empty array for empty input', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.batchUpdate([])

      expect(result).toEqual([])
    })

    it('should update multiple rows', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([
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
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
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
      const sheet = createStubSheet([
        ['id', 'name', 'age', 'active'],
        [1, 'Alice', 30, true]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.reset()

      expect(sheet.clear).toHaveBeenCalled()
    })

    it('should reset with provided data', () => {
      const sheet = createStubSheet([['id', 'name', 'age', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      adapter.reset([
        { id: 1, name: 'Alice', age: 30, active: true },
        { id: 2, name: 'Bob', age: 25, active: false }
      ])

      expect(sheet.clear).toHaveBeenCalled()
      // Should write header + data
      const setValuesCalls = sheet.getRange.mock.results
        .map((r: any) => r.value)
        .filter((r: any) => r.setValues?.mock?.calls?.length > 0)
      expect(setValuesCalls.length).toBeGreaterThanOrEqual(2) // header + data
    })
  })

  describe('clearCache', () => {
    it('should clear sheet reference and data cache', () => {
      const sheet = createStubSheet([
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
      const sheet = createStubSheet(rawData)
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<TestRow>(DEFAULT_OPTIONS)
      const result = adapter.getRawData()

      expect(result).toEqual(rawData)
    })
  })

  describe('rowToObject / objectToRow serialization', () => {
    it('should auto-detect and parse JSON array strings', () => {
      const sheet = createStubSheet([
        ['id', 'tags'],
        [1, '["a","b","c"]']
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags']
      })
      const result = adapter.findAll()

      expect(result[0].tags).toEqual(['a', 'b', 'c'])
    })

    it('should auto-detect and parse JSON object strings', () => {
      const sheet = createStubSheet([
        ['id', 'meta'],
        [1, '{"key":"value"}']
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta']
      })
      const result = adapter.findAll()

      expect(result[0].meta).toEqual({ key: 'value' })
    })

    it('should keep invalid JSON strings as-is', () => {
      const sheet = createStubSheet([
        ['id', 'data'],
        [1, '[invalid json']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'created'],
        [1, date]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created']
      })
      const result = adapter.findAll()

      expect(result[0].created).toBe(date.toISOString())
    })

    it('should serialize arrays to JSON when writing', () => {
      const sheet = createStubSheet([['id', 'tags']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags']
      })
      adapter.insert({ tags: ['a', 'b'] })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('["a","b"]')
    })

    it('should serialize objects to JSON when writing', () => {
      const sheet = createStubSheet([['id', 'meta']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta']
      })
      adapter.insert({ meta: { key: 'value' } })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('{"key":"value"}')
    })

    it('should convert undefined/null to empty string when writing', () => {
      const sheet = createStubSheet([['id', 'name']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; name: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name']
      })
      adapter.insert({ name: undefined as unknown as string })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('')
    })
  })

  describe('schema-based column types', () => {
    it('should deserialize string[] type', () => {
      const sheet = createStubSheet([
        ['id', 'tags'],
        [1, '["a","b"]']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'tags'],
        [1, '']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'tags'],
        [1, 'not json']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'scores'],
        [1, '[10,20,30]']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'meta'],
        [1, '{"key":"val"}']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'meta'],
        [1, '']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'meta'],
        [1, 'not json']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'active'],
        [1, 'TRUE'],
        [2, 'false'],
        [3, '']
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'active'],
        [1, 1],
        [2, 0]
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([
        ['id', 'count'],
        [1, '42'],
        [2, '']
      ])
      setupGASGlobals(sheet)

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

    it('should handle date type', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      const sheet = createStubSheet([
        ['id', 'created'],
        [1, date]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      const result = adapter.findAll()
      expect(result[0].created).toBe(date.toISOString())
    })

    it('should pass through non-Date values for date type', () => {
      const sheet = createStubSheet([
        ['id', 'created'],
        [1, '2024-01-15']
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      const result = adapter.findAll()
      expect(result[0].created).toBe('2024-01-15')
    })

    it('should pass through already-parsed values for array/object types', () => {
      const sheet = createStubSheet([
        ['id', 'tags'],
        [1, ['a', 'b']] // already an array, not a string
      ])
      setupGASGlobals(sheet)

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
      const sheet = createStubSheet([['id', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      adapter.insert({ active: true })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('TRUE')
    })

    it('should serialize FALSE for falsy boolean', () => {
      const sheet = createStubSheet([['id', 'active']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; active: boolean }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'active'],
        columnTypes: { active: 'boolean' }
      })
      adapter.insert({ active: false })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('FALSE')
    })

    it('should serialize string[] to JSON', () => {
      const sheet = createStubSheet([['id', 'tags']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      adapter.insert({ tags: ['x', 'y'] })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('["x","y"]')
    })

    it('should serialize non-array as empty array string for string[]', () => {
      const sheet = createStubSheet([['id', 'tags']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; tags: string[] }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'tags'],
        columnTypes: { tags: 'string[]' }
      })
      adapter.insert({ tags: 'not-array' as unknown as string[] })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('[]')
    })

    it('should serialize object to JSON', () => {
      const sheet = createStubSheet([['id', 'meta']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'json' }
      })
      adapter.insert({ meta: { key: 'val' } })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('{"key":"val"}')
    })

    it('should serialize non-object as empty string for object type', () => {
      const sheet = createStubSheet([['id', 'meta']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; meta: object }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'meta'],
        columnTypes: { meta: 'object' }
      })
      adapter.insert({ meta: 'not-object' as unknown as object })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('')
    })

    it('should serialize Date for date type', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      const sheet = createStubSheet([['id', 'created']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; created: Date }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      adapter.insert({ created: date })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe(date.toISOString())
    })

    it('should pass through string value for date type', () => {
      const sheet = createStubSheet([['id', 'created']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; created: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'created'],
        columnTypes: { created: 'date' }
      })
      adapter.insert({ created: '2024-01-15' })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('2024-01-15')
    })

    it('should pass through default type values', () => {
      const sheet = createStubSheet([['id', 'name']])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; name: string }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name'],
        columnTypes: { name: 'string' }
      })
      adapter.insert({ name: 'hello' })

      const appendCall = sheet.appendRow.mock.calls[0][0]
      expect(appendCall[1]).toBe('hello')
    })

    it('should return empty value for null/undefined with string type', () => {
      const sheet = createStubSheet([
        ['id', 'name'],
        [1, null]
      ])
      setupGASGlobals(sheet)

      const adapter = new SheetsAdapter<{ id: number; name: string | null }>({
        spreadsheetId: 'test',
        sheetName: 'Test',
        columns: ['id', 'name'],
        columnTypes: { name: 'string' }
      })
      const result = adapter.findAll()
      expect(result[0].name).toBeNull()
    })
  })
})
