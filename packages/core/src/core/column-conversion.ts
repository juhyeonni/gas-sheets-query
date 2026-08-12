/**
 * Column type conversion helpers
 *
 * Shared, adapter-independent implementation of the schema-driven
 * deserialization that turns raw transport/sheet values into the runtime types
 * the generated models declare (`datetime` -> `Date`, `string[]` -> array, ...).
 *
 * Used by the local-first client (#135) so that rows arriving from a sync pull
 * get the same treatment as rows read through SheetsAdapter.
 *
 * TODO: SheetsAdapter still carries a private copy of this logic
 * (`deserializeByType`). It should delegate here once the in-flight
 * serialization work on that file lands, so there is exactly one
 * implementation.
 */
import type { ColumnType } from '../adapters/sheets-adapter.js'

/**
 * Convert a single raw value to its runtime representation for `colType`.
 *
 * Idempotent: values that are already deserialized (a `Date` for a 'date'
 * column, an array for a 'string[]' column) are returned unchanged.
 */
export function deserializeColumnValue(value: unknown, colType: ColumnType): unknown {
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
      // the generated `Date` type (#97).
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
 * Apply {@link deserializeColumnValue} to every declared column of a row.
 *
 * Returns the row untouched when no column types are declared, so callers
 * without a typed schema keep their existing behavior. Columns absent from the
 * row are left absent rather than being filled with empty values.
 */
export function deserializeRow<T extends object>(
  row: T,
  columnTypes: Record<string, ColumnType> | undefined
): T {
  if (!columnTypes) return row

  const entries = Object.keys(columnTypes)
  if (entries.length === 0) return row

  let converted: Record<string, unknown> | undefined
  for (const col of entries) {
    if (!(col in row)) continue
    const raw = (row as Record<string, unknown>)[col]
    const next = deserializeColumnValue(raw, columnTypes[col])
    if (next === raw) continue
    if (!converted) converted = { ...(row as Record<string, unknown>) }
    converted[col] = next
  }

  return (converted as T | undefined) ?? row
}
