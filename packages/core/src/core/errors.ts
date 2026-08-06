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
