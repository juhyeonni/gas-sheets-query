/**
 * Custom error classes for gas-sheets-query
 * 
 * Provides descriptive errors with error codes for easier handling.
 */

/**
 * Base error class for gas-sheets-query
 */
export class SheetsQueryError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'SheetsQueryError'
    
    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Thrown when a table is not found in the database configuration
 */
export class TableNotFoundError extends SheetsQueryError {
  constructor(
    public readonly tableName: string,
    public readonly availableTables: string[]
  ) {
    super(
      `Table "${tableName}" not found. Available: ${availableTables.join(', ')}`,
      'TABLE_NOT_FOUND'
    )
    this.name = 'TableNotFoundError'
  }
}

/**
 * Thrown when a row is not found by ID
 */
export class RowNotFoundError extends SheetsQueryError {
  constructor(
    public readonly id: string | number,
    public readonly tableName?: string
  ) {
    const tableInfo = tableName ? ` in table "${tableName}"` : ''
    super(
      `Row with id "${id}" not found${tableInfo}`,
      'ROW_NOT_FOUND'
    )
    this.name = 'RowNotFoundError'
  }
}

/**
 * Thrown when an insert would create a row whose id already exists.
 *
 * Only client-supplied ids can collide (`idMode: 'client'`); auto-mode ids are
 * allocated under the write lock. A duplicate id is unreachable by id lookups,
 * so it is rejected instead of written (#128).
 */
export class DuplicateIdError extends SheetsQueryError {
  constructor(
    public readonly id: string | number,
    public readonly tableName?: string
  ) {
    const tableInfo = tableName ? ` in table "${tableName}"` : ''
    super(
      `Row with id "${id}" already exists${tableInfo}`,
      'DUPLICATE_ID'
    )
    this.name = 'DuplicateIdError'
  }
}

/**
 * Thrown when a query returns no results but one was expected
 */
export class NoResultsError extends SheetsQueryError {
  constructor(
    public readonly tableName?: string
  ) {
    const tableInfo = tableName ? ` in table "${tableName}"` : ''
    super(
      `No results found${tableInfo}`,
      'NO_RESULTS'
    )
    this.name = 'NoResultsError'
  }
}

/**
 * Thrown when a required store is missing
 */
export class MissingStoreError extends SheetsQueryError {
  constructor(
    public readonly tableName: string
  ) {
    super(
      `Missing store for table "${tableName}"`,
      'MISSING_STORE'
    )
    this.name = 'MissingStoreError'
  }
}

/**
 * Thrown when validation fails
 */
export class ValidationError extends SheetsQueryError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

/**
 * Thrown when an operation targets a column the store cannot represent.
 *
 * A positional store (SheetsAdapter) can only read and write the columns it was
 * declared with: `objectToRow` drops every other key. A schema operation on an
 * undeclared column therefore has no effect at all, so it fails loudly instead
 * of reporting a success it did not deliver (#127).
 */
export class UnknownColumnError extends SheetsQueryError {
  constructor(
    public readonly column: string,
    public readonly tableName: string,
    public readonly declaredColumns: string[]
  ) {
    super(
      `Column "${column}" is not declared for "${tableName}". ` +
      `Declared columns: ${declaredColumns.join(', ')}. ` +
      'Add the column to the store schema (or regenerate your types) before migrating.',
      'UNKNOWN_COLUMN'
    )
    this.name = 'UnknownColumnError'
  }
}

/**
 * Thrown when the physical layout of a sheet contradicts the declared schema.
 *
 * The adapter maps columns by position, so a header that is not the declared
 * column list (minus columns not yet added) means reads are already misaligned.
 * Writing into it would corrupt data, so the operation aborts (#127).
 */
export class SchemaMismatchError extends SheetsQueryError {
  constructor(
    public readonly tableName: string,
    public readonly actualHeader: string[],
    public readonly declaredColumns: string[]
  ) {
    super(
      `Sheet "${tableName}" header [${actualHeader.join(', ')}] does not match the ` +
      `declared columns [${declaredColumns.join(', ')}]. ` +
      'Align the sheet header with the schema before running schema operations.',
      'SCHEMA_MISMATCH'
    )
    this.name = 'SchemaMismatchError'
  }
}

/**
 * Thrown when an invalid operator is used
 */
export class InvalidOperatorError extends SheetsQueryError {
  constructor(
    public readonly operator: string,
    public readonly validOperators: string[]
  ) {
    super(
      `Invalid operator "${operator}". Valid operators: ${validOperators.join(', ')}`,
      'INVALID_OPERATOR'
    )
    this.name = 'InvalidOperatorError'
  }
}

/* -------------------------------------------------------------------------
 * GAS platform errors (#136)
 *
 * Apps Script reports every platform failure — quota exhaustion, a lock it
 * could not hand out, a Sheets backend hiccup — as a plain `Error` whose only
 * distinguishing feature is its message. Callers therefore cannot tell "come
 * back in a second" from "your code has a bug", and nothing can decide what
 * is worth retrying. The classes below give those failures a type, and
 * {@link classifyGasError} maps the platform's messages onto them.
 * ---------------------------------------------------------------------- */

