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
