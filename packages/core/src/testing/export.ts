/**
 * Snapshot exporters — read fake sheet/spreadsheet state back out as plain
 * grids, CSV, or a versioned JSON envelope. Free functions (not class
 * methods), mirroring {@link loaders}.
 */
import { FakeSheet } from './fake-sheet.js'
import { FakeSpreadsheet } from './fake-spreadsheet.js'
import { serializeCsvCell } from './csv.js'
import { tagDates } from './json.js'
import type { SnapshotEnvelope } from './json.js'

/**
 * A defensively-copied, rectangular grid of the sheet's content.
 * `[]` for an empty sheet (deliberately not `getDataRange()`'s 1x1 `['']`).
 */
export function toGrid(sheet: FakeSheet): unknown[][] {
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()
  if (lastRow === 0 || lastCol === 0) return []
  return sheet.getRange(1, 1, lastRow, lastCol).getValues()
}

/** RFC 4180 CSV of the sheet's content. `Date` → ISO string, boolean → `TRUE`/`FALSE`. */
export function toCsv(sheet: FakeSheet): string {
  return toGrid(sheet)
    .map(row => row.map(serializeCsvCell).join(','))
    .join('\r\n')
}

/** Versioned JSON snapshot of every sheet in the spreadsheet (see {@link SnapshotEnvelope}). */
export function toJson(spreadsheet: FakeSpreadsheet): string {
  const sheets: SnapshotEnvelope['sheets'] = {}
  for (const sheet of spreadsheet.getSheets()) {
    sheets[sheet.getName()] = {
      grid: tagDates(toGrid(sheet)),
      frozenRows: sheet.getFrozenRows()
    }
  }
  const envelope: SnapshotEnvelope = { version: 1, sheets }
  return JSON.stringify(envelope)
}
