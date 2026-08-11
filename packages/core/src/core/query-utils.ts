/**
 * Shared query utilities for evaluating conditions and sorting rows.
 * Used by both MockAdapter and SheetsAdapter (local strategy).
 */
import type { Row, WhereCondition, OrderByCondition } from './types.js'

/**
 * Escape regex special characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Dates compare by instant, not object identity (#192): a `date` column
 * deserializes to a Date, so `where(col, '=', new Date(t))` used to hit
 * `===` and never match anything.
 */
function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

/**
 * Evaluate a single where condition against a row
 */
export function evaluateCondition<T extends Row>(row: T, condition: WhereCondition<T>): boolean {
  const { field, operator } = condition
  const fieldValue = comparable(row[field])
  const value = comparable(condition.value)

  switch (operator) {
    case '=':
      return fieldValue === value
    case '!=':
      return fieldValue !== value
    case '>':
      return (fieldValue as number) > (value as number)
    case '>=':
      return (fieldValue as number) >= (value as number)
    case '<':
      return (fieldValue as number) < (value as number)
    case '<=':
      return (fieldValue as number) <= (value as number)
    case 'like':
      if (typeof fieldValue !== 'string' || typeof value !== 'string') return false
      const escaped = escapeRegex(value)
      const pattern = escaped.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(fieldValue)
    case 'in':
      return Array.isArray(value) && value.map(comparable).includes(fieldValue)
    default:
      return false
  }
}

/**
 * Compare function for sorting rows.
 * Handles null/undefined by pushing them to the end.
 */
export function compareRows<T extends Row>(a: T, b: T, orderBy: OrderByCondition<T>[]): number {
  for (const { field, direction } of orderBy) {
    const aVal = a[field]
    const bVal = b[field]

    let comparison = 0
    if ((aVal == null) && (bVal == null)) comparison = 0
    else if (aVal == null) comparison = 1
    else if (bVal == null) comparison = -1
    else if (aVal < bVal) comparison = -1
    else if (aVal > bVal) comparison = 1

    if (comparison !== 0) {
      return direction === 'asc' ? comparison : -comparison
    }
  }
  return 0
}
