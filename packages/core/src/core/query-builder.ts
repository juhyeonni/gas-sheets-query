/**
 * Query Builder - fluent API for building queries
 */
import type { RowWithId, DataStore, QueryOptions, Operator, SingleValueOperator, SortDirection, WhereCondition, OrderByCondition } from './types.js'
import { NoResultsError, SheetsQueryError } from './errors.js'
import { serializeValues } from './index-store.js'

/**
 * Columns of `T` whose type can hold a number: `number`, a numeric literal, or a
 * union that includes one, such as `number | null` or an optional `number`.
 * Aggregating any other column always yields 0 or null, so the aggregation
 * methods and the `agg()` spec fields accept only these.
 */
export type NumericColumn<T> = {
  [K in keyof T & string]-?: CanHoldNumber<T[K]> extends true ? K : never
}[keyof T & string]

type CanHoldNumber<V> = number extends V
  ? true
  : [Extract<V, number>] extends [never] ? false : true

/**
 * Aggregation specification
 * - 'count' - count of rows in group
 * - 'sum:field' - sum of field values
 * - 'avg:field' - average of field values
 * - 'min:field' - minimum field value
 * - 'max:field' - maximum field value
 *
 * `F` is the set of allowed field names. `agg()` passes the numeric columns of
 * the row type; a bare `AggSpec` accepts any field name.
 */
export type AggSpec<F extends string = string> =
  | 'count'
  | `sum:${F}`
  | `avg:${F}`
  | `min:${F}`
  | `max:${F}`

/**
 * Aggregation result object
 */
export type AggResult<T extends Record<string, AggSpec>> = {
  [K in keyof T]: number
}

/**
 * Grouped aggregation result with group key
 */
export type GroupedAggResult<G extends string, T extends Record<string, AggSpec>> = 
  { [K in G]: unknown } & AggResult<T>

/**
 * Having condition for filtering groups
 */
export interface HavingCondition {
  aggName: string
  operator: Operator
  value: number
}

/**
 * QueryBuilder provides a fluent interface for building and executing queries
 *
 * `G` holds the `groupBy()` keys, which `agg()` results expose next to the
 * spec names. It defaults to no keys.
 *
 * @example
 * ```ts
 * const users = query
 *   .where('active', '=', true)
 *   .where('age', '>', 18)
 *   .orderBy('name', 'asc')
 *   .limit(10)
 *   .exec()
 * ```
 */
export class QueryBuilder<T extends RowWithId, G extends keyof T & string = never> {
  private whereConditions: WhereCondition<T>[] = []
  private orderByConditions: OrderByCondition<T>[] = []
  private limitValue?: number
  private offsetValue?: number
  private groupByFields: (keyof T & string)[] = []
  private havingConditions: HavingCondition[] = []

  constructor(private readonly store: DataStore<T>) {}

  /**
   * Add a where condition
   * Multiple where calls are combined with AND
   *
   * When operator is 'in', value must be an array.
   * For all other operators, value must be a single value.
   */
  where<K extends keyof T & string>(field: K, operator: 'in', value: T[K][]): this
  where<K extends keyof T & string>(field: K, operator: SingleValueOperator, value: T[K]): this
  where<K extends keyof T & string>(
    field: K,
    operator: Operator,
    value: T[K] | T[K][]
  ): this {
    this.whereConditions.push({
      field,
      operator,
      value
    } as WhereCondition<T>)
    return this
  }

  /**
   * Shorthand for where(field, '=', value)
   */
  whereEq<K extends keyof T & string>(field: K, value: T[K]): this {
    return this.where(field, '=', value)
  }

  /**
   * Shorthand for where(field, '!=', value)
   */
  whereNot<K extends keyof T & string>(field: K, value: T[K]): this {
    return this.where(field, '!=', value)
  }

  /**
   * Shorthand for where(field, 'in', values)
   */
  whereIn<K extends keyof T & string>(field: K, values: T[K][]): this {
    return this.where(field, 'in', values)
  }

  /**
   * Shorthand for where(field, 'like', pattern)
   */
  whereLike<K extends keyof T & string>(field: K, pattern: string): this {
    return this.where(field, 'like', pattern as T[K])
  }

