/**
 * RFC 4180 CSV parsing/serialization and Sheets-style auto-typing coercion,
 * shared by the snapshot loaders and exporters.
 */

/** Parses an RFC 4180 CSV string into rows of raw string cells. */
export function parseCsv(csv: string): string[][] {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv
  if (text === '') return []

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i += 1
        }
      } else {
        field += ch
        i += 1
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
    } else if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
    } else if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i += 1
    }
  }

  if (inQuotes) {
    throw new Error('parseCsv: unterminated quoted field')
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Serializes a single cell for CSV output, applying RFC 4180 quoting where needed. */
export function serializeCsvCell(value: unknown): string {
  let raw: string
  if (value instanceof Date) {
    raw = value.toISOString()
  } else if (typeof value === 'boolean') {
    raw = value ? 'TRUE' : 'FALSE'
  } else if (value === null || value === undefined) {
    raw = ''
  } else {
    raw = String(value)
  }

  return /["\r\n,]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/
const BOOLEAN_RE = /^(true|false)$/i
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/

/**
 * Emulates Google Sheets' cell auto-typing when loading a raw CSV/text cell:
 * numeric strings become numbers, `true`/`false` (any case) become booleans,
 * and valid ISO 8601 date/datetime strings become `Date`s. Anything that
 * doesn't cleanly match — including out-of-range dates like `"2026-13-99"` —
 * is left as a string.
 */
export function coerceCell(raw: string): unknown {
  if (raw === '') return ''
  if (BOOLEAN_RE.test(raw)) return raw.toLowerCase() === 'true'
  if (NUMBER_RE.test(raw)) return Number(raw)

  const match = raw.match(ISO_DATE_RE)
  if (match) {
    const [, , month, day, hour = '0', minute = '0', second = '0'] = match
    const isValidRange =
      Number(month) >= 1 && Number(month) <= 12 &&
      Number(day) >= 1 && Number(day) <= 31 &&
      Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    if (isValidRange) {
      const parsed = new Date(raw)
      if (!isNaN(parsed.getTime())) return parsed
    }
  }

  return raw
}
