/**
 * SheetsAdapter - Real Google Sheets DataStore implementation
 * Uses Google Apps Script SpreadsheetApp API
 */
import type { RowWithId, DataStore, QueryOptions, BatchUpdateItem, IdMode } from '../core/types'
import { evaluateCondition, compareRows } from '../core/query-utils'

/** Column type definition for schema-based serialization */
export type ColumnType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'date' 
  | 'string[]' 
  | 'number[]' 
  | 'object' 
  | 'json'

/** SheetsAdapter configuration options */
export interface SheetsAdapterOptions {
  /** Spreadsheet ID (optional - uses active spreadsheet if not provided) */
  spreadsheetId?: string
  /** Sheet name */
  sheetName: string
  /** Column names in order (first column should be 'id') */
  columns: string[]
  /** Whether to create sheet if it doesn't exist (default: true) */
  createIfNotExists?: boolean
  /** ID column name (default: 'id') */
  idColumn?: string
  /** 
   * ID generation mode (default: 'auto')
   * - 'auto': server generates numeric IDs (default, backward compatible)
   * - 'client': client provides IDs (UUID, string, etc.)
   */
  idMode?: IdMode
  /**
   * Column type definitions for schema-based serialization (optional)
   * If provided, enables type-aware serialization/deserialization
   * Example: { labels: 'string[]', metadata: 'object' }
   */
  columnTypes?: Record<string, ColumnType>
}


/**
 * Google Sheets DataStore implementation
 * Provides CRUD operations on a single sheet
 */
export class SheetsAdapter<T extends RowWithId> implements DataStore<T> {
  private spreadsheetId?: string
  private sheetName: string
  private columns: string[]
  private idColumn: string
  private createIfNotExists: boolean
  private idMode: IdMode
  private columnTypes: Record<string, ColumnType>

  // Sheet reference cache
  private _sheet: GoogleAppsScript.Spreadsheet.Sheet | null = null
  private _spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null
  // Data cache - invalidated on write operations
  private _dataCache: T[] | null = null

  constructor(options: SheetsAdapterOptions) {
    this.spreadsheetId = options.spreadsheetId
    this.sheetName = options.sheetName
    this.columns = options.columns
    this.idColumn = options.idColumn || 'id'
    this.createIfNotExists = options.createIfNotExists ?? true
    this.idMode = options.idMode ?? 'auto'
    this.columnTypes = options.columnTypes ?? {}
    
    // Validate that id column is in columns
    if (!this.columns.includes(this.idColumn)) {
      throw new Error(`ID column '${this.idColumn}' must be included in columns`)
    }
  }