/**
 * Thrown when the script lock could not be acquired within the timeout.
 *
 * `Lock.waitLock` is documented as "timing out with an exception"; that
 * exception used to escape `withScriptLock` raw. A lock timeout means another
 * execution is mid-write: the operation was not attempted at all, so it is
 * safe for the caller to retry it later (but not immediately — see
 * `withRetries`, which deliberately does not retry this).
 */
export class LockTimeoutError extends SheetsQueryError {
  constructor(
    /** The wait budget that elapsed, when the acquisition site knows it. */
    public readonly timeoutMs?: number,
    public readonly cause?: unknown
  ) {
    super(
      `Could not acquire the script lock${timeoutMs === undefined ? '' : ` within ${timeoutMs}ms`}. ` +
      'Another execution is holding it; no data was written. Retry the operation.',
      'LOCK_TIMEOUT'
    )
    this.name = 'LockTimeoutError'
  }
}

/**
 * Thrown when a GAS quota or rate limit was hit.
 *
 * `transient` separates the two very different kinds the platform words
 * almost identically: a short-term rate limit clears within seconds and is
 * worth a backoff, while a daily quota (or the 6-minute execution ceiling)
 * will not clear inside this execution — retrying it only burns what is left
 * of the run.
 */
export class QuotaExceededError extends SheetsQueryError {
  constructor(
    public readonly originalMessage: string,
    public readonly transient: boolean,
    public readonly cause?: unknown
  ) {
    super(
      `Google Apps Script quota exceeded${transient ? ' (rate limit, retryable)' : ' (not retryable in this execution)'}: ` +
      originalMessage,
      'QUOTA_EXCEEDED'
    )
    this.name = 'QuotaExceededError'
  }
}

/**
 * Thrown for a Sheets/Apps Script backend failure that is not a quota or a
 * lock — timeouts against the Spreadsheets service, internal errors, the
 * generic "a server error occurred". These are overwhelmingly transient.
 */
export class SheetsApiError extends SheetsQueryError {
  constructor(
    public readonly originalMessage: string,
    public readonly transient: boolean = true,
    public readonly cause?: unknown
  ) {
    super(`Google Sheets API error: ${originalMessage}`, 'SHEETS_API_ERROR')
    this.name = 'SheetsApiError'
  }
}

/**
 * Thrown when a serialized value would not fit in a single Sheets cell.
 *
 * A cell holds at most 50,000 characters. Without this guard the platform
 * discovers the overflow *during* the write, so a multi-row batch aborts
 * halfway and leaves a partial update behind (#136). The guard runs over the
 * whole batch before the first write, so the operation is all-or-nothing.
 */
export class CellSizeLimitError extends SheetsQueryError {
  constructor(
    public readonly column: string,
    public readonly length: number,
    public readonly limit: number,
    public readonly tableName: string,
    public readonly id?: string | number
  ) {
    const rowInfo = id === undefined ? '' : ` (row id "${id}")`
    super(
      `Value for column "${column}" in "${tableName}"${rowInfo} serializes to ${length} characters, ` +
      `over the ${limit}-character Google Sheets cell limit. ` +
      'Shorten the value, or split it across columns or a linked sheet. Nothing was written.',
      'CELL_SIZE_LIMIT'
    )
    this.name = 'CellSizeLimitError'
  }
}

/** How a matched GAS message is surfaced. */
type GasErrorKind = 'lock' | 'quota' | 'api'

/** One row of the classification table. */
interface GasErrorPattern {
  /** Lowercased substring searched for in the platform message. */
  readonly match: string
  /** Which typed error the match produces. */
  readonly kind: GasErrorKind
  /** Whether an immediate bounded retry can plausibly succeed. */
  readonly transient: boolean
  /** Why this string exists / where it comes from. */
  readonly note: string
}

/**
 * Known Apps Script failure messages, most specific first.
 *
 * Matching is a lowercased substring test, because the platform decorates
 * these strings with service names, document ids and hints
 * ("Service invoked too many times in a short time: spreadsheets. Try
 * Utilities.sleep(1000) between calls."), and the wording of the decoration
 * is not stable. The apostrophe in "We're sorry…" is dodged entirely by
 * matching from "sorry," onwards — the platform emits both the ASCII and the
 * typographic form.
 *
 * Sources:
 * - `Lock.waitLock` / `tryLock` semantics and the lock-timeout exception:
 *   https://developers.google.com/apps-script/reference/lock/lock
 * - Quota / rate-limit exception wording ("Service invoked too many times",
 *   "Service using too much computer time for one day", the 6-minute
 *   execution ceiling):
 *   https://developers.google.com/apps-script/guides/services/quotas
 * - "Service Spreadsheets timed out while accessing document with id …" and
 *   the recommendation to answer it with truncated exponential backoff:
 *   https://support.google.com/docs/thread/225093185
 *   https://gist.github.com/peterherrmann/2700284 (GASRetry)
 * - Generic server errors ("We're sorry, a server error occurred", "Internal
 *   error", "Unexpected error while getting the method or property …"):
 *   https://groups.google.com/g/google-apps-script-community/c/FcbkowjjXz8
 */
