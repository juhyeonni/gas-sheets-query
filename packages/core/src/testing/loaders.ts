/**
 * Snapshot loaders — build fake spreadsheets/sheets from plain arrays,
 * RFC 4180 CSV, or a `toJson()` envelope. Free functions (not class methods)
 * so `FakeSheet`/`FakeSpreadsheet` keep exposing only their GAS-parity
 * allowlist.
 */
import { FakeSheet } from './fake-sheet'
import { FakeSpreadsheet } from './fake-spreadsheet'
import { parseCsv, coerceCell } from './csv'
import { untagDates } from './json'
import type { SnapshotEnvelope } from './json'

/** Options for {@link fromCsv}. */
export interface FromCsvOptions {
  /** Emulate Sheets auto-typing (numbers/booleans/dates). Default `true`. */
  coerce?: boolean
}

function buildSheet(name: string, grid: unknown[][]): FakeSheet {
  const sheet = new FakeSheet(name)
  for (const row of grid) sheet.appendRow(row)
  return sheet
}

/** Builds a {@link FakeSpreadsheet} with one sheet per key; values used verbatim (no coercion). */
export function fromArrays(sheets: Record<string, unknown[][]>, name = 'Spreadsheet'): FakeSpreadsheet {
  const fakeSheets = Object.entries(sheets).map(([sheetName, grid]) => buildSheet(sheetName, grid))
  return new FakeSpreadsheet(name, fakeSheets)
}

/** Parses an RFC 4180 CSV string into a single {@link FakeSheet}. */
export function fromCsv(name: string, csv: string, opts: FromCsvOptions = {}): FakeSheet {
  const coerce = opts.coerce ?? true
  const rows = parseCsv(csv)
  const grid = coerce ? rows.map(row => row.map(coerceCell)) : rows
  return buildSheet(name, grid)
}

/** Rebuilds a {@link FakeSpreadsheet} from a {@link SnapshotEnvelope} produced by `toJson()`. */
export function fromJson(json: string, name = 'Spreadsheet'): FakeSpreadsheet {
  const envelope = JSON.parse(json) as SnapshotEnvelope
  const fakeSheets = Object.entries(envelope.sheets).map(([sheetName, entry]) => {
    const grid = untagDates(entry.grid)
    const sheet = buildSheet(sheetName, grid)
    sheet.setFrozenRows(entry.frozenRows ?? 0)
    return sheet
  })
  return new FakeSpreadsheet(name, fakeSheets)
}