  /**
   * Add an order by condition
   */
  orderBy<K extends keyof T & string>(field: K, direction: SortDirection = 'asc'): this {
    this.orderByConditions.push({ field, direction })
    return this
  }

  /**
   * Set the maximum number of results
   */
  limit(count: number): this {
    this.limitValue = count
    return this
  }

  /**
   * Set the number of results to skip
   */
  offset(count: number): this {
    this.offsetValue = count
    return this
  }

  /**
   * Shorthand for offset/limit for pagination
   */
  page(pageNumber: number, pageSize: number): this {
    this.offsetValue = (pageNumber - 1) * pageSize
    this.limitValue = pageSize
    return this
  }

  /**
   * Build the query options without executing
   */
  build(): QueryOptions<T> {
    return {
      where: [...this.whereConditions],
      orderBy: [...this.orderByConditions],
      limitValue: this.limitValue,
      offsetValue: this.offsetValue
    }
  }

  /**
   * Execute the query and return results
   */
  exec(): T[] {
    return this.store.find(this.build())
  }

  /**
   * Execute and return the first result or undefined
   */
  first(): T | undefined {
    // Build with limit 1 without mutating this builder, so it stays reusable.
    const results = this.store.find({ ...this.build(), limitValue: 1 })
    return results[0]
  }

  /**
   * Execute and return the first result or throw
   * @throws NoResultsError if no results found
   */
  firstOrFail(): T {
    const result = this.first()
    if (!result) {
      throw new NoResultsError()
    }
    return result
  }

  /**
   * Execute and return count of results
   */
  count(): number {
    return this.findUnpaginated(false).length
  }

  /**
   * Calculate sum of a numeric field
   * Returns 0 for empty datasets (sum of nothing is 0)
   */
  sum<K extends NumericColumn<T>>(field: K): number {
    return this.numericValues(this.findUnpaginated(false), field)
      .reduce((a, b) => a + b, 0)
  }

