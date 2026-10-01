/**
 * Shared query utilities for evaluating conditions and sorting rows.
 * Used by MockAdapter, SheetsAdapter (local strategy) and the client LocalAdapter.
 *
 * Compiled predicates live only for one find() call. They are never cached on
 * builders, conditions or adapters, because where() keeps the caller's `in`
 * array by reference and the caller may mutate it between queries.
 */
import type { Row, WhereCondition, OrderByCondition, QueryOptions } from './types.js'

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
export function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

export type RowPredicate<T extends Row> = (row: T) => boolean

/**
 * Compile a where condition into a row predicate. The operand is converted
 * (and `like` / `in` operands are prepared) once, not once per row.
 */
export function compileCondition<T extends Row>(condition: WhereCondition<T>): RowPredicate<T> {
  const { field, operator } = condition
  const value = comparable(condition.value)

  switch (operator) {
    case '=':
      return row => comparable(row[field]) === value
    case '!=':
      return row => comparable(row[field]) !== value
    case '>':
      return row => (comparable(row[field]) as number) > (value as number)
    case '>=':
      return row => (comparable(row[field]) as number) >= (value as number)
    case '<':
      return row => (comparable(row[field]) as number) < (value as number)
    case '<=':
      return row => (comparable(row[field]) as number) <= (value as number)
    case 'like': {
      if (typeof value !== 'string') return () => false
      const pattern = escapeRegex(value).replace(/%/g, '.*').replace(/_/g, '.')
      const re = new RegExp(`^${pattern}$`, 'i')
      return row => {
        const fieldValue = comparable(row[field])
        return typeof fieldValue === 'string' && re.test(fieldValue)
      }
    }
    case 'in': {
      if (!Array.isArray(value)) return () => false
      const keys = new Set(value.map(comparable))
      return row => keys.has(comparable(row[field]))
    }
    default:
      return () => false
  }
}

/** Compile a list of conditions (AND) into one row predicate. */
export function compileWhere<T extends Row>(where: WhereCondition<T>[]): RowPredicate<T> {
  const predicates = where.map(compileCondition)
  return row => predicates.every(p => p(row))
}

/**
 * Evaluate a single where condition against a row
 */
export function evaluateCondition<T extends Row>(row: T, condition: WhereCondition<T>): boolean {
  return compileCondition(condition)(row)
}

/**
 * Compare two already-comparable() values. null/undefined sort last.
 */
function compareValues(aVal: unknown, bVal: unknown): number {
  if (aVal == null && bVal == null) return 0
  if (aVal == null) return 1
  if (bVal == null) return -1
  if ((aVal as number) < (bVal as number)) return -1
  if ((aVal as number) > (bVal as number)) return 1
  return 0
}

/**
 * Compare function for sorting rows.
 * Handles null/undefined by pushing them to the end.
 */
export function compareRows<T extends Row>(a: T, b: T, orderBy: OrderByCondition<T>[]): number {
  for (const { field, direction } of orderBy) {
    const comparison = compareValues(comparable(a[field]), comparable(b[field]))
    if (comparison !== 0) {
      return direction === 'asc' ? comparison : -comparison
    }
  }
  return 0
}

/**
 * Stable sort that converts each row's sort keys once. Returns a new array.
 */
export function sortRows<T extends Row>(rows: readonly T[], orderBy: OrderByCondition<T>[]): T[] {
  if (orderBy.length === 0) return [...rows]
  const decorated = rows.map(row => ({ row, keys: orderBy.map(o => comparable(row[o.field])) }))
  decorated.sort((a, b) => {
    for (let i = 0; i < orderBy.length; i++) {
      const comparison = compareValues(a.keys[i], b.keys[i])
      if (comparison !== 0) {
        return orderBy[i].direction === 'asc' ? comparison : -comparison
      }
    }
    return 0
  })
  return decorated.map(d => d.row)
}

/**
 * Filter, sort, offset and limit rows. Never mutates `rows` and always
 * returns a new array. Without an orderBy and with a limit, it stops
 * evaluating rows once offset + limit matches are found.
 */
export function applyQuery<T extends Row>(
  rows: readonly T[],
  where: WhereCondition<T>[],
  options: Pick<QueryOptions<T>, 'orderBy' | 'limitValue' | 'offsetValue'>
): T[] {
  const offset = options.offsetValue !== undefined && options.offsetValue > 0 ? options.offsetValue : 0
  const limit = options.limitValue !== undefined && options.limitValue >= 0 ? options.limitValue : undefined
  const predicate = compileWhere(where)
  const stopAt = options.orderBy.length === 0 && limit !== undefined ? offset + limit : undefined

  const matched: T[] = []
  if (stopAt !== 0) {
    for (const row of rows) {
      if (predicate(row)) {
        matched.push(row)
        if (matched.length === stopAt) break
      }
    }
  }

  const result = sortRows(matched, options.orderBy).slice(offset)
  return limit === undefined ? result : result.slice(0, limit)
}