  /** Get the spreadsheet instance */
  private getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    if (!this._spreadsheet) {
      const ss = this.spreadsheetId
        ? SpreadsheetApp.openById(this.spreadsheetId)
        : SpreadsheetApp.getActiveSpreadsheet()
      if (!ss) {
        throw new Error(
          `No spreadsheet available for sheet '${this.sheetName}'. ` +
          'Bind this script to a Sheet, or pass spreadsheetId to SheetsAdapter, ' +
          'or set Script Property SPREADSHEET_ID.'
        )
      }
      this._spreadsheet = ss
    }
    return this._spreadsheet
  }

  /** Get the sheet instance, creating if necessary */
  private getSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    if (!this._sheet) {
      const ss = this.getSpreadsheet()
      let sheet = ss.getSheetByName(this.sheetName)
      
      if (!sheet) {
        if (this.createIfNotExists) {
          sheet = ss.insertSheet(this.sheetName)
          // Write header row
          sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns])
        } else {
          throw new Error(`Sheet '${this.sheetName}' not found`)
        }
      }
      
      this._sheet = sheet
    }
    return this._sheet
  }

  /** Clear all caches (sheet references and data) */
  clearCache(): void {
    this._sheet = null
    this._spreadsheet = null
    this._dataCache = null
  }

  /** Invalidate data cache (called after write operations) */
  private invalidateDataCache(): void {
    this._dataCache = null
  }

  /** 
   * Convert sheet row (array) to object
   * Uses schema-based types if available, falls back to auto-detection
   */
  private rowToObject(values: unknown[]): T {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]
      let value = values[i]
      const colType = this.columnTypes[col]
      
      // Convert Date objects to ISO strings for consistency
      if (value instanceof Date) {
        value = value.toISOString()
      }
      
      // Schema-based deserialization
      if (colType) {
        value = this.deserializeByType(value, colType)
      } else {
        // Auto-detect: try to parse JSON strings (arrays and objects)
        if (typeof value === 'string' && value.length > 0) {
          const trimmed = value.trim()
          if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
              (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
              value = JSON.parse(trimmed)
            } catch {
              // Keep as string if parsing fails
            }
          }
        }
      }
      
      obj[col] = value
    }
    return obj as T
  }

  /** Deserialize value based on column type */
  private deserializeByType(value: unknown, colType: ColumnType): unknown {
    if (value === '' || value === null || value === undefined) {
      // Return appropriate empty value for type
      if (colType === 'string[]' || colType === 'number[]') return []
      if (colType === 'object' || colType === 'json') return null
      if (colType === 'boolean') return false
      if (colType === 'number') return 0
      return value
    }

    switch (colType) {
      case 'string[]':
      case 'number[]':
      case 'object':
      case 'json':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return colType.endsWith('[]') ? [] : null
          }
        }
        return value
      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true'
        }
        return Boolean(value)
      case 'number':
        return Number(value)
      case 'date': {
        // Date columns deserialize to a real Date so the runtime value matches
        // the generated `Date` type (#97). rowToObject may have pre-converted a
        // GAS Date to an ISO string, so parse strings/numbers back to a Date.
        if (value instanceof Date) return value
        if (typeof value === 'string' || typeof value === 'number') {
          const parsed = new Date(value)
          if (!isNaN(parsed.getTime())) return parsed
        }
        return value
      }
      default:
        return value
    }
  }

  /**
   * Convert object to sheet row (array)
   * Uses schema-based types if available, falls back to auto-detection
   */
  private objectToRow(obj: Partial<T>): unknown[] {
    return this.columns.map(col => {
      const value = obj[col as keyof T]
      const colType = this.columnTypes[col]
      
      // Convert undefined/null to empty string for Sheets
      if (value === undefined || value === null) return ''
      
      // Schema-based serialization
      if (colType) {
        return this.serializeByType(value, colType)
      }
      
      // Auto-detect: serialize arrays and objects to JSON
      if (Array.isArray(value)) return JSON.stringify(value)
      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        return JSON.stringify(value)
      }
      return value
    })
  }

  /** Serialize value based on column type */
  private serializeByType(value: unknown, colType: ColumnType): unknown {
    switch (colType) {
      case 'string[]':
      case 'number[]':
        if (Array.isArray(value)) return JSON.stringify(value)
        return '[]'
      case 'object':
      case 'json':
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value)
        }
        return ''
      case 'boolean':
        return value ? 'TRUE' : 'FALSE'
      case 'date':
        if (value instanceof Date) return value.toISOString()
        return value
      default:
        return value
    }
  }

  /**
   * Run a function while holding the script lock (when LockService is available).
   * The lock is held for the entire duration of fn so that read-allocate-write
   * sequences stay atomic across concurrent executions.
   */
  private withLock<R>(fn: () => R): R {
    let lock: GoogleAppsScript.Lock.Lock | null = null
    try {
      if (typeof LockService !== 'undefined') {
        lock = LockService.getScriptLock()
        lock.waitLock(10000)
      }
      return fn()
    } finally {
      if (lock) {
        lock.releaseLock()
      }
    }
  }

  /**
   * Get the next available ID by scanning the current max.
   * Must be called inside withLock() together with the row write so that
   * ID allocation and the write are atomic.
   */
  private getNextId(): number {
    return this.readMaxId() + 1
  }

  /** Read the current max ID from the sheet */
  private readMaxId(): number {
    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()

    if (lastRow <= 1) return 0

    const idColIndex = this.columns.indexOf(this.idColumn) + 1
    const idRange = sheet.getRange(2, idColIndex, lastRow - 1, 1)
    const ids = idRange.getValues().flat().filter(id => typeof id === 'number' && !isNaN(id))

    if (ids.length === 0) return 0
    return Math.max(...ids as number[])
  }

  /** Find row index by ID (1-indexed, returns -1 if not found) */
  private findRowIndexById(id: string | number): number {
    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()
    
    if (lastRow <= 1) return -1
    
    const idColIndex = this.columns.indexOf(this.idColumn) + 1
    const idRange = sheet.getRange(2, idColIndex, lastRow - 1, 1)
    const ids = idRange.getValues().flat()
    
    // Support both string and number comparison
    const rowOffset = ids.findIndex(rowId => rowId === id || String(rowId) === String(id))
    return rowOffset === -1 ? -1 : rowOffset + 2 // +2 for header row and 1-indexing
  }

  findAll(): T[] {
    if (this._dataCache !== null) {
      return [...this._dataCache]
    }

    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()

    if (lastRow <= 1) {
      this._dataCache = []
      return []
    }

    const dataRange = sheet.getRange(2, 1, lastRow - 1, this.columns.length)
    const values = dataRange.getValues()

    this._dataCache = values
      .filter(row => row.some(cell => cell !== ''))
      .map(row => this.rowToObject(row))

    return [...this._dataCache]
  }

  findById(id: string | number): T | undefined {
    const rowIndex = this.findRowIndexById(id)
    if (rowIndex === -1) return undefined
    
    const sheet = this.getSheet()
    const values = sheet.getRange(rowIndex, 1, 1, this.columns.length).getValues()[0]
    return this.rowToObject(values)
  }

  find(options: QueryOptions<T>): T[] {
    // Get all data first (GAS doesn't support SQL-like queries)
    let result = this.findAll()
    
    // Apply where conditions
    if (options.where.length > 0) {
      result = result.filter(row =>
        options.where.every(condition => evaluateCondition(row, condition))
      )
    }
    
    // Apply ordering
    if (options.orderBy.length > 0) {
      result.sort((a, b) => compareRows(a, b, options.orderBy))
    }
    
    // Apply offset
    if (options.offsetValue !== undefined && options.offsetValue > 0) {
      result = result.slice(options.offsetValue)
    }
    
    // Apply limit
    if (options.limitValue !== undefined && options.limitValue >= 0) {
      result = result.slice(0, options.limitValue)
    }
    
    return result
  }

  insert(data: Omit<T, 'id'> | T): T {
    this.invalidateDataCache()
    const sheet = this.getSheet()

    if (this.idMode === 'client') {
      // Client mode: use client-provided ID
      if (!(this.idColumn in (data as Record<string, unknown>))) {
        throw new Error(`ID is required in client mode (idMode: 'client')`)
      }
      const newRow = data as T
      const rowValues = this.objectToRow(newRow)
      sheet.appendRow(rowValues)
      return newRow
    } else {
      // Auto mode: allocate the ID and write the row atomically under the lock,
      // otherwise concurrent executions can allocate the same ID.
      return this.withLock(() => {
        const id = this.getNextId()
        const newRow = { ...data, [this.idColumn]: id } as T
        const rowValues = this.objectToRow(newRow)
        sheet.appendRow(rowValues)
        return newRow
      })
    }
  }

  update(id: string | number, data: Partial<T>): T | undefined {
    const rowIndex = this.findRowIndexById(id)
    if (rowIndex === -1) return undefined

    this.invalidateDataCache()
    const sheet = this.getSheet()
    const currentValues = sheet.getRange(rowIndex, 1, 1, this.columns.length).getValues()[0]
    const currentRow = this.rowToObject(currentValues)
    
    const updatedRow = { ...currentRow, ...data } as T
    const rowValues = this.objectToRow(updatedRow)
    
    sheet.getRange(rowIndex, 1, 1, this.columns.length).setValues([rowValues])
    
    return updatedRow
  }

  delete(id: string | number): boolean {
    const rowIndex = this.findRowIndexById(id)
    if (rowIndex === -1) return false

    this.invalidateDataCache()
    const sheet = this.getSheet()
    sheet.deleteRow(rowIndex)

    return true
  }

  batchInsert(items: (Omit<T, 'id'> | T)[]): T[] {
    if (items.length === 0) return []

    this.invalidateDataCache()
    const sheet = this.getSheet()

    // Batch write all rows at once, appending after the current last row.
    const writeRows = (rows: unknown[][]) => {
      const lastRow = sheet.getLastRow()
      sheet.getRange(lastRow + 1, 1, rows.length, this.columns.length)
        .setValues(rows)
    }

    if (this.idMode === 'client') {
      // Client mode: use client-provided IDs (no server-side allocation)
      const results: T[] = []
      const rowsToInsert: unknown[][] = []
      for (const data of items) {
        if (!(this.idColumn in (data as Record<string, unknown>))) {
          throw new Error(`ID is required in client mode (idMode: 'client')`)
        }
        const newRow = data as T
        results.push(newRow)
        rowsToInsert.push(this.objectToRow(newRow))
      }
      writeRows(rowsToInsert)
      return results
    }

    // Auto mode: allocate IDs (incl. the getLastRow used for the write
    // position) and write atomically under the lock to avoid duplicate IDs.
    return this.withLock(() => {
      const results: T[] = []
      const rowsToInsert: unknown[][] = []
      let nextId = this.getNextId()
      for (const data of items) {
        const newRow = { ...data, [this.idColumn]: nextId } as T
        results.push(newRow)
        rowsToInsert.push(this.objectToRow(newRow))
        nextId++
      }
      writeRows(rowsToInsert)
      return results
    })
  }

  batchUpdate(items: BatchUpdateItem<T>[]): T[] {
    if (items.length === 0) return []

    this.invalidateDataCache()
    const results: T[] = []
    const sheet = this.getSheet()
    
    // Build a map of id -> data for batch processing
    const updateMap = new Map<string | number, Partial<Omit<T, 'id'>>>()
    for (const { id, data } of items) {
      updateMap.set(id, data)
    }

    // Get all data to find rows to update
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return results

    const allData = sheet.getRange(2, 1, lastRow - 1, this.columns.length).getValues()
    const idColIndex = this.columns.indexOf(this.idColumn)

    const updatedRows: { rowIndex: number; values: unknown[] }[] = []

    for (let i = 0; i < allData.length; i++) {
      const rowId = allData[i][idColIndex] as string | number
      const updateData = updateMap.get(rowId) ?? updateMap.get(String(rowId))
      
      if (updateData) {
        const currentRow = this.rowToObject(allData[i])
        const updatedRow = { ...currentRow, ...updateData } as T
        results.push(updatedRow)
        updatedRows.push({
          rowIndex: i + 2, // +2 for header and 1-indexing
          values: this.objectToRow(updatedRow)
        })
      }
    }
    
    // Write all updates (could optimize with batch ranges if rows are contiguous)
    for (const { rowIndex, values } of updatedRows) {
      sheet.getRange(rowIndex, 1, 1, this.columns.length).setValues([values])
    }
    
    return results
  }

  reset(data: T[] = []): void {
    this.invalidateDataCache()
    const sheet = this.getSheet()
    
    // Clear all data except header
    sheet.clear()
    
    // Write header
    sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns])
    
    // Write data
    if (data.length > 0) {
      const rows = data.map(row => this.objectToRow(row))
      sheet.getRange(2, 1, rows.length, this.columns.length).setValues(rows)
    }
  }

  /** Get raw sheet data (for debugging) */
  getRawData(): unknown[][] {
    const sheet = this.getSheet()
    return sheet.getDataRange().getValues()
  }
}