  /**
   * Calculate average of a numeric field
   * Returns null if no rows match
   */
  avg<K extends NumericColumn<T>>(field: K): number | null {
    const values = this.numericValues(this.findUnpaginated(false), field)
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  /**
   * Find minimum value of a field
   * Returns null if no rows or no numeric values exist
   */
  min<K extends NumericColumn<T>>(field: K): number | null {
    const values = this.numericValues(this.findUnpaginated(false), field)
    return values.length > 0 ? values.reduce((a, b) => Math.min(a, b), Infinity) : null
  }

  /**
   * Find maximum value of a field
   * Returns null if no rows or no numeric values exist
   */
  max<K extends NumericColumn<T>>(field: K): number | null {
    const values = this.numericValues(this.findUnpaginated(false), field)
    return values.length > 0 ? values.reduce((a, b) => Math.max(a, b), -Infinity) : null
  }

  /**
   * Group by one or more fields
   * The keys become part of the builder's type, so `agg()` results expose them.
   * A second call replaces the keys.
   */
  groupBy<K extends keyof T & string>(...fields: K[]): QueryBuilder<T, K> {
    this.groupByFields = fields
    return this as unknown as QueryBuilder<T, K>
  }

  /**
   * Filter groups by aggregation condition
   * `aggName` must be one of the spec names passed to `agg()`, or `agg()` throws.
   * Without groupBy(), `agg()` ignores the condition.
   */
  having(aggName: string, operator: Operator, value: number): this {
    this.havingConditions.push({ aggName, operator, value })
    return this
  }

  /**
   * Execute aggregation and return results
   * If groupBy() was called, returns grouped results
   * Otherwise returns a single aggregation result
   *
   * orderBy decides the order of groups; it is ignored by count/sum/avg/min/max
   * and by agg() without groupBy().
   *
   * Each spec field must be a numeric column of the row type.
   * @throws SheetsQueryError if a having() alias is not one of the spec names
   */
  agg<A extends Record<string, AggSpec<NumericColumn<T>>>>(specs: A): GroupedAggResult<G, A>[] {
    this.assertHavingAliases(specs)
    const rows = this.findUnpaginated(this.groupByFields.length > 0)

    if (this.groupByFields.length === 0) {
      // No grouping - return single result
      const result = this.computeAggregations(rows, specs)
      return [result as GroupedAggResult<G, A>]
    }
    
    // Group rows by fields
    const groups = new Map<string, T[]>()
    for (const row of rows) {
      const key = serializeValues(this.groupByFields.map(f => row[f]))
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }
    
    // Compute aggregations for each group
    const results: GroupedAggResult<G, A>[] = []
    
    for (const [, groupRows] of groups) {
      const aggs = this.computeAggregations(groupRows, specs)
      
      // Apply having conditions
      if (!this.passesHavingConditions(aggs)) {
        continue
      }
      
      // Add group key fields
      const result: Record<string, unknown> = { ...aggs }
      for (const field of this.groupByFields) {
        result[field] = groupRows[0][field]
      }
      
      results.push(result as GroupedAggResult<G, A>)
    }
    
    return results
  }

  /**
   * Check if any results exist
   */
  exists(): boolean {
    return this.first() !== undefined
  }

  /**
   * Clone this query builder for modification
   */
  clone(): QueryBuilder<T, G> {
    const cloned = new QueryBuilder<T, G>(this.store)
    cloned.whereConditions = [...this.whereConditions]
    cloned.orderByConditions = [...this.orderByConditions]
    cloned.limitValue = this.limitValue
    cloned.offsetValue = this.offsetValue
    cloned.groupByFields = [...this.groupByFields]
    cloned.havingConditions = [...this.havingConditions]
    return cloned
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Fetch all matching rows, ignoring limit/offset. Sorting is only requested
   * when the order of the result matters (grouped aggregation).
   */
  private findUnpaginated(ordered: boolean): T[] {
    return this.store.find({
      where: [...this.whereConditions],
      orderBy: ordered ? [...this.orderByConditions] : []
    })
  }

  /**
   * The number values of a field across rows; other values are skipped
   */
  private numericValues(rows: T[], field: string): number[] {
    return rows
      .map(row => (row as Record<string, unknown>)[field])
      .filter((v): v is number => typeof v === 'number')
  }

  /**
   * Throw when a having() alias is not one of the agg() spec names: such a
   * condition would otherwise pass every group
   */
  private assertHavingAliases(specs: Record<string, AggSpec>): void {
    for (const { aggName } of this.havingConditions) {
      if (!Object.prototype.hasOwnProperty.call(specs, aggName)) {
        throw new SheetsQueryError(
          `having() references unknown aggregation "${aggName}". ` +
          `It must be one of the agg() spec names: ${Object.keys(specs).join(', ')}`,
          'UNKNOWN_AGGREGATION'
        )
      }
    }
  }

  /**
   * Compute aggregation values for a set of rows
   */
  private computeAggregations<A extends Record<string, AggSpec>>(
    rows: T[],
    specs: A
  ): AggResult<A> {
    const result: Record<string, number> = {}

    for (const [name, spec] of Object.entries(specs)) {
      if (spec === 'count') {
        result[name] = rows.length
      } else {
        const [fn, field] = spec.split(':')
        const values = this.numericValues(rows, field)

        switch (fn) {
          case 'sum':
            result[name] = values.reduce((a, b) => a + b, 0)
            break
          case 'avg':
            result[name] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
            break
          case 'min':
            result[name] = values.length > 0 ? values.reduce((a, b) => Math.min(a, b), Infinity) : 0
            break
          case 'max':
            result[name] = values.length > 0 ? values.reduce((a, b) => Math.max(a, b), -Infinity) : 0
            break
        }
      }
    }
    
    return result as AggResult<A>
  }

  /**
   * Check if aggregation results pass all having conditions
   */
  private passesHavingConditions(aggs: Record<string, number>): boolean {
    for (const cond of this.havingConditions) {
      // agg() has checked that every alias is one of the spec names
      if (!this.compareValues(aggs[cond.aggName], cond.operator, cond.value)) {
        return false
      }
    }
    return true
  }

  /**
   * Compare two values with an operator
   */
  private compareValues(left: number, operator: Operator, right: number): boolean {
    switch (operator) {
      case '=': return left === right
      case '!=': return left !== right
      case '>': return left > right
      case '>=': return left >= right
      case '<': return left < right
      case '<=': return left <= right
      default: return true
    }
  }
}

/**
 * Create a new QueryBuilder for the given store
 */
export function createQueryBuilder<T extends RowWithId>(
  store: DataStore<T>
): QueryBuilder<T> {
  return new QueryBuilder<T>(store)
}
