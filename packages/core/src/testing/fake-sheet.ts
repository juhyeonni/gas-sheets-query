/**
 * FakeSheet — offline, deterministic simulation of a single Google Sheets
 * tab, backed by an in-memory grid. Implements GAS-parity semantics for the
 * allowlisted method surface only; unimplemented GAS methods do not exist
 * on this class (fail loudly rather than silently no-op).
 */

/** A rectangular view over part of a {@link FakeSheet}'s grid, mirroring GAS `Range`. */
export class FakeRange {
  constructor(
    private readonly readValues: () => unknown[][],
    private readonly writeValues: (values: unknown[][]) => void,
    private readonly numRows: number,
    private readonly numCols: number
  ) {}

  /** Reads the range. Cells beyond sheet content are padded with `''`. */
  getValues(): unknown[][] {
    return this.readValues()
  }

  /**
   * Writes the range. Throws if `values` doesn't match the range's
   * dimensions (GAS parity); grows the underlying grid when the range
   * extends beyond current bounds.
   */
  setValues(values: unknown[][]): void {
    const rowsMatch = values.length === this.numRows
    const colsMatch = values.every(row => row.length === this.numCols)
    if (!rowsMatch || !colsMatch) {
      throw new Error(
        `setValues: dimension mismatch — range is ${this.numRows}x${this.numCols}, ` +
        `values are ${values.length}x${values[0]?.length ?? 0}`
      )
    }
    this.writeValues(values)
  }
}

/** One sheet tab as a mutable rectangular grid. */
export class FakeSheet {
  private grid: unknown[][] = []
  private frozenRows = 0

  constructor(private readonly name: string) {}

  getName(): string {
    return this.name
  }

  /** 1-indexed, GAS-parity coordinates. `numRows`/`numCols` default to 1. */
  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error(
        `getRange: coordinates must be >= 1 (got row=${row}, col=${col}, numRows=${numRows}, numCols=${numCols})`
      )
    }
    return new FakeRange(
      () => this.readRange(row, col, numRows, numCols),
      values => this.writeRange(row, col, values),
      numRows,
      numCols
    )
  }

  /** Last row with content in any column, or 0 for an empty sheet. */
  getLastRow(): number {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      if (this.grid[r].some(cell => !isBlank(cell))) return r + 1
    }
    return 0
  }

  /** Last column with content in any row (trailing-empty-column safe — #86 class). */
  getLastColumn(): number {
    let last = 0
    for (const row of this.grid) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (!isBlank(row[c])) {
          if (c + 1 > last) last = c + 1
          break
        }
      }
    }
    return last
  }

  /** `getRange(1, 1, max(getLastRow(),1), max(getLastColumn(),1))` — a 1x1 A1 range on an empty sheet. */
  getDataRange(): FakeRange {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1))
  }

  /** Appends a row after the current last row. Stored as-is (not padded); reads pad to rectangular. */
  appendRow(values: unknown[]): void {
    this.grid.push([...values])
  }

  /** Deletes a row, shifting subsequent rows up. Throws if out of bounds (GAS parity). */
  deleteRow(rowIndex: number): void {
    if (rowIndex < 1 || rowIndex > this.grid.length) {
      throw new Error(`deleteRow: row ${rowIndex} is out of bounds (sheet has ${this.grid.length} rows)`)
    }
    this.grid.splice(rowIndex - 1, 1)
  }

  /**
   * Inserts a blank column before `columnIndex` (1-indexed), shifting cells at
   * and after that position one column right. Rows whose content ends before
   * the position are left as-is (they read as blank there either way).
   */
  insertColumnBefore(columnIndex: number): void {
    if (columnIndex < 1) {
      throw new Error(`insertColumnBefore: column index must be >= 1 (got ${columnIndex})`)
    }
    for (const row of this.grid) {
      if (row.length >= columnIndex) {
        row.splice(columnIndex - 1, 0, '')
      }
    }
  }

  /**
   * Deletes the column at `columnIndex` (1-indexed), shifting cells after that
   * position one column left — values included, which is what makes it the
   * physical counterpart of {@link insertColumnBefore} (#180). Rows whose
   * content ends before the position are left as-is (they read as blank there
   * either way).
   */
  deleteColumn(columnIndex: number): void {
    if (columnIndex < 1) {
      throw new Error(`deleteColumn: column index must be >= 1 (got ${columnIndex})`)
    }
    for (const row of this.grid) {
      if (row.length >= columnIndex) {
        row.splice(columnIndex - 1, 1)
      }
    }
  }

  /** Empties the grid and resets frozen-row state. */
  clear(): void {
    this.grid = []
    this.frozenRows = 0
  }

  /** Empties the grid, leaving frozen-row state untouched. */
  clearContents(): void {
    this.grid = []
  }

  /** State only — no behavioral effect on read/write. */
  setFrozenRows(rows: number): void {
    this.frozenRows = rows
  }

  getFrozenRows(): number {
    return this.frozenRows
  }

  private readRange(row: number, col: number, numRows: number, numCols: number): unknown[][] {
    const result: unknown[][] = []
    for (let r = 0; r < numRows; r++) {
      const srcRow = this.grid[row - 1 + r]
      const outRow: unknown[] = []
      for (let c = 0; c < numCols; c++) {
        outRow.push(normalizeCell(srcRow?.[col - 1 + c]))
      }
      result.push(outRow)
    }
    return result
  }

  private writeRange(row: number, col: number, values: unknown[][]): void {
    const lastRowIndex = row - 1 + values.length - 1
    while (this.grid.length <= lastRowIndex) {
      this.grid.push([])
    }
    for (let r = 0; r < values.length; r++) {
      const targetRow = this.grid[row - 1 + r]
      const lastColIndex = col - 1 + values[r].length - 1
      while (targetRow.length <= lastColIndex) {
        targetRow.push('')
      }
      for (let c = 0; c < values[r].length; c++) {
        targetRow[col - 1 + c] = values[r][c]
      }
    }
  }
}

function isBlank(cell: unknown): boolean {
  return cell === '' || cell === undefined || cell === null
}

function normalizeCell(cell: unknown): unknown {
  return isBlank(cell) ? '' : cell
}