const GAS_ERROR_PATTERNS: readonly GasErrorPattern[] = [
  // --- lock acquisition -------------------------------------------------
  {
    match: 'lock timeout',
    kind: 'lock',
    transient: false,
    note: 'LockService.waitLock: "Lock timeout: another process was holding the lock for too long."'
  },
  {
    match: 'could not obtain lock',
    kind: 'lock',
    transient: false,
    note: 'Legacy LockService wording, still emitted by some runtimes.'
  },

  // --- terminal quotas (checked before the generic quota strings) -------
  {
    match: 'exceeded maximum execution time',
    kind: 'quota',
    transient: false,
    note: '6-minute per-execution ceiling. The runtime is killing the script; a retry cannot run.'
  },
  {
    match: 'too many times for one day',
    kind: 'quota',
    transient: false,
    note: '"Service invoked too many times for one day: <service>." Resets at midnight PT.'
  },
  {
    match: 'too much computer time for one day',
    kind: 'quota',
    transient: false,
    note: 'Daily total-runtime quota.'
  },

  // --- transient rate limits -------------------------------------------
  {
    match: 'too many times in a short time',
    kind: 'quota',
    transient: true,
    note: 'Short-term rate limit; the platform itself suggests Utilities.sleep between calls.'
  },
  {
    match: 'service invoked too many times',
    kind: 'quota',
    transient: true,
    note: 'Undecorated form of the rate limit; assumed short-term (the daily rows above win first).'
  },
  {
    match: 'rate limit exceeded',
    kind: 'quota',
    transient: true,
    note: 'Drive/Sheets REST wording that reaches Apps Script through advanced services.'
  },
  {
    match: 'ratelimitexceeded',
    kind: 'quota',
    transient: true,
    note: 'camelCase reason code from the JSON APIs.'
  },
  {
    match: 'quota exceeded',
    kind: 'quota',
    transient: true,
    note: 'Generic quota wording; short-term unless one of the daily rows matched first.'
  },

  // --- transient backend failures ---------------------------------------
  {
    match: 'timed out',
    kind: 'api',
    transient: true,
    note:
      '"Service Spreadsheets timed out while accessing document with id <id>." — the classic ' +
      'transient Sheets failure. The bare substring also covers the "Service timed out: Spreadsheets" ordering.'
  },
  {
    match: 'too many simultaneous invocations',
    kind: 'api',
    transient: true,
    note: 'Concurrent-execution contention against one document.'
  },
  {
    match: 'internal error',
    kind: 'api',
    transient: true,
    note: '"Internal error while accessing spreadsheet."'
  },
  {
    match: 'sorry, a server error occurred',
    kind: 'api',
    transient: true,
    note: 'Both the ASCII and typographic apostrophe forms of "We\'re sorry, …".'
  },
  {
    match: 'server error occurred',
    kind: 'api',
    transient: true,
    note: 'Shorter variant of the same server error.'
  },
  {
    match: 'unexpected error while getting the method or property',
    kind: 'api',
    transient: true,
    note: 'Widely reported transient failure when a SpreadsheetApp handle briefly goes bad.'
  },
  {
    match: 'service unavailable',
    kind: 'api',
    transient: true,
    note: '"Service unavailable: Spreadsheets".'
  },
  {
    match: 'service error:',
    kind: 'api',
    transient: true,
    note: '"Service error: Spreadsheets".'
  }
]

/** Best-effort message extraction from an unknown thrown value. */
function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  return undefined
}

/**
 * Map a thrown value onto a typed library error.
 *
 * Returns `undefined` when the value is not a recognized GAS platform failure
 * — an unrecognized error is a logical error, and silently relabelling it
 * would hide real bugs behind a retry loop. An error that is already a
 * {@link SheetsQueryError} is returned as-is.
 */
export function classifyGasError(error: unknown): SheetsQueryError | undefined {
  if (error instanceof SheetsQueryError) return error

  const message = messageOf(error)
  if (message === undefined) return undefined

  const haystack = message.toLowerCase()
  for (const pattern of GAS_ERROR_PATTERNS) {
    if (haystack.indexOf(pattern.match) === -1) continue

    switch (pattern.kind) {
      case 'lock':
        // The wait budget is not in the message; the acquisition site adds it.
        return new LockTimeoutError(undefined, error)
      case 'quota':
        return new QuotaExceededError(message, pattern.transient, error)
      case 'api':
        return new SheetsApiError(message, pattern.transient, error)
    }
  }

  return undefined
}

/**
 * Whether a bounded retry with backoff can plausibly succeed for this error.
 *
 * Deliberately false for {@link LockTimeoutError}: the caller already waited
 * the full lock timeout, so an immediate second wait just spends the same
 * budget again. Also false for anything unrecognized — retrying a logical
 * error multiplies its side effects instead of fixing it.
 */
export function isTransientGasError(error: unknown): boolean {
  const classified = classifyGasError(error)
  if (classified instanceof QuotaExceededError) return classified.transient
  if (classified instanceof SheetsApiError) return classified.transient
  return false
}
