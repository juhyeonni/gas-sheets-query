/**
 * Versioned JSON snapshot envelope for a whole {@link FakeSpreadsheet}, with
 * `Date` cells tagged so `toJson()`/`fromJson()` round-trips exactly.
 */

/** A single sheet's exported grid + frozen-row state within a {@link SnapshotEnvelope}. */
export interface SnapshotSheetEntry {
  grid: unknown[][]
  frozenRows: number
}

/** The full `toJson()`/`fromJson()` wire format. */
export interface SnapshotEnvelope {
  version: 1
  sheets: Record<string, SnapshotSheetEntry>
}

interface DateTag {
  $date: string
}

function isDateTag(value: unknown): value is DateTag {
  return typeof value === 'object' && value !== null && '$date' in (value as Record<string, unknown>)
}

/** Replaces `Date` cells with `{ $date: ISOString }` tags for JSON serialization. */
export function tagDates(grid: unknown[][]): unknown[][] {
  return grid.map(row => row.map(cell => (cell instanceof Date ? { $date: cell.toISOString() } : cell)))
}

/** Reverses {@link tagDates}: replaces `{ $date: ISOString }` tags with `Date` instances. */
export function untagDates(grid: unknown[][]): unknown[][] {
  return grid.map(row => row.map(cell => (isDateTag(cell) ? new Date(cell.$date) : cell)))
}
